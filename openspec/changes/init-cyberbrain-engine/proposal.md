# Proposal: 初始化 Cyberbrain (電脳) 跨工程编译型知识库通用引擎

- **Change ID**: `init-cyberbrain-engine`
- **Status**: in-progress
- **Created**: 2026-11-08
- **Authors**: Technical Lead / Architect (Pairing with Antigravity)

---

## 1. 契约背景与设计动机

在长期迭代 Ghost（个人第二大脑）与 TeamWiki（团队知识中枢）的过程中，底层编译优先（Compile-over-Retrieval）的核心能力出现了重复开发与版本分化：
- MDAST 语法树清洗与章节分块逻辑存在代码复制；
- BM25 稀疏检索算法与 SIGIR RRF 融合公式两边独立实现；
- 本地轻量 ONNX Late Chunking 特征池化与反向双链图伴随需要全机统一消费。

为了终结跨项目复制代码与逻辑漂移，立项本提案：**将所有属于知识库编译、对账、感知、检索与巡检的无状态算法能力彻底抽离，初始化为通用内核工程 `@bebop/cyberbrain`**。

---

## 2. 核心模块与首期下沉范围

1. **AST 语法树模块 (`src/ast/`)**：
   - 将已在 TeamWiki 验证成熟的 MDAST Visitor 访问者模式解析器移入，导出 `parseMarkdownWithAST` 与 `distillMarkdownContent`。
2. **感知检索模块 (`src/sense/`)**：
   - 整合 `BM25Engine`、`rrfFuseScores`；
   - 整合今日落地的 `computeLateChunking` 通用 ONNX 特征池化引擎（共享 `~/.cache/onnx-models/` 离线权重）。
3. **差量打补丁模块 (`src/patch/`)**：
   - 下沉段落级 AST 差量对比与章节废弃标记逻辑（`diffDocumentSections`, `applySectionPatch`）。
4. **拓扑与巡检模块 (`src/graph/`, `src/lint/`)**：
   - 导出通用的双向双链图谱构建器与 OKF v0.2 Schema 巡检规则。

---

## 3. 验收标准与任务清单

- [x] 初始化 `Cyberbrain/` 独立工程骨架（`package.json`, `tsconfig.json`, `tsup.config.ts`）；
- [x] 建立跨 Agent 最高宪法 `Cyberbrain/AGENTS.md`，确立无状态与解耦契约；
- [ ] 移植并导出 `src/ast/`、`src/sense/` 核心算法模块；
- [ ] 编写全景单测，验证纯无状态 API 在多场景下正确运行；
- [ ] 在 `dotagents/AGENTS.md` 注册全机工作空间路由，使 Bebop 多 Agent 体系完整感知新内核。
