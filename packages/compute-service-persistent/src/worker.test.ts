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
import {
  DurableControlPlaneProcessSupervisor,
  PersistentComputeWorker,
} from "./worker";

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
  it("runs expired-claim recovery before every claim attempt", async () => {
    const clock = new ManualComputeClock(1_000);
    const core = new ComputeServiceCore({
      repository: new InMemoryComputeTaskRepository(),
      objectStore: new InMemoryComputeObjectStore(),
      processSupervisor: new InMemoryComputeProcessSupervisor(),
      auditSink: new InMemoryComputeAuditSink(),
      clock,
      idFactory: new SequenceComputeIdFactory(),
      maxConcurrency: 1,
      maxLeaseDurationMs: 1_000,
    });
    const calls: string[] = [];
    const coordinator: PersistentLeaseCoordinatorV1 = {
      recoverExpiredClaims: async () => {
        calls.push("recover");
        return [];
      },
      claimNext: async () => {
        calls.push("claim");
        return null;
      },
      heartbeat: async () => {
        throw new Error("Unexpected heartbeat.");
      },
      release: async () => false,
    };
    const worker = new PersistentComputeWorker({
      holderId: "recovery-worker",
      core,
      coordinator,
      leaseDurationMs: 300,
      heartbeatIntervalMs: 50,
      nextLeaseId: () => "recovery-lease",
    });

    await expect(worker.tick(new AbortController().signal)).resolves.toBe(false);
    await expect(worker.tick(new AbortController().signal)).resolves.toBe(false);
    expect(calls).toEqual(["recover", "claim", "recover", "claim"]);
  });

  it("keeps the worker loop alive after an isolated recovery failure", async () => {
    const core = new ComputeServiceCore({
      repository: new InMemoryComputeTaskRepository(),
      objectStore: new InMemoryComputeObjectStore(),
      processSupervisor: new InMemoryComputeProcessSupervisor(),
      auditSink: new InMemoryComputeAuditSink(),
      clock: new ManualComputeClock(1_000),
      idFactory: new SequenceComputeIdFactory(),
      maxConcurrency: 1,
      maxLeaseDurationMs: 1_000,
    });
    const controller = new AbortController();
    let recoveryAttempts = 0;
    let claimAttempts = 0;
    const failures: string[] = [];
    const coordinator: PersistentLeaseCoordinatorV1 = {
      recoverExpiredClaims: async () => {
        recoveryAttempts += 1;
        if (recoveryAttempts === 1) throw new Error("isolated recovery row failure");
        return [];
      },
      claimNext: async () => {
        claimAttempts += 1;
        controller.abort();
        return null;
      },
      heartbeat: async () => {
        throw new Error("Unexpected heartbeat.");
      },
      release: async () => false,
    };
    const worker = new PersistentComputeWorker({
      holderId: "resilient-worker",
      core,
      coordinator,
      leaseDurationMs: 300,
      heartbeatIntervalMs: 50,
      pollIntervalMs: 1,
      onCycleFailure: (stage) => failures.push(stage),
    });

    await expect(worker.run(controller.signal)).resolves.toBeUndefined();
    expect(recoveryAttempts).toBe(2);
    expect(claimAttempts).toBe(1);
    expect(failures).toEqual(["recovery"]);
  });

  it("retries after a heartbeat failure without abandoning the in-flight child", async () => {
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
    const input = await objectStore.putImmutable("inputs/heartbeat.bin", new Uint8Array([1]));
    await core.createTask({
      version: COMPUTE_TASK_REQUEST_VERSION,
      owner: {
        contractVersion: COMPUTE_TASK_OWNER_CONTRACT_VERSION,
        datasetHash: HASH_A,
        specHash: HASH_B,
        runId: "run-heartbeat",
        taskId: "task-heartbeat",
      },
      taskKind: "ena-model",
      input: input.descriptor,
      deadlineAtMs: 20_000,
      expiresAtMs: 30_000,
    });
    const failures: string[] = [];
    let active: PersistentLeaseClaimV1 | null = null;
    let heartbeatFailed = false;
    let released = 0;
    const coordinator: PersistentLeaseCoordinatorV1 = {
      recoverExpiredClaims: async () => [],
      claimNext: async ({ holderId, leaseId, durationMs }) => {
        if (active !== null) return null;
        const lease = await core.claimTask("task-heartbeat", { holderId, leaseId, durationMs });
        const record = await core.getTask("task-heartbeat");
        if (record === null) throw new Error("Missing heartbeat task.");
        active = {
          version: PERSISTENT_LEASE_CLAIM_VERSION,
          slot: 1,
          holderId,
          taskId: "task-heartbeat",
          fencingEpoch: 1,
          lease,
          record,
        };
        return active;
      },
      heartbeat: async () => {
        heartbeatFailed = true;
        throw new Error("isolated heartbeat failure");
      },
      release: async () => {
        released += 1;
        active = null;
        return true;
      },
    };
    const worker = new PersistentComputeWorker({
      holderId: "heartbeat-worker",
      core,
      coordinator,
      leaseDurationMs: 300,
      heartbeatIntervalMs: 10,
      pollIntervalMs: 1,
      nextLeaseId: () => "heartbeat-lease",
      onCycleFailure: (stage) => failures.push(stage),
    });

    const running = worker.tick(new AbortController().signal);
    await waitFor(() => heartbeatFailed);
    expect(supervisor.spawnCount()).toBe(1);
    expect(released).toBe(0);
    supervisor.observeTermination("child-1", {
      kind: "crashed",
      observedAtMs: clock.now(),
      exitCode: 1,
      signal: null,
    });
    await expect(running).resolves.toBe(true);
    await core.settleBackground();
    expect(supervisor.spawnCount()).toBe(1);
    expect(released).toBe(1);
    expect((await core.getTask("task-heartbeat"))?.state).toBe("failed");
    expect(failures).toEqual(["heartbeat"]);
  });

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

  it("sweeps an owned running task deadline, observes child termination, and finalizes without crashing the loop", async () => {
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
    const input = await objectStore.putImmutable("inputs/deadline.bin", new Uint8Array([1]));
    await core.createTask({
      version: COMPUTE_TASK_REQUEST_VERSION,
      owner: {
        contractVersion: COMPUTE_TASK_OWNER_CONTRACT_VERSION,
        datasetHash: HASH_A,
        specHash: HASH_B,
        runId: "run-deadline",
        taskId: "task-deadline",
      },
      taskKind: "ena-model",
      input: input.descriptor,
      deadlineAtMs: 1_500,
      expiresAtMs: 30_000,
    });
    let active: PersistentLeaseClaimV1 | null = null;
    let released = 0;
    const coordinator: PersistentLeaseCoordinatorV1 = {
      recoverExpiredClaims: async () => [],
      claimNext: async ({ holderId, leaseId, durationMs }) => {
        if (active !== null) return null;
        const lease = await core.claimTask("task-deadline", { holderId, leaseId, durationMs });
        const record = await core.getTask("task-deadline");
        if (record === null) throw new Error("Missing deadline task.");
        active = {
          version: PERSISTENT_LEASE_CLAIM_VERSION,
          slot: 1,
          holderId,
          taskId: "task-deadline",
          fencingEpoch: 1,
          lease,
          record,
        };
        return active;
      },
      heartbeat: async (claim, durationMs) => {
        const lease = await core.heartbeatLease(claim.taskId, claim.lease, durationMs);
        const record = await core.getTask(claim.taskId);
        if (record === null) throw new Error("Missing deadline task.");
        active = { ...claim, lease, record };
        return active;
      },
      release: async () => {
        released += 1;
        active = null;
        return true;
      },
    };
    const worker = new PersistentComputeWorker({
      holderId: "deadline-worker",
      core,
      coordinator,
      leaseDurationMs: 300,
      heartbeatIntervalMs: 10,
      nextLeaseId: () => "deadline-lease",
    });
    const running = worker.tick(new AbortController().signal);
    await waitFor(() => supervisor.spawnCount() === 1);
    clock.set(1_500);
    await waitFor(() => supervisor.terminationRequests("child-1").includes("deadline"));
    expect(core.capacitySnapshot().occupied).toBe(1);
    expect(released).toBe(0);
    supervisor.observeTermination("child-1", {
      kind: "terminated",
      observedAtMs: clock.now(),
      exitCode: null,
      signal: "SIGTERM",
    });
    await expect(running).resolves.toBe(true);
    await core.settleBackground();
    expect((await core.getTask("task-deadline"))?.state).toBe("timed_out");
    expect(core.capacitySnapshot().occupied).toBe(0);
    expect(released).toBe(1);
  });

  it("persists cross-runtime cancellation intent until the owning worker observes termination and releases capacity", async () => {
    const clock = new ManualComputeClock(1_000);
    const repository = new InMemoryComputeTaskRepository();
    const objectStore = new InMemoryComputeObjectStore();
    const workerSupervisor = new InMemoryComputeProcessSupervisor();
    const common = {
      repository,
      objectStore,
      auditSink: new InMemoryComputeAuditSink(),
      clock,
      idFactory: new SequenceComputeIdFactory(),
      maxConcurrency: 1,
      maxLeaseDurationMs: 1_000,
    };
    const apiCore = new ComputeServiceCore({
      ...common,
      processSupervisor: new DurableControlPlaneProcessSupervisor(),
    });
    const workerCore = new ComputeServiceCore({
      ...common,
      processSupervisor: workerSupervisor,
    });
    const input = await objectStore.putImmutable("inputs/task-cross-runtime.bin", new Uint8Array([1]));
    await apiCore.createTask({
      version: COMPUTE_TASK_REQUEST_VERSION,
      owner: {
        contractVersion: COMPUTE_TASK_OWNER_CONTRACT_VERSION,
        datasetHash: HASH_A,
        specHash: HASH_B,
        runId: "run-cross-runtime",
        taskId: "task-cross-runtime",
      },
      taskKind: "ena-model",
      input: input.descriptor,
      deadlineAtMs: 20_000,
      expiresAtMs: 30_000,
    });

    let active: PersistentLeaseClaimV1 | null = null;
    let released = 0;
    const coordinator: PersistentLeaseCoordinatorV1 = {
      recoverExpiredClaims: async () => [],
      claimNext: async ({ holderId, leaseId, durationMs }) => {
        if (active !== null) return null;
        const lease = await workerCore.claimTask("task-cross-runtime", {
          holderId,
          leaseId,
          durationMs,
        });
        const record = await workerCore.getTask("task-cross-runtime");
        if (record === null) throw new Error("Missing claimed task.");
        active = {
          version: PERSISTENT_LEASE_CLAIM_VERSION,
          slot: 1,
          holderId,
          taskId: "task-cross-runtime",
          fencingEpoch: 1,
          lease,
          record,
        };
        return active;
      },
      heartbeat: async (claim, durationMs) => {
        const lease = await workerCore.heartbeatLease(claim.taskId, claim.lease, durationMs);
        const record = await workerCore.getTask(claim.taskId);
        if (record === null) throw new Error("Missing heartbeat task.");
        active = { ...claim, lease, record };
        return active;
      },
      release: async () => {
        released += 1;
        active = null;
        return true;
      },
    };
    const worker = new PersistentComputeWorker({
      holderId: "worker-runtime",
      core: workerCore,
      coordinator,
      leaseDurationMs: 300,
      heartbeatIntervalMs: 50,
      nextLeaseId: () => "lease-cross-runtime",
    });
    const running = worker.tick(new AbortController().signal);
    await waitFor(() => workerSupervisor.spawnCount() === 1);

    await expect(apiCore.cancelTask("task-cross-runtime")).resolves.toMatchObject({
      state: "cancelling",
      pendingStopOutcome: "cancelled",
    });
    await waitFor(() =>
      workerSupervisor.terminationRequests("child-1").includes("cancelled"),
    );
    expect(workerCore.capacitySnapshot().occupied).toBe(1);
    expect(released).toBe(0);

    workerSupervisor.observeTermination("child-1", {
      kind: "terminated",
      observedAtMs: clock.now(),
      exitCode: null,
      signal: "SIGTERM",
    });
    await expect(running).resolves.toBe(true);
    await workerCore.settleBackground();
    expect((await workerCore.getTask("task-cross-runtime"))?.state).toBe("cancelled");
    expect(workerCore.capacitySnapshot().occupied).toBe(0);
    expect(released).toBe(1);
  });

  it("releases the observed distributed fence before completing process-owned object deletion", async () => {
    const clock = new ManualComputeClock(1_000);
    const repository = new InMemoryComputeTaskRepository();
    const objectStore = new InMemoryComputeObjectStore();
    const supervisor = new InMemoryComputeProcessSupervisor();
    const common = {
      repository,
      objectStore,
      auditSink: new InMemoryComputeAuditSink(),
      clock,
      idFactory: new SequenceComputeIdFactory(),
      maxConcurrency: 1,
      maxLeaseDurationMs: 1_000,
    };
    const apiCore = new ComputeServiceCore({
      ...common,
      processSupervisor: new DurableControlPlaneProcessSupervisor(),
      deferProcessOwnedDeletionCompletion: true,
    });
    const workerCore = new ComputeServiceCore({
      ...common,
      processSupervisor: supervisor,
      deferProcessOwnedDeletionCompletion: true,
    });
    const input = await objectStore.putImmutable("inputs/delete-order.bin", new Uint8Array([1]));
    const created = await apiCore.createTask({
      version: COMPUTE_TASK_REQUEST_VERSION,
      owner: {
        contractVersion: COMPUTE_TASK_OWNER_CONTRACT_VERSION,
        datasetHash: HASH_A,
        specHash: HASH_B,
        runId: "run-delete-order",
        taskId: "task-delete-order",
      },
      taskKind: "ena-model",
      input: input.descriptor,
      deadlineAtMs: 20_000,
      expiresAtMs: 30_000,
    });
    let active: PersistentLeaseClaimV1 | null = null;
    const statesAtReconcile: string[] = [];
    const coordinator: PersistentLeaseCoordinatorV1 = {
      recoverExpiredClaims: async () => [],
      claimNext: async ({ holderId, leaseId, durationMs }) => {
        const lease = await workerCore.claimTask("task-delete-order", {
          holderId,
          leaseId,
          durationMs,
        });
        const record = await workerCore.getTask("task-delete-order");
        if (record === null) throw new Error("Missing deletion-order task.");
        active = {
          version: PERSISTENT_LEASE_CLAIM_VERSION,
          slot: 1,
          holderId,
          taskId: "task-delete-order",
          fencingEpoch: 1,
          lease,
          record,
        };
        return active;
      },
      heartbeat: async (claim) => claim,
      release: async () => {
        throw new Error("Expected atomic observed-termination reconciliation.");
      },
      reconcileObservedTermination: async () => {
        const record = await workerCore.getTask("task-delete-order");
        statesAtReconcile.push(record?.state ?? "missing");
        expect(await objectStore.head(created.record.requestObjectKey)).not.toBeNull();
        active = null;
        return true;
      },
    };
    const worker = new PersistentComputeWorker({
      holderId: "delete-order-worker",
      core: workerCore,
      coordinator,
      leaseDurationMs: 300,
      heartbeatIntervalMs: 10,
      nextLeaseId: () => "delete-order-lease",
    });
    const running = worker.tick(new AbortController().signal);
    await waitFor(() => supervisor.spawnCount() === 1);
    await expect(apiCore.deleteTask("task-delete-order")).resolves.toMatchObject({
      status: "pending_termination",
    });
    supervisor.observeTermination("child-1", {
      kind: "terminated",
      observedAtMs: clock.now(),
      exitCode: null,
      signal: "SIGTERM",
    });
    await expect(running).resolves.toBe(true);
    await workerCore.settleBackground();
    expect(statesAtReconcile).toEqual(["deleting"]);
    expect((await workerCore.getTask("task-delete-order"))?.state).toBe("deleted");
    expect(await objectStore.head(created.record.requestObjectKey)).toBeNull();
  });
});
