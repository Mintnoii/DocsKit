import assert from "node:assert/strict";
import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { isObject, isString, omit, unique } from "radash";
import { ensureArray, localIsoDate } from "../../../contracts/markdown";
import type { ConceptModeling, DistillOptions } from "../../ingest/ast/distiller";
import type { OkfTexts } from "../../../contracts/texts";

const DISTILLER_CACHE = new Map<string, typeof import("../../ingest/ast/distiller")>();

/** 惰性加载 AST 提纯器模块单例，规避顶层重型解析器引入 */
async function getDistillerModule(): Promise<typeof import("../../ingest/ast/distiller")> {
  const hit = DISTILLER_CACHE.get("distiller");
  if (hit) return hit;
  const loaded = await import("../../ingest/ast/distiller");
  DISTILLER_CACHE.set("distiller", loaded);
  return loaded;
}

const NEUTRAL_OKF_TEXTS: OkfTexts = Object.freeze({
  appendixHeading: "## Attachments",
  attachmentLine: (item: { readonly name: string; readonly url: string }): string =>
    `- ${item.name} (${item.url})`,
});

// ==========================================
// 1. OKF 通用公共字段 Schema 底座
// ==========================================

export const OKFStatusSchema = Type.Union([
  Type.Literal("evergreen"),
  Type.Literal("developing"),
  Type.Literal("deprecated"),
], { });

export const OKFConfidenceSchema = Type.Union([
  Type.Literal("high"),
  Type.Literal("medium"),
  Type.Literal("low"),
], { });

// ==========================================
// 2. 各业务形态卡片 Frontmatter Schema
// ==========================================

/**
 * OKF 概念卡片 Schema (wiki/learning/)
 */
export const OKFConceptFrontmatterSchema = Type.Object({
  type: Type.Literal("concept"),
  title: Type.String({ minLength: 1 }),
  created: Type.String({ minLength: 4 }),
  updated: Type.String({ minLength: 4 }),
  modeling: Type.Union([
    Type.Literal("ipo"),
    Type.Literal("decomposition"),
    Type.Literal("hybrid"),
  ], { }),
  summary: Type.String({ }),
  status: Type.Optional(OKFStatusSchema),
  confidence: Type.Optional(OKFConfidenceSchema),
  aliases: Type.Optional(Type.Array(Type.String())),
  moc: Type.Optional(Type.Array(Type.String())),
  spines: Type.Optional(Type.Array(Type.String())),
  tags: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: true });

/**
 * OKF 一手信源卡片 Schema (wiki/sources/)
 */
export const OKFSourceItemSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  resource: Type.String({ minLength: 1 }),
  origin_entry: Type.Optional(Type.String({ })),
  title: Type.Optional(Type.String({ })),
  url: Type.Optional(Type.String({ })),
}, { additionalProperties: true });

export const OKFSourceFrontmatterSchema = Type.Object({
  type: Type.Literal("source"),
  title: Type.String({ minLength: 1 }),
  created: Type.String({ minLength: 4 }),
  updated: Type.String({ minLength: 4 }),
  category: Type.String({ minLength: 1 }),
  status: Type.Optional(OKFStatusSchema),
  confidence: Type.Optional(OKFConfidenceSchema),
  author: Type.Optional(Type.String({ })),
  clusters: Type.Optional(Type.Array(Type.String(), { })),
  sources: Type.Array(OKFSourceItemSchema, { }),
  tags: Type.Optional(Type.Array(Type.String())),
  moc: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: true });

/**
 * OKF 人物/实践者/机构实体卡片 Schema (wiki/people/)
 */
export const OKFEntityFrontmatterSchema = Type.Object({
  type: Type.Literal("entity"),
  title: Type.String({ minLength: 1 }),
  created: Type.String({ minLength: 4 }),
  updated: Type.String({ minLength: 4 }),
  domain: Type.String({ minLength: 1 }),
  role: Type.Optional(Type.String({ })),
  status: Type.Optional(OKFStatusSchema),
  aliases: Type.Optional(Type.Array(Type.String())),
  moc: Type.Optional(Type.Array(Type.String())),
  tags: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: true });

/**
 * OKF 速查手册卡片 Schema (wiki/cheatsheet/)
 */
export const OKFCheatsheetFrontmatterSchema = Type.Object({
  type: Type.Literal("cheatsheet"),
  title: Type.String({ minLength: 1 }),
  created: Type.String({ minLength: 4 }),
  updated: Type.String({ minLength: 4 }),
  modeling: Type.Literal("recipe", { }),
  summary: Type.String({ }),
  category: Type.String({ minLength: 1 }),
  status: Type.Optional(OKFStatusSchema),
  confidence: Type.Optional(OKFConfidenceSchema),
  tools: Type.Array(Type.String(), { }),
  moc: Type.Optional(Type.Array(Type.String())),
  tags: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: true });

/**
 * OKF 领域看板卡片 Schema (wiki/areas/<domain>/_index.md)
 */
export const OKFDomainFrontmatterSchema = Type.Object({
  type: Type.Literal("domain"),
  title: Type.String({ minLength: 1 }),
  created: Type.String({ minLength: 4 }),
  updated: Type.String({ minLength: 4 }),
  status: Type.Optional(OKFStatusSchema),
  tags: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: true });

/**
 * 全系 OKF 卡片多态联合 Schema (Discriminated Union on 'type')
 */
export const OKFFrontmatterSchema = Type.Union([
  OKFConceptFrontmatterSchema,
  OKFSourceFrontmatterSchema,
  OKFEntityFrontmatterSchema,
  OKFCheatsheetFrontmatterSchema,
  OKFDomainFrontmatterSchema,
]);

// 静态推断类型
export type OKFConceptFrontmatter = Static<typeof OKFConceptFrontmatterSchema>;
export type OKFSourceFrontmatter = Static<typeof OKFSourceFrontmatterSchema>;
export type OKFEntityFrontmatter = Static<typeof OKFEntityFrontmatterSchema>;
export type OKFCheatsheetFrontmatter = Static<typeof OKFCheatsheetFrontmatterSchema>;
export type OKFDomainFrontmatter = Static<typeof OKFDomainFrontmatterSchema>;
export type OKFFrontmatter = Static<typeof OKFFrontmatterSchema>;

// ==========================================
// 3. Schema 映射表与校验引擎
// ==========================================

const SCHEMA_MAP: Record<string, TSchema> = {
  concept: OKFConceptFrontmatterSchema,
  source: OKFSourceFrontmatterSchema,
  entity: OKFEntityFrontmatterSchema,
  cheatsheet: OKFCheatsheetFrontmatterSchema,
  domain: OKFDomainFrontmatterSchema,
};

export interface OKFValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * 校验给定数据是否符合指定/自动推断的 OKF 卡片元数据规范
 */
export function validateOKFMetadata(data: unknown, explicitType?: string): OKFValidationResult {
  if (!isObject(data)) {
    return { valid: false, errors: ["metadata_not_object"] };
  }

  const rawType = explicitType || (data as Record<string, unknown>).type;
  if (!isString(rawType) || !rawType) {
    return { valid: false, errors: ["missing_or_invalid_type"] };
  }

  const schema = SCHEMA_MAP[rawType];
  if (!schema) {
    return { valid: false, errors: [`unsupported_card_type:${rawType}`] };
  }

  if (Value.Check(schema, data)) {
    return { valid: true, errors: [] };
  }

  const errors = [...Value.Errors(schema, data)].map(
    (e) => `[${e.path}] ${e.message} (${JSON.stringify(e.value)})`
  );
  return { valid: false, errors };
}

// ==========================================
// 4. 通用 OKF 元数据组装与强类型入参
// ==========================================

export interface CreateOKFConceptInput {
  readonly type: "concept";
  readonly title: string;
  readonly summary: string;
  readonly modeling?: ConceptModeling;
  readonly status?: "evergreen" | "developing" | "deprecated";
  readonly confidence?: "high" | "medium" | "low";
  readonly aliases?: readonly string[];
  readonly moc?: readonly string[];
  readonly spines?: readonly string[];
  readonly tags?: readonly string[];
  readonly created?: string;
  readonly updated?: string;
  readonly extraMeta?: Readonly<Record<string, unknown>>;
}

export interface CreateOKFSourceInput {
  readonly type: "source";
  readonly title: string;
  readonly category: string;
  readonly sources: ReadonlyArray<Static<typeof OKFSourceItemSchema>>;
  readonly status?: "evergreen" | "developing" | "deprecated";
  readonly confidence?: "high" | "medium" | "low";
  readonly author?: string;
  readonly clusters?: readonly string[];
  readonly tags?: readonly string[];
  readonly moc?: readonly string[];
  readonly created?: string;
  readonly updated?: string;
  readonly extraMeta?: Readonly<Record<string, unknown>>;
}

export interface CreateOKFEntityInput {
  readonly type: "entity";
  readonly title: string;
  readonly domain: string;
  readonly role?: string;
  readonly status?: "evergreen" | "developing" | "deprecated";
  readonly aliases?: readonly string[];
  readonly moc?: readonly string[];
  readonly tags?: readonly string[];
  readonly created?: string;
  readonly updated?: string;
  readonly extraMeta?: Readonly<Record<string, unknown>>;
}

export interface CreateOKFCheatsheetInput {
  readonly type: "cheatsheet";
  readonly title: string;
  readonly summary: string;
  readonly category: string;
  readonly tools: readonly string[];
  readonly modeling?: "recipe";
  readonly status?: "evergreen" | "developing" | "deprecated";
  readonly confidence?: "high" | "medium" | "low";
  readonly moc?: readonly string[];
  readonly tags?: readonly string[];
  readonly created?: string;
  readonly updated?: string;
  readonly extraMeta?: Readonly<Record<string, unknown>>;
}

export interface CreateOKFDomainInput {
  readonly type: "domain";
  readonly title: string;
  readonly status?: "evergreen" | "developing" | "deprecated";
  readonly tags?: readonly string[];
  readonly created?: string;
  readonly updated?: string;
  readonly extraMeta?: Readonly<Record<string, unknown>>;
}

export type CreateOKFMetadataInput =
  | CreateOKFConceptInput
  | CreateOKFSourceInput
  | CreateOKFEntityInput
  | CreateOKFCheatsheetInput
  | CreateOKFDomainInput;

/**
 * 通用 OKF v0.2 元数据构造纯函数 (涵盖 concept / source / entity / cheatsheet / domain)
 *
 * 核心机制：
 * 1. 纯无状态函数，依据 input.type 自动装配必填字段与默认值；
 * 2. 结合 TypeBox 进行严格的运行时格式校验；
 * 3. 校验未通过时抛出友好的 TypeError 阻断脏数据入库；
 * 4. 支持任意业务扩展字段（additionalProperties: true）。
 */
const spread = (key: string, value: unknown): Record<string, unknown> =>
  value === undefined ? {} : { [key]: value };

const listOf = (values?: readonly string[]): readonly string[] | undefined =>
  values && values.length > 0 ? [...values] : undefined;

/** 公共基底由工厂统一装配，各卡片形态只声明自己的差异字段 */
function buildSpecificFields(input: CreateOKFMetadataInput): Record<string, unknown> {
  switch (input.type) {
    case "concept":
      return {
        modeling: input.modeling ?? "ipo",
        summary: input.summary.trim(),
        ...spread("confidence", input.confidence),
        ...spread("aliases", listOf(input.aliases)),
        ...spread("moc", listOf(input.moc)),
        ...spread("spines", listOf(input.spines)),
        ...spread("tags", listOf(input.tags)),
      };
    case "source":
      return {
        category: input.category.trim(),
        sources: [...input.sources],
        ...spread("confidence", input.confidence),
        ...spread("author", input.author),
        ...spread("clusters", listOf(input.clusters)),
        ...spread("tags", listOf(input.tags)),
        ...spread("moc", listOf(input.moc)),
      };
    case "entity":
      return {
        domain: input.domain.trim(),
        ...spread("role", input.role),
        ...spread("aliases", listOf(input.aliases)),
        ...spread("moc", listOf(input.moc)),
        ...spread("tags", listOf(input.tags)),
      };
    case "cheatsheet":
      return {
        modeling: "recipe",
        summary: input.summary.trim(),
        category: input.category.trim(),
        tools: [...input.tools],
        ...spread("confidence", input.confidence),
        ...spread("moc", listOf(input.moc)),
        ...spread("tags", listOf(input.tags)),
      };
    case "domain":
      return { ...spread("tags", listOf(input.tags)) };
    default: {
      const exhaustiveCheck: never = input;
      throw new TypeError(`unsupported_card_type:${String(exhaustiveCheck)}`);
    }
  }
}

/**
 * 通用 OKF 卡片元数据工厂函数
 * 装配公共基础字段（type/title/created/updated/status），分派形态特定字段，并通过 TypeBox 严格校验
 */
export function createOKFMetadata<T extends OKFFrontmatter = OKFFrontmatter>(
  input: CreateOKFMetadataInput
): T {
  const { type, title, created = localIsoDate(), updated = localIsoDate(), extraMeta = {} } = input;
  const rawMeta: Record<string, unknown> = {
    type,
    title: title.trim(),
    created,
    updated,
    ...spread("status", input.status),
    ...buildSpecificFields(input),
    ...extraMeta,
  };

  const { valid, errors } = validateOKFMetadata(rawMeta, type);
  assert(
    valid,
    `okf_validation_failed:${type}:${errors.join(";")}`
  );

  return rawMeta as T;
}

// 概念卡片特化别名，完全向下兼容
export function createOKFConceptMetadata(
  input: Omit<CreateOKFConceptInput, "type"> & { type?: "concept" }
): OKFConceptFrontmatter {
  return createOKFMetadata<OKFConceptFrontmatter>({
    ...input,
    type: "concept",
  });
}

// ==========================================
// 5. 元数据增量更新与合并函数 (Update/Patch)
// ==========================================

export type OKFUpdatePatch<T extends OKFFrontmatter> = Partial<
  Omit<T, "type" | "created">
> & {
  readonly extraMeta?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
};

/**
 * OKF 元数据增量更新与合并纯函数
 *
 * 核心审美规范：
 * 1. 【不可变性】：严格保留原卡片的 created 创建日期与核心 type 类型；
 * 2. 【自动更新时效】：默认自动将 updated 更新为当天日期（亦可显式指定）；
 * 3. 【集合智能去重合并】：针对 aliases、moc、spines、tags 等数组字段，执行 Array.from(new Set([...old, ...patch])) 幂等合并，而非粗暴覆盖；
 * 4. 【信源智能累加】：针对 source 类型的 sources 列表，依据 id (sha256) 唯一键进行差量累加去重；
 * 5. 【强类型门禁防线】：合并后全量经过 TypeBox validateOKFMetadata 校验，杜绝因补丁导致脏元数据污染。
 */
interface SourceRef {
  readonly id: string;
  readonly [key: string]: unknown;
}

const MERGEABLE_LIST_KEYS = ["aliases", "moc", "spines", "tags", "clusters", "tools"] as const;

const mergeList = (oldValue: unknown, newValue: unknown): readonly string[] | undefined => {
  const combined = unique(
    [...ensureArray<string>(oldValue), ...ensureArray<string>(newValue)]
      .map((item) => String(item).trim())
      .filter(Boolean)
  );
  return combined.length > 0 ? combined : undefined;
};

/** 按 sha256 id 唯一键对溯源列表做差量累加，同 id 以补丁字段覆盖 */
const mergeSources = (...groups: readonly unknown[]): readonly SourceRef[] =>
  [
    ...groups
      .flatMap((group) => ensureArray<SourceRef>(group))
      .filter((item) => item?.id)
      .reduce<Map<string, SourceRef>>(
        (acc, item) => acc.set(item.id, { ...acc.get(item.id), ...item }),
        new Map()
      )
      .values(),
  ];

/**
 * OKF 元数据增量补丁合并函数
 * 保持 created 不可变，自动推进 updated，对 aliases/moc/spines 等集合字段做幂等去重累加，并通过 TypeBox 强校验
 */
export function updateOKFMetadata<T extends OKFFrontmatter>(
  existing: T,
  patch: OKFUpdatePatch<T>,
  options?: { readonly today?: string }
): T {
  assert(isObject(existing) && existing.type, "invalid_existing_metadata");

  const patchRecord = patch as Record<string, unknown>;
  const existingRecord = existing as Record<string, unknown>;

  const mergedLists = MERGEABLE_LIST_KEYS.reduce<Record<string, unknown>>((acc, key) => {
    const united = mergeList(existingRecord[key], patchRecord[key]);
    return united ? { ...acc, [key]: united } : acc;
  }, {});

  // extraMeta 是控制字段而非元数据，序列化前从补丁中剔除
  const patchFields = omit(patchRecord, ["extraMeta"]);
  const merged: Record<string, unknown> = {
    ...existingRecord,
    ...patchFields,
    type: existing.type,
    created: existing.created,
    updated: isString(patchRecord.updated) ? patchRecord.updated : options?.today ?? localIsoDate(),
    ...mergedLists,
    ...(existing.type === "source"
      ? { sources: mergeSources(existingRecord.sources, patchRecord.sources) }
      : {}),
    ...(patch.extraMeta ?? {}),
  };

  const { valid, errors } = validateOKFMetadata(merged, existing.type);
  assert(
    valid,
    `okf_update_validation_failed:${existing.type}:${errors.join(";")}`
  );

  return merged as T;
}

// ==========================================
// 6. 正文辅助函数与高层便利组合器
// ==========================================

export interface CardAttachmentItem {
  readonly name: string;
  readonly url: string;
  readonly ext?: string;
}

/**
 * 纯正文附件追加函数 (完全解耦元数据)
 */
export function appendCardAttachments(
  body: string,
  attachments?: readonly CardAttachmentItem[],
  texts: OkfTexts = NEUTRAL_OKF_TEXTS
): string {
  if (!attachments || attachments.length === 0) return body;

  const lines = attachments.map((item) => texts.attachmentLine(item));
  return `${body.trimEnd()}\n\n${texts.appendixHeading}\n\n${lines.join("\n")}\n`;
}

export interface BuildOKFConceptCardOptions {
  readonly title: string;
  readonly cleanContent: string;
  readonly modeling?: ConceptModeling;
  readonly summary?: string;
  readonly status?: "evergreen" | "developing" | "deprecated";
  readonly confidence?: "high" | "medium" | "low";
  readonly aliases?: readonly string[];
  readonly moc?: readonly string[];
  readonly spines?: readonly string[];
  readonly tags?: readonly string[];
  readonly extraMeta?: Readonly<Record<string, unknown>>;
  readonly attachments?: readonly CardAttachmentItem[];
  readonly today?: string;
  readonly distill?: DistillOptions;
  readonly okfTexts?: OkfTexts;
}

export interface OKFConceptCardResult {
  readonly frontmatter: OKFConceptFrontmatter;
  readonly body: string;
}

/**
 * 通用 OKF v0.2 原子概念卡片提纯与结构化组合器
 */
export async function buildOKFConceptCard(options: BuildOKFConceptCardOptions): Promise<OKFConceptCardResult> {
  const {
    title,
    cleanContent,
    modeling = "ipo",
    summary: customSummary,
    status,
    confidence,
    aliases = [],
    moc = [],
    spines = [],
    tags = [],
    extraMeta = {},
    attachments = [],
    today = localIsoDate(),
    distill = {},
    okfTexts = NEUTRAL_OKF_TEXTS,
  } = options;

  const { parseMarkdownWithAST, distillMarkdownContent } = await getDistillerModule();
  const finalSummary = customSummary ?? parseMarkdownWithAST(cleanContent, title, {
    summary: distill.extractor?.summary,
    sectionFilter: distill.extractor?.sectionFilter,
  }).summary;

  const frontmatter = createOKFConceptMetadata({
    title,
    summary: finalSummary,
    modeling,
    status,
    confidence,
    aliases,
    moc,
    spines,
    tags,
    extraMeta,
    created: today,
    updated: today,
  });

  const distilledBody = distillMarkdownContent(cleanContent, title, {
    ...distill,
    modeling,
    summary: finalSummary,
  });

  const body = appendCardAttachments(distilledBody, attachments, okfTexts);

  return { frontmatter, body };
}
