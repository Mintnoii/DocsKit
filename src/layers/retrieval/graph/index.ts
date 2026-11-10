/**
 * 纯 TS 双向 1-Hop 拓扑图谱构建函数
 * 纯声明式反向索引：不修改调用方传入的任何卡片对象。
 */

import { isString, last, unique } from "radash";
import { stripMarkdownExtension } from "../../../contracts/markdown";
import { normalizeWikilinkTarget, stripAnchor, stripAlias } from "../../../foundation/wikilink";

export { normalizeWikilinkTarget, stripAnchor, stripAlias } from "../../../foundation/wikilink";

/** 匹配 Markdown `[[target]]` 双链语法，支持多行与 Unicode 字符 */
const WIKILINK_PATTERN = /\[\[([\s\S]+?)\]\]/gu;

/** 匹配 Markdown 多行代码块围栏（``` ... ```），用于在提取双链前将其剥离，防止代码内部内容被误提为双链 */
const CODE_FENCE = /```[\s\S]*?```/g;

/** 匹配 Markdown 行内单行代码（`code`），防止行内代码被误提为双链 */
const INLINE_CODE = /`[^`\n]+`/g;

/**
 * 剥离代码块并还原转义管道符 `\|` 为 `|`，避免误伤别名切分
 * 正则 `/\\\|/g` 将 Markdown 表格或正文转义的反斜杠管道符还原为普通管道符
 */
const stripCode = (text: string): string =>
  text.replace(CODE_FENCE, "").replace(INLINE_CODE, "").replace(/\\\|/g, "|");

export interface WikilinkOptions {
  /** 由业务层给定的排除前缀，通用引擎不写死任何目录名 */
  readonly excludePrefixes?: readonly string[];
}

/** 稳健提取 [[双链]] 目标集合（剥离代码围栏与行内代码，支持别名与锚点） */
export function extractWikilinks(text: string, options: WikilinkOptions = {}): Set<string> {
  if (!text) return new Set();

  const excludePrefixes = options.excludePrefixes ?? [];
  const targets = [...stripCode(text).matchAll(WIKILINK_PATTERN)]
    .map(([, inner]) => normalizeWikilinkTarget(inner))
    .filter(Boolean)
    .filter((target) => target && !excludePrefixes.some((prefix) => target.startsWith(prefix)));

  return new Set(targets);
}

/**
 * 提取正文中所有 [[双链]] 指向的目标标识列表（数组形式），支持前缀排除
 */
export function extractWikiOutboundLinks(content: string, options?: WikilinkOptions): string[] {
  return [...extractWikilinks(content, options)];
}

/**
 * 把 wikilink 目标收敛为稳定图谱节点键
 * 路径式目标 (wiki/learning/foo-bar) 与裸 stem (foo-bar) 归一到同一节点
 */
export const toGraphNodeKey = (target: string): string => {
  if (!target) return "";
  const segments = stripAnchor(stripAlias(target)).split("/").filter(Boolean);
  return stripMarkdownExtension(last(segments) ?? "");
};

/** 中英文混合字数统计（CJK 单字 + Latin 词） */
export function countContentWords(body: string): number {
  if (!body) return 0;
  return (
    // 正则 `/[\u4e00-\u9fff]/gu` 匹配中日韩统一表意文字（CJK），每个汉字按 1 词计算
    (body.match(/[\u4e00-\u9fff]/gu) ?? []).length +
    // 正则 `/[a-zA-Z0-9_\-]+/gu` 匹配连续英文/数字/下划线单词，每组按 1 词计算
    (body.match(/[a-zA-Z0-9_\-]+/gu) ?? []).length
  );
}

export interface GraphCardNode {
  readonly title: string;
  /** 自定义图谱节点键（如文件名 stem）；缺省时回退 title，保证旧调用方行为不变 */
  readonly id?: string;
  readonly outboundLinks?: readonly string[];
  readonly backlinks?: readonly string[];
  readonly [key: string]: unknown;
}

/**
 * 动态索引全量卡片正反向关系图谱，返回全新对象图
 * 节点键优先取 card.id（业务层可指定 stem 等稳定标识），缺省回退 title
 */
export function indexBidirectionalGraph<
  T extends Pick<GraphCardNode, "title" | "outboundLinks" | "backlinks">
>(
  cardsInput: readonly T[] | Map<string, T>
): Map<string, T> {
  const keyOf = (card: T): string => {
    const custom = (card as { id?: unknown }).id;
    return isString(custom) && custom.trim() ? custom : card.title;
  };

  const entries: readonly (readonly [string, T])[] = cardsInput instanceof Map
    ? [...cardsInput.entries()]
    : cardsInput.map((card) => [keyOf(card), card] as const);

  const inbound = new Map<string, string[]>();
  entries.forEach(([, card]) => {
    (card.outboundLinks ?? []).forEach((targetTitle) => {
      inbound.set(targetTitle, [...(inbound.get(targetTitle) ?? []), keyOf(card)]);
    });
  });

  return new Map(
    entries.map(([key, card]) => [
      key,
      {
        ...card,
        backlinks: unique([...(card.backlinks ?? []), ...(inbound.get(key) ?? [])]),
      } as T,
    ])
  );
}
