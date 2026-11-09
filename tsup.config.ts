import { defineConfig } from "tsup";

/** entry 键与 package.json exports 子路径一一对应 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    "ast/index": "src/core/ast/index.ts",
    "sense/index": "src/core/sense/index.ts",
    "patch/index": "src/core/patch/index.ts",
    "lint/index": "src/core/lint/index.ts",
    "hash/index": "src/core/hash/index.ts",
    "snapshot/index": "src/core/snapshot/index.ts",
    "graph/index": "src/core/graph/index.ts",
    "jit/index": "src/core/jit/index.ts",
    "shared/index": "src/core/shared/index.ts",
    "pipeline/index": "src/pipeline/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
});
