import {
  COMPUTE_JOB_RECORD_VERSION,
  COMPUTE_LEASE_VERSION,
  type ComputeJobRecordV1,
  type ComputeJobState,
  type ComputeAuditEventV1,
  type ComputeAuditSink,
  type ComputeClock,
  type ComputeTaskRepository,
  type LeaseTokenV1,
  type RepositoryCompareAndSetResult,
  type RepositoryCreateResult,
} from "@3dena/compute-service-core";
import {
  COMPUTE_HTTP_JOB_VERSION,
  type AnalysisJobEventV1,
  type ComputeHttpEventBroker,
  type ComputeHttpJobRecordV1,
  type ComputeHttpJobRepository,
  type ComputeHttpProgressEventInput,
  type HttpRepositoryCompareAndSetResult,
  type HttpRepositoryCreateResult,
  type ComputeHttpDeletionLifecycleProbe,
} from "@3dena/compute-service-http";

import {
  EXTERNAL_TERMINATION_OBSERVATION_VERSION,
  PERSISTENT_LEASE_CLAIM_VERSION,
  RECOVERY_RECEIPT_VERSION_V2,
  TERMINATION_RECONCILIATION_RECEIPT_VERSION,
  type ExternalTerminationObservationV1,
  type PersistentLeaseClaimV1,
  type PersistentLeaseCoordinatorV1,
  type RecoveryDisposition,
  type RecoveryReceiptV2,
  type TerminationReconciliationReceiptV1,
} from "./contracts";
import { persistentError } from "./errors";
import {
  canonicalStringify,
  cloneFrozen,
  hasExactKeys,
  isRecord,
  OPAQUE_ID,
} from "./util";
import type {
  PersistentTemporalDueSourceV1,
  PersistentTemporalWorkItemV1,
} from "./temporal-sweeper";

export interface SqlQueryResult<Row extends Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number;
}

export interface SqlQueryExecutor {
  query<Row extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>>;
}

export interface PgCompatibleClient extends SqlQueryExecutor {
  release(): void;
}

export interface PgCompatiblePool extends SqlQueryExecutor {
  connect(): Promise<PgCompatibleClient>;
}

/**
 * Thin transaction wrapper compatible with `pg.Pool`. The application shell
 * owns TLS, credentials, direct-vs-pooled endpoint selection, and Pool setup.
 */
export class PostgresDatabase implements SqlQueryExecutor {
  readonly #pool: PgCompatiblePool;

  constructor(pool: PgCompatiblePool) {
    if (!isRecord(pool) || typeof pool.query !== "function" || typeof pool.connect !== "function") {
      persistentError("CONFIGURATION_INVALID");
    }
    this.#pool = pool;
  }

  query<Row extends Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    return this.#pool.query<Row>(text, values);
  }

  async transaction<T>(operation: (executor: SqlQueryExecutor) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        persistentError("DATABASE_FAILURE");
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

/**
 * Request/tick-scoped authoritative clock. Production composition must await
 * synchronize() immediately before every API request, worker tick, and TTL
 * sweep; now() never consults the Fly/Vercel host wall clock.
 */
export class PostgresAuthoritativeClock implements ComputeClock {
  readonly #database: PostgresDatabase;
  #serverNowMs: number | null = null;

  constructor(database: PostgresDatabase) {
    this.#database = database;
  }

  async synchronize(): Promise<number> {
    const result = await this.#database.query<TimeRow>(
      "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms",
    );
    this.#serverNowMs = safeInteger(result.rows[0]?.now_ms);
    return this.#serverNowMs;
  }

  now(): number {
    if (this.#serverNowMs === null) persistentError("DATABASE_FAILURE");
    return this.#serverNowMs;
  }
}

export class PostgresDeletionLifecycleProbe
  implements ComputeHttpDeletionLifecycleProbe
{
  constructor(private readonly database: SqlQueryExecutor) {}

  async capacityReleased(taskId: string): Promise<boolean> {
    if (!OPAQUE_ID.test(taskId)) persistentError("CONFIGURATION_INVALID");
    const result = await this.database.query<{
      capacity_released: unknown;
      [key: string]: unknown;
    }>(
      `SELECT NOT EXISTS (
         SELECT 1 FROM compute_capacity_slots WHERE task_id = $1
       ) AS capacity_released`,
      [taskId],
    );
    const value = result.rows[0]?.capacity_released;
    if (typeof value !== "boolean") persistentError("DATABASE_FAILURE");
    return value;
  }

  async terminationObserved(taskId: string): Promise<boolean> {
    if (!OPAQUE_ID.test(taskId)) persistentError("CONFIGURATION_INVALID");
    const result = await this.database.query<{
      termination_observed: unknown;
      [key: string]: unknown;
    }>(
      `SELECT EXISTS (
         SELECT 1 FROM compute_jobs AS j
         JOIN compute_termination_reconciliation_receipts AS receipt
           ON receipt.task_ref = j.task_ref
         WHERE j.task_id = $1
           AND receipt.receipt->>'terminationObserved' = 'true'
       ) AS termination_observed`,
      [taskId],
    );
    const value = result.rows[0]?.termination_observed;
    if (typeof value !== "boolean") persistentError("DATABASE_FAILURE");
    return value;
  }
}

/**
 * Selects a bounded temporal work page using PostgreSQL server time. A
 * database-backed singleton lease prevents multiple API runtimes from
 * repeatedly selecting the same page while the previous holder is healthy;
 * row locks isolate concurrent maintenance statements without requiring a
 * host-local clock or a full-table repository list.
 */
export class PostgresTemporalDueSource implements PersistentTemporalDueSourceV1 {
  readonly #database: PostgresDatabase;
  readonly #holderId: string;
  readonly #leaseDurationMs: number;
  readonly #batchSize: number;

  constructor(
    database: PostgresDatabase,
    input: Readonly<{
      holderId: string;
      leaseDurationMs?: number;
      batchSize?: number;
    }>,
  ) {
    if (!(database instanceof PostgresDatabase) || !OPAQUE_ID.test(input.holderId)) {
      persistentError("CONFIGURATION_INVALID");
    }
    this.#leaseDurationMs = input.leaseDurationMs ?? 5_000;
    this.#batchSize = input.batchSize ?? 100;
    if (!Number.isSafeInteger(this.#leaseDurationMs) || this.#leaseDurationMs < 1_000 ||
        this.#leaseDurationMs > 60_000 || !Number.isSafeInteger(this.#batchSize) ||
        this.#batchSize < 1 || this.#batchSize > 500) {
      persistentError("CONFIGURATION_INVALID");
    }
    this.#database = database;
    this.#holderId = input.holderId;
  }

  async claimDue(): Promise<readonly PersistentTemporalWorkItemV1[]> {
    return this.#database.transaction(async (sql) => {
      const lease = await sql.query<{ lease_epoch: unknown; [key: string]: unknown }>(
        `INSERT INTO compute_scheduler_leases
           (lease_name, holder_id, lease_epoch, expires_at, updated_at)
         VALUES ('temporal-control-v1', $1, 1,
           clock_timestamp() + ($2::bigint * interval '1 millisecond'),
           clock_timestamp())
         ON CONFLICT (lease_name) DO UPDATE SET
           holder_id = EXCLUDED.holder_id,
           lease_epoch = compute_scheduler_leases.lease_epoch + 1,
           expires_at = EXCLUDED.expires_at,
           updated_at = clock_timestamp()
         WHERE compute_scheduler_leases.holder_id = EXCLUDED.holder_id
            OR compute_scheduler_leases.expires_at <= clock_timestamp()
         RETURNING lease_epoch`,
        [this.#holderId, this.#leaseDurationMs],
      );
      if (lease.rowCount === 0) return Object.freeze([]);
      if (lease.rowCount !== 1) persistentError("DATABASE_FAILURE");
      const leaseEpoch = safeInteger(lease.rows[0]?.lease_epoch);

      // Keep both control planes live under a permanently backlogged peer.
      // A one-item page alternates by durable lease epoch; larger pages reserve
      // a fixed slice for HTTP privacy cleanup instead of using only leftover
      // capacity after core jobs.
      const taskLimit = this.#batchSize === 1
        ? (leaseEpoch % 2 === 0 ? 1 : 0)
        : Math.ceil(this.#batchSize / 2);
      const httpLimit = this.#batchSize - taskLimit;

      const tasks = taskLimit === 0
        ? { rows: [], rowCount: 0 }
        : await sql.query<{ task_id: unknown; [key: string]: unknown }>(
        `SELECT j.task_id FROM compute_jobs AS j
         WHERE (
           (j.state IN ('queued','leased','starting','running','cancelling')
             AND j.deadline_at <= clock_timestamp())
           OR (j.state <> 'deleted' AND j.expires_at <= clock_timestamp())
           OR (j.state = 'deleting' AND NOT EXISTS (
             SELECT 1 FROM compute_capacity_slots AS s WHERE s.task_id = j.task_id
           ))
         )
         ORDER BY LEAST(j.deadline_at, j.expires_at), j.task_id
         FOR UPDATE OF j SKIP LOCKED
         LIMIT $1`,
        [taskLimit],
      );
      const work: PersistentTemporalWorkItemV1[] = tasks.rows.map((row) => {
        if (typeof row.task_id !== "string" || !OPAQUE_ID.test(row.task_id)) {
          persistentError("DATABASE_FAILURE");
        }
        return Object.freeze({ kind: "task" as const, id: row.task_id });
      });
      if (httpLimit > 0) {
        const deletions = await sql.query<{
          job_id: unknown;
          work_kind: unknown;
          [key: string]: unknown;
        }>(
          `SELECT h.job_id,
             CASE
               WHEN h.expires_at <= clock_timestamp()
                 AND h.record ? 'deletionCompletedAtMs' THEN 'http-purge'
               WHEN h.record ? 'deleteRequestedAtMs'
                 OR h.expires_at <= clock_timestamp()
                 OR NOT EXISTS (
                   SELECT 1 FROM compute_jobs AS core
                   WHERE core.task_id = h.record->>'coreTaskId'
                 ) THEN 'http-deletion'
               ELSE 'http-reconcile'
             END AS work_kind
           FROM compute_http_jobs AS h
           WHERE (
               h.expires_at <= clock_timestamp()
               AND h.record ? 'deletionCompletedAtMs'
             ) OR (
               NOT (h.record ? 'deletionCompletedAtMs')
               AND (
                 h.expires_at <= clock_timestamp()
                 OR h.record ? 'deleteRequestedAtMs'
                 OR (
                   NOT (h.record ? 'inputDeletedAtMs')
                   AND
                   h.record->>'taskKind' = 'longitudinal-analysis-v2'
                   AND h.record ? 'coreTaskId'
                   AND (
                     (
                       jsonb_typeof(h.record->'createdAtMs') = 'number'
                       AND (h.record->>'createdAtMs')::bigint + 60000 <=
                         floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
                       AND NOT EXISTS (
                         SELECT 1 FROM compute_jobs AS core
                         WHERE core.task_id = h.record->>'coreTaskId'
                       )
                     )
                     OR EXISTS (
                       SELECT 1 FROM compute_jobs AS core
                       WHERE core.task_id = h.record->>'coreTaskId'
                         AND core.state IN (
                           'succeeded','failed','cancelled','timed_out','expired','deleted'
                         )
                       )
                     )
                   )
                 )
               )
             )
           ORDER BY h.updated_at, h.job_id
           FOR UPDATE OF h SKIP LOCKED
           LIMIT $1`,
          [httpLimit],
        );
        for (const row of deletions.rows) {
          if (typeof row.job_id !== "string" || !OPAQUE_ID.test(row.job_id) ||
              (row.work_kind !== "http-deletion" &&
                row.work_kind !== "http-reconcile" &&
                row.work_kind !== "http-purge")) {
            persistentError("DATABASE_FAILURE");
          }
          work.push(Object.freeze({ kind: row.work_kind, id: row.job_id }));
        }
      }
      return Object.freeze(work);
    });
  }
}

interface RecordRow {
  readonly record: unknown;
  [key: string]: unknown;
}

interface TimeRow {
  readonly now_ms: string | number;
  [key: string]: unknown;
}

interface SlotRow {
  readonly slot_number: number;
  readonly fencing_epoch: string | number;
  readonly task_id?: string | null;
  readonly lease_epoch?: string | number | null;
  readonly record?: unknown;
  readonly quarantined_at?: unknown;
  [key: string]: unknown;
}

function safeInteger(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 0) {
    persistentError("DATABASE_FAILURE");
  }
  return Number(parsed);
}

function assertCoreRecord(value: unknown): asserts value is ComputeJobRecordV1 {
  if (
    !isRecord(value) ||
    value.version !== COMPUTE_JOB_RECORD_VERSION ||
    !isRecord(value.owner) ||
    typeof value.owner.taskId !== "string" ||
    !OPAQUE_ID.test(value.owner.taskId) ||
    typeof value.taskRef !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.taskRef) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !Number.isSafeInteger(value.leaseEpoch) ||
    Number(value.leaseEpoch) < 0 ||
    typeof value.state !== "string"
  ) {
    persistentError("DATABASE_FAILURE");
  }
}

function assertHttpRecord(value: unknown): asserts value is ComputeHttpJobRecordV1 {
  if (
    !isRecord(value) ||
    value.version !== COMPUTE_HTTP_JOB_VERSION ||
    typeof value.jobId !== "string" ||
    !OPAQUE_ID.test(value.jobId) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    typeof value.createIdempotencyHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.createIdempotencyHash) ||
    (value.inputDeletedAtMs !== undefined &&
      (!Number.isSafeInteger(value.inputDeletedAtMs) || Number(value.inputDeletedAtMs) < 0)) ||
    (value.deletionCompletedAtMs !== undefined &&
      (!Number.isSafeInteger(value.deletionCompletedAtMs) ||
        Number(value.deletionCompletedAtMs) < 0 ||
        !Number.isSafeInteger(value.inputDeletedAtMs) ||
        !Number.isSafeInteger(value.deleteRequestedAtMs) ||
        Number(value.deletionCompletedAtMs) < Number(value.inputDeletedAtMs) ||
        Number(value.deletionCompletedAtMs) < Number(value.deleteRequestedAtMs)))
  ) {
    persistentError("DATABASE_FAILURE");
  }
}

const HTTP_EVENT_STATES = new Set<AnalysisJobEventV1["state"]>([
  "CREATED",
  "UPLOADED",
  "QUEUED",
  "RUNNING",
  "CANCEL_REQUESTED",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
]);

function storedHttpEvent(value: unknown): AnalysisJobEventV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "sequence",
      "state",
      "phase",
      "completed",
      "total",
      "emittedAt",
    ]) ||
    value.schemaVersion !== "3dena.job-event.v1" ||
    typeof value.state !== "string" ||
    !HTTP_EVENT_STATES.has(value.state as AnalysisJobEventV1["state"]) ||
    typeof value.phase !== "string" ||
    !Number.isSafeInteger(value.completed) ||
    Number(value.completed) < 0 ||
    (value.total !== null &&
      (!Number.isSafeInteger(value.total) ||
        Number(value.total) < Number(value.completed))) ||
    typeof value.emittedAt !== "string" ||
    Number.isNaN(Date.parse(value.emittedAt))
  ) {
    persistentError("DATABASE_FAILURE");
  }
  const sequence = safeInteger(value.sequence);
  if (sequence < 1) persistentError("DATABASE_FAILURE");
  return Object.freeze({
    schemaVersion: "3dena.job-event.v1",
    sequence,
    state: value.state as AnalysisJobEventV1["state"],
    phase: value.phase,
    completed: Number(value.completed),
    total: value.total === null ? null : Number(value.total),
    emittedAt: value.emittedAt,
  });
}

function sameHttpEventSnapshot(
  previous: AnalysisJobEventV1,
  input: ComputeHttpProgressEventInput,
): boolean {
  return previous.state === input.state &&
    previous.phase === input.phase &&
    previous.completed === input.completed &&
    previous.total === input.total;
}

function firstRecord<Row extends RecordRow>(result: SqlQueryResult<Row>): unknown | null {
  return result.rows[0]?.record ?? null;
}

function dateFromMs(milliseconds: number): string {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    persistentError("DATABASE_CONFLICT");
  }
  return new Date(milliseconds).toISOString();
}

async function persistExactTerminationReceipt(
  sql: SqlQueryExecutor,
  receipt: TerminationReconciliationReceiptV1,
  providerReceiptId: string | null,
  observation: ExternalTerminationObservationV1 | null,
): Promise<void> {
  const inserted = await sql.query(
    `INSERT INTO compute_termination_reconciliation_receipts
       (task_ref, lease_epoch, fencing_epoch, reconciled_at, source,
         provider_receipt_id, observation, receipt)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)
     ON CONFLICT DO NOTHING`,
    [receipt.taskRef, receipt.leaseEpoch, receipt.fencingEpoch,
      dateFromMs(receipt.reconciledAtMs), receipt.source,
      providerReceiptId, observation === null ? null : JSON.stringify(observation),
      JSON.stringify(receipt)],
  );
  if (inserted.rowCount === 1) return;
  if (inserted.rowCount !== 0) persistentError("RECOVERY_CONFLICT");
  const existing = await sql.query<{
    source: unknown;
    provider_receipt_id: unknown;
    observation: unknown;
    receipt: unknown;
    [key: string]: unknown;
  }>(
    `SELECT source, provider_receipt_id, observation, receipt
     FROM compute_termination_reconciliation_receipts
     WHERE task_ref = $1 AND lease_epoch = $2 AND fencing_epoch = $3
     FOR UPDATE`,
    [receipt.taskRef, receipt.leaseEpoch, receipt.fencingEpoch],
  );
  const observed = existing.rows[0];
  if (existing.rowCount !== 1 || observed === undefined ||
      observed.source !== receipt.source ||
      observed.provider_receipt_id !== providerReceiptId ||
      canonicalStringify(observed.observation) !== canonicalStringify(observation) ||
      canonicalStringify(observed.receipt) !== canonicalStringify(receipt)) {
    persistentError("RECOVERY_CONFLICT");
  }
}

export class PostgresComputeTaskRepository implements ComputeTaskRepository {
  readonly #database: SqlQueryExecutor;

  constructor(database: SqlQueryExecutor) {
    this.#database = database;
  }

  async get(taskId: string): Promise<ComputeJobRecordV1 | null> {
    const result = await this.#database.query<RecordRow>(
      "SELECT record FROM compute_jobs WHERE task_id = $1",
      [taskId],
    );
    const value = firstRecord(result);
    if (value === null) return null;
    assertCoreRecord(value);
    return cloneFrozen(value);
  }

  async list(): Promise<readonly ComputeJobRecordV1[]> {
    const result = await this.#database.query<RecordRow>(
      "SELECT record FROM compute_jobs ORDER BY task_id",
    );
    return result.rows.map(({ record }) => {
      assertCoreRecord(record);
      return cloneFrozen(record);
    });
  }

  async createIfAbsent(record: ComputeJobRecordV1): Promise<RepositoryCreateResult> {
    assertCoreRecord(record);
    if (record.revision !== 0) persistentError("DATABASE_CONFLICT");
    const result = await this.#database.query<RecordRow>(
      `INSERT INTO compute_jobs (
         task_id, task_ref, request_fingerprint, state, revision, lease_epoch,
         created_at, updated_at, deadline_at, expires_at, record
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
       ON CONFLICT (task_id) DO NOTHING
       RETURNING record`,
      [
        record.owner.taskId,
        record.taskRef,
        record.requestFingerprint,
        record.state,
        record.revision,
        record.leaseEpoch,
        dateFromMs(record.createdAtMs),
        dateFromMs(record.updatedAtMs),
        dateFromMs(record.request.deadlineAtMs),
        dateFromMs(record.request.expiresAtMs),
        JSON.stringify(record),
      ],
    );
    const inserted = firstRecord(result);
    if (inserted !== null) {
      assertCoreRecord(inserted);
      return Object.freeze({ created: true, record: cloneFrozen(inserted) });
    }
    const existing = await this.get(record.owner.taskId);
    if (existing === null) persistentError("DATABASE_FAILURE");
    return Object.freeze({ created: false, record: existing });
  }

  async compareAndSet(
    taskId: string,
    expectedRevision: number,
    next: ComputeJobRecordV1,
  ): Promise<RepositoryCompareAndSetResult> {
    assertCoreRecord(next);
    if (next.owner.taskId !== taskId || next.revision !== expectedRevision + 1) {
      persistentError("DATABASE_CONFLICT");
    }
    const result = await this.#database.query<RecordRow>(
      `UPDATE compute_jobs
       SET state = $3, revision = $4, lease_epoch = $5,
           updated_at = $6, deadline_at = $7, expires_at = $8, record = $9::jsonb
       WHERE task_id = $1 AND revision = $2
         AND task_ref = $10 AND request_fingerprint = $11
         AND (
           claim_fencing_epoch IS NULL OR EXISTS (
             SELECT 1 FROM compute_capacity_slots fenced
             WHERE fenced.slot_number = compute_jobs.claim_slot_number
               AND fenced.task_id = compute_jobs.task_id
               AND fenced.fencing_epoch = compute_jobs.claim_fencing_epoch
               AND fenced.lease_epoch = compute_jobs.lease_epoch
           )
         )
       RETURNING record`,
      [
        taskId,
        expectedRevision,
        next.state,
        next.revision,
        next.leaseEpoch,
        dateFromMs(next.updatedAtMs),
        dateFromMs(next.request.deadlineAtMs),
        dateFromMs(next.request.expiresAtMs),
        JSON.stringify(next),
        next.taskRef,
        next.requestFingerprint,
      ],
    );
    const updated = firstRecord(result);
    if (updated !== null) {
      assertCoreRecord(updated);
      return Object.freeze({ applied: true, record: cloneFrozen(updated) });
    }
    const current = await this.get(taskId);
    if (current === null) persistentError("DATABASE_FAILURE");
    return Object.freeze({ applied: false, record: current });
  }
}

/** Append-only aggregate lifecycle audit; the event contract contains no raw rows or labels. */
export class PostgresComputeAuditSink implements ComputeAuditSink {
  readonly #database: SqlQueryExecutor;

  constructor(database: SqlQueryExecutor) {
    this.#database = database;
  }

  async emit(event: ComputeAuditEventV1): Promise<void> {
    const result = await this.#database.query(
      `INSERT INTO compute_audit_events (
         task_ref, kind, state, occurred_at, event
       ) VALUES ($1,$2,$3,to_timestamp($4 / 1000.0),$5::jsonb)`,
      [event.taskRef, event.kind, event.state, event.atMs, JSON.stringify(event)],
    );
    if (result.rowCount !== 1) persistentError("DATABASE_FAILURE");
  }
}

export class PostgresComputeHttpJobRepository
  implements ComputeHttpJobRepository
{
  readonly #database: PostgresDatabase;

  constructor(database: PostgresDatabase) {
    this.#database = database;
  }

  async get(jobId: string): Promise<ComputeHttpJobRecordV1 | null> {
    const result = await this.#database.query<RecordRow>(
      "SELECT record FROM compute_http_jobs WHERE job_id = $1",
      [jobId],
    );
    const value = firstRecord(result);
    if (value === null) return null;
    assertHttpRecord(value);
    return cloneFrozen(value);
  }

  async findByCreateIdempotencyHash(hash: string): Promise<ComputeHttpJobRecordV1 | null> {
    const result = await this.#database.query<RecordRow>(
      "SELECT record FROM compute_http_jobs WHERE create_idempotency_hash = $1",
      [hash],
    );
    const value = firstRecord(result);
    if (value === null) return null;
    assertHttpRecord(value);
    return cloneFrozen(value);
  }

  async createIfAbsent(record: ComputeHttpJobRecordV1): Promise<HttpRepositoryCreateResult> {
    assertHttpRecord(record);
    if (record.revision !== 0) persistentError("DATABASE_CONFLICT");
    const inserted = await this.#database.query<RecordRow>(
      `INSERT INTO compute_http_jobs (
         job_id, create_idempotency_hash, create_request_fingerprint,
         capability_hash, revision, created_at, updated_at, expires_at, record
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       ON CONFLICT DO NOTHING RETURNING record`,
      [record.jobId, record.createIdempotencyHash, record.createRequestFingerprint,
        record.capabilityHash, record.revision, dateFromMs(record.createdAtMs),
        dateFromMs(record.updatedAtMs), dateFromMs(record.expiresAtMs), JSON.stringify(record)],
    );
    const value = firstRecord(inserted);
    if (value !== null) {
      assertHttpRecord(value);
      return Object.freeze({ created: true, record: cloneFrozen(value) });
    }
    const existing =
      (await this.get(record.jobId)) ??
      (await this.findByCreateIdempotencyHash(record.createIdempotencyHash));
    if (existing === null) persistentError("DATABASE_FAILURE");
    return Object.freeze({ created: false, record: existing });
  }

  async compareAndSet(
    jobId: string,
    expectedRevision: number,
    next: ComputeHttpJobRecordV1,
  ): Promise<HttpRepositoryCompareAndSetResult> {
    assertHttpRecord(next);
    if (next.jobId !== jobId || next.revision !== expectedRevision + 1) {
      persistentError("DATABASE_CONFLICT");
    }
    const result = await this.#database.query<RecordRow>(
      `UPDATE compute_http_jobs
       SET revision = $3, updated_at = $4, expires_at = $5, record = $6::jsonb
       WHERE job_id = $1 AND revision = $2 AND capability_hash = $7
         AND create_request_fingerprint = $8
       RETURNING record`,
      [jobId, expectedRevision, next.revision, dateFromMs(next.updatedAtMs),
        dateFromMs(next.expiresAtMs), JSON.stringify(next), next.capabilityHash,
        next.createRequestFingerprint],
    );
    const value = firstRecord(result);
    if (value !== null) {
      assertHttpRecord(value);
      return Object.freeze({ applied: true, record: cloneFrozen(value) });
    }
    const current = await this.get(jobId);
    if (current === null) persistentError("DATABASE_FAILURE");
    return Object.freeze({ applied: false, record: current });
  }

  /**
   * Removes only an expired HTTP tombstone whose owned input/result deletion
   * has already been durably recorded. Replay events and their sequence cursor
   * remain available until this exact retention boundary, then disappear in
   * the same transaction as the owning job row.
   */
  async purgeExpired(jobId: string): Promise<boolean> {
    if (!OPAQUE_ID.test(jobId)) persistentError("CONFIGURATION_INVALID");
    return this.#database.transaction(async (sql) => {
      const eligible = await sql.query<{ job_id: unknown; [key: string]: unknown }>(
        `SELECT job_id FROM compute_http_jobs AS h
         WHERE h.job_id = $1
           AND h.expires_at <= clock_timestamp()
           AND h.record ? 'deletionCompletedAtMs'
           AND jsonb_typeof(h.record->'deletionCompletedAtMs') = 'number'
           AND (
             NOT (h.record ? 'coreTaskId')
             OR EXISTS (
               SELECT 1 FROM compute_jobs AS core
               WHERE core.task_id = h.record->>'coreTaskId'
                 AND core.state = 'deleted'
                 AND core.record->'deletionReceipt'->>'requestObjectAbsent' = 'true'
                 AND core.record->'deletionReceipt'->>'ownedResultObjectsAbsent' = 'true'
                 AND jsonb_typeof(core.record->'ownedResultObjectKeys') = 'array'
                 AND (core.record->'deletionReceipt'->>'ownedResultObjectCount')
                   ~ '^(0|[1-9][0-9]{0,9})$'
                 AND (core.record->'deletionReceipt'->>'ownedResultObjectCount')::bigint
                   = jsonb_array_length(core.record->'ownedResultObjectKeys')
             )
           )
         FOR UPDATE OF h`,
        [jobId],
      );
      if (eligible.rowCount === 0) return false;
      if (eligible.rowCount !== 1 || eligible.rows[0]?.job_id !== jobId) {
        persistentError("DATABASE_FAILURE");
      }
      await sql.query("DELETE FROM compute_events WHERE job_id = $1", [jobId]);
      const cursor = await sql.query(
        "DELETE FROM compute_event_cursors WHERE job_id = $1",
        [jobId],
      );
      if (cursor.rowCount < 0 || cursor.rowCount > 1) {
        persistentError("DATABASE_FAILURE");
      }
      const job = await sql.query(
        "DELETE FROM compute_http_jobs WHERE job_id = $1",
        [jobId],
      );
      if (job.rowCount !== 1) persistentError("DATABASE_FAILURE");
      return true;
    });
  }
}

export interface PostgresEventBrokerOptions {
  readonly pollIntervalMs?: number;
  readonly batchSize?: number;
}

export class PostgresComputeHttpEventBroker implements ComputeHttpEventBroker {
  readonly #database: PostgresDatabase;
  readonly #pollIntervalMs: number;
  readonly #batchSize: number;

  constructor(database: PostgresDatabase, options: PostgresEventBrokerOptions = {}) {
    this.#database = database;
    this.#pollIntervalMs = options.pollIntervalMs ?? 250;
    this.#batchSize = options.batchSize ?? 100;
    if (
      !Number.isSafeInteger(this.#pollIntervalMs) || this.#pollIntervalMs < 10 ||
      !Number.isSafeInteger(this.#batchSize) || this.#batchSize < 1 || this.#batchSize > 1000
    ) persistentError("CONFIGURATION_INVALID");
  }

  async publish(
    jobId: string,
    input: ComputeHttpProgressEventInput,
  ): Promise<AnalysisJobEventV1> {
    return this.#database.transaction(async (sql) => {
      const owner = await sql.query<{ job_id: unknown; [key: string]: unknown }>(
        `SELECT job_id FROM compute_http_jobs
         WHERE job_id = $1 FOR KEY SHARE`,
        [jobId],
      );
      if (owner.rowCount !== 1 || owner.rows[0]?.job_id !== jobId) {
        persistentError("DATABASE_FAILURE");
      }
      const insertedCursor = await sql.query(
        `INSERT INTO compute_event_cursors (job_id, next_sequence)
         VALUES ($1, 1) ON CONFLICT (job_id) DO NOTHING`,
        [jobId],
      );
      if (insertedCursor.rowCount < 0 || insertedCursor.rowCount > 1) {
        persistentError("DATABASE_FAILURE");
      }
      const cursorState = await sql.query<{
        next_sequence: string | number;
        [key: string]: unknown;
      }>(
        `SELECT next_sequence FROM compute_event_cursors
         WHERE job_id = $1 FOR UPDATE`,
        [jobId],
      );
      if (cursorState.rowCount !== 1) persistentError("DATABASE_FAILURE");
      const nextSequence = safeInteger(cursorState.rows[0]?.next_sequence);
      if (nextSequence < 1) persistentError("DATABASE_FAILURE");
      const latest = await sql.query<{ event: unknown; [key: string]: unknown }>(
        `SELECT event FROM compute_events
         WHERE job_id = $1 ORDER BY sequence DESC LIMIT 1`,
        [jobId],
      );
      if (latest.rowCount < 0 || latest.rowCount > 1) {
        persistentError("DATABASE_FAILURE");
      }
      const previous = latest.rowCount === 0
        ? null
        : storedHttpEvent(latest.rows[0]?.event);
      if (
        (previous === null && nextSequence !== 1) ||
        (previous !== null && previous.sequence !== nextSequence - 1)
      ) {
        persistentError("DATABASE_FAILURE");
      }
      if (previous !== null && sameHttpEventSnapshot(previous, input)) {
        return previous;
      }
      const serverTime = await sql.query<{
        emitted_at: unknown;
        [key: string]: unknown;
      }>("SELECT clock_timestamp() AS emitted_at");
      const emittedAtValue = serverTime.rows[0]?.emitted_at;
      const emittedAt = emittedAtValue instanceof Date
        ? emittedAtValue.toISOString()
        : typeof emittedAtValue === "string" && !Number.isNaN(Date.parse(emittedAtValue))
          ? new Date(emittedAtValue).toISOString()
          : persistentError("DATABASE_FAILURE");
      const cursor = await sql.query<{ sequence: string | number; [key: string]: unknown }>(
        `UPDATE compute_event_cursors SET next_sequence = next_sequence + 1
         WHERE job_id = $1 AND next_sequence = $2
         RETURNING next_sequence - 1 AS sequence`,
        [jobId, nextSequence],
      );
      const sequence = safeInteger(cursor.rows[0]?.sequence);
      if (cursor.rowCount !== 1 || sequence !== nextSequence) {
        persistentError("DATABASE_FAILURE");
      }
      const event: AnalysisJobEventV1 = Object.freeze({
        schemaVersion: "3dena.job-event.v1",
        sequence,
        ...input,
        emittedAt,
      });
      const inserted = await sql.query(
        `INSERT INTO compute_events (job_id, sequence, emitted_at, event)
         VALUES ($1,$2,$3,$4::jsonb)`,
        [jobId, sequence, emittedAt, JSON.stringify(event)],
      );
      if (inserted.rowCount !== 1) persistentError("DATABASE_FAILURE");
      return event;
    });
  }

  async *subscribe(
    jobId: string,
    afterSequence: number,
    signal?: AbortSignal,
  ): AsyncIterable<AnalysisJobEventV1> {
    let cursor = afterSequence;
    while (signal?.aborted !== true) {
      const result = await this.#database.query<{ event: unknown; [key: string]: unknown }>(
        `SELECT event FROM compute_events
         WHERE job_id = $1 AND sequence > $2 ORDER BY sequence LIMIT $3`,
        [jobId, cursor, this.#batchSize],
      );
      if (result.rows.length > 0) {
        for (const row of result.rows) {
          const event = storedHttpEvent(row.event);
          if (event.sequence <= cursor) persistentError("DATABASE_FAILURE");
          cursor = event.sequence;
          yield event;
        }
        continue;
      }
      // The owning HTTP tombstone and replay rows are purged atomically at
      // their retention boundary. A subscriber may already be waiting when
      // that transaction commits, so an empty event page must distinguish
      // "nothing new yet" from "this stream no longer has an owner". Without
      // this check the iterator would poll forever and the HTTP layer would
      // keep emitting heartbeats that incorrectly mask the terminal purge.
      const owner = await this.#database.query<{
        job_id: unknown;
        [key: string]: unknown;
      }>(
        "SELECT job_id FROM compute_http_jobs WHERE job_id = $1",
        [jobId],
      );
      if (owner.rowCount === 0) return;
      if (owner.rowCount !== 1 || owner.rows[0]?.job_id !== jobId) {
        persistentError("DATABASE_FAILURE");
      }
      await new Promise<void>((resolve) => {
        if (signal?.aborted === true) return resolve();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const settle = (): void => {
          if (timer !== undefined) clearTimeout(timer);
          signal?.removeEventListener("abort", settle);
          resolve();
        };
        timer = setTimeout(settle, this.#pollIntervalMs);
        signal?.addEventListener("abort", settle, { once: true });
      });
    }
  }
}

export interface PostgresLeaseCoordinatorOptions {
  readonly maxLeaseDurationMs: number;
  readonly recoveryBatchSize?: number;
}

function withoutKeys<T extends Record<string, unknown>>(
  value: T,
  keys: readonly string[],
): Record<string, unknown> {
  const copy = { ...value };
  for (const key of keys) delete copy[key];
  return copy;
}

function recoveryState(record: ComputeJobRecordV1, nowMs: number): {
  readonly state: ComputeJobState;
  readonly disposition: RecoveryDisposition;
} {
  if (nowMs >= record.request.expiresAtMs) return { state: "expired", disposition: "expired" };
  if (nowMs >= record.request.deadlineAtMs) return { state: "timed_out", disposition: "timed_out" };
  if (record.state === "cancelling") {
    const desired = record.pendingStopOutcome ?? "cancelled";
    if (desired === "deleted") return { state: "cancelled", disposition: "cancelled" };
    return {
      state: desired === "failed" ? "failed" : desired,
      disposition: desired === "expired" ? "expired" : desired === "timed_out" ? "timed_out" : "cancelled",
    };
  }
  if (record.result !== undefined) return { state: "succeeded", disposition: "ack_replayed" };
  return { state: "queued", disposition: "requeued" };
}

export class PostgresDistributedLeaseCoordinator
  implements PersistentLeaseCoordinatorV1
{
  readonly #database: PostgresDatabase;
  readonly #maxLeaseDurationMs: number;
  readonly #recoveryBatchSize: number;

  constructor(database: PostgresDatabase, options: PostgresLeaseCoordinatorOptions) {
    this.#database = database;
    this.#maxLeaseDurationMs = options.maxLeaseDurationMs;
    this.#recoveryBatchSize = options.recoveryBatchSize ?? 32;
    if (!Number.isSafeInteger(this.#maxLeaseDurationMs) || this.#maxLeaseDurationMs < 1 ||
        !Number.isSafeInteger(this.#recoveryBatchSize) || this.#recoveryBatchSize < 1 || this.#recoveryBatchSize > 1000) {
      persistentError("CONFIGURATION_INVALID");
    }
  }

  async configureCapacity(limit: number): Promise<void> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      persistentError("CONFIGURATION_INVALID");
    }
    await this.#database.transaction(async (sql) => {
      await sql.query(
        `INSERT INTO compute_capacity_slots (slot_number, enabled)
         SELECT value, true FROM generate_series(1, $1::integer) AS value
         ON CONFLICT (slot_number) DO UPDATE SET enabled =
           (compute_capacity_slots.quarantined_at IS NULL)`,
        [limit],
      );
      const disabled = await sql.query(
        `UPDATE compute_capacity_slots SET enabled = false
         WHERE slot_number > $1 AND holder_id IS NULL`,
        [limit],
      );
      const occupiedBeyondLimit = await sql.query(
        `SELECT slot_number FROM compute_capacity_slots
         WHERE slot_number > $1 AND holder_id IS NOT NULL LIMIT 1`,
        [limit],
      );
      if (occupiedBeyondLimit.rowCount > 0) persistentError("DATABASE_CONFLICT");
      return disabled;
    });
  }

  async claimNext(input: Readonly<{
    holderId: string;
    leaseId: string;
    durationMs: number;
  }>): Promise<PersistentLeaseClaimV1 | null> {
    if (!OPAQUE_ID.test(input.holderId) || !OPAQUE_ID.test(input.leaseId) ||
        !Number.isSafeInteger(input.durationMs) || input.durationMs < 1 || input.durationMs > this.#maxLeaseDurationMs) {
      persistentError("CONFIGURATION_INVALID");
    }
    return this.#database.transaction(async (sql) => {
      const time = await sql.query<TimeRow>(
        "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms",
      );
      const nowMs = safeInteger(time.rows[0]?.now_ms);
      const slotResult = await sql.query<SlotRow>(
        `SELECT slot_number, fencing_epoch FROM compute_capacity_slots
         WHERE enabled = true AND holder_id IS NULL
         ORDER BY slot_number FOR UPDATE SKIP LOCKED LIMIT 1`,
      );
      const slot = slotResult.rows[0];
      if (slot === undefined) return null;
      const jobResult = await sql.query<SlotRow>(
        `SELECT task_id, record FROM compute_jobs
         WHERE state = 'queued' AND deadline_at > clock_timestamp()
           AND expires_at > clock_timestamp()
         ORDER BY created_at, task_id FOR UPDATE SKIP LOCKED LIMIT 1`,
      );
      const job = jobResult.rows[0];
      if (job?.task_id === undefined || job.record === undefined) return null;
      if (job.task_id === null) persistentError("DATABASE_FAILURE");
      const taskId = job.task_id;
      assertCoreRecord(job.record);
      const duration = Math.min(
        input.durationMs,
        job.record.request.deadlineAtMs - nowMs,
        job.record.request.expiresAtMs - nowMs,
      );
      if (duration < 1) return null;
      const lease: LeaseTokenV1 = Object.freeze({
        version: COMPUTE_LEASE_VERSION,
        leaseId: input.leaseId,
        holderId: input.holderId,
        epoch: job.record.leaseEpoch + 1,
        issuedAtMs: nowMs,
        expiresAtMs: nowMs + duration,
      });
      const next = cloneFrozen({
        ...job.record,
        state: "leased" as const,
        revision: job.record.revision + 1,
        leaseEpoch: lease.epoch,
        lease,
        updatedAtMs: nowMs,
      });
      const fencingEpoch = safeInteger(slot.fencing_epoch) + 1;
      const jobUpdate = await sql.query(
        `UPDATE compute_jobs SET state = 'leased', revision = $2, lease_epoch = $3,
           updated_at = $4, record = $5::jsonb, claim_slot_number = $6,
           claim_fencing_epoch = $7 WHERE task_id = $1`,
        [taskId, next.revision, next.leaseEpoch, dateFromMs(nowMs),
          JSON.stringify(next), slot.slot_number, fencingEpoch],
      );
      const slotUpdate = await sql.query(
        `UPDATE compute_capacity_slots SET fencing_epoch = $2, holder_id = $3,
           task_id = $4, lease_id = $5, lease_epoch = $6,
           heartbeat_at = $7, expires_at = $8 WHERE slot_number = $1`,
        [slot.slot_number, fencingEpoch, input.holderId, taskId, input.leaseId,
          lease.epoch, dateFromMs(nowMs), dateFromMs(lease.expiresAtMs)],
      );
      if (jobUpdate.rowCount !== 1 || slotUpdate.rowCount !== 1) {
        persistentError("RECOVERY_CONFLICT");
      }
      return Object.freeze({
        version: PERSISTENT_LEASE_CLAIM_VERSION,
        slot: slot.slot_number,
        holderId: input.holderId,
        taskId,
        fencingEpoch,
        lease,
        record: next,
      });
    });
  }

  async heartbeat(
    claim: PersistentLeaseClaimV1,
    durationMs: number,
  ): Promise<PersistentLeaseClaimV1> {
    if (claim.version !== PERSISTENT_LEASE_CLAIM_VERSION ||
        !Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > this.#maxLeaseDurationMs) {
      persistentError("CONFIGURATION_INVALID");
    }
    return this.#database.transaction(async (sql) => {
      const locked = await sql.query<SlotRow>(
        `SELECT slot_number, fencing_epoch, task_id, lease_epoch
         FROM compute_capacity_slots WHERE slot_number = $1 FOR UPDATE`,
        [claim.slot],
      );
      const slot = locked.rows[0];
      if (slot === undefined || slot.task_id !== claim.taskId ||
          safeInteger(slot.fencing_epoch) !== claim.fencingEpoch ||
          safeInteger(slot.lease_epoch) !== claim.lease.epoch) {
        persistentError("RECOVERY_CONFLICT");
      }
      const time = await sql.query<TimeRow>(
        "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms",
      );
      const nowMs = safeInteger(time.rows[0]?.now_ms);
      const task = await sql.query<RecordRow>(
        "SELECT record FROM compute_jobs WHERE task_id = $1 FOR UPDATE",
        [claim.taskId],
      );
      const record = firstRecord(task);
      assertCoreRecord(record);
      if (record.lease?.leaseId !== claim.lease.leaseId ||
          record.lease.epoch !== claim.lease.epoch ||
          !["leased", "starting", "running"].includes(record.state)) {
        persistentError("RECOVERY_CONFLICT");
      }
      const expiresAtMs = Math.min(
        nowMs + durationMs,
        record.request.deadlineAtMs,
        record.request.expiresAtMs,
      );
      if (expiresAtMs <= nowMs) persistentError("RECOVERY_CONFLICT");
      const lease = cloneFrozen({ ...record.lease, expiresAtMs });
      const next = cloneFrozen({ ...record, lease, revision: record.revision + 1, updatedAtMs: nowMs });
      const jobUpdate = await sql.query(
        `UPDATE compute_jobs SET revision = $2, updated_at = $3, record = $4::jsonb
         WHERE task_id = $1`,
        [claim.taskId, next.revision, dateFromMs(nowMs), JSON.stringify(next)],
      );
      const slotUpdate = await sql.query(
        `UPDATE compute_capacity_slots SET heartbeat_at = $2, expires_at = $3
         WHERE slot_number = $1`,
        [claim.slot, dateFromMs(nowMs), dateFromMs(expiresAtMs)],
      );
      if (jobUpdate.rowCount !== 1 || slotUpdate.rowCount !== 1) {
        persistentError("RECOVERY_CONFLICT");
      }
      return Object.freeze({ ...claim, lease, record: next });
    });
  }

  async release(claim: PersistentLeaseClaimV1): Promise<boolean> {
    return this.#database.transaction(async (sql) => {
      const locked = await sql.query(
        `SELECT slot_number FROM compute_capacity_slots
         WHERE slot_number = $1 AND fencing_epoch = $2 AND holder_id = $3
           AND task_id = $4 AND lease_id = $5 AND lease_epoch = $6
         FOR UPDATE`,
        [claim.slot, claim.fencingEpoch, claim.holderId, claim.taskId,
          claim.lease.leaseId, claim.lease.epoch],
      );
      if (locked.rowCount === 0) return false;
      if (locked.rowCount !== 1) persistentError("DATABASE_FAILURE");
      const job = await sql.query(
        `UPDATE compute_jobs SET claim_slot_number = NULL,
           claim_fencing_epoch = NULL
         WHERE task_id = $1 AND claim_slot_number = $2
           AND claim_fencing_epoch = $3 AND lease_epoch = $4`,
        [claim.taskId, claim.slot, claim.fencingEpoch, claim.lease.epoch],
      );
      const slot = await sql.query(
        `UPDATE compute_capacity_slots
         SET holder_id = NULL, task_id = NULL, lease_id = NULL, lease_epoch = NULL,
           heartbeat_at = NULL, expires_at = NULL
         WHERE slot_number = $1 AND fencing_epoch = $2 AND holder_id = $3
           AND task_id = $4 AND lease_id = $5 AND lease_epoch = $6`,
        [claim.slot, claim.fencingEpoch, claim.holderId, claim.taskId,
          claim.lease.leaseId, claim.lease.epoch],
      );
      if (job.rowCount !== 1 || slot.rowCount !== 1) persistentError("RECOVERY_CONFLICT");
      return true;
    });
  }

  async reconcileObservedTermination(
    claim: PersistentLeaseClaimV1,
  ): Promise<boolean> {
    return this.#database.transaction(async (sql) => {
      const locked = await sql.query<SlotRow>(
        `SELECT s.slot_number, s.fencing_epoch, s.task_id, s.lease_epoch, j.record
         FROM compute_capacity_slots s
         JOIN compute_jobs j ON j.task_id = s.task_id
         WHERE s.slot_number = $1 AND s.fencing_epoch = $2
           AND s.holder_id = $3 AND s.task_id = $4
           AND s.lease_id = $5 AND s.lease_epoch = $6
         FOR UPDATE OF s, j`,
        [claim.slot, claim.fencingEpoch, claim.holderId, claim.taskId,
          claim.lease.leaseId, claim.lease.epoch],
      );
      const row = locked.rows[0];
      if (row === undefined) return false;
      assertCoreRecord(row.record);
      if (row.record.execution !== undefined ||
          !["succeeded", "failed", "cancelled", "timed_out", "expired", "deleting", "deleted"]
            .includes(row.record.state)) {
        persistentError("RECOVERY_CONFLICT");
      }
      const time = await sql.query<TimeRow>(
        "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms",
      );
      const reconciledAtMs = safeInteger(time.rows[0]?.now_ms);
      const receipt: TerminationReconciliationReceiptV1 = Object.freeze({
        version: TERMINATION_RECONCILIATION_RECEIPT_VERSION,
        taskRef: row.record.taskRef,
        leaseEpoch: claim.lease.epoch,
        fencingEpoch: claim.fencingEpoch,
        reconciledAtMs,
        terminationObserved: true,
        capacityReleased: true,
        source: "owning-worker",
      });
      await persistExactTerminationReceipt(sql, receipt, null, null);
      const job = await sql.query(
        `UPDATE compute_jobs SET claim_slot_number = NULL,
           claim_fencing_epoch = NULL
         WHERE task_id = $1 AND claim_slot_number = $2
           AND claim_fencing_epoch = $3 AND lease_epoch = $4`,
        [claim.taskId, claim.slot, claim.fencingEpoch, claim.lease.epoch],
      );
      const slot = await sql.query(
        `UPDATE compute_capacity_slots
         SET holder_id = NULL, task_id = NULL, lease_id = NULL,
           lease_epoch = NULL, heartbeat_at = NULL, expires_at = NULL
         WHERE slot_number = $1 AND fencing_epoch = $2
           AND holder_id = $3 AND task_id = $4`,
        [claim.slot, claim.fencingEpoch, claim.holderId, claim.taskId],
      );
      if (job.rowCount !== 1 || slot.rowCount !== 1) {
        persistentError("RECOVERY_CONFLICT");
      }
      return true;
    });
  }

  async reconcileQuarantinedClaim(input: Readonly<{
    slot: number;
    recoveryFencingEpoch: number;
    observation: ExternalTerminationObservationV1;
  }>): Promise<TerminationReconciliationReceiptV1> {
    if (!Number.isSafeInteger(input.slot) || input.slot < 1 ||
        !Number.isSafeInteger(input.recoveryFencingEpoch) ||
        input.recoveryFencingEpoch < 1 ||
        input.observation.version !== EXTERNAL_TERMINATION_OBSERVATION_VERSION ||
        !OPAQUE_ID.test(input.observation.taskId) ||
        !OPAQUE_ID.test(input.observation.executionId) ||
        (input.observation.childId !== null && !OPAQUE_ID.test(input.observation.childId)) ||
        !Number.isSafeInteger(input.observation.observedAtMs) ||
        input.observation.observedAtMs < 0 ||
        !OPAQUE_ID.test(input.observation.providerReceiptId) ||
        !["completed", "crashed", "terminated", "launch_rejected"]
          .includes(input.observation.kind)) {
      persistentError("CONFIGURATION_INVALID");
    }
    return this.#database.transaction(async (sql) => {
      const isolatedEpoch = input.recoveryFencingEpoch + 1;
      const locked = await sql.query<SlotRow>(
        `SELECT s.slot_number, s.fencing_epoch, s.task_id, s.lease_epoch, j.record
         FROM compute_capacity_slots s
         JOIN compute_jobs j ON j.task_id = s.task_id
         WHERE s.slot_number = $1 AND s.fencing_epoch = $2
           AND s.task_id = $3 AND s.quarantined_at IS NOT NULL
         FOR UPDATE OF s, j`,
        [input.slot, isolatedEpoch, input.observation.taskId],
      );
      const row = locked.rows[0];
      if (row === undefined) persistentError("RECOVERY_CONFLICT");
      assertCoreRecord(row.record);
      const execution = row.record.execution;
      if (execution?.executionId !== input.observation.executionId ||
          (input.observation.childId !== null &&
            execution.childId !== input.observation.childId)) {
        persistentError("RECOVERY_CONFLICT");
      }
      const mutable = withoutKeys(row.record as unknown as Record<string, unknown>, [
        "lease", "execution", "pendingStopOutcome",
      ]);
      let target: ComputeJobState;
      if (input.observation.observedAtMs >= row.record.request.expiresAtMs) {
        target = "expired";
        delete mutable.result;
        delete mutable.failure;
      } else if (input.observation.observedAtMs >= row.record.request.deadlineAtMs) {
        target = "timed_out";
        delete mutable.result;
        delete mutable.failure;
      } else if (row.record.pendingStopOutcome === "deleted") {
        target = "deleting";
        delete mutable.result;
        delete mutable.failure;
      } else if (row.record.pendingStopOutcome !== undefined &&
          row.record.pendingStopOutcome !== "queued") {
        target = row.record.pendingStopOutcome;
        delete mutable.result;
        if (target !== "failed") delete mutable.failure;
      } else if (input.observation.kind === "completed" && row.record.result !== undefined) {
        target = "succeeded";
        delete mutable.failure;
      } else if (input.observation.kind === "launch_rejected" ||
          input.observation.kind === "crashed") {
        target = "failed";
        delete mutable.result;
        mutable.failure = {
          code: input.observation.kind === "launch_rejected"
            ? "PROCESS_START_FAILED"
            : "PROCESS_CRASHED",
          atMs: input.observation.observedAtMs,
        };
      } else {
        target = "queued";
        delete mutable.result;
        delete mutable.failure;
      }
      const next = cloneFrozen({
        ...mutable,
        state: target,
        revision: row.record.revision + 1,
        updatedAtMs: input.observation.observedAtMs,
      }) as unknown as ComputeJobRecordV1;
      assertCoreRecord(next);
      const receipt: TerminationReconciliationReceiptV1 = Object.freeze({
        version: TERMINATION_RECONCILIATION_RECEIPT_VERSION,
        taskRef: row.record.taskRef,
        leaseEpoch: safeInteger(row.lease_epoch),
        fencingEpoch: isolatedEpoch,
        reconciledAtMs: input.observation.observedAtMs,
        terminationObserved: true,
        capacityReleased: true,
        source: "external-quarantine-reconcile",
      });
      await persistExactTerminationReceipt(
        sql,
        receipt,
        input.observation.providerReceiptId,
        input.observation,
      );
      const job = await sql.query(
        `UPDATE compute_jobs SET state = $2, revision = $3, updated_at = $4,
           record = $5::jsonb, claim_slot_number = NULL,
           claim_fencing_epoch = NULL
         WHERE task_id = $1 AND claim_slot_number = $6
           AND claim_fencing_epoch = $7`,
        [input.observation.taskId, next.state, next.revision,
          dateFromMs(next.updatedAtMs), JSON.stringify(next), input.slot,
          input.recoveryFencingEpoch],
      );
      const slot = await sql.query(
        `UPDATE compute_capacity_slots SET enabled = true,
           holder_id = NULL, task_id = NULL, lease_id = NULL,
           lease_epoch = NULL, heartbeat_at = NULL, expires_at = NULL,
           quarantined_at = NULL, quarantine_receipt = NULL
         WHERE slot_number = $1 AND fencing_epoch = $2
           AND task_id = $3 AND quarantined_at IS NOT NULL`,
        [input.slot, isolatedEpoch, input.observation.taskId],
      );
      if (job.rowCount !== 1 || slot.rowCount !== 1) {
        persistentError("RECOVERY_CONFLICT");
      }
      return receipt;
    });
  }

  async recoverExpiredClaims(): Promise<readonly RecoveryReceiptV2[]> {
    return this.#database.transaction(async (sql) => {
      const time = await sql.query<TimeRow>(
        "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms",
      );
      const nowMs = safeInteger(time.rows[0]?.now_ms);
      const slots = await sql.query<SlotRow>(
        `SELECT s.slot_number, s.fencing_epoch, s.task_id, s.lease_epoch,
           s.quarantined_at, j.record
         FROM compute_capacity_slots s
         JOIN compute_jobs j ON j.task_id = s.task_id
         WHERE s.holder_id IS NOT NULL AND s.quarantined_at IS NULL
           AND s.expires_at <= clock_timestamp()
         ORDER BY s.expires_at, s.slot_number
         FOR UPDATE OF s, j SKIP LOCKED LIMIT $1`,
        [this.#recoveryBatchSize],
      );
      const receipts: RecoveryReceiptV2[] = [];
      for (const slot of slots.rows) {
        if (slot.task_id === undefined || slot.task_id === null || slot.record === undefined) {
          persistentError("DATABASE_FAILURE");
        }
        assertCoreRecord(slot.record);
        const previousEpoch = safeInteger(slot.lease_epoch);
        const fencingEpoch = safeInteger(slot.fencing_epoch);
        if (slot.record.lease?.epoch !== previousEpoch) persistentError("RECOVERY_CONFLICT");
        if (slot.record.execution !== undefined ||
            ["starting", "running", "cancelling"].includes(slot.record.state)) {
          const receipt: RecoveryReceiptV2 = Object.freeze({
            version: RECOVERY_RECEIPT_VERSION_V2,
            taskRef: slot.record.taskRef,
            previousLeaseEpoch: previousEpoch,
            fencingEpoch,
            disposition: "quarantined",
            recoveredAtMs: nowMs,
            terminationObserved: false,
            capacityReleased: false,
            isolated: true,
          });
          const quarantined = await sql.query(
            `UPDATE compute_capacity_slots
             SET enabled = false, fencing_epoch = fencing_epoch + 1,
               quarantined_at = $2, quarantine_receipt = $3::jsonb
             WHERE slot_number = $1 AND quarantined_at IS NULL`,
            [slot.slot_number, dateFromMs(nowMs), JSON.stringify(receipt)],
          );
          if (quarantined.rowCount !== 1) persistentError("RECOVERY_CONFLICT");
          await sql.query(
            `INSERT INTO compute_recovery_receipts
               (task_ref, previous_lease_epoch, fencing_epoch, recovered_at, disposition, receipt)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING`,
            [receipt.taskRef, previousEpoch, fencingEpoch, dateFromMs(nowMs),
              receipt.disposition, JSON.stringify(receipt)],
          );
          receipts.push(receipt);
          continue;
        }
        const target = recoveryState(slot.record, nowMs);
        const mutable = withoutKeys(slot.record as unknown as Record<string, unknown>, [
          "lease", "execution", "pendingStopOutcome",
        ]);
        if (target.state !== "succeeded") delete mutable.result;
        if (target.state !== "failed") delete mutable.failure;
        const next = cloneFrozen({
          ...mutable,
          state: target.state,
          revision: slot.record.revision + 1,
          updatedAtMs: nowMs,
        }) as unknown as ComputeJobRecordV1;
        assertCoreRecord(next);
        const jobUpdate = await sql.query(
          `UPDATE compute_jobs SET state = $2, revision = $3, updated_at = $4,
             record = $5::jsonb, claim_slot_number = NULL,
             claim_fencing_epoch = NULL WHERE task_id = $1
               AND claim_slot_number = $6 AND claim_fencing_epoch = $7
               AND lease_epoch = $8`,
          [slot.task_id, next.state, next.revision, dateFromMs(nowMs), JSON.stringify(next),
            slot.slot_number, fencingEpoch, previousEpoch],
        );
        const slotUpdate = await sql.query(
          `UPDATE compute_capacity_slots
           SET holder_id = NULL, task_id = NULL, lease_id = NULL, lease_epoch = NULL,
             heartbeat_at = NULL, expires_at = NULL
           WHERE slot_number = $1 AND fencing_epoch = $2 AND task_id = $3
             AND lease_epoch = $4`,
          [slot.slot_number, fencingEpoch, slot.task_id, previousEpoch],
        );
        if (jobUpdate.rowCount !== 1 || slotUpdate.rowCount !== 1) {
          persistentError("RECOVERY_CONFLICT");
        }
        const terminationObserved = [
          "succeeded", "failed", "cancelled", "timed_out", "expired", "deleting", "deleted",
        ].includes(slot.record.state);
        if (terminationObserved) {
          const terminationReceipt: TerminationReconciliationReceiptV1 = Object.freeze({
            version: TERMINATION_RECONCILIATION_RECEIPT_VERSION,
            taskRef: slot.record.taskRef,
            leaseEpoch: previousEpoch,
            fencingEpoch,
            reconciledAtMs: nowMs,
            terminationObserved: true,
            capacityReleased: true,
            source: "expired-claim-recovery",
          });
          await sql.query(
            `INSERT INTO compute_termination_reconciliation_receipts
               (task_ref, lease_epoch, fencing_epoch, reconciled_at, source, receipt)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING`,
            [terminationReceipt.taskRef, terminationReceipt.leaseEpoch,
              terminationReceipt.fencingEpoch,
              dateFromMs(terminationReceipt.reconciledAtMs),
              terminationReceipt.source, JSON.stringify(terminationReceipt)],
          );
        }
        const receipt: RecoveryReceiptV2 = Object.freeze({
          version: RECOVERY_RECEIPT_VERSION_V2,
          taskRef: slot.record.taskRef,
          previousLeaseEpoch: previousEpoch,
          fencingEpoch,
          disposition: target.disposition,
          recoveredAtMs: nowMs,
          terminationObserved,
          capacityReleased: true,
          isolated: false,
        });
        await sql.query(
          `INSERT INTO compute_recovery_receipts
             (task_ref, previous_lease_epoch, fencing_epoch, recovered_at, disposition, receipt)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING`,
          [receipt.taskRef, previousEpoch, fencingEpoch, dateFromMs(nowMs),
            receipt.disposition, JSON.stringify(receipt)],
        );
        receipts.push(receipt);
      }
      return Object.freeze(receipts);
    });
  }
}
