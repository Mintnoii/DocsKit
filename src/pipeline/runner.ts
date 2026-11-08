import matter from "gray-matter";
import { normalizeMarkdownContent } from "../core/ast/normalize";
import { distillMarkdownContent } from "../core/ast/distiller";
import { computeMarkdownBodyHash, checkContentIdempotency } from "../core/hash/index";
import { diffDocumentSections, applySectionPatch } from "../core/patch/section-patcher";
import { checkHumanLock } from "../core/lint/index";
import type { PipelineOptions, PipelineResult } from "./options";

/**
 * 知识库声明式通用编译流水线执行器 (Configurable Pipeline Runner)
 *
 * 严格执行 4 阶段正交管道：
 * 1. 清洗 (Sanitize)：抹平换行、统一 Callout 为 GitHub 块引用、提取附件资产；
 * 2. 门禁 (Gate)：0-Token 纯正文指纹幂等校验 + 人工锁阻断；
 * 3. 提纯与对账 (Process)：
 *    - patch: 按章节 AST 对比增量合并，支持废弃警告；
 *    - distill: 抽取核心定义、IPO 结构与精选代码；
 *    - passThrough: 直通；
 * 4. 元数据计算与交付格式化：执行自定义元数据转换与标准 YAML 前置封装。
 */
export async function runPipeline<TMeta extends Record<string, any> = Record<string, any>>(
  rawInput: string,
  options: PipelineOptions<TMeta>
): Promise<PipelineResult<TMeta>> {
  const {
    title,
    compileMode = "patch",
    modeling,
    existingContent,
    gates = {},
    features = {},
    knownFingerprints,
    metadata = {},
  } = options;

  const {
    idempotency = true,
    humanLock = true,
  } = gates;

  const {
    extractAttachments = true,
    deprecationNotice = false,
    transformLink,
  } = features;

  // 阶段 1：格式清洗 (Sanitize)
  const normalized = normalizeMarkdownContent(rawInput, {
    extractAttachments,
    transformLink,
  });

  // 阶段 2：门禁检查 (Gate)
  // 门禁 A：人工锁检查 (若目标已有人工锁标记，坚决阻断)
  if (humanLock && existingContent && checkHumanLock(existingContent)) {
    const existingParsed = matter(existingContent);
    return {
      action: "SKIPPED_HUMAN_LOCK",
      skipped: true,
      skipReason: "LOCKED_BY_HUMAN",
      content: existingParsed.content.trim(),
      fullMarkdown: existingContent,
      bodyHash: computeMarkdownBodyHash(existingContent),
      frontmatter: existingParsed.data as TMeta,
      attachments: [],
    };
  }

  // 门禁 B：0-Token 纯正文指纹幂等检查
  const currentBodyHash = computeMarkdownBodyHash(normalized.cleanContent);
  if (idempotency && currentBodyHash) {
    if (knownFingerprints && knownFingerprints.has(currentBodyHash)) {
      return {
        action: "SKIPPED_IDEMPOTENCY",
        skipped: true,
        skipReason: "UNCHANGED_HASH",
        content: normalized.cleanContent,
        fullMarkdown: rawInput,
        bodyHash: currentBodyHash,
        frontmatter: normalized.frontmatter as TMeta,
        attachments: normalized.attachments,
      };
    }
  }

  // 阶段 3：提纯与对账 (Process)
  let processedContent = normalized.cleanContent;
  let actionResult: PipelineResult<TMeta>["action"] = "CREATED";

  if (compileMode === "distill") {
    processedContent = distillMarkdownContent(normalized.cleanContent, title, {
      modeling,
    });
    actionResult = "DISTILLED";
  } else if (compileMode === "patch" && existingContent) {
    const patchDiff = diffDocumentSections(existingContent, normalized.cleanContent, title);
    processedContent = applySectionPatch(existingContent, patchDiff, {
      appendDeprecatedWarning: deprecationNotice,
    });
    actionResult = "PATCHED";
  }

  // 阶段 4：元数据计算与封装 (Metadata & Assemble)
  const defaultModeling = compileMode === "distill" && modeling ? { modeling } : {};
  const baseData = {
    ...defaultModeling,
    ...(metadata.defaultValues || {}),
    ...(normalized.frontmatter || {}),
  } as TMeta;

  const finalFrontmatter = metadata.transform
    ? metadata.transform(baseData, processedContent)
    : baseData;

  const fullMarkdown = matter.stringify(processedContent, finalFrontmatter);

  return {
    action: actionResult,
    skipped: false,
    content: processedContent,
    fullMarkdown,
    bodyHash: currentBodyHash,
    frontmatter: Object.freeze(finalFrontmatter),
    attachments: normalized.attachments,
  };
}
