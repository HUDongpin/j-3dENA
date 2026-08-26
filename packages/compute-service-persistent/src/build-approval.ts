import { createHash, createPublicKey, verify } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";

import type { ComputeHttpReadinessProbe } from "@3dena/compute-service-http";

import {
  BUILD_APPROVAL_CANDIDATE_VERSION,
  BUILD_APPROVAL_REGISTRY_VERSION,
  BUILD_APPROVAL_VERSION,
  type BuildApprovalCandidateV1,
  type BuildApprovalPublicKeyV1,
  type BuildApprovalRegistry,
  type BuildApprovalV1,
  type ExpectedRuntimeBuildV1,
} from "./contracts";
import { persistentError } from "./errors";
import type { PostgresDatabase } from "./postgres";
import {
  canonicalStringify,
  cloneFrozen,
  hasExactKeys,
  isRecord,
  LOWER_SHA256,
  OPAQUE_ID,
  sha256Text,
} from "./util";

const COMMIT = /^[a-f0-9]{40}$/u;
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u;
const TARBALL_INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
export const BUILD_APPROVAL_PUBLIC_KEY_REGISTRY_MAX_BYTES = 128 * 1024;

const CANDIDATE_KEYS = [
  "version", "releaseId", "environment", "gitCommit", "vercelDeploymentId",
  "vercelBuildId", "flyImageDigest", "flyBuildId", "analysisTarballSha256",
  "jenaVersion", "jenaCommit", "jenaTarballSha256", "jenaTarballIntegrity",
  "sdkVersion", "buildId", "lockfileSha256",
  "sbomSha256", "schemaBundleSha256", "migrationManifestSha256",
  "publicKeyRegistrySha256", "materializationManifestSha256", "contractVersions",
  "implementationActorIds",
] as const;
const APPROVAL_KEYS = [
  "version", "candidate", "approvalManifestSha256", "reviewerId", "approvedAt",
  "publicKeyId", "signatureAlgorithm", "signatureBase64",
] as const;
const SIGNATURE_ENVELOPE_KEYS = APPROVAL_KEYS.filter((key) => key !== "signatureBase64");
const PUBLIC_KEY_ENTRY_KEYS = [
  "algorithm", "allowedEnvironments", "publicKeyPem", "reviewerId", "role",
] as const;

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function assertBuildApprovalCandidate(
  value: unknown,
): asserts value is BuildApprovalCandidateV1 {
  const contractVersions = isRecord(value) && Array.isArray(value.contractVersions)
    ? value.contractVersions
    : null;
  const implementationActorIds = isRecord(value) && Array.isArray(value.implementationActorIds)
    ? value.implementationActorIds
    : null;
  if (
    !isRecord(value) || !hasExactKeys(value, CANDIDATE_KEYS) ||
    value.version !== BUILD_APPROVAL_CANDIDATE_VERSION ||
    typeof value.releaseId !== "string" || !OPAQUE_ID.test(value.releaseId) ||
    (value.environment !== "preview" && value.environment !== "production") ||
    typeof value.gitCommit !== "string" || !COMMIT.test(value.gitCommit) ||
    typeof value.vercelDeploymentId !== "string" || !OPAQUE_ID.test(value.vercelDeploymentId) ||
    typeof value.vercelBuildId !== "string" || !OPAQUE_ID.test(value.vercelBuildId) ||
    typeof value.flyImageDigest !== "string" || !IMAGE_DIGEST.test(value.flyImageDigest) ||
    typeof value.flyBuildId !== "string" || !OPAQUE_ID.test(value.flyBuildId) ||
    typeof value.analysisTarballSha256 !== "string" || !LOWER_SHA256.test(value.analysisTarballSha256) ||
    typeof value.jenaVersion !== "string" || !VERSION.test(value.jenaVersion) ||
    typeof value.jenaCommit !== "string" || !COMMIT.test(value.jenaCommit) ||
    typeof value.jenaTarballSha256 !== "string" || !LOWER_SHA256.test(value.jenaTarballSha256) ||
    typeof value.jenaTarballIntegrity !== "string" || !TARBALL_INTEGRITY.test(value.jenaTarballIntegrity) ||
    typeof value.sdkVersion !== "string" || !VERSION.test(value.sdkVersion) ||
    typeof value.buildId !== "string" || !OPAQUE_ID.test(value.buildId) ||
    typeof value.lockfileSha256 !== "string" || !LOWER_SHA256.test(value.lockfileSha256) ||
    typeof value.sbomSha256 !== "string" || !LOWER_SHA256.test(value.sbomSha256) ||
    typeof value.schemaBundleSha256 !== "string" || !LOWER_SHA256.test(value.schemaBundleSha256) ||
    typeof value.migrationManifestSha256 !== "string" ||
      !LOWER_SHA256.test(value.migrationManifestSha256) ||
    typeof value.publicKeyRegistrySha256 !== "string" ||
      !LOWER_SHA256.test(value.publicKeyRegistrySha256) ||
    typeof value.materializationManifestSha256 !== "string" ||
      !LOWER_SHA256.test(value.materializationManifestSha256) ||
    contractVersions === null || contractVersions.length < 1 ||
    contractVersions.some((item) => typeof item !== "string" || !VERSION.test(item)) ||
    new Set(contractVersions).size !== contractVersions.length ||
    [...contractVersions].sort().some((item, index) => item !== contractVersions[index])
    || implementationActorIds === null || implementationActorIds.length < 1
    || implementationActorIds.some((item) => typeof item !== "string" || !OPAQUE_ID.test(item))
    || new Set(implementationActorIds).size !== implementationActorIds.length
    || [...implementationActorIds].sort().some((item, index) => item !== implementationActorIds[index])
  ) {
    persistentError("BUILD_APPROVAL_INVALID");
  }
}

export function buildApprovalManifestSha256(candidate: BuildApprovalCandidateV1): string {
  assertBuildApprovalCandidate(candidate);
  return sha256Text(canonicalStringify(candidate));
}

export function buildApprovalSignaturePayload(
  value: Omit<BuildApprovalV1, "signatureBase64">,
): string {
  if (!isRecord(value) || !hasExactKeys(value, SIGNATURE_ENVELOPE_KEYS) ||
      value.version !== BUILD_APPROVAL_VERSION ||
      typeof value.approvalManifestSha256 !== "string" ||
        !LOWER_SHA256.test(value.approvalManifestSha256) ||
      typeof value.reviewerId !== "string" || !OPAQUE_ID.test(value.reviewerId) ||
      !validTimestamp(value.approvedAt) ||
      typeof value.publicKeyId !== "string" || !OPAQUE_ID.test(value.publicKeyId) ||
      value.signatureAlgorithm !== "Ed25519") {
    persistentError("BUILD_APPROVAL_INVALID");
  }
  assertBuildApprovalCandidate(value.candidate);
  if (buildApprovalManifestSha256(value.candidate) !== value.approvalManifestSha256) {
    persistentError("BUILD_APPROVAL_INVALID");
  }
  return canonicalStringify(value);
}

function assertPublicKeyEntry(value: unknown): asserts value is BuildApprovalPublicKeyV1 {
  const environments = isRecord(value) && Array.isArray(value.allowedEnvironments)
    ? value.allowedEnvironments
    : null;
  if (!isRecord(value) || !hasExactKeys(value, PUBLIC_KEY_ENTRY_KEYS) ||
      value.algorithm !== "Ed25519" || value.role !== "independent-reviewer" ||
      typeof value.reviewerId !== "string" || !OPAQUE_ID.test(value.reviewerId) ||
      typeof value.publicKeyPem !== "string" || /PRIVATE KEY/iu.test(value.publicKeyPem) ||
      environments === null || environments.length < 1 ||
      environments.some((environment) =>
        environment !== "preview" && environment !== "production") ||
      new Set(environments).size !== environments.length ||
      [...environments].sort().some((environment, index) =>
        environment !== environments[index])) {
    persistentError("BUILD_APPROVAL_INVALID");
  }
  try {
    const publicKey = createPublicKey(value.publicKeyPem);
    if (publicKey.asymmetricKeyType !== "ed25519" ||
        String(publicKey.export({ format: "pem", type: "spki" })) !== value.publicKeyPem) {
      persistentError("BUILD_APPROVAL_INVALID");
    }
  } catch {
    persistentError("BUILD_APPROVAL_INVALID");
  }
}

export function parseBuildApprovalPublicKeyRegistry(
  bytes: Uint8Array,
): ReadonlyMap<string, BuildApprovalPublicKeyV1> {
  if (bytes.byteLength < 1 ||
      bytes.byteLength > BUILD_APPROVAL_PUBLIC_KEY_REGISTRY_MAX_BYTES) {
    persistentError("BUILD_APPROVAL_INVALID");
  }
  let value: unknown;
  const text = Buffer.from(bytes).toString("utf8");
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    persistentError("BUILD_APPROVAL_INVALID");
  }
  if (!isRecord(value) || Object.keys(value).length < 1 ||
      text !== `${canonicalStringify(value)}\n`) {
    persistentError("BUILD_APPROVAL_INVALID");
  }
  const entries: Array<[string, BuildApprovalPublicKeyV1]> = [];
  for (const [publicKeyId, entry] of Object.entries(value)) {
    if (!OPAQUE_ID.test(publicKeyId)) persistentError("BUILD_APPROVAL_INVALID");
    assertPublicKeyEntry(entry);
    entries.push([publicKeyId, cloneFrozen(entry)]);
  }
  return new Map(entries);
}

export async function loadBuildApprovalPublicKeyRegistry(
  path: string,
): Promise<Readonly<{
  publicKeys: ReadonlyMap<string, BuildApprovalPublicKeyV1>;
  sha256: string;
}>> {
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size < 1n ||
        before.size > BigInt(BUILD_APPROVAL_PUBLIC_KEY_REGISTRY_MAX_BYTES)) {
      throw new TypeError("Build approval public-key registry exceeds the 128 KiB limit.");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (after.dev !== before.dev || after.ino !== before.ino ||
        after.size !== before.size || after.mtimeNs !== before.mtimeNs ||
        after.ctimeNs !== before.ctimeNs || BigInt(bytes.byteLength) !== before.size) {
      throw new TypeError("Build approval public-key registry changed during secure read.");
    }
    return Object.freeze({
      publicKeys: parseBuildApprovalPublicKeyRegistry(bytes),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  } catch (error) {
    if (error instanceof TypeError && /public-key registry/iu.test(error.message)) throw error;
    throw new TypeError("Build approval public-key registry is invalid.");
  } finally {
    await handle.close();
  }
}

export function assertBuildApproval(
  value: unknown,
  publicKeys: ReadonlyMap<string, BuildApprovalPublicKeyV1>,
): asserts value is BuildApprovalV1 {
  if (
    !isRecord(value) || !hasExactKeys(value, APPROVAL_KEYS) ||
    value.version !== BUILD_APPROVAL_VERSION ||
    typeof value.approvalManifestSha256 !== "string" || !LOWER_SHA256.test(value.approvalManifestSha256) ||
    typeof value.reviewerId !== "string" || !OPAQUE_ID.test(value.reviewerId) ||
    !validTimestamp(value.approvedAt) ||
    typeof value.publicKeyId !== "string" || !OPAQUE_ID.test(value.publicKeyId) ||
    value.signatureAlgorithm !== "Ed25519" ||
    typeof value.signatureBase64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value.signatureBase64)
  ) persistentError("BUILD_APPROVAL_INVALID");
  assertBuildApprovalCandidate(value.candidate);
  if (value.candidate.implementationActorIds.includes(value.reviewerId)) {
    persistentError("BUILD_APPROVAL_INVALID");
  }
  if (buildApprovalManifestSha256(value.candidate) !== value.approvalManifestSha256) {
    persistentError("BUILD_APPROVAL_INVALID");
  }
  const publicKeyEntry = publicKeys.get(value.publicKeyId);
  if (publicKeyEntry === undefined) persistentError("BUILD_APPROVAL_INVALID");
  assertPublicKeyEntry(publicKeyEntry);
  if (publicKeyEntry.reviewerId !== value.reviewerId ||
      !publicKeyEntry.allowedEnvironments.includes(value.candidate.environment) ||
      publicKeyEntry.role !== "independent-reviewer" ||
      publicKeyEntry.algorithm !== value.signatureAlgorithm) {
    persistentError("BUILD_APPROVAL_INVALID");
  }
  const signaturePayload = buildApprovalSignaturePayload({
    version: value.version,
    candidate: value.candidate,
    approvalManifestSha256: value.approvalManifestSha256,
    reviewerId: value.reviewerId,
    approvedAt: value.approvedAt,
    publicKeyId: value.publicKeyId,
    signatureAlgorithm: value.signatureAlgorithm,
  });
  const signature = Buffer.from(value.signatureBase64, "base64");
  if (signature.byteLength !== 64 || signature.toString("base64") !== value.signatureBase64) {
    persistentError("BUILD_APPROVAL_INVALID");
  }
  let valid = false;
  try {
    valid = verify(
      null,
      Buffer.from(signaturePayload, "utf8"),
      createPublicKey(publicKeyEntry.publicKeyPem),
      signature,
    );
  } catch {
    persistentError("BUILD_APPROVAL_INVALID");
  }
  if (!valid) persistentError("BUILD_APPROVAL_INVALID");
}

interface ApprovalRow extends Record<string, unknown> {
  readonly approval?: unknown;
}

export class PostgresBuildApprovalRegistry implements BuildApprovalRegistry {
  readonly version = BUILD_APPROVAL_REGISTRY_VERSION;
  readonly #database: PostgresDatabase;
  readonly #publicKeys: ReadonlyMap<string, BuildApprovalPublicKeyV1>;

  constructor(
    database: PostgresDatabase,
    publicKeys: ReadonlyMap<string, BuildApprovalPublicKeyV1>,
  ) {
    if (publicKeys.size < 1) persistentError("CONFIGURATION_INVALID");
    for (const [publicKeyId, entry] of publicKeys) {
      if (!OPAQUE_ID.test(publicKeyId)) persistentError("CONFIGURATION_INVALID");
      try {
        assertPublicKeyEntry(entry);
      } catch {
        persistentError("CONFIGURATION_INVALID");
      }
    }
    this.#database = database;
    this.#publicKeys = new Map(publicKeys);
  }

  async activate(approval: BuildApprovalV1): Promise<void> {
    assertBuildApproval(approval, this.#publicKeys);
    await this.#database.transaction(async (sql) => {
      await sql.query("LOCK TABLE compute_build_approval_events IN SHARE ROW EXCLUSIVE MODE");
      await sql.query(
        `INSERT INTO compute_build_approvals (
          approval_manifest_sha256, release_id, environment, git_commit,
          vercel_deployment_id, vercel_build_id, fly_image_digest, fly_build_id,
          reviewer_id, approved_at, approval
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
        ON CONFLICT (approval_manifest_sha256) DO NOTHING`,
        [approval.approvalManifestSha256, approval.candidate.releaseId,
          approval.candidate.environment, approval.candidate.gitCommit,
          approval.candidate.vercelDeploymentId, approval.candidate.vercelBuildId,
          approval.candidate.flyImageDigest, approval.candidate.flyBuildId,
          approval.reviewerId, approval.approvedAt, JSON.stringify(approval)],
      );
      const stored = await sql.query<ApprovalRow>(
        `SELECT approval FROM compute_build_approvals
         WHERE approval_manifest_sha256 = $1`,
        [approval.approvalManifestSha256],
      );
      const observed = stored.rows[0]?.approval;
      assertBuildApproval(observed, this.#publicKeys);
      if (canonicalStringify(observed) !== canonicalStringify(approval)) {
        persistentError("BUILD_APPROVAL_INVALID");
      }
      await sql.query(
        `INSERT INTO compute_build_approval_events (
          approval_manifest_sha256, environment, event_type, actor_id, occurred_at
        ) VALUES ($1,$2,'activated',$3,$4)
        ON CONFLICT (approval_manifest_sha256, event_type, actor_id, occurred_at)
        DO NOTHING`,
        [approval.approvalManifestSha256, approval.candidate.environment,
          approval.reviewerId, approval.approvedAt],
      );
    });
  }

  async revoke(manifestSha256: string, revokedAt: string, actorId: string): Promise<void> {
    if (!LOWER_SHA256.test(manifestSha256) || !validTimestamp(revokedAt) ||
        !OPAQUE_ID.test(actorId)) {
      persistentError("BUILD_APPROVAL_INVALID");
    }
    await this.#database.transaction(async (sql) => {
      await sql.query("LOCK TABLE compute_build_approval_events IN SHARE ROW EXCLUSIVE MODE");
      const approval = await sql.query<ApprovalRow>(
        `SELECT approval FROM compute_build_approvals
         WHERE approval_manifest_sha256 = $1`,
        [manifestSha256],
      );
      if (approval.rows[0]?.approval === undefined) {
        persistentError("BUILD_APPROVAL_INVALID");
      }
      await sql.query(
        `INSERT INTO compute_build_approval_events (
          approval_manifest_sha256, environment, event_type, actor_id, occurred_at
        ) SELECT approval_manifest_sha256, environment, 'revoked', $2, $3
          FROM compute_build_approvals WHERE approval_manifest_sha256 = $1
        ON CONFLICT (approval_manifest_sha256, event_type, actor_id, occurred_at)
        DO NOTHING`,
        [manifestSha256, actorId, revokedAt],
      );
    });
  }

  async isActive(expected: ExpectedRuntimeBuildV1): Promise<boolean> {
    if (!isRecord(expected) || !hasExactKeys(expected, [
      "releaseId", "environment", "gitCommit", "vercelDeploymentId",
      "vercelBuildId", "flyImageDigest", "flyBuildId", "approvalManifestSha256",
      "migrationManifestSha256", "publicKeyRegistrySha256",
      "materializationManifestSha256", "contractVersions",
      "jenaVersion", "jenaCommit",
      "jenaTarballIntegrity", "sdkVersion", "buildId",
    ])) return false;
    const result = await this.#database.query<ApprovalRow>(
      `WITH latest_activation AS (
         SELECT event_id, approval_manifest_sha256
         FROM compute_build_approval_events
         WHERE environment = $3 AND event_type = 'activated'
         ORDER BY event_id DESC LIMIT 1
       )
       SELECT approval FROM latest_activation active
       JOIN compute_build_approvals approval
         ON approval.approval_manifest_sha256 = active.approval_manifest_sha256
       WHERE approval.approval_manifest_sha256 = $1 AND approval.release_id = $2
         AND approval.environment = $3 AND approval.git_commit = $4
         AND approval.vercel_deployment_id = $5 AND approval.vercel_build_id = $6
         AND approval.fly_image_digest = $7 AND approval.fly_build_id = $8
         AND NOT EXISTS (
           SELECT 1 FROM compute_build_approval_events revoked
           WHERE revoked.approval_manifest_sha256 = active.approval_manifest_sha256
             AND revoked.event_type = 'revoked' AND revoked.event_id > active.event_id
         )`,
      [expected.approvalManifestSha256, expected.releaseId, expected.environment,
        expected.gitCommit, expected.vercelDeploymentId, expected.vercelBuildId,
        expected.flyImageDigest, expected.flyBuildId],
    );
    const approval = result.rows[0]?.approval;
    if (approval === undefined) return false;
    try {
      assertBuildApproval(approval, this.#publicKeys);
      return approval.candidate.migrationManifestSha256 ===
          expected.migrationManifestSha256 &&
        approval.candidate.publicKeyRegistrySha256 ===
          expected.publicKeyRegistrySha256 &&
        approval.candidate.materializationManifestSha256 ===
          expected.materializationManifestSha256 &&
        canonicalStringify(approval.candidate.contractVersions) ===
          canonicalStringify(expected.contractVersions) &&
        approval.candidate.jenaVersion === expected.jenaVersion &&
        approval.candidate.jenaCommit === expected.jenaCommit &&
        approval.candidate.jenaTarballIntegrity === expected.jenaTarballIntegrity &&
        approval.candidate.sdkVersion === expected.sdkVersion &&
        approval.candidate.buildId === expected.buildId;
    } catch {
      return false;
    }
  }
}

export class BuildApprovalReadinessProbe implements ComputeHttpReadinessProbe {
  readonly #registry: BuildApprovalRegistry;
  readonly #expected: ExpectedRuntimeBuildV1;
  readonly #dependencies: readonly (() => Promise<boolean>)[];

  constructor(input: Readonly<{
    registry: BuildApprovalRegistry;
    expected: ExpectedRuntimeBuildV1;
    dependencies?: readonly (() => Promise<boolean>)[];
  }>) {
    this.#registry = input.registry;
    this.#expected = cloneFrozen(input.expected);
    this.#dependencies = [...(input.dependencies ?? [])];
  }

  async check(): Promise<boolean> {
    try {
      if (!(await this.#registry.isActive(this.#expected))) return false;
      for (const dependency of this.#dependencies) {
        if (!(await dependency())) return false;
      }
      return true;
    } catch {
      return false;
    }
  }
}
