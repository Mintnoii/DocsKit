import { normalize } from "pathe";
import picomatch from "picomatch";
import { isString } from "radash";

export const DEFAULT_PROTECTED_PATTERNS = ["**/_raw/**", "_raw/**"];
export const DEFAULT_BLOCK_REASON = "只读底座受保护：严禁向只读底座目录执行任何写入或编辑操作！";

/** 基于 picomatch Glob 判定路径是否命中受保护目录 */
export function isProtectedPath(
  targetPath: string,
  patterns: readonly string[] = DEFAULT_PROTECTED_PATTERNS
): boolean {
  if (!targetPath) return false;
  return picomatch([...patterns])(normalize(targetPath));
}

export interface GenericToolCallEvent {
  readonly toolName: string;
  readonly input?: {
    readonly path?: string;
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
}

export interface GuardEvaluationResult {
  readonly block: boolean;
  readonly reason: string;
}

const DEFAULT_WRITE_TOOLS = ["write", "edit", "write_file", "edit_file"];

/** 通用 Agent ToolCall 写入拦截守护器 */
export function evaluateToolCallPathGuard(
  event: GenericToolCallEvent,
  options?: {
    readonly protectedPatterns?: readonly string[];
    readonly blockReason?: string;
    readonly writeToolNames?: readonly string[];
  }
): GuardEvaluationResult | undefined {
  const writeTools = options?.writeToolNames ?? DEFAULT_WRITE_TOOLS;
  const path = event.input?.path;
  if (!writeTools.includes(event.toolName) || !isString(path)) return undefined;
  if (!isProtectedPath(path, options?.protectedPatterns)) return undefined;

  return { block: true, reason: options?.blockReason ?? DEFAULT_BLOCK_REASON };
}
