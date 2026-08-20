import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ANALYSIS_CONTRACT_VERSION_V1,
  ANALYSIS_EXECUTION_DATASET_VERSION_V2,
  ANALYSIS_TASK_VERSION_V1,
  DATASET_RECEIPT_VERSION_V1,
  executeAnalysisTask,
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
  InMemoryComputeTaskRepository,
  SequenceComputeIdFactory,
  type ComputeClock,
  type ComputeTaskRequestV1,
  type ComputeObjectStore,
  type ProcessLaunchContextV1,
} from "@3dena/compute-service-core";

import {
  FILE_SYSTEM_RESULT_STORE_OPTIONS_VERSION,
  NODE_COMPUTE_SUPERVISOR_OPTIONS_VERSION,
  NODE_WORKER_SESSION_VERSION,
  SCIENTIFIC_ARTIFACT_PUT_REQUEST_VERSION,
  SCIENTIFIC_EXECUTION_INPUT_VERSION,
  SCIENTIFIC_INPUT_PROVIDER_VERSION,
  SCIENTIFIC_JSON_INPUT_PROVIDER_OPTIONS_VERSION,
  SCIENTIFIC_PUBLICATION_RECEIPT_VERSION,
  SCIENTIFIC_RESULT_PUBLISHER_VERSION,
  SCIENTIFIC_RESULT_ARTIFACT_VERSION,
  SCIENTIFIC_SESSION_ADAPTER_OPTIONS_VERSION,
  SCIENTIFIC_STORED_INPUT_VERSION,
  SCIENTIFIC_WORKER_PROTOCOL_VERSION,
  FileSystemImmutableResultStore,
  JsonObjectStoreScientificInputProvider,
  NodeComputeProcessSupervisor,
  ScientificWorkerSessionAdapter,
  resolveScientificWorkerEntry,
  type ScientificPublicationRequestV1,
  type ScientificPublicationReceiptV1,
  type ScientificResultArtifactV1,
  type ScientificStoredInputV1,
  type NodeWorkerSessionV1,
} from "../index";

const DATASET_HASH = "a".repeat(64);
const SPEC_HASH = "b".repeat(64);
const PRIVATE_PARTICIPANT_ID =
  "PRIVATE_PARTICIPANT_ID_MUST_NOT_ESCAPE_SCIENTIFIC_CHILD";

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

function createRequest(
  taskId: string,
  input: ComputeTaskRequestV1["input"],
  deadlineAtMs: number,
): ComputeTaskRequestV1 {
  return {
    version: COMPUTE_TASK_REQUEST_VERSION,
    owner: computeOwner(taskId),
    taskKind: "ena-model",
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
        envelope: {
          schemaVersion: "3dena.analysis-result-envelope.v1",
          owner: wrongOwner,
          taskKind: "ena-model",
          result: { privateParticipant: PRIVATE_PARTICIPANT_ID },
          diagnostics: [],
          evidence: {},
          provenance: {},
        },
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
