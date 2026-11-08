/**
 * 纯 TS 双向 1-Hop 拓扑图谱分析与构建算子
 * 自动识别 Markdown 中的 [[双链]]，并建立 Outbound Links 与 Backlinks 索引网
 */

/**
 * 从 Markdown 纯文本中安全提取正向引用的 [[双链]] 目标名称
 */
export function extractWikiOutboundLinks(content: string): string[] {
  if (!content) return [];
  const matches = content.match(/\[\[(?:wiki\/learning\/)?([^\]|]+)(?:\|[^\]]+)?\]\]/g) || [];
  const targets: string[] = [];
  for (const m of matches) {
    const rawTarget = m.replace(/^\[\[(?:wiki\/learning\/)?/, "").replace(/\]\]$/, "").split("|")[0].trim();
    if (rawTarget && !rawTarget.startsWith("wiki/areas/")) {
      targets.push(rawTarget);
    }
  }
  return Array.from(new Set(targets));
}

export interface GraphCardNode {
  readonly title: string;
  readonly outboundLinks?: readonly string[];
  backlinks?: string[];
  readonly [key: string]: any;
}

/**
 * 动态索引全量卡片正反向关系图谱 (Backlinks Indexer)
 * 支持传入数组或已存在的 Map<string, T>
 */
export function indexBidirectionalGraph<T extends GraphCardNode>(
  cardsInput: readonly T[] | Map<string, T>
): Map<string, T> {
  const cardMap = cardsInput instanceof Map ? cardsInput : new Map<string, T>();

  // 1. 如果传入的是数组，注册主卡
  if (Array.isArray(cardsInput)) {
    for (const card of cardsInput) {
      if (!card.backlinks) {
        (card as any).backlinks = [];
      }
      cardMap.set(card.title, card);
    }
  } else {
    // 如果是 Map，确保每个独立卡片对象都有 backlinks 数组
    for (const card of cardMap.values()) {
      if (!card.backlinks) {
        (card as any).backlinks = [];
      }
    }
  }

  // 2. 遍历正向依赖，反向注入被依赖卡片的 backlinks
  const uniqueCards = Array.from(new Set(cardMap.values()));
  for (const card of uniqueCards) {
    const outbound = card.outboundLinks || [];
    for (const targetTitle of outbound) {
      const targetCard = cardMap.get(targetTitle);
      if (targetCard && targetCard.backlinks) {
        if (!targetCard.backlinks.includes(card.title)) {
          targetCard.backlinks.push(card.title);
        }
      }
    }
  }

  return cardMap;
}
