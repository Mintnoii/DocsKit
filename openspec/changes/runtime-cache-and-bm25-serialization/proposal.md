# Proposal: 运行时编译缓存与 BM25 倒排索引序列化持久化 (Runtime Cache & BM25 Serialization)

- **Change ID**: `runtime-cache-and-bm25-serialization`
- **Status**: in-progress
- **Created**: 2026-11-11
- **素材源流**: 针对 Markdown 编译引擎与知识检索性能研讨，收敛确立 4 个优化方向（V8 编译缓存、BM25 索引持久化、字符级 Diff、Rust Wasm 解析器）并裁决主线落地前 2 项。
- **关联提交**: `79a2acc` (已完成分层重组与全仓 JSDoc 注释收敛)

---

## 1. 架构技术雷达与方向裁决 (Technology Radar)

在知识库大规模文档处理与检索提速场景中，梳理评估了 4 个潜在技术方向并作出明确工程裁决：

| 序号 | 优化方向 | 方案评估与裁决 | 最终决策 |
| :--- | :--- | :--- | :--- |
| **方向 1** | **Node.js 原生 V8 编译缓存** | 依托 Node.js 22.8+ 原生 `module.enableCompileCache()`，把 CLI 与模块解析的字节码缓存到磁盘。**0 额外第三方依赖**，冷启动提升显著。 | **✅ 立即落地 (P0)** |
| **方向 2** | **BM25 倒排索引序列化与持久化** | 为 `BM25Engine` 扩充纯内存 `exportIndex()` / `importIndex()` 以及结构化 `dump()` / `load()`。下游知识库（Ghost/TeamWiki）构建期建好索引后可直接落盘 `index.json`，二次检索与热重启时直接毫秒级反序列化，无需重新对全量卡片做 2-Gram 昂贵分词。 | **✅ 立即落地 (P1)** |
| **方向 3** | **AST / 字符级行 Diff (`jsdiff`)** | 引入 Token 级 Diff 算法矩阵。但 DocsKit 本质是知识库编译引擎而非代码协同编辑器，章节粒度比对 (`UPDATED` / `DEPRECATED`) 已满足卡片演化需求，细粒度差量会破坏常青卡片整洁度并增加不必要计算。 | **❌ 否决暂缓 (保持极简，不做过度工程)** |
| **方向 4** | **Rust/Wasm 语法树解析器 (`pulldown-cmark`)** | 极限提升 Markdown 解析吞吐，但当前卡片体量下纯 JS `mdast` 配合惰性加载单例足以毫秒响应，过早引入跨语言 Wasm 会增加打包分发复杂度。 | **❌ 否决暂缓 (超万卡大库时再做)** |

---

## 2. 目标方案 (Implementation Design)

### 2.1 方向 1：Node.js 原生 V8 编译缓存
- 在 DocsKit 统一门面入口 `src/index.ts` 顶层首行，安全检测并调起 `node:module` 的 `enableCompileCache()`；
- 遵循优雅降级：若在旧版 Node 或非 Node 环境（如边缘 Worker/浏览器环境测试）下 `enableCompileCache` 为 undefined，静默跳过，绝不抛出异常。

### 2.2 方向 2：BM25 倒排索引可序列化导出与毫秒还原
- 契约设计：
  ```typescript
  export interface BM25SerializedIndex {
    readonly version: 1;
    readonly k1: number;
    readonly b: number;
    readonly avgdl: number;
    readonly docCount: number;
    readonly docs: readonly [string, BM25Doc][];
    readonly invertedIndex: readonly [string, readonly [string, number][]][];
  }
  ```
- 能力实现：
  1. `exportIndex(): BM25SerializedIndex`：把当前实例内部的 `docs` Map、`invertedIndex` Map 及其嵌套 posting list 转换为可直接进行 `JSON.stringify` 的纯 JSON-Safe 对象；
  2. `importIndex(serialized: BM25SerializedIndex): void`：从结构化对象瞬时重建内部 `Map`，清空 `idfCache` 缓存；
  3. 静态工厂方法 `BM25Engine.fromIndex(serialized: BM25SerializedIndex): BM25Engine`：一行代码开箱即用还原引擎实例；
- 保持纯度与零业务偏见：函数只负责内存维度的 POJO 数据对象转换与校验，不写死任何具体磁盘路径与文件名，磁盘 I/O 交由调用方自由控制。

---

## 3. 验收标准与验证矩阵

1. **类型安全**：`BM25SerializedIndex` 强类型定义完备，导出与导入具备契约校验（版本号、关键字段非空）；
2. **检索一致性等价**：同一个语料集，通过 `addDocument` 实时构建的引擎与 `exportIndex` 导出后通过 `fromIndex` 还原的引擎，对任意 query 检索出的 `score` 与文档排名**逐字、逐位完全一致**；
3. **冷启动加速与防崩**：`src/index.ts` 接入 `enableCompileCache` 后全套测试与打包通过，低版本环境优雅容错；
4. **全机测试全绿**：`pnpm typecheck` 0 错，`pnpm test` 全量通过，`pnpm build` 顺利产出 DTS。
