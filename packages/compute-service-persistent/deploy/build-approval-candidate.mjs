#!/usr/bin/env node
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

import {
  BUILD_APPROVAL_ARTIFACT_BOUNDS_V1,
  canonical,
  MAX_PUBLIC_KEY_REGISTRY_BYTES,
  readBuildApprovalSourceFile,
  validateBuildApprovalPublicKeyRegistryBytes,
  verifyBuildApprovalInputs,
  writeNewBuildApprovalFile,
} from "./build-approval-inputs-lib.mjs";
import { parseStrictJson } from "./strict-json.mjs";

const [manifestPath, expectedManifestSha256, outputPath] = process.argv.slice(2);
if (!manifestPath || !expectedManifestSha256 || !outputPath) {
  throw new Error(
    "usage: build-approval-candidate.mjs <materialization-manifest.json> " +
      "<expected-materialization-manifest-sha256> <candidate-output.json>",
  );
}
if (!/^[a-f0-9]{64}$/u.test(expectedManifestSha256)) {
  throw new Error("expected materialization manifest SHA-256 is invalid");
}

const sourceRoot = process.cwd();
const ARTIFACT_BOUND_DESCRIPTIONS = Object.freeze({
  analysisTarball: "32 MiB analysis tarball limit",
  jenaTarball: "8 MiB Jena tarball limit",
  lockfile: "4 MiB lockfile limit",
  sbom: "16 MiB SBOM limit",
  schemaBundle: "32 MiB schema bundle limit",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value, keys, path) {
  if (!isRecord(value) ||
      Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new Error(`${path} fields are not exact`);
  }
}

function portablePath(value, path) {
  if (typeof value !== "string" || value.length < 1 || value.length > 1024 ||
      isAbsolute(value) || value.includes("\\") || value.includes("\0") ||
      value.endsWith("/") || value.split("/").some((segment) =>
        segment === "" || segment === "." || segment === "..")) {
    throw new Error(`${path} is not a portable source-root-relative path`);
  }
  return value;
}

function descriptor(value, path) {
  exact(value, ["path", "sha256"], path);
  portablePath(value.path, `${path}.path`);
  if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.sha256)) {
    throw new Error(`${path}.sha256 is invalid`);
  }
  return { path: value.path, sha256: value.sha256 };
}

async function verifiedFile(value, path, maximumBytes, maximumDescription) {
  const expected = descriptor(value, path);
  const bytes = await readBuildApprovalSourceFile(
    sourceRoot,
    expected.path,
    path,
    maximumBytes,
    maximumDescription,
  );
  const observed = createHash("sha256").update(bytes).digest("hex");
  if (observed !== expected.sha256) {
    throw new Error(`${path}.sha256 expected ${expected.sha256} but observed ${observed}`);
  }
  return { bytes, sha256: observed };
}

const manifestBytes = await readBuildApprovalSourceFile(
  sourceRoot,
  manifestPath,
  "materialization manifest",
  BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.materializationManifest,
  "4 MiB materialization manifest limit",
);
const observedManifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
if (observedManifestSha256 !== expectedManifestSha256) {
  throw new Error(
    `materialization manifest SHA-256 expected ${expectedManifestSha256} ` +
      `but observed ${observedManifestSha256}`,
  );
}
let manifest;
try {
  manifest = parseStrictJson(manifestBytes);
} catch {
  throw new Error("materialization manifest is not valid JSON");
}
const manifestRelativePath = portablePath(
  relative(await realpath(sourceRoot), await realpath(manifestPath))
    .split(sep).join("/"),
  "materialization manifest path",
);
const verifiedMaterializationOutputs = await verifyBuildApprovalInputs(
  manifest,
  manifestBytes.toString("utf8"),
  manifestRelativePath,
  sourceRoot,
);
const manifestPublicKeyRegistry = descriptor(
  manifest.input.publicKeyRegistry,
  "materialization manifest input.publicKeyRegistry",
);
const candidateInputDescriptor = descriptor(
  verifiedMaterializationOutputs.candidateInput,
  "verified materialization outputs.candidateInput",
);
const materializedSchemaBundle = descriptor(
  verifiedMaterializationOutputs.schemaBundle,
  "verified materialization outputs.schemaBundle",
);

const inputFile = await verifiedFile(
  candidateInputDescriptor,
  "candidate input",
  BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.candidateInput,
  "4 MiB candidate input limit",
);
let input;
try {
  input = parseStrictJson(inputFile.bytes);
} catch {
  throw new Error("candidate input is not valid JSON");
}
exact(input, [
  "releaseId", "environment", "gitCommit", "vercelDeploymentId", "vercelBuildId",
  "flyImageDigest", "flyBuildId", "jenaVersion", "jenaCommit", "sdkVersion", "buildId",
  "migrations", "contractVersions", "implementationActorIds", "artifacts",
  "publicKeyRegistry",
], "candidate input");
exact(input.artifacts, [
  "analysisTarball", "jenaTarball", "lockfile", "sbom", "schemaBundle",
], "candidate input.artifacts");
const candidatePublicKeyRegistry = descriptor(
  input.publicKeyRegistry,
  "candidate input.publicKeyRegistry",
);
if (canonical(candidatePublicKeyRegistry) !== canonical(manifestPublicKeyRegistry)) {
  throw new Error("candidate input public-key registry disagrees with materialization manifest");
}
if (canonical(descriptor(input.artifacts.schemaBundle, "candidate input.artifacts.schemaBundle")) !==
    canonical(materializedSchemaBundle)) {
  throw new Error("candidate schema bundle disagrees with materialization manifest");
}

if (typeof input.releaseId !== "string" ||
    (input.environment !== "preview" && input.environment !== "production") ||
    typeof input.gitCommit !== "string" || !/^[a-f0-9]{40}$/u.test(input.gitCommit) ||
    typeof input.vercelDeploymentId !== "string" ||
    typeof input.vercelBuildId !== "string" ||
    typeof input.flyImageDigest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(input.flyImageDigest) ||
    typeof input.flyBuildId !== "string" ||
    typeof input.jenaVersion !== "string" ||
    typeof input.jenaCommit !== "string" || !/^[a-f0-9]{40}$/u.test(input.jenaCommit) ||
    typeof input.sdkVersion !== "string" || typeof input.buildId !== "string" ||
    !Array.isArray(input.migrations) || input.migrations.length < 1) {
  throw new Error("candidate input is invalid");
}

const migrationManifest = [];
for (const [index, migration] of input.migrations.entries()) {
  exact(migration, ["path", "sha256", "version"], `candidate input.migrations[${index}]`);
  if (typeof migration.version !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u.test(migration.version)) {
    throw new Error(`candidate input.migrations[${index}] is invalid`);
  }
  const verified = await verifiedFile(
    { path: migration.path, sha256: migration.sha256 },
    `candidate input.migrations[${index}]`,
    BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.migration,
    "1 MiB migration limit",
  );
  migrationManifest.push({ sha256: verified.sha256, version: migration.version });
}
if (new Set(migrationManifest.map((entry) => entry.version)).size !== migrationManifest.length ||
    [...migrationManifest].sort((left, right) => left.version.localeCompare(right.version))
      .some((entry, index) => entry.version !== migrationManifest[index].version)) {
  throw new Error("candidate input.migrations must be unique and ordered");
}

const artifactBytes = {};
for (const name of [
  "analysisTarball", "jenaTarball", "lockfile", "sbom", "schemaBundle",
]) {
  artifactBytes[name] = await verifiedFile(
    input.artifacts[name],
    `candidate input.artifacts.${name}`,
    BUILD_APPROVAL_ARTIFACT_BOUNDS_V1[name],
    ARTIFACT_BOUND_DESCRIPTIONS[name],
  );
}
const publicKeyRegistry = await verifiedFile(
  candidatePublicKeyRegistry,
  "candidate input.publicKeyRegistry",
  MAX_PUBLIC_KEY_REGISTRY_BYTES,
  "128 KiB public-key registry limit",
);
validateBuildApprovalPublicKeyRegistryBytes(
  publicKeyRegistry.bytes,
  "candidate input.publicKeyRegistry",
);

const candidate = {
  version: "3dena.build-approval-candidate.v4",
  releaseId: input.releaseId,
  environment: input.environment,
  gitCommit: input.gitCommit,
  vercelDeploymentId: input.vercelDeploymentId,
  vercelBuildId: input.vercelBuildId,
  flyImageDigest: input.flyImageDigest,
  flyBuildId: input.flyBuildId,
  analysisTarballSha256: artifactBytes.analysisTarball.sha256,
  jenaVersion: input.jenaVersion,
  jenaCommit: input.jenaCommit,
  jenaTarballSha256: artifactBytes.jenaTarball.sha256,
  jenaTarballIntegrity: `sha512-${createHash("sha512")
    .update(artifactBytes.jenaTarball.bytes).digest("base64")}`,
  sdkVersion: input.sdkVersion,
  buildId: input.buildId,
  lockfileSha256: artifactBytes.lockfile.sha256,
  sbomSha256: artifactBytes.sbom.sha256,
  schemaBundleSha256: artifactBytes.schemaBundle.sha256,
  migrationManifestSha256: createHash("sha256")
    .update(JSON.stringify(migrationManifest), "utf8").digest("hex"),
  publicKeyRegistrySha256: publicKeyRegistry.sha256,
  materializationManifestSha256: observedManifestSha256,
  contractVersions: input.contractVersions,
  implementationActorIds: input.implementationActorIds,
};
const candidateCanonical = canonical(candidate, "candidate");
const receipt = {
  candidate,
  approvalManifestSha256: createHash("sha256").update(candidateCanonical, "utf8").digest("hex"),
  candidateInputSha256: inputFile.sha256,
  materializationManifestSha256: observedManifestSha256,
  publicKeyRegistrySha256: publicKeyRegistry.sha256,
};
// This CLI deliberately has no private-key input and cannot sign or activate.
await writeNewBuildApprovalFile(sourceRoot, outputPath, `${canonical(receipt)}\n`);
