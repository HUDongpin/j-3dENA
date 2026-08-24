#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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
]);
const requiredJena = Object.freeze({
  version: "0.7.0-ona.0",
  commit: "90790856f00bdef63dbd27fc3a5b502e8cffe65f",
  tarballIntegrity: "sha512-gBhKP9d7C3akXTPlU03AJHBs+dBBDt1TUFGx96P/pB/s0GEGGX2aZFLJGWf9HLc+wuBJIjrJn7tIGicg1WQflQ==",
});

function reject(reason) {
  throw new Error(`RUNTIME_BUNDLE_REJECTED: ${reason}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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
const runtimeBytes = await readFile(join(directory, "compute-runtime.mjs"));
const workerBytes = await readFile(join(directory, "scientific-worker-entry.mjs"));
const manifest = JSON.parse(await readFile(join(directory, "build-manifest.json"), "utf8"));

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
