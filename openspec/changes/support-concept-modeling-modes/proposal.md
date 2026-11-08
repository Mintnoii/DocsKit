# Proposal: 提纯模块支持 OKF v0.2 概念建模三大形态 (IPO / Decomposition / Hybrid)

- **Change ID**: `support-concept-modeling-modes`
- **Status**: in-progress
- **Created**: 2026-11-09
- **Authors**: Technical Lead / Architect (Pairing with Antigravity)

---

## 1. 契约背景与设计动机

概念提炼不能单一写死为 IPO。根据 OKF v0.2 与知识库工程实践，概念建模有三种正交的架构形态：
1. **`ipo`（纯 IPO 算子模型）**：单步原子机制，确定性输入 (Input) $\to$ 核心处理 (Process) $\to$ 确定性产出 (Output)；
2. **`decomposition`（纯分解模型）**：多阶段工作流，拆解为递进工序阶段，交代目标、核心动作与准入准出；
3. **`hybrid`（混合建模架构）**：外层声明全局宏观 IPO 契约，内层递进推进步骤解耦装配底层子概念。

---

## 2. 改造方案

1. 在 `src/core/ast/distiller.ts` 中引入 `ConceptModeling = "ipo" | "decomposition" | "hybrid"`；
2. `distillMarkdownContent` 支持传入 `DistillOptions`，按形态动态生成正文骨架与标注；
3. 在 `src/pipeline/options.ts` 中增加 `modeling?: ConceptModeling`，并在 `runPipeline` 的 Frontmatter 中自动同步写入 `modeling: options.modeling`；
4. 编写全景单元测试覆盖这 3 种建模方式。
