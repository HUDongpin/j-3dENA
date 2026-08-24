import { generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  BUILD_APPROVAL_CANDIDATE_VERSION,
  BUILD_APPROVAL_REGISTRY_VERSION,
  BUILD_APPROVAL_VERSION,
  type BuildApprovalCandidateV1,
  type BuildApprovalRegistry,
  type BuildApprovalV1,
  type ExpectedRuntimeBuildV1,
} from "./contracts";
import {
  assertBuildApproval,
  BuildApprovalReadinessProbe,
  buildApprovalManifestSha256,
  PostgresBuildApprovalRegistry,
} from "./build-approval";
import {
  PostgresDatabase,
  type PgCompatibleClient,
  type PgCompatiblePool,
  type SqlQueryResult,
} from "./postgres";

const hex = (character: string, length = 64): string => character.repeat(length);

function candidate(): BuildApprovalCandidateV1 {
  return {
    version: BUILD_APPROVAL_CANDIDATE_VERSION,
    releaseId: "release-20260821",
    environment: "production",
    gitCommit: hex("a", 40),
    vercelDeploymentId: "dpl-approved",
    vercelBuildId: "vercel-build-approved",
    flyImageDigest: `sha256:${hex("b")}`,
    flyBuildId: "fly-build-approved",
    analysisTarballSha256: hex("c"),
    jenaVersion: "0.7.0-ona.0",
    jenaCommit: hex("d", 40),
    jenaTarballSha256: hex("e"),
    jenaTarballIntegrity: "sha512-ZXhhY3QtamVuYS10YXJiYWxs",
    sdkVersion: "0.2.0-implemented-unverified.4",
    buildId: "approved-longitudinal-build-1",
    lockfileSha256: hex("f"),
    sbomSha256: hex("1"),
    schemaBundleSha256: hex("2"),
    migrationManifestSha256: hex("3"),
    contractVersions: ["3dena.compute-http.v1", "3dena.contract.v1"],
    implementationActorIds: ["compute-implementer-1", "release-implementer-1"],
  };
}

class ApprovalPool implements PgCompatiblePool, PgCompatibleClient {
  readonly statements: string[] = [];
  readonly approvals = new Map<string, BuildApprovalV1>();
  readonly events: Array<Readonly<{
    id: number;
    manifest: string;
    environment: string;
    type: "activated" | "revoked";
  }>> = [];

  async connect(): Promise<PgCompatibleClient> { return this; }
  release(): void {}

  async query<Row extends Record<string, unknown>>(
    sql: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.statements.push(sql);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) || sql.startsWith("LOCK TABLE")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("INSERT INTO compute_build_approvals")) {
      const approval = JSON.parse(String(values[10])) as BuildApprovalV1;
      this.approvals.set(String(values[0]), approval);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("SELECT approval FROM compute_build_approvals")) {
      const approval = this.approvals.get(String(values[0]));
      return {
        rows: (approval === undefined ? [] : [{ approval }]) as unknown as Row[],
        rowCount: approval === undefined ? 0 : 1,
      };
    }
    if (sql.includes("event_type, actor_id") && sql.includes("'activated'")) {
      this.events.push({
        id: this.events.length + 1,
        manifest: String(values[0]),
        environment: String(values[1]),
        type: "activated",
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("event_type, actor_id") && sql.includes("'revoked'")) {
      const approval = this.approvals.get(String(values[0]));
      if (approval !== undefined) this.events.push({
        id: this.events.length + 1,
        manifest: String(values[0]),
        environment: approval.candidate.environment,
        type: "revoked",
      });
      return { rows: [], rowCount: approval === undefined ? 0 : 1 };
    }
    if (sql.includes("WITH latest_activation")) {
      const expectedManifest = String(values[0]);
      const environment = String(values[2]);
      const latest = [...this.events].reverse().find(
        (event) => event.environment === environment && event.type === "activated",
      );
      const revoked = latest === undefined ? false : this.events.some(
        (event) => event.manifest === latest.manifest && event.type === "revoked" && event.id > latest.id,
      );
      const approval = latest?.manifest === expectedManifest && !revoked
        ? this.approvals.get(expectedManifest)
        : undefined;
      const matches = approval !== undefined &&
        approval.candidate.releaseId === values[1] &&
        approval.candidate.gitCommit === values[3] &&
        approval.candidate.vercelDeploymentId === values[4] &&
        approval.candidate.vercelBuildId === values[5] &&
        approval.candidate.flyImageDigest === values[6] &&
        approval.candidate.flyBuildId === values[7];
      return {
        rows: (matches ? [{ approval }] : []) as unknown as Row[],
        rowCount: matches ? 1 : 0,
      };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

describe("BuildApprovalV1", () => {
  it("cryptographically binds every exact-build field and rejects mutation", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const manifest = candidate();
    const digest = buildApprovalManifestSha256(manifest);
    const approval: BuildApprovalV1 = {
      version: BUILD_APPROVAL_VERSION,
      candidate: manifest,
      approvalManifestSha256: digest,
      reviewerId: "reviewer-independent-1",
      approvedAt: "2026-08-21T12:00:00.000Z",
      publicKeyId: "release-key-1",
      signatureAlgorithm: "Ed25519",
      signatureBase64: sign(null, Buffer.from(digest, "ascii"), privateKey).toString("base64"),
    };
    expect(() => assertBuildApproval(approval, new Map([["release-key-1", publicKey]])))
      .not.toThrow();
    let rejected: unknown;
    try {
      assertBuildApproval({
        ...approval,
        candidate: { ...manifest, flyBuildId: "mixed-build" },
      }, new Map([["release-key-1", publicKey]]));
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toMatchObject({ code: "BUILD_APPROVAL_INVALID" });
    expect(() => assertBuildApproval({
      ...approval,
      reviewerId: "compute-implementer-1",
    }, new Map([["release-key-1", publicKey]]))).toThrowError();
  });

  it("keeps readiness fail-closed for missing approval or dependency failure", async () => {
    const expected: ExpectedRuntimeBuildV1 = {
      releaseId: "release-20260821",
      environment: "production",
      gitCommit: hex("a", 40),
      vercelDeploymentId: "dpl-approved",
      vercelBuildId: "vercel-build-approved",
      flyImageDigest: `sha256:${hex("b")}`,
      flyBuildId: "fly-build-approved",
      approvalManifestSha256: hex("c"),
      migrationManifestSha256: hex("3"),
      contractVersions: ["3dena.compute-http.v1", "3dena.contract.v1"],
      jenaVersion: "0.7.0-ona.0",
      jenaCommit: hex("d", 40),
      jenaTarballIntegrity: "sha512-ZXhhY3QtamVuYS10YXJiYWxs",
      sdkVersion: "0.2.0-implemented-unverified.4",
      buildId: "approved-longitudinal-build-1",
    };
    let active = false;
    const registry: BuildApprovalRegistry = {
      version: BUILD_APPROVAL_REGISTRY_VERSION,
      activate: async () => undefined,
      revoke: async () => undefined,
      isActive: async () => active,
    };
    const dependencies = [async () => true, async () => false];
    const probe = new BuildApprovalReadinessProbe({ registry, expected, dependencies });
    await expect(probe.check()).resolves.toBe(false);
    active = true;
    await expect(probe.check()).resolves.toBe(false);
    const ready = new BuildApprovalReadinessProbe({
      registry,
      expected,
      dependencies: [async () => true],
    });
    await expect(ready.check()).resolves.toBe(true);
  });

  it("derives active/non-revoked exact builds from append-only events", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const manifest = candidate();
    const digest = buildApprovalManifestSha256(manifest);
    const approval: BuildApprovalV1 = {
      version: BUILD_APPROVAL_VERSION,
      candidate: manifest,
      approvalManifestSha256: digest,
      reviewerId: "reviewer-independent-1",
      approvedAt: "2026-08-21T12:00:00.000Z",
      publicKeyId: "release-key-1",
      signatureAlgorithm: "Ed25519",
      signatureBase64: sign(null, Buffer.from(digest, "ascii"), privateKey).toString("base64"),
    };
    const expected: ExpectedRuntimeBuildV1 = {
      releaseId: manifest.releaseId,
      environment: manifest.environment,
      gitCommit: manifest.gitCommit,
      vercelDeploymentId: manifest.vercelDeploymentId,
      vercelBuildId: manifest.vercelBuildId,
      flyImageDigest: manifest.flyImageDigest,
      flyBuildId: manifest.flyBuildId,
      approvalManifestSha256: digest,
      migrationManifestSha256: manifest.migrationManifestSha256,
      contractVersions: manifest.contractVersions,
      jenaVersion: manifest.jenaVersion,
      jenaCommit: manifest.jenaCommit,
      jenaTarballIntegrity: manifest.jenaTarballIntegrity,
      sdkVersion: manifest.sdkVersion,
      buildId: manifest.buildId,
    };
    const pool = new ApprovalPool();
    const registry = new PostgresBuildApprovalRegistry(
      new PostgresDatabase(pool),
      new Map([["release-key-1", publicKey]]),
    );
    await expect(registry.isActive(expected)).resolves.toBe(false);
    await registry.activate(approval);
    await expect(registry.isActive(expected)).resolves.toBe(true);
    await expect(registry.isActive({ ...expected, flyBuildId: "mixed-build" }))
      .resolves.toBe(false);
    await expect(registry.isActive({ ...expected, migrationManifestSha256: hex("9") }))
      .resolves.toBe(false);
    for (const changed of [
      { ...expected, jenaVersion: "0.7.0-drift" },
      { ...expected, jenaCommit: hex("9", 40) },
      { ...expected, jenaTarballIntegrity: "sha512-ZHJpZnQ=" },
      { ...expected, sdkVersion: "0.2.0-drift" },
      { ...expected, buildId: "unsigned-build-drift" },
    ]) {
      await expect(registry.isActive(changed)).resolves.toBe(false);
    }
    await registry.revoke(digest, "2026-08-21T12:30:00.000Z", "release-operator-2");
    await expect(registry.isActive(expected)).resolves.toBe(false);
    expect(pool.statements.join("\n")).not.toMatch(/UPDATE\s+compute_build/iu);
    expect(pool.events.map((event) => event.type)).toEqual(["activated", "revoked"]);
  });
});
