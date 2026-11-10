# Proposal: 证据链与卡片治理函数下沉 (Consolidate Evidence & Governance Functions)

- **Change ID**: `consolidate-evidence-governance`
- **Status**: in-progress
- **Created**: 2026-11-10
- **Authors**: Technical Lead / Architect
- **素材源流**: `Ghost/_raw/ai对话/DocsKit证据链与治理函数下沉.md`（本轮研讨原档，含下游 docs 对账与三仓工作树取证）
- **关联文档**: `README.md`、`docs/CAPABILITIES.md`、`docs/BUILDING-VAULTS.md`、`docs/OKF-v0.2-SPECIFICATION.md`（上一轮已收口）

---

## 立项动因

TeamWiki 升级到 OKF v0.3、Ghost 固化 `title === stem` 身份不变量之后，一批确定性计算留在了业务层，且两个项目各写了一份。`AGENTS.md` 的跨项目铁律要求通用算法只写一份，这批函数目前没有统一实现。

| 下游实现 | 行数 | 待下沉的纯函数 | 现状问题 |
| :--- | :--- | :--- | :--- |
| `TeamWiki/src/compile/anchors.ts` | 305 | `splitAnchorableParagraphs`、`buildSourceRefs`、`verifySourceRef` | 段落切分、锚点指纹、复算校验全在业务层 |
| `TeamWiki/src/compile/claims.ts` | 163 | `checkClaimCoverage`、`mechanicalClaim` | 与调 LLM 的 `attachClaims` 混在同一文件 |
| `TeamWiki/src/lint/supersede-audit.ts` | 158 | `auditSupersedeChain` 的判定逻辑 | 判定与读盘、读业务台账捆在一起 |
| `TeamWiki/src/compile/pipeline.ts` | 227 | `resolveTargetCardPath` 的路径仲裁 | 判定与 `fs.access`、`fs.readFile` 捆在一起 |
| `Ghost/.pi/lib/compile/builder.ts` | 1334 | `normalizeReadableTitle`、`sanitizeFileName` | 与 DocsKit 已有的 `condenseTitle`、`sanitizeFileName` 语义分叉 |
| `Ghost/.pi/lib/lint/rules.ts` | 677 | `checkTitleStemConsistency` | 依赖 Ghost 私有 `VaultGraphIndex` 类型 |

DocsKit 侧已有可直接复用的底座：`shared/numeric.ts` 的 `computeTextNgramSimilarity`、`computeBigramDiceSimilarity`、`cleanTextForVector`，`shared/markdown.ts` 的 `normalizeLf`、`condenseTitle`，`hash/index.ts` 的 SHA-256，`snapshot/index.ts` 的 `sanitizeFileName`。下沉时若另起一份哈希或相似度，会制造同名概念多套结果，违反公共底座唯一原则。

另有一个必须随实现带上的既有坑。TeamWiki 演练时编译锚点基于清洗后正文，审计却基于原文，清洗删行让段落编号错位，指纹校验误报失效。生成方与复算方必须共用同一份前置变换，通用函数内部不能再做一次清洗。

## 目标方案

### 新增 `docskit/evidence` 子路径

承载证据链的五组纯函数：`splitAnchorableParagraphs`、`buildSourceRefs`、`verifySourceRef`、`checkClaimCoverage`、`mechanicalClaim`，以及 `AnchorParagraph`、`SourceRef`、`ClaimCoverageResult` 三个契约类型。段落指纹走 `hash` 模块新增的短哈希函数，选段打分走 `shared/numeric.ts` 的 `computeTextNgramSimilarity`，字组覆盖走 `cleanTextForVector`。

### 现有模块补齐

| 子路径 | 新增函数 | 职责 |
| :--- | :--- | :--- |
| `docskit/hash` | `computeShortHash` | SHA-256 十六进制前 N 位，默认 8 位，全库唯一短哈希实现 |
| `docskit/shared` | `normalizeReadableTitle` | 剥离话题标签与残留井号，空白折叠，空值回退，保留既有 `condenseTitle` |
| `docskit/lint` | `auditSupersedeChain`、`checkTitleStemConsistency` | 演化链与身份一致性判定，输入输出都是普通数据，不读盘 |
| `docskit/snapshot` | `resolveCardPathCollision` | 同名并存路径仲裁，返回判定与可复现后缀，不做文件访问 |

### 导出与构建对账

`package.json exports`、`tsup.config.ts` entry、`src/index.ts` barrel 同步增加 `evidence`。`AGENTS.md` 的目录结构、模块能力表与子路径计数从 11 改为 12，README 与三份 docs 同步收口。

### IO 与业务语义留在业务层

读盘、列目录、写冲突台账、调模型、签字段 Schema 全不进内核。通用函数只接收已备好的数据并返回判定，业务层决定素材从哪来、卡片往哪放、结果怎么落盘。

## 设计决策摘要

完整决策与备选见 `design.md`。

| 编号 | 决策 |
| :--- | :--- |
| D1 | 新增独立 `evidence` 子路径，不把证据链函数散进 ast / hash / lint |
| D2 | 生成与复算共用同一份输入文本，函数内部零额外清洗 |
| D3 | 演化链与身份巡检改造成纯数据判定，业务层负责读盘与台账 |
| D4 | 路径仲裁只返回判定，文件存在性由业务层以已占用路径集合传入 |
| D5 | 阈值与长度上限走声明式 options，默认值对齐下游现有行为 |
| D6 | 短哈希下沉到 `hash`，标题规范化下沉到 `shared`，不新增重复实现 |
| D7 | v0.3 治理字段 Schema 与模型判定全部不下沉 |
| D8 | 本轮不碰下游工作树，接入列为阶段二 |

## 边界与不做

- 不下沉 OKF v0.3 的治理字段 Schema，团队责任链与裁决态带业务语义。
- 不下沉 `attachClaims`、`judgeRelation` 等调模型的函数。
- 不下沉冲突台账读写、审计日志、人工签字命令与 CLI 入口。
- 不读盘、不列目录、不写文件，不写死 `wiki/learning`、`_raw/` 等具体目录。
- 不改现有 11 个子路径的任何函数签名与返回结构，不删 `condenseTitle` 与 `sanitizeFileName`。
- 不改下游 TeamWiki 与 Ghost 的工作树，两仓当前都有用户自己的未提交改动。
- 不引入新依赖，不动重型依赖的惰性加载契约。

## 向后兼容性

本变更全是新增导出。现有 11 个子路径的签名、返回结构与副作用保持逐字不变，根 barrel 的既有符号零删减。`condenseTitle` 与 `snapshot/sanitizeFileName` 保留原行为，新增的 `normalizeReadableTitle` 与它们职责不同，不互相替代。下游当前不消费新子路径，零迁移成本。阶段二接入时由业务层逐处改 import，不改调用语义。

## 验收标准

| 编号 | 判据 | 命令或方法 |
| :--- | :--- | :--- |
| A1 | `pnpm typecheck` 零错 | `pnpm typecheck` |
| A2 | `pnpm test` 全绿且不新增失败 | `pnpm test` |
| A3 | `pnpm build` 成功，12 个子路径产物齐备 | `pnpm build` 后逐个动态 import |
| A4 | `package.json exports` 与 `tsup.config.ts` entry 一一对账 | 脚本比对键集合 |
| A5 | 根 barrel 既有导出符号零删减 | 构建前后导出名集合比对 |
| A6 | 新增函数覆盖五类判定的正常与边界场景 | `tests/evidence-and-governance.test.ts` |
| A7 | 段落锚点在同输入下生成与复算自洽，改一个字即失效 | 单测断言 |
| A8 | `src/` 内零 `as any`、`@ts-ignore`、`@ts-expect-error`、原生 `try/catch` | `grep -rn` 零命中 |
| A9 | 说明文档与代码同生共死 | README、三份 docs、AGENTS.md 对账完成 |

## 风险与回退

| 风险 | 处置 |
| :--- | :--- |
| 通用化后与下游现有实现输出不一致 | 单测写死期望值，逐项对齐下游规则；阶段二接入前先做一次同输入对账 |
| 生成方与复算方前置变换不同导致锚点误报 | D2 硬约束，函数不做额外清洗，设计文档写明契约 |
| `tsup` 的 `clean: true` 清掉下游正在消费的 `dist/` | build 前确认代码可编译，build 后立即逐个 import 验证 12 个子路径 |
| 根 barrel 新增导出触发命名冲突 | 构建前用导出名集合比对，冲突则在模块内改名，不动既有符号 |
| 下游工作树被误改 | 本轮所有写操作限定在 DocsKit 仓，git status 收尾复核 |

回退方式：本变更为独立提交，删掉新增子路径与导出即可回到原状，不涉及数据迁移。

## 涉及文件

| 路径 | 改动 |
| :--- | :--- |
| `src/core/evidence/` | 新增段落切分、锚点、覆盖校验模块 |
| `src/core/hash/index.ts` | 新增 `computeShortHash` |
| `src/core/shared/markdown.ts` | 新增 `normalizeReadableTitle` |
| `src/core/lint/` | 新增演化链审计与身份一致性巡检 |
| `src/core/snapshot/index.ts` | 新增路径仲裁 |
| `src/index.ts`、`package.json`、`tsup.config.ts` | 新增 `evidence` 子路径三处对账 |
| `tests/evidence-and-governance.test.ts` | 新增回归用例 |
| `AGENTS.md`、`README.md`、`docs/*.md` | 契约与说明文档同步 |
| `openspec/changes/consolidate-evidence-governance/` | 提案、设计、任务与 delta spec |

## 新增 Requirement

完整条目见 `specs/evidence-governance/spec.md`，每条含 SHALL 与 WHEN/THEN 场景。摘要如下。

- Requirement: 段落级证据锚点 SHALL 由确定性函数产出，模型不得参与定位。
- Requirement: 锚点复算 SHALL 与生成共用同一份输入文本，指纹不符即判失效。
- Requirement: 声明句 SHALL 通过字组覆盖与拉丁词全命中校验，不通过退回机械首句。
- Requirement: 演化链审计 SHALL 只消费传入的卡片与冲突记录，不访问文件系统。
- Requirement: 身份一致性巡检 SHALL 逐卡比对 title 与文件名 stem。
- Requirement: 同名路径仲裁 SHALL 在内容不同时返回并存路径，旧卡不得被覆盖。
- Requirement: 新增子路径 SHALL 与 exports、entry、barrel 三处对账。
- Requirement: 通用函数 MUST NOT 写死业务目录或团队治理字段。

## 落地结果（2026-11-10）

### 已闭环

| 项 | 结果 |
| :--- | :--- |
| 新增 `docskit/evidence` | 五个函数（`splitAnchorableParagraphs`、`buildSourceRefs`、`verifySourceRef`、`checkClaimCoverage`、`mechanicalClaim`）与契约类型，纯文本处理，零重型依赖 |
| 现有模块补齐 | `hash` 的 `computeShortHash`、`shared` 的 `normalizeReadableTitle`、`lint` 的 `auditSupersedeChain` 与 `checkTitleStemConsistency`、`snapshot` 的 `resolveCardPathCollision` |
| 导出三处对账 | `package.json exports` 与 `tsup.config.ts` entry 键集合 12 个一致，`src/index.ts` 增命名空间与扁平导出两行 |
| 构建与回归 | `pnpm typecheck` 零错，`pnpm test` 58/58 通过（新增 20 项），`pnpm build` 成功 |
| 构建产物 | 12 个子路径逐个动态 import 零失败，根 barrel 导出 106 增至 119，旧符号零缺失 |
| 跨仓对账 | 段落切分、选段、复算、覆盖校验、机械首句与 TeamWiki 原实现同输入逐字一致；TeamWiki 与 Ghost 现有 `docskit/*` 导入在 dist 重建后仍正常 |
| 规约校验 | `openspec validate consolidate-evidence-governance --type change` 通过 |
| 文档同步 | AGENTS.md 目录与能力表补 evidence 并把计数改 12，README 能力一览补新行，三份 docs 改掉「尚无对应导出」口径 |

### 验收对照

| 编号 | 结果 |
| :--- | :--- |
| A1 | 通过，typecheck 零错 |
| A2 | 通过，58/58 且不新增失败 |
| A3 | 通过，build 成功且 12 个子路径产物齐备 |
| A4 | 通过，exports 与 entry 键集合逐一对账一致 |
| A5 | 通过，构建前 106 个符号零删减 |
| A6 | 通过，20 项新用例覆盖五类判定的正常与边界 |
| A7 | 通过，同文本复算 true，改正文与改指纹均 false |
| A8 | 通过，新增源码零 `as any`、零 `@ts-ignore`、零原生 `try/catch` |
| A9 | 通过，README、三份 docs、AGENTS.md 与代码导出面一致 |

### 实现偏差与纠偏

- 单测初稿用「改首个标题」判锚点失效，选中段落恰好在另一节，anchor 与 hash 都没变，断言失败。改成改正文内容后通过，并补了引用片段不命中的第三条断言。
- 覆盖校验从下游自写的 `normalizeForCompare` 换成公共底座 `cleanTextForVector`，两组样例与下游输出逐字一致。
- `openspec validate --all` 里既有 7 个 change 仍报失败，它们没有 `specs/` delta，属仓库既有历史状态，与本轮无关，未改动。
- 下游工作树零改动，阶段二三项保持未勾选。

### 阶段二

等 qing 授权后单独开窗：TeamWiki 四个文件与 Ghost 两个文件改 import，跑 13 个 verify 套件与既有单测对账。

> 目录已按层重组，本文历史正文里的 `src/core/...` 路径按取证原则保留。当前物理路径与迁移映射见 `openspec/changes/refactor-engine-purity/proposal.md` 的「后续追加：目录按层重组」。
