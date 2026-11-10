/**
 * JIT 上下文装配：只算指针集合与结构数据，提示词文案由渲染器注入。
 */

import { normalize } from "pathe";
import { unique } from "radash";
import { NEUTRAL_LABELS, type JITMode, type JITRenderCard, type JITRenderer } from "../../../contracts/texts";

export interface JITCardItem {
  readonly title: string;
  readonly summary: string;
  readonly filePath: string;
  readonly content?: string;
  readonly dependencies?: readonly { readonly title: string; readonly filePath: string }[];
  readonly dependents?: readonly { readonly title: string; readonly filePath: string }[];
}

export interface JITFormatOptions {
  readonly mode?: JITMode;
  readonly vaultName?: string;
  readonly render?: JITRenderer;
}

const NEUTRAL_RENDERER: JITRenderer = (ctx) =>
  ctx.matches
    .map((card) => `- ${card.title}: ${card.summary} (file:///${normalize(card.filePath)})`)
    .join("\n");

const toRenderCard = (card: JITCardItem): JITRenderCard => ({
  title: card.title,
  summary: card.summary,
  filePath: normalize(card.filePath),
  content: card.content,
  dependencies: card.dependencies?.map((item) => ({ ...item, filePath: normalize(item.filePath) })),
  dependents: card.dependents?.map((item) => ({ ...item, filePath: normalize(item.filePath) })),
});

/** 路径收集与视图渲染彻底解耦，默认输出只含输入数据 */
export function formatAgentJITPrompt(
  query: string,
  matches: readonly JITCardItem[],
  options: JITFormatOptions = {}
): { readonly prompt: string; readonly topCardPaths: readonly string[] } {
  const { mode = "compact", vaultName = NEUTRAL_LABELS.defaultVaultName, render = NEUTRAL_RENDERER } = options;
  const topCardPaths = unique(
    matches.flatMap((match) => [
      match.filePath,
      ...(match.dependencies ?? []).map((item) => item.filePath),
      ...(match.dependents ?? []).map((item) => item.filePath),
    ])
  );

  return {
    prompt: render({ query, matches: matches.map(toRenderCard), mode, vaultName, topCardPaths }),
    topCardPaths,
  };
}
