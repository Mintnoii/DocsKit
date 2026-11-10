/**
 * 卡片生命周期与重复排查，纯无状态。
 * 策略数值走 contracts/policy，诊断结果返回稳定 code，中文句子归 docskit/presets。
 */

import { sift, sort } from "radash";
import { computeBigramDiceSimilarity, computeNormalizedDotProduct } from "../../../foundation/numeric";
import { POLICY } from "../../../contracts/policy";

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

const similarityOf = ({ a, b }: CardPair): { readonly similarity: number; readonly mode: string } =>
  a.vector && b.vector && a.vector.length > 0 && b.vector.length > 0
    ? { similarity: computeNormalizedDotProduct(a.vector, b.vector), mode: "vector" }
    : { similarity: computeBigramDiceSimilarity(a.title, b.title), mode: "title_bigram" };

/** 排查内容高度重复的卡片对 */
export function findHighSimilarityCardPairs(
  cards: readonly CardLifecycleItem[],
  options?: { readonly similarityThreshold?: number }
): HighSimilarityCardPair[] {
  const { similarityThreshold = POLICY.lifecycle.similarityThreshold } = options ?? {};

  const pairs = cards
    .flatMap((a, idx) => cards.slice(idx + 1).map((b): CardPair => ({ a, b })))
    .map((pair) => ({ pair, ...similarityOf(pair) }))
    .filter(({ similarity }) => similarity >= similarityThreshold)
    .map(({ pair, similarity }) => ({
      cardA: pair.a.title,
      cardB: pair.b.title,
      similarity: Number(similarity.toFixed(POLICY.lifecycle.scorePrecision)),
      advisory: "high_similarity",
    }));

  return sort(pairs, (pair) => pair.similarity, true);
}

/** 汇总过期卡片清理建议与重复卡片对 */
export function analyzeCardLifecycle(
  cards: readonly CardLifecycleItem[],
  options?: { readonly similarityThreshold?: number }
): CardLifecycleReport {
  const staleCandidates = cards.flatMap((card): StaleCardCandidate[] => {
    if (card.status === "deprecated") {
      return [{ id: card.id, title: card.title, reason: "deprecated" }];
    }

    const consumption = card.consumptionCount ?? 0;
    const inbounds = card.inboundCount ?? 0;
    const lowConfidence = card.confidence === "low";
    const sparseInbound = inbounds <= POLICY.lifecycle.sparseInboundMax && (card.horizontalInboundCount ?? 0) === 0;
    if (consumption !== 0 || (!lowConfidence && !sparseInbound)) return [];

    const reasons = sift([
      lowConfidence && "low_confidence",
      sparseInbound && "sparse_inbound",
    ]);
    return [{ id: card.id, title: card.title, reason: reasons.join("+") || "stale_candidate" }];
  });

  return {
    staleCandidates,
    highSimilarityPairs: findHighSimilarityCardPairs(cards, options),
  };
}

/** @deprecated 使用 analyzeCardLifecycle */
export const analyzeVaultMetabolism = analyzeCardLifecycle;
