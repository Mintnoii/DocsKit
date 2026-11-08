import { basename, dirname, extname, normalize, join } from "pathe";
import semver from "semver";

export interface SnapshotMeta {
  readonly title: string;
  readonly category: string;
  readonly revision: number | null;
  readonly safeFileName: string;
}

/**
 * 安全过滤跨平台文件名中的非法字符
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

  // 3. 兜底字符串自然比对
  return String(incomingVersion) !== String(currentVersion);
}
