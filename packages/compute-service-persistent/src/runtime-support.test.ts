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

import { CoreScientificResultPublisher } from "./runtime-support";

const DATASET_HASH = "1".repeat(64);

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
