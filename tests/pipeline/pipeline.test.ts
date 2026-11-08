import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runPipeline,
  computeMarkdownBodyHash,
  normalizeMarkdownContent,
} from "../../src/index";

describe("Cyberbrain Configurable Pipeline Engine Test Suite", () => {
  it("默认 patch 模式应能对比更新已有卡片，保留全文主干", async () => {
    const existing = `---
title: 服务端渲染方案
status: evergreen
---

## 1. 架构痛点
首屏渲染较慢。

## 2. 旧接口
旧实现代码。
`;

    const incoming = `---
title: 服务端渲染方案
---

## 1. 架构痛点
首屏渲染较慢，且 TTFB 过长。

## 3. 新渲染管线
引入流式 SSR。
`;

    const res = await runPipeline(incoming, {
      title: "服务端渲染方案",
      compileMode: "patch",
      existingContent: existing,
      features: {
        deprecationNotice: true,
      },
    });

    assert.equal(res.action, "PATCHED");
    assert.equal(res.skipped, false);
    assert.ok(res.content.includes("首屏渲染较慢，且 TTFB 过长"));
    assert.ok(res.content.includes("3. 新渲染管线"));
    // 旧接口在 incoming 中未出现，启用 deprecationNotice 时应保留并注入废弃警示声明
    assert.ok(res.content.includes("废弃声明"));
    assert.ok(res.content.includes("[!WARNING]"));
  });

  it("distill 模式应支持 concept 建模三大形态 (ipo / decomposition / hybrid)", async () => {
    const raw = `
## 1. 为什么需要治理
系统状态存在复杂度。

## 2. 第一阶段
装配基础环境。

## 3. 第二阶段
运行时状态机闭环。

\`\`\`ts
export function loop() {
  return true;
}
\`\`\`
`;

    // 1. 测试 IPO 算子建模
    const resIpo = await runPipeline(raw, {
      title: "Prefix Caching 原理",
      compileMode: "distill",
      modeling: "ipo",
    });
    assert.equal(resIpo.action, "DISTILLED");
    assert.ok(resIpo.content.includes("形态 A · 纯 IPO 算子模型"));
    assert.ok(resIpo.content.includes("核心架构契约与设计范式"));
    assert.equal(resIpo.frontmatter.modeling, "ipo");

    // 2. 测试 Decomposition 分解工序建模
    const resDecomp = await runPipeline(raw, {
      title: "Agent 上下文治理",
      compileMode: "distill",
      modeling: "decomposition",
    });
    assert.equal(resDecomp.action, "DISTILLED");
    assert.ok(resDecomp.content.includes("形态 B · 纯分解工序模型"));
    assert.ok(resDecomp.content.includes("多阶段生命周期工序分解"));
    assert.equal(resDecomp.frontmatter.modeling, "decomposition");

    // 3. 测试 Hybrid 混合架构建模
    const resHybrid = await runPipeline(raw, {
      title: "Agent Loop 控制循环机制",
      compileMode: "distill",
      modeling: "hybrid",
    });
    assert.equal(resHybrid.action, "DISTILLED");
    assert.ok(resHybrid.content.includes("形态 C · 混合建模架构"));
    assert.ok(resHybrid.content.includes("全局宏观 IPO 契约与内层工序解构"));
    assert.equal(resHybrid.frontmatter.modeling, "hybrid");
  });

  it("人工锁 lock: human 保护门禁应能强反射阻断覆盖", async () => {
    const existingLocked = `---
title: 核心架构规范
lock: human
---

## 绝对红线
架构师人工拍板，禁止 AI 自动化脚本覆盖。
`;

    const incoming = `
## 绝对红线
AI 擅自尝试改写的内容。
`;

    const res = await runPipeline(incoming, {
      title: "核心架构规范",
      existingContent: existingLocked,
      gates: {
        humanLock: true,
      },
    });

    assert.equal(res.action, "SKIPPED_HUMAN_LOCK");
    assert.equal(res.skipped, true);
    assert.equal(res.skipReason, "LOCKED_BY_HUMAN");
    assert.ok(res.content.includes("禁止 AI 自动化脚本覆盖"));
  });

  it("0-Token 纯正文幂等检查门禁应能短路跳过", async () => {
    const doc = `---
title: 测试幂等
---

## 1. 核心章节
这是一段毫无变化的内容。
`;
    const hash = computeMarkdownBodyHash(doc)!;
    const fingerprints = new Set([hash]);

    const res = await runPipeline(doc, {
      title: "测试幂等",
      knownFingerprints: fingerprints,
      gates: {
        idempotency: true,
      },
    });

    assert.equal(res.action, "SKIPPED_IDEMPOTENCY");
    assert.equal(res.skipped, true);
    assert.equal(res.skipReason, "UNCHANGED_HASH");
  });

  it("应支持自定义链接转换钩子与元数据动态转换", async () => {
    const raw = `
参考文档：[用户中心](https://internal.wiki.com/pages/user-center)。
`;

    interface CustomMeta {
      category: string;
      processedAt?: string;
    }

    const res = await runPipeline<CustomMeta>(raw, {
      title: "动态转换测试",
      features: {
        transformLink: (url, text) => {
          if (url.includes("internal.wiki.com")) {
            return `[[${text}|internal]]`;
          }
          return null;
        },
      },
      metadata: {
        defaultValues: { category: "base" },
        transform: (data) => ({ ...data, processedAt: "2026-11-09" }),
      },
    });

    assert.ok(res.content.includes("[[用户中心|internal]]"));
    assert.equal(res.frontmatter.processedAt, "2026-11-09");
  });
});
