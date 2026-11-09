# 重构任务清单

> 关联：`proposal.md`｜执行方式：当前工作树原地重构（见文末执行约束）｜验收基线：`pnpm typecheck` + `pnpm test` + `pnpm build`

## 第一轮 消灭显式过程式胶水与重复底座

- [x] 新建 `src/core/shared/markdown.ts`，迁入 `ast/markdown-utils.ts` 全部函数，成为唯一 Frontmatter 入口
- [x] 新建 `src/core/shared/numeric.ts`，收敛 4 套 N-gram / 余弦 / Bigram Dice 实现
- [x] `ast/index.ts` 改从 shared 重新导出，删除 `ast/markdown-utils.ts` 物理文件
- [x] `ast/normalize.ts` 换 `parseMarkdownSafely` + `renderMarkdownTable` + `outdent`，消灭手写表格与替换游标
- [x] `ast/distiller.ts` 整篇模板改 `outdent` + `renderMarkdownTable`，消灭三十余次 `distilled +=`，修 `fm.title` 非字符串崩溃
- [x] `ast/scanner.ts` 用 `pathe.normalize` + `picomatch` 声明式过滤，删掉 `startsWith` 与重复斜杠替换
- [x] `ast/okf-meta.ts` 五分支 `switch` 改字典查表 + 公共基底，`localIsoDate` 复用，`assert` 门禁，去掉硬编码评估字段
- [x] `patch/section-patcher.ts` 改用 MDAST 切章节，修 frontmatter 丢失缺陷，diff 改声明式
- [x] `patch/dedup.ts` 消费 `shared/numeric`，用 `radash.max` 消灭游标比较，移除 `compute-cosine-similarity`
- [x] `sense/ngram.ts` 改为 shared 同源 re-export；`sense/late-chunking.ts` 复用归一化与点积并修 `any`
- [x] `sense/bm25.ts` / `sense/index.ts` 消灭 `for + push` 与 `Array.isArray` 双形态分流
- [x] `sense/reranker.ts` / `sense/pipeline.ts` 原生 `try/catch` 全量换 `radash.tryit`，清理 `any` 与空吞
- [x] `lint/index.ts` / `lint/card-lifecycle.ts` / `lint/vault-auditor.ts` / `lint/guard.ts` 声明式换装 + 复用 shared
- [x] `graph/index.ts` 消灭 mutate 副作用与 `startsWith`，复用 `normalizeWikilinkTarget`
- [x] `hash/index.ts` / `snapshot/tombstone.ts` / `snapshot/index.ts` / `jit/index.ts` 收敛底座、消灭 map 内副作用与 5 连 if
- [x] `pipeline/runner.ts` 换统一 Markdown 底座并同步修复后的 patch 组装顺序
- [x] `src/index.ts` 改 `export *` barrel；`package.json` 补子路径、删无用依赖；`tsup.config.ts` 对账；`AGENTS.md` 更正目录树

## 第二轮 拿着放大镜深挖残留

- [x] 全库扫描 `startsWith` / `Array.isArray` / `typeof === "string"` / 嵌套三元 / 手写路径拼接 / 硬编码日期与状态，逐条判定去留
- [x] 复核每个模块是否真的消费了已引入的 `radash` / `pathe` / `picomatch` / `outdent` / `typebox`，杜绝装库不用
- [x] 复核 7 项逻辑缺陷的修复是否引入新回归，补充 `applySectionPatch` 与 MDAST 章节切分回归测试
- [x] 全量 `pnpm typecheck` + `pnpm test` + `pnpm build`，比对公开导出符号零缺失

## 执行约束

- 工作树已有 446+/143- 未提交改动与 3 个未跟踪新文件，Orca worktree 从 master 建立会丢掉这批基线；又因严禁擅自 `git commit` 无法先固化基线，故本次降级为当前 Agent 在当前工作树原生编码，全程不 commit / push。
- 所有既有未提交改动作为基线原样纳入重构范围，不回退、不覆盖其业务意图。

## 项目定名收口

- [x] 全库现行文件替换旧名为 `DocsKit`，已结案提案与思辨留档按取证原则保留原词
- [x] 更名 `tests/cyberbrain.test.ts` 为 `tests/docs-kit.test.ts`，同步测试描述与英文包描述
- [x] 更新 `package.json` 的 `name` 与 `description`，跑 `pnpm install` 对账 lock
- [x] 全量 `pnpm typecheck` + `pnpm test` + `pnpm build` + `npm pack --dry-run` 验证
