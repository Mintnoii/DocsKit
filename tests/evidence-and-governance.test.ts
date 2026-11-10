import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  splitAnchorableParagraphs,
  buildSourceRefs,
  verifySourceRef,
  checkClaimCoverage,
  mechanicalClaim,
  DEFAULT_EVIDENCE_OPTIONS,
} from "../src/layers/compile/evidence/index";
import { auditSupersedeChain, checkTitleStemConsistency } from "../src/layers/governance/lint/index";
import { resolveCardPathCollision } from "../src/layers/ingest/snapshot/index";
import { normalizeReadableTitle } from "../src/contracts/markdown";
import { computeShortHash } from "../src/foundation/hash";

const MARKDOWN = [
  "# 一级",
  "这是第一段正文，内容要足够长，确保归一化之后长度超过四十个字符，才能被保留下来参与锚点生成与后续复算。",
  "",
  "这是第二段正文，同样需要写满四十个字符以上，用来验证同一标题路径下的段落序号会依次递增而不混乱。",
  "",
  "## 二级",
  "二级标题下的第一段正文也要写够四十个字符，用来验证标题栈拼接与跨层级的段落序号重置行为是否正确。",
  "",
  "# 另一个一级",
  "新的一级标题会清空旧栈，这里的正文同样写够四十个字符，用来验证标题栈弹出逻辑与路径拼接的结果。",
].join("\n");

describe("段落级证据锚点", () => {
  it("按标题栈切段并给同级段落编号", () => {
    const paragraphs = splitAnchorableParagraphs(MARKDOWN);

    assert.equal(paragraphs.length, 4);
    assert.equal(paragraphs[0].headingPath, "一级");
    assert.equal(paragraphs[0].anchor, "一级#p1");
    assert.equal(paragraphs[0].index, 1);
    assert.equal(paragraphs[1].anchor, "一级#p2");
    assert.equal(paragraphs[2].headingPath, "一级 > 二级");
    assert.equal(paragraphs[2].anchor, "一级 > 二级#p1");
    assert.equal(paragraphs[3].headingPath, "另一个一级");
    assert.equal(paragraphs[3].anchor, "另一个一级#p1");
    assert.equal(paragraphs[0].hash.length, DEFAULT_EVIDENCE_OPTIONS.hashLength);
  });

  it("CRLF 与 LF 产出逐字一致", () => {
    assert.deepEqual(
      splitAnchorableParagraphs(MARKDOWN.replaceAll("\n", "\r\n")),
      splitAnchorableParagraphs(MARKDOWN)
    );
  });

  it("短段丢弃、跨行注释不切块、围栏与表格分隔行被剔除", () => {
    const markdown = [
      "## 章节",
      "<!-- 跨行注释开始",
      "注释内容不参与段落文本 -->",
      "这是正文内容，长度要超过四十个字符，用来验证注释行被丢弃之后正文仍然属于同一个段落块。",
      "```ts",
      "const marker = '代码文本保留';",
      "```",
      "| :--- | :---: |",
      "![图片](image.png)",
      "",
      "太短",
    ].join("\n");

    const paragraphs = splitAnchorableParagraphs(markdown);
    assert.equal(paragraphs.length, 1);
    assert.ok(!paragraphs[0].text.includes("注释内容"));
    assert.ok(paragraphs[0].text.includes("代码文本保留"));
    assert.ok(!paragraphs[0].text.includes("!["));
  });

  it("阈值可由调用方覆盖", () => {
    const paragraphs = splitAnchorableParagraphs("## 短\n只有几个字", { minParagraphLength: 2 });
    assert.equal(paragraphs.length, 1);
    assert.equal(paragraphs[0].anchor, "短#p1");
  });
});

describe("证据选段与复算", () => {
  it("选段条数受 limit 约束且引用来自真实段落", () => {
    const paragraphs = splitAnchorableParagraphs(MARKDOWN);
    const refs = buildSourceRefs(paragraphs, "标题栈拼接与段落序号", { limit: 2 });

    assert.equal(refs.length, 2);
    assert.ok(paragraphs.some((paragraph) => paragraph.anchor === refs[0].anchor));
    assert.ok(refs.every((ref) => ref.quote.length > 0 && ref.claim.length > 0));
    assert.ok(refs.every((ref) => ref.hash.length === DEFAULT_EVIDENCE_OPTIONS.hashLength));
  });

  it("全零分数退化为按段落长度降序", () => {
    const paragraphs = splitAnchorableParagraphs(MARKDOWN);
    const refs = buildSourceRefs(paragraphs, "qqqzzz", { limit: 2 });
    const expected = [...paragraphs]
      .sort((a, b) => b.text.length - a.text.length || a.anchor.localeCompare(b.anchor))
      .slice(0, 2)
      .map((paragraph) => paragraph.anchor);

    assert.deepEqual(refs.map((ref) => ref.anchor), expected);
  });

  it("同输入复算通过，改一个字即失效", () => {
    const refs = buildSourceRefs(splitAnchorableParagraphs(MARKDOWN), "标题栈", { limit: 1 });
    const ref = refs[0];

    assert.equal(verifySourceRef(ref, MARKDOWN), true);
    assert.equal(verifySourceRef(ref, MARKDOWN.replaceAll("四十个字符", "四十个字符与改动")), false);
    assert.equal(verifySourceRef({ ...ref, hash: "00000000" }, MARKDOWN), false);
    assert.equal(verifySourceRef({ ...ref, quote: "完全不相干的引用片段" }, MARKDOWN), false);
  });

  it("截断 quote 去掉尾部省略号后仍能命中原文", () => {
    const longText = "批量导出行数上限。".repeat(20);
    const markdown = `## 长段落\n${longText}`;
    const paragraphs = splitAnchorableParagraphs(markdown, { minParagraphLength: 10 });
    const ref = buildSourceRefs(paragraphs, "批量导出", { maxQuoteLength: 40, limit: 1 })[0];

    assert.equal(ref.quote.length, 40);
    assert.ok(ref.quote.endsWith("…"));
    assert.equal(verifySourceRef(ref, markdown, { minParagraphLength: 10 }), true);
  });
});

describe("声明句覆盖校验", () => {
  const quote = "批量导出行数上限为五万行，超过阈值时必须切换为异步任务执行，避免同步接口超时。";

  it("结论是原文前缀时覆盖率满格且通过", () => {
    const result = checkClaimCoverage("批量导出行数上限为五万行", quote);
    assert.equal(result.coverage, 1);
    assert.deepEqual(result.missingLatinTokens, []);
    assert.equal(result.passed, true);
  });

  it("引入原文没有的拉丁词判不通过", () => {
    const result = checkClaimCoverage("使用 WebAudio 线程渲染", quote);
    assert.ok(result.missingLatinTokens.includes("webaudio"));
    assert.equal(result.passed, false);
  });

  it("过短结论直接判不通过", () => {
    const result = checkClaimCoverage("", quote);
    assert.equal(result.coverage, 0);
    assert.equal(result.passed, false);
  });

  it("机械兜底取首句且受上限约束", () => {
    assert.equal(mechanicalClaim("第一句话。第二句话。"), "第一句话。");
    assert.equal(mechanicalClaim("没有句末标点的长文本", { maxClaimLength: 4 }), "没有句末");
  });
});

describe("演化链与身份巡检", () => {
  it("五类违规逐项命中", () => {
    const cards = [
      { stem: "open-orphan", title: "孤儿冲突卡", status: "developing", conflict: "open", supersededBy: null },
      { stem: "dep-no-ref", title: "缺回链卡", status: "deprecated", conflict: "none", supersededBy: null },
      { stem: "dep-dangling", title: "悬空卡", status: "deprecated", conflict: "none", supersededBy: "wiki/learning/missing.md" },
      { stem: "keep-stale", title: "裁决态卡", status: "evergreen", conflict: "developing", supersededBy: null },
    ];
    const conflicts = [
      { id: "conflict-0001", status: "resolved" as const, existingPath: "wiki/learning/gone.md", candidatePath: "wiki/learning/also-gone.md", decision: "keep" as const },
      { id: "conflict-0002", status: "resolved" as const, existingPath: "wiki/learning/keep-stale.md", candidatePath: null, decision: "keep" as const },
    ];

    const report = auditSupersedeChain(cards, conflicts);
    const kinds = report.issues.map((issue) => issue.kind);

    assert.ok(kinds.includes("missing_conflict_record"));
    assert.ok(kinds.includes("missing_superseded_by"));
    assert.ok(kinds.includes("dangling_superseded_by"));
    assert.equal(kinds.filter((kind) => kind === "missing_card").length, 2);
    assert.ok(kinds.includes("resolution_mismatch"));
    assert.equal(report.resolvedConflicts, 2);
    assert.equal(report.deprecatedCards, 2);
  });

  it("全库合规时零违规", () => {
    const cards = [
      { stem: "old", title: "旧卡", status: "deprecated", conflict: "resolved", supersededBy: "wiki/learning/new.md" },
      { stem: "new", title: "新卡", status: "evergreen", conflict: "resolved", supersededBy: null },
    ];
    const conflicts = [
      { id: "conflict-0001", status: "open" as const, existingPath: "wiki/learning/old.md", candidatePath: "wiki/learning/new.md" },
      { id: "conflict-0002", status: "resolved" as const, existingPath: "wiki/learning/old.md", candidatePath: "wiki/learning/new.md", decision: "supersede" as const },
    ];

    const report = auditSupersedeChain(cards, conflicts);
    assert.deepEqual(report.issues, []);
    assert.equal(report.openConflicts, 1);
    assert.equal(report.deprecatedCards, 1);
  });

  it("title 与 stem 不一致时报出路径与两个值", () => {
    const issues = checkTitleStemConsistency([
      { stem: "对齐", title: "对齐", path: "wiki/learning/对齐.md" },
      { stem: "分裂", title: "另一个标题", path: "wiki/learning/分裂.md" },
      { stem: "空标题", title: "  ", path: "wiki/learning/空标题.md" },
    ]);

    assert.equal(issues.length, 1);
    assert.equal(issues[0].cardPath, "wiki/learning/分裂.md");
    assert.equal(issues[0].title, "另一个标题");
    assert.equal(issues[0].stem, "分裂");
  });
});

describe("路径仲裁与标题底座", () => {
  const targetPath = "wiki/learning/流式渲染.md";
  const base = { targetPath, existingHash: null, incomingHash: "hash-new", sourceFile: "_raw/feishu/鉴权方案-rev2.md" };

  it("目标不存在时直接用，内容相同时跳过", () => {
    assert.deepEqual(resolveCardPathCollision({ ...base, occupiedPaths: [] }), {
      action: "use", path: targetPath, identical: false,
    });
    assert.deepEqual(resolveCardPathCollision({ ...base, existingHash: "hash-new", occupiedPaths: [targetPath] }), {
      action: "skip", path: targetPath, identical: true,
    });
  });

  it("内容不同时生成可复现并存路径，旧卡不被覆盖", () => {
    const params = { ...base, existingHash: "hash-old", occupiedPaths: [targetPath] };
    const first = resolveCardPathCollision(params);
    const second = resolveCardPathCollision(params);

    assert.equal(first.action, "rename");
    assert.equal(first.path, second.path);
    assert.notEqual(first.path, targetPath);
    assert.match(first.path, /-x[0-9a-f]{4}\.md$/);
  });

  it("后缀撞车时递增序号", () => {
    const params = { ...base, existingHash: "hash-old", occupiedPaths: [targetPath] };
    const first = resolveCardPathCollision(params);
    const second = resolveCardPathCollision({ ...params, occupiedPaths: [targetPath, first.path] });

    assert.notEqual(second.path, first.path);
    assert.match(second.path, /-x[0-9a-f]{4}1\.md$/);
  });

  it("可读标题剥离话题标签并做空值回退", () => {
    assert.equal(normalizeReadableTitle("大模型前沿 #技术落地"), "大模型前沿");
    assert.equal(normalizeReadableTitle("#A#B"), "A B");
    assert.equal(normalizeReadableTitle("###"), "Untitled");
    assert.equal(normalizeReadableTitle(""), "Untitled");
    assert.equal(normalizeReadableTitle("保留｜可读符号"), "保留｜可读符号");
  });

  it("短哈希稳定且位数可配", () => {
    assert.equal(computeShortHash("abc").length, 8);
    assert.equal(computeShortHash("abc"), computeShortHash("abc"));
    assert.notEqual(computeShortHash("abc"), computeShortHash("abd"));
    assert.equal(computeShortHash("abc", 4), computeShortHash("abc").slice(0, 4));
  });
});
