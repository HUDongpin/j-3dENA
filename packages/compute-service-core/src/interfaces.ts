import type {
  ComputeAuditEventV1,
  ComputeJobRecordV1,
  COMPUTE_PROCESS_LAUNCH_CONTROL_VERSION,
  ComputeTaskRequestV1,
  ImmutableObjectDescriptor,
  LeaseTokenV1,
  ObservedProcessTermination,
  ProcessTerminationReason,
  TaskOwnerV1,
} from "./contracts";

export interface RepositoryCreateResult {
  readonly created: boolean;
  readonly record: ComputeJobRecordV1;
}

export interface RepositoryCompareAndSetResult {
  readonly applied: boolean;
  readonly record: ComputeJobRecordV1;
}

/** Persistent implementations may use PostgreSQL, but none is supplied here. */
export interface ComputeTaskRepository {
  get(taskId: string): Promise<ComputeJobRecordV1 | null>;
  list(): Promise<readonly ComputeJobRecordV1[]>;
  createIfAbsent(record: ComputeJobRecordV1): Promise<RepositoryCreateResult>;
  compareAndSet(
    taskId: string,
    expectedRevision: number,
    next: ComputeJobRecordV1,
  ): Promise<RepositoryCompareAndSetResult>;
}

export interface ImmutableObjectPutResult {
  readonly created: boolean;
  readonly descriptor: ImmutableObjectDescriptor;
}

/** Persistent implementations may use S3-compatible storage; none is supplied. */
export interface ComputeObjectStore {
  putImmutable(
    key: string,
    bytes: Uint8Array,
  ): Promise<ImmutableObjectPutResult>;
  head(key: string): Promise<ImmutableObjectDescriptor | null>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<boolean>;
}

export interface ProcessLaunchContextV1 {
  readonly owner: TaskOwnerV1;
  readonly taskRef: string;
  readonly request: ComputeTaskRequestV1;
  readonly lease: LeaseTokenV1;
  readonly executionId: string;
  readonly resultObjectKey: string;
}

export interface SupervisedChildProcess {
  readonly childId: string;
  /** Must resolve exactly once; adapter rejection is a contract failure. */
  readonly termination: Promise<ObservedProcessTermination>;
}

export interface ProcessLaunchControlV1 {
  readonly version: typeof COMPUTE_PROCESS_LAUNCH_CONTROL_VERSION;
  readonly deadlineAtMs: number;
  readonly signal: AbortSignal;
}

/**
 * A real child/container supervisor is intentionally outside this package.
 * `requestTermination` must be idempotent for the same child and reason so a
 * caller can safely retry a dispatch whose acknowledgement was lost.
 */
export interface ComputeProcessSupervisor {
  /**
   * A rejection certifies that no child was launched. If the promise remains
   * unresolved after `signal` aborts, the core keeps capacity occupied because
   * it cannot safely infer whether a child exists.
   */
  spawn(
    context: ProcessLaunchContextV1,
    control: ProcessLaunchControlV1,
  ): Promise<SupervisedChildProcess>;
  requestTermination(
    childId: string,
    reason: ProcessTerminationReason,
  ): Promise<void>;
}

export interface ComputeAuditSink {
  emit(event: ComputeAuditEventV1): void | Promise<void>;
}

export interface ComputeClock {
  now(): number;
}

export interface ComputeIdFactory {
  nextId(namespace: "execution" | "slot"): string;
}
