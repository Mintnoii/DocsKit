/**
 * AST 结构提取与卡片装配。
 *
 * 引擎只产结构与数据：章节、代码块、表格、摘要。
 * 业务模板、关键词表与兜底文案由调用方注入，见 docskit/presets。
 */

import { createRequire } from "node:module";
import { isString, sift } from "radash";
import type { Code, Heading, Root, Table } from "mdast";
import { parseMarkdownSafely, splitLines } from "../../../contracts/markdown";
import { POLICY } from "../../../contracts/policy";
import { offsetOf, positioned, sliceOf, type PositionedNode } from "./position";
import type { ConceptModeling, DistillExtractor, DistillRenderer } from "../../../contracts/texts";

export type { ConceptModeling } from "../../../contracts/texts";

interface MdastDeps {
  readonly fromMarkdown: typeof import("mdast-util-from-markdown").fromMarkdown;
  readonly gfmFromMarkdown: typeof import("mdast-util-gfm").gfmFromMarkdown;
  readonly gfm: typeof import("micromark-extension-gfm").gfm;
  readonly selectAll: typeof import("unist-util-select").selectAll;
}

const MDAST_CACHE = new Map<string, MdastDeps>();

const mdastDeps = (): MdastDeps => {
  const hit = MDAST_CACHE.get("mdast");
  if (hit) return hit;
  const req = createRequire(import.meta.url);
  const loaded: MdastDeps = {
    fromMarkdown: req("mdast-util-from-markdown").fromMarkdown,
    gfmFromMarkdown: req("mdast-util-gfm").gfmFromMarkdown,
    gfm: req("micromark-extension-gfm").gfm,
    selectAll: req("unist-util-select").selectAll,
  };
  MDAST_CACHE.set("mdast", loaded);
  return loaded;
};

/** MDAST 原生声明式查询，选择器只在此登记 */
const SELECTORS = Object.freeze({ heading: "heading", code: "code", table: "table" });

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

export interface ParseMarkdownOptions {
  readonly summary?: DistillExtractor["summary"];
  readonly sectionFilter?: DistillExtractor["sectionFilter"];
}

export interface DistillOptions {
  readonly modeling?: ConceptModeling;
  readonly summary?: string;
  readonly extractor?: DistillExtractor;
  readonly render?: DistillRenderer;
}

const NEUTRAL_EXTRACTOR: DistillExtractor = Object.freeze({
  summary: (_content: string, title: string): string => title,
  sectionFilter: (): boolean => true,
});

const NEUTRAL_RENDERER: DistillRenderer = (ctx) =>
  sift([
    `# ${ctx.title}`,
    ctx.summary,
    ...ctx.sections.map((section) => `## ${section.title}\n\n${section.body}`),
    ...ctx.tables,
    ...ctx.codeBlocks,
  ]).join("\n\n");

const titleOf = (content: string, heading: Heading & PositionedNode): string =>
  content
    .slice(offsetOf(heading.position.start), offsetOf(heading.position.end))
    // 正则 `/^#{2,3}\s+/` 剔除行首的 2 到 3 个 # 号前缀及空白，只保留纯标题文字
    .replace(/^#{2,3}\s+/, "")
    .trim();

/** 结构提取：章节、代码块、表格，零业务词表与零自造文案 */
export function parseMarkdownWithAST(
  rawContent: string,
  defaultTitle: string,
  options: ParseMarkdownOptions = {}
): ParsedMarkdownAST {
  const { content } = parseMarkdownSafely(rawContent);
  const { fromMarkdown, gfmFromMarkdown, gfm, selectAll } = mdastDeps();
  const tree: Root = fromMarkdown(content, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const extractor = options.summary ?? NEUTRAL_EXTRACTOR.summary;
  const sectionFilter = options.sectionFilter ?? NEUTRAL_EXTRACTOR.sectionFilter;

  const codeBlocks = positioned(selectAll(SELECTORS.code, tree) as Code[])
    .filter((node) => splitLines(node.value).length >= POLICY.distiller.minCodeLines)
    .map((node) => sliceOf(content, node));

  const tables = positioned(selectAll(SELECTORS.table, tree) as Table[]).map((node) => sliceOf(content, node));

  // 仅保留二级 (depth=2, ##) 与三级 (depth=3, ###) 标题作为知识要点切块
  const headings = positioned(selectAll(SELECTORS.heading, tree) as Heading[])
    .filter((node) => node.depth === 2 || node.depth === 3)
    .filter((node) => sectionFilter(titleOf(content, node)));

  const sections: readonly ParsedMarkdownSection[] = headings.map((heading, idx) => {
    const title = titleOf(content, heading);
    const endOffset = headings[idx + 1] ? offsetOf(headings[idx + 1].position.start) : content.length;
    return {
      title,
      // 正则 `/[\s\p{P}]+/gu` 将空白与 Unicode 标点符号收敛为连字符 `-`，生成稳定 HTML/Markdown 锚点
      anchor: `#${title.toLowerCase().replace(/[\s\p{P}]+/gu, "-")}`,
      body: content.slice(offsetOf(heading.position.end), endOffset).trim(),
      depth: heading.depth,
      startOffset: offsetOf(heading.position.start),
      endOffset,
    };
  });

  return { codeBlocks, tables, summary: extractor(content, defaultTitle), sections };
}

/** 卡片装配：默认中性结构，注入业务渲染器后输出对应模板 */
export function distillMarkdownContent(
  rawMarkdown: string,
  cardTitle: string,
  options: DistillOptions = {}
): string {
  const { modeling = "ipo", summary: customSummary, extractor, render = NEUTRAL_RENDERER } = options;
  const { data: fm, content } = parseMarkdownSafely(rawMarkdown);
  const cleanTitle = (isString(fm.title) && fm.title ? fm.title : cardTitle)
    // 正则 `/-rev\d+$/` 剥离快照版本后缀（如 `-rev2`）
    .replace(/-rev\d+$/, "")
    // 正则 `/^[0-9\-_]+/` 剥离抓取文件名前缀的序号与下划线
    .replace(/^[0-9\-_]+/, "")
    .trim();

  const parsed = parseMarkdownWithAST(content, cleanTitle, extractor);
  return render({
    title: cleanTitle,
    summary: customSummary || parsed.summary,
    modeling,
    sections: parsed.sections,
    codeBlocks: parsed.codeBlocks,
    tables: parsed.tables,
  });
}
