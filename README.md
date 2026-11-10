# DocsKit

[![npm](https://img.shields.io/badge/npm-docskit-cb3837)](https://www.npmjs.com/package/docskit)
[![license](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![types](https://img.shields.io/badge/types-TypeScript-3178C6)](./package.json)

把编译型知识库的通用计算做成纯 TypeScript 函数库。

外部长文、团队方案、随手记的碎片进入知识库前，都要走清洗、幂等判定、章节对账、双链索引这几步。每个知识库各写一遍，代码很快分叉：行正则把代码块里的注释当成标题，Frontmatter 一变就把没改动的正文判成新素材，删掉的接口悄悄消失后没人知道要去哪查。DocsKit 把这些计算收成无状态纯函数，业务层只决定素材从哪来、卡片往哪放、检索结果怎么交给模型。

## 环境要求

- Node.js >= 20
- pnpm（包管理器统一用 pnpm）
- 安装时必须允许依赖的 install scripts：`@xenova/transformers` 依赖的 `sharp` 需要下载 libvips 原生二进制，跳过脚本会导致测试直接报 `Cannot find module '../build/Release/sharp-win32-x64.node'`
- `docskit/sense` 的 Late Chunking 使用本地 ONNX 推理，首次运行会把 `Xenova/bge-small-zh-v1.5` 缓存到 `~/.cache/onnx-models`，需要一次网络访问

## 从源码开始

```bash
pnpm install
pnpm build
```

产物在 `dist/`，ESM 与 `.d.ts` 同时产出。项目只发 ESM，包管理器统一用 pnpm。发布到 npm 后可改为 `pnpm add docskit`。

示例按发布包的子路径写。源码按层放在 `src/foundation/` 与 `src/layers/` 下，物理路径与子路径的映射见 `AGENTS.md` 目录结构，`package.json exports` 的十四个子路径保持按能力命名不变。`tests/vault-recipes.test.ts` 属于一次性脚本入口，从 `../src/index` 根 barrel 引入，按 `AGENTS.md` 属豁免范围。

## 快速开始

```ts
import { buildSnapshotPath } from "docskit/snapshot";
import { isProtectedPath } from "docskit/lint";
import { checkContentIdempotency } from "docskit/hash";
import { runPipeline } from "docskit/pipeline";

const raw = `## 背景
首屏渲染慢。

## 方案
引入流式渲染。
`;

// 原始素材落到只读底座，位置稳定且不允许回写
const snapshot = buildSnapshotPath({ category: "articles", title: "流式渲染", revision: 1 });
console.log(snapshot);              // _raw/articles/流式渲染-rev1.md
console.log(isProtectedPath(snapshot)); // true

// 纯正文指纹没变就短路，省掉一次模型调用
const knownHashes = new Set<string>();
const gate = checkContentIdempotency(raw, knownHashes);
if (!gate.shouldSkip) {
  const result = await runPipeline(raw, {
    title: "流式渲染",
    compileMode: "distill",
    modeling: "ipo",
  });
  console.log(result.action);       // DISTILLED
  console.log(result.fullMarkdown); // 带 YAML Frontmatter 的完整卡片
}
```

`runPipeline` 还支持 `patch`（按 MDAST 章节增量合并，旧卡片元数据原样保留）与 `passThrough`（清洗后直通）。完整配方见 `docs/BUILDING-VAULTS.md`，文中两段示例在 `tests/vault-recipes.test.ts` 有对应断言。

## 能力一览

十四个能力子路径与 `package.json exports`、`tsup.config.ts` entry 一一对账，外加一个 `./package.json` 元入口。每个函数只有一个权威子路径，能力模块不再重导出别处的符号。

| 子路径 | 关键函数 | 职责 |
| :--- | :--- | :--- |
| `docskit/markdown` | `parseMarkdownSafely`、`stringifyMarkdownSafely`、`renderMarkdownTable`、`outdent`、`normalizeReadableTitle`、`collapseWhitespace`、`splitLines`、`stripMarkdownExtension` | 全库唯一的 Frontmatter、排版与章节函数底座 |
| `docskit/numeric` | `cosineSimilarityVectors`、`computeTextNgramSimilarity`、`computeBigramDiceSimilarity`、`normalizeVector` | 全库唯一的字符相似度与向量数值实现 |
| `docskit/ast` | `normalizeMarkdownContent`、`parseMarkdownWithAST`、`distillMarkdownContent`、`getMarkdownFiles` | 语法树解析、内容清洗、核心提炼、文件扫描 |
| `docskit/okf` | `createOKFMetadata`、`validateOKFMetadata`、`buildOKFConceptCard`、`OKFFrontmatterSchema` | 卡片 Frontmatter 契约、校验、生成与附件组装 |
| `docskit/patch` | `diffDocumentSections`、`applySectionPatch`、`evaluateDedupGate`、`findMostSimilarVector` | 章节差量对账、废弃声明注入、四级级联去重 |
| `docskit/snapshot` | `buildSnapshotPath`、`parseSnapshotMeta`、`isVersionNewer`、`sanitizeFileName`、`isTombstoneHit`、`resolveCardPathCollision` | 快照路径、版本对账、文件名清洗、低质素材特征防重 |
| `docskit/sense` | `BM25Engine`、`computeLateChunking`、`rrfFuseScores`、`executeHybridRankPipeline`、`createReranker`、`rankDocumentsByNgramVector` | 词项精确检索、章节级向量、多路召回融合与重排 |
| `docskit/graph` | `extractWikilinks`、`extractWikiOutboundLinks`、`indexBidirectionalGraph`、`normalizeWikilinkTarget`、`stripAnchor`、`stripAlias` | 双链提取、目标归一与双向 1-Hop 拓扑图 |
| `docskit/lint` | `lintVaultTopology`、`auditDirectoryVault`、`isProtectedPath`、`evaluateToolCallPathGuard`、`analyzeCardLifecycle`、`findHighSimilarityCardPairs`、`auditSupersedeChain`、`checkTitleStemConsistency` | 断链与 Schema 巡检、只读底座守护、过期卡片与重复卡片排查 |
| `docskit/hash` | `computeMarkdownBodyHash`、`calcRawContentSha256`、`checkContentIdempotency`、`computeShortHash`、`computeSha256Hex` | 纯正文指纹、素材哈希与 0-Token 幂等短路 |
| `docskit/evidence` | `splitAnchorableParagraphs`、`buildSourceRefs`、`verifySourceRef`、`checkClaimCoverage`、`mechanicalClaim` | 段落级证据锚点、确定性选段与指纹复算、声明句覆盖校验 |
| `docskit/presets` | `ZH_CN_DISTILL_OPTIONS`、`ZH_CN_NORMALIZE_TEXTS`、`ZH_CN_JIT_RENDERER`、`ZH_CN_SECTION_TEXTS`、`ZH_CN_LABELS` | 五个聚合入口，卡片模板、附件清单、提示词和废弃声明一次注入 |
| `docskit/jit` | `formatAgentJITPrompt` | 面向 Coding Agent 的渐进式上下文装配 |
| `docskit/pipeline` | `runPipeline` | 清洗、门禁、编译、元数据组装四阶段编排 |

## 两种知识库怎么搭

个人知识库的素材多为一次性长文与碎片，主链路走提炼，概念之间靠去重门禁防止同义碎片化。团队知识库的方案按修订号反复同步，主链路走增量合并，删掉的接口要留在卡片里并打上废弃声明，人工拍板的卡片不许被自动覆盖。

两条链路用的是同一批函数，差别集中在 `compileMode`、版本判定、删除处理与元数据来源。`docs/BUILDING-VAULTS.md` 给出两份完整可运行的配方、差异对照表和交付前自检清单。

## 下游契约怎么扩

`docskit/okf` 提供 OKF v0.2 的通用字段基线，下游在这份基线上扩自己的字段，引擎不写死业务治理语义。TeamWiki 已扩到 OKF v0.3，多了段落级来源锚点、声明句、责任链与演化链字段；Ghost 另加 `title === stem` 的身份不变量。这些扩展由各项目自己的 Schema 与巡检命令承担，边界与字段清单见 `docs/OKF-v0.2-SPECIFICATION.md` 末节。

五类确定性计算已经收进通用引擎。证据链在 `docskit/evidence`，演化链与身份巡检在 `docskit/lint`，路径仲裁在 `docskit/snapshot`，标题规范化在 `docskit/markdown`，短哈希在 `docskit/hash`。字段形状、模型判定、台账与签字命令仍留在业务层，配方接法见 `docs/BUILDING-VAULTS.md`。

## 引擎纯度与业务预设

`src/contracts/`、`src/foundation/` 与 `src/layers/` 下的方法体不写业务语言。渲染类函数默认输出只由输入数据组成的结构骨架，诊断类返回值默认给结构化 code，阈值与权重集中在 `src/contracts/policy.ts` 的冻结表。原中文卡片模板、附件附录、JIT 提示词与废弃声明全部收在 `docskit/presets`，调用方按需注入。

```ts
import { distillMarkdownContent } from "docskit/ast";
import { ZH_CN_DISTILL_OPTIONS } from "docskit/presets";
import { runPipeline } from "docskit/pipeline";

const card = distillMarkdownContent(raw, title, ZH_CN_DISTILL_OPTIONS);
const result = await runPipeline(raw, {
  title,
  compileMode: "distill",
  texts: { distill: ZH_CN_DISTILL_OPTIONS },
});
```

不注入时输出是中性结构，注入后得到这套中文模板，和旧版快照不再逐字相同。纯计算类函数（哈希、相似度、段落锚点、路径仲裁、演化链判定）无论是否注入，结果都不变。策略数值可以逐项覆盖，默认值见 `src/contracts/policy.ts`。

## 设计约束

这些约束约束的是内核本身，业务层可以自由组合。

- 内核不写死任何具体工程名或目录名，需要过滤时由调用方通过参数传入。
- Frontmatter 读写、表格排版、字符相似度各只有一份实现，业务模块只消费不重写。
- `src/contracts/`、`src/foundation/` 与 `src/layers/` 全部是无状态纯函数，可单独 import；`src/layers/compile/pipeline/` 才负责按配置编排。
- 元数据里的评估字段由上游模型显式给定，代码不写死默认值。
- 公开子路径与构建 entry 一一对账，新增函数只需在所属模块导出一次。
- 消费方按 `docskit/<子路径>` 导入，根 barrel 只留给一次性脚本与工具入口，每个符号只有一个权威子路径。
- 包标记 `sideEffects: false`，`exports` 显式带 `./package.json`，打包器可安全剪枝。
- `src/contracts/`、`src/foundation/` 与 `src/layers/` 零业务中文，模板与诊断句子走 `docskit/presets` 注入。
- 策略数值只在 `contracts/policy.ts` 声明，方法体不写字面量默认值。

## 开发

```bash
pnpm typecheck   # TypeScript 严格模式检查
pnpm test        # node:test，含配方与回归用例
pnpm build       # tsup 产出 ESM 与声明文件
```

改动先在 `openspec/changes/` 留方案并跑通测试，再合入内核。贡献规范与目录契约见 `AGENTS.md`。

## 文档

- [`docs/CAPABILITIES.md`](docs/CAPABILITIES.md) 能力与四阶段分层
- [`docs/BUILDING-VAULTS.md`](docs/BUILDING-VAULTS.md) 用 DocsKit 搭建知识库的可运行配方
- [`docs/OKF-v0.2-SPECIFICATION.md`](docs/OKF-v0.2-SPECIFICATION.md) 通用卡片契约与下游扩展边界
- [`AGENTS.md`](AGENTS.md) 跨 Agent 工程契约

## 许可证

[MIT](./LICENSE)
