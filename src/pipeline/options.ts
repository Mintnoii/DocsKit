/**
 * 编译模式：
 * - patch: 保持全文主干与接口完整，按章节 AST 差量对账（90% 场景推荐）
 * - distill: 抽取核心定义、IPO 结构与精选实现代码
 * - passThrough: 仅做标准清洗后原样直通
 */
export type CompileMode = "patch" | "distill" | "passThrough";

export interface PipelineGates {
  /** 是否启用 0-Token 纯正文哈希幂等检查（默认 true） */
  readonly idempotency?: boolean;
  /** 是否启用 lock: human 人工锁检查阻断（默认 true） */
  readonly humanLock?: boolean;
}

export interface PipelineFeatures {
  /** 是否提取二进制附件并在文末生成资产清单表格（默认 true） */
  readonly extractAttachments?: boolean;
  /** 发生章节或接口删除时，是否在原位置注入 [!WARNING] 废弃警示（默认 false） */
  readonly deprecationNotice?: boolean;
  /** 自定义链接转换钩子（如站内 wiki 链接转双链指针） */
  readonly transformLink?: (url: string, linkText: string) => string | null;
}

export interface PipelineMetadataOptions<TMeta = Record<string, unknown>> {
  /** 默认填充的元数据字段 */
  readonly defaultValues?: Partial<TMeta>;
  /** 必填字段列表（校验缺失将抛出错误） */
  readonly requiredFields?: readonly string[];
  /** 元数据后置处理与动态计算钩子 */
  readonly transform?: (data: TMeta, content: string) => TMeta;
}

export interface PipelineOptions<TMeta = Record<string, unknown>> {
  /** 文档核心标题（必填，用作 AST 提纯与章节回退名称） */
  readonly title: string;
  /** 编译模式，默认 "patch" */
  readonly compileMode?: CompileMode;
  /** 概念建模范式（在 compileMode: "distill" 时生效，支持 ipo / decomposition / hybrid，默认 "ipo"） */
  readonly modeling?: "ipo" | "decomposition" | "hybrid";
  /** 如果是 patch 模式，传入既有旧卡片正文（若不存在则等同于全量新建） */
  readonly existingContent?: string;
  /** 门禁开关配置 */
  readonly gates?: PipelineGates;
  /** 功能开关配置 */
  readonly features?: PipelineFeatures;
  /** 历史正文哈希指纹集（用于 0-Token 幂等拦截） */
  readonly knownFingerprints?: ReadonlySet<string>;
  /** 业务自定义元数据配置 */
  readonly metadata?: PipelineMetadataOptions<TMeta>;
}

export interface PipelineResult<TMeta = Record<string, unknown>> {
  /** 执行决策与动作 */
  readonly action: "SKIPPED_IDEMPOTENCY" | "SKIPPED_HUMAN_LOCK" | "CREATED" | "PATCHED" | "DISTILLED";
  /** 是否被跳过 */
  readonly skipped: boolean;
  /** 跳过原因 */
  readonly skipReason?: "UNCHANGED_HASH" | "LOCKED_BY_HUMAN" | "EMPTY_BODY";
  /** 产出的纯正文内容（已去除 frontmatter 封装） */
  readonly content: string;
  /** 最终标准序列化的完整 Markdown（包含 Frontmatter 与 LF 换行） */
  readonly fullMarkdown: string;
  /** 纯正文指纹 (sha256:...) */
  readonly bodyHash: string | null;
  /** 最终合并计算后的元数据 */
  readonly frontmatter: Readonly<TMeta>;
  /** 提取到的附件清单 */
  readonly attachments: ReadonlyArray<{ readonly name: string; readonly url: string; readonly ext: string }>;
}
