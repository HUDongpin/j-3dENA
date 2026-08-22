import type { ComputeClock, ComputeObjectStore } from "@3dena/compute-service-core";
import {
  DatasetWorkflowError,
  createDatasetWorkflow,
  createTabularImportParserAdapter,
  type DatasetRoleMappingV1,
  type DatasetWorkflow,
  type InspectedDatasetCandidateV1,
  type ParsedWorksheetCandidateV1,
  type WorksheetSelection,
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
  type ComputeHttpCapabilityCodec,
  type ComputeHttpDatasetWorkflowService,
  type CreateComputeDatasetRequestV1,
  type PreviewComputeDatasetRequestV1,
  type PutComputeDatasetMappingRequestV1,
  type ResolvedComputeDatasetActivationV1,
  type ResolvedComputeDatasetExecutionV1,
  type SelectComputeDatasetWorksheetRequestV1,
} from "@3dena/compute-service-http";

import {
  PostgresDatasetSessionRepository,
  PostgresDatasetWorkflowStorage,
  type PersistentDatasetControlStateV1,
  type PersistentDatasetSessionRecordV1,
} from "./dataset-storage";
import type { PostgresDatabase } from "./postgres";
import { canonicalStringify, cloneFrozen, sha256Text } from "./util";

interface ControlState extends PersistentDatasetControlStateV1 {
  readonly inspected: InspectedDatasetCandidateV1 | null;
  readonly selection: WorksheetSelection | null;
  readonly parsed: ParsedWorksheetCandidateV1 | null;
  readonly mapping: DatasetRoleMappingV1 | null;
  readonly mappingSha256: string | null;
  readonly prepared: Readonly<{ activationIdentity: string }> | null;
  readonly activation: ComputeDatasetActivationReceiptV1 | null;
}

interface LoadedDataset {
  readonly record: PersistentDatasetSessionRecordV1;
  readonly state: ControlState;
  readonly workflow: DatasetWorkflow;
}

const EMPTY_STATE: ControlState = Object.freeze({
  inspected: null,
  selection: null,
  parsed: null,
  mapping: null,
  mappingSha256: null,
  prepared: null,
  activation: null,
});

function workflowError(
  code: ConstructorParameters<typeof DatasetWorkflowError>[0],
  path: string,
): never {
  throw new DatasetWorkflowError(code, path, "persistent dataset service state is unavailable");
}

export class PostgresComputeHttpDatasetWorkflowService
  implements ComputeHttpDatasetWorkflowService
{
  readonly #database: PostgresDatabase;
  readonly #repository: PostgresDatasetSessionRepository;
  readonly #objectStore: ComputeObjectStore;
  readonly #codec: ComputeHttpCapabilityCodec;
  readonly #clock: ComputeClock;

  constructor(input: Readonly<{
    database: PostgresDatabase;
    objectStore: ComputeObjectStore;
    capabilityCodec: ComputeHttpCapabilityCodec;
    clock: ComputeClock;
  }>) {
    this.#database = input.database;
    this.#repository = new PostgresDatasetSessionRepository(input.database);
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
    return cloneFrozen((await this.#repository.create(session, EMPTY_STATE)).session);
  }

  async authorize(
    datasetId: string,
    capabilityToken: string,
    origin: string | null,
  ): Promise<ComputeDatasetSessionV1 | null> {
    const loaded = await this.#repository.load(datasetId);
    if (loaded === null || loaded.session.boundOrigin !== origin ||
        this.#clock.now() >= loaded.session.expiresAtMs ||
        !this.#codec.verify(capabilityToken, loaded.session.capabilityHash)) return null;
    return cloneFrozen(loaded.session);
  }

  async uploadContent(
    session: ComputeDatasetSessionV1,
    bytes: Uint8Array,
  ): Promise<ComputeDatasetUploadResultV1> {
    const current = await this.#requireRecord(session);
    await this.#objectStore.putImmutable(session.inputObjectKey, bytes);
    const workflow = this.#workflow(session);
    const inspected = await workflow.stageUpload({
      schemaVersion: "3dena.stage-upload-request.v1",
      generation: session.generation,
      preflight: session.preflight,
      bytes,
    });
    await this.#save(current, {
      ...EMPTY_STATE,
      inspected,
    });
    return cloneFrozen(inspected);
  }

  async selectWorksheet(
    session: ComputeDatasetSessionV1,
    request: SelectComputeDatasetWorksheetRequestV1,
  ): Promise<ComputeDatasetWorksheetResultV1> {
    const loaded = await this.#rehydrate(session);
    if (loaded.state.inspected === null) workflowError("UPLOAD_NOT_FOUND", "dataset");
    const parsed = await loaded.workflow.parseWorksheet({
      schemaVersion: "3dena.parse-worksheet-request.v1",
      generation: session.generation,
      uploadIdentity: loaded.state.inspected.uploadIdentity,
      selection: request.selection,
    });
    await this.#save(loaded.record, {
      ...loaded.state,
      selection: request.selection,
      parsed,
      mapping: null,
      mappingSha256: null,
      prepared: null,
      activation: null,
    });
    return cloneFrozen(parsed);
  }

  async putMapping(
    session: ComputeDatasetSessionV1,
    request: PutComputeDatasetMappingRequestV1,
  ): Promise<ComputeDatasetMappingReceiptV1> {
    const loaded = await this.#requireRecord(session);
    const state = loaded.state as ControlState;
    if (state.parsed?.parsedIdentity !== request.parsedIdentity) {
      workflowError("PARSED_NOT_FOUND", "parsedIdentity");
    }
    const mappingSha256 = sha256Text(canonicalStringify({
      parsedIdentity: request.parsedIdentity,
      mapping: request.mapping,
    }));
    await this.#save(loaded, {
      ...state,
      mapping: cloneFrozen(request.mapping),
      mappingSha256,
      prepared: null,
      activation: null,
    });
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
    const loaded = await this.#rehydrate(session);
    if (loaded.state.parsed === null || loaded.state.mapping === null ||
        loaded.state.mappingSha256 !== request.mappingSha256) {
      workflowError("MAPPING_INVALID", "mappingSha256");
    }
    const candidate = await loaded.workflow.prepareDataset({
      schemaVersion: "3dena.prepare-dataset-request.v1",
      generation: session.generation,
      parsedIdentity: loaded.state.parsed.parsedIdentity,
      mapping: loaded.state.mapping,
    });
    await this.#save(loaded.record, {
      ...loaded.state,
      prepared: { activationIdentity: candidate.activationIdentity },
    });
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
    const loaded = await this.#rehydrate(session);
    if (loaded.state.prepared?.activationIdentity !== request.activationIdentity ||
        loaded.state.parsed === null || loaded.state.mapping === null) {
      workflowError("ACTIVATION_CANDIDATE_UNKNOWN", "activationIdentity");
    }
    await loaded.workflow.prepareDataset({
      schemaVersion: "3dena.prepare-dataset-request.v1",
      generation: session.generation,
      parsedIdentity: loaded.state.parsed.parsedIdentity,
      mapping: loaded.state.mapping,
    });
    const result = await loaded.workflow.activateDataset({
      schemaVersion: "3dena.activate-dataset-request.v1",
      generation: session.generation,
      activationIdentity: request.activationIdentity,
      expectedActiveActivationIdentity: request.expectedActiveActivationIdentity,
    });
    if (result.outcome !== "activated" || result.active === null) {
      workflowError("ACTIVATION_CONFLICT", "activation");
    }
    const core = {
      schemaVersion: COMPUTE_DATASET_ACTIVATION_RECEIPT_VERSION,
      datasetId: session.datasetId,
      generation: session.generation,
      activationIdentity: result.active.activationIdentity,
      uploadIdentity: result.active.uploadIdentity,
      datasetReceipt: result.active.receipt,
      activatedAt: new Date(this.#clock.now()).toISOString(),
      expiresAt: new Date(session.expiresAtMs).toISOString(),
    } as const;
    const receipt: ComputeDatasetActivationReceiptV1 = Object.freeze({
      ...core,
      activationReceiptSha256: sha256Text(canonicalStringify(core)),
    });
    await this.#save(loaded.record, { ...loaded.state, activation: receipt });
    return cloneFrozen(receipt);
  }

  async resolveActivation(
    receipt: ComputeDatasetActivationReceiptV1,
    capabilityToken: string,
    origin: string | null,
  ): Promise<ResolvedComputeDatasetActivationV1 | null> {
    const session = await this.authorize(receipt.datasetId, capabilityToken, origin);
    if (session === null) return null;
    const loaded = await this.#requireRecord(session);
    const state = loaded.state as ControlState;
    if (state.activation === null ||
        canonicalStringify(state.activation) !== canonicalStringify(receipt)) return null;
    const workflow = this.#workflow(session);
    const snapshot = await workflow.snapshot();
    const object = await this.#objectStore.head(session.inputObjectKey);
    if (snapshot.active === null || snapshot.active.activationIdentity !== receipt.activationIdentity ||
        object === null || object.sha256 !== session.preflight.sha256 ||
        object.byteLength !== session.preflight.byteLength) return null;
    return Object.freeze({ session, receipt: cloneFrozen(receipt), active: snapshot.active, object });
  }

  async resolveActivatedExecution(
    datasetId: string,
    activationReceiptSha256: string,
  ): Promise<ResolvedComputeDatasetExecutionV1 | null> {
    const loaded = await this.#repository.load(datasetId);
    if (loaded === null) return null;
    const state = loaded.state as ControlState;
    if (state.activation?.activationReceiptSha256 !== activationReceiptSha256) return null;
    const workflow = this.#workflow(loaded.session);
    const payload = await workflow.readActiveDataset();
    const object = await this.#objectStore.head(loaded.session.inputObjectKey);
    if (payload === null || object === null || object.sha256 !== loaded.session.preflight.sha256 ||
        payload.handle.activationIdentity !== state.activation.activationIdentity) return null;
    return Object.freeze({
      session: cloneFrozen(loaded.session),
      receipt: cloneFrozen(state.activation),
      payload: cloneFrozen(payload),
      object,
    });
  }

  async delete(session: ComputeDatasetSessionV1): Promise<void> {
    await this.#requireRecord(session);
    await this.#deleteOwnedObjects(session);
    await this.#repository.markDeleted(session.datasetId);
  }

  async deleteActivated(datasetId: string, activationReceiptSha256: string): Promise<void> {
    const loaded = await this.#repository.load(datasetId);
    if (loaded === null) return;
    const state = loaded.state as ControlState;
    if (state.activation?.activationReceiptSha256 !== activationReceiptSha256) {
      workflowError("ACTIVATION_CANDIDATE_UNKNOWN", "activationReceiptSha256");
    }
    await this.#deleteOwnedObjects(loaded.session);
    await this.#repository.markDeleted(datasetId);
  }

  async #rehydrate(session: ComputeDatasetSessionV1): Promise<LoadedDataset> {
    const record = await this.#requireRecord(session);
    const state = record.state as ControlState;
    const workflow = this.#workflow(session);
    if (state.inspected !== null) {
      const bytes = await this.#objectStore.get(session.inputObjectKey);
      if (bytes === null) workflowError("UPLOAD_NOT_FOUND", "storage.upload");
      await workflow.stageUpload({
        schemaVersion: "3dena.stage-upload-request.v1",
        generation: session.generation,
        preflight: session.preflight,
        bytes,
      });
    }
    if (state.parsed !== null && state.inspected !== null) {
      await workflow.parseWorksheet({
        schemaVersion: "3dena.parse-worksheet-request.v1",
        generation: session.generation,
        uploadIdentity: state.inspected.uploadIdentity,
        selection: state.selection,
      });
    }
    return { record, state, workflow };
  }

  #workflow(session: ComputeDatasetSessionV1): DatasetWorkflow {
    return createDatasetWorkflow({
      storage: new PostgresDatasetWorkflowStorage({
        database: this.#database,
        objectStore: this.#objectStore,
        datasetId: session.datasetId,
        inputObjectKey: session.inputObjectKey,
      }),
      parser: createTabularImportParserAdapter(),
    });
  }

  async #requireRecord(session: ComputeDatasetSessionV1): Promise<PersistentDatasetSessionRecordV1> {
    const record = await this.#repository.load(session.datasetId);
    if (record === null || canonicalStringify(record.session) !== canonicalStringify(session)) {
      workflowError("UPLOAD_NOT_FOUND", "dataset");
    }
    return record;
  }

  async #save(
    record: PersistentDatasetSessionRecordV1,
    state: ControlState,
  ): Promise<void> {
    if (!(await this.#repository.compareAndSet(record, state))) {
      workflowError("GENERATION_CONFLICT", "dataset.revision");
    }
  }

  async #deleteOwnedObjects(session: ComputeDatasetSessionV1): Promise<void> {
    const parsed = await this.#repository.listParsedObjectKeys(session.datasetId);
    for (const key of [...new Set([session.inputObjectKey, ...parsed])]) {
      await this.#objectStore.delete(key);
      if ((await this.#objectStore.head(key)) !== null) {
        workflowError("ACTIVATION_STORAGE_FAILURE", "storage.delete.probe");
      }
    }
  }
}
