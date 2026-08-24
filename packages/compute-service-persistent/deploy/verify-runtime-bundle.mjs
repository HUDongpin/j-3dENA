#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const [requestedDirectory, expectedSdkVersion] = process.argv.slice(2);
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

function reject(reason) {
  throw new Error(`RUNTIME_BUNDLE_REJECTED: ${reason}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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

if (!requestedDirectory || !expectedSdkVersion ||
    !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u.test(expectedSdkVersion)) {
  reject("usage: verify-runtime-bundle.mjs <bundle-directory> <expected-sdk-version>");
}

const directory = resolve(requestedDirectory);
const runtimeBytes = await readFile(join(directory, "compute-runtime.mjs"));
const workerBytes = await readFile(join(directory, "scientific-worker-entry.mjs"));
const manifest = JSON.parse(await readFile(join(directory, "build-manifest.json"), "utf8"));

if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) ||
    manifest.schemaVersion !== "3dena.compute-runtime-build-manifest.v3") {
  reject("manifest must use 3dena.compute-runtime-build-manifest.v3");
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
      entry.version !== requiredMigrations[index] ||
      typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(entry.sha256))) {
  reject("migration manifest is not current");
}
if (manifest.migrationManifestSha256 !==
    sha256(Buffer.from(canonical(manifest.migrationManifest), "utf8"))) {
  reject("migration manifest digest mismatch");
}
if (manifest.runtimeDependencies?.["@vercel/blob"] !== "2.8.0" ||
    manifest.runtimeDependencies?.pg !== "8.22.0") {
  reject("runtime dependency pins are not current");
}
if (!manifest.approvedLongitudinalBuild ||
    manifest.approvedLongitudinalBuild.sdkVersion !== expectedSdkVersion ||
    manifest.approvedLongitudinalBuild.jenaVersion !== "0.7.0-ona.0" ||
    typeof manifest.approvedLongitudinalBuild.jenaCommit !== "string" ||
    !/^[a-f0-9]{40}$/u.test(manifest.approvedLongitudinalBuild.jenaCommit) ||
    typeof manifest.approvedLongitudinalBuild.jenaTarballIntegrity !== "string" ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(manifest.approvedLongitudinalBuild.jenaTarballIntegrity) ||
    typeof manifest.approvedLongitudinalBuild.buildId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(manifest.approvedLongitudinalBuild.buildId)) {
  reject("approved longitudinal build identity is not current");
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: manifest.schemaVersion,
  sdkVersion: manifest.approvedLongitudinalBuild.sdkVersion,
  runtimeBundleSha256: manifest.runtimeBundleSha256,
  scientificWorkerBundleSha256: manifest.scientificWorkerBundleSha256,
})}\n`);
