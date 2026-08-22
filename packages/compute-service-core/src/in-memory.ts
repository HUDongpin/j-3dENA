import type {
  ComputeAuditEventV1,
  ComputeJobRecordV1,
  ImmutableObjectDescriptor,
  ObservedProcessTermination,
  ProcessTerminationReason,
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
  RepositoryCompareAndSetResult,
  RepositoryCreateResult,
  SupervisedChildProcess,
} from "./interfaces";
import {
  assertObjectKey,
  cloneFrozen,
  descriptorsEqual,
  sha256Bytes,
} from "./util";

export class InMemoryComputeTaskRepository implements ComputeTaskRepository {
  readonly #records = new Map<string, ComputeJobRecordV1>();

  async get(taskId: string): Promise<ComputeJobRecordV1 | null> {
    const record = this.#records.get(taskId);
    return record === undefined ? null : cloneFrozen(record);
  }

  async list(): Promise<readonly ComputeJobRecordV1[]> {
    return [...this.#records.values()]
      .sort((left, right) => left.owner.taskId.localeCompare(right.owner.taskId))
      .map((record) => cloneFrozen(record));
  }

  async createIfAbsent(record: ComputeJobRecordV1): Promise<RepositoryCreateResult> {
    const existing = this.#records.get(record.owner.taskId);
    if (existing !== undefined) {
      return Object.freeze({ created: false, record: cloneFrozen(existing) });
    }
    if (record.revision !== 0) {
      coreError("REPOSITORY_CONFLICT", "A new compute job must start at revision zero.");
    }
    const stored = cloneFrozen(record);
    this.#records.set(record.owner.taskId, stored);
    return Object.freeze({ created: true, record: cloneFrozen(stored) });
  }

  async compareAndSet(
    taskId: string,
    expectedRevision: number,
    next: ComputeJobRecordV1,
  ): Promise<RepositoryCompareAndSetResult> {
    const current = this.#records.get(taskId);
    if (current === undefined) {
      coreError("TASK_NOT_FOUND", "The compute task does not exist.");
    }
    if (current.revision !== expectedRevision) {
      return Object.freeze({ applied: false, record: cloneFrozen(current) });
    }
    if (
      next.owner.taskId !== taskId ||
      next.revision !== expectedRevision + 1 ||
      next.version !== current.version ||
      next.taskRef !== current.taskRef ||
      next.requestFingerprint !== current.requestFingerprint
    ) {
      coreError(
        "REPOSITORY_CONFLICT",
        "The compare-and-set replacement violates immutable job identity.",
      );
    }
    const stored = cloneFrozen(next);
    this.#records.set(taskId, stored);
    return Object.freeze({ applied: true, record: cloneFrozen(stored) });
  }
}

interface StoredObject {
  readonly descriptor: ImmutableObjectDescriptor;
  readonly bytes: Uint8Array;
}

export class InMemoryComputeObjectStore implements ComputeObjectStore {
  readonly #objects = new Map<string, StoredObject>();
  #deleteFailuresRemaining = 0;

  failNextDelete(): void {
    this.#deleteFailuresRemaining += 1;
  }

  async putImmutable(
    key: string,
    bytes: Uint8Array,
  ): Promise<ImmutableObjectPutResult> {
    assertObjectKey(key, "object key");
    const snapshot = Uint8Array.from(bytes);
    const descriptor = Object.freeze({
      key,
      sha256: sha256Bytes(snapshot),
      byteLength: snapshot.byteLength,
    });
    const existing = this.#objects.get(key);
    if (existing !== undefined) {
      if (!descriptorsEqual(existing.descriptor, descriptor)) {
        coreError(
          "IMMUTABLE_OBJECT_CONFLICT",
          "An immutable object key already contains different bytes.",
        );
      }
      return Object.freeze({
        created: false,
        descriptor: cloneFrozen(existing.descriptor),
      });
    }
    this.#objects.set(key, { descriptor, bytes: snapshot });
    return Object.freeze({ created: true, descriptor: cloneFrozen(descriptor) });
  }

  async head(key: string): Promise<ImmutableObjectDescriptor | null> {
    const stored = this.#objects.get(key);
    return stored === undefined ? null : cloneFrozen(stored.descriptor);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const stored = this.#objects.get(key);
    return stored === undefined ? null : Uint8Array.from(stored.bytes);
  }

  async delete(key: string): Promise<boolean> {
    if (this.#deleteFailuresRemaining > 0) {
      this.#deleteFailuresRemaining -= 1;
      coreError("REPOSITORY_CONFLICT", "Injected immutable object deletion failure.");
    }
    return this.#objects.delete(key);
  }

  keys(): readonly string[] {
    return Object.freeze([...this.#objects.keys()].sort());
  }
}

export class ManualComputeClock implements ComputeClock {
  #nowMs: number;

  constructor(nowMs = 0) {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      coreError("INVALID_ARGUMENT", "Manual clock time must be a non-negative integer.");
    }
    this.#nowMs = nowMs;
  }

  now(): number {
    return this.#nowMs;
  }

  set(nowMs: number): void {
    if (!Number.isSafeInteger(nowMs) || nowMs < this.#nowMs) {
      coreError("INVALID_ARGUMENT", "Manual clock cannot move backwards.");
    }
    this.#nowMs = nowMs;
  }

  advance(milliseconds: number): void {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
      coreError("INVALID_ARGUMENT", "Clock advance must be a non-negative integer.");
    }
    this.#nowMs += milliseconds;
  }
}

export class SequenceComputeIdFactory implements ComputeIdFactory {
  #next = 1;

  nextId(namespace: "execution" | "slot"): string {
    const value = `${namespace}-${this.#next}`;
    this.#next += 1;
    return value;
  }
}

export class InMemoryComputeAuditSink implements ComputeAuditSink {
  readonly #events: ComputeAuditEventV1[] = [];
  readonly #failNextKinds = new Set<ComputeAuditEventV1["kind"]>();

  failNext(kind: ComputeAuditEventV1["kind"]): void {
    this.#failNextKinds.add(kind);
  }

  emit(event: ComputeAuditEventV1): void {
    if (this.#failNextKinds.delete(event.kind)) {
      coreError("REPOSITORY_CONFLICT", "Injected audit sink failure.");
    }
    this.#events.push(cloneFrozen(event));
  }

  events(): readonly ComputeAuditEventV1[] {
    return this.#events.map((event) => cloneFrozen(event));
  }
}

interface ControlledChild {
  readonly childId: string;
  readonly context: ProcessLaunchContextV1;
  readonly launchControl: ProcessLaunchControlV1;
  readonly termination: Promise<ObservedProcessTermination>;
  readonly resolve: (termination: ObservedProcessTermination) => void;
  readonly terminationRequests: ProcessTerminationReason[];
  observed: boolean;
}

interface PendingControlledLaunch {
  readonly context: ProcessLaunchContextV1;
  readonly control: ProcessLaunchControlV1;
  readonly resolve: (child: SupervisedChildProcess) => void;
  readonly reject: () => void;
}

export class InMemoryComputeProcessSupervisor
  implements ComputeProcessSupervisor
{
  readonly #children = new Map<string, ControlledChild>();
  readonly #pendingLaunches: PendingControlledLaunch[] = [];
  #nextChild = 1;
  #failNext = false;
  #hangNext = false;
  #spawnCount = 0;

  failNextSpawn(): void {
    this.#failNext = true;
  }

  hangNextSpawn(): void {
    this.#hangNext = true;
  }

  async spawn(
    context: ProcessLaunchContextV1,
    control: ProcessLaunchControlV1,
  ): Promise<SupervisedChildProcess> {
    this.#spawnCount += 1;
    if (this.#failNext) {
      this.#failNext = false;
      coreError("PROCESS_START_FAILED", "The in-memory supervisor rejected process start.");
    }
    if (this.#hangNext) {
      this.#hangNext = false;
      return new Promise<SupervisedChildProcess>((resolve, reject) => {
        this.#pendingLaunches.push({
          context: cloneFrozen(context),
          control,
          resolve,
          reject: () => reject(new Error("Injected launch rejection.")),
        });
      });
    }
    return this.#createChild(context, control);
  }

  #createChild(
    context: ProcessLaunchContextV1,
    control: ProcessLaunchControlV1,
  ): SupervisedChildProcess {
    const childId = `child-${this.#nextChild}`;
    this.#nextChild += 1;
    let resolve!: (termination: ObservedProcessTermination) => void;
    const termination = new Promise<ObservedProcessTermination>((settle) => {
      resolve = settle;
    });
    this.#children.set(childId, {
      childId,
      context: cloneFrozen(context),
      launchControl: control,
      termination,
      resolve,
      terminationRequests: [],
      observed: false,
    });
    return Object.freeze({ childId, termination });
  }

  resolveNextHungSpawn(): string {
    const pending = this.#pendingLaunches.shift();
    if (pending === undefined) {
      coreError("TASK_NOT_FOUND", "No hung process launch is pending.");
    }
    const child = this.#createChild(pending.context, pending.control);
    pending.resolve(child);
    return child.childId;
  }

  rejectNextHungSpawn(): void {
    const pending = this.#pendingLaunches.shift();
    if (pending === undefined) {
      coreError("TASK_NOT_FOUND", "No hung process launch is pending.");
    }
    pending.reject();
  }

  pendingLaunchCount(): number {
    return this.#pendingLaunches.length;
  }

  pendingLaunchSignalAborted(index = 0): boolean {
    const pending = this.#pendingLaunches[index];
    if (pending === undefined) {
      coreError("TASK_NOT_FOUND", "Pending launch index does not exist.");
    }
    return pending.control.signal.aborted;
  }

  pendingLaunchDeadlineAtMs(index = 0): number {
    const pending = this.#pendingLaunches[index];
    if (pending === undefined) {
      coreError("TASK_NOT_FOUND", "Pending launch index does not exist.");
    }
    return pending.control.deadlineAtMs;
  }

  async requestTermination(
    childId: string,
    reason: ProcessTerminationReason,
  ): Promise<void> {
    const child = this.#children.get(childId);
    if (child === undefined) {
      coreError("TASK_NOT_FOUND", "The supervised child does not exist.");
    }
    if (!child.terminationRequests.includes(reason)) {
      child.terminationRequests.push(reason);
    }
  }

  observeTermination(
    childId: string,
    termination: ObservedProcessTermination,
  ): void {
    const child = this.#children.get(childId);
    if (child === undefined) {
      coreError("TASK_NOT_FOUND", "The supervised child does not exist.");
    }
    if (child.observed) return;
    child.observed = true;
    child.resolve(cloneFrozen(termination));
  }

  spawnCount(): number {
    return this.#spawnCount;
  }

  context(childId: string): ProcessLaunchContextV1 {
    const child = this.#children.get(childId);
    if (child === undefined) {
      coreError("TASK_NOT_FOUND", "The supervised child does not exist.");
    }
    return cloneFrozen(child.context);
  }

  terminationRequests(childId: string): readonly ProcessTerminationReason[] {
    const child = this.#children.get(childId);
    if (child === undefined) {
      coreError("TASK_NOT_FOUND", "The supervised child does not exist.");
    }
    return Object.freeze([...child.terminationRequests]);
  }
}
