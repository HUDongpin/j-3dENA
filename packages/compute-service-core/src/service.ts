import {
  COMPUTE_AUDIT_EVENT_VERSION,
  COMPUTE_DELETION_RECEIPT_VERSION,
  COMPUTE_JOB_RECORD_VERSION,
  COMPUTE_LEASE_VERSION,
  COMPUTE_OPERATIONAL_FAILURE_SNAPSHOT_VERSION,
  COMPUTE_OPERATIONAL_FAILURE_VERSION,
  COMPUTE_PROCESS_LAUNCH_CONTROL_VERSION,
  COMPUTE_RESULT_PUBLICATION_VERSION,
  COMPUTE_TASK_OWNER_CONTRACT_VERSION,
  COMPUTE_TASK_REQUEST_VERSION,
  MAX_OPERATIONAL_FAILURE_RECORDS,
  type CapacitySnapshot,
  type ComputeAuditEventKind,
  type ComputeAuditEventV1,
  type ComputeJobRecordV1,
  type ComputeJobState,
  type ComputeOperationalFailureCode,
  type ComputeOperationalFailureComponent,
  type ComputeOperationalFailureSnapshotV1,
  type ComputeOperationalFailureV1,
  type ComputeTaskRequestV1,
  type CreateTaskResult,
  type DeleteTaskResult,
  type DeletionIntentV1,
  type ExecutionAttemptV1,
  type ImmutableObjectDescriptor,
  type LeaseTokenV1,
  type ObservedProcessTermination,
  type PendingStopOutcome,
  type ProcessTerminationReason,
  type ResultPublicationV1,
} from "./contracts";
import { coreError } from "./errors";
import type {
  ComputeAuditSink,
  ComputeClock,
  ComputeIdFactory,
  ComputeObjectStore,
  ComputeProcessSupervisor,
  ComputeTaskRepository,
  ImmutableObjectPutResult,
  ProcessLaunchControlV1,
  ProcessLaunchContextV1,
  SupervisedChildProcess,
} from "./interfaces";
import { assertJobStateTransition, isTerminalState } from "./state-machine";
import {
  assertExactObjectKeys,
  assertLowerSha256,
  assertObjectKey,
  assertOpaqueId,
  canonicalStringify,
  cloneFrozen,
  descriptorsEqual,
  sha256Text,
} from "./util";

const MAX_CAS_ATTEMPTS = 32;
const DEFAULT_MAX_PROCESS_LAUNCH_DURATION_MS = 30_000;
const MAX_PROCESS_LAUNCH_DURATION_MS = 5 * 60_000;
const SERVICE_OWNED_OBJECT_PREFIXES = Object.freeze([
  "compute-requests/",
  "compute-results/",
]);

type JobPatch = Partial<Omit<ComputeJobRecordV1, "version" | "revision">>;
type JobOptionalKey =
  | "lease"
  | "execution"
  | "result"
  | "pendingStopOutcome"
  | "failure"
  | "deletion"
  | "deletionReceipt";

interface CapacitySlot {
  readonly slotId: string;
  readonly taskRef: string;
  childId?: string;
}

type SettledProcessLaunch =
  | Readonly<{ kind: "launched"; child: SupervisedChildProcess }>
  | Readonly<{ kind: "rejected" }>;

type ProcessLaunchRaceOutcome =
  | SettledProcessLaunch
  | Readonly<{ kind: "deadline" }>;

interface ProcessLaunchRace {
  readonly outcome: ProcessLaunchRaceOutcome;
  readonly settled: Promise<SettledProcessLaunch>;
  readonly abortController: AbortController;
}

class BoundedOperationalFailureJournal {
  readonly #records: ComputeOperationalFailureV1[] = [];
  #nextReplacement = 0;
  #total = 0;
  #dropped = 0;

  record(
    component: ComputeOperationalFailureComponent,
    code: ComputeOperationalFailureCode,
    atMs: number,
  ): void {
    if (this.#total < Number.MAX_SAFE_INTEGER) this.#total += 1;
    const failure = cloneFrozen({
      version: COMPUTE_OPERATIONAL_FAILURE_VERSION,
      component,
      code,
      atMs,
    });
    if (this.#records.length < MAX_OPERATIONAL_FAILURE_RECORDS) {
      this.#records.push(failure);
      return;
    }
    this.#records[this.#nextReplacement] = failure;
    this.#nextReplacement =
      (this.#nextReplacement + 1) % MAX_OPERATIONAL_FAILURE_RECORDS;
    if (this.#dropped < Number.MAX_SAFE_INTEGER) this.#dropped += 1;
  }

  count(): number {
    return this.#total;
  }

  snapshot(): ComputeOperationalFailureSnapshotV1 {
    const ordered =
      this.#records.length < MAX_OPERATIONAL_FAILURE_RECORDS ||
      this.#nextReplacement === 0
        ? [...this.#records]
        : [
            ...this.#records.slice(this.#nextReplacement),
            ...this.#records.slice(0, this.#nextReplacement),
          ];
    return cloneFrozen({
      version: COMPUTE_OPERATIONAL_FAILURE_SNAPSHOT_VERSION,
      total: this.#total,
      dropped: this.#dropped,
      records: ordered,
    });
  }

  clear(): void {
    this.#records.length = 0;
    this.#nextReplacement = 0;
    this.#total = 0;
    this.#dropped = 0;
  }
}

class ObservedTerminationCapacity {
  readonly #limit: number;
  readonly #idFactory: ComputeIdFactory;
  readonly #slots = new Map<string, CapacitySlot>();

  constructor(limit: number, idFactory: ComputeIdFactory) {
    this.#limit = limit;
    this.#idFactory = idFactory;
  }

  reserve(taskRef: string): CapacitySlot | null {
    const existing = [...this.#slots.values()].find(
      (slot) => slot.taskRef === taskRef,
    );
    if (existing !== undefined) return existing;
    if (this.#slots.size >= this.#limit) return null;
    const slot = {
      slotId: this.#idFactory.nextId("slot"),
      taskRef,
    };
    this.#slots.set(slot.slotId, slot);
    return slot;
  }

  bindChild(slotId: string, childId: string): void {
    const slot = this.#slots.get(slotId);
    if (slot === undefined) {
      coreError("REPOSITORY_CONFLICT", "A process cannot bind to an unknown slot.");
    }
    if (slot.childId !== undefined && slot.childId !== childId) {
      coreError("REPOSITORY_CONFLICT", "A capacity slot already owns another child.");
    }
    slot.childId = childId;
  }

  releaseUnstarted(slotId: string): void {
    const slot = this.#slots.get(slotId);
    if (slot === undefined) return;
    if (slot.childId !== undefined) {
      coreError(
        "REPOSITORY_CONFLICT",
        "A child-owning slot cannot be released before observed termination.",
      );
    }
    this.#slots.delete(slotId);
  }

  observeTermination(slotId: string, childId: string): void {
    const slot = this.#slots.get(slotId);
    if (slot === undefined) return;
    if (slot.childId !== childId) {
      coreError(
        "REPOSITORY_CONFLICT",
        "Observed child termination does not match the capacity slot owner.",
      );
    }
    this.#slots.delete(slotId);
  }

  snapshot(): CapacitySnapshot {
    return cloneFrozen({
      limit: this.#limit,
      occupied: this.#slots.size,
      slots: [...this.#slots.values()]
        .sort((left, right) => left.slotId.localeCompare(right.slotId))
        .map((slot) => ({ ...slot })),
    });
  }
}

export interface ComputeServiceCoreOptions {
  readonly repository: ComputeTaskRepository;
  readonly objectStore: ComputeObjectStore;
  readonly processSupervisor: ComputeProcessSupervisor;
  readonly auditSink: ComputeAuditSink;
  readonly clock: ComputeClock;
  readonly idFactory: ComputeIdFactory;
  readonly maxConcurrency: number;
  readonly maxLeaseDurationMs?: number;
  readonly maxProcessLaunchDurationMs?: number;
  /** Persistent runtimes release the distributed fence before provider deletion. */
  readonly deferProcessOwnedDeletionCompletion?: boolean;
}

export interface ClaimTaskOptions {
  readonly leaseId: string;
  readonly holderId: string;
  readonly durationMs: number;
}

export class ComputeServiceCore {
  readonly #repository: ComputeTaskRepository;
  readonly #objectStore: ComputeObjectStore;
  readonly #processSupervisor: ComputeProcessSupervisor;
  readonly #auditSink: ComputeAuditSink;
  readonly #clock: ComputeClock;
  readonly #idFactory: ComputeIdFactory;
  readonly #capacity: ObservedTerminationCapacity;
  readonly #maxLeaseDurationMs: number;
  readonly #maxProcessLaunchDurationMs: number;
  readonly #deferProcessOwnedDeletionCompletion: boolean;
  readonly #background = new Set<Promise<void>>();
  readonly #operationalFailures = new BoundedOperationalFailureJournal();
  readonly #executeOperations = new Map<
    string,
    Readonly<{
      leaseId: string;
      leaseEpoch: number;
      promise: Promise<ComputeJobRecordV1>;
    }>
  >();

  constructor(options: ComputeServiceCoreOptions) {
    if (!Number.isSafeInteger(options.maxConcurrency) || options.maxConcurrency < 1) {
      coreError("INVALID_ARGUMENT", "maxConcurrency must be a positive integer.");
    }
    const maxLeaseDurationMs = options.maxLeaseDurationMs ?? 5 * 60_000;
    if (!Number.isSafeInteger(maxLeaseDurationMs) || maxLeaseDurationMs < 1) {
      coreError("INVALID_ARGUMENT", "maxLeaseDurationMs must be a positive integer.");
    }
    const maxProcessLaunchDurationMs =
      options.maxProcessLaunchDurationMs ??
      DEFAULT_MAX_PROCESS_LAUNCH_DURATION_MS;
    if (
      !Number.isSafeInteger(maxProcessLaunchDurationMs) ||
      maxProcessLaunchDurationMs < 1 ||
      maxProcessLaunchDurationMs > MAX_PROCESS_LAUNCH_DURATION_MS
    ) {
      coreError(
        "INVALID_ARGUMENT",
        "maxProcessLaunchDurationMs must be within the supported launch limit.",
      );
    }
    this.#repository = options.repository;
    this.#objectStore = options.objectStore;
    this.#processSupervisor = options.processSupervisor;
    this.#auditSink = options.auditSink;
    this.#clock = options.clock;
    this.#idFactory = options.idFactory;
    this.#capacity = new ObservedTerminationCapacity(
      options.maxConcurrency,
      options.idFactory,
    );
    this.#maxLeaseDurationMs = maxLeaseDurationMs;
    this.#maxProcessLaunchDurationMs = maxProcessLaunchDurationMs;
    this.#deferProcessOwnedDeletionCompletion =
      options.deferProcessOwnedDeletionCompletion ?? false;
  }

  capacitySnapshot(): CapacitySnapshot {
    return this.#capacity.snapshot();
  }

  operationalFailureCount(): number {
    return this.#operationalFailures.count();
  }

  operationalFailureSnapshot(): ComputeOperationalFailureSnapshotV1 {
    return this.#operationalFailures.snapshot();
  }

  async getTask(taskId: string): Promise<ComputeJobRecordV1 | null> {
    return this.#repository.get(taskId);
  }

  async createTask(input: ComputeTaskRequestV1): Promise<CreateTaskResult> {
    const now = this.#clock.now();
    const request = this.#validateAndFreezeRequest(input, now);
    const requestFingerprint = sha256Text(canonicalStringify(request));
    const taskRef = sha256Text(canonicalStringify(request.owner));

    const existing = await this.#repository.get(request.owner.taskId);
    if (existing !== null) {
      if (
        existing.requestFingerprint !== requestFingerprint ||
        existing.taskRef !== taskRef
      ) {
        coreError(
          "IDEMPOTENCY_CONFLICT",
          "The task identifier is already bound to a different immutable request.",
        );
      }
      await this.#emit(existing, "task_create_replayed");
      return Object.freeze({ created: false, record: existing });
    }

    const inputHead = await this.#objectStore.head(request.input.key);
    if (inputHead === null) {
      coreError("OBJECT_NOT_FOUND", "The immutable compute input object is missing.");
    }
    if (!descriptorsEqual(inputHead, request.input)) {
      coreError(
        "OBJECT_RECEIPT_MISMATCH",
        "The compute input object does not match its immutable receipt.",
      );
    }

    const requestObjectKey = `compute-requests/${taskRef}/${requestFingerprint}.json`;
    const requestBytes = new TextEncoder().encode(canonicalStringify(request));
    const requestObjectPut = await this.#objectStore.putImmutable(
      requestObjectKey,
      requestBytes,
    );

    const record: ComputeJobRecordV1 = cloneFrozen({
      version: COMPUTE_JOB_RECORD_VERSION,
      owner: request.owner,
      taskRef,
      request,
      requestFingerprint,
      requestObjectKey,
      state: "queued",
      revision: 0,
      leaseEpoch: 0,
      createdAtMs: now,
      updatedAtMs: now,
      ownedResultObjectKeys: [],
    });
    const created = await this.#repository.createIfAbsent(record);
    if (
      !created.created &&
      (created.record.requestFingerprint !== requestFingerprint ||
        created.record.taskRef !== taskRef)
    ) {
      await this.#deleteUnregisteredRequestObject(
        request.owner.taskId,
        requestObjectPut,
        created.record,
      );
      coreError(
        "IDEMPOTENCY_CONFLICT",
        "A concurrent create bound the task identifier to another request.",
      );
    }
    await this.#emit(
      created.record,
      created.created ? "task_created" : "task_create_replayed",
    );
    return Object.freeze({ created: created.created, record: created.record });
  }

  async claimTask(
    taskId: string,
    options: ClaimTaskOptions,
  ): Promise<LeaseTokenV1> {
    assertOpaqueId(taskId, "taskId");
    assertOpaqueId(options.leaseId, "leaseId");
    assertOpaqueId(options.holderId, "holderId");
    if (
      !Number.isSafeInteger(options.durationMs) ||
      options.durationMs < 1 ||
      options.durationMs > this.#maxLeaseDurationMs
    ) {
      coreError("INVALID_ARGUMENT", "Lease duration is outside the configured limit.");
    }
    await this.sweepTask(taskId);

    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const record = await this.#requireTask(taskId);
      if (
        record.state === "leased" &&
        record.lease?.leaseId === options.leaseId &&
        record.lease.holderId === options.holderId
      ) {
        return record.lease;
      }
      if (record.state !== "queued") {
        coreError("LEASE_CONFLICT", "The compute task is not available for claim.");
      }
      const now = this.#clock.now();
      if (now >= record.request.expiresAtMs || now >= record.request.deadlineAtMs) {
        await this.sweepTask(taskId);
        coreError("LEASE_CONFLICT", "The compute task is no longer claimable.");
      }
      const lease: LeaseTokenV1 = cloneFrozen({
        version: COMPUTE_LEASE_VERSION,
        leaseId: options.leaseId,
        holderId: options.holderId,
        epoch: record.leaseEpoch + 1,
        issuedAtMs: now,
        expiresAtMs: Math.min(
          now + options.durationMs,
          record.request.deadlineAtMs,
          record.request.expiresAtMs,
        ),
      });
      const next = this.#nextRecord(record, "leased", now, {
        lease,
        leaseEpoch: lease.epoch,
      }, ["failure", "pendingStopOutcome"]);
      const changed = await this.#repository.compareAndSet(
        taskId,
        record.revision,
        next,
      );
      if (!changed.applied) continue;
      await this.#emit(changed.record, "lease_claimed", {
        leaseEpoch: lease.epoch,
      });
      return lease;
    }
    coreError("REPOSITORY_CONFLICT", "Lease claim exceeded the CAS retry limit.");
  }

  async heartbeatLease(
    taskId: string,
    lease: LeaseTokenV1,
    durationMs: number,
  ): Promise<LeaseTokenV1> {
    if (
      !Number.isSafeInteger(durationMs) ||
      durationMs < 1 ||
      durationMs > this.#maxLeaseDurationMs
    ) {
      coreError("INVALID_ARGUMENT", "Heartbeat duration is outside the configured limit.");
    }
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const record = await this.#requireTask(taskId);
      const now = this.#clock.now();
      this.#assertActiveLease(record, lease, now);
      if (
        record.state !== "leased" &&
        record.state !== "starting" &&
        record.state !== "running"
      ) {
        coreError("STALE_LEASE", "The lease cannot heartbeat in the current state.");
      }
      const currentLease = record.lease;
      if (currentLease === undefined) {
        coreError("STALE_LEASE", "The compute task has no active lease.");
      }
      const refreshed: LeaseTokenV1 = cloneFrozen({
        ...currentLease,
        expiresAtMs: Math.min(
          now + durationMs,
          record.request.deadlineAtMs,
          record.request.expiresAtMs,
        ),
      });
      const next = this.#nextRecord(record, record.state, now, { lease: refreshed });
      const changed = await this.#repository.compareAndSet(
        taskId,
        record.revision,
        next,
      );
      if (!changed.applied) continue;
      await this.#emit(changed.record, "lease_heartbeat", {
        leaseEpoch: refreshed.epoch,
      });
      return refreshed;
    }
    coreError("REPOSITORY_CONFLICT", "Lease heartbeat exceeded the CAS retry limit.");
  }

  async executeTask(
    taskId: string,
    lease: LeaseTokenV1,
  ): Promise<ComputeJobRecordV1> {
    const active = this.#executeOperations.get(taskId);
    if (active !== undefined) {
      if (active.leaseId === lease.leaseId && active.leaseEpoch === lease.epoch) {
        return active.promise;
      }
      try {
        await active.promise;
      } catch {
        // The next call still revalidates repository state and lease ownership.
      }
      return this.executeTask(taskId, lease);
    }
    const operation = this.#executeTaskInternal(taskId, lease);
    this.#executeOperations.set(taskId, {
      leaseId: lease.leaseId,
      leaseEpoch: lease.epoch,
      promise: operation,
    });
    try {
      return await operation;
    } finally {
      const current = this.#executeOperations.get(taskId);
      if (current?.promise === operation) this.#executeOperations.delete(taskId);
    }
  }

  async #executeTaskInternal(
    taskId: string,
    lease: LeaseTokenV1,
  ): Promise<ComputeJobRecordV1> {
    await this.sweepTask(taskId);
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const record = await this.#requireTask(taskId);
      const now = this.#clock.now();
      if (
        (record.state === "starting" ||
          record.state === "running" ||
          record.state === "cancelling") &&
        record.execution?.leaseId === lease.leaseId &&
        record.execution.leaseEpoch === lease.epoch
      ) {
        return record;
      }
      this.#assertActiveLease(record, lease, now);
      if (record.state !== "leased") {
        coreError("STALE_LEASE", "The lease cannot execute the task in its current state.");
      }

      const slot = this.#capacity.reserve(record.taskRef);
      if (slot === null) {
        await this.#emit(record, "capacity_rejected", {
          reasonCode: "MAX_CONCURRENCY",
        });
        coreError("CAPACITY_EXHAUSTED", "No compute process capacity is available.");
      }
      const executionId = this.#idFactory.nextId("execution");
      const leaseKey = sha256Text(lease.leaseId).slice(0, 16);
      const resultObjectKey =
        `compute-results/${record.taskRef}/${lease.epoch}-${leaseKey}.bin`;
      const launchDeadlineAtMs = Math.min(
        now + this.#maxProcessLaunchDurationMs,
        record.lease?.expiresAtMs ?? lease.expiresAtMs,
        record.request.deadlineAtMs,
        record.request.expiresAtMs,
      );
      const execution: ExecutionAttemptV1 = cloneFrozen({
        executionId,
        leaseId: lease.leaseId,
        leaseEpoch: lease.epoch,
        slotId: slot.slotId,
        resultObjectKey,
        launchDeadlineAtMs,
        startedAtMs: now,
      });
      const ownedKeys = record.ownedResultObjectKeys.includes(resultObjectKey)
        ? record.ownedResultObjectKeys
        : [...record.ownedResultObjectKeys, resultObjectKey];
      const starting = this.#nextRecord(record, "starting", now, {
        execution,
        ownedResultObjectKeys: ownedKeys,
      }, ["result", "failure", "pendingStopOutcome"]);
      const reserved = await this.#repository.compareAndSet(
        taskId,
        record.revision,
        starting,
      );
      if (!reserved.applied) {
        this.#capacity.releaseUnstarted(slot.slotId);
        continue;
      }

      const launchContext: ProcessLaunchContextV1 = {
        owner: reserved.record.owner,
        taskRef: reserved.record.taskRef,
        request: reserved.record.request,
        lease: reserved.record.lease ?? lease,
        executionId,
        resultObjectKey,
      };
      const launch = await this.#raceProcessLaunch(
        launchContext,
        launchDeadlineAtMs,
      );
      if (launch.outcome.kind === "deadline") {
        launch.abortController.abort();
        const timedOut = await this.#markProcessLaunchTimedOut(
          taskId,
          executionId,
        );
        this.#track(
          launch.settled.then((settled) =>
            this.#handleLateProcessLaunch(
              taskId,
              executionId,
              slot.slotId,
              resultObjectKey,
              settled,
            ),
          ),
        );
        return timedOut;
      }
      if (launch.outcome.kind === "rejected") {
        this.#capacity.releaseUnstarted(slot.slotId);
        return this.#markProcessStartFailed(taskId, executionId);
      }
      const child = launch.outcome.child;

      this.#capacity.bindChild(slot.slotId, child.childId);
      this.#track(
        child.termination.then((termination) =>
          this.#handleObservedTermination(
            taskId,
            executionId,
            slot.slotId,
            child.childId,
            resultObjectKey,
            termination,
          ),
        ),
      );
      let running: ComputeJobRecordV1;
      try {
        running = await this.#bindStartedChild(
          taskId,
          executionId,
          child.childId,
        );
      } catch (error) {
        try {
          await this.#processSupervisor.requestTermination(
            child.childId,
            "orchestration_failure",
          );
        } catch {
          this.#recordOperationalFailure(
            "process_supervisor",
            "TERMINATION_REQUEST_REJECTED",
          );
        }
        throw error;
      }
      if (running.state === "cancelling") {
        await this.#requestTerminationIfNeeded(running);
      }
      await this.#emit(running, "execution_started", {
        leaseEpoch: lease.epoch,
      });
      return running;
    }
    coreError("REPOSITORY_CONFLICT", "Execution exceeded the CAS retry limit.");
  }

  async publishResult(
    taskId: string,
    lease: LeaseTokenV1,
    object: ImmutableObjectDescriptor,
  ): Promise<ComputeJobRecordV1> {
    assertExactObjectKeys(
      object,
      ["key", "sha256", "byteLength"],
      "result object receipt",
    );
    assertObjectKey(object.key, "result object key");
    assertLowerSha256(object.sha256, "result sha256");
    if (!Number.isSafeInteger(object.byteLength) || object.byteLength < 0) {
      coreError("INVALID_ARGUMENT", "Result byteLength must be a non-negative integer.");
    }
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const record = await this.#requireTask(taskId);
      const now = this.#clock.now();
      this.#assertActiveLease(record, lease, now);
      if (record.state !== "running" || record.execution === undefined) {
        coreError("STALE_LEASE", "Only the current running lease may publish a result.");
      }
      if (record.execution.resultObjectKey !== object.key) {
        coreError(
          "PUBLICATION_CONFLICT",
          "The result object key is not owned by the current execution attempt.",
        );
      }
      if (record.result !== undefined) {
        if (
          record.result.leaseId === lease.leaseId &&
          record.result.leaseEpoch === lease.epoch &&
          descriptorsEqual(record.result.object, object)
        ) {
          return record;
        }
        coreError("PUBLICATION_CONFLICT", "A different result is already published.");
      }
      const stored = await this.#objectStore.head(object.key);
      if (stored === null) {
        coreError("OBJECT_NOT_FOUND", "The candidate result object is missing.");
      }
      if (!descriptorsEqual(stored, object)) {
        coreError(
          "OBJECT_RECEIPT_MISMATCH",
          "The candidate result does not match its immutable object receipt.",
        );
      }
      const publication: ResultPublicationV1 = cloneFrozen({
        version: COMPUTE_RESULT_PUBLICATION_VERSION,
        object,
        leaseId: lease.leaseId,
        leaseEpoch: lease.epoch,
        publishedAtMs: now,
      });
      const next = this.#nextRecord(record, "running", now, {
        result: publication,
      });
      const changed = await this.#repository.compareAndSet(
        taskId,
        record.revision,
        next,
      );
      if (!changed.applied) continue;
      await this.#emit(changed.record, "result_published", {
        leaseEpoch: lease.epoch,
      });
      return changed.record;
    }
    coreError("REPOSITORY_CONFLICT", "Result publication exceeded the CAS retry limit.");
  }

  async cancelTask(taskId: string): Promise<ComputeJobRecordV1> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const record = await this.#requireTask(taskId);
      if (
        record.state === "cancelled" ||
        record.state === "deleted" ||
        record.state === "deleting" ||
        isTerminalState(record.state)
      ) {
        return record;
      }
      if (
        record.state === "cancelling" &&
        record.pendingStopOutcome === "deleted"
      ) {
        await this.#requestTerminationIfNeeded(record);
        return record;
      }
      if (
        record.state === "cancelling" &&
        record.pendingStopOutcome === "cancelled"
      ) {
        await this.#requestTerminationIfNeeded(record);
        return record;
      }
      const now = this.#clock.now();
      if (record.state === "queued" || record.state === "leased") {
        const cancelled = this.#nextRecord(record, "cancelled", now, {}, [
          "lease",
          "execution",
          "result",
          "pendingStopOutcome",
          "failure",
        ]);
        const changed = await this.#repository.compareAndSet(
          taskId,
          record.revision,
          cancelled,
        );
        if (!changed.applied) continue;
        await this.#emit(changed.record, "task_terminal", {
          reasonCode: "CANCELLED",
        });
        return changed.record;
      }
      if (
        record.state === "starting" ||
        record.state === "running" ||
        record.state === "cancelling"
      ) {
        const execution = this.#markTerminationRequested(
          record.execution,
          now,
          "cancelled",
        );
        const cancelling = this.#nextRecord(record, "cancelling", now, {
          pendingStopOutcome: "cancelled",
          ...(execution === undefined ? {} : { execution }),
        });
        const changed = await this.#repository.compareAndSet(
          taskId,
          record.revision,
          cancelling,
        );
        if (!changed.applied) continue;
        await this.#requestTerminationIfNeeded(changed.record);
        await this.#emit(changed.record, "stop_requested", {
          reasonCode: "CANCELLED",
        });
        return changed.record;
      }
      return record;
    }
    coreError("REPOSITORY_CONFLICT", "Cancellation exceeded the CAS retry limit.");
  }

  async deleteTask(taskId: string): Promise<DeleteTaskResult> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const record = await this.#requireTask(taskId);
      if (record.state === "deleted") {
        if (record.deletionReceipt === undefined) {
          coreError("REPOSITORY_CONFLICT", "Deleted task lacks its deletion receipt.");
        }
        return Object.freeze({
          status: "deleted",
          record,
          receipt: record.deletionReceipt,
        });
      }
      if (record.state === "deleting") {
        return this.#completeDeletion(taskId);
      }
      if (
        record.state === "cancelling" &&
        record.pendingStopOutcome === "deleted" &&
        record.deletion !== undefined
      ) {
        await this.#requestTerminationIfNeeded(record);
        return Object.freeze({
          status: "pending_termination",
          record,
        });
      }
      const now = this.#clock.now();
      const deletion: DeletionIntentV1 = record.deletion ?? cloneFrozen({
        requestedAtMs: now,
        previousState: record.state,
      });
      if (
        (record.state === "starting" ||
          record.state === "running" ||
          record.state === "cancelling") &&
        record.execution !== undefined
      ) {
        const execution = this.#markTerminationRequested(
          record.execution,
          now,
          "deletion",
        );
        if (execution === undefined) {
          coreError(
            "REPOSITORY_CONFLICT",
            "A process-owning deletion is missing its execution attempt.",
          );
        }
        const cancelling = this.#nextRecord(record, "cancelling", now, {
          deletion,
          execution,
          pendingStopOutcome: "deleted",
        });
        const changed = await this.#repository.compareAndSet(
          taskId,
          record.revision,
          cancelling,
        );
        if (!changed.applied) continue;
        await this.#requestTerminationIfNeeded(changed.record);
        await this.#emit(changed.record, "task_delete_requested", {
          reasonCode: "AWAITING_PROCESS_TERMINATION",
        });
        return Object.freeze({
          status: "pending_termination",
          record: changed.record,
        });
      }
      const deleting = this.#nextRecord(record, "deleting", now, { deletion }, [
        "lease",
        "execution",
        "result",
        "pendingStopOutcome",
        "failure",
      ]);
      const changed = await this.#repository.compareAndSet(
        taskId,
        record.revision,
        deleting,
      );
      if (!changed.applied) continue;
      await this.#emit(changed.record, "task_delete_requested");
      return this.#completeDeletion(taskId);
    }
    coreError("REPOSITORY_CONFLICT", "Deletion exceeded the CAS retry limit.");
  }

  async sweep(): Promise<readonly ComputeJobRecordV1[]> {
    const records = await this.#repository.list();
    const swept: ComputeJobRecordV1[] = [];
    for (const record of records) {
      swept.push(await this.sweepTask(record.owner.taskId));
    }
    return Object.freeze(swept);
  }

  async sweepTask(taskId: string): Promise<ComputeJobRecordV1> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const record = await this.#requireTask(taskId);
      const now = this.#clock.now();
      if (record.state === "deleted" || record.state === "deleting") return record;

      const ttlExpired = now >= record.request.expiresAtMs;
      const deadlineExpired = now >= record.request.deadlineAtMs;
      const leaseExpired =
        record.lease !== undefined && now >= record.lease.expiresAtMs;

      if (!ttlExpired && !deadlineExpired && !leaseExpired) return record;

      if (record.state === "cancelling") {
        if (
          record.pendingStopOutcome === "deleted" ||
          record.pendingStopOutcome === "cancelled" ||
          record.pendingStopOutcome === "failed"
        ) {
          await this.#requestTerminationIfNeeded(record);
          return record;
        }
        const desired: PendingStopOutcome = ttlExpired
          ? "expired"
          : deadlineExpired
            ? "timed_out"
            : record.pendingStopOutcome ?? "queued";
        if (record.pendingStopOutcome === desired) {
          await this.#requestTerminationIfNeeded(record);
          return record;
        }
        const changed = await this.#repository.compareAndSet(
          taskId,
          record.revision,
          this.#nextRecord(record, "cancelling", now, {
            pendingStopOutcome: desired,
          }),
        );
        if (!changed.applied) continue;
        return changed.record;
      }

      if (record.state === "starting" || record.state === "running") {
        const outcome: PendingStopOutcome = ttlExpired
          ? "expired"
          : deadlineExpired
            ? "timed_out"
            : "queued";
        const reason: ProcessTerminationReason = ttlExpired
          ? "ttl_expired"
          : deadlineExpired
            ? "deadline"
            : "lease_expired";
        const execution = this.#markTerminationRequested(record.execution, now, reason);
        const stopping = this.#nextRecord(record, "cancelling", now, {
          pendingStopOutcome: outcome,
          ...(execution === undefined ? {} : { execution }),
        });
        const changed = await this.#repository.compareAndSet(
          taskId,
          record.revision,
          stopping,
        );
        if (!changed.applied) continue;
        await this.#requestTerminationIfNeeded(changed.record);
        await this.#emit(
          changed.record,
          ttlExpired
            ? "ttl_expired"
            : leaseExpired
              ? "lease_expired"
              : "stop_requested",
          { reasonCode: reason.toUpperCase() },
        );
        return changed.record;
      }

      if (ttlExpired && record.state !== "expired") {
        const expired = this.#nextRecord(record, "expired", now, {}, [
          "lease",
          "execution",
          "pendingStopOutcome",
          "failure",
        ]);
        const changed = await this.#repository.compareAndSet(
          taskId,
          record.revision,
          expired,
        );
        if (!changed.applied) continue;
        await this.#emit(changed.record, "ttl_expired", {
          reasonCode: "TTL_EXPIRED",
        });
        return changed.record;
      }

      if (
        deadlineExpired &&
        (record.state === "queued" || record.state === "leased")
      ) {
        const timedOut = this.#nextRecord(record, "timed_out", now, {}, [
          "lease",
          "execution",
          "result",
          "pendingStopOutcome",
          "failure",
        ]);
        const changed = await this.#repository.compareAndSet(
          taskId,
          record.revision,
          timedOut,
        );
        if (!changed.applied) continue;
        await this.#emit(changed.record, "task_terminal", {
          reasonCode: "DEADLINE",
        });
        return changed.record;
      }

      if (leaseExpired && record.state === "leased") {
        const queued = this.#nextRecord(record, "queued", now, {}, ["lease"]);
        const changed = await this.#repository.compareAndSet(
          taskId,
          record.revision,
          queued,
        );
        if (!changed.applied) continue;
        await this.#emit(changed.record, "lease_expired", {
          reasonCode: "LEASE_EXPIRED_BEFORE_START",
        });
        return changed.record;
      }
      return record;
    }
    coreError("REPOSITORY_CONFLICT", "Temporal sweep exceeded the CAS retry limit.");
  }

  /** Drain registered callbacks after the caller has observed all active children. */
  async settleBackground(): Promise<void> {
    while (this.#background.size > 0) {
      await Promise.all([...this.#background]);
    }
    if (this.#operationalFailures.count() > 0) {
      this.#operationalFailures.clear();
      coreError(
        "REPOSITORY_CONFLICT",
        "One or more allowlisted operational side effects failed.",
      );
    }
  }

  async #raceProcessLaunch(
    context: ProcessLaunchContextV1,
    deadlineAtMs: number,
  ): Promise<ProcessLaunchRace> {
    const abortController = new AbortController();
    const control: ProcessLaunchControlV1 = Object.freeze({
      version: COMPUTE_PROCESS_LAUNCH_CONTROL_VERSION,
      deadlineAtMs,
      signal: abortController.signal,
    });
    const settled: Promise<SettledProcessLaunch> = Promise.resolve()
      .then(() => this.#processSupervisor.spawn(context, control))
      .then(
        (child) => Object.freeze({ kind: "launched" as const, child }),
        () => Object.freeze({ kind: "rejected" as const }),
      );
    const delayMs = Math.max(0, deadlineAtMs - this.#clock.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<Readonly<{ kind: "deadline" }>>((resolve) => {
      timer = setTimeout(
        () => resolve(Object.freeze({ kind: "deadline" as const })),
        delayMs,
      );
    });
    const outcome = await Promise.race([settled, deadline]);
    if (timer !== undefined) clearTimeout(timer);
    return Object.freeze({ outcome, settled, abortController });
  }

  async #markProcessLaunchTimedOut(
    taskId: string,
    executionId: string,
  ): Promise<ComputeJobRecordV1> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const record = await this.#requireTask(taskId);
      if (record.execution?.executionId !== executionId) return record;
      if (record.state === "cancelling") {
        await this.#emit(record, "process_launch_timed_out", {
          reasonCode: "PROCESS_LAUNCH_TIMED_OUT",
        });
        return record;
      }
      if (record.state !== "starting") return record;
      const now = this.#clock.now();
      const execution = this.#markTerminationRequested(
        record.execution,
        now,
        "launch_timeout",
      );
      if (execution === undefined) {
        coreError(
          "REPOSITORY_CONFLICT",
          "Launch timeout lost its reserved execution attempt.",
        );
      }
      const timedOut = this.#nextRecord(record, "cancelling", now, {
        execution,
        pendingStopOutcome: "failed",
        failure: {
          code: "PROCESS_LAUNCH_TIMED_OUT",
          atMs: now,
        },
      }, ["result"]);
      const changed = await this.#repository.compareAndSet(
        taskId,
        record.revision,
        timedOut,
      );
      if (!changed.applied) continue;
      await this.#emit(changed.record, "process_launch_timed_out", {
        reasonCode: "PROCESS_LAUNCH_TIMED_OUT",
      });
      return changed.record;
    }
    coreError("REPOSITORY_CONFLICT", "Process launch timeout exceeded the CAS limit.");
  }

  async #handleLateProcessLaunch(
    taskId: string,
    executionId: string,
    slotId: string,
    resultObjectKey: string,
    settled: SettledProcessLaunch,
  ): Promise<void> {
    if (settled.kind === "rejected") {
      // Supervisor rejection is the explicit certificate that no child exists.
      this.#capacity.releaseUnstarted(slotId);
      await this.#markProcessStartFailed(taskId, executionId);
      return;
    }
    const child = settled.child;
    this.#track(
      child.termination.then((termination) =>
        this.#handleObservedTermination(
          taskId,
          executionId,
          slotId,
          child.childId,
          resultObjectKey,
          termination,
        ),
      ),
    );
    this.#capacity.bindChild(slotId, child.childId);
    let record: ComputeJobRecordV1;
    try {
      record = await this.#bindStartedChild(taskId, executionId, child.childId);
    } catch (error) {
      try {
        await this.#processSupervisor.requestTermination(
          child.childId,
          "orchestration_failure",
        );
      } catch {
        this.#recordOperationalFailure(
          "process_supervisor",
          "TERMINATION_REQUEST_REJECTED",
        );
      }
      throw error;
    }
    await this.#requestTerminationIfNeeded(record);
    const leaseEpoch = record.execution?.leaseEpoch;
    await this.#emit(
      record,
      "execution_started",
      leaseEpoch === undefined ? {} : { leaseEpoch },
    );
  }

  async #markProcessStartFailed(
    taskId: string,
    executionId: string,
  ): Promise<ComputeJobRecordV1> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const record = await this.#requireTask(taskId);
      if (record.execution?.executionId !== executionId) return record;
      const now = this.#clock.now();
      if (record.state === "cancelling") {
        const outcome = record.pendingStopOutcome ?? "cancelled";
        const target: ComputeJobState =
          outcome === "deleted" ? "deleting" : outcome;
        const remove: JobOptionalKey[] = [
          "lease",
          "execution",
          "result",
          "pendingStopOutcome",
        ];
        if (target !== "failed") remove.push("failure");
        const next = this.#nextRecord(record, target, now, {}, remove);
        const changed = await this.#repository.compareAndSet(
          taskId,
          record.revision,
          next,
        );
        if (!changed.applied) continue;
        if (changed.record.state === "deleting" &&
            !this.#deferProcessOwnedDeletionCompletion) {
          return (await this.#completeDeletion(taskId)).record;
        }
        if (changed.record.state !== "queued") {
          await this.#emit(changed.record, "task_terminal", {
            reasonCode: changed.record.state.toUpperCase(),
          });
        }
        return changed.record;
      }
      if (record.state !== "starting") return record;
      const failed = this.#nextRecord(record, "failed", now, {
        failure: { code: "PROCESS_START_FAILED", atMs: now },
      }, ["lease", "execution", "result", "pendingStopOutcome"]);
      const changed = await this.#repository.compareAndSet(
        taskId,
        record.revision,
        failed,
      );
      if (!changed.applied) continue;
      await this.#emit(changed.record, "task_terminal", {
        reasonCode: "PROCESS_START_FAILED",
      });
      return changed.record;
    }
    coreError("REPOSITORY_CONFLICT", "Process-start failure exceeded the CAS retry limit.");
  }

  async #bindStartedChild(
    taskId: string,
    executionId: string,
    childId: string,
  ): Promise<ComputeJobRecordV1> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const record = await this.#requireTask(taskId);
      const execution = record.execution;
      if (execution?.executionId !== executionId) {
        coreError("REPOSITORY_CONFLICT", "Started process no longer owns the job attempt.");
      }
      if (execution.childId === childId) return record;
      const withChild: ExecutionAttemptV1 = cloneFrozen({ ...execution, childId });
      const targetState = record.state === "starting" ? "running" : record.state;
      if (targetState !== "running" && targetState !== "cancelling") {
        coreError("REPOSITORY_CONFLICT", "Started process cannot bind in this job state.");
      }
      const next = this.#nextRecord(record, targetState, this.#clock.now(), {
        execution: withChild,
      });
      const changed = await this.#repository.compareAndSet(
        taskId,
        record.revision,
        next,
      );
      if (!changed.applied) continue;
      return changed.record;
    }
    coreError("REPOSITORY_CONFLICT", "Child binding exceeded the CAS retry limit.");
  }

  async #handleObservedTermination(
    taskId: string,
    executionId: string,
    slotId: string,
    childId: string,
    resultObjectKey: string,
    termination: ObservedProcessTermination,
  ): Promise<void> {
    let finalized: ComputeJobRecordV1 | null = null;
    let deleteResultObjects = true;
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      deleteResultObjects = true;
      const record = await this.#requireTask(taskId);
      if (record.execution?.executionId !== executionId) {
        finalized = record;
        break;
      }
      const now = this.#clock.now();
      let target: ComputeJobState;
      let patch: JobPatch = {};
      const remove: JobOptionalKey[] = [
        "lease",
        "execution",
        "pendingStopOutcome",
      ];

      if (record.state === "cancelling") {
        const outcome = record.pendingStopOutcome ?? "cancelled";
        target = outcome === "deleted" ? "deleting" : outcome;
        if (target === "deleting" && record.deletion === undefined) {
          patch = {
            deletion: {
              requestedAtMs: now,
              previousState: "cancelling",
            },
          };
        }
        remove.push("result");
        if (target !== "failed") remove.push("failure");
      } else if (record.state === "starting" || record.state === "running") {
        const terminationAt = termination.observedAtMs;
        const ttlExpired = terminationAt >= record.request.expiresAtMs;
        const deadlineExpired = terminationAt >= record.request.deadlineAtMs;
        const leaseExpired =
          record.lease !== undefined && terminationAt >= record.lease.expiresAtMs;
        const completedNormally =
          termination.kind === "completed" && termination.exitCode === 0;
        if (ttlExpired || deadlineExpired || leaseExpired) {
          target = ttlExpired
            ? "expired"
            : deadlineExpired
              ? "timed_out"
              : "queued";
          remove.push("result", "failure");
        } else if (completedNormally && record.result !== undefined) {
          target = "succeeded";
          deleteResultObjects = false;
          remove.push("failure");
        } else {
          target = "failed";
          remove.push("result");
          patch = {
            failure: {
              code: completedNormally
                ? "PROCESS_EXITED_WITHOUT_RESULT"
                : termination.kind === "crashed"
                  ? "PROCESS_CRASHED"
                  : "PROCESS_TERMINATED_UNEXPECTEDLY",
              atMs: now,
            },
          };
        }
      } else {
        finalized = record;
        break;
      }

      const next = this.#nextRecord(record, target, now, patch, remove);
      const changed = await this.#repository.compareAndSet(
        taskId,
        record.revision,
        next,
      );
      if (!changed.applied) continue;
      finalized = changed.record;
      break;
    }
    if (finalized === null) {
      coreError("REPOSITORY_CONFLICT", "Termination finalization exceeded the CAS retry limit.");
    }

    this.#capacity.observeTermination(slotId, childId);
    await this.#emit(finalized, "process_termination_observed", {
      reasonCode: termination.kind.toUpperCase(),
    });
    if (deleteResultObjects) {
      await this.#objectStore.delete(resultObjectKey);
    }
    if (finalized.state === "deleting" &&
        !this.#deferProcessOwnedDeletionCompletion) {
      await this.#completeDeletion(taskId);
    } else if (finalized.state !== "queued") {
      await this.#emit(finalized, "task_terminal", {
        reasonCode: finalized.state.toUpperCase(),
      });
    }
  }

  async #completeDeletion(taskId: string): Promise<DeleteTaskResult> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const record = await this.#requireTask(taskId);
      if (record.state === "deleted") {
        if (record.deletionReceipt === undefined) {
          coreError("REPOSITORY_CONFLICT", "Deleted task lacks its deletion receipt.");
        }
        return Object.freeze({
          status: "deleted",
          record,
          receipt: record.deletionReceipt,
        });
      }
      if (record.state !== "deleting" || record.deletion === undefined) {
        coreError("INVALID_STATE_TRANSITION", "Task is not ready for deletion.");
      }
      await this.#objectStore.delete(record.requestObjectKey);
      for (const key of record.ownedResultObjectKeys) {
        await this.#objectStore.delete(key);
      }
      if ((await this.#objectStore.head(record.requestObjectKey)) !== null) {
        coreError("REPOSITORY_CONFLICT", "Request object deletion was not observed.");
      }
      for (const key of record.ownedResultObjectKeys) {
        if ((await this.#objectStore.head(key)) !== null) {
          coreError("REPOSITORY_CONFLICT", "Result object deletion was not observed.");
        }
      }
      const inputHead = await this.#objectStore.head(record.request.input.key);
      const receipt = cloneFrozen({
        version: COMPUTE_DELETION_RECEIPT_VERSION,
        taskRef: record.taskRef,
        requestedAtMs: record.deletion.requestedAtMs,
        completedAtMs: this.#clock.now(),
        previousState: record.deletion.previousState,
        requestObjectAbsent: true as const,
        ownedResultObjectsAbsent: true as const,
        inputObjectDeletionRequested: false as const,
        inputObjectObservedPresentAtCompletion:
          inputHead !== null && descriptorsEqual(inputHead, record.request.input),
        ownedResultObjectCount: record.ownedResultObjectKeys.length,
      });
      const deleted = this.#nextRecord(record, "deleted", this.#clock.now(), {
        deletionReceipt: receipt,
      }, ["lease", "execution", "result", "pendingStopOutcome", "failure"]);
      const changed = await this.#repository.compareAndSet(
        taskId,
        record.revision,
        deleted,
      );
      if (!changed.applied) continue;
      await this.#emit(changed.record, "task_deleted");
      return Object.freeze({
        status: "deleted",
        record: changed.record,
        receipt,
      });
    }
    coreError("REPOSITORY_CONFLICT", "Deletion completion exceeded the CAS retry limit.");
  }

  async #requestTerminationIfNeeded(record: ComputeJobRecordV1): Promise<void> {
    const execution = record.execution;
    if (
      execution?.childId === undefined ||
      execution.terminationReason === undefined
    ) {
      return;
    }
    await this.#processSupervisor.requestTermination(
      execution.childId,
      execution.terminationReason,
    );
  }

  #markTerminationRequested(
    execution: ExecutionAttemptV1 | undefined,
    now: number,
    reason: ProcessTerminationReason,
  ): ExecutionAttemptV1 | undefined {
    if (execution === undefined) return undefined;
    if (execution.terminationRequestedAtMs !== undefined) return execution;
    return cloneFrozen({
      ...execution,
      terminationRequestedAtMs: now,
      terminationReason: reason,
    });
  }

  #assertActiveLease(
    record: ComputeJobRecordV1,
    candidate: LeaseTokenV1,
    now: number,
  ): void {
    const lease = record.lease;
    if (
      lease === undefined ||
      lease.leaseId !== candidate.leaseId ||
      lease.holderId !== candidate.holderId ||
      lease.epoch !== candidate.epoch ||
      now >= lease.expiresAtMs
    ) {
      coreError("STALE_LEASE", "The lease is stale or no longer owns the task.");
    }
  }

  async #deleteUnregisteredRequestObject(
    taskId: string,
    candidate: ImmutableObjectPutResult,
    winningRecord: ComputeJobRecordV1,
  ): Promise<void> {
    if (winningRecord.requestObjectKey === candidate.descriptor.key) {
      coreError(
        "REPOSITORY_CONFLICT",
        "A registered request object cannot be cleaned as a losing create.",
      );
    }

    // `created: false` means another caller may share this candidate key. The
    // authoritative task row must therefore be re-read before deletion. Once a
    // different immutable row has won the same taskId, no caller can register
    // this candidate and it is safe to remove as an orphan.
    if (!candidate.created) {
      const authoritative = await this.#repository.get(taskId);
      if (
        authoritative === null ||
        authoritative.requestFingerprint !== winningRecord.requestFingerprint ||
        authoritative.taskRef !== winningRecord.taskRef ||
        authoritative.requestObjectKey === candidate.descriptor.key
      ) {
        coreError(
          "REPOSITORY_CONFLICT",
          "Shared losing request-object ownership could not be proven.",
        );
      }
    }

    const stored = await this.#objectStore.head(candidate.descriptor.key);
    if (stored !== null && !descriptorsEqual(stored, candidate.descriptor)) {
      coreError(
        "REPOSITORY_CONFLICT",
        "Losing request object changed before cleanup.",
      );
    }
    if (stored !== null) await this.#objectStore.delete(candidate.descriptor.key);
    if ((await this.#objectStore.head(candidate.descriptor.key)) !== null) {
      coreError(
        "REPOSITORY_CONFLICT",
        "A conflicting create request object could not be cleaned up.",
      );
    }
  }

  async #requireTask(taskId: string): Promise<ComputeJobRecordV1> {
    const record = await this.#repository.get(taskId);
    if (record === null) {
      coreError("TASK_NOT_FOUND", "The compute task does not exist.");
    }
    return record;
  }

  #nextRecord(
    record: ComputeJobRecordV1,
    state: ComputeJobState,
    now: number,
    patch: JobPatch = {},
    remove: readonly JobOptionalKey[] = [],
  ): ComputeJobRecordV1 {
    assertJobStateTransition(record.state, state);
    const mutable = {
      ...record,
      ...patch,
      state,
      revision: record.revision + 1,
      updatedAtMs: now,
    } as unknown as Record<string, unknown>;
    for (const key of remove) delete mutable[key];
    return cloneFrozen(mutable as unknown as ComputeJobRecordV1);
  }

  #validateAndFreezeRequest(
    input: ComputeTaskRequestV1,
    now: number,
  ): ComputeTaskRequestV1 {
    assertExactObjectKeys(
      input,
      ["version", "owner", "taskKind", "input", "deadlineAtMs", "expiresAtMs"],
      "compute request",
    );
    assertExactObjectKeys(
      input.owner,
      ["contractVersion", "datasetHash", "specHash", "runId", "taskId"],
      "TaskOwner",
    );
    assertExactObjectKeys(
      input.input,
      ["key", "sha256", "byteLength"],
      "input object receipt",
    );
    if (input.version !== COMPUTE_TASK_REQUEST_VERSION) {
      coreError("INVALID_ARGUMENT", "Compute request version is not supported.");
    }
    if (input.owner.contractVersion !== COMPUTE_TASK_OWNER_CONTRACT_VERSION) {
      coreError("INVALID_ARGUMENT", "TaskOwner contract version is not supported.");
    }
    assertLowerSha256(input.owner.datasetHash, "datasetHash");
    assertLowerSha256(input.owner.specHash, "specHash");
    assertOpaqueId(input.owner.runId, "runId");
    assertOpaqueId(input.owner.taskId, "taskId");
    assertOpaqueId(input.taskKind, "taskKind");
    assertObjectKey(input.input.key, "input object key");
    if (
      SERVICE_OWNED_OBJECT_PREFIXES.some((prefix) =>
        input.input.key.startsWith(prefix),
      )
    ) {
      coreError(
        "INVALID_ARGUMENT",
        "Input objects cannot use a compute-service-owned object namespace.",
      );
    }
    assertLowerSha256(input.input.sha256, "input sha256");
    if (!Number.isSafeInteger(input.input.byteLength) || input.input.byteLength < 0) {
      coreError("INVALID_ARGUMENT", "Input byteLength must be a non-negative integer.");
    }
    if (
      !Number.isSafeInteger(input.deadlineAtMs) ||
      !Number.isSafeInteger(input.expiresAtMs) ||
      input.deadlineAtMs <= now ||
      input.expiresAtMs < input.deadlineAtMs
    ) {
      coreError(
        "INVALID_ARGUMENT",
        "Compute request deadline and TTL must be future ordered integers.",
      );
    }
    return cloneFrozen(input);
  }

  async #emit(
    record: ComputeJobRecordV1,
    kind: ComputeAuditEventKind,
    optional: Readonly<{
      reasonCode?: string;
      leaseEpoch?: number;
    }> = {},
  ): Promise<void> {
    const capacity = this.#capacity.snapshot();
    const event: ComputeAuditEventV1 = cloneFrozen({
      version: COMPUTE_AUDIT_EVENT_VERSION,
      kind,
      atMs: this.#clock.now(),
      taskRef: record.taskRef,
      state: record.state,
      ...(optional.reasonCode === undefined
        ? {}
        : { reasonCode: optional.reasonCode }),
      ...(optional.leaseEpoch === undefined
        ? {}
        : { leaseEpoch: optional.leaseEpoch }),
      occupiedSlots: capacity.occupied,
      capacityLimit: capacity.limit,
    });
    try {
      await this.#auditSink.emit(event);
    } catch {
      this.#recordOperationalFailure("audit_sink", "AUDIT_EMIT_REJECTED");
    }
  }

  #track(promise: Promise<void>): void {
    const tracked = promise
      .catch(() => {
        this.#recordOperationalFailure(
          "background_callback",
          "BACKGROUND_CALLBACK_REJECTED",
        );
      })
      .finally(() => {
        this.#background.delete(tracked);
      });
    this.#background.add(tracked);
  }

  #recordOperationalFailure(
    component: ComputeOperationalFailureComponent,
    code: ComputeOperationalFailureCode,
  ): void {
    this.#operationalFailures.record(component, code, this.#clock.now());
  }
}
