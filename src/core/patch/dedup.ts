import cosineSimilarity from "compute-cosine-similarity";

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

/**
 * 纯数学函数：计算两个文本基于 1-gram + 2-gram 的字符级余弦相似度
 *
 * 核心审美规范：
 * 1. 纯无状态纯函数，零 IO、零环境依赖；
 * 2. 依托成熟开源算法库 compute-cosine-similarity 进行余弦相似度计算，杜绝手搓浮点向量点积；
 * 3. 涵盖中英文字符、数字与驼峰/连字符命名。
 *
 * @example
 * ```ts
 * computeNgramSimilarity("WebGL渲染管线", "WebGL渲染管线与状态机"); // ~0.75
 * ```
 */
export function computeNgramSimilarity(a: string, b: string): number {
  const cleanA = (a ?? "").toLowerCase().replace(/[\s\p{P}]+/gu, "");
  const cleanB = (b ?? "").toLowerCase().replace(/[\s\p{P}]+/gu, "");

  if (!cleanA || !cleanB) return 0;
  if (cleanA === cleanB) return 1.0;

  const vocabulary = new Map<string, number>();
  let idx = 0;

  // 收集 1-gram 和 2-gram
  for (let i = 0; i < cleanA.length; i++) {
    const gram = cleanA[i];
    if (!vocabulary.has(gram)) vocabulary.set(gram, idx++);
  }
  for (let i = 0; i < cleanA.length - 1; i++) {
    const gram = cleanA.slice(i, i + 2);
    if (!vocabulary.has(gram)) vocabulary.set(gram, idx++);
  }

  for (let i = 0; i < cleanB.length; i++) {
    const gram = cleanB[i];
    if (!vocabulary.has(gram)) vocabulary.set(gram, idx++);
  }
  for (let i = 0; i < cleanB.length - 1; i++) {
    const gram = cleanB.slice(i, i + 2);
    if (!vocabulary.has(gram)) vocabulary.set(gram, idx++);
  }

  if (vocabulary.size === 0) return 0;

  const vecA = textToNgramVector(cleanA, vocabulary);
  const vecB = textToNgramVector(cleanB, vocabulary);

  const score = cosineSimilarity(vecA, vecB);
  return typeof score === "number" && !Number.isNaN(score) ? score : 0;
}

function textToNgramVector(cleanText: string, vocabulary: Map<string, number>): number[] {
  const vec = new Array(vocabulary.size).fill(0);

  // 1-gram (单字权重 1)
  for (let i = 0; i < cleanText.length; i++) {
    const gram = cleanText[i];
    const index = vocabulary.get(gram);
    if (index !== undefined) {
      vec[index] += 1;
    }
  }

  // 2-gram (双字连词权重 2)
  for (let i = 0; i < cleanText.length - 1; i++) {
    const gram = cleanText.slice(i, i + 2);
    const index = vocabulary.get(gram);
    if (index !== undefined) {
      vec[index] += 2;
    }
  }

  return vec;
}

/**
 * 语义防腐查重匹配门禁 (纯计算纯函数，零文件 IO)
 *
 * 判定新文档应该「原地增量更新 (MERGE_PATCH)」还是「作为全新概念收录 (CREATE_NEW)」
 * 
 * 规则策略：
 * 1. 强特征优先：标题或别名完全包含/完全一致 -> 直接判定 MERGE_PATCH (similarity = 1.0)
 * 2. 别名模糊匹配：与别名契约的匹配度高 -> MERGE_PATCH
 * 3. 语义相似度：
 *    - 相似度 >= threshold (默认 0.58): 判定同义/版本演化 -> MERGE_PATCH
 *    - 相似度 < threshold: 判定独立新知识 -> CREATE_NEW
 */
export function evaluateDedupGate<T extends DedupCandidateItem>(
  candidateTitle: string,
  existingItems: readonly T[],
  options: DedupGateOptions = {}
): DedupMatchResult<T> {
  const { threshold = 0.58 } = options;

  if (!existingItems || existingItems.length === 0) {
    return {
      action: "CREATE_NEW",
      similarity: 0,
      reason: "知识库尚无已收录原子卡片，直接创建新概念",
    };
  }

  const cleanCand = candidateTitle.toLowerCase().replace(/[\s\p{P}]+/gu, "");

  // 1. 强规则：标题或别名完全包含 / 词素包含
  for (const item of existingItems) {
    const cleanTitle = item.title.toLowerCase().replace(/[\s\p{P}]+/gu, "");
    if (cleanCand === cleanTitle || cleanCand.includes(cleanTitle) || cleanTitle.includes(cleanCand)) {
      return {
        action: "MERGE_PATCH",
        matchedItem: item,
        similarity: 1.0,
        reason: `标题高度重合或互为子集（"${candidateTitle}" vs "${item.title}"）`,
      };
    }

    if (item.aliases) {
      for (const alias of item.aliases) {
        const cleanAlias = alias.toLowerCase().replace(/[\s\p{P}]+/gu, "");
        if (cleanAlias && (cleanCand === cleanAlias || cleanCand.includes(cleanAlias) || cleanAlias.includes(cleanCand))) {
          return {
            action: "MERGE_PATCH",
            matchedItem: item,
            similarity: 1.0,
            reason: `命中已有卡片别名《${alias}》（关联卡片《${item.title}》）`,
          };
        }
      }
    }
  }

  // 2. 弱规则：N-gram 字符级余弦相似度计算
  let bestMatch: T | undefined;
  let maxScore = 0;

  for (const item of existingItems) {
    const score = computeNgramSimilarity(candidateTitle, item.title);
    if (score > maxScore) {
      maxScore = score;
      bestMatch = item;
    }
  }

  if (bestMatch && maxScore >= threshold) {
    return {
      action: "MERGE_PATCH",
      matchedItem: bestMatch,
      similarity: maxScore,
      reason: `标题语义相似度达标 (${(maxScore * 100).toFixed(1)}% >= ${(threshold * 100).toFixed(0)}%)，判定为同一架构主题演进`,
    };
  }

  return {
    action: "CREATE_NEW",
    similarity: maxScore,
    reason: `与已有概念最大相似度仅 ${(maxScore * 100).toFixed(1)}% (低于门禁阈值 ${(threshold * 100).toFixed(0)}%)，判定为独立新知识`,
  };
}
