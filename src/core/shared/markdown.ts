/**
 * DocsKit 公共 Markdown 与文本排版底座
 *
 * 全项目唯一的 Frontmatter 解析/序列化入口（gray-matter 容器 + eemeli/yaml 标量引擎），
 * 以及唯一的表格与长文排版入口。业务模块一律消费此处函数，禁止裸调 matter 或手搓管道符。
 */

import { readFile } from "node:fs/promises";
import { join } from "pathe";
import matter from "gray-matter";
import { outdent } from "outdent";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { isArray, isString } from "radash";

export { outdent };

export interface ParsedMarkdownResult<T = Record<string, unknown>> {
  readonly data: Readonly<T>;
  readonly content: string;
  readonly body: string;
}

/** 本地标准短日期 (YYYY-MM-DD，sv-SE 无时区污染) */
export const localIsoDate = (): string => new Date().toLocaleDateString("sv-SE");

/** 抹平 CRLF 为 LF，保证跨平台正文指纹零漂移 */
export const normalizeLf = (text: string): string => text.replaceAll("\r\n", "\n");

/** 源头归一：把标量或数组统一收敛为安全数组，业务链路不再散落 Array.isArray */
export const ensureArray = <T>(val: unknown): T[] => {
  if (isArray(val)) return val as T[];
  return val === null || val === undefined || val === "" ? [] : [val as T];
};

/** YAML 1.2 工业级标量引擎（特殊字符自动转义，常规标量纯净直出） */
export const matterYamlEngine = Object.freeze({
  engines: {
    yaml: {
      parse: (str: string) => parseYaml(str) ?? {},
      stringify: (data: object) => stringifyYaml(data, { lineWidth: 0 }),
    },
  },
});

export function parseMarkdownSafely<T = Record<string, unknown>>(rawMarkdown: string): ParsedMarkdownResult<T> {
  const parsed = matter(normalizeLf(rawMarkdown), matterYamlEngine);
  return Object.freeze({
    data: Object.freeze({ ...(parsed.data as T) }),
    content: parsed.content,
    body: parsed.content.trim(),
  });
}

export function stringifyMarkdownSafely(content: string, data: Record<string, unknown>): string {
  return matter.stringify(content, data, matterYamlEngine);
}

export async function readMarkdownFile<T = Record<string, unknown>>(
  ...pathSegments: string[]
): Promise<ParsedMarkdownResult<T>> {
  const raw = await readFile(join(...pathSegments), "utf-8");
  return parseMarkdownSafely<T>(raw);
}

const splitH2Blocks = (markdown: string): readonly string[] => normalizeLf(markdown).split(/\n(?=##\s)/);
const isH2Block = (block: string, keyword: string): boolean => block.startsWith("## ") && block.includes(keyword);

/** 按二级标题剔除章节（## 为 Markdown 标题语法，非路径路由） */
export function dropSection(markdown: string, targetKeyword: string): string {
  return splitH2Blocks(markdown).filter((block) => !isH2Block(block, targetKeyword)).join("\n");
}

/** 按二级标题提取章节正文 */
export function extractSection(markdown: string, targetKeyword: string): string {
  return splitH2Blocks(markdown).find((block) => isH2Block(block, targetKeyword)) ?? "";
}

const wikilinkTargets = (markdown: string): readonly string[] =>
  [...markdown.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map(([, raw]) => raw.trim());

/** 判断文档是否包含指向目标词条的 [[双链]]（支持别名管道符与 .md 后缀） */
export function hasWikiLink(markdown: string, relPath: string): boolean {
  const stem = relPath.replace(/\.md$/, "");
  return wikilinkTargets(markdown).some((target) => target === relPath || target === stem);
}

/** 判断指定章节（缺省回退全文）是否已收录该信源双链 */
export function hasSourceLink(
  markdown: string,
  relPath: string,
  sectionKeyword = "关联信源与跨文献证据"
): boolean {
  return hasWikiLink(extractSection(markdown, sectionKeyword) || markdown, relPath);
}

const LATEX_UNICODE: Readonly<Record<string, string>> = Object.freeze({
  "$\\neq$": "≠",
  "$\\le$": "≤",
  "$\\ge$": "≥",
  "$\\times$": "×",
  "$\\div$": "÷",
  "$\\pm$": "±",
  "$\\approx$": "≈",
});

/** 非标 LaTeX 数学符号转通用 Unicode（单一字典查表，平铺 replace 链归零） */
export function sanitizeLatexToUnicode(src: string): string {
  return src.replace(/\$[^$]+\$/g, (token) => LATEX_UNICODE[token] ?? token);
}

/** 提取首选标题：Frontmatter title > H1 > H2 > 回退值 */
export function extractDocumentTitle(
  metaTitle: unknown,
  body: string,
  fallbackTitle = "Untitled"
): string {
  if (isString(metaTitle) && metaTitle.trim()) return metaTitle.trim();
  const heading = body.match(/^#{1,2}\s+(.+)/m);
  return heading?.[1].trim() ?? fallbackTitle;
}

/** 标题降噪：剥离话题标签、压平空白、超长截断 */
export function condenseTitle(rawTitle: string, maxLen = 40): string {
  const stripped = rawTitle.replace(/#[^\s#]+/gu, "").replace(/\s+/gu, " ").trim();
  const base = stripped || rawTitle.trim();
  return base.length > maxLen ? `${base.slice(0, maxLen)}…` : base;
}

export interface MarkdownTableOptions {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly (string | number | boolean | null | undefined)[])[];
  readonly align?: readonly ("left" | "center" | "right")[];
}

const ALIGN_TOKENS = Object.freeze({ left: ":---", center: ":---:", right: "---:" });

/** 声明式 Markdown 表格渲染（全项目唯一管道符拼装点） */
export function renderMarkdownTable(options: MarkdownTableOptions): string {
  const { headers, rows, align } = options;
  if (headers.length === 0) return "";

  const separator = `| ${headers.map((_, idx) => ALIGN_TOKENS[align?.[idx] ?? "left"]).join(" | ")} |`;
  const headerLine = `| ${headers.join(" | ")} |`;
  const dataLines = rows.map((row) => {
    const cells = headers.map((_, idx) => {
      const val = row[idx];
      return val === null || val === undefined ? "" : String(val).replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
    });
    return `| ${cells.join(" | ")} |`;
  });

  return [headerLine, separator, ...dataLines].join("\n");
}

/** 在指定标题下方置顶追加；标题不存在则文末新建补充章节 */
export function appendUnderHeading(
  markdown: string,
  headingRegex: RegExp,
  entry: string,
  fallbackHeading = "## 补充说明"
): string {
  const normalized = normalizeLf(markdown);
  if (headingRegex.test(normalized)) return normalized.replace(headingRegex, `$&\n${entry}`);

  const trimmed = normalized.trimEnd();
  return trimmed.length > 0
    ? `${trimmed}\n\n${fallbackHeading}\n${entry}\n`
    : `${fallbackHeading}\n${entry}\n`;
}
