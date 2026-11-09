# Tasks: 引擎冷启动瘦身 · 惰性加载与子路径导入

- [x] 立项动因与加载成本归属的实测采集 <!-- id: 0 -->
- [x] 目标方案、边界与验收标准写入 proposal.md <!-- id: 1 -->

## 引擎侧：消除静态绑定

- [x] `late-chunking.ts` 的 `@xenova/transformers` 顶层静态 import 改动态 import <!-- id: 2 -->
  - `env.localModelPath = SHARED_CACHE_DIR` 一并搬进动态加载后的初始化路径，共享缓存目录约定不得丢失
  - 验收：`grep -rn "^import.*@xenova/transformers" src/` 零命中

- [x] `ast/distiller.ts` 的 mdast 系顶层静态 import 改惰性单例 <!-- id: 3 -->
  - 走 `createRequire(import.meta.url)` 保持同步契约
  - 验收：`parseMarkdownWithAST` 与 `distillMarkdownContent` 签名不变

- [x] `ast/normalize.ts` 的 mdast 系顶层静态 import 改惰性单例 <!-- id: 4 -->
  - `normalizeMarkdownContent` 签名与返回值结构不变

- [x] `ast/okf-meta.ts` 对 `distiller.ts` 的静态依赖降级为动态 import <!-- id: 5 -->
  - `validateOKFMetadata` 与 `createOKF*` 系列契约不变
  - `buildOKFConceptCard` 改为 async，全机无消费方调用该函数

- [x] `patch/section-patcher.ts` 的 mdast 系顶层静态 import 改惰性单例 <!-- id: 6 -->
  - 三个导出函数保持同步，签名不变

- [x] `okf-meta.ts` 移出 `ast` 目录至 `src/core/okf/` <!-- id: 7 -->
  - 新增 `src/core/okf/index.ts` barrel
  - `ast` barrel 移除 okf-meta 导出
  - 根 barrel 增加 okf 命名空间与扁平导出，导出面 39/39 保持完整
  - `package.json` exports 与 `tsup.config.ts` entry 增加 okf 子路径
  - 验收：`grep -rn "@sinclair/typebox" src/core/ast/` 零命中

## 消费方侧：改走子路径导入

- [x] TeamWiki 18 个文件从 `docskit` 根 barrel 改为按需子路径导入 <!-- id: 8 -->
  - 检索热路径只加载 sense 与 graph 与 jit 与 ast
  - `ast` 与 `shared` 重叠符号一律走 `shared`（实测 2 ms 对 9 ms）

- [x] Ghost 8 个文件从 `docskit` 根 barrel 改为按需子路径导入 <!-- id: 9 -->
  - 别名导入全部保留

## 契约固化

- [x] DocsKit `AGENTS.md` 增补「消费方按需子路径导入」与「重型依赖不得顶层静态引入」两条铁律 <!-- id: 10 -->
  - 目录结构与模块能力表补 okf 子路径条目

## 验收

- [x] `pnpm test` 34/34 通过，不新增失败 <!-- id: 11 -->
- [x] `pnpm typecheck` 0 错 <!-- id: 12 -->
- [x] `pnpm build` 成功，`dist/okf/` 产物齐备 <!-- id: 13 -->
- [x] `grep -rn "as any\|@ts-ignore\|@ts-expect-error" src/` 零命中 <!-- id: 14 -->
- [x] 复跑分层打点，根 barrel 411ms 降至 190ms，`docskit/ast` 435ms 降至 9ms <!-- id: 15 -->
- [x] Late Chunking 输出逐字不变，现有相关单测全绿 <!-- id: 16 -->

## 收尾对账

- [x] 消费方端到端复跑，`pnpm context` 从 2024 到 2293ms 降至 840 到 923ms <!-- id: 17 -->
- [x] 把实测数据回写 proposal.md 的「落地结果」段 <!-- id: 18 -->
- [x] tasks.md 逐项勾选，与实际改动对账 <!-- id: 19 -->
