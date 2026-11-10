/**
 * DocsKit 公共 Markdown 与文本排版底座
 *
 * 全项目唯一的 Frontmatter 解析/序列化入口（gray-matter 容器 + eemeli/yaml 标量引擎），
 * 以及唯一的表格与长文排版入口。业务模块一律消费此处函数，禁止裸调 matter 或手搓管道符。
 */

import { POLICY } from "./policy";
import { NEUTRAL_LABELS } from "./texts";
import { readFile } from "node:fs/promises";
import { extname, join } from "pathe";
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

/** 抹平 CRLF 与老式 CR 为 LF，保证跨平台正文指纹零漂移 */
export const normalizeLf = (text: string): string =>
  text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");

/** 跨平台行切分，换行归一先于切片 */
export const splitLines = (text: string): readonly string[] => normalizeLf(text).split("\n");

/** 连续空白与全角空格收敛成单个空格，首尾去掉（正则 `/[\\s\\u3000]+/gu` 匹配 ASCII 空白与全角空格） */
export const collapseWhitespace = (text: string): string =>
  text.replace(/[\s\u3000]+/gu, " ").trim();

/** 去掉 Markdown 扩展名，大小写不敏感，不是路径切片 */
export const stripMarkdownExtension = (text: string): string => {
  const extension = extname(text);
  return extension.toLowerCase() === ".md" ? text.slice(0, -extension.length) : text;
};

/**
 * 标量/数组源头归一函数：
 *
 * 【为什么不能只用 radash 的 isArray 判断】：
 * 1. 语义不同：`isArray(val)` 只是一个类型谓词（boolean 判断），调用方拿到 false 后仍需手写三元表达式或 if 分支去构造 `[]` 或 `[val]`；
 * 2. 脏数据防御：Markdown Frontmatter 或外部 JSON 解析经常出现 `tags: null`、`tags: ""`、`tags: undefined`，或者用户手写了单标量 `tags: "interview"`（而非 `tags: ["interview"]`）；
 * 3. 抹平类型收敛：此函数将「未定义/空串/单标量/真实数组」在入口处一次性收敛为真正的安全数组 `T[]`，下游链式调用（如 `.map()`、`.filter()`、`...` 解构）即可 100% 信任解构，彻底消灭全链路散落的防御八股代码。
 */
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

/**
 * 安全解析 Markdown 文本及其 YAML Frontmatter，抹平回车换行并使用 YAML 1.2 引擎接管
 */
export function parseMarkdownSafely<T = Record<string, unknown>>(rawMarkdown: string): ParsedMarkdownResult<T> {
  const parsed = matter(normalizeLf(rawMarkdown), matterYamlEngine);
  return Object.freeze({
    data: Object.freeze({ ...(parsed.data as T) }),
    content: parsed.content,
    body: parsed.content.trim(),
  });
}

/**
 * 将数据对象序列化为 YAML Frontmatter 并拼接正文内容，保证标量换行与特殊字符安全
 */
export function stringifyMarkdownSafely(content: string, data: Record<string, unknown>): string {
  return matter.stringify(content, data, matterYamlEngine);
}

/**
 * 异步读取物理文件并安全解析为 Markdown 结构体
 */
export async function readMarkdownFile<T = Record<string, unknown>>(
  ...pathSegments: string[]
): Promise<ParsedMarkdownResult<T>> {
  const raw = await readFile(join(...pathSegments), "utf8");
  return parseMarkdownSafely<T>(raw);
}

// 正则 `/\n(?=##\s)/` 基于前瞻断言按二级标题行切分章节块，保留 ## 标记
const splitH2Blocks = (markdown: string): readonly string[] => normalizeLf(markdown).split(/\n(?=##\s)/);
// 仅匹配第一行标题是否包含目标关键词，避免章节内部正文词汇误伤判定
const isH2Block = (block: string, keyword: string): boolean => {
  const firstLine = block.split("\n")[0] ?? "";
  return firstLine.startsWith("## ") && firstLine.includes(keyword);
};

/** 按二级标题剔除章节（## 为 Markdown 标题语法，非路径路由） */
export function dropSection(markdown: string, targetKeyword: string): string {
  return splitH2Blocks(markdown).filter((block) => !isH2Block(block, targetKeyword)).join("\n");
}

/** 按二级标题提取章节正文 */
export function extractSection(markdown: string, targetKeyword: string): string {
  return splitH2Blocks(markdown).find((block) => isH2Block(block, targetKeyword)) ?? "";
}

// 正则 `/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g` 提取 Markdown 双链 `[[target]]` 或 `[[target|alias]]` 的核心目标名
const wikilinkTargets = (markdown: string): readonly string[] =>
  [...markdown.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map(([, raw]) => raw.trim());

/** 判断文档是否包含指向目标词条的 [[双链]]（支持别名管道符与 .md 后缀） */
export function hasWikiLink(markdown: string, relPath: string): boolean {
  // 正则 `/\.md$/` 剥离尾部 .md 扩展名，获得纯文件名词条名
  const stem = relPath.replace(/\.md$/, "");
  return wikilinkTargets(markdown).some((target) => target === relPath || target === stem);
}

/** 判断指定章节（缺省回退信源相关常见标题）是否已收录该信源双链 */
export function hasSourceLink(
  markdown: string,
  relPath: string,
  sectionKeywords: readonly string[] | string = ["sources", "关联信源", "信源"]
): boolean {
  const keywords = Array.isArray(sectionKeywords) ? sectionKeywords : [sectionKeywords];
  const section = keywords.map((kw) => extractSection(markdown, kw)).find((s) => s.length > 0);
  return hasWikiLink(section || markdown, relPath);
}

// 匹配非标准 LaTeX 数学行内符号（如 `$\neq$`, `$\le$` 等），统一映射转义为干净 Unicode 符号
const LATEX_UNICODE: Readonly<Record<string, string>> = Object.freeze({
  "$\\neq$": "≠",
  "$\\le$": "≤",
  "$\\ge$": "≥",
  "$\\times$": "×",
  "$\\div$": "÷",
  "$\\pm$": "±",
  "$\\approx$": "≈",
});

/**
 * 非标 LaTeX 数学符号转通用 Unicode（单一字典查表，平铺 replace 链归零）
 * 正则 `/\$[^$]+\$/g` 捕获以单个美元符号包围的行内公式片段
 */
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
  // 正则 `/^#{1,2}\s+(.+)/m` 提取首个 1 级或 2 级 Markdown 标题
  const heading = body.match(/^#{1,2}\s+(.+)/m);
  return heading?.[1].trim() ?? fallbackTitle;
}

/** 标题降噪：剥离话题标签、压平空白、超长截断 */
export function condenseTitle(rawTitle: string, maxLen = POLICY.text.condenseMaxLen): string {
  // 正则 `/#+[^\s#]+/gu` 剥离类似 `#话题` 的标签文本
  const stripped = collapseWhitespace(rawTitle.replace(/#[^\s#]+/gu, ""));
  const base = stripped || rawTitle.trim();
  return base.length > maxLen ? `${base.slice(0, maxLen)}…` : base;
}

/**
 * 可读标题规范化：剥离话题标签与残留井号，空白折叠，空值兜底。
 * 与 condenseTitle 职责不同，此函数保留可读符号且不截断，供卡片 title 与 H1 使用。
 */
export const normalizeReadableTitle = (rawTitle: string, fallback = NEUTRAL_LABELS.untitled): string => {
  // 正则 `/#+[\w\u4e00-\u9fa5]+/gu` 剥离带词条的话题标签，`/#/gu` 剥离孤立残存的井号
  const withoutTags = collapseWhitespace(rawTitle.replace(/#+[\w\u4e00-\u9fa5]+/gu, " ").replace(/#/gu, " "));
  const stripped = collapseWhitespace(rawTitle.replace(/#/gu, " "));
  return withoutTags || stripped || fallback;
};

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
      // 单元格换行转空格（`/\r?\n/g`），管道符转义为 `\|`（`/\|/g`），避免破坏 Markdown 表格行列结构
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
  fallbackHeading = "## Notes"
): string {
  const normalized = normalizeLf(markdown);
  if (headingRegex.test(normalized)) return normalized.replace(headingRegex, `$&\n${entry}`);

  const trimmed = normalized.trimEnd();
  return trimmed.length > 0
    ? `${trimmed}\n\n${fallbackHeading}\n${entry}\n`
    : `${fallbackHeading}\n${entry}\n`;
}
