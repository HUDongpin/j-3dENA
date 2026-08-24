import { type AnalysisTaskV1, type DatasetReceiptV1, type TaskOwnerV1 } from "./contracts.js";
export type RemoteJobStateV1 = "CREATED" | "UPLOADED" | "QUEUED" | "RUNNING" | "CANCEL_REQUESTED" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "EXPIRED";
export interface CreateAnalysisJobRequestV1 {
    schemaVersion: "3dena.create-job-request.v1";
    dataset: {
        sha256: string;
        byteLength: number;
        format: DatasetReceiptV1["format"];
    };
    processingPolicyConfirmed: true;
}
export interface AnalysisJobCapabilityV1 {
    schemaVersion: "3dena.job-capability.v1";
    jobId: string;
    capabilityToken: string;
    uploadUrl: string;
    expiresAt: string;
}
export interface AnalysisJobReferenceV1 {
    jobId: string;
    capabilityToken: string;
}
export interface ExecuteAnalysisJobRequestV1 {
    schemaVersion: "3dena.execute-job-request.v1";
    datasetReceipt: DatasetReceiptV1;
    task: AnalysisTaskV1;
}
export interface AnalysisJobStatusV1 {
    schemaVersion: "3dena.job-status.v1";
    jobId: string;
    state: RemoteJobStateV1;
    owner: TaskOwnerV1 | null;
    progress: {
        phase: string;
        completed: number;
        total: number | null;
    } | null;
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
    resultAvailable: boolean;
    errorCode: string | null;
}
export interface AnalysisJobEventV1 {
    schemaVersion: "3dena.job-event.v1";
    sequence: number;
    state: RemoteJobStateV1;
    phase: string;
    completed: number;
    total: number | null;
    emittedAt: string;
}
export interface AnalysisJobResultReferenceV1 {
    schemaVersion: "3dena.job-result-reference.v1";
    jobId: string;
    sha256: string;
    byteLength: number;
    resultUrl: string;
    exportUrl: string | null;
    expiresAt: string;
}
export interface AnalysisDeletionReceiptV1 {
    schemaVersion: "3dena.job-deletion-receipt.v1";
    jobId: string;
    cancelled: boolean;
    inputDeleted: boolean;
    resultDeleted: boolean;
    deletedAt: string;
}
export interface AnalysisDeletionReceiptV2 {
    schemaVersion: "3dena.job-deletion-receipt.v2";
    jobId: string;
    cancelled: boolean;
    inputDeleted: boolean;
    resultDeleted: boolean;
    deletedAt: string | null;
    readonly intentAccepted: true;
    readonly termination: "not_required" | "pending" | "observed";
    readonly capacity: "not_reserved" | "held" | "released";
    readonly objects: "pending" | "deleted";
}
export interface AnalysisComputeBuildInfoV1 {
    schemaVersion: "3dena.compute-build-info.v1";
    approvalManifestSha256: string;
    releaseId: string;
    gitCommit: string;
    flyImageDigest: string;
    flyBuildId: string;
    role: "api";
    contractVersions: string[];
}
export interface AnalysisClientConfig {
    baseUrl: string;
    fetch?: typeof fetch;
    /** Client-side request deadline; the scientific task retains its own deadline. */
    requestTimeoutMilliseconds?: number;
    /** Delay between stable-key V2 deletion reconciliation requests. */
    deletionPollIntervalMilliseconds?: number;
    /** Total time allowed for the durable deletion lifecycle to close. */
    deletionCompletionTimeoutMilliseconds?: number;
}
export interface AnalysisClientV1 {
    createJob(request: CreateAnalysisJobRequestV1, idempotencyKey: string): Promise<AnalysisJobCapabilityV1>;
    executeJob(reference: AnalysisJobReferenceV1, request: ExecuteAnalysisJobRequestV1, idempotencyKey: string): Promise<AnalysisJobStatusV1>;
    getJob(reference: AnalysisJobReferenceV1): Promise<AnalysisJobStatusV1>;
    events(reference: AnalysisJobReferenceV1, signal?: AbortSignal): AsyncGenerator<AnalysisJobEventV1>;
    getResult(reference: AnalysisJobReferenceV1): Promise<AnalysisJobResultReferenceV1>;
    deleteJob(reference: AnalysisJobReferenceV1, idempotencyKey: string): Promise<AnalysisDeletionReceiptV1>;
    getBuildInfo(): Promise<AnalysisComputeBuildInfoV1>;
}
/**
 * Additive durable-deletion client contract. Keeping these methods out of V1
 * preserves source compatibility for existing V1-only client implementations.
 */
export interface AnalysisClientV2 extends AnalysisClientV1 {
    deleteJobV2(reference: AnalysisJobReferenceV1, idempotencyKey: string): Promise<AnalysisDeletionReceiptV2>;
    deleteJobUntilComplete(reference: AnalysisJobReferenceV1, idempotencyKey: string): Promise<AnalysisDeletionReceiptV2>;
}
export declare class AnalysisClientError extends Error {
    readonly code: string;
    readonly status: number | null;
    readonly requestId: string | null;
    constructor(code: string, message: string, status?: number | null, requestId?: string | null);
}
/** Creates the capability-token remote client used by the public Web product. */
export declare function createAnalysisClient(config: AnalysisClientConfig): AnalysisClientV2;
//# sourceMappingURL=analysis-client.d.ts.map