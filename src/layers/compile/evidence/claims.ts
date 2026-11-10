/** 声明句的证据覆盖校验与机械兜底，模型结论必须落在原文用词范围内 */

import { unique } from "radash";
import { cleanTextForVector } from "../../../foundation/numeric";
import {
  resolveEvidenceOptions,
  type ClaimCoverageResult,
  type EvidenceOptions,
} from "./contracts";

/**
 * 将规范化文本切解为相邻 2-Gram 字符组集合，用于计算字符覆盖率
 */
const bigramSet = (normalized: string): ReadonlySet<string> => {
  const chars = [...normalized];
  // 提取两两相邻字符形成 2-Gram
  return new Set(chars.slice(0, -1).map((char, idx) => `${char}${chars[idx + 1]}`));
};

/**
 * 提取文本中的拉丁标识符/英文单词（如下划线变量名、混合数字标识等）
 * 正则 `/[a-z][a-z0-9_]*[0-9]|[a-z0-9]+/g`：优先匹配带下划线或数字的复合变量名（如 `token_2`），兜底匹配常规英文数字单词
 */
const latinTokens = (text: string, minLength: number): readonly string[] =>
  unique(text.toLowerCase().match(/[a-z][a-z0-9_]*[0-9]|[a-z0-9]+/g) ?? []).filter(
    (token) => token.length >= minLength
  );

/** 字组覆盖率达标且拉丁词全命中才算原文撑得住结论 */
export const checkClaimCoverage = (
  claim: string,
  quote: string,
  options: EvidenceOptions = {}
): ClaimCoverageResult => {
  const resolved = resolveEvidenceOptions(options);
  const normalizedClaim = cleanTextForVector(claim);
  const normalizedQuote = cleanTextForVector(quote);

  // 结论句少于 2 字符无法构成有效断言，直接判定未覆盖
  if (normalizedClaim.length < 2) {
    return { coverage: 0, missingLatinTokens: [], passed: false };
  }

  const quoteGrams = bigramSet(normalizedQuote);
  const claimGrams = [...bigramSet(normalizedClaim)];
  const coverage = claimGrams.length === 0
    ? 1
    : claimGrams.filter((gram) => quoteGrams.has(gram)).length / claimGrams.length;
  const missingLatinTokens = latinTokens(claim, resolved.minLatinTokenLength).filter(
    (token) => !normalizedQuote.includes(token)
  );

  return {
    coverage,
    missingLatinTokens,
    passed: coverage >= resolved.minClaimCoverage && missingLatinTokens.length === 0,
  };
};

/**
 * 机械截取段落首句作为事实断言兜底：
 * 正则匹配 `^([^。！？\n]+[。！？])` 捕获第一个以句号/问号/感叹号结尾的完整单句，无句末标点时取整段，并截断至最大上限
 */
export const mechanicalClaim = (quote: string, options: EvidenceOptions = {}): string => {
  const resolved = resolveEvidenceOptions(options);
  // 提取首个以中文标点（。！？）结束的单句
  const matched = /^([^。！？\n]+[。！？])/.exec(quote);
  const sentence = matched ? matched[1] : quote;
  return sentence.length <= resolved.maxClaimLength
    ? sentence
    : sentence.slice(0, resolved.maxClaimLength);
};
