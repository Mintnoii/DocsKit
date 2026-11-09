import { fdir } from "fdir";
import picomatch from "picomatch";
import { normalize } from "pathe";

export interface ScanMarkdownFilesOptions {
  /** 追加的排除 Glob，默认排除 _index*.md */
  exclude?: readonly string[];
  /** 是否递归扫描子目录，默认 true */
  recursive?: boolean;
}

const DEFAULT_EXCLUDES = ["**/_index*.md"] as const;

/**
 * 极速跨平台递归扫描 Markdown 文件（fdir 遍历 + pathe 归一 + picomatch 声明式过滤）
 * 返回统一 POSIX 风格绝对路径，彻底消灭手工斜杠替换与 startsWith 路由。
 */
export async function getMarkdownFiles(
  dir: string,
  options?: ScanMarkdownFilesOptions
): Promise<string[]> {
  const crawler = new fdir()
    .withFullPaths()
    .filter((filePath) => filePath.endsWith(".md"));

  if (options?.recursive === false) crawler.withMaxDepth(1);

  const rawFiles = (await crawler.crawl(dir).withPromise()) as string[];
  const isExcluded = picomatch([...DEFAULT_EXCLUDES, ...(options?.exclude ?? [])]);

  return rawFiles.map((filePath) => normalize(filePath)).filter((filePath) => !isExcluded(filePath));
}
