import assert from "node:assert/strict";
import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { isObject, isString, omit, unique } from "radash";
import { ensureArray, localIsoDate } from "../shared/markdown";
import type { ConceptModeling } from "../ast/distiller";

let cachedDistillerModule: typeof import("../ast/distiller") | null = null;

async function getDistillerModule(): Promise<typeof import("../ast/distiller")> {
  if (!cachedDistillerModule) {
    cachedDistillerModule = await import("../ast/distiller");
  }
  return cachedDistillerModule;
}

// ==========================================
// 1. OKF 通用公共字段 Schema 底座
// ==========================================

export const OKFStatusSchema = Type.Union([
  Type.Literal("evergreen"),
  Type.Literal("developing"),
  Type.Literal("deprecated"),
], { description: "知识演化生命周期（由上游显式给定，缺省即未评估）" });

export const OKFConfidenceSchema = Type.Union([
  Type.Literal("high"),
  Type.Literal("medium"),
  Type.Literal("low"),
], { description: "置信度/成熟度评级（由上游 LLM 评估给定，代码严禁伪造）" });

// ==========================================
// 2. 各业务形态卡片 Frontmatter Schema
// ==========================================

/**
 * OKF 概念卡片 Schema (wiki/learning/)
 */
export const OKFConceptFrontmatterSchema = Type.Object({
  type: Type.Literal("concept"),
  title: Type.String({ minLength: 1, description: "概念标准原子标题" }),
  created: Type.String({ minLength: 4, description: "创建日期 YYYY-MM-DD" }),
  updated: Type.String({ minLength: 4, description: "更新日期 YYYY-MM-DD" }),
  modeling: Type.Union([
    Type.Literal("ipo"),
    Type.Literal("decomposition"),
    Type.Literal("hybrid"),
  ], { description: "概念建模形态" }),
  summary: Type.String({ description: "概念核心定义一句话/本质剖析" }),
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
  id: Type.String({ minLength: 1, description: "sha256 唯一指纹，如 sha256:abc..." }),
  resource: Type.String({ minLength: 1, description: "关联只读素材相对路径，如 _raw/articles/xxx.md" }),
  origin_entry: Type.Optional(Type.String({ description: "采集来源，如 wechat-clipper / douyin-sync / feishu" })),
  title: Type.Optional(Type.String({ description: "信源原标题" })),
  url: Type.Optional(Type.String({ description: "原始外部网络 URL" })),
}, { additionalProperties: true });

export const OKFSourceFrontmatterSchema = Type.Object({
  type: Type.Literal("source"),
  title: Type.String({ minLength: 1, description: "信源规范标题" }),
  created: Type.String({ minLength: 4, description: "创建日期 YYYY-MM-DD" }),
  updated: Type.String({ minLength: 4, description: "更新日期 YYYY-MM-DD" }),
  category: Type.String({ minLength: 1, description: "所属领域，如 ai-agent / frontend / knowledge" }),
  status: Type.Optional(OKFStatusSchema),
  confidence: Type.Optional(OKFConfidenceSchema),
  author: Type.Optional(Type.String({ description: "原作者" })),
  clusters: Type.Optional(Type.Array(Type.String(), { description: "SEA 信源分簇标记" })),
  sources: Type.Array(OKFSourceItemSchema, { description: "关联的不可变原始文件 SHA256 溯源列表" }),
  tags: Type.Optional(Type.Array(Type.String())),
  moc: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: true });

/**
 * OKF 人物/实践者/机构实体卡片 Schema (wiki/people/)
 */
export const OKFEntityFrontmatterSchema = Type.Object({
  type: Type.Literal("entity"),
  title: Type.String({ minLength: 1, description: "实体全名/组织名" }),
  created: Type.String({ minLength: 4, description: "创建日期 YYYY-MM-DD" }),
  updated: Type.String({ minLength: 4, description: "更新日期 YYYY-MM-DD" }),
  domain: Type.String({ minLength: 1, description: "主要所属领域，如 ai-agent" }),
  role: Type.Optional(Type.String({ description: "角色/头衔/学术流派" })),
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
  title: Type.String({ minLength: 1, description: "速查规范标题" }),
  created: Type.String({ minLength: 4, description: "创建日期 YYYY-MM-DD" }),
  updated: Type.String({ minLength: 4, description: "更新日期 YYYY-MM-DD" }),
  modeling: Type.Literal("recipe", { description: "强类型操作规程建模" }),
  summary: Type.String({ description: "速查定位一句话摘要" }),
  category: Type.String({ minLength: 1, description: "所属业务领域" }),
  status: Type.Optional(OKFStatusSchema),
  confidence: Type.Optional(OKFConfidenceSchema),
  tools: Type.Array(Type.String(), { description: "适用工具/命令列表" }),
  moc: Type.Optional(Type.Array(Type.String())),
  tags: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: true });

/**
 * OKF 领域看板卡片 Schema (wiki/areas/<domain>/_index.md)
 */
export const OKFDomainFrontmatterSchema = Type.Object({
  type: Type.Literal("domain"),
  title: Type.String({ minLength: 1, description: "领域看板总标题" }),
  created: Type.String({ minLength: 4, description: "创建日期 YYYY-MM-DD" }),
  updated: Type.String({ minLength: 4, description: "更新日期 YYYY-MM-DD" }),
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
    return { valid: false, errors: ["元数据必须为非 null 的普通对象"] };
  }

  const rawType = explicitType || (data as Record<string, unknown>).type;
  if (!isString(rawType) || !rawType) {
    return { valid: false, errors: ["缺少必需的 'type' 字段或类型不正确"] };
  }

  const schema = SCHEMA_MAP[rawType];
  if (!schema) {
    return { valid: false, errors: [`不支持的 OKF 卡片类型: "${rawType}"`] };
  }

  if (Value.Check(schema, data)) {
    return { valid: true, errors: [] };
  }

  const errors = [...Value.Errors(schema, data)].map(
    (e) => `[${e.path}] ${e.message} (当前值: ${JSON.stringify(e.value)})`
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
      throw new TypeError(`[DocsKit OKF Validator] 不支持的卡片类型: ${String(exhaustiveCheck)}`);
    }
  }
}

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
    `[DocsKit OKF Validator] OKF v0.2 (${type}) Frontmatter 格式校验失败: ${errors.join("; ")}`
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

export function updateOKFMetadata<T extends OKFFrontmatter>(
  existing: T,
  patch: OKFUpdatePatch<T>,
  options?: { readonly today?: string }
): T {
  assert(isObject(existing) && existing.type, "[DocsKit OKF Validator] 待更新的现有元数据不合法");

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
    `[DocsKit OKF Validator] 更新后 OKF (${existing.type}) Frontmatter 格式校验失败: ${errors.join("; ")}`
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
export function appendCardAttachments(body: string, attachments?: readonly CardAttachmentItem[]): string {
  if (!attachments || attachments.length === 0) {
    return body;
  }

  const attachmentLines = attachments.map(
    (att) => `- 📎 **关联资产**: \`${att.name}\` ([查看地址](${att.url}))`
  );

  const trimmedBody = body.trimEnd();
  return `${trimmedBody}\n\n## 5. 关联外部资产与依赖清单\n\n${attachmentLines.join("\n")}\n`;
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
  } = options;

  const { parseMarkdownWithAST, distillMarkdownContent } = await getDistillerModule();

  let finalSummary = customSummary;
  if (!finalSummary) {
    const { summary: astSummary } = parseMarkdownWithAST(cleanContent, title);
    finalSummary = astSummary;
  }

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
    modeling,
    summary: finalSummary,
  });

  const body = appendCardAttachments(distilledBody, attachments);

  return { frontmatter, body };
}
