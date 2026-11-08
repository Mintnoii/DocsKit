export interface JITCardItem {
  readonly title: string;
  readonly summary: string;
  readonly filePath: string;
  readonly content?: string;
  readonly dependencies?: readonly { readonly title: string; readonly filePath: string }[];
  readonly dependents?: readonly { readonly title: string; readonly filePath: string }[];
}

export interface JITFormatOptions {
  /** 消费模式: compact (指针+摘要, ~200 Token) | detailed (携带正文契约, ~800 Token) */
  readonly mode?: "compact" | "detailed";
  /** 知识库所属名称/标题 */
  readonly vaultName?: string;
}

/**
 * 格式化为注入 Coding Agent (Claude Code / Cursor / Windsurf / IDE) 的标准紧凑上下文
 */
export function formatAgentJITPrompt(
  query: string,
  matches: readonly JITCardItem[],
  options: JITFormatOptions = {}
): { readonly prompt: string; readonly topCardPaths: readonly string[] } {
  const { mode = "compact", vaultName = "知识库" } = options;
  const topCardPaths: string[] = [];

  if (matches.length === 0) {
    return {
      prompt: `> [!NOTE] ${vaultName} 架构感知透镜\n> 未检索到与 "${query}" 强相关的核心规范卡片。如涉及全新架构，请遵循团队常规编码规范。`,
      topCardPaths: [],
    };
  }

  let prompt = `<!-- ${vaultName} Architecture & Consensus Context (JIT Progressive Lens) -->\n`;
  prompt += `> [!IMPORTANT] 核心架构与因果约束对账 (JIT 懒加载就绪)\n`;
  prompt += `> 本地知识透镜已命中以下 ${matches.length} 项与当前任务强相关的唯一真理源卡片：\n\n`;

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    topCardPaths.push(m.filePath);
    const normalizedPath = m.filePath.replaceAll("\\", "/");

    prompt += `### ${i + 1}. 《${m.title}》\n`;
    prompt += `- **因果摘要**: ${m.summary}\n`;
    prompt += `- **物理指针**: \`file:///${normalizedPath}\`\n`;

    if (m.dependencies && m.dependencies.length > 0) {
      prompt += `- **🔗 1-Hop 强前置依赖**: ${m.dependencies.map((d) => `《${d.title}》(\`file:///${d.filePath.replaceAll("\\", "/")}\`)`).join("、")}\n`;
      m.dependencies.forEach((d) => topCardPaths.push(d.filePath));
    }

    if (m.dependents && m.dependents.length > 0) {
      prompt += `- **⚓ 1-Hop 下游关联受影响卡片 (Backlinks)**: ${m.dependents.map((d) => `《${d.title}》(\`file:///${d.filePath.replaceAll("\\", "/")}\`)`).join("、")}\n`;
      m.dependents.forEach((d) => topCardPaths.push(d.filePath));
    }

    if (mode === "detailed" && m.content) {
      prompt += `\n<card_contract_body>\n${m.content.trim()}\n</card_contract_body>\n`;
    }
    prompt += `\n`;
  }

  prompt += `> [!TIP] Coding Agent 执行纪律：\n`;
  prompt += `> 1. 上述卡片为公共架构资产与决策约束，**不可随意推翻**；\n`;
  prompt += `> 2. 若当前修改涉及上述模块的边界或重构，**请主动发起 \`read_file\` 工具调用深入精读对应物理指针**，顺着 1-Hop 双链避免重构破坏。\n`;

  return { prompt, topCardPaths: Array.from(new Set(topCardPaths)) };
}
