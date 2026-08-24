import { createHash } from "node:crypto";

import type { ComputeObjectStore } from "@3dena/compute-service-core";
import {
  DatasetWorkflowError,
  type AtomicActivationOutcomeV1,
  type AtomicActivationRequestV1,
  type DatasetWorkflowStorage,
  type GenerationClaimOutcomeV1,
  type ImmutableParsedRecordV1,
  type ImmutablePutOutcomeV1,
  type ImmutableUploadRecordV1,
  type ParsedIdentityV1,
  type StoredActivationRecordV1,
  type UploadIdentityV1,
} from "@3dena/dataset-workflow";
import type { ComputeDatasetSessionV1 } from "@3dena/compute-service-http";

import type { PostgresDatabase, SqlQueryExecutor } from "./postgres";
import { canonicalStringify, cloneFrozen, isRecord, OPAQUE_ID } from "./util";

interface WorkflowRow extends Record<string, unknown> {
  readonly generation?: unknown;
  readonly revision?: unknown;
  readonly session?: unknown;
  readonly control_state?: unknown;
  readonly active_record?: unknown;
}

interface ArtifactRow extends Record<string, unknown> {
  readonly record?: unknown;
}

interface PersistentParsedObjectRefV1 {
  readonly schemaVersion: "3dena.persistent-parsed-object-ref.v1";
  readonly parsedIdentity: string;
  readonly object: Readonly<{
    key: string;
    sha256: string;
    byteLength: number;
  }>;
}

export interface PersistentDatasetControlStateV1 {
  readonly inspected: unknown | null;
  readonly selection: unknown | null;
  readonly parsed: unknown | null;
  readonly mapping: unknown | null;
  readonly mappingSha256: string | null;
  readonly prepared: unknown | null;
  readonly activation: unknown | null;
}

export interface PersistentDatasetSessionRecordV1 {
  readonly revision: number;
  readonly session: ComputeDatasetSessionV1;
  readonly state: PersistentDatasetControlStateV1;
}

function workflowError(
  code: ConstructorParameters<typeof DatasetWorkflowError>[0],
  path: string,
): never {
  throw new DatasetWorkflowError(code, path, "persistent dataset state is unavailable");
}

function safeInteger(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 0) {
    workflowError("ACTIVATION_STORAGE_FAILURE", "storage.integer");
  }
  return Number(parsed);
}

function bytesSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class PostgresDatasetSessionRepository {
  readonly #database: PostgresDatabase;

  constructor(database: PostgresDatabase) {
    this.#database = database;
  }

  async create(
    session: ComputeDatasetSessionV1,
    state: PersistentDatasetControlStateV1,
  ): Promise<PersistentDatasetSessionRecordV1> {
    if (!OPAQUE_ID.test(session.datasetId)) workflowError("INVALID_REQUEST", "datasetId");
    const result = await this.#database.query<WorkflowRow>(
      `INSERT INTO compute_dataset_workflows (
        dataset_id, generation, revision, session, control_state, expires_at
      ) VALUES ($1,$2,0,$3::jsonb,$4::jsonb,to_timestamp($5 / 1000.0))
      ON CONFLICT (dataset_id) DO NOTHING
      RETURNING generation, revision, session, control_state, active_record`,
      [session.datasetId, session.generation, JSON.stringify(session),
        JSON.stringify(state), session.expiresAtMs],
    );
    if (result.rowCount === 0) {
      const existing = await this.load(session.datasetId);
      if (existing === null || canonicalStringify(existing.session) !== canonicalStringify(session)) {
        workflowError("GENERATION_CONFLICT", "datasetId");
      }
      return existing;
    }
    return { revision: 0, session: cloneFrozen(session), state: cloneFrozen(state) };
  }

  async load(datasetId: string): Promise<PersistentDatasetSessionRecordV1 | null> {
    const result = await this.#database.query<WorkflowRow>(
      `SELECT revision, session, control_state FROM compute_dataset_workflows
       WHERE dataset_id = $1 AND deleted_at IS NULL
         AND expires_at > clock_timestamp()`,
      [datasetId],
    );
    const row = result.rows[0];
    if (!isRecord(row?.session) || !isRecord(row.control_state)) return null;
    return {
      revision: safeInteger(row.revision),
      session: cloneFrozen(row.session as unknown as ComputeDatasetSessionV1),
      state: cloneFrozen(row.control_state as unknown as PersistentDatasetControlStateV1),
    };
  }

  async compareAndSet(
    record: PersistentDatasetSessionRecordV1,
    state: PersistentDatasetControlStateV1,
  ): Promise<boolean> {
    const result = await this.#database.query<WorkflowRow>(
      `UPDATE compute_dataset_workflows
       SET revision = revision + 1, control_state = $3::jsonb,
           updated_at = clock_timestamp()
       WHERE dataset_id = $1 AND revision = $2 AND deleted_at IS NULL
         AND expires_at > clock_timestamp()
       RETURNING revision`,
      [record.session.datasetId, record.revision, JSON.stringify(state)],
    );
    return result.rowCount === 1;
  }

  async markDeleted(datasetId: string): Promise<void> {
    await this.#database.transaction(async (sql) => {
      await sql.query("DELETE FROM compute_dataset_artifacts WHERE dataset_id = $1", [datasetId]);
      const deleted = await sql.query(
        `UPDATE compute_dataset_workflows SET deleted_at = clock_timestamp(),
           revision = revision + 1, control_state = '{}'::jsonb,
           active_record = NULL, updated_at = clock_timestamp()
         WHERE dataset_id = $1 AND deleted_at IS NULL`,
        [datasetId],
      );
      if (deleted.rowCount > 0) {
        await sql.query(
          `INSERT INTO compute_dataset_deletion_receipts (dataset_id, deleted_at)
           VALUES ($1, clock_timestamp()) ON CONFLICT (dataset_id) DO NOTHING`,
          [datasetId],
        );
      }
    });
  }

  async listParsedObjectKeys(datasetId: string): Promise<readonly string[]> {
    const result = await this.#database.query<ArtifactRow>(
      `SELECT record FROM compute_dataset_artifacts
       WHERE dataset_id = $1 AND artifact_kind = 'parsed'
       ORDER BY artifact_identity`,
      [datasetId],
    );
    return result.rows.map(({ record }) => {
      if (!isRecord(record) || record.schemaVersion !== "3dena.persistent-parsed-object-ref.v1" ||
          !isRecord(record.object) || typeof record.object.key !== "string") {
        workflowError("PARSED_STORAGE_FAILURE", "storage.parsed.object");
      }
      return record.object.key;
    });
  }
}

export class PostgresDatasetWorkflowStorage implements DatasetWorkflowStorage {
  readonly #database: PostgresDatabase;
  readonly #objectStore: ComputeObjectStore;
  readonly #datasetId: string;
  readonly #inputObjectKey: string;

  constructor(input: Readonly<{
    database: PostgresDatabase;
    objectStore: ComputeObjectStore;
    datasetId: string;
    inputObjectKey: string;
  }>) {
    this.#database = input.database;
    this.#objectStore = input.objectStore;
    this.#datasetId = input.datasetId;
    this.#inputObjectKey = input.inputObjectKey;
  }

  async claimGeneration(generation: number): Promise<GenerationClaimOutcomeV1> {
    return this.#database.transaction(async (sql) => {
      const row = await this.#lockedWorkflow(sql);
      const current = safeInteger(row.generation);
      if (generation < current) return "stale";
      if (generation === current) return "current";
      await sql.query(
        `UPDATE compute_dataset_workflows SET generation = $2,
          updated_at = clock_timestamp()
         WHERE dataset_id = $1`,
        [this.#datasetId, generation],
      );
      return "claimed";
    });
  }

  async isGenerationCurrent(generation: number): Promise<boolean> {
    const result = await this.#database.query<WorkflowRow>(
      `SELECT generation FROM compute_dataset_workflows
       WHERE dataset_id = $1 AND deleted_at IS NULL
         AND expires_at > clock_timestamp()`,
      [this.#datasetId],
    );
    return result.rows[0] !== undefined && safeInteger(result.rows[0].generation) === generation;
  }

  async putUpload(record: ImmutableUploadRecordV1): Promise<ImmutablePutOutcomeV1> {
    const [head, bytes] = await Promise.all([
      this.#objectStore.head(this.#inputObjectKey),
      this.#objectStore.get(this.#inputObjectKey),
    ]);
    if (head === null || bytes === null || head.sha256 !== record.sha256 ||
        head.byteLength !== record.byteLength || bytesSha256(bytes) !== record.sha256 ||
        bytes.byteLength !== record.bytes.byteLength || bytesSha256(record.bytes) !== record.sha256) {
      workflowError("UPLOAD_CUSTODY_MISMATCH", "storage.upload");
    }
    const metadata = { ...record, bytes: undefined };
    delete (metadata as { bytes?: unknown }).bytes;
    const inserted = await this.#database.query(
      `INSERT INTO compute_dataset_artifacts (
        dataset_id, artifact_kind, artifact_identity, record
      ) VALUES ($1,'upload',$2,$3::jsonb)
      ON CONFLICT (dataset_id, artifact_kind, artifact_identity) DO NOTHING`,
      [this.#datasetId, record.uploadIdentity, JSON.stringify(metadata)],
    );
    if (inserted.rowCount === 1) return "created";
    const existing = await this.#artifact("upload", record.uploadIdentity);
    if (canonicalStringify(existing) !== canonicalStringify(metadata)) {
      workflowError("UPLOAD_CUSTODY_MISMATCH", "storage.upload");
    }
    return "existing";
  }

  async readUpload(identity: UploadIdentityV1): Promise<ImmutableUploadRecordV1 | null> {
    const metadata = await this.#artifact("upload", identity);
    if (metadata === null) return null;
    const bytes = await this.#objectStore.get(this.#inputObjectKey);
    if (bytes === null || !isRecord(metadata)) return null;
    return cloneFrozen({
      ...metadata,
      bytes,
    } as unknown as ImmutableUploadRecordV1);
  }

  async putParsed(record: ImmutableParsedRecordV1): Promise<ImmutablePutOutcomeV1> {
    const bytes = new TextEncoder().encode(canonicalStringify(record));
    const key = `compute-datasets/${this.#datasetId}/parsed/${bytesSha256(bytes)}.json`;
    const stored = await this.#objectStore.putImmutable(key, bytes);
    const reference: PersistentParsedObjectRefV1 = Object.freeze({
      schemaVersion: "3dena.persistent-parsed-object-ref.v1",
      parsedIdentity: record.parsedIdentity,
      object: stored.descriptor,
    });
    const inserted = await this.#database.query(
      `INSERT INTO compute_dataset_artifacts (
        dataset_id, artifact_kind, artifact_identity, record
      ) VALUES ($1,'parsed',$2,$3::jsonb)
      ON CONFLICT (dataset_id, artifact_kind, artifact_identity) DO NOTHING`,
      [this.#datasetId, record.parsedIdentity, JSON.stringify(reference)],
    );
    if (inserted.rowCount === 1) return "created";
    const existing = await this.#artifact("parsed", record.parsedIdentity);
    if (canonicalStringify(existing) !== canonicalStringify(reference)) {
      workflowError("PARSED_STORAGE_FAILURE", "storage.parsed");
    }
    return "existing";
  }

  async readParsed(identity: ParsedIdentityV1): Promise<ImmutableParsedRecordV1 | null> {
    const reference = await this.#artifact("parsed", identity);
    if (reference === null) return null;
    if (!isRecord(reference) || reference.schemaVersion !== "3dena.persistent-parsed-object-ref.v1" ||
        reference.parsedIdentity !== identity || !isRecord(reference.object) ||
        typeof reference.object.key !== "string" || typeof reference.object.sha256 !== "string" ||
        !Number.isSafeInteger(reference.object.byteLength)) {
      workflowError("PARSED_STORAGE_FAILURE", "storage.parsed.reference");
    }
    const [head, bytes] = await Promise.all([
      this.#objectStore.head(reference.object.key),
      this.#objectStore.get(reference.object.key),
    ]);
    if (head === null || bytes === null || head.sha256 !== reference.object.sha256 ||
        head.byteLength !== reference.object.byteLength ||
        bytes.byteLength !== reference.object.byteLength ||
        bytesSha256(bytes) !== reference.object.sha256) {
      workflowError("PARSED_STORAGE_FAILURE", "storage.parsed.bytes");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      workflowError("PARSED_STORAGE_FAILURE", "storage.parsed.json");
    }
    if (!isRecord(parsed) || parsed.parsedIdentity !== identity) {
      workflowError("PARSED_STORAGE_FAILURE", "storage.parsed.identity");
    }
    return cloneFrozen(parsed as unknown as ImmutableParsedRecordV1);
  }

  async activateAtomic(request: AtomicActivationRequestV1): Promise<AtomicActivationOutcomeV1> {
    return this.#database.transaction(async (sql) => {
      const row = await this.#lockedWorkflow(sql);
      if (safeInteger(row.generation) !== request.generation) return "stale";
      const active = row.active_record;
      const current = isRecord(active) && isRecord(active.handle) &&
        typeof active.handle.activationIdentity === "string"
        ? active.handle.activationIdentity
        : null;
      if (current !== request.expectedActiveActivationIdentity) return "conflict";
      await sql.query(
        `UPDATE compute_dataset_workflows SET active_record = $2::jsonb,
          updated_at = clock_timestamp()
         WHERE dataset_id = $1`,
        [this.#datasetId, JSON.stringify(request.next)],
      );
      return "activated";
    });
  }

  async readActive(): Promise<StoredActivationRecordV1 | null> {
    const result = await this.#database.query<WorkflowRow>(
      `SELECT active_record FROM compute_dataset_workflows
       WHERE dataset_id = $1 AND deleted_at IS NULL
         AND expires_at > clock_timestamp()`,
      [this.#datasetId],
    );
    const active = result.rows[0]?.active_record;
    return isRecord(active)
      ? cloneFrozen(active as unknown as StoredActivationRecordV1)
      : null;
  }

  async #lockedWorkflow(sql: SqlQueryExecutor): Promise<WorkflowRow> {
    const result = await sql.query<WorkflowRow>(
      `SELECT generation, active_record FROM compute_dataset_workflows
       WHERE dataset_id = $1 AND deleted_at IS NULL
         AND expires_at > clock_timestamp() FOR UPDATE`,
      [this.#datasetId],
    );
    const row = result.rows[0];
    if (row === undefined) workflowError("ACTIVATION_STORAGE_FAILURE", "storage.dataset");
    return row;
  }

  async #artifact(kind: "upload" | "parsed", identity: string): Promise<unknown | null> {
    const result = await this.#database.query<ArtifactRow>(
      `SELECT record FROM compute_dataset_artifacts
       WHERE dataset_id = $1 AND artifact_kind = $2 AND artifact_identity = $3`,
      [this.#datasetId, kind, identity],
    );
    return result.rows[0]?.record ?? null;
  }
}
