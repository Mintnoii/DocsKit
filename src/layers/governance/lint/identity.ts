/** 卡片身份一致性巡检，不变量是 frontmatter title 等于文件名 stem */

export interface CardIdentity {
  readonly stem: string;
  readonly title: string;
  readonly path?: string;
}

export interface TitleStemIssue {
  readonly cardPath: string;
  readonly title: string;
  readonly stem: string;
  readonly message: string;
}

/**
 * 校验卡片 frontmatter 标题与文件名 stem 是否严格一致
 * 过滤空标题，不一致时输出带违规路径的诊断记录
 */
export const checkTitleStemConsistency = (
  cards: readonly CardIdentity[]
): readonly TitleStemIssue[] =>
  cards
    .filter((card) => card.title.trim().length > 0 && card.title.trim() !== card.stem)
    .map((card) => ({
      cardPath: card.path ?? card.stem,
      title: card.title.trim(),
      stem: card.stem,
      message: "title_stem_mismatch",
    }));
