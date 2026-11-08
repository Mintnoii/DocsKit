import { AutoTokenizer, AutoModel, env } from "@xenova/transformers";
import os from "node:os";
import fs from "node:fs";
import { join } from "pathe";

// 规范全机公共离线模型权重缓存目录，Ghost 与 TeamWiki 共享 ~/.cache/onnx-models
const SHARED_CACHE_DIR = join(os.homedir(), ".cache", "onnx-models");
env.localModelPath = SHARED_CACHE_DIR;

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

let cachedTokenizer: any = null;
let cachedModel: any = null;
const DEFAULT_MODEL = "Xenova/bge-small-zh-v1.5";

/**
 * 惰性初始化纯 ONNX 本地嵌入模型与分词器 (零 Python、零独立服务进程)
 */
export async function getSharedEmbeddingModel(modelName = DEFAULT_MODEL) {
  if (!cachedTokenizer || !cachedModel) {
    // 检查本地共享缓存中是否存在该模型，存在则强制纯离线加载，阻断外网拉取超时
    const localDir = join(SHARED_CACHE_DIR, modelName);
    if (fs.existsSync(localDir)) {
      env.allowRemoteModels = false;
    }
    cachedTokenizer = await AutoTokenizer.from_pretrained(modelName);
    cachedModel = await AutoModel.from_pretrained(modelName);
  }
  return { tokenizer: cachedTokenizer, model: cachedModel };
}

/**
 * L2 范数归一化向量
 */
function normalizeVector(vec: number[]): number[] {
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  const norm = Math.sqrt(sumSq) || 1e-12;
  return vec.map((v) => v / norm);
}

/**
 * 将字符偏移量区间转换为 Token 下标区间
 */
function mapCharOffsetsToTokenRange(
  charStart: number,
  charEnd: number,
  tokens: string[]
): [number, number] {
  let curChar = 0;
  let tokenStart = -1;
  let tokenEnd = -1;

  for (let i = 0; i < tokens.length; i++) {
    const rawTok = tokens[i];
    // 忽略特殊标记
    if (rawTok === "[CLS]" || rawTok === "[SEP]" || rawTok === "<s>" || rawTok === "</s>") {
      continue;
    }
    const cleanTok = rawTok.replace(/^##/, "");
    const tokLen = cleanTok.length;
    const tokStart = curChar;
    const tokEnd = curChar + tokLen;

    if (tokEnd > charStart && tokenStart === -1) {
      tokenStart = i;
    }
    if (tokStart < charEnd) {
      tokenEnd = i + 1;
    }
    curChar += tokLen;
  }

  // 兜底防越界
  if (tokenStart === -1) tokenStart = 1;
  if (tokenEnd === -1 || tokenEnd <= tokenStart) tokenEnd = Math.min(tokens.length - 1, tokenStart + 1);

  return [tokenStart, tokenEnd];
}

/**
 * 跨工程通用 Late Chunking 计算核心
 * 
 * 机制：
 * 1. 先将整篇文本完整送入 Transformer，获取整篇 Token 级全局隐层特征矩阵 [1, seq_len, hidden_dim]；
 * 2. 对整篇计算 [CLS] 或全局 Mean-Pooling 获得 docVector；
 * 3. 顺着 AST 各章节的字符 Span，映射到对应的 Token 子区间，进行 Mean-Pooling 得到各章节向量。
 * 产出的章节向量天然浸润了整篇文本全局自注意力的上下文！
 */
export async function computeLateChunking(
  fullText: string,
  sections: LateChunkSectionSpan[],
  modelName = DEFAULT_MODEL
): Promise<LateChunkOutput> {
  const { tokenizer, model } = await getSharedEmbeddingModel(modelName);

  // 1. 整体文本编码 (截断到模型最大支持长度，如 512，避免维度广播溢出)
  const inputs = tokenizer(fullText, {
    max_length: 512,
    truncation: true,
  });
  const inputIds: number[] = Array.from(inputs.input_ids.data);
  const tokens: string[] = tokenizer.model.convert_ids_to_tokens(inputIds);

  // 2. Transformer 推理得到所有 Token 最后一层特征张量: dims = [1, seq_len, hidden_dim]
  const outputs = await model(inputs);
  const lastHiddenState = outputs.last_hidden_state;
  const [_batch, seqLen, hiddenDim] = lastHiddenState.dims;
  const tensorData: Float32Array = lastHiddenState.data;

  // 3. 计算整卡 docVector (全局均值池化)
  const globalSum = new Float64Array(hiddenDim);
  let validTokenCount = 0;
  for (let t = 0; t < seqLen; t++) {
    const tok = tokens[t];
    if (tok === "[CLS]" || tok === "[SEP]") continue;
    validTokenCount++;
    const offset = t * hiddenDim;
    for (let d = 0; d < hiddenDim; d++) {
      globalSum[d] += tensorData[offset + d];
    }
  }
  const globalMean = new Array(hiddenDim);
  for (let d = 0; d < hiddenDim; d++) {
    globalMean[d] = validTokenCount > 0 ? globalSum[d] / validTokenCount : 0;
  }
  const docVector = normalizeVector(globalMean);

  // 4. 按 AST 章节 Span 提取具有全局上下文的章节向量 (Late Chunking Mean-Pooling)
  const chunks: LateChunkItem[] = [];

  for (const sec of sections) {
    const [tFrom, tTo] = mapCharOffsetsToTokenRange(sec.startOffset, sec.endOffset, tokens);
    const chunkSum = new Float64Array(hiddenDim);
    let count = 0;

    for (let t = tFrom; t < tTo && t < seqLen; t++) {
      const tok = tokens[t];
      if (tok === "[CLS]" || tok === "[SEP]") continue;
      count++;
      const offset = t * hiddenDim;
      for (let d = 0; d < hiddenDim; d++) {
        chunkSum[d] += tensorData[offset + d];
      }
    }

    const chunkMean = new Array(hiddenDim);
    for (let d = 0; d < hiddenDim; d++) {
      chunkMean[d] = count > 0 ? chunkSum[d] / count : globalMean[d];
    }

    chunks.push({
      anchor: sec.anchor,
      title: sec.title,
      vector: normalizeVector(chunkMean),
    });
  }

  return { docVector, chunks };
}
