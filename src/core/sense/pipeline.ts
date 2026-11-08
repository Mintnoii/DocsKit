import { cleanTextForVector, buildNgramVocabulary, textToNgramVector, cosineSimilarityVectors } from "./ngram";
import { rrfFuseScores } from "./index";
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

/**
 * 纯 TS 批量 N-Gram 稠密向量相似度打分
 */
export function rankDocumentsByNgramVector<T extends HybridSearchableDocument>(
  query: string,
  docs: readonly T[]
): Array<{ id: string; score: number }> {
  const cleanQ = cleanTextForVector(query);
  if (!cleanQ || docs.length === 0) {
    return docs.map((d) => ({ id: d.id, score: 0 }));
  }

  const vocabulary = buildNgramVocabulary([cleanQ]);
  const vecQ = textToNgramVector(cleanQ, vocabulary);

  const results: Array<{ id: string; score: number }> = [];

  for (const doc of docs) {
    const text = cleanTextForVector(doc.searchBody);
    const vecD = textToNgramVector(text, vocabulary);
    const score = cosineSimilarityVectors(vecQ, vecD);
    results.push({ id: doc.id, score });
  }

  return results.sort((a, b) => b.score - a.score);
}

/**
 * 通用多路召回融合与重排管道 (SIGIR RRF + Cross-Encoder Rerank)
 *
 * 核心机制：
 * 1. 接收 BM25 排名与向量排名列表；
 * 2. 结合 rrfFuseScores 融合多通道排名；
 * 3. 若配置了 rerank，自动调度并按相关度进行最终微调；
 * 4. 纯无状态纯函数，Ghost、TeamWiki 与 CLI 均可零感知复用。
 */
export async function executeHybridRankPipeline<T extends HybridSearchableDocument>(
  query: string,
  docs: readonly T[],
  bm25Results: ReadonlyArray<{ id: string; score: number }>,
  vectorResults: ReadonlyArray<{ id: string; score: number }>,
  options?: HybridRankingPipelineOptions
): Promise<HybridRankResult[]> {
  const K = options?.rrfK || 60;
  const limit = options?.candidateLimit || 10;
  const rrfScores = new Map<string, { score: number; bm25Rank?: number; vectorRank?: number }>();

  bm25Results.forEach((res, rank) => {
    if (res.score >= 0.1) {
      const current = rrfScores.get(res.id) || { score: 0 };
      current.bm25Rank = rank + 1;
      rrfScores.set(res.id, current);
    }
  });

  vectorResults.forEach((res, rank) => {
    if (res.score >= 0.2) {
      const current = rrfScores.get(res.id) || { score: 0 };
      current.vectorRank = rank + 1;
      rrfScores.set(res.id, current);
    }
  });

  let sortedRRF: HybridRankResult[] = Array.from(rrfScores.entries())
    .map(([id, stats]) => ({
      id,
      rrfScore: rrfFuseScores(stats.bm25Rank, stats.vectorRank, K),
      bm25Rank: stats.bm25Rank,
      vectorRank: stats.vectorRank,
    }))
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, Math.max(limit * 3, 10));

  // 可选神经网络重排 (Cross-Encoder Reranker)
  if (options?.rerank?.enabled && sortedRRF.length > 0) {
    const reranker = createReranker(options.rerank);
    if (reranker) {
      try {
        const docMap = new Map(docs.map((d) => [d.id, d]));
        const rerankItems = sortedRRF.map((item) => {
          const doc = docMap.get(item.id);
          return {
            id: item.id,
            text: doc ? `${doc.title}。${doc.searchBody}` : item.id,
          };
        });

        const rerankScores = await reranker.rerank(query, rerankItems);
        const scoreMap = new Map(rerankScores.map((s) => [s.id, s.score]));

        sortedRRF = [...sortedRRF].sort((a, b) => {
          const scoreA = scoreMap.get(a.id) ?? -999;
          const scoreB = scoreMap.get(b.id) ?? -999;
          return scoreB - scoreA;
        });
      } catch (err: any) {
        console.warn(`[Rerank] 执行异常: ${err.message}，自动平滑降级至 RRF 顺序`);
      }
    }
  }

  return sortedRRF.slice(0, limit);
}
