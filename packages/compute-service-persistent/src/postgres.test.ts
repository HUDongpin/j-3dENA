import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  COMPUTE_JOB_RECORD_VERSION,
  COMPUTE_TASK_OWNER_CONTRACT_VERSION,
  COMPUTE_TASK_REQUEST_VERSION,
  type ComputeJobRecordV1,
} from "@3dena/compute-service-core";

import type {
  PgCompatibleClient,
  PgCompatiblePool,
  SqlQueryResult,
} from "./postgres";
import { PostgresObjectLedger } from "./vercel-blob";
import { PERSISTENT_LEASE_CLAIM_VERSION } from "./contracts";
import {
  PostgresDatabase,
  PostgresAuthoritativeClock,
  PostgresComputeTaskRepository,
  PostgresDistributedLeaseCoordinator,
  PostgresDeletionLifecycleProbe,
  PostgresTemporalDueSource,
} from "./postgres";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function queuedRecord(): ComputeJobRecordV1 {
  return {
    version: COMPUTE_JOB_RECORD_VERSION,
    owner: {
      contractVersion: COMPUTE_TASK_OWNER_CONTRACT_VERSION,
      datasetHash: HASH_A,
      specHash: HASH_B,
      runId: "run-1",
      taskId: "task-1",
    },
    taskRef: HASH_C,
    request: {
      version: COMPUTE_TASK_REQUEST_VERSION,
      owner: {
        contractVersion: COMPUTE_TASK_OWNER_CONTRACT_VERSION,
        datasetHash: HASH_A,
        specHash: HASH_B,
        runId: "run-1",
        taskId: "task-1",
      },
      taskKind: "ena-model",
      input: { key: "inputs/task-1.bin", sha256: HASH_A, byteLength: 10 },
      deadlineAtMs: 20_000,
      expiresAtMs: 30_000,
    },
    requestFingerprint: HASH_B,
    requestObjectKey: "requests/task-1.json",
    state: "queued",
    revision: 0,
    leaseEpoch: 0,
    createdAtMs: 1_000,
    updatedAtMs: 1_000,
    ownedResultObjectKeys: [],
  };
}

type Handler = (
  sql: string,
  values: readonly unknown[],
) => SqlQueryResult<Record<string, unknown>>;

class HandlerPool implements PgCompatiblePool, PgCompatibleClient {
  readonly statements: string[] = [];
  readonly #handler: Handler;

  constructor(handler: Handler) {
    this.#handler = handler;
  }

  async connect(): Promise<PgCompatibleClient> {
    return this;
  }

  release(): void {}

  async query<Row extends Record<string, unknown>>(
    sql: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.statements.push(sql);
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      return { rows: [], rowCount: 0 };
    }
    return this.#handler(sql, values) as SqlQueryResult<Row>;
  }
}

describe("persistent PostgreSQL contract", () => {
  it("fences every active job CAS against the exact distributed slot attempt", async () => {
    const current = queuedRecord();
    const next: ComputeJobRecordV1 = {
      ...current,
      state: "cancelled",
      revision: 1,
      updatedAtMs: 2_000,
    };
    const pool = new HandlerPool((sql) => {
      if (sql.startsWith("UPDATE compute_jobs")) {
        return { rows: [{ record: next }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const repository = new PostgresComputeTaskRepository(new PostgresDatabase(pool));
    await expect(repository.compareAndSet("task-1", 0, next)).resolves.toMatchObject({
      applied: true,
    });
    const statement = pool.statements.find((sql) => sql.startsWith("UPDATE compute_jobs"));
    expect(statement).toContain("claim_fencing_epoch IS NULL OR EXISTS");
    expect(statement).toContain("fenced.fencing_epoch = compute_jobs.claim_fencing_epoch");
    expect(statement).toContain("fenced.lease_epoch = compute_jobs.lease_epoch");
  });

  it("reports distributed capacity release only when no durable slot still owns the task", async () => {
    const pool = new HandlerPool((sql, values) => {
      if (sql.includes("compute_termination_reconciliation_receipts")) {
        return {
          rows: [{ termination_observed: values[0] === "task-observed" }],
          rowCount: 1,
        };
      }
      if (sql.includes("NOT EXISTS") && sql.includes("compute_capacity_slots")) {
        return {
          rows: [{ capacity_released: values[0] === "task-released" }],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const probe = new PostgresDeletionLifecycleProbe(new PostgresDatabase(pool));
    await expect(probe.capacityReleased("task-held")).resolves.toBe(false);
    await expect(probe.capacityReleased("task-released")).resolves.toBe(true);
    await expect(probe.terminationObserved("task-unobserved")).resolves.toBe(false);
    await expect(probe.terminationObserved("task-observed")).resolves.toBe(true);
  });

  it("claims one bounded server-time temporal page under a singleton database lease", async () => {
    const pool = new HandlerPool((sql, values) => {
      if (sql.includes("INSERT INTO compute_scheduler_leases")) {
        expect(values).toEqual(["api-runtime-1", 5_000]);
        return { rows: [{ lease_epoch: "4" }], rowCount: 1 };
      }
      if (sql.includes("SELECT j.task_id FROM compute_jobs")) {
        expect(values).toEqual([2]);
        return { rows: [{ task_id: "task-due-1" }], rowCount: 1 };
      }
      if (sql.includes("SELECT h.job_id") && sql.includes("FROM compute_http_jobs")) {
        expect(values).toEqual([1]);
        return {
          rows: [{ job_id: "job-delete-1", work_kind: "http-deletion" }],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const source = new PostgresTemporalDueSource(new PostgresDatabase(pool), {
      holderId: "api-runtime-1",
      leaseDurationMs: 5_000,
      batchSize: 3,
    });
    await expect(source.claimDue()).resolves.toEqual([
      { kind: "task", id: "task-due-1" },
      { kind: "http-deletion", id: "job-delete-1" },
    ]);
    const statements = pool.statements.join("\n");
    expect(statements).toContain("clock_timestamp()");
    expect(statements).toContain("FOR UPDATE OF j SKIP LOCKED");
    expect(statements).toContain("FOR UPDATE OF h SKIP LOCKED");
    expect(statements).toContain("LIMIT $1");
    expect(statements).not.toContain("SELECT record FROM compute_jobs ORDER BY task_id");
    const deletionSelection = pool.statements.find(
      (sql) => sql.includes("SELECT h.job_id") && sql.includes("FROM compute_http_jobs"),
    );
    expect(deletionSelection).not.toContain("compute_capacity_slots");
    expect(deletionSelection).toContain("longitudinal-analysis-v2");
    expect(deletionSelection).toContain("60000");
    expect(deletionSelection).toContain("NOT EXISTS");
    expect(deletionSelection).toContain("compute_jobs AS core");
    expect(deletionSelection).toContain("work_kind");
    expect(deletionSelection).toContain("succeeded");
    expect(deletionSelection).toContain("failed");
  });

  it("does not scan temporal work when another runtime still owns the singleton lease", async () => {
    const pool = new HandlerPool((sql) => {
      if (sql.includes("INSERT INTO compute_scheduler_leases")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const source = new PostgresTemporalDueSource(new PostgresDatabase(pool), {
      holderId: "api-runtime-2",
    });
    await expect(source.claimDue()).resolves.toEqual([]);
    expect(pool.statements.some((sql) => sql.includes("SELECT j.task_id"))).toBe(false);
  });

  it("persists Blob intent/available/deleting/deleted under exact generation fences", async () => {
    let state: "missing" | "intent" | "available" | "deleting" | "deleted" = "missing";
    let fencingEpoch = 1;
    let generation = 1;
    let pathname = `prod-compute/aa/${HASH_A}`;
    const objectRow = () => ({
      object_ref: HASH_A,
      object_key: "inputs/sql-blob.bin",
      pathname,
      sha256: HASH_B,
      byte_length: "2",
      generation: String(generation),
      fencing_epoch: String(fencingEpoch),
      state,
    });
    const pool = new HandlerPool((sql, values) => {
      if (sql.includes("INSERT INTO compute_blob_namespace_locks")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("SELECT fencing_epoch FROM compute_blob_namespace_locks")) {
        return { rows: [{ fencing_epoch: "1" }], rowCount: 1 };
      }
      if (sql.includes("SELECT 1 FROM compute_blob_orphan_intents")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM compute_objects WHERE object_ref") && sql.includes("FOR UPDATE")) {
        return state === "missing" ? { rows: [], rowCount: 0 } : { rows: [objectRow()], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO compute_objects")) {
        state = "intent";
        return { rows: [objectRow()], rowCount: 1 };
      }
      if (sql.includes("SET state = 'available'")) {
        state = "available";
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("SET generation = generation + 1")) {
        generation += 1;
        fencingEpoch += 1;
        pathname = String(values[5]);
        state = "intent";
        return { rows: [objectRow()], rowCount: 1 };
      }
      if (sql.includes("FROM compute_objects WHERE object_key")) {
        return { rows: [objectRow()], rowCount: 1 };
      }
      if (sql.includes("SET state = 'deleting'")) {
        fencingEpoch += 1;
        state = "deleting";
        return { rows: [objectRow()], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO compute_deletion_receipts")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("SET state = 'deleted'")) {
        state = "deleted";
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const ledger = new PostgresObjectLedger(new PostgresDatabase(pool));
    const lease = await ledger.beginPut({
      namespace: "prod-compute",
      objectRef: HASH_A,
      objectKey: "inputs/sql-blob.bin",
      pathname: `prod-compute/aa/${HASH_A}`,
      sha256: HASH_B,
      byteLength: 2,
      createdAtMs: 1_000,
      deleteAfterMs: 2_000,
    });
    expect(lease).toMatchObject({ generation: 1, fencingEpoch: 1, state: "intent" });
    await ledger.markAvailable(lease, 1_001);
    const deleting = await ledger.beginDelete("inputs/sql-blob.bin", 1_100);
    expect(deleting).toMatchObject({ generation: 1, fencingEpoch: 2, state: "deleting" });
    if (deleting === null) throw new Error("Expected fenced delete lease.");
    await ledger.completeDelete(deleting, {
      version: "3dena.object-deletion-probe.v1",
      objectRef: HASH_A,
      requestedAtMs: 1_100,
      completedAtMs: 1_101,
      headAbsent: true,
      getAbsent: true,
    });
    expect(state).toBe("deleted");
    const reactivated = await ledger.beginPut({
      namespace: "prod-compute",
      objectRef: HASH_A,
      objectKey: "inputs/sql-blob.bin",
      pathname: `prod-compute/aa/${HASH_A}`,
      sha256: HASH_B,
      byteLength: 2,
      createdAtMs: 1_200,
      deleteAfterMs: 2_200,
    });
    expect(reactivated).toMatchObject({
      generation: 2,
      fencingEpoch: 3,
      pathname: `prod-compute/aa/${HASH_A}.g2`,
      state: "intent",
    });
    await ledger.markAvailable(reactivated, 1_201);
    await expect(ledger.resolve("inputs/sql-blob.bin")).resolves.toMatchObject({
      generation: 2,
      pathname: `prod-compute/aa/${HASH_A}.g2`,
      state: "available",
    });
    const statements = pool.statements.join("\n");
    expect(statements).toContain("FOR UPDATE");
    expect(statements).toContain("generation = $2");
    expect(statements).toContain("fencing_epoch = $3");
    expect(statements).toContain("pathname = $6");
  });

  it("rolls back termination reconciliation when exact fenced slot release loses its CAS", async () => {
    const record: ComputeJobRecordV1 = {
      ...queuedRecord(),
      state: "cancelled",
      revision: 3,
      leaseEpoch: 1,
      updatedAtMs: 2_000,
    };
    const pool = new HandlerPool((sql) => {
      if (sql.includes("JOIN compute_jobs") && sql.includes("FOR UPDATE OF s, j")) {
        return { rows: [{
          slot_number: 1,
          fencing_epoch: "4",
          task_id: "task-1",
          lease_epoch: "1",
          record,
        }], rowCount: 1 };
      }
      if (sql.includes("extract(epoch")) {
        return { rows: [{ now_ms: "2000" }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO compute_termination_reconciliation_receipts")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE compute_jobs")) return { rows: [], rowCount: 1 };
      if (sql.startsWith("UPDATE compute_capacity_slots")) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const coordinator = new PostgresDistributedLeaseCoordinator(
      new PostgresDatabase(pool),
      { maxLeaseDurationMs: 5_000 },
    );
    await expect(coordinator.reconcileObservedTermination({
      version: PERSISTENT_LEASE_CLAIM_VERSION,
      slot: 1,
      holderId: "worker-1",
      taskId: "task-1",
      fencingEpoch: 4,
      lease: {
        version: "3dena.compute-lease.v1",
        leaseId: "lease-1",
        holderId: "worker-1",
        epoch: 1,
        issuedAtMs: 1_000,
        expiresAtMs: 2_000,
      },
      record,
    })).rejects.toMatchObject({ code: "RECOVERY_CONFLICT" });
    expect(pool.statements).toContain("ROLLBACK");
    expect(pool.statements).not.toContain("COMMIT");
  });

  it("does not release an owning-worker slot when an exact receipt conflict is unproven", async () => {
    const record: ComputeJobRecordV1 = {
      ...queuedRecord(),
      state: "cancelled",
      revision: 3,
      leaseEpoch: 1,
      updatedAtMs: 2_000,
    };
    const pool = new HandlerPool((sql) => {
      if (sql.includes("JOIN compute_jobs") && sql.includes("FOR UPDATE OF s, j")) {
        return { rows: [{
          slot_number: 1,
          fencing_epoch: "4",
          task_id: "task-1",
          lease_epoch: "1",
          record,
        }], rowCount: 1 };
      }
      if (sql.includes("extract(epoch")) {
        return { rows: [{ now_ms: "2000" }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO compute_termination_reconciliation_receipts")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM compute_termination_reconciliation_receipts") &&
          sql.includes("FOR UPDATE")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("UPDATE compute_jobs") ||
          sql.startsWith("UPDATE compute_capacity_slots")) {
        throw new Error("slot/job mutation occurred before exact receipt proof");
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const coordinator = new PostgresDistributedLeaseCoordinator(
      new PostgresDatabase(pool),
      { maxLeaseDurationMs: 5_000 },
    );
    await expect(coordinator.reconcileObservedTermination({
      version: PERSISTENT_LEASE_CLAIM_VERSION,
      slot: 1,
      holderId: "worker-1",
      taskId: "task-1",
      fencingEpoch: 4,
      lease: {
        version: "3dena.compute-lease.v1",
        leaseId: "lease-1",
        holderId: "worker-1",
        epoch: 1,
        issuedAtMs: 1_000,
        expiresAtMs: 2_000,
      },
      record,
    })).rejects.toMatchObject({ code: "RECOVERY_CONFLICT" });
    expect(pool.statements).toContain("ROLLBACK");
    expect(pool.statements.some((sql) => sql.startsWith("UPDATE compute_jobs")))
      .toBe(false);
    expect(pool.statements.some((sql) => sql.startsWith("UPDATE compute_capacity_slots")))
      .toBe(false);
  });

  it("uses PostgreSQL server time even when the host wall clock is skewed", async () => {
    const pool = new HandlerPool((sql) => {
      if (sql.includes("clock_timestamp")) {
        return { rows: [{ now_ms: "1787300123456" }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const clock = new PostgresAuthoritativeClock(new PostgresDatabase(pool));
    expect(() => clock.now()).toThrow();
    const originalNow = Date.now;
    Date.now = () => 1;
    try {
      await expect(clock.synchronize()).resolves.toBe(1_787_300_123_456);
      expect(clock.now()).toBe(1_787_300_123_456);
      expect(pool.statements).toContain(
        "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms",
      );
    } finally {
      Date.now = originalNow;
    }
  });

  it("rejects fractional PostgreSQL time values instead of rounding host-side", async () => {
    const pool = new HandlerPool((sql) => {
      if (sql.includes("clock_timestamp")) {
        return { rows: [{ now_ms: "1787300123456.789000" }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const clock = new PostgresAuthoritativeClock(new PostgresDatabase(pool));
    await expect(clock.synchronize()).rejects.toMatchObject({
      code: "DATABASE_FAILURE",
    });
    expect(() => clock.now()).toThrow();
  });

  it("ships real queue/capacity/event/approval schema without session locks or LISTEN", () => {
    const sql = readFileSync(
      new URL("../migrations/0001_persistent_compute.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("compute_capacity_slots");
    expect(sql).toContain("compute_build_approvals");
    expect(sql).toContain("compute_build_approval_events");
    expect(sql).toContain("reject_compute_build_history_mutation");
    expect(sql).toContain("compute_schema_migrations_immutable");
    expect(sql).not.toMatch(/UPDATE\s+compute_build_approvals/iu);
    expect(sql).not.toMatch(/UPDATE\s+compute_build_approval_events/iu);
    expect(sql).toContain("compute_recovery_receipts");
    expect(sql).toContain("compute_deletion_receipts");
    expect(sql).toContain("compute_events");
    expect(sql).toContain("compute_audit_events");
    expect(sql).not.toMatch(/advisory|LISTEN/iu);
  });

  it("ships append-only control-plane migration with fenced Blob and scheduler state", () => {
    const sql = readFileSync(
      new URL("../migrations/0002_persistent_control_plane.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("compute_scheduler_leases");
    expect(sql).toContain("compute_termination_reconciliation_receipts");
    expect(sql).toContain("claim_fencing_epoch");
    expect(sql).toContain("compute_blob_namespace_locks");
    expect(sql).toContain("compute_blob_orphan_intents");
    expect(sql).toContain("generation bigint NOT NULL DEFAULT 1");
    expect(sql).toContain("state IN ('intent','available','deleting','deleted')");
    expect(sql).toContain("3dena.build-approval.v2");
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+compute_schema_migrations/iu);
  });

  it("ships an append-only approval migration that preserves V1/V2 and permits signed V3", () => {
    const sql = readFileSync(
      new URL("../migrations/0003_build_approval_v3.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("3dena.build-approval.v1");
    expect(sql).toContain("3dena.build-approval.v2");
    expect(sql).toContain("3dena.build-approval.v3");
    expect(sql).toContain("compute_build_approvals_approval_check");
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+compute_schema_migrations/iu);
  });

  it("claims one queued task with server time, SKIP LOCKED, and a fencing epoch", async () => {
    const record = queuedRecord();
    const pool = new HandlerPool((sql) => {
      if (sql.includes("extract(epoch")) return { rows: [{ now_ms: "2000" }], rowCount: 1 };
      if (sql.includes("FROM compute_capacity_slots") && sql.includes("SKIP LOCKED")) {
        return { rows: [{ slot_number: 1, fencing_epoch: "7" }], rowCount: 1 };
      }
      if (sql.includes("FROM compute_jobs") && sql.includes("state = 'queued'")) {
        return { rows: [{ task_id: "task-1", record }], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const coordinator = new PostgresDistributedLeaseCoordinator(
      new PostgresDatabase(pool),
      { maxLeaseDurationMs: 5_000 },
    );
    const claim = await coordinator.claimNext({
      holderId: "fly-machine-1",
      leaseId: "lease-1",
      durationMs: 4_000,
    });
    expect(claim).toMatchObject({
      slot: 1,
      fencingEpoch: 8,
      taskId: "task-1",
      lease: { epoch: 1, issuedAtMs: 2_000, expiresAtMs: 6_000 },
      record: { state: "leased", revision: 1 },
    });
    expect(pool.statements.join("\n")).toContain("FOR UPDATE SKIP LOCKED");
    expect(pool.statements.join("\n")).toContain("clock_timestamp()");
    const slotSelection = pool.statements.find((statement) =>
      statement.includes("FROM compute_capacity_slots") && statement.includes("SKIP LOCKED"),
    );
    expect(slotSelection).toMatch(/WHERE enabled = true AND holder_id IS NULL/iu);
    expect(slotSelection).not.toMatch(/holder_id IS NULL OR expires_at/iu);
  });

  it("quarantines an expired starting attempt even when no child id was ever bound", async () => {
    const base = queuedRecord();
    const running: ComputeJobRecordV1 = {
      ...base,
      state: "starting",
      revision: 4,
      leaseEpoch: 2,
      lease: {
        version: "3dena.compute-lease.v1",
        leaseId: "lease-old",
        holderId: "machine-old",
        epoch: 2,
        issuedAtMs: 2_000,
        expiresAtMs: 3_000,
      },
      execution: {
        executionId: "execution-old",
        leaseId: "lease-old",
        leaseEpoch: 2,
        slotId: "slot-local-old",
        resultObjectKey: "results/task-1.bin",
        launchDeadlineAtMs: 2_500,
        startedAtMs: 2_000,
      },
      result: {
        version: "3dena.compute-result-publication.v1",
        object: { key: "results/task-1.bin", sha256: HASH_C, byteLength: 100 },
        leaseId: "lease-old",
        leaseEpoch: 2,
        publishedAtMs: 2_500,
      },
    };
    const storedRecords: unknown[] = [];
    const pool = new HandlerPool((sql, values) => {
      if (sql.includes("extract(epoch")) return { rows: [{ now_ms: "4000" }], rowCount: 1 };
      if (sql.includes("JOIN compute_jobs")) {
        return { rows: [{
          slot_number: 1,
          fencing_epoch: "9",
          task_id: "task-1",
          lease_epoch: "2",
          record: running,
        }], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE compute_jobs")) storedRecords.push(JSON.parse(String(values[4])));
      if (sql.startsWith("UPDATE") || sql.startsWith("INSERT")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const coordinator = new PostgresDistributedLeaseCoordinator(
      new PostgresDatabase(pool),
      { maxLeaseDurationMs: 5_000 },
    );
    await expect(coordinator.recoverExpiredClaims()).resolves.toEqual([
      expect.objectContaining({
        disposition: "quarantined",
        previousLeaseEpoch: 2,
        fencingEpoch: 9,
        terminationObserved: false,
        capacityReleased: false,
        isolated: true,
      }),
    ]);
    expect(storedRecords).toEqual([]);
    expect(pool.statements.join("\n")).toContain("quarantined_at");
    expect(pool.statements.join("\n")).not.toContain(
      "SET holder_id = NULL, task_id = NULL, lease_id = NULL",
    );
    expect(pool.statements.join("\n")).toContain("FOR UPDATE OF s, j SKIP LOCKED");
  });

  it("uses an external immutable termination observation to reconcile and re-enable an isolated slot", async () => {
    const base = queuedRecord();
    const starting: ComputeJobRecordV1 = {
      ...base,
      state: "starting",
      revision: 4,
      leaseEpoch: 2,
      lease: {
        version: "3dena.compute-lease.v1",
        leaseId: "lease-old",
        holderId: "machine-old",
        epoch: 2,
        issuedAtMs: 2_000,
        expiresAtMs: 3_000,
      },
      execution: {
        executionId: "execution-old",
        leaseId: "lease-old",
        leaseEpoch: 2,
        slotId: "slot-local-old",
        resultObjectKey: "results/task-1.bin",
        launchDeadlineAtMs: 2_500,
        startedAtMs: 2_000,
      },
    };
    const stored: ComputeJobRecordV1[] = [];
    const pool = new HandlerPool((sql, values) => {
      if (sql.includes("JOIN compute_jobs") && sql.includes("quarantined_at IS NOT NULL")) {
        return { rows: [{
          slot_number: 1,
          fencing_epoch: "10",
          task_id: "task-1",
          lease_epoch: "2",
          record: starting,
        }], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE compute_jobs")) {
        stored.push(JSON.parse(String(values[4])) as ComputeJobRecordV1);
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE compute_capacity_slots") || sql.startsWith("INSERT")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const coordinator = new PostgresDistributedLeaseCoordinator(
      new PostgresDatabase(pool),
      { maxLeaseDurationMs: 5_000 },
    );
    await expect(coordinator.reconcileQuarantinedClaim({
      slot: 1,
      recoveryFencingEpoch: 9,
      observation: {
        version: "3dena.external-termination-observation.v1",
        taskId: "task-1",
        executionId: "execution-old",
        childId: null,
        observedAtMs: 4_000,
        kind: "launch_rejected",
        providerReceiptId: "platform-receipt-1",
      },
    })).resolves.toMatchObject({
      source: "external-quarantine-reconcile",
      terminationObserved: true,
      capacityReleased: true,
      fencingEpoch: 10,
    });
    expect(stored).toEqual([expect.objectContaining({
      state: "failed",
      failure: { code: "PROCESS_START_FAILED", atMs: 4_000 },
    })]);
    expect(stored[0]?.execution).toBeUndefined();
    expect(pool.statements.join("\n")).toContain("quarantined_at = NULL");
    expect(pool.statements.join("\n")).toContain("provider_receipt_id");
  });

  it("does not release a quarantined slot when the exact termination receipt cannot be persisted", async () => {
    const base = queuedRecord();
    const starting: ComputeJobRecordV1 = {
      ...base,
      state: "starting",
      revision: 4,
      leaseEpoch: 2,
      lease: {
        version: "3dena.compute-lease.v1",
        leaseId: "lease-old",
        holderId: "machine-old",
        epoch: 2,
        issuedAtMs: 2_000,
        expiresAtMs: 3_000,
      },
      execution: {
        executionId: "execution-old",
        leaseId: "lease-old",
        leaseEpoch: 2,
        slotId: "slot-local-old",
        resultObjectKey: "results/task-1.bin",
        launchDeadlineAtMs: 2_500,
        startedAtMs: 2_000,
      },
    };
    const pool = new HandlerPool((sql) => {
      if (sql.includes("JOIN compute_jobs") && sql.includes("quarantined_at IS NOT NULL")) {
        return { rows: [{
          slot_number: 1,
          fencing_epoch: "10",
          task_id: "task-1",
          lease_epoch: "2",
          record: starting,
        }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO compute_termination_reconciliation_receipts")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM compute_termination_reconciliation_receipts") &&
          sql.includes("FOR UPDATE")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("UPDATE compute_jobs") ||
          sql.startsWith("UPDATE compute_capacity_slots")) {
        throw new Error("slot/job mutation occurred before exact receipt proof");
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const coordinator = new PostgresDistributedLeaseCoordinator(
      new PostgresDatabase(pool),
      { maxLeaseDurationMs: 5_000 },
    );
    await expect(coordinator.reconcileQuarantinedClaim({
      slot: 1,
      recoveryFencingEpoch: 9,
      observation: {
        version: "3dena.external-termination-observation.v1",
        taskId: "task-1",
        executionId: "execution-old",
        childId: null,
        observedAtMs: 4_000,
        kind: "launch_rejected",
        providerReceiptId: "platform-receipt-1",
      },
    })).rejects.toMatchObject({ code: "RECOVERY_CONFLICT" });
    expect(pool.statements).toContain("ROLLBACK");
    expect(pool.statements.some((sql) => sql.startsWith("UPDATE compute_jobs")))
      .toBe(false);
    expect(pool.statements.some((sql) => sql.startsWith("UPDATE compute_capacity_slots")))
      .toBe(false);
  });
});
