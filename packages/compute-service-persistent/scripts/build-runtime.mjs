#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
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
  "3dena.compute-prepared-import-http.v1",
  "3dena.compute-source-result-job-http.v1",
  "3dena.contract.v1",
  "3dena.longitudinal-compute-submission.v2",
]);
const REQUIRED_JENA_VERSION = "0.7.0-ona.0";
const REQUIRED_JENA_COMMIT = "90790856f00bdef63dbd27fc3a5b502e8cffe65f";
const REQUIRED_JENA_TARBALL_INTEGRITY = "sha512-gBhKP9d7C3akXTPlU03AJHBs+dBBDt1TUFGx96P/pB/s0GEGGX2aZFLJGWf9HLc+wuBJIjrJn7tIGicg1WQflQ==";
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);
const outputDirectory = resolve(requestedOutputDirectory);
if (outputDirectory === repositoryRoot || !outputDirectory.startsWith(`${repositoryRoot}/output/`)) {
  throw new Error("RUNTIME_BUILD_FAILED: output must be a new directory under repository output/");
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
  } catch {
    throw new Error("RUNTIME_BUILD_FAILED: exact Git source identity is unavailable");
  }
}

const sourceCommit = git(["rev-parse", "HEAD"]);
if (!/^[a-f0-9]{40}$/u.test(sourceCommit)) {
  throw new Error("RUNTIME_BUILD_FAILED: source commit must be a full lowercase Git SHA");
}

function assertExactCleanSource(expectedCommit) {
  if (git(["rev-parse", "HEAD"]) !== expectedCommit) {
    throw new Error("RUNTIME_BUILD_FAILED: source commit changed during runtime bundling");
  }
  if (git(["status", "--porcelain=v1", "--untracked-files=all"]) !== "") {
    throw new Error("RUNTIME_BUILD_FAILED: refusing to build a runtime bundle from a dirty worktree");
  }
}
assertExactCleanSource(sourceCommit);

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
exact(input, ["schemaVersion", "migrations", "contractVersions", "approvedLongitudinalBuild"], "input");
exact(input.approvedLongitudinalBuild, [
  "jenaVersion", "jenaCommit", "jenaTarballIntegrity", "sdkVersion", "buildId",
], "input.approvedLongitudinalBuild");
if (input.schemaVersion !== "3dena.compute-runtime-build-input.v4" ||
    !Array.isArray(input.migrations) || input.migrations.length < 1 ||
    !Array.isArray(input.contractVersions) || input.contractVersions.length < 1 ||
    input.contractVersions.some((value) => typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u.test(value)) ||
    new Set(input.contractVersions).size !== input.contractVersions.length ||
    [...input.contractVersions].sort().some((value, index) => value !== input.contractVersions[index]) ||
    input.contractVersions.length !== REQUIRED_CONTRACT_VERSIONS.length ||
    input.contractVersions.some((value, index) => value !== REQUIRED_CONTRACT_VERSIONS[index]) ||
    input.approvedLongitudinalBuild.jenaVersion !== REQUIRED_JENA_VERSION ||
    input.approvedLongitudinalBuild.jenaCommit !== REQUIRED_JENA_COMMIT ||
    input.approvedLongitudinalBuild.jenaTarballIntegrity !== REQUIRED_JENA_TARBALL_INTEGRITY ||
    typeof input.approvedLongitudinalBuild.sdkVersion !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u.test(input.approvedLongitudinalBuild.sdkVersion) ||
    typeof input.approvedLongitudinalBuild.buildId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(input.approvedLongitudinalBuild.buildId)) {
  throw new Error("runtime build input is invalid");
}
const migrationManifest = [];
for (const [index, migration] of input.migrations.entries()) {
  exact(migration, ["path", "version"], `input.migrations[${index}]`);
  if (typeof migration.path !== "string" || migration.path.trim() === "" ||
      typeof migration.version !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u.test(migration.version)) {
    throw new Error("runtime build input is invalid");
  }
  migrationManifest.push({
    sha256: sha256(await readFile(resolve(migration.path))),
    version: migration.version,
  });
}
if (new Set(migrationManifest.map((entry) => entry.version)).size !== migrationManifest.length ||
    [...migrationManifest].sort((left, right) => left.version.localeCompare(right.version))
      .some((entry, index) => entry.version !== migrationManifest[index].version)) {
  throw new Error("runtime build input is invalid");
}

const packageManifest = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));
if (packageManifest.dependencies?.pg !== "8.22.0" ||
    packageManifest.dependencies?.["@vercel/blob"] !== "2.8.0") {
  throw new Error("reviewed runtime dependency pins are missing");
}
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

async function bundle(entry, fileName, outDir, define = {}) {
  await build({
    appType: "custom",
    configFile: false,
    root: repositoryRoot,
    logLevel: "warn",
    define,
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
  const scientificBuildDefines = {
    __THREEDENA_JENA_VERSION__: JSON.stringify(
      input.approvedLongitudinalBuild.jenaVersion,
    ),
    __THREEDENA_JENA_COMMIT__: JSON.stringify(
      input.approvedLongitudinalBuild.jenaCommit,
    ),
    __THREEDENA_JENA_TARBALL_INTEGRITY__: JSON.stringify(
      input.approvedLongitudinalBuild.jenaTarballIntegrity,
    ),
    __THREEDENA_SDK_VERSION__: JSON.stringify(
      input.approvedLongitudinalBuild.sdkVersion,
    ),
    __THREEDENA_BUILD_ID__: JSON.stringify(
      input.approvedLongitudinalBuild.buildId,
    ),
  };
  await bundle(
    resolve(packageDirectory, "src/runtime-entry.ts"),
    "compute-runtime.mjs",
    runtimeDirectory,
    scientificBuildDefines,
  );
  await bundle(
    resolve(repositoryRoot, "packages/compute-service-node/src/scientific/worker-entry.ts"),
    "scientific-worker-entry.mjs",
    workerDirectory,
    scientificBuildDefines,
  );
  const runtimePath = join(runtimeDirectory, "compute-runtime.mjs");
  const workerPath = join(workerDirectory, "scientific-worker-entry.mjs");
  const runtimeBytes = await readFile(runtimePath);
  const workerBytes = await readFile(workerPath);
  if (runtimeBytes.byteLength < 1 || workerBytes.byteLength < 1) {
    throw new Error("runtime bundle is empty");
  }
  assertExactCleanSource(sourceCommit);
  const manifest = {
    schemaVersion: "3dena.compute-runtime-build-manifest.v4",
    sourceCommit,
    migrationManifest,
    migrationManifestSha256: sha256(Buffer.from(canonical(migrationManifest), "utf8")),
    contractVersions: input.contractVersions,
    runtimeDependencies: { "@vercel/blob": "2.8.0", pg: "8.22.0" },
    approvedLongitudinalBuild: input.approvedLongitudinalBuild,
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
