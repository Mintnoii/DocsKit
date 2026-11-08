import matter from "gray-matter";

/**
 * 校验卡片元数据中的 lock: human 标记
 * 当检测到人工权威锁时阻断自动覆写
 */
export function checkHumanLock(markdownContent: string): boolean {
  if (!markdownContent) return false;
  const { data } = matter(markdownContent);
  return data.lock === "human" || data.locked === true;
}

export interface LintResult {
  readonly valid: boolean;
  readonly brokenLinks: readonly string[];
}
