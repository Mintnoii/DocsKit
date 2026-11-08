# Tasks: 增强结构指标统计与版本快照解析

- [x] 升级 `src/core/ast/normalize.ts` 接入 `unist-util-select` 声明式指标统计 <!-- id: 0 -->
- [x] 创建 `src/core/snapshot/index.ts` 实现路径与版本比对算子 <!-- id: 1 -->
- [x] 导出并在 `src/index.ts` 与 `package.json` / `tsup.config.ts` 注册 <!-- id: 2 -->
- [x] 编写测试用例验证指标与版本解析 <!-- id: 3 -->
- [x] 验证 `pnpm test` / `typecheck` / `build` 全绿 <!-- id: 4 -->
