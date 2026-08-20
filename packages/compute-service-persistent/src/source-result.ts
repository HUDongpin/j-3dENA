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

/**
 * Append-only publication index and exact-byte resolver for derived tasks.
 * It accepts raw ENA results only; derived results can never recursively pose
 * as a model source. Prepared exchange sources require their separately
 * reviewed import registry and remain fail-closed here.
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
    const inserted = await this.#database.query(
      `INSERT INTO compute_scientific_results (
        result_hash, dataset_hash, spec_hash, build_id, task_id,
        object_key, object_sha256, object_byte_length,
        published_at, expires_at, publication_receipt
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9 / 1000.0),
        to_timestamp($10 / 1000.0),$11::jsonb)
      ON CONFLICT (result_hash) DO NOTHING`,
      [record.sourceResultHash, record.owner.datasetHash, record.owner.specHash,
        record.buildId, record.owner.taskId, record.object.key,
        record.object.sha256, record.object.byteLength, record.publishedAtMs,
        record.expiresAtMs, JSON.stringify(record.publicationReceipt)],
    );
    if (inserted.rowCount === 1) return;
    const existing = await this.#database.query<SourceResultRow>(
      `SELECT result_hash, dataset_hash, spec_hash, build_id, task_id,
        object_key, object_sha256, object_byte_length,
        extract(epoch FROM published_at) * 1000 AS published_at_ms,
        extract(epoch FROM expires_at) * 1000 AS expires_at_ms,
        publication_receipt
       FROM compute_scientific_results WHERE result_hash = $1`,
      [record.sourceResultHash],
    );
    const row = existing.rows[0];
    if (
      row?.result_hash !== record.sourceResultHash ||
      row.dataset_hash !== record.owner.datasetHash ||
      row.spec_hash !== record.owner.specHash ||
      row.build_id !== record.buildId ||
      row.task_id !== record.owner.taskId ||
      row.object_key !== record.object.key ||
      row.object_sha256 !== record.object.sha256 ||
      safeInteger(row.object_byte_length) !== record.object.byteLength ||
      safeInteger(row.published_at_ms) !== record.publishedAtMs ||
      safeInteger(row.expires_at_ms) !== record.expiresAtMs ||
      canonicalStringify(row.publication_receipt) !==
        canonicalStringify(record.publicationReceipt)
    ) persistentError("DATABASE_CONFLICT");
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
      `SELECT result_hash, dataset_hash, spec_hash, build_id, task_id,
        object_key, object_sha256, object_byte_length,
        extract(epoch FROM published_at) * 1000 AS published_at_ms,
        extract(epoch FROM expires_at) * 1000 AS expires_at_ms
       FROM compute_scientific_results
       WHERE result_hash = $1 AND dataset_hash = $2 AND build_id = $3
         AND expires_at > to_timestamp($4 / 1000.0)`,
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
      parsed.taskKind !== "ena-model"
    ) return null;
    const envelope = parsed.envelope;
    try {
      assertAnalysisResultEnvelopeV1(envelope);
    } catch {
      return null;
    }
    const validated = envelope as AnalysisResultEnvelopeV1<AnalysisTaskResultV1>;
    if (
      validated.taskKind !== "ena-model" ||
      validated.result.schemaVersion !== "3dena.analysis-result.v1" ||
      validated.owner.datasetHash !== input.activatedDatasetSha256 ||
      validated.owner.specHash !== row.spec_hash ||
      validated.owner.taskId !== row.task_id ||
      validated.evidence.buildId !== input.requiredBuildId ||
      validated.provenance.buildId !== input.requiredBuildId ||
      validated.provenance.resultHash !== input.sourceResultHash ||
      await hashAnalysisValueV1(validated.result) !== input.sourceResultHash
    ) return null;
    const source: AnalysisExecutionSourceResultV2 = {
      sourceKind: "raw-jena",
      hash: input.sourceResultHash,
      result: validated.result,
    };
    return {
      source,
      owner: structuredClone(validated.owner),
      buildId: input.requiredBuildId,
      publishedAtMs,
      expiresAtMs,
    };
  }
}
