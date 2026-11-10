## ADDED Requirements

### Requirement: BM25 倒排索引序列化与反序列化
系统 SHALL 为 BM25Engine 提供可安全进行 JSON 序列化的纯数据结构导出与导入方法，并保证还原后的检索打分与原始实例完全等价。

#### Scenario: 导出索引并反序列化还原
- **WHEN** 对存有已索引文档的 `BM25Engine` 调用 `exportIndex()`
- **THEN** 系统返回符合 `BM25SerializedIndex` 强契约且可被 `JSON.stringify` 的纯数据结构，且 `BM25Engine.fromIndex(serialized)` 能成功重建等价引擎实例。

#### Scenario: 还原实例检索结果严格等价
- **WHEN** 使用还原后的引擎与原引擎执行相同 query 的 `search()` 操作
- **THEN** 两者返回的候选文档 ID、匹配数量以及浮点相关度分数必须逐项完全相等。

### Requirement: 原生 Node.js V8 编译缓存安全接入
系统 SHALL 在顶层入口检测并尝试启用 `module.enableCompileCache()`，并在低版本或非 Node.js 环境下静默优雅降级。

#### Scenario: 支持环境自动激活缓存
- **WHEN** DocsKit 在支持该特性的 Node.js 运行时中被引入
- **THEN** 顶层安全调用 `enableCompileCache()` 且不会抛出任何运行时异常。
