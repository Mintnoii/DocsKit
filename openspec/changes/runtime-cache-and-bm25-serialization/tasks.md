# Tasks: 运行时编译缓存与 BM25 序列化持久化

## 阶段一：核心实现与验证 (本轮落地)

- [x] 在 `src/index.ts` 顶层接入 `enableCompileCache` 优雅降级 <!-- id: 0 -->
- [x] 在 `src/layers/retrieval/sense/bm25.ts` 定义 `BM25SerializedIndex` 强契约接口 <!-- id: 1 -->
- [x] 在 `BM25Engine` 实现 `exportIndex(): BM25SerializedIndex` <!-- id: 2 -->
- [x] 在 `BM25Engine` 实现 `importIndex(serialized: BM25SerializedIndex): void` <!-- id: 3 -->
- [x] 在 `BM25Engine` 实现静态工厂方法 `BM25Engine.fromIndex(serialized: BM25SerializedIndex): BM25Engine` <!-- id: 4 -->
- [x] 导出 `BM25SerializedIndex` 并在 `src/layers/retrieval/sense/index.ts` re-export <!-- id: 5 -->
- [x] 编写单测验证序列化导出、恢复与搜索评分严格等价性 <!-- id: 6 -->
- [x] 验证 `pnpm typecheck` 0 错，`pnpm test` 全绿 (72/72)，`pnpm build` 成功 <!-- id: 7 -->
- [x] 对账完成 tasks.md 勾选并完成提案验证 <!-- id: 8 -->
