# Proposal: 引擎纯度与声明式重构 (Refactor Engine Purity)

- **Change ID**: `refactor-engine-purity`
- **Status**: in-progress
- **Created**: 2026-11-11
- **素材源流**: 当前对话直接提炼（qing 对 DocsKit 全仓编码审美的纠偏），审美真源为 `dotagents/MIND.md` 维度 3 与 `dotagents/SYSTEM_PROMPT.md` 门禁 1
- **前置变更**: `consolidate-evidence-governance`（同工作树，未提交）

---

## 立项动因

全仓代码体检显示三类系统性问题，与「通用引擎零业务偏见」的契约冲突。

| 类别 | 实测证据 |
| :--- | :--- |
| 业务中文写死在方法内 | `ast/distiller.ts` 44 行、`okf/okf-meta.ts` 44 行、`jit/index.ts` 13 行、`patch/section-patcher.ts` 9 行、`lint/card-lifecycle.ts` 7 行、`ast/normalize.ts` 6 行，另有 `patch/dedup.ts`、`lint/supersede.ts`、`lint/identity.ts`、`lint/guard.ts`、`snapshot/tombstone.ts` 的诊断文案 |
| 魔法数字散落 | `patch/dedup.ts` 的 `0.35 / 0.65 / 0.58`，外加 `0.88` 伪相似度、`0.7 / 0.3` 权重、`length < 4`；`lint/card-lifecycle.ts` 的 `0.82`；`ast/distiller.ts` 的 `slice(0, 3/4)`；`sense/*` 的 RRF k、窗口、限额与降级分数 |
| 天书正则与选择器堆叠 | `shared/markdown.ts` 28 处、`ast/distiller.ts` 13、`sense/reranker.ts` 13、`sense/pipeline.ts` 12、`ast/normalize.ts` 11、`patch/dedup.ts` 10；`normalize.ts` 的 `selectAll("table")` 字符串选择器、`CALLOUT_CONTAINER` 捕获组正则、`collectNodeText` 手搓递归、`link.position!` 非空断言 |

`ast/distiller.ts` 把客套词表、建模范式注记、IPO 表格、兜底阶段模板、避坑红线与 `${defaultTitle} 的核心机制与工程落地实践。` 全部拼进方法体；`ast/normalize.ts` 把附件附录的中文表头、提示语与 Markdown 结构混在一起。这些文案绑定了 Ghost 与 TeamWiki 的私有卡片语义，通用引擎不该持有。

## 目标方案

### 三层物理分离

| 层 | 落点 | 职责 |
| :--- | :--- | :--- |
| 策略数值 | `src/core/policy.ts` | 全库唯一的冻结常量表，阈值、权重、上限、精度只在此声明，options 覆盖 |
| 文案契约 | `src/core/texts.ts` | 各模块的文案接口与中性默认值，零业务中文 |
| 业务预设 | `src/presets/zh-cn.ts` | 原有中文模板、诊断文案与提示词，经 `docskit/presets` 显式注入 |

`src/core/` 内方法体零中文字符串。诊断类返回值默认给结构化 code，展示文案由业务层注入；渲染类函数默认输出来自输入数据的纯结构骨架，中文模板经注入恢复。

### 重点模块第一性重写

`ast/distiller.ts`、`ast/normalize.ts`、`jit/index.ts`、`patch/dedup.ts`、`okf/okf-meta.ts`、`lint/card-lifecycle.ts` 按 IPO 重新设计，不照搬旧逻辑：

- 渲染与数据提取分离，`parseMarkdownWithAST` 只产结构，卡片装配由声明式模板字典驱动。
- MDAT 节点遍历用 `unist-util-visit` 替代手搓递归，选择器字符串抽成常量表，非空断言改契约过滤加 `assert`。
- 关键词表、建模注记、兜底模板全部退出引擎。
- 集合变换用 `map / filter / flatMap / reduce`，禁 `let`、禁 `for` 加 `push`、禁嵌套三元。

### 全仓治理

其余模块把散落的默认值收进 `policy.ts`，把中文文案收进 `presets`，把 `?? 0` 隐式兜底改为显式解构，把 `typeof === "string"` 一类换成 radash 原生判断。两轮主动深挖扫描 `startsWith`、`Array.isArray`、嵌套三元、马甲函数与未消费的库引入。

## 设计决策摘要

完整方案与备选见 `design.md`。

| 编号 | 决策 |
| :--- | :--- |
| D1 | 中文文案移到显式业务预设，引擎默认零中文，不靠注释解释「为什么有中文」 |
| D2 | 渲染类函数改注入式模板，默认输出只由输入数据组成 |
| D3 | 诊断类返回值默认结构化 code，中文句子归展示层 |
| D4 | 策略数值单一真理源，options 覆盖，纯计算行为逐字不变 |
| D5 | 正则按源头消灭，能用AST节点、pathe、radash表达的删掉 |
| D6 | 契约信任，删非空断言与隐式兜底，非法入参当场中断 |
| D7 | 新增 `docskit/presets` 子路径，与 exports、entry、barrel 三处对账 |
| D8 | 就地施工不开 worktree，因上一轮成果未提交且 worktree 基于 HEAD 会丢改动 |

## 边界与不做

- 不改纯计算函数的数值行为：哈希、相似度、段落锚点、路径仲裁、演化链判定改前改后逐字一致。
- 不引入新依赖，`unist-util-visit` 与 radash 等已在依赖表内。
- 不动 TeamWiki 与 Ghost 工作树，两仓接入属阶段二。
- 不做性能优化，不改重型依赖的惰性加载契约。
- 不删既有导出符号，不删 `condenseTitle`、`sanitizeFileName` 等兼容别名。

## 向后兼容性

本变更对渲染类与诊断类函数是行为变更。`distillMarkdownContent`、`normalizeMarkdownContent`、`formatAgentJITPrompt`、`buildOKFConceptCard` 默认输出不再自带中文模板；`evaluateDedupGate`、`analyzeCardLifecycle`、`auditSupersedeChain` 等默认返回结构化 code 而非中文句子。另有三个中性默认值变化：`normalizeReadableTitle` 的空值兜底从中文改 `Untitled`，`hasSourceLink` 的默认章节关键词改 `sources`，`appendUnderHeading` 的缺省标题改 `## Notes`，调用方显式传参即可恢复。注入 `ZH_CN_*_TEXTS` 后得到平实的中文模板，与旧版快照不再逐字相同。纯计算类函数零变化。下游 TeamWiki 与 Ghost 的适配列阶段二。

## 验收标准

| 编号 | 判据 |
| :--- | :--- |
| A1 | `src/core/**/*.ts` 内中文字符串字面量零命中 |
| A2 | `src/core/**/*.ts` 内散落魔法数字零命中，全部经 `policy.ts` 引用 |
| A3 | 重点模块零 `let`、零 `for` 加 `push`、零非空断言、零原生 `try/catch` |
| A4 | `pnpm typecheck` 零错，`pnpm test` 全绿 |
| A5 | `pnpm build` 成功，13 个子路径零导入失败，旧导出符号零删减 |
| A6 | 纯计算函数改前改后同输入逐字一致 |
| A7 | 注入中文预设后渲染输出含平实中文模板，纯计算结果不变 |
| A8 | `openspec validate refactor-engine-purity --type change` 通过 |
| A9 | README、AGENTS.md、三份 docs 与代码契约同步 |

## 涉及文件

`src/core/policy.ts`、`src/core/texts.ts`、`src/presets/zh-cn.ts` 为新增；`src/core/ast/`、`src/core/okf/`、`src/core/jit/`、`src/core/patch/`、`src/core/lint/`、`src/core/sense/`、`src/core/snapshot/`、`src/pipeline/` 按批次治理；`src/index.ts`、`package.json`、`tsup.config.ts` 增加预设子路径；`tests/` 同步断言并补行为等价快照。

## 新增 Requirement

完整条目见 `specs/engine-purity/spec.md`，每条含 SHALL 与 WHEN/THEN 场景。

## 落地结果（2026-11-11）

### 已闭环

| 项 | 结果 |
| :--- | :--- |
| 三层骨架 | `src/core/policy.ts` 冻结策略表、`src/core/texts.ts` 文案契约与中性标签、`src/presets/zh-cn.ts` 集中全部中文模板与诊断句子 |
| 重点模块重写 | `ast/distiller.ts` 渲染与提取分离、`ast/normalize.ts` 节点位置契约与选择器常量化、`jit/index.ts` 渲染器注入、`patch/dedup.ts` code 化理由、`okf/okf-meta.ts` 清掉 44 行 description 与模板、`lint/card-lifecycle.ts` code 化诊断 |
| 全仓治理 | `patch/section-patcher.ts` 去非空断言与手搓模板，`lint/supersede.ts`、`lint/identity.ts`、`lint/guard.ts`、`sense/*`、`shared/markdown.ts`、`evidence/contracts.ts` 的中文与散落阈值全部收敛 |
| 导出对账 | 新增 `docskit/presets`，13 个子路径与 exports / entry 键集合一致，根导出 119 增至 135，旧符号零缺失 |
| 回归 | `pnpm typecheck` 零错，`pnpm test` 69/69 通过（新增 11 项），`pnpm build` 成功 |
| 下游 | TeamWiki 从 `docskit/ast` 与 `docskit/shared` 的现有导入在 dist 重建后仍正常 |
| 文档 | AGENTS.md 加引擎零业务语言与策略收敛两条铁律并补目录和能力表，README 加预设注入示例，三份 docs 同步 |
| 预设精简 | 15 个导出盘完后只留 5 个聚合入口，删掉 10 个零消费或内部导出，324 行压到 240 行，中文文案按平实词表重写 |
| 小工具收敛 | `createHash` 收成一处，锚点/别名/扩展名/空白/行切分各自下沉到底座，手写 `.md` 与 wiki 路径正则清零 |

### 验收对照

| 编号 | 结果 |
| :--- | :--- |
| A1 | 通过，`src/core/**/*.ts` 中文字符串字面量零命中（注释按取证原则保留） |
| A2 | 通过，阈值、权重、上限、精度全部经 `policy.ts` 引用；残留 `?? 0` 是集合累加初值与零向量恒等值，不是策略默认值 |
| A3 | 通过，六个重点模块零 `let`、零 `for` 加 `push`、零非空断言、零原生 `try/catch` |
| A4 | 通过，typecheck 0 错、69/69 测试 |
| A5 | 通过，build 成功，13 个子路径零导入失败，根导出旧集合零删减 |
| A6 | 通过，段落锚点、路径仲裁、哈希与相似度有固定期望值断言 |
| A7 | 通过，distill / normalize / JIT / section / runPipeline 注入中文预设后中文模板断言全部通过 |
| A8 | 通过，`openspec validate refactor-engine-purity --type change` 通过 |
| A9 | 通过，README、AGENTS.md、三份 docs 与代码契约同步 |

### 实现偏差与已知剩余

- 测试同步采取注入中文预设并同步改写断言，没有删断言换绿。`layer-1.test.ts`、`pipeline.test.ts`、`vault-recipes.test.ts` 各自注入对应预设，另新增 `tests/engine-purity.test.ts` 覆盖零中文、策略表、预设恢复与纯计算等价。
- 新增用例初稿假设 `threshold` 能压过所有合并路径，实测 fuzzy 门禁优先于 threshold，改用不相关标题验证选项覆盖，没有改生产逻辑去迁就测试。
- `sense/late-chunking.ts` 的模块级惰性单例与 `sense/pipeline.ts`、`sense/reranker.ts` 的少量 `let` 属既有异步状态结构，本轮只做阈值与文案治理，未推倒重写，列为已知剩余。重点模块不含这三个文件。
- `graph/index.ts` 与 `shared/markdown.ts` 里保留的 `startsWith` 是路径前缀与 Markdown 标题语法判定，不是防御八股；新增代码里的前缀判定已改为切片比对。
- 未开 worktree，未提交上一轮成果。原因是 qing 只授权重构，且 worktree 基于 HEAD 会丢掉 17 项未提交改动。

### 后续追加：预设精简与平实化

qing 复盘 `src/presets/zh-cn.ts` 时指出文案太书面，要求盘点哪些是必须的。实测 15 个导出里只有 5 个有真实消费，`ZH_CN_OKF_APPENDIX`、`ZH_CN_GUARD_REASON`、`ZH_CN_DIAGNOSTICS` 的五个分组与三个标签字段全仓零消费。按 `MIND.md` 维度 5 的平实化词表重写全部中文文案，去掉中英混排、括号英文注、冒号副标、感叹号与命令腔，兜底 summary 从「核心机制与工程落地实践」改成「是怎么工作的」。A7 验收口径随之从「与旧版快照逐字一致」改成「含平实中文模板且纯计算结果不变」，四个测试文件的断言与三份文档同步改写。此批次让预设不再承担旧版快照回放职责。

### 后续追加：小工具收敛

qing 继续挑出散落的格式处理写法：`sense/pipeline.ts` 自己调 `crypto.createHash` 算缓存键、两处 `split("#")`、多处手写 `.md` 后缀与 wiki 路径正则、`utf-8` 与 `utf8` 混用。按 `MIND.md` 维度 3 的底座提炼纪律收成七个公共函数：`computeSha256Hex`（全库唯一摘要）、`collapseWhitespace`、`splitLines`、`normalizeLf`（同时处理老式 CR）、`stripMarkdownExtension`、`stripAnchor`、`stripAlias`。`lint/topology.ts` 改复用 `graph` 的双链归一，删掉 `replace(/.*\/wiki\//, ...)` 一类天书正则。Node `fs` 与 `crypto` 的编码参数统一成 `utf8`，没有再包一层常量。`join` 与 `split` 共 39 处里绝大多数是渲染输出时的数据流表达，抽成 `joinLines()` 反而多一层间接，按极简阶梯保留。验证：typecheck 零错、69/69 测试、build 成功、13 个子路径零导入失败、根导出 131、本提案 validate 通过。

### 后续追加：目录按层重组

qing 指出按能力原子化平铺的 `src/core/` 不表达「哪一层用」，要求把横切底座单独放到 src 顶层，文档清理归第一层，RAG 相关放一起。按主推方案重组为 `src/foundation/`（shared、hash、policy、texts、wikilink）与 `src/layers/{ingest,compile,retrieval,governance}/`，`src/presets/` 不动。能力模块内部文件保持完整，没有按阶段拆散。

硬约束是公开契约不动：`package.json exports` 的十三个子路径按能力命名一个不改，`tsup.config.ts` 的 entry 映射到新位置，`src/index.ts` barrel 路径同步。构建前后根导出集合 131 对 131，零缺失零新增，下游 TeamWiki 与 Ghost 的现有 import 正常。

顺带把 `stripAnchor`、`stripAlias`、`normalizeWikilinkTarget` 下沉到 `foundation/wikilink.ts`，`graph` 只留拓扑构建并保留 re-export，`governance/lint/topology.ts` 改为直接消费底座。分层依赖扫描还发现 `compile` 与 `governance` 互相引用，把 `checkHumanLock` 与只读守护一起下沉到 `foundation/guard.ts`，`lint` 保留 re-export，环消掉且 `docskit/lint` 导出面不变。治理层仍有一条 `vault-auditor.ts` 复用 `graph` 的拓扑构建函数，那是合理的能力复用，没有强行拆。

搬迁用脚本做路径映射式重写，第一次漏了 `policy.ts` 与 `texts.ts` 的无扩展名 import，typecheck 当场抓到 24 处残留并补齐。验证：typecheck 零错、69/69 测试、build 成功、13 个子路径零导入失败、导出集合一致、openspec validate 通过、`src/core` 目录已不存在。

历史正文里的 `src/core/...` 路径按取证原则保留，迁移映射以本节为准。

### 后续追加：foundation 拍平

qing 继续指出 `hash/` 与 `shared/` 两个目录里其实都只是单文件，问能否直接放到 `foundation/` 下。核查 `hash/index.ts` 54 行，`shared/` 是 `markdown.ts` 195 行加 `numeric.ts` 114 行加两行 barrel。按建议去掉两个目录，`hash.ts`、`markdown.ts`、`numeric.ts` 平铺到 foundation，`shared.ts` 保留两行 barrel 承接 `docskit/shared` 子路径入口。

没有把 markdown 与 numeric 合成一个 309 行文件，理由是两者职责不同，一个是 Frontmatter 与排版，一个是字符级数值相似度，合并会破坏刚收敛的能力原子化。`shared.ts` 只有两行，是公开子路径的必要入口，删了 `docskit/shared` 就失去聚合点。

用映射式脚本搬迁并处理文件内部相对路径（`markdown.ts` 的 `../policy` 变 `./policy`、`hash.ts` 的 `../shared/markdown` 变 `./markdown`），typecheck 一次通过，没有出现上一轮的漏映射。验证：typecheck 零错、69/69 测试、build 成功、13 个子路径零导入失败、根导出 131 对 131、`docskit/shared` 仍导出 31 个符号且含数值函数、`docskit/hash` 仍导出 7 个、下游 import 正常、两个提案 validate 通过。

### 后续追加：删掉 shared.ts

qing 纠正上一轮的理解偏差：他要的是把 `shared/` 里的文件提出来平铺，既不要 shared 文件夹，也不要一个叫 shared.ts 的 barrel 文件。我上一轮把「单文件即可」理解成合并成一个 shared.ts，多留了一个两行文件，属于判断错。

这轮删掉 `shared.ts`，`docskit/shared` 子路径的 entry 从 `src/foundation/shared.ts` 改指 `src/foundation/markdown.ts`，在 `markdown.ts` 的 import 区后加一行 `export * from "./numeric";` 承接聚合导出。`src/index.ts` 根 barrel 相应删掉单独导出 numeric 的那行，避免同源符号重复。foundation 下现在七个单文件：`markdown.ts`、`numeric.ts`、`hash.ts`、`policy.ts`、`texts.ts`、`wikilink.ts`、`guard.ts`，没有任何 shared 命名的文件或目录。

公开契约仍然不动：`package.json exports` 十三个子路径按能力命名不变，根导出 131 对 131，`docskit/shared` 仍导出 31 个符号且同时含排版函数与数值函数，下游 TeamWiki 的 `parseMarkdownSafely`、`renderMarkdownTable` 正常。验证：typecheck 零错、69/69 测试、build 成功、13 个子路径零导入失败、两个提案 validate 通过、AGENTS 目录树与 CAPABILITIES 映射表同步。若后续要连 `docskit/shared` 这个公开子路径名一起改掉，属契约变更，需单独授权。

### 后续追加：契约层单独成夹

qing 提出把 `markdown.ts`、`policy.ts`、`texts.ts` 单独放进一个文件夹，直接放在 `src/` 下。按建议新建 `src/contracts/`，三个文件从 foundation 移入，`src/foundation/` 只留 `numeric.ts`、`hash.ts`、`wikilink.ts`、`guard.ts` 四个纯计算与门禁工具。两处都在 `src/` 下平级，都是平铺单文件。

拆分依据：`policy` 与 `texts` 零内部依赖，`markdown` 只依赖这两个同组文件加留在 foundation 的 `numeric`，移出去不会成环。它们三个是格式、策略与文案的约定，`foundation` 剩下的是算法实现与拦截规则，性质不同。`markdown.ts` 末尾的聚合导出行改成 `export * from "../foundation/numeric"`，`docskit/shared` 子路径的 tsup entry 指到 `src/contracts/markdown.ts`，产物路径与导出面不变。

文件夹名按「契约层」起的 `contracts`，若 qing 想换成别的名字，改一处目录名加 tsup entry 即可，公开子路径不受影响。验证：typecheck 零错、69/69 测试、build 成功、13 个子路径零导入失败、根导出 131 对 131、`docskit/shared` 仍 31 个符号且同时含排版与数值函数、下游 TeamWiki 的 `parseMarkdownSafely`、`renderMarkdownTable` 正常、两个提案 validate 通过。AGENTS 目录树、能力表与 CAPABILITIES 映射表同步。

### 后续追加：清掉实现文件里的聚合胶水

qing 指出 `contracts/markdown.ts` 末尾 `export * from "../foundation/numeric"` 是遗留。核实属实：那行是删掉 `shared.ts` 之后，为让 `docskit/shared` 一个入口同时导出 Markdown 底座与数值相似度，塞进实现文件里的历史妥协。

先查下游真实消费，避免随手删断契约：Ghost 的 `embedder.ts` 从 `docskit/shared` 取 `cosineSimilarityVectors`，`lint/metabolism.ts` 取 `computeBigramDiceSimilarity` 与 `computeNormalizedDotProduct`，共三个数值符号。这三个在 `docskit/lint`、`docskit/sense` 也都有重导出，但改 import 要碰下游工作树，属阶段二，本轮不动。

落地方式是职责归位：删掉 `markdown.ts` 里那行，新建 `src/contracts/index.ts` 作为 `docskit/shared` 的兼容入口，两行分别 re-export `markdown` 与 `foundation/numeric`；`tsup.config.ts` 的 `shared/index` entry 指到它；根 barrel 补一行显式导出 `foundation/numeric`，避免同源符号经实现文件间接带出。实现文件恢复单一职责，公开契约完全不变。

验证：typecheck 零错、69/69 测试、build 成功、13 个子路径零导入失败、根导出 131 对 131、`docskit/shared` 仍 31 个符号且同时含排版与数值函数、Ghost 三个数值符号可调用、`contracts/markdown.ts` 对 numeric 零引用、两个提案 validate 通过。AGENTS 目录树与 CAPABILITIES 映射表同步。

遗留的本质是 `docskit/shared` 这个历史子路径名把两类能力绑在一起，本次只把胶水挪回入口文件，没有假装问题消失。彻底拆掉该子路径需新增按能力命名的入口并迁移下游几十处 import，属契约变更，等 qing 单独授权。

### 后续追加：彻底拆掉 docskit/shared

qing 拍板不要任何 shared，彻底拆成按能力命名的 `docskit/markdown` 与 `docskit/numeric`，下游回头再处理。这轮是公开契约变更，按授权执行。

落地：`package.json exports` 删掉 `./shared`，新增 `./markdown`（指 `src/contracts/markdown.ts`）与 `./numeric`（指 `src/foundation/numeric.ts`）；`tsup.config.ts` entry 同步；删掉只为 compat 存在的 `src/contracts/index.ts`；`src/index.ts` 补 `markdown`、`numeric` 两个命名空间导出，扁平导出保持。子路径从 13 变 14，根导出 131 增至 133（新增两个命名空间），旧符号零缺失。`docskit/markdown` 21 个符号、不含数值函数，`docskit/numeric` 10 个符号、不含排版函数，两类能力彻底分开。

下游影响已实测并接受：TeamWiki 从 `docskit/shared` 的 import 报 `ERR_PACKAGE_PATH_NOT_EXPORTED`。qing 明确「下游回头重新处理」，本轮不碰两仓工作树。按符号分流的迁移清单：

| 目标子路径 | 处数 | 涉及符号 |
| :--- | :--- | :--- |
| `docskit/markdown` | 54 | `parseMarkdownSafely`、`stringifyMarkdownSafely`、`readMarkdownFile`、`dropSection`、`extractSection`、`appendUnderHeading`、`hasWikiLink`、`hasSourceLink`、`outdent`、`renderMarkdownTable`、`localIsoDate`、`normalizeLf`、`ensureArray`、`sanitizeLatexToUnicode`、`extractDocumentTitle` |
| `docskit/numeric` | 3 | `cosineSimilarityVectors`（`Ghost/.pi/lib/evolution/embedder.ts`）、`computeBigramDiceSimilarity` 与 `computeNormalizedDotProduct`（`Ghost/.pi/lib/lint/metabolism.ts`） |

另需 `.vitepress/config.ts` 与若干 lint/compile 脚本同步改 import。数值三符号在 `docskit/lint`、`docskit/sense` 也有重导出，可选更短路径。

验证：typecheck 零错、69/69 测试、build 成功、14 个子路径零导入失败、exports 与 entry 键集合一致、根导出旧集合零缺失、`dist/shared` 物理残留清除、两个提案 validate 通过。README 能力表、AGENTS 目录树与能力表、CAPABILITIES 架构图与映射表、BUILDING-VAULTS、OKF 规范全部改到新子路径名。历史提案正文里的 `docskit/shared` 按取证原则保留。

### 后续追加：导出面收敛

qing 问「还有没有可以优化的导出，比如要不要按分层简化」。检索与本地实测都指向反面：物理目录已按层组织，导出面收粗会让消费方为整层能力付加载成本（`docskit/retrieval` 会拖起 ONNX 与 transformers，`docskit/compile` 会带上 typebox 与 mdast），与前几轮惰性加载优化直接对冲。Node 官方、Cloudpack 的 exports map 指引与 panva/jose 都用细粒度子路径；Next.js 与 Rspack 的实测指出 barrel 会让引擎在解析期构建整张依赖图，用不到的重导出无法剪掉。因此没有按层做粗粒度入口。

按 qing 拍板的主推方案，真正落地三处：

| 项 | 改动 |
| :--- | :--- |
| 清重复导出 | 删掉 `ast/index.ts` 对 markdown 的整包重导出、`hash.ts` 的 `normalizeLf`、`sense/ngram.ts` 整个中转文件、`patch/dedup.ts` 的 `computeNgramSimilarity`、`lint/card-lifecycle.ts` 的两个数值函数。`sense/pipeline.ts` 改直连 `foundation/numeric`。29 个重复符号归零 |
| 根 barrel | 删掉 14 个命名空间导出，只留扁平导出。下游命名空间零消费，根导出 133 降至 119 |
| 包元数据 | 加 `sideEffects: false` 与 `"./package.json": "./package.json"`。加之前核过顶层状态：全是进程内 Map 与惰性单例，无文件写入、无全局注册、无顶层 I/O |

导出面现在一条规矩：每个符号只有一个权威子路径。Markdown 与文本工具在 `docskit/markdown`，数值相似度与向量在 `docskit/numeric`，哈希在 `docskit/hash`，双链字符串工具在 `docskit/graph`，门禁与只读守护在 `docskit/lint`。AGENTS 里那条「重叠符号选耗时最低子路径」的规则随之删除。

下游影响：本轮新增断点只有 1 处运行时 import，`TeamWiki/src/compile/anchors.ts` 的 `computeTextNgramSimilarity` 要从 `docskit/sense` 改到 `docskit/numeric`。扫描里其余标 `?` 的都是 TypeScript 类型，走 `.d.ts`，不受运行时导出影响。加上上一轮 shared 拆分的 57 处，阶段二迁移清单共 58 处，已逐项列出目标子路径与符号。

验证：typecheck 零错、69/69 测试、build 成功、14 个能力子路径零导入失败、重复符号 0、根 barrel 命名空间对象 0、`docskit/package.json` 可解析、exports 与 entry 键集合一致、两个提案 validate 通过。README、AGENTS 目录树与能力表、CAPABILITIES、BUILDING-VAULTS 同步。

### 后续追加：radash 原生 API 收口

qing 指出仓里仍有手写类型判断与数据操作，要求按 radash 优化。按引用守卫先回读 `Ghost/wiki/learning/[速查] 前端轻量小而美常用工具库选型与实操指南.md` 正文，卡片给的是 radash 轻量替代 lodash 的定位与 `pick` / `omit` / `retry` 手势；本仓没有属性拣选与重试场景，没有硬塞这三个 API。同时列出本地 radash 12.x 的实际导出清单并实测边界行为，避免凭记忆盲猜签名。

落地：

| 类别 | 改动 |
| :--- | :--- |
| 类型判断 | `rrf.ts` 的 `typeof rank === "number"` 改 `isNumber`；`bm25.ts` 两处非空断言 `!` 改为源头创建 Map 与 `assert(doc, "bm25_doc_missing")`。全仓运行时 typeof 判断与非空断言归零 |
| 数据操作 | 排序全部换成 `radash.sort` 并返回新数组（10 处手写 `.sort((a,b)=>b.x-a.x)` 归零）；`first` / `last` 替换手写 `[0]` 与 `[length-1]`；`rrf.ts` 累加改 `sum(ranks.map(...))`；`pipeline.ts` 两处重复的 rerank 重排胶水抽成 `reorderByRerank` |
| 策略漏项 | `rrf.ts` 的 `maybeK = 60` 改 `POLICY.sense.rrfK` 并补 `: number` 标注（冻结对象把 60 推成字面量类型） |

实测避坑：`radash.isEmpty(0)` 与 `isEmpty(false)` 都返回 `true`，所以 `ensureArray` 与表格单元格的空判断保持原生，换过去会吞掉合法标量；`radash.select` 的双参数形态不是 filter；`radash.sum` 带 getter 的重载要求元素为 object，`(number|undefined)[]` 必须先 map 成 `number[]`。这三条写进 AGENTS 铁律 2，防止下次踩回去。

刻意未换：`instanceof Map` / `Set` 是运行时契约判断，`new Set(...)` 多在构造查找索引而非数组去重，`numeric.ts` 的向量运算与 `paragraphs.ts` 的状态折叠都是最直给的数据流表达，换 radash 会多一层间接或无意义兜底。按 Ponytail 极简阶梯保留。

验证：typecheck 零错、69/69 测试、build 成功、14 子路径零导入失败、导出面零差异、根导出 119、两个提案 validate 通过。另用 `.cache/pre-radash` 备份源码做改前后数值对账：RRF 三种输入含 undefined/0/NaN、双链归一六类边界、附件替换顺序、BM25 排序结果、混合检索结果全部逐字一致。全仓 typeof 判断 / 非空断言 / 手写 sort 比较 / try-catch / for 循环 / as any 均为零命中。

### 阶段二

渲染与诊断类默认输出已变化，下游需要注入 `ZH_CN_*_TEXTS` 或改用结构化 code。TeamWiki 与 Ghost 的适配（含 shared 拆分与导出收敛后的 import 迁移）等 qing 授权后单独开窗。
