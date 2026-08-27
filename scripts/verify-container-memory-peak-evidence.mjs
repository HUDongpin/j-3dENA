#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  linkSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { request as httpsRequest } from "node:https";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "../packages/compute-service-persistent/deploy/strict-json.mjs";

const EVIDENCE_VERSION = "3dena.container-memory-peak-evidence.v1";
const PIN_VERSION = "3dena.container-memory-peak-pins.v1";
const RAW_RUN_VERSION = "3dena.container-memory-peak-raw-run.v1";
const MARKER_VERSION = "3dena.container-memory-peak-run-marker.v1";
const RECEIPT_VERSION = "3dena.container-memory-peak-consistency-verification.v1";
const IMAGE_DIGEST = "sha256:4257374102d32b5b21d59fe3030b1fab339c65b7c55070d396d1b78b099b5881";
const IMAGE_SOURCE_COMMIT = "fb5c89322ea32b88fcde456b0338e659aa590272";
const FLY_BUILD_ID = "a8b63e853c28be665282eaa4e8010d4198319106";
const SDK_VERSION = "0.2.0-implemented-unverified.12";
const SCIENTIFIC_WORKER_SHA256 = "df19b871790be8de8267b6467733647071b7b7e8a642341a09e7095f7887d0c7";
const RUNTIME_BUNDLE_SHA256 = "54c4e2a96a5fbd8324ee2a3d91411a229e82fb892dc57eab3b15dd8565d2d751";
const BUILD_MANIFEST_SHA256 = "cb07d77e824f57b9ed709aad12994b1fece92b297b7e9252fa4f0f7116573dc5";
const SCAN_RECEIPT_SHA256 = "53b828f7dbb0608087bfeaa7347190faebdd7115e507db6cf5ed3be2165340fc";
const DOCKER_INSPECT_SHA256 = "75ea98fa5b3aa1898222dcdd61b4049bbd375fcbb59f4c51c3ec5225aea9d03a";
const REQUEST_ARTIFACT_SHA256 = "7e8dc73d599685ee108aa6608405a73f3995fb31e4f3561e1009d671708bd65f";
const REQUEST_HASH = "a76fa8cd5aca04017ad39403e5da0f1c53725e0e439fcffd18fdd1474ed22aed";
const EXPECTED_RESULT_HASH = "2438b7a52a7ec0be3a00cf4382e34469cfce1a5e111ce3cfa76c95f6002b862a";
const AUXILIARY_HOST_RECEIPT_SHA256 = "d9b0d03edbc1d25858a4b433fb0dee687492e5632a5146dc8158d2c3c051cf49";
const AUXILIARY_HOST_REDACTED_RECEIPT_SHA256 = "ab5b95038a1c80fcd9506ac879b189d63cfec7e35820196f463e3cec59349a12";
const MEMORY_LIMIT_BYTES = 2_147_483_648;
const THRESHOLD_FRACTION = 0.5;
const LEAK_MARKER = "3DENA_CONTAINER_MEMORY_PEAK_PRIVATE_SENTINEL_V1";
const LOWER_SHA256 = /^[a-f0-9]{64}$/u;
const GIT_COMMIT = /^[a-f0-9]{40}$/u;
const IMAGE_REF = /^registry\.fly\.io\/[a-z0-9-]+@sha256:[a-f0-9]{64}$/u;
const RELATIVE_EVIDENCE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)(?!.*[\u0000-\u001f])[A-Za-z0-9._/-]+$/u;
const CONTAINER_ID = /^[a-f0-9]{12,64}$/u;
const utf8 = new TextDecoder("utf-8", { fatal: true });
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const MAX_JSON_BYTES = 256 * 1024 * 1024;
const MAX_LOG_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_EVIDENCE_BYTES = 64 * 1024 * 1024;
const GITHUB_REPOSITORY = "HUDongpin/j-3dENA";
const GITHUB_REPOSITORY_ID = "1341282948";
const GITHUB_REPOSITORY_OWNER_ID = "47708816";
const GITHUB_MAIN_REF = "refs/heads/main";
const GITHUB_SERVER_URL = "https://github.com";
const GITHUB_WORKFLOW_PATH = ".github/workflows/container-memory-peak-calibration.yml";
const GITHUB_PROTECTED_ENVIRONMENT = "container-memory-peak-calibration";
const EVIDENCE_ARTIFACT_NAME = "exact-v12-container-memory-peak-evidence";
const FORMAL_RECEIPT_ARTIFACT_NAME = "exact-v12-container-memory-peak-verification-receipt";
const GITHUB_PRODUCER_JOB = "exact-v12-container-memory-peak-producer";
const GITHUB_VERIFIER_JOB = "exact-v12-container-memory-peak-verifier";
const FORMAL_RECEIPT_VERSION = "3dena.container-memory-peak-github-artifact-verification.v1";
const GITHUB_ARTIFACT_ATTESTATION_VERSION = "3dena.container-memory-peak-github-artifact-attestation.v1";
const GITHUB_OIDC_REQUEST_ORIGIN = "https://vstoken.actions.githubusercontent.com";
const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_AUDIENCE = "urn:3dena:container-memory-peak-evidence:v1";
const MAX_GITHUB_OIDC_RESPONSE_BYTES = 64 * 1024;
const CONTAINER_RUNNER_PATH = "/calibration/tooling/run-container-memory-peak-linux-calibration.mjs";
const CONTAINER_NODE_PATH = "/usr/local/bin/node";
const CONTAINER_TINI_PATH = "/sbin/tini";
const TINI_SHA256 = "93dcc18adc78c65a028a84799ecf8ad40c936fdfc5f2a57b1acda5a8117fa82c";
const SCIENTIFIC_HARD_DEADLINE_MS = 60_000;
const CONTAINER_REQUEST_PATH = "/calibration/tooling/container-memory-peak-calibration-request.json";
const CONTAINER_HOST_REDACTED_PATH = "/calibration/prior/host-preflight-redacted.json";
const EXPECTED_IMAGE_CONFIG_ENV = Object.freeze([
  "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  "NODE_VERSION=24.19.0",
  "YARN_VERSION=1.22.22",
  "NODE_ENV=production",
  "HOME=/nonexistent",
  "TMPDIR=/tmp",
  "TZ=UTC",
  "LANG=C.UTF-8",
  "LC_ALL=C.UTF-8",
  "NODE_OPTIONS=--disable-proto=throw",
  "BUILD_MANIFEST_PATH=/app/build-manifest.json",
  "BUILD_APPROVAL_PUBLIC_KEYS_PATH=/app/build-approval-public-keys.json",
  "SCIENTIFIC_WORKER_ENTRY_PATH=/app/scientific-worker-entry.mjs",
  "MAX_OPEN_FILES=1024",
  "MAX_PROCESSES=64",
]);

const DEFAULT_FROZEN_PINS = Object.freeze({
  imageDigest: IMAGE_DIGEST,
  imageSourceCommit: IMAGE_SOURCE_COMMIT,
  flyBuildId: FLY_BUILD_ID,
  sdkVersion: SDK_VERSION,
  scientificWorkerSha256: SCIENTIFIC_WORKER_SHA256,
  runtimeBundleSha256: RUNTIME_BUNDLE_SHA256,
  buildManifestSha256: BUILD_MANIFEST_SHA256,
  exactImageScanReceiptSha256: SCAN_RECEIPT_SHA256,
  dockerInspectSha256: DOCKER_INSPECT_SHA256,
  requestArtifactSha256: REQUEST_ARTIFACT_SHA256,
  requestHash: REQUEST_HASH,
  expectedResultHash: EXPECTED_RESULT_HASH,
  auxiliaryHostSourceReceiptSha256: AUXILIARY_HOST_RECEIPT_SHA256,
  auxiliaryHostRedactedReceiptSha256: AUXILIARY_HOST_REDACTED_RECEIPT_SHA256,
  memoryLimitBytes: MEMORY_LIMIT_BYTES,
  thresholdFraction: THRESHOLD_FRACTION,
});

const EXPECTED_ENVELOPE = Object.freeze({
  scope: "frozen-v12-calibration-envelope-only",
  sourceRows: 240,
  groups: 2,
  participantsPerGroup: 20,
  periods: 6,
  codes: 8,
  permutationRepetitions: 500,
  participantHistoryBootstrapRepetitions: 500,
  inferenceFamilies: Object.freeze([
    "independent-period",
    "paired-periods",
    "repeated-periods",
    "path-comparison",
  ]),
  networkOverlay: true,
  extrapolationPermitted: false,
});

const EXPECTED_POLICY = Object.freeze({
  platform: "linux",
  architecture: "amd64",
  cgroupVersion: 2,
  runtimeUser: "10001:10001",
  memoryMaxBytes: MEMORY_LIMIT_BYTES,
  memorySwapMaxBytes: 0,
  cpuCount: 1,
  pidsMax: 64,
  readOnlyRoot: true,
  networkDisabled: true,
  noNewPrivileges: true,
  capDropAll: true,
  tmpfs: Object.freeze({
    mountPath: "/tmp",
    options: Object.freeze(["rw", "nosuid", "nodev", "noexec"]),
  }),
  freshContainerRuns: 3,
});

function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}

function writeWarning(message) {
  try {
    process.stderr.write(`WARN: ${message}\n`);
  } catch {
    // A diagnostic stream failure cannot change a receipt already committed.
  }
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function record(value, path) {
  if (!isRecord(value)) fail(path, "must be an evidence document object");
  return value;
}

function exactKeys(value, keys, path) {
  const object = record(value, path);
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(path, `must contain exact keys ${expected.join(", ")}; unknown or missing key detected`);
  }
  return object;
}

function exactJson(actual, expected, path) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(path, "does not match the frozen calibration contract");
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function asBytes(value, path) {
  if (!(value instanceof Uint8Array)) fail(path, "must be immutable evidence bytes");
  return value;
}

function parseJsonBytes(value, path) {
  const bytes = asBytes(value, path);
  try {
    return parseStrictJson(utf8.decode(bytes));
  } catch (error) {
    throw new Error(`${path}: must be fatal-UTF-8 strict JSON without duplicate keys`, {
      cause: error,
    });
  }
}

function decodeText(value, path) {
  try {
    return utf8.decode(asBytes(value, path));
  } catch (error) {
    throw new Error(`${path}: must be fatal UTF-8 text`, { cause: error });
  }
}

function canonicalJson(value, path = "value") {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "contains a non-finite canonical number");
    return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry, index) => canonicalJson(entry, `${path}[${index}]`)).join(",")}]`;
  }
  const object = record(value, path);
  const keys = Object.keys(object).sort();
  return `{${keys.map((key) => {
    if (object[key] === undefined) fail(`${path}.${key}`, "cannot be undefined");
    return `${JSON.stringify(key)}:${canonicalJson(object[key], `${path}.${key}`)}`;
  }).join(",")}}`;
}

function analysisHash(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

function descriptor(value, bytes, path) {
  const item = exactKeys(value, ["path", "sha256", "byteLength"], path);
  if (typeof item.path !== "string" || !RELATIVE_EVIDENCE_PATH.test(item.path) ||
      item.path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail(`${path}.path`, "must be a normalized contained relative evidence path");
  }
  if (!LOWER_SHA256.test(item.sha256)) fail(`${path}.sha256`, "must be lowercase SHA-256");
  if (!Number.isSafeInteger(item.byteLength) || item.byteLength < 0) {
    fail(`${path}.byteLength`, "must be a non-negative safe integer");
  }
  if (bytes.byteLength !== item.byteLength) fail(path, "byte length does not match custodied bytes");
  if (sha256(bytes) !== item.sha256) fail(path, "hash does not match custodied bytes");
  return item;
}

function inspectPinManifest(bytes, expectedSha256, expectedToolingCommit, frozenPins) {
  if (!LOWER_SHA256.test(expectedSha256) || sha256(bytes) !== expectedSha256) {
    fail("pin manifest", "hash does not match the externally supplied pin manifest SHA-256");
  }
  const pin = exactKeys(
    parseJsonBytes(bytes, "pin manifest"),
    ["schemaVersion", "repository", "image", "priorEvidence", "tooling", "runtime", "calibration"],
    "pin manifest",
  );
  if (pin.schemaVersion !== PIN_VERSION) fail("pin manifest.schemaVersion", "is unsupported");
  if (pin.repository !== "HUDongpin/j-3dENA") fail("pin manifest.repository", "is not approved");
  const image = exactKeys(pin.image, [
    "ref", "digest", "sourceCommit", "flyBuildId", "sdkVersion",
    "scientificWorkerSha256", "runtimeBundleSha256", "buildManifestSha256",
  ], "pin manifest.image");
  if (!IMAGE_REF.test(image.ref) || !image.ref.endsWith(`@${frozenPins.imageDigest}`)) {
    fail("pin manifest.image.ref", "must bind the immutable exact Fly registry digest");
  }
  for (const [field, expected] of [
    ["digest", frozenPins.imageDigest],
    ["sourceCommit", frozenPins.imageSourceCommit],
    ["flyBuildId", frozenPins.flyBuildId],
    ["sdkVersion", frozenPins.sdkVersion],
    ["scientificWorkerSha256", frozenPins.scientificWorkerSha256],
    ["runtimeBundleSha256", frozenPins.runtimeBundleSha256],
    ["buildManifestSha256", frozenPins.buildManifestSha256],
  ]) {
    if (image[field] !== expected) fail(`pin manifest.image.${field}`, "does not match the frozen identity");
  }
  const prior = exactKeys(pin.priorEvidence, [
    "exactImageScanReceiptSha256", "dockerInspectSha256",
    "auxiliaryHostSourceReceiptSha256", "auxiliaryHostRedactedReceiptSha256", "auxiliaryHostReceiptRole",
  ], "pin manifest.priorEvidence");
  for (const [field, expected] of [
    ["exactImageScanReceiptSha256", frozenPins.exactImageScanReceiptSha256],
    ["dockerInspectSha256", frozenPins.dockerInspectSha256],
    ["auxiliaryHostSourceReceiptSha256", frozenPins.auxiliaryHostSourceReceiptSha256],
    ["auxiliaryHostRedactedReceiptSha256", frozenPins.auxiliaryHostRedactedReceiptSha256],
  ]) {
    if (prior[field] !== expected) fail(`pin manifest.priorEvidence.${field}`, "does not match the frozen evidence hash");
  }
  if (prior.auxiliaryHostReceiptRole !== "informational-only") {
    fail("pin manifest.priorEvidence.auxiliaryHostReceiptRole", "must be informational-only");
  }
  const tooling = exactKeys(pin.tooling, [
    "commit", "workflowSha256", "verifierSha256", "hostObserverSha256", "runnerSha256", "requestArtifactSha256",
  ], "pin manifest.tooling");
  if (!GIT_COMMIT.test(tooling.commit) || tooling.commit !== expectedToolingCommit) {
    fail("pin manifest.tooling.commit", "must match the separately supplied tooling commit");
  }
  if (!LOWER_SHA256.test(tooling.runnerSha256)) fail("pin manifest.tooling.runnerSha256", "is invalid");
  for (const field of ["workflowSha256", "verifierSha256", "hostObserverSha256"]) {
    if (!LOWER_SHA256.test(tooling[field])) fail(`pin manifest.tooling.${field}`, "is invalid");
  }
  if (tooling.requestArtifactSha256 !== frozenPins.requestArtifactSha256) {
    fail("pin manifest.tooling.requestArtifactSha256", "does not match the frozen request artifact");
  }
  const runtime = exactKeys(pin.runtime, [
    "nodePath", "nodeSha256", "tiniPath", "tiniSha256", "configEnv",
  ], "pin manifest.runtime");
  if (runtime.nodePath !== CONTAINER_NODE_PATH || runtime.tiniPath !== CONTAINER_TINI_PATH ||
      !LOWER_SHA256.test(runtime.nodeSha256) || runtime.tiniSha256 !== TINI_SHA256 ||
      canonicalJson(runtime.configEnv) !== canonicalJson(EXPECTED_IMAGE_CONFIG_ENV)) {
    fail("pin manifest.runtime", "does not bind the exact absolute Node/tini executables and Config.Env allowlist");
  }
  const calibration = exactKeys(pin.calibration, [
    "requestHash", "expectedResultHash", "memoryLimitBytes", "thresholdFraction", "freshContainerRuns",
    "scientificHardDeadlineMilliseconds",
  ], "pin manifest.calibration");
  for (const [field, expected] of [
    ["requestHash", frozenPins.requestHash],
    ["expectedResultHash", frozenPins.expectedResultHash],
    ["memoryLimitBytes", frozenPins.memoryLimitBytes],
    ["thresholdFraction", frozenPins.thresholdFraction],
    ["freshContainerRuns", 3],
    ["scientificHardDeadlineMilliseconds", SCIENTIFIC_HARD_DEADLINE_MS],
  ]) {
    if (calibration[field] !== expected) fail(`pin manifest.calibration.${field}`, "does not match the frozen calibration pin");
  }
  return { pin, image, prior, tooling, runtime, calibration };
}

function inspectPriorEvidence(input, evidence, pin, frozenPins) {
  descriptor(evidence.externalEvidence.exactImageScanReceipt, input.scanReceiptBytes, "evidence.externalEvidence.exactImageScanReceipt");
  descriptor(evidence.externalEvidence.dockerInspect, input.dockerInspectBytes, "evidence.externalEvidence.dockerInspect");
  const hostDescriptor = exactKeys(evidence.externalEvidence.auxiliaryHostPreflight, [
    "path", "sha256", "byteLength", "role", "contributesToFormalApproval",
  ], "evidence.externalEvidence.auxiliaryHostPreflight");
  descriptor(
    { path: hostDescriptor.path, sha256: hostDescriptor.sha256, byteLength: hostDescriptor.byteLength },
    input.auxiliaryHostRedactedReceiptBytes,
    "evidence.externalEvidence.auxiliaryHostPreflight",
  );
  if (hostDescriptor.role !== "informational-only" || hostDescriptor.contributesToFormalApproval !== false) {
    fail("evidence.externalEvidence.auxiliaryHostPreflight", "must remain informational-only and excluded from approval");
  }
  if (sha256(input.scanReceiptBytes) !== frozenPins.exactImageScanReceiptSha256 ||
      sha256(input.scanReceiptBytes) !== pin.prior.exactImageScanReceiptSha256) {
    fail("exact image scan receipt", "hash does not match the frozen pin");
  }
  if (sha256(input.dockerInspectBytes) !== frozenPins.dockerInspectSha256 ||
      sha256(input.dockerInspectBytes) !== pin.prior.dockerInspectSha256) {
    fail("docker inspect", "hash does not match the frozen pin");
  }
  if (sha256(input.auxiliaryHostRedactedReceiptBytes) !== frozenPins.auxiliaryHostRedactedReceiptSha256 ||
      sha256(input.auxiliaryHostRedactedReceiptBytes) !== pin.prior.auxiliaryHostRedactedReceiptSha256) {
    fail("redacted auxiliary host receipt", "hash does not match the frozen informational evidence pin");
  }
  const scan = record(parseJsonBytes(input.scanReceiptBytes, "exact image scan receipt"), "exact image scan receipt");
  const scanImage = record(scan.image, "exact image scan receipt.image");
  const scanReport = record(scan.scan, "exact image scan receipt.scan");
  if (scan.schemaVersion !== "3dena.container-scan-receipt.v3" || scan.status !== "passed" ||
      scan.repository !== "HUDongpin/j-3dENA" || scanImage.ref !== pin.image.ref ||
      scanImage.digest !== frozenPins.imageDigest || scanImage.sourceHeadCommit !== frozenPins.imageSourceCommit ||
      scanImage.user !== "10001:10001" || scanImage.os !== "linux" || scanImage.architecture !== "amd64" ||
      scanImage.inspectSha256 !== frozenPins.dockerInspectSha256 || scanReport.resultCount !== 0 ||
      scanReport.artifactName !== pin.image.ref) {
    fail("exact image scan receipt", "does not bind the clean exact Linux amd64 image identity");
  }
  const inspect = parseJsonBytes(input.dockerInspectBytes, "docker inspect");
  if (!Array.isArray(inspect) || inspect.length !== 1) fail("docker inspect", "must contain exactly one image");
  const image = record(inspect[0], "docker inspect[0]");
  const config = record(image.Config, "docker inspect[0].Config");
  const labels = record(config.Labels, "docker inspect[0].Config.Labels");
  if (!Array.isArray(image.RepoDigests) || !image.RepoDigests.includes(pin.image.ref) ||
      image.Os !== "linux" || image.Architecture !== "amd64" || config.User !== "10001:10001" ||
      canonicalJson(config.Env) !== canonicalJson(EXPECTED_IMAGE_CONFIG_ENV) ||
      labels["org.opencontainers.image.revision"] !== frozenPins.imageSourceCommit ||
      labels["org.3dena.tini.sha256"] !== pin.runtime.tiniSha256) {
    fail("docker inspect", "does not independently bind the exact image source, platform, architecture, user, and Config.Env allowlist");
  }
  const host = exactKeys(
    parseJsonBytes(input.auxiliaryHostRedactedReceiptBytes, "redacted auxiliary host receipt"),
    ["schemaVersion", "status", "sourceReceiptSha256", "sourceMeasurement", "formalMeasurement", "redaction", "claims"],
    "redacted auxiliary host receipt",
  );
  const sourceMeasurement = exactKeys(host.sourceMeasurement, [
    "platform", "architecture", "kind", "equivalentToLinuxCgroupV2ContainerMemoryPeak",
  ], "redacted auxiliary host receipt.sourceMeasurement");
  const formalMeasurement = exactKeys(host.formalMeasurement, [
    "platform", "architecture", "kind",
  ], "redacted auxiliary host receipt.formalMeasurement");
  const redaction = exactKeys(host.redaction, [
    "absolutePathsRemoved", "childProcessIdentifiersRemoved",
  ], "redacted auxiliary host receipt.redaction");
  const claims = exactKeys(host.claims, [
    "contributesToFormalApproval", "formalContainerMemoryPeakCapacityApproved",
  ], "redacted auxiliary host receipt.claims");
  if (host.schemaVersion !== "3dena.container-memory-peak-host-preflight-redacted.v1" ||
      host.status !== "INFORMATIONAL_ONLY" || host.sourceReceiptSha256 !== frozenPins.auxiliaryHostSourceReceiptSha256 ||
      sourceMeasurement.platform !== "darwin" || sourceMeasurement.architecture !== "arm64" ||
      sourceMeasurement.kind !== "macos-process-rss" ||
      sourceMeasurement.equivalentToLinuxCgroupV2ContainerMemoryPeak !== false ||
      formalMeasurement.platform !== "linux" || formalMeasurement.architecture !== "amd64" ||
      formalMeasurement.kind !== "cgroup-v2-whole-container-memory-peak" ||
      redaction.absolutePathsRemoved !== true || redaction.childProcessIdentifiersRemoved !== true ||
      claims.contributesToFormalApproval !== false || claims.formalContainerMemoryPeakCapacityApproved !== false) {
    fail("redacted auxiliary host receipt", "must explicitly deny formal container approval and contain no host path or process identifier");
  }
  return Object.freeze({
    sourceReceiptSha256: frozenPins.auxiliaryHostSourceReceiptSha256,
    redactedReceiptSha256: frozenPins.auxiliaryHostRedactedReceiptSha256,
    role: "informational-only",
    contributesToFormalApproval: false,
  });
}

function inspectRequest(bytes, pin, frozenPins) {
  if (sha256(bytes) !== frozenPins.requestArtifactSha256 ||
      sha256(bytes) !== pin.tooling.requestArtifactSha256) {
    fail("request artifact", "hash does not match the frozen request artifact SHA-256");
  }
  const request = exactKeys(parseJsonBytes(bytes, "request artifact"), [
    "dataset", "pathTask", "inferenceTask", "bootstrapTask", "networkOverlayTask", "execution",
  ], "request artifact");
  const execution = record(request.execution, "request artifact.execution");
  const { target: _target, ...scientificExecution } = execution;
  if (execution.target !== "persistent-compute-service" || execution.sdkVersion !== frozenPins.sdkVersion ||
      execution.buildId !== frozenPins.flyBuildId || execution.seed !== 2026) {
    fail("request artifact.execution", "does not bind the approved persistent v12 build and seed");
  }
  const observedRequestHash = analysisHash({
    dataset: request.dataset,
    pathTask: request.pathTask,
    inferenceTask: request.inferenceTask,
    bootstrapTask: request.bootstrapTask,
    networkOverlayTask: request.networkOverlayTask,
    execution: scientificExecution,
  });
  if (observedRequestHash !== frozenPins.requestHash || observedRequestHash !== pin.calibration.requestHash) {
    fail("request artifact.requestHash", "does not match the frozen scientific request hash");
  }
  const dataset = record(request.dataset, "request artifact.dataset");
  const receipt = record(dataset.receipt, "request artifact.dataset.receipt");
  const sourceResult = record(dataset.sourceResult, "request artifact.dataset.sourceResult");
  const result = record(sourceResult.result, "request artifact.dataset.sourceResult.result");
  const trajectory = record(result.trajectory, "request artifact.dataset.sourceResult.result.trajectory");
  const runSpec = record(record(request.pathTask, "request artifact.pathTask").runSpec, "request artifact.pathTask.runSpec");
  const inference = record(request.inferenceTask, "request artifact.inferenceTask");
  const bootstrap = record(request.bootstrapTask, "request artifact.bootstrapTask");
  const overlay = record(request.networkOverlayTask, "request artifact.networkOverlayTask");
  if (receipt.rows !== 240 || !Array.isArray(result.nodes) || result.nodes.length !== 8 ||
      !Array.isArray(runSpec.orderedPeriods) || runSpec.orderedPeriods.length !== 6 ||
      !Array.isArray(trajectory.groupOrder) || trajectory.groupOrder.length !== 2 ||
      !Array.isArray(trajectory.participantPeriods) || trajectory.participantPeriods.length !== 240 ||
      !Array.isArray(inference.requests) ||
      canonicalJson(inference.requests.map((item) => item?.kind)) !== canonicalJson(EXPECTED_ENVELOPE.inferenceFamilies) ||
      inference.requests[3]?.repetitions !== 500 || bootstrap.repetitions !== 500 ||
      !Array.isArray(overlay.requests) || overlay.requests.length !== 1) {
    fail("request artifact.workload", "does not match the approved frozen calibration envelope");
  }
  const participantsByGroup = new Map();
  const periodsByParticipant = new Map();
  for (const [index, item] of trajectory.participantPeriods.entries()) {
    const point = record(item, `request artifact.trajectory.participantPeriods[${index}]`);
    const group = record(point.group, `request artifact.trajectory.participantPeriods[${index}].group`).canonical;
    const participant = record(point.participantLabel, `request artifact.trajectory.participantPeriods[${index}].participantLabel`).canonical;
    const time = record(point.time, `request artifact.trajectory.participantPeriods[${index}].time`).canonical;
    if (typeof group !== "string" || typeof participant !== "string" || typeof time !== "string") {
      fail("request artifact.workload", "contains a non-canonical participant, group, or period identity");
    }
    if (!participantsByGroup.has(group)) participantsByGroup.set(group, new Set());
    participantsByGroup.get(group).add(participant);
    const participantKey = `${group}\u0000${participant}`;
    if (!periodsByParticipant.has(participantKey)) periodsByParticipant.set(participantKey, new Set());
    periodsByParticipant.get(participantKey).add(time);
  }
  if (participantsByGroup.size !== 2 || [...participantsByGroup.values()].some((items) => items.size !== 20) ||
      periodsByParticipant.size !== 40 || [...periodsByParticipant.values()].some((items) => items.size !== 6)) {
    fail("request artifact.workload.participantsPerGroup", "must be exactly 20 participants per group with six periods each");
  }
  return request;
}

function expectedContainerCommand(runIndex, expectedPinManifestSha256, expectedToolingCommit) {
  return [
    "--",
    CONTAINER_NODE_PATH,
    CONTAINER_RUNNER_PATH,
    "--run-index", String(runIndex),
    "--pin-manifest", "/calibration/pin-manifest.json",
    "--expected-pin-manifest-sha256", expectedPinManifestSha256,
    "--request", CONTAINER_REQUEST_PATH,
    "--scan-receipt", "/calibration/prior/scan-receipt.json",
    "--docker-inspect", "/calibration/prior/docker-inspect.json",
    "--auxiliary-host-redacted-receipt", CONTAINER_HOST_REDACTED_PATH,
    "--tooling-commit", expectedToolingCommit,
    "--output-dir", "/evidence",
  ];
}

function inspectRuntime(runtimeBytes, run, pin, policy, path, runIndex, expectedPinManifestSha256, expectedToolingCommit) {
  descriptor(run.runtimeInspect, runtimeBytes, `${path}.runtimeInspect`);
  const document = parseJsonBytes(runtimeBytes, `${path}.runtimeInspect`);
  if (!Array.isArray(document) || document.length !== 1) fail(`${path}.runtimeInspect`, "must contain one stopped container");
  const container = record(document[0], `${path}.runtimeInspect[0]`);
  const config = record(container.Config, `${path}.runtimeInspect[0].Config`);
  const host = record(container.HostConfig, `${path}.runtimeInspect[0].HostConfig`);
  const state = record(container.State, `${path}.runtimeInspect[0].State`);
  const network = record(container.NetworkSettings, `${path}.runtimeInspect[0].NetworkSettings`);
  if (canonicalJson(config.Env) !== canonicalJson(EXPECTED_IMAGE_CONFIG_ENV)) {
    fail(`${path}.runtimeInspect[0].Config.Env`, "must equal the exact frozen environment allowlist; NODE_PATH, LD_PRELOAD, altered NODE_OPTIONS, and PATH drift are forbidden");
  }
  if (typeof container.Id !== "string" || !/^[a-f0-9]{64}$/u.test(container.Id) ||
      config.Image !== pin.image.ref || config.User !== policy.runtimeUser ||
      canonicalJson(config.Entrypoint) !== canonicalJson(["/sbin/tini"]) ||
      canonicalJson(config.Cmd) !== canonicalJson(expectedContainerCommand(
        runIndex,
        expectedPinManifestSha256,
        expectedToolingCommit,
      ))) {
    fail(`${path}.runtimeInspect`, "container identity, image, or runtime user does not match policy");
  }
  const tmpfs = record(host.Tmpfs, `${path}.runtimeInspect[0].HostConfig.Tmpfs`);
  const tmpfsOptions = typeof tmpfs["/tmp"] === "string" ? tmpfs["/tmp"].split(",") : [];
  const networks = record(network.Networks, `${path}.runtimeInspect[0].NetworkSettings.Networks`);
  const networkNames = Object.keys(networks);
  const networkRecord = networkNames.length === 1 && networkNames[0] === "none"
    ? record(networks.none, `${path}.runtimeInspect[0].NetworkSettings.Networks.none`)
    : null;
  const addressFields = ["Gateway", "IPAddress", "GlobalIPv6Address", "IPv6Gateway", "MacAddress"];
  const topLevelAddressesEmpty = addressFields.every((field) =>
    network[field] === undefined || network[field] === "");
  const nestedAddressesEmpty = networkRecord === null
    ? networkNames.length === 0
    : addressFields.every((field) => networkRecord[field] === undefined || networkRecord[field] === "");
  const hostMounts = Array.isArray(host.Mounts) ? host.Mounts : [];
  const observedMounts = Array.isArray(container.Mounts) ? container.Mounts : [];
  const calibrationSource = hostMounts[0]?.Source;
  const runSource = hostMounts[1]?.Source;
  const normalizedAbsoluteMountSource = (source) =>
    typeof source === "string" && /^\/(?:[^/\\\u0000-\u001f]+\/)*[^/\\\u0000-\u001f]+$/u.test(source) &&
    source.split("/").slice(1).every((segment) => segment !== "." && segment !== "..");
  const isolatedMountSources = normalizedAbsoluteMountSource(calibrationSource) &&
    normalizedAbsoluteMountSource(runSource) && runSource.endsWith(`/run-${runIndex}`) &&
    runSource !== calibrationSource && !runSource.startsWith(`${calibrationSource}/`) &&
    !calibrationSource.startsWith(`${runSource}/`);
  const mountsMatch = hostMounts.length === 2 && observedMounts.length === 2 &&
    isolatedMountSources && hostMounts[0]?.Type === "bind" &&
    hostMounts[0]?.Target === "/calibration" && hostMounts[0]?.ReadOnly === true &&
    hostMounts[1]?.Type === "bind" &&
    hostMounts[1]?.Target === "/evidence" && hostMounts[1]?.ReadOnly === false &&
    observedMounts[0]?.Type === "bind" && observedMounts[0]?.Source === calibrationSource &&
    observedMounts[0]?.Destination === "/calibration" && observedMounts[0]?.RW === false &&
    observedMounts[1]?.Type === "bind" && observedMounts[1]?.Source === runSource &&
    observedMounts[1]?.Destination === "/evidence" && observedMounts[1]?.RW === true;
  if (host.NetworkMode !== "none" || !topLevelAddressesEmpty || !nestedAddressesEmpty ||
      host.Privileged !== false || host.CapAdd !== null || host.Binds !== null ||
      !Array.isArray(host.Devices) || host.Devices.length !== 0 ||
      host.PidMode !== "" || host.IpcMode !== "private" || host.UsernsMode !== "" ||
      host.CgroupnsMode !== "private" || !mountsMatch || host.ReadonlyRootfs !== true ||
      host.Memory !== policy.memoryMaxBytes || host.MemorySwap !== policy.memoryMaxBytes ||
      host.MemorySwappiness !== 0 || host.NanoCpus !== 1_000_000_000 || host.PidsLimit !== policy.pidsMax ||
      !Array.isArray(host.CapDrop) || canonicalJson(host.CapDrop) !== canonicalJson(["ALL"]) ||
      !Array.isArray(host.SecurityOpt) || canonicalJson(host.SecurityOpt) !== canonicalJson(["no-new-privileges"]) ||
      Object.keys(tmpfs).length !== 1 || canonicalJson(tmpfsOptions) !== canonicalJson(policy.tmpfs.options)) {
    fail(`${path}.runtimeInspect`, "entrypoint, command, privilege, namespace, bind, mount, device, security, network, memory, cpu, pids, or tmpfs policy drifted");
  }
  if (state.Status !== "exited" || state.Running !== false || state.OOMKilled !== false || state.Dead !== false ||
      state.ExitCode !== 0 || state.Error !== "") {
    fail(`${path}.runtimeInspect.State`, "container did not exit cleanly without OOM or signal evidence");
  }
  return { container, state };
}

function inspectHostObservation(bytes, declared, runtime, raw, pin, policy, path, runIndex) {
  descriptor(declared.hostObservation, bytes, `${path}.hostObservation`);
  const observation = exactKeys(parseJsonBytes(bytes, `${path}.hostObservation`), [
    "schemaVersion", "status", "runIndex", "containerId", "observer", "measurement", "execution", "claims",
  ], `${path}.hostObservation`);
  const observer = exactKeys(observation.observer, [
    "toolingCommit", "observerSha256",
  ], `${path}.hostObservation.observer`);
  const measurement = exactKeys(observation.measurement, [
    "source", "cgroupPathSha256", "memoryMaxBytes", "memorySwapMaxBytes",
    "maximumMemoryPeakBytes", "sampleCount",
  ], `${path}.hostObservation.measurement`);
  const execution = exactKeys(observation.execution, [
    "startedAt", "completedAt", "durationMilliseconds", "targetExited",
  ], `${path}.hostObservation.execution`);
  const claims = exactKeys(observation.claims, [
    "independentFromContainerPayload", "wholeContainerAccounting", "equivalentToScientificChildProcessRss",
  ], `${path}.hostObservation.claims`);
  const started = Date.parse(execution.startedAt);
  const completed = Date.parse(execution.completedAt);
  const runtimeStarted = Date.parse(runtime.state.StartedAt);
  const rawCompleted = Date.parse(raw.execution.completedAt);
  if (observation.schemaVersion !== "3dena.container-memory-peak-host-cgroup-observation.v1" ||
      observation.status !== "OBSERVED" || observation.runIndex !== runIndex ||
      observation.containerId !== runtime.container.Id || observer.toolingCommit !== pin.tooling.commit ||
      observer.observerSha256 !== pin.tooling.hostObserverSha256 ||
      measurement.source !== "host-side-cgroup-v2" || !LOWER_SHA256.test(measurement.cgroupPathSha256) ||
      measurement.memoryMaxBytes !== policy.memoryMaxBytes || measurement.memorySwapMaxBytes !== policy.memorySwapMaxBytes ||
      !Number.isSafeInteger(measurement.maximumMemoryPeakBytes) || measurement.maximumMemoryPeakBytes <= 0 ||
      measurement.maximumMemoryPeakBytes < raw.cgroup.memoryPeakBytes ||
      measurement.maximumMemoryPeakBytes > policy.memoryMaxBytes ||
      !Number.isSafeInteger(measurement.sampleCount) || measurement.sampleCount < 1 ||
      !Number.isFinite(started) || !Number.isFinite(completed) ||
      new Date(started).toISOString() !== execution.startedAt ||
      new Date(completed).toISOString() !== execution.completedAt || completed <= started ||
      execution.durationMilliseconds !== completed - started || started < runtimeStarted || completed < rawCompleted ||
      execution.targetExited !== true || claims.independentFromContainerPayload !== true ||
      claims.wholeContainerAccounting !== true || claims.equivalentToScientificChildProcessRss !== false) {
    fail(`${path}.hostObservation`, "does not independently bind the target container's host-side cgroup v2 memory.peak and exact limits");
  }
  return Object.freeze({
    hostObservedContainerMemoryPeakBytes: measurement.maximumMemoryPeakBytes,
    hostObserverSha256: observer.observerSha256,
    cgroupPathSha256: measurement.cgroupPathSha256,
    sampleCount: measurement.sampleCount,
  });
}

function scientificCore(bundle) {
  const identity = record(bundle.identity, "artifact.bundle.identity");
  const execution = record(bundle.execution, "artifact.bundle.execution");
  const { resultHash: _resultHash, runId: _runId, requestHash: _requestHash, ...scientificIdentity } = identity;
  const { target: _target, ...scientificExecution } = execution;
  return {
    schemaVersion: bundle.schemaVersion,
    identity: scientificIdentity,
    runSpec: bundle.runSpec,
    model: bundle.model,
    paths: bundle.paths,
    inference: bundle.inference,
    pathComparisons: bundle.pathComparisons,
    bootstrap: bundle.bootstrap,
    codeGeometry: bundle.codeGeometry,
    networkOverlays: bundle.networkOverlays,
    diagnostics: bundle.diagnostics,
    scientificExecution,
  };
}

function countOccurrences(text, marker) {
  let count = 0;
  let offset = 0;
  while (true) {
    const found = text.indexOf(marker, offset);
    if (found < 0) return count;
    count += 1;
    offset = found + marker.length;
  }
}

function inspectGithubRunProvenance(value, expectedToolingCommit) {
  const provenance = exactKeys(value, [
    "schemaVersion", "repository", "repositoryId", "repositoryOwnerId", "serverUrl", "ref", "refProtected", "sha", "workflowPath",
    "workflowRef", "workflowSha", "runId", "runAttempt", "job",
    "protectedEnvironment", "runnerEnvironment", "artifacts",
  ], "evidence.githubProvenance");
  const runnerEnvironment = exactKeys(provenance.runnerEnvironment, [
    "runnerOs", "runnerArch", "runnerImage", "runnerImageVersion", "kernelRelease", "kernelVersion",
    "dockerClientVersion", "dockerServerVersion", "cgroupVersion", "cgroupFilesystem",
  ], "evidence.githubProvenance.runnerEnvironment");
  const boundedText = (value) =>
    typeof value === "string" && value.length >= 1 && value.length <= 256 && !/[\u0000-\u001f]/u.test(value);
  if (runnerEnvironment.runnerOs !== "Linux" || runnerEnvironment.runnerArch !== "X64" ||
      !/^ubuntu[0-9]+$/u.test(runnerEnvironment.runnerImage) ||
      !/^[A-Za-z0-9._-]+$/u.test(runnerEnvironment.runnerImageVersion) ||
      !boundedText(runnerEnvironment.kernelRelease) || !boundedText(runnerEnvironment.kernelVersion) ||
      !/^[0-9]+(?:\.[0-9]+){1,3}(?:[-+._A-Za-z0-9]*)?$/u.test(runnerEnvironment.dockerClientVersion) ||
      !/^[0-9]+(?:\.[0-9]+){1,3}(?:[-+._A-Za-z0-9]*)?$/u.test(runnerEnvironment.dockerServerVersion) ||
      runnerEnvironment.cgroupVersion !== 2 || runnerEnvironment.cgroupFilesystem !== "cgroup2fs") {
    fail("evidence.githubProvenance.runnerEnvironment", "must record the exact Linux X64 GitHub image, kernel, Docker client/server, and cgroup v2 runtime observation");
  }
  const artifacts = exactKeys(provenance.artifacts, [
    "evidenceName", "formalReceiptName",
  ], "evidence.githubProvenance.artifacts");
  if (provenance.schemaVersion !== "3dena.container-memory-peak-github-run-provenance.v1" ||
      provenance.repository !== GITHUB_REPOSITORY || provenance.serverUrl !== GITHUB_SERVER_URL ||
      provenance.repositoryId !== GITHUB_REPOSITORY_ID ||
      provenance.repositoryOwnerId !== GITHUB_REPOSITORY_OWNER_ID ||
      provenance.ref !== GITHUB_MAIN_REF || provenance.refProtected !== true ||
      provenance.sha !== expectedToolingCommit || provenance.workflowPath !== GITHUB_WORKFLOW_PATH ||
      provenance.workflowRef !== `${GITHUB_REPOSITORY}/${GITHUB_WORKFLOW_PATH}@${provenance.ref}` ||
      provenance.workflowSha !== expectedToolingCommit ||
      typeof provenance.runId !== "string" || !/^[1-9][0-9]*$/u.test(provenance.runId) ||
      !Number.isSafeInteger(provenance.runAttempt) || provenance.runAttempt < 1 ||
      provenance.job !== GITHUB_PRODUCER_JOB || provenance.protectedEnvironment !== GITHUB_PROTECTED_ENVIRONMENT ||
      artifacts.evidenceName !== EVIDENCE_ARTIFACT_NAME ||
      artifacts.formalReceiptName !== FORMAL_RECEIPT_ARTIFACT_NAME) {
    fail("evidence.githubProvenance", "does not bind the exact protected main GitHub repository, workflow run, and artifact names");
  }
  return Object.freeze({
    ...structuredClone(provenance),
    runUrl: `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${provenance.runId}`,
  });
}

function inspectRun(inputRun, evidenceRun, index, pin, frozenPins, policy, frozenRequest, expectedPinManifestSha256) {
  const path = `evidence.runs[${index}]`;
  const declared = exactKeys(evidenceRun, [
    "runIndex", "rawRun", "runtimeInspect", "hostObservation", "artifact", "stdout", "stderr", "childStdout", "childStderr",
  ], path);
  const runIndex = index + 1;
  if (declared.runIndex !== runIndex) fail(`${path}.runIndex`, "must preserve exact 1..3 order");
  const files = exactKeys(inputRun, [
    "rawRunBytes", "runtimeInspectBytes", "hostObservationBytes", "artifactBytes", "stdoutBytes", "stderrBytes",
    "childStdoutBytes", "childStderrBytes",
  ], `input.runs[${index}]`);
  for (const field of Object.keys(files)) asBytes(files[field], `input.runs[${index}].${field}`);
  descriptor(declared.rawRun, files.rawRunBytes, `${path}.rawRun`);
  descriptor(declared.artifact, files.artifactBytes, `${path}.artifact`);
  descriptor(declared.stdout, files.stdoutBytes, `${path}.stdout`);
  descriptor(declared.stderr, files.stderrBytes, `${path}.stderr`);
  descriptor(declared.childStdout, files.childStdoutBytes, `${path}.childStdout`);
  descriptor(declared.childStderr, files.childStderrBytes, `${path}.childStderr`);

  const runtime = inspectRuntime(
    files.runtimeInspectBytes,
    declared,
    pin,
    policy,
    path,
    runIndex,
    expectedPinManifestSha256,
    pin.tooling.commit,
  );
  const raw = exactKeys(parseJsonBytes(files.rawRunBytes, `${path}.rawRun`), [
    "schemaVersion", "runIndex", "identity", "environment", "cgroup", "workload",
    "execution", "logs", "auxiliaryHostPreflight",
  ], `${path}.rawRun`);
  if (raw.schemaVersion !== RAW_RUN_VERSION || raw.runIndex !== runIndex) fail(`${path}.rawRun.schemaVersion`, "or runIndex is invalid");
  const identity = exactKeys(raw.identity, [
    "imageDigest", "imageSourceCommit", "flyBuildId", "sdkVersion", "scientificWorkerSha256",
    "runtimeBundleSha256", "buildManifestSha256", "exactImageScanReceiptSha256",
    "dockerInspectSha256", "toolingCommit", "runnerSha256", "requestArtifactSha256",
    "requestHash", "expectedResultHash",
  ], `${path}.rawRun.identity`);
  const expectedIdentity = {
    imageDigest: frozenPins.imageDigest,
    imageSourceCommit: frozenPins.imageSourceCommit,
    flyBuildId: frozenPins.flyBuildId,
    sdkVersion: frozenPins.sdkVersion,
    scientificWorkerSha256: frozenPins.scientificWorkerSha256,
    runtimeBundleSha256: frozenPins.runtimeBundleSha256,
    buildManifestSha256: frozenPins.buildManifestSha256,
    exactImageScanReceiptSha256: frozenPins.exactImageScanReceiptSha256,
    dockerInspectSha256: frozenPins.dockerInspectSha256,
    toolingCommit: pin.tooling.commit,
    runnerSha256: pin.tooling.runnerSha256,
    requestArtifactSha256: frozenPins.requestArtifactSha256,
    requestHash: frozenPins.requestHash,
    expectedResultHash: frozenPins.expectedResultHash,
  };
  for (const [field, expected] of Object.entries(expectedIdentity)) {
    if (identity[field] !== expected) fail(`${path}.rawRun.identity.${field}`, "does not match the exact pin");
  }
  const environment = exactKeys(raw.environment, [
    "platform", "architecture", "cgroupVersion", "runtimeUser", "nodeVersion", "containerId",
  ], `${path}.rawRun.environment`);
  for (const field of ["platform", "architecture", "cgroupVersion", "runtimeUser"]) {
    if (environment[field] !== policy[field]) fail(`${path}.rawRun.environment.${field}`, "does not match the Linux container policy");
  }
  if (typeof environment.nodeVersion !== "string" || !/^v(?:2[0-9]|[3-9][0-9])\./u.test(environment.nodeVersion)) {
    fail(`${path}.rawRun.environment.nodeVersion`, "must identify Node 20 or newer");
  }
  if (typeof environment.containerId !== "string" || !CONTAINER_ID.test(environment.containerId) ||
      !runtime.container.Id.startsWith(environment.containerId)) {
    fail(`${path}.rawRun.environment.containerId`, "does not match runtime inspect container identity");
  }
  const cgroup = exactKeys(raw.cgroup, [
    "memoryMaxBytes", "memoryPeakBytes", "memorySwapMaxBytes", "cpuQuotaMicroseconds",
    "cpuPeriodMicroseconds", "cpuCount", "pidsMax", "oomEvents", "oomKillEvents",
  ], `${path}.rawRun.cgroup`);
  for (const [field, expected] of [
    ["memoryMaxBytes", policy.memoryMaxBytes],
    ["memorySwapMaxBytes", policy.memorySwapMaxBytes],
    ["cpuQuotaMicroseconds", 100_000],
    ["cpuPeriodMicroseconds", 100_000],
    ["cpuCount", policy.cpuCount],
    ["pidsMax", policy.pidsMax],
    ["oomEvents", 0],
    ["oomKillEvents", 0],
  ]) {
    if (cgroup[field] !== expected) fail(`${path}.rawRun.cgroup.${field}`, "does not match the exact cgroup v2 limit");
  }
  if (!Number.isSafeInteger(cgroup.memoryPeakBytes) || cgroup.memoryPeakBytes <= 0 ||
      cgroup.memoryPeakBytes > policy.memoryMaxBytes) {
    fail(`${path}.rawRun.cgroup.memoryPeakBytes`, "must be a positive measured peak within memory.max");
  }
  exactJson(raw.workload, EXPECTED_ENVELOPE, `${path}.rawRun.workload`);
  const execution = exactKeys(raw.execution, [
    "startedAt", "completedAt", "durationMilliseconds", "scientificHardDeadlineMilliseconds", "scientificChildrenStarted",
    "maximumConcurrentScientificChildren", "childExitCode", "childSignal", "artifactAckSendCompleted",
    "publicationAckSendCompleted", "workerExitedSuccessfullyAfterAckSends",
    "requestHash", "resultHash", "artifactSha256", "artifactByteLength",
  ], `${path}.rawRun.execution`);
  const started = Date.parse(execution.startedAt);
  const completed = Date.parse(execution.completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed) ||
      new Date(started).toISOString() !== execution.startedAt || new Date(completed).toISOString() !== execution.completedAt ||
      completed <= started || execution.durationMilliseconds !== completed - started) {
    fail(`${path}.rawRun.execution.durationMilliseconds`, "must bind canonical timestamps and exact positive duration");
  }
  const stateStarted = Date.parse(runtime.state.StartedAt);
  const stateFinished = Date.parse(runtime.state.FinishedAt);
  if (!Number.isFinite(stateStarted) || !Number.isFinite(stateFinished) || started < stateStarted || completed > stateFinished) {
    fail(`${path}.rawRun.execution`, "timestamps must be contained by Docker runtime state");
  }
  if (execution.scientificChildrenStarted !== 1 || execution.maximumConcurrentScientificChildren !== 1 ||
      execution.scientificHardDeadlineMilliseconds !== SCIENTIFIC_HARD_DEADLINE_MS ||
      execution.childExitCode !== 0 || execution.childSignal !== null || execution.artifactAckSendCompleted !== true ||
      execution.publicationAckSendCompleted !== true || execution.workerExitedSuccessfullyAfterAckSends !== true ||
      execution.requestHash !== frozenPins.requestHash ||
      execution.resultHash !== frozenPins.expectedResultHash || execution.artifactSha256 !== sha256(files.artifactBytes) ||
      execution.artifactByteLength !== files.artifactBytes.byteLength) {
    fail(`${path}.rawRun.execution`, "child exit, signal, single-child, completed IPC sends, artifact, publication, request, or result evidence failed");
  }
  const logs = exactKeys(raw.logs, [
    "leakMarkerSha256", "childStdoutSha256", "childStdoutByteLength",
    "childStderrSha256", "childStderrByteLength", "markerLeakCount",
  ], `${path}.rawRun.logs`);
  const stdout = decodeText(files.stdoutBytes, `${path}.stdout`);
  const stderr = decodeText(files.stderrBytes, `${path}.stderr`);
  const childStdout = decodeText(files.childStdoutBytes, `${path}.childStdout`);
  const childStderr = decodeText(files.childStderrBytes, `${path}.childStderr`);
  if (stderr !== "" || childStdout !== "" || childStderr !== "") {
    fail(`${path}.stderr`, "runner stderr and scientific child stdout/stderr must be empty");
  }
  const leakCount = [stdout, stderr, childStdout, childStderr]
    .reduce((sum, text) => sum + countOccurrences(text, LEAK_MARKER), 0);
  if (logs.leakMarkerSha256 !== sha256(Buffer.from(LEAK_MARKER)) ||
      logs.childStdoutSha256 !== sha256(files.childStdoutBytes) || logs.childStdoutByteLength !== files.childStdoutBytes.byteLength ||
      logs.childStderrSha256 !== sha256(files.childStderrBytes) || logs.childStderrByteLength !== files.childStderrBytes.byteLength ||
      logs.markerLeakCount !== leakCount || leakCount !== 0) {
    fail(`${path}.rawRun.logs.markerLeakCount`, "marker leak or child log hash mismatch detected");
  }
  const auxiliary = exactKeys(raw.auxiliaryHostPreflight, [
    "sourceReceiptSha256", "redactedReceiptSha256", "informationalOnly", "contributesToFormalApproval",
  ], `${path}.rawRun.auxiliaryHostPreflight`);
  if (auxiliary.sourceReceiptSha256 !== frozenPins.auxiliaryHostSourceReceiptSha256 ||
      auxiliary.redactedReceiptSha256 !== frozenPins.auxiliaryHostRedactedReceiptSha256 || auxiliary.informationalOnly !== true ||
      auxiliary.contributesToFormalApproval !== false) {
    fail(`${path}.rawRun.auxiliaryHostPreflight`, "must not contribute to formal approval");
  }
  const markerText = stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
  if (markerText.includes("\n") || markerText === "") fail(`${path}.stdout`, "must contain exactly one marker JSON line");
  const marker = exactKeys(parseStrictJson(markerText), [
    "schemaVersion", "status", "runIndex", "rawRunSha256", "artifactSha256", "resultHash",
  ], `${path}.stdout.marker`);
  if (marker.schemaVersion !== MARKER_VERSION || marker.status !== "passed" || marker.runIndex !== runIndex ||
      marker.rawRunSha256 !== sha256(files.rawRunBytes) || marker.artifactSha256 !== sha256(files.artifactBytes) ||
      marker.resultHash !== frozenPins.expectedResultHash) {
    fail(`${path}.stdout.marker`, "does not cross-bind the raw run and result artifact");
  }

  const artifact = exactKeys(parseJsonBytes(files.artifactBytes, `${path}.artifact`), [
    "version", "owner", "taskKind", "requestHash", "bundle",
  ], `${path}.artifact`);
  if (artifact.version !== "3dena.compute-scientific-longitudinal-result-artifact.v2" ||
      artifact.taskKind !== "longitudinal-analysis-v2" || artifact.requestHash !== frozenPins.requestHash) {
    fail(`${path}.artifact`, "does not bind the scientific longitudinal request");
  }
  const artifactOwner = exactKeys(artifact.owner, [
    "contractVersion", "datasetHash", "specHash", "runId", "taskId",
  ], `${path}.artifact.owner`);
  const bundle = exactKeys(artifact.bundle, [
    "schemaVersion", "identity", "runSpec", "model", "paths", "inference", "pathComparisons",
    "bootstrap", "codeGeometry", "networkOverlays", "diagnostics", "execution",
  ], `${path}.artifact.bundle`);
  const bundleIdentity = exactKeys(bundle.identity, [
    "datasetHash", "specHash", "sourceResultHash", "requestHash", "resultHash", "runId", "jenaBuildId",
  ], `${path}.artifact.bundle.identity`);
  const bundleExecution = exactKeys(bundle.execution, [
    "target", "jenaVersion", "jenaCommit", "jenaTarballIntegrity", "sdkVersion", "buildId", "seed",
    "permutationPlanHashes", "resamplingPlanHashes", "evidenceStatus",
  ], `${path}.artifact.bundle.execution`);
  const requestPathTask = record(frozenRequest.pathTask, "request artifact.pathTask");
  const requestRunSpec = record(requestPathTask.runSpec, "request artifact.pathTask.runSpec");
  if (artifactOwner.contractVersion !== "3dena.compute-task-owner.v1" ||
      artifactOwner.taskId !== "container-memory-peak-v12-task" ||
      artifactOwner.datasetHash !== requestPathTask.datasetHash ||
      artifactOwner.specHash !== requestPathTask.specHash ||
      artifactOwner.runId !== requestPathTask.runId ||
      artifactOwner.datasetHash !== bundleIdentity.datasetHash ||
      artifactOwner.specHash !== bundleIdentity.specHash ||
      artifactOwner.runId !== bundleIdentity.runId) {
    fail(`${path}.artifact.owner`, "must bind the exact calibration task and scientific bundle identity");
  }
  if (bundleIdentity.datasetHash !== requestPathTask.datasetHash ||
      bundleIdentity.specHash !== requestPathTask.specHash ||
      bundleIdentity.runId !== requestPathTask.runId ||
      bundleIdentity.sourceResultHash !== requestRunSpec.sourceResultHash) {
    fail(`${path}.artifact.bundle.identity`, "must bind the frozen request identity");
  }
  exactJson(bundle.runSpec, requestRunSpec, `${path}.artifact.bundle.runSpec`);
  if (bundleIdentity.requestHash !== frozenPins.requestHash || bundleIdentity.resultHash !== frozenPins.expectedResultHash ||
      bundleExecution.target !== "persistent-compute-service" || bundleExecution.sdkVersion !== frozenPins.sdkVersion ||
      bundleExecution.buildId !== frozenPins.flyBuildId || bundleExecution.seed !== 2026) {
    fail(`${path}.artifact.bundle`, "does not bind the expected request, result, SDK, and build identity");
  }
  if (analysisHash(scientificCore(bundle)) !== bundleIdentity.resultHash) {
    fail(`${path}.artifact.bundle.result hash`, "canonical scientific result hash does not reproduce");
  }
  const hostObservation = inspectHostObservation(
    files.hostObservationBytes,
    declared,
    runtime,
    raw,
    pin,
    policy,
    path,
    runIndex,
  );
  return Object.freeze({
    runIndex,
    containerId: runtime.container.Id,
    measurementAuthority: "host-side-cgroup-v2-observer",
    containerSelfReportedMemoryPeakBytes: cgroup.memoryPeakBytes,
    hostObservedContainerMemoryPeakBytes: hostObservation.hostObservedContainerMemoryPeakBytes,
    containerMemoryPeakBytes: hostObservation.hostObservedContainerMemoryPeakBytes,
    containerMemoryPeakFraction: hostObservation.hostObservedContainerMemoryPeakBytes / policy.memoryMaxBytes,
    hostObserverSha256: hostObservation.hostObserverSha256,
    cgroupPathSha256: hostObservation.cgroupPathSha256,
    hostObserverSampleCount: hostObservation.sampleCount,
    resultHash: bundleIdentity.resultHash,
  });
}

function verifyContainerMemoryPeakEvidenceCandidateDocuments(input, options, frozenPins) {
  if (!isRecord(input)) throw new TypeError("Container memory peak evidence document must be an object.");
  const source = exactKeys(input, [
    "evidence", "pinManifestBytes", "scanReceiptBytes", "dockerInspectBytes", "workflowBytes",
    "verifierBytes", "hostObserverBytes", "runnerBytes",
    "requestBytes", "auxiliaryHostRedactedReceiptBytes", "runs",
  ], "input");
  const evidence = exactKeys(source.evidence, [
    "schemaVersion", "status", "pinManifest", "externalEvidence", "tooling",
    "githubProvenance", "approvedCalibrationEnvelope", "executionPolicy", "runs", "aggregate", "claims",
  ], "evidence");
  if (evidence.schemaVersion !== EVIDENCE_VERSION) fail("evidence.schemaVersion", "is unsupported");
  if (evidence.status !== "EXECUTED") fail("evidence.status", "must be EXECUTED, not NOT_RUN or self-attested");
  const expectedPinManifestSha256 = options.expectedPinManifestSha256;
  const expectedToolingCommit = options.expectedToolingCommit;
  if (typeof expectedPinManifestSha256 !== "string" || !LOWER_SHA256.test(expectedPinManifestSha256)) {
    fail("options.expectedPinManifestSha256", "must be an external lowercase SHA-256 pin");
  }
  if (typeof expectedToolingCommit !== "string" || !GIT_COMMIT.test(expectedToolingCommit)) {
    fail("options.expectedToolingCommit", "must be a full lowercase Git SHA separate from image source");
  }
  const pinManifestBytes = asBytes(source.pinManifestBytes, "input.pinManifestBytes");
  descriptor(evidence.pinManifest, pinManifestBytes, "evidence.pinManifest");
  const pin = inspectPinManifest(
    pinManifestBytes,
    expectedPinManifestSha256,
    expectedToolingCommit,
    frozenPins,
  );
  evidence.externalEvidence = exactKeys(evidence.externalEvidence, [
    "exactImageScanReceipt", "dockerInspect", "auxiliaryHostPreflight",
  ], "evidence.externalEvidence");
  const tooling = exactKeys(evidence.tooling, [
    "toolingCommit", "imageSourceCommit", "workflow", "verifier", "hostObserver", "runner", "request",
  ], "evidence.tooling");
  if (tooling.toolingCommit !== expectedToolingCommit || tooling.imageSourceCommit !== frozenPins.imageSourceCommit) {
    fail("evidence.tooling", "must keep toolingCommit separate from imageSourceCommit");
  }
  if (tooling.toolingCommit === tooling.imageSourceCommit) {
    fail("evidence.tooling.toolingCommit", "must not masquerade as the frozen image source commit");
  }
  const githubProvenance = inspectGithubRunProvenance(
    evidence.githubProvenance,
    expectedToolingCommit,
  );
  descriptor(tooling.workflow, asBytes(source.workflowBytes, "input.workflowBytes"), "evidence.tooling.workflow");
  descriptor(tooling.verifier, asBytes(source.verifierBytes, "input.verifierBytes"), "evidence.tooling.verifier");
  descriptor(tooling.hostObserver, asBytes(source.hostObserverBytes, "input.hostObserverBytes"), "evidence.tooling.hostObserver");
  descriptor(tooling.runner, asBytes(source.runnerBytes, "input.runnerBytes"), "evidence.tooling.runner");
  descriptor(tooling.request, asBytes(source.requestBytes, "input.requestBytes"), "evidence.tooling.request");
  for (const [label, bytes, expected] of [
    ["workflow", source.workflowBytes, pin.tooling.workflowSha256],
    ["verifier", source.verifierBytes, pin.tooling.verifierSha256],
    ["host observer", source.hostObserverBytes, pin.tooling.hostObserverSha256],
    ["runner", source.runnerBytes, pin.tooling.runnerSha256],
  ]) {
    if (sha256(bytes) !== expected) fail(`${label} SHA256`, "does not match the externally hash-bound pin manifest tooling identity");
  }
  const frozenRequest = inspectRequest(source.requestBytes, pin, frozenPins);
  const auxiliaryHostPreflight = inspectPriorEvidence(source, evidence, pin, frozenPins);
  exactJson(evidence.approvedCalibrationEnvelope, EXPECTED_ENVELOPE, "evidence.approvedCalibrationEnvelope");
  exactJson(evidence.executionPolicy, EXPECTED_POLICY, "evidence.executionPolicy");
  const policy = evidence.executionPolicy;
  if (!Array.isArray(evidence.runs) || evidence.runs.length !== 3 ||
      !Array.isArray(source.runs) || source.runs.length !== 3) {
    fail("evidence.runs", "must contain exactly three fresh container runs");
  }
  const verifiedRuns = evidence.runs.map((run, index) =>
    inspectRun(
      source.runs[index],
      run,
      index,
      pin,
      frozenPins,
      policy,
      frozenRequest,
      expectedPinManifestSha256,
    ));
  if (new Set(verifiedRuns.map((run) => run.containerId)).size !== 3) {
    fail("evidence.runs.containerId", "must contain three unique fresh container IDs");
  }
  const maximumContainerMemoryPeakBytes = Math.max(...verifiedRuns.map((run) => run.containerMemoryPeakBytes));
  const maximumContainerMemoryPeakFraction = maximumContainerMemoryPeakBytes / frozenPins.memoryLimitBytes;
  if (maximumContainerMemoryPeakFraction > frozenPins.thresholdFraction) {
    fail("evidence.aggregate.maximumContainerMemoryPeakFraction", "exceeds the exact 0.5 sizing threshold");
  }
  const aggregate = exactKeys(evidence.aggregate, [
    "runCount", "maximumContainerMemoryPeakBytes", "memoryLimitBytes", "maximumContainerMemoryPeakFraction",
    "thresholdFraction", "calibrationEnvelopeUnderThreshold",
  ], "evidence.aggregate");
  if (aggregate.runCount !== 3 || aggregate.maximumContainerMemoryPeakBytes !== maximumContainerMemoryPeakBytes ||
      aggregate.memoryLimitBytes !== frozenPins.memoryLimitBytes || aggregate.maximumContainerMemoryPeakFraction !== maximumContainerMemoryPeakFraction ||
      aggregate.thresholdFraction !== frozenPins.thresholdFraction || aggregate.calibrationEnvelopeUnderThreshold !== true) {
    fail("evidence.aggregate", "self-reported aggregate does not match the three raw runs");
  }
  const claims = exactKeys(evidence.claims, [
    "approvedCalibrationEnvelopeOnly", "extrapolationBeyondEnvelopeApproved", "realFlyMultiMachineApproved",
    "requiredRealFlyMachines", "realFlyMultiMachineStatus",
  ], "evidence.claims");
  if (claims.approvedCalibrationEnvelopeOnly !== true || claims.extrapolationBeyondEnvelopeApproved !== false ||
      claims.realFlyMultiMachineApproved !== false || claims.requiredRealFlyMachines !== 2 ||
      claims.realFlyMultiMachineStatus !== "NOT_RUN") {
    fail("evidence.claims.real Fly multi-machine", "three containers are not >=2 real Fly Machines; status must remain NOT_RUN");
  }
  return Object.freeze({
    schemaVersion: RECEIPT_VERSION,
    status: "consistency-passed",
    measurement: Object.freeze({
      kind: "linux-cgroup-v2-container-memory-peak",
      scope: "whole-container",
      source: "host-side-observer-of-target-cgroup-v2-memory.peak",
      includesRunnerAndContainerAccounting: true,
      equivalentToScientificChildProcessRss: false,
      equivalentToMacosProcessRss: false,
    }),
    image: Object.freeze({
      ref: pin.image.ref,
      digest: frozenPins.imageDigest,
      sourceCommit: frozenPins.imageSourceCommit,
      flyBuildId: frozenPins.flyBuildId,
      sdkVersion: frozenPins.sdkVersion,
      scientificWorkerSha256: frozenPins.scientificWorkerSha256,
      runtimeBundleSha256: frozenPins.runtimeBundleSha256,
      buildManifestSha256: frozenPins.buildManifestSha256,
    }),
    tooling: Object.freeze({
      toolingCommit: expectedToolingCommit,
      imageSourceCommit: frozenPins.imageSourceCommit,
      runnerSha256: pin.tooling.runnerSha256,
      workflowSha256: pin.tooling.workflowSha256,
      verifierSha256: pin.tooling.verifierSha256,
      hostObserverSha256: pin.tooling.hostObserverSha256,
      nodePath: pin.runtime.nodePath,
      nodeSha256: pin.runtime.nodeSha256,
      tiniPath: pin.runtime.tiniPath,
      tiniSha256: pin.runtime.tiniSha256,
      requestArtifactSha256: frozenPins.requestArtifactSha256,
      requestHash: frozenPins.requestHash,
    }),
    githubProvenance,
    pinManifestSha256: expectedPinManifestSha256,
    approvedCalibrationEnvelope: Object.freeze(structuredClone(EXPECTED_ENVELOPE)),
    executionPolicy: Object.freeze(structuredClone(EXPECTED_POLICY)),
    runCount: 3,
    runs: Object.freeze(verifiedRuns),
    maximumContainerMemoryPeakBytes,
    memoryLimitBytes: frozenPins.memoryLimitBytes,
    maximumContainerMemoryPeakFraction,
    thresholdFraction: frozenPins.thresholdFraction,
    calibrationEnvelopeUnderThreshold: true,
    formalLinuxContainerSizingApproved: false,
    formalContainerMemoryPeakCapacityApproved: false,
    exactScientificForkHarnessCalibrationPassed: true,
    persistentServicePathExercised: false,
    apiQueueWorkerPathExercised: false,
    persistentServiceCapacityApproved: false,
    flyCapacityApproved: false,
    approvedCalibrationEnvelopeOnly: true,
    extrapolationBeyondEnvelopeApproved: false,
    auxiliaryHostPreflight,
    realFlyMultiMachineApproved: false,
    requiredRealFlyMachines: 2,
    realFlyMultiMachineStatus: "NOT_RUN",
    boundary: "Consistency-only verification of a direct scientific fork harness and whole-container cgroup v2 memory.peak for the frozen envelope; the persistent API, queue, worker service path and >=2 real Fly Machines remain NOT_RUN.",
  });
}

export function verifyContainerMemoryPeakEvidenceDocuments(input, options = {}) {
  const fixedPinOptions = exactKeys(options, [
    "expectedPinManifestSha256", "expectedToolingCommit",
  ], "fixed-pin consistency document verification options");
  return verifyContainerMemoryPeakEvidenceCandidateDocuments(
    input,
    fixedPinOptions,
    DEFAULT_FROZEN_PINS,
  );
}

export function verifyContainerMemoryPeakTestEvidenceDocuments(input, options = {}) {
  const testOptions = exactKeys(options, [
    "expectedPinManifestSha256", "expectedToolingCommit", "frozenPins",
  ], "test-only document verification options");
  const frozenPins = exactKeys(
    testOptions.frozenPins,
    Object.keys(DEFAULT_FROZEN_PINS),
    "test-only frozenPins",
  );
  const candidate = verifyContainerMemoryPeakEvidenceCandidateDocuments(
    input,
    testOptions,
    frozenPins,
  );
  return Object.freeze({
    ...candidate,
    schemaVersion: "3dena.container-memory-peak-test-verification.v1",
    status: "test-only-consistency-pass",
    formalLinuxContainerSizingApproved: false,
    formalContainerMemoryPeakCapacityApproved: false,
    testOnlyCandidateSatisfiedFrozenPolicy: true,
    boundary: "Synthetic pin overrides are test-only consistency evidence and can never issue formal capacity approval.",
  });
}

function assertFormalGithubRuntime(expectedToolingCommit) {
  const environment = process.env;
  const expectedWorkflowRef = `${GITHUB_REPOSITORY}/${GITHUB_WORKFLOW_PATH}@${GITHUB_MAIN_REF}`;
  const required = {
    GITHUB_ACTIONS: "true",
    CI: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY,
    GITHUB_REPOSITORY_ID,
    GITHUB_REPOSITORY_OWNER_ID,
    GITHUB_SERVER_URL,
    GITHUB_REF: GITHUB_MAIN_REF,
    GITHUB_REF_PROTECTED: "true",
    GITHUB_SHA: expectedToolingCommit,
    GITHUB_WORKFLOW_SHA: expectedToolingCommit,
    GITHUB_WORKFLOW_REF: expectedWorkflowRef,
    GITHUB_JOB: GITHUB_VERIFIER_JOB,
    CONTAINER_MEMORY_PEAK_PROTECTED_ENVIRONMENT: GITHUB_PROTECTED_ENVIRONMENT,
  };
  for (const [name, expected] of Object.entries(required)) {
    if (environment[name] !== expected) {
      fail("formal GitHub Actions runtime", `${name} must equal the protected github-hosted workflow identity`);
    }
  }
  if (typeof environment.GITHUB_RUN_ID !== "string" || !/^[1-9][0-9]*$/u.test(environment.GITHUB_RUN_ID) ||
      typeof environment.GITHUB_RUN_ATTEMPT !== "string" || !/^[1-9][0-9]*$/u.test(environment.GITHUB_RUN_ATTEMPT) ||
      typeof environment.ACTIONS_ID_TOKEN_REQUEST_URL !== "string" || environment.ACTIONS_ID_TOKEN_REQUEST_URL === "" ||
      typeof environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN !== "string" || environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN === "") {
    fail("formal GitHub Actions runtime", "requires exact run/ref/attempt identity and a protected-job OIDC request capability");
  }
  return environment;
}

function parseGithubOidcJwtPart(segment, label) {
  if (typeof segment !== "string" || segment.length < 2 || segment.length > 32 * 1024 ||
      !/^[A-Za-z0-9_-]+$/u.test(segment)) {
    fail(label, "must be bounded canonical base64url without padding");
  }
  const bytes = Buffer.from(segment, "base64url");
  if (bytes.toString("base64url") !== segment) {
    fail(label, "must use canonical base64url encoding");
  }
  return parseJsonBytes(bytes, label);
}

function inspectLiveGithubOidcToken(token, environment) {
  if (typeof token !== "string" || token.length < 128 || token.length > 48 * 1024) {
    fail("live GitHub OIDC token", "must be a bounded JWT returned by GitHub");
  }
  const segments = token.split(".");
  if (segments.length !== 3 || segments[2].length < 64 || segments[2].length > 2048 ||
      !/^[A-Za-z0-9_-]+$/u.test(segments[2])) {
    fail("live GitHub OIDC token", "must contain a non-empty canonical JWT signature");
  }
  const header = record(parseGithubOidcJwtPart(segments[0], "live GitHub OIDC header"), "live GitHub OIDC header");
  const claims = record(parseGithubOidcJwtPart(segments[1], "live GitHub OIDC claims"), "live GitHub OIDC claims");
  if (header.alg !== "RS256" || header.typ !== "JWT" ||
      typeof header.kid !== "string" || header.kid.length < 1 || header.kid.length > 256) {
    fail("live GitHub OIDC header", "must identify GitHub's bounded RS256 JWT key");
  }
  const expectedSubject = `repo:${GITHUB_REPOSITORY}:environment:${GITHUB_PROTECTED_ENVIRONMENT}`;
  const expectedClaims = {
    iss: GITHUB_OIDC_ISSUER,
    aud: GITHUB_OIDC_AUDIENCE,
    sub: expectedSubject,
    repository: GITHUB_REPOSITORY,
    repository_id: GITHUB_REPOSITORY_ID,
    repository_owner_id: GITHUB_REPOSITORY_OWNER_ID,
    ref: GITHUB_MAIN_REF,
    ref_protected: "true",
    sha: environment.GITHUB_SHA,
    workflow_ref: environment.GITHUB_WORKFLOW_REF,
    workflow_sha: environment.GITHUB_WORKFLOW_SHA,
    run_id: environment.GITHUB_RUN_ID,
    run_attempt: environment.GITHUB_RUN_ATTEMPT,
    runner_environment: "github-hosted",
    event_name: "workflow_dispatch",
    environment: GITHUB_PROTECTED_ENVIRONMENT,
  };
  for (const [name, expected] of Object.entries(expectedClaims)) {
    if (String(claims[name]) !== expected) {
      fail(`live GitHub OIDC claims.${name}`, "does not bind the exact protected workflow execution");
    }
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  for (const name of ["iat", "nbf", "exp"]) {
    if (!Number.isSafeInteger(claims[name])) {
      fail(`live GitHub OIDC claims.${name}`, "must be an integer timestamp");
    }
  }
  if (claims.nbf > nowSeconds + 30 || claims.iat > nowSeconds + 30 ||
      claims.iat < nowSeconds - 120 || claims.exp <= nowSeconds ||
      claims.exp <= claims.iat || claims.exp - claims.iat > 15 * 60) {
    fail("live GitHub OIDC claims time", "must be a newly issued, currently valid, short-lived token");
  }
  return Object.freeze({
    issuer: claims.iss,
    audience: claims.aud,
    subject: claims.sub,
    repository: claims.repository,
    repositoryId: String(claims.repository_id),
    repositoryOwnerId: String(claims.repository_owner_id),
    ref: claims.ref,
    refProtected: String(claims.ref_protected) === "true",
    sha: claims.sha,
    workflowRef: claims.workflow_ref,
    workflowSha: claims.workflow_sha,
    runId: String(claims.run_id),
    runAttempt: Number(claims.run_attempt),
    runnerEnvironment: claims.runner_environment,
    eventName: claims.event_name,
    protectedEnvironment: claims.environment,
    issuedAtSeconds: claims.iat,
    expiresAtSeconds: claims.exp,
    tokenSha256: sha256(Buffer.from(token, "utf8")),
  });
}

function requestLiveGithubOidcProvenance(environment) {
  let requestUrl;
  try {
    requestUrl = new URL(environment.ACTIONS_ID_TOKEN_REQUEST_URL);
  } catch (error) {
    throw new Error("live GitHub OIDC request URL is invalid.", { cause: error });
  }
  if (requestUrl.origin !== GITHUB_OIDC_REQUEST_ORIGIN || requestUrl.protocol !== "https:" ||
      requestUrl.username !== "" || requestUrl.password !== "") {
    fail("live GitHub OIDC fixed origin", `must be ${GITHUB_OIDC_REQUEST_ORIGIN} over authenticated HTTPS`);
  }
  requestUrl.searchParams.set("audience", GITHUB_OIDC_AUDIENCE);
  return new Promise((resolveOidc, rejectOidc) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) rejectOidc(error);
      else resolveOidc(value);
    };
    const request = httpsRequest(requestUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`,
        "User-Agent": "3dena-container-memory-peak-verifier/1",
      },
      maxHeaderSize: 16 * 1024,
    }, (response) => {
      const chunks = [];
      let totalBytes = 0;
      response.on("error", (error) => finish(new Error("live GitHub OIDC response failed.", { cause: error })));
      response.on("data", (chunk) => {
        const bytes = Buffer.from(chunk);
        totalBytes += bytes.byteLength;
        if (totalBytes > MAX_GITHUB_OIDC_RESPONSE_BYTES) {
          request.destroy(new Error("live GitHub OIDC response exceeded its byte budget."));
          return;
        }
        chunks.push(bytes);
      });
      response.on("end", () => {
        try {
          if (response.statusCode !== 200 ||
              typeof response.headers["content-type"] !== "string" ||
              !response.headers["content-type"].toLowerCase().startsWith("application/json")) {
            fail("live GitHub OIDC response", "must be a successful JSON response from the fixed GitHub origin");
          }
          const body = exactKeys(
            parseJsonBytes(Buffer.concat(chunks), "live GitHub OIDC response"),
            ["value"],
            "live GitHub OIDC response",
          );
          finish(undefined, inspectLiveGithubOidcToken(body.value, environment));
        } catch (error) {
          finish(error);
        }
      });
    });
    request.setTimeout(15_000, () => {
      request.destroy(new Error("live GitHub OIDC request timed out."));
    });
    request.once("error", (error) => finish(new Error("live GitHub OIDC HTTPS exchange failed.", { cause: error })));
    request.end();
  });
}

function inspectConsistencyReceiptForFormalization(receipt, expectedToolingCommit) {
  const value = exactKeys(receipt, [
    "schemaVersion", "status", "measurement", "image", "tooling", "githubProvenance",
    "pinManifestSha256", "approvedCalibrationEnvelope", "executionPolicy", "runCount", "runs",
    "maximumContainerMemoryPeakBytes", "memoryLimitBytes", "maximumContainerMemoryPeakFraction", "thresholdFraction",
    "calibrationEnvelopeUnderThreshold", "formalLinuxContainerSizingApproved",
    "formalContainerMemoryPeakCapacityApproved", "approvedCalibrationEnvelopeOnly",
    "exactScientificForkHarnessCalibrationPassed", "persistentServicePathExercised",
    "apiQueueWorkerPathExercised", "persistentServiceCapacityApproved", "flyCapacityApproved",
    "extrapolationBeyondEnvelopeApproved", "auxiliaryHostPreflight", "realFlyMultiMachineApproved",
    "requiredRealFlyMachines", "realFlyMultiMachineStatus", "boundary",
  ], "consistency receipt");
  if (value.schemaVersion !== RECEIPT_VERSION || value.status !== "consistency-passed" ||
      value.formalLinuxContainerSizingApproved !== false ||
      value.formalContainerMemoryPeakCapacityApproved !== false ||
      value.exactScientificForkHarnessCalibrationPassed !== true ||
      value.persistentServicePathExercised !== false || value.apiQueueWorkerPathExercised !== false ||
      value.persistentServiceCapacityApproved !== false || value.flyCapacityApproved !== false ||
      value.calibrationEnvelopeUnderThreshold !== true || value.runCount !== 3 ||
      value.memoryLimitBytes !== MEMORY_LIMIT_BYTES || value.thresholdFraction !== THRESHOLD_FRACTION ||
      value.maximumContainerMemoryPeakFraction !== value.maximumContainerMemoryPeakBytes / MEMORY_LIMIT_BYTES ||
      value.maximumContainerMemoryPeakFraction > THRESHOLD_FRACTION ||
      value.approvedCalibrationEnvelopeOnly !== true || value.extrapolationBeyondEnvelopeApproved !== false ||
      value.realFlyMultiMachineApproved !== false || value.requiredRealFlyMachines !== 2 ||
      value.realFlyMultiMachineStatus !== "NOT_RUN") {
    fail("consistency receipt", "is not the fixed-pin, non-formal, under-threshold consistency result");
  }
  const measurement = exactKeys(value.measurement, [
    "kind", "scope", "source", "includesRunnerAndContainerAccounting",
    "equivalentToScientificChildProcessRss", "equivalentToMacosProcessRss",
  ], "consistency receipt.measurement");
  if (measurement.kind !== "linux-cgroup-v2-container-memory-peak" ||
      measurement.scope !== "whole-container" || measurement.source !== "host-side-observer-of-target-cgroup-v2-memory.peak" ||
      measurement.includesRunnerAndContainerAccounting !== true ||
      measurement.equivalentToScientificChildProcessRss !== false ||
      measurement.equivalentToMacosProcessRss !== false) {
    fail("consistency receipt.measurement", "must describe whole-container cgroup v2 memory.peak, not process RSS");
  }
  exactJson(value.approvedCalibrationEnvelope, EXPECTED_ENVELOPE, "consistency receipt.approvedCalibrationEnvelope");
  exactJson(value.executionPolicy, EXPECTED_POLICY, "consistency receipt.executionPolicy");
  if (!LOWER_SHA256.test(value.pinManifestSha256) || !Array.isArray(value.runs) || value.runs.length !== 3) {
    fail("consistency receipt", "pin manifest or exact three-run list is invalid");
  }
  const runs = value.runs.map((candidate, index) => {
    const run = exactKeys(candidate, [
      "runIndex", "containerId", "measurementAuthority", "containerSelfReportedMemoryPeakBytes",
      "hostObservedContainerMemoryPeakBytes", "containerMemoryPeakBytes", "containerMemoryPeakFraction",
      "hostObserverSha256", "cgroupPathSha256", "hostObserverSampleCount", "resultHash",
    ], `consistency receipt.runs[${index}]`);
    if (run.runIndex !== index + 1 || typeof run.containerId !== "string" || !/^[a-f0-9]{64}$/u.test(run.containerId) ||
        run.measurementAuthority !== "host-side-cgroup-v2-observer" ||
        !Number.isSafeInteger(run.containerSelfReportedMemoryPeakBytes) || run.containerSelfReportedMemoryPeakBytes <= 0 ||
        run.hostObservedContainerMemoryPeakBytes !== run.containerMemoryPeakBytes ||
        run.hostObservedContainerMemoryPeakBytes < run.containerSelfReportedMemoryPeakBytes ||
        !Number.isSafeInteger(run.containerMemoryPeakBytes) || run.containerMemoryPeakBytes <= 0 ||
        run.containerMemoryPeakFraction !== run.containerMemoryPeakBytes / MEMORY_LIMIT_BYTES ||
        !LOWER_SHA256.test(run.hostObserverSha256) || !LOWER_SHA256.test(run.cgroupPathSha256) ||
        !Number.isSafeInteger(run.hostObserverSampleCount) || run.hostObserverSampleCount < 1 ||
        run.resultHash !== EXPECTED_RESULT_HASH) {
      fail(`consistency receipt.runs[${index}]`, "does not reproduce an exact verified whole-container run");
    }
    return run;
  });
  if (new Set(runs.map((run) => run.containerId)).size !== 3 ||
      Math.max(...runs.map((run) => run.containerMemoryPeakBytes)) !== value.maximumContainerMemoryPeakBytes) {
    fail("consistency receipt.runs", "does not reproduce three unique containers and the aggregate maximum");
  }
  const image = exactKeys(value.image, [
    "ref", "digest", "sourceCommit", "flyBuildId", "sdkVersion", "scientificWorkerSha256",
    "runtimeBundleSha256", "buildManifestSha256",
  ], "consistency receipt.image");
  const tooling = exactKeys(value.tooling, [
    "toolingCommit", "imageSourceCommit", "workflowSha256", "verifierSha256", "hostObserverSha256",
    "runnerSha256", "nodePath", "nodeSha256", "tiniPath", "tiniSha256",
    "requestArtifactSha256", "requestHash",
  ], "consistency receipt.tooling");
  if (!IMAGE_REF.test(image.ref) || !image.ref.endsWith(`@${IMAGE_DIGEST}`) ||
      image.digest !== IMAGE_DIGEST || image.sourceCommit !== IMAGE_SOURCE_COMMIT ||
      image.flyBuildId !== FLY_BUILD_ID || image.sdkVersion !== SDK_VERSION ||
      image.scientificWorkerSha256 !== SCIENTIFIC_WORKER_SHA256 ||
      image.runtimeBundleSha256 !== RUNTIME_BUNDLE_SHA256 ||
      image.buildManifestSha256 !== BUILD_MANIFEST_SHA256 ||
      tooling.toolingCommit !== expectedToolingCommit || tooling.imageSourceCommit !== IMAGE_SOURCE_COMMIT ||
      !LOWER_SHA256.test(tooling.workflowSha256) || !LOWER_SHA256.test(tooling.verifierSha256) ||
      !LOWER_SHA256.test(tooling.hostObserverSha256) || !LOWER_SHA256.test(tooling.runnerSha256) ||
      tooling.nodePath !== CONTAINER_NODE_PATH || !LOWER_SHA256.test(tooling.nodeSha256) ||
      tooling.tiniPath !== CONTAINER_TINI_PATH || tooling.tiniSha256 !== TINI_SHA256 ||
      tooling.requestArtifactSha256 !== REQUEST_ARTIFACT_SHA256 || tooling.requestHash !== REQUEST_HASH) {
    fail("consistency receipt identity", "does not reproduce the frozen image, scientific, request, and tooling pins");
  }
  const auxiliary = exactKeys(value.auxiliaryHostPreflight, [
    "sourceReceiptSha256", "redactedReceiptSha256", "role", "contributesToFormalApproval",
  ], "consistency receipt.auxiliaryHostPreflight");
  if (auxiliary.sourceReceiptSha256 !== AUXILIARY_HOST_RECEIPT_SHA256 ||
      auxiliary.redactedReceiptSha256 !== AUXILIARY_HOST_REDACTED_RECEIPT_SHA256 ||
      auxiliary.role !== "informational-only" || auxiliary.contributesToFormalApproval !== false) {
    fail("consistency receipt.auxiliaryHostPreflight", "must remain frozen, redacted, and excluded");
  }
  const githubWithUrl = exactKeys(value.githubProvenance, [
    "schemaVersion", "repository", "repositoryId", "repositoryOwnerId", "serverUrl", "ref", "refProtected", "sha", "workflowPath", "workflowRef",
    "workflowSha", "runId", "runAttempt", "job", "protectedEnvironment", "artifacts", "runUrl",
  ], "consistency receipt.githubProvenance");
  const { runUrl, ...githubWithoutUrl } = githubWithUrl;
  const github = inspectGithubRunProvenance(githubWithoutUrl, expectedToolingCommit);
  if (runUrl !== github.runUrl) {
    fail("consistency receipt.githubProvenance.runUrl", "does not bind the exact GitHub run URL");
  }
  return value;
}

export async function verifyContainerMemoryPeakGithubArtifactAttestationDocuments(input, options = {}) {
  const source = exactKeys(input, [
    "consistencyReceiptBytes", "githubArtifactCustodyBytes",
  ], "formalization input");
  const parsedOptions = exactKeys(options, [
    "expectedConsistencyReceiptSha256", "expectedEvidenceArtifactId",
    "expectedEvidenceArtifactDigest", "expectedToolingCommit",
  ], "formal GitHub artifact verification options");
  if (!LOWER_SHA256.test(parsedOptions.expectedConsistencyReceiptSha256) ||
      !/^[1-9][0-9]*$/u.test(parsedOptions.expectedEvidenceArtifactId) ||
      !LOWER_SHA256.test(parsedOptions.expectedEvidenceArtifactDigest) ||
      !GIT_COMMIT.test(parsedOptions.expectedToolingCommit) ||
      parsedOptions.expectedToolingCommit === IMAGE_SOURCE_COMMIT) {
    fail("formal GitHub artifact verification options", "must contain exact external receipt, artifact, and tooling identities");
  }
  const environment = assertFormalGithubRuntime(parsedOptions.expectedToolingCommit);
  const githubOidcProvenance = await requestLiveGithubOidcProvenance(environment);
  const consistencyBytes = asBytes(source.consistencyReceiptBytes, "formalization input.consistencyReceiptBytes");
  const custodyBytes = asBytes(source.githubArtifactCustodyBytes, "formalization input.githubArtifactCustodyBytes");
  if (sha256(consistencyBytes) !== parsedOptions.expectedConsistencyReceiptSha256) {
    fail("consistency receipt", "does not match the externally supplied SHA-256");
  }
  const consistency = inspectConsistencyReceiptForFormalization(
    parseJsonBytes(consistencyBytes, "consistency receipt"),
    parsedOptions.expectedToolingCommit,
  );
  const custody = exactKeys(parseJsonBytes(custodyBytes, "GitHub artifact custody"), [
    "schemaVersion", "repository", "repositoryId", "repositoryOwnerId", "serverUrl", "ref", "refProtected", "sha", "workflowPath", "workflowRef",
    "workflowSha", "runId", "runAttempt", "producerJob", "verifierJob", "protectedEnvironment",
    "evidenceArtifact", "consistencyReceiptSha256",
  ], "GitHub artifact custody");
  const artifact = exactKeys(custody.evidenceArtifact, [
    "id", "name", "digest", "url",
  ], "GitHub artifact custody.evidenceArtifact");
  const expectedArtifactUrl = `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${environment.GITHUB_RUN_ID}/artifacts/${artifact.id}`;
  if (custody.schemaVersion !== GITHUB_ARTIFACT_ATTESTATION_VERSION ||
      custody.repository !== GITHUB_REPOSITORY || custody.serverUrl !== GITHUB_SERVER_URL ||
      custody.repositoryId !== GITHUB_REPOSITORY_ID || custody.repositoryOwnerId !== GITHUB_REPOSITORY_OWNER_ID ||
      custody.ref !== GITHUB_MAIN_REF || custody.refProtected !== true || custody.sha !== parsedOptions.expectedToolingCommit ||
      custody.workflowPath !== GITHUB_WORKFLOW_PATH || custody.workflowRef !== environment.GITHUB_WORKFLOW_REF ||
      custody.workflowSha !== parsedOptions.expectedToolingCommit || custody.runId !== environment.GITHUB_RUN_ID ||
      String(custody.runAttempt) !== environment.GITHUB_RUN_ATTEMPT ||
      custody.producerJob !== GITHUB_PRODUCER_JOB || custody.verifierJob !== GITHUB_VERIFIER_JOB ||
      custody.protectedEnvironment !== GITHUB_PROTECTED_ENVIRONMENT ||
      artifact.id !== parsedOptions.expectedEvidenceArtifactId || artifact.name !== EVIDENCE_ARTIFACT_NAME ||
      artifact.digest !== parsedOptions.expectedEvidenceArtifactDigest || artifact.url !== expectedArtifactUrl ||
      custody.consistencyReceiptSha256 !== parsedOptions.expectedConsistencyReceiptSha256 ||
      consistency.githubProvenance.runId !== custody.runId ||
      consistency.githubProvenance.runAttempt !== custody.runAttempt ||
      consistency.githubProvenance.ref !== custody.ref || consistency.githubProvenance.sha !== custody.sha ||
      consistency.githubProvenance.workflowSha !== custody.workflowSha) {
    fail("GitHub artifact custody", "does not bind the exact protected workflow run, artifact ID/digest, and consistency receipt");
  }
  return Object.freeze({
    schemaVersion: FORMAL_RECEIPT_VERSION,
    status: "github-custody-verified-calibration-only",
    measurement: consistency.measurement,
    image: consistency.image,
    tooling: consistency.tooling,
    pinManifestSha256: consistency.pinManifestSha256,
    consistencyReceiptSha256: parsedOptions.expectedConsistencyReceiptSha256,
    githubArtifactAttestation: custody,
    githubOidcProvenance,
    approvedCalibrationEnvelope: consistency.approvedCalibrationEnvelope,
    executionPolicy: consistency.executionPolicy,
    runCount: consistency.runCount,
    runs: consistency.runs,
    maximumContainerMemoryPeakBytes: consistency.maximumContainerMemoryPeakBytes,
    memoryLimitBytes: consistency.memoryLimitBytes,
    maximumContainerMemoryPeakFraction: consistency.maximumContainerMemoryPeakFraction,
    thresholdFraction: consistency.thresholdFraction,
    calibrationEnvelopeUnderThreshold: true,
    formalLinuxContainerSizingApproved: false,
    formalContainerMemoryPeakCapacityApproved: false,
    exactScientificForkHarnessCalibrationPassed: true,
    persistentServicePathExercised: false,
    apiQueueWorkerPathExercised: false,
    persistentServiceCapacityApproved: false,
    flyCapacityApproved: false,
    githubWorkflowArtifactCustodyVerified: true,
    approvedCalibrationEnvelopeOnly: true,
    extrapolationBeyondEnvelopeApproved: false,
    auxiliaryHostPreflight: consistency.auxiliaryHostPreflight,
    realFlyMultiMachineApproved: false,
    requiredRealFlyMachines: 2,
    realFlyMultiMachineStatus: "NOT_RUN",
    boundary: "GitHub issuance-time OIDC and artifact custody verify only the frozen direct scientific fork calibration. This is not an offline signed attestation, does not exercise the persistent API -> queue -> worker path, does not approve capacity, and leaves >=2 real Fly Machines NOT_RUN.",
  });
}

function inside(root, path) {
  const pathRelative = relative(root, path);
  return pathRelative !== "" && pathRelative !== ".." && !pathRelative.startsWith(`..${sep}`);
}

function normalizedRelativePath(path, label) {
  if (typeof path !== "string" || !RELATIVE_EVIDENCE_PATH.test(path) ||
      path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail(label, "must be a normalized contained relative path");
  }
  return path;
}

function secureReadFile(context, relativePath, label, maximumBytes = MAX_JSON_BYTES) {
  const normalized = normalizedRelativePath(relativePath, label);
  const requested = resolve(context.requestedRoot, normalized);
  if (!inside(context.requestedRoot, requested)) fail(label, "is outside the evidence root");
  let component = context.requestedRoot;
  for (const segment of normalized.split("/")) {
    component = resolve(component, segment);
    let componentMetadata;
    try {
      componentMetadata = lstatSync(component, { bigint: true });
    } catch (error) {
      throw new Error(`${label}: evidence path does not exist`, { cause: error });
    }
    if (componentMetadata.isSymbolicLink()) fail(label, "contains a symbolic-link component");
  }
  const realPath = realpathSync(requested);
  if (!inside(context.realRoot, realPath)) fail(label, "resolved outside the evidence root");
  const metadata = lstatSync(realPath, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail(label, "must be a regular file, not a symbolic link");
  if (metadata.nlink !== 1n) fail(label, "must have one custody link and no external hard-link alias");
  if (metadata.size < 0n || metadata.size > BigInt(maximumBytes)) {
    fail(label, `must be no larger than ${maximumBytes} bytes`);
  }
  const remainingBudget = BigInt(context.maximumTotalBytes - context.totalBytes);
  if (metadata.size > remainingBudget) {
    fail(
      "evidence total byte budget",
      `declared file would exceed the remaining ${remainingBudget} bytes before allocation`,
    );
  }
  const descriptor = openSync(realPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.dev !== metadata.dev || before.ino !== metadata.ino ||
        before.size !== metadata.size || before.nlink !== 1n) {
      fail(label, "changed during secure open");
    }
    const identity = `${before.dev}:${before.ino}`;
    if (context.fileIdentities.has(identity)) fail(label, "aliases another evidence inode");
    context.fileIdentities.add(identity);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    const current = lstatSync(realPath, { bigint: true });
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs || after.nlink !== 1n ||
        current.isSymbolicLink() || current.dev !== before.dev || current.ino !== before.ino ||
        current.size !== before.size || current.nlink !== 1n || BigInt(bytes.byteLength) !== before.size) {
      fail(label, "changed during secure read");
    }
    context.totalBytes += bytes.byteLength;
    if (context.totalBytes > context.maximumTotalBytes) {
      fail("evidence total byte budget", `cumulative evidence exceeded ${context.maximumTotalBytes} bytes`);
    }
    return Object.freeze({ bytes, realPath });
  } finally {
    closeSync(descriptor);
  }
}

function establishEvidenceRoot(path, maximumTotalBytes = MAX_TOTAL_EVIDENCE_BYTES) {
  const requestedRoot = resolve(path);
  const metadata = lstatSync(requestedRoot, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail("evidence root", "must be a real directory, not a symbolic link");
  }
  const realRoot = realpathSync(requestedRoot);
  if (realRoot !== requestedRoot) {
    fail("evidence root", "must not traverse a symbolic-link component");
  }
  return {
    requestedRoot,
    realRoot,
    fileIdentities: new Set(),
    totalBytes: 0,
    maximumTotalBytes,
  };
}

function evidenceParentDirectories(paths) {
  const directories = new Set([""]);
  for (const path of paths) {
    const segments = path.split("/");
    segments.pop();
    let current = "";
    for (const segment of segments) {
      current = current === "" ? segment : `${current}/${segment}`;
      directories.add(current);
    }
  }
  return directories;
}

function auditClosedEvidenceTree(context, declaredPaths, outputPath, { outputRequired }) {
  const declaredFiles = new Set(
    [...declaredPaths].map((path) => normalizedRelativePath(path, "declared evidence path")),
  );
  const normalizedOutput = normalizedRelativePath(outputPath, "output path");
  const allowedFiles = new Set([...declaredFiles, normalizedOutput]);
  const allowedDirectories = evidenceParentDirectories(allowedFiles);
  const observedFiles = new Set();

  function visit(directoryPath, relativeDirectory) {
    for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
      const relativePath = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
      const absolutePath = resolve(directoryPath, entry.name);
      const metadata = lstatSync(absolutePath, { bigint: true });
      if (metadata.isSymbolicLink()) {
        fail("evidence closed set", `undeclared or declared symbolic link ${relativePath} is forbidden`);
      }
      if (metadata.isDirectory()) {
        if (!allowedDirectories.has(relativePath)) {
          fail("evidence closed set", `undeclared directory ${relativePath} is forbidden`);
        }
        visit(absolutePath, relativePath);
        continue;
      }
      if (!metadata.isFile()) {
        fail("evidence closed set", `non-regular entry ${relativePath} is forbidden`);
      }
      if (!allowedFiles.has(relativePath)) {
        fail("evidence closed set", `undeclared file ${relativePath} is forbidden`);
      }
      if (metadata.nlink !== 1n) {
        fail("evidence closed set", `hard-linked evidence file ${relativePath} is forbidden`);
      }
      observedFiles.add(relativePath);
    }
  }

  visit(context.requestedRoot, "");
  for (const path of declaredFiles) {
    if (!observedFiles.has(path)) fail("evidence closed set", `declared file ${path} is missing`);
  }
  if (outputRequired && !observedFiles.has(normalizedOutput)) {
    fail("evidence closed set", "atomic output receipt is missing after publication");
  }
  return Object.freeze({ declaredFiles, allowedDirectories, normalizedOutput });
}

function isMissingPath(path) {
  try {
    lstatSync(path);
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

function syncDirectory(path) {
  const descriptor = openSync(path, fsConstants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeExclusiveReceipt(context, outputPath, receipt, {
  testPublicationFault,
} = {}) {
  const normalized = normalizedRelativePath(outputPath, "output path");
  const requested = resolve(context.requestedRoot, normalized);
  if (!inside(context.requestedRoot, requested)) fail("output path", "is outside the evidence root");
  const requestedParent = dirname(requested);
  const parentMetadata = lstatSync(requestedParent, { bigint: true });
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink() ||
      realpathSync(requestedParent) !== dirname(resolve(context.realRoot, normalized))) {
    fail("output path", "parent must be a real contained evidence directory");
  }
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  const temporary = resolve(
    requestedParent,
    `.${normalized.split("/").at(-1)}.${process.pid}.${randomBytes(16).toString("hex")}.tmp`,
  );
  let descriptor;
  let temporaryCreated = false;
  let published = false;
  try {
    descriptor = openSync(
      temporary,
      fsConstants.O_RDWR | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    temporaryCreated = true;
    let offset = 0;
    while (offset < bytes.byteLength) offset += writeSync(descriptor, bytes, offset);
    fsyncSync(descriptor);
    const metadata = fstatSync(descriptor, { bigint: true });
    if (!metadata.isFile() || metadata.nlink !== 1n || metadata.size !== BigInt(bytes.byteLength)) {
      fail("output receipt", "temporary exclusive receipt inode is invalid");
    }
    const observed = Buffer.alloc(bytes.byteLength);
    let readOffset = 0;
    while (readOffset < observed.byteLength) {
      const count = readSync(descriptor, observed, readOffset, observed.byteLength - readOffset, readOffset);
      if (count === 0) fail("output receipt", "could not re-read the complete exclusive receipt");
      readOffset += count;
    }
    if (sha256(observed) !== sha256(bytes) ||
        canonicalJson(parseJsonBytes(observed, "temporary output receipt")) !== canonicalJson(receipt)) {
      fail("output receipt", "temporary bytes failed complete strict-JSON verification");
    }
    if (testPublicationFault === "before-publish" ||
        testPublicationFault === "prepublish-temp-unlink-persistent") {
      throw new Error(`Injected ${testPublicationFault} publication fault.`);
    }
    closeSync(descriptor);
    descriptor = undefined;

    linkSync(temporary, requested);
    published = true;
    // The exclusive hard link is the one-way commit point. Every scientific,
    // custody, closed-tree, and receipt-byte check has already completed. Once
    // the destination is visible, cleanup and durability diagnostics may not
    // turn a committed PASS into a failing process that leaves a PASS receipt.
    try {
      if (testPublicationFault === "post-publish-temp-unlink-persistent") {
        throw new Error("Injected persistent post-publication temporary unlink fault.");
      }
      unlinkSync(temporary);
      temporaryCreated = false;
    } catch (error) {
      writeWarning(
        `post-publication temporary receipt cleanup failed; committed PASS remains valid: ${error.message}`,
      );
    }
    try {
      if (testPublicationFault === "post-publish-directory-fsync") {
        throw new Error("Injected post-publication directory fsync fault.");
      }
      syncDirectory(requestedParent);
    } catch (error) {
      writeWarning(
        `post-publication receipt directory sync failed after atomic commit: ${error.message}`,
      );
    }
    return receipt;
  } catch (error) {
    const cleanupErrors = [];
    const destinationWasPreexisting = error?.code === "EEXIST";
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
      descriptor = undefined;
    }
    if (temporaryCreated) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          if (testPublicationFault === "prepublish-temp-unlink-persistent") {
            throw new Error("Injected persistent prepublication temporary unlink fault.");
          }
          unlinkSync(temporary);
          temporaryCreated = false;
          break;
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
    }
    if (published) throw error;
    try {
      syncDirectory(requestedParent);
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    try {
      if (temporaryCreated || !isMissingPath(temporary)) {
        cleanupErrors.push(new Error("Prepublication cleanup failed to prove temporary receipt ENOENT."));
      }
      if (!destinationWasPreexisting && !isMissingPath(requested)) {
        cleanupErrors.push(new Error("Prepublication failure did not preserve receipt destination ENOENT."));
      }
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    const primary = error?.code === "EEXIST"
      ? new Error("output receipt already exists; exclusive verification refuses overwrite", { cause: error })
      : error;
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [primary, ...cleanupErrors],
        "HIGH PRIORITY: receipt verification failed before publication and cleanup reported errors while the final destination remained absent.",
      );
    }
    throw primary;
  }
}

function verifyContainerMemoryPeakEvidenceCandidateDirectory(parsedOptions, documentVerifier) {
  const context = establishEvidenceRoot(
    parsedOptions.evidenceRoot,
    parsedOptions.testMaximumTotalBytes ?? MAX_TOTAL_EVIDENCE_BYTES,
  );
  const manifestFile = secureReadFile(context, parsedOptions.manifestPath, "evidence manifest", 4 * 1024 * 1024);
  const evidence = parseJsonBytes(manifestFile.bytes, "evidence manifest");
  const manifest = record(evidence, "evidence manifest");
  const pinDescriptor = record(manifest.pinManifest, "evidence manifest.pinManifest");
  if (pinDescriptor.path !== parsedOptions.pinManifestPath) {
    fail("pin manifest path", "argument must match the manifest-custodied relative path");
  }
  const pinManifestBytes = secureReadFile(context, pinDescriptor.path, "pin manifest").bytes;
  const external = record(manifest.externalEvidence, "evidence manifest.externalEvidence");
  const tooling = record(manifest.tooling, "evidence manifest.tooling");
  const scanReceiptBytes = secureReadFile(
    context,
    record(external.exactImageScanReceipt, "external scan receipt descriptor").path,
    "exact image scan receipt",
  ).bytes;
  const dockerInspectBytes = secureReadFile(
    context,
    record(external.dockerInspect, "external docker inspect descriptor").path,
    "docker inspect",
  ).bytes;
  const auxiliaryHostRedactedReceiptBytes = secureReadFile(
    context,
    record(external.auxiliaryHostPreflight, "external host descriptor").path,
    "auxiliary host receipt",
  ).bytes;
  const workflowBytes = secureReadFile(
    context,
    record(tooling.workflow, "workflow descriptor").path,
    "reviewed workflow",
    4 * 1024 * 1024,
  ).bytes;
  const verifierBytes = secureReadFile(
    context,
    record(tooling.verifier, "verifier descriptor").path,
    "reviewed verifier",
    4 * 1024 * 1024,
  ).bytes;
  const hostObserverBytes = secureReadFile(
    context,
    record(tooling.hostObserver, "host observer descriptor").path,
    "reviewed host observer",
    4 * 1024 * 1024,
  ).bytes;
  const runnerBytes = secureReadFile(
    context,
    record(tooling.runner, "runner descriptor").path,
    "runner",
  ).bytes;
  const requestBytes = secureReadFile(
    context,
    record(tooling.request, "request descriptor").path,
    "request artifact",
  ).bytes;
  if (!Array.isArray(manifest.runs) || manifest.runs.length !== 3) {
    fail("evidence manifest.runs", "must declare exactly three runs before file discovery");
  }
  const runs = manifest.runs.map((candidate, index) => {
    const run = record(candidate, `evidence manifest.runs[${index}]`);
    return {
      rawRunBytes: secureReadFile(context, record(run.rawRun, "raw run descriptor").path, `run ${index + 1} raw JSON`).bytes,
      runtimeInspectBytes: secureReadFile(context, record(run.runtimeInspect, "runtime inspect descriptor").path, `run ${index + 1} runtime inspect`).bytes,
      hostObservationBytes: secureReadFile(context, record(run.hostObservation, "host observation descriptor").path, `run ${index + 1} host cgroup observation`).bytes,
      artifactBytes: secureReadFile(context, record(run.artifact, "artifact descriptor").path, `run ${index + 1} result artifact`).bytes,
      stdoutBytes: secureReadFile(context, record(run.stdout, "stdout descriptor").path, `run ${index + 1} stdout`, MAX_LOG_BYTES).bytes,
      stderrBytes: secureReadFile(context, record(run.stderr, "stderr descriptor").path, `run ${index + 1} stderr`, MAX_LOG_BYTES).bytes,
      childStdoutBytes: secureReadFile(context, record(run.childStdout, "child stdout descriptor").path, `run ${index + 1} child stdout`, MAX_LOG_BYTES).bytes,
      childStderrBytes: secureReadFile(context, record(run.childStderr, "child stderr descriptor").path, `run ${index + 1} child stderr`, MAX_LOG_BYTES).bytes,
    };
  });
  const declaredPaths = new Set([
    parsedOptions.manifestPath,
    pinDescriptor.path,
    record(external.exactImageScanReceipt, "external scan receipt descriptor").path,
    record(external.dockerInspect, "external docker inspect descriptor").path,
    record(external.auxiliaryHostPreflight, "external host descriptor").path,
    record(tooling.workflow, "workflow descriptor").path,
    record(tooling.verifier, "verifier descriptor").path,
    record(tooling.hostObserver, "host observer descriptor").path,
    record(tooling.runner, "runner descriptor").path,
    record(tooling.request, "request descriptor").path,
  ]);
  for (const [index, run] of manifest.runs.entries()) {
    for (const field of [
      "rawRun", "runtimeInspect", "hostObservation", "artifact", "stdout", "stderr", "childStdout", "childStderr",
    ]) {
      declaredPaths.add(record(run[field], `evidence manifest.runs[${index}].${field}`).path);
    }
  }
  auditClosedEvidenceTree(context, declaredPaths, parsedOptions.outputPath, { outputRequired: false });
  const receipt = documentVerifier(
    {
      evidence,
      pinManifestBytes,
      scanReceiptBytes,
      dockerInspectBytes,
      workflowBytes,
      verifierBytes,
      hostObserverBytes,
      runnerBytes,
      requestBytes,
      auxiliaryHostRedactedReceiptBytes,
      runs,
    },
    {
      expectedPinManifestSha256: parsedOptions.expectedPinManifestSha256,
      expectedToolingCommit: parsedOptions.expectedToolingCommit,
      ...(parsedOptions.frozenPins === undefined ? {} : { frozenPins: parsedOptions.frozenPins }),
    },
  );
  return writeExclusiveReceipt(context, parsedOptions.outputPath, receipt, {
    testPublicationFault: parsedOptions.testPublicationFault,
  });
}

export function verifyContainerMemoryPeakEvidenceDirectory(options) {
  const parsedOptions = exactKeys(options, [
    "evidenceRoot", "manifestPath", "pinManifestPath", "expectedPinManifestSha256",
    "expectedToolingCommit", "outputPath",
  ], "fixed-pin consistency directory verification options");
  return verifyContainerMemoryPeakEvidenceCandidateDirectory(
    parsedOptions,
    verifyContainerMemoryPeakEvidenceDocuments,
  );
}

export function verifyContainerMemoryPeakTestEvidenceDirectory(options) {
  const expectedKeys = [
    "evidenceRoot", "manifestPath", "pinManifestPath", "expectedPinManifestSha256",
    "expectedToolingCommit", "outputPath", "frozenPins",
  ];
  if (Object.hasOwn(options, "testMaximumTotalBytes")) expectedKeys.push("testMaximumTotalBytes");
  if (Object.hasOwn(options, "testPublicationFault")) expectedKeys.push("testPublicationFault");
  const parsedOptions = exactKeys(options, expectedKeys, "test-only directory verification options");
  if (parsedOptions.testMaximumTotalBytes !== undefined &&
      (!Number.isSafeInteger(parsedOptions.testMaximumTotalBytes) ||
       parsedOptions.testMaximumTotalBytes < 1 ||
       parsedOptions.testMaximumTotalBytes > MAX_TOTAL_EVIDENCE_BYTES)) {
    fail("testMaximumTotalBytes", "must be a positive test-only budget no larger than the formal budget");
  }
  if (parsedOptions.testPublicationFault !== undefined &&
      ![
        "before-publish",
        "prepublish-temp-unlink-persistent",
        "post-publish-temp-unlink-persistent",
        "post-publish-directory-fsync",
      ].includes(parsedOptions.testPublicationFault)) {
    fail("testPublicationFault", "is not an approved test-only publication fault");
  }
  return verifyContainerMemoryPeakEvidenceCandidateDirectory(
    parsedOptions,
    verifyContainerMemoryPeakTestEvidenceDocuments,
  );
}

export async function verifyContainerMemoryPeakGithubArtifactAttestationDirectory(options) {
  const parsedOptions = exactKeys(options, [
    "formalRoot", "consistencyReceiptPath", "githubArtifactCustodyPath",
    "expectedConsistencyReceiptSha256", "expectedEvidenceArtifactId",
    "expectedEvidenceArtifactDigest", "expectedToolingCommit", "outputPath",
  ], "formal GitHub artifact directory verification options");
  const context = establishEvidenceRoot(parsedOptions.formalRoot, 8 * 1024 * 1024);
  const consistencyReceiptBytes = secureReadFile(
    context,
    parsedOptions.consistencyReceiptPath,
    "formal consistency receipt",
    4 * 1024 * 1024,
  ).bytes;
  const githubArtifactCustodyBytes = secureReadFile(
    context,
    parsedOptions.githubArtifactCustodyPath,
    "formal GitHub artifact attestation",
    1024 * 1024,
  ).bytes;
  const declaredPaths = new Set([
    parsedOptions.consistencyReceiptPath,
    parsedOptions.githubArtifactCustodyPath,
  ]);
  auditClosedEvidenceTree(context, declaredPaths, parsedOptions.outputPath, { outputRequired: false });
  const receipt = await verifyContainerMemoryPeakGithubArtifactAttestationDocuments(
    { consistencyReceiptBytes, githubArtifactCustodyBytes },
    {
      expectedConsistencyReceiptSha256: parsedOptions.expectedConsistencyReceiptSha256,
      expectedEvidenceArtifactId: parsedOptions.expectedEvidenceArtifactId,
      expectedEvidenceArtifactDigest: parsedOptions.expectedEvidenceArtifactDigest,
      expectedToolingCommit: parsedOptions.expectedToolingCommit,
    },
  );
  return writeExclusiveReceipt(context, parsedOptions.outputPath, receipt);
}

function parseNamedArguments(argv, names) {
  const allowed = new Set(names);
  if (argv.length !== allowed.size * 2) fail("arguments", "all mode-specific verifier arguments are required exactly once");
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name) || value === undefined || values.has(name)) {
      fail("arguments", `invalid or duplicate argument ${name ?? "<missing>"}`);
    }
    values.set(name, value);
  }
  return values;
}

function parseArguments(argv) {
  if (argv[0] !== "--mode" || (argv[1] !== "consistency" && argv[1] !== "formal-github-artifact")) {
    fail("arguments", "--mode must be consistency or formal-github-artifact");
  }
  if (argv[1] === "consistency") {
    const values = parseNamedArguments(argv, [
      "--mode", "--evidence-root", "--manifest", "--pin-manifest",
      "--expected-pin-manifest-sha256", "--expected-tooling-commit", "--output",
    ]);
    return {
      mode: "consistency",
      options: {
        evidenceRoot: values.get("--evidence-root"),
        manifestPath: values.get("--manifest"),
        pinManifestPath: values.get("--pin-manifest"),
        expectedPinManifestSha256: values.get("--expected-pin-manifest-sha256"),
        expectedToolingCommit: values.get("--expected-tooling-commit"),
        outputPath: values.get("--output"),
      },
    };
  }
  const values = parseNamedArguments(argv, [
    "--mode", "--formal-root", "--consistency-receipt", "--github-artifact-attestation",
    "--expected-consistency-receipt-sha256", "--expected-evidence-artifact-id",
    "--expected-evidence-artifact-digest", "--expected-tooling-commit", "--output",
  ]);
  return {
    mode: "formal-github-artifact",
    options: {
      formalRoot: values.get("--formal-root"),
      consistencyReceiptPath: values.get("--consistency-receipt"),
      githubArtifactCustodyPath: values.get("--github-artifact-attestation"),
      expectedConsistencyReceiptSha256: values.get("--expected-consistency-receipt-sha256"),
      expectedEvidenceArtifactId: values.get("--expected-evidence-artifact-id"),
      expectedEvidenceArtifactDigest: values.get("--expected-evidence-artifact-digest"),
      expectedToolingCommit: values.get("--expected-tooling-commit"),
      outputPath: values.get("--output"),
    },
  };
}

function samePath(left, right) {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return resolve(left) === resolve(right);
  }
}

async function runCli() {
  try {
    const invocation = parseArguments(process.argv.slice(2));
    const receipt = invocation.mode === "consistency"
      ? verifyContainerMemoryPeakEvidenceDirectory(invocation.options)
      : await verifyContainerMemoryPeakGithubArtifactAttestationDirectory(invocation.options);
    process.stdout.write(`${JSON.stringify({
      schemaVersion: receipt.schemaVersion,
      status: receipt.status,
      formalLinuxContainerSizingApproved: receipt.formalLinuxContainerSizingApproved,
      realFlyMultiMachineApproved: receipt.realFlyMultiMachineApproved,
      realFlyMultiMachineStatus: receipt.realFlyMultiMachineStatus,
    })}\n`);
  } catch (error) {
    process.stderr.write(`Container memory peak evidence verification failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  }
}

if (samePath(process.argv[1] ?? "", SCRIPT_PATH)) {
  await runCli();
}
