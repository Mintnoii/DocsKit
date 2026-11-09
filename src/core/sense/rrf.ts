import { isArray } from "radash";

/**
 * 经典 SIGIR 倒数秩融合 (RRF)
 * 兼容数组形式 rrfFuseScores([1, 2], 60) 与变长形式 rrfFuseScores(1, 2, 60)
 */
export function rrfFuseScores(
  ranksOrRankA: readonly (number | undefined)[] | number | undefined,
  rankBOrK?: number,
  maybeK = 60
): number {
  const isRanksForm = isArray(ranksOrRankA);
  const k = isRanksForm ? (rankBOrK ?? 60) : maybeK;
  const ranks: readonly (number | undefined)[] = isRanksForm
    ? ranksOrRankA
    : [ranksOrRankA as number | undefined, rankBOrK];

  return ranks.reduce<number>(
    (score, rank) => (typeof rank === "number" && rank > 0 ? score + 1 / (k + rank) : score),
    0
  );
}
