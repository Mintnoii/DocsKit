# OKF v0.2 (Open Knowledge Framework) 规范卡片契约手册

> 📚 **OKF (Open Knowledge Framework)**：DocsKit 内置的原子卡片结构基线，字段 Schema 与生成函数收敛在 `docskit/okf`。下游可在这份基线上扩字段，边界见文末。  
> 核心目标：**格式统一、机器可读、零中心账本、供 AI 与人类高效消费。**

---

## 为什么要有卡片契约

传统个人笔记或团队 Wiki 最容易陷入三大混乱：
1. **格式群魔乱舞**：有的写成了长篇流水账，有的只有几句话，AI 检索时无法确定哪里是结论、哪里是代码；
2. **缺乏检索元数据**：AI 想要快速了解文章大意，被迫把几千字全部读完，极度浪费 Token；
3. **引用关系断裂**：卡片孤立存在，无法自动生成网状知识图谱，修改底层代码时不知道会影响谁。

**OKF v0.2 就是给知识卡片制定的一套“类代码契约”**。`docskit/okf` 的 Schema 与生成函数按这套基线实现，下游扩出的字段另按各项目的 Schema 校验。

---

## 完整卡片模板

一张标准的 OKF v0.2 原子卡片由两部分组成：**头部 Frontmatter（机器元数据）** + **正文 Body（黄金结构化正文）**。

```markdown
---
type: concept
title: "卡片核心标题"
created: 2026-11-09
updated: 2026-11-09
modeling: ipo
summary: "40~80字一句话本质定义与适用场景，供向量检索快速召回。"
status: evergreen
confidence: high
aliases:
  - "别名1"
  - "英文缩写或简称"
moc:
  - "[[wiki/areas/frontend/_index|前端工程化看板]]"
lock: human
content_hash: "sha256十六进制字符串"
---

# 卡片核心标题

> [!NOTE] 架构核心定义摘要
> 40~80字一句话本质定义与适用场景，承接 Frontmatter 中的 summary。

## 1. 架构背景与核心痛点
（阐述该技术或业务诞生的背景、没有它之前遇到了什么问题、为什么需要它）

## 2. 核心契约与设计范式
（阐述其运作原理、核心公式、状态机流转或核心架构图）

| 字段/状态 | 类型/触发条件 | 说明 |
| :--- | :--- | :--- |
| IDLE | 初始化完成 | 空闲等待状态 |
| RUNNING | 任务执行中 | 正在处理核心逻辑 |

## 3. 生产级核心实现代码与算法
（给出生产环境中可直接落地的核心代码块，行数充实、带有清晰注释）

```typescript
export function executeCoreWorkflow() {
  // 核心逻辑
}
```

## 4. 生产踩坑剖析与避坑指南
（给出真实场景中的踩坑记录、注意事项、内存泄漏防范与上线前检查清单）

> [!WARNING] 生产安全红线
> 涉及全局事件订阅时，必须在组件销毁钩子中显式解除绑定，杜绝内存泄漏。
```

---

## 元数据字段

| 字段名 | 允许的取值 | 含义与白话解释 | 谁来消费？ |
| :--- | :--- | :--- | :--- |
| **`type`** | `concept` \| `cheatsheet` \| `adr` | **卡片体裁类型**：<br>- `concept`：原子概念/业务规约（最常用）；<br>- `cheatsheet`：速查手册/代码备忘清单；<br>- `adr`：重大架构决策记录（Architecture Decision Record）。 | 格式校验器 (`lint`)、看板分类生成 |
| **`title`** | 纯文本字符串 | **卡片的规范名称**。必须精准、无营销口水废话。 | 搜索索引 (BM25)、双链引用 |
| **`created`** | `YYYY-MM-DD` | 卡片创建日期。 | 生命周期审计 |
| **`updated`** | `YYYY-MM-DD` | 卡片最近更新日期。 | 过期提醒（如超过 90 天未更新） |
| **`modeling`** | `ipo` \| `decomposition` \| `recipe` | **内容建模结构**：<br>- `ipo`：输入/处理/输出（架构/代码卡片默认）；<br>- `decomposition`：拆解分析型；<br>- `recipe`：配方/步骤操作型。 | 编译提纯器 (`distiller`) |
| **`summary`** | 40~80 字文本 | **一句话定义**。极度重要！必须讲透“是什么 + 解决什么问题”。 | **向量检索核心**、**Agent JIT 极简暴露 (<200 Token)** |
| **`status`** | `evergreen` \| `developing` \| `deprecated` | **卡片生命周期状态**：<br>- `evergreen`：长期有效，生产标准（默认）；<br>- `developing`：孵化中，草案；<br>- `deprecated`：已废弃淘汰，仅留存归档。 | 检索过滤、废弃保护机制 |
| **`confidence`** | `high` \| `medium` \| `low` | 知识可信度置信度（团队定稿方案一般为 `high`）。 | 搜索权重排序 |
| **`aliases`** | 字符串数组 | **同义词与常见缩写**（如 `["WebGL管线", "3D渲染"]`）。 | **BM25 检索别名召回**（解决提问词与标题不一致） |
| **`moc`** | `[[双链]]` 数组 | **所属领域看板**（Map of Content）。指定本卡片挂载在哪个业务或知识大盘下。 | 双向关联图谱、门户网站侧边栏导航 |
| **`lock`** *(可选)* | `human` | **人工锁定标记**。技术负责人认定的铁律军规加上此标记后，AI 自动化脚本绝对禁止覆写。 | 编译安全门禁 (`lock.ts`) |
| **`content_hash`** | SHA-256 字符串 | 正文纯文本哈希值。用于再次同步时比对，未变动直接 0-Token 拦截。 | 幂等防抖门禁 (`hash.ts`) |

`docskit/okf` 里与这份契约对得上的导出如下。

| 函数 / Schema | 作用 |
| :--- | :--- |
| `OKFFrontmatterSchema`、`OKFConceptFrontmatterSchema`、`OKFSourceFrontmatterSchema`、`OKFCheatsheetFrontmatterSchema`、`OKFDomainFrontmatterSchema`、`OKFEntityFrontmatterSchema` | 按卡片体裁声明字段与枚举 |
| `OKFStatusSchema`、`OKFConfidenceSchema`、`OKFSourceItemSchema` | 状态、置信度与信源条目的子契约 |
| `createOKFMetadata`、`createOKFConceptMetadata` | 由输入组装合规 Frontmatter |
| `updateOKFMetadata` | 在旧元数据上做定向更新 |
| `validateOKFMetadata` | 落盘前强契约校验 |
| `buildOKFConceptCard`、`appendCardAttachments` | 生成概念卡正文与附件留痕 |

Frontmatter 的读写由 `docskit/markdown` 的 `parseMarkdownSafely` 与 `stringifyMarkdownSafely` 承担，`okf` 只管字段契约与校验，两处不重复实现。

---

## IPO 正文骨架

OKF v0.2 强烈推荐 **IPO 模型（Input-Process-Output）** 作为架构与技术类卡片的骨架，它分为 4 个标准章节：

1. **第 1 节：架构背景与核心痛点（Why - 输入/动机）**
   - 不说废话，直接交代该概念因何而生，解决了没有它之前的什么生产故障或研发效率瓶颈。
2. **第 2 节：核心契约与设计范式（What - 机制与模型）**
   - 给出清晰的数据结构、核心接口定义、状态流转图或对比表格，明确技术边界。
3. **第 3 节：生产级核心实现代码与算法（How - 处理/代码）**
   - 提取自长文或真实项目的核心代码片段。必须具有实际可运行性，严禁写只写半截的虚构伪代码。
4. **第 4 节：生产踩坑剖析与避坑指南（Gotcha - 警示/输出保障）**
   - 沉淀最宝贵的边界条件防范：如内存释放、并发死锁、断网降级、重试风暴防范。

---

## 与底层函数的关系

```text
               ┌────────────────────────────────────────────────────────┐
               │              OKF v0.2 业务规范 (The Specification)      │
               │  - 定义 Frontmatter 元数据 (title, summary, status...)  │
               │  - 定义 IPO 黄金正文结构 (痛点 -> 设计 -> 代码 -> 避坑)   │
               └────────────────────────────────────────────────────────┘
                                           │
                        ┌──────────────────┴──────────────────┐
                        ▼                                     ▼
     ┌────────────────────────────────────┐ ┌────────────────────────────────────┐
     │   MDAST 语法树工具 (The Extractor)   │ │  Late Chunking 引擎 (The Embedder) │
     │  - 用抽象语法树安全提取代码/表格     │ │  - 针对 OKF 卡片计算整篇自注意力   │
     │  - 杜绝代码内注释被当成新标题误切   │ │  - 顺着 OKF 章节切出局部高精向量   │
     │  - 负责按 IPO 模板安全缝合正文     │ │  - 供 Coding Agent <200 Token 定位 │
     └────────────────────────────────────┘ └────────────────────────────────────┘
```

- **OKF v0.2 定的是产物基线**：不管底层用 Node.js 还是 Rust，不管是用正则切还是 AST 切，产物先满足这套 YAML 与章节规范，下游扩展字段另算；
- **MDAST 是“精密施工工具”**：我们引入 MDAST 纯粹是为了更稳健、更安全地生产出符合 OKF v0.2 标准的卡片。

---

## 下游扩展边界

这份文档写的是 `docskit/okf` 实际产出的通用基线。两个消费方在这份基线上各有扩展，扩展部分由各自项目的 Schema 与巡检命令承担，通用引擎不写死业务治理语义。

| 消费方 | 扩展内容 | 落点 |
| :--- | :--- | :--- |
| Ghost | 沿用 OKF v0.2，另加 `title === stem` 身份不变量与可读标题规范化 | `lint/rules.ts`、`compile/builder.ts` |
| TeamWiki | 扩到 OKF v0.3，加段落级来源锚点 `{anchor, hash, quote, claim}`、`owner` / `reviewer` / `reviewed_at` / `conflict` / `superseded_by` / `source_ref` / `source_file`，底座元数据补 `source_kind` / `anchor_scheme` / `content_sha256` | `src/compile/contract.ts`、`src/compile/anchors.ts`、`src/lint/` |

段落切分与指纹复算、声明句词级覆盖、演化链审计、同名并存路径仲裁、标题规范化与身份巡检这几类确定性函数已收进 DocsKit，分别在 `docskit/evidence`、`docskit/lint`、`docskit/snapshot`、`docskit/markdown` 与 `docskit/hash`。下游改 import 属于下一阶段，字段形状与治理语义仍由各项目自己持有。渲染与诊断文案已移到 `docskit/presets`，这份规范只描述字段形状，不持有任何业务模板。接法见 `docs/BUILDING-VAULTS.md` 的「注入业务文案」。
