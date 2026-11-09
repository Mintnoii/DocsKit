import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { selectAll } from "unist-util-select";
import { sift } from "radash";
import type { Heading } from "mdast";
import { outdent, parseMarkdownSafely } from "../shared/markdown";

export interface SectionBlock {
  readonly title: string;
  readonly level: number;
  readonly content: string;
  readonly rawText: string;
}

export interface SectionDiffItem {
  readonly title: string;
  readonly type: "UPDATED" | "ADDED" | "DEPRECATED";
  readonly oldContent?: string;
  readonly newContent?: string;
  readonly details: string;
}

export interface SectionDiffResult {
  readonly action: "NO_OP" | "PATCH_SECTIONS" | "DEPRECATE_FEATURE";
  readonly modifiedSections: readonly SectionDiffItem[];
  readonly hasDeprecated: boolean;
  readonly deprecatedDetails: readonly string[];
}

export interface ApplyPatchOptions {
  /** 是否向废弃章节注入警告块，默认 true */
  readonly appendDeprecatedWarning?: boolean;
  /** 修订版本标识，默认 "Latest" */
  readonly revisionTag?: string;
}

const INTRO_TITLE = "## 引言与前言";
const API_PATTERN = /`[a-zA-Z0-9_]+\([^)]*\)`/g;

const isIntro = (title: string): boolean => ["引言", "前言"].some((keyword) => title.includes(keyword));
const compact = (text: string): string => text.replace(/\s+/g, "");
const apiNamesOf = (text: string): readonly string[] => text.match(API_PATTERN) ?? [];
const asMap = (sections: readonly SectionBlock[]): Map<string, SectionBlock> =>
  new Map(sections.map((section) => [section.title, section]));

/**
 * MDAST 驱动的章节切分：代码块里的 `## 注释` 绝不会被误判为标题，
 * Frontmatter 由统一底座剥离，不再落入引言正文。
 */
export function parseSections(markdown: string): SectionBlock[] {
  const { body } = parseMarkdownSafely(markdown);
  if (!body) return [];

  const tree = fromMarkdown(body, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const headings = (selectAll("heading", tree) as Heading[])
    .filter((heading) => (heading.depth === 2 || heading.depth === 3) && heading.position);

  const intro = body.slice(0, headings[0]?.position?.start.offset ?? body.length).trim();
  const introBlocks: SectionBlock[] = intro
    ? [{ title: INTRO_TITLE, level: 2, content: intro, rawText: intro }]
    : [];

  const sectionBlocks = headings.map((heading, idx): SectionBlock => {
    const title = body.slice(heading.position!.start.offset, heading.position!.end.offset).trim();
    const rawText = body.slice(
      heading.position!.end.offset,
      headings[idx + 1]?.position?.start.offset ?? body.length
    );
    return { title, level: heading.depth, content: rawText.trim(), rawText };
  });

  return [...introBlocks, ...sectionBlocks];
}

/** 章节级差量对账：废弃 / 更新 / 新增三类变更纯集合变换得出 */
export function diffDocumentSections(
  oldMarkdown: string,
  newMarkdown: string,
  _docTitle = "未命名文档"
): SectionDiffResult {
  const oldSections = parseSections(oldMarkdown);
  const newSections = parseSections(newMarkdown);
  const newMap = asMap(newSections);
  const oldMap = asMap(oldSections);

  const removed = oldSections
    .filter((section) => !isIntro(section.title) && !newMap.has(section.title))
    .map((section): SectionDiffItem => ({
      title: section.title,
      type: "DEPRECATED",
      oldContent: section.content,
      details: `旧章节《${section.title}》已在最新版本中被移除`,
    }));

  const changed = oldSections
    .filter((section) => !isIntro(section.title) && newMap.has(section.title))
    .filter((section) => compact(section.content) !== compact(newMap.get(section.title)!.content))
    .map((section): SectionDiffItem => {
      const incoming = newMap.get(section.title)!;
      const incomingApis = apiNamesOf(incoming.content);
      const removedApis = apiNamesOf(section.content).filter((api) => !incomingApis.includes(api));
      return removedApis.length > 0
        ? {
            title: section.title,
            type: "DEPRECATED",
            oldContent: section.content,
            newContent: incoming.content,
            details: `检测到已废弃的接口定义: ${removedApis.join(", ")}`,
          }
        : {
            title: section.title,
            type: "UPDATED",
            oldContent: section.content,
            newContent: incoming.content,
            details: "章节内容局部变更",
          };
    });

  const added = newSections
    .filter((section) => !isIntro(section.title) && !oldMap.has(section.title))
    .map((section): SectionDiffItem => ({
      title: section.title,
      type: "ADDED",
      newContent: section.content,
      details: `新增章节《${section.title}》`,
    }));

  const modifiedSections = [...removed, ...changed, ...added];
  const deprecatedDetails = modifiedSections
    .filter((item) => item.type === "DEPRECATED")
    .map((item) => item.details);

  return {
    action: modifiedSections.length === 0 ? "NO_OP" : "PATCH_SECTIONS",
    modifiedSections,
    hasDeprecated: deprecatedDetails.length > 0,
    deprecatedDetails,
  };
}

const warningOf = (details: string, revisionTag: string): string => outdent`
  > [!WARNING] ⚠️ 章节/接口废弃声明 (${revisionTag})
  > ${details}。请注意迁移。
`;

/** 靶向缝合正文：未受影响章节原样保留，废弃声明注入正文章节内 */
export function applySectionPatch(
  oldCardRaw: string,
  diffResult: SectionDiffResult,
  options: ApplyPatchOptions = {}
): string {
  const { appendDeprecatedWarning = true, revisionTag = "Latest" } = options;
  const patches = new Map(diffResult.modifiedSections.map((item) => [item.title, item]));

  const retained = parseSections(oldCardRaw).map((section): string | null => {
    const patch = patches.get(section.title);
    if (!patch || patch.type === "ADDED") return `${section.title}\n\n${section.content}\n`;
    if (patch.type === "UPDATED") return `${section.title}\n\n${patch.newContent}\n`;

    const warning = appendDeprecatedWarning ? `${warningOf(patch.details, revisionTag)}\n\n` : "";
    const body = patch.newContent ?? patch.oldContent ?? "";
    return `${section.title}\n\n${warning}${body}\n`;
  });

  const appended = diffResult.modifiedSections
    .filter((item) => item.type === "ADDED")
    .map((item) => `${item.title}\n\n${item.newContent}\n`);

  return [...sift(retained), ...appended].join("\n").trim();
}
