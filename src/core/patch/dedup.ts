/**
 * DocsKit / Dedup Gate (概念与文档级联去重引擎)
 *
 * 四级级联：规整化精确命中 → 核心名提取 → Fuse.js 词形模糊 → 共享 N-gram 语义兜底。
 * 相似度算法统一消费 shared/numeric，杜绝同名概念多套数值结果。
 */

import Fuse from "fuse.js";
import { max } from "radash";
import { computeNgramSimilarity, cosineSimilarityVectors } from "../shared/numeric";

export { computeNgramSimilarity } from "../shared/numeric";

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
  /** 相似度判定阈值，默认 0.58 */
  readonly threshold?: number;
}

/** 标点、空白与符号清洗归一化 */
export const normalizeConceptKey = (text: string): string =>
  text.toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");

/** 提取核心概念名（剥离中英文括号补充说明） */
export const coreConceptName = (text: string): string =>
  text.replace(/[（(][^）)]*[）)]/gu, "").trim();

/** Fuse.js 词形模糊匹配（长度比率门禁防短词吞并长词） */
export function findFuzzyLexicalMatch<T extends { readonly title: string; readonly aliases?: readonly string[] }>(
  candidateTitle: string,
  items: readonly T[],
  options?: { readonly threshold?: number; readonly minLengthRatio?: number }
): T | null {
  const candidateCore = normalizeConceptKey(coreConceptName(candidateTitle));
  if (candidateCore.length < 4) return null;

  const threshold = options?.threshold ?? 0.35;
  const minLengthRatio = options?.minLengthRatio ?? 0.65;

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

/** 向量池语义匹配函数 */
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
  return Math.max(lexical, titleSim * 0.7 + summarySim * 0.3);
};

/** 通用概念/文档级联去重判定门禁 */
export function evaluateDedupGate<T extends DedupCandidateItem>(
  candidate: DedupCandidateItem,
  existingItems: readonly T[],
  options: DedupGateOptions = {}
): DedupMatchResult<T> {
  const threshold = options.threshold ?? 0.58;
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
      reason: isTitleHit
        ? `精确标题命中: "${exactHit.title}"`
        : `别名命中: 候选词与已有知识卡片 "${exactHit.title}" 的别名一致`,
    };
  }

  const fuzzyMatched = findFuzzyLexicalMatch(candidate.title, existingItems);
  if (fuzzyMatched) {
    return {
      action: "MERGE_PATCH",
      matchedItem: fuzzyMatched,
      similarity: 0.88,
      reason: `词形高相关模糊命中: "${fuzzyMatched.title}"`,
    };
  }

  const scored = existingItems.map((item) => ({ item, similarity: similarityOf(candidate, item) }));
  const best = max(scored, (entry) => entry.similarity);
  const topScore = best?.similarity ?? 0;
  const percent = (topScore * 100).toFixed(1);
  const thresholdPercent = (threshold * 100).toFixed(1);

  return best && topScore >= threshold
    ? {
        action: "MERGE_PATCH",
        matchedItem: best.item,
        similarity: Number(topScore.toFixed(4)),
        reason: `相似度 ${percent}% 超过门限 ${thresholdPercent}%，合并至已存卡片 "${best.item.title}"`,
      }
    : {
        action: "CREATE_NEW",
        similarity: Number(topScore.toFixed(4)),
        reason: `最高相似度仅 ${percent}%，低于门限 ${thresholdPercent}%，独立新增为新卡片`,
      };
}
