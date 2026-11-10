# 用 DocsKit 搭一个知识库

把一篇几千字的技术方案切块塞进向量库，代码块会被切碎，表格会散架，改了一处接口也找不到哪几张卡片在引用它。两个知识库各自写一遍 Markdown 解析、去重和检索，代码很快分叉。DocsKit 把这些通用计算收成无状态纯函数，业务层只决定素材从哪来、卡片往哪放、检索结果怎么给模型看。

本文给两份可运行的配方。个人型把外部素材提纯成概念卡片，团队型把版本化方案增量合并成长期维护的主干。文中的两段代码在 `tests/vault-recipes.test.ts` 有对应实现和断言，`pnpm test` 会实际执行它们。示例按发布包的子路径写，仓库内试跑时把 `docskit/<子路径>` 换成对应源码路径；测试文件属一次性脚本入口，从 `../src/index` 根 barrel 引入。

## 都要做的四件事

不管卡片最终给谁看，底下这四层都得有。它们各自独立，按需取用，不要求一次全接上。

| 层 | 要解决的事 | 对应函数 |
| :--- | :--- | :--- |
| 只读底座 | 原始素材落盘位置稳定，Agent 不能回写 | `buildSnapshotPath`、`parseSnapshotMeta`、`isProtectedPath`、`evaluateToolCallPathGuard` |
| 幂等与人工锁 | 正文没变就别重复调模型，人工拍板的卡片不许覆盖 | `computeMarkdownBodyHash`、`checkContentIdempotency`、`checkHumanLock` |
| 卡片契约 | Frontmatter 字段统一，正文与元数据分离 | `parseMarkdownSafely`、`stringifyMarkdownSafely`、`createOKFMetadata`、`validateOKFMetadata` |
| 拓扑与巡检 | 双链成图，断链和格式错误能被扫出来 | `extractWikiOutboundLinks`、`indexBidirectionalGraph`、`lintVaultTopology`、`auditDirectoryVault` |

这些函数分属 `docskit/snapshot`、`docskit/lint`、`docskit/hash`、`docskit/markdown`、`docskit/okf`、`docskit/ast`、`docskit/graph`，从各自子路径导入。每个函数只有一个权威子路径，Frontmatter 与排版走 `docskit/markdown`，数值相似度走 `docskit/numeric`，不再做归属选择题。`runPipeline` 内部只做 Frontmatter 合并与 `stringifyMarkdownSafely` 封装，强契约校验要业务层显式调 `validateOKFMetadata`。

只读底座与幂等门禁通常最先执行，此时还没碰模型：

```ts
import { buildSnapshotPath } from "docskit/snapshot";
import { isProtectedPath } from "docskit/lint";
import { checkContentIdempotency } from "docskit/hash";

const snapshotPath = buildSnapshotPath({ category: "articles", title, revision: 1 });
// _raw/articles/<title>-rev1.md
if (!isProtectedPath(snapshotPath)) throw new Error("快照必须落在只读底座");

const gate = checkContentIdempotency(rawMaterial, knownHashes);
if (gate.shouldSkip) return null;
```

`buildSnapshotPath` 默认把文件放进 `_raw/`，`isProtectedPath` 的默认规则正好覆盖这个目录。要接到 Agent 的工具调用链上，把 `evaluateToolCallPathGuard` 挂在写文件之前，它会拦下指向只读底座的 `write` 与 `edit`。

## 个人型知识库

个人知识库的入口很杂，公众号长文、视频转录、随手记的碎片都会进来。这类素材的关系是「一篇素材长出若干概念」，所以主链路走提炼，概念之间靠去重门禁防止同义碎片化。

素材先落到只读底座，算指纹做幂等短路，再与已有概念比对，最后交给 `runPipeline` 的 `distill` 模式产出带 Frontmatter 的概念卡片。`modeling: "ipo"` 让卡片按输入、处理、输出三段组织，适合讲单个机制。

```ts
import { buildSnapshotPath } from "docskit/snapshot";
import { isProtectedPath } from "docskit/lint";
import { checkContentIdempotency } from "docskit/hash";
import { evaluateDedupGate } from "docskit/patch";
import { runPipeline } from "docskit/pipeline";

type ConceptRef = { readonly title: string; readonly aliases?: readonly string[] };

export async function buildPersonalCard(
  rawMaterial: string,
  knownHashes: Set<string>,
  title: string,
  existingConcepts: readonly ConceptRef[] = []
) {
  const snapshotPath = buildSnapshotPath({ category: "articles", title, revision: 1 });
  if (!isProtectedPath(snapshotPath)) throw new Error("快照必须落在只读底座");

  if (checkContentIdempotency(rawMaterial, knownHashes).shouldSkip) return null;

  const dedup = evaluateDedupGate({ title }, existingConcepts, { threshold: 0.58 });
  if (dedup.action === "MERGE_PATCH") return null;

  const result = await runPipeline(rawMaterial, {
    title,
    compileMode: "distill",
    modeling: "ipo",
    metadata: { defaultValues: { type: "concept" } },
  });
  return result.fullMarkdown;
}
```

`evaluateDedupGate` 依次做精确命中、别名命中、Fuse.js 词形模糊和字符级 N-gram 兜底。命中已有卡片时应改走 `compileMode: "patch"` 把新证据并入老卡，上面的示例为了短直接返回 `null`。`existingConcepts` 由扫描卡片目录得到，`getMarkdownFiles` 配合 `parseMarkdownSafely` 就能拼出来。

## 团队型知识库

团队知识库的素材来自飞书文档和定版方案，同一份文档会按修订号反复同步。这类素材最怕两件事，新版把旧版整篇冲掉，以及旧接口悄悄消失后没人知道要去哪查。主链路因此走增量合并。

先用 `parseSnapshotMeta` 与 `isVersionNewer` 确认修订号真的前进了，再交给 `runPipeline` 的 `patch` 模式。这个模式会把新素材与旧卡片按 MDAST 章节逐一对照，改动就地替换，删掉的章节注入 `> [!WARNING]` 废弃声明，旧卡片的 Frontmatter 原样保留。人工锁由 `gates.humanLock` 在流水线内拦下，命中时 `action` 会是 `SKIPPED_HUMAN_LOCK`。

```ts
import { parseSnapshotMeta, isVersionNewer } from "docskit/snapshot";
import { runPipeline } from "docskit/pipeline";
import { extractWikiOutboundLinks, indexBidirectionalGraph } from "docskit/graph";
import { formatAgentJITPrompt } from "docskit/jit";

export async function buildTeamCard(incoming: string, existing: string | undefined, title: string) {
  const snapshot = parseSnapshotMeta("_raw/feishu/鉴权方案-rev2.md");
  if (!isVersionNewer(snapshot.revision, 1)) return null;

  const result = await runPipeline(incoming, {
    title,
    compileMode: "patch",
    existingContent: existing,
    features: { deprecationNotice: true },
    gates: { humanLock: true },
  });

  const graph = indexBidirectionalGraph([
    { title, outboundLinks: extractWikiOutboundLinks(result.content) },
    { title: "上游依赖", outboundLinks: [] },
  ]);
  const jit = formatAgentJITPrompt(
    `修改 ${title}`,
    [{ title, summary: "方案主干", filePath: `wiki/${snapshot.category}/${title}.md` }],
    { mode: "compact" }
  );

  return { fullMarkdown: result.fullMarkdown, graph, prompt: jit.prompt, action: result.action };
}
```

`formatAgentJITPrompt` 只装指针和摘要，`mode: "detailed"` 才把正文契约塞进上下文。改代码时先给紧凑版，模型真要动到某个模块再让它自己读文件，省下大量 Token。`graph` 可以直接喂给 `lintVaultTopology` 查断链与孤立卡片。

## 两种配方的差异

底层函数是同一批，差别集中在三处配置和一个索引去向。

| 维度 | 个人型 | 团队型 |
| :--- | :--- | :--- |
| 素材形态 | 一次性的长文与碎片 | 按修订号反复同步的方案 |
| `compileMode` | `distill` | `patch` |
| 版本判定 | 一般不需要 | `parseSnapshotMeta` + `isVersionNewer` 必接 |
| 删除处理 | 不保留旧章节 | `features.deprecationNotice` 注入废弃声明 |
| 元数据来源 | 由 `metadata.defaultValues` 与模型给出 | 旧卡片 Frontmatter 作基底，新素材覆盖 |
| 下游消费者 | 写作与研报 | Coding Agent 的 JIT 上下文、静态门户 |

`runPipeline` 的第四阶段是元数据组装与 YAML 封装，索引构建不在这条流水线里。BM25 倒排、Late Chunking 章节向量和双链图谱要按业务时机单独调用 `BM25Engine`、`computeLateChunking` 与 `indexBidirectionalGraph`。

## 下游扩展环节怎么接

两个知识库在四阶段之外各加了自己的治理环节。TeamWiki 的 OKF v0.3 加了段落级来源锚点、声明句覆盖校验、责任链字段、冲突裁决与演化链，Ghost 加了 `title === stem` 身份不变量与可读标题规范化。这些字段与判定带业务语义，留在各项目自己的 Schema 与巡检命令里，通用引擎不写死。

接这些环节时可以直接消费的纯函数如下。

| 环节 | 可复用的 DocsKit 函数 | 业务层自己承担 |
| :--- | :--- | :--- |
| 底座素材登记 | `buildSnapshotPath`、`parseSnapshotMeta`、`cleanUrlKey`、`isProtectedPath`、`evaluateToolCallPathGuard` | 快照版本号、密级与版本冻结策略 |
| 证据段落回指 | `parseMarkdownSafely`、`extractSection`、`dropSection`、`appendUnderHeading`、`computeTextNgramSimilarity`、`calcRawContentSha256` | 锚点四元组的生成、指纹复算与失效判定 |
| 卡片契约扩展 | `createOKFMetadata`、`updateOKFMetadata`、`validateOKFMetadata`、`stringifyMarkdownSafely`、`localIsoDate` | 扩展字段的强契约、签字入口与复审清单 |
| 演化链与巡检 | `auditVaultLifecycle`、`analyzeCardLifecycle`、`lintVaultTopology`、`findHighSimilarityCardPairs` | 冲突台账、裁决命令与审计日志 |
| 素材排除登记 | `getMarkdownFiles`、`readMarkdownFile`、`sanitizeFileName`、`isTombstoneHit` | 排除清单、下线命令与复活巡检 |

这几类确定性函数已经收进通用引擎。`docskit/evidence` 提供段落切分、锚点构建与复算、覆盖校验、机械首句，`docskit/lint` 提供演化链审计与身份一致性巡检，`docskit/snapshot` 提供路径仲裁，`docskit/markdown` 与 `docskit/hash` 提供标题规范化与短哈希。生成与复算必须传入同一份规范化文本。字段契约、模型判定、台账与签字命令仍留在业务层，决策依据见 `openspec/changes/consolidate-evidence-governance/design.md`。

## 注入业务文案

引擎默认输出中性结构。要得到中文卡片模板、附件清单、JIT 提示词和废弃声明，从 `docskit/presets` 注入。

```ts
import { ZH_CN_DISTILL_OPTIONS, ZH_CN_NORMALIZE_TEXTS, ZH_CN_SECTION_TEXTS, ZH_CN_JIT_RENDERER } from "docskit/presets";

const result = await runPipeline(raw, {
  title,
  compileMode: "distill",
  texts: {
    distill: ZH_CN_DISTILL_OPTIONS,
    normalize: ZH_CN_NORMALIZE_TEXTS,
    section: ZH_CN_SECTION_TEXTS,
  },
});

const jit = formatAgentJITPrompt(query, matches, { render: ZH_CN_JIT_RENDERER });
```

不注入时 `distillMarkdownContent` 只输出标题、原文章节、表格与代码块，`evaluateDedupGate` 的 `reason` 返回 `exact_title_hit` 一类 code。策略数值集中在 `src/contracts/policy.ts`，要调阈值就在 options 里覆盖。

## 交付前自检

| 检查 | 命令或函数 | 期望 |
| :--- | :--- | :--- |
| 类型与构建 | `pnpm typecheck`、`pnpm build` | 0 error，ESM 与 DTS 均产出 |
| 配方与函数回归 | `pnpm test` | 全绿 |
| 断链与格式 | `lintVaultTopology` 或 `auditDirectoryVault` | `isHealthy: true` |
| 只读底座 | `isProtectedPath` | 所有 `_raw/` 路径返回 `true` |
| 元数据格式 | `validateOKFMetadata` | 每张卡片 `valid: true` |
| 生命周期 | `auditVaultLifecycle`、`analyzeCardLifecycle` | 过期卡片与重复卡片对有明确清单 |
| 导入路径 | 业务代码 `grep -rn 'from "docskit"' src/` | 零命中，根 barrel 只出现在脚本与工具入口 |
| 证据锚点 | `verifySourceRef` 复算同一份规范化文本 | 返回 true，改一个字返回 false |
| 中文预设 | 注入 `ZH_CN_DISTILL_OPTIONS` 后检查关键文案 | 卡片含中文模板，纯计算结果不变 |

通用字段契约与下游扩展边界见 `docs/OKF-v0.2-SPECIFICATION.md`，能力与四阶段分层见 `docs/CAPABILITIES.md`。
