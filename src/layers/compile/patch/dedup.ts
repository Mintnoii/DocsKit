/**
 * 概念与文档级联去重。
 * 相似度算法统一消费 foundation/numeric，策略数值统一消费 contracts/policy，
 * 判定理由返回稳定 code，中文句子由 docskit/presets 提供。
 */

import Fuse from "fuse.js";
import { max } from "radash";
import { cleanTextForVector, computeNgramSimilarity, cosineSimilarityVectors } from "../../../foundation/numeric";
import { POLICY } from "../../../contracts/policy";

export interface DedupCandidateItem {
  readonly title: string;
  readonly aliases?: readonly string[];
  readonly summary?: string;
  readonly filePath?: string;
}

export interface DedupMatchResult<T extends DedupCandidateItem = DedupCandidateItem> {
  readonly action: "CREATE_NEW" | "MERGE_PATCH";
  readonly matchedItem?: T;
  readonly similarity: number;
  readonly reason: string;
}

export interface DedupGateOptions {
  readonly threshold?: number;
}

/** 标点、空白与符号清洗归一，与 foundation/numeric 同源同值 */
export const normalizeConceptKey = cleanTextForVector;

/**
 * 提取核心概念名：
 * 正则 `/[（(][^）)]*[）)]/gu` 剥离中英文圆括号及其内部的补充说明（例如将 `RRF (倒数秩融合)` 提纯为 `RRF`）
 */
export const coreConceptName = (text: string): string =>
  text.replace(/[（(][^）)]*[）)]/gu, "").trim();

/** Fuse.js 词形模糊匹配，长度比率门禁防短词吞并长词 */
export function findFuzzyLexicalMatch<T extends { readonly title: string; readonly aliases?: readonly string[] }>(
  candidateTitle: string,
  items: readonly T[],
  options?: { readonly threshold?: number; readonly minLengthRatio?: number }
): T | null {
  const candidateCore = normalizeConceptKey(coreConceptName(candidateTitle));
  if (candidateCore.length < POLICY.dedup.minCoreLength) return null;

  const { threshold = POLICY.dedup.fuzzyThreshold, minLengthRatio = POLICY.dedup.minLengthRatio } = options ?? {};
  const searchItems = items.map((item) => ({
    item,
    core: normalizeConceptKey(coreConceptName(item.title)),
    title: normalizeConceptKey(item.title),
    aliases: (item.aliases ?? []).map(normalizeConceptKey),
  }));

  const results = new Fuse(searchItems, {
    keys: ["core", "title", "aliases"],
    threshold,
    ignoreLocation: true,
  }).search(candidateCore);

  const matched = results.find((result) => {
    const targetCore = result.item.core;
    const ratio = Math.min(candidateCore.length, targetCore.length) / Math.max(candidateCore.length, targetCore.length);
    return ratio >= minLengthRatio;
  });

  return matched?.item.item ?? null;
}

/** 向量池语义匹配 */
export function findMostSimilarVector(
  queryVector: readonly number[],
  pool: Readonly<Record<string, readonly number[]>> | ReadonlyMap<string, number[]>
): { readonly name: string; readonly score: number } | null {
  const entries = pool instanceof Map ? [...pool.entries()] : Object.entries(pool);
  const scored = entries.map(([name, vector]) => ({
    name,
    score: cosineSimilarityVectors(queryVector, vector),
  }));
  return max(scored, (entry) => entry.score) ?? null;
}

const similarityOf = <T extends DedupCandidateItem>(candidate: DedupCandidateItem, item: T): number => {
  const titleSim = computeNgramSimilarity(candidate.title, item.title);
  const lexical = Math.max(
    titleSim,
    ...(item.aliases ?? []).map((alias) => computeNgramSimilarity(candidate.title, alias)),
    0
  );
  const summarySim = candidate.summary && item.summary
    ? computeNgramSimilarity(candidate.summary, item.summary)
    : 0;
  return Math.max(
    lexical,
    titleSim * POLICY.dedup.lexicalWeight + summarySim * POLICY.dedup.summaryWeight
  );
};

/** 通用概念/文档级联去重判定门禁 */
export function evaluateDedupGate<T extends DedupCandidateItem>(
  candidate: DedupCandidateItem,
  existingItems: readonly T[],
  options: DedupGateOptions = {}
): DedupMatchResult<T> {
  const { threshold = POLICY.dedup.threshold } = options;
  const candidateKey = normalizeConceptKey(candidate.title);

  const exactHit = existingItems.find((item) =>
    normalizeConceptKey(item.title) === candidateKey ||
    item.aliases?.some((alias) => normalizeConceptKey(alias) === candidateKey)
  );
  if (exactHit) {
    const isTitleHit = normalizeConceptKey(exactHit.title) === candidateKey;
    return {
      action: "MERGE_PATCH",
      matchedItem: exactHit,
      similarity: 1,
      reason: isTitleHit ? "exact_title_hit" : "alias_hit",
    };
  }

  const fuzzyMatched = findFuzzyLexicalMatch(candidate.title, existingItems);
  if (fuzzyMatched) {
    return {
      action: "MERGE_PATCH",
      matchedItem: fuzzyMatched,
      similarity: POLICY.dedup.fuzzySimilarity,
      reason: "fuzzy_hit",
    };
  }

  const scored = existingItems.map((item) => ({ item, similarity: similarityOf(candidate, item) }));
  const best = max(scored, (entry) => entry.similarity);
  const topScore = best?.similarity ?? 0;
  const precision = POLICY.dedup.scorePrecision;

  return best && topScore >= threshold
    ? {
        action: "MERGE_PATCH",
        matchedItem: best.item,
        similarity: Number(topScore.toFixed(precision)),
        reason: "threshold_hit",
      }
    : {
        action: "CREATE_NEW",
        similarity: Number(topScore.toFixed(precision)),
        reason: "below_threshold",
      };
}
