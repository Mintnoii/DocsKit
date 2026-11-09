import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { selectAll } from "unist-util-select";
import { extname } from "pathe";
import { isObject, isString, sift } from "radash";
import type { Link, Root } from "mdast";
import { ensureArray, outdent, parseMarkdownSafely, renderMarkdownTable } from "../shared/markdown";

export interface MarkdownAttachment {
  readonly name: string;
  readonly url: string;
  readonly ext: string;
}

export interface NormalizeOptions {
  /** 是否抽取二进制附件并在文末生成资产表格，默认 true */
  readonly extractAttachments?: boolean;
  /** 可选站内链接转相对双链的回调钩子 */
  readonly transformLink?: (url: string, text: string) => string | null;
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

const BINARY_EXTENSIONS = new Set([
  ".zip", ".tar", ".gz", ".exe", ".apk", ".dmg", ".pdf", ".docx", ".xlsx", ".pptx",
]);

const CALLOUT_CONTAINER = /:::([a-zA-Z]+)(?:[ \t]+([^\n]+))?[\n]+([\s\S]*?):::/g;
const CALLOUT_TIP = /> 💡[ \t]*/g;

interface LinkReplacement {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

const isBinaryLink = (link: Link): boolean => BINARY_EXTENSIONS.has(extname(link.url).toLowerCase());

/** MDAST 语法树驱动：Callout 归一、附件抽取、链接改写与结构统计 */
export function normalizeMarkdownContent(
  rawMarkdown: string,
  options: NormalizeOptions = {}
): MarkdownNormalizeResult {
  const { extractAttachments = true, transformLink } = options;
  const { data: frontmatter, content } = parseMarkdownSafely(rawMarkdown);
  const { preprocessedText, calloutsCount } = standardizeCallouts(content);

  const tree: Root = fromMarkdown(preprocessedText, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

  const tablesCount = selectAll("table", tree).length;
  const codeBlocksCount = selectAll("code", tree).length;
  const mermaidCount = selectAll('code[lang="mermaid"]', tree).length;

  const links = selectAll("link", tree) as Link[];
  const binaryLinks = extractAttachments ? links.filter(isBinaryLink) : [];

  const attachments = binaryLinks.map((link): MarkdownAttachment => {
    const ext = extname(link.url).toLowerCase();
    const pureExt = ext.slice(1);
    const cleanName = collectNodeText(link).trim().replace(/^下载\s*/, "").trim() || `attachment.${pureExt}`;
    return {
      name: cleanName.endsWith(ext) ? cleanName : `${cleanName}${ext}`,
      url: link.url,
      ext: pureExt,
    };
  });

  const attachmentReplacements = binaryLinks.map((link, idx) =>
    replacementOf(link, `📎 **[附件资产: ${attachments[idx].name}]** *(见文末附件清单)*`)
  );

  const transformedReplacements = transformLink
    ? sift(
        links
          .filter((link) => !(extractAttachments && isBinaryLink(link)))
          .map((link) => {
            const transformed = transformLink(link.url, collectNodeText(link).trim());
            return transformed ? replacementOf(link, transformed) : null;
          })
      )
    : [];

  let cleanContent = [...attachmentReplacements, ...transformedReplacements]
    .sort((a, b) => b.start - a.start)
    .reduce(
      (text, rep) => `${text.slice(0, rep.start)}${rep.replacement}${text.slice(rep.end)}`,
      preprocessedText
    );

  if (attachments.length > 0) {
    cleanContent = `${cleanContent}\n\n${generateAttachmentsAppendix(attachments)}`;
  }

  return {
    frontmatter,
    cleanContent: cleanContent.replace(/\n{3,}/g, "\n\n").trim(),
    attachments: Object.freeze(attachments),
    stats: {
      calloutsCount,
      tablesCount,
      mermaidCount,
      codeBlocksCount,
      attachmentsCount: attachments.length,
      linksTransformedCount: transformedReplacements.length,
    },
  };
}

const replacementOf = (link: Link, replacement: string): LinkReplacement => ({
  start: link.position!.start.offset!,
  end: link.position!.end.offset!,
  replacement,
});

/** Callout 容器转标准 GitHub Alerts，计数与替换分离，杜绝回调副作用 */
function standardizeCallouts(text: string): { preprocessedText: string; calloutsCount: number } {
  const containers = [...text.matchAll(CALLOUT_CONTAINER)];
  const containerReplaced = text.replace(CALLOUT_CONTAINER, (_match, type: string, title: string | undefined, body: string = "") => {
    const alertType = type.toUpperCase();
    const header = title?.trim() ? `> [!${alertType}] ${title.trim()}` : `> [!${alertType}]`;
    const formattedBody = body.trim().split("\n").map((line: string) => `> ${line}`).join("\n");
    return `${header}\n${formattedBody}\n`;
  });
  const tipCount = [...containerReplaced.matchAll(CALLOUT_TIP)].length;

  return {
    preprocessedText: containerReplaced.replace(CALLOUT_TIP, "> [!NOTE] "),
    calloutsCount: containers.length + tipCount,
  };
}

/** 递归收集 MDAST 节点纯文本（源头归一，业务链路零类型猜忌） */
function collectNodeText(node: unknown): string {
  if (isString(node)) return node;
  if (!isObject(node)) return "";
  const { value, children } = node as { value?: unknown; children?: unknown };
  return isString(value) ? value : ensureArray<unknown>(children).map(collectNodeText).join("");
}

/** 声明式生成附件清单附录 */
function generateAttachmentsAppendix(attachments: readonly MarkdownAttachment[]): string {
  return outdent`
    ---

    ### 📦 外部附件与关联资产清单

    > [!NOTE] 以下附件从原始素材中提取留痕：

    ${renderMarkdownTable({
      headers: ["序号", "附件名称", "格式", "资源地址"],
      align: ["center", "left", "center", "left"],
      rows: attachments.map((att, idx) => [
        idx + 1,
        `\`${att.name}\``,
        `\`.${att.ext}\``,
        `[原始下载链接](${att.url})`,
      ]),
    })}
  `;
}
