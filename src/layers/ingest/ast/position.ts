/** MDAST 节点位置契约：缺位当场中断，杜绝非空断言与隐式兜底 */

import assert from "node:assert/strict";

export interface OffsetPoint {
  readonly offset?: number;
}

export interface PositionedNode {
  readonly position: { readonly start: OffsetPoint; readonly end: OffsetPoint };
}

/** @example positioned([{ position: undefined }, { position: p }]) → 只保留带 p 的节点 */
export const positioned = <T extends { readonly position?: unknown }>(
  nodes: readonly T[]
): readonly (T & PositionedNode)[] =>
  nodes.filter((node): node is T & PositionedNode => node.position !== undefined);

/** @example offsetOf({ line: 1, column: 1, offset: 12 }) → 12 */
export const offsetOf = (point: OffsetPoint): number => {
  assert(point.offset !== undefined, "mdast_offset_missing");
  return point.offset;
};

/** @example sliceOf("abcdef", node{start:1,end:4}) → "bcd" */
export const sliceOf = (content: string, node: PositionedNode): string =>
  content.slice(offsetOf(node.position.start), offsetOf(node.position.end)).trim();
