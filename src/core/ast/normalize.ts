import matter from "gray-matter";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { visit } from "unist-util-visit";
import { selectAll } from "unist-util-select";
import { extname } from "pathe";
import type { Root, Link } from "mdast";

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
  ".zip", ".tar", ".gz", ".exe", ".apk", ".dmg", ".pdf", ".docx", ".xlsx", ".pptx"
]);

/**
 * 纯 AST 驱动的通用 Markdown 语法清洗与规范化器
 *
 * 核心审美规范：
 * 1. 采用 `unist-util-select` 声明式 CSS 选择器统计图表与表格，杜绝手写天书正则；
 * 2. 节点识别全量走 MDAST 语法树访问者模式（Visitor），只对真实 `link` 节点操作，绝不误伤正文与代码块；
 * 3. 附件资产与站内指针在 AST 阶段准确定位，声明式构建表格；
 * 4. 保持 Markdown 源生格式纯净度，无多余转义。
 */
export function normalizeMarkdownContent(
  rawMarkdown: string,
  options: NormalizeOptions = {}
): MarkdownNormalizeResult {
  const { extractAttachments = true, transformLink } = options;
  const normalizedInput = (rawMarkdown ?? "").replace(/\r\n/g, "\n");
  const { data: frontmatter, content } = matter(normalizedInput);

  // 1. 规范化 Callout 容器为标准 GitHub 块引用
  const { preprocessedText, calloutsCount } = standardizeCallouts(content);

  // 2. 解析为标准 MDAST 语法树
  const tree: Root = fromMarkdown(preprocessedText, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

  // 3. 利用 unist-util-select 声明式统计文档核心结构指标 (零正则，工业级准确)
  const tables = selectAll("table", tree);
  const codeBlocks = selectAll("code", tree);
  const mermaidBlocks = selectAll('code[lang="mermaid"]', tree);

  let linksTransformedCount = 0;
  const attachments: MarkdownAttachment[] = [];
  const linkReplacements: Array<{ readonly start: number; readonly end: number; readonly replacement: string }> = [];

  // 4. 访问者模式遍历：准确定位链接，零天书正则
  visit(tree, (node) => {
    if (node.type !== "link" || !node.position) {
      return;
    }

    const link = node as Link;
    const url = link.url || "";
    const ext = extname(url).toLowerCase();
    const linkText = collectNodeText(link).trim();

    // 判定 1：外部二进制附件资产 (基于 pathe.extname 标准扩展名判定)
    if (extractAttachments && BINARY_EXTENSIONS.has(ext)) {
      const pureExt = ext.slice(1);
      const cleanName = linkText.replace(/^下载\s*/, "").trim() || `attachment.${pureExt}`;
      const finalName = cleanName.endsWith(ext) ? cleanName : `${cleanName}${ext}`;

      attachments.push({ name: finalName, url, ext: pureExt });
      linkReplacements.push({
        start: node.position.start.offset!,
        end: node.position.end.offset!,
        replacement: `📎 **[附件资产: ${finalName}]** *(见文末附件清单)*`,
      });
      return;
    }

    // 判定 2：站内/外部自定义链接转换钩子
    if (transformLink) {
      const transformed = transformLink(url, linkText);
      if (transformed) {
        linksTransformedCount++;
        linkReplacements.push({
          start: node.position.start.offset!,
          end: node.position.end.offset!,
          replacement: transformed,
        });
      }
    }
  });

  // 5. 按 AST 物理位置从后向前精确替换
  let cleanContent = preprocessedText;
  const sortedReplacements = [...linkReplacements].sort((a, b) => b.start - a.start);
  for (const rep of sortedReplacements) {
    cleanContent = `${cleanContent.slice(0, rep.start)}${rep.replacement}${cleanContent.slice(rep.end)}`;
  }

  // 6. 若抽取到了附件，声明式构建标准资产附录表格追加文末
  if (extractAttachments && attachments.length > 0) {
    cleanContent += generateAttachmentsAppendix(attachments);
  }

  // 7. 清除连续无意义空行
  cleanContent = cleanContent.replace(/\n{3,}/g, "\n\n").trim();

  return {
    frontmatter: Object.freeze(frontmatter),
    cleanContent,
    attachments: Object.freeze(attachments),
    stats: {
      calloutsCount,
      tablesCount: tables.length,
      mermaidCount: mermaidBlocks.length,
      codeBlocksCount: codeBlocks.length,
      attachmentsCount: attachments.length,
      linksTransformedCount,
    },
  };
}

/**
 * 平实转换 Callout 语法为标准 GitHub Alerts
 */
function standardizeCallouts(text: string): { preprocessedText: string; calloutsCount: number } {
  let count = 0;
  const replaced = text
    .replace(
      /:::([a-zA-Z]+)(?:[ \t]+([^\n]+))?[\n]+([\s\S]*?):::/g,
      (_match, type: string, title?: string, body: string = "") => {
        count++;
        const alertType = type.toUpperCase();
        const header = title?.trim() ? `> [!${alertType}] ${title.trim()}` : `> [!${alertType}]`;
        const formattedBody = body
          .trim()
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n");
        return `${header}\n${formattedBody}\n`;
      }
    )
    .replace(/> 💡[ \t]*/g, () => {
      count++;
      return "> [!NOTE] ";
    });

  return { preprocessedText: replaced, calloutsCount: count };
}

/**
 * 递归收集 MDAST 节点的纯文本值
 */
function collectNodeText(node: any): string {
  if (!node) return "";
  if (node.value) return node.value;
  if (Array.isArray(node.children)) {
    return node.children.map(collectNodeText).join("");
  }
  return "";
}

/**
 * 声明式生成附件清单表格
 */
function generateAttachmentsAppendix(attachments: readonly MarkdownAttachment[]): string {
  const rows = attachments
    .map((att, idx) => `| ${idx + 1} | \`${att.name}\` | \`.${att.ext}\` | [原始下载链接](${att.url}) |`)
    .join("\n");

  return `\n\n---\n\n### 📦 外部附件与关联资产清单\n\n> [!NOTE] 以下附件从原始素材中提取留痕：\n\n| 序号 | 附件名称 | 格式 | 资源地址 |\n| :---: | :--- | :---: | :--- |\n${rows}`;
}
