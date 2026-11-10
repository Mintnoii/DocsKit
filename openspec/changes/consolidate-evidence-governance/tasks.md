# Tasks: 证据链与卡片治理函数下沉

> 任务粒度控制在 2 小时内。阶段二需要授权，本轮不动下游工作树。

## 立项与规约

- [x] 归档本轮研讨原档至 `Ghost/_raw/ai对话/DocsKit证据链与治理函数下沉.md` <!-- id: 0 -->
- [x] `proposal.md` 写清动因、目标方案、非目标、兼容性与验收标准 <!-- id: 1 -->
- [x] `design.md` 写清 D1 到 D8 的方案、备选与理由 <!-- id: 2 -->
- [x] `specs/evidence-governance/spec.md` 写清 SHALL 条目与 WHEN/THEN 场景 <!-- id: 3 -->
- [x] `tasks.md` 拆解任务并末尾挂文档对齐项 <!-- id: 4 -->

## 公共底座先行

- [x] `src/core/hash/index.ts` 新增 `computeShortHash(text, length = 8)`，SHA-256 十六进制前 N 位 <!-- id: 5 -->
  - 复用现有 `createHash`，不另起一份哈希实现
  - 验收：同一文本同长度输出稳定，长度参数生效

- [x] `src/core/shared/markdown.ts` 新增 `normalizeReadableTitle(rawTitle)` <!-- id: 6 -->
  - 用空格替换话题标签与残留井号，空白折叠，全标签与空串都有回退
  - 保留 `condenseTitle` 不动，两个函数职责不同
  - 验收：话题标签、双井号、结尾孤立井号、全标签回退、纯空白五类边界

## 新增 evidence 子路径

- [x] 新建 `src/core/evidence/` 与 `index.ts` barrel <!-- id: 7 -->
  - 只放纯文本处理，不 import mdast 系包与 transformers
  - 类型 `AnchorParagraph`、`SourceRef`、`ClaimCoverageResult`、`EvidenceOptions` 显式导出

- [x] 实现 `splitAnchorableParagraphs(markdown, options?)` <!-- id: 8 -->
  - 标题栈按六级标题维护，同级段落序号从 1 开始，空行切块
  - 段落归一化剔除整行图片、纯链接、表格分隔行、HTML 注释与围栏标记行
  - 用不可变折叠，不写 for+push 游标与原生 try/catch
  - 验收：同输入下段落编号与下游实现逐字一致，CRLF 与 LF 结果相同

- [x] 实现 `buildSourceRefs(paragraphs, query, options?)` <!-- id: 9 -->
  - 打分消费 `computeTextNgramSimilarity`，正分按分数降序、同分按 anchor 字典序
  - 全零退化按段落长度降序，quote 与 claim 长度受 options 约束
  - 验收：limit 生效，全零退化顺序稳定，与下游输出逐字一致

- [x] 实现 `verifySourceRef(ref, markdown, options?)` <!-- id: 10 -->
  - 复算走同一份 `splitAnchorableParagraphs`，不做额外清洗
  - anchor 缺失、hash 不符、quote 不在段落文本内三种情况都判失效
  - 验收：同输入 true，改正文 false，截断 quote 去尾部省略号后命中

- [x] 实现 `checkClaimCoverage(claim, quote, options?)` 与 `mechanicalClaim(quote, options?)` <!-- id: 11 -->
  - 字组归一消费 `cleanTextForVector`，bigram 覆盖率与拉丁词全命中同时判定
  - 过短结论直接判不通过，机械首句按句末标点取并受上限约束
  - 验收：中文覆盖达标、拉丁词缺失、空结论、无句末符号四类边界

## 现有模块补齐

- [x] `src/core/lint/` 新增 `auditSupersedeChain(cards, conflicts)` 纯数据判定 <!-- id: 12 -->
  - 五类违规：缺台账记录、缺 superseded_by、悬空指向、引用卡片不存在、裁决态不匹配
  - 零 `node:fs`，零业务目录，输入输出都是普通数组
  - 验收：五类违规各一条断言，另有全绿场景

- [x] `src/core/lint/` 新增 `checkTitleStemConsistency(cards)` <!-- id: 13 -->
  - 逐卡比对 trim 后的 title 与 stem，空 title 跳过
  - 验收：一致零 issue，不一致报出路径与两个值

- [x] `src/core/snapshot/index.ts` 新增 `resolveCardPathCollision(params)` <!-- id: 14 -->
  - 目标不存在返回 use，同哈希返回 skip，不同内容按 sourceFile 短哈希生成并存路径
  - 后缀已占用时递增序号，路径处理全部走 `pathe`
  - 验收：同输入可复现，旧目标路径不出现在 rename 结果里

## 导出与构建对账

- [x] `src/index.ts` 增加 `evidence` 命名空间导出与扁平导出两行 <!-- id: 15 -->
  - 验收：构建前 106 个既有导出符号零删减

- [x] `package.json exports` 与 `tsup.config.ts` entry 增加 `./evidence` <!-- id: 16 -->
  - 验收：exports 子路径键与 entry 键集合 12 个一一对账

- [x] `pnpm build` 后逐个动态 import 验证 12 个子路径产物齐备 <!-- id: 17 -->
  - build 前 typecheck 与 test 全绿，`clean: true` 会清空下游在用的 `dist/`
  - 验收：12 个子路径零导入失败，TeamWiki 与 Ghost 现有导入仍正常

## 测试与质量门禁

- [x] 新建 `tests/evidence-and-governance.test.ts`，分组覆盖 id 5 到 14 的全部行为 <!-- id: 18 -->
- [x] `pnpm typecheck` 零错、`pnpm test` 58/58 全绿不新增失败 <!-- id: 19 -->
- [x] `grep -rn "as any\|@ts-ignore\|@ts-expect-error\|} catch" src/core/evidence src/core/lint` 零命中 <!-- id: 20 -->
- [x] 两轮主动深挖重构：扫残留 `startsWith`、`Array.isArray`、`typeof === "string"` 与嵌套三元 <!-- id: 21 -->
  - 新增源码里唯一的 `startsWith` 已改为正则判定；命中的两处属既有代码的注释与 Markdown 语法判定，未扩大改动范围

## 收尾对账与文档对齐

- [x] `AGENTS.md` 目录结构、模块能力表与子路径计数从 11 改 12 <!-- id: 22 -->
- [x] `README.md` 能力一览增加 `docskit/evidence` 行，说明新增函数 <!-- id: 23 -->
- [x] `docs/CAPABILITIES.md` 架构图补 evidence 块，四阶段表补证据链归属 <!-- id: 24 -->
- [x] `docs/BUILDING-VAULTS.md` 与 `docs/OKF-v0.2-SPECIFICATION.md` 把「尚无对应导出」改成已提供清单 <!-- id: 25 -->
- [x] `proposal.md` 回写落地结果与验收实测，`tasks.md` 逐项勾选 <!-- id: 26 -->
- [x] 项目说明文档与对外白皮书对齐：复核 README、三份 docs、AGENTS.md 与代码导出零分叉，StandAlone 侧本轮无对应条目 <!-- id: 27 -->

> 目录已按层重组，本文任务描述里的 `src/core/...` 路径按取证原则保留。当前物理路径与迁移映射见 `openspec/changes/refactor-engine-purity/proposal.md` 的「后续追加：目录按层重组」。

## 阶段二（本轮未授权，不动）

> TeamWiki 与 Ghost 当前都有用户自己的未提交改动，且 DocsKit `AGENTS.md` 要求通用引擎先跑通测试再供各项目使用。以下任务等 qing 明确授权后单独开窗。

- [ ] TeamWiki 把 `anchors.ts`、`claims.ts`、`supersede-audit.ts`、`pipeline.ts` 的本地实现改为消费 `docskit/evidence` 等子路径，跑 13 个 verify 套件对账 <!-- id: 28 -->
- [ ] Ghost 把 `normalizeReadableTitle`、`checkTitleStemConsistency` 改为消费 `docskit/shared` 与 `docskit/lint`，跑现有 title 相关单测对账 <!-- id: 29 -->
- [ ] 两仓接入后复跑 typecheck 与全量测试，确认纯计算结果不变并接受新的中文模板输出 <!-- id: 30 -->
