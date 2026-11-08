# Proposal: 知识库编译通用流水线与模块架构重构 (Configurable Pipeline Engine)

- **Change ID**: `configurable-pipeline-engine`
- **Status**: in-progress
- **Created**: 2026-11-09
- **Authors**: Technical Lead / Architect (Pairing with Antigravity)

---

## 1. 契约背景与设计动机

在最初的 `CAPABILITIES.md` 设计与讨论中，曾尝试将编译逻辑与具体业务工程（Ghost / TeamWiki）挂钩，或过度拆解为琐碎的文档形态分支（Concept / Spec / Report 等）。经过第一性原理审判，确立了全新的正交架构：

1. **彻底解耦业务项目名称**：
   - 严禁在 Cyberbrain 底层及流水线中硬编码 `Ghost`、`TeamWiki` 或任何私有平台名字；
   - 通用引擎定位于：**纯无状态算子库（Core Atoms） + 声明式可组合编译流水线（Configurable Pipeline）**。
2. **拒绝过度琐碎分类，回归编译第一性**：
   - 知识库流水线本质上只有 4 个正交阶段：
     - **清洗 (Sanitize)**：换行抹平、未闭合语法修复、Callout 转换、附件链接识别；
     - **门禁 (Gate)**：0-Token 纯正文哈希幂等短路、`lock: human` 人工锁阻断；
     - **编译与合并 (Compile & Patch)**：
       - `patch`（90% 场景）：按章节 AST 差量对账，保留全文主干与接口完整性，支持已删章节/接口注入废弃警示；
       - `distill`：抽取核心定义、IPO 结构与精选代码；
       - `passThrough`：直通清洗后正文；
     - **索引与感知 (Index)**：BM25 词项倒排、Late Chunking 高精向量、双链拓扑。
3. **支持灵活声明式配置与功能开关**：
   - 允许外部调用者通过强类型 `PipelineOptions` 注入元数据 Schema、字段转换钩子及功能开关（如 `deprecationNotice`, `idempotency`, `humanLock`）。

---

## 2. 架构拓扑与目录调整

```text
Cyberbrain/
├── AGENTS.md                          # 跨 Agent 唯一规范真理源
├── package.json                       # 模块导出定义
├── docs/                              # 架构演进文档
├── src/
│   ├── index.ts                       # 统一聚合导出
│   │
│   ├── core/                          # 【底座：纯无状态通用算子 · 零业务偏见】
│   │   ├── hash/                      # 换行抹平、SHA-256、正文指纹提取、0-Token 幂等拦截
│   │   ├── ast/                       # MDAST 语法树安全解析、章节切块、表格代码块提取、通用清洗
│   │   ├── patch/                     # 章节 AST 差量对账、废弃标记注入
│   │   ├── sense/                     # BM25、Late Chunking、RRF 融合
│   │   ├── graph/                     # 双向双链 Outbound / Backlinks 依赖拓扑
│   │   └── lint/                      # 死链巡检、人工锁校验、过期文档审计
│   │
│   └── pipeline/                      # 【流水线：声明式编排与组合器】
│       ├── options.ts                 # PipelineOptions 强类型契约
│       └── runner.ts                  # runPipeline 执行管道
│
└── tests/
    ├── core/                          # 纯算子测试
    └── pipeline/                      # 流水线组合功能测试
```

---

## 3. 验收标准与任务清单

- [ ] 更新 `docs/CAPABILITIES.md` 固化本轮架构决议，清除具体业务项目绑定；
- [ ] 调整 `src/` 目录组织，将底层纯算子归整至 `src/core/`；
- [ ] 实现 `src/pipeline/options.ts` 强类型定义；
- [ ] 实现 `src/pipeline/runner.ts` 声明式执行器；
- [ ] 重新导出 `src/index.ts` 并更新 `package.json` 与 `tsup.config.ts`；
- [ ] 编写全景单测 `tests/pipeline/pipeline.test.ts`，验证全部通过；
- [ ] `pnpm typecheck` 与 `pnpm build` 100% 成功。
