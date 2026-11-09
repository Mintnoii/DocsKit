# Proposal: 引擎冷启动瘦身 · 惰性加载与子路径导入 (Lazy Engine Bootstrap)

- **Change ID**: `lazy-engine-bootstrap`
- **Status**: in-progress
- **Created**: 2026-11-10
- **Authors**: Technical Lead / Architect
- **素材源流**: TeamWiki 对照实验耗时分层实测（`TeamWiki/docs/eval/PERF-BREAKDOWN.md`）与 DocsKit 侧导入链分段打点

---

## 1. 立项动因

DocsKit 是 Ghost 与 TeamWiki 共用的通用引擎底座。实测发现，任何一次消费方启动都要为**用不到的模块**付出 1 秒以上的加载代价。

TeamWiki `pnpm context` 端到端耗时 1.6 到 2.1 秒。分层实测（单进程内分段打点，三次运行）：

| 段 | 耗时 |
| --- | --- |
| 模块加载（冷启动） | 1014 / 1064 / 1734 ms |
| 检索 + 云端 rerank | 294 / 305 / 329 ms |
| 检索 + 本地排序（rerank 关） | 19 / 20 / 31 ms |

**本地检索只要 19 到 31 毫秒**，冷启动是端到端延迟的大头。

### 1.1 加载成本归属

DocsKit 侧逐模块打点：

| 模块 | 耗时 |
| --- | --- |
| `docskit/ast` | 603 ms |
| `docskit/sense` | 215 ms |
| `docskit/snapshot` | 36 ms |
| `docskit/lint` | 8 ms |
| `docskit/jit` / `hash` / `graph` / `shared` / `pipeline` | 各 2 到 6 ms |
| `docskit` 根 barrel（子模块已缓存） | 24 ms |

`ast` 内部：`ast/distiller.ts` 485 ms、`ast/index.ts` 281 ms，其余三个子模块 0 ms。`distiller.ts` 顶部静态引入的 mdast 系包逐个计时：`mdast-util-from-markdown` 121 ms、`mdast-util-gfm` 100 ms、`micromark-extension-gfm` 34 ms、`unist-util-select` 32 ms。

`sense` 内部：`@xenova/transformers` 单独 import 294 到 348 ms，`sense/index` 总计 310 ms。根因是 `src/core/sense/late-chunking.ts` 第 1 行用了**顶层静态 import**，把整个 transformers 包拖进任何一次 `sense` 导入链。同目录的 `reranker.ts` 第 95 行用的却是动态 import，做法不一致。

### 1.2 消费方的实际需求

TeamWiki `src/sense/searcher.ts` 从 `docskit` 根 barrel 导入 `BM25Engine`、`rankDocumentsByNgramVector`、`executeHybridRankPipeline`、`locateTopSectionsWithLateChunking`、`parseMarkdownWithAST` 等符号。

但根 barrel 在 `src/index.ts` 里对全部九个核心模块做了 `export *` 静态再导出。ESM 静态再导出的求值发生在模块加载期，与消费方实际用到哪些符号无关。结果是**消费方只要碰 `docskit` 任意一个符号，就要把 mdast 工具链与 transformers 全部拉起来**。

更关键的是，TeamWiki 检索热路径里 `parseMarkdownWithAST` 只在 `enableLateChunking` 开启时调用（`searcher.ts` 第 162 行），`locateTopSectionsWithLateChunking` 同样受该开关控制。**纯检索路径根本不需要 AST 工具链与 ONNX 运行时**，但它们被静态绑定在导入链上，每次都照付。

### 1.3 消费方的绕行成本

子路径导入其实已经可用。`package.json` 的 `exports` 字段已声明 `./ast`、`./sense`、`./jit`、`./lint` 等九个子路径，`tsup.config.ts` 也已为它们配置了独立 entry，产物 `dist/ast/index.js`、`dist/sense/index.js` 等独立文件齐备。

但 DocsKit 的 `AGENTS.md` 与既有消费方代码惯例走的是根 barrel 导入，子路径虽在，未被实际采用。这是**契约已备而用法未收口**，不需要新增构建能力。

---

## 2. 目标方案

### 2.1 引擎侧：消除静态绑定

1. **`late-chunking.ts` 顶层静态 import 改动态 import**。transformers 只在真正要做 Late Chunking 时才加载。`env.localModelPath = SHARED_CACHE_DIR` 这行配置要一并搬进动态加载后的初始化路径，不能因为改成动态 import 而丢失共享缓存目录约定。
2. **`ast` 内部 mdast 依赖改为惰性求值**。`distiller.ts` 与 `normalize.ts` 顶部静态引入 `mdast-util-from-markdown` 等四个包，占了 `ast` 模块 603 ms 的绝大部分。改为函数内动态 import，让「不需要 AST 的调用方」不必付这笔钱。
3. **`okf-meta.ts` 对 `distiller.ts` 的依赖降级**。该文件第 6 行静态引入 `distillMarkdownContent` 与 `parseMarkdownWithAST`，使 `okf-meta` 单独导入也会拖起整条 mdast 链。
4. **`okf-meta.ts` 移出 `ast` 目录**。OKF 元数据 Schema 契约与 MDAST 解析、内容归一、文件扫描是三件不相干的事。`@sinclair/typebox` 单独 import 实测 134 ms，占 `docskit/ast` 子路径 191 到 222 ms 加载成本的绝大部分。移入 `src/core/okf/` 后 `docskit/ast` 降到 9 ms。

### 2.2 消费方侧：改走子路径导入

TeamWiki 与 Ghost 的库消费文件从 `docskit` 根 barrel 改为按需子路径导入。根 barrel 仅适用于脚本与工具入口。

### 2.3 契约固化

- DocsKit `AGENTS.md` 增补「消费方按需子路径导入」与「重型依赖不得顶层静态引入」两条铁律，防止后续回退。
- 子路径导入下每个模块的导出契约保持不变，禁止顺手改签名。

---

## 3. 边界与不做

- **不改任何运行时行为**。加载时机变，函数签名、返回结构、语义判定全部保持。Late Chunking 的输出结果必须逐字一致。
- **不删依赖**。`@xenova/transformers` 与 mdast 系包仍在 `package.json` 里，只是加载时机后移。
- **不做 bundle 拆分重构**。`tsup.config.ts` 的 `splitting: false` 保持不变，改的是源码层的 import 形态。
- **不引入新依赖**。
- **不改向量模型、rerank 后端、检索算法与融合参数**。
- **不追求「零加载成本」**。AST 与 Late Chunking 真被调用时仍要加载，目标是让用不到的路径不再付钱。

---

## 4. 验收标准

| 编号 | 判据 | 命令或方法 |
| --- | --- | --- |
| A1 | `pnpm test` 34/34 通过，不新增失败 | `pnpm test` |
| A2 | `pnpm typecheck` 0 错 | `pnpm typecheck` |
| A3 | `pnpm build` 成功 | `pnpm build` |
| A4 | 零 `as any` / `@ts-ignore` / `@ts-expect-error` | `grep -rn "as any\|@ts-ignore\|@ts-expect-error" src/` |
| A5 | `src/` 内不残留 transformers 顶层静态 import | `grep -rn "^import.*@xenova/transformers" src/` 零命中 |
| A6 | `src/` 内不残留 mdast 系包顶层静态 import | `grep -rn "^import.*mdast-util\|^import.*micromark\|^import.*unist-util" src/` 零命中 |
| A7 | 纯检索路径的引擎加载成本显著下降 | 复跑分层打点，`docskit/ast` 与 `docskit/sense` 的独立加载耗时各降 50% 以上 |
| A8 | Late Chunking 输出逐字不变 | 现有 Late Chunking 相关单测全绿 |
| A9 | 消费方仍能用根 barrel 导入 | 既有消费方代码零改动仍可编译运行 |

---

## 5. 风险与回退

| 风险 | 处置 |
| --- | --- |
| 动态 import 后首次调用有额外延迟 | 延迟只在真正需要 AST / Late Chunking 时发生，摊到单次调用上可接受 |
| `env.localModelPath` 搬移时丢失共享缓存目录约定 | 该行必须随动态 import 一起搬，验收时人工核对 |
| 消费方改子路径导入后漏掉某个符号 | 以 typecheck 报错为准，逐个补齐，不加类型断言绕过 |
| 加载时机变化影响竞态 | 动态 import 本身是幂等的，模块缓存由 ESM 保证，不引入共享可变状态 |

回退方式：本变更为独立提交，`git revert` 即可回到原状，不涉及数据迁移。

---

## 6. 落地结果（2026-11-10）

### 6.1 已闭环

五个提交全部落地，跨 DocsKit、TeamWiki、Ghost 三仓：

| 提交 | 仓库 | 内容 |
| :--- | :--- | :--- |
| `3422876` | DocsKit | 四处重型依赖改惰性加载：late-chunking 的 transformers、distiller/normalize/section-patcher 的 mdast |
| `1dacbf2` | DocsKit | okf-meta 移出 ast 目录，解除 typebox 绑定 |
| `88aabd6` | TeamWiki | 18 个文件的 docskit 导入改子路径 |
| `c1df65cb` | Ghost | 8 个文件的 docskit 导入改子路径 |
| `974d531` | DocsKit | AGENTS.md 固化两条新契约 |

### 6.2 加载成本实测

各入口独立进程加载耗时：

| 入口 | 改前 | 改后 | 降幅 |
| :--- | :--- | :--- | :--- |
| 根 barrel | 411 ms | 190 ms | 54% |
| `docskit/sense` | 112 ms | 13 ms | 88% |
| `docskit/ast` | 435 ms | 9 ms | 98% |
| 子路径组合（sense+graph+jit+ast） | 178 ms | 77 ms | 56% |

单模块：`docskit/shared` 2 ms、`docskit/graph` 1 ms、`docskit/patch` 9 ms、`docskit/ast` 9 ms、`docskit/hash` 4 ms、`docskit/sense` 12 ms、`docskit/okf` 3 ms、`docskit/jit` 53 ms、`docskit/lint` 97 ms。

TeamWiki `pnpm context` 端到端：2024 到 2293 ms 降至 840 到 923 ms。

### 6.3 关键实现决策

mdast 系包走 `createRequire(import.meta.url)` 惰性单例，保持 `parseMarkdownWithAST`、`distillMarkdownContent`、`normalizeMarkdownContent`、`parseSections` 四个导出函数的**同步契约**不变。走动态 import 会把它们变成 async，污染 pipeline、patch 与全部外部消费方的调用链，得不偿失。

`buildOKFConceptCard` 因需等待 distiller 模块加载改为 async，全机无消费方调用该函数，现有代码不受影响。

### 6.4 验收结果

| 项 | 结果 |
| :--- | :--- |
| DocsKit `pnpm test` | 34/34 通过 |
| DocsKit `pnpm typecheck` | 0 错 |
| DocsKit `pnpm build` | 成功，`dist/okf/` 产物齐备 |
| 根 barrel 导出面 | 39/39 符号完整，`validateOKFMetadata` 等 OKF 符号仍可用 |
| TeamWiki `tsc --noEmit` | 0 错 |
| TeamWiki `pnpm lint` | 断链 0、Schema 0、身份 0、套话 0，Rerank 生效 |
| TeamWiki 六个 verify 脚本 | identity 10/10、metadata 10/10、runtime 5/5、topology 6/6、paths 5/5、relevance 4/4 |
| TeamWiki 检索输出 | 改造前后逐字一致 |
| Ghost `pnpm typecheck` | 与基线一致（仅 builder.ts 一条既有 yaml 缺失错误） |
| Ghost `pnpm test` | 176 项中 159 通过 17 失败，与基线完全一致 |

### 6.5 派发返工记录

三轮 agy 派发中有一轮返工：okf-meta 迁移时漏了 `src/core/lint/topology.ts` 的引用点，导致 typecheck 与 build 失败。原因是 agy 未做全仓引用扫描，只改了 Target 清单内的文件。补派一次修完。这条印证了「agy 自报通过不可信，Pi 必须逐条回验」。

另有一处 agy 报告失实：把 `@sinclair/typebox` 说成在 devDependencies，实际在 dependencies。代码未受影响，但说明自报文本本身也要核对。
