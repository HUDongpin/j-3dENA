#!/usr/bin/env node
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { join, resolve } from "node:path";

const [requestedDirectory, expectedSdkVersion, expectedBuildId, expectedSourceCommit] = process.argv.slice(2);
const requiredContracts = Object.freeze([
  "3dena.compute-dataset-http.v1",
  "3dena.compute-http.v1",
  "3dena.compute-prepared-import-http.v1",
  "3dena.compute-source-result-job-http.v1",
  "3dena.contract.v1",
  "3dena.longitudinal-compute-submission.v2",
]);
const requiredMigrations = Object.freeze([
  "0001-persistent-compute",
  "0002-persistent-control-plane",
  "0003-build-approval-v3",
  "0004-scientific-result-generations",
  "0005-build-approval-v4",
]);
const requiredJena = Object.freeze({
  version: "0.7.0-ona.0",
  commit: "90790856f00bdef63dbd27fc3a5b502e8cffe65f",
  tarballIntegrity: "sha512-gBhKP9d7C3akXTPlU03AJHBs+dBBDt1TUFGx96P/pB/s0GEGGX2aZFLJGWf9HLc+wuBJIjrJn7tIGicg1WQflQ==",
});
const RUNTIME_BUNDLE_FILE_BOUNDS_V1 = Object.freeze({
  schemaVersion: "3dena.runtime-bundle-file-bounds.v1",
  runtime: 64 * 1024 * 1024,
  worker: 64 * 1024 * 1024,
  manifest: 1024 * 1024,
});

function reject(reason) {
  throw new Error(`RUNTIME_BUNDLE_REJECTED: ${reason}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readBoundBundleFile(pathname, label, maximumBytes) {
  let handle;
  try {
    handle = await open(
      pathname,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const before = await handle.stat();
    if (!before.isFile()) reject(`${label} must be a regular file`);
    if (before.size > maximumBytes) {
      reject(`${label} exceeds its ${maximumBytes}-byte limit`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.byteLength !== before.size || after.size !== before.size ||
        after.dev !== before.dev || after.ino !== before.ino ||
        after.mtimeMs !== before.mtimeMs) {
      reject(`${label} changed while it was being read`);
    }
    return bytes;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("RUNTIME_BUNDLE_REJECTED:")) {
      throw error;
    }
    reject(`${label} could not be read securely`);
  } finally {
    await handle?.close();
  }
}

function exact(value, fields, path) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\0") !== [...fields].sort().join("\0")) {
    reject(`${path} must contain exact fields`);
  }
}

function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) reject("non-finite manifest value");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!value || typeof value !== "object") reject("unsupported manifest value");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

if (!requestedDirectory || !expectedSdkVersion || !expectedBuildId || !expectedSourceCommit ||
    !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u.test(expectedSdkVersion) ||
    !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(expectedBuildId) ||
    !/^[a-f0-9]{40}$/u.test(expectedSourceCommit)) {
  reject("usage: verify-runtime-bundle.mjs <bundle-directory> <expected-sdk-version> <expected-build-id> <expected-source-commit>");
}

const directory = resolve(requestedDirectory);
const runtimeBytes = await readBoundBundleFile(
  join(directory, "compute-runtime.mjs"),
  "compute runtime bundle",
  RUNTIME_BUNDLE_FILE_BOUNDS_V1.runtime,
);
const workerBytes = await readBoundBundleFile(
  join(directory, "scientific-worker-entry.mjs"),
  "scientific worker bundle",
  RUNTIME_BUNDLE_FILE_BOUNDS_V1.worker,
);
const manifestBytes = await readBoundBundleFile(
  join(directory, "build-manifest.json"),
  "runtime build manifest",
  RUNTIME_BUNDLE_FILE_BOUNDS_V1.manifest,
);
const manifest = JSON.parse(manifestBytes.toString("utf8"));

if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
  reject("manifest must be an object");
}
if (manifest.schemaVersion !== "3dena.compute-runtime-build-manifest.v4") {
  reject("manifest must use 3dena.compute-runtime-build-manifest.v4");
}
exact(manifest, [
  "schemaVersion", "sourceCommit", "migrationManifest", "migrationManifestSha256",
  "contractVersions", "runtimeDependencies", "approvedLongitudinalBuild",
  "runtimeBundleSha256", "scientificWorkerBundleSha256",
], "manifest");
if (manifest.sourceCommit !== expectedSourceCommit) {
  reject("manifest source commit does not match the OCI source commit");
}
if (runtimeBytes.byteLength < 1 || workerBytes.byteLength < 1 ||
    manifest.runtimeBundleSha256 !== sha256(runtimeBytes) ||
    manifest.scientificWorkerBundleSha256 !== sha256(workerBytes)) {
  reject("runtime artifact digest mismatch");
}
if (!Array.isArray(manifest.contractVersions) ||
    manifest.contractVersions.length !== requiredContracts.length ||
    manifest.contractVersions.some((value, index) => value !== requiredContracts[index])) {
  reject("contract version set is not current");
}
if (!Array.isArray(manifest.migrationManifest) ||
    manifest.migrationManifest.length !== requiredMigrations.length ||
    manifest.migrationManifest.some((entry, index) =>
      !entry || typeof entry !== "object" || Array.isArray(entry) ||
      Object.keys(entry).sort().join("\0") !== ["sha256", "version"].sort().join("\0") ||
      entry.version !== requiredMigrations[index] ||
      typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(entry.sha256))) {
  reject("migration manifest is not current");
}
if (manifest.migrationManifestSha256 !==
    sha256(Buffer.from(canonical(manifest.migrationManifest), "utf8"))) {
  reject("migration manifest digest mismatch");
}
exact(manifest.runtimeDependencies, ["@vercel/blob", "pg"], "manifest.runtimeDependencies");
if (manifest.runtimeDependencies["@vercel/blob"] !== "2.8.0" ||
    manifest.runtimeDependencies?.pg !== "8.22.0") {
  reject("runtime dependency pins are not current");
}
exact(manifest.approvedLongitudinalBuild, [
  "jenaVersion", "jenaCommit", "jenaTarballIntegrity", "sdkVersion", "buildId",
], "manifest.approvedLongitudinalBuild");
if (
    manifest.approvedLongitudinalBuild.sdkVersion !== expectedSdkVersion ||
    manifest.approvedLongitudinalBuild.buildId !== expectedBuildId ||
    manifest.approvedLongitudinalBuild.jenaVersion !== requiredJena.version ||
    manifest.approvedLongitudinalBuild.jenaCommit !== requiredJena.commit ||
    manifest.approvedLongitudinalBuild.jenaTarballIntegrity !== requiredJena.tarballIntegrity ||
    typeof manifest.approvedLongitudinalBuild.buildId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(manifest.approvedLongitudinalBuild.buildId)) {
  reject("approved longitudinal build identity is not current");
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: manifest.schemaVersion,
  sourceCommit: manifest.sourceCommit,
  sdkVersion: manifest.approvedLongitudinalBuild.sdkVersion,
  runtimeBundleSha256: manifest.runtimeBundleSha256,
  scientificWorkerBundleSha256: manifest.scientificWorkerBundleSha256,
})}\n`);
