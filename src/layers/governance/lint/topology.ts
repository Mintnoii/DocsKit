/**
 * 知识库拓扑与生命周期巡检纯函数（零外部 IO，可离线内存执行）
 */

import { POLICY } from "../../../contracts/policy";
import { basename, normalize } from "pathe";
import { group } from "radash";
import { parseMarkdownSafely, stripMarkdownExtension } from "../../../contracts/markdown";
import { normalizeWikilinkTarget, stripAlias } from "../../../foundation/wikilink";
import { validateOKFMetadata } from "../../compile/okf/okf-meta";

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

const WIKI_MARKER = "wiki/";

const wikiRelativeKey = (pathOrTarget: string): string => {
  const normalized = normalize(pathOrTarget);
  const markerIndex = normalized.lastIndexOf(WIKI_MARKER);
  return stripMarkdownExtension(markerIndex >= 0 ? normalized.slice(markerIndex) : normalized);
};

const isKnownTarget = (target: string, existingNames: ReadonlySet<string>): boolean => {
  const cleanTarget = normalizeWikilinkTarget(stripAlias(target));
  return [
    cleanTarget,
    wikiRelativeKey(cleanTarget),
    basename(cleanTarget),
  ].some((candidate) => existingNames.has(candidate));
};

/** 全库断链、孤岛与 OKF Schema 健康度巡检 */
export function lintVaultTopology(cards: readonly VaultLintCardItem[]): VaultTopologyLintResult {
  const existingNames = new Set(
    cards.flatMap((card) => {
      const rel = wikiRelativeKey(card.filePath);
      return [card.title, rel, basename(rel)].filter(Boolean);
    })
  );

  const brokenLinks = cards.flatMap((card) =>
    (card.outboundLinks ?? [])
      .filter((target) => !isKnownTarget(target, existingNames))
      .map((target) => ({
        sourceFile: normalize(card.filePath),
        target: normalizeWikilinkTarget(stripAlias(target)),
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

/** 一天的毫秒数常量：24 小时 * 60 分钟 * 60 秒 * 1000 毫秒 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 生命周期健康大盘：状态按实际值统计，缺失日期不伪造、不参与陈旧判定 */
export function auditVaultLifecycle(
  cards: readonly LifecycleCardItem[],
  options?: { readonly staleDays?: number; readonly now?: number }
): VaultLifecycleAuditResult {
  const staleDays = options?.staleDays ?? POLICY.lifecycle.staleDays;
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
          // 超过陈旧阈值 2 倍周期（默认 180 天）建议废弃，否则提示复审
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
