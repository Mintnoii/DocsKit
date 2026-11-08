import { createHash } from "node:crypto";
import matter from "gray-matter";
import { isEmpty } from "radash";

/**
 * 抹平换行符（CRLF -> LF）
 */
export const normalizeLf = (text: string): string => (text ?? "").replace(/\r\n/g, "\n");

/**
 * 计算纯净字符串的 SHA-256 散列
 * 先行抹平 CRLF 为 LF，杜绝因跨平台换行符差异导致伪哈希冲突
 *
 * @example
 * ```ts
 * computeContentHash("hello\r\nworld"); // "sha256:..."
 * ```
 */
export const computeContentHash = (content: string): string => {
  const normalized = normalizeLf(content);
  return `sha256:${createHash("sha256").update(normalized, "utf8").digest("hex")}`;
};

/**
 * 纯函数：计算 Markdown 纯正文 SHA-256 指纹（剔除 Frontmatter 干扰）
 * 对齐 Ghost 知识库 Zero-Ledger 溯源指纹契约
 *
 * @example
 * ```ts
 * const raw = "---\ntitle: test\n---\nHello World";
 * computeMarkdownBodyHash(raw); // "sha256:..."
 * ```
 */
export const computeMarkdownBodyHash = (rawMarkdown: string): string | null => {
  const normalized = normalizeLf(rawMarkdown);
  const parsed = matter(normalized);
  const body = parsed.content.trim();

  return isEmpty(body)
    ? null
    : `sha256:${createHash("sha256").update(body, "utf8").digest("hex")}`;
};

/**
 * 0-Token 幂等门禁检查器
 * 在调用 LLM 或执行繁重编译流水线前，根据指纹或历史哈希集进行纯内存 O(1) 短路拦截
 *
 * @example
 * ```ts
 * const knownHashes = new Set(["sha256:abc..."]);
 * checkContentIdempotency("sha256:abc...", knownHashes); // { shouldSkip: true, reason: "HASH_EXISTS" }
 * ```
 */
export interface IdempotencyResult {
  readonly shouldSkip: boolean;
  readonly hash: string | null;
  readonly reason?: "EMPTY_BODY" | "HASH_EXISTS" | "UNCHANGED";
}

export const checkContentIdempotency = (
  incomingHashOrContent: string,
  existingFingerprints: ReadonlySet<string> | string
): IdempotencyResult => {
  const isHash = incomingHashOrContent.startsWith("sha256:");
  const hash = isHash
    ? incomingHashOrContent
    : computeMarkdownBodyHash(incomingHashOrContent);

  if (!hash) {
    return { shouldSkip: true, hash: null, reason: "EMPTY_BODY" };
  }

  const isMatched = typeof existingFingerprints === "string"
    ? hash === existingFingerprints
    : existingFingerprints.has(hash);

  return isMatched
    ? { shouldSkip: true, hash, reason: "HASH_EXISTS" }
    : { shouldSkip: false, hash };
};
