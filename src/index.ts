// 核心算子命名空间导出
export * as ast from "./core/ast/index";
export * as sense from "./core/sense/index";
export * as patch from "./core/patch/index";
export * as hash from "./core/hash/index";
export * as lint from "./core/lint/index";

// 顶层平坦常用算子导出
export { parseMarkdownWithAST, distillMarkdownContent, type ConceptModeling, type DistillOptions } from "./core/ast/distiller";
export { normalizeMarkdownContent, type MarkdownNormalizeResult, type MarkdownAttachment, type NormalizeOptions } from "./core/ast/normalize";
export { computeContentHash, computeMarkdownBodyHash, checkContentIdempotency, type IdempotencyResult } from "./core/hash/index";
export { checkHumanLock, type LintResult } from "./core/lint/index";
export { BM25Engine } from "./core/sense/bm25";
export { computeLateChunking } from "./core/sense/late-chunking";
export { diffDocumentSections, applySectionPatch } from "./core/patch/section-patcher";
export { rrfFuseScores } from "./core/sense/index";

// 流水线引擎与类型导出
export { runPipeline } from "./pipeline/runner";
export type {
  PipelineOptions,
  PipelineResult,
  CompileMode,
  PipelineGates,
  PipelineFeatures,
  PipelineMetadataOptions,
} from "./pipeline/options";
