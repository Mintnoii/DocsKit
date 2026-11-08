import fs from "node:fs/promises";
import { basename } from "pathe";
import matter from "gray-matter";
import { getMarkdownFiles, type ScanMarkdownFilesOptions } from "../ast/scanner";
import { extractWikiOutboundLinks, indexBidirectionalGraph } from "../graph/index";
import {
  lintVaultTopology,
  auditVaultLifecycle,
  type VaultLintCardItem,
  type VaultTopologyLintResult,
  type VaultLifecycleAuditResult,
  type LifecycleCardItem,
} from "./index";

export interface VaultAuditOptions {
  /** 排除的扫描模式 */
  readonly exclude?: readonly string[];
  /** 陈旧度阈值天数，默认 90 天 */
  readonly staleDays?: number;
}

export interface VaultAuditReport {
  readonly directory: string;
  readonly totalFiles: number;
  readonly isHealthy: boolean;
  readonly topology: VaultTopologyLintResult;
  readonly lifecycle: VaultLifecycleAuditResult;
}

/**
 * 原子能力 1：从物理目录加载并解构为内存卡片列表 (纯 IO 提取)
 */
export async function loadVaultCardNodes(
  vaultDir: string,
  options?: ScanMarkdownFilesOptions
): Promise<VaultLintCardItem[]> {
  const mdFiles = await getMarkdownFiles(vaultDir, options);

  // 并行安全读取并解析卡片 AST 与 Frontmatter
  const cardList: VaultLintCardItem[] = await Promise.all(
    mdFiles.map(async (file) => {
      const content = await fs.readFile(file, "utf-8");
      const { data: frontmatter, content: body } = matter(content);
      const title =
        (frontmatter?.title as string) ||
        basename(file).replace(/\.md$/, "");
      const outboundLinks = extractWikiOutboundLinks(body);

      return {
        filePath: file.replaceAll("\\", "/"),
        title,
        content,
        outboundLinks,
        frontmatter,
      };
    })
  );

  return cardList;
}

/**
 * 原子能力 2：将卡片列表编织为带双向引用的图谱拓扑节点
 */
export function buildVaultTopologyGraph(
  cards: readonly VaultLintCardItem[]
): Map<string, VaultLintCardItem> {
  const map = new Map<string, any>();
  for (const c of cards) {
    map.set(c.title, {
      ...c,
      backlinks: [...(c.backlinks || [])],
    });
  }
  return indexBidirectionalGraph(map) as Map<string, VaultLintCardItem>;
}

/**
 * 组合开箱即用门面算子：全自动审计目录知识库
 *
 * 核心审美规范：
 * 1. 严格由上述原子化算子组合而成，绝不写成一坨；
 * 2. loadVaultCardNodes 负责加载；
 * 3. buildVaultTopologyGraph 负责拓扑编织；
 * 4. lintVaultTopology 负责断链与 Schema 判定；
 * 5. auditVaultLifecycle 负责陈旧度分析；
 * 6. 为 TeamWiki 与 Ghost 提供极简单行一站式调用。
 */
export async function auditDirectoryVault(
  vaultDir: string,
  options?: VaultAuditOptions
): Promise<VaultAuditReport> {
  // 1. 原子化加载
  const rawCards = await loadVaultCardNodes(vaultDir, {
    exclude: options?.exclude,
  });

  // 2. 原子化构建拓扑图谱
  const graph = buildVaultTopologyGraph(rawCards);

  // 3. 原子化拓扑巡检 (断链、孤岛、TypeBox Schema)
  const populatedCards: VaultLintCardItem[] = rawCards.map((c) => {
    const node = graph.get(c.title);
    return {
      ...c,
      backlinks: node?.backlinks || [],
    };
  });
  const topology = lintVaultTopology(populatedCards);

  // 4. 原子化生命周期大盘计算
  const lifecycleInput: LifecycleCardItem[] = populatedCards.map((c) => ({
    title: c.title,
    filePath: c.filePath,
    updated: (c.frontmatter?.updated as string) || (c.frontmatter?.created as string),
    created: c.frontmatter?.created as string,
    status: c.frontmatter?.status as string,
    outboundCount: c.outboundLinks?.length || 0,
    inboundCount: c.backlinks?.length || 0,
  }));
  const lifecycle = auditVaultLifecycle(lifecycleInput, {
    staleDays: options?.staleDays ?? 90,
  });

  return {
    directory: vaultDir.replaceAll("\\", "/"),
    totalFiles: rawCards.length,
    isHealthy: topology.isHealthy,
    topology,
    lifecycle,
  };
}
