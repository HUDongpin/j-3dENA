import type { ComputeObjectStore } from "@3dena/compute-service-core";

import type {
  ActivateComputeDatasetRequestV1,
  ComputeDatasetActivationReceiptV1,
  ComputeDatasetMappingReceiptV1,
  ComputeDatasetPreviewResultV1,
  ComputeDatasetSessionV1,
  ComputeDatasetUploadResultV1,
  ComputeDatasetWorksheetResultV1,
  CreateComputeDatasetRequestV1,
  PreviewComputeDatasetRequestV1,
  PutComputeDatasetMappingRequestV1,
  ResolvedComputeDatasetActivationV1,
  ResolvedComputeDatasetExecutionV1,
  SelectComputeDatasetWorksheetRequestV1,
} from "./dataset-contracts";

export interface ComputeHttpDatasetWorkflowService {
  create(input: Readonly<{
    datasetId: string;
    capabilityHash: string;
    boundOrigin: string | null;
    request: CreateComputeDatasetRequestV1;
    createdAtMs: number;
    expiresAtMs: number;
  }>): Promise<ComputeDatasetSessionV1>;
  authorize(
    datasetId: string,
    capabilityToken: string,
    origin: string | null,
  ): Promise<ComputeDatasetSessionV1 | null>;
  uploadContent(
    session: ComputeDatasetSessionV1,
    bytes: Uint8Array,
  ): Promise<ComputeDatasetUploadResultV1>;
  selectWorksheet(
    session: ComputeDatasetSessionV1,
    request: SelectComputeDatasetWorksheetRequestV1,
  ): Promise<ComputeDatasetWorksheetResultV1>;
  putMapping(
    session: ComputeDatasetSessionV1,
    request: PutComputeDatasetMappingRequestV1,
  ): Promise<ComputeDatasetMappingReceiptV1>;
  preview(
    session: ComputeDatasetSessionV1,
    request: PreviewComputeDatasetRequestV1,
  ): Promise<ComputeDatasetPreviewResultV1>;
  activate(
    session: ComputeDatasetSessionV1,
    request: ActivateComputeDatasetRequestV1,
  ): Promise<ComputeDatasetActivationReceiptV1>;
  resolveActivation(
    receipt: ComputeDatasetActivationReceiptV1,
    capabilityToken: string,
    origin: string | null,
  ): Promise<ResolvedComputeDatasetActivationV1 | null>;
  resolveActivatedExecution(
    datasetId: string,
    activationReceiptSha256: string,
  ): Promise<ResolvedComputeDatasetExecutionV1 | null>;
  delete(session: ComputeDatasetSessionV1): Promise<void>;
  deleteActivated(datasetId: string, activationReceiptSha256: string): Promise<void>;
}

export interface ComputeHttpDatasetWorkflowDependencies {
  readonly service: ComputeHttpDatasetWorkflowService;
  readonly objectStore: ComputeObjectStore;
}
