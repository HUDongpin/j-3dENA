#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("usage: build-approval-candidate.mjs <explicit-input.json> <candidate-output.json>");
}

function canonical(value, path = "value") {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number`);
    return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry, index) => canonical(entry, `${path}[${index}]`)).join(",")}]`;
  }
  if (!value || typeof value !== "object") throw new Error(`${path} is not canonical JSON`);
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => {
    if (value[key] === undefined) throw new Error(`${path}.${key} is undefined`);
    return `${JSON.stringify(key)}:${canonical(value[key], `${path}.${key}`)}`;
  }).join(",")}}`;
}

function exact(value, keys, path) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new Error(`${path} fields are not exact`);
  }
}

async function fileSha256(pathname) {
  const bytes = await readFile(resolve(pathname));
  return createHash("sha256").update(bytes).digest("hex");
}

const input = JSON.parse(await readFile(resolve(inputPath), "utf8"));
exact(input, [
  "releaseId", "environment", "gitCommit", "vercelDeploymentId", "vercelBuildId",
  "flyImageDigest", "flyBuildId", "jenaVersion", "jenaCommit", "sdkVersion", "buildId", "migrations",
  "contractVersions", "implementationActorIds", "artifacts",
], "input");
exact(input.artifacts, [
  "analysisTarball", "jenaTarball", "lockfile", "sbom", "schemaBundle",
], "input.artifacts");

if (!Array.isArray(input.migrations) || input.migrations.length < 1) {
  throw new Error("input.migrations is invalid");
}
const migrationManifest = [];
for (const [index, migration] of input.migrations.entries()) {
  exact(migration, ["path", "version"], `input.migrations[${index}]`);
  if (typeof migration.path !== "string" || migration.path.trim() === "" ||
      typeof migration.version !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u.test(migration.version)) {
    throw new Error(`input.migrations[${index}] is invalid`);
  }
  migrationManifest.push({
    sha256: await fileSha256(migration.path),
    version: migration.version,
  });
}
if (new Set(migrationManifest.map((entry) => entry.version)).size !== migrationManifest.length ||
    [...migrationManifest].sort((left, right) => left.version.localeCompare(right.version))
      .some((entry, index) => entry.version !== migrationManifest[index].version)) {
  throw new Error("input.migrations must be unique and ordered");
}

const candidate = {
  version: "3dena.build-approval-candidate.v3",
  releaseId: input.releaseId,
  environment: input.environment,
  gitCommit: input.gitCommit,
  vercelDeploymentId: input.vercelDeploymentId,
  vercelBuildId: input.vercelBuildId,
  flyImageDigest: input.flyImageDigest,
  flyBuildId: input.flyBuildId,
  analysisTarballSha256: await fileSha256(input.artifacts.analysisTarball),
  jenaVersion: input.jenaVersion,
  jenaCommit: input.jenaCommit,
  jenaTarballSha256: await fileSha256(input.artifacts.jenaTarball),
  jenaTarballIntegrity: `sha512-${createHash("sha512")
    .update(await readFile(resolve(input.artifacts.jenaTarball))).digest("base64")}`,
  sdkVersion: input.sdkVersion,
  buildId: input.buildId,
  lockfileSha256: await fileSha256(input.artifacts.lockfile),
  sbomSha256: await fileSha256(input.artifacts.sbom),
  schemaBundleSha256: await fileSha256(input.artifacts.schemaBundle),
  migrationManifestSha256: createHash("sha256")
    .update(JSON.stringify(migrationManifest), "utf8").digest("hex"),
  contractVersions: input.contractVersions,
  implementationActorIds: input.implementationActorIds,
};
const candidateCanonical = canonical(candidate, "candidate");
const receipt = {
  candidate,
  approvalManifestSha256: createHash("sha256").update(candidateCanonical, "utf8").digest("hex"),
};
// This CLI deliberately has no private-key input and cannot sign or activate.
await writeFile(resolve(outputPath), `${canonical(receipt)}\n`, { encoding: "utf8", flag: "wx" });
