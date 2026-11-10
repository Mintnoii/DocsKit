/**
 * 全库策略数值单一真理源。
 * 阈值、权重、上限与精度只在此集中声明，业务模块一律解构引用，支持 options 显式覆盖。
 */

export const POLICY = Object.freeze({
  /**
   * 概念与卡片级联去重策略 (compile/patch/dedup.ts)
   */
  dedup: Object.freeze({
    /** 综合加权相似度判定阈值（高于此值判定为同一概念卡片并进入合并流程） */
    threshold: 0.58,
    /** Fuse.js 词形模糊匹配容差阈值（越小越严格） */
    fuzzyThreshold: 0.35,
    /** 候选词与目标词长度比率下限，防止 "Vue" 吞并 "Vue Router" 等短词吞长词现象 */
    minLengthRatio: 0.65,
    /** 核心概念名有效字符长度下限，短于此长度不触发模糊搜索 */
    minCoreLength: 4,
    /** 词形字面相似度在加权打分中的权重 (70%) */
    lexicalWeight: 0.7,
    /** 摘要语义相似度在加权打分中的权重 (30%) */
    summaryWeight: 0.3,
    /** 命中 Fuse.js 词形模糊匹配时的保底等效相似度分数 */
    fuzzySimilarity: 0.88,
    /** 相似度分数的输出精度（保留 4 位小数） */
    scorePrecision: 4,
  }),

  /**
   * 知识库生命周期与代谢分析策略 (governance/lint/card-lifecycle.ts, topology.ts)
   */
  lifecycle: Object.freeze({
    /** 冗余卡片对查重的高相似度告警阈值（余弦相似度高于 0.82 判定为高危重复卡） */
    similarityThreshold: 0.82,
    /** 相似度打分精度 */
    scorePrecision: 4,
    /** 稀疏入链判定上限（垂直入链 <= 1 且无水平入链视为孤立/边缘卡片） */
    sparseInboundMax: 1,
    /** 常青卡片 (evergreen) 陈旧复审天数（超过 90 天未更新触发 review_stale 建议） */
    staleDays: 90,
  }),

  /**
   * AST 结构提取与卡片提纯策略 (ingest/ast/distiller.ts, presets/zh-cn.ts)
   *
   * 【为什么设置提取上限，而不是无脑全存？】
   * 1. 原始长文/代码/表格已 100% 完整保存在 _raw/ 底座，绝不丢数据；
   * 2. 知识库 Wiki 卡片定位是「高信噪比提纯」，而非「长文搬家/镜像」；
   * 3. 严格控制单卡体积，防止后续 JIT/RAG 检索时撑爆 LLM 上下文 Token 预算，
   *    并避免超长文本导致模型发生注意力分散（Lost in the Middle）；
   * 4. 推动合理拆卡：当步骤超过 4 步时，说明概念粒度过粗，应通过 [[双链]] 拆原子卡，而非堆在一张卡内。
   */
  distiller: Object.freeze({
    /** 有效代码块最小行数阈值（过滤 1~2 行的琐碎命令片段，如 `pnpm install`） */
    minCodeLines: 3,
    /**
     * 建模卡片分阶段列表展示上限（默认最多提取 4 阶段）：
     * 超过 4 阶段表明业务流程过长，应拆分子卡片通过双链引用
     */
    maxStages: 4,
    /**
     * 混合建模核心子步骤展示上限（默认最多提取 3 步骤）：
     * 保证宏观结构紧凑清晰，不喧宾夺主
     */
    maxSteps: 3,
    /**
     * 卡片保留的核心重点代码块数量上限（默认挑选字符长度最长/信息密度最高的前 3 个）：
     * 避免网页中十几个辅助/片段代码塞满卡片，真正关键实现直出
     */
    maxCodeBlocks: 3,
    /**
     * 卡片保留的重点表格数量上限（默认最多保留 3 张）：
     * 优先呈现核心对比表与输入输出表，防止长表格撑爆上下文
     */
    maxTables: 3,
  }),

  /**
   * 混合检索、BM25 与 Late Chunking 稠密向量策略 (retrieval/sense/)
   */
  sense: Object.freeze({
    /** BM25 稀疏检索有效得分下限，低于此分数不计入 RRF 候选池 */
    bm25MinScore: 0.1,
    /** 向量余弦检索有效得分下限 */
    vectorMinScore: 0.2,
    /** SIGIR RRF 倒数秩融合平滑常数 k（工业标准 60，平衡头部名次差距） */
    rrfK: 60,
    /** 混合检索最终返回的 Top 候选卡片数量 */
    candidateLimit: 10,
    /** 多路召回初筛扩充倍数（初筛候选池 = limit * 3） */
    candidateMultiplier: 3,
    /** 多路召回初筛保底最小候选池容量 */
    minCandidatePool: 10,
    /** 进程内 Cross-Encoder Rerank 结果 LRU 缓存条数上限 */
    rerankCacheLimit: 128,
    /** 本地 Embedding 与 Late Chunking 上下文窗口最大 Token 长度 */
    maxTokens: 512,
    /** BM25 词频饱和度参数 k1（经典最佳实践 1.5） */
    bm25K1: 1.5,
    /** BM25 文档长度惩罚系数 b（经典最佳实践 0.75） */
    bm25B: 0.75,
    /** BM25 独立单路检索默认返回数量上限 */
    bm25Limit: 10,
  }),

  /**
   * 证据链锚点与事实覆盖度策略 (compile/evidence/)
   */
  evidence: Object.freeze({
    /** 锚点有效段落字符长度下限（短于 40 字符过滤，避免碎片干扰） */
    minParagraphLength: 40,
    /** 引用选段截断长度上限 */
    maxQuoteLength: 120,
    /** 事实断言声明句长度上限 */
    maxClaimLength: 60,
    /** 原文对断言声明句的 2-Gram 覆盖率最低及格线 (60%) */
    minClaimCoverage: 0.6,
    /** 参与必选覆盖校验的拉丁标识符/英文单词最小字符长度 */
    minLatinTokenLength: 3,
    /** 提取的最佳佐证选段数量上限 */
    limit: 3,
    /** 段落哈希指纹的短截断长度（SHA-256 前 8 位） */
    hashLength: 8,
  }),

  /**
   * 文本与标题排版策略 (contracts/markdown.ts)
   */
  text: Object.freeze({
    /** 卡片降噪标题最大保留字符长度（超长截断并补省略号） */
    condenseMaxLen: 40,
  }),

  /**
   * 章节差量更新与版本标记策略 (compile/patch/section-patcher.ts)
   */
  section: Object.freeze({
    /** 默认版本变更标识 */
    defaultRevision: "Latest",
    /** 最新版本占位标识 */
    latestRevision: "Latest",
  }),
});
