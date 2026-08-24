import { mkdir, rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(packageDirectory, "../..");
const outputDirectory = resolve(packageDirectory, "dist");
const execFileAsync = promisify(execFile);

if (dirname(outputDirectory) !== packageDirectory) {
  throw new Error("SCIENTIFIC_WORKER_BUILD_FAILED: unsafe output directory");
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
const analysisManifest = JSON.parse(await readFile(resolve(repositoryRoot, "packages/analysis/package.json"), "utf8"));
const jenaReceipt = JSON.parse(await readFile(resolve(repositoryRoot, "vendor/jena-js/RECEIPT.json"), "utf8"));
if (
  jenaReceipt.schemaVersion !== "3dena.jena-artifact-receipt.v1"
  || jenaReceipt.package !== "jena-js"
  || jenaReceipt.version !== analysisManifest.peerDependencies?.["jena-js"]
  || !/^[a-f0-9]{40}$/u.test(jenaReceipt.officialCommit)
  || typeof jenaReceipt.tarballIntegrity !== "string"
) throw new Error("SCIENTIFIC_WORKER_BUILD_FAILED: invalid vendored jENA receipt");
const repositoryHead = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot })).stdout.trim();
const dirty = (await execFileAsync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: repositoryRoot })).stdout.trim() !== "";
const scientificBuildId = process.env.THREEDENA_PACKAGE_BUILD_ID
  ?? `${repositoryHead}${dirty ? "-dirty" : ""}`;
const productionIdentity = process.env.NODE_ENV === "production";
await build({
  configFile: false,
  root: repositoryRoot,
  logLevel: "warn",
  resolve: {
    alias: {
      "@3dena/analysis": resolve(repositoryRoot, "packages/analysis/src/index.ts"),
      "@3dena/compute-service-http": resolve(repositoryRoot, "packages/compute-service-http/src/index.ts"),
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
  define: productionIdentity ? {
    __THREEDENA_JENA_VERSION__: JSON.stringify(jenaReceipt.version),
    __THREEDENA_JENA_COMMIT__: JSON.stringify(jenaReceipt.officialCommit),
    __THREEDENA_JENA_TARBALL_INTEGRITY__: JSON.stringify(jenaReceipt.tarballIntegrity),
    __THREEDENA_SDK_VERSION__: JSON.stringify(analysisManifest.version),
    __THREEDENA_BUILD_ID__: JSON.stringify(scientificBuildId),
  } : {},
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
