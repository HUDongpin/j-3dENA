import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(packageDirectory, "../..");
const outputDirectory = resolve(packageDirectory, "dist");

if (dirname(outputDirectory) !== packageDirectory) {
  throw new Error("SCIENTIFIC_WORKER_BUILD_FAILED: unsafe output directory");
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await build({
  configFile: false,
  root: repositoryRoot,
  logLevel: "warn",
  resolve: {
    alias: {
      "@3dena/analysis": resolve(repositoryRoot, "packages/analysis/src/index.ts"),
      "@3dena/export": resolve(repositoryRoot, "packages/export/src/index.ts"),
      "@3dena/io": resolve(repositoryRoot, "packages/io/src/index.ts"),
      "@3dena/stats": resolve(repositoryRoot, "packages/stats/src/index.ts"),
      "@3dena/tabular-import": resolve(
        repositoryRoot,
        "packages/tabular-import/src/index.ts",
      ),
      "@3dena/trajectory": resolve(
        repositoryRoot,
        "packages/trajectory/src/index.ts",
      ),
    },
  },
  build: {
    target: "node20",
    outDir: outputDirectory,
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
    lib: {
      entry: resolve(
        packageDirectory,
        "src/scientific/worker-entry.ts",
      ),
      formats: ["es"],
      fileName: () => "scientific-worker-entry.mjs",
    },
    rollupOptions: {
      external: [/^node:/u],
    },
  },
});
