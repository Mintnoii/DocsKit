import { tryit, unique } from "radash";
import {
  cleanTextForVector,
  buildNgramVocabulary,
  textToNgramVector,
  cosineSimilarityVectors,
} from "./ngram";
import { rrfFuseScores } from "./rrf";
import { createReranker, type RerankConfig } from "./reranker";

export interface HybridSearchableDocument {
  id: string;
  title: string;
  searchBody: string;
}

export interface HybridRankResult {
  id: string;
  rrfScore: number;
  bm25Rank?: number;
  vectorRank?: number;
}

export interface HybridRankingPipelineOptions {
  rrfK?: number;
  candidateLimit?: number;
  rerank?: RerankConfig;
}

const BM25_MIN_SCORE = 0.1;
const VECTOR_MIN_SCORE = 0.2;
const DEFAULT_RRF_K = 60;
const DEFAULT_LIMIT = 10;

/** 纯 TS 批量 N-Gram 稠密向量相似度打分 */
export function rankDocumentsByNgramVector<T extends HybridSearchableDocument>(
  query: string,
  docs: readonly T[]
): Array<{ id: string; score: number }> {
  const cleanQ = cleanTextForVector(query);
  if (!cleanQ || docs.length === 0) return docs.map((doc) => ({ id: doc.id, score: 0 }));

  const vocabulary = buildNgramVocabulary([cleanQ]);
  const queryVector = textToNgramVector(cleanQ, vocabulary);

  return docs
    .map((doc) => ({
      id: doc.id,
      score: cosineSimilarityVectors(
        queryVector,
        textToNgramVector(cleanTextForVector(doc.searchBody), vocabulary)
      ),
    }))
    .sort((a, b) => b.score - a.score);
}

/** 保留原始数组名次（过滤低分项不压缩后续名次） */
const ranksOf = (
  results: ReadonlyArray<{ id: string; score: number }>,
  minScore: number
): Map<string, number> =>
  new Map(results.flatMap((res, rank) => (res.score >= minScore ? [[res.id, rank + 1] as const] : [])));

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

  let sortedRRF: HybridRankResult[] = unique([...bm25Ranks.keys(), ...vectorRanks.keys()])
    .map((id) => ({
      id,
      rrfScore: rrfFuseScores(bm25Ranks.get(id), vectorRanks.get(id), k),
      bm25Rank: bm25Ranks.get(id),
      vectorRank: vectorRanks.get(id),
    }))
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, Math.max(limit * 3, 10));

  const reranker = options?.rerank?.enabled && sortedRRF.length > 0
    ? createReranker(options.rerank)
    : null;

  if (reranker) {
    const docMap = new Map(docs.map((doc) => [doc.id, doc]));
    const rerankItems = sortedRRF.map((item) => {
      const doc = docMap.get(item.id);
      return { id: item.id, text: doc ? `${doc.title}。${doc.searchBody}` : item.id };
    });

    const [err, scores] = await tryit(async () => reranker.rerank(query, rerankItems))();
    if (err || !scores) {
      console.warn(`[Rerank] 执行异常: ${err?.message ?? "无结果"}，自动平滑降级至 RRF 顺序`);
    } else {
      const scoreMap = new Map(scores.map((score) => [score.id, score.score]));
      sortedRRF = [...sortedRRF].sort(
        (a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0)
      );
    }
  }

  return sortedRRF.slice(0, limit);
}
