import { createHash } from "node:crypto";

import {
  assertAnalysisResultEnvelopeV1,
  hashAnalysisValueV1,
  type AnalysisExecutionSourceResultV2,
  type AnalysisResultEnvelopeV1,
  type AnalysisTaskResultV1,
} from "@3dena/analysis";
import type {
  ComputeObjectStore,
  ImmutableObjectDescriptor,
} from "@3dena/compute-service-core";
import type {
  ComputeHttpSourceResultResolver,
  ResolvedComputeHttpSourceResultV1,
} from "@3dena/compute-service-http";

import { persistentError } from "./errors";
import type { PostgresDatabase } from "./postgres";
import {
  canonicalStringify,
  hasExactKeys,
  isRecord,
  LOWER_SHA256,
  OPAQUE_ID,
} from "./util";

interface SourceResultRow extends Record<string, unknown> {
  readonly publication_id?: unknown;
  readonly generation?: unknown;
  readonly result_hash?: unknown;
  readonly dataset_hash?: unknown;
  readonly spec_hash?: unknown;
  readonly build_id?: unknown;
  readonly task_id?: unknown;
  readonly object_key?: unknown;
  readonly object_sha256?: unknown;
  readonly object_byte_length?: unknown;
  readonly published_at_ms?: unknown;
  readonly expires_at_ms?: unknown;
  readonly publication_receipt?: unknown;
}

export interface PublishedScientificResultRecordV1 {
  readonly sourceResultHash: string;
  readonly owner: AnalysisResultEnvelopeV1<AnalysisTaskResultV1>["owner"];
  readonly buildId: string;
  readonly object: ImmutableObjectDescriptor;
  readonly publishedAtMs: number;
  readonly expiresAtMs: number;
  readonly publicationReceipt: unknown;
}

function safeInteger(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 0) {
    persistentError("DATABASE_FAILURE");
  }
  return Number(parsed);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function publicationMatches(
  row: SourceResultRow,
  record: PublishedScientificResultRecordV1,
): boolean {
  return row.result_hash === record.sourceResultHash &&
    row.dataset_hash === record.owner.datasetHash &&
    row.spec_hash === record.owner.specHash &&
    row.build_id === record.buildId &&
    row.task_id === record.owner.taskId &&
    row.object_key === record.object.key &&
    row.object_sha256 === record.object.sha256 &&
    safeInteger(row.object_byte_length) === record.object.byteLength &&
    safeInteger(row.published_at_ms) === record.publishedAtMs &&
    safeInteger(row.expires_at_ms) === record.expiresAtMs &&
    canonicalStringify(row.publication_receipt) ===
      canonicalStringify(record.publicationReceipt);
}

/**
 * Append-only publication index and exact-byte resolver for derived tasks.
 * It accepts only primary raw ENA or prepared-exchange import results; derived
 * results can never recursively pose as a scientific source.
 */
export class PostgresPublishedSourceResultRegistry
  implements ComputeHttpSourceResultResolver
{
  readonly #database: PostgresDatabase;
  readonly #objectStore: ComputeObjectStore;

  constructor(database: PostgresDatabase, objectStore: ComputeObjectStore) {
    this.#database = database;
    this.#objectStore = objectStore;
  }

  async record(record: PublishedScientificResultRecordV1): Promise<void> {
    if (
      !LOWER_SHA256.test(record.sourceResultHash) ||
      !LOWER_SHA256.test(record.owner.datasetHash) ||
      !LOWER_SHA256.test(record.owner.specHash) ||
      !OPAQUE_ID.test(record.owner.taskId) ||
      !OPAQUE_ID.test(record.buildId) ||
      !LOWER_SHA256.test(record.object.sha256) ||
      !Number.isSafeInteger(record.object.byteLength) || record.object.byteLength < 1 ||
      !Number.isSafeInteger(record.publishedAtMs) ||
      !Number.isSafeInteger(record.expiresAtMs) ||
      record.expiresAtMs <= record.publishedAtMs
    ) persistentError("BUILD_APPROVAL_INVALID");
    await this.#database.transaction(async (sql) => {
      const lock = await sql.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) AS locked`,
        [record.sourceResultHash],
      );
      if (lock.rowCount !== 1) persistentError("DATABASE_FAILURE");

      const existing = await sql.query<SourceResultRow>(
        `SELECT publication.publication_id, publication.generation,
          publication.result_hash, publication.dataset_hash,
          publication.spec_hash, publication.build_id, publication.task_id,
          publication.object_key, publication.object_sha256,
          publication.object_byte_length,
          extract(epoch FROM publication.published_at) * 1000 AS published_at_ms,
          extract(epoch FROM publication.expires_at) * 1000 AS expires_at_ms,
          publication.publication_receipt
         FROM compute_scientific_result_active AS mapping
         JOIN compute_scientific_result_publications AS publication
           ON publication.publication_id = mapping.publication_id
          AND publication.result_hash = mapping.result_hash
          AND publication.expires_at = mapping.expires_at
         WHERE mapping.result_hash = $1
           AND mapping.expires_at > clock_timestamp()
         FOR UPDATE OF mapping`,
        [record.sourceResultHash],
      );
      if (existing.rowCount > 1) persistentError("DATABASE_FAILURE");
      const row = existing.rows[0];
      if (row !== undefined) {
        if (publicationMatches(row, record)) return;
        persistentError("DATABASE_CONFLICT");
      }

      const retired = await sql.query(
        `DELETE FROM compute_scientific_result_active
         WHERE result_hash = $1 AND expires_at <= clock_timestamp()`,
        [record.sourceResultHash],
      );
      if (retired.rowCount > 1) persistentError("DATABASE_FAILURE");

      const inserted = await sql.query<SourceResultRow>(
        `INSERT INTO compute_scientific_result_publications (
          result_hash, generation, dataset_hash, spec_hash, build_id, task_id,
          object_key, object_sha256, object_byte_length,
          published_at, expires_at, publication_receipt
        )
        SELECT $1, COALESCE(MAX(history.generation), 0) + 1,
          $2, $3, $4, $5, $6, $7, $8,
          to_timestamp($9 / 1000.0), to_timestamp($10 / 1000.0), $11::jsonb
        FROM compute_scientific_result_publications AS history
        WHERE history.result_hash = $1
        RETURNING publication_id, generation`,
        [record.sourceResultHash, record.owner.datasetHash, record.owner.specHash,
          record.buildId, record.owner.taskId, record.object.key,
          record.object.sha256, record.object.byteLength, record.publishedAtMs,
          record.expiresAtMs, JSON.stringify(record.publicationReceipt)],
      );
      if (inserted.rowCount !== 1) persistentError("DATABASE_FAILURE");
      const publicationId = safeInteger(inserted.rows[0]?.publication_id);
      if (publicationId < 1 || safeInteger(inserted.rows[0]?.generation) < 1) {
        persistentError("DATABASE_FAILURE");
      }
      const activated = await sql.query(
        `INSERT INTO compute_scientific_result_active (
          result_hash, publication_id, expires_at
        ) VALUES ($1, $2, to_timestamp($3 / 1000.0))`,
        [record.sourceResultHash, publicationId, record.expiresAtMs],
      );
      if (activated.rowCount !== 1) persistentError("DATABASE_FAILURE");
    });
  }

  /**
   * Deletes only expired lookup metadata. Immutable publication generations,
   * including migration-backfilled 0001 evidence, are never mutated here.
   */
  async purgeExpiredActiveMappings(batchSize = 1_000): Promise<number> {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
      persistentError("CONFIGURATION_INVALID");
    }
    const deleted = await this.#database.query(
      `WITH expired AS (
         SELECT result_hash
         FROM compute_scientific_result_active
         WHERE expires_at <= clock_timestamp()
         ORDER BY expires_at, result_hash
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       DELETE FROM compute_scientific_result_active AS mapping
       USING expired
       WHERE mapping.result_hash = expired.result_hash`,
      [batchSize],
    );
    if (deleted.rowCount < 0 || deleted.rowCount > batchSize) {
      persistentError("DATABASE_FAILURE");
    }
    return deleted.rowCount;
  }

  async resolve(input: Readonly<{
    sourceResultHash: string;
    activatedDatasetSha256: string;
    requiredBuildId: string;
    nowMs: number;
  }>): Promise<ResolvedComputeHttpSourceResultV1 | null> {
    if (
      !LOWER_SHA256.test(input.sourceResultHash) ||
      !LOWER_SHA256.test(input.activatedDatasetSha256) ||
      !OPAQUE_ID.test(input.requiredBuildId) ||
      !Number.isSafeInteger(input.nowMs)
    ) return null;
    const result = await this.#database.query<SourceResultRow>(
      `SELECT publication.result_hash, publication.dataset_hash,
        publication.spec_hash, publication.build_id, publication.task_id,
        publication.object_key, publication.object_sha256,
        publication.object_byte_length,
        extract(epoch FROM publication.published_at) * 1000 AS published_at_ms,
        extract(epoch FROM publication.expires_at) * 1000 AS expires_at_ms
       FROM compute_scientific_result_active AS mapping
       JOIN compute_scientific_result_publications AS publication
         ON publication.publication_id = mapping.publication_id
        AND publication.result_hash = mapping.result_hash
        AND publication.expires_at = mapping.expires_at
       WHERE mapping.result_hash = $1
         AND publication.dataset_hash = $2
         AND publication.build_id = $3
         AND publication.published_at <= clock_timestamp()
         AND mapping.expires_at > clock_timestamp()
         AND mapping.expires_at > to_timestamp($4 / 1000.0)`,
      [input.sourceResultHash, input.activatedDatasetSha256,
        input.requiredBuildId, input.nowMs],
    );
    const row = result.rows[0];
    if (
      row === undefined ||
      row.result_hash !== input.sourceResultHash ||
      row.dataset_hash !== input.activatedDatasetSha256 ||
      row.build_id !== input.requiredBuildId ||
      typeof row.spec_hash !== "string" || !LOWER_SHA256.test(row.spec_hash) ||
      typeof row.task_id !== "string" || !OPAQUE_ID.test(row.task_id) ||
      typeof row.object_key !== "string" || row.object_key.length < 1 ||
      typeof row.object_sha256 !== "string" || !LOWER_SHA256.test(row.object_sha256)
    ) return null;
    const descriptor: ImmutableObjectDescriptor = {
      key: row.object_key,
      sha256: row.object_sha256,
      byteLength: safeInteger(row.object_byte_length),
    };
    const publishedAtMs = safeInteger(row.published_at_ms);
    const expiresAtMs = safeInteger(row.expires_at_ms);
    if (publishedAtMs > input.nowMs || expiresAtMs <= input.nowMs) return null;
    const [head, bytes] = await Promise.all([
      this.#objectStore.head(descriptor.key),
      this.#objectStore.get(descriptor.key),
    ]);
    if (
      head === null || bytes === null ||
      head.sha256 !== descriptor.sha256 || head.byteLength !== descriptor.byteLength ||
      bytes.byteLength !== descriptor.byteLength || sha256(bytes) !== descriptor.sha256
    ) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return null;
    }
    if (
      !isRecord(parsed) ||
      !hasExactKeys(parsed, ["version", "owner", "taskKind", "envelope"]) ||
      parsed.version !== "3dena.compute-scientific-result-artifact.v1" ||
      (parsed.taskKind !== "ena-model" && parsed.taskKind !== "prepared-import")
    ) return null;
    const envelope = parsed.envelope;
    try {
      assertAnalysisResultEnvelopeV1(envelope);
    } catch {
      return null;
    }
    const validated = envelope as AnalysisResultEnvelopeV1<AnalysisTaskResultV1>;
    const rawJena = validated.taskKind === "ena-model";
    if (
      (validated.taskKind !== "ena-model" && validated.taskKind !== "prepared-import") ||
      (rawJena
        ? validated.result.schemaVersion !== "3dena.analysis-result.v1" ||
          validated.provenance.sourceKind !== "raw-jena" ||
          validated.provenance.jenaExecuted !== true
        : validated.result.schemaVersion !== "3dena.prepared-space-result.v1" ||
          validated.provenance.sourceKind !== "prepared-exchange" ||
          validated.provenance.jenaExecuted !== false) ||
      validated.owner.datasetHash !== input.activatedDatasetSha256 ||
      validated.owner.specHash !== row.spec_hash ||
      validated.owner.taskId !== row.task_id ||
      validated.evidence.buildId !== input.requiredBuildId ||
      validated.provenance.buildId !== input.requiredBuildId ||
      validated.provenance.resultHash !== input.sourceResultHash ||
      await hashAnalysisValueV1(validated.result) !== input.sourceResultHash
    ) return null;
    const source = (rawJena
      ? {
          sourceKind: "raw-jena",
          hash: input.sourceResultHash,
          result: validated.result,
        }
      : {
          sourceKind: "prepared-exchange",
          hash: input.sourceResultHash,
          result: validated.result,
        }) as AnalysisExecutionSourceResultV2;
    return {
      source,
      owner: structuredClone(validated.owner),
      buildId: input.requiredBuildId,
      publishedAtMs,
      expiresAtMs,
    };
  }
}
