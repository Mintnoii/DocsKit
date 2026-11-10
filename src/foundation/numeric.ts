/**
 * DocsKit 公共数值与文本相似度底座
 *
 * 全项目唯一的字符级 N-gram 特征、余弦相似度、L2 归一化与 Bigram Dice 实现。
 * sense / patch / lint / late-chunking 一律消费此处，杜绝同名概念多套数值结果。
 */

import { unique } from "radash";

/**
 * 小写化并剥离标点、符号与空白
 * 正则 `/[\p{P}\p{S}\s]+/gu` 匹配所有 Unicode 标点符号 (\p{P})、数学/货币符号 (\p{S}) 以及空白符 (\s)
 */
export const cleanTextForVector = (text: string): string =>
  text.toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");

const charsOf = (text: string): readonly string[] => [...cleanTextForVector(text)];

const gramsOf = (text: string): readonly string[] => {
  const chars = charsOf(text);
  return [
    ...chars,
    ...chars.slice(0, -1).map((char, idx) => `${char}${chars[idx + 1]}`),
  ];
};

/** 由语料构建 1-gram + 2-gram 词表，返回 gram -> 向量下标 */
export const buildNgramVocabulary = (texts: readonly string[]): Map<string, number> =>
  new Map(unique(texts.flatMap(gramsOf)).map((gram, idx) => [gram, idx]));

/** 生成字符级加权特征向量（1-gram 权重 1，2-gram 权重 2），维度对齐词表 */
export const textToNgramVector = (
  text: string,
  vocabulary: ReadonlyMap<string, number>
): number[] => {
  const chars = charsOf(text);
  const weights = [
    ...chars.map((char): readonly [string, number] => [char, 1]),
    ...chars.slice(0, -1).map((char, idx): readonly [string, number] => [`${char}${chars[idx + 1]}`, 2]),
  ].reduce<Map<string, number>>(
    (acc, [gram, weight]) => acc.set(gram, (acc.get(gram) ?? 0) + weight),
    new Map()
  );

  return [...vocabulary.keys()].map((gram) => weights.get(gram) ?? 0);
};

/** 稠密向量余弦相似度（维度不一致或零向量返回 0） */
export const cosineSimilarityVectors = (vecA: readonly number[], vecB: readonly number[]): number => {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;

  const { dot, normA, normB } = vecA.reduce(
    (acc, value, idx) => ({
      dot: acc.dot + value * vecB[idx],
      normA: acc.normA + value * value,
      normB: acc.normB + vecB[idx] * vecB[idx],
    }),
    { dot: 0, normA: 0, normB: 0 }
  );
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
};

/** 直接计算两段文本的字符级 N-gram 余弦相似度 */
export const computeTextNgramSimilarity = (a: string, b: string): number => {
  if (!cleanTextForVector(a) || !cleanTextForVector(b)) return 0;
  const vocabulary = buildNgramVocabulary([a, b]);
  return cosineSimilarityVectors(
    textToNgramVector(a, vocabulary),
    textToNgramVector(b, vocabulary)
  );
};

/** 去重门禁侧的历史别名，与 computeTextNgramSimilarity 同源同值 */
export const computeNgramSimilarity = computeTextNgramSimilarity;

const bigramsOf = (text: string): Map<string, number> => {
  const chars = charsOf(text);
  return chars.slice(0, -1).reduce<Map<string, number>>(
    (acc, char, idx) => {
      const gram = `${char}${chars[idx + 1]}`;
      return acc.set(gram, (acc.get(gram) ?? 0) + 1);
    },
    new Map()
  );
};

/** 2-gram Dice 系数（用于卡片标题冗余对排查） */
export const computeBigramDiceSimilarity = (textA: string, textB: string): number => {
  const cleanA = cleanTextForVector(textA);
  const cleanB = cleanTextForVector(textB);

  if (!cleanA && !cleanB) return 1;
  if (!cleanA || !cleanB) return 0;
  if (cleanA === cleanB) return 1;
  if (cleanA.length < 2 || cleanB.length < 2) return 0;

  const mapB = bigramsOf(cleanB);
  const intersection = [...bigramsOf(cleanA).entries()]
    .reduce((sum, [gram, count]) => sum + Math.min(count, mapB.get(gram) ?? 0), 0);
  const total = cleanA.length - 1 + (cleanB.length - 1);

  return total > 0 ? (2 * intersection) / total : 0;
};

/** L2 范数归一化（已归一化向量点积即余弦） */
export const normalizeVector = (vec: readonly number[]): number[] => {
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0)) || 1e-12;
  return vec.map((value) => value / norm);
};

/** 向量点积（缺位按 0 处理） */
export const dotProduct = (vecA: readonly number[], vecB: readonly number[]): number =>
  vecA.reduce((sum, value, idx) => sum + value * (vecB[idx] ?? 0), 0);

/** 已归一化向量的点积，保留代谢分析侧的原有命名 */
export const computeNormalizedDotProduct = dotProduct;
