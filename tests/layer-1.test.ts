import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeContentHash,
  computeMarkdownBodyHash,
  checkContentIdempotency,
  normalizeMarkdownContent,
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
  });
});
