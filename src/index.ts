// DocsKit 统一门面：只做扁平导出，供一次性脚本与工具入口使用。业务代码一律走 docskit/<子路径>。


export * from "./contracts/markdown";
export * from "./foundation/numeric";
export * from "./foundation/hash";
export * from "./layers/ingest/ast/index";
export * from "./layers/compile/okf/index";
export * from "./layers/ingest/snapshot/index";
export * from "./layers/retrieval/sense/index";
export * from "./layers/compile/patch/index";
export * from "./layers/governance/lint/index";
export * from "./layers/retrieval/graph/index";
export * from "./layers/retrieval/jit/index";
export * from "./layers/compile/evidence/index";
export * from "./presets/index";
export * from "./layers/compile/pipeline/index";
