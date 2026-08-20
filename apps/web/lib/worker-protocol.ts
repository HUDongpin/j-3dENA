import type {
  AnalysisResult,
  PreparedSpaceMapping,
  PreparedSpaceResult,
} from "@3dena/analysis";
import type { AnalysisMapping } from "@/lib/analysis-contract";
import type { PreparedDatasetReceipt } from "@/lib/prepared-class1";

export interface RunOwner {
  datasetHash: string;
  specHash: string;
  runId: string;
}

export type WorkerPhase =
  | "parsing"
  | "decoding"
  | "validating"
  | "modeling"
  | "trajectory"
  | "complete";

export interface AnalyzeRawWorkerRequest {
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

export interface AnalyzePreparedWorkerRequest {
  v: 1;
  kind: "analyze-prepared";
  runId: string;
  input: {
    /** Exact immutable upload snapshot; decoded again inside the analysis Worker. */
    bytes: ArrayBuffer;
    sourceName: string;
    mapping: PreparedSpaceMapping;
    datasetHash: string;
    specHash: string;
    debugDelayMs: number;
  };
}

export type AnalysisWorkerRequest =
  | AnalyzeRawWorkerRequest
  | AnalyzePreparedWorkerRequest;

export interface ValidatePreparedWorkerRequest {
  v: 1;
  kind: "validate-prepared";
  requestId: string;
  input: {
    bytes: ArrayBuffer;
    sourceName: string;
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

export interface PreparedResultWorkerResponse {
  type: "prepared-result";
  owner: RunOwner;
  result: PreparedSpaceResult;
}

export interface ErrorWorkerResponse {
  type: "error";
  owner: RunOwner;
  message: string;
}

export type AnalysisWorkerResponse =
  | ProgressWorkerResponse
  | ResultWorkerResponse
  | PreparedResultWorkerResponse
  | ErrorWorkerResponse;

export interface PreparedValidatedWorkerResponse {
  type: "prepared-validated";
  requestId: string;
  receipt: PreparedDatasetReceipt;
}

export interface PreparedValidationErrorWorkerResponse {
  type: "prepared-validation-error";
  requestId: string;
  message: string;
}

export type PreparedValidationWorkerResponse =
  | PreparedValidatedWorkerResponse
  | PreparedValidationErrorWorkerResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

export function isAnalysisWorkerRequest(
  value: unknown,
): value is AnalysisWorkerRequest {
  if (!isRecord(value) || !isRecord(value.input)) return false;
  const input = value.input;
  if (
    value.v !== 1 ||
    typeof value.runId !== "string" ||
    value.runId.length === 0 ||
    !isHash(input.datasetHash) ||
    !isHash(input.specHash) ||
    typeof input.debugDelayMs !== "number" ||
    !Number.isFinite(input.debugDelayMs)
  ) {
    return false;
  }
  if (value.kind === "analyze") {
    return typeof input.csvText === "string" && isRecord(input.mapping);
  }
  if (value.kind === "analyze-prepared") {
    return (
      input.bytes instanceof ArrayBuffer &&
      typeof input.sourceName === "string" &&
      input.sourceName.length > 0 &&
      isRecord(input.mapping)
    );
  }
  return false;
}

export function isPreparedValidationWorkerRequest(
  value: unknown,
): value is ValidatePreparedWorkerRequest {
  if (!isRecord(value) || !isRecord(value.input)) return false;
  return (
    value.v === 1 &&
    value.kind === "validate-prepared" &&
    typeof value.requestId === "string" &&
    value.requestId.length > 0 &&
    value.input.bytes instanceof ArrayBuffer &&
    typeof value.input.sourceName === "string" &&
    value.input.sourceName.length > 0
  );
}
