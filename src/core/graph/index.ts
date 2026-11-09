/**
 * 纯 TS 双向 1-Hop 拓扑图谱构建函数
 * 纯声明式反向索引：不修改调用方传入的任何卡片对象。
 */

import { extname } from "pathe";
import { unique } from "radash";

const WIKILINK_PATTERN = /\[\[([\s\S]+?)\]\]/gu;
const CODE_FENCE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`\n]+`/g;

const stripCode = (text: string): string =>
  text.replace(CODE_FENCE, "").replace(INLINE_CODE, "").replace(/\\\|/g, "|");

/** 清洗 wikilink 目标：剥离锚点与 .md 后缀 */
export function normalizeWikilinkTarget(target: string): string {
  const clean = target.trim();
  const withoutAnchor = clean.includes("#") && !clean.endsWith("#.md") && !clean.endsWith("#")
    ? clean.split("#")[0].trim()
    : clean;
  return extname(withoutAnchor) === ".md" ? withoutAnchor.slice(0, -3) : withoutAnchor;
}

export interface WikilinkOptions {
  /** 由业务层给定的排除前缀，通用引擎不写死任何目录名 */
  readonly excludePrefixes?: readonly string[];
}

/** 稳健提取 [[双链]] 目标集合（剥离代码围栏与行内代码，支持别名与锚点） */
export function extractWikilinks(text: string, options: WikilinkOptions = {}): Set<string> {
  if (!text) return new Set();

  const excludePrefixes = options.excludePrefixes ?? [];
  const targets = [...stripCode(text).matchAll(WIKILINK_PATTERN)]
    .map(([, inner]) => (inner.split("|")[0] ?? "").trim())
    .filter(Boolean)
    .map(normalizeWikilinkTarget)
    .filter((target) => target && !excludePrefixes.some((prefix) => target.startsWith(prefix)));

  return new Set(targets);
}

export function extractWikiOutboundLinks(content: string, options?: WikilinkOptions): string[] {
  return [...extractWikilinks(content, options)];
}

/** 中英文混合字数统计（CJK 单字 + Latin 词） */
export function countContentWords(body: string): number {
  if (!body) return 0;
  return (body.match(/[\u4e00-\u9fff]/gu) ?? []).length +
    (body.match(/[a-zA-Z0-9_\-]+/gu) ?? []).length;
}

export interface GraphCardNode {
  readonly title: string;
  readonly outboundLinks?: readonly string[];
  readonly backlinks?: readonly string[];
  readonly [key: string]: unknown;
}

/** 动态索引全量卡片正反向关系图谱，返回全新对象图 */
export function indexBidirectionalGraph<
  T extends Pick<GraphCardNode, "title" | "outboundLinks" | "backlinks">
>(
  cardsInput: readonly T[] | Map<string, T>
): Map<string, T> {
  const entries: readonly (readonly [string, T])[] = cardsInput instanceof Map
    ? [...cardsInput.entries()]
    : cardsInput.map((card) => [card.title, card] as const);

  const inbound = new Map<string, string[]>();
  entries.forEach(([, card]) => {
    (card.outboundLinks ?? []).forEach((targetTitle) => {
      inbound.set(targetTitle, [...(inbound.get(targetTitle) ?? []), card.title]);
    });
  });

  return new Map(
    entries.map(([key, card]) => [
      key,
      {
        ...card,
        backlinks: unique([...(card.backlinks ?? []), ...(inbound.get(card.title) ?? [])]),
      } as T,
    ])
  );
}
