/**
 * 卡片生命周期与重复排查函数（纯无状态）
 * 只做两件具体的事：挑出该清理的过期卡片，挑出内容高度重复的卡片对。
 * 相似度算法统一消费 shared/numeric，本模块只负责业务判定与建议生成。
 */

import { sift } from "radash";
import { computeBigramDiceSimilarity, computeNormalizedDotProduct } from "../shared/numeric";

export { computeBigramDiceSimilarity, computeNormalizedDotProduct } from "../shared/numeric";

export interface CardLifecycleItem {
  readonly id: string;
  readonly title: string;
  readonly type?: string;
  readonly status?: string;
  readonly confidence?: string;
  readonly content?: string;
  readonly vector?: readonly number[];
  readonly inboundCount?: number;
  readonly horizontalInboundCount?: number;
  readonly consumptionCount?: number;
}

export interface HighSimilarityCardPair {
  readonly cardA: string;
  readonly cardB: string;
  readonly similarity: number;
  readonly advisory: string;
}

export interface StaleCardCandidate {
  readonly id: string;
  readonly title: string;
  readonly reason: string;
}

export interface CardLifecycleReport {
  readonly staleCandidates: readonly StaleCardCandidate[];
  readonly highSimilarityPairs: readonly HighSimilarityCardPair[];
}

// 旧称含生物学隐喻，保留为兼容别名，下游迁移完成后可移除。
/** @deprecated 使用 CardLifecycleItem */
export type MetabolismCardItem = CardLifecycleItem;
/** @deprecated 使用 StaleCardCandidate */
export type StaleMetabolismCandidate = StaleCardCandidate;
/** @deprecated 使用 CardLifecycleReport */
export type MetabolismAnalysisResult = CardLifecycleReport;

interface CardPair {
  readonly a: CardLifecycleItem;
  readonly b: CardLifecycleItem;
}

const similarityOf = ({ a, b }: CardPair): { similarity: number; mode: string } =>
  a.vector && b.vector && a.vector.length > 0 && b.vector.length > 0
    ? { similarity: computeNormalizedDotProduct(a.vector, b.vector), mode: "向量余弦" }
    : { similarity: computeBigramDiceSimilarity(a.title, b.title), mode: "标题字符" };

/** 排查内容高度重复的卡片对，建议合并 */
export function findHighSimilarityCardPairs(
  cards: readonly CardLifecycleItem[],
  options?: { readonly similarityThreshold?: number }
): HighSimilarityCardPair[] {
  const threshold = options?.similarityThreshold ?? 0.82;

  return cards
    .flatMap((a, idx) => cards.slice(idx + 1).map((b): CardPair => ({ a, b })))
    .map((pair) => ({ pair, ...similarityOf(pair) }))
    .filter(({ similarity }) => similarity >= threshold)
    .map(({ pair, similarity, mode }) => ({
      cardA: pair.a.title,
      cardB: pair.b.title,
      similarity: Number(similarity.toFixed(4)),
      advisory: `两张卡片${mode}相似度高达 ${(similarity * 100).toFixed(1)}%，可能重复收录，建议合并为一张卡片`,
    }))
    .sort((a, b) => b.similarity - a.similarity);
}

/** 汇总过期卡片清理建议与重复卡片对 */
export function analyzeCardLifecycle(
  cards: readonly CardLifecycleItem[],
  options?: { readonly similarityThreshold?: number }
): CardLifecycleReport {
  const staleCandidates = cards.flatMap((card): StaleCardCandidate[] => {
    if (card.status === "deprecated") {
      return [{
        id: card.id,
        title: card.title,
        reason: "已标记为历史更替 (status: deprecated)，建议下线或归档",
      }];
    }

    const consumption = card.consumptionCount ?? 0;
    const inbounds = card.inboundCount ?? 0;
    const isLowConfidence = card.confidence === "low";
    const isSparseInbound = inbounds <= 1 && (card.horizontalInboundCount ?? 0) === 0;
    if (consumption !== 0 || (!isLowConfidence && !isSparseInbound)) return [];

    const reasons = sift([
      isLowConfidence && "质量评级为 low",
      isSparseInbound && `入链稀疏 (仅 ${inbounds} 条${isLowConfidence ? "" : "，无横向概念链"})`,
    ]);
    return [{
      id: card.id,
      title: card.title,
      reason: `${reasons.join(" 且 ")}，下游成果物零引用，建议复查后清理`,
    }];
  });

  return {
    staleCandidates,
    highSimilarityPairs: findHighSimilarityCardPairs(cards, options),
  };
}

/** @deprecated 使用 analyzeCardLifecycle */
export const analyzeVaultMetabolism = analyzeCardLifecycle;
