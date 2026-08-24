/// <reference lib="webworker" />

import {
  AnalysisValidationError,
  analyzePreparedSpace,
  analyzeRows,
  type AnalyzeRowsInput,
  type RawRow,
} from "@3dena/analysis";
import { decodeEna3dExchangeV1WithSha256 } from "@3dena/io";
import type { AnalysisMapping } from "@/lib/analysis-contract";
import { parseAnalysisCsv } from "@/lib/parse-analysis-csv";
import type {
  AnalysisWorkerRequest,
  AnalysisWorkerResponse,
  AnalyzeRawWorkerRequest,
  RunOwner,
  WorkerPhase,
} from "@/lib/worker-protocol";
import { isAnalysisWorkerRequest } from "@/lib/worker-protocol";

const workerScope: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

function post(
  response: AnalysisWorkerResponse,
): void {
  workerScope.postMessage(response);
}

function ownerFor(request: AnalysisWorkerRequest): RunOwner {
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
  if (!isAnalysisWorkerRequest(event.data)) return;
  const typedRequest = event.data;
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

    if (typedRequest.kind === "analyze-prepared") {
      progress(
        owner,
        "decoding",
        24,
        "Revalidating exact prepared-exchange bytes inside the Worker…",
      );
      const artifact = await decodeEna3dExchangeV1WithSha256(
        typedRequest.input.bytes,
      );
      if (artifact.sha256 !== typedRequest.input.datasetHash) {
        throw new Error(
          "Prepared exchange bytes no longer match the activated dataset hash.",
        );
      }
      progress(
        owner,
        "trajectory",
        62,
        "Reducing participant-period centroids in the imported shared space…",
      );
      const result = analyzePreparedSpace({
        source: {
          artifact,
          name: typedRequest.input.sourceName,
        },
        mapping: typedRequest.input.mapping,
      });
      progress(owner, "complete", 100, "Prepared-space analysis complete.");
      post({ type: "prepared-result", owner, result });
      return;
    }

    const rawRequest: AnalyzeRawWorkerRequest = typedRequest;
    progress(owner, "parsing", 22, "Parsing CSV rows inside the worker…");
    const rows = parseAnalysisCsv(
      rawRequest.input.csvText,
      rawRequest.input.mapping,
    );
    const input = toAnalysisInput(rows, rawRequest.input.mapping);

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
