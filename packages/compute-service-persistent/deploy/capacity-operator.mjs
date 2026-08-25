#!/usr/bin/env node

import { createHash, createPublicKey, verify } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { migrationManifestSha256 } from "./migrate.mjs";
import {
  canonicalOperatorCustodyRoot,
  portableOperatorPath,
  readOperatorCustodiedFile,
} from "./operator-path-custody.mjs";
import { parseStrictJson } from "./strict-json.mjs";

const CAPACITY_INPUT_VERSION = "3dena.compute-capacity-operator.v1";
const CAPACITY_RESULT_VERSION = "3dena.compute-capacity-operator-result.v1";
const BUILD_APPROVAL_CANDIDATE_VERSION = "3dena.build-approval-candidate.v4";
const BUILD_APPROVAL_VERSION = "3dena.build-approval.v4";
const MAX_CAPACITY = 10_000;
const MAX_INPUT_BYTES = 16 * 1024;
const MAX_MIGRATION_CONFIG_BYTES = 64 * 1024;
const MAX_MIGRATION_BYTES = 1024 * 1024;
const MAX_PUBLIC_KEY_REGISTRY_BYTES = 128 * 1024;
const LOWER_SHA256 = /^[a-f0-9]{64}$/u;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const TARBALL_INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const INPUT_KEYS = [
  "schemaVersion",
  "operation",
  "expectedCapacity",
  "migrationConfigPath",
  "migrationConfigSha256",
  "buildReadiness",
];
const BUILD_READINESS_KEYS = [
  "environment",
  "approvalManifestSha256",
  "publicKeysPath",
  "publicKeysSha256",
];
const EXPECTED_INPUT_DIGEST_KEYS = [
  "expectedConfigSha256",
  "expectedApprovalManifestSha256",
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

function validUniqueSortedStrings(value, pattern) {
  return Array.isArray(value) && value.length > 0 &&
    value.every((entry) => typeof entry === "string" && pattern.test(entry)) &&
    new Set(value).size === value.length &&
    [...value].sort().every((entry, index) => entry === value[index]);
}

function validCandidate(value) {
  return exact(value, CANDIDATE_KEYS) &&
    value.version === BUILD_APPROVAL_CANDIDATE_VERSION &&
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
    typeof value.publicKeyRegistrySha256 === "string" &&
      LOWER_SHA256.test(value.publicKeyRegistrySha256) &&
    typeof value.materializationManifestSha256 === "string" &&
      LOWER_SHA256.test(value.materializationManifestSha256) &&
    validUniqueSortedStrings(value.contractVersions, VERSION) &&
    validUniqueSortedStrings(value.implementationActorIds, OPAQUE_ID);
}

function assertActiveApproval(
  value,
  buildReadiness,
  migrationManifestSha256,
  publicKeys,
) {
  if (!exact(value, APPROVAL_KEYS) || value.version !== BUILD_APPROVAL_VERSION ||
      !validCandidate(value.candidate) ||
      typeof value.approvalManifestSha256 !== "string" ||
        !LOWER_SHA256.test(value.approvalManifestSha256) ||
      value.approvalManifestSha256 !== buildReadiness.approvalManifestSha256 ||
      value.candidate.environment !== buildReadiness.environment ||
      value.candidate.migrationManifestSha256 !== migrationManifestSha256 ||
      typeof value.reviewerId !== "string" || !OPAQUE_ID.test(value.reviewerId) ||
      value.candidate.implementationActorIds.includes(value.reviewerId) ||
      !validTimestamp(value.approvedAt) ||
      typeof value.publicKeyId !== "string" || !OPAQUE_ID.test(value.publicKeyId) ||
      value.signatureAlgorithm !== "Ed25519" ||
      typeof value.signatureBase64 !== "string" ||
        !/^[A-Za-z0-9+/]+={0,2}$/u.test(value.signatureBase64) ||
      sha256(canonical(value.candidate)) !== value.approvalManifestSha256 ||
      value.candidate.publicKeyRegistrySha256 !== publicKeys.sha256) {
    fail("active build approval is not ready");
  }
  const publicKey = publicKeys.entries.get(value.publicKeyId);
  if (publicKey === undefined || publicKey.algorithm !== value.signatureAlgorithm ||
      publicKey.role !== "independent-reviewer" ||
      publicKey.reviewerId !== value.reviewerId ||
      !publicKey.allowedEnvironments.includes(value.candidate.environment)) {
    fail("active build approval is not ready");
  }
  const signature = Buffer.from(value.signatureBase64, "base64");
  if (signature.byteLength !== 64 || signature.toString("base64") !== value.signatureBase64) {
    fail("active build approval is not ready");
  }
  const signatureEnvelope = {
    version: value.version,
    candidate: value.candidate,
    approvalManifestSha256: value.approvalManifestSha256,
    reviewerId: value.reviewerId,
    approvedAt: value.approvedAt,
    publicKeyId: value.publicKeyId,
    signatureAlgorithm: value.signatureAlgorithm,
  };
  let verified = false;
  try {
    verified = verify(
      null,
      Buffer.from(canonical(signatureEnvelope), "utf8"),
      createPublicKey(publicKey.publicKeyPem),
      signature,
    );
  } catch {
    fail("active build approval is not ready");
  }
  if (!verified) fail("active build approval is not ready");
}

function parseBoundedJson(bytes, maximumBytes, errorMessage) {
  try {
    if (!(bytes instanceof Uint8Array)) fail(errorMessage);
    if (bytes.byteLength < 2 || bytes.byteLength > maximumBytes) fail(errorMessage);
    return { value: parseStrictJson(bytes), bytes };
  } catch {
    fail(errorMessage);
  }
}

function loadPublicKeys(bytes) {
  const parsed = parseBoundedJson(
    bytes,
    MAX_PUBLIC_KEY_REGISTRY_BYTES,
    "build approval public-key registry is invalid",
  );
  const { value } = parsed;
  if (!isRecord(value) || Object.keys(value).length < 1 ||
      Buffer.from(bytes).toString("utf8") !== `${canonical(value)}\n`) {
    fail("build approval public-key registry is invalid");
  }
  const entries = new Map();
  for (const [id, entry] of Object.entries(value)) {
    if (!OPAQUE_ID.test(id) || !exact(entry, [
      "algorithm", "allowedEnvironments", "publicKeyPem", "reviewerId", "role",
    ]) || entry.algorithm !== "Ed25519" || entry.role !== "independent-reviewer" ||
        typeof entry.reviewerId !== "string" || !OPAQUE_ID.test(entry.reviewerId) ||
        !validUniqueSortedStrings(entry.allowedEnvironments, /^(?:preview|production)$/u) ||
        typeof entry.publicKeyPem !== "string" || /PRIVATE KEY/iu.test(entry.publicKeyPem)) {
      fail("build approval public-key registry is invalid");
    }
    let key;
    try {
      key = createPublicKey(entry.publicKeyPem);
    } catch {
      fail("build approval public-key registry is invalid");
    }
    if (key.asymmetricKeyType !== "ed25519" ||
        String(key.export({ format: "pem", type: "spki" })) !== entry.publicKeyPem) {
      fail("build approval public-key registry is invalid");
    }
    entries.set(id, entry);
  }
  return Object.freeze({ entries, sha256: sha256(bytes) });
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
  environment,
) {
  const configBytes = await readOperatorCustodiedFile(
    rootRealPath,
    migrationConfigPath,
    MAX_MIGRATION_CONFIG_BYTES,
    "migration config is invalid",
  );
  if (sha256(configBytes) !== expectedMigrationConfigSha256) {
    fail("migration config is invalid");
  }
  const { value: config } = parseBoundedJson(
    configBytes,
    MAX_MIGRATION_CONFIG_BYTES,
    "migration config is invalid",
  );
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
  const connectionString = environment[config.databaseUrlEnv];
  if (!connectionString) fail("configured database URL environment variable is missing");
  return Object.freeze({
    config: Object.freeze(structuredClone(config)),
    migrationManifestSha256: migrationManifestSha256(config.migrations),
    connectionString,
  });
}

export async function loadCapacityOperatorInput(
  sourceRoot,
  configPath,
  expectedDigests,
  environment = process.env,
) {
  if (!portableOperatorPath(configPath) ||
      !exact(expectedDigests, EXPECTED_INPUT_DIGEST_KEYS) ||
      typeof expectedDigests.expectedConfigSha256 !== "string" ||
        !LOWER_SHA256.test(expectedDigests.expectedConfigSha256) ||
      typeof expectedDigests.expectedApprovalManifestSha256 !== "string" ||
        !LOWER_SHA256.test(expectedDigests.expectedApprovalManifestSha256) ||
      typeof expectedDigests.expectedPublicKeyRegistrySha256 !== "string" ||
        !LOWER_SHA256.test(expectedDigests.expectedPublicKeyRegistrySha256)) {
    fail("capacity operator input is invalid");
  }
  const rootRealPath = await canonicalOperatorCustodyRoot(
    sourceRoot,
    "capacity operator input is invalid",
  );
  const configBytes = await readOperatorCustodiedFile(
    rootRealPath,
    configPath,
    MAX_INPUT_BYTES,
    "capacity operator input is invalid",
  );
  if (sha256(configBytes) !== expectedDigests.expectedConfigSha256) {
    fail("capacity operator input is invalid");
  }
  const { value } = parseBoundedJson(
    configBytes,
    MAX_INPUT_BYTES,
    "capacity operator input is invalid",
  );
  if (!exact(value, INPUT_KEYS) || value.schemaVersion !== CAPACITY_INPUT_VERSION ||
      (value.operation !== "apply" && value.operation !== "verify") ||
      !Number.isSafeInteger(value.expectedCapacity) || value.expectedCapacity < 1 ||
      value.expectedCapacity > MAX_CAPACITY ||
      !portableOperatorPath(value.migrationConfigPath) ||
      typeof value.migrationConfigSha256 !== "string" ||
        !LOWER_SHA256.test(value.migrationConfigSha256) ||
      !exact(value.buildReadiness, BUILD_READINESS_KEYS) ||
      (value.buildReadiness.environment !== "preview" &&
        value.buildReadiness.environment !== "production") ||
      typeof value.buildReadiness.approvalManifestSha256 !== "string" ||
      !LOWER_SHA256.test(value.buildReadiness.approvalManifestSha256) ||
      value.buildReadiness.approvalManifestSha256 !==
        expectedDigests.expectedApprovalManifestSha256 ||
      !portableOperatorPath(value.buildReadiness.publicKeysPath) ||
      value.buildReadiness.publicKeysSha256 !==
        expectedDigests.expectedPublicKeyRegistrySha256) {
    fail("capacity operator input is invalid");
  }
  const migration = await loadCustodiedMigrationConfig(
    rootRealPath,
    value.migrationConfigPath,
    value.migrationConfigSha256,
    environment,
  );
  const publicKeyRegistryBytes = await readOperatorCustodiedFile(
    rootRealPath,
    value.buildReadiness.publicKeysPath,
    MAX_PUBLIC_KEY_REGISTRY_BYTES,
    "build approval public-key registry is invalid",
  );
  if (sha256(publicKeyRegistryBytes) !==
      expectedDigests.expectedPublicKeyRegistrySha256) {
    fail("build approval public-key registry is invalid");
  }
  const publicKeys = loadPublicKeys(publicKeyRegistryBytes);
  if (publicKeys.sha256 !== expectedDigests.expectedPublicKeyRegistrySha256) {
    fail("build approval public-key registry is invalid");
  }
  return Object.freeze({
    input: Object.freeze({
      schemaVersion: CAPACITY_INPUT_VERSION,
      operation: value.operation,
      expectedCapacity: value.expectedCapacity,
      migrationConfigPath: value.migrationConfigPath,
      migrationConfigSha256: value.migrationConfigSha256,
      buildReadiness: Object.freeze({ ...value.buildReadiness }),
    }),
    migrations: Object.freeze(migration.config.migrations.map(({ version, sha256: digest }) =>
      Object.freeze({ version, sha256: digest }))),
    migrationManifestSha256: migration.migrationManifestSha256,
    connectionString: migration.connectionString,
    publicKeys,
  });
}

async function defaultConnector(connectionString) {
  const { Client } = await import("pg");
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: true },
  });
  await client.connect();
  return client;
}

async function verifyMigrationReadiness(client, migrations) {
  const result = await client.query(
    "SELECT version, sha256 FROM compute_schema_migrations ORDER BY applied_at, version",
  );
  if (result.rowCount !== migrations.length || result.rows.length !== migrations.length ||
      result.rows.some((row, index) =>
        row?.version !== migrations[index]?.version ||
        row?.sha256 !== migrations[index]?.sha256)) {
    fail("approved migration manifest is not active");
  }
}

async function verifyBuildReadiness(
  client,
  buildReadiness,
  migrationManifestSha256,
  publicKeys,
) {
  const result = await client.query(
    `WITH latest_activation AS (
       SELECT event_id, approval_manifest_sha256
       FROM compute_build_approval_events
       WHERE environment = $2 AND event_type = 'activated'
       ORDER BY event_id DESC LIMIT 1
     )
     SELECT approval.approval FROM latest_activation active
     JOIN compute_build_approvals approval
       ON approval.approval_manifest_sha256 = active.approval_manifest_sha256
     WHERE approval.approval_manifest_sha256 = $1
       AND approval.environment = $2
       AND NOT EXISTS (
         SELECT 1 FROM compute_build_approval_events revoked
         WHERE revoked.approval_manifest_sha256 = active.approval_manifest_sha256
           AND revoked.event_type = 'revoked' AND revoked.event_id > active.event_id
       )`,
    [buildReadiness.approvalManifestSha256, buildReadiness.environment],
  );
  if (result.rowCount !== 1 || result.rows.length !== 1) {
    fail("active build approval is not ready");
  }
  assertActiveApproval(
    result.rows[0]?.approval,
    buildReadiness,
    migrationManifestSha256,
    publicKeys,
  );
}

function count(value) {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_CAPACITY * 2) {
    fail("capacity inventory is invalid");
  }
  return parsed;
}

async function capacityInventory(client, expectedCapacity) {
  const result = await client.query(
    `SELECT
       count(*) FILTER (
         WHERE slot_number BETWEEN 1 AND $1
       )::integer AS configured_expected_count,
       count(*) FILTER (
         WHERE slot_number BETWEEN 1 AND $1
           AND enabled = true AND quarantined_at IS NULL
       )::integer AS enabled_expected_count,
       count(*) FILTER (
         WHERE slot_number > $1 AND enabled = true
       )::integer AS enabled_beyond_count,
       count(*) FILTER (
         WHERE slot_number > $1 AND holder_id IS NOT NULL
       )::integer AS occupied_beyond_count
     FROM compute_capacity_slots`,
    [expectedCapacity],
  );
  if (result.rowCount !== 1 || result.rows.length !== 1) {
    fail("capacity inventory is invalid");
  }
  const row = result.rows[0];
  return Object.freeze({
    configuredExpectedCount: count(row?.configured_expected_count),
    enabledExpectedCount: count(row?.enabled_expected_count),
    enabledBeyondCount: count(row?.enabled_beyond_count),
    occupiedBeyondCount: count(row?.occupied_beyond_count),
  });
}

function exactCapacity(inventory, expectedCapacity) {
  return inventory.configuredExpectedCount === expectedCapacity &&
    inventory.enabledExpectedCount === expectedCapacity &&
    inventory.enabledBeyondCount === 0 &&
    inventory.occupiedBeyondCount === 0;
}

async function applyCapacity(client, expectedCapacity) {
  const before = await capacityInventory(client, expectedCapacity);
  if (before.occupiedBeyondCount !== 0) {
    fail("capacity rows do not match explicit configuration");
  }
  const upserted = await client.query(
    `INSERT INTO compute_capacity_slots (slot_number, enabled)
     SELECT value, true FROM generate_series(1, $1::integer) AS value
     ON CONFLICT (slot_number) DO UPDATE SET enabled =
       (compute_capacity_slots.quarantined_at IS NULL)`,
    [expectedCapacity],
  );
  if (upserted.rowCount !== expectedCapacity) fail("capacity configuration CAS failed");
  await client.query(
    `UPDATE compute_capacity_slots SET enabled = false
     WHERE slot_number > $1 AND holder_id IS NULL`,
    [expectedCapacity],
  );
}

export async function runCapacityOperator(
  sourceRoot,
  configPath,
  expectedDigests,
  connect = defaultConnector,
  environment = process.env,
) {
  if (typeof connect !== "function") fail("capacity operator connector is invalid");
  const loaded = await loadCapacityOperatorInput(
    sourceRoot,
    configPath,
    expectedDigests,
    environment,
  );
  const client = await connect(loaded.connectionString);
  if (!isRecord(client) || typeof client.query !== "function" ||
      typeof client.end !== "function") {
    fail("capacity operator connector is invalid");
  }
  let transactionStarted = false;
  let committed = false;
  try {
    await client.query(loaded.input.operation === "verify"
      ? "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY"
      : "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    transactionStarted = true;
    if (loaded.input.operation === "apply") {
      await client.query("LOCK TABLE compute_schema_migrations IN SHARE MODE");
    }
    await verifyMigrationReadiness(client, loaded.migrations);
    if (loaded.input.operation === "apply") {
      await client.query("LOCK TABLE compute_build_approval_events IN SHARE MODE");
    }
    await verifyBuildReadiness(
      client,
      loaded.input.buildReadiness,
      loaded.migrationManifestSha256,
      loaded.publicKeys,
    );
    if (loaded.input.operation === "apply") {
      await client.query("LOCK TABLE compute_capacity_slots IN SHARE ROW EXCLUSIVE MODE");
      await applyCapacity(client, loaded.input.expectedCapacity);
    }
    const inventory = await capacityInventory(client, loaded.input.expectedCapacity);
    if (!exactCapacity(inventory, loaded.input.expectedCapacity)) {
      fail("capacity rows do not match explicit configuration");
    }
    await client.query("COMMIT");
    committed = true;
    return Object.freeze({
      schemaVersion: CAPACITY_RESULT_VERSION,
      operation: loaded.input.operation,
      expectedCapacity: loaded.input.expectedCapacity,
      verified: true,
    });
  } catch (error) {
    if (transactionStarted && !committed) {
      try {
        await client.query("ROLLBACK");
      } catch {
        fail("capacity operator rollback failed");
      }
    }
    throw error;
  } finally {
    await client.end();
  }
}

export async function runCapacityOperatorCli(
  sourceRoot,
  configPath,
  expectedDigests,
  options = {},
) {
  const writeStdout = options.writeStdout ?? ((value) => process.stdout.write(value));
  const writeStderr = options.writeStderr ?? ((value) => process.stderr.write(value));
  try {
    const result = await runCapacityOperator(
      sourceRoot,
      configPath,
      expectedDigests,
      options.connect ?? defaultConnector,
      options.environment ?? process.env,
    );
    writeStdout(`${JSON.stringify(result)}\n`);
    return 0;
  } catch {
    writeStderr("COMPUTE_CAPACITY_OPERATOR_FAILED\n");
    return 1;
  }
}

if (process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arguments_ = process.argv.slice(2);
  const expectedDigests = arguments_.length === 4 ? {
    expectedConfigSha256: arguments_[1],
    expectedApprovalManifestSha256: arguments_[2],
    expectedPublicKeyRegistrySha256: arguments_[3],
  } : undefined;
  const exitCode = await runCapacityOperatorCli(
    process.cwd(),
    arguments_.length === 4 ? arguments_[0] : undefined,
    expectedDigests,
  );
  process.exitCode = exitCode;
}
