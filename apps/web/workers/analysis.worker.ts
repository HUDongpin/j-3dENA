/// <reference lib="webworker" />

import {
  AnalysisValidationError,
  analyzeRows,
  type AnalyzeRowsInput,
  type RawRow,
} from "@3dena/analysis";
import type { AnalysisMapping } from "@/lib/analysis-contract";
import { parseAnalysisCsv } from "@/lib/parse-analysis-csv";
import type {
  AnalysisWorkerResponse,
  AnalyzeWorkerRequest,
  RunOwner,
  WorkerPhase,
} from "@/lib/worker-protocol";

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

function post(
  response: AnalysisWorkerResponse,
): void {
  workerScope.postMessage(response);
}

function ownerFor(request: AnalyzeWorkerRequest): RunOwner {
  return {
    datasetHash: request.input.datasetHash,
    specHash: request.input.specHash,
    runId: request.runId,
  };
}

function progress(
  owner: RunOwner,
  phase: WorkerPhase,
  percent: number,
  message: string,
): void {
  post({ type: "progress", owner, phase, percent, message });
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function toAnalysisInput(
  rows: RawRow[],
  mapping: AnalysisMapping,
): AnalyzeRowsInput {
  return {
    rows,
    mapping: {
      units: [...mapping.unitColumns],
      conversation: [...mapping.conversationColumns],
      codes: [...mapping.codeColumns],
      ...(mapping.model === "EndPoint"
        ? {}
        : {
            trajectory: {
              participant: [mapping.entityColumn],
              group: mapping.groupColumn,
              time: mapping.timeColumn,
              cohortPolicy: "available" as const,
            },
          }),
    },
    config: {
      model: mapping.model,
      window: mapping.window,
      weightBy: "binary",
      windowSizeBack: mapping.windowSizeBack,
      windowSizeForward: 0,
      centerAlignToOrigin: true,
    },
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof AnalysisValidationError) {
    return error.issues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ");
  }
  return error instanceof Error ? error.message : "The analysis worker failed.";
}

workerScope.addEventListener("message", async (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (
    !request ||
    typeof request !== "object" ||
    (request as Partial<AnalyzeWorkerRequest>).v !== 1 ||
    (request as Partial<AnalyzeWorkerRequest>).kind !== "analyze"
  ) {
    return;
  }

  const typedRequest = request as AnalyzeWorkerRequest;
  const owner = ownerFor(typedRequest);

  try {
    progress(owner, "validating", 8, "Validating the immutable run request…");

    // This delay exists only to make hard-cancellation deterministic in E2E.
    // The production UI always supplies zero, so production cannot activate it.
    const debugDelayMs =
      process.env.NODE_ENV === "production"
        ? 0
        : typedRequest.input.debugDelayMs;
    if (debugDelayMs > 0) {
      await pause(debugDelayMs);
    }

    progress(owner, "parsing", 22, "Parsing CSV rows inside the worker…");
    const rows = parseAnalysisCsv(
      typedRequest.input.csvText,
      typedRequest.input.mapping,
    );
    const input = toAnalysisInput(rows, typedRequest.input.mapping);

    progress(owner, "modeling", 48, "Building and rotating the ENA model…");
    const result = analyzeRows(input);

    progress(
      owner,
      "trajectory",
      86,
      "Reading group-time centroids from the shared SVD space…",
    );
    progress(owner, "complete", 100, "Analysis complete.");
    post({ type: "result", owner, result });
  } catch (error) {
    post({ type: "error", owner, message: errorMessage(error) });
  }
});

export {};
