/**
 * 文案契约层：只定义渲染器签名与中性标签，不持有任何业务文案。
 * 中文模板与提示词由 src/presets/zh-cn.ts 显式注入。
 */

export type ConceptModeling = "ipo" | "decomposition" | "hybrid";
export type JITMode = "compact" | "detailed";

export interface DistillSection {
  readonly title: string;
  readonly body: string;
}

export interface DistillRenderContext {
  readonly title: string;
  readonly summary: string;
  readonly modeling: ConceptModeling;
  readonly sections: readonly DistillSection[];
  readonly codeBlocks: readonly string[];
  readonly tables: readonly string[];
}

export type DistillRenderer = (context: DistillRenderContext) => string;

export interface DistillExtractor {
  readonly summary: (content: string, title: string) => string;
  readonly sectionFilter: (title: string) => boolean;
}

export interface AttachmentData {
  readonly name: string;
  readonly url: string;
  readonly ext: string;
}

export type AppendixRenderer = (attachments: readonly AttachmentData[]) => string;

export interface NormalizeTexts {
  readonly attachmentBadge: (name: string) => string;
  readonly downloadPrefix: string;
  readonly appendix: AppendixRenderer;
  readonly attachmentFallback: string;
}

export interface JITLink {
  readonly title: string;
  readonly filePath: string;
}

export interface JITRenderCard {
  readonly title: string;
  readonly summary: string;
  readonly filePath: string;
  readonly content?: string;
  readonly dependencies?: readonly JITLink[];
  readonly dependents?: readonly JITLink[];
}

export interface OkfTexts {
  readonly appendixHeading: string;
  readonly attachmentLine: (item: { readonly name: string; readonly url: string }) => string;
}

export interface SectionTexts {
  readonly introTitle: string;
  readonly introKeywords: readonly string[];
  readonly notice: (details: string, revisionTag: string) => string;
  readonly details: {
    readonly removed: (title: string) => string;
    readonly removedApis: (apis: readonly string[]) => string;
    readonly changed: string;
    readonly added: (title: string) => string;
  };
}

export interface JITRenderContext {
  readonly query: string;
  readonly matches: readonly JITRenderCard[];
  readonly mode: JITMode;
  readonly vaultName: string;
  readonly topCardPaths: readonly string[];
}

export type JITRenderer = (context: JITRenderContext) => string;

/** 引擎内缺省标签，全部中性，业务语言由调用方注入 */
export const NEUTRAL_LABELS = Object.freeze({
  untitled: "Untitled",
  rootHeading: "ROOT",
  defaultVaultName: "vault",
  attachmentFallback: "attachment",
});
