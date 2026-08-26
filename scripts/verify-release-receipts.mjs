#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  verifyBuildApprovalBundle,
  verifyIndependentReviewerSignature,
} from "../packages/compute-service-persistent/deploy/build-approval-operator.mjs";
import {
  BUILD_APPROVAL_ARTIFACT_BOUNDS_V1,
  verifyBuildApprovalInputs,
} from "../packages/compute-service-persistent/deploy/build-approval-inputs-lib.mjs";
import { parseStrictJson } from "../packages/compute-service-persistent/deploy/strict-json.mjs";
import { inspectContainerScanEvidenceDocuments } from "./verify-container-scan-evidence.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_MANIFEST = resolve(
  fileURLToPath(new URL("../evidence/release/active-release-receipts.json", import.meta.url)),
);
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_SHA = /^[0-9a-f]{40}$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{5,255}$/u;
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_RELEASE_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_SIGNED_APPROVAL_BYTES = 64 * 1024;
const MAX_PUBLIC_KEY_REGISTRY_BYTES = 128 * 1024;
const MAX_CONTAINER_SCAN_RECEIPT_BYTES = 1024 * 1024;
const MAX_IMAGE_INSPECT_BYTES = 4 * 1024 * 1024;
const MAX_REGISTRY_VERIFICATION_BYTES = 1024 * 1024;
const MAX_TRIVY_JSON_BYTES = 64 * 1024 * 1024;
const MAX_READINESS_EVIDENCE_BYTES = 64 * 1024;

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
    contract: "3dena.container-scan-receipt.v3",
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

const BUILD_AUTHORITY_RECEIPTS = new Set([
  "clean-checkout", "sdk-consumers", "codeql", "secret-scan", "npm-audit",
  "sbom-lock-graph", "parser-fuzz", "license-legal",
]);
const VERCEL_AUTHORITY_RECEIPTS = new Set([
  "chromium", "firefox", "playwright-webkit", "safari-real",
  "voiceover-safari", "nvda-firefox", "preview",
]);

const RECEIPT_DETAIL_FIELDS = Object.freeze({
  "clean-checkout": ["buildId"],
  "sdk-consumers": ["buildId"],
  chromium: ["browser", "vercelBuildId", "vercelDeploymentId"],
  firefox: ["browser", "vercelBuildId", "vercelDeploymentId"],
  "playwright-webkit": ["browser", "vercelBuildId", "vercelDeploymentId"],
  "safari-real": ["browser", "platform", "vercelBuildId", "vercelDeploymentId"],
  "voiceover-safari": [
    "assistiveTechnology", "browser", "vercelBuildId", "vercelDeploymentId",
  ],
  "nvda-firefox": [
    "assistiveTechnology", "browser", "vercelBuildId", "vercelDeploymentId",
  ],
  codeql: ["buildId"],
  "secret-scan": ["buildId"],
  "npm-audit": ["buildId"],
  "sbom-lock-graph": ["buildId"],
  "parser-fuzz": [
    "buildId", "contract", "failedTests", "maxOldSpaceMb",
    "nonContractExceptions", "pendingTests", "rawMarkerLeaks", "seedCount",
    "sourceBundleSha256", "strategyCount", "targetCount", "totalCases",
    "vitestReportSha256",
  ],
  "container-scan": [
    "bakedSensitiveEnvironmentVariables", "contract", "flyBuildId",
    "flyImageDigest", "imageInspectSha256", "imageRef", "publicKeyCount",
    "publicKeyRegistryRawSha256", "publicKeyRegistrySha256",
    "publicKeyRegistryVerificationSha256", "receiptPath", "resultCount",
    "runtimeUser", "scannerName", "scannerVersion", "sourceHeadCommit",
    "trivyJsonSha256",
  ],
  "license-legal": ["buildId", "decision"],
  preview: ["vercelBuildId", "vercelDeploymentId"],
  "capacity-multi-machine": [
    "flyBuildId", "flyImageDigest", "machineCount", "peakRssFractionOfLimit",
  ],
  "stress-2h": [
    "capacityLeaks", "expiredReadableObjects", "flyBuildId", "flyImageDigest",
    "memoryUpwardDrift", "rawLogLeaks", "stalePublications",
    "unexplainedWorkerExits",
  ],
  "soak-24h": [
    "capacityLeaks", "expiredReadableObjects", "flyBuildId", "flyImageDigest",
    "memoryUpwardDrift", "rawLogLeaks", "stalePublications",
    "unexplainedWorkerExits",
  ],
  "canary-5": ["flyBuildId", "flyImageDigest", "trafficPercent"],
  "canary-25": ["flyBuildId", "flyImageDigest", "trafficPercent"],
  "canary-100": ["flyBuildId", "flyImageDigest", "trafficPercent"],
  rollback: [
    "contractsFenced", "flyBuildId", "flyDigestRestored", "flyImageDigest",
    "migrationBackwardCompatible", "runningJobsSafe", "sweeperStillActive",
    "vercelRestored",
  ],
  "production-probe": [
    "approvalManifestSha256", "contract", "flyBuildId", "flyImageDigest",
    "readinessPath", "runtimeRole",
  ],
  "deletion-probe": [
    "expiredReadableObjects", "flyBuildId", "flyImageDigest", "maxDeletionLagMs",
  ],
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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON contains a non-finite number");
    return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!isRecord(value)) throw new TypeError("canonical JSON contains an invalid value");
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function hasExactObjectKeys(value, keys) {
  return isRecord(value) && JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...keys].sort());
}

function portableEvidencePath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length < 1 ||
      relativePath.length > 1024 || isAbsolute(relativePath) ||
      relativePath.includes("\\") || relativePath.includes("\0") ||
      relativePath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("receiptPath is not a portable evidence-relative path");
  }
  return relativePath;
}

function boundedEvidenceBytes(evidenceRoot, relativePath, maximumBytes) {
  portableEvidencePath(relativePath);
  const root = realpathSync(evidenceRoot);
  const requested = resolve(root, relativePath);
  const pathRelative = relative(root, requested);
  if (pathRelative === "" || pathRelative === ".." ||
      pathRelative.startsWith(`..${sep}`) || isAbsolute(pathRelative)) {
    throw new Error("raw evidence escapes the evidence root");
  }
  let currentPath = root;
  for (const segment of pathRelative.split(sep)) {
    currentPath = resolve(currentPath, segment);
    const component = lstatSync(currentPath, { bigint: true });
    if (component.isSymbolicLink()) throw new Error("raw evidence contains a symbolic-link component");
  }
  const metadata = lstatSync(requested, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 2n ||
      metadata.size > BigInt(maximumBytes)) {
    throw new Error("raw receipt is not a bounded regular file");
  }
  const real = realpathSync(requested);
  const realRelative = relative(root, real);
  if (realRelative === "" || realRelative === ".." ||
      realRelative.startsWith(`..${sep}`) || isAbsolute(realRelative)) {
    throw new Error("raw receipt escapes the evidence root");
  }
  const descriptor = openSync(requested, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    const currentReal = realpathSync(requested);
    const current = lstatSync(requested, { bigint: true });
    if (!opened.isFile() || currentReal !== real || current.isSymbolicLink() ||
        current.dev !== opened.dev || current.ino !== opened.ino ||
        opened.size !== metadata.size || opened.dev !== metadata.dev ||
        opened.ino !== metadata.ino) {
      throw new Error("raw receipt changed during secure open");
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(requested, { bigint: true });
    if (after.dev !== opened.dev || after.ino !== opened.ino ||
        after.size !== opened.size || after.mtimeNs !== opened.mtimeNs ||
        after.ctimeNs !== opened.ctimeNs || afterPath.dev !== opened.dev ||
        afterPath.ino !== opened.ino || afterPath.isSymbolicLink() ||
        BigInt(bytes.byteLength) !== opened.size) {
      throw new Error("raw receipt changed during secure read");
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function boundedEvidenceJson(evidenceRoot, relativePath, maximumBytes) {
  const bytes = boundedEvidenceBytes(evidenceRoot, relativePath, maximumBytes);
  return { bytes, value: parseStrictJson(bytes) };
}

function childEvidencePath(parentPath, childPath) {
  portableEvidencePath(childPath);
  const parent = dirname(parentPath);
  return parent === "." ? childPath : `${parent}/${childPath}`;
}

function releaseTrustPolicy(options, findings) {
  const expectedPublicKeyRegistrySha256 =
    options.expectedPublicKeyRegistrySha256;
  const allowedPublicKeyIds = options.allowedPublicKeyIds;
  const allowedReviewerIds = options.allowedReviewerIds;
  if (!SHA256.test(expectedPublicKeyRegistrySha256 ?? "") ||
      !Array.isArray(allowedPublicKeyIds) || allowedPublicKeyIds.length < 1 ||
      allowedPublicKeyIds.some((value) => !validId(value)) ||
      new Set(allowedPublicKeyIds).size !== allowedPublicKeyIds.length ||
      !Array.isArray(allowedReviewerIds) || allowedReviewerIds.length < 1 ||
      allowedReviewerIds.some((value) => !validId(value)) ||
      new Set(allowedReviewerIds).size !== allowedReviewerIds.length) {
    findings.push(finding(
      "release-trust-policy",
      "options",
      "An external pinned registry SHA-256 and non-empty allowed public-key/reviewer policies are required.",
    ));
    return null;
  }
  return Object.freeze({
    expectedPublicKeyRegistrySha256,
    allowedPublicKeyIds: new Set(allowedPublicKeyIds),
    allowedReviewerIds: new Set(allowedReviewerIds),
  });
}

function assertRawContainerScanReceipt(value, details, gitCommit) {
  if (!hasExactObjectKeys(value, [
    "schemaVersion", "status", "repository", "runIdentity", "image", "scanner", "scan",
  ]) || value.schemaVersion !== "3dena.container-scan-receipt.v3" ||
      value.status !== "passed" || value.repository !== "HUDongpin/j-3dENA" ||
      !hasExactObjectKeys(value.runIdentity, ["runId", "runAttempt"]) ||
      !/^[1-9][0-9]*$/u.test(value.runIdentity.runId) ||
      !/^[1-9][0-9]*$/u.test(value.runIdentity.runAttempt)) {
    throw new Error("raw container-scan receipt header is invalid");
  }
  const image = value.image;
  if (!hasExactObjectKeys(image, [
    "ref", "digest", "sourceRepository", "sourceHeadCommit", "user", "os", "architecture",
    "entrypoint", "command", "healthcheck", "bakedSensitiveEnvironmentVariables",
    "inspectPath", "inspectSha256", "inspectByteLength", "publicKeyRegistry",
  ]) || image.ref !== details.imageRef ||
      image.digest !== details.imageRef.slice(details.imageRef.indexOf("@") + 1) ||
      image.sourceRepository !== "https://github.com/HUDongpin/j-3dENA" ||
      image.sourceHeadCommit !== gitCommit || image.sourceHeadCommit !== details.sourceHeadCommit ||
      image.user !== details.runtimeUser || image.os !== "linux" ||
      !["amd64", "arm64"].includes(image.architecture) ||
      image.bakedSensitiveEnvironmentVariables !== details.bakedSensitiveEnvironmentVariables ||
      image.inspectSha256 !== details.imageInspectSha256 ||
      !Number.isSafeInteger(image.inspectByteLength) || image.inspectByteLength < 1) {
    throw new Error("raw container-scan image identity is invalid");
  }
  const registry = image.publicKeyRegistry;
  if (!hasExactObjectKeys(registry, [
    "expectedSha256", "sha256", "publicKeyCount", "rawPath", "rawSha256",
    "rawByteLength", "verificationPath", "verificationSha256",
    "verificationByteLength",
  ]) || registry.expectedSha256 !== details.publicKeyRegistrySha256 ||
      registry.sha256 !== details.publicKeyRegistrySha256 ||
      registry.rawSha256 !== details.publicKeyRegistryRawSha256 ||
      registry.verificationSha256 !== details.publicKeyRegistryVerificationSha256 ||
      registry.publicKeyCount !== details.publicKeyCount ||
      !Number.isSafeInteger(registry.rawByteLength) || registry.rawByteLength < 2 ||
      !Number.isSafeInteger(registry.verificationByteLength) ||
      registry.verificationByteLength < 1) {
    throw new Error("raw container-scan public-key registry identity is invalid");
  }
  if (!hasExactObjectKeys(value.scanner, ["name", "fullName", "informationUri", "version"]) ||
      value.scanner.name !== details.scannerName ||
      value.scanner.version !== details.scannerVersion ||
      value.scanner.informationUri !== "https://github.com/aquasecurity/trivy" ||
      !hasExactObjectKeys(value.scan, [
        "format", "artifactName", "artifactType", "resultCount", "targetCount",
        "reportPath", "reportSha256", "reportByteLength",
      ]) || value.scan.resultCount !== details.resultCount ||
      value.scan.format !== "trivy-json" || value.scan.artifactName !== image.ref ||
      value.scan.artifactType !== "container_image" ||
      value.scan.reportSha256 !== details.trivyJsonSha256 ||
      !Number.isSafeInteger(value.scan.targetCount) || value.scan.targetCount < 0 ||
      !Number.isSafeInteger(value.scan.reportByteLength) || value.scan.reportByteLength < 1) {
    throw new Error("raw container-scan scanner evidence is invalid");
  }
}

function assertRawContainerScanArtifacts(value, evidenceRoot, receiptPath) {
  const descriptors = {
    inspect: {
      path: value.image.inspectPath,
      sha256: value.image.inspectSha256,
      byteLength: value.image.inspectByteLength,
      maximumBytes: MAX_IMAGE_INSPECT_BYTES,
    },
    publicKeyVerification: {
      path: value.image.publicKeyRegistry.verificationPath,
      sha256: value.image.publicKeyRegistry.verificationSha256,
      byteLength: value.image.publicKeyRegistry.verificationByteLength,
      maximumBytes: MAX_REGISTRY_VERIFICATION_BYTES,
    },
    publicKeyRegistry: {
      path: value.image.publicKeyRegistry.rawPath,
      sha256: value.image.publicKeyRegistry.rawSha256,
      byteLength: value.image.publicKeyRegistry.rawByteLength,
      maximumBytes: MAX_PUBLIC_KEY_REGISTRY_BYTES,
    },
    trivyJson: {
      path: value.scan.reportPath,
      sha256: value.scan.reportSha256,
      byteLength: value.scan.reportByteLength,
      maximumBytes: MAX_TRIVY_JSON_BYTES,
    },
  };
  const evidence = {};
  for (const [name, descriptor] of Object.entries(descriptors)) {
    const bytes = boundedEvidenceBytes(
      evidenceRoot,
      childEvidencePath(receiptPath, descriptor.path),
      descriptor.maximumBytes,
    );
    if (bytes.byteLength !== descriptor.byteLength || sha256(bytes) !== descriptor.sha256) {
      throw new Error("raw container-scan child evidence drifted");
    }
    evidence[name] = Object.freeze({ bytes, value: parseStrictJson(bytes) });
  }
  const semantic = inspectContainerScanEvidenceDocuments({
    trivyJson: evidence.trivyJson.value,
    inspect: evidence.inspect.value,
    publicKeyRegistryBytes: evidence.publicKeyRegistry.bytes,
    publicKeyVerification: evidence.publicKeyVerification.value,
    imageRef: value.image.ref,
    expectedPublicKeyRegistrySha256:
      value.image.publicKeyRegistry.expectedSha256,
    sourceHeadCommit: value.image.sourceHeadCommit,
  });
  const semanticImage = {
    digest: semantic.image.digest,
    sourceRepository: semantic.image.sourceRepository,
    sourceHeadCommit: semantic.image.sourceHeadCommit,
    user: semantic.image.user,
    os: semantic.image.os,
    architecture: semantic.image.architecture,
    entrypoint: semantic.image.entrypoint,
    command: semantic.image.command,
    healthcheck: semantic.image.healthcheck,
    bakedSensitiveEnvironmentVariables:
      semantic.image.bakedSensitiveEnvironmentVariables,
  };
  const receiptImage = {
    digest: value.image.digest,
    sourceRepository: value.image.sourceRepository,
    sourceHeadCommit: value.image.sourceHeadCommit,
    user: value.image.user,
    os: value.image.os,
    architecture: value.image.architecture,
    entrypoint: value.image.entrypoint,
    command: value.image.command,
    healthcheck: value.image.healthcheck,
    bakedSensitiveEnvironmentVariables:
      value.image.bakedSensitiveEnvironmentVariables,
  };
  if (canonical(semanticImage) !== canonical(receiptImage) ||
      semantic.scanner.name !== value.scanner.name ||
      semantic.scanner.fullName !== value.scanner.fullName ||
      semantic.scanner.informationUri !== value.scanner.informationUri ||
      semantic.scanner.version !== value.scanner.version ||
      semantic.scanner.artifactName !== value.scan.artifactName ||
      semantic.scanner.artifactType !== value.scan.artifactType ||
      semantic.scanner.targetCount !== value.scan.targetCount ||
      semantic.scanner.resultCount !== value.scan.resultCount ||
      semantic.publicKeyRegistry.sha256 !== value.image.publicKeyRegistry.sha256 ||
      semantic.publicKeyRegistry.publicKeyCount !==
        value.image.publicKeyRegistry.publicKeyCount) {
    throw new Error("raw container-scan child evidence semantics drifted");
  }
}

function assertCandidateMatchesMaterialization(
  candidate,
  materializationManifest,
  materializationManifestSha256,
  publicKeyRegistrySha256,
  evidenceRoot,
) {
  const input = materializationManifest.input.candidate;
  const migrationManifest = input.migrations.map(({ version, sha256: digest }) => ({
    sha256: digest,
    version,
  }));
  const jenaTarballBytes = boundedEvidenceBytes(
    evidenceRoot,
    input.artifacts.jenaTarball.path,
    BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.jenaTarball,
  );
  const expected = {
    releaseId: input.releaseId,
    environment: input.environment,
    gitCommit: input.gitCommit,
    vercelDeploymentId: input.vercelDeploymentId,
    vercelBuildId: input.vercelBuildId,
    flyImageDigest: input.flyImageDigest,
    flyBuildId: input.flyBuildId,
    analysisTarballSha256: input.artifacts.analysisTarball.sha256,
    jenaVersion: input.jenaVersion,
    jenaCommit: input.jenaCommit,
    jenaTarballSha256: input.artifacts.jenaTarball.sha256,
    jenaTarballIntegrity: `sha512-${createHash("sha512")
      .update(jenaTarballBytes).digest("base64")}`,
    sdkVersion: input.sdkVersion,
    buildId: input.buildId,
    lockfileSha256: input.artifacts.lockfile.sha256,
    sbomSha256: input.artifacts.sbom.sha256,
    schemaBundleSha256: materializationManifest.outputs.schemaBundle.sha256,
    migrationManifestSha256: sha256(JSON.stringify(migrationManifest)),
    publicKeyRegistrySha256,
    materializationManifestSha256,
    contractVersions: input.contractVersions,
    implementationActorIds: input.implementationActorIds,
  };
  const observed = { ...candidate };
  delete observed.version;
  if (candidate.version !== "3dena.build-approval-candidate.v4" ||
      canonical(observed) !== canonical(expected)) {
    throw new Error("signed candidate was not derived from the exact materialization manifest");
  }
}

async function verifyBuildApprovalEvidence(
  manifest,
  evidenceRoot,
  trustPolicy,
  findings,
) {
  const descriptor = manifest.buildApproval;
  const descriptorPath = "manifest.buildApproval";
  if (!hasExactObjectKeys(descriptor, [
    "signedApproval",
    "publicKeyRegistry",
    "materializationManifest",
  ])) {
    findings.push(finding(
      "build-approval-artifact",
      descriptorPath,
      "Exact raw BuildApprovalV4 artifact descriptors are required.",
    ));
    return null;
  }
  for (const field of ["signedApproval", "publicKeyRegistry", "materializationManifest"]) {
    const artifact = descriptor[field];
    if (!hasExactObjectKeys(artifact, ["path", "sha256", "byteLength"]) ||
        !SHA256.test(artifact.sha256) || !Number.isSafeInteger(artifact.byteLength) ||
        artifact.byteLength < 2) {
      findings.push(finding(
        "build-approval-artifact",
        `${descriptorPath}.${field}`,
        "An exact portable path, lowercase SHA-256, and positive byte length are required.",
      ));
      return null;
    }
  }
  if (evidenceRoot === undefined) {
    findings.push(finding(
      "build-approval-artifact",
      descriptorPath,
      "The evidence root is required to read the raw signed approval artifacts.",
    ));
    return null;
  }
  if (trustPolicy === null) return null;
  if (descriptor.publicKeyRegistry.sha256 !==
      trustPolicy.expectedPublicKeyRegistrySha256) {
    findings.push(finding(
      "trusted-public-key-registry",
      `${descriptorPath}.publicKeyRegistry.sha256`,
      "The evidence registry must match the externally pinned release trust root.",
    ));
    return null;
  }
  try {
    const signedApprovalBytes = boundedEvidenceBytes(
      evidenceRoot,
      descriptor.signedApproval.path,
      MAX_SIGNED_APPROVAL_BYTES,
    );
    const publicKeyRegistryBytes = boundedEvidenceBytes(
      evidenceRoot,
      descriptor.publicKeyRegistry.path,
      MAX_PUBLIC_KEY_REGISTRY_BYTES,
    );
    const materializationManifestBytes = boundedEvidenceBytes(
      evidenceRoot,
      descriptor.materializationManifest.path,
      BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.materializationManifest,
    );
    if (signedApprovalBytes.byteLength !== descriptor.signedApproval.byteLength ||
        publicKeyRegistryBytes.byteLength !== descriptor.publicKeyRegistry.byteLength ||
        materializationManifestBytes.byteLength !== descriptor.materializationManifest.byteLength ||
        sha256(signedApprovalBytes) !== descriptor.signedApproval.sha256 ||
        sha256(publicKeyRegistryBytes) !== descriptor.publicKeyRegistry.sha256 ||
        sha256(materializationManifestBytes) !== descriptor.materializationManifest.sha256) {
      throw new Error("raw build approval artifact hash mismatch");
    }
    let materializationManifest;
    try {
      materializationManifest = parseStrictJson(materializationManifestBytes);
      await verifyBuildApprovalInputs(
        materializationManifest,
        materializationManifestBytes.toString("utf8"),
        descriptor.materializationManifest.path,
        evidenceRoot,
      );
    } catch {
      findings.push(finding(
        "build-approval-materialization",
        `${descriptorPath}.materializationManifest`,
        "The raw materialization manifest must be strict, canonical, exact, and semantically reproducible from its bounded source/output files.",
      ));
      return null;
    }
    const verification = verifyBuildApprovalBundle(
      signedApprovalBytes,
      publicKeyRegistryBytes,
      trustPolicy.expectedPublicKeyRegistrySha256,
    );
    const { approval } = verification;
    const { candidate } = approval;
    if (!trustPolicy.allowedPublicKeyIds.has(approval.publicKeyId) ||
        !trustPolicy.allowedReviewerIds.has(approval.reviewerId)) {
      findings.push(finding(
        "build-approval-policy",
        `${descriptorPath}.signedApproval`,
        "The BuildApprovalV4 signer is outside the externally allowed key/reviewer policy.",
      ));
      return null;
    }
    try {
      assertCandidateMatchesMaterialization(
        candidate,
        materializationManifest,
        descriptor.materializationManifest.sha256,
        trustPolicy.expectedPublicKeyRegistrySha256,
        evidenceRoot,
      );
    } catch {
      findings.push(finding(
        "build-approval-materialization-binding",
        `${descriptorPath}.materializationManifest`,
        "The signed V4 candidate must be exactly derived from the verified materialization lineage.",
      ));
      return null;
    }
    if (candidate.releaseId !== manifest.releaseId ||
        candidate.environment !== manifest.environment ||
        candidate.gitCommit !== manifest.gitCommit ||
        candidate.publicKeyRegistrySha256 !== descriptor.publicKeyRegistry.sha256 ||
        candidate.materializationManifestSha256 !== descriptor.materializationManifest.sha256 ||
        !IMAGE_DIGEST.test(candidate.flyImageDigest)) {
      throw new Error("signed candidate disagrees with release identity");
    }
    return Object.freeze({
      ...verification,
      publicKeyRegistryBytes,
    });
  } catch {
    findings.push(finding(
      "build-approval-artifact",
      descriptorPath,
      "Raw BuildApprovalV4, registry, or materialization evidence is missing, unsafe, unsigned, drifted, or inconsistent.",
    ));
    return null;
  }
}

function verifyReleaseApproval(
  manifest,
  buildApprovalVerification,
  trustPolicy,
  findings,
  nowMs,
) {
  const approval = manifest.releaseApproval;
  const path = "manifest.releaseApproval";
  if (!hasExactObjectKeys(approval, [
    "version",
    "manifestSha256",
    "reviewerId",
    "approvedAt",
    "publicKeyId",
    "signatureAlgorithm",
    "signatureBase64",
  ]) || approval.version !== "3dena.release-receipts-approval.v1" ||
      !SHA256.test(approval.manifestSha256) || !validId(approval.reviewerId) ||
      !UTC_TIMESTAMP.test(approval.approvedAt) || !validId(approval.publicKeyId) ||
      approval.signatureAlgorithm !== "Ed25519" ||
      typeof approval.signatureBase64 !== "string") {
    findings.push(finding(
      "release-approval-signature",
      path,
      "A complete independent Ed25519 approval of the final receipt matrix is required.",
    ));
    return null;
  }
  if (buildApprovalVerification === null) {
    findings.push(finding(
      "release-approval-signature",
      path,
      "Release approval cannot be verified without the signed build evidence and exact registry bytes.",
    ));
    return null;
  }
  if (trustPolicy === null ||
      !trustPolicy.allowedPublicKeyIds.has(approval.publicKeyId) ||
      !trustPolicy.allowedReviewerIds.has(approval.reviewerId)) {
    findings.push(finding(
      "release-approval-policy",
      path,
      "The release approval signer is outside the externally allowed key/reviewer policy.",
    ));
    return null;
  }
  try {
    const { releaseApproval: _releaseApproval, ...unsignedManifest } = manifest;
    if (sha256(canonical(unsignedManifest)) !== approval.manifestSha256) {
      throw new Error("release manifest hash drifted");
    }
    const completedTimes = Array.isArray(manifest.receipts)
      ? manifest.receipts.map((receipt) => Date.parse(receipt?.completedAt ?? ""))
      : [];
    const approvedAtMs = Date.parse(approval.approvedAt);
    const latestReceiptCompletedAt = completedTimes.length > 0
      ? Math.max(...completedTimes)
      : Number.NaN;
    if (!Number.isFinite(approvedAtMs) || !Number.isFinite(latestReceiptCompletedAt) ||
        approvedAtMs <= latestReceiptCompletedAt || approvedAtMs > nowMs) {
      throw new Error("release approval timestamp is outside the receipt window");
    }
    const envelope = {
      version: approval.version,
      manifestSha256: approval.manifestSha256,
      reviewerId: approval.reviewerId,
      approvedAt: approval.approvedAt,
      publicKeyId: approval.publicKeyId,
      signatureAlgorithm: approval.signatureAlgorithm,
    };
    return verifyIndependentReviewerSignature({
      canonicalPayloadBytes: Buffer.from(canonical(envelope), "utf8"),
      signatureBase64: approval.signatureBase64,
      publicKeyId: approval.publicKeyId,
      reviewerId: approval.reviewerId,
      environment: manifest.environment,
      implementationActorIds:
        buildApprovalVerification.approval.candidate.implementationActorIds,
      publicKeyRegistryBytes: buildApprovalVerification.publicKeyRegistryBytes,
      expectedPublicKeyRegistrySha256:
        trustPolicy.expectedPublicKeyRegistrySha256,
    });
  } catch {
    findings.push(finding(
      "release-approval-signature",
      path,
      "The independent release approval is invalid, stale, premature, future-dated, or does not sign this exact final receipt matrix.",
    ));
    return null;
  }
}

function validateReceiptAuthority(
  receipt,
  path,
  candidate,
  findings,
) {
  if (candidate === undefined) return;
  let expectedDeploymentId;
  if (BUILD_AUTHORITY_RECEIPTS.has(receipt.kind)) {
    expectedDeploymentId = candidate.buildId;
    if (receipt.details.buildId !== candidate.buildId) {
      findings.push(finding(
        "receipt-build-binding",
        `${path}.details.buildId`,
        "Build-authority evidence must bind the signed candidate build ID.",
      ));
    }
  } else if (VERCEL_AUTHORITY_RECEIPTS.has(receipt.kind)) {
    expectedDeploymentId = candidate.vercelDeploymentId;
    if (receipt.details.vercelDeploymentId !== candidate.vercelDeploymentId ||
        receipt.details.vercelBuildId !== candidate.vercelBuildId) {
      findings.push(finding(
        "receipt-vercel-binding",
        `${path}.details`,
        "Vercel-authority evidence must bind the signed candidate deployment and build IDs.",
      ));
    }
  } else {
    expectedDeploymentId = candidate.flyBuildId;
    if (receipt.details.flyBuildId !== candidate.flyBuildId ||
        receipt.details.flyImageDigest !== candidate.flyImageDigest) {
      findings.push(finding(
        "receipt-fly-binding",
        `${path}.details`,
        "Fly-authority evidence must bind the signed candidate build and immutable image digest.",
      ));
    }
  }
  if (receipt.deploymentId !== expectedDeploymentId) {
    findings.push(finding(
      "receipt-deployment-binding",
      `${path}.deploymentId`,
      "Receipt deployment identity must match its signed build authority.",
    ));
  }
}

function validateProductionReadinessEvidence(
  receipt,
  path,
  evidenceRoot,
  buildApprovalVerification,
  findings,
) {
  const candidate = buildApprovalVerification?.approval?.candidate;
  const approvalManifestSha256 =
    buildApprovalVerification?.approval?.approvalManifestSha256;
  if (candidate === undefined || approvalManifestSha256 === undefined ||
      evidenceRoot === undefined ||
      typeof receipt.details.readinessPath !== "string") {
    findings.push(finding(
      "production-readiness-evidence",
      `${path}.details.readinessPath`,
      "Bounded raw production readiness evidence is required.",
    ));
    return;
  }
  try {
    const raw = boundedEvidenceJson(
      evidenceRoot,
      receipt.details.readinessPath,
      MAX_READINESS_EVIDENCE_BYTES,
    );
    if (sha256(raw.bytes) !== receipt.artifactSha256 ||
        raw.bytes.toString("utf8") !== `${canonical(raw.value)}\n`) {
      throw new Error("readiness evidence bytes drifted");
    }
    if (!hasExactObjectKeys(raw.value, [
      "schemaVersion", "endpoint", "httpStatus", "observedAt", "deploymentId",
      "response",
    ]) || raw.value.schemaVersion !== "3dena.production-readiness-evidence.v1" ||
        raw.value.endpoint !== "/readyz" || raw.value.httpStatus !== 200 ||
        raw.value.deploymentId !== receipt.deploymentId ||
        raw.value.observedAt !== receipt.completedAt) {
      throw new Error("readiness observation identity is invalid");
    }
    const response = raw.value.response;
    if (!hasExactObjectKeys(response, [
      "schemaVersion", "status", "approvalManifestSha256", "releaseId",
      "gitCommit", "flyImageDigest", "flyBuildId", "role", "contractVersions",
    ]) || response.schemaVersion !== "3dena.compute-readiness.v1" ||
        response.status !== "ready" || response.role !== "api" ||
        response.approvalManifestSha256 !== approvalManifestSha256 ||
        response.releaseId !== candidate.releaseId ||
        response.gitCommit !== candidate.gitCommit ||
        response.flyImageDigest !== candidate.flyImageDigest ||
        response.flyBuildId !== candidate.flyBuildId ||
        canonical(response.contractVersions) !== canonical(candidate.contractVersions) ||
        receipt.details.contract !== raw.value.schemaVersion ||
        receipt.details.approvalManifestSha256 !== approvalManifestSha256 ||
        receipt.details.runtimeRole !== response.role) {
      throw new Error("readiness response disagrees with signed candidate");
    }
  } catch {
    findings.push(finding(
      "production-readiness-evidence",
      `${path}.details.readinessPath`,
      "The raw /readyz evidence must be safe, canonical, ready=true, and bind the exact deployment, image, runtime role, and approval manifest.",
    ));
  }
}

function validateDetails(
  receipt,
  required,
  path,
  findings,
  manifestGitCommit,
  evidenceRoot,
  buildApprovalVerification,
) {
  if (!isRecord(receipt.details)) {
    findings.push(finding("receipt-details", `${path}.details`, "Receipt details must be an object."));
    return;
  }
  const allowedFields = RECEIPT_DETAIL_FIELDS[receipt.kind];
  if (allowedFields === undefined || !hasExactObjectKeys(receipt.details, allowedFields)) {
    findings.push(finding(
      "receipt-details-contract",
      `${path}.details`,
      "Receipt details must contain the exact versioned fields for this receipt kind.",
    ));
  }
  const candidate = buildApprovalVerification?.approval?.candidate;
  validateReceiptAuthority(receipt, path, candidate, findings);
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
    if (typeof receipt.details.receiptPath !== "string") {
      findings.push(finding("container-scan-artifact", `${path}.details.receiptPath`, "Raw scan receipt path is required."));
    }
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
    const signedCandidate = buildApprovalVerification?.approval?.candidate;
    if (signedCandidate !== undefined && (
      receipt.details.imageRef.slice(receipt.details.imageRef.indexOf("@") + 1) !==
        signedCandidate.flyImageDigest ||
      receipt.details.publicKeyRegistrySha256 !== signedCandidate.publicKeyRegistrySha256 ||
      receipt.details.sourceHeadCommit !== signedCandidate.gitCommit
    )) {
      findings.push(finding(
        "build-approval-scan-binding",
        `${path}.details`,
        "Exact-image scan evidence must match the signed candidate image, source, and public-key registry.",
      ));
    }
    for (const hashField of [
      "imageInspectSha256",
      "trivyJsonSha256",
      "publicKeyRegistrySha256",
      "publicKeyRegistryRawSha256",
      "publicKeyRegistryVerificationSha256",
    ]) {
      if (!SHA256.test(receipt.details[hashField])) {
        findings.push(finding("container-scan-hash", `${path}.details.${hashField}`, "Exact image evidence SHA-256 values are required."));
      }
    }
    if (!Number.isSafeInteger(receipt.details.publicKeyCount) ||
        receipt.details.publicKeyCount < 1 || receipt.details.publicKeyCount > 10_000) {
      findings.push(finding(
        "container-scan-invariant",
        `${path}.details.publicKeyCount`,
        "The verified in-image public-key registry must be non-empty and bounded.",
      ));
    }
    if (evidenceRoot !== undefined && typeof receipt.details.receiptPath === "string") {
      try {
        const raw = boundedEvidenceJson(
          evidenceRoot,
          receipt.details.receiptPath,
          MAX_CONTAINER_SCAN_RECEIPT_BYTES,
        );
        if (sha256(raw.bytes) !== receipt.artifactSha256) {
          throw new Error("raw receipt bytes do not match artifactSha256");
        }
        assertRawContainerScanReceipt(raw.value, receipt.details, manifestGitCommit);
        assertRawContainerScanArtifacts(
          raw.value,
          evidenceRoot,
          receipt.details.receiptPath,
        );
      } catch {
        findings.push(finding(
          "container-scan-artifact",
          `${path}.details.receiptPath`,
          "Raw container-scan v3 receipt is missing, unsafe, drifted, or inconsistent.",
        ));
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
  if (receipt.kind === "production-probe") {
    validateProductionReadinessEvidence(
      receipt,
      path,
      evidenceRoot,
      buildApprovalVerification,
      findings,
    );
  }
}

export async function inspectReleaseReceipts(manifest, options = {}) {
  const findings = [];
  if (
    !exactKeys(
      manifest,
      [
        "schemaVersion",
        "releaseId",
        "gitCommit",
        "environment",
        "buildApproval",
        "receipts",
        "releaseApproval",
      ],
      "manifest",
      findings,
    )
  ) {
    return { ok: false, findings, evidence: { required: Object.keys(REQUIRED_RELEASE_RECEIPTS).length, observed: 0 } };
  }
  if (manifest.schemaVersion !== "3dena.release-receipts.v2") {
    findings.push(finding("manifest-schema", "manifest.schemaVersion", "Unsupported release receipt schema."));
  }
  if (!validId(manifest.releaseId)) {
    findings.push(finding("manifest-identity", "manifest.releaseId", "A release ID is required."));
  }
  if (!GIT_SHA.test(manifest.gitCommit)) {
    findings.push(finding("build-identity", "manifest.gitCommit", "An exact Git commit is required."));
  }
  if (manifest.environment !== "production") {
    findings.push(finding("production-environment", "manifest.environment", "Final release receipts must target production."));
  }
  const trustPolicy = releaseTrustPolicy(options, findings);
  const buildApprovalVerification = await verifyBuildApprovalEvidence(
    manifest,
    options.evidenceRoot,
    trustPolicy,
    findings,
  );
  const buildApprovalManifestHash =
    buildApprovalVerification?.approval?.approvalManifestSha256;
  const releaseApprovalVerification = verifyReleaseApproval(
    manifest,
    buildApprovalVerification,
    trustPolicy,
    findings,
    Number.isFinite(options.nowMs) ? options.nowMs : Date.now(),
  );
  if (!Array.isArray(manifest.receipts)) {
    findings.push(finding("receipts", "manifest.receipts", "Expected a receipt array."));
    return { ok: false, findings, evidence: { required: Object.keys(REQUIRED_RELEASE_RECEIPTS).length, observed: 0 } };
  }

  const implementationActors = new Set(
    buildApprovalVerification?.approval?.candidate?.implementationActorIds ?? [],
  );
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
    if (buildApprovalManifestHash !== undefined &&
        receipt.buildApprovalManifestHash !== buildApprovalManifestHash) {
      findings.push(finding("mixed-build", `${path}.buildApprovalManifestHash`, "Every receipt must bind the same signed BuildApprovalV4 candidate."));
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
    validateDetails(
      receipt,
      required,
      path,
      findings,
      manifest.gitCommit,
      options.evidenceRoot,
      buildApprovalVerification,
    );
  });

  for (const kind of Object.keys(REQUIRED_RELEASE_RECEIPTS)) {
    const observed = byKind.get(kind)?.length ?? 0;
    if (observed !== 1) {
      findings.push(finding("required-receipt-count", `manifest.receipts#${kind}`, `Expected exactly one receipt; observed ${observed}.`));
    }
  }

  const productionProbe = byKind.get("production-probe")?.[0];
  const containerScan = byKind.get("container-scan")?.[0];
  const scannedImageRef = containerScan?.details?.imageRef;
  const scannedImageDigest = typeof scannedImageRef === "string"
    ? scannedImageRef.slice(scannedImageRef.indexOf("@") + 1)
    : null;
  if (productionProbe !== undefined && containerScan !== undefined &&
      (productionProbe.details?.flyImageDigest !==
        scannedImageDigest ||
        productionProbe.details?.flyBuildId !== productionProbe.deploymentId)) {
    findings.push(finding(
      "production-scan-binding",
      "manifest.receipts#production-probe",
      "Production readiness must bind the same Fly build and exact image verified by the container scan receipt.",
    ));
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
      buildApprovalManifestHash: SHA256.test(buildApprovalManifestHash ?? "")
        ? buildApprovalManifestHash
        : null,
      buildApprovalReviewerId:
        buildApprovalVerification?.approval?.reviewerId ?? null,
      publicKeyRegistrySha256:
        buildApprovalVerification?.publicKeyRegistry?.sha256 ?? null,
      releaseApprovalManifestSha256:
        releaseApprovalVerification === null
          ? null
          : manifest.releaseApproval.manifestSha256,
      releaseApprovalReviewerId:
        releaseApprovalVerification?.reviewerId ?? null,
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
    let expectedPublicKeyRegistrySha256;
    const allowedPublicKeyIds = [];
    const allowedReviewerIds = [];
    for (let index = 2; index < process.argv.length; index += 1) {
      if (process.argv[index] === "--manifest" && process.argv[index + 1]) {
        manifestPath = resolve(process.argv[index + 1]);
        index += 1;
      } else if (process.argv[index] === "--expected-public-key-registry-sha256" &&
          process.argv[index + 1]) {
        expectedPublicKeyRegistrySha256 = process.argv[index + 1];
        index += 1;
      } else if (process.argv[index] === "--allowed-public-key-id" &&
          process.argv[index + 1]) {
        allowedPublicKeyIds.push(process.argv[index + 1]);
        index += 1;
      } else if (process.argv[index] === "--allowed-reviewer-id" &&
          process.argv[index + 1]) {
        allowedReviewerIds.push(process.argv[index + 1]);
        index += 1;
      } else if (process.argv[index] === "--help" || process.argv[index] === "-h") {
        process.stdout.write(
          "Usage: node scripts/verify-release-receipts.mjs [--manifest <json>] " +
          "--expected-public-key-registry-sha256 <sha256> " +
          "--allowed-public-key-id <id> --allowed-reviewer-id <id>\n",
        );
        manifestPath = null;
      } else {
        throw new Error(`Unknown argument: ${process.argv[index]}`);
      }
    }
    expectedPublicKeyRegistrySha256 ??=
      process.env.RELEASE_EXPECTED_PUBLIC_KEY_REGISTRY_SHA256;
    if (allowedPublicKeyIds.length === 0 &&
        process.env.RELEASE_ALLOWED_PUBLIC_KEY_ID) {
      allowedPublicKeyIds.push(process.env.RELEASE_ALLOWED_PUBLIC_KEY_ID);
    }
    if (allowedReviewerIds.length === 0 &&
        process.env.RELEASE_ALLOWED_REVIEWER_ID) {
      allowedReviewerIds.push(process.env.RELEASE_ALLOWED_REVIEWER_ID);
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
        const manifestArtifact = boundedEvidenceJson(
          dirname(manifestPath),
          basename(manifestPath),
          MAX_RELEASE_MANIFEST_BYTES,
        );
        const result = await inspectReleaseReceipts(
          manifestArtifact.value,
          {
            evidenceRoot: dirname(manifestPath),
            expectedPublicKeyRegistrySha256,
            allowedPublicKeyIds,
            allowedReviewerIds,
          },
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
