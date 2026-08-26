#!/usr/bin/env node

import { createHash, createPublicKey, verify } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  MIGRATION_ADVISORY_LOCK_KEY,
  migrationManifestSha256,
} from "./migrate.mjs";
import {
  canonicalOperatorCustodyRoot,
  portableOperatorPath,
  readOperatorCustodiedFile,
} from "./operator-path-custody.mjs";
import { parseStrictJson } from "./strict-json.mjs";

export { operatorReadSnapshotIsStable } from "./operator-path-custody.mjs";

const INPUT_VERSION = "3dena.build-approval-operator.v1";
const RESULT_VERSION = "3dena.build-approval-operator-result.v1";
const CANDIDATE_VERSION = "3dena.build-approval-candidate.v4";
const APPROVAL_VERSION = "3dena.build-approval.v4";
const MAX_INPUT_BYTES = 16 * 1024;
const MAX_MIGRATION_CONFIG_BYTES = 64 * 1024;
const MAX_MIGRATION_BYTES = 1024 * 1024;
const MAX_APPROVAL_BYTES = 64 * 1024;
const MAX_PUBLIC_KEYS_BYTES = 128 * 1024;
const MAX_CANONICAL_SIGNATURE_PAYLOAD_BYTES = 256 * 1024;
const MAXIMUM_TRANSACTION_ATTEMPTS = 3;
const RETRYABLE_TRANSACTION_CODES = new Set(["40001", "40P01"]);
const LOWER_SHA256 = /^[a-f0-9]{64}$/u;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const TARBALL_INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const INPUT_KEYS = [
  "schemaVersion",
  "operation",
  "environment",
  "migrationConfigPath",
  "migrationConfigSha256",
  "signedApprovalPath",
  "signedApprovalSha256",
  "publicKeysPath",
  "publicKeysSha256",
];
const EXPECTED_INPUT_DIGEST_KEYS = [
  "expectedConfigSha256",
  "expectedSignedApprovalSha256",
  "expectedPublicKeyRegistrySha256",
];
const APPROVAL_KEYS = [
  "version",
  "candidate",
  "approvalManifestSha256",
  "reviewerId",
  "approvedAt",
  "publicKeyId",
  "signatureAlgorithm",
  "signatureBase64",
];
const PUBLIC_KEY_ENTRY_KEYS = [
  "algorithm",
  "allowedEnvironments",
  "publicKeyPem",
  "reviewerId",
  "role",
];
const INDEPENDENT_REVIEWER_SIGNATURE_INPUT_KEYS = [
  "canonicalPayloadBytes",
  "signatureBase64",
  "publicKeyId",
  "reviewerId",
  "environment",
  "implementationActorIds",
  "publicKeyRegistryBytes",
  "expectedPublicKeyRegistrySha256",
];
const CANDIDATE_KEYS = [
  "version",
  "releaseId",
  "environment",
  "gitCommit",
  "vercelDeploymentId",
  "vercelBuildId",
  "flyImageDigest",
  "flyBuildId",
  "analysisTarballSha256",
  "jenaVersion",
  "jenaCommit",
  "jenaTarballSha256",
  "jenaTarballIntegrity",
  "sdkVersion",
  "buildId",
  "lockfileSha256",
  "sbomSha256",
  "schemaBundleSha256",
  "migrationManifestSha256",
  "publicKeyRegistrySha256",
  "materializationManifestSha256",
  "contractVersions",
  "implementationActorIds",
];

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value, fields) {
  return isRecord(value) &&
    Object.keys(value).sort().join("\0") === [...fields].sort().join("\0");
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}


function validTimestamp(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value));
}

function validUniqueSorted(value, pattern) {
  return Array.isArray(value) && value.length > 0 &&
    value.every((entry) => typeof entry === "string" && pattern.test(entry)) &&
    new Set(value).size === value.length &&
    [...value].sort().every((entry, index) => entry === value[index]);
}

function validAllowedEnvironments(value) {
  return Array.isArray(value) && value.length > 0 &&
    value.every((entry) => entry === "preview" || entry === "production") &&
    new Set(value).size === value.length &&
    [...value].sort().every((entry, index) => entry === value[index]);
}

function canonicalSignature(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{86}==$/u.test(value)) return undefined;
  const bytes = Buffer.from(value, "base64");
  return bytes.byteLength === 64 && bytes.toString("base64") === value ? bytes : undefined;
}

function validCandidate(value) {
  return exact(value, CANDIDATE_KEYS) && value.version === CANDIDATE_VERSION &&
    typeof value.releaseId === "string" && OPAQUE_ID.test(value.releaseId) &&
    (value.environment === "preview" || value.environment === "production") &&
    typeof value.gitCommit === "string" && COMMIT.test(value.gitCommit) &&
    typeof value.vercelDeploymentId === "string" && OPAQUE_ID.test(value.vercelDeploymentId) &&
    typeof value.vercelBuildId === "string" && OPAQUE_ID.test(value.vercelBuildId) &&
    typeof value.flyImageDigest === "string" && IMAGE_DIGEST.test(value.flyImageDigest) &&
    typeof value.flyBuildId === "string" && OPAQUE_ID.test(value.flyBuildId) &&
    typeof value.analysisTarballSha256 === "string" && LOWER_SHA256.test(value.analysisTarballSha256) &&
    typeof value.jenaVersion === "string" && VERSION.test(value.jenaVersion) &&
    typeof value.jenaCommit === "string" && COMMIT.test(value.jenaCommit) &&
    typeof value.jenaTarballSha256 === "string" && LOWER_SHA256.test(value.jenaTarballSha256) &&
    typeof value.jenaTarballIntegrity === "string" && TARBALL_INTEGRITY.test(value.jenaTarballIntegrity) &&
    typeof value.sdkVersion === "string" && VERSION.test(value.sdkVersion) &&
    typeof value.buildId === "string" && OPAQUE_ID.test(value.buildId) &&
    typeof value.lockfileSha256 === "string" && LOWER_SHA256.test(value.lockfileSha256) &&
    typeof value.sbomSha256 === "string" && LOWER_SHA256.test(value.sbomSha256) &&
    typeof value.schemaBundleSha256 === "string" && LOWER_SHA256.test(value.schemaBundleSha256) &&
    typeof value.migrationManifestSha256 === "string" && LOWER_SHA256.test(value.migrationManifestSha256) &&
    typeof value.publicKeyRegistrySha256 === "string" && LOWER_SHA256.test(value.publicKeyRegistrySha256) &&
    typeof value.materializationManifestSha256 === "string" &&
      LOWER_SHA256.test(value.materializationManifestSha256) &&
    validUniqueSorted(value.contractVersions, VERSION) &&
    validUniqueSorted(value.implementationActorIds, OPAQUE_ID);
}

function assertSignedApproval(
  value,
  environment,
  migrationManifestSha256,
  publicKeys,
) {
  if (!exact(value, APPROVAL_KEYS) || value.version !== APPROVAL_VERSION ||
      !validCandidate(value.candidate) || value.candidate.environment !== environment ||
      value.candidate.migrationManifestSha256 !== migrationManifestSha256 ||
      typeof value.approvalManifestSha256 !== "string" ||
        !LOWER_SHA256.test(value.approvalManifestSha256) ||
      sha256(canonical(value.candidate)) !== value.approvalManifestSha256 ||
      typeof value.reviewerId !== "string" || !OPAQUE_ID.test(value.reviewerId) ||
      value.candidate.implementationActorIds.includes(value.reviewerId) ||
      !validTimestamp(value.approvedAt) ||
      typeof value.publicKeyId !== "string" || !OPAQUE_ID.test(value.publicKeyId) ||
      value.signatureAlgorithm !== "Ed25519" ||
      canonicalSignature(value.signatureBase64) === undefined) {
    fail("signed build approval is invalid");
  }
  const registryEntry = publicKeys.get(value.publicKeyId);
  if (registryEntry === undefined || registryEntry.algorithm !== value.signatureAlgorithm ||
      registryEntry.reviewerId !== value.reviewerId ||
      registryEntry.role !== "independent-reviewer" ||
      !registryEntry.allowedEnvironments.includes(environment)) {
    fail("signed build approval is invalid");
  }
  const { signatureBase64: _signatureBase64, ...approvalEnvelope } = value;
  let valid = false;
  try {
    valid = verify(
      null,
      Buffer.from(canonical(approvalEnvelope), "utf8"),
      createPublicKey(registryEntry.publicKeyPem),
      Buffer.from(value.signatureBase64, "base64"),
    );
  } catch {
    fail("signed build approval is invalid");
  }
  if (!valid) fail("signed build approval is invalid");
}

function parsePublicKeys(bytes) {
  let text;
  let value;
  try {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 2 ||
        bytes.byteLength > MAX_PUBLIC_KEYS_BYTES) {
      fail("build approval public-key registry is invalid");
    }
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = parseStrictJson(text);
    if (text !== `${canonical(value)}\n`) {
      fail("build approval public-key registry is invalid");
    }
  } catch {
    fail("build approval public-key registry is invalid");
  }
  if (!isRecord(value) || Object.keys(value).length < 1 ||
      Object.entries(value).some(([id, entry]) =>
        !OPAQUE_ID.test(id) || !exact(entry, PUBLIC_KEY_ENTRY_KEYS) ||
        entry.algorithm !== "Ed25519" ||
        !validAllowedEnvironments(entry.allowedEnvironments) ||
        typeof entry.publicKeyPem !== "string" ||
        typeof entry.reviewerId !== "string" || !OPAQUE_ID.test(entry.reviewerId) ||
        entry.role !== "independent-reviewer")) {
    fail("build approval public-key registry is invalid");
  }
  const entries = [];
  try {
    for (const [id, entry] of Object.entries(value)) {
      const publicKey = createPublicKey(entry.publicKeyPem);
      if (publicKey.asymmetricKeyType !== "ed25519" ||
          publicKey.export({ type: "spki", format: "pem" }) !== entry.publicKeyPem) {
        fail("build approval public-key registry is invalid");
      }
      entries.push([id, Object.freeze({
        algorithm: entry.algorithm,
        allowedEnvironments: Object.freeze([...entry.allowedEnvironments]),
        publicKeyPem: entry.publicKeyPem,
        reviewerId: entry.reviewerId,
        role: entry.role,
      })]);
    }
  } catch {
    fail("build approval public-key registry is invalid");
  }
  return Object.freeze({
    publicKeys: new Map(entries),
    sha256: sha256(bytes),
  });
}

function parseBoundedJsonBytes(bytes, maximumBytes, errorMessage) {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 2 ||
        bytes.byteLength > maximumBytes) {
      fail(errorMessage);
    }
    return parseStrictJson(bytes);
  } catch {
    fail(errorMessage);
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

export function verifyBuildApprovalBundle(
  signedApprovalBytes,
  publicKeyRegistryBytes,
  expectedPublicKeyRegistrySha256,
) {
  if (typeof expectedPublicKeyRegistrySha256 !== "string" ||
      !LOWER_SHA256.test(expectedPublicKeyRegistrySha256)) {
    fail("signed build approval is invalid");
  }
  const approval = parseBoundedJsonBytes(
    signedApprovalBytes,
    MAX_APPROVAL_BYTES,
    "signed build approval is invalid",
  );
  const publicKeyRegistry = parsePublicKeys(publicKeyRegistryBytes);
  assertSignedApproval(
    approval,
    approval?.candidate?.environment,
    approval?.candidate?.migrationManifestSha256,
    publicKeyRegistry.publicKeys,
  );
  if (publicKeyRegistry.sha256 !== expectedPublicKeyRegistrySha256 ||
      approval.candidate.publicKeyRegistrySha256 !== expectedPublicKeyRegistrySha256) {
    fail("signed build approval is invalid");
  }
  const registryEntry = publicKeyRegistry.publicKeys.get(approval.publicKeyId);
  if (registryEntry === undefined) fail("signed build approval is invalid");
  return deepFreeze({
    schemaVersion: "3dena.build-approval-verification.v1",
    approval: structuredClone(approval),
    publicKeyRegistry: {
      sha256: publicKeyRegistry.sha256,
      publicKeyId: approval.publicKeyId,
      algorithm: registryEntry.algorithm,
      allowedEnvironments: [...registryEntry.allowedEnvironments],
      reviewerId: registryEntry.reviewerId,
      role: registryEntry.role,
    },
    verified: true,
  });
}

export function verifyIndependentReviewerSignature(input) {
  if (!exact(input, INDEPENDENT_REVIEWER_SIGNATURE_INPUT_KEYS) ||
      !(input.canonicalPayloadBytes instanceof Uint8Array) ||
      input.canonicalPayloadBytes.byteLength < 2 ||
      input.canonicalPayloadBytes.byteLength > MAX_CANONICAL_SIGNATURE_PAYLOAD_BYTES ||
      typeof input.signatureBase64 !== "string" ||
      typeof input.publicKeyId !== "string" || !OPAQUE_ID.test(input.publicKeyId) ||
      typeof input.reviewerId !== "string" || !OPAQUE_ID.test(input.reviewerId) ||
      (input.environment !== "preview" && input.environment !== "production") ||
      !validUniqueSorted(input.implementationActorIds, OPAQUE_ID) ||
      input.implementationActorIds.includes(input.reviewerId) ||
      !(input.publicKeyRegistryBytes instanceof Uint8Array) ||
      typeof input.expectedPublicKeyRegistrySha256 !== "string" ||
      !LOWER_SHA256.test(input.expectedPublicKeyRegistrySha256)) {
    fail("independent reviewer signature is invalid");
  }
  let payloadText;
  try {
    payloadText = new TextDecoder("utf-8", { fatal: true })
      .decode(input.canonicalPayloadBytes);
    const payloadValue = parseStrictJson(payloadText);
    if (payloadText !== canonical(payloadValue)) {
      fail("independent reviewer signature is invalid");
    }
  } catch {
    fail("independent reviewer signature is invalid");
  }
  const signature = canonicalSignature(input.signatureBase64);
  if (signature === undefined) fail("independent reviewer signature is invalid");
  const publicKeyRegistry = parsePublicKeys(input.publicKeyRegistryBytes);
  if (publicKeyRegistry.sha256 !== input.expectedPublicKeyRegistrySha256) {
    fail("independent reviewer signature is invalid");
  }
  const registryEntry = publicKeyRegistry.publicKeys.get(input.publicKeyId);
  if (registryEntry === undefined || registryEntry.algorithm !== "Ed25519" ||
      registryEntry.reviewerId !== input.reviewerId ||
      registryEntry.role !== "independent-reviewer" ||
      !registryEntry.allowedEnvironments.includes(input.environment)) {
    fail("independent reviewer signature is invalid");
  }
  let verified = false;
  try {
    verified = verify(
      null,
      Buffer.from(input.canonicalPayloadBytes),
      createPublicKey(registryEntry.publicKeyPem),
      signature,
    );
  } catch {
    fail("independent reviewer signature is invalid");
  }
  if (!verified) fail("independent reviewer signature is invalid");
  return deepFreeze({
    schemaVersion: "3dena.independent-reviewer-signature-verification.v1",
    environment: input.environment,
    reviewerId: input.reviewerId,
    publicKeyRegistry: {
      sha256: publicKeyRegistry.sha256,
      publicKeyId: input.publicKeyId,
      algorithm: registryEntry.algorithm,
      allowedEnvironments: [...registryEntry.allowedEnvironments],
      reviewerId: registryEntry.reviewerId,
      role: registryEntry.role,
    },
    verified: true,
  });
}

function validMigrationDescriptors(value) {
  if (!Array.isArray(value) || value.length < 1) return false;
  const versions = [];
  for (const entry of value) {
    if (!exact(entry, ["path", "sha256", "version"]) ||
        !portableOperatorPath(entry.path) ||
        typeof entry.sha256 !== "string" || !LOWER_SHA256.test(entry.sha256) ||
        typeof entry.version !== "string" || !VERSION.test(entry.version)) {
      return false;
    }
    versions.push(entry.version);
  }
  return new Set(versions).size === versions.length &&
    [...versions].sort().every((version, index) => version === versions[index]);
}

async function loadCustodiedMigrationConfig(
  rootRealPath,
  migrationConfigPath,
  expectedMigrationConfigSha256,
  environmentVariables,
) {
  let configBytes;
  let config;
  try {
    configBytes = await readOperatorCustodiedFile(
      rootRealPath,
      migrationConfigPath,
      MAX_MIGRATION_CONFIG_BYTES,
      "migration config is invalid",
    );
    if (sha256(configBytes) !== expectedMigrationConfigSha256) {
      fail("migration config is invalid");
    }
    config = parseBoundedJsonBytes(
      configBytes,
      MAX_MIGRATION_CONFIG_BYTES,
      "migration config is invalid",
    );
  } catch {
    fail("migration config is invalid");
  }
  if (!exact(config, ["databaseUrlEnv", "migrations"]) ||
      typeof config.databaseUrlEnv !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(config.databaseUrlEnv) ||
      !validMigrationDescriptors(config.migrations)) {
    fail("migration config is invalid");
  }
  for (const entry of config.migrations) {
    const bytes = await readOperatorCustodiedFile(
      rootRealPath,
      entry.path,
      MAX_MIGRATION_BYTES,
      "migration config is invalid",
    );
    if (sha256(bytes) !== entry.sha256) fail(`migration SHA-256 mismatch: ${entry.version}`);
  }
  const connectionString = environmentVariables[config.databaseUrlEnv];
  if (!connectionString) fail("configured database URL environment variable is missing");
  return Object.freeze({
    config: Object.freeze(structuredClone(config)),
    migrationManifestSha256: migrationManifestSha256(config.migrations),
    connectionString,
  });
}

export async function loadBuildApprovalOperatorInput(
  sourceRoot,
  configPath,
  expectedDigests,
  environmentVariables = process.env,
) {
  if (!portableOperatorPath(configPath) || !exact(expectedDigests, EXPECTED_INPUT_DIGEST_KEYS) ||
      typeof expectedDigests.expectedConfigSha256 !== "string" ||
        !LOWER_SHA256.test(expectedDigests.expectedConfigSha256) ||
      typeof expectedDigests.expectedSignedApprovalSha256 !== "string" ||
        !LOWER_SHA256.test(expectedDigests.expectedSignedApprovalSha256) ||
      typeof expectedDigests.expectedPublicKeyRegistrySha256 !== "string" ||
        !LOWER_SHA256.test(expectedDigests.expectedPublicKeyRegistrySha256)) {
    fail("build approval operator input is invalid");
  }
  const rootRealPath = await canonicalOperatorCustodyRoot(
    sourceRoot,
    "build approval operator input is invalid",
  );
  const inputBytes = await readOperatorCustodiedFile(
    rootRealPath,
    configPath,
    MAX_INPUT_BYTES,
    "build approval operator input is invalid",
  );
  if (sha256(inputBytes) !== expectedDigests.expectedConfigSha256) {
    fail("build approval operator input is invalid");
  }
  const input = parseBoundedJsonBytes(
    inputBytes,
    MAX_INPUT_BYTES,
    "build approval operator input is invalid",
  );
  if (!exact(input, INPUT_KEYS) || input.schemaVersion !== INPUT_VERSION ||
      (input.operation !== "activate" && input.operation !== "verify") ||
      (input.environment !== "preview" && input.environment !== "production") ||
      !portableOperatorPath(input.migrationConfigPath) ||
      typeof input.migrationConfigSha256 !== "string" ||
        !LOWER_SHA256.test(input.migrationConfigSha256) ||
      !portableOperatorPath(input.signedApprovalPath) ||
      input.signedApprovalSha256 !== expectedDigests.expectedSignedApprovalSha256 ||
      !portableOperatorPath(input.publicKeysPath) ||
      input.publicKeysSha256 !== expectedDigests.expectedPublicKeyRegistrySha256) {
    fail("build approval operator input is invalid");
  }
  const migration = await loadCustodiedMigrationConfig(
    rootRealPath,
    input.migrationConfigPath,
    input.migrationConfigSha256,
    environmentVariables,
  );
  const [approvalBytes, publicKeyRegistryBytes] = await Promise.all([
    readOperatorCustodiedFile(
      rootRealPath,
      input.signedApprovalPath,
      MAX_APPROVAL_BYTES,
      "signed build approval is invalid",
    ),
    readOperatorCustodiedFile(
      rootRealPath,
      input.publicKeysPath,
      MAX_PUBLIC_KEYS_BYTES,
      "build approval public-key registry is invalid",
    ),
  ]);
  if (sha256(approvalBytes) !== expectedDigests.expectedSignedApprovalSha256 ||
      sha256(publicKeyRegistryBytes) !== expectedDigests.expectedPublicKeyRegistrySha256) {
    fail("signed build approval is invalid");
  }
  const approval = parseBoundedJsonBytes(
    approvalBytes,
    MAX_APPROVAL_BYTES,
    "signed build approval is invalid",
  );
  const publicKeyRegistry = parsePublicKeys(publicKeyRegistryBytes);
  if (approval?.candidate?.publicKeyRegistrySha256 !== publicKeyRegistry.sha256 ||
      publicKeyRegistry.sha256 !== expectedDigests.expectedPublicKeyRegistrySha256) {
    fail("signed build approval is invalid");
  }
  assertSignedApproval(
    approval,
    input.environment,
    migration.migrationManifestSha256,
    publicKeyRegistry.publicKeys,
  );
  return Object.freeze({
    input: Object.freeze({
      schemaVersion: INPUT_VERSION,
      operation: input.operation,
      environment: input.environment,
      migrationConfigPath: input.migrationConfigPath,
      migrationConfigSha256: input.migrationConfigSha256,
      signedApprovalPath: input.signedApprovalPath,
      signedApprovalSha256: input.signedApprovalSha256,
      publicKeysPath: input.publicKeysPath,
      publicKeysSha256: input.publicKeysSha256,
    }),
    migrations: Object.freeze(migration.config.migrations.map(({ version, sha256: digest }) =>
      Object.freeze({ version, sha256: digest }))),
    migrationManifestSha256: migration.migrationManifestSha256,
    connectionString: migration.connectionString,
    approval: Object.freeze(structuredClone(approval)),
    publicKeys: publicKeyRegistry.publicKeys,
  });
}

async function defaultConnector(connectionString) {
  const { Client } = await import("pg");
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: true } });
  await client.connect();
  return client;
}

async function verifyMigrations(client, migrations) {
  const result = await client.query(
    "SELECT version, sha256 FROM compute_schema_migrations ORDER BY applied_at, version",
  );
  if (result.rowCount !== migrations.length || result.rows.length !== migrations.length ||
      result.rows.some((row, index) => row?.version !== migrations[index]?.version ||
        row?.sha256 !== migrations[index]?.sha256)) {
    fail("approved migration manifest is not active");
  }
}

async function activateApproval(client, approval, environment, migrationDigest, publicKeys) {
  await client.query(
    `INSERT INTO compute_build_approvals (
       approval_manifest_sha256, release_id, environment, git_commit,
       vercel_deployment_id, vercel_build_id, fly_image_digest, fly_build_id,
       reviewer_id, approved_at, approval
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
     ON CONFLICT (approval_manifest_sha256) DO NOTHING`,
    [approval.approvalManifestSha256, approval.candidate.releaseId,
      environment, approval.candidate.gitCommit,
      approval.candidate.vercelDeploymentId, approval.candidate.vercelBuildId,
      approval.candidate.flyImageDigest, approval.candidate.flyBuildId,
      approval.reviewerId, approval.approvedAt, JSON.stringify(approval)],
  );
  const stored = await client.query(
    `SELECT approval FROM compute_build_approvals
     WHERE approval_manifest_sha256 = $1`,
    [approval.approvalManifestSha256],
  );
  const observed = stored.rows[0]?.approval;
  if (stored.rowCount !== 1 || stored.rows.length !== 1) {
    fail("stored build approval does not match signed input");
  }
  try {
    assertSignedApproval(observed, environment, migrationDigest, publicKeys);
  } catch {
    fail("stored build approval does not match signed input");
  }
  if (canonical(observed) !== canonical(approval)) {
    fail("stored build approval does not match signed input");
  }
  await client.query(
    `INSERT INTO compute_build_approval_events (
       approval_manifest_sha256, environment, event_type, actor_id, occurred_at
     ) VALUES ($1,$2,'activated',$3,$4)
     ON CONFLICT (approval_manifest_sha256, event_type, actor_id, occurred_at)
     DO NOTHING`,
    [approval.approvalManifestSha256, environment,
      approval.reviewerId, approval.approvedAt],
  );
  const event = await client.query(
    `SELECT approval_manifest_sha256, environment, event_type, actor_id,
       (occurred_at = $4::timestamptz) AS occurred_at_matches
     FROM compute_build_approval_events
     WHERE approval_manifest_sha256 = $1 AND environment = $2
       AND event_type = 'activated' AND actor_id = $3
       AND occurred_at = $4::timestamptz`,
    [approval.approvalManifestSha256, environment,
      approval.reviewerId, approval.approvedAt],
  );
  const row = event.rows[0];
  if (event.rowCount !== 1 || event.rows.length !== 1 ||
      row?.approval_manifest_sha256 !== approval.approvalManifestSha256 ||
      row?.environment !== environment || row?.event_type !== "activated" ||
      row?.actor_id !== approval.reviewerId || row?.occurred_at_matches !== true) {
    fail("stored activation event does not match signed input");
  }
}

async function verifyActiveApproval(client, approval, environment, migrationDigest, publicKeys) {
  const result = await client.query(
    `WITH latest_activation AS (
       SELECT event_id, approval_manifest_sha256, actor_id, occurred_at
       FROM compute_build_approval_events
       WHERE environment = $2 AND event_type = 'activated'
       ORDER BY event_id DESC LIMIT 1
     )
     SELECT stored.approval FROM latest_activation active
     JOIN compute_build_approvals stored
       ON stored.approval_manifest_sha256 = active.approval_manifest_sha256
     WHERE stored.approval_manifest_sha256 = $1
       AND stored.environment = $2 AND active.actor_id = $3
       AND active.occurred_at = $4::timestamptz
       AND NOT EXISTS (
         SELECT 1 FROM compute_build_approval_events revoked
         WHERE revoked.approval_manifest_sha256 = active.approval_manifest_sha256
           AND revoked.event_type = 'revoked' AND revoked.event_id > active.event_id
       )`,
    [approval.approvalManifestSha256, environment,
      approval.reviewerId, approval.approvedAt],
  );
  const observed = result.rows[0]?.approval;
  if (result.rowCount !== 1 || result.rows.length !== 1) {
    fail("signed build approval is not the latest active build");
  }
  try {
    assertSignedApproval(observed, environment, migrationDigest, publicKeys);
  } catch {
    fail("signed build approval is not the latest active build");
  }
  if (canonical(observed) !== canonical(approval)) {
    fail("signed build approval is not the latest active build");
  }
}

function retryableTransactionError(error) {
  return error !== null && typeof error === "object" &&
    RETRYABLE_TRANSACTION_CODES.has(error.code);
}

async function executeOperatorTransaction(client, loaded) {
  await client.query(
    "SELECT pg_advisory_xact_lock($1::bigint)",
    [MIGRATION_ADVISORY_LOCK_KEY],
  );
  if (loaded.input.operation === "activate") {
    await client.query("LOCK TABLE compute_schema_migrations IN SHARE MODE");
  }
  await verifyMigrations(client, loaded.migrations);
  if (loaded.input.operation === "activate") {
    await client.query("LOCK TABLE compute_build_approval_events IN SHARE ROW EXCLUSIVE MODE");
    await activateApproval(
      client,
      loaded.approval,
      loaded.input.environment,
      loaded.migrationManifestSha256,
      loaded.publicKeys,
    );
  }
  await verifyActiveApproval(
    client,
    loaded.approval,
    loaded.input.environment,
    loaded.migrationManifestSha256,
    loaded.publicKeys,
  );
}

export async function runBuildApprovalOperator(
  sourceRoot,
  configPath,
  expectedDigests,
  connect = defaultConnector,
  environmentVariables = process.env,
) {
  if (typeof connect !== "function") fail("build approval operator connector is invalid");
  const loaded = await loadBuildApprovalOperatorInput(
    sourceRoot,
    configPath,
    expectedDigests,
    environmentVariables,
  );
  const client = await connect(loaded.connectionString);
  if (!isRecord(client) || typeof client.query !== "function" || typeof client.end !== "function") {
    fail("build approval operator connector is invalid");
  }
  try {
    for (let attempt = 1; attempt <= MAXIMUM_TRANSACTION_ATTEMPTS; attempt += 1) {
      let transactionStarted = false;
      let committed = false;
      try {
        await client.query(loaded.input.operation === "verify"
          ? "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY"
          : "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
        transactionStarted = true;
        await executeOperatorTransaction(client, loaded);
        await client.query("COMMIT");
        committed = true;
        return Object.freeze({
          schemaVersion: RESULT_VERSION,
          operation: loaded.input.operation,
          environment: loaded.input.environment,
          approvalManifestSha256: loaded.approval.approvalManifestSha256,
          verified: true,
        });
      } catch (error) {
        if (transactionStarted && !committed) {
          try {
            await client.query("ROLLBACK");
          } catch {
            fail("build approval operator rollback failed");
          }
        }
        if (attempt < MAXIMUM_TRANSACTION_ATTEMPTS && retryableTransactionError(error)) continue;
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

export async function runBuildApprovalOperatorCli(
  sourceRoot,
  configPath,
  expectedDigests,
  options = {},
) {
  const writeStdout = options.writeStdout ?? ((value) => process.stdout.write(value));
  const writeStderr = options.writeStderr ?? ((value) => process.stderr.write(value));
  try {
    const result = await runBuildApprovalOperator(
      sourceRoot,
      configPath,
      expectedDigests,
      options.connect ?? defaultConnector,
      options.environment ?? process.env,
    );
    writeStdout(`${JSON.stringify(result)}\n`);
    return 0;
  } catch {
    writeStderr("COMPUTE_BUILD_APPROVAL_OPERATOR_FAILED\n");
    return 1;
  }
}

if (process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arguments_ = process.argv.slice(2);
  const expectedDigests = arguments_.length === 4 ? {
    expectedConfigSha256: arguments_[1],
    expectedSignedApprovalSha256: arguments_[2],
    expectedPublicKeyRegistrySha256: arguments_[3],
  } : undefined;
  process.exitCode = await runBuildApprovalOperatorCli(
    process.cwd(),
    arguments_.length === 4 ? arguments_[0] : undefined,
    expectedDigests,
  );
}
