import { join } from "pathe";
import fs from "node:fs";

function loadEnvKey(): string {
  if (process.env.SILICONFLOW_API_KEY) {
    return process.env.SILICONFLOW_API_KEY;
  }
  try {
    const envPath = join(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      const match = content.match(/^SILICONFLOW_API_KEY\s*=\s*(.+)$/m);
      if (match) {
        return match[1].trim();
      }
    }
  } catch {}
  return "";
}

export interface RerankItem {
  id: string; // 唯一标识 (卡片 title 或 id)
  text: string; // 参评文本 (summary 或 text)
}

export interface RerankResult {
  id: string;
  score: number;
}

export interface RerankConfig {
  enabled?: boolean;
  backend?: "siliconflow" | "local-onnx" | "http" | "disabled";
  model?: string;
  apiKey?: string;
  httpEndpoint?: string;
  topK?: number;
}

export interface Reranker {
  rerank(query: string, items: readonly RerankItem[]): Promise<RerankResult[]>;
}

/**
 * 方案 1: 本地进程内 ONNX 神经网络重排适配器 (优雅降级支持)
 */
export class LocalOnnxReranker implements Reranker {
  private modelName: string;
  private tokenizer: any = null;
  private model: any = null;

  constructor(options?: { model?: string }) {
    this.modelName = options?.model || "Xenova/bge-reranker-base";
  }

  private async init() {
    if (!this.tokenizer || !this.model) {
      const { AutoTokenizer, AutoModelForSequenceClassification } = await import("@xenova/transformers");
      this.tokenizer = await AutoTokenizer.from_pretrained(this.modelName);
      this.model = await AutoModelForSequenceClassification.from_pretrained(this.modelName);
    }
  }

  async rerank(query: string, items: readonly RerankItem[]): Promise<RerankResult[]> {
    if (!items || items.length === 0) return [];
    try {
      await this.init();
      const results: RerankResult[] = [];
      for (const item of items) {
        const inputs = await this.tokenizer(query, { text_pair: item.text, padding: true, truncation: true });
        const output = await this.model(inputs);
        const score = output.logits.data[0];
        results.push({ id: item.id, score });
      }
      return results.sort((a, b) => b.score - a.score);
    } catch (err: any) {
      console.warn(`[LocalOnnxReranker] 本地 ONNX 运行异常 (${err.message})，降级保持原有顺序`);
      return items.map((item, idx) => ({ id: item.id, score: 1 - idx * 0.05 }));
    }
  }
}

/**
 * 方案 2: 标准 HTTP / SiliconFlow 神经网络重排适配器 (自动优雅降级)
 */
export class HttpReranker implements Reranker {
  private endpoint: string;
  private apiKey: string;
  private model: string;

  constructor(options: { endpoint?: string; apiKey?: string; model?: string }) {
    this.endpoint = options.endpoint || "https://api.siliconflow.cn/v1/rerank";
    this.apiKey = options.apiKey || loadEnvKey();
    this.model = options.model || "BAAI/bge-reranker-v2-m3";
  }

  async rerank(query: string, items: readonly RerankItem[]): Promise<RerankResult[]> {
    if (!items || items.length === 0) return [];
    if (!this.apiKey) {
      console.warn("[Rerank] 未检测到有效的 API Key，自动优雅降级回退");
      return items.map((item, idx) => ({ id: item.id, score: 1 - idx * 0.05 }));
    }

    const documents = items.map((i) => i.text);

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          query,
          documents,
          top_n: items.length,
          return_documents: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`[Rerank] HTTP 调用异常: HTTP ${response.status}: ${errorText}，自动降级回退`);
        return items.map((item, idx) => ({ id: item.id, score: 1 - idx * 0.05 }));
      }

      const data = await response.json() as any;
      if (!data.results || !Array.isArray(data.results)) {
        return items.map((item, idx) => ({ id: item.id, score: 1 - idx * 0.05 }));
      }

      const scoreMap = new Map<number, number>();
      for (const res of data.results) {
        scoreMap.set(res.index, res.relevance_score);
      }

      const results: RerankResult[] = items.map((item, idx) => ({
        id: item.id,
        score: scoreMap.get(idx) ?? 0,
      }));

      return results.sort((a, b) => b.score - a.score);
    } catch (err: any) {
      console.warn(`[Rerank] 网络请求失败 (${err.message})，自动优雅降级回退`);
      return items.map((item, idx) => ({ id: item.id, score: 1 - idx * 0.05 }));
    }
  }
}

/**
 * 统一工厂函数：依据配置创建 Reranker 实例
 */
export function createReranker(config?: RerankConfig): Reranker | null {
  if (!config || !config.enabled) return null;

  const backend = config.backend || "siliconflow";
  if (backend === "siliconflow" || backend === "http") {
    return new HttpReranker({
      endpoint: config.httpEndpoint,
      apiKey: config.apiKey,
      model: config.model,
    });
  }

  if (backend === "local-onnx") {
    return new LocalOnnxReranker({
      model: config.model,
    });
  }

  return null;
}
