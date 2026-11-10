/** 证据选段与锚点复算，打分与指纹都复用公共底座 */

import { computeTextNgramSimilarity } from "../../../foundation/numeric";
import { resolveEvidenceOptions, type AnchorParagraph, type EvidenceOptions, type SourceRef } from "./contracts";
import { mechanicalClaim } from "./claims";
import { splitAnchorableParagraphs } from "./paragraphs";

interface ScoredParagraph {
  readonly paragraph: AnchorParagraph;
  readonly score: number;
}

const byScoreThenAnchor = (left: ScoredParagraph, right: ScoredParagraph): number =>
  right.score - left.score || left.paragraph.anchor.localeCompare(right.paragraph.anchor);

const byLengthThenAnchor = (left: ScoredParagraph, right: ScoredParagraph): number =>
  right.paragraph.text.length - left.paragraph.text.length ||
  left.paragraph.anchor.localeCompare(right.paragraph.anchor);

const truncateQuote = (text: string, maxLength: number): string =>
  text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;

/** 按字符级 N-Gram 打分选段，全零时退化为按段落长度选，条数受 limit 约束 */
export const buildSourceRefs = (
  paragraphs: readonly AnchorParagraph[],
  query: string,
  options: EvidenceOptions = {}
): readonly SourceRef[] => {
  const resolved = resolveEvidenceOptions(options);
  const scored: readonly ScoredParagraph[] = paragraphs.map((paragraph) => ({
    paragraph,
    score: computeTextNgramSimilarity(query, paragraph.text),
  }));

  const positive = scored.filter((item) => item.score > 0).sort(byScoreThenAnchor);
  const fallback = [...scored].sort(byLengthThenAnchor);
  const selected = positive.length > 0 ? positive : fallback;

  return selected.slice(0, resolved.limit).map(({ paragraph }) => ({
    anchor: paragraph.anchor,
    hash: paragraph.hash,
    quote: truncateQuote(paragraph.text, resolved.maxQuoteLength),
    claim: mechanicalClaim(paragraph.text, { maxClaimLength: resolved.maxClaimLength }),
  }));
};

/** 复算必须与生成共用同一份输入文本，函数内部不做额外清洗 */
export const verifySourceRef = (
  ref: SourceRef,
  markdown: string,
  options: EvidenceOptions = {}
): boolean => {
  const matched = splitAnchorableParagraphs(markdown, options).find(
    (paragraph) => paragraph.anchor === ref.anchor
  );
  if (!matched || matched.hash !== ref.hash) return false;

  const quote = ref.quote.endsWith("…") ? ref.quote.slice(0, -1) : ref.quote;
  return matched.text.includes(quote);
};
