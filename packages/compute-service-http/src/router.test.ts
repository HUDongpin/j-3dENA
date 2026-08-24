import { createHash } from "node:crypto";

import {
  ANALYSIS_CONTRACT_VERSION_V1,
  ANALYSIS_TASK_VERSION_V1,
  DATASET_RECEIPT_VERSION_V1,
  analyzeRows,
  createAnalysisClient,
  hashAnalysisValueV1,
  type AnalysisResult,
  type AnalysisJobReferenceV1,
  type AnalysisTaskV1,
  type DatasetReceiptV1,
  type TrajectoryRunSpecV2,
} from "@3dena/analysis";
import {
  ComputeServiceCore,
  InMemoryComputeAuditSink,
  InMemoryComputeObjectStore,
  InMemoryComputeProcessSupervisor,
  InMemoryComputeTaskRepository,
  ManualComputeClock,
  SequenceComputeIdFactory,
} from "@3dena/compute-service-core";
import { describe, expect, it, vi } from "vitest";

import {
  HmacComputeHttpCapabilityCodec,
  InMemoryComputeHttpEventBroker,
  InMemoryComputeHttpJobRepository,
  InMemoryComputeHttpObjectUrlIssuer,
  SequenceComputeHttpIdFactory,
  StaticComputeHttpReadinessProbe,
} from "./in-memory";
import { ComputeV1HttpRouter } from "./router";
import {
  LONGITUDINAL_COMPUTE_STORED_INPUT_VERSION_V2,
  LONGITUDINAL_COMPUTE_SUBMISSION_VERSION_V2,
  LONGITUDINAL_COMPUTE_TASK_KIND_V2,
  type ApprovedLongitudinalExecutionBuildV2,
  type LongitudinalComputeCapabilityV2,
  type LongitudinalComputeSubmissionV2,
  type ScientificStoredLongitudinalInputV2,
} from "./longitudinal-contracts";
import type {
  ComputeHttpDeletionLifecycleProbe,
  ComputeHttpRateLimiter,
} from "./interfaces";

const NOW = Date.UTC(2026, 7, 21, 8, 0, 0);
const ORIGIN = "https://app.example";
const SECRET = "test-only-capability-secret-with-at-least-32-bytes";
const LONGITUDINAL_SERVICE_TOKEN =
  "test-only-longitudinal-service-token-with-at-least-32-bytes";
const SPEC_HASH = "b".repeat(64);
const LONGITUDINAL_DATASET_HASH = "1".repeat(64);
const APPROVED_LONGITUDINAL_BUILD: ApprovedLongitudinalExecutionBuildV2 = {
  jenaVersion: "0.7.0-ona.0",
  jenaCommit: "2".repeat(40),
  jenaTarballIntegrity: "sha512-approved-fixture",
  sdkVersion: "0.2.0-implemented-unverified.6",
  buildId: "approved-longitudinal-build-1",
};

interface Harness {
  readonly router: ComputeV1HttpRouter;
  readonly core: ComputeServiceCore;
  readonly objectStore: InMemoryComputeObjectStore;
  readonly supervisor: InMemoryComputeProcessSupervisor;
  readonly clock: ManualComputeClock;
  readonly httpRepository: InMemoryComputeHttpJobRepository;
  readonly events: InMemoryComputeHttpEventBroker;
  readonly urls: InMemoryComputeHttpObjectUrlIssuer;
  readonly readiness: StaticComputeHttpReadinessProbe;
}

function harness(
  rateLimiter: ComputeHttpRateLimiter = {
    consume: async () => ({ allowed: true, retryAfterSeconds: 1 }),
  },
  deletionLifecycle?: ComputeHttpDeletionLifecycleProbe,
  longitudinalOptions: Readonly<{
    approvedBuild?: ApprovedLongitudinalExecutionBuildV2 | null;
    maxJsonBodyBytes?: number;
    maxLongitudinalJsonBodyBytes?: number;
    maxLongitudinalStoredInputBytes?: number;
    maxTaskRuntimeMs?: number;
  }> = {},
): Harness {
  const objectStore = new InMemoryComputeObjectStore();
  const supervisor = new InMemoryComputeProcessSupervisor();
  const clock = new ManualComputeClock(NOW);
  const core = new ComputeServiceCore({
    repository: new InMemoryComputeTaskRepository(),
    objectStore,
    processSupervisor: supervisor,
    auditSink: new InMemoryComputeAuditSink(),
    clock,
    idFactory: new SequenceComputeIdFactory(),
    maxConcurrency: 2,
    maxLeaseDurationMs: 60_000,
  });
  const httpRepository = new InMemoryComputeHttpJobRepository();
  const events = new InMemoryComputeHttpEventBroker();
  const urls = new InMemoryComputeHttpObjectUrlIssuer(
    "https://objects.example/private/",
  );
  const readiness = new StaticComputeHttpReadinessProbe(true);
  const router = new ComputeV1HttpRouter({
    core,
    infrastructure: {
      repository: httpRepository,
      objectStore,
      clock,
      idFactory: new SequenceComputeHttpIdFactory(),
      capabilityCodec: new HmacComputeHttpCapabilityCodec(SECRET),
      objectUrls: urls,
      events,
      readiness,
      rateLimiter,
      ...(deletionLifecycle === undefined ? {} : { deletionLifecycle }),
    },
    allowedOrigins: [ORIGIN, "http://localhost:3000"],
    buildIdentity: {
      approvalManifestSha256: "9".repeat(64),
      releaseId: "release-test",
      gitCommit: "8".repeat(40),
      flyImageDigest: `sha256:${"7".repeat(64)}`,
      flyBuildId: "compute-http-test-build",
      contractVersions: ["3dena.test-contract.v1"],
    },
    ...(longitudinalOptions.approvedBuild === null
      ? {}
      : {
          approvedLongitudinalBuild:
            longitudinalOptions.approvedBuild ?? APPROVED_LONGITUDINAL_BUILD,
          longitudinalServiceTokenSha256: sha256(
            new TextEncoder().encode(LONGITUDINAL_SERVICE_TOKEN),
          ),
        }),
    jobTtlMs: 60 * 60_000,
    maxTaskRuntimeMs: longitudinalOptions.maxTaskRuntimeMs ?? 30 * 60_000,
    ...(longitudinalOptions.maxJsonBodyBytes === undefined
      ? {}
      : { maxJsonBodyBytes: longitudinalOptions.maxJsonBodyBytes }),
    ...(longitudinalOptions.maxLongitudinalJsonBodyBytes === undefined
      ? {}
      : {
          maxLongitudinalJsonBodyBytes:
            longitudinalOptions.maxLongitudinalJsonBodyBytes,
        }),
    ...(longitudinalOptions.maxLongitudinalStoredInputBytes === undefined
      ? {}
      : {
          maxLongitudinalStoredInputBytes:
            longitudinalOptions.maxLongitudinalStoredInputBytes,
        }),
  });
  return {
    router,
    core,
    objectStore,
    supervisor,
    clock,
    httpRepository,
    events,
    urls,
    readiness,
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function datasetReceipt(bytes: Uint8Array): DatasetReceiptV1 {
  const digest = sha256(bytes);
  return {
    schemaVersion: DATASET_RECEIPT_VERSION_V1,
    sha256: digest,
    byteLength: bytes.byteLength,
    format: "csv",
    sheet: { index: 0, name: "CSV" },
    rows: 2,
    columns: 4,
    schema: {
      schemaVersion: "3dena.dataset-schema.v1",
      headers: ["participant", "conversation", "A", "B"],
      columns: [
        { name: "participant", inferredType: "string", roles: ["unit"] },
        {
          name: "conversation",
          inferredType: "string",
          roles: ["conversation"],
        },
        { name: "A", inferredType: "number", roles: ["code"] },
        { name: "B", inferredType: "number", roles: ["code"] },
      ],
    },
    limits: {
      schemaVersion: "3dena.dataset-limits.v1",
      maxFileBytes: 5 * 1024 * 1024,
      maxWorksheets: 32,
      maxRows: 100_000,
      maxColumns: 256,
      maxCells: 5_000_000,
    },
    warnings: [],
    activationIdentity: `dataset:${digest}`,
  };
}

function analysisTask(
  receipt: DatasetReceiptV1,
  taskId = "task-1",
): Extract<AnalysisTaskV1, { kind: "network-comparison" }> {
  return {
    schemaVersion: ANALYSIS_TASK_VERSION_V1,
    kind: "network-comparison",
    owner: {
      contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
      datasetHash: receipt.sha256,
      specHash: SPEC_HASH,
      runId: "run-1",
      taskId,
    },
    deadlineEpochMilliseconds: NOW + 10 * 60_000,
    sourceResultHash: "c".repeat(64),
    groups: ["group-a", "group-b"],
  };
}

function fetchFor(router: ComputeV1HttpRouter): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    router.handle(new Request(input, init))) as typeof fetch;
}

function createRequest(bytes: Uint8Array) {
  return {
    schemaVersion: "3dena.create-job-request.v1" as const,
    dataset: {
      sha256: sha256(bytes),
      byteLength: bytes.byteLength,
      format: "csv" as const,
    },
    processingPolicyConfirmed: true as const,
  };
}

function longitudinalFittedResult(): AnalysisResult {
  const result = analyzeRows({
    rows: [
      { Student: "private-a", Group: "A", Time: "T1", Weight: 2, A: 1, B: 1, C: 0, D: 0 },
      { Student: "private-a", Group: "A", Time: "T2", Weight: 2, A: 0, B: 1, C: 1, D: 0 },
      { Student: "private-b", Group: "B", Time: "T1", Weight: 3, A: 1, B: 0, C: 0, D: 1 },
      { Student: "private-b", Group: "B", Time: "T2", Weight: 3, A: 0, B: 0, C: 1, D: 1 },
    ],
    mapping: {
      units: ["Student", "Group"],
      conversation: ["Time"],
      codes: ["A", "B", "C", "D"],
      metadata: ["Weight"],
      trajectory: {
        participant: ["Student"],
        group: "Group",
        time: "Time",
        timeOrder: ["T1", "T2"],
        cohortPolicy: "available",
      },
    },
    config: { model: "SeparateTrajectory", windowSizeBack: 4 },
  });
  const participantTokens = new Map<string, string>();
  const unitTokens = new Map<string, string>();
  const stepTokens = new Map<string, string>();
  const opaqueToken = (
    map: Map<string, string>,
    canonical: string,
    namespace: string,
  ): string => {
    const existing = map.get(canonical);
    if (existing !== undefined) return existing;
    const created = `${namespace}-${map.size + 1}-${createHash("sha256")
      .update(canonical)
      .digest("hex")
      .slice(0, 32)}`;
    map.set(canonical, created);
    return created;
  };
  result.points = result.points.map((point) => {
    const participantToken = opaqueToken(
      participantTokens,
      point.participantLabel.canonical,
      "participant",
    );
    const unitToken = opaqueToken(unitTokens, point.unit.canonical, "unit");
    const stepToken = opaqueToken(
      stepTokens,
      point.step?.canonical ?? point.id.canonical,
      "step",
    );
    const unit = {
      columns: [...point.unit.columns],
      values: [unitToken, point.group!.value],
      canonical: `opaque-unit:${unitToken}`,
      display: "Opaque unit",
    };
    const step = {
      columns: [...point.step!.columns],
      values: [point.time!.value],
      canonical: `opaque-step:${stepToken}`,
      display: "Opaque step",
    };
    return {
      ...point,
      participantLabel: {
        columns: [...point.participantLabel.columns],
        values: [participantToken],
        canonical: `opaque-participant:${participantToken}`,
        display: "Opaque participant",
      },
      unit,
      step,
      id: {
        columns: [...unit.columns, ...step.columns],
        values: [...unit.values, ...step.values],
        canonical: `opaque-point:${unitToken}:${stepToken}`,
        display: "Opaque fitted point",
      },
      metadata: { Weight: point.metadata.Weight! },
    };
  });
  result.accumulation.modelCounts.rowKeys = result.points.map((point) =>
    structuredClone(point.id));
  result.accumulation.rowCounts = {
    rowKeys: [],
    columns: [...result.accumulation.rowCounts.columns],
    values: [],
  };
  result.trajectory!.participantPeriods = [];
  result.trajectory!.centroids = [];
  result.trajectory!.paths = result.trajectory!.paths.map((path) => ({
    group: structuredClone(path.group),
    steps: path.steps.map((step) => ({
      time: structuredClone(step.time),
      centroidIndex: null,
    })),
  }));
  result.summary.rowCountRows = 0;
  result.summary.participantPeriods = 0;
  result.summary.trajectoryCentroids = 0;
  result.summary.units = new Set(
    result.points.map((point) => point.unit.canonical),
  ).size;
  result.diagnostics = [{
    code: "FITTED_JENA_FIXED_ROTATION_ADAPTER_V2",
    severity: "info",
    message: "Full-space coordinates were projected by jENA against the immutable successful-fit rotation; no ENA accumulation or rotation fit was repeated.",
    path: "provenance.resultSemantics",
  }];
  result.provenance.adapter = "@3dena/analysis";
  result.provenance.adapterVersion = APPROVED_LONGITUDINAL_BUILD.sdkVersion;
  result.provenance.jenaPackage = "jena-js";
  result.provenance.jenaVersion = APPROVED_LONGITUDINAL_BUILD.jenaVersion;
  result.provenance.jenaCommit = APPROVED_LONGITUDINAL_BUILD.jenaCommit;
  result.provenance.resultSemantics =
    "one immutable fitted jENA rotation; fixed projectIn full-space recovery; participant-period reduction before group-time centroids";
  return result;
}

async function longitudinalSubmission(): Promise<LongitudinalComputeSubmissionV2> {
  const result = longitudinalFittedResult();
  const sourceResultHash = await hashAnalysisValueV1(result);
  const runSpec: TrajectoryRunSpecV2 = {
    schemaVersion: "3dena.trajectory-run-spec.v2",
    sourceResultHash,
    participantColumns: ["Student"],
    timeColumn: "Time",
    groupColumn: "Group",
    orderedPeriods: result.trajectory!.timeOrder.map((time, index) => ({
      identity: {
        components: [{ name: "Time", type: "string", value: String(time.value) }],
      },
      sourceTimeCanonical: time.canonical,
      displayLabel: time.display,
      expected: true,
      value: { type: "ordered-index-v2", index },
    })),
    selectedDimensions: [...result.axes],
    cohortPolicy: "available",
    missingValuePolicy: "complete-analytical-rows",
    estimand: { kind: "weighted-participant", metadataField: "Weight" },
  };
  const specHash = await hashAnalysisValueV1(runSpec);
  return {
    schemaVersion: LONGITUDINAL_COMPUTE_SUBMISSION_VERSION_V2,
    dataset: {
      schemaVersion: "3dena.analysis-execution-dataset.v2",
      receipt: {
        schemaVersion: "3dena.dataset-receipt.v1",
        sha256: LONGITUDINAL_DATASET_HASH,
        byteLength: 1,
        format: "csv",
        sheet: null,
        rows: 4,
        columns: 8,
        schema: {
          schemaVersion: "3dena.dataset-schema.v1",
          headers: ["Student", "Group", "Time", "Weight", "A", "B", "C", "D"],
          columns: ["Student", "Group", "Time", "Weight", "A", "B", "C", "D"]
            .map((name) => ({
              name,
              inferredType: "string" as const,
              roles: ["metadata" as const],
            })),
        },
        limits: {
          schemaVersion: "3dena.dataset-limits.v1",
          maxFileBytes: 1_000,
          maxWorksheets: 1,
          maxRows: 1_000,
          maxColumns: 100,
          maxCells: 100_000,
        },
        warnings: [],
        activationIdentity: `open-ena:${LONGITUDINAL_DATASET_HASH}:${specHash}`,
      },
      specHash,
      buildId: APPROVED_LONGITUDINAL_BUILD.buildId,
      sourceResult: {
        sourceKind: "raw-jena",
        hash: sourceResultHash,
        result,
      },
    },
    pathTask: {
      schemaVersion: "3dena.trajectory-path-task.v2",
      kind: "trajectory-path-v2",
      datasetHash: LONGITUDINAL_DATASET_HASH,
      specHash,
      runId: "opaque-run-1",
      runSpec,
    },
    seed: 2026,
    processingPolicyConfirmed: true,
  };
}

async function rebindLongitudinalSource(
  value: LongitudinalComputeSubmissionV2,
  mutate: (result: AnalysisResult) => void,
): Promise<LongitudinalComputeSubmissionV2> {
  const copy = structuredClone(value);
  const source = copy.dataset.sourceResult!;
  mutate(source.result as AnalysisResult);
  source.hash = await hashAnalysisValueV1(source.result);
  copy.pathTask.runSpec.sourceResultHash = source.hash;
  const specHash = await hashAnalysisValueV1(copy.pathTask.runSpec);
  copy.dataset.specHash = specHash;
  copy.pathTask.specHash = specHash;
  copy.dataset.receipt.activationIdentity =
    `open-ena:${LONGITUDINAL_DATASET_HASH}:${specHash}`;
  return copy;
}

function longitudinalCreateRequest(
  body: unknown,
  idempotencyKey: string,
): Request {
  return new Request("https://compute.example/v2/longitudinal-jobs", {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      "x-3dena-service-token": LONGITUDINAL_SERVICE_TOKEN,
      "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
    },
    body: JSON.stringify(body),
  });
}

async function createAndUpload(target: Harness, bytes: Uint8Array) {
  const client = createAnalysisClient({
    baseUrl: "https://compute.example",
    fetch: fetchFor(target.router),
  });
  const capability = await client.createJob(
    createRequest(bytes),
    "create-job-0001",
  );
  await target.objectStore.putImmutable(
    target.urls.uploadObjectKey(capability.jobId),
    bytes,
  );
  return { client, capability };
}

describe("ComputeV1HttpRouter dedicated longitudinal V2 jobs", () => {
  it("requires the protected service token even when Origin is allowlisted or spoofed", async () => {
    const target = harness();
    const submission = await longitudinalSubmission();
    const withoutToken = longitudinalCreateRequest(
      submission,
      "longitudinal-auth-missing",
    );
    withoutToken.headers.delete("x-3dena-service-token");
    const missing = await target.router.handle(withoutToken);
    expect(missing.status).toBe(401);
    expect(await missing.json()).toMatchObject({ code: "UNAUTHORIZED" });

    const wrongToken = longitudinalCreateRequest(
      submission,
      "longitudinal-auth-wrong",
    );
    wrongToken.headers.set(
      "x-3dena-service-token",
      "attacker-controlled-longitudinal-service-token-000000",
    );
    const rejected = await target.router.handle(wrongToken);
    expect(rejected.status).toBe(401);
    expect(await rejected.json()).toMatchObject({ code: "UNAUTHORIZED" });
    expect(await target.httpRepository.findByCreateIdempotencyHash("unreachable"))
      .toBeNull();
  });

  it("persists one exact wrapper, queues a hard-deadline core task, and reuses V1 status/result/artifact routes", async () => {
    const target = harness();
    const submission = await longitudinalSubmission();
    const preflight = await target.router.handle(new Request(
      "https://compute.example/v2/longitudinal-jobs",
      {
        method: "OPTIONS",
        headers: {
          origin: ORIGIN,
          "access-control-request-method": "POST",
          "access-control-request-headers":
            "content-type, idempotency-key, x-3dena-contract-version",
        },
      },
    ));
    expect(preflight.status).toBe(204);

    const response = await target.router.handle(
      longitudinalCreateRequest(submission, "longitudinal-create-0001"),
    );
    expect(response.status).toBe(201);
    const capability = (await response.json()) as LongitudinalComputeCapabilityV2;
    const jobBase = `https://compute.example/v1/jobs/${capability.jobId}`;
    expect(capability).toEqual({
      schemaVersion: "3dena.longitudinal-compute-capability.v2",
      jobId: expect.stringMatching(/^longitudinal-[a-f0-9]{40}$/u),
      capabilityToken: expect.stringMatching(/^cap_v1_/u),
      urls: {
        schemaVersion: "3dena.longitudinal-compute-status-urls.v2",
        statusUrl: jobBase,
        eventsUrl: `${jobBase}/events`,
        resultUrl: `${jobBase}/result`,
        artifactUrl: `${jobBase}/artifact`,
        cancelUrl: jobBase,
        deleteUrl: jobBase,
      },
      expiresAt: new Date(NOW + 60 * 60_000).toISOString(),
    });
    for (const url of Object.values(capability.urls).filter(
      (value) => typeof value === "string" && value.startsWith("https://"),
    )) {
      expect(url).not.toContain(capability.capabilityToken);
    }

    const record = await target.httpRepository.get(capability.jobId);
    expect(record).toMatchObject({
      taskKind: LONGITUDINAL_COMPUTE_TASK_KIND_V2,
      coreTaskId: capability.jobId,
      inputObjectOwnedByJob: true,
      sourceResultHash: submission.dataset.sourceResult!.hash,
      owner: {
        datasetHash: submission.pathTask.datasetHash,
        specHash: submission.pathTask.specHash,
        runId: submission.pathTask.runId,
        taskId: capability.jobId,
      },
      longitudinalInputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      longitudinalInputByteLength: expect.any(Number),
    });
    if (record === null) throw new Error("Expected a durable longitudinal HTTP record.");
    const storedBytes = await target.objectStore.get(record.inputObjectKey);
    if (storedBytes === null) throw new Error("Expected the immutable longitudinal input.");
    const storedText = new TextDecoder().decode(storedBytes);
    const stored = JSON.parse(storedText) as ScientificStoredLongitudinalInputV2;
    expect(stored).toEqual({
      version: LONGITUDINAL_COMPUTE_STORED_INPUT_VERSION_V2,
      kind: LONGITUDINAL_COMPUTE_TASK_KIND_V2,
      owner: record.owner,
      deadlineAtMs: NOW + 60_000,
      request: expect.objectContaining({
        execution: {
          target: "persistent-compute-service",
          ...APPROVED_LONGITUDINAL_BUILD,
          seed: 2026,
        },
      }),
    });
    expect(storedText).not.toContain("private-a");
    expect(storedText).not.toContain("private-b");
    expect(storedText).not.toContain("rawRows");
    expect(stored.request).not.toHaveProperty("bootstrapTask");
    const storedSourceResult = stored.request.dataset.sourceResult!.result as AnalysisResult;
    expect(storedSourceResult.accumulation.rowCounts.values)
      .toEqual([]);
    expect(storedSourceResult.trajectory!.participantPeriods)
      .toEqual([]);
    expect(storedSourceResult.trajectory!.centroids)
      .toEqual([]);

    const core = await target.core.getTask(capability.jobId);
    expect(core).toMatchObject({
      state: "queued",
      request: {
        taskKind: LONGITUDINAL_COMPUTE_TASK_KIND_V2,
        deadlineAtMs: NOW + 60_000,
        expiresAtMs: NOW + 60 * 60_000,
        input: {
          key: record.inputObjectKey,
          sha256: record.longitudinalInputSha256,
          byteLength: record.longitudinalInputByteLength,
        },
      },
    });
    const authHeaders = {
      origin: ORIGIN,
      authorization: `Bearer ${capability.capabilityToken}`,
      "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
    };
    const queued = await target.router.handle(new Request(capability.urls.statusUrl, {
      headers: authHeaders,
    }));
    expect(queued.status).toBe(200);
    expect(await queued.json()).toMatchObject({ state: "QUEUED" });

    const executeAgain = await target.router.handle(new Request(
      `${jobBase}/execute`,
      {
        method: "POST",
        headers: {
          ...authHeaders,
          "content-type": "application/json",
          "idempotency-key": "longitudinal-execute-forbidden",
        },
        body: "{}",
      },
    ));
    expect(executeAgain.status).toBe(405);

    const lease = await target.core.claimTask(capability.jobId, {
      leaseId: "lease-longitudinal",
      holderId: "worker-longitudinal",
      durationMs: 30_000,
    });
    const running = await target.core.executeTask(capability.jobId, lease);
    const resultBytes = new TextEncoder().encode('{"longitudinalBundle":true}');
    const resultKey = running.execution?.resultObjectKey;
    const childId = running.execution?.childId;
    if (resultKey === undefined || childId === undefined) {
      throw new Error("Expected a running longitudinal child.");
    }
    const resultObject = (await target.objectStore.putImmutable(
      resultKey,
      resultBytes,
    )).descriptor;
    await target.core.publishResult(capability.jobId, lease, resultObject);
    target.supervisor.observeTermination(childId, {
      kind: "completed",
      observedAtMs: target.clock.now(),
      exitCode: 0,
      signal: null,
    });
    await target.core.settleBackground();

    const artifact = await target.router.handle(new Request(
      capability.urls.artifactUrl,
      { headers: authHeaders },
    ));
    expect(artifact.status).toBe(200);
    expect(new Uint8Array(await artifact.arrayBuffer())).toEqual(resultBytes);
    expect(artifact.headers.get("x-3dena-result-sha256")).toBe(sha256(resultBytes));
    expect(await target.objectStore.head(record.inputObjectKey)).toBeNull();
    const terminalReplay = await target.router.handle(
      longitudinalCreateRequest(submission, "longitudinal-create-0001"),
    );
    expect(terminalReplay.status).toBe(200);
    expect(await target.objectStore.head(record.inputObjectKey)).toBeNull();
  });

  it("rejects unknown/build/privacy input and preserves create idempotency", async () => {
    const target = harness();
    const valid = await longitudinalSubmission();
    const first = await target.router.handle(
      longitudinalCreateRequest(valid, "longitudinal-idempotent-key"),
    );
    const firstCapability = (await first.json()) as LongitudinalComputeCapabilityV2;
    const replay = await target.router.handle(
      longitudinalCreateRequest(valid, "longitudinal-idempotent-key"),
    );
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(firstCapability);

    const conflict = await target.router.handle(longitudinalCreateRequest(
      { ...valid, seed: 2027 },
      "longitudinal-idempotent-key",
    ));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    for (const [key, invalid] of [
      ["longitudinal-unknown-field", { ...valid, rawRows: [{ Student: "private-a" }] }],
      ["longitudinal-build-injection", {
        ...valid,
        execution: { target: "browser-worker", buildId: "attacker-build" },
      }],
      ["longitudinal-dataset-build-injection", {
        ...valid,
        dataset: { ...valid.dataset, buildId: "attacker-build" },
      }],
    ] as const) {
      const rejected = await target.router.handle(longitudinalCreateRequest(invalid, key));
      expect(rejected.status).toBe(400);
      const text = await rejected.text();
      expect(JSON.parse(text)).toMatchObject({ code: "INVALID_REQUEST" });
      expect(text).not.toContain("private-a");
      expect(text).not.toContain("attacker-build");
    }

    const rawIdentity = await rebindLongitudinalSource(valid, (result) => {
      result.points[0]!.participantLabel.values[0] = "private-a";
    });
    const privacyRejected = await target.router.handle(longitudinalCreateRequest(
      rawIdentity,
      "longitudinal-private-identity",
    ));
    expect(privacyRejected.status).toBe(400);
    expect(await privacyRejected.text()).not.toContain("private-a");
  });

  it("retires a deleted create operation while allowing the same specification under a new retry attempt key", async () => {
    const target = harness();
    const submission = await longitudinalSubmission();
    const first = await target.router.handle(longitudinalCreateRequest(
      submission,
      "longitudinal-attempt-0001",
    ));
    expect(first.status).toBe(201);
    const firstCapability = (await first.json()) as LongitudinalComputeCapabilityV2;
    const deletion = await target.router.handle(new Request(
      firstCapability.urls.deleteUrl,
      {
        method: "DELETE",
        headers: {
          origin: ORIGIN,
          authorization: `Bearer ${firstCapability.capabilityToken}`,
          accept: "application/vnd.3dena.job-deletion-receipt.v2+json",
          "idempotency-key": "delete-longitudinal-attempt-0001",
          "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
        },
      },
    ));
    expect(deletion.status).toBe(200);
    expect(await deletion.json()).toMatchObject({
      intentAccepted: true,
      termination: "not_required",
      capacity: "not_reserved",
      objects: "deleted",
    });

    const retiredReplay = await target.router.handle(longitudinalCreateRequest(
      submission,
      "longitudinal-attempt-0001",
    ));
    expect(retiredReplay.status).toBe(409);
    expect(await retiredReplay.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const retry = await target.router.handle(longitudinalCreateRequest(
      submission,
      "longitudinal-attempt-0002",
    ));
    expect(retry.status).toBe(201);
    const retryCapability = (await retry.json()) as LongitudinalComputeCapabilityV2;
    expect(retryCapability.jobId).not.toBe(firstCapability.jobId);
    expect((await target.core.getTask(retryCapability.jobId))?.state).toBe("queued");
  });

  it("shares readiness, rate, and body guards and fails closed without a 60-second approved runtime", async () => {
    const valid = await longitudinalSubmission();
    const notReady = harness();
    notReady.readiness.setReady(false);
    const unavailable = await notReady.router.handle(longitudinalCreateRequest(
      valid,
      "longitudinal-not-ready",
    ));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ code: "NOT_READY" });

    const missingBuild = harness(undefined, undefined, { approvedBuild: null });
    const buildUnavailable = await missingBuild.router.handle(longitudinalCreateRequest(
      valid,
      "longitudinal-missing-build",
    ));
    expect(buildUnavailable.status).toBe(503);
    expect(await buildUnavailable.json()).toMatchObject({ code: "NOT_READY" });

    const shortRuntime = harness(undefined, undefined, { maxTaskRuntimeMs: 59_999 });
    const deadlineUnavailable = await shortRuntime.router.handle(
      longitudinalCreateRequest(valid, "longitudinal-short-runtime"),
    );
    expect(deadlineUnavailable.status).toBe(503);
    expect(await deadlineUnavailable.json()).toMatchObject({ code: "NOT_READY" });

    const rateLimited = harness({
      consume: async () => ({ allowed: false, retryAfterSeconds: 9 }),
    });
    const limited = await rateLimited.router.handle(longitudinalCreateRequest(
      valid,
      "longitudinal-rate-limit",
    ));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("9");

    const bodyLimited = harness(undefined, undefined, {
      maxLongitudinalJsonBodyBytes: 128,
    });
    const oversized = await bodyLimited.router.handle(longitudinalCreateRequest(
      valid,
      "longitudinal-body-limit",
    ));
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("stops reading a streamed V2 JSON body immediately after the 32 MiB-class route limit", async () => {
    const target = harness(undefined, undefined, {
      maxLongitudinalJsonBodyBytes: 8,
    });
    let cancelledAtLimit = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("123456789"));
      },
      pull() {
        // Leave the transport open: a buffering implementation would wait for
        // more bytes, while the bounded reader must cancel immediately.
      },
      cancel() {
        cancelledAtLimit = true;
      },
    });
    const response = await target.router.handle(new Request(
      "https://compute.example/v2/longitudinal-jobs",
      {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          "idempotency-key": "longitudinal-stream-limit",
          "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
          "x-3dena-service-token": LONGITUDINAL_SERVICE_TOKEN,
        },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" },
    ));
    expect(response.status).toBe(413);
    expect(cancelledAtLimit).toBe(true);
  });

  it("rejects a V2 submission when the trusted stored wrapper exceeds the worker input limit", async () => {
    const target = harness(undefined, undefined, {
      maxLongitudinalStoredInputBytes: 1,
    });
    const put = vi.spyOn(target.objectStore, "putImmutable");
    const response = await target.router.handle(longitudinalCreateRequest(
      await longitudinalSubmission(),
      "longitudinal-stored-wrapper-limit",
    ));

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(put).not.toHaveBeenCalled();
    expect(await target.httpRepository.findByCreateIdempotencyHash(
      new HmacComputeHttpCapabilityCodec(SECRET).hashSecret(
        `longitudinal-create\0${ORIGIN}\0longitudinal-stored-wrapper-limit`,
      ),
    )).toBeNull();
  });

  it("recovers idempotently when the process crashes after immutable input storage but before core creation", async () => {
    const target = harness();
    const valid = await longitudinalSubmission();
    const createTask = vi.spyOn(target.core, "createTask")
      .mockRejectedValueOnce(new Error("simulated process crash"));
    const failed = await target.router.handle(longitudinalCreateRequest(
      valid,
      "longitudinal-crash-recovery",
    ));
    expect(failed.status).toBe(500);
    createTask.mockRestore();

    const replay = await target.router.handle(longitudinalCreateRequest(
      valid,
      "longitudinal-crash-recovery",
    ));
    expect(replay.status).toBe(200);
    const capability = (await replay.json()) as LongitudinalComputeCapabilityV2;
    expect((await target.core.getTask(capability.jobId))?.state).toBe("queued");
    const record = await target.httpRepository.get(capability.jobId);
    expect(record?.longitudinalInputSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(await target.objectStore.head(record!.inputObjectKey)).toMatchObject({
      sha256: record?.longitudinalInputSha256,
      byteLength: record?.longitudinalInputByteLength,
    });
  });

  it("rejects an overdue crash replay before Blob put and persists sweeper-visible cleanup intent", async () => {
    const target = harness();
    const valid = await longitudinalSubmission();
    const createTask = vi.spyOn(target.core, "createTask")
      .mockRejectedValueOnce(new Error("simulated process crash"));
    const failed = await target.router.handle(longitudinalCreateRequest(
      valid,
      "longitudinal-overdue-crash-replay",
    ));
    expect(failed.status).toBe(500);
    createTask.mockRestore();
    target.clock.set(NOW + 60_001);
    const put = vi.spyOn(target.objectStore, "putImmutable");

    const replay = await target.router.handle(longitudinalCreateRequest(
      valid,
      "longitudinal-overdue-crash-replay",
    ));
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ code: "DEADLINE_EXCEEDED" });
    expect(put).not.toHaveBeenCalled();
    const idempotencyHash = new HmacComputeHttpCapabilityCodec(SECRET).hashSecret(
      `longitudinal-create\0${ORIGIN}\0longitudinal-overdue-crash-replay`,
    );
    const jobId = `longitudinal-${idempotencyHash.slice(0, 40)}`;
    expect(await target.core.getTask(jobId)).toBeNull();
    expect(await target.httpRepository.get(jobId)).toMatchObject({
      deleteRequestedAtMs: NOW + 60_001,
      deleteTerminationRequired: false,
      deleteCapacityReserved: false,
    });
    await expect(target.router.reconcileDurableDeletion(jobId)).resolves.toBe(true);
    expect((await target.httpRepository.get(jobId))?.inputDeletedAtMs)
      .toBe(NOW + 60_001);
  });

  it("lets the durable sweeper clean an overdue post-put/pre-core crash without client replay", async () => {
    const target = harness();
    const valid = await longitudinalSubmission();
    const createTask = vi.spyOn(target.core, "createTask")
      .mockRejectedValueOnce(new Error("simulated process crash"));
    const failed = await target.router.handle(longitudinalCreateRequest(
      valid,
      "longitudinal-no-replay-crash",
    ));
    expect(failed.status).toBe(500);
    createTask.mockRestore();
    const idempotencyHash = new HmacComputeHttpCapabilityCodec(SECRET).hashSecret(
      `longitudinal-create\0${ORIGIN}\0longitudinal-no-replay-crash`,
    );
    const jobId = `longitudinal-${idempotencyHash.slice(0, 40)}`;
    const before = await target.httpRepository.get(jobId);
    expect(before?.deleteRequestedAtMs).toBeUndefined();
    expect(await target.objectStore.head(before!.inputObjectKey)).not.toBeNull();

    target.clock.set(NOW + 60_001);
    await expect(target.router.reconcileDurableDeletion(jobId)).resolves.toBe(true);
    expect(await target.httpRepository.get(jobId)).toMatchObject({
      deleteRequestedAtMs: NOW + 60_001,
      inputDeletedAtMs: NOW + 60_001,
    });
    expect(await target.objectStore.head(before!.inputObjectKey)).toBeNull();
  });

  it("lets the durable sweeper erase V2 input after terminal worker failure without client polling", async () => {
    const target = harness();
    const response = await target.router.handle(longitudinalCreateRequest(
      await longitudinalSubmission(),
      "longitudinal-terminal-sweeper",
    ));
    expect(response.status).toBe(201);
    const capability = (await response.json()) as LongitudinalComputeCapabilityV2;
    const before = await target.httpRepository.get(capability.jobId);
    if (before === null) throw new Error("Expected durable longitudinal job.");
    const lease = await target.core.claimTask(capability.jobId, {
      leaseId: "lease-terminal-sweeper",
      holderId: "worker-terminal-sweeper",
      durationMs: 30_000,
    });
    const running = await target.core.executeTask(capability.jobId, lease);
    const childId = running.execution?.childId;
    if (childId === undefined) throw new Error("Expected running child.");
    target.supervisor.observeTermination(childId, {
      kind: "crashed",
      observedAtMs: target.clock.now(),
      exitCode: 1,
      signal: null,
    });
    await target.core.settleBackground();
    expect((await target.core.getTask(capability.jobId))?.state).toBe("failed");
    expect(await target.objectStore.head(before.inputObjectKey)).not.toBeNull();

    await expect(target.router.reconcileJob(capability.jobId)).resolves.toMatchObject({
      state: "FAILED",
    });
    expect(await target.objectStore.head(before.inputObjectKey)).toBeNull();
    expect((await target.httpRepository.get(capability.jobId))?.inputDeletedAtMs)
      .toBe(NOW);
  });
});

describe("ComputeV1HttpRouter", () => {
  it("does not let unverified Authorization values rotate the rate-limit key", async () => {
    const keys: string[] = [];
    const target = harness({
      consume: async ({ keyHash }) => {
        keys.push(keyHash);
        return { allowed: true, retryAfterSeconds: 1 };
      },
    });
    for (const authorization of ["Bearer attacker-token-one", "Bearer attacker-token-two"]) {
      await target.router.handle(new Request("https://compute.example/v1/jobs", {
        method: "POST",
        headers: {
          origin: ORIGIN,
          authorization,
          "content-type": "application/json",
          "idempotency-key": `rate-key-${keys.length}-0000`,
          "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
        },
        body: "{}",
      }));
    }
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("separates a verified job principal quota from the stable invalid-capability bucket", async () => {
    const keys: string[] = [];
    const target = harness({
      consume: async ({ keyHash }) => {
        keys.push(keyHash);
        return { allowed: true, retryAfterSeconds: 1 };
      },
    });
    const dataset = new TextEncoder().encode("participant,conversation,A,B\np1,c1,1,1\n");
    const { client, capability } = await createAndUpload(target, dataset);
    keys.length = 0;
    await client.getJob(capability);
    for (const token of [
      "invalid-capability-token-one",
      "invalid-capability-token-two",
    ]) {
      const response = await target.router.handle(new Request(
        `https://compute.example/v1/jobs/${capability.jobId}`,
        {
          headers: {
            origin: ORIGIN,
            authorization: `Bearer ${token}`,
            "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
          },
        },
      ));
      expect(response.status).toBe(401);
    }
    expect(keys).toHaveLength(3);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[1]).toBe(keys[2]);
  });
  it("rate-limits max+1 before parsing or creating a job", async () => {
    let count = 0;
    let deny = true;
    const limiter: ComputeHttpRateLimiter = {
      consume: async () => {
        count += 1;
        return { allowed: !deny || count <= 1, retryAfterSeconds: 17 };
      },
    };
    const target = harness(limiter);
    const bytes = new TextEncoder().encode("a,b,c\n1,1,1\n");
    const first = await target.router.handle(new Request("https://compute.example/v1/jobs", {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        "idempotency-key": "rate-first-key",
        "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
      },
      body: JSON.stringify(createRequest(bytes)),
    }));
    expect(first.status).toBe(201);
    const denied = await target.router.handle(new Request("https://compute.example/v1/jobs", {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        "idempotency-key": "rate-denied-key",
        "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
      },
      body: "not-json-and-must-not-be-parsed",
    }));
    expect(denied.status).toBe(429);
    expect(denied.headers.get("retry-after")).toBe("17");
    await expect(denied.json()).resolves.toMatchObject({ code: "RATE_LIMITED" });
    deny = false;
    const third = await target.router.handle(new Request("https://compute.example/v1/jobs", {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        "idempotency-key": "rate-third-key",
        "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
      },
      body: JSON.stringify(createRequest(bytes)),
    }));
    expect((await third.json()) as { jobId: string }).toMatchObject({ jobId: "job-2" });
  });

  it("runs the public client contract through create, upload, queue, result, SSE, and delete", async () => {
    const target = harness();
    const dataset = new TextEncoder().encode("participant,conversation,A,B\np1,c1,1,1\n");
    const receipt = datasetReceipt(dataset);
    const { client, capability } = await createAndUpload(target, dataset);
    const reference: AnalysisJobReferenceV1 = capability;

    const uploaded = await client.getJob(reference);
    expect(uploaded).toMatchObject({
      jobId: capability.jobId,
      state: "UPLOADED",
      owner: null,
      resultAvailable: false,
    });
    const queued = await client.executeJob(
      reference,
      {
        schemaVersion: "3dena.execute-job-request.v1",
        datasetReceipt: receipt,
        task: analysisTask(receipt),
      },
      "execute-job-0001",
    );
    expect(queued).toMatchObject({
      state: "QUEUED",
      owner: analysisTask(receipt).owner,
    });
    await expect(
      client.executeJob(
        reference,
        {
          schemaVersion: "3dena.execute-job-request.v1",
          datasetReceipt: receipt,
          task: {
            ...analysisTask(receipt),
            groups: ["group-a", "group-c"],
          },
        },
        "execute-job-0001",
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });

    const lease = await target.core.claimTask(capability.jobId, {
      leaseId: "lease-1",
      holderId: "worker-1",
      durationMs: 30_000,
    });
    const running = await target.core.executeTask(capability.jobId, lease);
    const resultBytes = new TextEncoder().encode('{"scientificResult":true}');
    const resultKey = running.execution?.resultObjectKey;
    const childId = running.execution?.childId;
    if (resultKey === undefined || childId === undefined) {
      throw new Error("Expected an executing in-memory child.");
    }
    const result = (
      await target.objectStore.putImmutable(resultKey, resultBytes)
    ).descriptor;
    await target.core.publishResult(capability.jobId, lease, result);
    target.supervisor.observeTermination(childId, {
      kind: "completed",
      observedAtMs: target.clock.now(),
      exitCode: 0,
      signal: null,
    });
    await target.core.settleBackground();

    const succeeded = await client.getJob(reference);
    expect(succeeded).toMatchObject({
      state: "SUCCEEDED",
      resultAvailable: true,
      errorCode: null,
    });
    expect(target.objectStore.keys()).not.toContain(
      target.urls.uploadObjectKey(capability.jobId),
    );
    expect(
      target.objectStore.keys().some((key) => key.startsWith("compute-inputs/")),
    ).toBe(false);

    const directResult = await target.router.handle(
      new Request(
        `https://compute.example/v1/jobs/${capability.jobId}/result`,
        {
          headers: {
            authorization: `Bearer ${capability.capabilityToken}`,
            "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
          },
        },
      ),
    );
    expect(directResult.headers.get("x-3dena-result-sha256")).toBe(
      sha256(resultBytes),
    );
    const resultReference = await client.getResult(reference);
    expect(resultReference).toMatchObject({
      jobId: capability.jobId,
      sha256: sha256(resultBytes),
      byteLength: resultBytes.byteLength,
      exportUrl: null,
    });
    expect(resultReference.resultUrl).not.toContain(capability.capabilityToken);

    const eventStates: string[] = [];
    for await (const event of client.events(reference)) {
      eventStates.push(event.state);
    }
    expect(eventStates).toEqual([
      "CREATED",
      "UPLOADED",
      "QUEUED",
      "SUCCEEDED",
    ]);
    expect(JSON.stringify(target.events.events(capability.jobId))).not.toContain(
      capability.capabilityToken,
    );

    const deletion = await client.deleteJob(reference, "delete-job-0001");
    expect(deletion).toEqual({
      schemaVersion: "3dena.job-deletion-receipt.v1",
      jobId: capability.jobId,
      cancelled: false,
      inputDeleted: true,
      resultDeleted: true,
      deletedAt: new Date(NOW).toISOString(),
    });
    expect(target.objectStore.keys()).not.toContain(resultKey);

    target.clock.advance(1_000);
    await expect(
      client.deleteJob(reference, "delete-job-0001"),
    ).resolves.toEqual(deletion);
  });

  it("stores only capability/idempotency digests and returns non-reflective errors", async () => {
    const target = harness();
    const dataset = new TextEncoder().encode("a,b,c\n1,1,1\n");
    const body = createRequest(dataset);
    const request = (): Request =>
      new Request("https://compute.example/v1/jobs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "private-create-key",
          "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
        },
        body: JSON.stringify(body),
      });
    const first = await target.router.handle(request());
    expect(first.status).toBe(201);
    const capability = (await first.json()) as {
      jobId: string;
      capabilityToken: string;
    };
    const replay = await target.router.handle(request());
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject(capability);

    const stored = await target.httpRepository.get(capability.jobId);
    const storedJson = JSON.stringify(stored);
    expect(storedJson).not.toContain(capability.capabilityToken);
    expect(storedJson).not.toContain("private-create-key");

    const unauthorized = await target.router.handle(
      new Request(`https://compute.example/v1/jobs/${capability.jobId}`, {
        headers: {
          authorization: "Bearer raw-participant-p1-private-token",
          "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
        },
      }),
    );
    expect(unauthorized.status).toBe(401);
    const unauthorizedText = await unauthorized.text();
    expect(JSON.parse(unauthorizedText)).toEqual({
      code: "UNAUTHORIZED",
      requestId: expect.any(String),
    });
    expect(unauthorizedText).not.toContain("participant");

    const corsError = await target.router.handle(
      new Request(`https://compute.example/v1/jobs/${capability.jobId}`, {
        headers: {
          origin: ORIGIN,
          authorization: "Bearer raw-participant-p1-private-token",
          "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
        },
      }),
    );
    expect(corsError.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(await corsError.text()).not.toContain("raw-participant");

    const conflictBody = {
      ...body,
      dataset: { ...body.dataset, format: "xlsx" },
    };
    const conflict = await target.router.handle(
      new Request("https://compute.example/v1/jobs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "private-create-key",
          "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
        },
        body: JSON.stringify(conflictBody),
      }),
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const unknownField = await target.router.handle(
      new Request("https://compute.example/v1/jobs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "unknown-field-key",
          "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
        },
        body: JSON.stringify({ ...body, rawRows: ["private"] }),
      }),
    );
    expect(unknownField.status).toBe(400);
    expect(await unknownField.json()).toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("enforces exact CORS, origin-bound capabilities, preflight, and contract negotiation", async () => {
    const target = harness();
    const preflight = await target.router.handle(
      new Request("https://compute.example/v1/jobs", {
        method: "OPTIONS",
        headers: {
          origin: ORIGIN,
          "access-control-request-method": "POST",
          "access-control-request-headers":
            "content-type, idempotency-key, x-3dena-contract-version",
        },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();

    const denied = await target.router.handle(
      new Request("https://compute.example/healthz", {
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();

    const missingContract = await target.router.handle(
      new Request("https://compute.example/build-info"),
    );
    expect(missingContract.status).toBe(406);

    const bytes = new TextEncoder().encode("a,b,c\n1,1,1\n");
    const create = await target.router.handle(
      new Request("https://compute.example/v1/jobs", {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          "idempotency-key": "origin-create-key",
          "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
        },
        body: JSON.stringify(createRequest(bytes)),
      }),
    );
    const capability = (await create.json()) as {
      jobId: string;
      capabilityToken: string;
    };
    const withoutOrigin = await target.router.handle(
      new Request(`https://compute.example/v1/jobs/${capability.jobId}`, {
        headers: {
          authorization: `Bearer ${capability.capabilityToken}`,
          "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
        },
      }),
    );
    expect(withoutOrigin.status).toBe(401);

    const deleteWithBody = await target.router.handle(
      new Request(`https://compute.example/v1/jobs/${capability.jobId}`, {
        method: "DELETE",
        headers: {
          origin: ORIGIN,
          authorization: `Bearer ${capability.capabilityToken}`,
          "content-type": "application/json",
          "idempotency-key": "delete-with-body",
          "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
        },
        body: "{}",
      }),
    );
    expect(deleteWithBody.status).toBe(400);
    expect(await deleteWithBody.json()).toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("persists a running deletion intent without deleting objects, then returns V2 final facts only after exit", async () => {
    let distributedCapacityReleased = false;
    let distributedTerminationObserved = false;
    const target = harness(undefined, {
      capacityReleased: async () => distributedCapacityReleased,
      terminationObserved: async () => distributedTerminationObserved,
    });
    const dataset = new TextEncoder().encode("participant,conversation,A,B\np1,c1,1,1\n");
    const receipt = datasetReceipt(dataset);
    const { client, capability } = await createAndUpload(target, dataset);
    await client.executeJob(
      capability,
      {
        schemaVersion: "3dena.execute-job-request.v1",
        datasetReceipt: receipt,
        task: analysisTask(receipt, "task-cancel"),
      },
      "execute-cancel-1",
    );
    const lease = await target.core.claimTask(capability.jobId, {
      leaseId: "lease-cancel",
      holderId: "worker-1",
      durationMs: 30_000,
    });
    const running = await target.core.executeTask(capability.jobId, lease);
    const childId = running.execution?.childId;
    if (childId === undefined) throw new Error("Expected running child.");

    const receiptResponse = await client.deleteJobV2(
      capability,
      "delete-cancel-1",
    );
    expect(receiptResponse).toMatchObject({
      cancelled: false,
      inputDeleted: false,
      resultDeleted: false,
      intentAccepted: true,
      termination: "pending",
      capacity: "held",
      objects: "pending",
    });
    const pendingObjectKeys = target.objectStore.keys();
    expect(pendingObjectKeys.filter((key) => key.startsWith("compute-inputs/")))
      .toHaveLength(2);
    await expect(client.deleteJobV2(
      capability,
      "delete-cancel-1",
    )).resolves.toMatchObject({
      cancelled: false,
      inputDeleted: false,
      resultDeleted: false,
      intentAccepted: true,
      termination: "pending",
      capacity: "held",
      objects: "pending",
    });
    await expect(client.getJob(capability)).resolves.toMatchObject({
      state: "CANCEL_REQUESTED",
      resultAvailable: false,
    });
    expect(target.objectStore.keys()).toEqual(pendingObjectKeys);
    expect((await target.httpRepository.get(capability.jobId))?.inputDeletedAtMs)
      .toBeUndefined();
    expect(target.core.capacitySnapshot().occupied).toBe(1);
    expect(target.supervisor.terminationRequests(childId)).toContain("deletion");
    expect(
      target.objectStore.keys().some((key) => key.startsWith("compute-inputs/")),
    ).toBe(true);

    target.supervisor.observeTermination(childId, {
      kind: "terminated",
      observedAtMs: target.clock.now(),
      exitCode: null,
      signal: "SIGTERM",
    });
    await target.core.settleBackground();
    expect(target.core.capacitySnapshot().occupied).toBe(0);
    expect((await target.core.getTask(capability.jobId))?.state).toBe("deleted");
    distributedCapacityReleased = true;
    distributedTerminationObserved = true;
    await expect(
      target.router.reconcileDurableDeletion(capability.jobId),
    ).resolves.toBe(true);
    await expect(client.deleteJobV2(
      capability,
      "delete-cancel-1",
    )).resolves.toMatchObject({
      intentAccepted: true,
      termination: "observed",
      capacity: "released",
      objects: "deleted",
    });
    expect((await target.router.reconcileJob(capability.jobId)).state).toBe(
      "CANCELLED",
    );
  });

  it("replays a durable delete intent into the owning worker while capacity is still held", async () => {
    let distributedCapacityReleased = false;
    let distributedTerminationObserved = false;
    const target = harness(undefined, {
      capacityReleased: async () => distributedCapacityReleased,
      terminationObserved: async () => distributedTerminationObserved,
    });
    const dataset = new TextEncoder().encode("participant,conversation,A,B\np1,c1,1,1\n");
    const receipt = datasetReceipt(dataset);
    const { client, capability } = await createAndUpload(target, dataset);
    await client.executeJob(
      capability,
      {
        schemaVersion: "3dena.execute-job-request.v1",
        datasetReceipt: receipt,
        task: analysisTask(receipt, "task-delete-crash-replay"),
      },
      "execute-delete-crash-replay",
    );
    const lease = await target.core.claimTask(capability.jobId, {
      leaseId: "lease-delete-crash-replay",
      holderId: "worker-delete-crash-replay",
      durationMs: 30_000,
    });
    const running = await target.core.executeTask(capability.jobId, lease);
    const childId = running.execution?.childId;
    if (childId === undefined) throw new Error("Expected running child.");

    // This is the durable crash boundary: the API persisted DELETE intent from
    // a stale leased snapshot, then disappeared before forwarding stop to core.
    const beforeIntent = await target.httpRepository.get(capability.jobId);
    if (beforeIntent === null) throw new Error("Expected HTTP job record.");
    const intent = await target.httpRepository.compareAndSet(
      capability.jobId,
      beforeIntent.revision,
      {
        ...beforeIntent,
        revision: beforeIntent.revision + 1,
        updatedAtMs: target.clock.now(),
        deleteIdempotencyHash: "f".repeat(64),
        deleteRequestedAtMs: target.clock.now(),
        deleteCancelled: true,
        deleteTerminationRequired: false,
        deleteCapacityReserved: false,
      },
    );
    expect(intent.applied).toBe(true);

    await expect(
      target.router.reconcileDurableDeletion(capability.jobId),
    ).resolves.toBe(false);
    expect((await target.core.getTask(capability.jobId))?.state).toBe("cancelling");
    expect(target.supervisor.terminationRequests(childId)).toContain("deletion");
    expect(await target.httpRepository.get(capability.jobId)).toMatchObject({
      deleteTerminationRequired: true,
      deleteCapacityReserved: true,
    });
    expect(target.objectStore.keys().some((key) => key.startsWith("compute-inputs/")))
      .toBe(true);

    target.supervisor.observeTermination(childId, {
      kind: "terminated",
      observedAtMs: target.clock.now(),
      exitCode: null,
      signal: "SIGTERM",
    });
    await target.core.settleBackground();
    distributedCapacityReleased = true;
    distributedTerminationObserved = true;
    await expect(
      target.router.reconcileDurableDeletion(capability.jobId),
    ).resolves.toBe(true);
    expect(target.objectStore.keys().some((key) => key.startsWith("compute-inputs/")))
      .toBe(false);
  });

  it("reports readiness/build identity and rejects mismatched uploads and deadlines", async () => {
    const target = harness();
    const client = createAnalysisClient({
      baseUrl: "https://compute.example",
      fetch: fetchFor(target.router),
    });
    await expect(client.getBuildInfo()).resolves.toEqual({
      schemaVersion: "3dena.compute-build-info.v1",
      approvalManifestSha256: "9".repeat(64),
      releaseId: "release-test",
      gitCommit: "8".repeat(40),
      flyImageDigest: `sha256:${"7".repeat(64)}`,
      flyBuildId: "compute-http-test-build",
      role: "api",
      contractVersions: [
        "3dena.compute-http.v1",
        ANALYSIS_CONTRACT_VERSION_V1,
        "3dena.test-contract.v1",
      ],
    });
    target.readiness.setReady(false);
    const notReady = await target.router.handle(
      new Request("https://compute.example/readyz"),
    );
    expect(notReady.status).toBe(503);
    expect(await notReady.json()).toMatchObject({ code: "NOT_READY" });

    await expect(
      client.createJob(createRequest(new TextEncoder().encode(
        "participant,conversation,A,B\np1,c1,1,1\n",
      )), "create-not-ready-1"),
    ).rejects.toMatchObject({ code: "NOT_READY", status: 503 });
    target.readiness.setReady(true);
    const ready = await target.router.handle(
      new Request("https://compute.example/readyz"),
    );
    expect(await ready.json()).toMatchObject({
      schemaVersion: "3dena.compute-readiness.v1",
      status: "ready",
      approvalManifestSha256: "9".repeat(64),
      releaseId: "release-test",
      gitCommit: "8".repeat(40),
      flyImageDigest: `sha256:${"7".repeat(64)}`,
      flyBuildId: "compute-http-test-build",
      role: "api",
    });

    const dataset = new TextEncoder().encode("participant,conversation,A,B\np1,c1,1,1\n");
    const receipt = datasetReceipt(dataset);
    const capability = await client.createJob(
      createRequest(dataset),
      "create-mismatch-1",
    );
    await target.objectStore.putImmutable(
      target.urls.uploadObjectKey(capability.jobId),
      new TextEncoder().encode("same-length-wrong-content-xxxxxxxxxxxxxxxxxxx"),
    );
    await expect(
      client.executeJob(
        capability,
        {
          schemaVersion: "3dena.execute-job-request.v1",
          datasetReceipt: receipt,
          task: analysisTask(receipt),
        },
        "execute-mismatch-1",
      ),
    ).rejects.toMatchObject({ code: "DATASET_RECEIPT_MISMATCH", status: 409 });

    const other = harness();
    const created = await createAndUpload(other, dataset);
    const tooLate = {
      ...analysisTask(receipt),
      deadlineEpochMilliseconds: NOW + 31 * 60_000,
    };
    await expect(
      created.client.executeJob(
        created.capability,
        {
          schemaVersion: "3dena.execute-job-request.v1",
          datasetReceipt: receipt,
          task: tooLate,
        },
        "execute-deadline-1",
      ),
    ).rejects.toMatchObject({ code: "DEADLINE_EXCEEDED", status: 400 });
  });
});
