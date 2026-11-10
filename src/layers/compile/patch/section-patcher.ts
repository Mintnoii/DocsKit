/**
 * 章节差量对账与靶向缝合。
 * 诊断文案与废弃声明模板由 SectionTexts 注入，节点位置走 ast/position 契约。
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { first, sift } from "radash";
import type { Heading } from "mdast";
import { parseMarkdownSafely } from "../../../contracts/markdown";
import { POLICY } from "../../../contracts/policy";
import { offsetOf, positioned } from "../../ingest/ast/position";
import type { SectionTexts } from "../../../contracts/texts";

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

const SELECTORS = Object.freeze({ heading: "heading" });

/**
 * 匹配 Markdown 中的反引号函数签名调用（如 `` `foo(bar)` ``），用于比对章节更新时是否发生旧 API 废弃/删除
 */
const API_PATTERN = /`[a-zA-Z0-9_]+\([^)]*\)`/g;

const NEUTRAL_TEXTS: SectionTexts = Object.freeze({
  introTitle: "## Introduction",
  introKeywords: [],
  notice: (details: string, revisionTag: string): string => `> [!WARNING] ${details} (${revisionTag})`,
  details: Object.freeze({
    removed: (): string => "section_removed",
    removedApis: (): string => "api_removed",
    changed: "section_changed",
    added: (): string => "section_added",
  }),
});

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
  readonly appendDeprecatedWarning?: boolean;
  readonly revisionTag?: string;
  readonly texts?: SectionTexts;
}

const isIntro = (title: string, texts: SectionTexts): boolean =>
  texts.introKeywords.some((keyword) => title.includes(keyword));
/** 剔除所有空白字符（包括空格、制表符、换行），用于纯内容实质等价性比对 */
const compact = (text: string): string => text.replace(/\s+/g, "");
const apiNamesOf = (text: string): readonly string[] => text.match(API_PATTERN) ?? [];
const asMap = (sections: readonly SectionBlock[]): Map<string, SectionBlock> =>
  new Map(sections.map((section) => [section.title, section]));

/** @example parseSections("## A\n内容") → [{ title: "## A", content: "内容", level: 2 }] */
export function parseSections(markdown: string, texts: SectionTexts = NEUTRAL_TEXTS): SectionBlock[] {
  const { body } = parseMarkdownSafely(markdown);
  if (!body) return [];

  const { fromMarkdown, gfmFromMarkdown, gfm, selectAll } = mdastDeps();
  const tree = fromMarkdown(body, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  // 仅切分二级 (depth=2, ##) 与三级 (depth=3, ###) 标题作为可对账独立章节
  const headings = positioned(selectAll(SELECTORS.heading, tree) as Heading[])
    .filter((heading) => heading.depth === 2 || heading.depth === 3);

  const firstHeading = first(headings);
  const introEnd = firstHeading ? offsetOf(firstHeading.position.start) : body.length;
  const intro = body.slice(0, introEnd).trim();
  // 章节起始前的引言前言，默认归属为 Introduction 章节块（深度级别 2）
  const introBlocks: readonly SectionBlock[] = intro
    ? [{ title: texts.introTitle, level: 2, content: intro, rawText: intro }]
    : [];

  const sectionBlocks: readonly SectionBlock[] = headings.map((heading, idx) => {
    const title = body.slice(offsetOf(heading.position.start), offsetOf(heading.position.end)).trim();
    const end = headings[idx + 1] ? offsetOf(headings[idx + 1].position.start) : body.length;
    const rawText = body.slice(offsetOf(heading.position.end), end);
    return { title, level: heading.depth, content: rawText.trim(), rawText };
  });

  return [...introBlocks, ...sectionBlocks];
}

/** 废弃 / 更新 / 新增三类变更纯集合变换得出 */
export function diffDocumentSections(
  oldMarkdown: string,
  newMarkdown: string,
  _docTitle = "",
  texts: SectionTexts = NEUTRAL_TEXTS
): SectionDiffResult {
  const oldSections = parseSections(oldMarkdown, texts);
  const newSections = parseSections(newMarkdown, texts);
  const newMap = asMap(newSections);
  const oldMap = asMap(oldSections);

  const removed = oldSections
    .filter((section) => !isIntro(section.title, texts) && !newMap.has(section.title))
    .map((section): SectionDiffItem => ({
      title: section.title,
      type: "DEPRECATED",
      oldContent: section.content,
      details: texts.details.removed(section.title),
    }));

  const changed = oldSections
    .filter((section) => !isIntro(section.title, texts) && newMap.has(section.title))
    .map((section) => {
      const incoming = newMap.get(section.title);
      assert(incoming, "section_map_missing");
      return { section, incoming };
    })
    .filter(({ section, incoming }) => compact(section.content) !== compact(incoming.content))
    .map(({ section, incoming }): SectionDiffItem => {
      const incomingApis = apiNamesOf(incoming.content);
      const removedApis = apiNamesOf(section.content).filter((api) => !incomingApis.includes(api));
      return removedApis.length > 0
        ? {
            title: section.title,
            type: "DEPRECATED",
            oldContent: section.content,
            newContent: incoming.content,
            details: texts.details.removedApis(removedApis),
          }
        : {
            title: section.title,
            type: "UPDATED",
            oldContent: section.content,
            newContent: incoming.content,
            details: texts.details.changed,
          };
    });

  const added = newSections
    .filter((section) => !isIntro(section.title, texts) && !oldMap.has(section.title))
    .map((section): SectionDiffItem => ({
      title: section.title,
      type: "ADDED",
      newContent: section.content,
      details: texts.details.added(section.title),
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

/** 靶向缝合正文：未受影响章节原样保留，废弃声明由注入模板生成 */
export function applySectionPatch(
  oldCardRaw: string,
  diffResult: SectionDiffResult,
  options: ApplyPatchOptions = {}
): string {
  const {
    appendDeprecatedWarning = true,
    revisionTag = POLICY.section.defaultRevision,
    texts = NEUTRAL_TEXTS,
  } = options;
  const patches = new Map(diffResult.modifiedSections.map((item) => [item.title, item]));

  const retained = parseSections(oldCardRaw, texts).map((section): string | null => {
    const patch = patches.get(section.title);
    if (!patch || patch.type === "ADDED") return `${section.title}\n\n${section.content}\n`;
    if (patch.type === "UPDATED") return `${section.title}\n\n${patch.newContent}\n`;

    const warning = appendDeprecatedWarning ? `${texts.notice(patch.details, revisionTag)}\n\n` : "";
    const body = patch.newContent ?? patch.oldContent ?? "";
    return `${section.title}\n\n${warning}${body}\n`;
  });

  const appended = diffResult.modifiedSections
    .filter((item) => item.type === "ADDED")
    .map((item) => `${item.title}\n\n${item.newContent}\n`);

  return [...sift(retained), ...appended].join("\n").trim();
}
