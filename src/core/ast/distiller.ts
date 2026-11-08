import matter from "gray-matter";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { visit } from "unist-util-visit";
import type { Heading, Code, Table } from "mdast";

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

/**
 * 紧凑优雅的 MDAST 语义提取器 (使用 unist-util-visit 访问者模式)
 */
export function parseMarkdownWithAST(rawContent: string, defaultTitle: string): ParsedMarkdownAST {
  const { content } = matter(rawContent);

  const tree = fromMarkdown(content, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

  const codeBlocks: string[] = [];
  const tables: string[] = [];
  const headings: Heading[] = [];

  visit(tree, (node) => {
    if (node.type === "code") {
      const c = node as Code;
      if (c.position && c.value.split("\n").length >= 3) {
        codeBlocks.push(content.slice(c.position.start.offset, c.position.end.offset).trim());
      }
    } else if (node.type === "table") {
      const t = node as Table;
      if (t.position) {
        tables.push(content.slice(t.position.start.offset, t.position.end.offset).trim());
      }
    } else if (node.type === "heading") {
      const h = node as Heading;
      if ((h.depth === 2 || h.depth === 3) && h.position) {
        const titleText = content
          .slice(h.position.start.offset, h.position.end.offset)
          .replace(/^#{2,3}\s+/, "")
          .trim();
        if (!titleText.match(/(点赞|关注|转载|打赏|作者介绍|往期推荐|一句话总结)/)) {
          headings.push(h);
        }
      }
    }
  });

  // 根据 AST 标题节点位置精确切分章节
  const sections: ParsedMarkdownSection[] = headings.map((h, i) => {
    const title = content
      .slice(h.position!.start.offset, h.position!.end.offset)
      .replace(/^#{2,3}\s+/, "")
      .trim();
    const anchor = "#" + title.toLowerCase().replace(/[\s\p{P}]+/gu, "-");
    const startOffset = h.position!.start.offset ?? 0;
    const bodyStart = h.position!.end.offset ?? 0;
    const endOffset = headings[i + 1]?.position?.start.offset ?? content.length;
    return {
      title,
      anchor,
      body: content.slice(bodyStart, endOffset).trim(),
      depth: h.depth,
      startOffset,
      endOffset,
    };
  });

  // 摘要提取
  const summaryMatch =
    content.match(/### 一句话总结[\r\n]+([^\r\n]+)/) ||
    content.match(/> \[!NOTE\][^\r\n]*[\r\n]+> ([^\r\n]+)/) ||
    content.match(/(?:核心总结|摘要|核心目标)[：:]\s*([^\r\n]+)/);

  const summary = summaryMatch
    ? summaryMatch[1].replace(/^[>#\s*]+/, "").trim()
    : `${defaultTitle} 的核心机制与工程落地实践。`;

  return { codeBlocks, tables, summary, sections };
}

/**
 * 概念卡片深度语义提纯引擎
 * 支持 OKF v0.2 概念建模三大形态 (IPO / Decomposition / Hybrid)
 */
export function distillMarkdownContent(
  rawMarkdown: string,
  cardTitle: string,
  options: DistillOptions = {}
): string {
  const { modeling = "ipo", summary: customSummary } = options;
  const { data: fm, content } = matter(rawMarkdown);

  let cleanTitle = fm.title || cardTitle;
  cleanTitle = cleanTitle.replace(/-rev\d+$/, "").replace(/^[0-9\-_]+/, "").trim();

  const { codeBlocks, tables, summary: astSummary, sections } = parseMarkdownWithAST(content, cleanTitle);
  const summary = customSummary || astSummary;

  // 1. 文档头部与建模范式声明
  let distilled = `# ${cleanTitle}\n\n`;

  if (modeling === "ipo") {
    distilled += `> **建模范式**：形态 A · 纯 IPO 算子模型 (Atomic Operator)\n`;
    distilled += `> **核心特征**：单步原子机制，确定性输入原材料 (Input) → 处理与校验逻辑 (Process) → 确定性产出物 (Output)。\n\n`;
  } else if (modeling === "decomposition") {
    distilled += `> **建模范式**：形态 B · 纯分解工序模型 (Decomposition Modeling)\n`;
    distilled += `> **核心特征**：解构为递进推进工序阶段，确立注意力信噪比，交代阶段目标、准入准出标准与核心动作。\n\n`;
  } else {
    distilled += `> **建模范式**：形态 C · 混合建模架构 (Hybrid Modeling)\n`;
    distilled += `> **核心特征**：外层声明全局严格 IPO 契约，内层递进推进步骤解耦装配底层可复用子概念。\n\n`;
  }

  distilled += `> [!NOTE] 核心因果摘要\n> ${summary}\n\n`;

  // 2. 第一节：核心定义与背景动机
  distilled += `## 1. 概念核心定义与架构背景\n\n`;
  const contextSec = sections.find((s) => s.title.match(/(痛点|背景|为什么|原理|思考|挑战|定义|本质)/));
  if (contextSec) {
    distilled += `### 💡 ${contextSec.title}\n\n${contextSec.body}\n\n`;
  } else if (sections.length > 0) {
    distilled += `${sections[0].body}\n\n`;
  }

  // 3. 第二节：核心架构契约与设计范式（根据 modeling 展开）
  if (modeling === "ipo") {
    distilled += `## 2. 核心架构契约与设计范式 (IPO 算子)\n\n`;
    distilled += `| 环节 | 契约要素与流转标准 | 说明 |\n`;
    distilled += `| :--- | :--- | :--- |\n`;
    distilled += `| **输入原材料 (Input)** | 原始上下文、参数与前置依赖状态 | 具备确定性校验规则 |\n`;
    distilled += `| **处理与校验 (Process)** | 核心状态机演算、幂等与副作用隔离 | 核心计算逻辑 |\n`;
    distilled += `| **确定性产出 (Output)** | 规格化结果对象与状态收敛信号 | 下游稳定解构消费 |\n\n`;

    const designSec = sections.find((s) => s.title.match(/(架构|契约|模型|选型|机制|流程|原理|规范)/) && s !== contextSec);
    if (designSec) {
      distilled += `### 📐 ${designSec.title}\n\n${designSec.body}\n\n`;
    }
  } else if (modeling === "decomposition") {
    distilled += `## 2. 多阶段生命周期工序分解 (Multi-Stage Decomposition)\n\n`;
    const stageSections = sections.filter((s) => s !== contextSec);
    if (stageSections.length >= 2) {
      stageSections.slice(0, 4).forEach((sec, idx) => {
        distilled += `### 阶段 ${idx + 1}：${sec.title}\n\n${sec.body}\n\n`;
      });
    } else {
      distilled += `### 阶段 1：静态预算与分层装载\n- **目标**：任务初始化与边界约束确立\n- **核心动作**：准入校验与前置状态对齐\n\n`;
      distilled += `### 阶段 2：动态执行与状态推演\n- **目标**：运行时推进与反馈处理\n- **核心动作**：环境交互与副作用受控执行\n\n`;
      distilled += `### 阶段 3：收敛仲裁与状态持久化\n- **目标**：任务终结与结果交付\n- **核心动作**：准出校验与知识沉淀留痕\n\n`;
    }
  } else {
    // hybrid
    distilled += `## 2. 全局宏观 IPO 契约与内层工序解构 (Hybrid Pipeline)\n\n`;
    distilled += `### 2.1 全局宏观 IPO 契约\n\n`;
    distilled += `| 输入 (Global Input) | 处理 (Global Process) | 输出 (Global Output) |\n`;
    distilled += `| :--- | :--- | :--- |\n`;
    distilled += `| 业务目标与外部素材 | 状态机流转与多阶段组装 | 收敛终态交付卡片 |\n\n`;

    distilled += `### 2.2 内层核心驱动步骤与子机制装配\n\n`;
    const subSections = sections.filter((s) => s !== contextSec);
    if (subSections.length > 0) {
      subSections.slice(0, 3).forEach((sec, idx) => {
        distilled += `#### 步骤 ${idx + 1}：${sec.title}\n\n${sec.body}\n\n`;
      });
    } else {
      distilled += `内层驱动步骤由状态机动态调度，保障高阶系统稳定性。\n\n`;
    }
  }

  // 4. 嵌入有效表格
  if (tables.length > 0) {
    distilled += `### 📊 核心契约与对比对账表\n\n`;
    distilled += tables.slice(0, 3).join("\n\n") + "\n\n";
  }

  // 5. 核心代码块
  if (codeBlocks.length > 0) {
    distilled += `## 3. 生产级核心实现代码与算法\n\n`;
    const topCodeBlocks = [...codeBlocks].sort((a, b) => b.length - a.length).slice(0, 3);
    distilled += topCodeBlocks.join("\n\n") + "\n\n";
  }

  // 6. 避坑指南
  distilled += `## 4. 生产踩坑剖析与避坑指南\n\n`;
  const gotchaSec = sections.find((s) => s.title.match(/(避坑|踩坑|注意事项|实战|优化|总结|关键点)/));
  if (gotchaSec) {
    distilled += `### ⚠️ ${gotchaSec.title}\n\n${gotchaSec.body}\n\n`;
  } else {
    distilled += `> [!WARNING] 生产安全红线与自愈纪律\n`;
    distilled += `> 1. 严格遵守不可变真理源原则，代码与架构契约演进必须在 OpenSpec 中先对账后动工；\n`;
    distilled += `> 2. 涉及长连接、Worker 线程或高频异步订阅时，必须保证在生命周期销毁时显式释放，杜绝内存泄漏。\n\n`;
  }

  return distilled;
}
