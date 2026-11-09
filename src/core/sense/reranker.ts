import { join } from "pathe";
import fs from "node:fs";
import { isArray, tryit } from "radash";

const readEnvFile = tryit(() => fs.readFileSync(join(process.cwd(), ".env"), "utf-8"));
const ENV_KEY_PATTERN = /^SILICONFLOW_API_KEY\s*=\s*(.+)$/m;

const loadEnvKey = (): string =>
  process.env.SILICONFLOW_API_KEY ||
  ENV_KEY_PATTERN.exec(readEnvFile()[1] ?? "")?.[1]?.trim() ||
  "";

/** 降级保序分数（恒正，杜绝长列表造出负分） */
const fallbackScores = (items: readonly { id: string }[]) =>
  items.map((item, idx) => ({ id: item.id, score: 1 / (1 + idx) }));

export interface RerankItem {
  id: string;
  text: string;
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

interface OnnxTokenizer {
  (query: string, options: Record<string, unknown>): Promise<unknown> | unknown;
}
interface OnnxRerankModel {
  (inputs: unknown): Promise<{ logits: { data: ArrayLike<number> } }>;
}
interface RerankResponse {
  results?: readonly { index: number; relevance_score: number }[];
}

/** 本地进程内 ONNX 神经网络重排适配器 */
export class LocalOnnxReranker implements Reranker {
  private tokenizer: OnnxTokenizer | null = null;
  private model: OnnxRerankModel | null = null;

  constructor(private readonly modelName = "Xenova/bge-reranker-base") {}

  private async init(): Promise<void> {
    if (this.tokenizer && this.model) return;
    const { AutoTokenizer, AutoModelForSequenceClassification } = await import("@xenova/transformers");
    this.tokenizer = await AutoTokenizer.from_pretrained(this.modelName) as unknown as OnnxTokenizer;
    this.model = await AutoModelForSequenceClassification.from_pretrained(this.modelName) as unknown as OnnxRerankModel;
  }

  async rerank(query: string, items: readonly RerankItem[]): Promise<RerankResult[]> {
    if (items.length === 0) return [];

    const [err, results] = await tryit(async () => {
      await this.init();
      return Promise.all(items.map(async (item) => {
        const inputs = await this.tokenizer!(query, {
          text_pair: item.text,
          padding: true,
          truncation: true,
        });
        const output = await this.model!(inputs);
        return { id: item.id, score: output.logits.data[0] };
      }));
    })();

    if (err || !results) {
      console.warn(`[LocalOnnxReranker] 本地 ONNX 运行异常 (${err?.message ?? "无结果"})，降级保持原有顺序`);
      return fallbackScores(items);
    }
    return results.sort((a, b) => b.score - a.score);
  }
}

/** 标准 HTTP / SiliconFlow 神经网络重排适配器 */
export class HttpReranker implements Reranker {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(options: { endpoint?: string; apiKey?: string; model?: string } = {}) {
    this.endpoint = options.endpoint ?? "https://api.siliconflow.cn/v1/rerank";
    this.apiKey = options.apiKey ?? loadEnvKey();
    this.model = options.model ?? "BAAI/bge-reranker-v2-m3";
  }

  async rerank(query: string, items: readonly RerankItem[]): Promise<RerankResult[]> {
    if (items.length === 0) return [];
    if (!this.apiKey) {
      console.warn("[Rerank] 未检测到有效的 API Key，自动优雅降级回退");
      return fallbackScores(items);
    }

    const [err, data] = await tryit(async (): Promise<RerankResponse | null> => {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          query,
          documents: items.map((item) => item.text),
          top_n: items.length,
          return_documents: false,
        }),
      });
      if (!response.ok) {
        console.warn(`[Rerank] HTTP 调用异常: HTTP ${response.status}: ${await response.text()}，自动降级回退`);
        return null;
      }
      return (await response.json()) as RerankResponse;
    })();

    if (err || !data || !isArray(data.results)) {
      console.warn(`[Rerank] 网络请求或响应异常 (${err?.message ?? "结果结构不符"})，自动优雅降级回退`);
      return fallbackScores(items);
    }

    const scoreMap = new Map(data.results.map((res) => [res.index, res.relevance_score]));
    return items
      .map((item, idx) => ({ id: item.id, score: scoreMap.get(idx) ?? 0 }))
      .sort((a, b) => b.score - a.score);
  }
}

const BACKEND_FACTORIES: Partial<
  Record<NonNullable<RerankConfig["backend"]>, (config: RerankConfig) => Reranker>
> = {
  siliconflow: (config) => new HttpReranker(config),
  http: (config) => new HttpReranker(config),
  "local-onnx": (config) => new LocalOnnxReranker(config.model),
};

/** 按配置查表创建 Reranker，未启用或未知后端返回 null */
export const createReranker = (config?: RerankConfig): Reranker | null =>
  config?.enabled
    ? (BACKEND_FACTORIES[config.backend ?? "siliconflow"]?.(config) ?? null)
    : null;
