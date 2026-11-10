# Tasks: 引擎纯度与声明式重构

> 就地施工，未获提交授权，不开 worktree。阶段二需要单独授权。

## 立项与规约

- [x] `proposal.md` 写清动因、方案、非目标、兼容性与验收标准 <!-- id: 0 -->
- [x] `design.md` 写清 D1 到 D8 的方案、备选与理由 <!-- id: 1 -->
- [x] `specs/engine-purity/spec.md` 写清 SHALL 条目与四级 Scenario <!-- id: 2 -->
- [x] `tasks.md` 拆解任务并末尾挂文档对齐项 <!-- id: 3 -->

## 三层骨架

- [x] 新建 `src/core/policy.ts`，全库策略数值单一冻结表 <!-- id: 4 -->
- [x] 新建 `src/core/texts.ts`，文案契约类型与中性默认值，零中文 <!-- id: 5 -->
- [x] 新建 `src/presets/zh-cn.ts`，集中原有中文模板与诊断文案 <!-- id: 6 -->
- [x] `package.json exports`、`tsup.config.ts` entry、`src/index.ts` 三处登记 `./presets` <!-- id: 7 -->

## 重点模块第一性重写

- [x] `ast/distiller.ts`：渲染与数据提取分离，模板注入，关键词表与兜底中文退出引擎 <!-- id: 8 -->
- [x] `ast/normalize.ts`：`unist-util-visit` 替代手搓递归，选择器抽常量，非空断言改契约过滤，附录中文注入 <!-- id: 9 -->
- [x] `jit/index.ts`：提示词文案注入，默认输出纯结构指针 <!-- id: 10 -->
- [x] `patch/dedup.ts`：阈值进 policy，reason 改结构化 code，权重与伪相似度进 policy <!-- id: 11 -->
- [x] `okf/okf-meta.ts`：Schema description 中文清理，卡片模板注入，564 行按职责收敛 <!-- id: 12 -->
- [x] `lint/card-lifecycle.ts`：阈值进 policy，advisory 与 reason 改结构化 code <!-- id: 13 -->

## 全仓文案与诊断治理

- [x] `lint/supersede.ts`、`lint/identity.ts`、`lint/guard.ts`：detail / message / reason 改 code <!-- id: 14 -->
- [x] `snapshot/tombstone.ts`、`patch/section-patcher.ts`、`sense/reranker.ts`：中文文案移到预设 <!-- id: 15 -->
- [x] `sense/pipeline.ts`、`sense/late-chunking.ts`、`shared/markdown.ts`：默认值进 policy，正则收敛 <!-- id: 16 -->
- [x] `pipeline/options.ts`、`pipeline/runner.ts`、`lint/topology.ts`、`lint/vault-auditor.ts`、`graph/index.ts`：防御八股与散落常量治理 <!-- id: 17 -->

## 质量门禁与深挖

- [x] 两轮主动深挖：扫 `startsWith`、`Array.isArray`、`typeof === "string"`、嵌套三元、马甲函数、未消费的库引入 <!-- id: 18 -->
- [x] `src/core/**/*.ts` 中文字符串字面量零命中 <!-- id: 19 -->
- [x] 重点模块零 `let`、零 `for` 加 `push`、零非空断言、零原生 `try/catch`、零 `as any` <!-- id: 20 -->
- [x] `pnpm typecheck` 零错、`pnpm test` 全绿 <!-- id: 21 -->
- [x] `pnpm build` 成功，13 个子路径零导入失败，旧导出符号零删减 <!-- id: 22 -->

## 测试与文档对齐

- [x] 现有测试断言同步：中文输出改结构断言，附件数据行断言保持 <!-- id: 23 -->
- [x] 新增 `tests/engine-purity.test.ts`：零中文、策略表、预设恢复、纯函数等价 <!-- id: 24 -->
- [x] `AGENTS.md` 目录、能力表、子路径计数与编码审美条款同步 <!-- id: 25 -->
- [x] `README.md` 与三份 docs 补预设注入、策略表与兼容性说明 <!-- id: 26 -->
- [x] `proposal.md` 回写落地结果与验收实测，`tasks.md` 逐项勾选 <!-- id: 27 -->
- [x] 项目说明文档与对外白皮书对齐：复核 README、三份 docs、AGENTS.md 与代码零分叉，StandAlone 侧本轮无对应条目 <!-- id: 28 -->

## 预设精简与平实化（追加批次）

- [x] 盘点 15 个导出的实际消费点，识别死代码与多余导出 <!-- id: 32 -->
- [x] `src/presets/zh-cn.ts` 压到 240 行，对外只留五个聚合入口 <!-- id: 33 -->
- [x] 删掉 `ZH_CN_OKF_APPENDIX`、`ZH_CN_GUARD_REASON`、`ZH_CN_DIAGNOSTICS` 五个分组与三个无用标签字段 <!-- id: 34 -->
- [x] 卡片模板、附件清单、JIT 提示词与废弃声明按平实词表重写，去掉括号英文注、冒号副标与命令腔 <!-- id: 35 -->
- [x] 四个测试文件的中文断言同步改写，README、AGENTS.md、BUILDING-VAULTS 与提案口径同步 <!-- id: 36 -->
- [x] 重跑 typecheck、69 项测试、build、13 个子路径导入与 openspec validate <!-- id: 37 -->

## 小工具收敛（追加批次）

- [x] `hash` 抽出 `computeSha256Hex`，`sense/pipeline.ts` 的缓存键不再自己调 crypto <!-- id: 38 -->
- [x] `shared` 补 `collapseWhitespace`、`splitLines`、`stripMarkdownExtension`，`normalizeLf` 兼顾老式 CR <!-- id: 39 -->
- [x] `graph` 补 `stripAnchor`、`stripAlias` 并让 `normalizeWikilinkTarget`、`toGraphNodeKey` 复用 <!-- id: 40 -->
- [x] `lint/topology.ts` 复用双链归一与扩展名工具，手写 wiki 路径正则归零 <!-- id: 41 -->
- [x] `fs`/`crypto` 编码参数统一 `utf8`，渲染类 `join` 与 `split` 按极简阶梯保留 <!-- id: 42 -->
- [x] AGENTS.md、README、CAPABILITIES 补新底座函数，提案与任务清单回写，重跑全套验证 <!-- id: 43 -->

## 目录按层重组（追加批次）

- [x] 备份未跟踪源码与 131 个根导出基线，脚本做映射式搬迁 <!-- id: 44 -->
- [x] `src/foundation/` 收 shared / hash / policy / texts / wikilink，`src/layers/` 分 ingest / compile / retrieval / governance <!-- id: 45 -->
- [x] 修掉首轮漏掉的 `policy` 与 `texts` 无扩展名 import，typecheck 零残留 <!-- id: 46 -->
- [x] 双链字符串工具下沉 foundation，graph 保留 re-export，治理层消掉一条反向依赖 <!-- id: 47 -->
- [x] `package.json exports` 十三个子路径不动，tsup entry 与根 barrel 路径同步 <!-- id: 48 -->
- [x] AGENTS.md 目录树、README、CAPABILITIES 与两份提案同步，重跑全套验证 <!-- id: 49 -->

## foundation 拍平（追加批次）

- [x] 备份源码与导出基线，核查两个目录的实际文件规模 <!-- id: 50 -->
- [x] `hash/` 与 `shared/` 去掉，`hash.ts`、`markdown.ts`、`numeric.ts`、`shared.ts` 平铺到 foundation <!-- id: 51 -->
- [x] 映射式重写文件内部相对 import 与 32 处外部引用，tsup entry 指到新单文件 <!-- id: 52 -->
- [x] `package.json exports` 十三个子路径不动，确认 `docskit/shared` 与 `docskit/hash` 导出集合不变 <!-- id: 53 -->
- [x] AGENTS 目录树、CAPABILITIES 映射表与提案同步，重跑全套验证 <!-- id: 54 -->

## 删掉 shared.ts（追加批次）

- [x] 按 qing 纠偏删掉 `shared.ts`，`docskit/shared` 子路径改由 `markdown.ts` 承接 <!-- id: 55 -->
- [x] `markdown.ts` 加一行聚合导出 numeric，根 barrel 删掉重复的 numeric 导出 <!-- id: 56 -->
- [x] AGENTS 目录树、CAPABILITIES 映射表与提案同步，重跑全套验证 <!-- id: 57 -->

## 契约层单独成夹（追加批次）

- [x] 备份源码与导出基线，核三个文件的内部依赖确认无环 <!-- id: 58 -->
- [x] 新建 `src/contracts/`，移入 markdown / policy / texts，foundation 只留四个纯计算与门禁文件 <!-- id: 59 -->
- [x] 映射式重写相对 import、tsup entry 与根 barrel，聚合导出行改指 `../foundation/numeric` <!-- id: 60 -->
- [x] `package.json exports` 十三个子路径不动，确认 `docskit/shared` 导出集合不变 <!-- id: 61 -->
- [x] AGENTS 目录树与铁律、README、CAPABILITIES 映射表、提案同步，重跑全套验证 <!-- id: 62 -->

## 清掉实现文件里的聚合胶水（追加批次）

- [x] 核查下游从 `docskit/shared` 取用的三个数值符号及替代子路径 <!-- id: 63 -->
- [x] 删掉 `contracts/markdown.ts` 末尾的 numeric re-export，实现文件恢复单一职责 <!-- id: 64 -->
- [x] 新建 `src/contracts/index.ts` 作为 shared 兼容入口，tsup entry 指到它 <!-- id: 65 -->
- [x] 根 barrel 补显式导出 `foundation/numeric`，导出集合 131 对 131 不变 <!-- id: 66 -->
- [x] AGENTS 目录树、CAPABILITIES 映射表与提案同步，重跑全套验证 <!-- id: 67 -->

## 彻底拆掉 docskit/shared（追加批次，已授权执行）

- [x] `package.json exports` 删 `./shared`，新增 `./markdown` 与 `./numeric` <!-- id: 68 -->
- [x] tsup entry 同步，删掉只做兼容入口的 `src/contracts/index.ts` <!-- id: 69 -->
- [x] 根 barrel 补两个命名空间导出，扁平导出保持，旧符号零缺失 <!-- id: 70 -->
- [x] 实测下游 shared import 已失效，按符号产出 54 处 + 3 处迁移清单写入提案 <!-- id: 71 -->
- [x] 五份说明文档与 AGENTS 能力表改到新子路径名，重跑全套验证 <!-- id: 72 -->

## 导出面收敛（追加批次，已授权执行）

- [x] 检索业界 subpath/barrel 做法并本地实测，判定按层粗粒度导出会倒退，不采用 <!-- id: 73 -->
- [x] 清掉五处重复重导出，29 个重复符号归零，内部 import 改直连权威文件 <!-- id: 74 -->
- [x] 根 barrel 删 14 个命名空间导出，只留扁平导出 <!-- id: 75 -->
- [x] `sideEffects: false` 与 `./package.json` 元入口，核过顶层状态无副作用 <!-- id: 76 -->
- [x] 扫下游新增断点 1 处，AGENTS 重叠规则删除，文档与提案同步，重跑全套验证 <!-- id: 77 -->

> 下游 import 迁移累计 58 处（shared 拆分 57 + 导出收敛 1）本轮未动，qing 明确「回头重新处理」，并入阶段二。

## radash 原生 API 收口（追加批次）

- [x] 回读 Ghost 速查卡片正文，列出本地 radash 实际导出并实测边界行为 <!-- id: 78 -->
- [x] 类型判断改 `isNumber`，两处非空断言改源头创建与 assert <!-- id: 79 -->
- [x] 10 处手写 sort 改 `radash.sort`，first/last/sum 替换手写索引与累加 <!-- id: 80 -->
- [x] `rrf.ts` 默认值收进 POLICY 并补 number 标注，重复 rerank 胶水抽成函数 <!-- id: 81 -->
- [x] 记录 isEmpty / select / sum 三个实测坑进 AGENTS 铁律 2 <!-- id: 82 -->
- [x] 用备份源码做改前后数值对账，重跑全套验证与提案同步 <!-- id: 83 -->

## 阶段二（本轮未授权，不动）

> 渲染与诊断类默认输出已变化，下游需要注入 `ZH_CN_*_TEXTS` 或改用结构化 code。

- [ ] TeamWiki 注入中文预设并复跑 13 个 verify 套件 <!-- id: 29 -->
- [ ] Ghost 注入中文预设并复跑既有单测 <!-- id: 30 -->
- [ ] 两仓确认接受新的中文模板输出 <!-- id: 31 -->
