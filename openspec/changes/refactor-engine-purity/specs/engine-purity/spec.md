# Delta Spec: engine-purity

> Change ID: `refactor-engine-purity`
> 素材源流: 当前对话直接提炼，审美真源 `dotagents/MIND.md` 维度 3

## ADDED Requirements

### Requirement: 引擎方法体零业务中文

`src/core/**/*.ts` SHALL NOT 含中文字符串字面量。所有中文模板、提示词、诊断句子 MUST 集中在 `src/presets/zh-cn.ts` 并经显式注入使用。

#### Scenario: 全仓扫描

- **WHEN** 扫描 `src/core/` 下全部 TypeScript 文件的字符串字面量
- **THEN** 中文字符命中数为 0

#### Scenario: 注入中文预设

- **WHEN** 调用方注入 `ZH_CN_*_TEXTS` 调用渲染与诊断函数
- **THEN** 输出包含平实的中文模板文案，纯计算结果不变

### Requirement: 策略数值单一真理源

所有阈值、权重、上限、精度 SHALL 在 `src/core/policy.ts` 的冻结常量表中声明，业务模块 MUST NOT 在方法体内写字面量默认值。

#### Scenario: 选项覆盖

- **WHEN** 调用方给 `evaluateDedupGate` 传 `threshold` 覆盖值
- **THEN** 判定按覆盖值执行，未传时按 `POLICY.dedup.threshold` 执行

#### Scenario: 纯计算行为不变

- **WHEN** 用同一组输入比对重构前后的相似度、哈希、锚点与路径仲裁结果
- **THEN** 输出逐字一致

### Requirement: 渲染类函数默认输出纯结构

`distillMarkdownContent`、`normalizeMarkdownContent`、`formatAgentJITPrompt` 与 `buildOKFConceptCard` 的默认输出 SHALL 只由输入数据与中性结构组成，MUST NOT 自带业务文案。

#### Scenario: 不注入预设

- **WHEN** 不传 `texts` 调用 `distillMarkdownContent`
- **THEN** 输出含 H1 与原文标题，不含模型自造的建模注记与兜底模板

#### Scenario: 附件数据可追溯

- **WHEN** `normalizeMarkdownContent` 抽到二进制附件
- **THEN** `attachments` 数组仍返回文件名、格式与地址，附录渲染由注入的模板决定

### Requirement: 诊断类返回值默认结构化

`evaluateDedupGate`、`analyzeCardLifecycle`、`auditSupersedeChain`、`checkTitleStemConsistency` 的 reason 与 detail SHALL 默认返回语义化 code，中文句子由预设格式化函数产出。

#### Scenario: 精确命中

- **WHEN** 候选标题与已有卡片精确一致
- **THEN** `action` 为 `MERGE_PATCH`，`reason` 为稳定 code 而非中文句子

#### Scenario: 五类演化链违规

- **WHEN** 卡片与台账记录存在五类不一致
- **THEN** `kind` 五类 code 全部产出，detail 不含中文

### Requirement: 正则与选择器按源头消灭

重点模块 SHALL 用 AST 节点遍历、`pathe`、`radash` 与具名常量替代手搓递归、捕获组回引与散落的选择器字符串，MUST NOT 使用非空断言绕过类型契约。

#### Scenario: 节点文本收集

- **WHEN** 需要收集 MDAST 链接节点的纯文本
- **THEN** 走 `unist-util-visit` 的声明式遍历，不出现手写递归函数

#### Scenario: 位置契约

- **WHEN** 链接节点缺少 position 信息
- **THEN** 在过滤阶段剔除或当场 assert，不出现 `position!`

### Requirement: 新增预设子路径三处对账

`docskit/presets` SHALL 在 `package.json exports`、`tsup.config.ts` entry 与 `src/index.ts` barrel 同步登记，根 barrel 既有导出符号 MUST NOT 减少。

#### Scenario: 构建后导入

- **WHEN** 执行 `pnpm build` 后动态 import 十三个子路径
- **THEN** 全部成功，`docskit/presets` 导出中文预设对象

### Requirement: 声明式数据流与两轮深挖

重点模块 SHALL 以 `map / filter / flatMap / reduce` 表达数据流，MUST NOT 含 `let` 中途改 state、`for` 加 `push` 游标、嵌套三元与原生 `try/catch`。

#### Scenario: 深挖扫描

- **WHEN** 扫描重点模块源码
- **THEN** 上述模式零命中，且每个引入的工具库都有真实消费点

## MODIFIED Requirements

> 本次无修改条目。纯计算类函数的签名与行为保持不变。
