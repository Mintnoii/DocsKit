import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeContentHash,
  computeMarkdownBodyHash,
  checkContentIdempotency,
  normalizeMarkdownContent,
  parseSnapshotMeta,
  buildSnapshotPath,
  isVersionNewer,
  sanitizeFileName,
} from "../src/index";

describe("Cyberbrain Core Operators Test Suite", () => {
  describe("1. Hash & 0-Token Idempotency Gate", () => {
    it("抹平 CRLF 后哈希应严格一致", () => {
      const crlf = "Line 1\r\nLine 2\r\n";
      const lf = "Line 1\nLine 2\n";
      const hashCrlf = computeContentHash(crlf);
      const hashLf = computeContentHash(lf);

      assert.equal(hashCrlf, hashLf);
      assert.ok(hashCrlf.startsWith("sha256:"));
    });

    it("computeMarkdownBodyHash 应剥离 Frontmatter 计算纯正文指纹", () => {
      const raw1 = `---
title: 测试标题 1
updated: 2026-11-01
---

## 核心内容
这是一段纯正文内容。`;

      const raw2 = `---
title: 测试标题 2 产生变化
updated: 2026-11-08
tags: [new]
---

## 核心内容
这是一段纯正文内容。`;

      const bodyHash1 = computeMarkdownBodyHash(raw1);
      const bodyHash2 = computeMarkdownBodyHash(raw2);

      assert.ok(bodyHash1);
      assert.equal(bodyHash1, bodyHash2);
    });

    it("空正文应返回 null，并在幂等检查中触发 EMPTY_BODY 跳过", () => {
      const emptyDoc = "---\ntitle: 仅有元数据\n---\n";
      assert.equal(computeMarkdownBodyHash(emptyDoc), null);

      const res = checkContentIdempotency(emptyDoc, new Set());
      assert.equal(res.shouldSkip, true);
      assert.equal(res.reason, "EMPTY_BODY");
    });
  });

  describe("2. AST Markdown Normalization & Clean", () => {
    it("应正确转换 :::tip 与 :::warning 容器为标准 GitHub/Obsidian Alerts", () => {
      const raw = `
:::tip 核心建议
请尽量遵循第一性原则进行重构。
:::

:::warning 注意事项
严禁删除旧章节，必须打上废弃标记。
:::
`;
      const result = normalizeMarkdownContent(raw);
      assert.ok(result.cleanContent.includes("> [!TIP] 核心建议"));
      assert.ok(result.cleanContent.includes("> 请尽量遵循第一性原则进行重构。"));
      assert.ok(result.cleanContent.includes("> [!WARNING] 注意事项"));
      assert.ok(result.cleanContent.includes("> 严禁删除旧章节，必须打上废弃标记。"));
      assert.equal(result.stats.calloutsCount, 2);
    });

    it("应提取外部二进制附件并在文末结构化列出，正文设立占位", () => {
      const raw = `
点击此处下载配置文件：[配置包.zip](https://internal.storage.com/files/config.zip)。
另有说明文档：[技术方案.pdf](https://internal.storage.com/docs/spec.pdf)。
`;
      const result = normalizeMarkdownContent(raw);

      assert.equal(result.attachments.length, 2);
      assert.equal(result.attachments[0].name, "配置包.zip");
      assert.equal(result.attachments[0].ext, "zip");
      assert.equal(result.attachments[1].name, "技术方案.pdf");

      assert.ok(result.cleanContent.includes("📎 **[附件资产: 配置包.zip]**"));
      assert.ok(result.cleanContent.includes("### 📦 外部附件与关联资产清单"));
      assert.ok(result.cleanContent.includes("| 1 | `配置包.zip` | `.zip` | [原始下载链接](https://internal.storage.com/files/config.zip) |"));
    });

    it("应通过 unist-util-select 准确统计 Mermaid、代码块与表格", () => {
      const raw = `
## 1. 架构图解
\`\`\`mermaid
flowchart TD
  A --> B
\`\`\`

\`\`\`ts
const x = 1;
\`\`\`

| 参数 | 类型 |
| :--- | :--- |
| id | string |
`;
      const result = normalizeMarkdownContent(raw);
      assert.equal(result.stats.mermaidCount, 1);
      assert.equal(result.stats.codeBlocksCount, 2);
      assert.equal(result.stats.tablesCount, 1);
    });
  });

  describe("3. Snapshot Path & Version Resolver", () => {
    it("parseSnapshotMeta 应声明式解构分类、标题与 revision", () => {
      const meta1 = parseSnapshotMeta("_raw/frontend/WebGL渲染引擎-rev3.md");
      assert.equal(meta1.category, "frontend");
      assert.equal(meta1.title, "WebGL渲染引擎");
      assert.equal(meta1.revision, 3);
      assert.equal(meta1.safeFileName, "WebGL渲染引擎-rev3.md");

      const meta2 = parseSnapshotMeta("snapshots/articles/深度学习通识.md");
      assert.equal(meta2.category, "articles");
      assert.equal(meta2.title, "深度学习通识");
      assert.equal(meta2.revision, null);
    });

    it("buildSnapshotPath 应生成标准物理路径", () => {
      const path = buildSnapshotPath({
        category: "agent",
        title: "Agent Loop 机制",
        revision: 2,
      });
      assert.equal(path, "_raw/agent/Agent Loop 机制-rev2.md");
    });

    it("isVersionNewer 应支持整数 revision 与 SemVer 版本比对", () => {
      assert.equal(isVersionNewer(3, 2), true);
      assert.equal(isVersionNewer(2, 2), false);
      assert.equal(isVersionNewer(1, 2), false);

      assert.equal(isVersionNewer("1.2.0", "1.1.9"), true);
      assert.equal(isVersionNewer("2.0.0", "2.0.0"), false);
      assert.equal(isVersionNewer("v1.5.0", "1.4.0"), true);
    });
  });
});
