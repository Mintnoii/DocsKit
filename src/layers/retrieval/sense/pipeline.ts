import { POLICY } from "../../../contracts/policy";
import { sort, tryit, unique } from "radash";
import { computeSha256Hex } from "../../../foundation/hash";
import { collapseWhitespace } from "../../../contracts/markdown";
import {
  cleanTextForVector,
  buildNgramVocabulary,
  textToNgramVector,
  cosineSimilarityVectors,
} from "../../../foundation/numeric";
import { rrfFuseScores } from "./rrf";
import { createReranker, type RerankConfig, type RerankOutput } from "./reranker";

export interface HybridSearchableDocument {
  id: string;
  title: string;
  searchBody: string;
}

/** 重排真实生效状态，随结果一并回传，不靠 stderr 警告 */
export interface HybridRerankState {
  readonly applied: boolean;
  readonly backend: string;
  readonly fallbackReason?: string;
  /** 本次分数来自缓存而非实时模型调用 */
  readonly cached?: boolean;
}

export interface HybridRankResult {
  id: string;
  rrfScore: number;
  bm25Rank?: number;
  vectorRank?: number;
  /** 未启用 rerank 时为 undefined */
  rerank?: HybridRerankState;
  /** rerank 真实相关度分数；未参与精排或未启用时为 undefined */
  rerankScore?: number;
}

export interface HybridRankingPipelineOptions {
  rrfK?: number;
  candidateLimit?: number;
  rerank?: RerankConfig;
  /** rerank 结果缓存开关，默认开启 */
  rerankCache?: boolean;
}

const BM25_MIN_SCORE = POLICY.sense.bm25MinScore;
const VECTOR_MIN_SCORE = POLICY.sense.vectorMinScore;
const DEFAULT_RRF_K = POLICY.sense.rrfK;
const DEFAULT_LIMIT = POLICY.sense.candidateLimit;
const DEFAULT_RERANK_CACHE_LIMIT = POLICY.sense.rerankCacheLimit;

/**
 * rerank 结果缓存（进程内）
 *
 * 同一 query 重复提问时，云端精排的往返开销不该重付。缓存键含候选集内容
 * 哈希与后端标识，候选集或模型一变自然不命中。
 *
 * 只缓存 applied=true 的结果：降级分数是恒保序的假分数，缓存下来会
 * 掩盖「模型没生效」这个事实。
 */
const rerankCache = new Map<string, RerankOutput>();
const RERANK_CACHE_LIMIT = DEFAULT_RERANK_CACHE_LIMIT;

/** 缓存键：归一化 query + 候选集内容 + 后端标识 + 模型名 */
const buildRerankCacheKey = (
  query: string,
  items: ReadonlyArray<{ id: string; text: string }>,
  backend: string,
  model: string
): string => {
  const payload = items.map((item) => `${item.id}\u0000${item.text}`).join("\u0001");
  const digest = computeSha256Hex(payload);
  return `${backend}|${model}|${collapseWhitespace(query)}|${digest}`;
};

/** 读取缓存并顺带刷新插入序（LRU：命中后移到最新） */
const readRerankCache = (key: string): RerankOutput | undefined => {
  const hit = rerankCache.get(key);
  if (!hit) return undefined;
  rerankCache.delete(key);
  rerankCache.set(key, hit);
  return hit;
};

/** 写入缓存，超出容量上限时淘汰最旧一条 */
const writeRerankCache = (key: string, output: RerankOutput): void => {
  rerankCache.set(key, output);
  if (rerankCache.size > RERANK_CACHE_LIMIT) {
    const oldest = rerankCache.keys().next();
    if (!oldest.done) rerankCache.delete(oldest.value);
  }
};

/** 纯 TS 批量 N-Gram 稠密向量相似度打分 */
export function rankDocumentsByNgramVector<T extends HybridSearchableDocument>(
  query: string,
  docs: readonly T[]
): Array<{ id: string; score: number }> {
  const cleanQ = cleanTextForVector(query);
  if (!cleanQ || docs.length === 0) return docs.map((doc) => ({ id: doc.id, score: 0 }));

  const vocabulary = buildNgramVocabulary([cleanQ]);
  const queryVector = textToNgramVector(cleanQ, vocabulary);

  const scored = docs.map((doc) => ({
    id: doc.id,
    score: cosineSimilarityVectors(
      queryVector,
      textToNgramVector(cleanTextForVector(doc.searchBody), vocabulary)
    ),
  }));

  return sort(scored, (entry) => entry.score, true);
}

/** 保留原始数组名次（过滤低分项不压缩后续名次） */
const ranksOf = (
  results: ReadonlyArray<{ id: string; score: number }>,
  minScore: number
): Map<string, number> =>
  new Map(results.flatMap((res, rank) => (res.score >= minScore ? [[res.id, rank + 1] as const] : [])));

/** 只重排前 rerankLimit 条，尾部保持 RRF 原序 */
const reorderByRerank = (
  items: readonly HybridRankResult[],
  scores: ReadonlyArray<{ id: string; score: number }>,
  rerankLimit: number
): HybridRankResult[] => {
  const scoreMap = new Map(scores.map((item) => [item.id, item.score]));
  const head = items.slice(0, rerankLimit).map((item) => ({ ...item, rerankScore: scoreMap.get(item.id) }));
  return [...sort(head, (item) => item.rerankScore ?? 0, true), ...items.slice(rerankLimit)];
};

/** 通用多路召回融合与重排管道 (SIGIR RRF + 可选 Cross-Encoder Rerank) */
export async function executeHybridRankPipeline<T extends HybridSearchableDocument>(
  query: string,
  docs: readonly T[],
  bm25Results: ReadonlyArray<{ id: string; score: number }>,
  vectorResults: ReadonlyArray<{ id: string; score: number }>,
  options?: HybridRankingPipelineOptions
): Promise<HybridRankResult[]> {
  const k = options?.rrfK ?? DEFAULT_RRF_K;
  const limit = options?.candidateLimit ?? DEFAULT_LIMIT;
  const bm25Ranks = ranksOf(bm25Results, BM25_MIN_SCORE);
  const vectorRanks = ranksOf(vectorResults, VECTOR_MIN_SCORE);

  const fused = unique([...bm25Ranks.keys(), ...vectorRanks.keys()])
    .map((id) => ({
      id,
      rrfScore: rrfFuseScores(bm25Ranks.get(id), vectorRanks.get(id), k),
      bm25Rank: bm25Ranks.get(id),
      vectorRank: vectorRanks.get(id),
    }));

  let sortedRRF: HybridRankResult[] = sort(fused, (entry) => entry.rrfScore, true)
    .slice(0, Math.max(limit * POLICY.sense.candidateMultiplier, POLICY.sense.minCandidatePool));

  const reranker = options?.rerank?.enabled && sortedRRF.length > 0
    ? createReranker(options.rerank)
    : null;

  let rerankState: HybridRerankState | undefined;

  if (reranker) {
    const docMap = new Map(docs.map((doc) => [doc.id, doc]));
    // rerank.topK 真正生效：只对前 topK 条候选做 cross-encoder 精排，
    // 未入池的候选保持 RRF 原序，避免精排视野过窄拖低召回质量
    const rerankLimit = Math.min(options?.rerank?.topK ?? sortedRRF.length, sortedRRF.length);
    const rerankItems = sortedRRF.slice(0, rerankLimit).map((item) => {
      const doc = docMap.get(item.id);
      return { id: item.id, text: doc ? `${doc.title}。${doc.searchBody}` : item.id };
    });

    const cacheEnabled = options?.rerankCache !== false;
    const cacheKey = cacheEnabled
      ? buildRerankCacheKey(
          query,
          rerankItems,
          reranker.backend,
          options?.rerank?.model ?? "default"
        )
      : "";

    const cachedOutput = cacheEnabled ? readRerankCache(cacheKey) : undefined;

    if (cachedOutput) {
      rerankState = {
        applied: true,
        backend: cachedOutput.backend,
        cached: true,
      };
      sortedRRF = reorderByRerank(sortedRRF, cachedOutput.results, rerankLimit);
    } else {
      const [err, output] = await tryit(async () => reranker.rerank(query, rerankItems))();
      if (err || !output) {
        rerankState = {
          applied: false,
          backend: reranker.backend,
          fallbackReason: err?.message ?? "rerank_no_result",
        };
        console.warn(`[Rerank] ${rerankState.fallbackReason}: keep_rrf_order`);
      } else {
        rerankState = {
          applied: output.applied,
          backend: output.backend,
          fallbackReason: output.fallbackReason,
        };
        // 仅在模型真正生效时重排；降级分数是恒保序的假分数，排序不得参与
        if (output.applied) {
          sortedRRF = reorderByRerank(sortedRRF, output.results, rerankLimit);
          // 只缓存模型真生效的结果，降级假分数禁止入缓存
          if (cacheEnabled) writeRerankCache(cacheKey, output);
        }
      }
    }
  }

  return sortedRRF
    .slice(0, limit)
    .map((item) => (rerankState ? { ...item, rerank: rerankState } : item));
}
