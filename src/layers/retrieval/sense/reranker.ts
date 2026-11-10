import { join } from "pathe";
import fs from "node:fs";
import { isArray, sort, tryit } from "radash";

const readEnvFile = tryit(() => fs.readFileSync(join(process.cwd(), ".env"), "utf8"));
/** 剥离首尾空白与引号，空串一律归一为空，避免"有值但用不了" */
const normalizeKey = (raw?: string): string => (raw ?? "").trim().replace(/^["']|["']$/g, "").trim();

// 正则 `/^SILICONFLOW_API_KEY\s*=\s*(.+)$/m` 多行匹配 .env 文件中的 SILICONFLOW_API_KEY 配置项
const ENV_KEY_PATTERN = /^SILICONFLOW_API_KEY\s*=\s*(.+)$/m;

const loadEnvKey = (): string =>
  normalizeKey(process.env.SILICONFLOW_API_KEY) ||
  normalizeKey(ENV_KEY_PATTERN.exec(readEnvFile()[1] ?? "")?.[1]);

/**
 * 解析生效凭据：显式配置优先，但空串视为未配置。
 * 严禁用 `??` 兜底：`apiKey: ""` 是常见的「配置了但没填」形态，`??` 会把它当有效值，
 * 直接短路环境变量与 .env，导致模型一次都不请求却没有任何报错。
 */
const resolveApiKey = (explicit?: string): string => normalizeKey(explicit) || loadEnvKey();

/** 降级保序分数（恒正，杜绝长列表造出负分） */
const fallbackScores = (items: readonly { id: string }[]) =>
  items.map((item, idx) => ({ id: item.id, score: 1 / (1 + idx) }));

/** 降级结果：分数照旧可用，但 applied=false 必须让上层看得见 */
const degraded = (
  items: readonly { id: string }[],
  backend: string,
  fallbackReason: string
): RerankOutput => ({
  results: fallbackScores(items),
  applied: false,
  backend,
  fallbackReason,
});

export interface RerankItem {
  id: string;
  text: string;
}

export interface RerankResult {
  id: string;
  score: number;
}

/** 重排执行结果：applied 是唯一可信的自证，调用方不得只看分数 */
export interface RerankOutput {
  readonly results: RerankResult[];
  /** 本次是否真的由神经网络模型完成打分 */
  readonly applied: boolean;
  /** 实际生效的后端标识（降级时仍是期望后端，便于归因） */
  readonly backend: string;
  /** applied 为 false 时的降级原因 */
  readonly fallbackReason?: string;
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
  readonly backend: string;
  rerank(query: string, items: readonly RerankItem[]): Promise<RerankOutput>;
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
  readonly backend: string;

  constructor(private readonly modelName = "Xenova/bge-reranker-base") {
    this.backend = `local-onnx:${modelName}`;
  }

  /** 惰性加载 Transformers 分词器与序列分类模型权重 */
  private async init(): Promise<void> {
    if (this.tokenizer && this.model) return;
    const { AutoTokenizer, AutoModelForSequenceClassification } = await import("@xenova/transformers");
    this.tokenizer = await AutoTokenizer.from_pretrained(this.modelName) as unknown as OnnxTokenizer;
    this.model = await AutoModelForSequenceClassification.from_pretrained(this.modelName) as unknown as OnnxRerankModel;
  }

  async rerank(query: string, items: readonly RerankItem[]): Promise<RerankOutput> {
    if (items.length === 0) return { results: [], applied: true, backend: this.backend };

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
      const fallbackReason = `local_onnx_failure:${err?.message ?? "no_result"}`;
      console.warn(`[LocalOnnxReranker] ${fallbackReason}: keep_original_order`);
      return degraded(items, this.backend, fallbackReason);
    }
    return {
      results: sort(results, (item) => item.score, true),
      applied: true,
      backend: this.backend,
    };
  }
}

/** 标准 HTTP / SiliconFlow 神经网络重排适配器 */
export class HttpReranker implements Reranker {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;
  readonly backend: string;

  constructor(options: { endpoint?: string; apiKey?: string; model?: string } = {}) {
    this.endpoint = options.endpoint ?? "https://api.siliconflow.cn/v1/rerank";
    this.apiKey = resolveApiKey(options.apiKey);
    this.model = options.model ?? "BAAI/bge-reranker-v2-m3";
    this.backend = `siliconflow:${this.model}`;
  }

  async rerank(query: string, items: readonly RerankItem[]): Promise<RerankOutput> {
    if (items.length === 0) return { results: [], applied: true, backend: this.backend };
    if (!this.apiKey) {
      const fallbackReason = "siliconflow_api_key_missing";
      console.warn(`[Rerank] ${fallbackReason}: graceful_fallback`);
      return degraded(items, this.backend, fallbackReason);
    }

    let httpReason: string | undefined;
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
        // 截取前 120 字符错误响应，防止云端长 HTML 报错撑爆日志
        httpReason = `HTTP ${response.status}: ${(await response.text()).slice(0, 120)}`;
        return null;
      }
      return (await response.json()) as RerankResponse;
    })();

    if (err || !data || !isArray(data.results)) {
      const fallbackReason = err?.message ?? httpReason ?? "invalid_rerank_response";
      console.warn(`[Rerank] ${fallbackReason}: graceful_fallback`);
      return degraded(items, this.backend, fallbackReason);
    }

    const scoreMap = new Map(data.results.map((res) => [res.index, res.relevance_score]));
    return {
      results: sort(
        items.map((item, idx) => ({ id: item.id, score: scoreMap.get(idx) ?? 0 })),
        (item) => item.score,
        true
      ),
      applied: true,
      backend: this.backend,
    };
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
