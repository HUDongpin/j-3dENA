import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  inspectReleaseReceipts,
  REQUIRED_RELEASE_RECEIPTS,
} from "./verify-release-receipts.mjs";
import { createContainerScanReceipt } from "./verify-container-scan-evidence.mjs";
import {
  BUILD_APPROVAL_ARTIFACT_BOUNDS_V1,
  prepareBuildApprovalInputs,
  writePreparedBuildApprovalOutput,
} from "../packages/compute-service-persistent/deploy/build-approval-inputs-lib.mjs";

const IMPLEMENTERS = [
  "actor-compute-0001",
  "actor-integration-0001",
  "actor-science-0001",
  "actor-web-0001",
];
const GIT_COMMIT = "b0123456789abcdef0123456789abcdef0123456";
const JENA_COMMIT = "c0123456789abcdef0123456789abcdef0123456";
const FLY_IMAGE_DIGEST =
  "sha256:c123456789abcdefc123456789abcdefc123456789abcdefc123456789abcdef";
const IMAGE_REF = `registry.fly.io/j-3dena-compute@${FLY_IMAGE_DIGEST}`;
const PUBLIC_KEY_ID = "release-key-0001";
const REVIEWER_ID = "actor-release-reviewer-0001";
const SIGNERS = new WeakMap();
const BUILD_RECEIPTS = new Set([
  "clean-checkout", "sdk-consumers", "codeql", "secret-scan", "npm-audit",
  "sbom-lock-graph", "parser-fuzz", "license-legal",
]);
const VERCEL_RECEIPTS = new Set([
  "chromium", "firefox", "playwright-webkit", "safari-real",
  "voiceover-safari", "nvda-firefox", "preview",
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function details(kind, required, scanReceipt, approval) {
  const candidate = approval.candidate;
  const value = {};
  if (BUILD_RECEIPTS.has(kind)) {
    value.buildId = candidate.buildId;
  } else if (VERCEL_RECEIPTS.has(kind)) {
    value.vercelDeploymentId = candidate.vercelDeploymentId;
    value.vercelBuildId = candidate.vercelBuildId;
  } else {
    value.flyBuildId = candidate.flyBuildId;
    value.flyImageDigest = candidate.flyImageDigest;
  }
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
  if (kind === "container-scan") {
    Object.assign(value, {
      contract: required.contract,
      imageRef: scanReceipt.image.ref,
      sourceHeadCommit: scanReceipt.image.sourceHeadCommit,
      scannerName: scanReceipt.scanner.name,
      scannerVersion: scanReceipt.scanner.version,
      resultCount: scanReceipt.scan.resultCount,
      bakedSensitiveEnvironmentVariables:
        scanReceipt.image.bakedSensitiveEnvironmentVariables,
      runtimeUser: scanReceipt.image.user,
      imageInspectSha256: scanReceipt.image.inspectSha256,
      trivyJsonSha256: scanReceipt.scan.reportSha256,
      publicKeyRegistrySha256: scanReceipt.image.publicKeyRegistry.sha256,
      publicKeyRegistryRawSha256:
        scanReceipt.image.publicKeyRegistry.rawSha256,
      publicKeyRegistryVerificationSha256:
        scanReceipt.image.publicKeyRegistry.verificationSha256,
      publicKeyCount: scanReceipt.image.publicKeyRegistry.publicKeyCount,
      receiptPath: "container-scan-receipt.json",
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
  if (kind === "production-probe") {
    Object.assign(value, {
      contract: "3dena.production-readiness-evidence.v1",
      readinessPath: "production-readiness.json",
      approvalManifestSha256: approval.approvalManifestSha256,
      runtimeRole: "api",
    });
  }
  return value;
}

function deploymentIdFor(kind, candidate) {
  if (BUILD_RECEIPTS.has(kind)) return candidate.buildId;
  if (VERCEL_RECEIPTS.has(kind)) return candidate.vercelDeploymentId;
  return candidate.flyBuildId;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function createScanEvidence(directory, publicKeyRegistrySha256) {
  const inspectPath = join(directory, "docker-inspect.json");
  const publicKeyVerificationPath = join(
    directory,
    "public-key-registry-verification.json",
  );
  const trivyJsonPath = join(directory, "trivy-exact-image.json");
  writeFileSync(inspectPath, `${JSON.stringify([{
    RepoDigests: [IMAGE_REF],
    Os: "linux",
    Architecture: "amd64",
    Config: {
      User: "10001:10001",
      Entrypoint: ["/usr/local/bin/compute-entrypoint"],
      Cmd: ["api"],
      Healthcheck: {
        Test: [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:8080/readyz',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))",
        ],
        Interval: 15_000_000_000,
        Timeout: 5_000_000_000,
        StartPeriod: 10_000_000_000,
        Retries: 3,
      },
      Labels: {
        "org.opencontainers.image.revision": GIT_COMMIT,
        "org.opencontainers.image.source": "https://github.com/HUDongpin/j-3dENA",
        "org.3dena.build-approval-public-keys.sha256": publicKeyRegistrySha256,
      },
      Env: ["NODE_ENV=production", "HOME=/nonexistent"],
    },
  }])}\n`);
  writeFileSync(publicKeyVerificationPath, `${JSON.stringify({
    schemaVersion: "3dena.image-public-key-registry-verification.v1",
    publicKeyCount: 1,
    sha256: publicKeyRegistrySha256,
    verified: true,
  })}\n`);
  writeFileSync(trivyJsonPath, `${JSON.stringify({
    SchemaVersion: 2,
    Trivy: { Version: "0.70.0" },
    ArtifactName: IMAGE_REF,
    ArtifactType: "container_image",
    Metadata: { RepoDigests: [IMAGE_REF] },
    Results: [],
  })}\n`);
  return createContainerScanReceipt({
    evidenceRoot: directory,
    trivyJson: trivyJsonPath,
    inspect: inspectPath,
    publicKeyRegistry: join(directory, "build-approval-public-keys.json"),
    publicKeyVerification: publicKeyVerificationPath,
    imageRef: IMAGE_REF,
    expectedPublicKeyRegistrySha256: publicKeyRegistrySha256,
    repository: "HUDongpin/j-3dENA",
    sourceHeadCommit: GIT_COMMIT,
    runId: "123456",
    runAttempt: "1",
  });
}

async function buildApprovalArtifacts(directory) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = String(publicKey.export({ format: "pem", type: "spki" }));
  const publicKeyRegistry = {
    "release-key-0001": {
      algorithm: "Ed25519",
      allowedEnvironments: ["preview", "production"],
      publicKeyPem,
      reviewerId: "actor-release-reviewer-0001",
      role: "independent-reviewer",
    },
  };
  const publicKeyRegistryBytes = `${canonical(publicKeyRegistry)}\n`;
  writeFileSync(join(directory, "build-approval-public-keys.json"), publicKeyRegistryBytes);

  const sourceBytes = {
    analysisTarball: Buffer.from("fixture analysis tarball\n"),
    jenaTarball: Buffer.from("fixture Jena tarball\n"),
    lockfile: Buffer.from('{"lockfileVersion":3}\n'),
    sbom: Buffer.from('{"bomFormat":"CycloneDX"}\n'),
    migration: Buffer.from("SELECT 1;\n"),
  };
  for (const [name, bytes] of Object.entries(sourceBytes)) {
    writeFileSync(join(directory, `${name}.fixture`), bytes);
  }
  mkdirSync(join(directory, "schemas"));
  const schemaDocument = `${canonical({
    $id: "https://schemas.3dena.example/runtime.json",
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
  })}\n`;
  const schemaIndex = `${canonical({
    schemaVersion: "3dena.schema-index.v1",
    schemas: { Runtime: "runtime.json" },
  })}\n`;
  writeFileSync(join(directory, "schemas/runtime.json"), schemaDocument);
  writeFileSync(join(directory, "schemas/index.json"), schemaIndex);

  const descriptor = (path, bytes) => ({ path, sha256: sha256(bytes) });
  const materializationInput = {
    schemaVersion: "3dena.build-approval-materialization-input.v1",
    candidate: {
      releaseId: "release-2026-08-21-0001",
      environment: "production",
      gitCommit: GIT_COMMIT,
      vercelDeploymentId: "production-deployment-0001",
      vercelBuildId: "vercel-build-0001",
      flyImageDigest: FLY_IMAGE_DIGEST,
      flyBuildId: "fly-build-0001",
      jenaVersion: "0.7.0-ona.0",
      jenaCommit: JENA_COMMIT,
      sdkVersion: "0.2.0-implemented-unverified.11",
      buildId: "build-approval-v4-0001",
      migrations: [{
        version: "0005",
        ...descriptor("migration.fixture", sourceBytes.migration),
      }],
      contractVersions: ["3dena.compute-http.v1", "3dena.contract.v1"],
      implementationActorIds: IMPLEMENTERS,
      artifacts: {
        analysisTarball: descriptor(
          "analysisTarball.fixture",
          sourceBytes.analysisTarball,
        ),
        jenaTarball: descriptor("jenaTarball.fixture", sourceBytes.jenaTarball),
        lockfile: descriptor("lockfile.fixture", sourceBytes.lockfile),
        sbom: descriptor("sbom.fixture", sourceBytes.sbom),
      },
    },
    schemaBundle: {
      index: descriptor("schemas/index.json", schemaIndex),
      schemas: [{
        name: "Runtime",
        ...descriptor("schemas/runtime.json", schemaDocument),
      }],
    },
    publicKeyRegistry: descriptor(
      "build-approval-public-keys.json",
      publicKeyRegistryBytes,
    ),
  };
  const prepared = await prepareBuildApprovalInputs(
    materializationInput,
    "materialized",
    directory,
  );
  await writePreparedBuildApprovalOutput(prepared, directory);
  const materializationManifestBytes = Buffer.from(
    prepared.files["build-approval-materialization-manifest.json"],
  );
  const candidate = {
    version: "3dena.build-approval-candidate.v4",
    releaseId: materializationInput.candidate.releaseId,
    environment: materializationInput.candidate.environment,
    gitCommit: materializationInput.candidate.gitCommit,
    vercelDeploymentId: materializationInput.candidate.vercelDeploymentId,
    vercelBuildId: materializationInput.candidate.vercelBuildId,
    flyImageDigest: materializationInput.candidate.flyImageDigest,
    flyBuildId: materializationInput.candidate.flyBuildId,
    analysisTarballSha256: sha256(sourceBytes.analysisTarball),
    jenaVersion: materializationInput.candidate.jenaVersion,
    jenaCommit: materializationInput.candidate.jenaCommit,
    jenaTarballSha256: sha256(sourceBytes.jenaTarball),
    jenaTarballIntegrity: `sha512-${createHash("sha512")
      .update(sourceBytes.jenaTarball).digest("base64")}`,
    sdkVersion: materializationInput.candidate.sdkVersion,
    buildId: materializationInput.candidate.buildId,
    lockfileSha256: sha256(sourceBytes.lockfile),
    sbomSha256: sha256(sourceBytes.sbom),
    schemaBundleSha256: prepared.manifest.outputs.schemaBundle.sha256,
    migrationManifestSha256: sha256(JSON.stringify([{
      sha256: sha256(sourceBytes.migration),
      version: "0005",
    }])),
    publicKeyRegistrySha256: sha256(publicKeyRegistryBytes),
    materializationManifestSha256: sha256(materializationManifestBytes),
    contractVersions: materializationInput.candidate.contractVersions,
    implementationActorIds: materializationInput.candidate.implementationActorIds,
  };
  const approvalManifestSha256 = sha256(canonical(candidate));
  const envelope = {
    version: "3dena.build-approval.v4",
    candidate,
    approvalManifestSha256,
    reviewerId: REVIEWER_ID,
    approvedAt: "2026-08-20T23:55:00.000Z",
    publicKeyId: PUBLIC_KEY_ID,
    signatureAlgorithm: "Ed25519",
  };
  const approval = {
    ...envelope,
    signatureBase64: sign(null, Buffer.from(canonical(envelope)), privateKey).toString("base64"),
  };
  const signedApprovalBytes = `${canonical(approval)}\n`;
  writeFileSync(join(directory, "signed-build-approval.json"), signedApprovalBytes);
  return {
    approval,
    privateKey,
    descriptor: {
      signedApproval: {
        path: "signed-build-approval.json",
        sha256: sha256(signedApprovalBytes),
        byteLength: Buffer.byteLength(signedApprovalBytes),
      },
      publicKeyRegistry: {
        path: "build-approval-public-keys.json",
        sha256: sha256(publicKeyRegistryBytes),
        byteLength: Buffer.byteLength(publicKeyRegistryBytes),
      },
      materializationManifest: {
        path: "materialized/build-approval-materialization-manifest.json",
        sha256: sha256(materializationManifestBytes),
        byteLength: Buffer.byteLength(materializationManifestBytes),
      },
    },
  };
}

async function validManifest(directory) {
  const { approval, descriptor, privateKey } =
    await buildApprovalArtifacts(directory);
  const scanReceipt = createScanEvidence(
    directory,
    descriptor.publicKeyRegistry.sha256,
  );
  let cursor = Date.parse("2026-08-21T00:00:00Z");
  const receipts = Object.entries(REQUIRED_RELEASE_RECEIPTS).map(([kind, required], index) => {
    const durationMs = required.minimumDurationMs ?? 60_000;
    const startedAt = new Date(cursor).toISOString();
    const completedAt = new Date(cursor + durationMs).toISOString();
    cursor += durationMs + 60_000;
    return {
      receiptId: `receipt-${String(index).padStart(2, "0")}-${kind}`,
      kind,
      buildApprovalManifestHash: approval.approvalManifestSha256,
      artifactSha256: String(index % 10).repeat(64),
      approverActorId: `actor-reviewer-${String(index).padStart(4, "0")}`,
      startedAt,
      completedAt,
      durationMs,
      outcome: "passed",
      environment: required.environment ?? "production",
      deploymentId: deploymentIdFor(kind, approval.candidate),
      details: details(kind, required, scanReceipt, approval),
    };
  });
  const manifest = {
    schemaVersion: "3dena.release-receipts.v2",
    releaseId: approval.candidate.releaseId,
    gitCommit: approval.candidate.gitCommit,
    environment: "production",
    buildApproval: descriptor,
    receipts,
  };
  const scan = manifest.receipts.find(({ kind }) => kind === "container-scan");
  const scanBytes = `${JSON.stringify(scanReceipt, null, 2)}\n`;
  writeFileSync(join(directory, scan.details.receiptPath), scanBytes);
  scan.artifactSha256 = sha256(scanBytes);
  const productionProbe = manifest.receipts.find(
    ({ kind }) => kind === "production-probe",
  );
  const readinessEvidence = {
    schemaVersion: "3dena.production-readiness-evidence.v1",
    endpoint: "/readyz",
    httpStatus: 200,
    observedAt: productionProbe.completedAt,
    deploymentId: approval.candidate.flyBuildId,
    response: {
      schemaVersion: "3dena.compute-readiness.v1",
      status: "ready",
      approvalManifestSha256: approval.approvalManifestSha256,
      releaseId: approval.candidate.releaseId,
      gitCommit: approval.candidate.gitCommit,
      flyImageDigest: approval.candidate.flyImageDigest,
      flyBuildId: approval.candidate.flyBuildId,
      role: "api",
      contractVersions: approval.candidate.contractVersions,
    },
  };
  const readinessBytes = `${canonical(readinessEvidence)}\n`;
  writeFileSync(
    join(directory, productionProbe.details.readinessPath),
    readinessBytes,
  );
  productionProbe.artifactSha256 = sha256(readinessBytes);
  const lastReceiptCompletedAt = manifest.receipts.reduce(
    (latest, receipt) => Math.max(latest, Date.parse(receipt.completedAt)),
    0,
  );
  const releaseApprovalEnvelope = {
    version: "3dena.release-receipts-approval.v1",
    manifestSha256: sha256(canonical(manifest)),
    reviewerId: "actor-release-reviewer-0001",
    approvedAt: new Date(lastReceiptCompletedAt + 60_000).toISOString(),
    publicKeyId: "release-key-0001",
    signatureAlgorithm: "Ed25519",
  };
  manifest.releaseApproval = {
    ...releaseApprovalEnvelope,
    signatureBase64: sign(
      null,
      Buffer.from(canonical(releaseApprovalEnvelope)),
      privateKey,
    ).toString("base64"),
  };
  SIGNERS.set(manifest, privateKey);
  return manifest;
}

async function withValidManifest(callback) {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "3dena-release-receipts-v2-")),
  );
  try {
    const manifest = await validManifest(directory);
    return await callback(manifest, directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function trustedOptions(directory, manifest, overrides = {}) {
  return {
    evidenceRoot: directory,
    expectedPublicKeyRegistrySha256:
      manifest.buildApproval.publicKeyRegistry.sha256,
    allowedPublicKeyIds: [PUBLIC_KEY_ID],
    allowedReviewerIds: [REVIEWER_ID],
    ...overrides,
  };
}

function resignBuildApproval(manifest, directory, mutateCandidate) {
  const privateKey = SIGNERS.get(manifest);
  assert.ok(privateKey);
  const approvalPath = join(
    directory,
    manifest.buildApproval.signedApproval.path,
  );
  const previous = JSON.parse(readFileSync(approvalPath, "utf8"));
  const candidate = structuredClone(previous.candidate);
  mutateCandidate(candidate);
  const envelope = {
    version: previous.version,
    candidate,
    approvalManifestSha256: sha256(canonical(candidate)),
    reviewerId: previous.reviewerId,
    approvedAt: previous.approvedAt,
    publicKeyId: previous.publicKeyId,
    signatureAlgorithm: previous.signatureAlgorithm,
  };
  const approval = {
    ...envelope,
    signatureBase64: sign(
      null,
      Buffer.from(canonical(envelope)),
      privateKey,
    ).toString("base64"),
  };
  const bytes = `${canonical(approval)}\n`;
  writeFileSync(approvalPath, bytes);
  manifest.buildApproval.signedApproval.sha256 = sha256(bytes);
  manifest.buildApproval.signedApproval.byteLength = Buffer.byteLength(bytes);
  for (const receipt of manifest.receipts) {
    receipt.buildApprovalManifestHash = approval.approvalManifestSha256;
  }
}

function resignReleaseApproval(manifest) {
  const privateKey = SIGNERS.get(manifest);
  assert.ok(privateKey);
  const { releaseApproval: previous, ...unsignedManifest } = manifest;
  const envelope = {
    version: previous.version,
    manifestSha256: sha256(canonical(unsignedManifest)),
    reviewerId: previous.reviewerId,
    approvedAt: previous.approvedAt,
    publicKeyId: previous.publicKeyId,
    signatureAlgorithm: previous.signatureAlgorithm,
  };
  manifest.releaseApproval = {
    ...envelope,
    signatureBase64: sign(
      null,
      Buffer.from(canonical(envelope)),
      privateKey,
    ).toString("base64"),
  };
}

function rewriteReadinessEvidence(manifest, directory, mutate) {
  const production = manifest.receipts.find(
    ({ kind }) => kind === "production-probe",
  );
  const path = join(directory, production.details.readinessPath);
  const evidence = JSON.parse(readFileSync(path, "utf8"));
  mutate(evidence);
  const bytes = `${canonical(evidence)}\n`;
  writeFileSync(path, bytes);
  production.artifactSha256 = sha256(bytes);
  resignReleaseApproval(manifest);
}

test("requires an external pinned registry and signer policy", async () => {
  await withValidManifest(async (manifest, directory) => {
    const missingPolicy = await inspectReleaseReceipts(manifest, {
      evidenceRoot: directory,
    });
    assert.equal(missingPolicy.ok, false);
    assert.ok(missingPolicy.findings.some(({ rule }) =>
      rule === "release-trust-policy"));

    const disallowedSigner = await inspectReleaseReceipts(
      manifest,
      trustedOptions(directory, manifest, {
        allowedPublicKeyIds: ["release-key-untrusted"],
      }),
    );
    assert.equal(disallowedSigner.ok, false);
    assert.ok(disallowedSigner.findings.some(({ rule }) =>
      rule === "build-approval-policy"));

    await withValidManifest(async (attackerManifest, attackerDirectory) => {
      const attackerRegistry = await inspectReleaseReceipts(
        attackerManifest,
        trustedOptions(attackerDirectory, attackerManifest, {
          expectedPublicKeyRegistrySha256:
            manifest.buildApproval.publicKeyRegistry.sha256,
        }),
      );
      assert.equal(attackerRegistry.ok, false);
      assert.ok(attackerRegistry.findings.some(({ rule }) =>
        rule === "trusted-public-key-registry"));
    });
  });
});

test("rejects a self-consistent signed arbitrary materialization manifest", async () => {
  await withValidManifest(async (manifest, directory) => {
    const descriptor = manifest.buildApproval.materializationManifest;
    const materializationPath = join(directory, descriptor.path);
    const materialization = JSON.parse(readFileSync(materializationPath, "utf8"));
    materialization.unreviewedOutput = { sha256: "f".repeat(64) };
    const bytes = `${canonical(materialization)}\n`;
    writeFileSync(materializationPath, bytes);
    descriptor.sha256 = sha256(bytes);
    descriptor.byteLength = Buffer.byteLength(bytes);
    resignBuildApproval(manifest, directory, (candidate) => {
      candidate.materializationManifestSha256 = descriptor.sha256;
    });
    resignReleaseApproval(manifest);

    const result = await inspectReleaseReceipts(
      manifest,
      trustedOptions(directory, manifest),
    );
    assert.equal(result.ok, false);
    assert.ok(result.findings.some(({ rule }) =>
      rule === "build-approval-materialization"));
  });
});

test("rejects duplicate materialization-manifest keys before normalization", async () => {
  await withValidManifest(async (manifest, directory) => {
    const descriptor = manifest.buildApproval.materializationManifest;
    const path = join(directory, descriptor.path);
    const value = JSON.parse(readFileSync(path, "utf8"));
    const bytes = Buffer.from(
      `{"schemaVersion":${JSON.stringify(value.schemaVersion)},` +
      `"schemaVersion":${JSON.stringify(value.schemaVersion)},` +
      `"input":${canonical(value.input)},"outputs":${canonical(value.outputs)}}\n`,
    );
    writeFileSync(path, bytes);
    descriptor.sha256 = sha256(bytes);
    descriptor.byteLength = bytes.byteLength;
    resignBuildApproval(manifest, directory, (candidate) => {
      candidate.materializationManifestSha256 = descriptor.sha256;
    });
    resignReleaseApproval(manifest);
    const result = await inspectReleaseReceipts(
      manifest,
      trustedOptions(directory, manifest),
    );
    assert.equal(result.ok, false);
    assert.ok(result.findings.some(({ rule }) =>
      rule === "build-approval-materialization"));
  });
});

test("rejects an oversized sparse Jena source through the shared bound", async () => {
  await withValidManifest(async (manifest, directory) => {
    const materialization = JSON.parse(readFileSync(
      join(directory, manifest.buildApproval.materializationManifest.path),
      "utf8",
    ));
    truncateSync(
      join(
        directory,
        materialization.input.candidate.artifacts.jenaTarball.path,
      ),
      BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.jenaTarball + 1,
    );
    const result = await inspectReleaseReceipts(
      manifest,
      trustedOptions(directory, manifest),
    );
    assert.equal(result.ok, false);
    assert.ok(result.findings.some(({ rule }) =>
      rule === "build-approval-materialization"));
  });
});

test("requires bounded exact production readiness evidence", async () => {
  await withValidManifest(async (manifest, directory) => {
    const production = manifest.receipts.find(
      ({ kind }) => kind === "production-probe",
    );
    rmSync(join(directory, production.details.readinessPath));
    resignReleaseApproval(manifest);
    const result = await inspectReleaseReceipts(
      manifest,
      trustedOptions(directory, manifest),
    );
    assert.equal(result.ok, false);
    assert.ok(result.findings.some(({ rule }) =>
      rule === "production-readiness-evidence"));
  });
});

test("rejects not-ready or cross-build production readiness evidence", async () => {
  const mutations = [
    (evidence) => { evidence.response.status = "not-ready"; },
    (evidence) => {
      evidence.response.approvalManifestSha256 = "f".repeat(64);
    },
    (evidence) => { evidence.deploymentId = "fly-build-attacker"; },
    (evidence) => {
      evidence.response.flyImageDigest = `sha256:${"e".repeat(64)}`;
    },
    (evidence) => { evidence.response.role = "worker"; },
  ];
  for (const mutate of mutations) {
    await withValidManifest(async (manifest, directory) => {
      rewriteReadinessEvidence(manifest, directory, mutate);
      const result = await inspectReleaseReceipts(
        manifest,
        trustedOptions(directory, manifest),
      );
      assert.equal(result.ok, false);
      assert.ok(result.findings.some(({ rule }) =>
        rule === "production-readiness-evidence"));
    });
  }
});

test("enforces exact receipt details and authority-specific deployment binding", async () => {
  await withValidManifest(async (manifest, directory) => {
    const codeql = manifest.receipts.find(({ kind }) => kind === "codeql");
    codeql.details.unverified = true;
    codeql.details.buildId = "attacker-build";
    codeql.deploymentId = "attacker-build";

    const chromium = manifest.receipts.find(({ kind }) => kind === "chromium");
    chromium.details.vercelDeploymentId = "attacker-vercel-deployment";
    chromium.details.vercelBuildId = "attacker-vercel-build";
    chromium.deploymentId = "attacker-vercel-deployment";

    const capacity = manifest.receipts.find(
      ({ kind }) => kind === "capacity-multi-machine",
    );
    capacity.details.flyBuildId = "attacker-fly-build";
    capacity.details.flyImageDigest = `sha256:${"e".repeat(64)}`;
    capacity.deploymentId = "attacker-fly-build";
    resignReleaseApproval(manifest);

    const result = await inspectReleaseReceipts(
      manifest,
      trustedOptions(directory, manifest),
    );
    assert.equal(result.ok, false);
    const rules = new Set(result.findings.map(({ rule }) => rule));
    assert.ok(rules.has("receipt-details-contract"));
    assert.ok(rules.has("receipt-build-binding"));
    assert.ok(rules.has("receipt-vercel-binding"));
    assert.ok(rules.has("receipt-fly-binding"));
    assert.ok(rules.has("receipt-deployment-binding"));
  });
});

test("accepts the complete exact-build release matrix", async () => {
  assert.equal(
    REQUIRED_RELEASE_RECEIPTS["container-scan"].contract,
    "3dena.container-scan-receipt.v3",
  );
  await withValidManifest(async (manifest, directory) => {
    const result = await inspectReleaseReceipts(manifest, trustedOptions(directory, manifest));
    assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
    assert.equal(result.evidence.required, Object.keys(REQUIRED_RELEASE_RECEIPTS).length);
  });
});

test("rejects a missing real Safari receipt, a mixed build, and implementer self-approval", async () => {
  await withValidManifest(async (manifest, directory) => {
    manifest.receipts = manifest.receipts.filter(({ kind }) => kind !== "safari-real");
    manifest.receipts[0].buildApprovalManifestHash = "c".repeat(64);
    manifest.receipts[1].approverActorId = IMPLEMENTERS[0];
    const result = await inspectReleaseReceipts(manifest, trustedOptions(directory, manifest));
    assert.equal(result.ok, false);
    const rules = new Set(result.findings.map(({ rule }) => rule));
    assert.ok(rules.has("required-receipt-count"));
    assert.ok(rules.has("mixed-build"));
    assert.ok(rules.has("independent-approver"));
  });
});

test("rejects shortened soak, canary order drift, deletion failure and incomplete rollback", async () => {
  await withValidManifest(async (manifest, directory) => {
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
    const result = await inspectReleaseReceipts(manifest, trustedOptions(directory, manifest));
    assert.equal(result.ok, false);
    const rules = new Set(result.findings.map(({ rule }) => rule));
    assert.ok(rules.has("minimum-duration"));
    assert.ok(rules.has("canary-order"));
    assert.ok(rules.has("expired-object-readable"));
    assert.ok(rules.has("rollback-invariant"));
  });
});

test("rejects a weakened or unbound parser fuzz receipt", async () => {
  await withValidManifest(async (manifest, directory) => {
    const fuzz = manifest.receipts.find(({ kind }) => kind === "parser-fuzz");
    fuzz.details.totalCases = 128;
    fuzz.details.rawMarkerLeaks = 1;
    fuzz.details.maxOldSpaceMb = 8_192;
    fuzz.details.vitestReportSha256 = "not-a-hash";
    const result = await inspectReleaseReceipts(manifest, trustedOptions(directory, manifest));
    assert.equal(result.ok, false);
    const rules = new Set(result.findings.map(({ rule }) => rule));
    assert.ok(rules.has("parser-fuzz-minimum"));
    assert.ok(rules.has("parser-fuzz-invariant"));
    assert.ok(rules.has("parser-fuzz-heap"));
    assert.ok(rules.has("parser-fuzz-hash"));
  });
});

test("rejects a mutable, finding-bearing, or source-drifted container scan receipt", async () => {
  await withValidManifest(async (manifest, directory) => {
    const scan = manifest.receipts.find(({ kind }) => kind === "container-scan");
    scan.details.imageRef = "registry.fly.io/j-3dena-compute:latest";
    scan.details.sourceHeadCommit = "c".repeat(40);
    scan.details.resultCount = 1;
    scan.details.trivyJsonSha256 = "not-a-hash";
    scan.details.publicKeyRegistrySha256 = "not-a-hash";
    scan.details.publicKeyCount = 0;
    const result = await inspectReleaseReceipts(manifest, trustedOptions(directory, manifest));
    assert.equal(result.ok, false);
    const rules = new Set(result.findings.map(({ rule }) => rule));
    assert.ok(rules.has("container-scan-image"));
    assert.ok(rules.has("container-scan-invariant"));
    assert.ok(rules.has("container-scan-hash"));
  });
});

test("rejects legacy manifests and requires the raw signed BuildApprovalV4 evidence set", async () => {
  await withValidManifest(async (manifest, directory) => {
    manifest.schemaVersion = "3dena.release-receipts.v1";
    let result = await inspectReleaseReceipts(manifest, trustedOptions(directory, manifest));
    assert.equal(result.ok, false);
    assert.ok(result.findings.some(({ rule }) => rule === "manifest-schema"));

    manifest.schemaVersion = "3dena.release-receipts.v2";
    writeFileSync(
      join(directory, manifest.buildApproval.materializationManifest.path),
      "tampered materialization manifest\n",
    );
    result = await inspectReleaseReceipts(manifest, trustedOptions(directory, manifest));
    assert.equal(result.ok, false);
    assert.ok(result.findings.some(({ rule }) => rule === "build-approval-artifact"));
  });
});

test("cross-binds the signed candidate image digest and registry bytes to exact-image scan evidence", async () => {
  await withValidManifest(async (manifest, directory) => {
    const scan = manifest.receipts.find(({ kind }) => kind === "container-scan");
    scan.details.imageRef = `registry.fly.io/j-3dena-compute@sha256:${"d".repeat(64)}`;
    const result = await inspectReleaseReceipts(manifest, trustedOptions(directory, manifest));
    assert.equal(result.ok, false);
    assert.ok(result.findings.some(({ rule }) => rule === "build-approval-scan-binding"));
  });
});

test("rejects any receipt-matrix mutation after the independent release approval signature", async () => {
  await withValidManifest(async (manifest, directory) => {
    const codeql = manifest.receipts.find(({ kind }) => kind === "codeql");
    codeql.artifactSha256 = "e".repeat(64);
    const result = await inspectReleaseReceipts(manifest, trustedOptions(directory, manifest));
    assert.equal(result.ok, false);
    assert.ok(result.findings.some(({ rule }) => rule === "release-approval-signature"));
  });
});

test("rejects a symlinked signed approval even when its bytes and declared hash match", async () => {
  const directory = mkdtempSync(join(tmpdir(), "3dena-release-approval-symlink-"));
  const outside = mkdtempSync(join(tmpdir(), "3dena-release-approval-outside-"));
  try {
    const manifest = await validManifest(directory);
    const approvalPath = join(directory, manifest.buildApproval.signedApproval.path);
    const approvalBytes = readFileSync(approvalPath);
    rmSync(approvalPath);
    const outsidePath = join(outside, "signed-build-approval.json");
    writeFileSync(outsidePath, approvalBytes);
    symlinkSync(outsidePath, approvalPath);
    const result = await inspectReleaseReceipts(manifest, trustedOptions(directory, manifest));
    assert.equal(result.ok, false);
    assert.ok(result.findings.some(({ rule }) => rule === "build-approval-artifact"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("binds container-scan details to the actual bounded raw v3 receipt bytes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "3dena-release-scan-receipt-"));
  try {
    const manifest = await validManifest(directory);
    const scan = manifest.receipts.find(({ kind }) => kind === "container-scan");
    const receiptPath = join(directory, scan.details.receiptPath);
    const bytes = readFileSync(receiptPath, "utf8");
    const accepted = await inspectReleaseReceipts(manifest, trustedOptions(directory, manifest));
    assert.equal(accepted.ok, true, JSON.stringify(accepted.findings, null, 2));

    const inspectPath = join(directory, "docker-inspect.json");
    const inspectBytes = readFileSync(inspectPath, "utf8");
    writeFileSync(inspectPath, `${inspectBytes} `);
    const childTampered = await inspectReleaseReceipts(manifest, trustedOptions(directory, manifest));
    assert.equal(childTampered.ok, false);
    assert.ok(childTampered.findings.some(({ rule }) => rule === "container-scan-artifact"));
    writeFileSync(inspectPath, inspectBytes);

    writeFileSync(receiptPath, `${bytes} `);
    const tampered = await inspectReleaseReceipts(manifest, trustedOptions(directory, manifest));
    assert.equal(tampered.ok, false);
    assert.ok(tampered.findings.some(({ rule }) => rule === "container-scan-artifact"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reinterprets exact scan child documents instead of trusting self-consistent hashes", async () => {
  await withValidManifest(async (manifest, directory) => {
    const scan = manifest.receipts.find(({ kind }) => kind === "container-scan");
    const reportPath = join(directory, "trivy-exact-image.json");
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    report.Results.push({
      Target: IMAGE_REF,
      Vulnerabilities: [{ VulnerabilityID: "CVE-fixture" }],
    });
    const reportBytes = `${JSON.stringify(report)}\n`;
    writeFileSync(reportPath, reportBytes);

    const receiptPath = join(directory, scan.details.receiptPath);
    const rawReceipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    rawReceipt.scan.reportSha256 = sha256(reportBytes);
    rawReceipt.scan.reportByteLength = Buffer.byteLength(reportBytes);
    const rawReceiptBytes = `${JSON.stringify(rawReceipt, null, 2)}\n`;
    writeFileSync(receiptPath, rawReceiptBytes);
    scan.details.trivyJsonSha256 = rawReceipt.scan.reportSha256;
    scan.artifactSha256 = sha256(rawReceiptBytes);

    const result = await inspectReleaseReceipts(manifest, trustedOptions(directory, manifest));
    assert.equal(result.ok, false);
    assert.ok(result.findings.some(({ rule }) => rule === "container-scan-artifact"));
  });
});

test("the CLI rejects duplicate release-manifest keys before object normalization", () => {
  const directory = mkdtempSync(join(tmpdir(), "3dena-release-duplicate-manifest-"));
  try {
    const manifestPath = join(directory, "active-release-receipts.json");
    writeFileSync(
      manifestPath,
      '{"schemaVersion":"3dena.release-receipts.v2","schemaVersion":"3dena.release-receipts.v2"}\n',
    );
    const result = spawnSync(process.execPath, [
      new URL("./verify-release-receipts.mjs", import.meta.url).pathname,
      "--manifest",
      manifestPath,
    ], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Release receipt verifier error/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the CLI requires and applies external registry and signer policy", async () => {
  await withValidManifest(async (manifest, directory) => {
    const manifestPath = join(directory, "active-release-receipts.json");
    writeFileSync(manifestPath, `${canonical(manifest)}\n`);
    const verifier = new URL(
      "./verify-release-receipts.mjs",
      import.meta.url,
    ).pathname;
    const missingPolicy = spawnSync(process.execPath, [
      verifier,
      "--manifest",
      manifestPath,
    ], { encoding: "utf8" });
    assert.equal(missingPolicy.status, 1);
    assert.ok(JSON.parse(missingPolicy.stdout).findings.some(({ rule }) =>
      rule === "release-trust-policy"));

    const accepted = spawnSync(process.execPath, [
      verifier,
      "--manifest",
      manifestPath,
      "--expected-public-key-registry-sha256",
      manifest.buildApproval.publicKeyRegistry.sha256,
      "--allowed-public-key-id",
      PUBLIC_KEY_ID,
      "--allowed-reviewer-id",
      REVIEWER_ID,
    ], { encoding: "utf8" });
    assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
    assert.equal(JSON.parse(accepted.stdout).ok, true);
  });
});

test("rejects a symlinked raw container-scan receipt", async () => {
  const directory = mkdtempSync(join(tmpdir(), "3dena-release-scan-receipt-"));
  const outside = mkdtempSync(join(tmpdir(), "3dena-release-scan-outside-"));
  try {
    const manifest = await validManifest(directory);
    const scan = manifest.receipts.find(({ kind }) => kind === "container-scan");
    const receiptPath = join(directory, scan.details.receiptPath);
    const bytes = readFileSync(receiptPath, "utf8");
    const outsidePath = join(outside, "receipt.json");
    writeFileSync(outsidePath, bytes);
    rmSync(receiptPath);
    symlinkSync(outsidePath, receiptPath);
    scan.artifactSha256 = sha256(bytes);
    const rejected = await inspectReleaseReceipts(manifest, trustedOptions(directory, manifest));
    assert.equal(rejected.ok, false);
    assert.ok(rejected.findings.some(({ rule }) => rule === "container-scan-artifact"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
