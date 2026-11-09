import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  executeHybridRankPipeline,
  type HybridSearchableDocument,
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
  return {
    captured,
    restore: () => {
      globalThis.fetch = original;
    },
  };
};

const jsonResponse = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const RERANK_CONFIG: RerankConfig = {
  enabled: true,
  backend: "siliconflow",
  model: "BAAI/bge-reranker-v2-m3",
  httpEndpoint: "https://api.siliconflow.cn/v1/rerank",
  topK: 3,
};

const DOCS: HybridSearchableDocument[] = [
  { id: "micro", title: "微前端", searchBody: "微前端运行时隔离" },
  { id: "audio", title: "音频渲染", searchBody: "音频渲染管线" },
  { id: "render", title: "渲染优化", searchBody: "渲染性能优化" },
];

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

describe("Rerank 结果缓存", () => {
  it("同一 query 重复调用命中缓存，第二次不再打云端", async () => {
    process.env.SILICONFLOW_API_KEY = "sk-cache";
    let callCount = 0;
    const { restore } = stubFetch(async () => {
      callCount += 1;
      return jsonResponse({
        results: [
          { index: 1, relevance_score: 0.92 },
          { index: 0, relevance_score: 0.1 },
        ],
      });
    });
    try {
      const first = await executeHybridRankPipeline("音频渲染", DOCS, bm25, vector, {
        candidateLimit: 3,
        rerank: { ...RERANK_CONFIG, apiKey: "" },
      });
      assert.equal(callCount, 1, "首次必须真实调用云端");
      assert.equal(first[0].rerank?.applied, true);
      assert.equal(first[0].rerank?.cached, undefined, "首次不得标记为缓存命中");

      const second = await executeHybridRankPipeline("音频渲染", DOCS, bm25, vector, {
        candidateLimit: 3,
        rerank: { ...RERANK_CONFIG, apiKey: "" },
      });
      assert.equal(callCount, 1, "重复 query 不得再次打云端");
      assert.equal(second[0].rerank?.cached, true, "缓存命中必须可辨");
      assert.deepEqual(
        second.map((item) => item.id),
        first.map((item) => item.id),
        "缓存命中的排序必须与首次一致"
      );
    } finally {
      restore();
    }
  });

  it("候选集变更后缓存不命中，必须重新调用云端", async () => {
    process.env.SILICONFLOW_API_KEY = "sk-invalidate";
    let callCount = 0;
    const { restore } = stubFetch(async () => {
      callCount += 1;
      return jsonResponse({
        results: [
          { index: 1, relevance_score: 0.92 },
          { index: 0, relevance_score: 0.1 },
        ],
      });
    });
    try {
      await executeHybridRankPipeline("候选集变更探针", DOCS, bm25, vector, {
        candidateLimit: 3,
        rerank: { ...RERANK_CONFIG, apiKey: "" },
      });
      assert.equal(callCount, 1);

      const changedDocs: HybridSearchableDocument[] = [
        { id: "micro", title: "微前端", searchBody: "微前端运行时隔离（已改）" },
        { id: "audio", title: "音频渲染", searchBody: "音频渲染管线" },
        { id: "render", title: "渲染优化", searchBody: "渲染性能优化" },
      ];
      const second = await executeHybridRankPipeline("候选集变更探针", changedDocs, bm25, vector, {
        candidateLimit: 3,
        rerank: { ...RERANK_CONFIG, apiKey: "" },
      });
      assert.equal(callCount, 2, "候选集内容变更后必须重新调用");
      assert.equal(second[0].rerank?.cached, undefined, "重新调用不得标记为缓存命中");
    } finally {
      restore();
    }
  });

  it("降级结果不得进缓存，每次都必须重新尝试", async () => {
    process.env.SILICONFLOW_API_KEY = "sk-degraded";
    let callCount = 0;
    const { restore } = stubFetch(async () => {
      callCount += 1;
      return new Response("Token is invalid.", { status: 401 });
    });
    try {
      const first = await executeHybridRankPipeline("降级不缓存探针", DOCS, bm25, vector, {
        candidateLimit: 3,
        rerank: { ...RERANK_CONFIG, apiKey: "" },
      });
      assert.equal(callCount, 1);
      assert.equal(first[0].rerank?.applied, false);

      const second = await executeHybridRankPipeline("降级不缓存探针", DOCS, bm25, vector, {
        candidateLimit: 3,
        rerank: { ...RERANK_CONFIG, apiKey: "" },
      });
      assert.equal(callCount, 2, "降级结果不得缓存，必须每次重试");
      assert.equal(second[0].rerank?.applied, false);
      assert.equal(second[0].rerank?.cached, undefined, "降级状态不得标记为缓存命中");
    } finally {
      restore();
    }
  });

  it("关闭缓存开关后行为与开启前逐字一致", async () => {
    process.env.SILICONFLOW_API_KEY = "sk-nocache";
    let callCount = 0;
    const { restore } = stubFetch(async () => {
      callCount += 1;
      return jsonResponse({
        results: [
          { index: 1, relevance_score: 0.92 },
          { index: 0, relevance_score: 0.1 },
        ],
      });
    });
    try {
      await executeHybridRankPipeline("关闭缓存探针", DOCS, bm25, vector, {
        candidateLimit: 3,
        rerank: { ...RERANK_CONFIG, apiKey: "" },
        rerankCache: false,
      });
      const second = await executeHybridRankPipeline("关闭缓存探针", DOCS, bm25, vector, {
        candidateLimit: 3,
        rerank: { ...RERANK_CONFIG, apiKey: "" },
        rerankCache: false,
      });
      assert.equal(callCount, 2, "关闭缓存后每次都必须真实调用");
      assert.equal(second[0].rerank?.cached, undefined);
    } finally {
      restore();
    }
  });
});
