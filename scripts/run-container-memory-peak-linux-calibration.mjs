#!/usr/bin/env node

import { fork } from "node:child_process";
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
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const STRICT_JSON_URL = existsSync("/usr/local/bin/strict-json.mjs")
  ? pathToFileURL("/usr/local/bin/strict-json.mjs")
  : new URL("../packages/compute-service-persistent/deploy/strict-json.mjs", import.meta.url);
const { parseStrictJson } = await import(STRICT_JSON_URL.href);

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCIENTIFIC_WORKER_PATH = "/app/scientific-worker-entry.mjs";
const RUNTIME_BUNDLE_PATH = "/app/compute-runtime.mjs";
const BUILD_MANIFEST_PATH = "/app/build-manifest.json";
const NODE_PATH = "/usr/local/bin/node";
const TINI_PATH = "/sbin/tini";
const CGROUP_ROOT = "/sys/fs/cgroup";
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
const SCIENTIFIC_HARD_DEADLINE_MS = 60_000;
const LEAK_MARKER = "3DENA_CONTAINER_MEMORY_PEAK_PRIVATE_SENTINEL_V1";
const LOWER_SHA256 = /^[a-f0-9]{64}$/u;
const GIT_COMMIT = /^[a-f0-9]{40}$/u;
const CONTAINER_ID = /^[a-f0-9]{12,64}$/u;
const MAX_INPUT_BYTES = 256 * 1024 * 1024;
const MAX_CHILD_LOG_BYTES = 4 * 1024 * 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true });
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

const WORKLOAD = Object.freeze({
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

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(value, keys, label) {
  if (!isRecord(value)) fail(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exact keys without unknown fields.`);
  }
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value, label = "value") {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${label} contains a non-finite number.`);
    return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => canonicalJson(item, `${label}[${index}]`)).join(",")}]`;
  }
  if (!isRecord(value)) fail(`${label} contains an unsupported canonical value.`);
  return `{${Object.keys(value).sort().map((key) => {
    if (value[key] === undefined) fail(`${label}.${key} cannot be undefined.`);
    return `${JSON.stringify(key)}:${canonicalJson(value[key], `${label}.${key}`)}`;
  }).join(",")}}`;
}

function analysisHash(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

export function hashLongitudinalCalibrationRequest(request) {
  const value = exactKeys(request, [
    "dataset", "pathTask", "inferenceTask", "bootstrapTask", "networkOverlayTask", "execution",
  ], "calibration request");
  const execution = exactKeys(value.execution, [
    "target", "jenaVersion", "jenaCommit", "jenaTarballIntegrity", "sdkVersion", "buildId", "seed",
  ], "calibration request.execution");
  const { target: _target, ...scientificExecution } = execution;
  return analysisHash({
    dataset: value.dataset,
    pathTask: value.pathTask,
    inferenceTask: value.inferenceTask,
    bootstrapTask: value.bootstrapTask,
    networkOverlayTask: value.networkOverlayTask,
    execution: scientificExecution,
  });
}

function strictInteger(text, label, { positive = false } = {}) {
  const value = text.trim();
  if (!/^[0-9]+$/u.test(value)) fail(`${label} must be a finite cgroup integer, not max.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || (positive && parsed === 0)) {
    fail(`${label} is outside the safe positive cgroup range.`);
  }
  return parsed;
}

function memoryEvents(text) {
  const values = new Map();
  for (const line of text.trim().split("\n")) {
    const match = /^([a-z_]+) ([0-9]+)$/u.exec(line);
    if (!match || values.has(match[1])) fail("memory.events is malformed or duplicated.");
    values.set(match[1], strictInteger(match[2], `memory.events.${match[1]}`));
  }
  if (!values.has("oom") || !values.has("oom_kill")) fail("memory.events lacks OOM counters.");
  return values;
}

export function readCgroupV2CalibrationSnapshot(root = CGROUP_ROOT) {
  const controllersPath = join(root, "cgroup.controllers");
  if (!existsSync(controllersPath)) fail("cgroup v2 controllers file is required.");
  const controllers = readFileSync(controllersPath, "utf8").trim().split(/\s+/u);
  for (const controller of ["cpu", "memory", "pids"]) {
    if (!controllers.includes(controller)) fail(`cgroup v2 ${controller} controller is required.`);
  }
  const cpu = readFileSync(join(root, "cpu.max"), "utf8").trim().split(/\s+/u);
  if (cpu.length !== 2) fail("cpu.max must contain quota and period.");
  const cpuQuotaMicroseconds = strictInteger(cpu[0], "cpu.max quota", { positive: true });
  const cpuPeriodMicroseconds = strictInteger(cpu[1], "cpu.max period", { positive: true });
  const cpuCount = cpuQuotaMicroseconds / cpuPeriodMicroseconds;
  if (!Number.isFinite(cpuCount)) fail("cpu.max does not produce a finite CPU count.");
  const events = memoryEvents(readFileSync(join(root, "memory.events"), "utf8"));
  return {
    memoryMaxBytes: strictInteger(readFileSync(join(root, "memory.max"), "utf8"), "memory.max", { positive: true }),
    memoryPeakBytes: strictInteger(readFileSync(join(root, "memory.peak"), "utf8"), "memory.peak", { positive: true }),
    memorySwapMaxBytes: strictInteger(readFileSync(join(root, "memory.swap.max"), "utf8"), "memory.swap.max"),
    cpuQuotaMicroseconds,
    cpuPeriodMicroseconds,
    cpuCount,
    pidsMax: strictInteger(readFileSync(join(root, "pids.max"), "utf8"), "pids.max", { positive: true }),
    oomEvents: events.get("oom"),
    oomKillEvents: events.get("oom_kill"),
  };
}

function readStableFile(path, label, maximumBytes = MAX_INPUT_BYTES) {
  const requested = resolve(path);
  const metadata = lstatSync(requested, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n ||
      metadata.size < 1n || metadata.size > BigInt(maximumBytes)) {
    fail(`${label} must be a single-link regular file within the size limit.`);
  }
  const descriptor = openSync(requested, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.dev !== metadata.dev || before.ino !== metadata.ino ||
        before.size !== metadata.size || before.nlink !== 1n) {
      fail(`${label} changed during secure open.`);
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs || after.nlink !== 1n ||
        BigInt(bytes.byteLength) !== before.size) {
      fail(`${label} changed during secure read.`);
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function strictJsonFile(path, label, expectedSha256) {
  const bytes = readStableFile(path, label);
  if (expectedSha256 !== undefined && sha256(bytes) !== expectedSha256) {
    fail(`${label} SHA-256 does not match its exact pin.`);
  }
  try {
    return { bytes, value: parseStrictJson(utf8.decode(bytes)) };
  } catch (error) {
    throw new Error(`${label} must be fatal-UTF-8 strict JSON without duplicate keys.`, {
      cause: error,
    });
  }
}

function parseArguments(argv) {
  const allowed = new Set([
    "--run-index", "--pin-manifest", "--expected-pin-manifest-sha256", "--request",
    "--scan-receipt", "--docker-inspect", "--auxiliary-host-redacted-receipt", "--tooling-commit",
    "--output-dir",
  ]);
  if (argv.length !== allowed.size * 2) fail("All runner arguments are required exactly once.");
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name) || value === undefined || values.has(name)) {
      fail(`Invalid or duplicate runner argument ${name ?? "<missing>"}.`);
    }
    values.set(name, value);
  }
  const runIndex = Number(values.get("--run-index"));
  if (!Number.isSafeInteger(runIndex) || runIndex < 1 || runIndex > 3) fail("--run-index must be 1, 2, or 3.");
  const expectedPinManifestSha256 = values.get("--expected-pin-manifest-sha256");
  const toolingCommit = values.get("--tooling-commit");
  if (!LOWER_SHA256.test(expectedPinManifestSha256)) fail("--expected-pin-manifest-sha256 is invalid.");
  if (!GIT_COMMIT.test(toolingCommit) || toolingCommit === IMAGE_SOURCE_COMMIT) {
    fail("--tooling-commit must be a separate full lowercase Git SHA.");
  }
  return {
    runIndex,
    pinManifest: values.get("--pin-manifest"),
    expectedPinManifestSha256,
    request: values.get("--request"),
    scanReceipt: values.get("--scan-receipt"),
    dockerInspect: values.get("--docker-inspect"),
    auxiliaryHostRedactedReceipt: values.get("--auxiliary-host-redacted-receipt"),
    toolingCommit,
    outputDir: values.get("--output-dir"),
  };
}

function inspectPinManifest(args, runnerSha256) {
  const source = strictJsonFile(args.pinManifest, "pin manifest", args.expectedPinManifestSha256);
  const pin = exactKeys(source.value, [
    "schemaVersion", "repository", "image", "priorEvidence", "tooling", "runtime", "calibration",
  ], "pin manifest");
  if (pin.schemaVersion !== "3dena.container-memory-peak-pins.v1" || pin.repository !== "HUDongpin/j-3dENA") {
    fail("Pin manifest schema or repository is invalid.");
  }
  const image = exactKeys(pin.image, [
    "ref", "digest", "sourceCommit", "flyBuildId", "sdkVersion", "scientificWorkerSha256",
    "runtimeBundleSha256", "buildManifestSha256",
  ], "pin manifest.image");
  const prior = exactKeys(pin.priorEvidence, [
    "exactImageScanReceiptSha256", "dockerInspectSha256", "auxiliaryHostSourceReceiptSha256",
    "auxiliaryHostRedactedReceiptSha256", "auxiliaryHostReceiptRole",
  ], "pin manifest.priorEvidence");
  const tooling = exactKeys(pin.tooling, [
    "commit", "workflowSha256", "verifierSha256", "hostObserverSha256", "runnerSha256", "requestArtifactSha256",
  ], "pin manifest.tooling");
  const runtime = exactKeys(pin.runtime, [
    "nodePath", "nodeSha256", "tiniPath", "tiniSha256", "configEnv",
  ], "pin manifest.runtime");
  const calibration = exactKeys(pin.calibration, [
    "requestHash", "expectedResultHash", "memoryLimitBytes", "thresholdFraction", "freshContainerRuns",
    "scientificHardDeadlineMilliseconds",
  ], "pin manifest.calibration");
  const expected = {
    digest: IMAGE_DIGEST,
    sourceCommit: IMAGE_SOURCE_COMMIT,
    flyBuildId: FLY_BUILD_ID,
    sdkVersion: SDK_VERSION,
    scientificWorkerSha256: SCIENTIFIC_WORKER_SHA256,
    runtimeBundleSha256: RUNTIME_BUNDLE_SHA256,
    buildManifestSha256: BUILD_MANIFEST_SHA256,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (image[field] !== value) fail(`pin manifest.image.${field} drifted.`);
  }
  if (typeof image.ref !== "string" || !image.ref.endsWith(`@${IMAGE_DIGEST}`)) fail("Image ref does not bind the exact digest.");
  if (prior.exactImageScanReceiptSha256 !== SCAN_RECEIPT_SHA256 ||
      prior.dockerInspectSha256 !== DOCKER_INSPECT_SHA256 ||
      prior.auxiliaryHostSourceReceiptSha256 !== AUXILIARY_HOST_RECEIPT_SHA256 ||
      prior.auxiliaryHostRedactedReceiptSha256 !== AUXILIARY_HOST_REDACTED_RECEIPT_SHA256 ||
      prior.auxiliaryHostReceiptRole !== "informational-only") {
    fail("Prior evidence pins drifted or promoted host evidence.");
  }
  if (tooling.commit !== args.toolingCommit || tooling.runnerSha256 !== runnerSha256 ||
      tooling.requestArtifactSha256 !== REQUEST_ARTIFACT_SHA256 ||
      !LOWER_SHA256.test(tooling.workflowSha256) || !LOWER_SHA256.test(tooling.verifierSha256) ||
      !LOWER_SHA256.test(tooling.hostObserverSha256)) {
    fail("Tooling commit, runner SHA-256, or request artifact SHA-256 drifted.");
  }
  if (runtime.nodePath !== NODE_PATH || runtime.tiniPath !== TINI_PATH ||
      !LOWER_SHA256.test(runtime.nodeSha256) || !LOWER_SHA256.test(runtime.tiniSha256) ||
      canonicalJson(runtime.configEnv) !== canonicalJson(EXPECTED_IMAGE_CONFIG_ENV)) {
    fail("Absolute Node, tini, or runtime environment pins are invalid.");
  }
  if (calibration.requestHash !== REQUEST_HASH || calibration.expectedResultHash !== EXPECTED_RESULT_HASH ||
      calibration.memoryLimitBytes !== MEMORY_LIMIT_BYTES || calibration.thresholdFraction !== 0.5 ||
      calibration.freshContainerRuns !== 3 ||
      calibration.scientificHardDeadlineMilliseconds !== SCIENTIFIC_HARD_DEADLINE_MS) {
    fail("Calibration request, result, limit, threshold, or run count pin drifted.");
  }
  return { image, prior, tooling, runtime, calibration };
}

function inspectRuntimeBinaries(runtime) {
  if (process.execPath !== "/usr/local/bin/node" || runtime.nodePath !== NODE_PATH || runtime.tiniPath !== TINI_PATH) {
    fail("Runner requires the exact absolute Node and tini paths.");
  }
  const nodeBytes = readStableFile(NODE_PATH, "in-image Node executable", 256 * 1024 * 1024);
  const tiniBytes = readStableFile(TINI_PATH, "in-image tini executable", 8 * 1024 * 1024);
  if (sha256(nodeBytes) !== runtime.nodeSha256 || sha256(tiniBytes) !== runtime.tiniSha256) {
    fail("In-image Node or tini executable SHA-256 drifted from the external pin manifest.");
  }
}

function inspectInImageArtifacts() {
  const workerBytes = readStableFile(SCIENTIFIC_WORKER_PATH, "in-image scientific worker");
  const runtimeBytes = readStableFile(RUNTIME_BUNDLE_PATH, "in-image runtime bundle");
  const manifestSource = strictJsonFile(BUILD_MANIFEST_PATH, "in-image build manifest", BUILD_MANIFEST_SHA256);
  if (sha256(workerBytes) !== SCIENTIFIC_WORKER_SHA256 || sha256(runtimeBytes) !== RUNTIME_BUNDLE_SHA256) {
    fail("In-image worker or runtime bundle SHA-256 drifted.");
  }
  const manifest = exactKeys(manifestSource.value, [
    "approvedLongitudinalBuild", "contractVersions", "migrationManifest", "migrationManifestSha256",
    "runtimeBundleSha256", "runtimeDependencies", "schemaVersion", "scientificWorkerBundleSha256",
    "sourceCommit",
  ], "in-image build manifest");
  const build = exactKeys(manifest.approvedLongitudinalBuild, [
    "buildId", "jenaCommit", "jenaTarballIntegrity", "jenaVersion", "sdkVersion",
  ], "in-image approved build");
  if (manifest.schemaVersion !== "3dena.compute-runtime-build-manifest.v4" ||
      manifest.sourceCommit !== IMAGE_SOURCE_COMMIT || manifest.runtimeBundleSha256 !== RUNTIME_BUNDLE_SHA256 ||
      manifest.scientificWorkerBundleSha256 !== SCIENTIFIC_WORKER_SHA256 ||
      build.buildId !== FLY_BUILD_ID || build.sdkVersion !== SDK_VERSION) {
    fail("In-image build manifest identity drifted.");
  }
  return build;
}

function inspectExternalInputs(args, pin) {
  const scan = strictJsonFile(args.scanReceipt, "exact-image scan receipt", SCAN_RECEIPT_SHA256).value;
  const inspect = strictJsonFile(args.dockerInspect, "docker inspect", DOCKER_INSPECT_SHA256).value;
  const host = strictJsonFile(
    args.auxiliaryHostRedactedReceipt,
    "redacted auxiliary host receipt",
    AUXILIARY_HOST_REDACTED_RECEIPT_SHA256,
  ).value;
  if (!isRecord(scan) || scan.schemaVersion !== "3dena.container-scan-receipt.v3" || scan.status !== "passed" ||
      scan.image?.digest !== IMAGE_DIGEST || scan.image?.sourceHeadCommit !== IMAGE_SOURCE_COMMIT ||
      scan.image?.ref !== pin.image.ref || scan.image?.inspectSha256 !== DOCKER_INSPECT_SHA256 ||
      scan.scan?.resultCount !== 0) {
    fail("Exact-image scan receipt does not bind the frozen clean image.");
  }
  if (!Array.isArray(inspect) || inspect.length !== 1 || inspect[0]?.Os !== "linux" ||
      inspect[0]?.Architecture !== "amd64" || inspect[0]?.Config?.User !== "10001:10001" ||
      canonicalJson(inspect[0]?.Config?.Env) !== canonicalJson(EXPECTED_IMAGE_CONFIG_ENV) ||
      !inspect[0]?.RepoDigests?.includes(pin.image.ref) ||
      inspect[0]?.Config?.Labels?.["org.opencontainers.image.revision"] !== IMAGE_SOURCE_COMMIT ||
      inspect[0]?.Config?.Labels?.["org.3dena.tini.sha256"] !== pin.runtime.tiniSha256) {
    fail("Docker inspect does not bind Linux amd64, non-root user, exact Config.Env, tini, digest, and image source.");
  }
  exactKeys(host, [
    "schemaVersion", "status", "sourceReceiptSha256", "sourceMeasurement", "formalMeasurement", "redaction", "claims",
  ], "redacted auxiliary host receipt");
  if (host.schemaVersion !== "3dena.container-memory-peak-host-preflight-redacted.v1" ||
      host.status !== "INFORMATIONAL_ONLY" || host.sourceReceiptSha256 !== AUXILIARY_HOST_RECEIPT_SHA256 ||
      host.sourceMeasurement?.platform !== "darwin" || host.sourceMeasurement?.architecture !== "arm64" ||
      host.sourceMeasurement?.kind !== "macos-process-rss" ||
      host.sourceMeasurement?.equivalentToLinuxCgroupV2ContainerMemoryPeak !== false ||
      host.formalMeasurement?.platform !== "linux" || host.formalMeasurement?.architecture !== "amd64" ||
      host.formalMeasurement?.kind !== "cgroup-v2-whole-container-memory-peak" ||
      host.redaction?.absolutePathsRemoved !== true || host.redaction?.childProcessIdentifiersRemoved !== true ||
      host.claims?.contributesToFormalApproval !== false ||
      host.claims?.formalContainerMemoryPeakCapacityApproved !== false) {
    fail("Redacted auxiliary host receipt must remain informational, non-formal, path-free, and process-ID-free.");
  }
}

function inspectRequest(args, pin, build) {
  const source = strictJsonFile(args.request, "frozen request artifact", REQUEST_ARTIFACT_SHA256);
  const request = structuredClone(source.value);
  request.execution.target = "persistent-compute-service";
  if (hashLongitudinalCalibrationRequest(request) !== REQUEST_HASH ||
      request.execution.sdkVersion !== SDK_VERSION || request.execution.buildId !== FLY_BUILD_ID ||
      request.execution.jenaVersion !== build.jenaVersion || request.execution.jenaCommit !== build.jenaCommit ||
      request.execution.jenaTarballIntegrity !== build.jenaTarballIntegrity ||
      pin.calibration.requestHash !== REQUEST_HASH) {
    fail("Frozen request did not synthesize the exact approved v12 scientific request.");
  }
  return { request, requestBytes: source.bytes };
}

function scientificCore(bundle) {
  const { resultHash: _resultHash, runId: _runId, requestHash: _requestHash, ...scientificIdentity } = bundle.identity;
  const { target: _target, ...scientificExecution } = bundle.execution;
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

function inspectArtifact(bytes) {
  if (bytes.byteLength < 2 || bytes.byteLength > MAX_INPUT_BYTES) fail("Scientific result artifact size is invalid.");
  const artifact = parseStrictJson(utf8.decode(bytes));
  exactKeys(artifact, ["version", "owner", "taskKind", "requestHash", "bundle"], "scientific result artifact");
  if (artifact.version !== "3dena.compute-scientific-longitudinal-result-artifact.v2" ||
      artifact.taskKind !== "longitudinal-analysis-v2" || artifact.requestHash !== REQUEST_HASH ||
      artifact.bundle?.identity?.requestHash !== REQUEST_HASH ||
      artifact.bundle?.identity?.resultHash !== EXPECTED_RESULT_HASH ||
      artifact.bundle?.execution?.sdkVersion !== SDK_VERSION ||
      artifact.bundle?.execution?.buildId !== FLY_BUILD_ID ||
      analysisHash(scientificCore(artifact.bundle)) !== EXPECTED_RESULT_HASH) {
    fail("Scientific result artifact request, build, result, or canonical hash drifted.");
  }
  return artifact;
}

export function sendChildIpcMessageAwaited(child, message, label) {
  return new Promise((resolveSend, rejectSend) => {
    let settled = false;
    const cleanup = () => {
      child.off?.("disconnect", onDisconnect);
      child.off?.("close", onClose);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        rejectSend(new Error(`${label} IPC send did not complete.`, { cause: error }));
      } else {
        resolveSend();
      }
    };
    const onDisconnect = () => finish(new Error("IPC channel disconnected before send callback."));
    const onClose = () => finish(new Error("Child closed before send callback."));
    child.once?.("disconnect", onDisconnect);
    child.once?.("close", onClose);
    try {
      const accepted = child.send(message, (error) => finish(error));
      if (!accepted && !child.connected) finish(new Error("IPC channel is closed."));
    } catch (error) {
      finish(error);
    }
  });
}

export function terminateChildAndAwaitClose(child, signal = "SIGKILL") {
  return new Promise((resolveClose, rejectClose) => {
    const onClose = (code, observedSignal) => {
      child.off?.("error", onError);
      resolveClose({ code, signal: observedSignal });
    };
    const onError = (error) => {
      child.off?.("close", onClose);
      rejectClose(error);
    };
    child.once("close", onClose);
    child.once?.("error", onError);
    try {
      child.kill(signal);
    } catch (error) {
      child.off?.("close", onClose);
      child.off?.("error", onError);
      rejectClose(error);
    }
  });
}

function appendLimited(chunks, chunk, label) {
  const bytes = Buffer.from(chunk);
  const total = chunks.reduce((sum, item) => sum + item.byteLength, 0) + bytes.byteLength;
  if (total > MAX_CHILD_LOG_BYTES) fail(`${label} exceeded the strict log limit.`);
  chunks.push(bytes);
}

function writeExclusive(path, bytes) {
  writeFileSync(path, bytes, { flag: "wx", mode: 0o444 });
}

async function executeScientificChild(args, request, requestBytes, outputRoot) {
  const datasetHash = request.pathTask.datasetHash;
  const specHash = request.pathTask.specHash;
  const runId = request.pathTask.runId;
  const taskId = "container-memory-peak-v12-task";
  const deadlineAtMs = Date.now() + SCIENTIFIC_HARD_DEADLINE_MS;
  const owner = {
    contractVersion: "3dena.compute-task-owner.v1",
    datasetHash,
    specHash,
    runId,
    taskId,
  };
  const source = {
    key: `container-memory-peak/input-${args.runIndex}.json`,
    sha256: sha256(requestBytes),
    byteLength: requestBytes.byteLength,
  };
  const lease = {
    version: "3dena.compute-lease.v1",
    leaseId: `container-memory-peak-lease-${args.runIndex}`,
    holderId: "container-memory-peak-holder",
    epoch: args.runIndex,
    issuedAtMs: Date.now(),
    expiresAtMs: deadlineAtMs,
  };
  const executionId = `container-memory-peak-execution-${args.runIndex}`;
  const context = {
    owner,
    taskRef: `container-memory-peak:${LEAK_MARKER}`,
    request: {
      version: "3dena.compute-task-request.v1",
      owner,
      taskKind: "longitudinal-analysis-v2",
      input: source,
      deadlineAtMs,
      expiresAtMs: deadlineAtMs + 10_000,
    },
    lease,
    executionId,
    resultObjectKey: `container-memory-peak/results/${args.runIndex}.json`,
  };
  const launch = {
    version: "3dena.compute-node-ipc.v1",
    type: "launch",
    context,
    payload: {
      version: "3dena.compute-scientific-worker-launch.v1",
      input: {
        version: "3dena.compute-scientific-longitudinal-execution-input.v2",
        kind: "longitudinal-analysis-v2",
        source,
        owner,
        deadlineAtMs,
        requestHash: REQUEST_HASH,
        request,
      },
      publication: {
        executionId,
        resultObjectKey: context.resultObjectKey,
        owner,
        lease,
      },
    },
  };
  const stdoutChunks = [];
  const stderrChunks = [];
  let artifactBytes;
  let artifactAckSendCompleted = false;
  let publicationAckSendCompleted = false;
  let artifactRequests = 0;
  let publicationRequests = 0;
  let failureCode = "";
  let asynchronousFailure;
  let protocolChain = Promise.resolve();

  const child = fork(SCIENTIFIC_WORKER_PATH, [], {
    cwd: "/app",
    detached: false,
    env: {
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      NODE_ENV: "production",
      NODE_OPTIONS: "--disable-proto=throw",
      TZ: "UTC",
    },
    serialization: "advanced",
    silent: true,
  });
  if (child.pid === undefined || child.stdout === null || child.stderr === null) {
    await terminateChildAndAwaitClose(child, "SIGKILL");
    fail("Scientific child did not expose a PID and private logs.");
  }
  const terminateForFailure = (error, code) => {
    if (asynchronousFailure === undefined) asynchronousFailure = error;
    if (failureCode === "") failureCode = code;
    try {
      child.kill("SIGKILL");
    } catch (killError) {
      asynchronousFailure = new AggregateError([asynchronousFailure, killError], "Child termination failed.");
    }
  };
  child.stdout.on("data", (chunk) => {
    try {
      appendLimited(stdoutChunks, chunk, "Scientific child stdout");
    } catch (error) {
      terminateForFailure(error, "STDOUT_LIMIT_EXCEEDED");
    }
  });
  child.stderr.on("data", (chunk) => {
    try {
      appendLimited(stderrChunks, chunk, "Scientific child stderr");
    } catch (error) {
      terminateForFailure(error, "STDERR_LIMIT_EXCEEDED");
    }
  });

  const handleMessage = async (message) => {
    if (asynchronousFailure !== undefined) return;
    if (!isRecord(message)) {
      terminateForFailure(new Error("Scientific child emitted an invalid IPC message."), "INVALID_IPC_MESSAGE");
      return;
    }
    if (message.type === "artifact-put-request") {
      artifactRequests += 1;
      if (artifactRequests !== 1 || publicationRequests !== 0 || !(message.bytes instanceof Uint8Array)) {
        terminateForFailure(new Error("Artifact request sequence is invalid."), "ARTIFACT_SEQUENCE_INVALID");
        return;
      }
      artifactBytes = Buffer.from(message.bytes);
      const object = message.object;
      if (!isRecord(object) || object.sha256 !== sha256(artifactBytes) || object.byteLength !== artifactBytes.byteLength) {
        terminateForFailure(new Error("Artifact request descriptor is invalid."), "ARTIFACT_DESCRIPTOR_INVALID");
        return;
      }
      try {
        inspectArtifact(artifactBytes);
        writeExclusive(join(outputRoot, "result-artifact.json"), artifactBytes);
      } catch (error) {
        terminateForFailure(error, "ARTIFACT_VALIDATION_FAILED");
        return;
      }
      try {
        await sendChildIpcMessageAwaited(child, {
          version: "3dena.compute-scientific-artifact-put-ack.v1",
          protocolVersion: "3dena.compute-scientific-worker.v1",
          type: "artifact-put-ack",
          executionId,
          object,
        }, "artifact acknowledgement");
        artifactAckSendCompleted = true;
      } catch (error) {
        terminateForFailure(error, "ARTIFACT_ACK_SEND_FAILED");
      }
      return;
    }
    if (message.type === "publication-request") {
      publicationRequests += 1;
      if (publicationRequests !== 1 || artifactRequests !== 1 || artifactBytes === undefined ||
          message.object?.sha256 !== sha256(artifactBytes) || message.object?.byteLength !== artifactBytes.byteLength) {
        terminateForFailure(new Error("Publication request sequence is invalid."), "PUBLICATION_SEQUENCE_INVALID");
        return;
      }
      try {
        await sendChildIpcMessageAwaited(child, {
          version: "3dena.compute-scientific-publication-ack.v1",
          protocolVersion: "3dena.compute-scientific-worker.v1",
          type: "publication-ack",
          receipt: {
            version: "3dena.compute-scientific-publication-receipt.v1",
            accepted: true,
            executionId,
            owner,
            leaseId: lease.leaseId,
            leaseEpoch: lease.epoch,
            object: message.object,
            publishedAtMs: Date.now(),
          },
        }, "publication acknowledgement");
        publicationAckSendCompleted = true;
      } catch (error) {
        terminateForFailure(error, "PUBLICATION_ACK_SEND_FAILED");
      }
      return;
    }
    if (message.type === "failed") {
      failureCode = String(message.code ?? "UNKNOWN");
      return;
    }
    terminateForFailure(new Error("Scientific child emitted an unknown IPC message."), "UNKNOWN_IPC_MESSAGE");
  };
  child.on("message", (message) => {
    protocolChain = protocolChain
      .then(() => handleMessage(message))
      .catch((error) => terminateForFailure(error, "IPC_HANDLER_FAILED"));
  });

  const spawned = new Promise((resolveSpawn, rejectSpawn) => {
    child.once("spawn", resolveSpawn);
    child.once("error", rejectSpawn);
  });
  let closed = false;
  const exited = new Promise((resolveExit) => {
    child.once("close", (code, signal) => {
      closed = true;
      resolveExit({ code, signal });
    });
    child.once("error", (error) => terminateForFailure(error, "CHILD_PROCESS_ERROR"));
  });
  await spawned;
  try {
    await sendChildIpcMessageAwaited(child, launch, "scientific launch");
  } catch (error) {
    terminateForFailure(error, "LAUNCH_SEND_FAILED");
  }
  let timeout;
  const timedOut = new Promise((resolveTimeout) => {
    timeout = setTimeout(() => {
      const error = new Error("Scientific child exceeded the 60-second hard deadline.");
      terminateForFailure(error, "SCIENTIFIC_CHILD_TIMEOUT");
      resolveTimeout({ timedOut: true });
    }, SCIENTIFIC_HARD_DEADLINE_MS);
  });
  let observedExit;
  try {
    const outcome = await Promise.race([
      exited.then((value) => ({ timedOut: false, value })),
      timedOut,
    ]);
    observedExit = outcome.timedOut ? await exited : outcome.value;
    await protocolChain;
  } finally {
    clearTimeout(timeout);
    if (!closed) {
      observedExit = await terminateChildAndAwaitClose(child, "SIGKILL");
      closed = true;
    }
  }
  const childStdout = Buffer.concat(stdoutChunks);
  const childStderr = Buffer.concat(stderrChunks);
  writeExclusive(join(outputRoot, "child-stdout.txt"), childStdout);
  writeExclusive(join(outputRoot, "child-stderr.txt"), childStderr);
  if (observedExit.code !== 0 || observedExit.signal !== null || failureCode !== "" ||
      artifactRequests !== 1 || publicationRequests !== 1 || artifactBytes === undefined ||
      artifactAckSendCompleted !== true || publicationAckSendCompleted !== true ||
      childStdout.byteLength !== 0 || childStderr.byteLength !== 0) {
    throw new Error(
      `Scientific child failed: ${JSON.stringify({ observedExit, failureCode, artifactRequests, publicationRequests })}`,
      { cause: asynchronousFailure },
    );
  }
  return {
    observedExit,
    artifactBytes,
    artifactAckSendCompleted,
    publicationAckSendCompleted,
    workerExitedSuccessfullyAfterAckSends: true,
    childStdout,
    childStderr,
  };
}

function outputDirectory(path) {
  const requested = resolve(path);
  const metadata = lstatSync(requested, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail("Output directory must be a real directory.");
  const real = realpathSync(requested);
  if (real !== requested) fail("Output directory must not traverse a symbolic link.");
  for (const name of ["raw-run.json", "result-artifact.json", "child-stdout.txt", "child-stderr.txt"]) {
    if (existsSync(join(real, name))) fail(`Output ${name} already exists.`);
  }
  return real;
}

function inspectRuntimeIdentity() {
  if (process.platform !== "linux" || process.arch !== "x64") fail("Runner requires Linux amd64.");
  if (typeof process.getuid !== "function" || typeof process.getgid !== "function" ||
      process.getuid() !== 10001 || process.getgid() !== 10001) {
    fail("Runner requires runtime user 10001:10001.");
  }
  const containerId = hostname();
  if (!CONTAINER_ID.test(containerId)) fail("Docker hostname must expose an opaque container ID.");
  return containerId;
}

async function run(argv) {
  const args = parseArguments(argv);
  const outputRoot = outputDirectory(args.outputDir);
  const containerId = inspectRuntimeIdentity();
  const runnerBytes = readStableFile(SCRIPT_PATH, "calibration runner", 4 * 1024 * 1024);
  const runnerSha256 = sha256(runnerBytes);
  const pin = inspectPinManifest(args, runnerSha256);
  inspectRuntimeBinaries(pin.runtime);
  const build = inspectInImageArtifacts();
  inspectExternalInputs(args, pin);
  const { request, requestBytes } = inspectRequest(args, pin, build);
  const before = readCgroupV2CalibrationSnapshot();
  if (before.memoryMaxBytes !== MEMORY_LIMIT_BYTES || before.memorySwapMaxBytes !== 0 ||
      before.cpuQuotaMicroseconds !== 100_000 || before.cpuPeriodMicroseconds !== 100_000 ||
      before.cpuCount !== 1 || before.pidsMax !== 64 || before.oomEvents !== 0 || before.oomKillEvents !== 0) {
    fail("Initial cgroup v2 limits do not match the frozen container policy.");
  }
  const startedMilliseconds = Date.now();
  const startedAt = new Date(startedMilliseconds).toISOString();
  const execution = await executeScientificChild(args, request, requestBytes, outputRoot);
  const after = readCgroupV2CalibrationSnapshot();
  const completedMilliseconds = Date.now();
  const completedAt = new Date(completedMilliseconds).toISOString();
  if (after.memoryMaxBytes !== MEMORY_LIMIT_BYTES || after.memorySwapMaxBytes !== 0 ||
      after.cpuQuotaMicroseconds !== 100_000 || after.cpuPeriodMicroseconds !== 100_000 ||
      after.cpuCount !== 1 || after.pidsMax !== 64 || after.oomEvents !== 0 || after.oomKillEvents !== 0 ||
      after.memoryPeakBytes <= 0) {
    fail("Final cgroup v2 measurement or OOM counters do not match policy.");
  }
  const markerLeakCount = [execution.childStdout, execution.childStderr]
    .reduce((count, bytes) => count + (utf8.decode(bytes).includes(LEAK_MARKER) ? 1 : 0), 0);
  if (markerLeakCount !== 0) fail("Confidentiality marker leaked into scientific child logs.");
  const artifactSha256 = sha256(execution.artifactBytes);
  const rawRun = {
    schemaVersion: "3dena.container-memory-peak-raw-run.v1",
    runIndex: args.runIndex,
    identity: {
      imageDigest: IMAGE_DIGEST,
      imageSourceCommit: IMAGE_SOURCE_COMMIT,
      flyBuildId: FLY_BUILD_ID,
      sdkVersion: SDK_VERSION,
      scientificWorkerSha256: SCIENTIFIC_WORKER_SHA256,
      runtimeBundleSha256: RUNTIME_BUNDLE_SHA256,
      buildManifestSha256: BUILD_MANIFEST_SHA256,
      exactImageScanReceiptSha256: SCAN_RECEIPT_SHA256,
      dockerInspectSha256: DOCKER_INSPECT_SHA256,
      toolingCommit: args.toolingCommit,
      runnerSha256,
      requestArtifactSha256: REQUEST_ARTIFACT_SHA256,
      requestHash: REQUEST_HASH,
      expectedResultHash: EXPECTED_RESULT_HASH,
    },
    environment: {
      platform: "linux",
      architecture: "amd64",
      cgroupVersion: 2,
      runtimeUser: "10001:10001",
      nodeVersion: process.version,
      containerId,
    },
    cgroup: after,
    workload: structuredClone(WORKLOAD),
    execution: {
      startedAt,
      completedAt,
      durationMilliseconds: completedMilliseconds - startedMilliseconds,
      scientificHardDeadlineMilliseconds: SCIENTIFIC_HARD_DEADLINE_MS,
      scientificChildrenStarted: 1,
      maximumConcurrentScientificChildren: 1,
      childExitCode: execution.observedExit.code,
      childSignal: execution.observedExit.signal,
      artifactAckSendCompleted: execution.artifactAckSendCompleted,
      publicationAckSendCompleted: execution.publicationAckSendCompleted,
      workerExitedSuccessfullyAfterAckSends: execution.workerExitedSuccessfullyAfterAckSends,
      requestHash: REQUEST_HASH,
      resultHash: EXPECTED_RESULT_HASH,
      artifactSha256,
      artifactByteLength: execution.artifactBytes.byteLength,
    },
    logs: {
      leakMarkerSha256: sha256(Buffer.from(LEAK_MARKER)),
      childStdoutSha256: sha256(execution.childStdout),
      childStdoutByteLength: execution.childStdout.byteLength,
      childStderrSha256: sha256(execution.childStderr),
      childStderrByteLength: execution.childStderr.byteLength,
      markerLeakCount,
    },
    auxiliaryHostPreflight: {
      sourceReceiptSha256: AUXILIARY_HOST_RECEIPT_SHA256,
      redactedReceiptSha256: AUXILIARY_HOST_REDACTED_RECEIPT_SHA256,
      informationalOnly: true,
      contributesToFormalApproval: false,
    },
  };
  const rawRunBytes = Buffer.from(`${JSON.stringify(rawRun)}\n`, "utf8");
  writeExclusive(join(outputRoot, "raw-run.json"), rawRunBytes);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: "3dena.container-memory-peak-run-marker.v1",
    status: "passed",
    runIndex: args.runIndex,
    rawRunSha256: sha256(rawRunBytes),
    artifactSha256,
    resultHash: EXPECTED_RESULT_HASH,
  })}\n`);
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
    await run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`Container memory peak calibration failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  }
}
