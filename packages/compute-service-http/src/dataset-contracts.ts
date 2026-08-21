import type {
  ActiveDatasetPayloadV1,
  ActiveDatasetHandleV1,
  ActivationIdentityV1,
  BrowserPreflightReceiptV1,
  DatasetRoleMappingV1,
  InspectedDatasetCandidateV1,
  ParsedIdentityV1,
  ParsedWorksheetCandidateV1,
  PreparedDatasetCandidateV1,
  TypedDatasetPreviewV1,
  WorksheetSelection,
} from "@3dena/dataset-workflow";
import type {
  AnalysisResourceLimits,
  AnalysisSpecV1,
  AnalysisTaskV1,
  DatasetReceiptV1,
  PreparedSpaceMapping,
} from "@3dena/analysis";
import type { ImmutableObjectDescriptor } from "@3dena/compute-service-core";

export const COMPUTE_DATASET_HTTP_VERSION = "3dena.compute-dataset-http.v1" as const;
export const COMPUTE_SOURCE_RESULT_JOB_HTTP_VERSION =
  "3dena.compute-source-result-job-http.v1" as const;
export const COMPUTE_PREPARED_IMPORT_HTTP_VERSION =
  "3dena.compute-prepared-import-http.v1" as const;
export const COMPUTE_DATASET_ACTIVATION_RECEIPT_VERSION =
  "3dena.compute-dataset-activation-receipt.v1" as const;

export interface CreateComputeDatasetRequestV1 {
  readonly schemaVersion: "3dena.create-compute-dataset-request.v1";
  readonly preflight: BrowserPreflightReceiptV1;
  readonly processingPolicyConfirmed: true;
}

export interface ComputeDatasetCapabilityV1 {
  readonly schemaVersion: "3dena.compute-dataset-capability.v1";
  readonly datasetId: string;
  readonly generation: number;
  readonly capabilityToken: string;
  readonly contentUrl: string;
  readonly expiresAt: string;
}

export interface SelectComputeDatasetWorksheetRequestV1 {
  readonly schemaVersion: "3dena.select-compute-dataset-worksheet-request.v1";
  readonly selection: WorksheetSelection | null;
}

export interface PutComputeDatasetMappingRequestV1 {
  readonly schemaVersion: "3dena.put-compute-dataset-mapping-request.v1";
  readonly parsedIdentity: ParsedIdentityV1;
  readonly mapping: DatasetRoleMappingV1;
}

export interface ComputeDatasetMappingReceiptV1 {
  readonly schemaVersion: "3dena.compute-dataset-mapping-receipt.v1";
  readonly datasetId: string;
  readonly generation: number;
  readonly parsedIdentity: ParsedIdentityV1;
  readonly mappingSha256: string;
}

export interface PreviewComputeDatasetRequestV1 {
  readonly schemaVersion: "3dena.preview-compute-dataset-request.v1";
  readonly mappingSha256: string;
}

export interface ComputeDatasetPreviewResultV1 {
  readonly schemaVersion: "3dena.compute-dataset-preview-result.v1";
  readonly datasetId: string;
  readonly generation: number;
  readonly activationIdentity: ActivationIdentityV1;
  readonly preview: TypedDatasetPreviewV1;
  readonly candidate: PreparedDatasetCandidateV1;
}

export interface ActivateComputeDatasetRequestV1 {
  readonly schemaVersion: "3dena.activate-compute-dataset-request.v1";
  readonly activationIdentity: ActivationIdentityV1;
  readonly expectedActiveActivationIdentity: ActivationIdentityV1 | null;
}

export interface ComputeDatasetActivationReceiptV1 {
  readonly schemaVersion: typeof COMPUTE_DATASET_ACTIVATION_RECEIPT_VERSION;
  readonly datasetId: string;
  readonly generation: number;
  readonly activationIdentity: ActivationIdentityV1;
  readonly uploadIdentity: string;
  readonly datasetReceipt: DatasetReceiptV1;
  readonly activatedAt: string;
  readonly expiresAt: string;
  readonly activationReceiptSha256: string;
}

export interface CreateActivatedAnalysisJobRequestV1 {
  readonly schemaVersion: "3dena.create-activated-job-request.v1";
  readonly activationReceipt: ComputeDatasetActivationReceiptV1;
  readonly processingPolicyConfirmed: true;
}

/**
 * Creates a derived-analysis job from a successful, capability-authorized ENA
 * result after the original raw activation has been deleted. No raw rows,
 * activation capability, or result bytes cross this request boundary.
 */
export interface CreateSourceResultAnalysisJobRequestV1 {
  readonly schemaVersion: "3dena.create-source-result-job-request.v1";
  readonly sourceJobId: string;
  readonly sourceResultHash: string;
  readonly processingPolicyConfirmed: true;
}

export interface SourceResultAnalysisJobCapabilityV1 {
  readonly schemaVersion: "3dena.source-result-job-capability.v1";
  readonly jobId: string;
  readonly capabilityToken: string;
  readonly sourceJobId: string;
  readonly sourceResultHash: string;
  readonly expiresAt: string;
}

/** Browser-safe prepared import task. Exact bytes are uploaded separately and
 * are injected into the internal Worker task only by the compute service. */
export interface ActivatedPreparedImportTaskSpecV1 {
  readonly schemaVersion: "3dena.activated-prepared-import-task-spec.v1";
  readonly kind: "prepared-import";
  readonly runId: string;
  readonly deadlineEpochMilliseconds: number;
  readonly mapping: PreparedSpaceMapping;
}

export interface ExecutePreparedImportJobRequestV1 {
  readonly schemaVersion: "3dena.execute-prepared-import-job-request.v1";
  readonly datasetReceipt: DatasetReceiptV1;
  readonly task: ActivatedPreparedImportTaskSpecV1;
}

/**
 * Browser-safe ENA request. Raw rows, mapping, dataset hashes, and task IDs are
 * deliberately absent: the service derives and binds all of them from the
 * immutable activation receipt before publishing the worker input object.
 */
export interface ActivatedEnaModelTaskSpecV1 {
  readonly schemaVersion: "3dena.activated-ena-model-task-spec.v1";
  readonly kind: "ena-model";
  readonly runId: string;
  readonly deadlineEpochMilliseconds: number;
  readonly spec: AnalysisSpecV1;
  readonly limits?: Partial<AnalysisResourceLimits>;
}

export interface ExecuteActivatedAnalysisJobRequestV1 {
  readonly schemaVersion: "3dena.execute-activated-job-request.v1";
  readonly task: ActivatedAnalysisTaskSpecV1;
}

type ActivatedDerivedTaskSpecV1<Kind extends Exclude<AnalysisTaskV1["kind"], "ena-model" | "prepared-import">> =
  Omit<Extract<AnalysisTaskV1, { kind: Kind }>, "schemaVersion" | "owner"> & {
    readonly schemaVersion: `3dena.activated-${Kind}-task-spec.v1`;
    readonly runId: string;
  };

export type ActivatedNetworkComparisonTaskSpecV1 =
  ActivatedDerivedTaskSpecV1<"network-comparison">;
export type ActivatedChangeNetworkTaskSpecV1 =
  ActivatedDerivedTaskSpecV1<"change-network">;
export type ActivatedStatisticsTaskSpecV1 =
  ActivatedDerivedTaskSpecV1<"statistics">;
export type ActivatedTrajectoryTaskSpecV1 =
  ActivatedDerivedTaskSpecV1<"trajectory">;
export type ActivatedTrajectoryComparisonTaskSpecV1 =
  ActivatedDerivedTaskSpecV1<"trajectory-comparison">;
export type ActivatedBootstrapTaskSpecV1 =
  ActivatedDerivedTaskSpecV1<"bootstrap">;

export type ActivatedAnalysisTaskSpecV1 =
  | ActivatedEnaModelTaskSpecV1
  | ActivatedNetworkComparisonTaskSpecV1
  | ActivatedChangeNetworkTaskSpecV1
  | ActivatedStatisticsTaskSpecV1
  | ActivatedTrajectoryTaskSpecV1
  | ActivatedTrajectoryComparisonTaskSpecV1
  | ActivatedBootstrapTaskSpecV1;

export interface ComputeDatasetSessionV1 {
  readonly datasetId: string;
  readonly generation: number;
  readonly capabilityHash: string;
  readonly boundOrigin: string | null;
  readonly preflight: BrowserPreflightReceiptV1;
  readonly inputObjectKey: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

export interface ResolvedComputeDatasetActivationV1 {
  readonly session: ComputeDatasetSessionV1;
  readonly receipt: ComputeDatasetActivationReceiptV1;
  readonly active: ActiveDatasetHandleV1;
  readonly object: ImmutableObjectDescriptor;
}

export interface ResolvedComputeDatasetExecutionV1 {
  readonly session: ComputeDatasetSessionV1;
  readonly receipt: ComputeDatasetActivationReceiptV1;
  readonly payload: ActiveDatasetPayloadV1;
  readonly object: ImmutableObjectDescriptor;
}

export type ComputeDatasetUploadResultV1 = InspectedDatasetCandidateV1;
export type ComputeDatasetWorksheetResultV1 = ParsedWorksheetCandidateV1;
