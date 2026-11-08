export * from "./bm25";
export * from "./late-chunking";
export * from "./ngram";
export * from "./reranker";

/**
 * 经典 SIGIR 倒数秩融合算法 (Reciprocal Rank Fusion, RRF)
 */
export function rrfFuseScores(ranks: readonly number[], k = 60): number {
  return ranks.reduce((acc, rank) => acc + 1 / (k + rank), 0);
}
