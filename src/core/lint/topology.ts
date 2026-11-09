/**
 * 知识库拓扑与生命周期巡检纯函数（零外部 IO，可离线内存执行）
 */

import { basename, normalize } from "pathe";
import { group } from "radash";
import { parseMarkdownSafely } from "../shared/markdown";
import { validateOKFMetadata } from "../ast/okf-meta";

export interface VaultLintCardItem {
  readonly filePath: string;
  readonly title: string;
  readonly content: string;
  readonly outboundLinks?: readonly string[];
  readonly backlinks?: readonly string[];
  readonly frontmatter?: Record<string, unknown>;
}

export interface BrokenLinkItem {
  readonly sourceFile: string;
  readonly target: string;
}

export interface SchemaViolationItem {
  readonly filePath: string;
  readonly errors: readonly string[];
}

export interface VaultTopologyLintResult {
  readonly totalFiles: number;
  readonly brokenLinks: readonly BrokenLinkItem[];
  readonly orphanCards: readonly string[];
  readonly schemaErrors: readonly SchemaViolationItem[];
  readonly isHealthy: boolean;
}

/** 人工权威锁标记（lock: human / locked: true）阻断自动覆写 */
export function checkHumanLock(markdownContent: string): boolean {
  if (!markdownContent) return false;
  const { data } = parseMarkdownSafely(markdownContent);
  return data.lock === "human" || data.locked === true;
}

const relativeCardKey = (filePath: string): string =>
  normalize(filePath).replace(/.*\/wiki\//, "wiki/").replace(/\.md$/, "");

const isKnownTarget = (target: string, existingNames: ReadonlySet<string>): boolean => {
  const cleanTarget = target.split("|")[0].trim().replace(/\.md$/, "");
  const candidates = [
    cleanTarget,
    cleanTarget.replace(/.*\/wiki\//, "wiki/"),
    cleanTarget.split("/").pop() ?? "",
  ];
  return candidates.some((candidate) => existingNames.has(candidate));
};

/** 全库断链、孤岛与 OKF Schema 健康度巡检 */
export function lintVaultTopology(cards: readonly VaultLintCardItem[]): VaultTopologyLintResult {
  const existingNames = new Set(
    cards.flatMap((card) => {
      const rel = relativeCardKey(card.filePath);
      return [card.title, rel, basename(rel)].filter(Boolean);
    })
  );

  const brokenLinks = cards.flatMap((card) =>
    (card.outboundLinks ?? [])
      .filter((target) => !isKnownTarget(target, existingNames))
      .map((target) => ({
        sourceFile: normalize(card.filePath),
        target: target.split("|")[0].trim().replace(/\.md$/, ""),
      }))
  );

  const orphanCards = cards
    .filter((card) => (card.backlinks?.length ?? 0) === 0 && (card.outboundLinks?.length ?? 0) === 0)
    .map((card) => card.title);

  const schemaErrors = cards.flatMap((card) => {
    const fm = card.frontmatter ?? parseMarkdownSafely(card.content).data;
    if (!fm.type) return [];
    const validation = validateOKFMetadata(fm);
    return validation.valid
      ? []
      : [{ filePath: normalize(card.filePath), errors: validation.errors }];
  });

  return {
    totalFiles: cards.length,
    brokenLinks,
    orphanCards,
    schemaErrors,
    isHealthy: brokenLinks.length === 0 && schemaErrors.length === 0,
  };
}

export interface LifecycleCardItem {
  readonly title: string;
  readonly filePath: string;
  readonly updated?: string;
  readonly created?: string;
  readonly status?: "evergreen" | "developing" | "deprecated" | string;
  readonly outboundCount?: number;
  readonly inboundCount?: number;
}

export interface StaleCandidateItem {
  readonly title: string;
  readonly filePath: string;
  readonly updated: string;
  readonly daysSinceUpdate: number;
  readonly suggestion: "keep" | "review_stale" | "deprecate";
}

export interface VaultLifecycleAuditResult {
  readonly totalScanned: number;
  readonly evergreenCount: number;
  readonly developingCount: number;
  readonly deprecatedCount: number;
  readonly staleCandidates: readonly StaleCandidateItem[];
  readonly orphanCards: readonly string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 生命周期健康大盘：状态按实际值统计，缺失日期不伪造、不参与陈旧判定 */
export function auditVaultLifecycle(
  cards: readonly LifecycleCardItem[],
  options?: { readonly staleDays?: number; readonly now?: number }
): VaultLifecycleAuditResult {
  const staleDays = options?.staleDays ?? 90;
  const now = options?.now ?? Date.now();
  const statusGroups = group(cards, (card) => card.status ?? "unspecified");

  const staleCandidates = cards.flatMap((card): StaleCandidateItem[] => {
    const updated = card.updated ?? card.created;
    if (!updated || card.status !== "evergreen") return [];

    const daysSinceUpdate = Math.max(0, Math.floor((now - new Date(updated).getTime()) / DAY_MS));
    return daysSinceUpdate >= staleDays
      ? [{
          title: card.title,
          filePath: normalize(card.filePath),
          updated,
          daysSinceUpdate,
          suggestion: daysSinceUpdate >= staleDays * 2 ? "deprecate" : "review_stale",
        }]
      : [];
  });

  const orphanCards = cards
    .filter((card) => (card.outboundCount ?? 0) === 0 && (card.inboundCount ?? 0) === 0)
    .map((card) => card.title);

  return {
    totalScanned: cards.length,
    evergreenCount: (statusGroups.evergreen ?? []).length,
    developingCount: (statusGroups.developing ?? []).length,
    deprecatedCount: (statusGroups.deprecated ?? []).length,
    staleCandidates,
    orphanCards,
  };
}
