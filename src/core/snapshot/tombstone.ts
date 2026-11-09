/**
 * 墓碑账本运行时纯函数：以轻量指纹阻断放弃编译/低质素材重复入库。
 */

import { sift, tryit } from "radash";

export interface TombstoneRecord {
  readonly identifier: string;
  readonly sha256?: string;
  readonly sourceUrl?: string;
  readonly externalId?: string;
  readonly title: string;
  readonly entry: string;
  readonly reason: string;
  readonly ignoredAt: string;
}

export interface TombstoneIndex {
  readonly records: ReadonlyArray<TombstoneRecord>;
  readonly urlSet: ReadonlySet<string>;
  readonly hashSet: ReadonlySet<string>;
  readonly idSet: ReadonlySet<string>;
  readonly titleSet: ReadonlySet<string>;
}

export interface TombstoneCandidate {
  readonly identifier?: string;
  readonly sha256?: string;
  readonly sourceUrl?: string;
  readonly externalId?: string;
  readonly title?: string;
}

/** URL 核心特征归一：剥离追踪参数，只保留 origin + pathname */
export function cleanUrlKey(rawUrl?: string): string | null {
  const trimmed = rawUrl?.trim();
  if (!trimmed) return null;

  const [err, parsed] = tryit(() => new URL(trimmed))();
  if (err || !parsed || !/^https?:$/.test(parsed.protocol)) return null;
  return `${parsed.origin}${parsed.pathname}`;
}

/** 由记录数组构建极速内存检索索引 */
export function buildTombstoneIndex(records: ReadonlyArray<TombstoneRecord>): TombstoneIndex {
  return Object.freeze({
    records,
    urlSet: new Set(sift(records.map((record) => cleanUrlKey(record.sourceUrl)))),
    hashSet: new Set(sift(records.map((record) => record.sha256))),
    idSet: new Set(sift(records.flatMap((record) => [record.identifier, record.externalId]))),
    titleSet: new Set(sift(records.map((record) => record.title))),
  });
}

interface HitRule {
  readonly by: string;
  readonly value: string | null | undefined;
  readonly set: ReadonlySet<string>;
  readonly findRecord: () => TombstoneRecord | undefined;
}

/** 判定候选素材是否命中墓碑（规则表声明式，命中记录惰性查找） */
export function isTombstoneHit(
  candidate: TombstoneCandidate,
  index: TombstoneIndex
): { readonly hit: boolean; readonly matchedBy?: string; readonly record?: TombstoneRecord } {
  const cleanedUrl = cleanUrlKey(candidate.sourceUrl);
  const rules: readonly HitRule[] = [
    {
      by: "identifier",
      value: candidate.identifier,
      set: index.idSet,
      findRecord: () => index.records.find((record) => record.identifier === candidate.identifier),
    },
    {
      by: "externalId",
      value: candidate.externalId,
      set: index.idSet,
      findRecord: () => index.records.find(
        (record) => record.externalId === candidate.externalId || record.identifier === candidate.externalId
      ),
    },
    {
      by: "sourceUrl",
      value: cleanedUrl,
      set: index.urlSet,
      findRecord: () => index.records.find((record) => cleanUrlKey(record.sourceUrl) === cleanedUrl),
    },
    {
      by: "sha256",
      value: candidate.sha256,
      set: index.hashSet,
      findRecord: () => index.records.find((record) => record.sha256 === candidate.sha256),
    },
    {
      by: "title",
      value: candidate.title,
      set: index.titleSet,
      findRecord: () => index.records.find((record) => record.title === candidate.title),
    },
  ];

  const matched = rules.find((rule) => rule.value && rule.set.has(rule.value));
  return matched
    ? { hit: true, matchedBy: matched.by, record: matched.findRecord() }
    : { hit: false };
}
