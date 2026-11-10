import { describe, it } from "node:test";
import { ZH_CN_DISTILL_OPTIONS, ZH_CN_NORMALIZE_TEXTS, ZH_CN_SECTION_TEXTS, ZH_CN_JIT_RENDERER, ZH_CN_LABELS } from "../src/presets/index";
import assert from "node:assert/strict";
import {
  buildSnapshotPath,
  parseSnapshotMeta,
  isVersionNewer,
  isProtectedPath,
  checkContentIdempotency,
  evaluateDedupGate,
  runPipeline,
  extractWikiOutboundLinks,
  indexBidirectionalGraph,
  formatAgentJITPrompt,
  lintVaultTopology,
} from "../src/index";

/** 个人型配方：素材落到只读底座，去重后提纯为概念卡片 */
type ConceptRef = { readonly title: string; readonly aliases?: readonly string[] };

async function buildPersonalCard(
  rawMaterial: string,
  knownHashes: Set<string>,
  title: string,
  existingConcepts: readonly ConceptRef[] = []
) {
  const snapshotPath = buildSnapshotPath({ category: "articles", title, revision: 1 });
  assert.ok(isProtectedPath(snapshotPath));

  const gate = checkContentIdempotency(rawMaterial, knownHashes);
  if (gate.shouldSkip) return null;

  const dedup = evaluateDedupGate({ title }, existingConcepts, { threshold: 0.58 });
  if (dedup.action === "MERGE_PATCH") return null;

  const result = await runPipeline(rawMaterial, {
    title,
    compileMode: "distill",
    modeling: "ipo",
    metadata: { defaultValues: { type: "concept" } },
    texts: { distill: ZH_CN_DISTILL_OPTIONS, normalize: ZH_CN_NORMALIZE_TEXTS, section: ZH_CN_SECTION_TEXTS },
  });
  return result.fullMarkdown;
}

/** 团队型配方：版本快照对账，主干增量合并，人工锁阻断，装配 JIT 上下文 */
async function buildTeamCard(incoming: string, existing: string | undefined, title: string) {
  const snapshot = parseSnapshotMeta("_raw/feishu/鉴权方案-rev2.md");
  if (!isVersionNewer(snapshot.revision, 1)) return null;

  const result = await runPipeline(incoming, {
    title,
    compileMode: "patch",
    existingContent: existing,
    features: { deprecationNotice: true },
    gates: { humanLock: true },
    texts: { section: ZH_CN_SECTION_TEXTS },
  });

  const graph = indexBidirectionalGraph([
    { title, outboundLinks: extractWikiOutboundLinks(result.content) },
    { title: "上游依赖", outboundLinks: [] },
  ]);
  const jit = formatAgentJITPrompt(
    `修改 ${title}`,
    [{ title, summary: "方案主干", filePath: `wiki/${snapshot.category}/${title}.md` }],
    { mode: "compact", render: ZH_CN_JIT_RENDERER, vaultName: ZH_CN_LABELS.vaultName }
  );

  return { fullMarkdown: result.fullMarkdown, graph, prompt: jit.prompt, action: result.action };
}

describe("构建指南配方可运行性", () => {
  it("个人型配方产出带 Frontmatter 的概念卡片并对未变素材短路", async () => {
    const raw = "## 背景\n首屏渲染慢。\n\n## 方案\n引入流式渲染。\n";
    const card = await buildPersonalCard(raw, new Set(), "流式渲染");

    assert.ok(card);
    assert.match(card, /^---/);
    assert.match(card, /单步机制/);

    const unchanged = new Set<string>();
    const hash = (await import("../src/index")).computeMarkdownBodyHash(raw)!;
    unchanged.add(hash);
    assert.equal(await buildPersonalCard(raw, unchanged, "流式渲染"), null);
  });

  it("团队型配方保留旧卡片元数据并注入废弃声明", async () => {
    const existing = `---
title: 鉴权方案
created: 2026-01-01
---

## 旧接口
旧实现。
`;
    const incoming = "## 新接口\n新实现。\n";
    const built = await buildTeamCard(incoming, existing, "鉴权方案");

    assert.ok(built);
    assert.match(built.fullMarkdown, /created: 2026-01-01/);
    assert.match(built.fullMarkdown, /deprecation_warning:/);
    assert.match(built.prompt, /先看这几张卡/);
    assert.equal(built.graph.size, 2);
  });

  it("人工锁与版本回退都应阻断编译", async () => {
    const locked = "---\nlock: human\n---\n\n## 红线\n人工拍板。\n";
    const skipped = await buildTeamCard("新内容", locked, "红线");
    assert.equal(skipped?.action, "SKIPPED_HUMAN_LOCK");
    assert.equal(skipped?.fullMarkdown, locked);
    assert.equal(isVersionNewer(1, 2), false);
  });

  it("全库断链巡检可直接消费配方产出的卡片", () => {
    const report = lintVaultTopology([
      {
        filePath: "wiki/learning/流式渲染.md",
        title: "流式渲染",
        content: "参见 [[上游依赖]]",
        outboundLinks: ["上游依赖"],
      },
      { filePath: "wiki/learning/上游依赖.md", title: "上游依赖", content: "", outboundLinks: [] },
    ]);
    assert.equal(report.brokenLinks.length, 0);
  });
});
