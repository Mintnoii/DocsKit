import matter from "gray-matter";
import { validateOKFMetadata, type OKFValidationResult } from "../ast/okf-meta";

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

/**
 * 校验卡片元数据中的 lock: human 标记
 * 当检测到人工权威锁时阻断自动覆写
 */
export function checkHumanLock(markdownContent: string): boolean {
  if (!markdownContent) return false;
  const { data } = matter(markdownContent);
  return data.lock === "human" || data.locked === true;
}

/**
 * 全库断链、双链拓扑与 OKF Schema 健康度巡检纯函数 (依托 Cyberbrain 内部规范)
 *
 * 核心审美规范：
 * 1. 纯无状态纯函数，零外部文件系统 IO，可离线/内存中毫秒级执行；
 * 2. 基于 Set.has() O(1) 复杂度精准定位不存在的目标卡片（Broken Links）；
 * 3. 基于双向图谱（backlinks 0 且 outboundLinks 0）识别悬空孤岛卡片；
 * 4. 依托 TypeBox validateOKFMetadata 对每张卡片的 Frontmatter 执行严格的工业级契约校验。
 */
export function lintVaultTopology(
  cards: readonly VaultLintCardItem[]
): VaultTopologyLintResult {
  const existingNames = new Set<string>();

  // 1. 构建全局已存在卡片标题与路径集合 (支持短名与相对路径)
  for (const card of cards) {
    existingNames.add(card.title);
    const normalized = card.filePath.replaceAll("\\", "/");
    const rel = normalized.replace(/.*\/wiki\//, "wiki/").replace(/\.md$/, "");
    existingNames.add(rel);
    const short = rel.split("/").pop();
    if (short) existingNames.add(short);
  }

  const brokenLinks: BrokenLinkItem[] = [];
  const orphanCards: string[] = [];
  const schemaErrors: SchemaViolationItem[] = [];

  // 2. 遍历校验断链、孤岛与 Schema
  for (const card of cards) {
    // 检查断链
    const links = card.outboundLinks || [];
    for (const target of links) {
      const cleanTarget = target.split("|")[0].trim().replace(/\.md$/, "");
      const targetRel = cleanTarget.replace(/.*\/wiki\//, "wiki/");
      const shortTarget = cleanTarget.split("/").pop() || "";

      if (
        !existingNames.has(cleanTarget) &&
        !existingNames.has(targetRel) &&
        !existingNames.has(shortTarget)
      ) {
        brokenLinks.push({
          sourceFile: card.filePath.replaceAll("\\", "/"),
          target: cleanTarget,
        });
      }
    }

    // 检查孤岛卡片 (无入链且无出链，处于认知断层)
    const inCount = card.backlinks?.length || 0;
    const outCount = links.length;
    if (inCount === 0 && outCount === 0) {
      orphanCards.push(card.title);
    }

    // 检查 Frontmatter Schema (优先使用传入的 frontmatter，否则基于 gray-matter 解构)
    const fm = card.frontmatter || matter(card.content).data;
    if (fm && Object.keys(fm).length > 0 && fm.type) {
      const validation: OKFValidationResult = validateOKFMetadata(fm);
      if (!validation.valid) {
        schemaErrors.push({
          filePath: card.filePath.replaceAll("\\", "/"),
          errors: validation.errors,
        });
      }
    }
  }

  const isHealthy = brokenLinks.length === 0 && schemaErrors.length === 0;

  return {
    totalFiles: cards.length,
    brokenLinks,
    orphanCards,
    schemaErrors,
    isHealthy,
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

/**
 * 知识库生命周期健康大盘计算纯函数 (纯无状态算子)
 */
export function auditVaultLifecycle(
  cards: readonly LifecycleCardItem[],
  options?: { readonly staleDays?: number; readonly now?: number }
): VaultLifecycleAuditResult {
  const staleDays = options?.staleDays ?? 90;
  const now = options?.now ?? Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  let evergreenCount = 0;
  let developingCount = 0;
  let deprecatedCount = 0;
  const staleCandidates: StaleCandidateItem[] = [];
  const orphanCards: string[] = [];

  for (const card of cards) {
    const status = card.status || "evergreen";
    if (status === "evergreen") evergreenCount++;
    else if (status === "developing") developingCount++;
    else if (status === "deprecated") deprecatedCount++;

    const updated = card.updated || card.created || "2026-01-01";
    const updatedTime = new Date(updated).getTime();
    const daysSinceUpdate = Math.max(0, Math.floor((now - updatedTime) / dayMs));

    if (daysSinceUpdate >= staleDays && status === "evergreen") {
      staleCandidates.push({
        title: card.title,
        filePath: card.filePath.replaceAll("\\", "/"),
        updated,
        daysSinceUpdate,
        suggestion: daysSinceUpdate >= staleDays * 2 ? "deprecate" : "review_stale",
      });
    }

    if ((card.outboundCount ?? 0) === 0 && (card.inboundCount ?? 0) === 0) {
      orphanCards.push(card.title);
    }
  }

  return {
    totalScanned: cards.length,
    evergreenCount,
    developingCount,
    deprecatedCount,
    staleCandidates,
    orphanCards,
  };
}

export * from "./vault-auditor";
