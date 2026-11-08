import matter from "gray-matter";

export interface SectionBlock {
  readonly title: string;       // 章节标题，如 "## 2. 核心接口契约"
  readonly level: number;       // 2
  readonly content: string;     // 该章节下的正文
  readonly rawText: string;     // 原始文本
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

/**
 * 将 Markdown 按 ## / ### 标题解析为结构化章节列表（支持集合式变换）
 */
export function parseSections(markdown: string): SectionBlock[] {
  const lines = (markdown ?? "").split(/\r?\n/);
  const sections: SectionBlock[] = [];

  let currentTitle = "## 引言与前言";
  let currentLines: string[] = [];
  let currentLevel = 2;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{2,3})\s+(.+)$/);
    if (headingMatch) {
      if (currentLines.length > 0) {
        sections.push({
          title: currentTitle,
          level: currentLevel,
          content: currentLines.join("\n").trim(),
          rawText: currentLines.join("\n"),
        });
      }
      currentLevel = headingMatch[1].length;
      currentTitle = line.trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0 || sections.length === 0) {
    sections.push({
      title: currentTitle,
      level: currentLevel,
      content: currentLines.join("\n").trim(),
      rawText: currentLines.join("\n"),
    });
  }

  return sections;
}

/**
 * 段落级 AST 差量对账器
 */
export function diffDocumentSections(
  oldMarkdown: string,
  newMarkdown: string,
  _docTitle = "未命名文档"
): SectionDiffResult {
  const oldSections = parseSections(oldMarkdown);
  const newSections = parseSections(newMarkdown);

  const modifiedSections: SectionDiffItem[] = [];
  const deprecatedDetails: string[] = [];

  const newMap = new Map<string, SectionBlock>();
  for (const s of newSections) {
    newMap.set(s.title, s);
  }

  // 1. 遍历旧章节，对比是否被更新或被删除 (废弃判定)
  for (const oldSec of oldSections) {
    if (oldSec.title.includes("引言") || oldSec.title.includes("前言")) continue;

    const matchedNew = newMap.get(oldSec.title);

    if (!matchedNew) {
      // 旧章节在新文档中未找到 -> 废弃
      const desc = `旧章节《${oldSec.title}》已在最新版本中被移除`;
      deprecatedDetails.push(desc);
      modifiedSections.push({
        title: oldSec.title,
        type: "DEPRECATED",
        oldContent: oldSec.content,
        details: desc,
      });
    } else {
      const oldClean = oldSec.content.replace(/\s+/g, "");
      const newClean = matchedNew.content.replace(/\s+/g, "");

      if (oldClean !== newClean) {
        const oldApis: string[] = oldSec.content.match(/`[a-zA-Z0-9_]+\([^)]*\)`/g) || [];
        const newApis: string[] = matchedNew.content.match(/`[a-zA-Z0-9_]+\([^)]*\)`/g) || [];
        const newApiSet = new Set<string>(newApis);
        const removedApis = oldApis.filter((api) => !newApiSet.has(api));

        if (removedApis.length > 0) {
          const desc = `检测到已废弃的接口定义: ${removedApis.join(", ")}`;
          deprecatedDetails.push(desc);
          modifiedSections.push({
            title: oldSec.title,
            type: "DEPRECATED",
            oldContent: oldSec.content,
            newContent: matchedNew.content,
            details: desc,
          });
        } else {
          modifiedSections.push({
            title: oldSec.title,
            type: "UPDATED",
            oldContent: oldSec.content,
            newContent: matchedNew.content,
            details: "章节内容局部变更",
          });
        }
      }
    }
  }

  // 2. 检查全新添加的章节
  const oldMap = new Map<string, SectionBlock>();
  for (const s of oldSections) {
    oldMap.set(s.title, s);
  }

  for (const newSec of newSections) {
    if (newSec.title.includes("引言") || newSec.title.includes("前言")) continue;
    if (!oldMap.has(newSec.title)) {
      modifiedSections.push({
        title: newSec.title,
        type: "ADDED",
        newContent: newSec.content,
        details: `新增章节《${newSec.title}》`,
      });
    }
  }

  return {
    action: modifiedSections.length === 0 ? "NO_OP" : "PATCH_SECTIONS",
    modifiedSections,
    hasDeprecated: deprecatedDetails.length > 0,
    deprecatedDetails,
  };
}

/**
 * 靶向精准缝合更新卡片正文（保持未受影响章节完全不变，支持废弃警告注入）
 */
export function applySectionPatch(
  oldCardRaw: string,
  diffResult: SectionDiffResult,
  options: ApplyPatchOptions = {}
): string {
  const { appendDeprecatedWarning = true, revisionTag = "Latest" } = options;
  const { data: fm, content: oldContent } = matter(oldCardRaw);
  const oldSections = parseSections(oldContent);

  if (diffResult.hasDeprecated) {
    fm.deprecation_warning = diffResult.deprecatedDetails.join("; ");
  }

  const updatedSectionTexts: string[] = [];

  for (const sec of oldSections) {
    const patch = diffResult.modifiedSections.find((m) => m.title === sec.title);

    if (!patch) {
      updatedSectionTexts.push(`${sec.title}\n\n${sec.content}\n`);
    } else if (patch.type === "UPDATED") {
      updatedSectionTexts.push(`${sec.title}\n\n${patch.newContent}\n`);
    } else if (patch.type === "DEPRECATED") {
      if (appendDeprecatedWarning) {
        const warning = `> [!WARNING] ⚠️ 章节/接口废弃声明 (${revisionTag})\n> ${patch.details}。请注意迁移。\n\n`;
        const body = patch.newContent ? patch.newContent : (patch.oldContent || "");
        updatedSectionTexts.push(`${sec.title}\n\n${warning}${body}\n`);
      } else if (patch.newContent) {
        updatedSectionTexts.push(`${sec.title}\n\n${patch.newContent}\n`);
      }
    }
  }

  // 追加新增章节
  const addedSections = diffResult.modifiedSections.filter((m) => m.type === "ADDED");
  for (const add of addedSections) {
    updatedSectionTexts.push(`${add.title}\n\n${add.newContent}\n`);
  }

  let finalBody = updatedSectionTexts.join("\n").trim();
  if (fm.title && !finalBody.startsWith("# ")) {
    finalBody = `# ${fm.title}\n\n${finalBody}`;
  }

  return finalBody;
}
