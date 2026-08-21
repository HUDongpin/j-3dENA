#!/usr/bin/env node
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";

const [inputPath, requestedOutputDirectory] = process.argv.slice(2);
if (!inputPath || !requestedOutputDirectory) {
  throw new Error("usage: build-runtime.mjs <explicit-input.json> <new-output-directory>");
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(packageDirectory, "../..");
const REQUIRED_CONTRACT_VERSIONS = Object.freeze([
  "3dena.compute-dataset-http.v1",
  "3dena.compute-http.v1",
  "3dena.compute-source-result-job-http.v1",
  "3dena.contract.v1",
]);
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);
const outputDirectory = resolve(requestedOutputDirectory);
if (outputDirectory === repositoryRoot || !outputDirectory.startsWith(`${repositoryRoot}/output/`)) {
  throw new Error("RUNTIME_BUILD_FAILED: output must be a new directory under repository output/");
}

function exact(value, keys, path) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new Error(`${path} fields are not exact`);
  }
}

function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite build input");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const input = JSON.parse(await readFile(resolve(inputPath), "utf8"));
exact(input, ["schemaVersion", "migrationPath", "migrationVersion", "contractVersions"], "input");
if (input.schemaVersion !== "3dena.compute-runtime-build-input.v1" ||
    !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u.test(input.migrationVersion) ||
    !Array.isArray(input.contractVersions) || input.contractVersions.length < 1 ||
    input.contractVersions.some((value) => typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u.test(value)) ||
    new Set(input.contractVersions).size !== input.contractVersions.length ||
    [...input.contractVersions].sort().some((value, index) => value !== input.contractVersions[index]) ||
    input.contractVersions.length !== REQUIRED_CONTRACT_VERSIONS.length ||
    input.contractVersions.some((value, index) => value !== REQUIRED_CONTRACT_VERSIONS[index])) {
  throw new Error("runtime build input is invalid");
}

const packageManifest = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));
if (packageManifest.dependencies?.pg !== "8.22.0" ||
    packageManifest.dependencies?.["@vercel/blob"] !== "2.8.0") {
  throw new Error("reviewed runtime dependency pins are missing");
}
const migrationBytes = await readFile(resolve(input.migrationPath));
const temporaryRoot = await mkdtemp(join(tmpdir(), "3dena-compute-runtime-"));

const aliases = {
  "@3dena/analysis": resolve(repositoryRoot, "packages/analysis/src/index.ts"),
  "@3dena/compute-service-core": resolve(repositoryRoot, "packages/compute-service-core/src/index.ts"),
  "@3dena/compute-service-http": resolve(repositoryRoot, "packages/compute-service-http/src/index.ts"),
  "@3dena/compute-service-node": resolve(repositoryRoot, "packages/compute-service-node/src/index.ts"),
  "@3dena/dataset-workflow": resolve(repositoryRoot, "packages/dataset-workflow/src/index.ts"),
  "@3dena/export": resolve(repositoryRoot, "packages/export/src/index.ts"),
  "@3dena/io": resolve(repositoryRoot, "packages/io/src/index.ts"),
  "@3dena/stats": resolve(repositoryRoot, "packages/stats/src/index.ts"),
  "@3dena/tabular-import": resolve(repositoryRoot, "packages/tabular-import/src/index.ts"),
  "@3dena/trajectory": resolve(repositoryRoot, "packages/trajectory/src/index.ts"),
};

async function bundle(entry, fileName, outDir) {
  await build({
    appType: "custom",
    configFile: false,
    root: repositoryRoot,
    logLevel: "warn",
    resolve: { alias: aliases, conditions: ["node", "import", "default"] },
    ssr: { noExternal: true, target: "node" },
    build: {
      target: "node20",
      ssr: entry,
      outDir,
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      rollupOptions: {
        external: (identifier) => NODE_BUILTINS.has(identifier),
        output: { entryFileNames: fileName, inlineDynamicImports: true },
      },
    },
  });
}

try {
  const runtimeDirectory = join(temporaryRoot, "runtime");
  const workerDirectory = join(temporaryRoot, "worker");
  await bundle(
    resolve(packageDirectory, "src/runtime-entry.ts"),
    "compute-runtime.mjs",
    runtimeDirectory,
  );
  await bundle(
    resolve(repositoryRoot, "packages/compute-service-node/src/scientific/worker-entry.ts"),
    "scientific-worker-entry.mjs",
    workerDirectory,
  );
  const runtimePath = join(runtimeDirectory, "compute-runtime.mjs");
  const workerPath = join(workerDirectory, "scientific-worker-entry.mjs");
  const runtimeBytes = await readFile(runtimePath);
  const workerBytes = await readFile(workerPath);
  if (runtimeBytes.byteLength < 1 || workerBytes.byteLength < 1) {
    throw new Error("runtime bundle is empty");
  }
  const manifest = {
    schemaVersion: "3dena.compute-runtime-build-manifest.v1",
    migrationVersion: input.migrationVersion,
    migrationSha256: sha256(migrationBytes),
    contractVersions: input.contractVersions,
    runtimeDependencies: { "@vercel/blob": "2.8.0", pg: "8.22.0" },
    runtimeBundleSha256: sha256(runtimeBytes),
    scientificWorkerBundleSha256: sha256(workerBytes),
  };
  await mkdir(outputDirectory, { recursive: false });
  await copyFile(
    runtimePath,
    join(outputDirectory, "compute-runtime.mjs"),
    fsConstants.COPYFILE_EXCL,
  );
  await copyFile(
    workerPath,
    join(outputDirectory, "scientific-worker-entry.mjs"),
    fsConstants.COPYFILE_EXCL,
  );
  await writeFile(join(outputDirectory, "build-manifest.json"), `${canonical(manifest)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
