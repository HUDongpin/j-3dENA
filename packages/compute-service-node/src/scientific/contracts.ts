import type {
  AnalysisExecutionDataset,
  AnalysisResultEnvelopeV1,
  AnalysisTaskResultV1,
  AnalysisTaskV1,
} from "@3dena/analysis";
import type {
  ImmutableObjectDescriptor,
  LeaseTokenV1,
  ProcessLaunchContextV1,
  TaskOwnerV1 as ComputeTaskOwnerV1,
} from "@3dena/compute-service-core";

export const SCIENTIFIC_WORKER_PROTOCOL_VERSION =
  "3dena.compute-scientific-worker.v1" as const;
export const SCIENTIFIC_EXECUTION_INPUT_VERSION =
  "3dena.compute-scientific-execution-input.v1" as const;
export const SCIENTIFIC_STORED_INPUT_VERSION =
  "3dena.compute-scientific-stored-input.v1" as const;
export const SCIENTIFIC_WORKER_LAUNCH_VERSION =
  "3dena.compute-scientific-worker-launch.v1" as const;
export const SCIENTIFIC_RESULT_ARTIFACT_VERSION =
  "3dena.compute-scientific-result-artifact.v1" as const;
export const SCIENTIFIC_ARTIFACT_PUT_REQUEST_VERSION =
  "3dena.compute-scientific-artifact-put-request.v1" as const;
export const SCIENTIFIC_ARTIFACT_PUT_ACK_VERSION =
  "3dena.compute-scientific-artifact-put-ack.v1" as const;
export const SCIENTIFIC_PUBLICATION_REQUEST_VERSION =
  "3dena.compute-scientific-publication-request.v1" as const;
export const SCIENTIFIC_PUBLICATION_RECEIPT_VERSION =
  "3dena.compute-scientific-publication-receipt.v1" as const;
export const SCIENTIFIC_PUBLICATION_ACK_VERSION =
  "3dena.compute-scientific-publication-ack.v1" as const;
export const SCIENTIFIC_WORKER_FAILURE_VERSION =
  "3dena.compute-scientific-worker-failure.v1" as const;
export const SCIENTIFIC_SESSION_ADAPTER_OPTIONS_VERSION =
  "3dena.compute-scientific-session-adapter-options.v1" as const;
export const SCIENTIFIC_INPUT_PROVIDER_VERSION =
  "3dena.compute-scientific-input-provider.v1" as const;
export const SCIENTIFIC_JSON_INPUT_PROVIDER_OPTIONS_VERSION =
  "3dena.compute-scientific-json-input-provider-options.v1" as const;
export const SCIENTIFIC_RESULT_PUBLISHER_VERSION =
  "3dena.compute-scientific-result-publisher.v1" as const;
export const FILE_SYSTEM_RESULT_STORE_OPTIONS_VERSION =
  "3dena.compute-file-result-store-options.v1" as const;

export const DEFAULT_MAX_SCIENTIFIC_INPUT_BYTES = 32 * 1024 * 1024;
export const DEFAULT_MAX_SCIENTIFIC_RESULT_BYTES = 128 * 1024 * 1024;
export const HARD_MAX_SCIENTIFIC_ARTIFACT_BYTES = 256 * 1024 * 1024;

export interface ScientificExecutionInputV1 {
  readonly version: typeof SCIENTIFIC_EXECUTION_INPUT_VERSION;
  readonly source: ImmutableObjectDescriptor;
  readonly dataset: AnalysisExecutionDataset;
  readonly task: AnalysisTaskV1;
}

/** Immutable JSON object bytes addressed by the core request descriptor. */
export interface ScientificStoredInputV1 {
  readonly version: typeof SCIENTIFIC_STORED_INPUT_VERSION;
  readonly dataset: AnalysisExecutionDataset;
  readonly task: AnalysisTaskV1;
}

export interface ScientificWorkerPublicationBindingV1 {
  readonly executionId: string;
  readonly resultObjectKey: string;
  readonly owner: ComputeTaskOwnerV1;
  readonly lease: LeaseTokenV1;
}

export interface ScientificWorkerLaunchPayloadV1 {
  readonly version: typeof SCIENTIFIC_WORKER_LAUNCH_VERSION;
  readonly input: ScientificExecutionInputV1;
  readonly publication: ScientificWorkerPublicationBindingV1;
}

export interface ScientificResultArtifactV1 {
  readonly version: typeof SCIENTIFIC_RESULT_ARTIFACT_VERSION;
  readonly owner: AnalysisResultEnvelopeV1<AnalysisTaskResultV1>["owner"];
  readonly taskKind: AnalysisTaskV1["kind"];
  readonly envelope: AnalysisResultEnvelopeV1<AnalysisTaskResultV1>;
}

export interface ScientificArtifactPutRequestV1 {
  readonly version: typeof SCIENTIFIC_ARTIFACT_PUT_REQUEST_VERSION;
  readonly protocolVersion: typeof SCIENTIFIC_WORKER_PROTOCOL_VERSION;
  readonly type: "artifact-put-request";
  readonly executionId: string;
  readonly owner: ComputeTaskOwnerV1;
  readonly lease: LeaseTokenV1;
  readonly object: ImmutableObjectDescriptor;
  readonly bytes: Uint8Array;
}

export interface ScientificArtifactPutAckV1 {
  readonly version: typeof SCIENTIFIC_ARTIFACT_PUT_ACK_VERSION;
  readonly protocolVersion: typeof SCIENTIFIC_WORKER_PROTOCOL_VERSION;
  readonly type: "artifact-put-ack";
  readonly executionId: string;
  readonly object: ImmutableObjectDescriptor;
}

export interface ScientificPublicationRequestV1 {
  readonly version: typeof SCIENTIFIC_PUBLICATION_REQUEST_VERSION;
  readonly protocolVersion: typeof SCIENTIFIC_WORKER_PROTOCOL_VERSION;
  readonly type: "publication-request";
  readonly executionId: string;
  readonly owner: ComputeTaskOwnerV1;
  readonly lease: LeaseTokenV1;
  readonly object: ImmutableObjectDescriptor;
}

export interface ScientificPublicationReceiptV1 {
  readonly version: typeof SCIENTIFIC_PUBLICATION_RECEIPT_VERSION;
  readonly accepted: true;
  readonly executionId: string;
  readonly owner: ComputeTaskOwnerV1;
  readonly leaseId: string;
  readonly leaseEpoch: number;
  readonly object: ImmutableObjectDescriptor;
  readonly publishedAtMs: number;
}

export interface ScientificPublicationAckV1 {
  readonly version: typeof SCIENTIFIC_PUBLICATION_ACK_VERSION;
  readonly protocolVersion: typeof SCIENTIFIC_WORKER_PROTOCOL_VERSION;
  readonly type: "publication-ack";
  readonly receipt: ScientificPublicationReceiptV1;
}

export type ScientificWorkerFailureCodeV1 =
  | "INVALID_INPUT"
  | "DEADLINE_EXCEEDED"
  | "EXECUTION_FAILED"
  | "ARTIFACT_STORE_FAILED"
  | "PUBLICATION_FAILED"
  | "PROTOCOL_FAILED";

export interface ScientificWorkerFailureV1 {
  readonly version: typeof SCIENTIFIC_WORKER_FAILURE_VERSION;
  readonly protocolVersion: typeof SCIENTIFIC_WORKER_PROTOCOL_VERSION;
  readonly type: "failed";
  readonly executionId: string;
  readonly code: ScientificWorkerFailureCodeV1;
}

export type ScientificWorkerToParentMessageV1 =
  | ScientificArtifactPutRequestV1
  | ScientificPublicationRequestV1
  | ScientificWorkerFailureV1;

export type ScientificParentToWorkerMessageV1 =
  | ScientificArtifactPutAckV1
  | ScientificPublicationAckV1;

export interface ScientificInputProviderV1 {
  readonly version: typeof SCIENTIFIC_INPUT_PROVIDER_VERSION;
  load(
    context: ProcessLaunchContextV1,
    signal: AbortSignal,
  ): Promise<ScientificExecutionInputV1>;
}

export interface ScientificJsonInputProviderOptionsV1 {
  readonly version: typeof SCIENTIFIC_JSON_INPUT_PROVIDER_OPTIONS_VERSION;
  readonly objectStore: import("@3dena/compute-service-core").ComputeObjectStore;
  readonly maxInputBytes?: number;
}

export interface ScientificResultPublisherV1 {
  readonly version: typeof SCIENTIFIC_RESULT_PUBLISHER_VERSION;
  publish(
    request: ScientificPublicationRequestV1,
    signal: AbortSignal,
  ): Promise<ScientificPublicationReceiptV1>;
}

export interface ScientificSessionAdapterOptionsV1 {
  readonly version: typeof SCIENTIFIC_SESSION_ADAPTER_OPTIONS_VERSION;
  readonly inputProvider: ScientificInputProviderV1;
  readonly resultStore: import("@3dena/compute-service-core").ComputeObjectStore;
  readonly publisher: ScientificResultPublisherV1;
  readonly maxResultBytes?: number;
}

export interface FileSystemResultStoreOptionsV1 {
  readonly version: typeof FILE_SYSTEM_RESULT_STORE_OPTIONS_VERSION;
  readonly rootDirectory: string;
}

export interface ScientificSessionAdapterSnapshotV1 {
  readonly version: "3dena.compute-scientific-session-snapshot.v1";
  readonly activeBindings: number;
  readonly totalFailures: number;
  readonly failures: ReadonlyArray<
    Readonly<{ code: ScientificWorkerFailureCodeV1; count: number }>
  >;
}
