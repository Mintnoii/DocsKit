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

在仓库内试跑下面的示例时，把 `from "docskit"` 换成 `from "./src/index.ts"`。`tests/vault-recipes.test.ts` 就是这么引用源码的。

## 快速开始

```ts
import {
  buildSnapshotPath,
  isProtectedPath,
  checkContentIdempotency,
  runPipeline,
} from "docskit";

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

| 子路径 | 关键函数 | 职责 |
| :--- | :--- | :--- |
| `docskit/shared` | `parseMarkdownSafely`、`renderMarkdownTable`、`computeTextNgramSimilarity` | 全库唯一的 Frontmatter、排版与文本相似度底座 |
| `docskit/ast` | `normalizeMarkdownContent`、`parseMarkdownWithAST`、`createOKFMetadata`、`getMarkdownFiles` | 语法树清洗、章节切分、OKF v0.2 元数据、极速文件扫描 |
| `docskit/patch` | `diffDocumentSections`、`applySectionPatch`、`evaluateDedupGate` | 章节差量对账、废弃声明注入、四级级联去重 |
| `docskit/snapshot` | `buildSnapshotPath`、`isVersionNewer`、`isTombstoneHit` | 快照路径、版本对账、低质素材特征防重 |
| `docskit/sense` | `BM25Engine`、`computeLateChunking`、`rrfFuseScores`、`executeHybridRankPipeline` | 词项精确检索、章节级向量、多路召回融合与重排 |
| `docskit/graph` | `extractWikilinks`、`indexBidirectionalGraph` | 双链提取与双向 1-Hop 拓扑图 |
| `docskit/lint` | `lintVaultTopology`、`auditDirectoryVault`、`isProtectedPath`、`analyzeCardLifecycle` | 断链与 Schema 巡检、只读底座守护、过期卡片与重复卡片排查 |
| `docskit/hash` | `computeMarkdownBodyHash`、`checkContentIdempotency` | 剥离 Frontmatter 的正文指纹与 0-Token 幂等短路 |
| `docskit/jit` | `formatAgentJITPrompt` | 面向 Coding Agent 的渐进式上下文装配 |
| `docskit/pipeline` | `runPipeline` | 清洗、门禁、编译、元数据组装四阶段编排 |

## 两种知识库怎么搭

个人知识库的素材多为一次性长文与碎片，主链路走提炼，概念之间靠去重门禁防止同义碎片化。团队知识库的方案按修订号反复同步，主链路走增量合并，删掉的接口要留在卡片里并打上废弃声明，人工拍板的卡片不许被自动覆盖。

两条链路用的是同一批函数，差别集中在 `compileMode`、版本判定、删除处理与元数据来源。`docs/BUILDING-VAULTS.md` 给出两份完整可运行的配方、差异对照表和交付前自检清单。

## 设计约束

这些约束约束的是内核本身，业务层可以自由组合。

- 内核不写死任何具体工程名或目录名，需要过滤时由调用方通过参数传入。
- Frontmatter 读写、表格排版、字符相似度各只有一份实现，业务模块只消费不重写。
- `src/core/` 全部是无状态纯函数，可单独 import；`src/pipeline/` 才负责按配置编排。
- 元数据里的评估字段由上游模型显式给定，代码不写死默认值。
- 公开子路径与构建 entry 一一对账，新增函数只需在所属模块导出一次。

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
- [`docs/OKF-v0.2-SPECIFICATION.md`](docs/OKF-v0.2-SPECIFICATION.md) 卡片元数据与正文契约
- [`AGENTS.md`](AGENTS.md) 跨 Agent 工程契约

## 许可证

[MIT](./LICENSE)
