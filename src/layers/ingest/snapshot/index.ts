import { basename, dirname, extname, normalize, join } from "pathe";
import semver from "semver";
import { computeShortHash } from "../../../foundation/hash";

export interface SnapshotMeta {
  readonly title: string;
  readonly category: string;
  readonly revision: number | null;
  readonly safeFileName: string;
}

/**
 * 安全过滤跨平台文件名中的非法字符：
 * 正则 `/[\\/:*?"<>|]/g` 替换 Windows/POSIX 文件系统保留字符为连字符 `-`
 * 正则 `/\s+/g` 折叠连续空白为单个空格
 */
export const sanitizeFileName = (name: string): string => {
  return (name ?? "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * 依托 pathe.dirname / pathe.basename 声明式解构快照文件的分类、标题与版本号
 * 彻底消灭手工字符串数组切片与伪正则
 *
 * @example
 * ```ts
 * parseSnapshotMeta("_raw/frontend/WebGL渲染引擎-rev3.md");
 * // { title: "WebGL渲染引擎", category: "frontend", revision: 3, safeFileName: "WebGL渲染引擎-rev3.md" }
 * ```
 */
export function parseSnapshotMeta(filePath: string): SnapshotMeta {
  const normalized = normalize(filePath);
  const safeFileName = basename(normalized);
  const ext = extname(safeFileName);
  const stem = basename(safeFileName, ext);
  const category = basename(dirname(normalized)) || "default";

  // 解析 -rev<id>
  const revMatch = stem.match(/-rev(\d+)$/);
  const revision = revMatch ? Number.parseInt(revMatch[1], 10) : null;
  const title = revMatch ? stem.slice(0, revMatch.index).trim() : stem;

  return {
    title,
    category,
    revision,
    safeFileName,
  };
}

/**
 * 组装标准不可变物理快照路径：`_raw/<category>/<title>[-rev<id>].md`
 */
export function buildSnapshotPath(options: {
  baseDir?: string;
  category: string;
  title: string;
  revision?: number | string | null;
}): string {
  const { baseDir = "_raw", category, title, revision } = options;
  const safeCat = sanitizeFileName(category);
  const safeTitle = sanitizeFileName(title);

  const revSuffix = revision !== undefined && revision !== null && `${revision}`.trim() !== ""
    ? `-rev${revision}`
    : "";

  return normalize(join(baseDir, safeCat, `${safeTitle}${revSuffix}.md`));
}

/**
 * 比较新老版本是否有实质递增
 * 兼容纯整数 Revision（如 3 > 2）与标准 SemVer 版本字符串（如 "1.2.0" > "1.1.9"）
 *
 * @example
 * ```ts
 * isVersionNewer(3, 2); // true
 * isVersionNewer("1.2.0", "1.1.0"); // true
 * ```
 */
export function isVersionNewer(
  incomingVersion: number | string | null | undefined,
  currentVersion: number | string | null | undefined
): boolean {
  if (incomingVersion === undefined || incomingVersion === null) return false;
  if (currentVersion === undefined || currentVersion === null) return true;

  // 1. 若两者均为数值或数值字面量，直接做数值比对
  const numIncoming = Number(incomingVersion);
  const numCurrent = Number(currentVersion);
  if (!Number.isNaN(numIncoming) && !Number.isNaN(numCurrent)) {
    return numIncoming > numCurrent;
  }

  // 2. 尝试使用 semver 进行版本对账
  const validIncoming = semver.coerce(String(incomingVersion));
  const validCurrent = semver.coerce(String(currentVersion));
  if (validIncoming && validCurrent) {
    return semver.gt(validIncoming, validCurrent);
  }

  // 3. 兜底自然序比对（numeric 保证 rev10 > rev9，绝不把「不相等」当成「更新」）
  return String(incomingVersion).localeCompare(String(currentVersion), undefined, { numeric: true }) > 0;
}

export interface CardPathCollisionParams {
  readonly targetPath: string;
  readonly existingHash: string | null;
  readonly incomingHash: string;
  readonly sourceFile: string;
  readonly occupiedPaths: readonly string[];
}

export interface CardPathCollisionResult {
  readonly action: "use" | "skip" | "rename";
  readonly path: string;
  readonly identical: boolean;
}

/**
 * 同名素材落盘路径仲裁：内容不同时生成并存卡片，旧卡保持完整等待裁决。
 * 文件存在性由调用方以 occupiedPaths 传入，函数零文件访问。
 */
export const resolveCardPathCollision = (
  params: CardPathCollisionParams
): CardPathCollisionResult => {
  const { targetPath, existingHash, incomingHash, sourceFile, occupiedPaths } = params;
  const occupied = new Set(occupiedPaths);

  if (!occupied.has(targetPath)) {
    return { action: "use", path: targetPath, identical: false };
  }
  if (existingHash !== null && existingHash === incomingHash) {
    return { action: "skip", path: targetPath, identical: true };
  }

  // 取源文件路径前 4 位 SHA-256 截断哈希作为稳定区分后缀
  const suffix = computeShortHash(sourceFile, 4);
  const extension = extname(targetPath) || ".md";
  const stem = basename(targetPath, extension);
  // 预生成 21 个候选路径序号（-x<hash>, -x<hash>1, ..., -x<hash>20），探测首个空闲路径
  const candidates = Array.from({ length: 21 }, (_, attempt) =>
    join(dirname(targetPath), `${stem}-x${suffix}${attempt === 0 ? "" : attempt}${extension}`)
  );
  const free = candidates.find((candidate) => !occupied.has(candidate));

  return { action: "rename", path: free ?? candidates[candidates.length - 1], identical: false };
};

export * from "./tombstone";
