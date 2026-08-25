import { createServer, get, type Server } from "node:http";

import { describe, expect, it, vi } from "vitest";

import {
  ANALYSIS_CONTRACT_VERSION_V1,
  analyzeRows,
  executeLongitudinalAnalysisV2,
  hashAnalysisValueV1,
  verifyLongitudinalAnalysisBundleV2,
  type DatasetReceiptV1,
  type LongitudinalExecutionRequestV2,
  type TrajectoryRunSpecV2,
} from "@3dena/analysis";
import {
  COMPUTE_TASK_OWNER_CONTRACT_VERSION,
  COMPUTE_TASK_REQUEST_VERSION,
  ComputeServiceCore,
  InMemoryComputeAuditSink,
  InMemoryComputeObjectStore,
  InMemoryComputeProcessSupervisor,
  InMemoryComputeTaskRepository,
  ManualComputeClock,
  SequenceComputeIdFactory,
} from "@3dena/compute-service-core";
import {
  SCIENTIFIC_LONGITUDINAL_RESULT_ARTIFACT_VERSION,
  SCIENTIFIC_LONGITUDINAL_TASK_KIND_V2,
  SCIENTIFIC_PUBLICATION_REQUEST_VERSION,
  SCIENTIFIC_WORKER_PROTOCOL_VERSION,
} from "@3dena/compute-service-node";

import {
  CoreScientificResultPublisher,
  bridgeNodeHttpRequest,
  runPersistentRetentionCycle,
} from "./runtime-support";

const DATASET_HASH = "1".repeat(64);

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function listenLoopback(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected an IPv4 loopback address.");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}

async function within<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), 2_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

describe("Node HTTP to Web transport bridge", () => {
  it("aborts the Web request and cancels the SSE body iterator when the client disconnects", async () => {
    const signalAborted = deferred();
    const bodyCancelled = deferred();
    const iteratorCleaned = deferred();
    const bridgeSettled = deferred();
    const firstChunkReceived = deferred();
    const firstChunk = new TextEncoder().encode("id: 1\ndata: ready\n\n");
    let pendingNext: ((result: IteratorResult<Uint8Array>) => void) | undefined;
    let iteratorReads = 0;
    let cancelled = false;
    let observedSignal: AbortSignal | undefined;
    const iterator: AsyncIterator<Uint8Array> = {
      next() {
        iteratorReads += 1;
        if (iteratorReads === 1) {
          return Promise.resolve({ done: false, value: firstChunk });
        }
        return new Promise<IteratorResult<Uint8Array>>((resolve) => {
          pendingNext = resolve;
        });
      },
      return() {
        iteratorCleaned.resolve();
        pendingNext?.({ done: true, value: undefined });
        return Promise.resolve({ done: true, value: undefined });
      },
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await iterator.next();
        if (cancelled) return;
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      },
      async cancel() {
        cancelled = true;
        bodyCancelled.resolve();
        await iterator.return?.();
      },
    });
    let baseUrl = "";
    const server = createServer((request, response) => {
      void bridgeNodeHttpRequest(request, response, baseUrl, (webRequest) => {
        observedSignal = webRequest.signal;
        webRequest.signal.addEventListener("abort", () => signalAborted.resolve(), {
          once: true,
        });
        return new Response(body, {
          headers: { "content-type": "text/event-stream" },
        });
      }).then(bridgeSettled.resolve, bridgeSettled.reject);
    });
    try {
      baseUrl = await listenLoopback(server);
      const client = get(`${baseUrl}/v1/jobs/job-1/events`, (response) => {
        response.once("data", () => {
          firstChunkReceived.resolve();
          response.destroy();
        });
      });
      client.on("error", () => undefined);

      await within(firstChunkReceived.promise, "the first SSE chunk");
      await within(signalAborted.promise, "the Web request abort signal");
      await within(bodyCancelled.promise, "the response body cancellation");
      await within(iteratorCleaned.promise, "the response iterator cleanup");
      await within(bridgeSettled.promise, "the HTTP bridge to settle");
      expect(observedSignal?.aborted).toBe(true);
      expect(iteratorReads).toBeGreaterThanOrEqual(2);
    } finally {
      await closeServer(server);
    }
  });

  it("does not abort or cancel a normally completed Web response", async () => {
    const bridgeSettled = deferred();
    let observedSignal: AbortSignal | undefined;
    let cancelCalls = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("ok"));
        controller.close();
      },
      cancel() {
        cancelCalls += 1;
      },
    });
    let baseUrl = "";
    const server = createServer((request, response) => {
      void bridgeNodeHttpRequest(request, response, baseUrl, (webRequest) => {
        observedSignal = webRequest.signal;
        return new Response(body, { status: 200 });
      }).then(bridgeSettled.resolve, bridgeSettled.reject);
    });
    try {
      baseUrl = await listenLoopback(server);
      const responseBody = deferred<string>();
      const client = get(`${baseUrl}/health`, (response) => {
        response.setEncoding("utf8");
        let value = "";
        response.on("data", (chunk: string) => {
          value += chunk;
        });
        response.once("end", () => responseBody.resolve(value));
        response.once("error", responseBody.reject);
      });
      client.once("error", responseBody.reject);

      await expect(within(responseBody.promise, "the normal response")).resolves.toBe("ok");
      await within(bridgeSettled.promise, "the normal HTTP bridge to settle");
      expect(observedSignal?.aborted).toBe(false);
      expect(cancelCalls).toBe(0);
    } finally {
      await closeServer(server);
    }
  });
});

describe("persistent retention composition", () => {
  it("attempts expired source-result active cleanup even when a peer sweep fails", async () => {
    const calls: string[] = [];
    await expect(runPersistentRetentionCycle({
      synchronize: async () => { calls.push("clock"); },
      sweepObjects: async () => {
        calls.push("objects");
        throw new Error("isolated object sweep failure");
      },
      reconcileOrphans: async () => { calls.push("orphans"); },
      purgeExpiredSourceResultMappings: async () => {
        calls.push("source-result-active");
        return 1;
      },
    })).rejects.toThrow("retention sweep failed");
    expect(calls[0]).toBe("clock");
    expect(new Set(calls.slice(1))).toEqual(new Set([
      "objects",
      "orphans",
      "source-result-active",
    ]));
  });
});

function receipt(specHash: string): DatasetReceiptV1 {
  const headers = ["Class", "Student", "Condition", "Time", "A", "B", "C", "D"];
  return {
    schemaVersion: "3dena.dataset-receipt.v1",
    sha256: DATASET_HASH,
    byteLength: 1,
    format: "csv",
    sheet: null,
    rows: 8,
    columns: headers.length,
    schema: {
      schemaVersion: "3dena.dataset-schema.v1",
      headers,
      columns: headers.map((name) => ({
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
    activationIdentity: `fixture:${DATASET_HASH}:${specHash}`,
  };
}

async function longitudinalRequest(): Promise<LongitudinalExecutionRequestV2> {
  const rows = [];
  for (const [conditionIndex, condition] of ["A", "B"].entries()) {
    for (const [studentIndex, student] of ["P1", "P2"].entries()) {
      for (const [timeIndex, time] of ["T1", "T2"].entries()) {
        const seed = conditionIndex * 20 + studentIndex * 5 + timeIndex * 2;
        rows.push({
          Class: "Class 1",
          Student: student,
          Condition: condition,
          Time: time,
          A: seed % 2,
          B: (seed + 1) % 3 === 0 ? 1 : 0,
          C: (seed + 2) % 4 === 0 ? 1 : 0,
          D: (seed + 3) % 5 === 0 ? 1 : 0,
        });
      }
    }
  }
  const result = analyzeRows({
    rows,
    mapping: {
      units: ["Class", "Student", "Condition"],
      conversation: ["Time"],
      codes: ["A", "B", "C", "D"],
      metadata: [],
      trajectory: {
        participant: ["Class", "Student"],
        group: "Condition",
        time: "Time",
        timeOrder: ["T1", "T2"],
        cohortPolicy: "available",
      },
    },
    config: { model: "SeparateTrajectory", windowSizeBack: 4 },
  });
  const sourceResultHash = await hashAnalysisValueV1(result);
  const runSpec: TrajectoryRunSpecV2 = {
    schemaVersion: "3dena.trajectory-run-spec.v2",
    sourceResultHash,
    participantColumns: ["Class", "Student"],
    timeColumn: "Time",
    groupColumn: "Condition",
    orderedPeriods: result.trajectory!.timeOrder.map((time, index) => ({
      identity: {
        components: [{ name: "time", type: "string", value: String(time.value) }],
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
  };
  const specHash = await hashAnalysisValueV1(runSpec);
  return {
    dataset: {
      schemaVersion: "3dena.analysis-execution-dataset.v2",
      receipt: receipt(specHash),
      specHash,
      buildId: "fixture-source-build",
      sourceResult: { sourceKind: "raw-jena", hash: sourceResultHash, result },
    },
    pathTask: {
      schemaVersion: "3dena.trajectory-path-task.v2",
      kind: "trajectory-path-v2",
      datasetHash: DATASET_HASH,
      specHash,
      runId: "runtime-publisher-v2",
      runSpec,
    },
    execution: {
      target: "persistent-compute-service",
      jenaVersion: "0.7.0-ona.0",
      jenaCommit: "94ea8519b6b2742b791924bc449e1b795135c5a0",
      jenaTarballIntegrity: "sha512-fixture",
      sdkVersion: "0.2.0",
      buildId: "fixture-analysis-build",
      seed: 2026,
    },
  };
}

describe("CoreScientificResultPublisher", () => {
  it("validates and publishes a durable longitudinal V2 artifact without indexing it as a source result", async () => {
    const request = await longitudinalRequest();
    const bundle = await executeLongitudinalAnalysisV2(request);
    await verifyLongitudinalAnalysisBundleV2(bundle);
    const owner = {
      contractVersion: COMPUTE_TASK_OWNER_CONTRACT_VERSION,
      datasetHash: request.pathTask.datasetHash,
      specHash: request.pathTask.specHash,
      runId: request.pathTask.runId,
      taskId: "runtime-publisher-v2",
    } as const;
    const objectStore = new InMemoryComputeObjectStore();
    const input = (await objectStore.putImmutable(
      "compute-inputs/runtime-publisher-v2.json",
      new TextEncoder().encode("{}"),
    )).descriptor;
    const clock = new ManualComputeClock(1_000);
    const core = new ComputeServiceCore({
      repository: new InMemoryComputeTaskRepository(),
      objectStore,
      processSupervisor: new InMemoryComputeProcessSupervisor(),
      auditSink: new InMemoryComputeAuditSink(),
      clock,
      idFactory: new SequenceComputeIdFactory(),
      maxConcurrency: 1,
      maxLeaseDurationMs: 10_000,
    });
    await core.createTask({
      version: COMPUTE_TASK_REQUEST_VERSION,
      owner,
      taskKind: SCIENTIFIC_LONGITUDINAL_TASK_KIND_V2,
      input,
      deadlineAtMs: 9_000,
      expiresAtMs: 10_000,
    });
    const lease = await core.claimTask(owner.taskId, {
      leaseId: "lease-runtime-publisher-v2",
      holderId: "worker-runtime-publisher-v2",
      durationMs: 5_000,
    });
    const running = await core.executeTask(owner.taskId, lease);
    const resultObjectKey = running.execution?.resultObjectKey;
    if (resultObjectKey === undefined) throw new Error("Expected a running result binding.");
    const bytes = new TextEncoder().encode(JSON.stringify({
      version: SCIENTIFIC_LONGITUDINAL_RESULT_ARTIFACT_VERSION,
      owner,
      taskKind: SCIENTIFIC_LONGITUDINAL_TASK_KIND_V2,
      requestHash: bundle.identity.requestHash,
      bundle,
    }));
    const resultObject = (await objectStore.putImmutable(resultObjectKey, bytes)).descriptor;
    const recordSourceResult = vi.fn();
    const publisher = new CoreScientificResultPublisher(
      core,
      { synchronize: async () => clock.now() },
      objectStore,
      { record: recordSourceResult },
      request.execution.buildId,
      {
        jenaVersion: request.execution.jenaVersion,
        jenaCommit: request.execution.jenaCommit,
        jenaTarballIntegrity: request.execution.jenaTarballIntegrity,
        sdkVersion: request.execution.sdkVersion,
        buildId: request.execution.buildId,
      },
    );

    await expect(publisher.publish({
      version: SCIENTIFIC_PUBLICATION_REQUEST_VERSION,
      protocolVersion: SCIENTIFIC_WORKER_PROTOCOL_VERSION,
      type: "publication-request",
      executionId: running.execution!.executionId,
      owner,
      lease,
      object: resultObject,
    }, new AbortController().signal)).resolves.toMatchObject({
      accepted: true,
      owner,
      object: resultObject,
    });
    expect((await core.getTask(owner.taskId))?.result?.object).toEqual(resultObject);
    expect(recordSourceResult).not.toHaveBeenCalled();
  });
});
