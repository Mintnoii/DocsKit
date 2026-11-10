/**
 * 中文业务预设。
 * 卡片模板、提示词和诊断句子都放在这里，引擎层只出结构与数据。
 * 对外只留五个聚合入口，其余都是本文件的内部实现。
 */

import { outdent, renderMarkdownTable } from "../contracts/markdown";
import { POLICY } from "../contracts/policy";
import { first, sift, sort } from "radash";
import type {
  AppendixRenderer,
  AttachmentData,
  ConceptModeling,
  DistillExtractor,
  DistillRenderer,
  JITRenderer,
  NormalizeTexts,
  SectionTexts,
} from "../contracts/texts";

export const ZH_CN_LABELS = Object.freeze({
  untitled: "未命名标题",
  vaultName: "知识库",
});

/** 这几组词只用来认中文素材里的客套话和章节，不是输出文案 */
const NOISE_TITLES = ["点赞", "关注", "转载", "打赏", "作者介绍", "往期推荐", "一句话总结"];
const CONTEXT_WORDS = ["痛点", "背景", "为什么", "原理", "思考", "挑战", "定义", "本质"];
const DESIGN_WORDS = ["架构", "契约", "模型", "选型", "机制", "流程", "原理", "规范"];
const GOTCHA_WORDS = ["避坑", "踩坑", "注意事项", "实战", "优化", "总结", "关键点"];
const SUMMARY_PATTERNS = [
  /### 一句话总结[\r\n]+([^\r\n]+)/,
  /> \[!NOTE\][^\r\n]*[\r\n]+> ([^\r\n]+)/,
  /(?:核心总结|摘要|核心目标)[：:]\s*([^\r\n]+)/,
];

const hasAny = (title: string, words: readonly string[]): boolean =>
  words.some((word) => title.includes(word));

const distillExtractor: DistillExtractor = Object.freeze({
  summary: (content: string, title: string): string => {
    const hit = first(sift(SUMMARY_PATTERNS.map((pattern) => content.match(pattern)?.[1])));
    return hit ? hit.replace(/^[>#\s*]+/, "").trim() : `${title} 是怎么工作的。`;
  },
  sectionFilter: (title: string): boolean => !hasAny(title, NOISE_TITLES),
});

const MODELING_NOTES: Readonly<Record<ConceptModeling, readonly string[]>> = {
  ipo: ["> 这张卡讲一个单步机制：输入是什么，中间怎么处理，最后产出什么。"],
  decomposition: ["> 这张卡按步骤拆开讲，每步写清楚要做什么和做完的标志。"],
  hybrid: ["> 这张卡先说整体输入输出，再拆开里面的关键步骤。"],
};

const IPO_TABLE = renderMarkdownTable({
  headers: ["环节", "写什么", "备注"],
  rows: [
    ["输入", "上游给的上下文、参数和前置状态", "进来先校验"],
    ["处理", "核心计算、幂等和副作用隔离", "主要逻辑在这里"],
    ["产出", "结果对象和状态", "下游直接解构"],
  ],
});

const HYBRID_TABLE = renderMarkdownTable({
  headers: ["输入", "处理", "产出"],
  rows: [["目标和素材", "按阶段组装", "交付卡片"]],
});

const FALLBACK_STAGES = outdent`
  ### 步骤 1：准备
  - 把边界和前置状态对齐。

  ### 步骤 2：执行
  - 按阶段推进，控制好副作用。

  ### 步骤 3：收尾
  - 校验结果并留一条记录。
`;

const FALLBACK_GOTCHA = outdent`
  > [!WARNING] 两个容易漏的点
  > 1. 改契约前先对一下现有卡片，别直接覆盖。
  > 2. 长连接、Worker 或订阅要在销毁时显式释放。
`;

const contractOf = (modeling: ConceptModeling, sections: readonly { title: string; body: string }[]): string => {
  const design = sections.find((section) => hasAny(section.title, DESIGN_WORDS));
  const ipo = sift([
    "## 2. 这张卡怎么运作",
    IPO_TABLE,
    design ? `### ${design.title}\n\n${design.body}` : "",
  ]).join("\n\n");
  // 依照 POLICY.distiller.maxStages 截取前 N 个核心阶段（默认 4 个），防止单卡步骤过多，引导过长流程拆分为双链子卡
  const stages = sections.length >= 2
    ? sections.slice(0, POLICY.distiller.maxStages)
        .map((section, idx) => `### 步骤 ${idx + 1}：${section.title}\n\n${section.body}`)
        .join("\n\n")
    : FALLBACK_STAGES;
  const decomposition = `## 2. 分几步做\n\n${stages}`;
  // 混合模式依照 POLICY.distiller.maxSteps 截取前 N 个子步骤（默认 3 个）
  const steps = sections.length > 0
    ? sections.slice(0, POLICY.distiller.maxSteps)
        .map((section, idx) => `#### 步骤 ${idx + 1}：${section.title}\n\n${section.body}`)
        .join("\n\n")
    : "步骤先留空，等素材补齐。";
  const hybrid = sift([
    "## 2. 整体与分步",
    "### 2.1 整体输入输出",
    HYBRID_TABLE,
    "### 2.2 关键步骤",
    steps,
  ]).join("\n\n");

  return { ipo, decomposition, hybrid }[modeling];
};

const distillRenderer: DistillRenderer = (ctx) => {
  const context = ctx.sections.find((section) => hasAny(section.title, CONTEXT_WORDS));
  const others = ctx.sections.filter((section) => section !== context);
  const gotcha = ctx.sections.find((section) => hasAny(section.title, GOTCHA_WORDS));
  // 优先按字符长度降序排序，仅挑选信息密度最高的前 N 个重点代码块（默认 3 个），避免碎小命令行片段撑爆卡片
  const topCodeBlocks = sort(ctx.codeBlocks, (block) => block.length, true).slice(0, POLICY.distiller.maxCodeBlocks);

  return sift([
    `# ${ctx.title}`,
    MODELING_NOTES[ctx.modeling].join("\n"),
    `> [!NOTE] 这张卡讲什么\n> ${ctx.summary}`,
    [
      "## 1. 背景",
      context ? `### ${context.title}` : "",
      context?.body ?? first(ctx.sections)?.body ?? "",
    ].filter(Boolean).join("\n\n"),
    contractOf(ctx.modeling, others),
    // 表格同样截取前 N 个核心结构表（默认 3 个）
    ctx.tables.length > 0
      ? `### 表格\n\n${ctx.tables.slice(0, POLICY.distiller.maxTables).join("\n\n")}`
      : "",
    ctx.codeBlocks.length > 0
      ? `## 3. 关键代码\n\n${topCodeBlocks.join("\n\n")}`
      : "",
    `## 4. 容易踩的坑\n\n${gotcha ? `### ${gotcha.title}\n\n${gotcha.body}` : FALLBACK_GOTCHA}`,
  ]).join("\n\n");
};

const attachmentBadge = (name: string): string => `📎 附件 ${name}，见文末清单`;

const appendixRenderer: AppendixRenderer = (attachments: readonly AttachmentData[]) =>
  outdent`
    ---

    ### 附件

    > 这几份来自原文：

    ${renderMarkdownTable({
      headers: ["#", "文件", "格式", "链接"],
      align: ["center", "left", "center", "left"],
      rows: attachments.map((att, idx) => [
        idx + 1,
        `\`${att.name}\``,
        `\`.${att.ext}\``,
        `[下载](${att.url})`,
      ]),
    })}
  `;

const JIT_TIPS = Object.freeze({
  compact: "> 2. 真要动到这些模块，先打开文件读一遍，再顺着依赖看一眼下游。",
  detailed: "> 2. 正文已经在上面，照着写就行。",
});

const jitRenderer: JITRenderer = (ctx) => {
  if (ctx.matches.length === 0) {
    return outdent`
      > [!NOTE] 没找到相关卡片
      > 没找到和「${ctx.query}」对得上的卡。若是新模块，按现有约定写。
    `;
  }

  const linkLine = (label: string, items: readonly { title: string; filePath: string }[] = []): string | null =>
    items.length > 0
      ? `- ${label}：${items.map((item) => `《${item.title}》(\`file:///${item.filePath}\`)`).join("、")}`
      : null;

  const blocks = ctx.matches.map((match, idx) => {
    const body = ctx.mode === "detailed" && match.content
      ? outdent`

          <card_contract_body>
          ${match.content.trim()}
          </card_contract_body>
        `
      : "";
    const lines = sift([
      `### ${idx + 1}. 《${match.title}》`,
      `- 讲什么：${match.summary}`,
      `- 文件：\`file:///${match.filePath}\``,
      linkLine("依赖", match.dependencies),
      linkLine("会受影响", match.dependents),
    ]);
    return `${lines.join("\n")}${body}`;
  });

  return outdent`
    <!-- ${ctx.vaultName} context -->
    > [!IMPORTANT] 先看这几张卡
    > 找到 ${ctx.matches.length} 张和这次改动有关的卡：

    ${blocks.join("\n\n")}

    > [!TIP] 动手前
    > 1. 这几张卡是已经定下来的口径，别顺手改掉；
    ${JIT_TIPS[ctx.mode]}
  `;
};

const deprecationNotice = (details: string, revisionTag: string): string =>
  `> [!WARNING] 这段已废弃 (${revisionTag})\n> ${details}。改代码时绕开它。`;

/** 一次性注入，得到中文卡片、附件清单、提示词和废弃声明 */
export const ZH_CN_DISTILL_OPTIONS = Object.freeze({
  extractor: distillExtractor,
  render: distillRenderer,
});

export const ZH_CN_NORMALIZE_TEXTS: NormalizeTexts = Object.freeze({
  attachmentBadge,
  downloadPrefix: "下载",
  appendix: appendixRenderer,
  attachmentFallback: "attachment",
});

export const ZH_CN_JIT_RENDERER: JITRenderer = jitRenderer;

export const ZH_CN_SECTION_TEXTS: SectionTexts = Object.freeze({
  introTitle: "## 引言",
  introKeywords: ["引言", "前言"],
  notice: deprecationNotice,
  details: Object.freeze({
    removed: (title: string): string => `《${title}》这节没了`,
    removedApis: (apis: readonly string[]): string => `这几个接口没了：${apis.join(", ")}`,
    changed: "内容有改动",
    added: (title: string): string => `新增《${title}》`,
  }),
});
