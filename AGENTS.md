---
type: meta
title: "AGENTS.md — DocsKit 知识库编译通用引擎跨 Agent 规范"
created: 2026-11-08
updated: 2026-11-09
tags: [meta, cross-agent, truth-source, architecture, docskit, bebop, ast, rrf, late-chunking]
status: evergreen
---

# AGENTS.md — DocsKit 跨 Agent 唯一规范与通用契约

> **DocsKit**：Bebop 全机编译型知识库的**纯通用计算与处理引擎**。
> 上承 **Ghost（个人第二大脑）** 与 **TeamWiki（团队知识中枢）**，下接文件系统与代码助手 (Cursor / Claude Code / Windsurf)。  
> 核心原则：**AI 是执行者，技术负责人是裁判；通用算法只写一份，杜绝重复手搓。**

---

## 1. 核心定位与设计原则 (Core Philosophy)

DocsKit 彻底解决多个知识库项目之间“重复写相似代码、算法版本不一致”的痛点，将所有**文档清洗、编译合并、搜索检索的通用算法**统一下沉为唯一公共库：

1. **业务与底层算法彻底分开**：
   - 业务项目（Ghost / TeamWiki）专心做自己的事：飞书拉取、微信/网页剪藏、网页展示部署；
   - 通用引擎（DocsKit）只做纯算法：Markdown 语法树清洗、章节切块、修改内容自动合并、关键词+向量混合搜索、章节级高精度特征计算、前后卡片关联引用。
2. **入库编译，拒绝生硬切片**：
   - 坚决摒弃把未清洗长文档硬切成碎块直接扔进向量库的粗暴做法；
   - 外部文档入库时先提炼核心要点，与已有卡片按章节比对合并，不丢弃老知识。
3. **纯本地轻量运行，不装笨重数据库**：
   - 不依赖外部笨重的向量数据库集群；
   - 底层全部使用人类可读的 Markdown 文件与本地轻量特征文件，断网也能秒级运行。
4. **模型权重全电脑只存一份**：
   - 向量计算统一使用轻量离线模型；
   - 统一缓存在 `~/.cache/onnx-models/`，所有项目共用同一份模型文件，绝不重复下载、不浪费磁盘。
5. **消灭胶水代码与原始拼接（语法树与声明式优先）**：
   - 坚决贯彻 `SYSTEM_PROMPT.md` 编码审美：表格绝不手动手搓 `|` 管道符，长文生成一律使用 `outdent` 模板标签；
   - Frontmatter 采用 `eemeli/yaml` 规范引擎接管，杜绝路径斜杠与双链字符引发的崩溃，确保标量绝对安全。

---

## 2. 仓库目录结构 (Repository Structure)

```text
DocsKit/
├── AGENTS.md              # 本文件：跨 Agent 规范真理源
├── README.md              # 开源项目门面
├── package.json           # 模块定义 (docskit)
├── tsconfig.json          # TypeScript 配置
├── tsup.config.ts         # 打包构建配置
├── openspec/              # 方案演进与任务提案
│   └── changes/           # 提案变更记录
├── docs/
│   ├── CAPABILITIES.md                         # 能力与四阶段分层路线图
│   ├── BUILDING-VAULTS.md                     # 用 DocsKit 搭建知识库的可运行配方
│   ├── OKF-v0.2-SPECIFICATION.md              # 卡片元数据与正文契约
│   └── ghost-teamwiki-distinction-dialogue.md # 双轨策略决策留档
├── src/
│   ├── index.ts           # 统一门面：命名空间导出 + 扁平函数导出（纯 barrel，不维护手工清单）
│   ├── core/              # 公共底座 + 无状态领域算法模块
│   │   ├── shared/        # 【公共底座】唯一 Frontmatter/排版入口与唯一数值相似度函数
│   │   │   ├── index.ts   # 底座统一导出
│   │   │   ├── markdown.ts # parseMarkdownSafely / stringifyMarkdownSafely / outdent / renderMarkdownTable
│   │   │   └── numeric.ts # N-gram 词表 / 余弦 / L2 归一化 / Bigram Dice
│   │   ├── ast/           # 语法树解析、章节切块、清洗归一、OKF 元数据、文件扫描
│   │   ├── patch/         # 章节差量对账、废弃标记、四级级联去重门禁
│   │   ├── snapshot/      # 快照路径、版本比对、URL 归一化与墓碑账本
│   │   ├── sense/         # BM25、RRF、Late Chunking、Rerank、混合检索管道
│   │   ├── graph/         # 双链提取与双向 1-Hop 拓扑图
│   │   ├── lint/          # 死链、Schema、生命周期、路径守护、重复卡片排查
│   │   ├── hash/          # 纯正文 SHA-256 与 0-Token 幂等门禁
│   │   └── jit/           # JIT 上下文渐进式装配函数
│   ├── pipeline/          # 声明式编译流水线（options / runner）
└── tests/                 # 通用自动化测试用例
```

---

## 3. 各模块核心能力与白话解释

| 模块 | 子路径 | 核心对外函数 | 到底解决了什么问题？（白话解释） |
| :--- | :--- | :--- | :--- |
| **公共底座** | `docskit/shared` | `parseMarkdownSafely`<br>`stringifyMarkdownSafely`<br>`renderMarkdownTable`<br>`computeTextNgramSimilarity`<br>`cosineSimilarityVectors`<br>`normalizeVector` | 把 Frontmatter 读写、表格排版与字符相似度收敛为全机唯一实现，业务模块只消费不重写，杜绝同名概念多套数值结果。 |
| **快照与防重墓碑** | `docskit/snapshot` | `parseSnapshotMeta`<br>`buildSnapshotPath`<br>`cleanUrlKey`<br>`buildTombstoneIndex`<br>`isTombstoneHit` | 声明式解析快照文件名与版本；提供跨平台 URL 核心特征清洗与墓碑账本函数，记录用户放弃/低质素材特征，上游秒级阻断死灰复燃。 |
| **语法树解析与文本函数** | `docskit/ast` | `parseMarkdownWithAST`<br>`distillMarkdownContent`<br>`outdent`<br>`renderMarkdownTable`<br>`parseMarkdownSafely`<br>`readMarkdownFile`<br>`dropSection`<br>`extractSection`<br>`hasWikiLink`<br>`hasSourceLink`<br>`appendUnderHeading`<br>`getMarkdownFiles`<br>`sanitizeLatexToUnicode`<br>`extractDocumentTitle` | 用真正的语法树切分文章章节，代码块里的注释和复杂表格绝不会被切碎切烂；自带纯声明式 outdent 模板标签、表格渲染与文件读取函数，提供章节定向剔除/提取、双链识别、非标 LaTeX 字符清洗与层级标题提取；基于 fdir 提供毫秒级跨平台 POSIX 路径扫描。 |
| **哈希与 0-Token 幂等** | `docskit/hash` | `computeContentHash`<br>`computeMarkdownBodyHash`<br>`calcRawContentSha256`<br>`checkContentIdempotency` | 抹平换行符后纯文本与纯 Markdown 正文 SHA-256 计算；提供 O(1) 纯内存 0-Token 编译前幂等拦截。 |
| **修改合并与级联去重** | `docskit/patch` | `diffDocumentSections`<br>`applySectionPatch`<br>`evaluateDedupGate`<br>`findFuzzyLexicalMatch`<br>`findMostSimilarVector`<br>`computeNgramSimilarity` | 文档改动时章节比对合并，已删接口打废弃警告；内置四级级联去重门禁（规范化直取、括号核心名提取、Fuse.js 长度比率词形模糊匹配、向量余弦语义池与 N-gram 字符级兜底），严防短词吞并长词。 |
| **混合搜索与高精度特征** | `docskit/sense` | `BM25Engine`<br>`computeLateChunking`<br>`rrfFuseScores`<br>`locateTopSectionsWithLateChunking` | 精确查函数名/错误码 + 语义查大意，结合全局上下文给每个小章节生成高精度向量，秒级精准定位到某一段。 |
| **前后引用关系图** | `docskit/graph` | `indexBidirectionalGraph`<br>`extractWikilinks`<br>`extractWikiOutboundLinks`<br>`countContentWords`<br>`normalizeWikilinkTarget` | 剥离代码围栏与行内代码精准提取 `[[双链]]` 并清洗锚点/扩展名；自动理清卡片间的双向 1-Hop 拓扑网，提供 CJK+Latin 统一字数统计。 |
| **文档体检与重复排查** | `docskit/lint` | `auditDirectoryVault`<br>`lintVaultTopology`<br>`auditVaultLifecycle`<br>`loadVaultCardNodes`<br>`isProtectedPath`<br>`evaluateToolCallPathGuard`<br>`computeBigramDiceSimilarity`<br>`findHighSimilarityCardPairs`<br>`analyzeCardLifecycle` | 检查全库死链、孤立卡片与 OKF Schema 格式；提醒过期老卡与人工锁定保护；提供通用只读物理底座拦截门禁；基于 2-gram Dice 与归一化余弦点积计算全库卡片高相似度冗余对，给出合并建议。 |
| **JIT 渐进装配** | `docskit/jit` | `formatAgentJITPrompt` | 提供符合 Karpathy LLM-Wiki 规范的三级装配上下文（指针+摘要 / 深度正文），自动嵌入 1-Hop 依赖与受影响下游，控制 Token 预算。 |

---

## 4. 跨项目使用铁律

1. **禁止在各个项目里重复抄代码**：
   - 只要是 Markdown 语法解析、搜索算法、向量计算的代码，**一律从 `docskit` 引入**，禁止在 Ghost 或 TeamWiki 内部另写一份。
2. **底层引擎不写死具体业务**：
   - 通用引擎里的所有函数必须是通用的，文件路径、分类名字等由具体业务项目作为参数传进来，内核不绑死任何项目私有逻辑。
3. **改动先在提案留档**：
   - 通用引擎要做重大改动或加新算法，先在 `DocsKit/openspec/changes/` 下记下方案并跑通测试，确认无误再供各项目使用。

---

## 5. 公共底座与编码审美铁律 (Shared Foundation & Code Aesthetics)

本库自身即全机「编译型知识库通用引擎」的审美标杆，新增代码起手必须满足以下硬反射：

1. **底座唯一**：任何 Frontmatter 解析/序列化一律走 `shared/markdown.ts`，严禁在业务模块裸调 `gray-matter` 或手写 `---` 切片；任何字符级相似度、余弦、向量归一化一律走 `shared/numeric.ts`，严禁另起一份实现；表格一律走 `renderMarkdownTable`，长文模板一律走 `outdent`，严禁手搓管道符与 `let text +=`。
2. **库优先于手搓**：路径一律 `pathe`（`normalize` / `basename` / `extname`），路径路由一律 `picomatch`，集合变换与排序一律 `radash`（`sift` / `unique` / `group` / `max` / `sum`），外部调用异常一律 `radash.tryit`，契约校验一律 `typebox` 与 `node:assert/strict`。严禁手写过程式 `for` + `push` 游标、`Array.isArray` 防御八股、原生 `try/catch` 与 `: any`。
3. **契约信任与源头治理**：上游已保证格式的数据直接解构；元数据评估字段（`status` / `confidence` / `summary`）由上游 LLM 显式给定，代码严禁写死默认值伪造结论，亦严禁在下游补写 `.trim()` 兜底。
4. **引擎零业务硬编码**：通用函数不得写死 `_raw/`、`wiki/areas/` 等具体业务目录；需要过滤时由业务层通过参数（如 `excludePrefixes` / `exclude`）传入。
5. **门面零双份维护**：`src/index.ts` 只做 barrel 导出，新增函数在所属模块导出一次即可；`package.json exports` 子路径与 `tsup.config.ts` entry 键必须一一对账。
6. **两轮主动深挖**：重构收工前扫一遍残留 `startsWith` / `Array.isArray` / `typeof === "string"` / 嵌套三元 / 马甲函数，并复核每个模块是否真的消费了已引入的工具库。
7. **术语平实统一**：可调用单元一律叫「纯函数」或「函数」，严禁用「算子」「原语」等数学大词包装字符串处理与文件读写；「底座」只用于指目录与模块层。历史提案与思辨留档按取证原则保留当时的原词。
