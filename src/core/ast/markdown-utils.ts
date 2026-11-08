import { outdent } from "outdent";
import matter from "gray-matter";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export { outdent };

export interface ParsedMarkdownResult<T = Record<string, unknown>> {
  readonly data: Readonly<T>;
  readonly content: string;
  readonly body: string;
}

/**
 * 工业级 Frontmatter 引擎配置：依托 eemeli/yaml 接管 YAML 1.2 序列化与反序列化
 * - 纯函数式：标量安全，特殊字符自动转义加引号，常规标量纯净直出
 */
export const matterYamlEngine = Object.freeze({
  engines: {
    yaml: {
      parse: (str: string) => parseYaml(str) ?? {},
      stringify: (data: object) => stringifyYaml(data, { lineWidth: 0 }),
    },
  },
});

/**
 * 标量安全的 Markdown 解析
 */
export function parseMarkdownSafely<T = Record<string, unknown>>(rawMarkdown: string): ParsedMarkdownResult<T> {
  const normalized = (rawMarkdown ?? "").replace(/\r\n/g, "\n");
  const parsed = matter(normalized, matterYamlEngine);
  return Object.freeze({
    data: Object.freeze({ ...(parsed.data as T) }),
    content: parsed.content,
    body: parsed.content.trim(),
  });
}

/**
 * 标量安全的 Markdown 序列化
 */
export function stringifyMarkdownSafely(content: string, data: Record<string, unknown>): string {
  return matter.stringify(content, data, matterYamlEngine);
}

/**
 * 标题降噪：去除标签、换行多余空白，超长截断并加省略号
 */
export function condenseTitle(rawTitle: string, maxLen = 40): string {
  const stripped = rawTitle
    .replace(/#[^\s#]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const base = stripped || rawTitle.trim();
  return base.length > maxLen ? `${base.slice(0, maxLen)}…` : base;
}

export interface MarkdownTableOptions {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly (string | number | boolean | null | undefined)[])[];
  readonly align?: readonly ("left" | "center" | "right")[];
}

/**
 * 声明式 Markdown 表格渲染算子（拒绝脆弱的手写管道符拼接）
 */
export function renderMarkdownTable(options: MarkdownTableOptions): string {
  const { headers, rows, align } = options;
  if (headers.length === 0) return "";

  const colCount = headers.length;
  const alignTokens = headers.map((_, idx) => {
    const a = align?.[idx] ?? "left";
    if (a === "center") return ":---:";
    if (a === "right") return "---:";
    return ":---";
  });

  const headerLine = `| ${headers.join(" | ")} |`;
  const separatorLine = `| ${alignTokens.join(" | ")} |`;

  const dataLines = rows.map((row) => {
    const cells = Array.from({ length: colCount }, (_, idx) => {
      const val = row[idx];
      if (val === null || val === undefined) return "";
      // 避免单元格内换行破坏表格结构
      return String(val).replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
    });
    return `| ${cells.join(" | ")} |`;
  });

  return [headerLine, separatorLine, ...dataLines].join("\n");
}

/**
 * 在指定二级标题下方精确追加内容；若标题不存在，则安全追加并创建补充标题
 */
export function appendUnderHeading(
  markdown: string,
  headingRegex: RegExp,
  entry: string,
  fallbackHeading = "## 补充说明"
): string {
  const normalized = (markdown ?? "").replace(/\r\n/g, "\n");

  if (headingRegex.test(normalized)) {
    return normalized.replace(headingRegex, `$&\n${entry}`);
  }

  const trimmed = normalized.trimEnd();
  return trimmed.length > 0 ? `${trimmed}\n\n${fallbackHeading}\n${entry}\n` : `${fallbackHeading}\n${entry}\n`;
}
