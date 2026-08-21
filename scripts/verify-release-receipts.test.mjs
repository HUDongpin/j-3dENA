import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectReleaseReceipts,
  REQUIRED_RELEASE_RECEIPTS,
} from "./verify-release-receipts.mjs";

const BUILD_HASH = "a".repeat(64);
const IMPLEMENTERS = ["actor-integration-0001", "actor-science-0001", "actor-compute-0001", "actor-web-0001"];

function details(kind, required) {
  const value = {};
  for (const field of ["browser", "platform", "assistiveTechnology", "decision", "trafficPercent"]) {
    if (required[field] !== undefined) value[field] = required[field];
  }
  if (required.minimumMachines !== undefined) {
    value.machineCount = required.minimumMachines;
    value.peakRssFractionOfLimit = 0.5;
  }
  if (kind === "stress-2h" || kind === "soak-24h") {
    Object.assign(value, {
      stalePublications: 0,
      capacityLeaks: 0,
      rawLogLeaks: 0,
      expiredReadableObjects: 0,
      unexplainedWorkerExits: 0,
      memoryUpwardDrift: 0,
    });
  }
  if (kind === "deletion-probe") {
    value.expiredReadableObjects = 0;
    value.maxDeletionLagMs = 23 * 60 * 60 * 1000;
  }
  if (kind === "parser-fuzz") {
    Object.assign(value, {
      contract: required.contract,
      totalCases: required.minimumCases,
      seedCount: required.minimumSeeds,
      targetCount: required.targetCount,
      strategyCount: required.strategyCount,
      failedTests: 0,
      pendingTests: 0,
      rawMarkerLeaks: 0,
      nonContractExceptions: 0,
      maxOldSpaceMb: required.maximumHeapMb,
      sourceBundleSha256: "d".repeat(64),
      vitestReportSha256: "e".repeat(64),
    });
  }
  if (kind === "rollback") {
    Object.assign(value, {
      vercelRestored: true,
      flyDigestRestored: true,
      migrationBackwardCompatible: true,
      contractsFenced: true,
      runningJobsSafe: true,
      sweeperStillActive: true,
    });
  }
  return value;
}

function validManifest() {
  let cursor = Date.parse("2026-08-21T00:00:00Z");
  const receipts = Object.entries(REQUIRED_RELEASE_RECEIPTS).map(([kind, required], index) => {
    const durationMs = required.minimumDurationMs ?? 60_000;
    const startedAt = new Date(cursor).toISOString();
    const completedAt = new Date(cursor + durationMs).toISOString();
    cursor += durationMs + 60_000;
    return {
      receiptId: `receipt-${String(index).padStart(2, "0")}-${kind}`,
      kind,
      buildApprovalManifestHash: BUILD_HASH,
      artifactSha256: String(index % 10).repeat(64),
      approverActorId: `actor-reviewer-${String(index).padStart(4, "0")}`,
      startedAt,
      completedAt,
      durationMs,
      outcome: "passed",
      environment: required.environment ?? "production",
      deploymentId: required.environment === "preview" ? "vercel-preview-0001" : "production-deployment-0001",
      details: details(kind, required),
    };
  });
  return {
    schemaVersion: "3dena.release-receipts.v1",
    releaseId: "release-2026-08-21-0001",
    gitCommit: "b".repeat(40),
    environment: "production",
    buildApprovalId: "build-approval-0001",
    buildApprovalManifestHash: BUILD_HASH,
    implementationActorIds: IMPLEMENTERS,
    receipts,
  };
}

test("accepts the complete exact-build release matrix", () => {
  const manifest = validManifest();
  const result = inspectReleaseReceipts(manifest);
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
  assert.equal(result.evidence.required, Object.keys(REQUIRED_RELEASE_RECEIPTS).length);
});

test("rejects a missing real Safari receipt, a mixed build, and implementer self-approval", () => {
  const manifest = validManifest();
  manifest.receipts = manifest.receipts.filter(({ kind }) => kind !== "safari-real");
  manifest.receipts[0].buildApprovalManifestHash = "c".repeat(64);
  manifest.receipts[1].approverActorId = IMPLEMENTERS[0];
  const result = inspectReleaseReceipts(manifest);
  assert.equal(result.ok, false);
  const rules = new Set(result.findings.map(({ rule }) => rule));
  assert.ok(rules.has("required-receipt-count"));
  assert.ok(rules.has("mixed-build"));
  assert.ok(rules.has("independent-approver"));
});

test("rejects shortened soak, canary order drift, deletion failure and incomplete rollback", () => {
  const manifest = validManifest();
  const byKind = new Map(manifest.receipts.map((receipt) => [receipt.kind, receipt]));
  const soak = byKind.get("soak-24h");
  soak.durationMs = 60_000;
  soak.completedAt = new Date(Date.parse(soak.startedAt) + 60_000).toISOString();
  const canary5 = byKind.get("canary-5");
  const canary25 = byKind.get("canary-25");
  canary25.startedAt = canary5.startedAt;
  canary25.completedAt = new Date(Date.parse(canary25.startedAt) + canary25.durationMs).toISOString();
  byKind.get("deletion-probe").details.expiredReadableObjects = 1;
  byKind.get("rollback").details.sweeperStillActive = false;
  const result = inspectReleaseReceipts(manifest);
  assert.equal(result.ok, false);
  const rules = new Set(result.findings.map(({ rule }) => rule));
  assert.ok(rules.has("minimum-duration"));
  assert.ok(rules.has("canary-order"));
  assert.ok(rules.has("expired-object-readable"));
  assert.ok(rules.has("rollback-invariant"));
});

test("rejects a weakened or unbound parser fuzz receipt", () => {
  const manifest = validManifest();
  const fuzz = manifest.receipts.find(({ kind }) => kind === "parser-fuzz");
  fuzz.details.totalCases = 128;
  fuzz.details.rawMarkerLeaks = 1;
  fuzz.details.maxOldSpaceMb = 8_192;
  fuzz.details.vitestReportSha256 = "not-a-hash";
  const result = inspectReleaseReceipts(manifest);
  assert.equal(result.ok, false);
  const rules = new Set(result.findings.map(({ rule }) => rule));
  assert.ok(rules.has("parser-fuzz-minimum"));
  assert.ok(rules.has("parser-fuzz-invariant"));
  assert.ok(rules.has("parser-fuzz-heap"));
  assert.ok(rules.has("parser-fuzz-hash"));
});
