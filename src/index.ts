// ==========================================
// Cyberbrain (電脳) 门面统一聚合导出
// ==========================================

export * as hash from "./core/hash/index";
export * as ast from "./core/ast/index";
export * as snapshot from "./core/snapshot/index";
export * as sense from "./core/sense/index";
export * as patch from "./core/patch/index";
export * as lint from "./core/lint/index";
export * as graph from "./core/graph/index";
export * as jit from "./core/jit/index";
export * as pipeline from "./pipeline/index";

// 顶层直接扁平常用算子
export {
  computeContentHash,
  computeMarkdownBodyHash,
  checkContentIdempotency,
  type IdempotencyResult,
} from "./core/hash/index";

export {
  normalizeMarkdownContent,
  parseMarkdownWithAST,
  distillMarkdownContent,
  appendCardAttachments,
  createOKFMetadata,
  createOKFConceptMetadata,
  updateOKFMetadata,
  buildOKFConceptCard,
  getMarkdownFiles,
  type ScanMarkdownFilesOptions,
  type MarkdownAttachment,
  type MarkdownNormalizeResult,
  type NormalizeOptions,
  type ParsedMarkdownAST,
  type ParsedMarkdownSection,
  type ConceptModeling,
  type DistillOptions,
  type CardAttachmentItem,
  type BuildOKFConceptCardOptions,
  type OKFConceptCardResult,
} from "./core/ast/index";

export {
  sanitizeFileName,
  parseSnapshotMeta,
  buildSnapshotPath,
  isVersionNewer,
  type SnapshotMeta,
} from "./core/snapshot/index";

export {
  BM25Engine,
  computeLateChunking,
  locateTopSectionsWithLateChunking,
  rrfFuseScores,
  cleanTextForVector,
  buildNgramVocabulary,
  textToNgramVector,
  cosineSimilarityVectors,
  computeTextNgramSimilarity,
  createReranker,
  HttpReranker,
  LocalOnnxReranker,
  rankDocumentsByNgramVector,
  executeHybridRankPipeline,
  type HybridSearchableDocument,
  type HybridRankResult,
  type HybridRankingPipelineOptions,
  type LateChunkSectionSpan,
  type LateChunkItem,
  type LateChunkOutput,
  type LocatedSectionResult,
  type Reranker,
  type RerankItem,
  type RerankResult,
  type RerankConfig,
} from "./core/sense/index";


export {
  extractWikiOutboundLinks,
  indexBidirectionalGraph,
  type GraphCardNode,
} from "./core/graph/index";

export {
  formatAgentJITPrompt,
  type JITCardItem,
  type JITFormatOptions,
} from "./core/jit/index";

export {
  diffDocumentSections,
  applySectionPatch,
  evaluateDedupGate,
  computeNgramSimilarity,
  type SectionDiffResult,
  type SectionDiffItem,
  type DedupCandidateItem,
  type DedupMatchResult,
  type DedupGateOptions,
} from "./core/patch/index";

export {
  runPipeline,
  type CompileMode,
  type PipelineOptions,
  type PipelineResult,
  type PipelineGates,
  type PipelineFeatures,
} from "./pipeline/index";
