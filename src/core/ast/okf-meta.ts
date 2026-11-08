import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { distillMarkdownContent, parseMarkdownWithAST, type ConceptModeling } from "./distiller";

// ==========================================
// 1. OKF 通用公共字段 Schema 底座
// ==========================================

export const OKFStatusSchema = Type.Union([
  Type.Literal("evergreen"),
  Type.Literal("developing"),
  Type.Literal("deprecated"),
], { default: "evergreen", description: "知识演化生命周期" });

export const OKFConfidenceSchema = Type.Union([
  Type.Literal("high"),
  Type.Literal("medium"),
  Type.Literal("low"),
], { default: "high", description: "置信度/成熟度评级" });

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
  status: OKFStatusSchema,
  confidence: OKFConfidenceSchema,
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
  status: OKFStatusSchema,
  confidence: OKFConfidenceSchema,
  author: Type.Optional(Type.String({ description: "原作者" })),
  clusters: Type.Optional(Type.Array(Type.String(), { description: "SEA 信源分簇标记" })),
  sources: Type.Array(OKFSourceItemSchema, { description: "关联的不可变原始文件 SHA256 溯源列表" }),
  tags: Type.Optional(Type.Array(Type.String())),
  moc: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: true });

/**
 * OKF 人物/布道者/机构实体卡片 Schema (wiki/people/)
 */
export const OKFEntityFrontmatterSchema = Type.Object({
  type: Type.Literal("entity"),
  title: Type.String({ minLength: 1, description: "实体全名/组织名" }),
  created: Type.String({ minLength: 4, description: "创建日期 YYYY-MM-DD" }),
  updated: Type.String({ minLength: 4, description: "更新日期 YYYY-MM-DD" }),
  domain: Type.String({ minLength: 1, description: "主要所属领域，如 ai-agent" }),
  role: Type.Optional(Type.String({ description: "角色/头衔/学术流派" })),
  status: OKFStatusSchema,
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
  status: OKFStatusSchema,
  confidence: OKFConfidenceSchema,
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
  status: OKFStatusSchema,
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
  if (typeof data !== "object" || data === null) {
    return { valid: false, errors: ["元数据必须为非 null 的普通对象"] };
  }

  const rawType = explicitType || (data as Record<string, unknown>).type;
  if (!rawType || typeof rawType !== "string") {
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
export function createOKFMetadata<T extends OKFFrontmatter = OKFFrontmatter>(
  input: CreateOKFMetadataInput
): T {
  const today = new Date().toISOString().split("T")[0];
  const {
    type,
    title,
    created = today,
    updated = today,
    status = "evergreen",
    extraMeta = {},
  } = input;

  let rawMeta: Record<string, unknown>;

  switch (type) {
    case "concept": {
      rawMeta = {
        type: "concept",
        title: title.trim(),
        created,
        updated,
        modeling: input.modeling || "ipo",
        summary: input.summary.trim(),
        status,
        confidence: input.confidence || "high",
        ...(input.aliases && input.aliases.length > 0 ? { aliases: [...input.aliases] } : {}),
        ...(input.moc && input.moc.length > 0 ? { moc: [...input.moc] } : {}),
        ...(input.spines && input.spines.length > 0 ? { spines: [...input.spines] } : {}),
        ...(input.tags && input.tags.length > 0 ? { tags: [...input.tags] } : {}),
        ...extraMeta,
      };
      break;
    }

    case "source": {
      rawMeta = {
        type: "source",
        title: title.trim(),
        created,
        updated,
        category: input.category.trim(),
        status,
        confidence: input.confidence || "high",
        sources: [...input.sources],
        ...(input.author ? { author: input.author } : {}),
        ...(input.clusters && input.clusters.length > 0 ? { clusters: [...input.clusters] } : {}),
        ...(input.tags && input.tags.length > 0 ? { tags: [...input.tags] } : {}),
        ...(input.moc && input.moc.length > 0 ? { moc: [...input.moc] } : {}),
        ...extraMeta,
      };
      break;
    }

    case "entity": {
      rawMeta = {
        type: "entity",
        title: title.trim(),
        created,
        updated,
        domain: input.domain.trim(),
        status,
        ...(input.role ? { role: input.role } : {}),
        ...(input.aliases && input.aliases.length > 0 ? { aliases: [...input.aliases] } : {}),
        ...(input.moc && input.moc.length > 0 ? { moc: [...input.moc] } : {}),
        ...(input.tags && input.tags.length > 0 ? { tags: [...input.tags] } : {}),
        ...extraMeta,
      };
      break;
    }

    case "cheatsheet": {
      rawMeta = {
        type: "cheatsheet",
        title: title.trim(),
        created,
        updated,
        modeling: "recipe",
        summary: input.summary.trim(),
        category: input.category.trim(),
        status,
        confidence: input.confidence || "high",
        tools: [...input.tools],
        ...(input.moc && input.moc.length > 0 ? { moc: [...input.moc] } : {}),
        ...(input.tags && input.tags.length > 0 ? { tags: [...input.tags] } : {}),
        ...extraMeta,
      };
      break;
    }

    case "domain": {
      rawMeta = {
        type: "domain",
        title: title.trim(),
        created,
        updated,
        status,
        ...(input.tags && input.tags.length > 0 ? { tags: [...input.tags] } : {}),
        ...extraMeta,
      };
      break;
    }

    default:
      throw new TypeError(`[Cyberbrain OKF Validator] 不支持的卡片类型: ${(input as any).type}`);
  }

  const { valid, errors } = validateOKFMetadata(rawMeta, type);
  if (!valid) {
    throw new TypeError(
      `[Cyberbrain OKF Validator] OKF v0.2 (${type}) Frontmatter 格式校验失败: ${errors.join("; ")}`
    );
  }

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
// 5. 元数据增量更新与合并算子 (Update/Patch)
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
export function updateOKFMetadata<T extends OKFFrontmatter>(
  existing: T,
  patch: OKFUpdatePatch<T>,
  options?: { readonly today?: string }
): T {
  if (typeof existing !== "object" || existing === null || !existing.type) {
    throw new TypeError(`[Cyberbrain OKF Validator] 待更新的现有元数据不合法`);
  }

  const today = options?.today || new Date().toISOString().split("T")[0];

  // 1. 数组字段智能集合去重合并辅助函数
  const mergeArray = (oldArr?: readonly string[], newArr?: readonly string[]): string[] | undefined => {
    if (!oldArr && !newArr) return undefined;
    const combined = [...(oldArr || []), ...(newArr || [])].map((item) => String(item).trim()).filter(Boolean);
    return Array.from(new Set(combined));
  };

  // 2. 基础对象克隆与浅合并
  const merged: Record<string, unknown> = {
    ...existing,
    ...patch,
    type: existing.type, // 绝对锁定类型，防止串味
    created: existing.created, // 严格保留诞生日期
    updated: (patch as any).updated || today, // 自动刷新时效
  };

  // 3. 针对数组字段执行集合合并 (aliases, moc, spines, tags, clusters, tools)
  const arrayKeys = ["aliases", "moc", "spines", "tags", "clusters", "tools"] as const;
  for (const key of arrayKeys) {
    if ((existing as any)[key] || (patch as any)[key]) {
      const united = mergeArray((existing as any)[key], (patch as any)[key]);
      if (united && united.length > 0) {
        merged[key] = united;
      }
    }
  }

  // 4. 特殊处理 source 卡片的 sources 溯源数组（按 sha256 id 唯一键幂等合并）
  if (existing.type === "source" && ((existing as any).sources || (patch as any).sources)) {
    const existingSources = ((existing as any).sources || []) as Array<{ id: string; [k: string]: unknown }>;
    const patchSources = ((patch as any).sources || []) as Array<{ id: string; [k: string]: unknown }>;
    const sourceMap = new Map<string, { id: string; [k: string]: unknown }>();
    for (const s of existingSources) {
      if (s?.id) sourceMap.set(s.id, s);
    }
    for (const s of patchSources) {
      if (s?.id) sourceMap.set(s.id, { ...(sourceMap.get(s.id) || {}), ...s });
    }
    merged.sources = Array.from(sourceMap.values());
  }

  // 5. 合并 extraMeta
  if (patch.extraMeta) {
    Object.assign(merged, patch.extraMeta);
  }

  // 6. 运行时格式门禁强校验
  const { valid, errors } = validateOKFMetadata(merged, existing.type);
  if (!valid) {
    throw new TypeError(
      `[Cyberbrain OKF Validator] 更新后 OKF (${existing.type}) Frontmatter 格式校验失败: ${errors.join("; ")}`
    );
  }

  return merged as T;
}

// ==========================================
// 6. 正文辅助算子与高层便利组合器
// ==========================================

export interface CardAttachmentItem {
  readonly name: string;
  readonly url: string;
  readonly ext?: string;
}

/**
 * 纯正文附件追加算子 (完全解耦元数据)
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
export function buildOKFConceptCard(options: BuildOKFConceptCardOptions): OKFConceptCardResult {
  const {
    title,
    cleanContent,
    modeling = "ipo",
    summary: customSummary,
    status = "evergreen",
    confidence = "high",
    aliases = [],
    moc = [],
    spines = [],
    tags = [],
    extraMeta = {},
    attachments = [],
    today = new Date().toISOString().split("T")[0],
  } = options;

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
