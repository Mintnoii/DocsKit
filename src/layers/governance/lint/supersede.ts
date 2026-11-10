/** 演化链与裁决态判定，输入输出都是普通数据，零文件访问 */

import { basename, extname } from "pathe";
import { sift } from "radash";

export interface SupersedeCard {
  readonly stem: string;
  readonly title: string;
  readonly status: string;
  readonly conflict: string;
  readonly supersededBy: string | null;
}

export interface ConflictRecordLike {
  readonly id: string;
  readonly status: "open" | "resolved";
  readonly existingPath: string;
  readonly candidatePath: string | null;
  readonly decision?: "keep" | "supersede" | null;
}

export type SupersedeIssueKind =
  | "missing_conflict_record"
  | "missing_superseded_by"
  | "dangling_superseded_by"
  | "missing_card"
  | "resolution_mismatch";

export interface SupersedeIssue {
  readonly kind: SupersedeIssueKind;
  readonly cardPath: string;
  readonly title: string;
  readonly detail: string;
}

export interface SupersedeAuditReport {
  readonly openConflicts: number;
  readonly resolvedConflicts: number;
  readonly deprecatedCards: number;
  readonly issues: readonly SupersedeIssue[];
}

const stemOf = (path: string): string => basename(path, extname(path));

const makeIssue = (
  kind: SupersedeIssueKind,
  cardPath: string,
  title: string,
  detail: string
): SupersedeIssue => ({ kind, cardPath, title, detail });

/** 五类违规逐项判定，调用方负责读盘与台账加载 */
export const auditSupersedeChain = (
  cards: readonly SupersedeCard[],
  conflicts: readonly ConflictRecordLike[]
): SupersedeAuditReport => {
  const cardStems = new Set(cards.map((card) => card.stem));
  const openRecords = conflicts.filter((record) => record.status === "open");
  const resolvedRecords = conflicts.filter((record) => record.status === "resolved");
  const deprecatedCards = cards.filter((card) => card.status === "deprecated");

  const missingRecords = cards
    .filter((card) => card.conflict === "open")
    .filter(
      (card) =>
        !openRecords.some((record) => {
          const candidateStem = record.candidatePath === null ? "" : stemOf(record.candidatePath);
          return stemOf(record.existingPath) === card.stem || candidateStem === card.stem;
        })
    )
    .map((card) =>
      makeIssue("missing_conflict_record", card.stem, card.title, card.stem)
    );

  const deprecatedIssues = deprecatedCards.flatMap((card) => {
    if (!card.supersededBy) {
      return [makeIssue("missing_superseded_by", card.stem, card.title, card.stem)];
    }
    return cardStems.has(stemOf(card.supersededBy))
      ? []
      : [makeIssue("dangling_superseded_by", card.stem, card.title, card.supersededBy)];
  });

  const recordIssues = conflicts.flatMap((record) => {
    const existingStem = stemOf(record.existingPath);
    const candidateStem = record.candidatePath === null ? "" : stemOf(record.candidatePath);

    const missing = sift([
      cardStems.has(existingStem)
        ? null
        : makeIssue("missing_card", existingStem, existingStem, `${record.id}:existing`),
      candidateStem && !cardStems.has(candidateStem)
        ? makeIssue("missing_card", candidateStem, candidateStem, `${record.id}:candidate`)
        : null,
    ]);

    const keepStem = record.decision === "keep" ? existingStem : candidateStem;
    const keepCard = cards.find((card) => card.stem === keepStem);
    const mismatch = record.status === "resolved" && record.decision && keepCard && keepCard.conflict !== "resolved"
      ? [makeIssue("resolution_mismatch", keepStem, keepCard.title, `${record.id}:${record.decision}:${keepCard.conflict}`)]
      : [];

    return [...missing, ...mismatch];
  });

  return {
    openConflicts: openRecords.length,
    resolvedConflicts: resolvedRecords.length,
    deprecatedCards: deprecatedCards.length,
    issues: [...missingRecords, ...deprecatedIssues, ...recordIssues],
  };
};
