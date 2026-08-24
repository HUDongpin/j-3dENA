import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  ANALYSIS_CONTRACT_VERSION_V1,
  ANALYSIS_EXECUTION_DATASET_VERSION_V2,
  ANALYSIS_TASK_VERSION_V1,
  DATASET_RECEIPT_VERSION_V1,
  executeAnalysisTask,
  executeLongitudinalAnalysisV2,
  getAnalysisBuildIdentityV2,
  hashAnalysisValueV1,
  hashLongitudinalExecutionRequestV2,
  verifyLongitudinalAnalysisBundleV2,
  type LongitudinalExecutionRequestV2,
  type AnalysisResult,
  type AnalysisExecutionDataset,
  type AnalysisExecutionDatasetV1,
  type AnalysisExecutionDatasetV2,
  type AnalysisTaskV1,
  type AnalyzeRowsInput,
  type RawRow,
} from "@3dena/analysis";
import {
  COMPUTE_LEASE_VERSION,
  COMPUTE_PROCESS_LAUNCH_CONTROL_VERSION,
  COMPUTE_TASK_OWNER_CONTRACT_VERSION,
  COMPUTE_TASK_REQUEST_VERSION,
  ComputeServiceCore,
  InMemoryComputeAuditSink,
  InMemoryComputeObjectStore,
  InMemoryComputeProcessSupervisor,
  InMemoryComputeTaskRepository,
  ManualComputeClock,
  SequenceComputeIdFactory,
  type ComputeClock,
  type ComputeTaskRequestV1,
  type ComputeObjectStore,
  type ProcessLaunchContextV1,
} from "@3dena/compute-service-core";
import {
  ComputeV1HttpRouter,
  HmacComputeHttpCapabilityCodec,
  InMemoryComputeHttpEventBroker,
  InMemoryComputeHttpJobRepository,
  InMemoryComputeHttpObjectUrlIssuer,
  LONGITUDINAL_COMPUTE_STORED_INPUT_VERSION_V2,
  LONGITUDINAL_COMPUTE_SUBMISSION_VERSION_V2,
  LONGITUDINAL_COMPUTE_TASK_KIND_V2,
  SequenceComputeHttpIdFactory,
  StaticComputeHttpReadinessProbe,
  type ApprovedLongitudinalExecutionBuildV2,
  type LongitudinalComputeCapabilityV2,
  type LongitudinalComputeSubmissionV2,
  type ScientificStoredLongitudinalInputV2 as HttpScientificStoredLongitudinalInputV2,
} from "@3dena/compute-service-http";

import {
  FILE_SYSTEM_RESULT_STORE_OPTIONS_VERSION,
  NODE_COMPUTE_SUPERVISOR_OPTIONS_VERSION,
  NODE_WORKER_SESSION_VERSION,
  SCIENTIFIC_ARTIFACT_PUT_REQUEST_VERSION,
  SCIENTIFIC_EXECUTION_INPUT_VERSION,
  SCIENTIFIC_INPUT_PROVIDER_VERSION,
  SCIENTIFIC_JSON_INPUT_PROVIDER_OPTIONS_VERSION,
  SCIENTIFIC_LONGITUDINAL_EXECUTION_INPUT_VERSION,
  SCIENTIFIC_LONGITUDINAL_RESULT_ARTIFACT_VERSION,
  SCIENTIFIC_LONGITUDINAL_TASK_KIND_V2,
  SCIENTIFIC_PUBLICATION_RECEIPT_VERSION,
  SCIENTIFIC_RESULT_PUBLISHER_VERSION,
  SCIENTIFIC_RESULT_ARTIFACT_VERSION,
  SCIENTIFIC_SESSION_ADAPTER_OPTIONS_VERSION,
  SCIENTIFIC_STORED_INPUT_VERSION,
  SCIENTIFIC_STORED_LONGITUDINAL_INPUT_VERSION,
  SCIENTIFIC_WORKER_PROTOCOL_VERSION,
  FileSystemImmutableResultStore,
  JsonObjectStoreScientificInputProvider,
  NodeComputeProcessSupervisor,
  ScientificWorkerSessionAdapter,
  executeScientificLongitudinalInputV2,
  resolveScientificWorkerEntry,
  type ScientificPublicationRequestV1,
  type ScientificPublicationReceiptV1,
  type ScientificResultArtifactV1,
  type ScientificLongitudinalResultArtifactV2,
  type ScientificStoredInputV1,
  type NodeWorkerSessionV1,
} from "../index";
import { bindPersistentLongitudinalRequestV2 } from "./validation";

const DATASET_HASH = "a".repeat(64);
const SPEC_HASH = "b".repeat(64);
const PRIVATE_PARTICIPANT_ID =
  "PRIVATE_PARTICIPANT_ID_MUST_NOT_ESCAPE_SCIENTIFIC_CHILD";
const HTTP_ORIGIN = "https://app.example";
const HTTP_SERVICE_TOKEN =
  "test-only-longitudinal-service-token-with-at-least-32-bytes";
const FIXED_PROJECTION_SEMANTICS =
  "one immutable fitted jENA rotation; fixed projectIn full-space recovery; participant-period reduction before group-time centroids";
const FIXED_PROJECTION_DIAGNOSTIC =
  "Full-space coordinates were projected by jENA against the immutable successful-fit rotation; no ENA accumulation or rotation fit was repeated.";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

interface CoreHarness {
  readonly rootDirectory: string;
  readonly store: FileSystemImmutableResultStore;
  readonly adapter: ScientificWorkerSessionAdapter;
  readonly supervisor: NodeComputeProcessSupervisor;
  readonly service: ComputeServiceCore;
  readonly publishStarted: Deferred<ScientificPublicationRequestV1>;
  readonly allowPublication: () => void;
  readonly publicationCount: () => number;
}

class SystemClock implements ComputeClock {
  now(): number {
    return Date.now();
  }
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Test operation did not settle.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function waitForGate(
  gate: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw new Error("SCIENTIFIC_SESSION_ABORTED");
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error("SCIENTIFIC_SESSION_ABORTED"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void gate.then(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
  });
}

function readSmallRaw(): RawRow[] {
  const text = readFileSync(
    new URL("../../../parity-contracts/fixtures/small-raw.csv", import.meta.url),
    "utf8",
  ).trim();
  const [header = "", ...lines] = text.split(/\r?\n/u);
  const columns = header.split(",").map((cell) => cell.replace(/^"|"$/gu, ""));
  return lines.map((line) => {
    const cells = line.split(",").map((cell) => cell.replace(/^"|"$/gu, ""));
    return Object.fromEntries(
      columns.map((column, index) => [
        column,
        ["EC", "ICT", "MCO", "ATT"].includes(column)
          ? Number(cells[index])
          : (cells[index] ?? ""),
      ]),
    ) as RawRow;
  });
}

function analysisInput(): AnalyzeRowsInput {
  return {
    rows: readSmallRaw().map((row) => ({
      ...row,
      Weight: row.Group === "G1" ? 1 : 2,
    })),
    mapping: {
      units: ["Group", "Name"],
      conversation: ["Lesson"],
      codes: ["EC", "ICT", "MCO", "ATT"],
      metadata: ["Weight"],
      trajectory: {
        participant: ["Name"],
        group: "Group",
        time: "Lesson",
        timeOrder: ["Lesson 1", "Lesson 2"],
        cohortPolicy: "available",
      },
    },
    config: {
      model: "AccumulatedTrajectory",
      window: "MovingStanzaWindow",
      weightBy: "binary",
      windowSizeBack: 4,
      windowSizeForward: 0,
      centerAlignToOrigin: true,
    },
  };
}

function dataset(): AnalysisExecutionDatasetV1 {
  return {
    schemaVersion: "3dena.analysis-execution-dataset.v1",
    receipt: {
      schemaVersion: DATASET_RECEIPT_VERSION_V1,
      sha256: DATASET_HASH,
      byteLength: 512,
      format: "csv",
      sheet: { index: 0, name: "CSV" },
      rows: 16,
      columns: 8,
      schema: {
        schemaVersion: "3dena.dataset-schema.v1",
        headers: [
          "Group",
          "Name",
          "Lesson",
          "EC",
          "ICT",
          "MCO",
          "ATT",
          "Weight",
        ],
        columns: [
          { name: "Group", inferredType: "string", roles: ["unit", "group"] },
          { name: "Name", inferredType: "string", roles: ["unit"] },
          {
            name: "Lesson",
            inferredType: "string",
            roles: ["conversation", "time"],
          },
          { name: "EC", inferredType: "number", roles: ["code"] },
          { name: "ICT", inferredType: "number", roles: ["code"] },
          { name: "MCO", inferredType: "number", roles: ["code"] },
          { name: "ATT", inferredType: "number", roles: ["code"] },
          { name: "Weight", inferredType: "number", roles: ["metadata"] },
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
      activationIdentity: `dataset:${DATASET_HASH}`,
    },
    specHash: SPEC_HASH,
    buildId: "compute-scientific-child-test",
    generatedAt: "2026-08-21T00:00:00.000Z",
  };
}

function analysisTask(taskId: string, deadlineAtMs: number): AnalysisTaskV1 {
  return {
    schemaVersion: ANALYSIS_TASK_VERSION_V1,
    kind: "ena-model",
    owner: {
      contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
      datasetHash: DATASET_HASH,
      specHash: SPEC_HASH,
      runId: `run-${taskId}`,
      taskId,
    },
    deadlineEpochMilliseconds: deadlineAtMs,
    input: analysisInput(),
  };
}

function computeOwner(taskId: string) {
  return {
    contractVersion: COMPUTE_TASK_OWNER_CONTRACT_VERSION,
    datasetHash: DATASET_HASH,
    specHash: SPEC_HASH,
    runId: `run-${taskId}`,
    taskId,
  } as const;
}

async function createStoredInput(
  store: FileSystemImmutableResultStore,
  taskId: string,
  deadlineAtMs: number,
  executionDataset: AnalysisExecutionDataset = dataset(),
) {
  const task = analysisTask(taskId, deadlineAtMs);
  const stored: ScientificStoredInputV1 = {
    version: SCIENTIFIC_STORED_INPUT_VERSION,
    dataset: executionDataset,
    task,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(stored));
  const input = (
    await store.putImmutable(`scientific-inputs/${taskId}.json`, bytes)
  ).descriptor;
  return { input, task };
}

async function longitudinalRequest(
  taskId: string,
): Promise<LongitudinalExecutionRequestV2> {
  const sourceTask = analysisTask(`${taskId}-source`, Date.now() + 60_000);
  const sourceEnvelope = await executeAnalysisTask(dataset(), sourceTask);
  if (
    sourceEnvelope.taskKind !== "ena-model" ||
    sourceEnvelope.result.schemaVersion !== "3dena.analysis-result.v1"
  ) throw new Error("Expected a fitted longitudinal ENA source result.");
  const result = sourceEnvelope.result;
  const trajectory = result.trajectory;
  if (trajectory === undefined) {
    throw new Error("Expected a fitted longitudinal ENA trajectory.");
  }
  const runId = `run-${taskId}`;
  const sourceResultHash = sourceEnvelope.provenance.resultHash;
  const executionDataset: AnalysisExecutionDatasetV2 = {
    schemaVersion: ANALYSIS_EXECUTION_DATASET_VERSION_V2,
    receipt: dataset().receipt,
    specHash: SPEC_HASH,
    buildId: "compute-scientific-longitudinal-source",
    generatedAt: "2026-08-24T00:00:00.000Z",
    sourceResult: {
      sourceKind: "raw-jena",
      hash: sourceResultHash,
      result,
    },
  };
  const participantColumns = result.points[0]?.participantLabel.columns;
  if (participantColumns === undefined || participantColumns.length === 0) {
    throw new Error("Expected immutable participant identity columns.");
  }
  const { bound: _bound, ...build } = getAnalysisBuildIdentityV2();
  return {
    dataset: executionDataset,
    pathTask: {
      schemaVersion: "3dena.trajectory-path-task.v2",
      kind: "trajectory-path-v2",
      datasetHash: DATASET_HASH,
      specHash: SPEC_HASH,
      runId,
      runSpec: {
        schemaVersion: "3dena.trajectory-run-spec.v2",
        sourceResultHash,
        participantColumns: [...participantColumns],
        timeColumn: "Lesson",
        groupColumn: "Group",
        orderedPeriods: trajectory.timeOrder.map((time, index) => ({
          identity: {
            components: [{
              name: "Lesson",
              type: typeof time.value === "boolean"
                ? "boolean"
                : typeof time.value === "number"
                  ? "number"
                  : "string",
              value: time.value ?? time.display,
            }],
          },
          sourceTimeCanonical: time.canonical,
          displayLabel: time.display,
          expected: true,
          value: { type: "ordered-index-v2", index },
        })),
        selectedDimensions: [...result.axes],
        cohortPolicy: "available",
        missingValuePolicy: "complete-analytical-rows",
        estimand: { kind: "equal-participant" },
      },
    },
    execution: {
      // Deliberately untrusted: the worker must normalize this server-side.
      target: "browser-worker",
      ...build,
      seed: 2026,
    },
  };
}

async function httpLongitudinalSubmission(
  taskId: string,
): Promise<{
  readonly submission: LongitudinalComputeSubmissionV2;
  readonly approvedBuild: ApprovedLongitudinalExecutionBuildV2;
}> {
  const request = structuredClone(await longitudinalRequest(taskId));
  const source = request.dataset.sourceResult;
  if (source === undefined) throw new Error("Expected a longitudinal source result.");
  const result = source.result as AnalysisResult;
  const jenaReceipt = JSON.parse(readFileSync(
    new URL("../../../../vendor/jena-js/RECEIPT.json", import.meta.url),
    "utf8",
  )) as {
    readonly version: string;
    readonly officialCommit: string;
    readonly tarballIntegrity: string;
  };
  const analysisManifest = JSON.parse(readFileSync(
    new URL("../../../../packages/analysis/package.json", import.meta.url),
    "utf8",
  )) as { readonly version: string };
  const approvedBuild: ApprovedLongitudinalExecutionBuildV2 = {
    jenaVersion: jenaReceipt.version,
    jenaCommit: jenaReceipt.officialCommit,
    jenaTarballIntegrity: jenaReceipt.tarballIntegrity,
    sdkVersion: analysisManifest.version,
    buildId: "http-node-integration-build",
  };
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
  const groupColumn = request.pathTask.runSpec.groupColumn;
  const timeColumn = request.pathTask.runSpec.timeColumn;
  result.points = result.points.map((point) => {
    const group = point.group;
    const time = point.time;
    const originalStep = point.step;
    if (group === undefined || time === undefined || originalStep === undefined) {
      throw new Error("Expected fitted longitudinal point identities.");
    }
    const participantToken = opaqueToken(
      participantTokens,
      point.participantLabel.canonical,
      "participant",
    );
    const unitToken = opaqueToken(unitTokens, point.unit.canonical, "unit");
    const stepToken = opaqueToken(stepTokens, originalStep.canonical, "step");
    let unitTokenWritten = false;
    const unitValues = point.unit.columns.map((column) => {
      if (groupColumn !== null && column === groupColumn) return group.value;
      if (!unitTokenWritten) {
        unitTokenWritten = true;
        return unitToken;
      }
      return "@opaque-unit-component";
    });
    let stepTokenWritten = false;
    const stepValues = originalStep.columns.map((column) => {
      if (column === timeColumn) return time.value;
      if (!stepTokenWritten) {
        stepTokenWritten = true;
        return stepToken;
      }
      return "@opaque-step-component";
    });
    const unit = {
      columns: [...point.unit.columns],
      values: unitValues,
      canonical: `opaque-unit:${unitToken}`,
      display: "Opaque unit",
    };
    const step = {
      columns: [...originalStep.columns],
      values: stepValues,
      canonical: `opaque-step:${stepToken}`,
      display: "Opaque step",
    };
    return {
      ...point,
      participantLabel: {
        columns: [...point.participantLabel.columns],
        values: point.participantLabel.columns.map((_, index) => (
          index === 0 ? participantToken : "@opaque-component"
        )),
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
      metadata: {},
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
  result.summary.units = new Set(result.points.map((point) => point.unit.canonical)).size;
  result.diagnostics = [{
    code: "FITTED_JENA_FIXED_ROTATION_ADAPTER_V2",
    severity: "info",
    message: FIXED_PROJECTION_DIAGNOSTIC,
    path: "provenance.resultSemantics",
  }];
  result.provenance.adapter = "@3dena/analysis";
  result.provenance.adapterVersion = approvedBuild.sdkVersion;
  result.provenance.jenaPackage = "jena-js";
  result.provenance.jenaVersion = approvedBuild.jenaVersion;
  result.provenance.jenaCommit = approvedBuild.jenaCommit;
  result.provenance.resultSemantics = FIXED_PROJECTION_SEMANTICS;
  request.dataset.buildId = approvedBuild.buildId;
  source.hash = await hashAnalysisValueV1(result);
  request.pathTask.runSpec.sourceResultHash = source.hash;
  const specHash = await hashAnalysisValueV1(request.pathTask.runSpec);
  request.dataset.specHash = specHash;
  request.pathTask.specHash = specHash;
  request.dataset.receipt.activationIdentity =
    `open-ena:${request.pathTask.datasetHash}:${specHash}`;
  return {
    approvedBuild,
    submission: {
      schemaVersion: LONGITUDINAL_COMPUTE_SUBMISSION_VERSION_V2,
      dataset: request.dataset,
      pathTask: request.pathTask,
      seed: request.execution.seed,
      processingPolicyConfirmed: true,
    },
  };
}

async function createStoredLongitudinalInput(
  store: ComputeObjectStore,
  taskId: string,
  deadlineAtMs: number,
  requestOverride?: LongitudinalExecutionRequestV2,
) {
  const request = requestOverride ?? await longitudinalRequest(taskId);
  const stored: HttpScientificStoredLongitudinalInputV2 = {
    version: SCIENTIFIC_STORED_LONGITUDINAL_INPUT_VERSION,
    kind: SCIENTIFIC_LONGITUDINAL_TASK_KIND_V2,
    owner: { ...computeOwner(taskId), contractVersion: ANALYSIS_CONTRACT_VERSION_V1 },
    deadlineAtMs,
    request,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(stored));
  const input = (
    await store.putImmutable(`scientific-inputs/${taskId}.json`, bytes)
  ).descriptor;
  return { input, request, stored };
}

function createRequest(
  taskId: string,
  input: ComputeTaskRequestV1["input"],
  deadlineAtMs: number,
  taskKind = "ena-model",
): ComputeTaskRequestV1 {
  return {
    version: COMPUTE_TASK_REQUEST_VERSION,
    owner: computeOwner(taskId),
    taskKind,
    input,
    deadlineAtMs,
    expiresAtMs: deadlineAtMs + 10_000,
  };
}

function createSupervisor(
  adapter: ScientificWorkerSessionAdapter,
): NodeComputeProcessSupervisor {
  return new NodeComputeProcessSupervisor(
    {
      version: NODE_COMPUTE_SUPERVISOR_OPTIONS_VERSION,
      workerEntry: resolveScientificWorkerEntry(),
      environment: { NODE_ENV: "test", LANG: "C.UTF-8", TZ: "UTC" },
      terminationGraceMs: 100,
    },
    adapter,
  );
}

async function createCoreHarness(
  injectedPublicationFailure?: string,
): Promise<CoreHarness> {
  const rootDirectory = await mkdtemp(join(tmpdir(), "3dena-scientific-child-"));
  const store = new FileSystemImmutableResultStore({
    version: FILE_SYSTEM_RESULT_STORE_OPTIONS_VERSION,
    rootDirectory,
  });
  const publishStarted = deferred<ScientificPublicationRequestV1>();
  const publicationGate = deferred<void>();
  let publications = 0;
  let service: ComputeServiceCore | undefined;
  const publisher = {
    version: SCIENTIFIC_RESULT_PUBLISHER_VERSION,
    async publish(
      request: ScientificPublicationRequestV1,
      signal: AbortSignal,
    ): Promise<ScientificPublicationReceiptV1> {
      publications += 1;
      publishStarted.resolve(structuredClone(request));
      await waitForGate(publicationGate.promise, signal);
      if (service === undefined || signal.aborted) {
        throw new Error("SCIENTIFIC_SESSION_ABORTED");
      }
      if (injectedPublicationFailure !== undefined) {
        throw new Error(injectedPublicationFailure);
      }
      const record = await service.publishResult(
        request.owner.taskId,
        request.lease,
        request.object,
      );
      if (record.result === undefined) throw new Error("PUBLICATION_NOT_OBSERVED");
      return {
        version: SCIENTIFIC_PUBLICATION_RECEIPT_VERSION,
        accepted: true,
        executionId: request.executionId,
        owner: { ...request.owner },
        leaseId: request.lease.leaseId,
        leaseEpoch: request.lease.epoch,
        object: { ...request.object },
        publishedAtMs: record.result.publishedAtMs,
      };
    },
  } as const;
  const inputProvider = new JsonObjectStoreScientificInputProvider({
    version: SCIENTIFIC_JSON_INPUT_PROVIDER_OPTIONS_VERSION,
    objectStore: store,
  });
  expect(inputProvider.version).toBe(SCIENTIFIC_INPUT_PROVIDER_VERSION);
  const adapter = new ScientificWorkerSessionAdapter({
    version: SCIENTIFIC_SESSION_ADAPTER_OPTIONS_VERSION,
    inputProvider,
    resultStore: store,
    publisher,
  });
  const supervisor = createSupervisor(adapter);
  service = new ComputeServiceCore({
    repository: new InMemoryComputeTaskRepository(),
    objectStore: store,
    processSupervisor: supervisor,
    auditSink: new InMemoryComputeAuditSink(),
    clock: new SystemClock(),
    idFactory: new SequenceComputeIdFactory(),
    maxConcurrency: 1,
    maxLeaseDurationMs: 30_000,
    maxProcessLaunchDurationMs: 5_000,
  });
  return {
    rootDirectory,
    store,
    adapter,
    supervisor,
    service,
    publishStarted,
    allowPublication: () => publicationGate.resolve(),
    publicationCount: () => publications,
  };
}

async function startCoreExecution(
  harness: CoreHarness,
  taskId: string,
  deadlineAtMs: number,
) {
  const { input } = await createStoredInput(
    harness.store,
    taskId,
    deadlineAtMs,
  );
  await harness.service.createTask(createRequest(taskId, input, deadlineAtMs));
  const lease = await harness.service.claimTask(taskId, {
    leaseId: `lease-${taskId}`,
    holderId: "scientific-worker-test",
    durationMs: Math.max(1, Math.min(25_000, deadlineAtMs - Date.now())),
  });
  const running = await harness.service.executeTask(taskId, lease);
  return { input, lease, running };
}

async function startCoreLongitudinalExecution(
  harness: CoreHarness,
  taskId: string,
  deadlineAtMs: number,
) {
  const { input, request } = await createStoredLongitudinalInput(
    harness.store,
    taskId,
    deadlineAtMs,
  );
  await harness.service.createTask(
    createRequest(
      taskId,
      input,
      deadlineAtMs,
      SCIENTIFIC_LONGITUDINAL_TASK_KIND_V2,
    ),
  );
  const lease = await harness.service.claimTask(taskId, {
    leaseId: `lease-${taskId}`,
    holderId: "scientific-worker-test",
    durationMs: Math.max(1, Math.min(25_000, deadlineAtMs - Date.now())),
  });
  const running = await harness.service.executeTask(taskId, lease);
  return { input, lease, request, running };
}

async function cleanHarness(harness: CoreHarness, taskId: string): Promise<void> {
  try {
    const record = await harness.service.getTask(taskId);
    if (
      record !== null &&
      ["starting", "running", "cancelling"].includes(record.state)
    ) {
      await harness.service.cancelTask(taskId);
    }
    await withTimeout(harness.service.settleBackground(), 5_000);
  } catch {
    // The test assertion remains authoritative; cleanup is best effort.
  }
  await rm(harness.rootDirectory, { recursive: true, force: true });
}

describe.sequential("scientific child-process candidate", () => {
  it("strictly validates durable longitudinal V2 input, bindings, and deadline", async () => {
    const objectStore = new InMemoryComputeObjectStore();
    const provider = new JsonObjectStoreScientificInputProvider({
      version: SCIENTIFIC_JSON_INPUT_PROVIDER_OPTIONS_VERSION,
      objectStore,
    });
    const taskId = "longitudinal-input-v2";
    const deadlineAtMs = Date.now() + 60_000;
    const { input, request, stored } = await createStoredLongitudinalInput(
      objectStore,
      taskId,
      deadlineAtMs,
    );
    const contextFor = (
      descriptor: ComputeTaskRequestV1["input"],
      deadline = deadlineAtMs,
    ): ProcessLaunchContextV1 => ({
      owner: computeOwner(taskId),
      taskRef: `task-ref-${taskId}`,
      request: createRequest(
        taskId,
        descriptor,
        deadline,
        SCIENTIFIC_LONGITUDINAL_TASK_KIND_V2,
      ),
      lease: {
        version: COMPUTE_LEASE_VERSION,
        leaseId: `lease-${taskId}`,
        holderId: "scientific-worker-test",
        epoch: 1,
        issuedAtMs: Date.now(),
        expiresAtMs: deadline + 10_000,
      },
      executionId: `execution-${taskId}`,
      resultObjectKey: `compute-results/${taskId}/result.json`,
    });

    const validatedInput = await provider.load(
      contextFor(input),
      new AbortController().signal,
    );
    expect(validatedInput).toMatchObject({
        version: SCIENTIFIC_LONGITUDINAL_EXECUTION_INPUT_VERSION,
        kind: SCIENTIFIC_LONGITUDINAL_TASK_KIND_V2,
        deadlineAtMs,
        requestHash: await hashLongitudinalExecutionRequestV2(request),
        request: {
          execution: { target: "persistent-compute-service" },
          pathTask: { runId: `run-${taskId}` },
        },
      });
    if (validatedInput.version !== SCIENTIFIC_LONGITUDINAL_EXECUTION_INPUT_VERSION) {
      throw new Error("Expected the longitudinal execution input discriminant.");
    }
    const directArtifact = await executeScientificLongitudinalInputV2(validatedInput);
    expect(directArtifact).toMatchObject({
      requestHash: validatedInput.requestHash,
      bundle: {
        identity: { requestHash: validatedInput.requestHash },
        execution: { target: "persistent-compute-service" },
      },
    });
    await expect(verifyLongitudinalAnalysisBundleV2(directArtifact.bundle)).resolves.toBeUndefined();
    expect(SCIENTIFIC_STORED_LONGITUDINAL_INPUT_VERSION)
      .toBe(LONGITUDINAL_COMPUTE_STORED_INPUT_VERSION_V2);
    expect(SCIENTIFIC_LONGITUDINAL_TASK_KIND_V2)
      .toBe(LONGITUDINAL_COMPUTE_TASK_KIND_V2);

    const invalidAnalysisOwners = [
      ["contractVersion", COMPUTE_TASK_OWNER_CONTRACT_VERSION],
      ["datasetHash", "d".repeat(64)],
      ["specHash", "e".repeat(64)],
      ["runId", "wrong-http-run"],
      ["taskId", "wrong-http-task"],
    ] as const;
    for (const [field, value] of invalidAnalysisOwners) {
      const invalidOwnerBytes = new TextEncoder().encode(JSON.stringify({
        ...stored,
        owner: { ...stored.owner, [field]: value },
      }));
      const invalidOwnerInput = (await objectStore.putImmutable(
        `scientific-inputs/${taskId}-owner-${field}.json`,
        invalidOwnerBytes,
      )).descriptor;
      await expect(
        provider.load(contextFor(invalidOwnerInput), new AbortController().signal),
        field,
      ).rejects.toMatchObject({ code: "INVALID_EXECUTION_INPUT" });
    }

    const wrongKindBytes = new TextEncoder().encode(JSON.stringify({
      ...stored,
      kind: "longitudinal-v2",
    }));
    const wrongKindInput = (await objectStore.putImmutable(
      `scientific-inputs/${taskId}-wrong-kind.json`,
      wrongKindBytes,
    )).descriptor;
    await expect(
      provider.load(contextFor(wrongKindInput), new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_EXECUTION_INPUT" });

    const mismatchedBuildBytes = new TextEncoder().encode(JSON.stringify({
      ...stored,
      request: {
        ...request,
        execution: { ...request.execution, buildId: "caller-selected-build" },
      },
    }));
    const mismatchedBuildInput = (await objectStore.putImmutable(
      `scientific-inputs/${taskId}-mismatched-build.json`,
      mismatchedBuildBytes,
    )).descriptor;
    await expect(
      provider.load(contextFor(mismatchedBuildInput), new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_EXECUTION_INPUT" });

    const unknownBytes = new TextEncoder().encode(JSON.stringify({
      ...stored,
      unknown: true,
    }));
    const unknownInput = (await objectStore.putImmutable(
      `scientific-inputs/${taskId}-unknown.json`,
      unknownBytes,
    )).descriptor;
    await expect(
      provider.load(contextFor(unknownInput), new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_EXECUTION_INPUT" });

    const mismatchedRequest: LongitudinalExecutionRequestV2 = {
      ...request,
      pathTask: { ...request.pathTask, runId: "wrong-run-binding" },
    };
    const mismatchedBytes = new TextEncoder().encode(JSON.stringify({
      ...stored,
      request: mismatchedRequest,
    }));
    const mismatchedInput = (await objectStore.putImmutable(
      `scientific-inputs/${taskId}-mismatched.json`,
      mismatchedBytes,
    )).descriptor;
    await expect(
      provider.load(contextFor(mismatchedInput), new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_EXECUTION_INPUT" });

    await expect(
      provider.load(
        contextFor(input, deadlineAtMs + 1),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INVALID_EXECUTION_INPUT" });
  });

  it("executes the exact immutable wrapper emitted by the real HTTP V2 route", async () => {
    const now = Date.now();
    const { submission, approvedBuild } = await httpLongitudinalSubmission(
      "http-router-node-worker",
    );
    const objectStore = new InMemoryComputeObjectStore();
    const core = new ComputeServiceCore({
      repository: new InMemoryComputeTaskRepository(),
      objectStore,
      processSupervisor: new InMemoryComputeProcessSupervisor(),
      auditSink: new InMemoryComputeAuditSink(),
      clock: new ManualComputeClock(now),
      idFactory: new SequenceComputeIdFactory(),
      maxConcurrency: 1,
      maxLeaseDurationMs: 60_000,
    });
    const httpRepository = new InMemoryComputeHttpJobRepository();
    const router = new ComputeV1HttpRouter({
      core,
      infrastructure: {
        repository: httpRepository,
        objectStore,
        clock: new ManualComputeClock(now),
        idFactory: new SequenceComputeHttpIdFactory(),
        capabilityCodec: new HmacComputeHttpCapabilityCodec(
          "test-only-capability-secret-with-at-least-32-bytes",
        ),
        objectUrls: new InMemoryComputeHttpObjectUrlIssuer(
          "https://objects.example/private/",
        ),
        events: new InMemoryComputeHttpEventBroker(),
        readiness: new StaticComputeHttpReadinessProbe(true),
        rateLimiter: {
          async consume() {
            return { allowed: true, retryAfterSeconds: 1 };
          },
        },
      },
      allowedOrigins: [HTTP_ORIGIN],
      buildIdentity: {
        approvalManifestSha256: "9".repeat(64),
        releaseId: "release-node-http-integration",
        gitCommit: "8".repeat(40),
        flyImageDigest: `sha256:${"7".repeat(64)}`,
        flyBuildId: "compute-http-node-integration",
        contractVersions: [ANALYSIS_CONTRACT_VERSION_V1],
      },
      approvedLongitudinalBuild: approvedBuild,
      longitudinalServiceTokenSha256: createHash("sha256")
        .update(new TextEncoder().encode(HTTP_SERVICE_TOKEN))
        .digest("hex"),
      jobTtlMs: 60 * 60_000,
      maxTaskRuntimeMs: 60_000,
    });
    const response = await router.handle(new Request(
      "https://compute.example/v2/longitudinal-jobs",
      {
        method: "POST",
        headers: {
          origin: HTTP_ORIGIN,
          "content-type": "application/json",
          "idempotency-key": "http-to-node-worker-0001",
          "x-3dena-service-token": HTTP_SERVICE_TOKEN,
          "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
        },
        body: JSON.stringify(submission),
      },
    ));
    expect(response.status).toBe(201);
    const capability = (await response.json()) as LongitudinalComputeCapabilityV2;
    const httpRecord = await httpRepository.get(capability.jobId);
    const coreRecord = await core.getTask(capability.jobId);
    if (httpRecord === null || coreRecord === null) {
      throw new Error("Expected the HTTP route to create one durable core task.");
    }
    const storedBytes = await objectStore.get(httpRecord.inputObjectKey);
    if (storedBytes === null) throw new Error("Expected HTTP-owned immutable input bytes.");
    const stored = JSON.parse(
      new TextDecoder().decode(storedBytes),
    ) as HttpScientificStoredLongitudinalInputV2;
    expect(stored).toMatchObject({
      version: LONGITUDINAL_COMPUTE_STORED_INPUT_VERSION_V2,
      kind: LONGITUDINAL_COMPUTE_TASK_KIND_V2,
      owner: httpRecord.owner,
      deadlineAtMs: coreRecord.request.deadlineAtMs,
      request: { execution: { target: "persistent-compute-service", ...approvedBuild } },
    });
    expect(storedBytes.byteLength).toBe(coreRecord.request.input.byteLength);
    expect(createHash("sha256").update(storedBytes).digest("hex"))
      .toBe(coreRecord.request.input.sha256);

    const context: ProcessLaunchContextV1 = {
      owner: coreRecord.request.owner,
      taskRef: `task-ref-${capability.jobId}`,
      request: coreRecord.request,
      lease: {
        version: COMPUTE_LEASE_VERSION,
        leaseId: `lease-${capability.jobId}`,
        holderId: "scientific-worker-test",
        epoch: 1,
        issuedAtMs: now,
        expiresAtMs: coreRecord.request.deadlineAtMs,
      },
      executionId: `execution-${capability.jobId}`,
      resultObjectKey: `compute-results/${capability.jobId}/result.json`,
    };
    vi.resetModules();
    vi.stubGlobal("__THREEDENA_JENA_VERSION__", approvedBuild.jenaVersion);
    vi.stubGlobal("__THREEDENA_JENA_COMMIT__", approvedBuild.jenaCommit);
    vi.stubGlobal(
      "__THREEDENA_JENA_TARBALL_INTEGRITY__",
      approvedBuild.jenaTarballIntegrity,
    );
    vi.stubGlobal("__THREEDENA_SDK_VERSION__", approvedBuild.sdkVersion);
    vi.stubGlobal("__THREEDENA_BUILD_ID__", approvedBuild.buildId);
    try {
      // Reload the node runtime after installing the same build identity that
      // the real HTTP route injected. This exercises the production binding
      // without weakening the unbound-source fail-closed contract.
      const boundRuntime = await import("../index");
      const provider = new boundRuntime.JsonObjectStoreScientificInputProvider({
        version: SCIENTIFIC_JSON_INPUT_PROVIDER_OPTIONS_VERSION,
        objectStore,
      });
      const loaded = await provider.load(context, new AbortController().signal);
      expect(loaded).toMatchObject({
        version: SCIENTIFIC_LONGITUDINAL_EXECUTION_INPUT_VERSION,
        kind: LONGITUDINAL_COMPUTE_TASK_KIND_V2,
        source: coreRecord.request.input,
        owner: coreRecord.request.owner,
        deadlineAtMs: coreRecord.request.deadlineAtMs,
        request: { execution: { target: "persistent-compute-service", ...approvedBuild } },
      });

      const invalidContextCases: Array<{
        readonly label: string;
        readonly context: ProcessLaunchContextV1;
      }> = [
        ...(["contractVersion", "datasetHash", "specHash", "runId", "taskId"] as const).map((field) => ({
          label: `context owner ${field}`,
          context: {
            ...context,
            owner: {
              ...context.owner,
              [field]: field === "contractVersion"
                ? ANALYSIS_CONTRACT_VERSION_V1
                : field.endsWith("Hash")
                  ? "f".repeat(64)
                  : `wrong-${field}`,
            },
          } as ProcessLaunchContextV1,
        })),
        {
          label: "deadline",
          context: {
            ...context,
            request: { ...context.request, deadlineAtMs: context.request.deadlineAtMs + 1 },
          },
        },
        {
          label: "task kind",
          context: {
            ...context,
            request: { ...context.request, taskKind: "ena-model" },
          },
        },
        {
          label: "source descriptor",
          context: {
            ...context,
            request: {
              ...context.request,
              input: { ...context.request.input, sha256: "0".repeat(64) },
            },
          },
        },
      ];
      for (const candidate of invalidContextCases) {
        await expect(
          provider.load(candidate.context, new AbortController().signal),
          candidate.label,
        ).rejects.toMatchObject({ code: "INVALID_EXECUTION_INPUT" });
      }
      if (loaded.version !== SCIENTIFIC_LONGITUDINAL_EXECUTION_INPUT_VERSION) {
        throw new Error("Expected a bound longitudinal worker input.");
      }
      const artifact = await boundRuntime.executeScientificLongitudinalInputV2(loaded);
      expect(artifact).toMatchObject({
        version: SCIENTIFIC_LONGITUDINAL_RESULT_ARTIFACT_VERSION,
        owner: coreRecord.request.owner,
        taskKind: LONGITUDINAL_COMPUTE_TASK_KIND_V2,
        requestHash: loaded.requestHash,
        bundle: {
          identity: { requestHash: loaded.requestHash },
          execution: { target: "persistent-compute-service", ...approvedBuild },
        },
      });
      expect(artifact.bundle.codeGeometry.nodes.length).toBeGreaterThan(0);
      expect(artifact.bundle.networkOverlays).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it("fails closed in production when the scientific bundle lacks an injected build identity", async () => {
    const request = await longitudinalRequest("production-unbound-build");
    expect(getAnalysisBuildIdentityV2().bound).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => bindPersistentLongitudinalRequestV2(request))
        .toThrowError(expect.objectContaining({ code: "INVALID_EXECUTION_INPUT" }));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("loads and validates all seven discriminated task variants from immutable worker input", async () => {
    const objectStore = new InMemoryComputeObjectStore();
    const provider = new JsonObjectStoreScientificInputProvider({
      version: SCIENTIFIC_JSON_INPUT_PROVIDER_OPTIONS_VERSION,
      objectStore,
    });
    const deadlineAtMs = Date.now() + 60_000;
    const sourceTask = analysisTask("seven-source", deadlineAtMs);
    const sourceEnvelope = await executeAnalysisTask(dataset(), sourceTask);
    if (sourceEnvelope.taskKind !== "ena-model" ||
        sourceEnvelope.result.schemaVersion !== "3dena.analysis-result.v1") {
      throw new Error("Expected an ENA source result.");
    }
    const baseDataset = dataset();
    const derivedDataset: AnalysisExecutionDatasetV2 = {
      schemaVersion: ANALYSIS_EXECUTION_DATASET_VERSION_V2,
      receipt: baseDataset.receipt,
      specHash: SPEC_HASH,
      buildId: baseDataset.buildId,
      generatedAt: "2026-08-21T00:00:00.000Z",
      sourceResult: {
        sourceKind: "raw-jena",
        hash: sourceEnvelope.provenance.resultHash,
        result: sourceEnvelope.result,
      },
    };
    const owner = (taskId: string) => ({
      contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
      datasetHash: DATASET_HASH,
      specHash: SPEC_HASH,
      runId: `run-${taskId}`,
      taskId,
    }) as const;
    const tasks: readonly AnalysisTaskV1[] = [
      sourceTask,
      {
        schemaVersion: ANALYSIS_TASK_VERSION_V1,
        kind: "network-comparison",
        owner: owner("seven-network"),
        deadlineEpochMilliseconds: deadlineAtMs,
        sourceResultHash: sourceEnvelope.provenance.resultHash,
        groups: ["G1", "G2"],
      },
      {
        schemaVersion: ANALYSIS_TASK_VERSION_V1,
        kind: "change-network",
        owner: owner("seven-change"),
        deadlineEpochMilliseconds: deadlineAtMs,
        sourceResultHash: sourceEnvelope.provenance.resultHash,
        field: "@group",
        level: "G1",
      },
      {
        schemaVersion: ANALYSIS_TASK_VERSION_V1,
        kind: "statistics",
        owner: owner("seven-statistics"),
        deadlineEpochMilliseconds: deadlineAtMs,
        sourceResultHash: sourceEnvelope.provenance.resultHash,
        design: "independent",
        groups: ["G1", "G2"],
        dimensions: ["SVD1"],
        alternative: "two-sided",
        adjustment: "holm",
        samePhysicalEntityConfirmed: false,
      },
      {
        schemaVersion: ANALYSIS_TASK_VERSION_V1,
        kind: "trajectory",
        owner: owner("seven-trajectory"),
        deadlineEpochMilliseconds: deadlineAtMs,
        sourceResultHash: sourceEnvelope.provenance.resultHash,
        group: "G1",
        selectedDimensions: ["SVD1", "SVD2", "SVD3"],
        cohortPolicy: "available",
        periods: [{
          sourceTimeCanonical: "s:Lesson 1",
          value: { type: "numeric-v1", value: 1, unit: "period" },
        }],
        estimand: { kind: "equal-participant-v1" },
      },
      {
        schemaVersion: ANALYSIS_TASK_VERSION_V1,
        kind: "trajectory-comparison",
        owner: owner("seven-trajectory-comparison"),
        deadlineEpochMilliseconds: deadlineAtMs,
        sourceResultHash: sourceEnvelope.provenance.resultHash,
        design: "independent",
        groups: ["G1", "G2"],
        samePhysicalEntityConfirmed: false,
      },
      {
        schemaVersion: ANALYSIS_TASK_VERSION_V1,
        kind: "bootstrap",
        owner: owner("seven-bootstrap"),
        deadlineEpochMilliseconds: deadlineAtMs,
        sourceResultHash: sourceEnvelope.provenance.resultHash,
        group: "G1",
        replicates: 200,
        confidenceLevel: 0.95,
        seed: 2026,
        interval: "pointwise-percentile-type7",
        rotationPolicy: "fixed-preprojected",
      },
    ];
    for (const task of tasks) {
      const executionDataset = task.kind === "ena-model" ? baseDataset : derivedDataset;
      const stored: ScientificStoredInputV1 = {
        version: SCIENTIFIC_STORED_INPUT_VERSION,
        dataset: executionDataset,
        task,
      };
      const descriptor = (await objectStore.putImmutable(
        `scientific-inputs/${task.owner.taskId}.json`,
        new TextEncoder().encode(JSON.stringify(stored)),
      )).descriptor;
      const now = Date.now();
      const context: ProcessLaunchContextV1 = {
        owner: computeOwner(task.owner.taskId),
        taskRef: `task-ref-${task.owner.taskId}`,
        request: {
          ...createRequest(task.owner.taskId, descriptor, deadlineAtMs),
          taskKind: task.kind,
        },
        lease: {
          version: COMPUTE_LEASE_VERSION,
          leaseId: `lease-${task.owner.taskId}`,
          holderId: "scientific-worker-test",
          epoch: 1,
          issuedAtMs: now,
          expiresAtMs: deadlineAtMs,
        },
        executionId: `execution-${task.owner.taskId}`,
        resultObjectKey: `compute-results/${task.owner.taskId}/result.json`,
      };
      await expect(provider.load(context, new AbortController().signal))
        .resolves.toMatchObject({ task: { kind: task.kind } });
    }
  });

  it("re-hashes immutable input bytes instead of trusting a mismatched object-store head", async () => {
    const taskId = "scientific-input-receipt";
    const deadlineAtMs = Date.now() + 8_000;
    const stored: ScientificStoredInputV1 = {
      version: SCIENTIFIC_STORED_INPUT_VERSION,
      dataset: dataset(),
      task: analysisTask(taskId, deadlineAtMs),
    };
    const expectedBytes = new TextEncoder().encode(JSON.stringify(stored));
    const returnedBytes = Uint8Array.from(expectedBytes);
    returnedBytes[0] = returnedBytes[0] === 0x7b ? 0x5b : 0x7b;
    const input = {
      key: `scientific-inputs/${taskId}.json`,
      sha256: createHash("sha256").update(expectedBytes).digest("hex"),
      byteLength: expectedBytes.byteLength,
    };
    const mismatchedStore: ComputeObjectStore = {
      async putImmutable() {
        throw new Error(PRIVATE_PARTICIPANT_ID);
      },
      async head() {
        return input;
      },
      async get() {
        return returnedBytes;
      },
      async delete() {
        throw new Error(PRIVATE_PARTICIPANT_ID);
      },
    };
    const provider = new JsonObjectStoreScientificInputProvider({
      version: SCIENTIFIC_JSON_INPUT_PROVIDER_OPTIONS_VERSION,
      objectStore: mismatchedStore,
    });
    const now = Date.now();
    const owner = computeOwner(taskId);
    const context: ProcessLaunchContextV1 = {
      owner,
      taskRef: "scientific-input-receipt-task-ref",
      request: createRequest(taskId, input, deadlineAtMs),
      lease: {
        version: COMPUTE_LEASE_VERSION,
        leaseId: "lease-scientific-input-receipt",
        holderId: "scientific-worker-test",
        epoch: 1,
        issuedAtMs: now,
        expiresAtMs: deadlineAtMs,
      },
      executionId: "execution-scientific-input-receipt",
      resultObjectKey:
        "compute-results/scientific-input-receipt-task-ref/result.bin",
    };
    const rejected = await provider
      .load(context, new AbortController().signal)
      .catch((error: unknown) => error);
    expect(rejected).toMatchObject({ code: "INVALID_EXECUTION_INPUT" });
    expect(String(rejected)).not.toContain(PRIVATE_PARTICIPANT_ID);
    expect(JSON.stringify(rejected)).not.toContain(PRIVATE_PARTICIPANT_ID);
  });

  it("rejects an artifact whose internal analysis owner differs from the lease-bound compute owner", async () => {
    const taskId = "scientific-artifact-owner";
    const deadlineAtMs = Date.now() + 8_000;
    const owner = computeOwner(taskId);
    const lease = {
      version: COMPUTE_LEASE_VERSION,
      leaseId: "lease-scientific-artifact-owner",
      holderId: "scientific-worker-test",
      epoch: 1,
      issuedAtMs: Date.now(),
      expiresAtMs: deadlineAtMs,
    } as const;
    const input = {
      key: `scientific-inputs/${taskId}.json`,
      sha256: "c".repeat(64),
      byteLength: 1,
    };
    const context: ProcessLaunchContextV1 = {
      owner,
      taskRef: "scientific-artifact-owner-task-ref",
      request: createRequest(taskId, input, deadlineAtMs),
      lease,
      executionId: "execution-scientific-artifact-owner",
      resultObjectKey:
        "compute-results/scientific-artifact-owner-task-ref/result.bin",
    };
    const resultStore = new InMemoryComputeObjectStore();
    const validEnvelope = await executeAnalysisTask(
      dataset(),
      analysisTask(taskId, deadlineAtMs),
    );
    let publicationCount = 0;
    const adapter = new ScientificWorkerSessionAdapter({
      version: SCIENTIFIC_SESSION_ADAPTER_OPTIONS_VERSION,
      inputProvider: {
        version: SCIENTIFIC_INPUT_PROVIDER_VERSION,
        async load() {
          return {
            version: SCIENTIFIC_EXECUTION_INPUT_VERSION,
            source: input,
            dataset: dataset(),
            task: analysisTask(taskId, deadlineAtMs),
          };
        },
      },
      resultStore,
      publisher: {
        version: SCIENTIFIC_RESULT_PUBLISHER_VERSION,
        async publish() {
          publicationCount += 1;
          throw new Error(PRIVATE_PARTICIPANT_ID);
        },
      },
    });
    const wrongOwner = {
      contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
      datasetHash: "d".repeat(64),
      specHash: SPEC_HASH,
      runId: owner.runId,
      taskId: owner.taskId,
    };
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        version: SCIENTIFIC_RESULT_ARTIFACT_VERSION,
        owner: wrongOwner,
        taskKind: "ena-model",
        envelope: { ...validEnvelope, owner: wrongOwner },
      }),
    );
    const descriptor = {
      key: context.resultObjectKey,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.byteLength,
    };
    const controller = new AbortController();
    const session: NodeWorkerSessionV1 = {
      version: NODE_WORKER_SESSION_VERSION,
      childId: "child-scientific-artifact-owner",
      executionId: context.executionId,
      context,
      signal: controller.signal,
      async send() {
        throw new Error(PRIVATE_PARTICIPANT_ID);
      },
      async requestTermination() {
        controller.abort();
      },
    };
    const rejected = await adapter
      .handleMessage(session, {
        version: SCIENTIFIC_ARTIFACT_PUT_REQUEST_VERSION,
        protocolVersion: SCIENTIFIC_WORKER_PROTOCOL_VERSION,
        type: "artifact-put-request",
        executionId: context.executionId,
        owner,
        lease,
        object: descriptor,
        bytes,
      })
      .catch((error: unknown) => error);
    expect(rejected).toMatchObject({ code: "ARTIFACT_BINDING_MISMATCH" });
    expect(await resultStore.head(descriptor.key)).toBeNull();
    expect(publicationCount).toBe(0);
    expect(String(rejected)).not.toContain(PRIVATE_PARTICIPANT_ID);
    expect(JSON.stringify(rejected)).not.toContain(PRIVATE_PARTICIPANT_ID);

    const malformedEnvelope = structuredClone(validEnvelope);
    (malformedEnvelope.provenance as unknown as Record<string, unknown>).unknown = true;
    const malformedBytes = new TextEncoder().encode(JSON.stringify({
      version: SCIENTIFIC_RESULT_ARTIFACT_VERSION,
      owner: validEnvelope.owner,
      taskKind: validEnvelope.taskKind,
      envelope: malformedEnvelope,
    }));
    const malformedDescriptor = {
      key: context.resultObjectKey,
      sha256: createHash("sha256").update(malformedBytes).digest("hex"),
      byteLength: malformedBytes.byteLength,
    };
    const malformed = await adapter.handleMessage(session, {
      version: SCIENTIFIC_ARTIFACT_PUT_REQUEST_VERSION,
      protocolVersion: SCIENTIFIC_WORKER_PROTOCOL_VERSION,
      type: "artifact-put-request",
      executionId: context.executionId,
      owner,
      lease,
      object: malformedDescriptor,
      bytes: malformedBytes,
    }).catch((error: unknown) => error);
    expect(malformed).toMatchObject({ code: "ARTIFACT_BINDING_MISMATCH" });
    expect(await resultStore.head(malformedDescriptor.key)).toBeNull();
    expect(publicationCount).toBe(0);
  });

  it("rejects a rehashed longitudinal artifact that is not bound to the prepared canonical request", async () => {
    const taskId = "scientific-longitudinal-artifact-binding";
    const deadlineAtMs = Date.now() + 20_000;
    const objectStore = new InMemoryComputeObjectStore();
    const { input } = await createStoredLongitudinalInput(
      objectStore,
      taskId,
      deadlineAtMs,
    );
    const context: ProcessLaunchContextV1 = {
      owner: computeOwner(taskId),
      taskRef: `task-ref-${taskId}`,
      request: createRequest(
        taskId,
        input,
        deadlineAtMs,
        SCIENTIFIC_LONGITUDINAL_TASK_KIND_V2,
      ),
      lease: {
        version: COMPUTE_LEASE_VERSION,
        leaseId: `lease-${taskId}`,
        holderId: "scientific-worker-test",
        epoch: 1,
        issuedAtMs: Date.now(),
        expiresAtMs: deadlineAtMs,
      },
      executionId: `execution-${taskId}`,
      resultObjectKey: `compute-results/${taskId}/result.json`,
    };
    const resultStore = new InMemoryComputeObjectStore();
    let publicationCount = 0;
    const adapter = new ScientificWorkerSessionAdapter({
      version: SCIENTIFIC_SESSION_ADAPTER_OPTIONS_VERSION,
      inputProvider: new JsonObjectStoreScientificInputProvider({
        version: SCIENTIFIC_JSON_INPUT_PROVIDER_OPTIONS_VERSION,
        objectStore,
      }),
      resultStore,
      publisher: {
        version: SCIENTIFIC_RESULT_PUBLISHER_VERSION,
        async publish() {
          publicationCount += 1;
          throw new Error(PRIVATE_PARTICIPANT_ID);
        },
      },
    });
    const controller = new AbortController();
    const launch = await adapter.prepareLaunchPayload(context, {
      version: COMPUTE_PROCESS_LAUNCH_CONTROL_VERSION,
      deadlineAtMs,
      signal: controller.signal,
    });
    if (launch.input.version !== SCIENTIFIC_LONGITUDINAL_EXECUTION_INPUT_VERSION) {
      throw new Error("Expected the longitudinal worker execution input.");
    }
    const bundle = await executeLongitudinalAnalysisV2(launch.input.request);
    const session: NodeWorkerSessionV1 = {
      version: NODE_WORKER_SESSION_VERSION,
      childId: `child-${taskId}`,
      executionId: context.executionId,
      context,
      signal: controller.signal,
      async send() {
        throw new Error(PRIVATE_PARTICIPANT_ID);
      },
      async requestTermination() {
        controller.abort();
      },
    };

    const artifacts: ScientificLongitudinalResultArtifactV2[] = [
      {
        version: SCIENTIFIC_LONGITUDINAL_RESULT_ARTIFACT_VERSION,
        owner: computeOwner(taskId),
        taskKind: SCIENTIFIC_LONGITUDINAL_TASK_KIND_V2,
        requestHash: "d".repeat(64),
        bundle,
      },
      {
        version: SCIENTIFIC_LONGITUDINAL_RESULT_ARTIFACT_VERSION,
        owner: computeOwner(taskId),
        taskKind: SCIENTIFIC_LONGITUDINAL_TASK_KIND_V2,
        requestHash: launch.input.requestHash,
        bundle: {
          ...structuredClone(bundle),
          identity: {
            ...bundle.identity,
            // The scientific result hash deliberately excludes this
            // publication fence, so the session must bind it independently.
            requestHash: "e".repeat(64),
          },
        },
      },
    ];
    for (const artifact of artifacts) {
      const bytes = new TextEncoder().encode(JSON.stringify(artifact));
      const descriptor = {
        key: context.resultObjectKey,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteLength: bytes.byteLength,
      };
      const rejected = await adapter.handleMessage(session, {
        version: SCIENTIFIC_ARTIFACT_PUT_REQUEST_VERSION,
        protocolVersion: SCIENTIFIC_WORKER_PROTOCOL_VERSION,
        type: "artifact-put-request",
        executionId: context.executionId,
        owner: context.owner,
        lease: context.lease,
        object: descriptor,
        bytes,
      }).catch((error: unknown) => error);
      expect(rejected).toMatchObject({ code: "ARTIFACT_BINDING_MISMATCH" });
      expect(await resultStore.head(descriptor.key)).toBeNull();
    }
    expect(publicationCount).toBe(0);
  });

  it("stores a checksummed immutable artifact and exits zero only after the parent publishes and acknowledges it", async () => {
    const taskId = "scientific-success";
    const harness = await createCoreHarness();
    try {
      const deadlineAtMs = Date.now() + 12_000;
      const { running } = await startCoreExecution(
        harness,
        taskId,
        deadlineAtMs,
      );
      const publication = await withTimeout(harness.publishStarted.promise);
      expect(publication).toMatchObject({
        executionId: running.execution?.executionId,
        owner: computeOwner(taskId),
        lease: running.lease,
        object: { key: running.execution?.resultObjectKey },
      });
      expect(await harness.store.head(publication.object.key)).toEqual(
        publication.object,
      );
      const artifactBytes = await harness.store.get(publication.object.key);
      expect(artifactBytes).not.toBeNull();
      const artifact = JSON.parse(
        new TextDecoder().decode(artifactBytes!),
      ) as ScientificResultArtifactV1;
      expect(artifact).toMatchObject({
        version: "3dena.compute-scientific-result-artifact.v1",
        owner: analysisTask(taskId, deadlineAtMs).owner,
        taskKind: "ena-model",
        envelope: {
          schemaVersion: "3dena.analysis-result-envelope.v1",
          evidence: {
            status: "IMPLEMENTED_UNVERIFIED",
            approvedForParity: false,
          },
        },
      });
      expect((await harness.service.getTask(taskId))?.result).toBeUndefined();
      expect(harness.supervisor.snapshot().activeChildren).toBe(1);
      expect(harness.service.capacitySnapshot().occupied).toBe(1);

      harness.allowPublication();
      await withTimeout(harness.service.settleBackground());
      const succeeded = await harness.service.getTask(taskId);
      expect(succeeded).toMatchObject({
        state: "succeeded",
        result: { object: publication.object },
      });
      expect(harness.publicationCount()).toBe(1);
      expect(harness.supervisor.snapshot().activeChildren).toBe(0);
      expect(harness.service.capacitySnapshot().occupied).toBe(0);
      expect(harness.adapter.snapshot().activeBindings).toBe(0);
    } finally {
      harness.allowPublication();
      await cleanHarness(harness, taskId);
    }
  });

  it("executes a durable longitudinal V2 request and publishes a lease-fenced bundle with a server-owned target", async () => {
    const taskId = "scientific-longitudinal-v2";
    const harness = await createCoreHarness();
    try {
      const deadlineAtMs = Date.now() + 20_000;
      const { request, running } = await startCoreLongitudinalExecution(
        harness,
        taskId,
        deadlineAtMs,
      );
      expect(request.execution.target).toBe("browser-worker");
      const publication = await withTimeout(harness.publishStarted.promise).catch(async (error: unknown) => {
        const task = await harness.service.getTask(taskId);
        throw new Error(`Longitudinal publication did not start: ${JSON.stringify({ task, adapter: harness.adapter.snapshot() })}`, { cause: error });
      });
      const artifactBytes = await harness.store.get(publication.object.key);
      expect(artifactBytes).not.toBeNull();
      expect(createHash("sha256").update(artifactBytes!).digest("hex"))
        .toBe(publication.object.sha256);
      expect(artifactBytes!.byteLength).toBe(publication.object.byteLength);
      const artifact = JSON.parse(
        new TextDecoder().decode(artifactBytes!),
      ) as ScientificLongitudinalResultArtifactV2;
      const expectedRequestHash = await hashLongitudinalExecutionRequestV2(request);
      const build = getAnalysisBuildIdentityV2();
      expect(artifact).toMatchObject({
        version: SCIENTIFIC_LONGITUDINAL_RESULT_ARTIFACT_VERSION,
        owner: computeOwner(taskId),
        taskKind: SCIENTIFIC_LONGITUDINAL_TASK_KIND_V2,
        requestHash: expectedRequestHash,
        bundle: {
          schemaVersion: "3dena.longitudinal-analysis-bundle.v2",
          identity: {
            datasetHash: DATASET_HASH,
            specHash: SPEC_HASH,
            runId: `run-${taskId}`,
            requestHash: expectedRequestHash,
            jenaBuildId: `jena-js@${build.jenaVersion}+${build.jenaCommit}:${build.buildId}`,
          },
          execution: {
            target: "persistent-compute-service",
            jenaVersion: build.jenaVersion,
            jenaCommit: build.jenaCommit,
            jenaTarballIntegrity: build.jenaTarballIntegrity,
            sdkVersion: build.sdkVersion,
            buildId: build.buildId,
          },
        },
      });
      expect(artifact.bundle.paths.length).toBeGreaterThan(0);
      expect(artifact.bundle.codeGeometry.nodes.length).toBeGreaterThan(0);
      expect(artifact.bundle.networkOverlays).toEqual([]);
      expect((await harness.service.getTask(taskId))?.result).toBeUndefined();
      expect(harness.supervisor.snapshot().activeChildren).toBe(1);

      harness.allowPublication();
      await withTimeout(harness.service.settleBackground());
      expect(await harness.service.getTask(taskId)).toMatchObject({
        state: "succeeded",
        result: { object: publication.object },
      });
      expect(running.execution?.resultObjectKey).toBe(publication.object.key);
      expect(harness.publicationCount()).toBe(1);
      expect(harness.adapter.snapshot().activeBindings).toBe(0);
    } finally {
      harness.allowPublication();
      await cleanHarness(harness, taskId);
    }
  }, 15_000);

  it("cancels while publication is withheld, waits for close, deletes the unpublished artifact, and exposes no row identity", async () => {
    const taskId = "scientific-cancel";
    const harness = await createCoreHarness();
    try {
      const deadlineAtMs = Date.now() + 12_000;
      await startCoreExecution(harness, taskId, deadlineAtMs);
      const publication = await withTimeout(harness.publishStarted.promise);
      expect(await harness.store.head(publication.object.key)).toEqual(
        publication.object,
      );
      const cancelling = await harness.service.cancelTask(taskId);
      expect(cancelling.state).toBe("cancelling");
      await withTimeout(harness.service.settleBackground());
      expect((await harness.service.getTask(taskId))?.state).toBe("cancelled");
      expect(await harness.store.head(publication.object.key)).toBeNull();
      expect(harness.publicationCount()).toBe(1);
      expect(harness.service.capacitySnapshot().occupied).toBe(0);
      expect(harness.adapter.snapshot().activeBindings).toBe(0);
      const observable = JSON.stringify({
        service: await harness.service.getTask(taskId),
        supervisor: harness.supervisor.snapshot(),
        adapter: harness.adapter.snapshot(),
      });
      expect(observable).not.toContain(PRIVATE_PARTICIPANT_ID);
      expect(observable).not.toContain("Lesson 1");
    } finally {
      harness.allowPublication();
      await cleanHarness(harness, taskId);
    }
  });

  it("honors the core deadline while publication is withheld and does not publish or retain the candidate artifact", async () => {
    const taskId = "scientific-deadline";
    const harness = await createCoreHarness();
    try {
      const deadlineAtMs = Date.now() + 2_000;
      await startCoreExecution(harness, taskId, deadlineAtMs);
      const publication = await withTimeout(harness.publishStarted.promise);
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.max(1, deadlineAtMs - Date.now() + 10)),
      );
      const stopping = await harness.service.sweepTask(taskId);
      expect(["cancelling", "timed_out"]).toContain(stopping.state);
      if (stopping.state === "cancelling") {
        expect(stopping.pendingStopOutcome).toBe("timed_out");
      }
      await withTimeout(harness.service.settleBackground());
      const timedOut = await harness.service.getTask(taskId);
      expect(timedOut?.state).toBe("timed_out");
      expect(timedOut?.result).toBeUndefined();
      expect(await harness.store.head(publication.object.key)).toBeNull();
      expect(harness.service.capacitySnapshot().occupied).toBe(0);
      const observable = JSON.stringify({
        task: await harness.service.getTask(taskId),
        supervisor: harness.supervisor.snapshot(),
        adapter: harness.adapter.snapshot(),
      });
      expect(observable).not.toContain(PRIVATE_PARTICIPANT_ID);
      expect(observable).not.toContain("Lesson 1");
    } finally {
      harness.allowPublication();
      await cleanHarness(harness, taskId);
    }
  });

  it("maps a private publisher failure to a fixed process outcome without retaining its message or result", async () => {
    const taskId = "scientific-publisher-failure";
    const harness = await createCoreHarness(PRIVATE_PARTICIPANT_ID);
    try {
      const deadlineAtMs = Date.now() + 12_000;
      await startCoreExecution(harness, taskId, deadlineAtMs);
      const publication = await withTimeout(harness.publishStarted.promise);
      expect(await harness.store.head(publication.object.key)).toEqual(
        publication.object,
      );
      harness.allowPublication();
      await withTimeout(harness.service.settleBackground());
      const failed = await harness.service.getTask(taskId);
      expect(failed).toMatchObject({
        state: "failed",
        failure: { code: "PROCESS_TERMINATED_UNEXPECTEDLY" },
      });
      expect(failed?.result).toBeUndefined();
      expect(await harness.store.head(publication.object.key)).toBeNull();
      expect(harness.service.capacitySnapshot().occupied).toBe(0);
      const observable = JSON.stringify({
        task: failed,
        supervisor: harness.supervisor.snapshot(),
        adapter: harness.adapter.snapshot(),
      });
      expect(observable).not.toContain(PRIVATE_PARTICIPANT_ID);
      expect(observable).not.toContain("Lesson 1");
    } finally {
      harness.allowPublication();
      await cleanHarness(harness, taskId);
    }
  });

  it("fails closed after ready on malformed execution data without publishing or exposing the private field", async () => {
    const rootDirectory = await mkdtemp(
      join(tmpdir(), "3dena-scientific-invalid-"),
    );
    const store = new FileSystemImmutableResultStore({
      version: FILE_SYSTEM_RESULT_STORE_OPTIONS_VERSION,
      rootDirectory,
    });
    let publicationCount = 0;
    const adapter = new ScientificWorkerSessionAdapter({
      version: SCIENTIFIC_SESSION_ADAPTER_OPTIONS_VERSION,
      inputProvider: new JsonObjectStoreScientificInputProvider({
        version: SCIENTIFIC_JSON_INPUT_PROVIDER_OPTIONS_VERSION,
        objectStore: store,
      }),
      resultStore: store,
      publisher: {
        version: SCIENTIFIC_RESULT_PUBLISHER_VERSION,
        async publish(): Promise<ScientificPublicationReceiptV1> {
          publicationCount += 1;
          throw new Error(PRIVATE_PARTICIPANT_ID);
        },
      },
    });
    const supervisor = createSupervisor(adapter);
    try {
      const taskId = "scientific-invalid";
      const deadlineAtMs = Date.now() + 8_000;
      const malformed = {
        ...dataset(),
        schemaVersion: ANALYSIS_EXECUTION_DATASET_VERSION_V2,
        privateRows: [{ participantId: PRIVATE_PARTICIPANT_ID }],
      } as unknown as AnalysisExecutionDataset;
      const { input } = await createStoredInput(
        store,
        taskId,
        deadlineAtMs,
        malformed,
      );
      const now = Date.now();
      const owner = computeOwner(taskId);
      const context: ProcessLaunchContextV1 = {
        owner,
        taskRef: "scientific-invalid-task-ref",
        request: createRequest(taskId, input, deadlineAtMs),
        lease: {
          version: COMPUTE_LEASE_VERSION,
          leaseId: "lease-scientific-invalid",
          holderId: "scientific-worker-test",
          epoch: 1,
          issuedAtMs: now,
          expiresAtMs: deadlineAtMs,
        },
        executionId: "execution-scientific-invalid",
        resultObjectKey: "compute-results/scientific-invalid-task-ref/result.bin",
      };
      const child = await supervisor.spawn(context, {
        version: COMPUTE_PROCESS_LAUNCH_CONTROL_VERSION,
        deadlineAtMs: now + 5_000,
        signal: new AbortController().signal,
      });
      const termination = await withTimeout(child.termination);
      expect(termination).toMatchObject({
        kind: "crashed",
        exitCode: 1,
        signal: null,
      });
      expect(publicationCount).toBe(0);
      expect(await store.head(context.resultObjectKey)).toBeNull();
      expect(adapter.snapshot()).toMatchObject({
        activeBindings: 0,
        totalFailures: 1,
        failures: [{ code: "INVALID_INPUT", count: 1 }],
      });
      const observable = JSON.stringify({
        termination,
        supervisor: supervisor.snapshot(),
        adapter: adapter.snapshot(),
      });
      expect(observable).not.toContain(PRIVATE_PARTICIPANT_ID);
      expect(observable).not.toContain("participantId");
    } finally {
      await rm(rootDirectory, { recursive: true, force: true });
    }
  });
});
