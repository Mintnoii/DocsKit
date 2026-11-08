import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "ast/index": "src/core/ast/index.ts",
    "sense/index": "src/core/sense/index.ts",
    "patch/index": "src/core/patch/index.ts",
    "lint/index": "src/core/lint/index.ts",
    "hash/index": "src/core/hash/index.ts",
    "snapshot/index": "src/core/snapshot/index.ts",
    "pipeline/index": "src/pipeline/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
});
