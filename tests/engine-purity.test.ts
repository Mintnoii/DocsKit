import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { POLICY } from "../src/contracts/policy";
import { NEUTRAL_LABELS } from "../src/contracts/texts";
import {
  ZH_CN_DISTILL_OPTIONS,
  ZH_CN_NORMALIZE_TEXTS,
  ZH_CN_JIT_RENDERER,
  ZH_CN_SECTION_TEXTS,
  ZH_CN_LABELS,
} from "../src/presets/index";
import { distillMarkdownContent } from "../src/layers/ingest/ast/distiller";
import { normalizeMarkdownContent } from "../src/layers/ingest/ast/normalize";
import { formatAgentJITPrompt } from "../src/layers/retrieval/jit/index";
import { evaluateDedupGate } from "../src/layers/compile/patch/dedup";
import { diffDocumentSections, applySectionPatch } from "../src/layers/compile/patch/section-patcher";
import { splitAnchorableParagraphs, buildSourceRefs, verifySourceRef } from "../src/layers/compile/evidence/index";
import { resolveCardPathCollision } from "../src/layers/ingest/snapshot/index";
import { runPipeline } from "../src/layers/compile/pipeline/index";

const DISTILL_RAW = [
  "## 背景",
  "首屏渲染较慢，需要把渲染链路拆成可验证的阶段，确保每一步都有明确的准入与准出条件。",
  "",
  "## 方案",
  "引入流式渲染，把长任务拆成可中断的片段，并在片段之间保留稳定的上下文快照。",
].join("\n");

const ATTACHMENT_RAW = "下载配置文件：[配置包.zip](https://example.com/config.zip)。";

const walk = (dir: string): readonly string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith(".ts") ? [path] : [];
  });

describe("引擎纯度", () => {
  it("引擎层方法体内零中文字符串字面量", () => {
    const offenders = [...walk("src/foundation"), ...walk("src/layers")].flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, idx) =>
          /[\u4e00-\u9fa5]/.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)
            ? [`${file}:${idx + 1}: ${line.trim()}`]
            : []
        )
    );
    assert.deepEqual(offenders, []);
  });

  it("策略数值集中在冻结表且选项可覆盖", () => {
    assert.ok(Object.isFrozen(POLICY));
    assert.ok(Object.isFrozen(POLICY.dedup));
    const exact = evaluateDedupGate({ title: "WebGL 渲染管线" }, [{ title: "WebGL 渲染管线" }]);
    assert.equal(exact.action, "MERGE_PATCH");
    assert.equal(exact.reason, "exact_title_hit");
    const lowered = evaluateDedupGate({ title: "Alpha" }, [{ title: "Omega" }], { threshold: 0.99 });
    assert.equal(lowered.action, "CREATE_NEW");
    assert.equal(lowered.reason, "below_threshold");
  });

  it("中性标签与标题兜底不含业务语言", () => {
    assert.equal(NEUTRAL_LABELS.untitled, "Untitled");
    assert.equal(NEUTRAL_LABELS.rootHeading, "ROOT");
    assert.equal(ZH_CN_LABELS.untitled, "未命名标题");
  });

  it("默认渲染只由输入数据组成，不带自造模板", () => {
    const neutral = distillMarkdownContent(DISTILL_RAW, "流式渲染");
    assert.ok(neutral.startsWith("# 流式渲染"));
    assert.ok(neutral.includes("## 背景"));
    assert.ok(!neutral.includes("单步机制"));
    assert.ok(!neutral.includes("这张卡讲什么"));
    assert.ok(!neutral.includes("生产踩坑剖析"));
  });
});

describe("中文预设注入后可恢复旧版输出", () => {
  it("distill 注入后恢复建模注记", () => {
    const card = distillMarkdownContent(DISTILL_RAW, "流式渲染", ZH_CN_DISTILL_OPTIONS);
    assert.ok(card.includes("单步机制"));
    assert.ok(card.includes("这张卡讲什么"));
    assert.ok(card.includes("容易踩的坑"));
  });

  it("runPipeline 注入后恢复中文卡片", async () => {
    const res = await runPipeline(DISTILL_RAW, {
      title: "流式渲染",
      compileMode: "distill",
      modeling: "ipo",
      texts: { distill: ZH_CN_DISTILL_OPTIONS },
    });
    assert.equal(res.action, "DISTILLED");
    assert.ok(res.content.includes("单步机制"));
  });

  it("normalize 注入后恢复附件占位与中文附录", () => {
    const neutral = normalizeMarkdownContent(ATTACHMENT_RAW);
    assert.ok(neutral.cleanContent.includes("[attachment: 配置包.zip]"));
    assert.ok(!neutral.cleanContent.includes("附件资产"));

    const zh = normalizeMarkdownContent(ATTACHMENT_RAW, { texts: ZH_CN_NORMALIZE_TEXTS });
    assert.ok(zh.cleanContent.includes("📎 附件 配置包.zip"));
    assert.ok(zh.cleanContent.includes("### 附件"));
    assert.ok(zh.cleanContent.includes("[下载](https://example.com/config.zip)"));
  });

  it("JIT 注入后恢复中文提示词", () => {
    const card = { title: "流式渲染", summary: "方案主干", filePath: "wiki/流式渲染.md" };
    const neutral = formatAgentJITPrompt("改渲染", [card]);
    assert.ok(!neutral.prompt.includes("先看这几张卡"));
    const zh = formatAgentJITPrompt("改渲染", [card], {
      render: ZH_CN_JIT_RENDERER,
      vaultName: ZH_CN_LABELS.vaultName,
    });
    assert.ok(zh.prompt.includes("先看这几张卡"));
    assert.deepEqual(zh.topCardPaths, ["wiki/流式渲染.md"]);
  });

  it("章节预设注入后恢复中文废弃声明", () => {
    const oldCard = "## 旧接口\n旧实现。\n";
    const incoming = "## 新接口\n新实现。\n";
    const diff = diffDocumentSections(oldCard, incoming, "", ZH_CN_SECTION_TEXTS);
    const patched = applySectionPatch(oldCard, diff, { texts: ZH_CN_SECTION_TEXTS });
    assert.ok(patched.includes("这段已废弃"));
    assert.ok(patched.includes("改代码时绕开它"));
  });
});

describe("纯计算行为逐字不变", () => {
  it("段落锚点生成与复算稳定", () => {
    const paragraphs = splitAnchorableParagraphs(DISTILL_RAW, { minParagraphLength: 10 });
    assert.equal(paragraphs[0].anchor, "背景#p1");
    assert.equal(paragraphs[0].hash.length, POLICY.evidence.hashLength);
    const ref = buildSourceRefs(paragraphs, "首屏渲染", { limit: 1 })[0];
    assert.equal(verifySourceRef(ref, DISTILL_RAW, { minParagraphLength: 10 }), true);
    assert.equal(verifySourceRef(ref, DISTILL_RAW.replace("首屏渲染较慢", "首屏渲染较快"), { minParagraphLength: 10 }), false);
  });

  it("路径仲裁三类判定稳定", () => {
    const targetPath = "wiki/learning/流式渲染.md";
    const base = { targetPath, existingHash: null, incomingHash: "h1", sourceFile: "_raw/a.md", occupiedPaths: [] };
    assert.equal(resolveCardPathCollision(base).action, "use");
    assert.equal(resolveCardPathCollision({ ...base, existingHash: "h1", occupiedPaths: [targetPath] }).action, "skip");
    const renamed = resolveCardPathCollision({ ...base, existingHash: "h0", occupiedPaths: [targetPath] });
    assert.equal(renamed.action, "rename");
    assert.notEqual(renamed.path, targetPath);
  });
});
