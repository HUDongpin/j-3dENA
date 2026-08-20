import { describe, expect, it } from "vitest";

import {
  COMPUTE_TASK_OWNER_CONTRACT_VERSION,
  COMPUTE_TASK_REQUEST_VERSION,
  MAX_OPERATIONAL_FAILURE_RECORDS,
  ComputeServiceCore,
  InMemoryComputeAuditSink,
  InMemoryComputeObjectStore,
  InMemoryComputeProcessSupervisor,
  InMemoryComputeTaskRepository,
  ManualComputeClock,
  SequenceComputeIdFactory,
  type ComputeJobRecordV1,
  type ComputeAuditSink,
  type ComputeClock,
  type ComputeTaskRepository,
  type ComputeTaskRequestV1,
  type ImmutableObjectDescriptor,
  type LeaseTokenV1,
  type RepositoryCompareAndSetResult,
  type RepositoryCreateResult,
} from "./index";

interface Harness {
  readonly service: ComputeServiceCore;
  readonly repository: InMemoryComputeTaskRepository;
  readonly objectStore: InMemoryComputeObjectStore;
  readonly supervisor: InMemoryComputeProcessSupervisor;
  readonly audit: InMemoryComputeAuditSink;
  readonly clock: ManualComputeClock;
}

function harness(maxConcurrency = 2): Harness {
  const repository = new InMemoryComputeTaskRepository();
  const objectStore = new InMemoryComputeObjectStore();
  const supervisor = new InMemoryComputeProcessSupervisor();
  const audit = new InMemoryComputeAuditSink();
  const clock = new ManualComputeClock(1_000);
  const service = new ComputeServiceCore({
    repository,
    objectStore,
    processSupervisor: supervisor,
    auditSink: audit,
    clock,
    idFactory: new SequenceComputeIdFactory(),
    maxConcurrency,
    maxLeaseDurationMs: 10_000,
  });
  return { service, repository, objectStore, supervisor, audit, clock };
}

async function requestFor(
  target: Pick<Harness, "objectStore" | "clock">,
  taskId: string,
  options: Readonly<{
    runId?: string;
    deadlineOffsetMs?: number;
    expiryOffsetMs?: number;
  }> = {},
): Promise<{
  readonly request: ComputeTaskRequestV1;
  readonly input: ImmutableObjectDescriptor;
}> {
  const bytes = new TextEncoder().encode(`private-input-${taskId}`);
  const input = (
    await target.objectStore.putImmutable(`inputs/${taskId}.bin`, bytes)
  ).descriptor;
  const deadlineOffsetMs = options.deadlineOffsetMs ?? 1_000;
  const expiryOffsetMs = options.expiryOffsetMs ?? 2_000;
  return {
    input,
    request: {
      version: COMPUTE_TASK_REQUEST_VERSION,
      owner: {
        contractVersion: COMPUTE_TASK_OWNER_CONTRACT_VERSION,
        datasetHash: "a".repeat(64),
        specHash: "b".repeat(64),
        runId: options.runId ?? `run-${taskId}`,
        taskId,
      },
      taskKind: "jena-analysis",
      input,
      deadlineAtMs: target.clock.now() + deadlineOffsetMs,
      expiresAtMs: target.clock.now() + expiryOffsetMs,
    },
  };
}

class PreferredWinnerBarrierRepository implements ComputeTaskRepository {
  readonly #delegate = new InMemoryComputeTaskRepository();
  readonly #preferredRunId: string;
  readonly #participants: number;
  #arrivals = 0;
  readonly #allArrived: Promise<void>;
  readonly #releaseAll: () => void;
  readonly #winnerStored: Promise<void>;
  readonly #releaseLosers: () => void;

  constructor(preferredRunId: string, participants: number) {
    this.#preferredRunId = preferredRunId;
    this.#participants = participants;
    let releaseAll!: () => void;
    this.#allArrived = new Promise<void>((resolve) => {
      releaseAll = resolve;
    });
    this.#releaseAll = releaseAll;
    let releaseLosers!: () => void;
    this.#winnerStored = new Promise<void>((resolve) => {
      releaseLosers = resolve;
    });
    this.#releaseLosers = releaseLosers;
  }

  get(taskId: string): Promise<ComputeJobRecordV1 | null> {
    return this.#delegate.get(taskId);
  }

  list(): Promise<readonly ComputeJobRecordV1[]> {
    return this.#delegate.list();
  }

  async createIfAbsent(
    record: ComputeJobRecordV1,
  ): Promise<RepositoryCreateResult> {
    this.#arrivals += 1;
    if (this.#arrivals === this.#participants) this.#releaseAll();
    await this.#allArrived;
    if (record.owner.runId === this.#preferredRunId) {
      const result = await this.#delegate.createIfAbsent(record);
      this.#releaseLosers();
      return result;
    }
    await this.#winnerStored;
    return this.#delegate.createIfAbsent(record);
  }

  compareAndSet(
    taskId: string,
    expectedRevision: number,
    next: ComputeJobRecordV1,
  ): Promise<RepositoryCompareAndSetResult> {
    return this.#delegate.compareAndSet(taskId, expectedRevision, next);
  }
}

class SystemComputeClock implements ComputeClock {
  now(): number {
    return Date.now();
  }
}

async function launchDeadlineTarget(): Promise<{
  readonly service: ComputeServiceCore;
  readonly supervisor: InMemoryComputeProcessSupervisor;
  readonly lease: LeaseTokenV1;
  readonly taskId: string;
}> {
  const taskId = "task-launch-deadline";
  const repository = new InMemoryComputeTaskRepository();
  const objectStore = new InMemoryComputeObjectStore();
  const supervisor = new InMemoryComputeProcessSupervisor();
  const clock = new SystemComputeClock();
  const service = new ComputeServiceCore({
    repository,
    objectStore,
    processSupervisor: supervisor,
    auditSink: new InMemoryComputeAuditSink(),
    clock,
    idFactory: new SequenceComputeIdFactory(),
    maxConcurrency: 1,
    maxLeaseDurationMs: 10_000,
    maxProcessLaunchDurationMs: 10,
  });
  const input = (
    await objectStore.putImmutable(
      `inputs/${taskId}.bin`,
      new TextEncoder().encode("launch-deadline-input"),
    )
  ).descriptor;
  const now = clock.now();
  await service.createTask({
    version: COMPUTE_TASK_REQUEST_VERSION,
    owner: {
      contractVersion: COMPUTE_TASK_OWNER_CONTRACT_VERSION,
      datasetHash: "a".repeat(64),
      specHash: "b".repeat(64),
      runId: "run-launch-deadline",
      taskId,
    },
    taskKind: "jena-analysis",
    input,
    deadlineAtMs: now + 10_000,
    expiresAtMs: now + 20_000,
  });
  const lease = await service.claimTask(taskId, {
    leaseId: "lease-launch-deadline",
    holderId: "worker-1",
    durationMs: 5_000,
  });
  supervisor.hangNextSpawn();
  return { service, supervisor, lease, taskId };
}

async function create(
  target: Harness,
  taskId: string,
  options: Parameters<typeof requestFor>[2] = {},
): Promise<{
  readonly request: ComputeTaskRequestV1;
  readonly input: ImmutableObjectDescriptor;
  readonly record: ComputeJobRecordV1;
}> {
  const fixture = await requestFor(target, taskId, options);
  const created = await target.service.createTask(fixture.request);
  return { ...fixture, record: created.record };
}

async function start(
  target: Harness,
  taskId: string,
  leaseId: string,
  durationMs = 500,
): Promise<{
  readonly lease: LeaseTokenV1;
  readonly record: ComputeJobRecordV1;
  readonly childId: string;
}> {
  const lease = await target.service.claimTask(taskId, {
    leaseId,
    holderId: "worker-1",
    durationMs,
  });
  const record = await target.service.executeTask(taskId, lease);
  const childId = record.execution?.childId;
  if (childId === undefined) throw new Error("Test process did not start.");
  return { lease, record, childId };
}

async function putAttemptResult(
  target: Harness,
  record: ComputeJobRecordV1,
  value: string,
): Promise<ImmutableObjectDescriptor> {
  const key = record.execution?.resultObjectKey;
  if (key === undefined) throw new Error("Test execution lacks a result key.");
  return (
    await target.objectStore.putImmutable(key, new TextEncoder().encode(value))
  ).descriptor;
}

async function allowTerminationHandlerToRun(
  condition: () => boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Termination handler did not settle in time.");
}

describe("ComputeServiceCore", () => {
  it("freezes immutable requests and idempotently creates, executes, and CAS-publishes", async () => {
    const target = harness(1);
    const fixture = await requestFor(target, "task-alpha");
    const first = await target.service.createTask(fixture.request);
    expect(first.created).toBe(true);
    expect(Object.isFrozen(first.record.request)).toBe(true);
    expect(Object.isFrozen(first.record.request.owner)).toBe(true);

    const mutableOwner = fixture.request.owner as { runId: string };
    mutableOwner.runId = "mutated-after-create";
    expect(first.record.request.owner.runId).toBe("run-task-alpha");

    const replayFixture = await requestFor(target, "task-alpha");
    const replay = await target.service.createTask(replayFixture.request);
    expect(replay.created).toBe(false);
    expect(replay.record.revision).toBe(0);
    await expect(
      target.service.createTask({
        ...replayFixture.request,
        taskKind: "different-task-kind",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      target.service.createTask({
        ...replayFixture.request,
        rawRows: ["must-not-enter-the-request-envelope"],
      } as ComputeTaskRequestV1),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    const collidingInput = (
      await target.objectStore.putImmutable(
        `compute-results/${"0".repeat(64)}/1-collision.bin`,
        new TextEncoder().encode("must-not-be-owned-as-input"),
      )
    ).descriptor;
    await expect(
      target.service.createTask({
        ...replayFixture.request,
        owner: {
          ...replayFixture.request.owner,
          taskId: "task-owned-prefix",
          runId: "run-owned-prefix",
        },
        input: collidingInput,
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    const lease = await target.service.claimTask("task-alpha", {
      leaseId: "lease-alpha",
      holderId: "worker-1",
      durationMs: 500,
    });
    const [running, replayedExecution] = await Promise.all([
      target.service.executeTask("task-alpha", lease),
      target.service.executeTask("task-alpha", lease),
    ]);
    expect(target.supervisor.spawnCount()).toBe(1);
    expect(replayedExecution.execution).toEqual(running.execution);

    const result = await putAttemptResult(target, running, "result-alpha");
    const published = await target.service.publishResult("task-alpha", lease, result);
    const replayedPublication = await target.service.publishResult(
      "task-alpha",
      lease,
      result,
    );
    expect(replayedPublication.revision).toBe(published.revision);

    const childId = running.execution?.childId;
    if (childId === undefined) throw new Error("Missing child.");
    target.supervisor.observeTermination(childId, {
      kind: "completed",
      observedAtMs: target.clock.now(),
      exitCode: 0,
      signal: null,
    });
    await target.service.settleBackground();
    expect((await target.service.getTask("task-alpha"))?.state).toBe("succeeded");
    expect(target.service.capacitySnapshot().occupied).toBe(0);

    const eventJson = JSON.stringify(target.audit.events());
    expect(eventJson).not.toContain("datasetHash");
    expect(eventJson).not.toContain("specHash");
    expect(eventJson).not.toContain("run-task-alpha");
    expect(eventJson).not.toContain("task-alpha");
    expect(eventJson).not.toContain("inputs/task-alpha.bin");
    expect(eventJson).not.toContain("private-input-task-alpha");
    const allowedEventKeys = new Set([
      "version",
      "kind",
      "atMs",
      "taskRef",
      "state",
      "reasonCode",
      "leaseEpoch",
      "occupiedSlots",
      "capacityLimit",
    ]);
    for (const event of target.audit.events()) {
      expect(Object.keys(event).every((key) => allowedEventKeys.has(key))).toBe(true);
    }
  });

  it("cleans new and shared loser objects after a barrier-forced immutable create race", async () => {
    const repository = new PreferredWinnerBarrierRepository(
      "run-create-race-winner",
      3,
    );
    const objectStore = new InMemoryComputeObjectStore();
    const clock = new ManualComputeClock(1_000);
    const service = new ComputeServiceCore({
      repository,
      objectStore,
      processSupervisor: new InMemoryComputeProcessSupervisor(),
      auditSink: new InMemoryComputeAuditSink(),
      clock,
      idFactory: new SequenceComputeIdFactory(),
      maxConcurrency: 1,
    });
    const fixture = await requestFor({ objectStore, clock }, "task-create-race");
    const loser: ComputeTaskRequestV1 = {
      ...fixture.request,
      owner: { ...fixture.request.owner, runId: "run-create-race-loser" },
    };
    const winner: ComputeTaskRequestV1 = {
      ...fixture.request,
      owner: { ...fixture.request.owner, runId: "run-create-race-winner" },
    };
    const outcomes = await Promise.allSettled([
      service.createTask(loser),
      service.createTask(loser),
      service.createTask(winner),
    ]);
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(2);
    for (const rejected of outcomes.filter(({ status }) => status === "rejected")) {
      expect(rejected).toMatchObject({
        reason: { code: "IDEMPOTENCY_CONFLICT" },
      });
    }
    const winningRecord = await service.getTask("task-create-race");
    if (winningRecord === null) throw new Error("Concurrent create produced no winner.");
    expect(winningRecord.owner.runId).toBe("run-create-race-winner");
    expect(
      objectStore
        .keys()
        .filter((key) => key.startsWith("compute-requests/")),
    ).toEqual([winningRecord.requestObjectKey]);
  });

  it("keeps a cancelled slot until observed termination and safely rapid-restarts", async () => {
    const target = harness(1);
    await create(target, "task-old", { runId: "run-old" });
    const old = await start(target, "task-old", "lease-old");
    const staleObject = await putAttemptResult(target, old.record, "stale-result");

    target.audit.failNext("stop_requested");
    const firstCancel = await target.service.cancelTask("task-old");
    const duplicateCancel = await target.service.cancelTask("task-old");
    expect(firstCancel.state).toBe("cancelling");
    expect(duplicateCancel.revision).toBe(firstCancel.revision);
    expect(target.supervisor.terminationRequests(old.childId)).toEqual(["cancelled"]);
    expect(target.service.operationalFailureCount()).toBe(1);
    expect(target.service.capacitySnapshot().occupied).toBe(1);
    await expect(
      target.service.publishResult("task-old", old.lease, staleObject),
    ).rejects.toMatchObject({ code: "STALE_LEASE" });

    await create(target, "task-new", { runId: "run-new" });
    const newLease = await target.service.claimTask("task-new", {
      leaseId: "lease-new",
      holderId: "worker-1",
      durationMs: 500,
    });
    await expect(
      target.service.executeTask("task-new", newLease),
    ).rejects.toMatchObject({ code: "CAPACITY_EXHAUSTED" });

    target.supervisor.observeTermination(old.childId, {
      kind: "terminated",
      observedAtMs: target.clock.now(),
      exitCode: null,
      signal: "SIGTERM",
    });
    await expect(target.service.settleBackground()).rejects.toMatchObject({
      code: "REPOSITORY_CONFLICT",
    });
    expect((await target.service.getTask("task-old"))?.state).toBe("cancelled");
    expect(target.service.capacitySnapshot().occupied).toBe(0);

    const restarted = await target.service.executeTask("task-new", newLease);
    const restartedResult = await putAttemptResult(target, restarted, "fresh-result");
    await target.service.publishResult("task-new", newLease, restartedResult);
    const restartedChild = restarted.execution?.childId;
    if (restartedChild === undefined) throw new Error("Missing restarted child.");
    target.supervisor.observeTermination(restartedChild, {
      kind: "completed",
      observedAtMs: target.clock.now(),
      exitCode: 0,
      signal: null,
    });
    await target.service.settleBackground();
    expect((await target.service.getTask("task-new"))?.state).toBe("succeeded");
  });

  it("enforces maximum concurrency plus one without early slot release", async () => {
    const target = harness(2);
    await create(target, "task-cap-a");
    await create(target, "task-cap-b");
    await create(target, "task-cap-c");
    const first = await start(target, "task-cap-a", "lease-cap-a");
    const second = await start(target, "task-cap-b", "lease-cap-b");
    const thirdLease = await target.service.claimTask("task-cap-c", {
      leaseId: "lease-cap-c",
      holderId: "worker-1",
      durationMs: 500,
    });

    await expect(
      target.service.executeTask("task-cap-c", thirdLease),
    ).rejects.toMatchObject({ code: "CAPACITY_EXHAUSTED" });
    await target.service.cancelTask("task-cap-a");
    expect(target.service.capacitySnapshot().occupied).toBe(2);
    await expect(
      target.service.executeTask("task-cap-c", thirdLease),
    ).rejects.toMatchObject({ code: "CAPACITY_EXHAUSTED" });

    target.supervisor.observeTermination(first.childId, {
      kind: "terminated",
      observedAtMs: target.clock.now(),
      exitCode: null,
      signal: "SIGTERM",
    });
    await allowTerminationHandlerToRun(
      () => target.service.capacitySnapshot().occupied === 1,
    );
    const third = await target.service.executeTask("task-cap-c", thirdLease);
    expect(target.service.capacitySnapshot().occupied).toBe(2);

    target.supervisor.observeTermination(second.childId, {
      kind: "crashed",
      observedAtMs: target.clock.now(),
      exitCode: 1,
      signal: null,
    });
    const thirdChild = third.execution?.childId;
    if (thirdChild === undefined) throw new Error("Missing third child.");
    target.supervisor.observeTermination(thirdChild, {
      kind: "terminated",
      observedAtMs: target.clock.now(),
      exitCode: null,
      signal: "SIGTERM",
    });
    await target.service.settleBackground();
    expect(target.service.capacitySnapshot().occupied).toBe(0);
  });

  it("holds timed-out slots until termination, records crashes, and does not leak failed starts", async () => {
    const target = harness(1);
    await create(target, "task-timeout", {
      deadlineOffsetMs: 100,
      expiryOffsetMs: 200,
    });
    const timed = await start(target, "task-timeout", "lease-timeout", 100);
    target.clock.advance(100);
    const stopping = await target.service.sweepTask("task-timeout");
    expect(stopping.state).toBe("cancelling");
    expect(stopping.pendingStopOutcome).toBe("timed_out");
    expect(target.service.capacitySnapshot().occupied).toBe(1);
    expect(target.supervisor.terminationRequests(timed.childId)).toEqual(["deadline"]);

    target.objectStore.failNextDelete();
    target.supervisor.observeTermination(timed.childId, {
      kind: "terminated",
      observedAtMs: target.clock.now(),
      exitCode: null,
      signal: "SIGKILL",
    });
    await expect(target.service.settleBackground()).rejects.toMatchObject({
      code: "REPOSITORY_CONFLICT",
    });
    expect((await target.service.getTask("task-timeout"))?.state).toBe("timed_out");
    expect(target.service.capacitySnapshot().occupied).toBe(0);

    await create(target, "task-late-completion", {
      deadlineOffsetMs: 100,
      expiryOffsetMs: 200,
    });
    const late = await start(
      target,
      "task-late-completion",
      "lease-late-completion",
      100,
    );
    const lateResult = await putAttemptResult(target, late.record, "too-late");
    await target.service.publishResult(
      "task-late-completion",
      late.lease,
      lateResult,
    );
    target.clock.advance(101);
    target.supervisor.observeTermination(late.childId, {
      kind: "completed",
      observedAtMs: target.clock.now(),
      exitCode: 0,
      signal: null,
    });
    await target.service.settleBackground();
    expect((await target.service.getTask("task-late-completion"))?.state).toBe(
      "timed_out",
    );

    await create(target, "task-crash");
    const crashed = await start(target, "task-crash", "lease-crash");
    target.supervisor.observeTermination(crashed.childId, {
      kind: "crashed",
      observedAtMs: target.clock.now(),
      exitCode: 137,
      signal: "SIGKILL",
    });
    await target.service.settleBackground();
    const crashRecord = await target.service.getTask("task-crash");
    expect(crashRecord?.state).toBe("failed");
    expect(crashRecord?.failure?.code).toBe("PROCESS_CRASHED");

    await create(target, "task-start-fail");
    const failedLease = await target.service.claimTask("task-start-fail", {
      leaseId: "lease-start-fail",
      holderId: "worker-1",
      durationMs: 500,
    });
    target.supervisor.failNextSpawn();
    const failedStart = await target.service.executeTask(
      "task-start-fail",
      failedLease,
    );
    expect(failedStart.state).toBe("failed");
    expect(failedStart.failure?.code).toBe("PROCESS_START_FAILED");
    expect(target.service.capacitySnapshot().occupied).toBe(0);
  });

  it("heartbeats leases, requeues only after expired-child termination, and rejects stale publication", async () => {
    const target = harness(1);
    await create(target, "task-lease", {
      deadlineOffsetMs: 1_000,
      expiryOffsetMs: 2_000,
    });
    const first = await start(target, "task-lease", "lease-first", 100);
    const staleObject = await putAttemptResult(target, first.record, "old-attempt");
    target.clock.advance(50);
    const heartbeat = await target.service.heartbeatLease(
      "task-lease",
      first.lease,
      100,
    );
    expect(heartbeat.expiresAtMs).toBe(target.clock.now() + 100);
    target.clock.advance(101);

    const expired = await target.service.sweepTask("task-lease");
    expect(expired.state).toBe("cancelling");
    expect(expired.pendingStopOutcome).toBe("queued");
    expect(target.service.capacitySnapshot().occupied).toBe(1);
    await expect(
      target.service.publishResult("task-lease", heartbeat, staleObject),
    ).rejects.toMatchObject({ code: "STALE_LEASE" });

    target.supervisor.observeTermination(first.childId, {
      kind: "terminated",
      observedAtMs: target.clock.now(),
      exitCode: null,
      signal: "SIGTERM",
    });
    await target.service.settleBackground();
    expect((await target.service.getTask("task-lease"))?.state).toBe("queued");

    const secondLease = await target.service.claimTask("task-lease", {
      leaseId: "lease-second",
      holderId: "worker-2",
      durationMs: 300,
    });
    expect(secondLease.epoch).toBe(first.lease.epoch + 1);
    const second = await target.service.executeTask("task-lease", secondLease);
    await expect(
      target.service.publishResult("task-lease", first.lease, staleObject),
    ).rejects.toMatchObject({ code: "STALE_LEASE" });
    const freshObject = await putAttemptResult(target, second, "new-attempt");
    await target.service.publishResult("task-lease", secondLease, freshObject);
    const secondChild = second.execution?.childId;
    if (secondChild === undefined) throw new Error("Missing second child.");
    target.supervisor.observeTermination(secondChild, {
      kind: "completed",
      observedAtMs: target.clock.now(),
      exitCode: 0,
      signal: null,
    });
    await target.service.settleBackground();
    expect((await target.service.getTask("task-lease"))?.state).toBe("succeeded");
  });

  it("applies TTL expiry to active work only after observed termination", async () => {
    const target = harness(1);
    await create(target, "task-ttl", {
      deadlineOffsetMs: 100,
      expiryOffsetMs: 100,
    });
    const running = await start(target, "task-ttl", "lease-ttl", 100);
    target.clock.advance(100);
    const stopping = await target.service.sweepTask("task-ttl");
    expect(stopping.state).toBe("cancelling");
    expect(stopping.pendingStopOutcome).toBe("expired");
    expect(target.supervisor.terminationRequests(running.childId)).toEqual([
      "ttl_expired",
    ]);
    expect(target.service.capacitySnapshot().occupied).toBe(1);

    target.supervisor.observeTermination(running.childId, {
      kind: "terminated",
      observedAtMs: target.clock.now(),
      exitCode: null,
      signal: "SIGTERM",
    });
    await target.service.settleBackground();
    expect((await target.service.getTask("task-ttl"))?.state).toBe("expired");
    expect(target.service.capacitySnapshot().occupied).toBe(0);
  });

  it("deletes only after child termination and returns an idempotent deletion receipt", async () => {
    const target = harness(1);
    const fixture = await create(target, "task-delete");
    const running = await start(target, "task-delete", "lease-delete");
    const result = await putAttemptResult(target, running.record, "delete-me");
    await target.service.publishResult("task-delete", running.lease, result);
    const requestObjectKey = fixture.record.requestObjectKey;

    const pending = await target.service.deleteTask("task-delete");
    const replayedPending = await target.service.deleteTask("task-delete");
    const cancelAfterDelete = await target.service.cancelTask("task-delete");
    expect(pending.status).toBe("pending_termination");
    expect(replayedPending.record.revision).toBe(pending.record.revision);
    expect(cancelAfterDelete.revision).toBe(pending.record.revision);
    expect(cancelAfterDelete.pendingStopOutcome).toBe("deleted");
    expect(target.service.capacitySnapshot().occupied).toBe(1);
    expect(await target.objectStore.head(requestObjectKey)).not.toBeNull();
    expect(await target.objectStore.head(result.key)).not.toBeNull();
    expect(target.supervisor.terminationRequests(running.childId)).toEqual([
      "deletion",
    ]);

    target.supervisor.observeTermination(running.childId, {
      kind: "terminated",
      observedAtMs: target.clock.now(),
      exitCode: null,
      signal: "SIGTERM",
    });
    await target.service.settleBackground();
    const deleted = await target.service.deleteTask("task-delete");
    const replayed = await target.service.deleteTask("task-delete");
    expect(deleted.status).toBe("deleted");
    expect(deleted.receipt).toEqual(replayed.receipt);
    expect(deleted.receipt).toMatchObject({
      requestObjectAbsent: true,
      ownedResultObjectsAbsent: true,
      inputObjectDeletionRequested: false,
      inputObjectObservedPresentAtCompletion: true,
      ownedResultObjectCount: 1,
    });
    expect(await target.objectStore.head(requestObjectKey)).toBeNull();
    expect(await target.objectStore.head(result.key)).toBeNull();
    expect(await target.objectStore.head(fixture.input.key)).toEqual(fixture.input);
    expect(target.service.capacitySnapshot().occupied).toBe(0);
  });

  it("bounds 10,000 hostile operational failures to allowlisted secret-free records", async () => {
    const repository = new InMemoryComputeTaskRepository();
    const objectStore = new InMemoryComputeObjectStore();
    const clock = new ManualComputeClock(5_000);
    const secret = "participant-p1-secret-object-key-input/private.bin";
    const hostileAudit: ComputeAuditSink = {
      emit() {
        throw Object.assign(new Error(secret), {
          cause: { secret, stack: `stack:${secret}` },
          objectKey: secret,
        });
      },
    };
    const service = new ComputeServiceCore({
      repository,
      objectStore,
      processSupervisor: new InMemoryComputeProcessSupervisor(),
      auditSink: hostileAudit,
      clock,
      idFactory: new SequenceComputeIdFactory(),
      maxConcurrency: 1,
    });
    const input = (
      await objectStore.putImmutable(
        "inputs/operational-failure.bin",
        new TextEncoder().encode("private scientific input"),
      )
    ).descriptor;
    const request: ComputeTaskRequestV1 = {
      version: COMPUTE_TASK_REQUEST_VERSION,
      owner: {
        contractVersion: COMPUTE_TASK_OWNER_CONTRACT_VERSION,
        datasetHash: "a".repeat(64),
        specHash: "b".repeat(64),
        runId: "run-operational-failure",
        taskId: "task-operational-failure",
      },
      taskKind: "jena-analysis",
      input,
      deadlineAtMs: 6_000,
      expiresAtMs: 7_000,
    };

    for (let index = 0; index < 10_000; index += 1) {
      await service.createTask(request);
    }
    const snapshot = service.operationalFailureSnapshot();
    expect(snapshot.total).toBe(10_000);
    expect(snapshot.dropped).toBe(10_000 - MAX_OPERATIONAL_FAILURE_RECORDS);
    expect(snapshot.records).toHaveLength(MAX_OPERATIONAL_FAILURE_RECORDS);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.records)).toBe(true);
    for (const record of snapshot.records) {
      expect(Object.keys(record).sort()).toEqual([
        "atMs",
        "code",
        "component",
        "version",
      ]);
      expect(record).toMatchObject({
        component: "audit_sink",
        code: "AUDIT_EMIT_REJECTED",
        atMs: 5_000,
      });
    }
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("message");
    expect(serialized).not.toContain("stack");
    expect(serialized).not.toContain("cause");
    expect(serialized).not.toContain("objectKey");

    await expect(service.settleBackground()).rejects.toMatchObject({
      code: "REPOSITORY_CONFLICT",
    });
    expect(service.operationalFailureSnapshot()).toMatchObject({
      total: 0,
      dropped: 0,
      records: [],
    });
  });

  it("aborts an unsettled launch at its versioned deadline without releasing capacity", async () => {
    const target = await launchDeadlineTarget();
    const startedAt = Date.now();
    const timedOut = await target.service.executeTask(target.taskId, target.lease);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(timedOut).toMatchObject({
      state: "cancelling",
      pendingStopOutcome: "failed",
      failure: { code: "PROCESS_LAUNCH_TIMED_OUT" },
      execution: { terminationReason: "launch_timeout" },
    });
    expect(timedOut.execution?.launchDeadlineAtMs).toBeGreaterThanOrEqual(
      timedOut.execution?.startedAtMs ?? 0,
    );
    expect(target.supervisor.pendingLaunchCount()).toBe(1);
    expect(target.supervisor.pendingLaunchSignalAborted()).toBe(true);
    expect(target.supervisor.pendingLaunchDeadlineAtMs()).toBe(
      timedOut.execution?.launchDeadlineAtMs,
    );
    expect(target.service.capacitySnapshot().occupied).toBe(1);
    expect(target.service.operationalFailureCount()).toBe(0);
    // The intentionally unresolved supervisor promise has no child-absence
    // certificate, so this test deliberately does not call settleBackground().
  });

  it("terminates a child reported after launch timeout and releases only after observed exit", async () => {
    const target = await launchDeadlineTarget();
    const timedOut = await target.service.executeTask(target.taskId, target.lease);
    expect(timedOut.state).toBe("cancelling");
    expect(target.service.capacitySnapshot().occupied).toBe(1);

    const childId = target.supervisor.resolveNextHungSpawn();
    await allowTerminationHandlerToRun(() =>
      target.supervisor.terminationRequests(childId).includes("launch_timeout"),
    );
    expect(target.service.capacitySnapshot().occupied).toBe(1);
    expect((await target.service.getTask(target.taskId))?.execution?.childId).toBe(
      childId,
    );

    target.supervisor.observeTermination(childId, {
      kind: "terminated",
      observedAtMs: Date.now(),
      exitCode: null,
      signal: "SIGKILL",
    });
    await target.service.settleBackground();
    expect(target.service.capacitySnapshot().occupied).toBe(0);
    expect(await target.service.getTask(target.taskId)).toMatchObject({
      state: "failed",
      failure: { code: "PROCESS_LAUNCH_TIMED_OUT" },
    });
  });
});
