/**
 * 段落级证据锚点的确定性切分，模型不参与定位。
 *
 * 硬契约：生成方与复算方必须传入同一份规范化文本。
 * 函数只做 CRLF 抹平与段落归一化，不剥离 Frontmatter，也不做额外清洗。
 */

import { collapseWhitespace, splitLines } from "../../../contracts/markdown";
import { computeShortHash } from "../../../foundation/hash";
import {
  resolveEvidenceOptions,
  type AnchorParagraph,
  type EvidenceOptions,
  type ResolvedEvidenceOptions,
} from "./contracts";

interface Heading {
  readonly level: number;
  readonly text: string;
}

interface LineScan {
  readonly inComment: boolean;
  readonly lines: readonly string[];
}

interface ScanState {
  readonly headings: readonly Heading[];
  readonly indices: ReadonlyMap<string, number>;
  readonly block: readonly string[];
  readonly paragraphs: readonly AnchorParagraph[];
}

/** 判断是否为 Markdown 代码块围栏起始/结束行（``` 或 ~~~） */
const isFenceLine = (line: string): boolean => /^(```|~~~)/.test(line.trim());

/** 判断是否为纯内联链接行（如独立成行的 `[链接文字](url)` 或 `![图片](url)`），用于剔除纯附件/空占位行 */
const isInlineOnly = (line: string): boolean => /^!?\[[^\]]*\]\([^)]*\)$/.test(line.trim());

/**
 * 判断是否为 Markdown 表格对齐分割线（如 `|:---|:---:|---:|`）
 * 分割单元格后所有内容必须匹配对齐语法，避免误将正文管道符当作表格
 */
const isTableDivider = (line: string): boolean => {
  const cells = line.trim().split("|").map((cell) => cell.trim());
  return cells.length > 1 && cells.every((cell) => cell === "" || /^:?-+:?$/.test(cell));
};

/**
 * 跨行 HTML 注释按行丢弃，不插入空行，避免把原本连续的正文块切开
 * 匹配 `<!--` 起始与 `-->` 闭合标签
 */
const dropHtmlComments = (lines: readonly string[]): readonly string[] =>
  lines.reduce<LineScan>(
    (state, line) => {
      const trimmed = line.trim();
      if (state.inComment) {
        return trimmed.includes("-->") ? { inComment: false, lines: state.lines } : state;
      }
      // 检测以 <!-- 开头但未在同行闭合的跨行注释
      if (/^<!--/.test(trimmed)) {
        return trimmed.includes("-->") ? state : { inComment: true, lines: state.lines };
      }
      return { ...state, lines: [...state.lines, line] };
    },
    { inComment: false, lines: [] }
  ).lines;

/** 剥离行内轻量标记（粗体、斜体、行内代码反引号），保留纯净字符流供哈希计算 */
const stripInlineMarks = (text: string): string =>
  collapseWhitespace(
    text
      // 剥离粗体 **text** 或 __text__
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      // 剥离斜体 *text* 或 _text_
      .replace(/(\*|_)(.*?)\1/g, "$2")
      // 剥离行内代码块 `code`
      .replace(/`([^`]+)`/g, "$1")
  );

/**
 * 标准化段落行集合：丢弃 HTML 注释，过滤代码块围栏、纯链接行与表格分隔线，拼接为单行文本并剥离行内标记
 */
const normalizeParagraph = (lines: readonly string[]): string =>
  stripInlineMarks(
    dropHtmlComments(lines)
      .filter((line) => !isFenceLine(line) && !isInlineOnly(line) && !isTableDivider(line))
      .join(" ")
  );

/**
 * 解析 Markdown 标题行（1~6 级 `#`），提取层级深度与标题纯文本
 */
const parseHeading = (line: string): Heading | null => {
  // 匹配行首 1 到 6 个 # 字符及其后空白
  const matched = /^(#{1,6})\s+(.+)$/.exec(line);
  return matched ? { level: matched[1].length, text: matched[2].trim() } : null;
};

/**
 * 根据当前标题栈组装层级面包屑路径（如 `一级标题 > 二级标题`），无标题时回退根路径
 */
const headingPathOf = (headings: readonly Heading[], root: string): string =>
  headings.length === 0 ? root : headings.map((heading) => heading.text).join(" > ");

/**
 * 结算并落盘当前缓冲的段落块：
 * 1. 过滤空缓冲与长度不足 `minParagraphLength` 的低质琐碎段
 * 2. 结合层级路径生成自增段落序号 `#pN`
 * 3. 计算截断 SHA-256 哈希指纹供后续双向校验
 */
const flushBlock = (state: ScanState, options: ResolvedEvidenceOptions): ScanState => {
  if (state.block.length === 0) return state;

  const text = normalizeParagraph(state.block);
  // 过滤短于阈值（默认 10 字符）的碎片行，避免琐碎无意义锚点
  if (text.length < options.minParagraphLength) return { ...state, block: [] };

  const headingPath = headingPathOf(state.headings, options.rootHeadingPath);
  const index = (state.indices.get(headingPath) ?? 0) + 1;
  const paragraph: AnchorParagraph = {
    anchor: `${headingPath}#p${index}`,
    headingPath,
    index,
    text,
    hash: computeShortHash(text, options.hashLength),
  };

  return {
    ...state,
    block: [],
    indices: new Map([...state.indices, [headingPath, index]]),
    paragraphs: [...state.paragraphs, paragraph],
  };
};

/**
 * 逐行状态机扫描：遇到标题则结算前块并压入标题栈；遇到空行则结算前块；常规内容行累积入 block 缓冲
 */
const scanLine = (state: ScanState, line: string, options: ResolvedEvidenceOptions): ScanState => {
  const heading = parseHeading(line);
  if (heading) {
    const flushed = flushBlock(state, options);
    return {
      ...flushed,
      headings: [...flushed.headings.filter((item) => item.level < heading.level), heading],
    };
  }

  // 空行代表 Markdown 段落自然切分，触发前块结算
  return line.trim() === ""
    ? flushBlock(state, options)
    : { ...state, block: [...state.block, line] };
};

/**
 * 将 Markdown 切分为带层级标题路径与哈希指纹的可定位段落序列
 * 段落号在同级标题下递增，空段自动跳过
 */
export const splitAnchorableParagraphs = (
  markdown: string,
  options: EvidenceOptions = {}
): readonly AnchorParagraph[] => {
  const resolved = resolveEvidenceOptions(options);
  const lines = splitLines(markdown);
  const initial: ScanState = { headings: [], indices: new Map(), block: [], paragraphs: [] };
  return [...lines, ""].reduce((state, line) => scanLine(state, line, resolved), initial).paragraphs;
};
