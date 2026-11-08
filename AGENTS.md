---
type: meta
title: "AGENTS.md — Cyberbrain (電脳) 知识库编译通用引擎跨 Agent 规范"
created: 2026-11-08
updated: 2026-11-08
tags: [meta, cross-agent, truth-source, architecture, cyberbrain, bebop, ast, rrf, late-chunking]
status: evergreen
---

# AGENTS.md — Cyberbrain (電脳) 跨 Agent 唯一规范与通用契约

> 🧠 **Cyberbrain (電脳)**：Bebop 全机编译型知识库的**纯通用计算与处理引擎**。  
> 上承 **Ghost（个人第二大脑）** 与 **TeamWiki（团队知识中枢）**，下接文件系统与代码助手 (Cursor / Claude Code / Windsurf)。  
> 核心原则：**AI 是执行者，技术负责人是裁判；通用算法只写一份，杜绝重复手搓。**

---

## 1. 核心定位与设计原则 (Core Philosophy)

Cyberbrain 彻底解决多个知识库项目之间“重复写相似代码、算法版本不一致”的痛点，将所有**文档清洗、编译合并、搜索检索的通用算法**统一下沉为唯一公共库：

1. **业务与底层算法彻底分开**：
   - 业务项目（Ghost / TeamWiki）专心做自己的事：飞书拉取、微信/网页剪藏、网页展示部署；
   - 通用引擎（Cyberbrain）只做纯算法：Markdown 语法树清洗、章节切块、修改内容自动合并、关键词+向量混合搜索、章节级高精度特征计算、前后卡片关联引用。
2. **入库编译，拒绝生硬切片**：
   - 坚决摒弃把未清洗长文档硬切成碎块直接扔进向量库的粗暴做法；
   - 外部文档入库时先提炼核心要点，与已有卡片按章节比对合并，不丢弃老知识。
3. **纯本地轻量运行，不装笨重数据库**：
   - 不依赖外部笨重的向量数据库集群；
   - 底层全部使用人类可读的 Markdown 文件与本地轻量特征文件，断网也能秒级运行。
4. **模型权重全电脑只存一份**：
   - 向量计算统一使用轻量离线模型；
   - 统一缓存在 `~/.cache/onnx-models/`，所有项目共用同一份模型文件，绝不重复下载、不浪费磁盘。

---

## 2. 仓库目录结构 (Repository Structure)

```text
Cyberbrain/
├── AGENTS.md              # 本文件：跨 Agent 规范真理源
├── package.json           # 模块定义 (cyberbrain)
├── tsconfig.json          # TypeScript 配置
├── tsup.config.ts         # 打包构建配置
├── openspec/              # 方案演进与任务提案
│   └── changes/           # 提案变更记录
├── docs/                  # 架构与能力分层路线图 (CAPABILITIES.md)
├── src/                   # 核心计算与算法源码
│   ├── index.ts           # 统一对外导出入口
│   ├── ast/               # Markdown 语法树安全解析、章节切块、表格与代码块提取
│   ├── patch/             # 新老文档章节对比、局部修改合并、已删接口标记已废弃
│   ├── sense/             # 关键词精确搜索 (BM25)、向量搜索、多路结果合并、章节精确特征计算
│   ├── graph/             # 前后卡片引用关系图（知道当前卡片被谁依赖、依赖了谁）
│   └── lint/              # 死链检查、卡片格式检查、过期文档提醒、人工锁定保护
└── tests/                 # 通用自动化测试用例
```

---

## 3. 各模块核心能力与白话解释

| 模块 | 子路径 | 核心对外函数 | 到底解决了什么问题？（白话解释） |
| :--- | :--- | :--- | :--- |
| **语法树解析** | `cyberbrain/ast` | `parseMarkdownWithAST`<br>`distillMarkdownContent` | 用真正的语法树切分文章章节，代码块里的注释和复杂表格绝不会被切碎切烂。 |
| **修改合并与废弃保护** | `cyberbrain/patch` | `diffDocumentSections`<br>`applySectionPatch` | 文档改动时只针对改动章节打补丁；发现老接口被删时不直接删除，而是打上“已废弃”警告，避免老系统查不到。 |
| **混合搜索与高精度特征** | `cyberbrain/sense` | `BM25Engine`<br>`computeLateChunking`<br>`rrfFuseScores` | 精确查函数名/错误码 + 语义查大意，结合全局上下文给每个小章节生成高精度向量，秒级精准定位到某一段。 |
| **前后引用关系图** | `cyberbrain/graph` | `buildBacklinksGraph`<br>`extractOneHopGraph` | 自动理清卡片间的 `[[双链]]`：查某个底层公用库时，自动提醒你“改动它会影响下游哪些业务卡片”。 |
| **文档体检与保护** | `cyberbrain/lint` | `lintVaultLinks`<br>`checkHumanLock`<br>`auditLifecycle` | 检查全库死链、提醒超过 90 天没更新的老文档；对于人工标记了 `lock: human` 的核心卡片，坚决不让 AI 脚本擅自修改。 |

---

## 4. 跨项目使用铁律

1. **禁止在各个项目里重复抄代码**：
   - 只要是 Markdown 语法解析、搜索算法、向量计算的代码，**一律从 `cyberbrain` 引入**，禁止在 Ghost 或 TeamWiki 内部另写一份。
2. **底层引擎不写死具体业务**：
   - 通用引擎里的所有函数必须是通用的，文件路径、分类名字等由具体业务项目作为参数传进来，内核不绑死任何项目私有逻辑。
3. **改动先在提案留档**：
   - 通用引擎要做重大改动或加新算法，先在 `Cyberbrain/openspec/changes/` 下记下方案并跑通测试，确认无误再供各项目使用。
