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
import {
  PostgresDatabase,
  PostgresAuthoritativeClock,
  PostgresDistributedLeaseCoordinator,
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
    } finally {
      Date.now = originalNow;
    }
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
  });

  it("replays an already-published result after lease expiry and fences the old child", async () => {
    const base = queuedRecord();
    const running: ComputeJobRecordV1 = {
      ...base,
      state: "running",
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
        childId: "child-old",
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
        disposition: "ack_replayed",
        previousLeaseEpoch: 2,
        fencingEpoch: 9,
      }),
    ]);
    expect(storedRecords).toEqual([
      expect.objectContaining({ state: "succeeded", result: running.result }),
    ]);
    expect(JSON.stringify(storedRecords[0])).not.toContain("child-old");
    expect(pool.statements.join("\n")).toContain("FOR UPDATE OF s, j SKIP LOCKED");
  });
});
