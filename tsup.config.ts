import { defineConfig } from "tsup";

/** entry 键与 package.json exports 子路径一一对应 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    "ast/index": "src/layers/ingest/ast/index.ts",
    "okf/index": "src/layers/compile/okf/index.ts",
    "sense/index": "src/layers/retrieval/sense/index.ts",
    "patch/index": "src/layers/compile/patch/index.ts",
    "lint/index": "src/layers/governance/lint/index.ts",
    "hash/index": "src/foundation/hash.ts",
    "snapshot/index": "src/layers/ingest/snapshot/index.ts",
    "graph/index": "src/layers/retrieval/graph/index.ts",
    "jit/index": "src/layers/retrieval/jit/index.ts",
    "markdown/index": "src/contracts/markdown.ts",
    "numeric/index": "src/foundation/numeric.ts",
    "evidence/index": "src/layers/compile/evidence/index.ts",
    "presets/index": "src/presets/index.ts",
    "pipeline/index": "src/layers/compile/pipeline/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
});
