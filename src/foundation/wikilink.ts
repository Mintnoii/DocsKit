/** 双链目标的纯字符串归一，检索层与治理层共用，不持有拓扑状态 */

import { first } from "radash";
import { stripMarkdownExtension } from "../contracts/markdown";

/** 去掉双链锚点，保留以 # 结尾的特殊形态 */
export const stripAnchor = (target: string): string => {
  const clean = target.trim();
  return clean.includes("#") && !clean.endsWith("#.md") && !clean.endsWith("#")
    ? (first(clean.split("#")) ?? "").trim()
    : clean;
};

/** 去掉双链的别名管道符 */
export const stripAlias = (target: string): string => (first(target.split("|")) ?? "").trim();

/** 锚点、别名与 .md 后缀一次收敛 */
export const normalizeWikilinkTarget = (target: string): string =>
  stripMarkdownExtension(stripAnchor(stripAlias(target)));
