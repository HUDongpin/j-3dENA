import type {
  AnalysisExecutionDataset,
  AnalysisJobEventV1,
  AnalysisJobStatusV1,
  AnalysisTaskV1,
  CreateAnalysisJobRequestV1,
  DatasetReceiptV1,
  TaskOwnerV1,
} from "@3dena/analysis";

export const COMPUTE_HTTP_JOB_VERSION = "3dena.compute-http-job.v1" as const;
export const COMPUTE_HTTP_EXECUTION_INPUT_VERSION =
  "3dena.compute-scientific-stored-input.v1" as const;
export const COMPUTE_HTTP_CONTRACT_VERSION = "3dena.compute-http.v1" as const;

export interface ReservedDatasetV1 {
  readonly sha256: string;
  readonly byteLength: number;
  readonly format: "csv" | "xlsx" | "xls" | "ena3d-json";
}

/**
 * API-control metadata only. It intentionally contains neither capability
 * plaintext, idempotency-key plaintext, raw rows, filenames, nor task input.
 */
export interface ComputeHttpJobRecordV1 {
  readonly version: typeof COMPUTE_HTTP_JOB_VERSION;
  readonly jobId: string;
  readonly revision: number;
  readonly capabilityHash: string;
  readonly boundOrigin: string | null;
  readonly createIdempotencyHash: string;
  readonly createRequestFingerprint: string;
  readonly dataset: ReservedDatasetV1;
  readonly inputObjectKey: string;
  readonly inputObjectOwnedByJob?: boolean;
  readonly activatedDatasetId?: string;
  readonly activationReceiptSha256?: string;
  readonly activatedDatasetContentUrl?: string;
  /** Non-row activation metadata retained after terminal raw-input deletion. */
  readonly activatedDatasetReceipt?: DatasetReceiptV1;
  /** Successful ENA job whose service-owned result authorizes this derived job. */
  readonly sourceJobId?: string;
  readonly sourceResultHash?: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly expiresAtMs: number;
  readonly owner?: TaskOwnerV1;
  readonly taskKind?: AnalysisTaskV1["kind"];
  readonly coreTaskId?: string;
  readonly executionObjectKey?: string;
  readonly executeIdempotencyHash?: string;
  readonly executeRequestFingerprint?: string;
  readonly inputDeletedAtMs?: number;
  readonly deleteIdempotencyHash?: string;
  readonly deleteRequestedAtMs?: number;
  readonly deleteCancelled?: boolean;
}

export interface ComputeExecutionInputV1 {
  readonly version: typeof COMPUTE_HTTP_EXECUTION_INPUT_VERSION;
  readonly dataset: AnalysisExecutionDataset;
  readonly task: AnalysisTaskV1;
}

export interface ComputeHttpBuildIdentityV1 {
  readonly approvalManifestSha256: string;
  readonly releaseId: string;
  readonly gitCommit: string;
  readonly flyImageDigest: string;
  readonly flyBuildId: string;
  readonly contractVersions: readonly string[];
}

export interface ComputeHttpProgressEventInput {
  readonly state: AnalysisJobStatusV1["state"];
  readonly phase: string;
  readonly completed: number;
  readonly total: number | null;
  readonly emittedAt: string;
}

export interface ComputeHttpCreateFingerprintInput {
  readonly request: CreateAnalysisJobRequestV1;
  readonly origin: string | null;
}

export type { AnalysisJobEventV1, AnalysisJobStatusV1 };
