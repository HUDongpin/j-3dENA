import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import * as verifierModule from "./verify-container-memory-peak-evidence.mjs";
import {
  verifyContainerMemoryPeakEvidenceDirectory as verifyFormalContainerMemoryPeakEvidenceDirectory,
  verifyContainerMemoryPeakEvidenceDocuments as verifyFormalContainerMemoryPeakEvidenceDocuments,
} from "./verify-container-memory-peak-evidence.mjs";
import {
  hashLongitudinalCalibrationRequest,
  readCgroupV2CalibrationSnapshot,
  sendChildIpcMessageAwaited,
  terminateChildAndAwaitClose,
} from "./run-container-memory-peak-linux-calibration.mjs";

const verifyContainerMemoryPeakEvidenceDocuments = (...args) =>
  verifierModule.verifyContainerMemoryPeakTestEvidenceDocuments(...args);
const verifyContainerMemoryPeakEvidenceDirectory = (...args) =>
  verifierModule.verifyContainerMemoryPeakTestEvidenceDirectory(...args);

test("rejects a non-object evidence document", () => {
  assert.throws(
    () => verifyFormalContainerMemoryPeakEvidenceDocuments(null, {
      expectedPinManifestSha256: "0".repeat(64),
      expectedToolingCommit: TOOLING_COMMIT,
    }),
    /evidence document/i,
  );
});

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    assert.equal(Number.isFinite(value), true);
    return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  assert.equal(typeof value, "object");
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function analysisHash(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

function descriptor(path, bytes) {
  return { path, sha256: sha256(bytes), byteLength: bytes.byteLength };
}

test("ships the frozen v12 calibration request with its exact scientific hash", () => {
  const path = resolve("scripts/container-memory-peak-calibration-request.json");
  const bytes = readFileSync(path);
  const request = JSON.parse(bytes.toString("utf8"));
  const { target: _target, ...scientificExecution } = request.execution;
  assert.equal(
    analysisHash({
      dataset: request.dataset,
      pathTask: request.pathTask,
      inferenceTask: request.inferenceTask,
      bootstrapTask: request.bootstrapTask,
      networkOverlayTask: request.networkOverlayTask,
      execution: scientificExecution,
    }),
    "a76fa8cd5aca04017ad39403e5da0f1c53725e0e439fcffd18fdd1474ed22aed",
  );
  assert.equal(request.dataset.receipt.rows, 240);
  assert.equal(request.dataset.sourceResult.result.nodes.length, 8);
  assert.equal(request.pathTask.runSpec.orderedPeriods.length, 6);
  assert.deepEqual(
    request.inferenceTask.requests.map(({ kind }) => kind),
    ["independent-period", "paired-periods", "repeated-periods", "path-comparison"],
  );
  assert.equal(request.inferenceTask.requests[3].repetitions, 500);
  assert.equal(request.bootstrapTask.repetitions, 500);
  assert.equal(request.networkOverlayTask.requests.length, 1);
});

const IMAGE_DIGEST = "sha256:4257374102d32b5b21d59fe3030b1fab339c65b7c55070d396d1b78b099b5881";
const IMAGE_SOURCE_COMMIT = "fb5c89322ea32b88fcde456b0338e659aa590272";
const FLY_BUILD_ID = "a8b63e853c28be665282eaa4e8010d4198319106";
const SDK_VERSION = "0.2.0-implemented-unverified.12";
const WORKER_SHA256 = "df19b871790be8de8267b6467733647071b7b7e8a642341a09e7095f7887d0c7";
const RUNTIME_SHA256 = "54c4e2a96a5fbd8324ee2a3d91411a229e82fb892dc57eab3b15dd8565d2d751";
const BUILD_MANIFEST_SHA256 = "cb07d77e824f57b9ed709aad12994b1fece92b297b7e9252fa4f0f7116573dc5";
const REQUEST_HASH = "a76fa8cd5aca04017ad39403e5da0f1c53725e0e439fcffd18fdd1474ed22aed";
const AUXILIARY_HOST_RECEIPT_SHA256 = "d9b0d03edbc1d25858a4b433fb0dee687492e5632a5146dc8158d2c3c051cf49";
const AUXILIARY_HOST_REDACTED_RECEIPT_SHA256 = "ab5b95038a1c80fcd9506ac879b189d63cfec7e35820196f463e3cec59349a12";
const TOOLING_COMMIT = "9".repeat(40);
const IMAGE_REF = `registry.fly.io/j3dena-preview-hdp-260826@${IMAGE_DIGEST}`;
const GITHUB_REF = "refs/heads/main";
const GITHUB_RUN_ID = "33060000001";
const GITHUB_REPOSITORY_ID = "1341282948";
const GITHUB_REPOSITORY_OWNER_ID = "47708816";
const LEAK_MARKER = "3DENA_CONTAINER_MEMORY_PEAK_PRIVATE_SENTINEL_V1";
const MEMORY_LIMIT = 2_147_483_648;
const NODE_SHA256 = "c".repeat(64);
const TINI_SHA256 = "93dcc18adc78c65a028a84799ecf8ad40c936fdfc5f2a57b1acda5a8117fa82c";
const IMAGE_CONFIG_ENV = Object.freeze([
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

const ENVELOPE = Object.freeze({
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

const POLICY = Object.freeze({
  platform: "linux",
  architecture: "amd64",
  cgroupVersion: 2,
  runtimeUser: "10001:10001",
  memoryMaxBytes: MEMORY_LIMIT,
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

function expectedContainerCommand(runIndex, expectedPinManifestSha256) {
  return [
    "--",
    "/usr/local/bin/node",
    "/calibration/tooling/run-container-memory-peak-linux-calibration.mjs",
    "--run-index", String(runIndex),
    "--pin-manifest", "/calibration/pin-manifest.json",
    "--expected-pin-manifest-sha256", expectedPinManifestSha256,
    "--request", "/calibration/tooling/container-memory-peak-calibration-request.json",
    "--scan-receipt", "/calibration/prior/scan-receipt.json",
    "--docker-inspect", "/calibration/prior/docker-inspect.json",
    "--auxiliary-host-redacted-receipt", "/calibration/prior/host-preflight-redacted.json",
    "--tooling-commit", TOOLING_COMMIT,
    "--output-dir", "/evidence",
  ];
}

function scientificCore(bundle) {
  const {
    resultHash: _resultHash,
    runId: _runId,
    requestHash: _requestHash,
    ...scientificIdentity
  } = bundle.identity;
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

function buildFixture() {
  const requestBytes = readFileSync(
    resolve("scripts/container-memory-peak-calibration-request.json"),
  );
  const request = JSON.parse(requestBytes.toString("utf8"));
  const runnerBytes = Buffer.from("#!/usr/bin/env node\n// synthetic runner\n", "utf8");
  const workflowBytes = Buffer.from("name: synthetic reviewed workflow fixture\n", "utf8");
  const verifierBytes = Buffer.from("#!/usr/bin/env node\n// synthetic verifier\n", "utf8");
  const hostObserverBytes = Buffer.from("#!/usr/bin/env node\n// synthetic host observer\n", "utf8");
  const scanReceipt = {
    schemaVersion: "3dena.container-scan-receipt.v3",
    status: "passed",
    repository: "HUDongpin/j-3dENA",
    runIdentity: { runId: "33056284011", runAttempt: "1" },
    image: {
      ref: IMAGE_REF,
      digest: IMAGE_DIGEST,
      sourceRepository: "https://github.com/HUDongpin/j-3dENA",
      sourceHeadCommit: IMAGE_SOURCE_COMMIT,
      user: "10001:10001",
      os: "linux",
      architecture: "amd64",
      inspectPath: "docker-inspect.json",
      inspectSha256: "placeholder-inspect-sha",
    },
    scanner: { name: "Trivy", version: "0.70.0" },
    scan: { format: "trivy-json", artifactName: IMAGE_REF, resultCount: 0 },
  };
  const dockerInspect = [{
    Id: `sha256:${"d".repeat(64)}`,
    RepoDigests: [IMAGE_REF],
    Architecture: "amd64",
    Os: "linux",
    Config: {
      User: "10001:10001",
      Env: [...IMAGE_CONFIG_ENV],
      Labels: {
        "org.opencontainers.image.revision": IMAGE_SOURCE_COMMIT,
        "org.3dena.tini.sha256": TINI_SHA256,
      },
    },
  }];
  const dockerInspectBytes = jsonBytes(dockerInspect);
  scanReceipt.image.inspectSha256 = sha256(dockerInspectBytes);
  const scanReceiptBytes = jsonBytes(scanReceipt);
  const auxiliaryHostRedactedReceiptBytes = jsonBytes({
    schemaVersion: "3dena.container-memory-peak-host-preflight-redacted.v1",
    status: "INFORMATIONAL_ONLY",
    sourceReceiptSha256: AUXILIARY_HOST_RECEIPT_SHA256,
    sourceMeasurement: {
      platform: "darwin",
      architecture: "arm64",
      kind: "macos-process-rss",
      equivalentToLinuxCgroupV2ContainerMemoryPeak: false,
    },
    formalMeasurement: {
      platform: "linux",
      architecture: "amd64",
      kind: "cgroup-v2-whole-container-memory-peak",
    },
    redaction: {
      absolutePathsRemoved: true,
      childProcessIdentifiersRemoved: true,
    },
    claims: {
      contributesToFormalApproval: false,
      formalContainerMemoryPeakCapacityApproved: false,
    },
  });

  const bundle = {
    schemaVersion: "3dena.longitudinal-analysis-bundle.v2",
    identity: {
      datasetHash: request.pathTask.datasetHash,
      specHash: request.pathTask.specHash,
      sourceResultHash: request.pathTask.runSpec.sourceResultHash,
      requestHash: REQUEST_HASH,
      resultHash: "",
      runId: request.pathTask.runId,
      jenaBuildId: `jena-js@${request.execution.jenaVersion}+${request.execution.jenaCommit}:${FLY_BUILD_ID}`,
    },
    runSpec: request.pathTask.runSpec,
    model: {
      type: "SeparateTrajectory",
      fullRotationDimensions: request.dataset.sourceResult.result.dimensions,
      selectedDimensions: request.pathTask.runSpec.selectedDimensions,
    },
    paths: [{
      schemaVersion: "3dena.synthetic-trajectory-path-fixture.v1",
      groupCanonical: "fixture-group-a",
      orderedPeriodCanonicals: ["period-1", "period-2"],
      selectedStepDistances: [0.25],
    }],
    inference: [{
      schemaVersion: "3dena.synthetic-inference-fixture.v1",
      kind: "independent-period",
      statistic: 1.5,
      adjustedPValue: 0.25,
    }],
    pathComparisons: [{
      schemaVersion: "3dena.synthetic-path-comparison-fixture.v1",
      groups: ["fixture-group-a", "fixture-group-b"],
      repetitions: 500,
      observedDistance: 0.5,
    }],
    bootstrap: [{
      schemaVersion: "3dena.synthetic-bootstrap-fixture.v1",
      groupCanonical: "fixture-group-a",
      periodCanonical: "period-1",
      lower: [0.1, 0.2, 0.3],
      upper: [0.4, 0.5, 0.6],
    }],
    codeGeometry: {
      schemaVersion: "3dena.longitudinal-code-geometry.v2",
      dimensions: request.pathTask.runSpec.selectedDimensions,
      nodes: [{
        index: 0,
        code: "fixture-code-1",
        coordinates: [0.1, 0.2, 0.3],
      }],
    },
    networkOverlays: [{
      schemaVersion: "3dena.synthetic-network-overlay-fixture.v1",
      groupCanonical: "fixture-group-a",
      periodCanonical: "period-1",
      edges: [{ source: "fixture-code-1", target: "fixture-code-2", weight: 0.75 }],
    }],
    diagnostics: [],
    execution: {
      target: "persistent-compute-service",
      jenaVersion: request.execution.jenaVersion,
      jenaCommit: request.execution.jenaCommit,
      jenaTarballIntegrity: request.execution.jenaTarballIntegrity,
      sdkVersion: SDK_VERSION,
      buildId: FLY_BUILD_ID,
      seed: 2026,
      permutationPlanHashes: ["a".repeat(64)],
      resamplingPlanHashes: ["b".repeat(64)],
      evidenceStatus: "IMPLEMENTED_UNVERIFIED",
    },
  };
  bundle.identity.resultHash = analysisHash(scientificCore(bundle));
  const expectedResultHash = bundle.identity.resultHash;
  const artifact = {
    version: "3dena.compute-scientific-longitudinal-result-artifact.v2",
    owner: {
      contractVersion: "3dena.compute-task-owner.v1",
      datasetHash: request.pathTask.datasetHash,
      specHash: request.pathTask.specHash,
      runId: request.pathTask.runId,
      taskId: "container-memory-peak-v12-task",
    },
    taskKind: "longitudinal-analysis-v2",
    requestHash: REQUEST_HASH,
    bundle,
  };
  const artifactBytes = jsonBytes(artifact);
  const emptyBytes = Buffer.alloc(0);
  const peaks = [220_000_000, 240_000_000, 230_000_000];
  const runs = [];
  const evidenceRuns = [];
  for (let index = 1; index <= 3; index += 1) {
    const containerId = String(index).repeat(64);
    const startedAt = `2026-08-27T01:00:0${index}.000Z`;
    const completedAt = `2026-08-27T01:00:0${index + 1}.000Z`;
    const rawRun = {
      schemaVersion: "3dena.container-memory-peak-raw-run.v1",
      runIndex: index,
      identity: {
        imageDigest: IMAGE_DIGEST,
        imageSourceCommit: IMAGE_SOURCE_COMMIT,
        flyBuildId: FLY_BUILD_ID,
        sdkVersion: SDK_VERSION,
        scientificWorkerSha256: WORKER_SHA256,
        runtimeBundleSha256: RUNTIME_SHA256,
        buildManifestSha256: BUILD_MANIFEST_SHA256,
        exactImageScanReceiptSha256: sha256(scanReceiptBytes),
        dockerInspectSha256: sha256(dockerInspectBytes),
        toolingCommit: TOOLING_COMMIT,
        runnerSha256: sha256(runnerBytes),
        requestArtifactSha256: sha256(requestBytes),
        requestHash: REQUEST_HASH,
        expectedResultHash,
      },
      environment: {
        platform: "linux",
        architecture: "amd64",
        cgroupVersion: 2,
        runtimeUser: "10001:10001",
        nodeVersion: "v24.19.0",
        containerId: containerId.slice(0, 12),
      },
      cgroup: {
        memoryMaxBytes: MEMORY_LIMIT,
        memoryPeakBytes: peaks[index - 1],
        memorySwapMaxBytes: 0,
        cpuQuotaMicroseconds: 100_000,
        cpuPeriodMicroseconds: 100_000,
        cpuCount: 1,
        pidsMax: 64,
        oomEvents: 0,
        oomKillEvents: 0,
      },
      workload: structuredClone(ENVELOPE),
      execution: {
        startedAt,
        completedAt,
        durationMilliseconds: 1_000,
        scientificHardDeadlineMilliseconds: 60_000,
        scientificChildrenStarted: 1,
        maximumConcurrentScientificChildren: 1,
        childExitCode: 0,
        childSignal: null,
        artifactAckSendCompleted: true,
        publicationAckSendCompleted: true,
        workerExitedSuccessfullyAfterAckSends: true,
        requestHash: REQUEST_HASH,
        resultHash: expectedResultHash,
        artifactSha256: sha256(artifactBytes),
        artifactByteLength: artifactBytes.byteLength,
      },
      logs: {
        leakMarkerSha256: sha256(Buffer.from(LEAK_MARKER)),
        childStdoutSha256: sha256(emptyBytes),
        childStdoutByteLength: 0,
        childStderrSha256: sha256(emptyBytes),
        childStderrByteLength: 0,
        markerLeakCount: 0,
      },
      auxiliaryHostPreflight: {
        sourceReceiptSha256: AUXILIARY_HOST_RECEIPT_SHA256,
        redactedReceiptSha256: sha256(auxiliaryHostRedactedReceiptBytes),
        informationalOnly: true,
        contributesToFormalApproval: false,
      },
    };
    const rawRunBytes = jsonBytes(rawRun);
    const marker = {
      schemaVersion: "3dena.container-memory-peak-run-marker.v1",
      status: "passed",
      runIndex: index,
      rawRunSha256: sha256(rawRunBytes),
      artifactSha256: sha256(artifactBytes),
      resultHash: expectedResultHash,
    };
    const stdoutBytes = jsonBytes(marker);
    const runtimeInspect = [{
      Id: containerId,
      Created: "2026-08-27T01:00:00.000000000Z",
      Config: {
        Image: IMAGE_REF,
        User: "10001:10001",
        Env: [...IMAGE_CONFIG_ENV],
        Entrypoint: ["/sbin/tini"],
        Cmd: expectedContainerCommand(index, "0".repeat(64)),
      },
      HostConfig: {
        NetworkMode: "none",
        Privileged: false,
        CapAdd: null,
        Binds: null,
        Devices: [],
        PidMode: "",
        IpcMode: "private",
        UsernsMode: "",
        CgroupnsMode: "private",
        ReadonlyRootfs: true,
        Memory: MEMORY_LIMIT,
        MemorySwap: MEMORY_LIMIT,
        MemorySwappiness: 0,
        NanoCpus: 1_000_000_000,
        PidsLimit: 64,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        Tmpfs: { "/tmp": "rw,nosuid,nodev,noexec" },
        Mounts: [
          {
            Type: "bind",
            Source: "/home/runner/_temp/container-memory-peak-input-33060000001-1",
            Target: "/calibration",
            ReadOnly: true,
          },
          {
            Type: "bind",
            Source: `/home/runner/_temp/container-memory-peak-output-33060000001-1/run-${index}`,
            Target: "/evidence",
            ReadOnly: false,
          },
        ],
      },
      State: {
        Status: "exited",
        Running: false,
        OOMKilled: false,
        Dead: false,
        ExitCode: 0,
        Error: "",
        StartedAt: "2026-08-27T01:00:00.500000000Z",
        FinishedAt: "2026-08-27T01:00:10.000000000Z",
      },
      NetworkSettings: { Networks: {} },
      Mounts: [
        {
          Type: "bind",
          Source: "/home/runner/_temp/container-memory-peak-input-33060000001-1",
          Destination: "/calibration",
          Mode: "",
          RW: false,
          Propagation: "rprivate",
        },
        {
          Type: "bind",
          Source: `/home/runner/_temp/container-memory-peak-output-33060000001-1/run-${index}`,
          Destination: "/evidence",
          Mode: "",
          RW: true,
          Propagation: "rprivate",
        },
      ],
    }];
    const runtimeInspectBytes = jsonBytes(runtimeInspect);
    const hostObservationBytes = jsonBytes({
      schemaVersion: "3dena.container-memory-peak-host-cgroup-observation.v1",
      status: "OBSERVED",
      runIndex: index,
      containerId,
      observer: {
        toolingCommit: TOOLING_COMMIT,
        observerSha256: sha256(hostObserverBytes),
      },
      measurement: {
        source: "host-side-cgroup-v2",
        cgroupPathSha256: String(index + 3).repeat(64),
        memoryMaxBytes: MEMORY_LIMIT,
        memorySwapMaxBytes: 0,
        maximumMemoryPeakBytes: peaks[index - 1],
        sampleCount: 10 + index,
      },
      execution: {
        startedAt,
        completedAt,
        durationMilliseconds: 1_000,
        targetExited: true,
      },
      claims: {
        independentFromContainerPayload: true,
        wholeContainerAccounting: true,
        equivalentToScientificChildProcessRss: false,
      },
    });
    runs.push({
      rawRunBytes,
      runtimeInspectBytes,
      hostObservationBytes,
      artifactBytes,
      stdoutBytes,
      stderrBytes: emptyBytes,
      childStdoutBytes: emptyBytes,
      childStderrBytes: emptyBytes,
    });
    evidenceRuns.push({
      runIndex: index,
      rawRun: descriptor(`runs/run-${index}/raw-run.json`, rawRunBytes),
      runtimeInspect: descriptor(`runs/run-${index}/runtime-inspect.json`, runtimeInspectBytes),
      hostObservation: descriptor(`runs/run-${index}/host-cgroup-observation.json`, hostObservationBytes),
      artifact: descriptor(`runs/run-${index}/result-artifact.json`, artifactBytes),
      stdout: descriptor(`runs/run-${index}/stdout.txt`, stdoutBytes),
      stderr: descriptor(`runs/run-${index}/stderr.txt`, emptyBytes),
      childStdout: descriptor(`runs/run-${index}/child-stdout.txt`, emptyBytes),
      childStderr: descriptor(`runs/run-${index}/child-stderr.txt`, emptyBytes),
    });
  }
  const frozenPins = {
    imageDigest: IMAGE_DIGEST,
    imageSourceCommit: IMAGE_SOURCE_COMMIT,
    flyBuildId: FLY_BUILD_ID,
    sdkVersion: SDK_VERSION,
    scientificWorkerSha256: WORKER_SHA256,
    runtimeBundleSha256: RUNTIME_SHA256,
    buildManifestSha256: BUILD_MANIFEST_SHA256,
    exactImageScanReceiptSha256: sha256(scanReceiptBytes),
    dockerInspectSha256: sha256(dockerInspectBytes),
    requestArtifactSha256: sha256(requestBytes),
    requestHash: REQUEST_HASH,
    expectedResultHash,
    auxiliaryHostSourceReceiptSha256: AUXILIARY_HOST_RECEIPT_SHA256,
    auxiliaryHostRedactedReceiptSha256: sha256(auxiliaryHostRedactedReceiptBytes),
    memoryLimitBytes: MEMORY_LIMIT,
    thresholdFraction: 0.5,
  };
  const pinManifest = {
    schemaVersion: "3dena.container-memory-peak-pins.v1",
    repository: "HUDongpin/j-3dENA",
    image: {
      ref: IMAGE_REF,
      digest: IMAGE_DIGEST,
      sourceCommit: IMAGE_SOURCE_COMMIT,
      flyBuildId: FLY_BUILD_ID,
      sdkVersion: SDK_VERSION,
      scientificWorkerSha256: WORKER_SHA256,
      runtimeBundleSha256: RUNTIME_SHA256,
      buildManifestSha256: BUILD_MANIFEST_SHA256,
    },
    priorEvidence: {
      exactImageScanReceiptSha256: frozenPins.exactImageScanReceiptSha256,
      dockerInspectSha256: frozenPins.dockerInspectSha256,
      auxiliaryHostSourceReceiptSha256: AUXILIARY_HOST_RECEIPT_SHA256,
      auxiliaryHostRedactedReceiptSha256: frozenPins.auxiliaryHostRedactedReceiptSha256,
      auxiliaryHostReceiptRole: "informational-only",
    },
    tooling: {
      commit: TOOLING_COMMIT,
      workflowSha256: sha256(workflowBytes),
      verifierSha256: sha256(verifierBytes),
      hostObserverSha256: sha256(hostObserverBytes),
      runnerSha256: sha256(runnerBytes),
      requestArtifactSha256: sha256(requestBytes),
    },
    runtime: {
      nodePath: "/usr/local/bin/node",
      nodeSha256: NODE_SHA256,
      tiniPath: "/sbin/tini",
      tiniSha256: TINI_SHA256,
      configEnv: [...IMAGE_CONFIG_ENV],
    },
    calibration: {
      requestHash: REQUEST_HASH,
      expectedResultHash,
      memoryLimitBytes: MEMORY_LIMIT,
      thresholdFraction: 0.5,
      freshContainerRuns: 3,
      scientificHardDeadlineMilliseconds: 60_000,
    },
  };
  const pinManifestBytes = jsonBytes(pinManifest);
  for (let index = 0; index < 3; index += 1) {
    const runtimeInspect = JSON.parse(runs[index].runtimeInspectBytes.toString("utf8"));
    runtimeInspect[0].Config.Cmd = expectedContainerCommand(
      index + 1,
      sha256(pinManifestBytes),
    );
    const runtimeInspectBytes = jsonBytes(runtimeInspect);
    runs[index].runtimeInspectBytes = runtimeInspectBytes;
    evidenceRuns[index].runtimeInspect = descriptor(
      evidenceRuns[index].runtimeInspect.path,
      runtimeInspectBytes,
    );
  }
  const maximumContainerMemoryPeakBytes = Math.max(...peaks);
  const evidence = {
    schemaVersion: "3dena.container-memory-peak-evidence.v1",
    status: "EXECUTED",
    pinManifest: descriptor("pin-manifest.json", pinManifestBytes),
    externalEvidence: {
      exactImageScanReceipt: descriptor("prior/scan-receipt.json", scanReceiptBytes),
      dockerInspect: descriptor("prior/docker-inspect.json", dockerInspectBytes),
      auxiliaryHostPreflight: {
        ...descriptor("prior/host-preflight-redacted.json", auxiliaryHostRedactedReceiptBytes),
        role: "informational-only",
        contributesToFormalApproval: false,
      },
    },
    tooling: {
      toolingCommit: TOOLING_COMMIT,
      imageSourceCommit: IMAGE_SOURCE_COMMIT,
      workflow: descriptor("tooling/container-memory-peak-calibration.yml", workflowBytes),
      verifier: descriptor("tooling/verify-container-memory-peak-evidence.mjs", verifierBytes),
      hostObserver: descriptor("tooling/observe-container-memory-peak-linux.mjs", hostObserverBytes),
      runner: descriptor("tooling/run-container-memory-peak-linux-calibration.mjs", runnerBytes),
      request: descriptor("tooling/container-memory-peak-calibration-request.json", requestBytes),
    },
    githubProvenance: {
      schemaVersion: "3dena.container-memory-peak-github-run-provenance.v1",
      repository: "HUDongpin/j-3dENA",
      repositoryId: GITHUB_REPOSITORY_ID,
      repositoryOwnerId: GITHUB_REPOSITORY_OWNER_ID,
      serverUrl: "https://github.com",
      ref: GITHUB_REF,
      refProtected: true,
      sha: TOOLING_COMMIT,
      workflowPath: ".github/workflows/container-memory-peak-calibration.yml",
      workflowRef: `HUDongpin/j-3dENA/.github/workflows/container-memory-peak-calibration.yml@${GITHUB_REF}`,
      workflowSha: TOOLING_COMMIT,
      runId: GITHUB_RUN_ID,
      runAttempt: 1,
      job: "exact-v12-container-memory-peak-producer",
      protectedEnvironment: "container-memory-peak-calibration",
      runnerEnvironment: {
        runnerOs: "Linux",
        runnerArch: "X64",
        runnerImage: "ubuntu24",
        runnerImageVersion: "20260820.1.0",
        kernelRelease: "6.11.0-1018-azure",
        kernelVersion: "#18~24.04.1-Ubuntu SMP PREEMPT_DYNAMIC",
        dockerClientVersion: "28.3.3",
        dockerServerVersion: "28.3.3",
        cgroupVersion: 2,
        cgroupFilesystem: "cgroup2fs",
      },
      artifacts: {
        evidenceName: "exact-v12-container-memory-peak-evidence",
        formalReceiptName: "exact-v12-container-memory-peak-verification-receipt",
      },
    },
    approvedCalibrationEnvelope: structuredClone(ENVELOPE),
    executionPolicy: structuredClone(POLICY),
    runs: evidenceRuns,
    aggregate: {
      runCount: 3,
      maximumContainerMemoryPeakBytes,
      memoryLimitBytes: MEMORY_LIMIT,
      maximumContainerMemoryPeakFraction: maximumContainerMemoryPeakBytes / MEMORY_LIMIT,
      thresholdFraction: 0.5,
      calibrationEnvelopeUnderThreshold: true,
    },
    claims: {
      approvedCalibrationEnvelopeOnly: true,
      extrapolationBeyondEnvelopeApproved: false,
      realFlyMultiMachineApproved: false,
      requiredRealFlyMachines: 2,
      realFlyMultiMachineStatus: "NOT_RUN",
    },
  };
  const input = {
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
  };
  const options = {
    expectedPinManifestSha256: sha256(pinManifestBytes),
    expectedToolingCommit: TOOLING_COMMIT,
    frozenPins,
  };
  return { input, options, expectedResultHash };
}

function replaceRunJson(fixture, index, field, mutate) {
  const bytesField = `${field}Bytes`;
  const value = JSON.parse(Buffer.from(fixture.input.runs[index][bytesField]).toString("utf8"));
  mutate(value);
  const bytes = jsonBytes(value);
  fixture.input.runs[index][bytesField] = bytes;
  const descriptorName = field === "rawRun" ? "rawRun" : field;
  fixture.input.evidence.runs[index][descriptorName] = descriptor(
    fixture.input.evidence.runs[index][descriptorName].path,
    bytes,
  );
  if (field === "rawRun" || field === "artifact") {
    const marker = JSON.parse(
      Buffer.from(fixture.input.runs[index].stdoutBytes).toString("utf8"),
    );
    if (field === "rawRun") marker.rawRunSha256 = sha256(bytes);
    if (field === "artifact") marker.artifactSha256 = sha256(bytes);
    const stdoutBytes = jsonBytes(marker);
    fixture.input.runs[index].stdoutBytes = stdoutBytes;
    fixture.input.evidence.runs[index].stdout = descriptor(
      fixture.input.evidence.runs[index].stdout.path,
      stdoutBytes,
    );
  }
}

test("formal document verification rejects caller-supplied frozen pin overrides", () => {
  const fixture = buildFixture();
  assert.throws(
    () => verifyFormalContainerMemoryPeakEvidenceDocuments(fixture.input, fixture.options),
    /frozenPins|unknown|formal pins/i,
  );
});

test("synthetic fixtures can only produce an explicitly non-formal test receipt", () => {
  assert.equal(
    typeof verifierModule.verifyContainerMemoryPeakTestEvidenceDocuments,
    "function",
  );
  const fixture = buildFixture();
  const receipt = verifierModule.verifyContainerMemoryPeakTestEvidenceDocuments(
    fixture.input,
    fixture.options,
  );
  assert.equal(receipt.schemaVersion, "3dena.container-memory-peak-test-verification.v1");
  assert.equal(receipt.status, "test-only-consistency-pass");
  assert.equal(receipt.formalContainerMemoryPeakCapacityApproved, false);
  assert.equal(receipt.testOnlyCandidateSatisfiedFrozenPolicy, true);
  assert.equal(receipt.calibrationEnvelopeUnderThreshold, true);
  assert.equal(receipt.measurement.scope, "whole-container");
  assert.equal(receipt.measurement.equivalentToScientificChildProcessRss, false);
  assert.equal(receipt.exactScientificForkHarnessCalibrationPassed, true);
  assert.equal(receipt.persistentServicePathExercised, false);
  assert.equal(receipt.apiQueueWorkerPathExercised, false);
  assert.equal(receipt.persistentServiceCapacityApproved, false);
  assert.equal(receipt.flyCapacityApproved, false);
});

test("offline synthetic inputs cannot mint the formal GitHub artifact verification schema", async () => {
  assert.equal(
    typeof verifierModule.verifyContainerMemoryPeakGithubArtifactAttestationDocuments,
    "function",
  );
  await assert.rejects(
    async () => verifierModule.verifyContainerMemoryPeakGithubArtifactAttestationDocuments(
      {
        consistencyReceiptBytes: jsonBytes({ synthetic: true }),
        githubArtifactCustodyBytes: jsonBytes({ synthetic: true }),
      },
      {
        expectedConsistencyReceiptSha256: "0".repeat(64),
        expectedEvidenceArtifactId: "1",
        expectedEvidenceArtifactDigest: "0".repeat(64),
        expectedToolingCommit: TOOLING_COMMIT,
      },
    ),
    /GitHub Actions|github-hosted|formal runtime|offline/i,
  );
});

test("spoofed offline GitHub environment variables cannot bypass a live fixed-origin OIDC exchange", async () => {
  const environment = {
    GITHUB_ACTIONS: "true",
    CI: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY: "HUDongpin/j-3dENA",
    GITHUB_REPOSITORY_ID,
    GITHUB_REPOSITORY_OWNER_ID,
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REF_PROTECTED: "true",
    GITHUB_SHA: TOOLING_COMMIT,
    GITHUB_WORKFLOW_SHA: TOOLING_COMMIT,
    GITHUB_WORKFLOW_REF: "HUDongpin/j-3dENA/.github/workflows/container-memory-peak-calibration.yml@refs/heads/main",
    GITHUB_RUN_ID: "12345",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_JOB: "exact-v12-container-memory-peak-verifier",
    CONTAINER_MEMORY_PEAK_PROTECTED_ENVIRONMENT: "container-memory-peak-calibration",
    ACTIONS_ID_TOKEN_REQUEST_URL: "http://127.0.0.1:9/fake-oidc",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "offline-synthetic-token",
  };
  const previous = new Map(Object.keys(environment).map((name) => [name, process.env[name]]));
  Object.assign(process.env, environment);
  const consistencyReceiptBytes = jsonBytes({ synthetic: true });
  try {
    await assert.rejects(
      async () => verifierModule.verifyContainerMemoryPeakGithubArtifactAttestationDocuments(
        {
          consistencyReceiptBytes,
          githubArtifactCustodyBytes: jsonBytes({ synthetic: true }),
        },
        {
          expectedConsistencyReceiptSha256: sha256(consistencyReceiptBytes),
          expectedEvidenceArtifactId: "1",
          expectedEvidenceArtifactDigest: "0".repeat(64),
          expectedToolingCommit: TOOLING_COMMIT,
        },
      ),
      /OIDC[^\n]*(?:https|vstoken\.actions\.githubusercontent\.com|fixed origin)/iu,
    );
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("formal GitHub artifact directory publication is closed-set and unavailable offline", async () => {
  assert.equal(
    typeof verifierModule.verifyContainerMemoryPeakGithubArtifactAttestationDirectory,
    "function",
  );
  const root = mkdtempSync(join(tmpdir(), "3dena-container-memory-peak-formal-offline-"));
  try {
    mkdirSync(join(root, "input"));
    writeFileSync(join(root, "input/consistency.json"), jsonBytes({ synthetic: true }));
    writeFileSync(join(root, "input/attestation.json"), jsonBytes({ synthetic: true }));
    await assert.rejects(
      async () => verifierModule.verifyContainerMemoryPeakGithubArtifactAttestationDirectory({
        formalRoot: realpathSync(root),
        consistencyReceiptPath: "input/consistency.json",
        githubArtifactCustodyPath: "input/attestation.json",
        expectedConsistencyReceiptSha256: "0".repeat(64),
        expectedEvidenceArtifactId: "1",
        expectedEvidenceArtifactDigest: "0".repeat(64),
        expectedToolingCommit: TOOLING_COMMIT,
        outputPath: "verification.json",
      }),
      /GitHub Actions|github-hosted|formal runtime|offline/i,
    );
    assert.equal(existsSync(join(root, "verification.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("container memory evidence requires exact GitHub run provenance", () => {
  const fixture = buildFixture();
  delete fixture.input.evidence.githubProvenance;
  assert.throws(
    () => verifyContainerMemoryPeakEvidenceDocuments(fixture.input, fixture.options),
    /github|provenance|workflow|run/i,
  );
});

test("container memory evidence records the GitHub runner image, kernel, Docker, and cgroup provenance", () => {
  const fixture = buildFixture();
  const receipt = verifyContainerMemoryPeakEvidenceDocuments(fixture.input, fixture.options);
  assert.deepEqual(receipt.githubProvenance.runnerEnvironment, {
    runnerOs: "Linux",
    runnerArch: "X64",
    runnerImage: "ubuntu24",
    runnerImageVersion: "20260820.1.0",
    kernelRelease: "6.11.0-1018-azure",
    kernelVersion: "#18~24.04.1-Ubuntu SMP PREEMPT_DYNAMIC",
    dockerClientVersion: "28.3.3",
    dockerServerVersion: "28.3.3",
    cgroupVersion: 2,
    cgroupFilesystem: "cgroup2fs",
  });
});

test("rejects GitHub repository, ref, workflow SHA, run, job, environment, and artifact-name provenance drift", () => {
  const cases = [
    (value) => { value.repository = "attacker/example"; },
    (value) => { value.ref = "refs/heads/other"; },
    (value) => { value.workflowSha = "0".repeat(40); },
    (value) => { value.runId = "0"; },
    (value) => { value.runAttempt = 0; },
    (value) => { value.job = "other-job"; },
    (value) => { value.protectedEnvironment = "unprotected"; },
    (value) => { value.runnerEnvironment.runnerOs = "macOS"; },
    (value) => { value.runnerEnvironment.cgroupFilesystem = "tmpfs"; },
    (value) => { value.runnerEnvironment.dockerServerVersion = "unknown"; },
    (value) => { value.artifacts.evidenceName = "other-artifact"; },
  ];
  for (const mutate of cases) {
    const fixture = buildFixture();
    mutate(fixture.input.evidence.githubProvenance);
    assert.throws(
      () => verifyContainerMemoryPeakEvidenceDocuments(fixture.input, fixture.options),
      /github|provenance|workflow|run|artifact|environment/i,
    );
  }
});

test("rejects an arbitrary branch even when every branch-controlled provenance field is self-consistent", () => {
  const fixture = buildFixture();
  const provenance = fixture.input.evidence.githubProvenance;
  provenance.ref = "refs/heads/attacker/self-consistent";
  provenance.workflowRef = `HUDongpin/j-3dENA/.github/workflows/container-memory-peak-calibration.yml@${provenance.ref}`;
  provenance.refProtected = true;
  assert.throws(
    () => verifyContainerMemoryPeakEvidenceDocuments(fixture.input, fixture.options),
    /refs\/heads\/main|protected main|ref/i,
  );
});

test("requires frozen numeric GitHub repository identities and an explicitly protected main ref", () => {
  const mutations = [
    ["repositoryId", "999"],
    ["repositoryOwnerId", "999"],
    ["refProtected", false],
  ];
  for (const [field, value] of mutations) {
    const fixture = buildFixture();
    fixture.input.evidence.githubProvenance[field] = value;
    assert.throws(
      () => verifyContainerMemoryPeakEvidenceDocuments(fixture.input, fixture.options),
      /repository|owner|protected|main|GitHub provenance/i,
      field,
    );
  }
});

test("verifies three raw container runs as a non-formal synthetic candidate", () => {
  const fixture = buildFixture();
  const receipt = verifyContainerMemoryPeakEvidenceDocuments(
    fixture.input,
    fixture.options,
  );
  assert.equal(receipt.schemaVersion, "3dena.container-memory-peak-test-verification.v1");
  assert.equal(receipt.status, "test-only-consistency-pass");
  assert.equal(receipt.runCount, 3);
  assert.equal(receipt.maximumContainerMemoryPeakBytes, 240_000_000);
  assert.equal(receipt.maximumContainerMemoryPeakFraction, 240_000_000 / MEMORY_LIMIT);
  assert.equal(receipt.formalLinuxContainerSizingApproved, false);
  assert.equal(receipt.formalContainerMemoryPeakCapacityApproved, false);
  assert.equal(receipt.testOnlyCandidateSatisfiedFrozenPolicy, true);
  assert.equal(receipt.realFlyMultiMachineApproved, false);
  assert.equal(receipt.realFlyMultiMachineStatus, "NOT_RUN");
  assert.equal(receipt.auxiliaryHostPreflight.contributesToFormalApproval, false);
  assert.equal(receipt.tooling.toolingCommit, TOOLING_COMMIT);
  assert.equal(receipt.tooling.imageSourceCommit, IMAGE_SOURCE_COMMIT);
});

test("uses the host-side cgroup observer as measurement authority instead of the image payload self-report", () => {
  const fixture = buildFixture();
  const receipt = verifyContainerMemoryPeakEvidenceDocuments(fixture.input, fixture.options);
  assert.equal(receipt.runs[0].measurementAuthority, "host-side-cgroup-v2-observer");
  assert.equal(receipt.runs[0].containerSelfReportedMemoryPeakBytes, 220_000_000);
  assert.equal(receipt.runs[0].hostObservedContainerMemoryPeakBytes, 220_000_000);
  assert.equal(receipt.runs[0].containerMemoryPeakBytes, 220_000_000);
  assert.equal(receipt.measurement.source, "host-side-observer-of-target-cgroup-v2-memory.peak");
});

test("pin manifest externally binds reviewed workflow, verifier, observer, runner, node, tini, and exact image Env", () => {
  const fixture = buildFixture();
  const pin = JSON.parse(fixture.input.pinManifestBytes.toString("utf8"));
  for (const field of [
    "workflowSha256", "verifierSha256", "hostObserverSha256", "runnerSha256",
  ]) {
    assert.match(pin.tooling[field], /^[a-f0-9]{64}$/u, field);
  }
  assert.equal(pin.runtime.nodePath, "/usr/local/bin/node");
  assert.match(pin.runtime.nodeSha256, /^[a-f0-9]{64}$/u);
  assert.equal(pin.runtime.tiniPath, "/sbin/tini");
  assert.match(pin.runtime.tiniSha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(pin.runtime.configEnv, IMAGE_CONFIG_ENV);
});

test("rejects unknown evidence keys and wrong schema versions", () => {
  const fixture = buildFixture();
  fixture.input.evidence.unknown = true;
  assert.throws(
    () => verifyContainerMemoryPeakEvidenceDocuments(fixture.input, fixture.options),
    /unknown|exact keys/i,
  );
  delete fixture.input.evidence.unknown;
  fixture.input.evidence.schemaVersion = "3dena.container-memory-peak-evidence.v0";
  assert.throws(
    () => verifyContainerMemoryPeakEvidenceDocuments(fixture.input, fixture.options),
    /schema/i,
  );
});

test("rejects pin-manifest, scan, inspect, runner, request, and host hash tampering", () => {
  for (const field of [
    "pinManifestBytes",
    "scanReceiptBytes",
    "dockerInspectBytes",
    "runnerBytes",
    "requestBytes",
    "auxiliaryHostRedactedReceiptBytes",
  ]) {
    const fixture = buildFixture();
    fixture.input[field] = Buffer.concat([fixture.input[field], Buffer.from(" ")]);
    assert.throws(
      () => verifyContainerMemoryPeakEvidenceDocuments(fixture.input, fixture.options),
      /hash|byte|pin manifest/i,
      field,
    );
  }
});

test("rejects wrong digest, source, worker, request, and result identities", () => {
  const cases = [
    ["imageDigest", `sha256:${"0".repeat(64)}`],
    ["imageSourceCommit", "0".repeat(40)],
    ["flyBuildId", "wrong-build-id"],
    ["sdkVersion", "0.2.0-wrong"],
    ["scientificWorkerSha256", "0".repeat(64)],
    ["runtimeBundleSha256", "0".repeat(64)],
    ["buildManifestSha256", "0".repeat(64)],
    ["exactImageScanReceiptSha256", "0".repeat(64)],
    ["dockerInspectSha256", "0".repeat(64)],
    ["toolingCommit", "0".repeat(40)],
    ["runnerSha256", "0".repeat(64)],
    ["requestArtifactSha256", "0".repeat(64)],
    ["requestHash", "0".repeat(64)],
    ["expectedResultHash", "0".repeat(64)],
  ];
  for (const [field, value] of cases) {
    const fixture = buildFixture();
    replaceRunJson(fixture, 0, "rawRun", (raw) => {
      raw.identity[field] = value;
      if (field === "requestHash") raw.execution.requestHash = value;
      if (field === "expectedResultHash") raw.execution.resultHash = value;
    });
    assert.throws(
      () => verifyContainerMemoryPeakEvidenceDocuments(fixture.input, fixture.options),
      new RegExp(field, "i"),
      field,
    );
  }
});

test("rejects calibration-envelope extrapolation and timestamp or duration drift", () => {
  const envelope = buildFixture();
  envelope.input.evidence.approvedCalibrationEnvelope.sourceRows = 241;
  assert.throws(
    () => verifyContainerMemoryPeakEvidenceDocuments(envelope.input, envelope.options),
    /envelope|calibration|workload/i,
  );

  const extrapolation = buildFixture();
  replaceRunJson(extrapolation, 0, "rawRun", (raw) => {
    raw.workload.extrapolationPermitted = true;
  });
  assert.throws(
    () => verifyContainerMemoryPeakEvidenceDocuments(extrapolation.input, extrapolation.options),
    /workload|calibration|frozen/i,
  );

  const duration = buildFixture();
  replaceRunJson(duration, 0, "rawRun", (raw) => {
    raw.execution.durationMilliseconds += 1;
  });
  assert.throws(
    () => verifyContainerMemoryPeakEvidenceDocuments(duration.input, duration.options),
    /duration|timestamp/i,
  );

  const stderr = buildFixture();
  stderr.input.runs[0].stderrBytes = Buffer.from("unexpected runner warning\n", "utf8");
  stderr.input.evidence.runs[0].stderr = descriptor(
    stderr.input.evidence.runs[0].stderr.path,
    stderr.input.runs[0].stderrBytes,
  );
  assert.throws(
    () => verifyContainerMemoryPeakEvidenceDocuments(stderr.input, stderr.options),
    /stderr|empty/i,
  );
});

test("rejects darwin, arm64, cgroup v1, wrong user, and wrong cgroup limits", () => {
  const cases = [
    ["environment", "platform", "darwin"],
    ["environment", "architecture", "arm64"],
    ["environment", "cgroupVersion", 1],
    ["environment", "runtimeUser", "0:0"],
    ["cgroup", "memoryMaxBytes", MEMORY_LIMIT - 1],
    ["cgroup", "memorySwapMaxBytes", 1],
    ["cgroup", "cpuCount", 2],
    ["cgroup", "pidsMax", 63],
  ];
  for (const [section, field, value] of cases) {
    const fixture = buildFixture();
    replaceRunJson(fixture, 0, "rawRun", (raw) => {
      raw[section][field] = value;
    });
    assert.throws(
      () => verifyContainerMemoryPeakEvidenceDocuments(fixture.input, fixture.options),
      new RegExp(field, "i"),
      `${section}.${field}`,
    );
  }
});

test("rejects runtime inspect security, capacity, network, and tmpfs drift", () => {
  const cases = [
    ["ReadonlyRootfs", false],
    ["Memory", MEMORY_LIMIT - 1],
    ["MemorySwap", MEMORY_LIMIT * 2],
    ["MemorySwappiness", 1],
    ["NanoCpus", 2_000_000_000],
    ["PidsLimit", 63],
    ["NetworkMode", "bridge"],
    ["CapDrop", []],
    ["SecurityOpt", []],
    ["Tmpfs", { "/tmp": "rw" }],
  ];
  for (const [field, value] of cases) {
    const fixture = buildFixture();
    replaceRunJson(fixture, 0, "runtimeInspect", (inspect) => {
      inspect[0].HostConfig[field] = value;
    });
    assert.throws(
      () => verifyContainerMemoryPeakEvidenceDocuments(fixture.input, fixture.options),
      /runtime inspect|security|policy|network|tmpfs|memory|cpu|pids/i,
      field,
    );
  }
});

test("rejects a writable run mount nested inside the immutable calibration input root", () => {
  const fixture = buildFixture();
  replaceRunJson(fixture, 0, "runtimeInspect", (inspect) => {
    const inputSource = inspect[0].HostConfig.Mounts[0].Source;
    const nestedOutput = `${inputSource}/runs/run-1`;
    inspect[0].HostConfig.Mounts[1].Source = nestedOutput;
    inspect[0].Mounts[1].Source = nestedOutput;
  });
  assert.throws(
    () => verifyContainerMemoryPeakEvidenceDocuments(fixture.input, fixture.options),
    /runtime inspect|mount|isolation/i,
  );
});

test("rejects privileged runtime, docker socket mounts, added capabilities, devices, namespaces, and command drift", () => {
  const mutations = [
    ["Privileged", (inspect) => { inspect[0].HostConfig.Privileged = true; }],
    ["docker socket bind", (inspect) => { inspect[0].HostConfig.Binds = ["/var/run/docker.sock:/var/run/docker.sock"]; }],
    ["CapAdd", (inspect) => { inspect[0].HostConfig.CapAdd = ["SYS_ADMIN"]; }],
    ["Devices", (inspect) => { inspect[0].HostConfig.Devices = [{ PathOnHost: "/dev/kvm", PathInContainer: "/dev/kvm", CgroupPermissions: "rwm" }]; }],
    ["PidMode", (inspect) => { inspect[0].HostConfig.PidMode = "host"; }],
    ["IpcMode", (inspect) => { inspect[0].HostConfig.IpcMode = "host"; }],
    ["UsernsMode", (inspect) => { inspect[0].HostConfig.UsernsMode = "host"; }],
    ["Entrypoint", (inspect) => { inspect[0].Config.Entrypoint = ["/bin/sh"]; }],
    ["Cmd", (inspect) => { inspect[0].Config.Cmd = ["-c", "true"]; }],
    ["extra mount", (inspect) => { inspect[0].Mounts.push({ Type: "bind", Source: "/var/run/docker.sock", Destination: "/var/run/docker.sock", Mode: "", RW: true, Propagation: "rprivate" }); }],
  ];
  for (const [label, mutate] of mutations) {
    const fixture = buildFixture();
    replaceRunJson(fixture, 0, "runtimeInspect", mutate);
    assert.throws(
      () => verifyContainerMemoryPeakEvidenceDocuments(fixture.input, fixture.options),
      /runtime|privileged|bind|mount|cap|device|namespace|entrypoint|command|cmd/i,
      label,
    );
  }
});

test("rejects hostile runtime Env injection, preload hooks, NODE_PATH, and PATH drift", () => {
  const hostileEntries = [
    "NODE_OPTIONS=--require=/tmp/preload.cjs",
    "NODE_PATH=/tmp/attacker-modules",
    "LD_PRELOAD=/tmp/attacker.so",
    "PATH=/tmp/attacker:/usr/local/bin:/usr/bin:/bin",
  ];
  for (const entry of hostileEntries) {
    const fixture = buildFixture();
    replaceRunJson(fixture, 0, "runtimeInspect", (inspect) => {
      inspect[0].Config.Env = [...inspect[0].Config.Env, entry];
    });
    assert.throws(
      () => verifyContainerMemoryPeakEvidenceDocuments(fixture.input, fixture.options),
      /Config\.Env|NODE_OPTIONS|NODE_PATH|LD_PRELOAD|PATH|environment allowlist/i,
      entry,
    );
  }
});

test("accepts Docker's inert none-network record but rejects any assigned address", () => {
  const fixture = buildFixture();
  for (let index = 0; index < 3; index += 1) {
    replaceRunJson(fixture, index, "runtimeInspect", (inspect) => {
      inspect[0].NetworkSettings.Networks = {
        none: {
          Gateway: "",
          IPAddress: "",
          GlobalIPv6Address: "",
          IPv6Gateway: "",
          MacAddress: "",
        },
      };
    });
  }
  assert.equal(
    verifyContainerMemoryPeakEvidenceDocuments(fixture.input, fixture.options).status,
    "test-only-consistency-pass",
  );

  replaceRunJson(fixture, 0, "runtimeInspect", (inspect) => {
    inspect[0].NetworkSettings.Networks.none.IPAddress = "172.17.0.2";
  });
  assert.throws(
    () => verifyContainerMemoryPeakEvidenceDocuments(fixture.input, fixture.options),
    /network|address|disabled/i,
  );
});

test("rejects two runs and duplicate container IDs", () => {
  const fixture = buildFixture();
  fixture.input.evidence.runs.pop();
  fixture.input.runs.pop();
  fixture.input.evidence.aggregate.runCount = 2;
  assert.throws(
    () => verifyContainerMemoryPeakEvidenceDocuments(fixture.input, fixture.options),
    /three|3|run count/i,
  );

  const duplicate = buildFixture();
  const first = JSON.parse(duplicate.input.runs[0].rawRunBytes.toString("utf8"));
  const firstInspect = JSON.parse(duplicate.input.runs[0].runtimeInspectBytes.toString("utf8"));
  replaceRunJson(duplicate, 1, "rawRun", (raw) => {
    raw.environment.containerId = first.environment.containerId;
  });
  replaceRunJson(duplicate, 1, "runtimeInspect", (inspect) => {
    inspect[0].Id = firstInspect[0].Id;
  });
  assert.throws(
    () => verifyContainerMemoryPeakEvidenceDocuments(duplicate.input, duplicate.options),
    /unique|duplicate|container/i,
  );
});

test("rejects nonzero exits, signals, failed publication, logs, and marker leaks", () => {
  const mutations = [
    ["childExitCode", 1],
    ["childSignal", "SIGKILL"],
    ["publicationAckSendCompleted", false],
    ["artifactAckSendCompleted", false],
    ["workerExitedSuccessfullyAfterAckSends", false],
    ["scientificChildrenStarted", 2],
    ["maximumConcurrentScientificChildren", 2],
  ];
  for (const [field, value] of mutations) {
    const fixture = buildFixture();
    replaceRunJson(fixture, 0, "rawRun", (raw) => {
      raw.execution[field] = value;
    });
    assert.throws(
      () => verifyContainerMemoryPeakEvidenceDocuments(fixture.input, fixture.options),
      /execution|child|publication|artifact|signal|exit/i,
      field,
    );
  }

  const leaked = buildFixture();
  leaked.input.runs[0].childStderrBytes = Buffer.from(`${LEAK_MARKER}\n`);
  leaked.input.evidence.runs[0].childStderr = descriptor(
    leaked.input.evidence.runs[0].childStderr.path,
    leaked.input.runs[0].childStderrBytes,
  );
  replaceRunJson(leaked, 0, "rawRun", (raw) => {
    raw.logs.childStderrSha256 = sha256(leaked.input.runs[0].childStderrBytes);
    raw.logs.childStderrByteLength = leaked.input.runs[0].childStderrBytes.byteLength;
    raw.logs.markerLeakCount = 1;
  });
  assert.throws(
    () => verifyContainerMemoryPeakEvidenceDocuments(leaked.input, leaked.options),
    /leak|stderr|marker/i,
  );
});

test("rejects peak fractions above threshold and self-reported aggregate drift", () => {
  const over = buildFixture();
  replaceRunJson(over, 0, "rawRun", (raw) => {
    raw.cgroup.memoryPeakBytes = MEMORY_LIMIT / 2 + 1;
  });
  over.input.evidence.aggregate.maximumContainerMemoryPeakBytes = MEMORY_LIMIT / 2 + 1;
  over.input.evidence.aggregate.maximumContainerMemoryPeakFraction = (MEMORY_LIMIT / 2 + 1) / MEMORY_LIMIT;
  assert.throws(
    () => verifyContainerMemoryPeakEvidenceDocuments(over.input, over.options),
    /threshold|fraction|peak/i,
  );

  const drift = buildFixture();
  drift.input.evidence.aggregate.maximumContainerMemoryPeakBytes += 1;
  assert.throws(
    () => verifyContainerMemoryPeakEvidenceDocuments(drift.input, drift.options),
    /aggregate|maximum|peak/i,
  );
});

test("rejects artifact tampering and independently recomputes the result hash", () => {
  const tampered = buildFixture();
  tampered.input.runs[0].artifactBytes = Buffer.concat([
    tampered.input.runs[0].artifactBytes,
    Buffer.from(" "),
  ]);
  assert.throws(
    () => verifyContainerMemoryPeakEvidenceDocuments(tampered.input, tampered.options),
    /artifact.*hash|byte/i,
  );

  const rehashed = buildFixture();
  replaceRunJson(rehashed, 0, "artifact", (artifact) => {
    artifact.bundle.paths.push({ synthetic: true });
  });
  const artifactBytes = rehashed.input.runs[0].artifactBytes;
  replaceRunJson(rehashed, 0, "rawRun", (raw) => {
    raw.execution.artifactSha256 = sha256(artifactBytes);
    raw.execution.artifactByteLength = artifactBytes.byteLength;
  });
  assert.throws(
    () => verifyContainerMemoryPeakEvidenceDocuments(rehashed.input, rehashed.options),
    /result hash|scientific/i,
  );
});

test("rejects an artifact owner that is not bound to the scientific bundle", () => {
  const fixture = buildFixture();
  replaceRunJson(fixture, 0, "artifact", (artifact) => {
    artifact.owner.datasetHash = "f".repeat(64);
  });
  const artifactBytes = fixture.input.runs[0].artifactBytes;
  replaceRunJson(fixture, 0, "rawRun", (raw) => {
    raw.execution.artifactSha256 = sha256(artifactBytes);
    raw.execution.artifactByteLength = artifactBytes.byteLength;
  });
  assert.throws(
    () => verifyContainerMemoryPeakEvidenceDocuments(fixture.input, fixture.options),
    /artifact.*owner|owner.*dataset|dataset.*owner/i,
  );
});

test("does not allow host preflight status to substitute for formal container evidence", () => {
  const fixture = buildFixture();
  const host = JSON.parse(fixture.input.auxiliaryHostRedactedReceiptBytes.toString("utf8"));
  host.claims.contributesToFormalApproval = true;
  host.claims.formalContainerMemoryPeakCapacityApproved = true;
  fixture.input.auxiliaryHostRedactedReceiptBytes = jsonBytes(host);
  const hostDescriptor = descriptor(
    fixture.input.evidence.externalEvidence.auxiliaryHostPreflight.path,
    fixture.input.auxiliaryHostRedactedReceiptBytes,
  );
  Object.assign(fixture.input.evidence.externalEvidence.auxiliaryHostPreflight, hostDescriptor);
  fixture.options.frozenPins.auxiliaryHostRedactedReceiptSha256 = hostDescriptor.sha256;
  const pin = JSON.parse(fixture.input.pinManifestBytes.toString("utf8"));
  pin.priorEvidence.auxiliaryHostRedactedReceiptSha256 = hostDescriptor.sha256;
  fixture.input.pinManifestBytes = jsonBytes(pin);
  fixture.input.evidence.pinManifest = descriptor("pin-manifest.json", fixture.input.pinManifestBytes);
  fixture.options.expectedPinManifestSha256 = sha256(fixture.input.pinManifestBytes);
  for (let index = 0; index < 3; index += 1) {
    replaceRunJson(fixture, index, "rawRun", (raw) => {
      raw.auxiliaryHostPreflight.redactedReceiptSha256 = hostDescriptor.sha256;
    });
  }
  assert.throws(
    () => verifyContainerMemoryPeakEvidenceDocuments(fixture.input, fixture.options),
    /host.*(?:formal|informational)|contributes/i,
  );
});

test("rejects a real Fly multi-machine approval claim", () => {
  const fixture = buildFixture();
  fixture.input.evidence.claims.realFlyMultiMachineApproved = true;
  assert.throws(
    () => verifyContainerMemoryPeakEvidenceDocuments(fixture.input, fixture.options),
    /real fly|multi-machine|not_run/i,
  );
});

function writeFixtureDirectory(fixture) {
  const root = mkdtempSync(join(tmpdir(), "3dena-container-memory-peak-"));
  function write(relativePath, bytes) {
    const path = join(root, relativePath);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, bytes);
  }
  write("evidence.json", jsonBytes(fixture.input.evidence));
  write(fixture.input.evidence.pinManifest.path, fixture.input.pinManifestBytes);
  write(
    fixture.input.evidence.externalEvidence.exactImageScanReceipt.path,
    fixture.input.scanReceiptBytes,
  );
  write(
    fixture.input.evidence.externalEvidence.dockerInspect.path,
    fixture.input.dockerInspectBytes,
  );
  write(
    fixture.input.evidence.externalEvidence.auxiliaryHostPreflight.path,
    fixture.input.auxiliaryHostRedactedReceiptBytes,
  );
  write(fixture.input.evidence.tooling.workflow.path, fixture.input.workflowBytes);
  write(fixture.input.evidence.tooling.verifier.path, fixture.input.verifierBytes);
  write(fixture.input.evidence.tooling.hostObserver.path, fixture.input.hostObserverBytes);
  write(fixture.input.evidence.tooling.runner.path, fixture.input.runnerBytes);
  write(fixture.input.evidence.tooling.request.path, fixture.input.requestBytes);
  for (let index = 0; index < 3; index += 1) {
    const declared = fixture.input.evidence.runs[index];
    const files = fixture.input.runs[index];
    write(declared.rawRun.path, files.rawRunBytes);
    write(declared.runtimeInspect.path, files.runtimeInspectBytes);
    write(declared.hostObservation.path, files.hostObservationBytes);
    write(declared.artifact.path, files.artifactBytes);
    write(declared.stdout.path, files.stdoutBytes);
    write(declared.stderr.path, files.stderrBytes);
    write(declared.childStdout.path, files.childStdoutBytes);
    write(declared.childStderr.path, files.childStderrBytes);
  }
  return root;
}

function verifyDirectory(root, fixture, { canonicalizeRoot = true, ...testOptions } = {}) {
  return verifyContainerMemoryPeakEvidenceDirectory({
    evidenceRoot: canonicalizeRoot ? realpathSync(root) : root,
    manifestPath: "evidence.json",
    pinManifestPath: "pin-manifest.json",
    expectedPinManifestSha256: fixture.options.expectedPinManifestSha256,
    expectedToolingCommit: fixture.options.expectedToolingCommit,
    outputPath: "verification.json",
    frozenPins: fixture.options.frozenPins,
    ...testOptions,
  });
}

test("formal directory verification rejects caller-supplied frozen pin overrides", () => {
  const fixture = buildFixture();
  const missingRoot = join(tmpdir(), `3dena-missing-${process.pid}-${Date.now()}`);
  assert.equal(existsSync(missingRoot), false);
  assert.throws(
    () => verifyFormalContainerMemoryPeakEvidenceDirectory({
      evidenceRoot: missingRoot,
      manifestPath: "evidence.json",
      pinManifestPath: "pin-manifest.json",
      expectedPinManifestSha256: fixture.options.expectedPinManifestSha256,
      expectedToolingCommit: fixture.options.expectedToolingCommit,
      outputPath: "verification.json",
      frozenPins: fixture.options.frozenPins,
    }),
    /frozenPins|unknown|formal pins/i,
  );
});

test("securely rereads the evidence tree and creates an exclusive receipt", () => {
  const fixture = buildFixture();
  const root = writeFixtureDirectory(fixture);
  try {
    const receipt = verifyDirectory(root, fixture);
    const written = JSON.parse(readFileSync(join(root, "verification.json"), "utf8"));
    assert.deepEqual(written, receipt);
    assert.equal(written.formalLinuxContainerSizingApproved, false);
    assert.equal(written.formalContainerMemoryPeakCapacityApproved, false);
    assert.equal(written.testOnlyCandidateSatisfiedFrozenPolicy, true);
    assert.equal(written.realFlyMultiMachineApproved, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects duplicate JSON keys and fatal UTF-8 evidence", () => {
  const duplicateFixture = buildFixture();
  const duplicateRoot = writeFixtureDirectory(duplicateFixture);
  try {
    const manifestPath = join(duplicateRoot, "evidence.json");
    const text = readFileSync(manifestPath, "utf8");
    writeFileSync(
      manifestPath,
      text.replace(
        '"status":"EXECUTED"',
        '"status":"EXECUTED","status":"EXECUTED"',
      ),
    );
    assert.throws(() => verifyDirectory(duplicateRoot, duplicateFixture), /duplicate|strict JSON/i);
  } finally {
    rmSync(duplicateRoot, { recursive: true, force: true });
  }

  const utf8Fixture = buildFixture();
  const utf8Root = writeFixtureDirectory(utf8Fixture);
  try {
    const stderrPath = join(utf8Root, utf8Fixture.input.evidence.runs[0].stderr.path);
    writeFileSync(stderrPath, Buffer.from([0xff]));
    assert.throws(() => verifyDirectory(utf8Root, utf8Fixture), /UTF-8|hash|byte/i);
  } finally {
    rmSync(utf8Root, { recursive: true, force: true });
  }
});

test("rejects path escape, symlink, and non-regular-file evidence", () => {
  const escapeFixture = buildFixture();
  escapeFixture.input.evidence.runs[0].artifact.path = "../outside.json";
  const escapeRoot = writeFixtureDirectory(buildFixture());
  try {
    writeFileSync(join(escapeRoot, "evidence.json"), jsonBytes(escapeFixture.input.evidence));
    assert.throws(() => verifyDirectory(escapeRoot, escapeFixture), /contained|relative|outside|path/i);
  } finally {
    rmSync(escapeRoot, { recursive: true, force: true });
  }

  const symlinkFixture = buildFixture();
  const symlinkRoot = writeFixtureDirectory(symlinkFixture);
  try {
    const artifactPath = join(symlinkRoot, symlinkFixture.input.evidence.runs[0].artifact.path);
    const targetPath = join(symlinkRoot, "actual-artifact.json");
    writeFileSync(targetPath, symlinkFixture.input.runs[0].artifactBytes);
    rmSync(artifactPath);
    symlinkSync(targetPath, artifactPath);
    assert.throws(() => verifyDirectory(symlinkRoot, symlinkFixture), /symbolic|symlink/i);
  } finally {
    rmSync(symlinkRoot, { recursive: true, force: true });
  }

  const regularFixture = buildFixture();
  const regularRoot = writeFixtureDirectory(regularFixture);
  try {
    const artifactPath = join(regularRoot, regularFixture.input.evidence.runs[0].artifact.path);
    rmSync(artifactPath);
    mkdirSync(artifactPath);
    assert.throws(() => verifyDirectory(regularRoot, regularFixture), /regular file/i);
  } finally {
    rmSync(regularRoot, { recursive: true, force: true });
  }

  const parentSymlinkFixture = buildFixture();
  const originalRoot = writeFixtureDirectory(parentSymlinkFixture);
  const parent = mkdtempSync(join(tmpdir(), "3dena-container-memory-peak-parent-"));
  try {
    const realParent = join(parent, "real-parent");
    const realRoot = join(realParent, "evidence");
    mkdirSync(realParent);
    renameSync(originalRoot, realRoot);
    const aliasParent = join(parent, "alias-parent");
    symlinkSync(realParent, aliasParent, "dir");
    assert.throws(
      () => verifyDirectory(
        join(aliasParent, "evidence"),
        parentSymlinkFixture,
        { canonicalizeRoot: false },
      ),
      /evidence root|symbolic|symlink/i,
    );
  } finally {
    rmSync(originalRoot, { recursive: true, force: true });
    rmSync(parent, { recursive: true, force: true });
  }
});

test("rejects an undeclared file in the evidence artifact root", () => {
  const fixture = buildFixture();
  const root = writeFixtureDirectory(fixture);
  try {
    writeFileSync(join(root, "undeclared-debug.log"), "not custodied\n");
    assert.throws(
      () => verifyDirectory(root, fixture),
      /undeclared|closed set|allowlist|extra file/i,
    );
    assert.equal(existsSync(join(root, "verification.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects undeclared directories, symbolic links, and hard links in the closed evidence root", () => {
  for (const kind of ["directory", "symlink", "hardlink"]) {
    const fixture = buildFixture();
    const root = writeFixtureDirectory(fixture);
    const outside = mkdtempSync(join(tmpdir(), "3dena-container-memory-peak-outside-"));
    try {
      if (kind === "directory") {
        mkdirSync(join(root, "undeclared-directory"));
      } else if (kind === "symlink") {
        writeFileSync(join(outside, "target.txt"), "outside\n");
        symlinkSync(join(outside, "target.txt"), join(root, "undeclared-link"));
      } else {
        writeFileSync(join(outside, "target.txt"), "outside\n");
        linkSync(join(outside, "target.txt"), join(root, "undeclared-hardlink"));
      }
      assert.throws(
        () => verifyDirectory(root, fixture),
        /undeclared|closed set|symbolic|hard.?link/i,
        kind,
      );
      assert.equal(existsSync(join(root, "verification.json")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  }
});

test("enforces a cumulative byte budget across the complete evidence tree", () => {
  const fixture = buildFixture();
  const root = writeFixtureDirectory(fixture);
  try {
    assert.throws(
      () => verifierModule.verifyContainerMemoryPeakTestEvidenceDirectory({
        evidenceRoot: realpathSync(root),
        manifestPath: "evidence.json",
        pinManifestPath: "pin-manifest.json",
        expectedPinManifestSha256: fixture.options.expectedPinManifestSha256,
        expectedToolingCommit: fixture.options.expectedToolingCommit,
        outputPath: "verification.json",
        frozenPins: fixture.options.frozenPins,
        testMaximumTotalBytes: 1024,
      }),
      /total.*(?:byte|evidence).*budget|cumulative.*budget/i,
    );
    assert.equal(existsSync(join(root, "verification.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects a cumulative byte-budget overflow before allocating the next evidence file", () => {
  const source = readFileSync(resolve("scripts/verify-container-memory-peak-evidence.mjs"), "utf8");
  const remainingBudgetCheck = source.indexOf("const remainingBudget = BigInt(context.maximumTotalBytes - context.totalBytes)");
  const boundedRead = source.indexOf("const bytes = readFileSync(descriptor)", remainingBudgetCheck);
  assert.ok(remainingBudgetCheck >= 0);
  assert.ok(boundedRead > remainingBudgetCheck);
});

test("refuses to overwrite an existing verification receipt", () => {
  const fixture = buildFixture();
  const root = writeFixtureDirectory(fixture);
  try {
    writeFileSync(join(root, "verification.json"), "owner evidence\n");
    assert.throws(() => verifyDirectory(root, fixture), /exist|exclusive|overwrite/i);
    assert.equal(readFileSync(join(root, "verification.json"), "utf8"), "owner evidence\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failure before the exclusive commit point leaves no final receipt", () => {
  const fixture = buildFixture();
  const root = writeFixtureDirectory(fixture);
  try {
    assert.throws(
      () => verifyDirectory(root, fixture, { testPublicationFault: "before-publish" }),
      /injected.*before-publish|publication/i,
    );
    assert.equal(existsSync(join(root, "verification.json")), false);
    assert.deepEqual(
      readFileSync(join(root, "evidence.json"), "utf8").length > 0,
      true,
    );
    assert.deepEqual(readdirSync(root).filter((name) => name.includes("verification.json.")), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports persistent prepublication cleanup failure while proving the final path absent", () => {
  const fixture = buildFixture();
  const root = writeFixtureDirectory(fixture);
  try {
    assert.throws(
      () => verifyDirectory(root, fixture, { testPublicationFault: "prepublish-temp-unlink-persistent" }),
      /HIGH PRIORITY|prepublication|cleanup|unlink/i,
    );
    assert.equal(existsSync(join(root, "verification.json")), false);
    assert.ok(readdirSync(root).some((name) => name.includes("verification.json.")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("post-publication cleanup diagnostics cannot downgrade a committed PASS", () => {
  for (const fault of ["post-publish-temp-unlink-persistent", "post-publish-directory-fsync"]) {
    const fixture = buildFixture();
    const root = writeFixtureDirectory(fixture);
    try {
      const receipt = verifyDirectory(root, fixture, { testPublicationFault: fault });
      assert.equal(receipt.status, "test-only-consistency-pass");
      assert.equal(existsSync(join(root, "verification.json")), true);
      assert.doesNotThrow(() => JSON.parse(readFileSync(join(root, "verification.json"), "utf8")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("a non-writable receipt directory cannot leave a final or temporary receipt", { skip: process.platform === "win32" }, () => {
  const fixture = buildFixture();
  const root = writeFixtureDirectory(fixture);
  try {
    chmodSync(root, 0o555);
    assert.throws(() => verifyDirectory(root, fixture), /permission|EACCES|EPERM|read-only/i);
    assert.equal(existsSync(join(root, "verification.json")), false);
  } finally {
    chmodSync(root, 0o755);
    rmSync(root, { recursive: true, force: true });
  }
});

test("runner independently reproduces the frozen scientific request hash", () => {
  const request = JSON.parse(
    readFileSync(resolve("scripts/container-memory-peak-calibration-request.json"), "utf8"),
  );
  assert.equal(hashLongitudinalCalibrationRequest(request), REQUEST_HASH);
});

test("runner reads exact cgroup v2 limits, peak, CPU, pids, and OOM counters", () => {
  const root = mkdtempSync(join(tmpdir(), "3dena-cgroup-v2-"));
  try {
    writeFileSync(join(root, "cgroup.controllers"), "cpu memory pids\n");
    writeFileSync(join(root, "memory.max"), `${MEMORY_LIMIT}\n`);
    writeFileSync(join(root, "memory.peak"), "240000000\n");
    writeFileSync(join(root, "memory.swap.max"), "0\n");
    writeFileSync(join(root, "cpu.max"), "100000 100000\n");
    writeFileSync(join(root, "pids.max"), "64\n");
    writeFileSync(join(root, "memory.events"), "low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\n");
    assert.deepEqual(readCgroupV2CalibrationSnapshot(root), {
      memoryMaxBytes: MEMORY_LIMIT,
      memoryPeakBytes: 240_000_000,
      memorySwapMaxBytes: 0,
      cpuQuotaMicroseconds: 100_000,
      cpuPeriodMicroseconds: 100_000,
      cpuCount: 1,
      pidsMax: 64,
      oomEvents: 0,
      oomKillEvents: 0,
    });
    writeFileSync(join(root, "memory.swap.max"), "max\n");
    assert.throws(() => readCgroupV2CalibrationSnapshot(root), /swap|max|finite/i);
    rmSync(join(root, "cgroup.controllers"));
    assert.throws(() => readCgroupV2CalibrationSnapshot(root), /cgroup v2|controllers/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runner records IPC acknowledgement send completion only after the child.send callback", async () => {
  let callback;
  let killed = false;
  const child = {
    connected: true,
    once() {},
    off() {},
    send(_message, candidate) {
      callback = candidate;
      return true;
    },
    kill() {
      killed = true;
    },
  };
  let settled = false;
  const pending = sendChildIpcMessageAwaited(child, { type: "ack" }, "test acknowledgement")
    .then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  callback();
  await pending;
  assert.equal(settled, true);
  assert.equal(killed, false);

  const failingChild = {
    ...child,
    send(_message, candidate) {
      candidate(new Error("callback rejected"));
      return true;
    },
  };
  await assert.rejects(
    sendChildIpcMessageAwaited(failingChild, { type: "ack" }, "test acknowledgement"),
    /callback rejected|acknowledgement/i,
  );
});

test("runner termination waits for the child close event before resolving", async () => {
  let closeHandler;
  let killedWith;
  const child = {
    once(event, handler) {
      if (event === "close") closeHandler = handler;
      else assert.equal(event, "error");
    },
    off() {},
    kill(signal) {
      killedWith = signal;
      return true;
    },
  };
  let settled = false;
  const pending = terminateChildAndAwaitClose(child, "SIGKILL").then((value) => {
    settled = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(killedWith, "SIGKILL");
  assert.equal(settled, false);
  closeHandler(137, "SIGKILL");
  assert.deepEqual(await pending, { code: 137, signal: "SIGKILL" });
});

test("runner source locks one scientific fork, in-image custody, and offline execution", () => {
  const source = readFileSync(
    resolve("scripts/run-container-memory-peak-linux-calibration.mjs"),
    "utf8",
  );
  assert.equal((source.match(/\bfork\s*\(/gu) ?? []).length, 1);
  assert.match(source, /\/app\/scientific-worker-entry\.mjs/u);
  assert.match(source, /\/app\/compute-runtime\.mjs/u);
  assert.match(source, /\/app\/build-manifest\.json/u);
  assert.match(source, /memory\.max/u);
  assert.match(source, /memory\.peak/u);
  assert.match(source, /memory\.swap\.max/u);
  assert.match(source, /O_NOFOLLOW/u);
  assert.match(source, /flag:\s*"wx",\s*mode:\s*0o444/u);
  assert.doesNotMatch(source, /mode:\s*0o600/u);
  assert.match(source, /child\.once\("close"/u);
  assert.match(source, /await sendChildIpcMessageAwaited/u);
  assert.match(source, /await protocolChain/u);
  assert.match(source, /terminateChildAndAwaitClose/u);
  assert.doesNotMatch(source, /artifactAckAccepted|publicationAckAccepted/u);
  assert.doesNotMatch(source, /node:(?:http|https|net|dns)|\bfetch\s*\(/u);
});

test("runner and verifier hash-bind absolute node, tini, runner, workflow, verifier, and observer paths", () => {
  const runner = readFileSync(resolve("scripts/run-container-memory-peak-linux-calibration.mjs"), "utf8");
  const verifier = readFileSync(resolve("scripts/verify-container-memory-peak-evidence.mjs"), "utf8");
  assert.match(runner, /process\.execPath\s*!==\s*"\/usr\/local\/bin\/node"/u);
  assert.match(runner, /\/usr\/local\/bin\/node/u);
  assert.match(runner, /\/sbin\/tini/u);
  assert.match(runner, /nodeSha256/u);
  assert.match(runner, /tiniSha256/u);
  assert.match(verifier, /workflowSha256/u);
  assert.match(verifier, /verifierSha256/u);
  assert.match(verifier, /hostObserverSha256/u);
  assert.match(verifier, /"\/usr\/local\/bin\/node"/u);
  assert.match(verifier, /"\/sbin\/tini"/u);
});

test("runner freezes the persistent service hard deadline at exactly 60 seconds", () => {
  const source = readFileSync(
    resolve("scripts/run-container-memory-peak-linux-calibration.mjs"),
    "utf8",
  );
  assert.match(source, /SCIENTIFIC_HARD_DEADLINE_MS\s*=\s*60_000/u);
  assert.match(source, /deadlineAtMs\s*=\s*Date\.now\(\)\s*\+\s*SCIENTIFIC_HARD_DEADLINE_MS/u);
  assert.match(source, /setTimeout\([\s\S]*SCIENTIFIC_HARD_DEADLINE_MS/u);
  assert.doesNotMatch(source, /10\s*\*\s*60_000|ten-minute/iu);
});

test("synthetic scientific fixture exercises non-empty path, inference, bootstrap, and geometry structures", () => {
  const fixture = buildFixture();
  const artifact = JSON.parse(fixture.input.runs[0].artifactBytes.toString("utf8"));
  assert.ok(artifact.bundle.paths.length > 0);
  assert.ok(artifact.bundle.inference.length > 0);
  assert.ok(artifact.bundle.bootstrap.length > 0);
  assert.ok(artifact.bundle.codeGeometry.nodes.length > 0);
  assert.ok(artifact.bundle.networkOverlays.length > 0);
  assert.ok(artifact.bundle.execution.permutationPlanHashes.length > 0);
  assert.ok(artifact.bundle.execution.resamplingPlanHashes.length > 0);
});

test("host observer independently reads a target cgroup v2 memory.peak without emitting host PID or path", async () => {
  const observer = await import("./observe-container-memory-peak-linux.mjs");
  assert.equal(typeof observer.observeTargetContainerCgroupV2, "function");
  const root = mkdtempSync(join(tmpdir(), "3dena-host-cgroup-observer-"));
  try {
    const procRoot = join(root, "proc");
    const cgroupRoot = join(root, "sys/fs/cgroup");
    const target = join(cgroupRoot, "system.slice/docker-test.scope");
    mkdirSync(join(procRoot, "4321"), { recursive: true });
    mkdirSync(target, { recursive: true });
    writeFileSync(join(procRoot, "4321/cgroup"), "0::/system.slice/docker-test.scope\n");
    writeFileSync(join(cgroupRoot, "cgroup.controllers"), "cpu memory pids\n");
    writeFileSync(join(target, "memory.max"), `${MEMORY_LIMIT}\n`);
    writeFileSync(join(target, "memory.swap.max"), "0\n");
    writeFileSync(join(target, "memory.peak"), "240000000\n");
    writeFileSync(join(target, "cgroup.events"), "populated 0\nfrozen 0\n");
    const receipt = await observer.observeTargetContainerCgroupV2({
      runIndex: 1,
      containerId: "a".repeat(64),
      targetPid: 4321,
      toolingCommit: TOOLING_COMMIT,
      procRoot,
      cgroupRoot,
      pollIntervalMilliseconds: 1,
      timeoutMilliseconds: 100,
      observerSha256: "b".repeat(64),
      now: (() => {
        let value = Date.parse("2026-08-27T01:00:00.000Z");
        return () => (value += 1);
      })(),
    });
    assert.equal(receipt.measurement.maximumMemoryPeakBytes, 240_000_000);
    assert.equal(receipt.measurement.memoryMaxBytes, MEMORY_LIMIT);
    assert.equal(receipt.measurement.memorySwapMaxBytes, 0);
    assert.equal(receipt.measurement.source, "host-side-cgroup-v2");
    assert.equal(receipt.claims.independentFromContainerPayload, true);
    const serialized = JSON.stringify(receipt);
    assert.doesNotMatch(serialized, /4321|system\.slice|\/proc\/|\/sys\/fs\/cgroup/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workflow runs three fresh exact-image containers with the frozen isolation flags", () => {
  const workflow = readFileSync(
    resolve(".github/workflows/container-memory-peak-calibration.yml"),
    "utf8",
  );
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /runs-on:\s*ubuntu-latest/u);
  assert.match(workflow, /exact-v12-container-memory-peak-producer:/u);
  assert.match(workflow, /exact-v12-container-memory-peak-verifier:/u);
  assert.match(workflow, /environment:\s*container-memory-peak-calibration/u);
  assert.match(workflow, /4257374102d32b5b21d59fe3030b1fab339c65b7c55070d396d1b78b099b5881/u);
  assert.match(workflow, /fb5c89322ea32b88fcde456b0338e659aa590272/u);
  assert.match(workflow, /53b828f7dbb0608087bfeaa7347190faebdd7115e507db6cf5ed3be2165340fc/u);
  assert.match(workflow, /75ea98fa5b3aa1898222dcdd61b4049bbd375fcbb59f4c51c3ec5225aea9d03a/u);
  assert.match(workflow, /FLY_API_TOKEN:\s*\$\{\{ secrets\.FLY_API_TOKEN \}\}/u);
  assert.match(workflow, /DOCKER_CONFIG=.*mktemp|docker_config=.*mktemp/u);
  assert.match(workflow, /docker login[^\n]*--password-stdin|--password-stdin/u);
  assert.match(workflow, /docker logout/u);
  assert.match(workflow, /trap[^\n]*(?:cleanup|docker)/u);
  assert.doesNotMatch(workflow, /~\/\.docker|\$HOME\/\.docker/u);
  for (const flag of [
    "--network none",
    "--read-only",
    "--user 10001:10001",
    "--memory 2147483648",
    "--memory-swap 2147483648",
    "--memory-swappiness 0",
    "--cpus 1",
    "--pids-limit 64",
    "--cap-drop ALL",
    "--security-opt no-new-privileges",
    "--tmpfs /tmp:rw,nosuid,nodev,noexec",
  ]) {
    assert.ok(workflow.includes(flag), flag);
  }
  assert.match(workflow, /run_one 1/u);
  assert.match(workflow, /run_one 2/u);
  assert.match(workflow, /run_one 3/u);
  assert.match(workflow, /docker run/u);
  assert.match(workflow, /docker inspect/u);
  assert.match(workflow, /docker rm -f/u);
  assert.match(workflow, /hostObservation:\s*descriptor\(`runs\/run-\$\{runIndex\}\/host-cgroup-observation\.json`\)/u);
  assert.match(workflow, /workflowSha256:\s*process\.env\.EXPECTED_WORKFLOW_SHA256/u);
  assert.match(workflow, /verifierSha256:\s*process\.env\.EXPECTED_VERIFIER_SHA256/u);
  assert.match(workflow, /hostObserverSha256:\s*process\.env\.EXPECTED_HOST_OBSERVER_SHA256/u);
  assert.match(workflow, /scientificHardDeadlineMilliseconds:\s*60000/u);
  assert.match(workflow, /runnerEnvironment:\s*\{/u);
  assert.match(workflow, /dockerClientVersion/u);
  assert.match(workflow, /dockerServerVersion/u);
  assert.match(workflow, /cgroupFilesystem/u);
  assert.match(workflow, /verify-container-memory-peak-evidence\.mjs/u);
  assert.match(workflow, /--mode formal-github-artifact/u);
  assert.match(workflow, /artifact-id/u);
  assert.match(workflow, /artifact-digest/u);
  assert.match(workflow, /actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/u);
  assert.match(workflow, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/u);
  assert.match(workflow, /if-no-files-found:\s*error/u);
  assert.doesNotMatch(workflow, /if:\s*always\(\)/u);
  assert.doesNotMatch(workflow, /chmod\s+0444/u);
  assert.doesNotMatch(workflow, /\bflyctl\b|\bfly machine\b|\bMachines create\b/iu);
});

test("workflow contains the registry secret before no repository code and uploads a curated closed evidence root", () => {
  const workflow = readFileSync(resolve(".github/workflows/container-memory-peak-calibration.yml"), "utf8");
  const secretIndex = workflow.indexOf("FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}");
  const logoutIndex = workflow.indexOf("docker logout", secretIndex);
  const firstRepositoryScriptIndex = Math.min(
    ...[
      workflow.indexOf("scripts/run-container-memory-peak-linux-calibration.mjs"),
      workflow.indexOf("scripts/verify-container-memory-peak-evidence.mjs"),
      workflow.indexOf("scripts/container-memory-peak-calibration-request.json"),
    ].filter((index) => index >= 0),
  );
  assert.ok(secretIndex >= 0);
  assert.ok(logoutIndex > secretIndex);
  assert.ok(firstRepositoryScriptIndex > logoutIndex);
  assert.match(workflow, /GITHUB_SHA/u);
  assert.match(workflow, /GITHUB_WORKFLOW_SHA/u);
  assert.match(workflow, /GITHUB_RUN_ATTEMPT/u);
  assert.match(workflow, /RUNNER_TEMP[^\n]*scan|scan[^\n]*RUNNER_TEMP/iu);
  assert.doesNotMatch(workflow, /EVIDENCE_ROOT[^\n]*downloaded-scan|downloaded-scan[^\n]*EVIDENCE_ROOT/u);
  assert.match(workflow, /name:\s*exact-v12-container-memory-peak-evidence/u);
  assert.match(workflow, /path:\s*\$\{\{ env\.EVIDENCE_ROOT \}\}/u);
  assert.match(workflow, /githubArtifactAttestation|github-artifact-attestation/u);
  assert.match(workflow, /exact-v12-container-memory-peak-verification-receipt/u);
});

test("workflow refuses secret and OIDC access outside the frozen protected main repository identity", () => {
  const workflow = readFileSync(resolve(".github/workflows/container-memory-peak-calibration.yml"), "utf8");
  assert.match(workflow, /github\.ref\s*==\s*'refs\/heads\/main'/u);
  assert.match(workflow, /github\.ref_protected\s*==\s*true/u);
  assert.match(workflow, /github\.repository_id\s*==\s*'1341282948'/u);
  assert.match(workflow, /github\.repository_owner_id\s*==\s*'47708816'/u);
  assert.match(workflow, /GITHUB_REF_PROTECTED/u);
  assert.match(workflow, /GITHUB_REPOSITORY_ID/u);
  assert.match(workflow, /GITHUB_REPOSITORY_OWNER_ID/u);
  assert.match(workflow, /expected_workflow_sha256/iu);
  assert.match(workflow, /expected_verifier_sha256/iu);
  assert.match(workflow, /expected_host_observer_sha256/iu);
});

test("workflow gives each run one isolated empty output and never mounts the evidence root or prior-run output", () => {
  const workflow = readFileSync(resolve(".github/workflows/container-memory-peak-calibration.yml"), "utf8");
  const section = /- name: Run the frozen workload in exactly three fresh containers[\s\S]*?\n        run: \|\n([\s\S]*?)(?=\n      - name:)/u.exec(workflow);
  assert.ok(section);
  const script = section[1];
  assert.match(script, /INPUT_ROOT/u);
  assert.match(script, /RUN_OUTPUT_STAGE/u);
  assert.match(script, /test\s+-z\s+"\$\(find\s+"\$run_output_dir"/u);
  assert.doesNotMatch(script, /source=\$evidence_absolute,target=\/calibration/u);
  assert.doesNotMatch(script, /source=\$EVIDENCE_ROOT,target=\/calibration/u);
  assert.match(script, /source=\$input_absolute,target=\/calibration,readonly/u);
  assert.match(script, /source=\$run_output_dir,target=\/evidence/u);
  assert.match(script, /observe-container-memory-peak-linux\.mjs/u);
});

test("workflow run block behavior passes every frozen isolation flag and force-cleans all three containers", () => {
  const workflow = readFileSync(resolve(".github/workflows/container-memory-peak-calibration.yml"), "utf8");
  const section = /- name: Run the frozen workload in exactly three fresh containers[\s\S]*?\n        run: \|\n([\s\S]*?)(?=\n      - name:)/u.exec(workflow);
  assert.ok(section);
  const script = section[1].split("\n").map((line) => line.replace(/^          /u, "")).join("\n");
  const root = mkdtempSync(join(tmpdir(), "3dena-container-memory-peak-workflow-behavior-"));
  try {
    const bin = join(root, "bin");
    const evidenceRoot = join(root, "evidence");
    const inputRoot = join(root, "input");
    const outputStage = join(root, "output-stage");
    const logStage = join(root, "log-stage");
    const stateStage = join(root, "state-stage");
    const dockerLog = join(root, "docker.log");
    mkdirSync(bin);
    mkdirSync(evidenceRoot);
    mkdirSync(inputRoot);
    mkdirSync(outputStage);
    mkdirSync(logStage);
    mkdirSync(stateStage);
    const dockerPath = join(bin, "docker");
    writeFileSync(dockerPath, `#!/usr/bin/env bash
set -euo pipefail
printf '%s' "$1" >>"$DOCKER_LOG"
shift
for argument in "$@"; do printf '\t%s' "$argument" >>"$DOCKER_LOG"; done
printf '\n' >>"$DOCKER_LOG"
if [[ "$(head -n 1 "$DOCKER_LOG" | cut -f1)" = "never" ]]; then exit 99; fi
case "$(tail -n 1 "$DOCKER_LOG" | cut -f1)" in
  run)
    previous=""
    cid_file=""
    output_dir=""
    for argument in "$@"; do
      if [[ "$previous" = "--cidfile" ]]; then cid_file="$argument"; fi
      if [[ "$argument" == type=bind,source=*,target=/evidence ]]; then
        output_dir="\${argument#type=bind,source=}"
        output_dir="\${output_dir%,target=/evidence}"
      fi
      previous="$argument"
    done
    run_index="\${cid_file##*-}"
    run_index="\${run_index%.cid}"
    printf '%064d\n' "$run_index" >"$cid_file"
    printf '{}\n' >"$output_dir/raw-run.json"
    printf '{}\n' >"$output_dir/result-artifact.json"
    : >"$output_dir/child-stdout.txt"
    : >"$output_dir/child-stderr.txt"
    sleep 0.05
    ;;
  inspect)
    if [[ "\${1:-}" = "--format" ]]; then printf '12345\n'; else printf '[{}]\n'; fi
    ;;
  rm) ;;
esac
`);
    chmodSync(dockerPath, 0o755);
    const nodePath = join(bin, "node");
    writeFileSync(nodePath, `#!/usr/bin/env bash
set -euo pipefail
output=""
previous=""
for argument in "$@"; do
  if [[ "$previous" = "--output" ]]; then output="$argument"; fi
  previous="$argument"
done
test -n "$output"
printf '{}\n' >"$output"
printf '{"status":"OBSERVED"}\n'
`);
    chmodSync(nodePath, 0o755);
    const result = spawnSync("bash", ["-c", script], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        DOCKER_LOG: dockerLog,
        EVIDENCE_ROOT: evidenceRoot,
        INPUT_ROOT: inputRoot,
        RUN_OUTPUT_STAGE: outputStage,
        RUN_LOG_STAGE: logStage,
        RUN_STATE_STAGE: stateStage,
        IMAGE_REF: IMAGE_REF,
        TOOLING_COMMIT: TOOLING_COMMIT,
        EXPECTED_PIN_MANIFEST_SHA256: "0".repeat(64),
        EXPECTED_HOST_OBSERVER_SHA256: "1".repeat(64),
        GITHUB_RUN_ID: "33060000001",
        GITHUB_RUN_ATTEMPT: "1",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const calls = readFileSync(dockerLog, "utf8").trim().split("\n").map((line) => line.split("\t"));
    const runs = calls.filter(([command]) => command === "run");
    const removals = calls.filter(([command, first]) => command === "rm" && first === "-f");
    assert.equal(runs.length, 3);
    assert.equal(removals.length, 3);
    for (const [index, run] of runs.entries()) {
      const args = run.slice(1);
      for (const [flag, value] of [
        ["--network", "none"], ["--user", "10001:10001"], ["--memory", "2147483648"],
        ["--memory-swap", "2147483648"], ["--memory-swappiness", "0"], ["--cpus", "1"],
        ["--pids-limit", "64"], ["--cap-drop", "ALL"],
        ["--security-opt", "no-new-privileges"], ["--tmpfs", "/tmp:rw,nosuid,nodev,noexec"],
        ["--entrypoint", "/sbin/tini"], ["--run-index", String(index + 1)],
      ]) {
        const position = args.indexOf(flag);
        assert.ok(position >= 0, flag);
        assert.equal(args[position + 1], value, flag);
      }
      assert.ok(args.includes("--read-only"));
      assert.equal(args.filter((value) => value === "--mount").length, 2);
      assert.equal(args.filter((value) => value === "--name").length, 1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("registry step behavior confines credentials to a temporary DOCKER_CONFIG and proves cleanup", () => {
  const workflow = readFileSync(resolve(".github/workflows/container-memory-peak-calibration.yml"), "utf8");
  const section = /- name: Authenticate, pull the exact image, and erase private-registry credentials[\s\S]*?\n        run: \|\n([\s\S]*?)(?=\n      - name:)/u.exec(workflow);
  assert.ok(section);
  const script = section[1].split("\n").map((line) => line.replace(/^          /u, "")).join("\n");
  const root = mkdtempSync(join(tmpdir(), "3dena-container-memory-peak-registry-behavior-"));
  try {
    const bin = join(root, "bin");
    const runnerTemp = join(root, "runner-temp");
    const fakeHome = join(root, "home");
    const dockerLog = join(root, "docker.log");
    mkdirSync(bin);
    mkdirSync(runnerTemp);
    mkdirSync(fakeHome);
    const dockerPath = join(bin, "docker");
    writeFileSync(dockerPath, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\t%s\n' "$1" "$DOCKER_CONFIG" >>"$DOCKER_LOG"
if [[ "$1" = "login" ]]; then read -r -d '' _secret || true; fi
`);
    chmodSync(dockerPath, 0o755);
    const secret = "test-secret-must-not-appear";
    const result = spawnSync("bash", ["-c", script], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        HOME: fakeHome,
        RUNNER_TEMP: runnerTemp,
        DOCKER_LOG: dockerLog,
        FLY_API_TOKEN: secret,
        IMAGE_REF,
        IMAGE_DIGEST,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes(secret), false);
    assert.equal(result.stderr.includes(secret), false);
    assert.equal(readFileSync(dockerLog, "utf8").includes(secret), false);
    assert.equal(existsSync(join(fakeHome, ".docker/config.json")), false);
    assert.deepEqual(readdirSync(runnerTemp), []);
    const configs = readFileSync(dockerLog, "utf8").trim().split("\n").map((line) => line.split("\t")[1]);
    assert.ok(configs.length >= 4);
    assert.equal(new Set(configs).size, 1);
    assert.match(configs[0], new RegExp(`^${runnerTemp.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/container-memory-peak-docker-config\\.`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("redacted auxiliary receipt binds the private source hash and workflow status stays NOT_RUN", () => {
  const redactedPath = resolve("evidence/performance/container-memory-peak-host-preflight-v12-redacted.json");
  const redactedBytes = readFileSync(redactedPath);
  const redacted = JSON.parse(redactedBytes.toString("utf8"));
  assert.equal(redacted.sourceReceiptSha256, AUXILIARY_HOST_RECEIPT_SHA256);
  assert.equal(redacted.sourceMeasurement.platform, "darwin");
  assert.equal(redacted.sourceMeasurement.architecture, "arm64");
  assert.equal(redacted.claims.formalContainerMemoryPeakCapacityApproved, false);
  assert.doesNotMatch(redactedBytes.toString("utf8"), /\/Users\/|\/Volumes\/|childPid|"pid"/u);
  const documentation = readFileSync(
    resolve("docs/release/container-memory-peak-calibration.md"),
    "utf8",
  );
  assert.match(documentation, /NOT_RUN/u);
  assert.match(documentation, /three fresh (?:Docker|Linux) containers/iu);
  assert.match(documentation, />=2 real Fly Machines/iu);
  assert.match(documentation, /informational-only/iu);
  assert.doesNotMatch(documentation, /PRODUCTION_READY/u);
});

test("formal evidence stages only the redacted informational host preflight", () => {
  const path = resolve("evidence/performance/container-memory-peak-host-preflight-v12-redacted.json");
  const bytes = readFileSync(path);
  const receipt = JSON.parse(bytes.toString("utf8"));
  assert.equal(sha256(bytes), "ab5b95038a1c80fcd9506ac879b189d63cfec7e35820196f463e3cec59349a12");
  assert.equal(receipt.sourceReceiptSha256, AUXILIARY_HOST_RECEIPT_SHA256);
  assert.equal(receipt.claims.contributesToFormalApproval, false);
  assert.equal(receipt.redaction.absolutePathsRemoved, true);
  assert.equal(receipt.redaction.childProcessIdentifiersRemoved, true);
  assert.doesNotMatch(bytes.toString("utf8"), /\/Users\/|\/Volumes\/|childPid|"pid"/u);
  const workflow = readFileSync(resolve(".github/workflows/container-memory-peak-calibration.yml"), "utf8");
  assert.match(workflow, /container-memory-peak-host-preflight-v12-redacted\.json/u);
  assert.doesNotMatch(workflow, /install[^\n]*worker-rss-host-preflight-v12\.json/u);
});

test("formal toolchain names and evidence semantics describe whole-container cgroup memory peak, never process RSS", () => {
  const formalPaths = [
    "scripts/run-container-memory-peak-linux-calibration.mjs",
    "scripts/verify-container-memory-peak-evidence.mjs",
    "scripts/verify-container-memory-peak-evidence.test.mjs",
    "scripts/container-memory-peak-calibration-request.json",
    ".github/workflows/container-memory-peak-calibration.yml",
    "docs/release/container-memory-peak-calibration.md",
  ];
  for (const path of formalPaths) assert.equal(existsSync(resolve(path)), true, path);
  for (const path of [
    "scripts/run-worker-rss-linux-container-calibration.mjs",
    "scripts/verify-worker-rss-linux-container-evidence.mjs",
    ".github/workflows/worker-rss-container-calibration.yml",
    "docs/release/worker-rss-linux-container-calibration.md",
  ]) {
    assert.equal(existsSync(resolve(path)), false, path);
  }
  const formalText = formalPaths
    .filter((path) => !path.endsWith("request.json") && !path.endsWith(".test.mjs"))
    .map((path) => readFileSync(resolve(path), "utf8"))
    .join("\n");
  assert.match(formalText, /whole-container|entire container/iu);
  assert.match(formalText, /cgroup v2[^\n]*memory\.peak|memory\.peak[^\n]*cgroup v2/iu);
  assert.match(formalText, /not\s+the scientific child process(?:'s)? RSS/iu);
  const withoutExplicitLegacyHostFilename = formalText.replaceAll(
    "worker-rss-host-preflight-v12.json",
    "legacy-host-preflight.json",
  );
  assert.doesNotMatch(withoutExplicitLegacyHostFilename, /worker[- ]rss|peakRss/iu);
  const withoutFrozenRequestRunId = withoutExplicitLegacyHostFilename.replaceAll(
    "rss-calibration-v12",
    "legacy-frozen-request-run-id",
  );
  assert.doesNotMatch(withoutFrozenRequestRunId, /rss-calibration/iu);
  const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
  assert.equal(
    packageJson.scripts["test:container-memory-peak-evidence:unit"],
    "node --test scripts/verify-container-memory-peak-evidence.test.mjs",
  );
  assert.equal(Object.hasOwn(packageJson.scripts, "test:worker-rss-linux-container-evidence:unit"), false);
  const ciWorkflow = readFileSync(resolve(".github/workflows/ci.yml"), "utf8");
  assert.match(ciWorkflow, /npm run test:container-memory-peak-evidence:unit/u);
  const verifierSource = readFileSync(resolve("scripts/verify-container-memory-peak-evidence.mjs"), "utf8");
  assert.match(verifierSource, /request as httpsRequest/u);
  assert.match(verifierSource, /https:\/\/vstoken\.actions\.githubusercontent\.com/u);
  assert.match(verifierSource, /workflow_ref[\s\S]*workflow_sha[\s\S]*run_id[\s\S]*run_attempt/u);
  assert.match(verifierSource, /tokenSha256/u);
  assert.match(formalText, /live authenticated HTTPS exchange/iu);
});

test("GitHub custody can verify only the direct scientific fork harness, never persistent-service or Fly capacity", () => {
  const verifier = readFileSync(resolve("scripts/verify-container-memory-peak-evidence.mjs"), "utf8");
  assert.doesNotMatch(verifier, /status:\s*"formally-approved"/u);
  assert.doesNotMatch(verifier, /formalLinuxContainerSizingApproved:\s*true/u);
  assert.doesNotMatch(verifier, /formalContainerMemoryPeakCapacityApproved:\s*true/u);
  assert.match(verifier, /exactScientificForkHarnessCalibrationPassed:\s*true/u);
  assert.match(verifier, /persistentServicePathExercised:\s*false/u);
  assert.match(verifier, /apiQueueWorkerPathExercised:\s*false/u);
  assert.match(verifier, /persistentServiceCapacityApproved:\s*false/u);
  assert.match(verifier, /flyCapacityApproved:\s*false/u);
  assert.match(verifier, /not an offline(?:-verifiable)? signed attestation/iu);
});

test("persistent deployment README no longer calls one-child RSS a capacity gate", () => {
  const readme = readFileSync(resolve("packages/compute-service-persistent/deploy/README.md"), "utf8");
  assert.doesNotMatch(readme, /one child peak RSS below 50%/iu);
  assert.match(readme, /whole-container cgroup v2 memory\.peak/iu);
  assert.match(readme, /API[^\n]*queue[^\n]*worker|persistent-service[^\n]*path/iu);
  assert.match(readme, />=2 real Fly Machines/iu);
});
