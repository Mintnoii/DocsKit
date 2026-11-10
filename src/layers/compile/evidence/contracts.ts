/** 证据链契约：段落、引用、覆盖校验结果与策略参数 */

export interface AnchorParagraph {
  readonly anchor: string;
  readonly headingPath: string;
  readonly index: number;
  readonly text: string;
  readonly hash: string;
}

export interface SourceRef {
  readonly anchor: string;
  readonly hash: string;
  readonly quote: string;
  readonly claim: string;
}

export interface ClaimCoverageResult {
  readonly coverage: number;
  readonly missingLatinTokens: readonly string[];
  readonly passed: boolean;
}

/** 阈值与长度都是策略，默认值对齐下游现有行为，调用方按需覆盖 */
export interface EvidenceOptions {
  readonly minParagraphLength?: number;
  readonly maxQuoteLength?: number;
  readonly maxClaimLength?: number;
  readonly minClaimCoverage?: number;
  readonly minLatinTokenLength?: number;
  readonly limit?: number;
  readonly hashLength?: number;
  readonly rootHeadingPath?: string;
}

export type ResolvedEvidenceOptions = Required<EvidenceOptions>;

export const DEFAULT_EVIDENCE_OPTIONS: ResolvedEvidenceOptions = Object.freeze({
  minParagraphLength: POLICY.evidence.minParagraphLength,
  maxQuoteLength: POLICY.evidence.maxQuoteLength,
  maxClaimLength: POLICY.evidence.maxClaimLength,
  minClaimCoverage: POLICY.evidence.minClaimCoverage,
  minLatinTokenLength: POLICY.evidence.minLatinTokenLength,
  limit: POLICY.evidence.limit,
  hashLength: POLICY.evidence.hashLength,
  rootHeadingPath: NEUTRAL_LABELS.rootHeading,
});

/** 解析并冻结证据链校验策略参数，缺省回退 POLICY 单一真理源 */
export const resolveEvidenceOptions = (
  options: EvidenceOptions = {}
): ResolvedEvidenceOptions => ({ ...DEFAULT_EVIDENCE_OPTIONS, ...options });
import { POLICY } from "../../../contracts/policy";
import { NEUTRAL_LABELS } from "../../../contracts/texts";
