import type {
  ComputeClock,
  ComputeObjectStore,
} from "@3dena/compute-service-core";
import {
  DatasetWorkflowError,
  InMemoryDatasetWorkflowStorage,
  createDatasetWorkflow,
  createTabularImportParserAdapter,
  type DatasetRoleMappingV1,
  type DatasetWorkflow,
  type ParsedWorksheetCandidateV1,
  type PreparedDatasetCandidateV1,
} from "@3dena/dataset-workflow";

import {
  COMPUTE_DATASET_ACTIVATION_RECEIPT_VERSION,
  type ActivateComputeDatasetRequestV1,
  type ComputeDatasetActivationReceiptV1,
  type ComputeDatasetMappingReceiptV1,
  type ComputeDatasetPreviewResultV1,
  type ComputeDatasetSessionV1,
  type ComputeDatasetUploadResultV1,
  type ComputeDatasetWorksheetResultV1,
  type CreateComputeDatasetRequestV1,
  type PreviewComputeDatasetRequestV1,
  type PutComputeDatasetMappingRequestV1,
  type ResolvedComputeDatasetActivationV1,
  type ResolvedComputeDatasetExecutionV1,
  type SelectComputeDatasetWorksheetRequestV1,
} from "./dataset-contracts";
import type { ComputeHttpDatasetWorkflowService } from "./dataset-interface";
import type { ComputeHttpCapabilityCodec } from "./interfaces";
import { canonicalStringify, cloneFrozen, isoTimestamp, sha256Text } from "./util";

interface MemoryDatasetSession {
  readonly session: ComputeDatasetSessionV1;
  readonly workflow: DatasetWorkflow;
  inspected: ComputeDatasetUploadResultV1 | undefined;
  parsed: ParsedWorksheetCandidateV1 | undefined;
  mapping: DatasetRoleMappingV1 | undefined;
  mappingSha256: string | undefined;
  prepared: PreparedDatasetCandidateV1 | undefined;
  activation: ComputeDatasetActivationReceiptV1 | undefined;
}

export class InMemoryComputeHttpDatasetWorkflowService
  implements ComputeHttpDatasetWorkflowService
{
  readonly #objectStore: ComputeObjectStore;
  readonly #codec: ComputeHttpCapabilityCodec;
  readonly #clock: ComputeClock;
  readonly #sessions = new Map<string, MemoryDatasetSession>();
  readonly #deletedActivations = new Map<string, string>();

  constructor(input: Readonly<{
    objectStore: ComputeObjectStore;
    capabilityCodec: ComputeHttpCapabilityCodec;
    clock: ComputeClock;
  }>) {
    this.#objectStore = input.objectStore;
    this.#codec = input.capabilityCodec;
    this.#clock = input.clock;
  }

  async create(input: Readonly<{
    datasetId: string;
    capabilityHash: string;
    boundOrigin: string | null;
    request: CreateComputeDatasetRequestV1;
    createdAtMs: number;
    expiresAtMs: number;
  }>): Promise<ComputeDatasetSessionV1> {
    const existing = this.#sessions.get(input.datasetId);
    const session: ComputeDatasetSessionV1 = cloneFrozen({
      datasetId: input.datasetId,
      generation: 1,
      capabilityHash: input.capabilityHash,
      boundOrigin: input.boundOrigin,
      preflight: input.request.preflight,
      inputObjectKey: `compute-datasets/${input.datasetId}/source.bin`,
      createdAtMs: input.createdAtMs,
      expiresAtMs: input.expiresAtMs,
    });
    if (existing !== undefined) {
      if (canonicalStringify(existing.session) !== canonicalStringify(session)) {
        throw new DatasetWorkflowError(
          "GENERATION_CONFLICT",
          "datasetId",
          "is already bound to another immutable create request",
        );
      }
      return cloneFrozen(existing.session);
    }
    this.#sessions.set(input.datasetId, {
      session,
      workflow: createDatasetWorkflow({
        storage: new InMemoryDatasetWorkflowStorage(),
        parser: createTabularImportParserAdapter(),
      }),
      inspected: undefined,
      parsed: undefined,
      mapping: undefined,
      mappingSha256: undefined,
      prepared: undefined,
      activation: undefined,
    });
    return cloneFrozen(session);
  }

  async authorize(
    datasetId: string,
    capabilityToken: string,
    origin: string | null,
  ): Promise<ComputeDatasetSessionV1 | null> {
    const target = this.#sessions.get(datasetId);
    if (target === undefined || this.#clock.now() >= target.session.expiresAtMs ||
        target.session.boundOrigin !== origin ||
        !this.#codec.verify(capabilityToken, target.session.capabilityHash)) return null;
    return cloneFrozen(target.session);
  }

  async uploadContent(
    session: ComputeDatasetSessionV1,
    bytes: Uint8Array,
  ): Promise<ComputeDatasetUploadResultV1> {
    const target = this.#require(session);
    await this.#objectStore.putImmutable(session.inputObjectKey, bytes);
    const inspected = await target.workflow.stageUpload({
      schemaVersion: "3dena.stage-upload-request.v1",
      generation: session.generation,
      preflight: session.preflight,
      bytes,
    });
    target.inspected = cloneFrozen(inspected);
    return cloneFrozen(inspected);
  }

  async selectWorksheet(
    session: ComputeDatasetSessionV1,
    request: SelectComputeDatasetWorksheetRequestV1,
  ): Promise<ComputeDatasetWorksheetResultV1> {
    const target = this.#require(session);
    if (target.inspected === undefined) this.#workflowError("UPLOAD_NOT_FOUND", "dataset");
    const parsed = await target.workflow.parseWorksheet({
      schemaVersion: "3dena.parse-worksheet-request.v1",
      generation: session.generation,
      uploadIdentity: target.inspected.uploadIdentity,
      selection: request.selection,
    });
    target.parsed = cloneFrozen(parsed);
    target.mapping = undefined;
    target.mappingSha256 = undefined;
    target.prepared = undefined;
    target.activation = undefined;
    return cloneFrozen(parsed);
  }

  async putMapping(
    session: ComputeDatasetSessionV1,
    request: PutComputeDatasetMappingRequestV1,
  ): Promise<ComputeDatasetMappingReceiptV1> {
    const target = this.#require(session);
    if (target.parsed?.parsedIdentity !== request.parsedIdentity) {
      this.#workflowError("PARSED_NOT_FOUND", "parsedIdentity");
    }
    const mappingSha256 = sha256Text(canonicalStringify({
      parsedIdentity: request.parsedIdentity,
      mapping: request.mapping,
    }));
    target.mapping = cloneFrozen(request.mapping);
    target.mappingSha256 = mappingSha256;
    target.prepared = undefined;
    target.activation = undefined;
    return Object.freeze({
      schemaVersion: "3dena.compute-dataset-mapping-receipt.v1",
      datasetId: session.datasetId,
      generation: session.generation,
      parsedIdentity: request.parsedIdentity,
      mappingSha256,
    });
  }

  async preview(
    session: ComputeDatasetSessionV1,
    request: PreviewComputeDatasetRequestV1,
  ): Promise<ComputeDatasetPreviewResultV1> {
    const target = this.#require(session);
    if (target.parsed === undefined || target.mapping === undefined ||
        target.mappingSha256 !== request.mappingSha256) {
      this.#workflowError("MAPPING_INVALID", "mappingSha256");
    }
    const candidate = await target.workflow.prepareDataset({
      schemaVersion: "3dena.prepare-dataset-request.v1",
      generation: session.generation,
      parsedIdentity: target.parsed.parsedIdentity,
      mapping: target.mapping,
    });
    target.prepared = cloneFrozen(candidate);
    return Object.freeze({
      schemaVersion: "3dena.compute-dataset-preview-result.v1",
      datasetId: session.datasetId,
      generation: session.generation,
      activationIdentity: candidate.activationIdentity,
      preview: cloneFrozen(candidate.preview),
      candidate: cloneFrozen(candidate),
    });
  }

  async activate(
    session: ComputeDatasetSessionV1,
    request: ActivateComputeDatasetRequestV1,
  ): Promise<ComputeDatasetActivationReceiptV1> {
    const target = this.#require(session);
    if (target.prepared?.activationIdentity !== request.activationIdentity) {
      this.#workflowError("ACTIVATION_CANDIDATE_UNKNOWN", "activationIdentity");
    }
    const result = await target.workflow.activateDataset({
      schemaVersion: "3dena.activate-dataset-request.v1",
      generation: session.generation,
      activationIdentity: request.activationIdentity,
      expectedActiveActivationIdentity: request.expectedActiveActivationIdentity,
    });
    if (result.outcome !== "activated" || result.active === null) {
      this.#workflowError("ACTIVATION_CONFLICT", "activation");
    }
    const core = {
      schemaVersion: COMPUTE_DATASET_ACTIVATION_RECEIPT_VERSION,
      datasetId: session.datasetId,
      generation: session.generation,
      activationIdentity: result.active.activationIdentity,
      uploadIdentity: result.active.uploadIdentity,
      datasetReceipt: result.active.receipt,
      activatedAt: isoTimestamp(this.#clock.now()),
      expiresAt: isoTimestamp(session.expiresAtMs),
    } as const;
    const receipt: ComputeDatasetActivationReceiptV1 = Object.freeze({
      ...core,
      activationReceiptSha256: sha256Text(canonicalStringify(core)),
    });
    target.activation = receipt;
    return cloneFrozen(receipt);
  }

  async resolveActivation(
    receipt: ComputeDatasetActivationReceiptV1,
    capabilityToken: string,
    origin: string | null,
  ): Promise<ResolvedComputeDatasetActivationV1 | null> {
    const session = await this.authorize(receipt.datasetId, capabilityToken, origin);
    if (session === null) return null;
    const target = this.#require(session);
    if (target.activation === undefined ||
        canonicalStringify(target.activation) !== canonicalStringify(receipt)) return null;
    const active = await target.workflow.snapshot();
    if (active.active === null || active.active.activationIdentity !== receipt.activationIdentity) return null;
    const object = await this.#objectStore.head(session.inputObjectKey);
    if (object === null || object.sha256 !== session.preflight.sha256 ||
        object.byteLength !== session.preflight.byteLength) return null;
    return Object.freeze({
      session,
      receipt: cloneFrozen(receipt),
      active: cloneFrozen(active.active),
      object,
    });
  }

  async resolveActivatedExecution(
    datasetId: string,
    activationReceiptSha256: string,
  ): Promise<ResolvedComputeDatasetExecutionV1 | null> {
    const target = this.#sessions.get(datasetId);
    if (
      target === undefined ||
      this.#clock.now() >= target.session.expiresAtMs ||
      target.activation?.activationReceiptSha256 !== activationReceiptSha256
    ) return null;
    const payload = await target.workflow.readActiveDataset();
    if (
      payload === null ||
      payload.handle.activationIdentity !== target.activation.activationIdentity ||
      payload.handle.receipt.sha256 !== target.activation.datasetReceipt.sha256
    ) return null;
    const object = await this.#objectStore.head(target.session.inputObjectKey);
    if (
      object === null ||
      object.sha256 !== target.session.preflight.sha256 ||
      object.byteLength !== target.session.preflight.byteLength
    ) return null;
    return Object.freeze({
      session: cloneFrozen(target.session),
      receipt: cloneFrozen(target.activation),
      payload: cloneFrozen(payload),
      object,
    });
  }

  async delete(session: ComputeDatasetSessionV1): Promise<void> {
    this.#require(session);
    await this.#objectStore.delete(session.inputObjectKey);
    this.#sessions.delete(session.datasetId);
  }

  async deleteActivated(datasetId: string, activationReceiptSha256: string): Promise<void> {
    const target = this.#sessions.get(datasetId);
    if (target === undefined) {
      if (this.#deletedActivations.get(datasetId) === activationReceiptSha256) return;
      this.#workflowError("ACTIVATION_CANDIDATE_UNKNOWN", "activationReceiptSha256");
    }
    if (target.activation?.activationReceiptSha256 !== activationReceiptSha256) {
      this.#workflowError("ACTIVATION_CANDIDATE_UNKNOWN", "activationReceiptSha256");
    }
    await this.#objectStore.delete(target.session.inputObjectKey);
    this.#deletedActivations.set(datasetId, activationReceiptSha256);
    this.#sessions.delete(datasetId);
  }

  #require(session: ComputeDatasetSessionV1): MemoryDatasetSession {
    const target = this.#sessions.get(session.datasetId);
    if (target === undefined || canonicalStringify(target.session) !== canonicalStringify(session)) {
      this.#workflowError("UPLOAD_NOT_FOUND", "dataset");
    }
    return target;
  }

  #workflowError(
    code: ConstructorParameters<typeof DatasetWorkflowError>[0],
    path: string,
  ): never {
    throw new DatasetWorkflowError(code, path, "dataset workflow state is unavailable");
  }
}
