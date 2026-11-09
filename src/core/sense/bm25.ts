import { group, sum } from "radash";

export interface BM25Doc {
  id: string;
  tokens: string[];
  length: number;
}

const CODE_WORD = /[a-zA-Z0-9_\-\$]+/g;
const NON_CJK = /[^\u4e00-\u9fa5]/g;

/** 纯 TypeScript 轻量级 BM25 倒排检索器（驼峰拆解 + 中文 2-gram） */
export class BM25Engine {
  private readonly docs = new Map<string, BM25Doc>();
  private readonly invertedIndex = new Map<string, Map<string, number>>();
  private readonly idfCache = new Map<string, number>();
  private avgdl = 0;
  private docCount = 0;

  constructor(private readonly k1 = 1.5, private readonly b = 0.75) {}

  public tokenize(text: string): string[] {
    if (!text) return [];

    const codeTokens = (text.match(CODE_WORD) ?? []).flatMap((word) => {
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

  public addDocument(id: string, text: string, titleWeightBoost = 1): void {
    const tokens = this.tokenize(text);
    this.docs.set(id, { id, tokens, length: tokens.length });

    const termFreq = tokens.reduce<Map<string, number>>(
      (acc, term) => acc.set(term, (acc.get(term) ?? 0) + titleWeightBoost),
      new Map()
    );
    [...termFreq].forEach(([term, freq]) => {
      if (!this.invertedIndex.has(term)) this.invertedIndex.set(term, new Map());
      this.invertedIndex.get(term)!.set(id, freq);
    });

    this.docCount++;
    this.avgdl = this.docCount > 0
      ? sum([...this.docs.values()], (doc) => doc.length) / this.docCount
      : 0;
    this.idfCache.clear();
  }

  private getIDF(term: string): number {
    const cached = this.idfCache.get(term);
    if (cached !== undefined) return cached;

    const n = this.invertedIndex.get(term)?.size ?? 0;
    const idf = Math.max(0.1, Math.log(1 + (this.docCount - n + 0.5) / (n + 0.5)));
    this.idfCache.set(term, idf);
    return idf;
  }

  public search(query: string, limit = 10): Array<{ id: string; score: number }> {
    const scored = this.tokenize(query).flatMap((term) => {
      const posting = this.invertedIndex.get(term);
      if (!posting) return [];

      const idf = this.getIDF(term);
      return [...posting].map(([docId, freq]) => {
        const doc = this.docs.get(docId)!;
        const denominator = freq + this.k1 * (1 - this.b + this.b * (doc.length / (this.avgdl || 1)));
        return { id: docId, score: idf * ((freq * (this.k1 + 1)) / denominator) };
      });
    });

    return Object.entries(group(scored, (entry) => entry.id))
      .map(([id, entries]) => ({ id, score: sum(entries ?? [], (entry) => entry.score) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
