#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_MANIFEST = resolve(
  fileURLToPath(new URL("../evidence/release/active-release-receipts.json", import.meta.url)),
);
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_SHA = /^[0-9a-f]{40}$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{5,255}$/u;

export const REQUIRED_RELEASE_RECEIPTS = Object.freeze({
  "clean-checkout": {},
  "sdk-consumers": {},
  chromium: { browser: "Chromium" },
  firefox: { browser: "Firefox" },
  "playwright-webkit": { browser: "Playwright WebKit" },
  "safari-real": { browser: "Safari", platform: "macOS" },
  "voiceover-safari": { assistiveTechnology: "VoiceOver", browser: "Safari" },
  "nvda-firefox": { assistiveTechnology: "NVDA", browser: "Firefox" },
  codeql: {},
  "secret-scan": {},
  "npm-audit": {},
  "sbom-lock-graph": {},
  "parser-fuzz": {
    contract: "3dena.parser-fuzz-execution.v1",
    minimumCases: 6_912,
    minimumSeeds: 3,
    targetCount: 2,
    strategyCount: 6,
    maximumHeapMb: 1_024,
  },
  "container-scan": {
    contract: "3dena.container-scan-receipt.v1",
    scannerName: "Trivy",
    scannerVersion: "0.70.0",
    runtimeUser: "10001:10001",
  },
  "license-legal": { decision: "approved" },
  preview: { environment: "preview" },
  "capacity-multi-machine": { minimumMachines: 2 },
  "stress-2h": { minimumDurationMs: 2 * 60 * 60 * 1000 },
  "soak-24h": { minimumDurationMs: 24 * 60 * 60 * 1000 },
  "canary-5": { trafficPercent: 5, environment: "production" },
  "canary-25": { trafficPercent: 25, environment: "production" },
  "canary-100": { trafficPercent: 100, environment: "production" },
  rollback: { environment: "production" },
  "production-probe": { environment: "production" },
  "deletion-probe": { environment: "production" },
});

function finding(rule, path, detail) {
  return Object.freeze({ scope: "release-receipts", rule, path, detail });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, path, findings) {
  if (!isRecord(value)) {
    findings.push(finding("invalid-object", path, "Expected an object."));
    return false;
  }
  if (
    JSON.stringify(Object.keys(value).sort()) !==
    JSON.stringify([...expected].sort())
  ) {
    findings.push(finding("contract-fields", path, "Unknown or missing fields are rejected."));
    return false;
  }
  return true;
}

function validId(value) {
  return typeof value === "string" && ID.test(value);
}

function validateDetails(receipt, required, path, findings, manifestGitCommit) {
  if (!isRecord(receipt.details)) {
    findings.push(finding("receipt-details", `${path}.details`, "Receipt details must be an object."));
    return;
  }
  for (const key of ["browser", "platform", "assistiveTechnology", "decision", "trafficPercent"]) {
    if (required[key] !== undefined && receipt.details[key] !== required[key]) {
      findings.push(finding("receipt-scope", `${path}.details.${key}`, `Expected ${JSON.stringify(required[key])}.`));
    }
  }
  if (
    required.minimumMachines !== undefined &&
    (!Number.isSafeInteger(receipt.details.machineCount) ||
      receipt.details.machineCount < required.minimumMachines)
  ) {
    findings.push(finding("machine-count", `${path}.details.machineCount`, `Expected at least ${required.minimumMachines} real Machines.`));
  }
  if (required.minimumDurationMs !== undefined && receipt.durationMs < required.minimumDurationMs) {
    findings.push(finding("minimum-duration", `${path}.durationMs`, `Expected at least ${required.minimumDurationMs} ms.`));
  }
  if (receipt.kind === "stress-2h" || receipt.kind === "soak-24h") {
    for (const zeroField of [
      "stalePublications",
      "capacityLeaks",
      "rawLogLeaks",
      "expiredReadableObjects",
      "unexplainedWorkerExits",
      "memoryUpwardDrift",
    ]) {
      if (receipt.details[zeroField] !== 0) {
        findings.push(finding("soak-invariant", `${path}.details.${zeroField}`, "Expected zero."));
      }
    }
  }
  if (receipt.kind === "capacity-multi-machine") {
    if (
      typeof receipt.details.peakRssFractionOfLimit !== "number" ||
      !Number.isFinite(receipt.details.peakRssFractionOfLimit) ||
      receipt.details.peakRssFractionOfLimit > 0.5
    ) {
      findings.push(finding("memory-headroom", `${path}.details.peakRssFractionOfLimit`, "Peak child RSS must be no more than 50% of the container limit."));
    }
  }
  if (receipt.kind === "deletion-probe") {
    if (receipt.details.expiredReadableObjects !== 0) {
      findings.push(finding("expired-object-readable", `${path}.details.expiredReadableObjects`, "No object may remain readable at 24 hours."));
    }
    if (
      !Number.isSafeInteger(receipt.details.maxDeletionLagMs) ||
      receipt.details.maxDeletionLagMs < 0 ||
      receipt.details.maxDeletionLagMs > 24 * 60 * 60 * 1000
    ) {
      findings.push(finding("deletion-lag", `${path}.details.maxDeletionLagMs`, "Deletion lag must be observed and no greater than 24 hours."));
    }
  }
  if (receipt.kind === "parser-fuzz") {
    if (receipt.details.contract !== required.contract) {
      findings.push(finding("parser-fuzz-contract", `${path}.details.contract`, "Exact parser fuzz execution contract is required."));
    }
    for (const [field, minimum] of [
      ["totalCases", required.minimumCases],
      ["seedCount", required.minimumSeeds],
    ]) {
      if (!Number.isSafeInteger(receipt.details[field]) || receipt.details[field] < minimum) {
        findings.push(finding("parser-fuzz-minimum", `${path}.details.${field}`, `Expected at least ${minimum}.`));
      }
    }
    for (const [field, expected] of [
      ["targetCount", required.targetCount],
      ["strategyCount", required.strategyCount],
      ["failedTests", 0],
      ["pendingTests", 0],
      ["rawMarkerLeaks", 0],
      ["nonContractExceptions", 0],
    ]) {
      if (receipt.details[field] !== expected) {
        findings.push(finding("parser-fuzz-invariant", `${path}.details.${field}`, `Expected ${expected}.`));
      }
    }
    if (
      !Number.isSafeInteger(receipt.details.maxOldSpaceMb) ||
      receipt.details.maxOldSpaceMb < 256 ||
      receipt.details.maxOldSpaceMb > required.maximumHeapMb
    ) {
      findings.push(finding("parser-fuzz-heap", `${path}.details.maxOldSpaceMb`, `Expected a heap ceiling no greater than ${required.maximumHeapMb} MiB.`));
    }
    for (const hashField of ["sourceBundleSha256", "vitestReportSha256"]) {
      if (!SHA256.test(receipt.details[hashField])) {
        findings.push(finding("parser-fuzz-hash", `${path}.details.${hashField}`, "Exact parser fuzz source and report SHA-256 values are required."));
      }
    }
  }
  if (receipt.kind === "container-scan") {
    for (const [field, expected] of [
      ["contract", required.contract],
      ["scannerName", required.scannerName],
      ["scannerVersion", required.scannerVersion],
      ["runtimeUser", required.runtimeUser],
      ["sourceHeadCommit", manifestGitCommit],
      ["resultCount", 0],
      ["bakedSensitiveEnvironmentVariables", 0],
    ]) {
      if (receipt.details[field] !== expected) {
        findings.push(finding("container-scan-invariant", `${path}.details.${field}`, `Expected ${JSON.stringify(expected)}.`));
      }
    }
    if (!/^registry\.fly\.io\/[a-z0-9-]+@sha256:[a-f0-9]{64}$/u.test(receipt.details.imageRef)) {
      findings.push(finding("container-scan-image", `${path}.details.imageRef`, "An immutable Fly image digest reference is required."));
    }
    for (const hashField of ["imageInspectSha256", "sarifSha256"]) {
      if (!SHA256.test(receipt.details[hashField])) {
        findings.push(finding("container-scan-hash", `${path}.details.${hashField}`, "Exact Docker inspect and SARIF SHA-256 values are required."));
      }
    }
  }
  if (receipt.kind === "rollback") {
    for (const flag of [
      "vercelRestored",
      "flyDigestRestored",
      "migrationBackwardCompatible",
      "contractsFenced",
      "runningJobsSafe",
      "sweeperStillActive",
    ]) {
      if (receipt.details[flag] !== true) {
        findings.push(finding("rollback-invariant", `${path}.details.${flag}`, "Rollback proof must be true."));
      }
    }
  }
}

export function inspectReleaseReceipts(manifest) {
  const findings = [];
  if (
    !exactKeys(
      manifest,
      [
        "schemaVersion",
        "releaseId",
        "gitCommit",
        "environment",
        "buildApprovalId",
        "buildApprovalManifestHash",
        "implementationActorIds",
        "receipts",
      ],
      "manifest",
      findings,
    )
  ) {
    return { ok: false, findings, evidence: { required: Object.keys(REQUIRED_RELEASE_RECEIPTS).length, observed: 0 } };
  }
  if (manifest.schemaVersion !== "3dena.release-receipts.v1") {
    findings.push(finding("manifest-schema", "manifest.schemaVersion", "Unsupported release receipt schema."));
  }
  if (!validId(manifest.releaseId) || !validId(manifest.buildApprovalId)) {
    findings.push(finding("manifest-identity", "manifest", "Release and build approval IDs are required."));
  }
  if (!GIT_SHA.test(manifest.gitCommit) || !SHA256.test(manifest.buildApprovalManifestHash)) {
    findings.push(finding("build-identity", "manifest", "Exact Git and signed build approval hashes are required."));
  }
  if (manifest.environment !== "production") {
    findings.push(finding("production-environment", "manifest.environment", "Final release receipts must target production."));
  }
  if (
    !Array.isArray(manifest.implementationActorIds) ||
    manifest.implementationActorIds.length === 0 ||
    manifest.implementationActorIds.some((id) => !validId(id))
  ) {
    findings.push(finding("implementation-actors", "manifest.implementationActorIds", "Implementation actor IDs are required for reviewer separation."));
  }
  if (!Array.isArray(manifest.receipts)) {
    findings.push(finding("receipts", "manifest.receipts", "Expected a receipt array."));
    return { ok: false, findings, evidence: { required: Object.keys(REQUIRED_RELEASE_RECEIPTS).length, observed: 0 } };
  }

  const implementationActors = new Set(manifest.implementationActorIds);
  const byKind = new Map();
  const receiptIds = new Set();
  manifest.receipts.forEach((receipt, index) => {
    const path = `manifest.receipts[${index}]`;
    if (
      !exactKeys(
        receipt,
        [
          "receiptId",
          "kind",
          "buildApprovalManifestHash",
          "artifactSha256",
          "approverActorId",
          "startedAt",
          "completedAt",
          "durationMs",
          "outcome",
          "environment",
          "deploymentId",
          "details",
        ],
        path,
        findings,
      )
    ) {
      return;
    }
    const required = REQUIRED_RELEASE_RECEIPTS[receipt.kind];
    if (required === undefined) {
      findings.push(finding("unknown-receipt-kind", `${path}.kind`, "Receipt kind is outside the release matrix."));
      return;
    }
    const existing = byKind.get(receipt.kind) ?? [];
    existing.push(receipt);
    byKind.set(receipt.kind, existing);
    if (!validId(receipt.receiptId) || receiptIds.has(receipt.receiptId)) {
      findings.push(finding("receipt-id", `${path}.receiptId`, "Receipt ID is malformed or duplicated."));
    }
    receiptIds.add(receipt.receiptId);
    if (receipt.buildApprovalManifestHash !== manifest.buildApprovalManifestHash) {
      findings.push(finding("mixed-build", `${path}.buildApprovalManifestHash`, "Every receipt must bind the same active BuildApprovalV1 manifest."));
    }
    if (!SHA256.test(receipt.artifactSha256)) {
      findings.push(finding("artifact-hash", `${path}.artifactSha256`, "Immutable artifact SHA-256 is required."));
    }
    if (!validId(receipt.approverActorId) || implementationActors.has(receipt.approverActorId)) {
      findings.push(finding("independent-approver", `${path}.approverActorId`, "Approver must be identified and outside implementation roles."));
    }
    if (!UTC_TIMESTAMP.test(receipt.startedAt) || !UTC_TIMESTAMP.test(receipt.completedAt)) {
      findings.push(finding("receipt-time", path, "UTC start and completion times are required."));
    }
    const elapsed = Date.parse(receipt.completedAt) - Date.parse(receipt.startedAt);
    if (!Number.isSafeInteger(receipt.durationMs) || receipt.durationMs < 0 || elapsed !== receipt.durationMs) {
      findings.push(finding("receipt-duration", `${path}.durationMs`, "Duration must equal the UTC receipt interval exactly."));
    }
    if (receipt.outcome !== "passed") {
      findings.push(finding("receipt-outcome", `${path}.outcome`, "Only passed receipts satisfy a release gate."));
    }
    if (required.environment !== undefined && receipt.environment !== required.environment) {
      findings.push(finding("receipt-environment", `${path}.environment`, `Expected ${required.environment}.`));
    }
    if (!validId(receipt.deploymentId)) {
      findings.push(finding("deployment-id", `${path}.deploymentId`, "Exact deployment/build identity is required."));
    }
    validateDetails(receipt, required, path, findings, manifest.gitCommit);
  });

  for (const kind of Object.keys(REQUIRED_RELEASE_RECEIPTS)) {
    const observed = byKind.get(kind)?.length ?? 0;
    if (observed !== 1) {
      findings.push(finding("required-receipt-count", `manifest.receipts#${kind}`, `Expected exactly one receipt; observed ${observed}.`));
    }
  }

  const canaryTimes = ["canary-5", "canary-25", "canary-100"].map(
    (kind) => Date.parse(byKind.get(kind)?.[0]?.startedAt ?? ""),
  );
  if (canaryTimes.every(Number.isFinite) && !(canaryTimes[0] < canaryTimes[1] && canaryTimes[1] < canaryTimes[2])) {
    findings.push(finding("canary-order", "manifest.receipts", "Canary receipts must advance in 5%, 25%, 100% chronological order."));
  }

  findings.sort((left, right) => `${left.path}:${left.rule}`.localeCompare(`${right.path}:${right.rule}`));
  return {
    ok: findings.length === 0,
    findings,
    evidence: Object.freeze({
      required: Object.keys(REQUIRED_RELEASE_RECEIPTS).length,
      observed: manifest.receipts.length,
      buildApprovalManifestHash: SHA256.test(manifest.buildApprovalManifestHash)
        ? manifest.buildApprovalManifestHash
        : null,
    }),
  };
}

function samePath(left, right) {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return resolve(left) === resolve(right);
  }
}

if (samePath(process.argv[1] ?? "", SCRIPT_PATH)) {
  try {
    let manifestPath = DEFAULT_MANIFEST;
    for (let index = 2; index < process.argv.length; index += 1) {
      if (process.argv[index] === "--manifest" && process.argv[index + 1]) {
        manifestPath = resolve(process.argv[index + 1]);
        index += 1;
      } else if (process.argv[index] === "--help" || process.argv[index] === "-h") {
        process.stdout.write("Usage: node scripts/verify-release-receipts.mjs [--manifest <json>]\n");
        manifestPath = null;
      } else {
        throw new Error(`Unknown argument: ${process.argv[index]}`);
      }
    }
    if (manifestPath !== null) {
      if (!existsSync(manifestPath)) {
        const result = {
          ok: false,
          findings: [
            finding(
              "missing-release-manifest",
              "evidence/release/active-release-receipts.json",
              "The independently approved exact-build release receipt manifest is absent.",
            ),
          ],
          evidence: {
            required: Object.keys(REQUIRED_RELEASE_RECEIPTS).length,
            observed: 0,
            buildApprovalManifestHash: null,
          },
        };
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        process.exitCode = 1;
      } else {
        const result = inspectReleaseReceipts(
          JSON.parse(readFileSync(manifestPath, "utf8")),
        );
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        process.exitCode = result.ok ? 0 : 1;
      }
    }
  } catch (error) {
    process.stderr.write(`Release receipt verifier error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
