import assert from "node:assert/strict";
import { POLICY } from "../../../contracts/policy";
import { group, sort, sum } from "radash";

export interface BM25Doc {
  id: string;
  tokens: string[];
  length: number;
}

/** 匹配代码中的标识符/变量名/错误码，包含下划线、短横线与 $ 符 */
const CODE_WORD = /[a-zA-Z0-9_\-\$]+/g;

/** 匹配所有非中日韩统一表意文字（CJK），用于提纯纯中文字符流 */
const NON_CJK = /[^\u4e00-\u9fa5]/g;

/** 纯 TypeScript 轻量级 BM25 倒排检索器（驼峰拆解 + 中文 2-gram） */
export class BM25Engine {
  private readonly docs = new Map<string, BM25Doc>();
  private readonly invertedIndex = new Map<string, Map<string, number>>();
  private readonly idfCache = new Map<string, number>();
  private avgdl = 0;
  private docCount = 0;

  constructor(private readonly k1 = POLICY.sense.bm25K1, private readonly b = POLICY.sense.bm25B) {}

  /** 文本分词器：代码按驼峰与分隔符拆解，中文按单字与相邻 2-gram 提取 */
  public tokenize(text: string): string[] {
    if (!text) return [];

    const codeTokens = (text.match(CODE_WORD) ?? []).flatMap((word) => {
      // 正则 `/([a-z])([A-Z])/g` 拆解小驼峰标识符（如 `parseMarkdown` → `parse Markdown`）并转小写
      const parts = word.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[\s_\-]+/);
      return [word.toLowerCase(), ...(parts.length > 1 ? parts.filter((part) => part.length > 1) : [])];
    });

    const chinese = text.replace(NON_CJK, "");
    const chars = [...chinese];
    return [
      ...codeTokens,
      ...chars.slice(0, -1).map((char, idx) => `${char}${chars[idx + 1]}`),
      ...(chars.length === 1 ? [chinese] : []),
    ];
  }

  /** 往倒排索引添加文档，计算词频并累加文档长度与倒排表 */
  public addDocument(id: string, text: string, titleWeightBoost = 1): void {
    const tokens = this.tokenize(text);
    this.docs.set(id, { id, tokens, length: tokens.length });

    const termFreq = tokens.reduce<Map<string, number>>(
      (acc, term) => acc.set(term, (acc.get(term) ?? 0) + titleWeightBoost),
      new Map()
    );
    [...termFreq].forEach(([term, freq]) => {
      const posting = this.invertedIndex.get(term) ?? new Map<string, number>();
      posting.set(id, freq);
      this.invertedIndex.set(term, posting);
    });

    this.docCount++;
    this.avgdl = this.docCount > 0
      ? sum([...this.docs.values()], (doc) => doc.length) / this.docCount
      : 0;
    this.idfCache.clear();
  }

  /** 基于文档词频倒排表计算逆文档频率 (IDF) 并缓存 */
  private getIDF(term: string): number {
    const cached = this.idfCache.get(term);
    if (cached !== undefined) return cached;

    const n = this.invertedIndex.get(term)?.size ?? 0;
    // 概率逆文档频率公式：`ln(1 + (N - n + 0.5) / (n + 0.5))`，下限平滑保底 0.1 防止高频停用词出现负权
    const idf = Math.max(0.1, Math.log(1 + (this.docCount - n + 0.5) / (n + 0.5)));
    this.idfCache.set(term, idf);
    return idf;
  }

  /** 执行 BM25 检索评分：累加命中 Token 的 IDF 权重并结合文档长度归一，按分数降序截取 */
  public search(query: string, limit = POLICY.sense.bm25Limit): Array<{ id: string; score: number }> {
    const scored = this.tokenize(query).flatMap((term) => {
      const posting = this.invertedIndex.get(term);
      if (!posting) return [];

      const idf = this.getIDF(term);
      return [...posting].map(([docId, freq]) => {
        const doc = this.docs.get(docId);
        assert(doc, "bm25_doc_missing");
        const denominator = freq + this.k1 * (1 - this.b + this.b * (doc.length / (this.avgdl || 1)));
        return { id: docId, score: idf * ((freq * (this.k1 + 1)) / denominator) };
      });
    });

    const ranked = Object.entries(group(scored, (entry) => entry.id))
      .map(([id, entries]) => ({ id, score: sum(entries ?? [], (entry) => entry.score) }));

    return sort(ranked, (entry) => entry.score, true).slice(0, limit);
  }
}
