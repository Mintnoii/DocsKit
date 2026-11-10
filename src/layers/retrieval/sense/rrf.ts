import { POLICY } from "../../../contracts/policy";
import { isArray, isNumber, sum } from "radash";

/**
 * 经典 SIGIR 倒数秩融合 (RRF)
 * 兼容数组形式 rrfFuseScores([1, 2], 60) 与变长形式 rrfFuseScores(1, 2, 60)
 */
export function rrfFuseScores(
  ranksOrRankA: readonly (number | undefined)[] | number | undefined,
  rankBOrK?: number,
  maybeK: number = POLICY.sense.rrfK
): number {
  const isRanksForm = isArray(ranksOrRankA);
  const k = isRanksForm ? (rankBOrK ?? POLICY.sense.rrfK) : maybeK;
  const ranks: readonly (number | undefined)[] = isRanksForm
    ? ranksOrRankA
    : [ranksOrRankA as number | undefined, rankBOrK];

  return sum(ranks.map((rank) => (isNumber(rank) && rank > 0 ? 1 / (k + rank) : 0)));
}
