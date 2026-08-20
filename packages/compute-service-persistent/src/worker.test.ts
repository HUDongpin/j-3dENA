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
  type LeaseTokenV1,
} from "@3dena/compute-service-core";

import {
  PERSISTENT_LEASE_CLAIM_VERSION,
  type PersistentLeaseClaimV1,
  type PersistentLeaseCoordinatorV1,
} from "./contracts";
import { PersistentComputeWorker } from "./worker";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Condition not observed.");
}

describe("PersistentComputeWorker", () => {
  it("polls, executes, observes terminal publication, then releases the fenced slot", async () => {
    const clock = new ManualComputeClock(1_000);
    const repository = new InMemoryComputeTaskRepository();
    const objectStore = new InMemoryComputeObjectStore();
    const supervisor = new InMemoryComputeProcessSupervisor();
    const core = new ComputeServiceCore({
      repository,
      objectStore,
      processSupervisor: supervisor,
      auditSink: new InMemoryComputeAuditSink(),
      clock,
      idFactory: new SequenceComputeIdFactory(),
      maxConcurrency: 1,
      maxLeaseDurationMs: 1_000,
    });
    const input = await objectStore.putImmutable("inputs/task-1.bin", new Uint8Array([1]));
    await core.createTask({
      version: COMPUTE_TASK_REQUEST_VERSION,
      owner: {
        contractVersion: COMPUTE_TASK_OWNER_CONTRACT_VERSION,
        datasetHash: HASH_A,
        specHash: HASH_B,
        runId: "run-1",
        taskId: "task-1",
      },
      taskKind: "ena-model",
      input: input.descriptor,
      deadlineAtMs: 20_000,
      expiresAtMs: 30_000,
    });

    let active: PersistentLeaseClaimV1 | null = null;
    let released = 0;
    const coordinator: PersistentLeaseCoordinatorV1 = {
      claimNext: async ({ holderId, leaseId, durationMs }) => {
        if (active !== null) return null;
        const lease = await core.claimTask("task-1", { holderId, leaseId, durationMs });
        const record = await core.getTask("task-1");
        if (record === null) throw new Error("Missing claimed task.");
        active = {
          version: PERSISTENT_LEASE_CLAIM_VERSION,
          slot: 1,
          holderId,
          taskId: "task-1",
          fencingEpoch: 1,
          lease,
          record,
        };
        return active;
      },
      heartbeat: async (claim, durationMs) => {
        const lease: LeaseTokenV1 = await core.heartbeatLease(claim.taskId, claim.lease, durationMs);
        const record = await core.getTask(claim.taskId);
        if (record === null) throw new Error("Missing heartbeat task.");
        active = { ...claim, lease, record };
        return active;
      },
      release: async () => {
        released += 1;
        active = null;
        return true;
      },
      recoverExpiredClaims: async () => [],
    };
    const worker = new PersistentComputeWorker({
      holderId: "fly-machine-1",
      core,
      coordinator,
      leaseDurationMs: 300,
      heartbeatIntervalMs: 50,
      nextLeaseId: () => "lease-1",
    });
    const controller = new AbortController();
    const running = worker.tick(controller.signal);
    await waitFor(() => supervisor.spawnCount() === 1);
    const context = supervisor.context("child-1");
    const result = await objectStore.putImmutable(
      context.resultObjectKey,
      new TextEncoder().encode("validated result"),
    );
    const lease = (active as PersistentLeaseClaimV1 | null)?.lease;
    if (lease === undefined) throw new Error("Missing active lease.");
    await core.publishResult("task-1", lease, result.descriptor);
    supervisor.observeTermination("child-1", {
      kind: "completed",
      observedAtMs: clock.now(),
      exitCode: 0,
      signal: null,
    });
    await expect(running).resolves.toBe(true);
    await core.settleBackground();
    expect((await core.getTask("task-1"))?.state).toBe("succeeded");
    expect(released).toBe(1);
  });
});
