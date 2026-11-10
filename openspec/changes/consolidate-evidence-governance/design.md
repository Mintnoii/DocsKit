# Design: 证据链与卡片治理函数下沉

## Context

DocsKit 把编译型知识库的通用计算收成纯函数，业务层决定素材来源、卡片去向与检索结果怎么交给模型。TeamWiki 的 OKF v0.3 与 Ghost 的卡片身份契约落地后，一批确定性计算留在了两个下游，且逻辑出现分叉。

四处具体分叉：

1. 段落切分与锚点指纹在 `TeamWiki/src/compile/anchors.ts` 手写了一套行扫描，包含标题栈、段落归一化、sha256 前 8 位、N-Gram 选段与复算。DocsKit 有 `computeTextNgramSimilarity` 与 SHA-256，却没有段落锚点函数。
2. 声明句的 bigram 覆盖与拉丁词全命中校验在 `TeamWiki/src/compile/claims.ts`，和调 LLM 的 `attachClaims` 混在一个文件里。
3. 演化链审计在 `TeamWiki/src/lint/supersede-audit.ts` 里直接 `fs.readdir(join(vaultRoot, "wiki/learning"))`，判定逻辑与业务目录、业务台账形状绑死。
4. Ghost 的 `normalizeReadableTitle` 与 DocsKit 的 `condenseTitle` 都在剥话题标签，规则不同：前者用空格替换并带空值回退，后者用空串替换且截断加省略号。Ghost 的 `sanitizeFileName` 与 DocsKit `snapshot/sanitizeFileName` 也各有一份。

还有一处真实故障要随设计一并解决。TeamWiki 演练时编译锚点基于清洗后正文，审计基于原文，清洗删行造成段落编号错位，指纹对不上被误报为失效。通用函数必须把「前置变换由调用方负责」写成硬契约。

三仓工作树取证：DocsKit 只有上一轮四份文档改动；TeamWiki 约 30 项、Ghost 多项用户自己的未提交改动。本轮写操作限定在 DocsKit 仓。

## Goals

- 五类确定性计算在 DocsKit 有唯一实现，两个下游后续可以只改 import。
- 新增函数全是纯函数，零文件访问、零业务目录、零团队治理语义。
- 同输入下输出与下游现有实现可对齐，阶段二接入不需要改调用语义。
- 公共底座复用到底，短哈希、字符相似度、Frontmatter 与路径处理各只有一份实现。
- 代码、测试、说明文档、OpenSpec 提案四处同生共死。

## Non-Goals

- 不做 OKF v0.3 字段 Schema 与强契约校验。
- 不做模型调用、冲突台账、审计日志、人工签字与 CLI。
- 不改下游两个工作树。
- 不改现有 11 个子路径的签名与行为。
- 不引入新依赖，不改变重型依赖的惰性加载方式。

## Decisions

### D1 新增独立 `evidence` 子路径

**方案**：`src/core/evidence/` 承载段落切分、锚点构建、复算、声明句覆盖与机械首句，`package.json` 增加 `./evidence`。

**备选**：把切分放 `ast`、哈希放 `hash`、覆盖校验放 `shared/numeric.ts`、选段放 `sense`，零新增子路径。

**理由**：证据链是一组内聚契约，生成方与复算方必须消费同一份规则。散进四个模块后，调用方要自己拼装，任何一处阈值改动都会让锚点失效。独立子路径还避开 `ast` 的 mdast 惰性加载链，纯文本处理不需要语法树。

### D2 生成与复算共用同一份输入文本

**方案**：`splitAnchorableParagraphs` 与 `verifySourceRef` 都只接收调用方已备好的 Markdown 字符串，内部只做 CRLF 抹平与段落归一化，不做 Frontmatter 剥离或额外清洗。文档与类型注释写明这层契约。

**备选**：函数内部自动剥离 Frontmatter 并清洗全文，降低调用方负担。

**理由**：TeamWiki 已因两侧清洗不一致踩过误报。自动生成会让调用方无法保证生成与复算走同一份变换，把确定性交给隐式行为。契约直给，责任留给调用方。

### D3 演化链与身份巡检做成纯数据判定

**方案**：`auditSupersedeChain(cards, conflicts)` 接收卡片元数据数组与冲突记录数组，返回违规清单与统计；`checkTitleStemConsistency(cards)` 接收 `{ stem, title, path }` 数组，返回 issue 数组。两者都不 import `node:fs`。

**备选**：把 TeamWiki 的 `auditSupersedeChain` 原样搬进 DocsKit，保留 `vaultRoot` 参数与读盘。

**理由**：原样搬运会把 `wiki/learning` 与业务台账结构写进通用引擎，违反 AGENTS.md 的零业务硬编码。读盘由调用方做，判定归内核，两侧都能单独测试。

### D4 路径仲裁只返回判定

**方案**：`resolveCardPathCollision({ targetPath, existingHash, incomingHash, sourceFile, occupiedPaths })` 返回 `{ action: "use" | "skip" | "rename", path, identical }`。同名不同内容时按 `sourceFile` 短哈希生成稳定后缀，后缀已占用则递增序号。

**备选**：内核用 `fs.access` 探测空位。

**理由**：文件访问属副作用，纯函数不该碰。传入已占用路径集合后，判定可复现、可单测，也避开 Windows 下路径大小写与 junction 的差异。

### D5 策略参数声明式直给

**方案**：段落最小长度、quote 上限、claim 上限、bigram 覆盖率阈值、选段条数、短哈希位数都通过 `EvidenceOptions` 传入，默认值与下游现有行为一致。

**备选**：在内核里写死常量，调用方无法调整。

**理由**：阈值是策略不是规则，写死会让第二个消费方被迫接受第一个消费方的取值。默认值保留向下兼容，参数化不增加调用复杂度。

### D6 底座复用，不新增重复实现

**方案**：短哈希下沉到 `hash/index.ts` 的 `computeShortHash`，段落指纹与路径后缀都消费它；选段打分用 `computeTextNgramSimilarity`；字组归一的去标点去空白用 `cleanTextForVector`；路径用 `pathe`；标题规范化新增到 `shared/markdown.ts`，`condenseTitle` 与 `snapshot/sanitizeFileName` 原样保留。

**备选**：在 `evidence` 内部自己算 sha256 与 bigram，标题规范化另起一个模块。

**理由**：同名概念多套数值结果会让去重、检索、锚点三条链路互相矛盾。保留旧函数是为了向后兼容，新增函数与旧函数职责不同，不互相替代。

### D7 治理字段与模型判定不下沉

**方案**：OKF v0.3 的 `owner`、`reviewer`、`conflict`、`superseded_by`、`source_ref` 等字段形状留在 TeamWiki 的 zod 契约里；`attachClaims`、`judgeRelation`、台账读写与签字命令留在业务层。内核只认中性的 `status`、`supersededBy`、`decision` 这类判定所需字段。

**备选**：把 v0.3 Schema 直接搬进 `docskit/okf`。

**理由**：团队责任链、复审 SLA 与裁决流程是组织语义，通用引擎写进去就绑死了单一消费方。字段形状变了不该逼所有知识库一起升级。

### D8 本轮实现锁在 DocsKit 仓

**方案**：提案、代码、测试、文档全部落在 DocsKit；下游接入写成 tasks.md 阶段二，明确标注未授权不动。

**备选**：同轮把 TeamWiki 与 Ghost 的对应文件改成从 `docskit/evidence` 等子路径导入。

**理由**：两仓当前都有用户自己的未提交改动，混入本轮会分不清是谁的变更。DocsKit `AGENTS.md` 也要求通用引擎先跑通测试再供各项目使用。

## 数据流

```text
业务层读底座素材 → 自己完成清洗与规范化
                 ↓
        splitAnchorableParagraphs(markdown, options)
                 ↓
        buildSourceRefs(paragraphs, query, options) → SourceRef[]
                 ↓
        模型写 claim（业务层） → checkClaimCoverage → 不通过退 mechanicalClaim
                 ↓
        卡片落盘前：resolveCardPathCollision 决定路径
                 ↓
        巡检：auditSupersedeChain / checkTitleStemConsistency 只收数据数组
                 ↓
        复算：verifySourceRef(ref, 同一份规范化文本)
```

## 兼容性设计

`src/index.ts` 同时维护命名空间导出与扁平导出，新增 `evidence` 两行。构建前用导出名集合比对确认零删减。`tsup` 的 `clean: true` 会清空 `dist/`，而两个下游通过 junction 直接消费 `dist/`，所以 build 必须在 typecheck 与 test 全绿之后执行，执行完立刻逐个 import 验证 12 个子路径。

## 测试策略

单文件 `tests/evidence-and-governance.test.ts` 分组覆盖：段落切分（标题栈、序号、CRLF、短段落丢弃）、锚点复算（一致通过、改字失效、quote 截断）、选段（正分排序、全零退化、limit）、覆盖校验（中文 bigram、拉丁词缺失、机械首句）、演化链五类违规、身份一致性、路径仲裁四种判定、标题规范化四类边界。期望值按下游现有规则写死，保证阶段二接入时行为可对齐。

另跑一次性对账：构建后列出 12 个子路径导出，比对 `package.json exports` 与 `tsup.config.ts` entry 键集合，确认三处一致。
