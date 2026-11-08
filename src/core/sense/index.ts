export * from "./bm25";
export * from "./late-chunking";
export * from "./ngram";
export * from "./reranker";
export * from "./pipeline";

/**
 * 经典 SIGIR 倒数秩融合算法 (Reciprocal Rank Fusion, RRF)
 * 支持传入数组或变长参数
 */
export function rrfFuseScores(
  ranksOrRankA: readonly (number | undefined)[] | number | undefined,
  rankBOrK?: number | undefined,
  maybeK = 60
): number {
  if (Array.isArray(ranksOrRankA)) {
    const k = typeof rankBOrK === "number" ? rankBOrK : 60;
    return ranksOrRankA.reduce<number>((acc, rank) => {
      return typeof rank === "number" && rank > 0 ? acc + 1 / (k + rank) : acc;
    }, 0);
  }

  // 变长传参形式: rrfFuseScores(rankA, rankB, k)
  const rankA = ranksOrRankA;
  const rankB = rankBOrK;
  const k = maybeK;
  let score = 0;
  if (typeof rankA === "number" && rankA > 0) score += 1 / (k + rankA);
  if (typeof rankB === "number" && rankB > 0) score += 1 / (k + rankB);
  return score;
}
