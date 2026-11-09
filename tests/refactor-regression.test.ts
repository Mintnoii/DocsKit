import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applySectionPatch,
  computeBigramDiceSimilarity,
  computeNgramSimilarity,
  computeTextNgramSimilarity,
  createOKFConceptMetadata,
  diffDocumentSections,
  indexBidirectionalGraph,
  isVersionNewer,
  parseSections,
  runPipeline,
} from "../src/index";

describe("重构回归：逻辑去伪存真与公共底座一致性", () => {
  it("patch 模式应保留旧卡片 frontmatter 并把废弃声明落进元数据", async () => {
    const existing = `---
title: 旧卡
created: 2026-01-01
---

## 1. 旧章节
旧内容。
`;
    const incoming = `---
title: 旧卡
---

## 2. 新章节
新内容。
`;

    const res = await runPipeline(incoming, {
      title: "旧卡",
      compileMode: "patch",
      existingContent: existing,
      features: { deprecationNotice: true },
    });

    assert.equal(res.action, "PATCHED");
    assert.equal(res.frontmatter.created, "2026-01-01");
    assert.match(res.fullMarkdown, /deprecation_warning:/);
    assert.match(res.content, /\[!WARNING\]/);
    assert.ok(!res.content.includes("## 引言与前言"));
  });

  it("章节切分走 MDAST，代码块内的 ## 注释不得被误判为标题", () => {
    const raw = `## 1. 真实章节

\`\`\`ts
// ## 假标题
const x = 1;
\`\`\`

## 2. 第二章节
正文。`;

    assert.deepEqual(
      parseSections(raw).map((section) => section.title),
      ["## 1. 真实章节", "## 2. 第二章节"]
    );

    const patch = applySectionPatch(raw, diffDocumentSections(raw, raw));
    assert.ok(!patch.includes("## 假标题\n\n"));
  });

  it("OKF 构造函数不得伪造未经上游评估的 status 与 confidence", () => {
    const meta = createOKFConceptMetadata({ title: "测试概念", summary: "测试摘要" });
    assert.equal(meta.status, undefined);
    assert.equal(meta.confidence, undefined);
    assert.equal(meta.modeling, "ipo");
  });

  it("去重门禁与混合检索消费同一份 N-gram 相似度实现", () => {
    assert.equal(
      computeNgramSimilarity("向量数据库", "向量数据库"),
      computeTextNgramSimilarity("向量数据库", "向量数据库")
    );
    assert.equal(computeBigramDiceSimilarity("知识图谱", "知识图谱"), 1);
  });

  it("双向图谱索引不得 mutate 调用方传入的卡片对象", () => {
    const cards = [
      { title: "A", outboundLinks: ["B"], backlinks: [] as string[] },
      { title: "B", outboundLinks: [] as string[], backlinks: [] as string[] },
    ];
    const graph = indexBidirectionalGraph(cards);

    assert.deepEqual(graph.get("B")?.backlinks, ["A"]);
    assert.deepEqual(cards[0].backlinks, []);
    assert.deepEqual(cards[1].backlinks, []);
  });

  it("版本兜底比对不得把「不相等」误判为递增", () => {
    assert.equal(isVersionNewer("alpha", "beta"), false);
    assert.equal(isVersionNewer("rev10", "rev9"), true);
  });
});
