/**
 * Markdown 归一：Callout 结构转换、附件抽取、链接改写与结构统计。
 *
 * 附件占位、附录表头与提示语由 NormalizeTexts 注入，引擎内零业务文案。
 * 节点位置契约统一走 ast/position，杜绝非空断言与手搓递归。
 */

import { createRequire } from "node:module";
import { extname } from "pathe";
import { sift, sort } from "radash";
import type { Code, Link, Root, Text } from "mdast";
import { parseMarkdownSafely, renderMarkdownTable, splitLines } from "../../../contracts/markdown";
import { NEUTRAL_LABELS, type AppendixRenderer, type NormalizeTexts } from "../../../contracts/texts";
import { offsetOf, positioned, type PositionedNode } from "./position";

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

const SELECTORS = Object.freeze({ link: "link", table: "table", code: "code", text: "text" });

const BINARY_EXTENSIONS = new Set([
  ".zip", ".tar", ".gz", ".exe", ".apk", ".dmg", ".pdf", ".docx", ".xlsx", ".pptx",
]);

/**
 * @example
 * ":::tip 核心建议\n请遵循。\n:::" → "> [!TIP] 核心建议\n> 请遵循。\n"
 * 只做容器到 GitHub Alerts 的结构转换，标题与正文原样来自输入。
 */
const CALLOUT_CONTAINER = /:::([a-zA-Z]+)(?:[ \t]+([^\n]+))?\n+([\s\S]*?):::/g;

/**
 * 匹配以 `> 💡` 开头的旧式表情提示行，统一替换为标准 GitHub Alert `> [!NOTE] `
 */
const CALLOUT_TIP = /> 💡[ \t]*/g;

export interface MarkdownAttachment {
  readonly name: string;
  readonly url: string;
  readonly ext: string;
}

export interface NormalizeOptions {
  readonly extractAttachments?: boolean;
  readonly transformLink?: (url: string, text: string) => string | null;
  readonly texts?: NormalizeTexts;
}

export interface MarkdownStructureStats {
  readonly calloutsCount: number;
  readonly tablesCount: number;
  readonly mermaidCount: number;
  readonly codeBlocksCount: number;
  readonly attachmentsCount: number;
  readonly linksTransformedCount: number;
}

export interface MarkdownNormalizeResult {
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly cleanContent: string;
  readonly attachments: ReadonlyArray<MarkdownAttachment>;
  readonly stats: MarkdownStructureStats;
}

const NEUTRAL_APPENDIX: AppendixRenderer = (attachments) =>
  renderMarkdownTable({
    headers: ["#", "Name", "Format", "URL"],
    align: ["center", "left", "center", "left"],
    rows: attachments.map((att, idx) => [
      idx + 1,
      `\`${att.name}\``,
      `\`.${att.ext}\``,
      `[raw](${att.url})`,
    ]),
  });

const NEUTRAL_TEXTS: NormalizeTexts = Object.freeze({
  attachmentBadge: (name: string): string => `[attachment: ${name}]`,
  downloadPrefix: "",
  appendix: NEUTRAL_APPENDIX,
  attachmentFallback: NEUTRAL_LABELS.attachmentFallback,
});

interface LinkReplacement {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

const isBinaryLink = (link: Link): boolean => BINARY_EXTENSIONS.has(extname(link.url).toLowerCase());

const textOfLink = (link: Link, selectAll: MdastDeps["selectAll"]): string =>
  (selectAll(SELECTORS.text, link) as Text[]).map((node) => node.value).join("");

const replacementOf = (link: Link & PositionedNode, replacement: string): LinkReplacement => ({
  start: offsetOf(link.position.start),
  end: offsetOf(link.position.end),
  replacement,
});

const standardizeCallouts = (text: string): { readonly preprocessedText: string; readonly calloutsCount: number } => {
  const containers = [...text.matchAll(CALLOUT_CONTAINER)];
  const containerReplaced = text.replace(
    CALLOUT_CONTAINER,
    (_match, type: string, title: string | undefined, body: string = "") => {
      const alertType = type.toUpperCase();
      const header = title?.trim() ? `> [!${alertType}] ${title.trim()}` : `> [!${alertType}]`;
      const formattedBody = splitLines(body.trim()).map((line) => `> ${line}`).join("\n");
      return `${header}\n${formattedBody}\n`;
    }
  );
  const tipCount = [...containerReplaced.matchAll(CALLOUT_TIP)].length;

  return {
    preprocessedText: containerReplaced.replace(CALLOUT_TIP, "> [!NOTE] "),
    calloutsCount: containers.length + tipCount,
  };
};

/**
 * 结构化解析并规范化原始 Markdown 正文
 * 提取附件二进制链接、替换为徽标并在文末追加附件清单，标准化 Callout 语法块
 */
export function normalizeMarkdownContent(
  rawMarkdown: string,
  options: NormalizeOptions = {}
): MarkdownNormalizeResult {
  const { extractAttachments = true, transformLink, texts = NEUTRAL_TEXTS } = options;
  const { data: frontmatter, content } = parseMarkdownSafely(rawMarkdown);
  const { preprocessedText, calloutsCount } = standardizeCallouts(content);
  const { fromMarkdown, gfmFromMarkdown, gfm, selectAll } = mdastDeps();

  const tree: Root = fromMarkdown(preprocessedText, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

  const codeNodes = positioned(selectAll(SELECTORS.code, tree) as Code[]);
  const tablesCount = selectAll(SELECTORS.table, tree).length;
  const links = positioned(selectAll(SELECTORS.link, tree) as Link[]);
  const binaryLinks = extractAttachments ? links.filter(isBinaryLink) : [];

  const attachments: readonly MarkdownAttachment[] = binaryLinks.map((link) => {
    const ext = extname(link.url).toLowerCase();
    const pureExt = ext.slice(1);
    const label = textOfLink(link, selectAll).trim();
    const stripped = texts.downloadPrefix && label.slice(0, texts.downloadPrefix.length) === texts.downloadPrefix
      ? label.slice(texts.downloadPrefix.length).trim()
      : label;
    const cleanName = stripped.trim() || `${texts.attachmentFallback}.${pureExt}`;
    return { name: cleanName.endsWith(ext) ? cleanName : `${cleanName}${ext}`, url: link.url, ext: pureExt };
  });

  const attachmentReplacements = binaryLinks.map((link, idx) =>
    replacementOf(link, texts.attachmentBadge(attachments[idx].name))
  );

  const transformedReplacements = transformLink
    ? sift(
        links
          .filter((link) => !(extractAttachments && isBinaryLink(link)))
          .map((link) => {
            const transformed = transformLink(link.url, textOfLink(link, selectAll).trim());
            return transformed ? replacementOf(link, transformed) : null;
          })
      )
    : [];

  const replaced = sort(
    [...attachmentReplacements, ...transformedReplacements],
    (rep) => rep.start,
    true
  )
    .reduce(
      (text, rep) => `${text.slice(0, rep.start)}${rep.replacement}${text.slice(rep.end)}`,
      preprocessedText
    );

  const withAppendix = attachments.length > 0
    ? `${replaced}\n\n${texts.appendix(attachments)}`
    : replaced;

  return {
    frontmatter,
    // 正则 `/\n{3,}/g` 将连续 3 个及以上多余换行折叠为标准双换行 `\n\n`
    cleanContent: withAppendix.replace(/\n{3,}/g, "\n\n").trim(),
    attachments: Object.freeze(attachments),
    stats: {
      calloutsCount,
      tablesCount,
      mermaidCount: codeNodes.filter((node) => node.lang === "mermaid").length,
      codeBlocksCount: codeNodes.length,
      attachmentsCount: attachments.length,
      linksTransformedCount: transformedReplacements.length,
    },
  };
}
