import { AutoTokenizer, AutoModel, env } from "@xenova/transformers";
import os from "node:os";
import fs from "node:fs";
import { join } from "pathe";
import { dotProduct, normalizeVector } from "../shared/numeric";

// 全机公共离线模型权重缓存：Ghost 与 TeamWiki 共享 ~/.cache/onnx-models
const SHARED_CACHE_DIR = join(os.homedir(), ".cache", "onnx-models");
env.localModelPath = SHARED_CACHE_DIR;

const DEFAULT_MODEL = "Xenova/bge-small-zh-v1.5";
const SPECIAL_TOKENS = new Set(["[CLS]", "[SEP]", "<s>", "</s>"]);

export interface LateChunkSectionSpan {
  anchor: string;
  title: string;
  startOffset: number;
  endOffset: number;
}

export interface LateChunkItem {
  anchor: string;
  title: string;
  vector: number[];
}

export interface LateChunkOutput {
  docVector: number[];
  chunks: LateChunkItem[];
}

/** 外部 ONNX 运行时的最小结构化契约，替代散落 any */
interface EncodedInputs {
  readonly input_ids: { readonly data: ArrayLike<number> };
}
interface HiddenState {
  readonly dims: readonly number[];
  readonly data: Float32Array;
}
interface TokenizerRuntime {
  (text: string, options?: Record<string, unknown>): Promise<EncodedInputs> | EncodedInputs;
  readonly model: { convert_ids_to_tokens(ids: number[]): string[] };
}
interface ModelRuntime {
  (inputs: unknown): Promise<{ last_hidden_state: HiddenState }>;
}

let cachedTokenizer: TokenizerRuntime | null = null;
let cachedModel: ModelRuntime | null = null;

/** 惰性初始化纯 ONNX 本地嵌入模型，命中共享缓存即强制离线 */
export async function getSharedEmbeddingModel(
  modelName = DEFAULT_MODEL
): Promise<{ tokenizer: TokenizerRuntime; model: ModelRuntime }> {
  if (!cachedTokenizer || !cachedModel) {
    if (fs.existsSync(join(SHARED_CACHE_DIR, modelName))) env.allowRemoteModels = false;
    cachedTokenizer = await AutoTokenizer.from_pretrained(modelName) as unknown as TokenizerRuntime;
    cachedModel = await AutoModel.from_pretrained(modelName) as unknown as ModelRuntime;
  }
  return { tokenizer: cachedTokenizer, model: cachedModel };
}

/** 字符偏移量区间映射为 Token 下标区间（跳过特殊标记） */
function mapCharOffsetsToTokenRange(
  charStart: number,
  charEnd: number,
  tokens: readonly string[]
): [number, number] {
  const { spans } = tokens.reduce<{
    cursor: number;
    spans: { index: number; start: number; end: number }[];
  }>(
    (acc, rawTok, index) => {
      if (SPECIAL_TOKENS.has(rawTok)) return acc;
      const length = rawTok.replace(/^##/, "").length;
      const span = { index, start: acc.cursor, end: acc.cursor + length };
      return { cursor: span.end, spans: [...acc.spans, span] };
    },
    { cursor: 0, spans: [] }
  );

  const covered = spans.filter((span) => span.end > charStart && span.start < charEnd);
  const from = covered[0]?.index ?? 1;
  const to = (covered.at(-1)?.index ?? Math.min(tokens.length - 2, from)) + 1;
  return [from, Math.max(from + 1, Math.min(to, tokens.length))];
}

/** 对指定 Token 区间做均值池化（数值内核保留紧凑循环以保证吞吐） */
function poolTokens(
  data: Float32Array,
  hiddenDim: number,
  seqLen: number,
  tokens: readonly string[],
  range: readonly number[]
): { mean: number[]; count: number } {
  let count = 0;
  const sum = range.reduce<Float64Array>((acc, t) => {
    if (t >= seqLen || SPECIAL_TOKENS.has(tokens[t])) return acc;
    count++;
    const offset = t * hiddenDim;
    return Float64Array.from(acc, (value, d) => value + data[offset + d]);
  }, new Float64Array(hiddenDim));

  return {
    count,
    mean: count > 0 ? [...sum].map((value) => value / count) : new Array<number>(hiddenDim).fill(0),
  };
}

/**
 * Late Chunking：整篇送入 Transformer 后按章节 Span 池化，
 * 章节向量天然浸润全文自注意力上下文。
 */
export async function computeLateChunking(
  fullText: string,
  sections: LateChunkSectionSpan[],
  modelName = DEFAULT_MODEL
): Promise<LateChunkOutput> {
  const { tokenizer, model } = await getSharedEmbeddingModel(modelName);

  const inputs = await tokenizer(fullText, { max_length: 512, truncation: true });
  const inputIds = Array.from(inputs.input_ids.data);
  const tokens = tokenizer.model.convert_ids_to_tokens(inputIds);

  const outputs = await model(inputs);
  const lastHiddenState = outputs.last_hidden_state;
  const [_batch, seqLen, hiddenDim] = lastHiddenState.dims;
  const tensorData = lastHiddenState.data;

  const allTokens = Array.from({ length: seqLen }, (_, idx) => idx);
  const { mean: globalMean } = poolTokens(tensorData, hiddenDim, seqLen, tokens, allTokens);
  const docVector = normalizeVector(globalMean);

  const chunks = sections.map((section): LateChunkItem => {
    const [tFrom, tTo] = mapCharOffsetsToTokenRange(section.startOffset, section.endOffset, tokens);
    const range = Array.from({ length: tTo - tFrom }, (_, idx) => tFrom + idx);
    const pooled = poolTokens(tensorData, hiddenDim, seqLen, tokens, range);
    return {
      anchor: section.anchor,
      title: section.title,
      vector: normalizeVector(pooled.count > 0 ? pooled.mean : globalMean),
    };
  });

  return { docVector, chunks };
}

export interface LocatedSectionResult {
  anchor: string;
  title: string;
  score: number;
}

/** 章节级微观精确定位：Query 向量与各章节 Late Chunk 向量比对 */
export async function locateTopSectionsWithLateChunking(
  query: string,
  docText: string,
  sections: LateChunkSectionSpan[],
  topK = 2
): Promise<LocatedSectionResult[]> {
  if (!query.trim() || !docText.trim() || sections.length === 0) return [];

  const { tokenizer, model } = await getSharedEmbeddingModel();
  const queryInputs = await tokenizer(query.trim(), { padding: true, truncation: true });
  const queryOutputs = await model(queryInputs);
  const qState = queryOutputs.last_hidden_state;
  const [_b, qSeqLen, qHiddenDim] = qState.dims;

  const { mean: queryMean } = poolTokens(
    qState.data,
    qHiddenDim,
    qSeqLen,
    new Array<string>(qSeqLen).fill(""),
    Array.from({ length: qSeqLen }, (_, idx) => idx)
  );
  const queryVector = normalizeVector(queryMean);

  const { chunks } = await computeLateChunking(docText, sections);
  return chunks
    .map((chunk) => ({
      anchor: chunk.anchor,
      title: chunk.title,
      score: Number(dotProduct(queryVector, chunk.vector).toFixed(4)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
