import fs from "node:fs/promises";
import { basename, normalize } from "pathe";
import { parseMarkdownSafely, extractDocumentTitle } from "../../../contracts/markdown";
import { getMarkdownFiles, type ScanMarkdownFilesOptions } from "../../ingest/ast/scanner";
import { extractWikiOutboundLinks, indexBidirectionalGraph } from "../../retrieval/graph/index";
import {
  lintVaultTopology,
  auditVaultLifecycle,
  type VaultLintCardItem,
  type VaultTopologyLintResult,
  type VaultLifecycleAuditResult,
  type LifecycleCardItem,
} from "./topology";

export interface VaultAuditOptions {
  readonly exclude?: readonly string[];
  readonly staleDays?: number;
}

export interface VaultAuditReport {
  readonly directory: string;
  readonly totalFiles: number;
  readonly isHealthy: boolean;
  readonly topology: VaultTopologyLintResult;
  readonly lifecycle: VaultLifecycleAuditResult;
}

/** 原子能力 1：并发加载目录卡片并解构为内存节点 */
export async function loadVaultCardNodes(
  vaultDir: string,
  options?: ScanMarkdownFilesOptions
): Promise<VaultLintCardItem[]> {
  const mdFiles = await getMarkdownFiles(vaultDir, options);

  return Promise.all(mdFiles.map(async (file): Promise<VaultLintCardItem> => {
    const raw = await fs.readFile(file, "utf8");
    const { data, content: body } = parseMarkdownSafely(raw);
    return {
      filePath: normalize(file),
      title: extractDocumentTitle(data.title, body, basename(file, ".md")),
      content: raw,
      outboundLinks: extractWikiOutboundLinks(body),
      frontmatter: data as Record<string, unknown>,
    };
  }));
}

/** 原子能力 2：编织双向引用图谱 */
export function buildVaultTopologyGraph(
  cards: readonly VaultLintCardItem[]
): Map<string, VaultLintCardItem> {
  return indexBidirectionalGraph(new Map(cards.map((card) => [card.title, card] as const)));
}

/** 开箱即用门面：加载 → 拓扑编织 → 断链巡检 → 生命周期大盘 */
export async function auditDirectoryVault(
  vaultDir: string,
  options?: VaultAuditOptions
): Promise<VaultAuditReport> {
  const rawCards = await loadVaultCardNodes(vaultDir, { exclude: options?.exclude });
  const graph = buildVaultTopologyGraph(rawCards);

  const populatedCards: VaultLintCardItem[] = rawCards.map((card) => ({
    ...card,
    backlinks: graph.get(card.title)?.backlinks ?? [],
  }));
  const topology = lintVaultTopology(populatedCards);

  const lifecycleInput: LifecycleCardItem[] = populatedCards.map((card) => ({
    title: card.title,
    filePath: card.filePath,
    updated: (card.frontmatter?.updated as string) ?? (card.frontmatter?.created as string),
    created: card.frontmatter?.created as string,
    status: card.frontmatter?.status as string,
    outboundCount: card.outboundLinks?.length ?? 0,
    inboundCount: card.backlinks?.length ?? 0,
  }));
  const lifecycle = auditVaultLifecycle(lifecycleInput, { staleDays: options?.staleDays ?? 90 });

  return {
    directory: normalize(vaultDir),
    totalFiles: rawCards.length,
    isHealthy: topology.isHealthy,
    topology,
    lifecycle,
  };
}
