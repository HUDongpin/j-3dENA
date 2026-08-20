import type { AnalysisResult } from "@3dena/analysis";
import type { AnalysisMapping } from "@/lib/analysis-contract";

export interface RunOwner {
  datasetHash: string;
  specHash: string;
  runId: string;
}

export type WorkerPhase =
  | "parsing"
  | "validating"
  | "modeling"
  | "trajectory"
  | "complete";

export interface AnalyzeWorkerRequest {
  v: 1;
  kind: "analyze";
  runId: string;
  input: {
    csvText: string;
    mapping: AnalysisMapping;
    datasetHash: string;
    specHash: string;
    /** Non-production browser-test hook. The UI always sends zero in production. */
    debugDelayMs: number;
  };
}

export interface ProgressWorkerResponse {
  type: "progress";
  owner: RunOwner;
  phase: WorkerPhase;
  percent: number;
  message: string;
}

export interface ResultWorkerResponse {
  type: "result";
  owner: RunOwner;
  result: AnalysisResult;
}

export interface ErrorWorkerResponse {
  type: "error";
  owner: RunOwner;
  message: string;
}

export type AnalysisWorkerResponse =
  | ProgressWorkerResponse
  | ResultWorkerResponse
  | ErrorWorkerResponse;
