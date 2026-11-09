import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  HttpReranker,
  createReranker,
  executeHybridRankPipeline,
  parseMarkdownWithAST,
  computeLateChunking,
  type RerankConfig,
} from "../src/index";

/** 记录最后一次请求的 Authorization，用于验证凭据真实来源 */
const stubFetch = (handler: (url: string, init: RequestInit) => Promise<Response>) => {
  const captured: { authorization?: string } = {};
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init: unknown) => {
    const requestInit = (init ?? {}) as RequestInit;
    captured.authorization = (requestInit.headers as Record<string, string> | undefined)?.Authorization;
    return handler(String(url), requestInit);
  }) as typeof fetch;
  return { captured, restore: () => (globalThis.fetch = original) };
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const DOCS = [
  { id: "audio", title: "前端音频线程渲染规范", searchBody: "AudioWorklet 音频线程渲染规范" },
  { id: "micro", title: "微前端与Monorepo", searchBody: "微前端沙箱隔离与依赖治理" },
  { id: "render", title: "React 渲染原理", searchBody: "Fiber 协调与渲染管线" },
];

const RERANK_CONFIG: RerankConfig = {
  enabled: true,
  backend: "siliconflow",
  model: "BAAI/bge-reranker-v2-m3",
  httpEndpoint: "https://api.siliconflow.cn/v1/rerank",
};

const bm25 = [
  { id: "micro", score: 9 },
  { id: "audio", score: 5 },
  { id: "render", score: 3 },
];
const vector = [
  { id: "micro", score: 0.9 },
  { id: "audio", score: 0.8 },
  { id: "render", score: 0.7 },
];

afterEach(() => {
  delete process.env.SILICONFLOW_API_KEY;
});

describe("Rerank 供给链活性防线", () => {
  it("空字符串 apiKey 只表示未填，必须回落到环境变量而不是短路", async () => {
    process.env.SILICONFLOW_API_KEY = "sk-from-env";
    const { captured, restore } = stubFetch(async () =>
      jsonResponse({ results: [{ index: 1, relevance_score: 0.92 }, { index: 0, relevance_score: 0.1 }] })
    );
    try {
      const output = await new HttpReranker({ ...RERANK_CONFIG, apiKey: "" }).rerank("音频渲染", [
        { id: "micro", text: "微前端" },
        { id: "audio", text: "音频" },
      ]);
      assert.equal(captured.authorization, "Bearer sk-from-env");
      assert.equal(output.applied, true);
      assert.equal(output.results[0].id, "audio");
    } finally {
      restore();
    }
  });

  it("凭据缺失时必须显式标记未生效，并给出降级原因", async () => {
    const output = await new HttpReranker({ ...RERANK_CONFIG, apiKey: "" }).rerank("音频", [
      { id: "a", text: "音频" },
      { id: "b", text: "微前端" },
    ]);
    assert.equal(output.applied, false);
    assert.match(output.fallbackReason ?? "", /SILICONFLOW_API_KEY/);
    assert.deepEqual(
      output.results.map((item) => item.id),
      ["a", "b"],
      "降级分数必须恒保序，不得伪造语义排序"
    );
  });

  it("HTTP 失败时必须记录状态码并保持 RRF 原序", async () => {
    process.env.SILICONFLOW_API_KEY = "sk-broken";
    const { restore } = stubFetch(async () => new Response("Token is invalid.", { status: 401 }));
    try {
      const ranked = await executeHybridRankPipeline("音频渲染", DOCS, bm25, vector, {
        candidateLimit: 3,
        rerank: { ...RERANK_CONFIG, apiKey: "" },
      });
      assert.deepEqual(
        ranked.map((item) => item.id),
        ["micro", "audio", "render"],
        "降级时排序必须与 RRF 完全一致"
      );
      assert.equal(ranked[0].rerank?.applied, false);
      assert.match(ranked[0].rerank?.fallbackReason ?? "", /401/);
    } finally {
      restore();
    }
  });

  it("模型真正生效时状态为 applied 且排序被模型改写", async () => {
    process.env.SILICONFLOW_API_KEY = "sk-live";
    const { restore } = stubFetch(async (_url, init) => {
      const body = JSON.parse(String(init.body)) as { documents: string[] };
      const results = body.documents.map((text, index) => ({
        index,
        relevance_score: text.includes("音频") ? 0.95 : 0.05,
      }));
      return jsonResponse({ results });
    });
    try {
      const ranked = await executeHybridRankPipeline("音频渲染", DOCS, bm25, vector, {
        candidateLimit: 3,
        rerank: { ...RERANK_CONFIG, apiKey: "" },
      });
      assert.equal(ranked[0].rerank?.applied, true);
      assert.equal(ranked[0].id, "audio", "噪声最小但语义最相关的卡片必须被模型顶到首位");
    } finally {
      restore();
    }
  });

  it("未启用 rerank 时不得回传状态字段", async () => {
    const ranked = await executeHybridRankPipeline("音频渲染", DOCS, bm25, vector, { candidateLimit: 3 });
    assert.equal(ranked[0].rerank, undefined);
    assert.equal(createReranker({ enabled: false }), null);
  });
});

describe("Late Chunking 章节定位活性", () => {
  it("超出编码窗口的章节必须独立编码，不得共用同一个池化向量", async () => {
    const longBody = Array.from(
      { length: 8 },
      (_, idx) => `## 第 ${idx + 1} 节\n\n${`第${idx + 1}节专属内容：${"渲染与分词".repeat(20)}。\n\n`}`
    ).join("");
    const { sections } = parseMarkdownWithAST(longBody, "长文档章节切分");
    assert.ok(sections.length >= 6, "构造的文档必须有足够章节");

    const { chunks } = await computeLateChunking(
      longBody,
      sections.map((section) => ({
        anchor: section.anchor,
        title: section.title,
        startOffset: section.startOffset,
        endOffset: section.endOffset,
      }))
    );

    const fingerprints = new Set(chunks.map((chunk) => chunk.vector.slice(0, 8).map((v) => v.toFixed(6)).join(",")));
    assert.equal(fingerprints.size, chunks.length, "每个章节都必须有互不相同的向量");
  });
});
