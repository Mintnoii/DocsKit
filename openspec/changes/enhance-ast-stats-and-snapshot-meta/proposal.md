# Proposal: 增强 Cyberbrain 结构指标统计与版本快照解析算子

- **Change ID**: `enhance-ast-stats-and-snapshot-meta`
- **Status**: in-progress
- **Created**: 2026-11-09
- **Authors**: Technical Lead / Architect (Pairing with Antigravity)

---

## 1. 契约背景与设计动机

通过对 TeamWiki 第 1 层真实场景的审查，提炼并增强两项高内聚、纯算子能力：
1. **基于 `unist-util-select` 的 AST 结构指标统计**：
   - 彻底消灭用字符串正则扫描 `mermaid` 与表格的脆弱代码；
   - 采用统一的 MDAST CSS 选择器声明式选出 `code[lang="mermaid"]`、`table`、`code`、`blockquote`；
   - 整合至 `normalizeMarkdownContent` 的 `stats` 产出中。
2. **基于 `pathe` + `semver` 的快照路径与版本比对算子 (`core/snapshot`)**：
   - 使用 `pathe.dirname` / `pathe.basename` 解构快照的分类与标题，消灭脆弱的数组切片；
   - 支持整数 revision（如 `-rev12`）与 SemVer 版本号的高健壮比对，支持 0-Token 防抖拦截。

---

## 2. 验收清单

- [ ] 在 `src/core/ast/normalize.ts` 中使用 `unist-util-select` 增强结构指标；
- [ ] 在 `src/core/snapshot/index.ts` 中实现纯路径解构与版本比对函数；
- [ ] 导出新算子并编写单元测试验证；
- [ ] 验证 `pnpm test` / `typecheck` / `build` 全绿并留档。
