import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdownWithAST, distillMarkdownContent, BM25Engine, computeLateChunking, rrfFuseScores } from "../src/index";

describe("Cyberbrain Engine Core Test Suite", () => {
  it("AST 模块应成功解析章节并杜绝代码注释撕裂", () => {
    const raw = `
## 1. 架构痛点
系统存在并发冲突。

\`\`\`ts
// ## 此处不是标题
const x = 1;
const y = 2;
const z = 3;
\`\`\`

## 2. 核心状态机
状态机包含 IDLE 与 RUNNING。
`;
    const res = parseMarkdownWithAST(raw, "测试");
    assert.equal(res.sections.length, 2);
    assert.equal(res.sections[0].title, "1. 架构痛点");
    assert.equal(res.sections[1].title, "2. 核心状态机");
    assert.equal(res.codeBlocks.length, 1);
  });

  it("BM25 检索模块应正确计算稀疏词项评分", () => {
    const engine = new BM25Engine();
    engine.addDocument("card1", "WebGL 独立渲染管线与状态机 渲染管线 状态机 WebGL");
    engine.addDocument("card2", "微前端沙箱事件总线 微前端 沙箱 事件总线");

    const searchRes = engine.search("WebGL 状态机");
    assert.ok(searchRes.length > 0);
    assert.equal(searchRes[0].id, "card1");
  });

  it("RRF 算子计算应满足标准公式", () => {
    const score = rrfFuseScores([1, 2], 60);
    const expected = 1 / 61 + 1 / 62;
    assert.ok(Math.abs(score - expected) < 1e-6);
  });

  it("Late Chunking 引擎应离线秒级产出高维向量", async () => {
    const text = `
# 标题
正文背景。
## 1. 第一节
这是第一节的内容。
## 2. 第二节
这是第二节的内容。
`.trim();
    const sections = [
      { anchor: "#1", title: "第一节", startOffset: text.indexOf("## 1."), endOffset: text.indexOf("## 2.") },
      { anchor: "#2", title: "第二节", startOffset: text.indexOf("## 2."), endOffset: text.length },
    ];
    const out = await computeLateChunking(text, sections);
    assert.equal(out.docVector.length, 512);
    assert.equal(out.chunks.length, 2);
    assert.equal(out.chunks[0].vector.length, 512);
  });
});
