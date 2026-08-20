/// <reference lib="webworker" />

import {
  ANALYSIS_CONTRACT_VERSION_V1,
  ANALYSIS_TASK_VERSION_V1,
  DATASET_RECEIPT_VERSION_V1,
  AnalysisTaskExecutionError,
  PreparedDerivedAnalysisError,
  executeAnalysisTask,
  hashAnalysisValueV1,
  type AnalysisTaskV1,
} from "@3dena/analysis";
import {
  isDerivedAnalysisWorkerRequest,
  type DerivedAnalysisWorkerResponse,
  type PreparedDerivedWorkerRequest,
  type RawDerivedWorkerRequest,
} from "@/lib/derived-analysis-protocol";

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

function post(response: DerivedAnalysisWorkerResponse): void {
  workerScope.postMessage(response);
}

function errorDetails(error: unknown): { code: string; message: string } {
  if (
    error instanceof AnalysisTaskExecutionError
    || error instanceof PreparedDerivedAnalysisError
  ) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) return { code: "DERIVED_WORKER_FAILURE", message: error.message };
  return { code: "DERIVED_WORKER_FAILURE", message: "The derived-analysis Worker failed." };
}

function analysisTask(
  request: RawDerivedWorkerRequest | PreparedDerivedWorkerRequest,
  sourceResultHash: string,
): AnalysisTaskV1 {
  const owner = {
    contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
    datasetHash: request.owner.datasetHash,
    specHash: request.owner.specHash,
    runId: request.owner.runId,
    taskId: request.owner.taskId,
  } as const;
  const base = {
    schemaVersion: ANALYSIS_TASK_VERSION_V1,
    owner,
    deadlineEpochMilliseconds: Date.now() + 60_000,
  } as const;
  let task: AnalysisTaskV1;
  if (request.intent.kind === "network-comparison") {
    task = {
      ...base,
      kind: "network-comparison",
      sourceResultHash,
      groups: [...request.intent.groups],
    };
  } else if (request.intent.kind === "change-network") {
    task = {
      ...base,
      kind: "change-network",
      sourceResultHash,
      field: request.intent.field,
      level: request.intent.level,
    };
  } else {
    task = {
      ...base,
      kind: "statistics",
      sourceResultHash,
      design: request.intent.design,
      groups: [...request.intent.groups],
      dimensions: [...request.intent.dimensions],
      alternative: request.intent.alternative,
      adjustment: request.intent.adjustment,
      samePhysicalEntityConfirmed: request.intent.samePhysicalEntityConfirmed,
    };
  }
  return task;
}

async function executeRaw(request: RawDerivedWorkerRequest): Promise<void> {
  const sourceResultHash = await hashAnalysisValueV1(request.source.result);
  const task = analysisTask(request, sourceResultHash);
  const envelope = await executeAnalysisTask(
    {
      schemaVersion: "3dena.analysis-execution-dataset.v1",
      receipt: {
        schemaVersion: DATASET_RECEIPT_VERSION_V1,
        sha256: request.owner.datasetHash,
        byteLength: request.source.byteLength,
        format: "csv",
        sheet: null,
        rows: request.source.rows,
        columns: request.source.columns,
        schema: request.source.schema,
        limits: request.source.limits,
        warnings: [],
        activationIdentity: `browser:${request.owner.datasetHash}`,
      },
      specHash: request.owner.specHash,
      buildId: request.buildId,
      sourceResult: { hash: sourceResultHash, result: request.source.result },
    },
    task,
  );
  post({ type: "raw-derived-result", owner: request.owner, envelope });
}

async function executePrepared(request: PreparedDerivedWorkerRequest): Promise<void> {
  const sourceResultHash = await hashAnalysisValueV1(request.source.result);
  const task = analysisTask(request, sourceResultHash);
  const envelope = await executeAnalysisTask(
    {
      schemaVersion: "3dena.analysis-execution-dataset.v2",
      receipt: request.source.receipt,
      specHash: request.owner.specHash,
      buildId: request.buildId,
      sourceResult: {
        sourceKind: "prepared-exchange",
        hash: sourceResultHash,
        result: request.source.result,
      },
    },
    task,
  );
  post({
    type: "prepared-derived-result",
    owner: request.owner,
    envelope,
  });
}

workerScope.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isDerivedAnalysisWorkerRequest(event.data)) return;
  const request = event.data;
  void (async () => {
    try {
      if (request.kind === "execute-raw-derived") await executeRaw(request);
      else await executePrepared(request);
    } catch (error) {
      const details = errorDetails(error);
      post({
        type: "derived-error",
        owner: request.owner,
        code: details.code,
        message: details.message,
      });
    }
  })();
});

export {};
