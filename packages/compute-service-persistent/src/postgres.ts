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
} from "@3dena/compute-service-http";

import {
  PERSISTENT_LEASE_CLAIM_VERSION,
  RECOVERY_RECEIPT_VERSION,
  type PersistentLeaseClaimV1,
  type PersistentLeaseCoordinatorV1,
  type RecoveryDisposition,
  type RecoveryReceiptV1,
} from "./contracts";
import { persistentError } from "./errors";
import {
  cloneFrozen,
  hasExactKeys,
  isRecord,
  OPAQUE_ID,
} from "./util";

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
      "SELECT extract(epoch FROM clock_timestamp()) * 1000 AS now_ms",
    );
    this.#serverNowMs = safeInteger(result.rows[0]?.now_ms);
    return this.#serverNowMs;
  }

  now(): number {
    if (this.#serverNowMs === null) persistentError("DATABASE_FAILURE");
    return this.#serverNowMs;
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
    !/^[a-f0-9]{64}$/u.test(value.createIdempotencyHash)
  ) {
    persistentError("DATABASE_FAILURE");
  }
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
  readonly #database: SqlQueryExecutor;

  constructor(database: SqlQueryExecutor) {
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
      await sql.query(
        `INSERT INTO compute_event_cursors (job_id, next_sequence)
         VALUES ($1, 1) ON CONFLICT (job_id) DO NOTHING`,
        [jobId],
      );
      const cursor = await sql.query<{ sequence: string | number; [key: string]: unknown }>(
        `UPDATE compute_event_cursors SET next_sequence = next_sequence + 1
         WHERE job_id = $1 RETURNING next_sequence - 1 AS sequence`,
        [jobId],
      );
      const sequence = safeInteger(cursor.rows[0]?.sequence);
      const event: AnalysisJobEventV1 = Object.freeze({
        schemaVersion: "3dena.job-event.v1",
        sequence,
        ...input,
        emittedAt,
      });
      await sql.query(
        `INSERT INTO compute_events (job_id, sequence, emitted_at, event)
         VALUES ($1,$2,$3,$4::jsonb)`,
        [jobId, sequence, emittedAt, JSON.stringify(event)],
      );
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
          if (!isRecord(row.event) || row.event.schemaVersion !== "3dena.job-event.v1" ||
              !Number.isSafeInteger(row.event.sequence) || Number(row.event.sequence) <= cursor) {
            persistentError("DATABASE_FAILURE");
          }
          const event = cloneFrozen(row.event) as unknown as AnalysisJobEventV1;
          cursor = event.sequence;
          yield event;
        }
        continue;
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
         ON CONFLICT (slot_number) DO UPDATE SET enabled = true`,
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
         WHERE enabled = true AND (holder_id IS NULL OR expires_at <= clock_timestamp())
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
      await sql.query(
        `UPDATE compute_jobs SET state = 'leased', revision = $2, lease_epoch = $3,
           updated_at = $4, record = $5::jsonb WHERE task_id = $1`,
        [taskId, next.revision, next.leaseEpoch, dateFromMs(nowMs), JSON.stringify(next)],
      );
      await sql.query(
        `UPDATE compute_capacity_slots SET fencing_epoch = $2, holder_id = $3,
           task_id = $4, lease_id = $5, lease_epoch = $6,
           heartbeat_at = $7, expires_at = $8 WHERE slot_number = $1`,
        [slot.slot_number, fencingEpoch, input.holderId, taskId, input.leaseId,
          lease.epoch, dateFromMs(nowMs), dateFromMs(lease.expiresAtMs)],
      );
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
      await sql.query(
        `UPDATE compute_jobs SET revision = $2, updated_at = $3, record = $4::jsonb
         WHERE task_id = $1`,
        [claim.taskId, next.revision, dateFromMs(nowMs), JSON.stringify(next)],
      );
      await sql.query(
        `UPDATE compute_capacity_slots SET heartbeat_at = $2, expires_at = $3
         WHERE slot_number = $1`,
        [claim.slot, dateFromMs(nowMs), dateFromMs(expiresAtMs)],
      );
      return Object.freeze({ ...claim, lease, record: next });
    });
  }

  async release(claim: PersistentLeaseClaimV1): Promise<boolean> {
    const result = await this.#database.query(
      `UPDATE compute_capacity_slots
       SET holder_id = NULL, task_id = NULL, lease_id = NULL, lease_epoch = NULL,
           heartbeat_at = NULL, expires_at = NULL
       WHERE slot_number = $1 AND fencing_epoch = $2 AND holder_id = $3
         AND task_id = $4 AND lease_id = $5 AND lease_epoch = $6`,
      [claim.slot, claim.fencingEpoch, claim.holderId, claim.taskId,
        claim.lease.leaseId, claim.lease.epoch],
    );
    return result.rowCount === 1;
  }

  async recoverExpiredClaims(): Promise<readonly RecoveryReceiptV1[]> {
    return this.#database.transaction(async (sql) => {
      const time = await sql.query<TimeRow>(
        "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms",
      );
      const nowMs = safeInteger(time.rows[0]?.now_ms);
      const slots = await sql.query<SlotRow>(
        `SELECT s.slot_number, s.fencing_epoch, s.task_id, s.lease_epoch, j.record
         FROM compute_capacity_slots s
         JOIN compute_jobs j ON j.task_id = s.task_id
         WHERE s.holder_id IS NOT NULL AND s.expires_at <= clock_timestamp()
         ORDER BY s.expires_at, s.slot_number
         FOR UPDATE OF s, j SKIP LOCKED LIMIT $1`,
        [this.#recoveryBatchSize],
      );
      const receipts: RecoveryReceiptV1[] = [];
      for (const slot of slots.rows) {
        if (slot.task_id === undefined || slot.task_id === null || slot.record === undefined) {
          persistentError("DATABASE_FAILURE");
        }
        assertCoreRecord(slot.record);
        const previousEpoch = safeInteger(slot.lease_epoch);
        const fencingEpoch = safeInteger(slot.fencing_epoch);
        if (slot.record.lease?.epoch !== previousEpoch) persistentError("RECOVERY_CONFLICT");
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
        await sql.query(
          `UPDATE compute_jobs SET state = $2, revision = $3, updated_at = $4,
             record = $5::jsonb WHERE task_id = $1`,
          [slot.task_id, next.state, next.revision, dateFromMs(nowMs), JSON.stringify(next)],
        );
        await sql.query(
          `UPDATE compute_capacity_slots
           SET holder_id = NULL, task_id = NULL, lease_id = NULL, lease_epoch = NULL,
             heartbeat_at = NULL, expires_at = NULL WHERE slot_number = $1`,
          [slot.slot_number],
        );
        const receipt: RecoveryReceiptV1 = Object.freeze({
          version: RECOVERY_RECEIPT_VERSION,
          taskRef: slot.record.taskRef,
          previousLeaseEpoch: previousEpoch,
          fencingEpoch,
          disposition: target.disposition,
          recoveredAtMs: nowMs,
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
