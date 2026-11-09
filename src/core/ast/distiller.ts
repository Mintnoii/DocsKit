import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { selectAll } from "unist-util-select";
import { isString, sift } from "radash";
import type { Code, Heading, Table } from "mdast";
import { outdent, parseMarkdownSafely, renderMarkdownTable } from "../shared/markdown";

export type ConceptModeling = "ipo" | "decomposition" | "hybrid";

export interface DistillOptions {
  /** 概念建模范式，默认 "ipo" */
  readonly modeling?: ConceptModeling;
  /** 自定义摘要（可选，若不传自动基于 AST 提取） */
  readonly summary?: string;
}

export interface ParsedMarkdownSection {
  readonly title: string;
  readonly anchor: string;
  readonly body: string;
  readonly depth: number;
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface ParsedMarkdownAST {
  readonly codeBlocks: readonly string[];
  readonly tables: readonly string[];
  readonly summary: string;
  readonly sections: readonly ParsedMarkdownSection[];
}

const NOISE_TITLE_KEYWORDS = ["点赞", "关注", "转载", "打赏", "作者介绍", "往期推荐", "一句话总结"];
const CONTEXT_KEYWORDS = ["痛点", "背景", "为什么", "原理", "思考", "挑战", "定义", "本质"];
const DESIGN_KEYWORDS = ["架构", "契约", "模型", "选型", "机制", "流程", "原理", "规范"];
const GOTCHA_KEYWORDS = ["避坑", "踩坑", "注意事项", "实战", "优化", "总结", "关键点"];
const SUMMARY_PATTERNS = [
  /### 一句话总结[\r\n]+([^\r\n]+)/,
  /> \[!NOTE\][^\r\n]*[\r\n]+> ([^\r\n]+)/,
  /(?:核心总结|摘要|核心目标)[：:]\s*([^\r\n]+)/,
];

const matchesAny = (title: string, keywords: readonly string[]): boolean =>
  keywords.some((keyword) => title.includes(keyword));

const titleOf = (content: string, heading: Heading): string =>
  content
    .slice(heading.position!.start.offset, heading.position!.end.offset)
    .replace(/^#{2,3}\s+/, "")
    .trim();

/** MDAST 语义提取：章节切分、代码块/表格抽取与核心定义摘要提炼 */
export function parseMarkdownWithAST(rawContent: string, defaultTitle: string): ParsedMarkdownAST {
  const { content } = parseMarkdownSafely(rawContent);
  const tree = fromMarkdown(content, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

  const codeBlocks = (selectAll("code", tree) as Code[])
    .filter((node) => node.position && node.value.split("\n").length >= 3)
    .map((node) => content.slice(node.position!.start.offset, node.position!.end.offset).trim());

  const tables = (selectAll("table", tree) as Table[])
    .filter((node) => node.position)
    .map((node) => content.slice(node.position!.start.offset, node.position!.end.offset).trim());

  const headings = (selectAll("heading", tree) as Heading[])
    .filter((node) => (node.depth === 2 || node.depth === 3) && node.position)
    .filter((node) => !matchesAny(titleOf(content, node), NOISE_TITLE_KEYWORDS));

  const sections: ParsedMarkdownSection[] = headings.map((heading, idx) => {
    const title = titleOf(content, heading);
    const startOffset = heading.position!.start.offset ?? 0;
    const bodyStart = heading.position!.end.offset ?? 0;
    const endOffset = headings[idx + 1]?.position?.start.offset ?? content.length;
    return {
      title,
      anchor: `#${title.toLowerCase().replace(/[\s\p{P}]+/gu, "-")}`,
      body: content.slice(bodyStart, endOffset).trim(),
      depth: heading.depth,
      startOffset,
      endOffset,
    };
  });

  const summaryText = sift(SUMMARY_PATTERNS.map((pattern) => content.match(pattern)?.[1]))[0];
  const summary = summaryText
    ? summaryText.replace(/^[>#\s*]+/, "").trim()
    : `${defaultTitle} 的核心机制与工程落地实践。`;

  return { codeBlocks, tables, summary, sections };
}

const MODELING_DECLARATIONS: Readonly<Record<ConceptModeling, readonly string[]>> = {
  ipo: [
    "> **建模范式**：形态 A · 纯 IPO 机制模型 (Atomic Operator)",
    "> **核心特征**：单步原子机制，确定性输入原材料 (Input) → 处理与校验逻辑 (Process) → 确定性产出物 (Output)。",
  ],
  decomposition: [
    "> **建模范式**：形态 B · 纯分解工序模型 (Decomposition Modeling)",
    "> **核心特征**：解构为递进推进工序阶段，确立注意力信噪比，交代阶段目标、准入准出标准与核心动作。",
  ],
  hybrid: [
    "> **建模范式**：形态 C · 混合建模架构 (Hybrid Modeling)",
    "> **核心特征**：外层声明全局严格 IPO 契约，内层递进推进步骤解耦装配底层可复用子概念。",
  ],
};

interface DistillContext {
  readonly sections: readonly ParsedMarkdownSection[];
  readonly contextSection?: ParsedMarkdownSection;
  readonly otherSections: readonly ParsedMarkdownSection[];
}

const IPO_CONTRACT_TABLE = renderMarkdownTable({
  headers: ["环节", "契约要素与流转标准", "说明"],
  rows: [
    ["**输入原材料 (Input)**", "原始上下文、参数与前置依赖状态", "具备确定性校验规则"],
    ["**处理与校验 (Process)**", "核心状态机演算、幂等与副作用隔离", "核心计算逻辑"],
    ["**确定性产出 (Output)**", "规格化结果对象与状态收敛信号", "下游稳定解构消费"],
  ],
});

const HYBRID_CONTRACT_TABLE = renderMarkdownTable({
  headers: ["输入 (Global Input)", "处理 (Global Process)", "输出 (Global Output)"],
  rows: [["业务目标与外部素材", "状态机流转与多阶段组装", "收敛终态交付卡片"]],
});

const FALLBACK_STAGES = outdent`
  ### 阶段 1：静态预算与分层装载
  - **目标**：任务初始化与边界约束确立
  - **核心动作**：准入校验与前置状态对齐

  ### 阶段 2：动态执行与状态推演
  - **目标**：运行时推进与反馈处理
  - **核心动作**：环境交互与副作用受控执行

  ### 阶段 3：收敛仲裁与状态持久化
  - **目标**：任务终结与结果交付
  - **核心动作**：准出校验与知识沉淀留痕
`;

const FALLBACK_GOTCHA = outdent`
  > [!WARNING] 生产安全红线与自愈纪律
  > 1. 严格遵守不可变真理源原则，代码与架构契约演进必须在 OpenSpec 中先对账后动工；
  > 2. 涉及长连接、Worker 线程或高频异步订阅时，必须保证在生命周期销毁时显式释放，杜绝内存泄漏。
`;

const buildIpoContract = (ctx: DistillContext): string => {
  const designSection = ctx.otherSections.find((section) => matchesAny(section.title, DESIGN_KEYWORDS));
  return sift([
    "## 2. 核心架构契约与设计范式 (IPO 机制)",
    IPO_CONTRACT_TABLE,
    designSection ? `### 📐 ${designSection.title}\n\n${designSection.body}` : "",
  ]).join("\n\n");
};

const buildDecompositionContract = (ctx: DistillContext): string => {
  const stages = ctx.otherSections.length >= 2
    ? ctx.otherSections.slice(0, 4)
        .map((section, idx) => `### 阶段 ${idx + 1}：${section.title}\n\n${section.body}`)
        .join("\n\n")
    : FALLBACK_STAGES;

  return `## 2. 多阶段生命周期工序分解 (Multi-Stage Decomposition)\n\n${stages}`;
};

const buildHybridContract = (ctx: DistillContext): string => {
  const steps = ctx.otherSections.length > 0
    ? ctx.otherSections.slice(0, 3)
        .map((section, idx) => `#### 步骤 ${idx + 1}：${section.title}\n\n${section.body}`)
        .join("\n\n")
    : "内层驱动步骤由状态机动态调度，保障高阶系统稳定性。";

  return sift([
    "## 2. 全局宏观 IPO 契约与内层工序解构 (Hybrid Pipeline)",
    "### 2.1 全局宏观 IPO 契约",
    HYBRID_CONTRACT_TABLE,
    "### 2.2 内层核心驱动步骤与子机制装配",
    steps,
  ]).join("\n\n");
};

const CONTRACT_BUILDERS: Readonly<Record<ConceptModeling, (ctx: DistillContext) => string>> = {
  ipo: buildIpoContract,
  decomposition: buildDecompositionContract,
  hybrid: buildHybridContract,
};

/** 概念卡片深度语义提纯：三大建模范式按字典查表装配，零命令式累加 */
export function distillMarkdownContent(
  rawMarkdown: string,
  cardTitle: string,
  options: DistillOptions = {}
): string {
  const { modeling = "ipo", summary: customSummary } = options;
  const { data: fm, content } = parseMarkdownSafely(rawMarkdown);
  const cleanTitle = (isString(fm.title) && fm.title ? fm.title : cardTitle)
    .replace(/-rev\d+$/, "")
    .replace(/^[0-9\-_]+/, "")
    .trim();

  const { codeBlocks, tables, summary: astSummary, sections } = parseMarkdownWithAST(content, cleanTitle);
  const summary = customSummary || astSummary;

  const contextSection = sections.find((section) => matchesAny(section.title, CONTEXT_KEYWORDS));
  const ctx: DistillContext = {
    sections,
    contextSection,
    otherSections: sections.filter((section) => section !== contextSection),
  };

  const gotchaSection = sections.find((section) => matchesAny(section.title, GOTCHA_KEYWORDS));
  const gotchaBody = gotchaSection
    ? `### ⚠️ ${gotchaSection.title}\n\n${gotchaSection.body}`
    : FALLBACK_GOTCHA;

  const topCodeBlocks = [...codeBlocks].sort((a, b) => b.length - a.length).slice(0, 3);

  return sift([
    `# ${cleanTitle}`,
    MODELING_DECLARATIONS[modeling].join("\n"),
    `> [!NOTE] 核心定义摘要\n> ${summary}`,
    [
      "## 1. 概念核心定义与架构背景",
      contextSection ? `### 💡 ${contextSection.title}` : "",
      contextSection?.body ?? sections[0]?.body ?? "",
    ].filter(Boolean).join("\n\n"),
    CONTRACT_BUILDERS[modeling](ctx),
    tables.length > 0 ? `### 📊 核心契约与对比对账表\n\n${tables.slice(0, 3).join("\n\n")}` : "",
    codeBlocks.length > 0 ? `## 3. 生产级核心实现代码与算法\n\n${topCodeBlocks.join("\n\n")}` : "",
    `## 4. 生产踩坑剖析与避坑指南\n\n${gotchaBody}`,
  ]).join("\n\n");
}
