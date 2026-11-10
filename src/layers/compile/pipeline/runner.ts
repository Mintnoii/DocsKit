import { computeMarkdownBodyHash } from "../../../foundation/hash";
import { normalizeMarkdownContent } from "../../ingest/ast/normalize";
import { distillMarkdownContent } from "../../ingest/ast/distiller";
import { diffDocumentSections, applySectionPatch } from "../patch/section-patcher";
import { checkHumanLock } from "../../../foundation/guard";
import { parseMarkdownSafely, stringifyMarkdownSafely } from "../../../contracts/markdown";
import type { CompileMode, PipelineOptions, PipelineResult, PipelineTexts } from "./options";

interface CompileContext {
  readonly normalizedContent: string;
  readonly existingContent?: string;
  readonly title: string;
  readonly modeling?: "ipo" | "decomposition" | "hybrid";
  readonly deprecationNotice: boolean;
  readonly texts?: PipelineTexts;
}

interface CompileOutcome {
  readonly content: string;
  readonly action: PipelineResult["action"];
  /** patch 阶段推导出的元数据补丁（废弃声明），由组装层统一落盘 */
  readonly patchMeta?: Readonly<Record<string, unknown>>;
}

const COMPILE_STRATEGIES: Readonly<Record<CompileMode, (ctx: CompileContext) => CompileOutcome>> = {
  distill: (ctx) => ({
    content: distillMarkdownContent(ctx.normalizedContent, ctx.title, { ...ctx.texts?.distill, modeling: ctx.modeling }),
    action: "DISTILLED",
  }),
  patch: (ctx) => {
    if (!ctx.existingContent) return { content: ctx.normalizedContent, action: "CREATED" };

    const diff = diffDocumentSections(ctx.existingContent, ctx.normalizedContent, ctx.title, ctx.texts?.section);
    return {
      content: applySectionPatch(ctx.existingContent, diff, {
        appendDeprecatedWarning: ctx.deprecationNotice,
        texts: ctx.texts?.section,
      }),
      action: "PATCHED",
      patchMeta: diff.hasDeprecated
        ? { deprecation_warning: diff.deprecatedDetails.join("; ") }
        : {},
    };
  },
  passThrough: (ctx) => ({ content: ctx.normalizedContent, action: "CREATED" }),
};

/**
 * 声明式通用编译流水线：清洗 → 门禁 → 提纯对账 → 元数据组装。
 * 各阶段纯查表分派，patch 模式保留旧卡片 frontmatter 并落盘废弃声明。
 */
export async function runPipeline<TMeta extends object = Record<string, unknown>>(
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
    texts,
  } = options;
  const { idempotency = true, humanLock = true } = gates;
  const { extractAttachments = true, deprecationNotice = false, transformLink } = features;

  const normalized = normalizeMarkdownContent(rawInput, { extractAttachments, transformLink, texts: texts?.normalize });

  // 门禁 A：人工锁阻断
  if (humanLock && existingContent && checkHumanLock(existingContent)) {
    const { data, content } = parseMarkdownSafely(existingContent);
    return {
      action: "SKIPPED_HUMAN_LOCK",
      skipped: true,
      skipReason: "LOCKED_BY_HUMAN",
      content: content.trim(),
      fullMarkdown: existingContent,
      bodyHash: computeMarkdownBodyHash(existingContent),
      frontmatter: data as TMeta,
      attachments: [],
    };
  }

  // 门禁 B：0-Token 纯正文指纹幂等短路
  const currentBodyHash = computeMarkdownBodyHash(normalized.cleanContent);
  if (idempotency && currentBodyHash && knownFingerprints?.has(currentBodyHash)) {
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

  const outcome = COMPILE_STRATEGIES[compileMode]({
    normalizedContent: normalized.cleanContent,
    existingContent,
    title,
    modeling,
    deprecationNotice,
    texts,
  });

  // 旧卡片元数据作为基底，新素材 frontmatter 覆盖，废弃声明最后并入
  const existingMeta = compileMode === "patch" && existingContent
    ? parseMarkdownSafely(existingContent).data
    : {};
  const baseData = {
    ...(compileMode === "distill" && modeling ? { modeling } : {}),
    ...(metadata.defaultValues ?? {}),
    ...existingMeta,
    ...normalized.frontmatter,
    ...(outcome.patchMeta ?? {}),
  } as TMeta;

  const finalFrontmatter = metadata.transform
    ? metadata.transform(baseData, outcome.content)
    : baseData;

  return {
    action: outcome.action,
    skipped: false,
    content: outcome.content,
    fullMarkdown: stringifyMarkdownSafely(outcome.content, finalFrontmatter as Record<string, unknown>),
    bodyHash: currentBodyHash,
    frontmatter: Object.freeze(finalFrontmatter),
    attachments: normalized.attachments,
  };
}
