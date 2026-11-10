import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BM25Engine, type BM25SerializedIndex } from "../src/layers/retrieval/sense/index";

describe("BM25Engine 序列化与持久化恢复测试套件", () => {
  const sampleDocs = [
    { id: "doc-1", text: "React 19 并发渲染与 Server Components 核心架构原理与实践。" },
    { id: "doc-2", text: "TypeScript 类型体操与高级条件类型推断指南。" },
    { id: "doc-3", text: "编译型知识库 DocsKit 架构设计与 AST 语法树章节提纯策略。" },
    { id: "doc-4", text: "BM25 倒排索引与 SIGIR 倒数秩融合 (RRF) 混合检索算法落地。" },
  ];

  it("exportIndex 输出应为合法 JSON 且能够完整通过序列化往返", () => {
    const engine = new BM25Engine();
    sampleDocs.forEach((doc) => engine.addDocument(doc.id, doc.text));

    const serialized = engine.exportIndex();
    assert.equal(serialized.version, 1);
    assert.equal(serialized.docCount, 4);
    assert.ok(serialized.docs.length === 4);
    assert.ok(serialized.invertedIndex.length > 0);

    // 验证 JSON.stringify / JSON.parse 无循环引用、无丢失字段
    const jsonStr = JSON.stringify(serialized);
    const parsed: BM25SerializedIndex = JSON.parse(jsonStr);

    assert.equal(parsed.version, 1);
    assert.equal(parsed.docCount, 4);
  });

  it("通过 fromIndex 恢复的引擎实例应与原实例的检索评分严格逐项一致", () => {
    const original = new BM25Engine();
    sampleDocs.forEach((doc) => original.addDocument(doc.id, doc.text));

    const serialized = original.exportIndex();
    const restored = BM25Engine.fromIndex(JSON.parse(JSON.stringify(serialized)));

    const queries = ["React 架构", "TypeScript 类型", "DocsKit 语法树", "BM25 混合检索", "不存在的未知Query"];

    for (const q of queries) {
      const origRes = original.search(q, 10);
      const restRes = restored.search(q, 10);

      assert.equal(origRes.length, restRes.length, `query '${q}' 命中条数不一致`);

      origRes.forEach((item, idx) => {
        const restItem = restRes[idx];
        assert.equal(item.id, restItem.id, `query '${q}' 第 ${idx} 位候选 ID 不匹配`);
        assert.ok(
          Math.abs(item.score - restItem.score) < 1e-10,
          `query '${q}' 第 ${idx} 位评分浮点不相等: ${item.score} vs ${restItem.score}`
        );
      });
    }
  });

  it("版本不匹配或结构损坏时 importIndex 应通过 assert 严格拒绝", () => {
    const engine = new BM25Engine();
    assert.throws(
      () => engine.importIndex({ version: 2 } as unknown as BM25SerializedIndex),
      /invalid_bm25_serialized_version/
    );
  });
});
