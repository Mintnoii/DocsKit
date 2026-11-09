// DocsKit 统一门面：命名空间导出 + 扁平函数导出，新增函数只需在所属模块导出一次。

export * as hash from "./core/hash/index";
export * as ast from "./core/ast/index";
export * as okf from "./core/okf/index";
export * as snapshot from "./core/snapshot/index";
export * as sense from "./core/sense/index";
export * as patch from "./core/patch/index";
export * as lint from "./core/lint/index";
export * as graph from "./core/graph/index";
export * as jit from "./core/jit/index";
export * as pipeline from "./pipeline/index";

export * from "./core/shared/markdown";
export * from "./core/shared/numeric";
export * from "./core/hash/index";
export * from "./core/ast/index";
export * from "./core/okf/index";
export * from "./core/snapshot/index";
export * from "./core/sense/index";
export * from "./core/patch/index";
export * from "./core/lint/index";
export * from "./core/graph/index";
export * from "./core/jit/index";
export * from "./pipeline/index";
