#!/usr/bin/env node
import { createHash } from "node:crypto";

import { validatePublicPackageArtifactReceiptV2 } from "./public-package-artifact-receipt.mjs";
import { PUBLIC_PACKAGE_RELEASE_VERSION } from "./public-package-release-contract.mjs";

export const PUBLIC_PACKAGE_CI_CUSTODY_SCHEMA_V1 =
  "3dena.public-package-ci-custody.v1";
export const PUBLIC_PACKAGE_CI_TRUSTED_REPOSITORY = "HUDongpin/j-3dENA";
export const PUBLIC_PACKAGE_CI_TRUSTED_WORKFLOW_PATH = ".github/workflows/ci.yml";
export const PUBLIC_PACKAGE_CI_TARBALL_FILENAME =
  `j-3dena-${PUBLIC_PACKAGE_RELEASE_VERSION}.tgz`;
export const PUBLIC_PACKAGE_CI_RECEIPT_FILENAME =
  `${PUBLIC_PACKAGE_CI_TARBALL_FILENAME}.artifact-receipt.json`;

const fullCommit = /^[0-9a-f]{40}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const manifestKeys = Object.freeze([
  "schemaVersion",
  "repository",
  "workflowPath",
  "sourceHead",
  "producerRunId",
  "producerRunAttempt",
  "tarball",
  "receipt",
]);
const artifactKeys = Object.freeze(["artifactId", "sha256"]);

function fail(message) {
  throw new Error(`PUBLIC_PACKAGE_CI_CUSTODY_INVALID: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value, path) {
  if (!isRecord(value)) fail(`${path} must be an object`);
  return value;
}

function exactKeys(value, expected, path) {
  const item = record(value, path);
  if (Object.keys(item).sort().join("\0") !== [...expected].sort().join("\0")) {
    fail(`${path} must contain exact fields`);
  }
  return item;
}

function positiveInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${path} must be a positive safe integer`);
  return value;
}

function exactString(value, expected, path) {
  if (value !== expected) fail(`${path} is not the trusted value`);
  return value;
}

function digest(value, path) {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    fail(`${path} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function artifactTuple(value, path) {
  const item = exactKeys(value, artifactKeys, path);
  positiveInteger(item.artifactId, `${path}.artifactId`);
  digest(item.sha256, `${path}.sha256`);
  return item;
}

export function validatePublicPackageCiCustodyV1(value) {
  const manifest = exactKeys(value, manifestKeys, "custody");
  exactString(
    manifest.schemaVersion,
    PUBLIC_PACKAGE_CI_CUSTODY_SCHEMA_V1,
    "custody.schemaVersion",
  );
  exactString(
    manifest.repository,
    PUBLIC_PACKAGE_CI_TRUSTED_REPOSITORY,
    "custody.repository",
  );
  exactString(
    manifest.workflowPath,
    PUBLIC_PACKAGE_CI_TRUSTED_WORKFLOW_PATH,
    "custody.workflowPath",
  );
  if (typeof manifest.sourceHead !== "string" || !fullCommit.test(manifest.sourceHead)) {
    fail("custody.sourceHead must be a full lowercase Git commit");
  }
  positiveInteger(manifest.producerRunId, "custody.producerRunId");
  positiveInteger(manifest.producerRunAttempt, "custody.producerRunAttempt");
  const tarball = artifactTuple(manifest.tarball, "custody.tarball");
  const receipt = artifactTuple(manifest.receipt, "custody.receipt");
  if (tarball.artifactId === receipt.artifactId) {
    fail("tarball and receipt must use distinct numeric artifact IDs");
  }
  return manifest;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function strictJson(bytes, path) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(`${path} is not strict UTF-8`);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(`${path} is not valid JSON`);
  }
}

export async function verifyLocalPublicPackageCiCustodyV1({
  manifest: value,
  tarballBytes,
  receiptBytes,
}) {
  const manifest = validatePublicPackageCiCustodyV1(value);
  if (!(tarballBytes instanceof Uint8Array) || !(receiptBytes instanceof Uint8Array)) {
    fail("tracked tarball and receipt must be byte arrays");
  }
  if (sha256(tarballBytes) !== manifest.tarball.sha256) {
    fail("tracked tarball SHA-256 differs from custody");
  }
  if (sha256(receiptBytes) !== manifest.receipt.sha256) {
    fail("tracked receipt SHA-256 differs from custody");
  }
  const receipt = validatePublicPackageArtifactReceiptV2(
    strictJson(receiptBytes, "tracked artifact receipt"),
  );
  if (
    receipt.source.repositoryHead !== manifest.sourceHead
    || receipt.package.buildId !== manifest.sourceHead
  ) {
    fail("tracked artifact receipt source differs from custody source S");
  }
  if (receipt.tarball.sha256 !== manifest.tarball.sha256) {
    fail("tracked artifact receipt tarball SHA-256 differs from custody");
  }
  return Object.freeze({
    sourceHead: manifest.sourceHead,
    producerRunId: manifest.producerRunId,
    producerRunAttempt: manifest.producerRunAttempt,
    receipt,
  });
}

function apiRecord(value, path) {
  return record(value, `GitHub API ${path}`);
}

function verifyApiArtifact({ artifact: value, tuple, role, filename, run, manifest }) {
  const artifact = apiRecord(value, `${role} artifact`);
  if (artifact.id !== tuple.artifactId) fail(`${role} artifact ID differs from custody`);
  if (artifact.name !== filename) fail(`${role} artifact name differs from its fixed role`);
  if (artifact.expired !== false) fail(`${role} artifact is expired or has no expiry proof`);
  if (artifact.digest !== `sha256:${tuple.sha256}`) {
    fail(`${role} artifact digest differs from custody SHA-256`);
  }
  const workflowRun = apiRecord(artifact.workflow_run, `${role} artifact.workflow_run`);
  if (
    workflowRun.id !== manifest.producerRunId
    || workflowRun.id !== run.id
    || workflowRun.repository_id !== run.repository.id
    || workflowRun.head_repository_id !== run.repository.id
    || workflowRun.head_sha !== manifest.sourceHead
  ) {
    fail(`${role} artifact does not belong to the exact trusted producer run`);
  }
}

export function verifyGitHubPublicPackageCiCustodyV1({
  manifest: value,
  run: runValue,
  tarballArtifact,
  receiptArtifact,
}) {
  const manifest = validatePublicPackageCiCustodyV1(value);
  const run = apiRecord(runValue, "run");
  const repository = apiRecord(run.repository, "run.repository");
  if (
    run.id !== manifest.producerRunId
    || run.run_attempt !== manifest.producerRunAttempt
    || run.status !== "completed"
    || run.conclusion !== "success"
    || !["pull_request", "push", "workflow_dispatch"].includes(run.event)
    || run.path !== manifest.workflowPath
    || run.head_sha !== manifest.sourceHead
    || repository.full_name !== manifest.repository
    || !Number.isSafeInteger(repository.id)
    || repository.id < 1
  ) {
    fail("GitHub API run is not the completed successful exact-S trusted producer");
  }
  verifyApiArtifact({
    artifact: tarballArtifact,
    tuple: manifest.tarball,
    role: "tarball",
    filename: PUBLIC_PACKAGE_CI_TARBALL_FILENAME,
    run,
    manifest,
  });
  verifyApiArtifact({
    artifact: receiptArtifact,
    tuple: manifest.receipt,
    role: "receipt",
    filename: PUBLIC_PACKAGE_CI_RECEIPT_FILENAME,
    run,
    manifest,
  });
  return Object.freeze({
    repository: manifest.repository,
    workflowPath: manifest.workflowPath,
    sourceHead: manifest.sourceHead,
    producerRunId: manifest.producerRunId,
    producerRunAttempt: manifest.producerRunAttempt,
    tarballArtifactId: manifest.tarball.artifactId,
    receiptArtifactId: manifest.receipt.artifactId,
  });
}
