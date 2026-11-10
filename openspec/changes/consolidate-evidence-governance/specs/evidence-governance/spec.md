# Delta Spec: evidence-governance

> Change ID: `consolidate-evidence-governance`
> 素材源流: `Ghost/_raw/ai对话/DocsKit证据链与治理函数下沉.md`

## ADDED Requirements

### Requirement: 段落级证据锚点由确定性函数产出

`docskit/evidence` SHALL 提供 `splitAnchorableParagraphs`，把传入的 Markdown 按标题栈切分为带 `anchor`、`headingPath`、`index`、`text`、`hash` 的段落数组。模型 MUST NOT 参与段落定位。

#### Scenario: 多级标题下的段落编号

- **WHEN** 传入含一级与二级标题、各标题下有多个空行分隔正文块的 Markdown
- **THEN** 每个段落的 `headingPath` 等于标题栈拼接结果，`index` 在同一标题路径下从 1 递增，短于最小长度的段落被丢弃

#### Scenario: 跨平台换行

- **WHEN** 同一份文本分别以 CRLF 与 LF 换行传入
- **THEN** 两次产出的段落数组逐字一致

### Requirement: 生成与复算共用同一份前置变换

`verifySourceRef` SHALL 消费与生成侧同一份输入文本，函数内部 MUST NOT 剥离 Frontmatter 或做额外清洗。anchor 缺失、指纹不符、引用片段不在段落文本内三种情况 SHALL 判失效。

#### Scenario: 原文未变

- **WHEN** 用生成 `SourceRef` 时的同一份 Markdown 复算
- **THEN** 返回 true

#### Scenario: 原文改动

- **WHEN** 目标段落改了一个字后复算
- **THEN** 返回 false

#### Scenario: 截断引用

- **WHEN** `quote` 以省略号结尾表示截断
- **THEN** 去掉尾部省略号后再做包含判定，仍能命中原文

### Requirement: 选段打分与覆盖校验复用公共底座

`buildSourceRefs` SHALL 用 `docskit/shared` 的 `computeTextNgramSimilarity` 打分，`checkClaimCoverage` SHALL 用 `cleanTextForVector` 做字组归一。结论句 MUST 同时满足 bigram 覆盖率不低于阈值与拉丁词全命中，否则退回 `mechanicalClaim`。

#### Scenario: 全部候选得分为零

- **WHEN** query 与所有段落的相似度都是 0
- **THEN** 退化为按段落文本长度降序选取，长度相同按 anchor 字典序，且不超过 limit

#### Scenario: 模型结论引入原文没有的拉丁词

- **WHEN** claim 含 quote 里不存在的长度达标拉丁词
- **THEN** `passed` 为 false 且 `missingLatinTokens` 列出该词

#### Scenario: 结论过短

- **WHEN** claim 归一化后不足两个字
- **THEN** 直接判不通过，`coverage` 为 0

### Requirement: 演化链审计只消费传入数据

`auditSupersedeChain` SHALL 只接收卡片元数据数组与冲突记录数组，返回违规清单与统计，MUST NOT 访问文件系统或写死任何知识库目录。

#### Scenario: 五类违规各归其位

- **WHEN** 卡片挂 `conflict: open` 却无台账记录、卡已 `deprecated` 却缺 `supersededBy`、`supersededBy` 指向不存在卡片、台账引用不存在的卡片、已裁决记录与卡片状态不一致
- **THEN** 分别产出 `missing_conflict_record`、`missing_superseded_by`、`dangling_superseded_by`、`missing_card`、`resolution_mismatch` 五类 issue

#### Scenario: 全库合规

- **WHEN** 所有卡片与台账记录互相一致
- **THEN** `issues` 为空，统计数字与传入数据一致

### Requirement: 身份一致性逐卡比对

`checkTitleStemConsistency` SHALL 逐卡比对 trim 后的 `title` 与文件名 `stem`，不一致时返回含路径与两个值的 issue，空 title 跳过。

#### Scenario: 身份分裂

- **WHEN** 某卡 `title` 与 `stem` 不同
- **THEN** 返回一条 issue 且指出该卡路径

#### Scenario: 身份一致

- **WHEN** 所有卡的 `title` 都等于 `stem`
- **THEN** 返回空数组

### Requirement: 同名路径仲裁保护旧卡

`resolveCardPathCollision` SHALL 在目标不存在时返回 `use`，内容哈希相同时返回 `skip`，内容不同时返回 `rename` 且生成稳定并存路径。旧目标路径 MUST NOT 被返回为写入目标。

#### Scenario: 同名不同内容

- **WHEN** 目标路径已存在且 `existingHash` 与 `incomingHash` 不同
- **THEN** 返回 `rename`，路径由 `sourceFile` 短哈希决定，同输入多次调用结果一致

#### Scenario: 后缀撞车

- **WHEN** 首选并存路径已在 `occupiedPaths` 中
- **THEN** 递增序号直到找到未占用路径

### Requirement: 标题规范化与短哈希各有唯一实现

`docskit/shared` SHALL 提供 `normalizeReadableTitle`，剥离话题标签与残留井号并做空值回退；`docskit/hash` SHALL 提供 `computeShortHash`，产出 SHA-256 十六进制前 N 位。既有 `condenseTitle` 与 `snapshot/sanitizeFileName` MUST NOT 被删除或改签名。

#### Scenario: 全为话题标签

- **WHEN** 标题只由话题标签与空白组成
- **THEN** 返回去井号并折叠空白后的回退文本，纯空白时返回固定兜底值

#### Scenario: 短哈希复用

- **WHEN** 段落指纹与路径后缀都要取短哈希
- **THEN** 两者都消费 `computeShortHash`，同文本同长度输出相同

### Requirement: 新增子路径三处对账

新增 `docskit/evidence` 后，`package.json exports`、`tsup.config.ts` entry 与 `src/index.ts` barrel SHALL 同步登记，根 barrel 既有导出符号 MUST NOT 减少。

#### Scenario: 构建后逐入口导入

- **WHEN** 执行 `pnpm build` 后逐个动态 import 十二个子路径
- **THEN** 每个入口都成功，`docskit/evidence` 导出五个函数与契约类型

#### Scenario: 既有符号零删减

- **WHEN** 比对构建前后的根 barrel 导出名集合
- **THEN** 旧集合是新集合的子集

### Requirement: 通用函数不绑定业务语义

所有新增函数 MUST NOT 写死 `wiki/learning`、`_raw/` 等具体目录，MUST NOT 声明或校验 `owner`、`reviewer`、`conflict`、`superseded_by` 等团队治理字段，MUST NOT 发起模型调用或写入文件。

#### Scenario: 纯函数可独立调用

- **WHEN** 在临时目录之外只传入内存数据调用任一新增函数
- **THEN** 无文件读写、无网络请求，返回值只由入参决定

## MODIFIED Requirements

> 本次无修改条目。既有 11 个子路径的签名与行为保持不变。
