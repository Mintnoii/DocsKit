# DocsKit 声明式审美与代码组织全量重构

## Why

项目自身沉淀了工业级函数（`parseMarkdownSafely` / `stringifyMarkdownSafely` / `renderMarkdownTable` / `outdent` / `pathe` / `picomatch` / `radash`），但 21 个源码文件里仍有 190 行过程式胶水命中，属于「一边装库一边手搓」。同时算法与底座重复实现、文档声明与物理结构脱节，已影响下游 Ghost / TeamWiki 的复用可信度。

### 实测基线（2026-11-09，重构前）

- `pnpm typecheck` 通过；`pnpm test` 18/18 通过；`pnpm build` 通过。
- 工作树已有 446+/143- 未提交改动与 3 个未跟踪新文件，作为本次重构基线原样保留。
- 源码 28 个 TS 文件、4503 行；裸用 `gray-matter` 8 处、手写 `replaceAll("\\","/")` 10 处、原生 `try/catch` 6 处、`any` 7 处。

### 排查结论

**A. 代码组织方式**

| 问题 | 证据 |
| :--- | :--- |
| 公共 Frontmatter 底座未收敛 | `parseMarkdownSafely` 只定义在 `markdown-utils.ts`，另有 8 个文件裸调 `matter()` |
| `normalizeLf` 重复定义 | `ast/markdown-utils.ts` 与 `hash/index.ts` 两份完全相同的实现 |
| 字符相似度算法 4 套轮子 | `sense/ngram.ts`、`patch/dedup.ts::computeNgramSimilarity`、`lint/card-lifecycle.ts::computeBigramDiceSimilarity`、`sense/late-chunking.ts` 私有 `normalizeVector`/`cosineSimilarityNormalized` |
| 表格与长文模板手搓 | `normalize.ts::generateAttachmentsAppendix`、`distiller.ts` 通篇 `distilled +=` 与手写 `\| :--- \|` |
| 门面双份维护 | `src/index.ts` 177 行手工 re-export 清单，与 `export * as X` 命名空间重复 |
| 文档与实现脱节 | `AGENTS.md` 声明 `src/ast/` 等平铺结构，实际为 `src/core/ast/`，且漏写 `hash/` 与 `pipeline/`；`package.json exports` 缺 `./graph`、`./jit` |
| 无用依赖 | `@modelcontextprotocol/sdk` 零引用；`compute-cosine-similarity` 仅服务 `dedup.ts` 一个可被复用替代的函数 |

**B. 编码审美**

显式 `for` + `push` + 可变游标遍布 21 个文件；`Array.isArray` / `typeof === "string"` / `.startsWith` 连环防御八股；`reranker.ts` 与 `tombstone.ts` 原生 `try/catch` 含空吞 `catch {}`；`okf-meta.ts` 五分支 `switch` 重复拼装 `rawMeta`；`jit/index.ts` 在 `map` 回调里 `push` 外部数组；`sense/index.ts::rrfFuseScores` 双形态重载靠 `Array.isArray` 分流。

**C. 重构即审判（逻辑去伪存真）**

1. `applySectionPatch` 用 `matter(oldCardRaw)` 取出 frontmatter、写入 `deprecation_warning`，最终只返回 `finalBody`，frontmatter 全程丢弃；`runner.ts` 随后另行 `matter.stringify` 重新封装，废弃声明永远不落盘。
2. `section-patcher.ts::parseSections` 用行正则 `^(#{2,3})\s+(.+)$` 切章节，会把代码块里的 `## 注释` 误判成标题，与注释宣称的「AST 差量对账」不符；项目已有 MDAST 解析能力。
3. `okf-meta.ts` 硬编码 `status = "evergreen"`、`confidence = "high"`，`lint/index.ts` 硬编码 `status || "evergreen"`、`updated || "2026-01-01"`。违反 MIND.md「严禁在代码中写死大模型评估字段 / 伪造元数据」铁律。
4. `graph/index.ts::indexBidirectionalGraph` 直接 mutate 调用方传入的 card 对象（`card.backlinks = []` / `push`），与「不可变纯函数」声明相悖。
5. `hash/index.ts::checkContentIdempotency` 同时返回语义完全相同的 `shouldSkip` 与 `skip`。
6. `distiller.ts` 对 `fm.title` 直接 `.replace()`，YAML 标量非字符串时运行时崩溃。
7. `dedup.ts::computeNgramSimilarity`（1/2-gram 等权 + 外部库）与 `sense/ngram.ts::computeTextNgramSimilarity`（2-gram 权重 2）同名概念两套数值结果。
8. `isVersionNewer` 在 SemVer 无法解析时兜底返回 `incoming !== current`，把「不相等」直接当成「更新」，旧版本回滚也会被判为递增。
9. `lint/index.ts` 与 `lint/vault-auditor.ts` 互相 import 形成循环依赖，模块职责混在一个文件里。

## What Changes

### 1. 新增 `src/core/shared/` 两个纯函数底座

- `markdown.ts`：物理迁入 `ast/markdown-utils.ts` 全部能力，成为全项目**唯一** Frontmatter / 文本排版入口。`ast/index.ts` 从 shared 重新导出，保证 `docskit/ast` 与顶层扁平 API 零破坏。
- `numeric.ts`：收敛 N-gram 词表、稀疏/稠密余弦、L2 归一化、Bigram Dice 为单一实现。`sense/ngram.ts` 改为同源 re-export，`patch/dedup.ts` 与 `lint/card-lifecycle.ts` 直接消费，`late-chunking.ts` 复用归一化与点积。

> 拒绝为路径单独建 `path.ts` 马甲：`pathe.normalize` 已直接产出 POSIX 路径，全链路直调原生库即可。

### 2. 逐模块声明式换装（保持全部公开 API 名称与签名）

裸 `matter()` 全量换 `parseMarkdownSafely`；`replaceAll("\\","/")` 全量换 `pathe.normalize`；`for + push` 换 `radash` 集合变换（`sift` / `unique` / `group` / `max` / `alphabetical`）；原生 `try/catch` 换 `radash.tryit`；`startsWith` 路由换 `picomatch`；长文与表格换 `outdent` + `renderMarkdownTable`；`any` 换具体类型或 `unknown` 加类型守卫；`switch` 重复拼装换字典查表 + 公共基底展开。

### 3. 修掉上述 7 项逻辑缺陷

`applySectionPatch` 返回完整带 frontmatter 的 Markdown 并同步调整 `runner.ts` 组装顺序；`parseSections` 走 MDAST；元数据默认值改为由调用方显式给定、缺省不写入；图谱索引改为返回新对象；幂等结果双字段保留兼容但由单一内部值派生；标题清洗加 `radash.isString` 源头治理；N-gram 相似度全库归一。

### 4. 组织方式收口（不做物理搬运）

`src/core/` 层级保留，理由：当前工作树有未提交基线，大规模文件移动会把 diff 放大成删除加新增并提高合并风险，且目录层级本身不产生信息增量。改由 `AGENTS.md` 更正为真实结构、补齐 `hash/` 与 `pipeline/`；`package.json` 补 `./graph`、`./jit` 子路径；`tsup.config.ts` entry 与 exports 一一对账；`src/index.ts` 177 行手工清单改为 `export *` barrel + 保留命名空间导出；移除两个无引用依赖。

### 5. 两轮主动深挖

第一轮消灭显式过程式胶水与重复底座；第二轮拿放大镜扫残留 `startsWith` / `Array.isArray` / `typeof ===` / 嵌套三元 / 马甲函数 / 硬编码字段，并复核每个模块是否真的消费了已引入的工具库。

## Non-goals

- 不改动任何公开 API 名称、函数签名与返回结构（下游 Ghost / TeamWiki 零感知）。
- 不物理移动 `src/core/` 目录、不改业务建模语义（OKF 五种卡片形态、三种建模范式、编译流水线四阶段）。
- 不擅自执行 `git commit` / `git push`；未提交的既有基线改动原样保留。

## Acceptance

- `pnpm typecheck` 0 error；`pnpm test` 18/18 通过并补充针对 `applySectionPatch` frontmatter 丢失与 MDAST 章节切分的回归用例；`pnpm build` 成功。
- 全库 `from "gray-matter"` 仅剩 `shared/markdown.ts` 一处；`replaceAll("\\","/")`、原生 `try/catch`、空 `catch {}`、`: any` 零命中。
- 字符相似度算法仅 `shared/numeric.ts` 一份实现；`compute-cosine-similarity` 与 `@modelcontextprotocol/sdk` 从依赖移除。
- `AGENTS.md` 目录树与磁盘真实结构一致；`exports` 与 `tsup` entry 完全对账。

## 实测结果（2026-11-09 收工）

- `pnpm typecheck` 0 error；`pnpm test` 24/24 通过（原 18 项 + 6 项重构回归）；`pnpm build` ESM 与 DTS 均成功。
- 公开 API 契约 87 个值导出符号零缺失，运行时模块共导出 103 项（新增 shared 函数）。
- 全库 `from "gray-matter"` 仅 `shared/markdown.ts` 一处；原生 `try/catch`、`: any`、`replaceAll("\\\\", "/")`、显式 `for` 循环与 `.push()` 均零命中；`Array.isArray` 与 `typeof === "string"` 零命中，残留 `startsWith` 仅 2 处正当用途（Markdown 标题语法判定、业务层参数化前缀过滤）。
- 模块内 `from "./index"` 循环依赖零命中；10 个 `exports` 子路径与 10 个 tsup entry 完全对账。
- 新增 `shared/markdown.ts`、`shared/numeric.ts`、`lint/topology.ts`、`sense/rrf.ts` 四个单一职责模块；删除 `ast/markdown-utils.ts`；移除 `@modelcontextprotocol/sdk` 与 `compute-cosine-similarity` 两个依赖。
- 未执行 `git commit` / `git push`；既有 446+/143- 未提交基线改动全部纳入重构范围并原样保留其业务意图。

## 后续收口 去黑话治理

按 `docs/ghost-teamwiki-distinction-dialogue.md` 既有的「去黑话行动留档」判例，把文学与生物学隐喻从源码注释、输出文案和文档里清掉，统一换成工程人话。

| 原词 | 替换 |
| :--- | :--- |
| 退火 / 新陈代谢 | 过期卡片清理 / 重复卡片排查 |
| 梦境循环 | 过期文档定期提醒 |
| 因果（摘要 / 约束 / 链 / 脉络） | 核心定义 / 架构约束 / 上下文 / 决策依据 |
| 透镜 / 炼化 / 常青 / 布道者 | 检索上下文 / 编译 / 长期有效 / 实践者 |
| 算子 / 原语 | 纯函数 / 函数（导出的是无状态纯函数，没有数学算子的约束） |

`lint/metabolism.ts` 更名 `lint/card-lifecycle.ts`；`analyzeVaultMetabolism` 主名改 `analyzeCardLifecycle`，`MetabolismCardItem` / `StaleMetabolismCandidate` / `MetabolismAnalysisResult` 三个类型改平实名。四个旧名以 `@deprecated` 兼容别名保留，下游 Ghost / TeamWiki 迁移完成后可移除，本次公开 API 仍零缺失。历史对话留档里作为「被废弃词」出现的条目按取证原则原样保留。

2026-11-09 追加术语拔高治理。全库 25 个文件约 70 处「算子」，其中 49 处在源码、测试、现行规范文档与活动提案中，统一换成「纯函数」「函数」；README 定位句改「把编译型知识库的通用计算做成纯 TypeScript 函数库」，`CAPABILITIES.md` 章节标题改「纯函数底座」，生成的 IPO 卡片文案与测试断言同步改「IPO 机制模型」。剩余 17 处在已结案 OpenSpec 提案与 `ghost-teamwiki-distinction-dialogue.md` 思辨留档里，按取证原则保留当时原话。`AGENTS.md` 第 5 节新增第 7 条术语平实统一铁律。

## 文档与开源收口

项目要开源，文档层补齐三件事。

1. **新增 `docs/BUILDING-VAULTS.md`**：此前四份文档共 365 行，都停在「有什么」和「为什么」，没有一份讲怎么从函数搭出知识库。新文档给公共起手式、个人型与团队型两份完整配方、差异对照表、交付前自检清单。两份配方在 `tests/vault-recipes.test.ts` 有对应实现与断言，`pnpm test` 实际执行，杜绝示例跑不起来。
2. **对账既有文档**：`docs/CAPABILITIES.md` 里 `gates.pathGuard`、`dedupThreshold` 两个配置项在 `PipelineOptions` 中并不存在，`deprecationNotice` 实际在 `features` 下，第四阶段被画成索引构建而 `runPipeline` 第四阶段是元数据组装。四处全部按源码修正，并说明索引由下游在流水线之外构建。`AGENTS.md` 目录树把 `shared/` 错挂在 `src/` 顶层（实际在 `src/core/shared/`），一并更正并补齐 docs 与 README 指针。`docs/ghost-teamwiki-distinction-dialogue.md` 末尾的 `file:///C:/Users/...` 私有绝对路径改相对链接。
3. **新增 `README.md`**：面向外部读者，脱敏内部工程代号与私有路径，按一句话定位、从源码开始、快速开始、能力一览、两种知识库、设计约束、开发、文档、许可证组织。`package.json` 补 `files: ["dist"]` 防止内部治理文件被打包发布，`description` 去掉内部系统代号，补 `keywords`。

**待拍板**：LICENSE 文件与 `license` / `repository` / `engines` 字段、git remote 配置。这些涉及许可证选型与对外身份，Agent 不擅自决定。

验证：`pnpm typecheck` 0 error，`pnpm test` 28/28（新增 4 项配方测试），`pnpm build` 双成功。

## 项目定名 DocsKit

qing 于 2026-11-09 拍板把 `Cyberbrain` 改为 `DocsKit`，npm 包名 `docskit`。判据是原名 Cyberbrain（電脳）指向脑与意识，跟「一组用来构建知识库的工具函数」的实际定位不符；新名用 `Docs` 复数点明处理对象是一批文档，`Kit` 点明是可按需取用的一组工具，不限定清洗、编译、检索中的任一动作。命名先后试过作品致敬名、短专名、单点机制名，均未按 qing 的判据通过，最终回到实测导出清单后收敛到全链路工具集合这一层。

落地：现行文件 68 处旧名替换（`package.json`、README、`AGENTS.md`、三份现行 docs、src 五处注释、三个测试文件、本活动提案），`tests/cyberbrain.test.ts` 更名 `tests/docs-kit.test.ts`，清掉与新定位相冲的 🧠 标记，`description` 改为覆盖清洗、编译、检索全链。已结案的四份 OpenSpec 提案、`docs/ghost-teamwiki-distinction-dialogue.md` 思辨留档与 `init-cyberbrain-engine/` 目录名按取证原则保留原词。目录结构、`exports` 子路径 key 与公开 API 全部不动。

实测：`docskit` 在 npm 官方源已被占用，qing 明确「占了也没事」，故本次按此名落地。发布前仍需在「协商原包名 / 改用未占用的 `docs-kit` / 走 scope」三者中拍板，Agent 不擅自决定。
