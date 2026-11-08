# Proposal: 实现 Cyberbrain 第 1 层：信源摄入与规范化 (Ingestion & Normalization)

- **Change ID**: `layer-1-ingestion-normalization`
- **Status**: in-progress
- **Created**: 2026-11-08
- **Authors**: Technical Lead / Architect (Pairing with Antigravity)

---

## 1. 契约背景与设计动机

根据 `Cyberbrain/docs/CAPABILITIES.md` 知识库生命周期五层流水线设计，**第 1 层：信源摄入与规范化（Ingestion & Normalization）** 的核心目标是：
**在外部文档接触 LLM 或写入磁盘前，完成 100% 纯净、安全、零 Token 开销的幂等与格式归一化。**

当前痛点与整合真源：
1. **纯净内容哈希与 0-Token 幂等门禁 (`cyberbrain/hash`)**：
   - 抹平 `\r\n` 与前后空白后，计算文本 SHA-256。
   - 提取正文主体（剔除 frontmatter 变动干扰，Bit-for-bit 对齐 Ghost `calcRawContentSha256` 逻辑）。
   - 提供 0-Token 幂等检查器，命中时立即短路拦截，杜绝下游无效重算。
2. **Markdown 语法归一化与清洗器 (`cyberbrain/ast/normalize` / `cleanMarkdownContent`)**：
   - 统一换行符为 `\n`，清除连续多余空行；
   - 转换飞书 Callout 组件（`:::tip`, `:::warning` 等）与表情符号为标准 GitHub/Obsidian Blockquote（`> [!TIP]`, `> [!NOTE]`）；
   - 清除危险或无意义 HTML 脏标签；
   - 识别提取外部二进制附件资产，统一留痕；
   - 飞书站内链接转为相对双链指针。
3. **不可变物理快照命名与路由器 (`cyberbrain/ingest/snapshot`)**：
   - 根据 category、标题与 revision 版本，生成标准 `_raw/<category>/<doc>-rev<id>.md` 规范化物理路径；
   - 规范化文件名字符（过滤操作系统非法字符，保持跨平台一致性）。

---

## 2. 编码审美与设计规范

- 采用 TypeScript 纯无状态纯函数设计，无副作用；
- 路径操作依托 `pathe`，流式集合转换依托 `radash`；
- 拒绝命令式 for 循环与脆弱状态机，数据塑形采用集合变换与函数式流；
- 核心函数附带真实 IPO `@example` 注释；
- 暴露标准子路径 `./hash` 与 `./ingest`，并在根入口 `./index.ts` 统一导出。

---

## 3. 验收标准与任务清单

- [ ] 实现 `src/hash/index.ts`（纯净文本与正文 SHA-256 计算、0-Token 幂等检查器）；
- [ ] 实现 `src/ast/normalize.ts`（飞书/网页 Markdown 清洗归一化、Callout 转换、附件提取留痕）；
- [ ] 实现 `src/ingest/snapshot.ts`（快照路径生成、版本号修订解析、文件名安全化）；
- [ ] 更新 `package.json` 与 `tsup.config.ts` 导出新子模块；
- [ ] 编写全面的单元测试 `tests/layer-1.test.ts` 并验证全部通过；
- [ ] 更新 tasks.md 留档对账。
