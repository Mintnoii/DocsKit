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

/** 只约束守卫真正消费的字段；input 用 object 承接异构事件，避开全可选属性的弱类型检测 */
export interface GenericToolCallEvent {
  readonly toolName: string;
  readonly input?: object;
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
  const path = event.input && "path" in event.input ? event.input.path : undefined;
  if (!writeTools.includes(event.toolName) || !isString(path)) return undefined;
  if (!isProtectedPath(path, options?.protectedPatterns)) return undefined;

  return { block: true, reason: options?.blockReason ?? DEFAULT_BLOCK_REASON };
}
