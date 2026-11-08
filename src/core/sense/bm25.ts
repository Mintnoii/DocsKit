export interface BM25Doc {
  id: string;
  tokens: string[];
  length: number;
}

/**
 * 纯 TypeScript 轻量级 BM25 词项倒排检索器
 * 核心针对前端 API、代码错误码、状态枚举与中英文技术概念进行加权分词
 */
export class BM25Engine {
  private k1: number;
  private b: number;
  private docs: Map<string, BM25Doc> = new Map();
  private avgdl: number = 0;
  private docCount: number = 0;
  private invertedIndex: Map<string, Map<string, number>> = new Map(); // term -> (docId -> freq)
  private idfCache: Map<string, number> = new Map();

  constructor(k1 = 1.5, b = 0.75) {
    this.k1 = k1;
    this.b = b;
  }

  /**
   * 面向前端代码与中文概念的分词器
   * 1. 拆解驼峰与连字符命名 (如 AudioWorkletNode -> audio, worklet, node, audioworkletnode)
   * 2. 中文字符按单字与双字切分 (1-gram + 2-gram)
   */
  public tokenize(text: string): string[] {
    const tokens: string[] = [];
    if (!text) return tokens;

    // 1. 提取所有连续的英文/数字代码词
    const codeWords = text.match(/[a-zA-Z0-9_\-\$]+/g) || [];
    for (const w of codeWords) {
      const lower = w.toLowerCase();
      tokens.push(lower);
      // 拆解驼峰命名 (AudioWorklet -> audio, worklet)
      const parts = w.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[\s_\-]+/);
      if (parts.length > 1) {
        for (const p of parts) {
          if (p.length > 1) tokens.push(p);
        }
      }
    }

    // 2. 提取中文字符：优先按 2-gram 连词切分；单字仅对独立汉字切分，避免常用虚字打翻倒排索引
    const chinese = text.replace(/[^\u4e00-\u9fa5]/g, "");
    for (let i = 0; i < chinese.length - 1; i++) {
      tokens.push(chinese.slice(i, i + 2));
    }
    if (chinese.length === 1) {
      tokens.push(chinese);
    }

    return tokens;
  }

  /**
   * 索引文档
   */
  public addDocument(id: string, text: string, titleWeightBoost = 1.0): void {
    const tokens = this.tokenize(text);
    const docLength = tokens.length;
    this.docs.set(id, { id, tokens, length: docLength });

    const termFreq = new Map<string, number>();
    for (const t of tokens) {
      termFreq.set(t, (termFreq.get(t) || 0) + 1 * titleWeightBoost);
    }

    for (const [term, freq] of termFreq.entries()) {
      if (!this.invertedIndex.has(term)) {
        this.invertedIndex.set(term, new Map());
      }
      this.invertedIndex.get(term)!.set(id, freq);
    }

    this.docCount++;
    this.recalculateStats();
  }

  private recalculateStats(): void {
    let totalLen = 0;
    for (const doc of this.docs.values()) {
      totalLen += doc.length;
    }
    this.avgdl = this.docCount > 0 ? totalLen / this.docCount : 0;
    this.idfCache.clear();
  }

  private getIDF(term: string): number {
    if (this.idfCache.has(term)) {
      return this.idfCache.get(term)!;
    }

    const n = this.invertedIndex.get(term)?.size || 0;
    // 标准 Lucene / Okapi BM25 变种平滑 IDF 公式
    const idf = Math.log(1 + (this.docCount - n + 0.5) / (n + 0.5));
    const finalIdf = Math.max(0.1, idf);
    this.idfCache.set(term, finalIdf);
    return finalIdf;
  }

  /**
   * 计算单查询的 BM25 检索得分
   */
  public search(query: string, limit = 10): Array<{ id: string; score: number }> {
    const queryTokens = this.tokenize(query);
    const scores = new Map<string, number>();

    for (const term of queryTokens) {
      const posting = this.invertedIndex.get(term);
      if (!posting) continue;

      const idf = this.getIDF(term);

      for (const [docId, freq] of posting.entries()) {
        const doc = this.docs.get(docId)!;
        const numerator = freq * (this.k1 + 1);
        const denominator = freq + this.k1 * (1 - this.b + this.b * (doc.length / (this.avgdl || 1)));
        const termScore = idf * (numerator / denominator);

        scores.set(docId, (scores.get(docId) || 0) + termScore);
      }
    }

    const results = Array.from(scores.entries())
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }
}
