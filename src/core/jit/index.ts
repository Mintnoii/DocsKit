import { normalize } from "pathe";
import { sift, unique } from "radash";
import { outdent } from "../shared/markdown";

export interface JITCardItem {
  readonly title: string;
  readonly summary: string;
  readonly filePath: string;
  readonly content?: string;
  readonly dependencies?: readonly { readonly title: string; readonly filePath: string }[];
  readonly dependents?: readonly { readonly title: string; readonly filePath: string }[];
}

export interface JITFormatOptions {
  /** compact (指针+摘要) | detailed (携带正文契约) */
  readonly mode?: "compact" | "detailed";
  readonly vaultName?: string;
}

const JIT_TIPS = Object.freeze({
  compact: "> 2. 若当前修改涉及上述模块的边界或重构，**请主动发起 `read_file` 工具调用深入精读对应物理指针**，顺着 1-Hop 双链避免重构破坏。",
  detailed: "> 2. 深度契约正文已载入上方，请严格对齐上述 IPO 契约与性能门禁编写代码。",
});

const pointerOf = (filePath: string): string => `\`file:///${normalize(filePath)}\``;

interface JITLink {
  readonly title: string;
  readonly filePath: string;
}

const linkLineOf = (label: string, items: readonly JITLink[] = []): string | null =>
  items.length > 0
    ? `- **${label}**: ${items.map((item) => `《${item.title}》(${pointerOf(item.filePath)})`).join("、")}`
    : null;

/** JIT 渐进式装配：指针/摘要与深度正文两级输出，路径收集与视图渲染彻底解耦 */
export function formatAgentJITPrompt(
  query: string,
  matches: readonly JITCardItem[],
  options: JITFormatOptions = {}
): { readonly prompt: string; readonly topCardPaths: readonly string[] } {
  const { mode = "compact", vaultName = "知识库" } = options;

  if (matches.length === 0) {
    return {
      prompt: outdent`
        > [!NOTE] ${vaultName} 架构检索上下文
        > 未检索到与 "${query}" 强相关的核心规范卡片。如涉及全新架构，请遵循团队常规编码规范。
      `,
      topCardPaths: [],
    };
  }

  const cardBlocks = matches.map((match, idx) => {
    const bodyBlock = mode === "detailed" && match.content
      ? outdent`

          <card_contract_body>
          ${match.content.trim()}
          </card_contract_body>
        `
      : "";

    const lines = sift([
      `### ${idx + 1}. 《${match.title}》`,
      `- **核心定义**: ${match.summary}`,
      `- **物理指针**: ${pointerOf(match.filePath)}`,
      linkLineOf("🔗 1-Hop 强前置依赖", match.dependencies),
      linkLineOf("⚓ 1-Hop 下游关联受影响卡片 (Backlinks)", match.dependents),
    ]);

    return `${lines.join("\n")}${bodyBlock}`;
  });

  const topCardPaths = unique(
    matches.flatMap((match) => [
      match.filePath,
      ...(match.dependencies ?? []).map((item) => item.filePath),
      ...(match.dependents ?? []).map((item) => item.filePath),
    ])
  );

  const prompt = outdent`
    <!-- ${vaultName} Architecture & Consensus Context (JIT Progressive Lens) -->
    > [!IMPORTANT] 核心架构约束对账 (JIT 懒加载就绪)
    > 本地检索命中以下 ${matches.length} 项与当前任务相关的规范卡片：

    ${cardBlocks.join("\n\n")}

    > [!TIP] Coding Agent 执行纪律：
    > 1. 上述卡片为公共架构资产与决策约束，**不可随意推翻**；
    ${JIT_TIPS[mode]}
  `;

  return { prompt, topCardPaths };
}
