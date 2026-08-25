import { describe, expect, it } from "vitest";

import {
  COMPUTE_TASK_OWNER_CONTRACT_VERSION,
  COMPUTE_TASK_REQUEST_VERSION,
  ComputeServiceCore,
  InMemoryComputeAuditSink,
  InMemoryComputeObjectStore,
  InMemoryComputeProcessSupervisor,
  InMemoryComputeTaskRepository,
  ManualComputeClock,
  SequenceComputeIdFactory,
} from "@3dena/compute-service-core";

import {
  PersistentTemporalTaskSweeper,
  runPersistentTemporalSweepLoop,
} from "./temporal-sweeper";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

describe("PersistentTemporalTaskSweeper", () => {
  it("schedules repeated durable sweeps and survives an isolated cycle failure", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const failures: string[] = [];
    const sweeper = {
      async sweep() {
        attempts += 1;
        if (attempts === 1) throw new Error("isolated sweep failure");
        controller.abort();
        return { examined: 0, finalizedOrUpdated: 0, failed: 0 };
      },
    };

    await expect(runPersistentTemporalSweepLoop({
      sweeper,
      signal: controller.signal,
      intervalMs: 1,
      onCycleFailure: () => failures.push("cycle"),
    })).resolves.toBeUndefined();
    expect(attempts).toBe(2);
    expect(failures).toEqual(["cycle"]);
  });

  it("continues past one task failure and finalizes the next expired queued task", async () => {
    const clock = new ManualComputeClock(1_000);
    const base = new InMemoryComputeTaskRepository();
    const objectStore = new InMemoryComputeObjectStore();
    const core = new ComputeServiceCore({
      repository: base,
      objectStore,
      processSupervisor: new InMemoryComputeProcessSupervisor(),
      auditSink: new InMemoryComputeAuditSink(),
      clock,
      idFactory: new SequenceComputeIdFactory(),
      maxConcurrency: 1,
      maxLeaseDurationMs: 1_000,
    });
    const input = await objectStore.putImmutable("inputs/temporal.bin", new Uint8Array([1]));
    await core.createTask({
      version: COMPUTE_TASK_REQUEST_VERSION,
      owner: {
        contractVersion: COMPUTE_TASK_OWNER_CONTRACT_VERSION,
        datasetHash: HASH_A,
        specHash: HASH_B,
        runId: "run-temporal",
        taskId: "task-temporal",
      },
      taskKind: "ena-model",
      input: input.descriptor,
      deadlineAtMs: 1_500,
      expiresAtMs: 5_000,
    });
    clock.set(2_000);
    const failureKinds: string[] = [];
    const sweeper = new PersistentTemporalTaskSweeper({
      source: {
        claimDue: async () => [
          { kind: "task", id: "missing-temporal" },
          { kind: "task", id: "task-temporal" },
          { kind: "http-deletion", id: "job-delete-due" },
          { kind: "http-reconcile", id: "job-terminal-due" },
          { kind: "http-purge", id: "job-expired-clean" },
        ],
      },
      core,
      reconcileHttpDeletion: async (jobId) => jobId === "job-delete-due",
      reconcileHttpJob: async (jobId) => jobId === "job-terminal-due",
      purgeHttpJob: async (jobId) => jobId === "job-expired-clean",
      onTaskFailure: () => failureKinds.push("task"),
    });

    await expect(sweeper.sweep()).resolves.toEqual({
      examined: 5,
      finalizedOrUpdated: 4,
      failed: 1,
    });
    expect((await core.getTask("task-temporal"))?.state).toBe("timed_out");
    expect(failureKinds).toEqual(["task"]);
  });

  it("deletes expired core tasks so a full temporal page cannot starve later work", async () => {
    const taskLimit = 50;
    const clock = new ManualComputeClock(1_000);
    const repository = new InMemoryComputeTaskRepository();
    const objectStore = new InMemoryComputeObjectStore();
    const core = new ComputeServiceCore({
      repository,
      objectStore,
      processSupervisor: new InMemoryComputeProcessSupervisor(),
      auditSink: new InMemoryComputeAuditSink(),
      clock,
      idFactory: new SequenceComputeIdFactory(),
      maxConcurrency: 1,
      maxLeaseDurationMs: 1_000,
    });
    const input = await objectStore.putImmutable(
      "inputs/expired-page.bin",
      new Uint8Array([1]),
    );
    const taskIds = Array.from(
      { length: taskLimit + 1 },
      (_, index) => `task-expired-${String(index).padStart(3, "0")}`,
    );
    for (const taskId of taskIds) {
      await core.createTask({
        version: COMPUTE_TASK_REQUEST_VERSION,
        owner: {
          contractVersion: COMPUTE_TASK_OWNER_CONTRACT_VERSION,
          datasetHash: HASH_A,
          specHash: HASH_B,
          runId: `run-${taskId}`,
          taskId,
        },
        taskKind: "ena-model",
        input: input.descriptor,
        deadlineAtMs: 1_500,
        expiresAtMs: 2_000,
      });
    }
    clock.set(2_000);
    for (const taskId of taskIds) {
      expect((await core.sweepTask(taskId)).state).toBe("expired");
    }
    const sweeper = new PersistentTemporalTaskSweeper({
      source: {
        claimDue: async () => (await repository.list())
          .filter((record) => record.state !== "deleted")
          .sort((left, right) => left.owner.taskId.localeCompare(right.owner.taskId))
          .slice(0, taskLimit)
          .map((record) => ({ kind: "task" as const, id: record.owner.taskId })),
      },
      core,
    });

    await expect(sweeper.sweep()).resolves.toEqual({
      examined: taskLimit,
      finalizedOrUpdated: taskLimit,
      failed: 0,
    });
    expect((await core.getTask(taskIds.at(-1)!))?.state).toBe("expired");
    await expect(sweeper.sweep()).resolves.toEqual({
      examined: 1,
      finalizedOrUpdated: 1,
      failed: 0,
    });
    expect((await repository.list()).every((record) => record.state === "deleted"))
      .toBe(true);
  });
});
