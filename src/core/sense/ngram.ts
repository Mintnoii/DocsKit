/**
 * 纯 TS 字符级 1-gram + 2-gram 混合文本特征向量与余弦相似度计算
 * 零外部依赖，毫秒级快速运行，支持中英文、数字与专有名词
 */

/**
 * 清洗文本（小写化并移除标点与不可见字符）
 */
export const cleanTextForVector = (text: string): string => {
  return (text ?? "").toLowerCase().replace(/[\s\p{P}]+/gu, "");
};

/**
 * 提取文本的 1-gram 和 2-gram 词表
 */
export function buildNgramVocabulary(texts: readonly string[]): Map<string, number> {
  const vocabulary = new Map<string, number>();
  let idx = 0;

  for (const text of texts) {
    const clean = cleanTextForVector(text);
    // 1-gram
    for (let i = 0; i < clean.length; i++) {
      const gram = clean[i];
      if (!vocabulary.has(gram)) {
        vocabulary.set(gram, idx++);
      }
    }
    // 2-gram
    for (let i = 0; i < clean.length - 1; i++) {
      const gram = clean.slice(i, i + 2);
      if (!vocabulary.has(gram)) {
        vocabulary.set(gram, idx++);
      }
    }
  }

  return vocabulary;
}

/**
 * 生成字符级加权 N-Gram 特征向量
 */
export function textToNgramVector(text: string, vocabulary: Map<string, number>): number[] {
  const clean = cleanTextForVector(text);
  const vec = new Array(vocabulary.size).fill(0);

  // 1-gram (单字权重 1)
  for (let i = 0; i < clean.length; i++) {
    const gram = clean[i];
    const index = vocabulary.get(gram);
    if (index !== undefined) {
      vec[index] += 1;
    }
  }

  // 2-gram (双字连词权重 2)
  for (let i = 0; i < clean.length - 1; i++) {
    const gram = clean.slice(i, i + 2);
    const index = vocabulary.get(gram);
    if (index !== undefined) {
      vec[index] += 2;
    }
  }

  return vec;
}

/**
 * 纯数学实现：计算两个稠密向量的余弦相似度
 */
export function cosineSimilarityVectors(vecA: readonly number[], vecB: readonly number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  const sim = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  return Number.isNaN(sim) ? 0 : sim;
}

/**
 * 直接计算两个文本的字符级 N-gram 余弦相似度
 */
export function computeTextNgramSimilarity(a: string, b: string): number {
  const cleanA = cleanTextForVector(a);
  const cleanB = cleanTextForVector(b);
  if (!cleanA || !cleanB) return 0;

  const vocabulary = buildNgramVocabulary([cleanA, cleanB]);
  if (vocabulary.size === 0) return 0;

  const vecA = textToNgramVector(cleanA, vocabulary);
  const vecB = textToNgramVector(cleanB, vocabulary);

  return cosineSimilarityVectors(vecA, vecB);
}
