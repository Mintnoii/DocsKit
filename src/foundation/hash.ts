import { createHash } from "node:crypto";
import { isEmpty } from "radash";
import { normalizeLf, parseMarkdownSafely } from "../contracts/markdown";

/** 全库唯一的 SHA-256 十六进制摘要，其他模块不得自己调 crypto */
export const computeSha256Hex = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

const sha256 = (text: string): string => `sha256:${computeSha256Hex(text)}`;

/** SHA-256 十六进制前 N 位，供段落指纹与并存路径后缀共用 */
export const computeShortHash = (text: string, length = 8): string =>
  computeSha256Hex(text).slice(0, length);

/** 抹平 CRLF 后计算纯文本 SHA-256 */
export const computeContentHash = (content: string): string => sha256(normalizeLf(content));

/** 剥离 Frontmatter 后基于纯正文计算 SHA-256（Zero-Ledger 溯源指纹契约） */
export const computeMarkdownBodyHash = (rawMarkdown: string): string | null => {
  const { body } = parseMarkdownSafely(rawMarkdown);
  return isEmpty(body) ? null : sha256(body);
};

/** 纯文本正文 SHA-256 别名，对齐 Ghost calcRawContentSha256 契约 */
export const calcRawContentSha256 = computeMarkdownBodyHash;

export interface IdempotencyResult {
  readonly shouldSkip: boolean;
  readonly skip: boolean;
  readonly reason: "EXACT_HASH_MATCH" | "EMPTY_BODY" | "NEW_OR_MODIFIED";
  readonly hash: string | null;
}

const idempotency = (
  shouldSkip: boolean,
  reason: IdempotencyResult["reason"],
  hash: string | null
): IdempotencyResult => ({ shouldSkip, skip: shouldSkip, reason, hash });

/** 0-Token 纯内存 O(1) 幂等短路，供 LLM 编译前拦截 */
export function checkContentIdempotency(
  rawMarkdown: string,
  existingHashes: ReadonlySet<string> | readonly string[]
): IdempotencyResult {
  const hash = computeMarkdownBodyHash(rawMarkdown);
  if (!hash) return idempotency(true, "EMPTY_BODY", null);

  const hashSet = existingHashes instanceof Set ? existingHashes : new Set(existingHashes);
  return hashSet.has(hash)
    ? idempotency(true, "EXACT_HASH_MATCH", hash)
    : idempotency(false, "NEW_OR_MODIFIED", hash);
}
