export const COMPUTE_TASK_OWNER_CONTRACT_VERSION =
  "3dena.compute-task-owner.v1" as const;
export const COMPUTE_TASK_REQUEST_VERSION =
  "3dena.compute-task-request.v1" as const;
export const COMPUTE_JOB_RECORD_VERSION =
  "3dena.compute-job-record.v1" as const;
export const COMPUTE_LEASE_VERSION = "3dena.compute-lease.v1" as const;
export const COMPUTE_RESULT_PUBLICATION_VERSION =
  "3dena.compute-result-publication.v1" as const;
export const COMPUTE_DELETION_RECEIPT_VERSION =
  "3dena.compute-deletion-receipt.v1" as const;
export const COMPUTE_AUDIT_EVENT_VERSION =
  "3dena.compute-audit-event.v1" as const;
export const COMPUTE_PROCESS_LAUNCH_CONTROL_VERSION =
  "3dena.compute-process-launch-control.v1" as const;
export const COMPUTE_OPERATIONAL_FAILURE_VERSION =
  "3dena.compute-operational-failure.v1" as const;
export const COMPUTE_OPERATIONAL_FAILURE_SNAPSHOT_VERSION =
  "3dena.compute-operational-failure-snapshot.v1" as const;
export const MAX_OPERATIONAL_FAILURE_RECORDS = 64 as const;

export interface TaskOwnerV1 {
  readonly contractVersion: typeof COMPUTE_TASK_OWNER_CONTRACT_VERSION;
  readonly datasetHash: string;
  readonly specHash: string;
  readonly runId: string;
  readonly taskId: string;
}

export interface ImmutableObjectDescriptor {
  readonly key: string;
  readonly sha256: string;
  readonly byteLength: number;
}

/**
 * Immutable job metadata. Raw research rows and parameters live behind the
 * content-addressed input object; they are never embedded in repository rows or
 * audit events.
 */
export interface ComputeTaskRequestV1 {
  readonly version: typeof COMPUTE_TASK_REQUEST_VERSION;
  readonly owner: TaskOwnerV1;
  readonly taskKind: string;
  readonly input: ImmutableObjectDescriptor;
  readonly deadlineAtMs: number;
  readonly expiresAtMs: number;
}

export type ComputeJobState =
  | "queued"
  | "leased"
  | "starting"
  | "running"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "expired"
  | "deleting"
  | "deleted";

export interface LeaseTokenV1 {
  readonly version: typeof COMPUTE_LEASE_VERSION;
  readonly leaseId: string;
  readonly holderId: string;
  readonly epoch: number;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}

export interface ExecutionAttemptV1 {
  readonly executionId: string;
  readonly leaseId: string;
  readonly leaseEpoch: number;
  readonly slotId: string;
  readonly resultObjectKey: string;
  readonly launchDeadlineAtMs: number;
  readonly childId?: string;
  readonly startedAtMs: number;
  readonly terminationRequestedAtMs?: number;
  readonly terminationReason?: ProcessTerminationReason;
}

export interface ResultPublicationV1 {
  readonly version: typeof COMPUTE_RESULT_PUBLICATION_VERSION;
  readonly object: ImmutableObjectDescriptor;
  readonly leaseId: string;
  readonly leaseEpoch: number;
  readonly publishedAtMs: number;
}

export type PendingStopOutcome =
  | "queued"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "expired"
  | "deleted";

export interface FailureDescriptorV1 {
  readonly code:
    | "PROCESS_START_FAILED"
    | "PROCESS_LAUNCH_TIMED_OUT"
    | "PROCESS_CRASHED"
    | "PROCESS_EXITED_WITHOUT_RESULT"
    | "PROCESS_TERMINATED_UNEXPECTEDLY";
  readonly atMs: number;
}

export interface DeletionIntentV1 {
  readonly requestedAtMs: number;
  readonly previousState: ComputeJobState;
}

export interface DeletionReceiptV1 {
  readonly version: typeof COMPUTE_DELETION_RECEIPT_VERSION;
  readonly taskRef: string;
  readonly requestedAtMs: number;
  readonly completedAtMs: number;
  readonly previousState: ComputeJobState;
  readonly requestObjectAbsent: true;
  readonly ownedResultObjectsAbsent: true;
  readonly inputObjectDeletionRequested: false;
  readonly inputObjectObservedPresentAtCompletion: boolean;
  readonly ownedResultObjectCount: number;
}

export interface ComputeJobRecordV1 {
  readonly version: typeof COMPUTE_JOB_RECORD_VERSION;
  readonly owner: TaskOwnerV1;
  readonly taskRef: string;
  readonly request: ComputeTaskRequestV1;
  readonly requestFingerprint: string;
  readonly requestObjectKey: string;
  readonly state: ComputeJobState;
  readonly revision: number;
  readonly leaseEpoch: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly lease?: LeaseTokenV1;
  readonly execution?: ExecutionAttemptV1;
  readonly result?: ResultPublicationV1;
  readonly pendingStopOutcome?: PendingStopOutcome;
  readonly failure?: FailureDescriptorV1;
  readonly deletion?: DeletionIntentV1;
  readonly deletionReceipt?: DeletionReceiptV1;
  readonly ownedResultObjectKeys: readonly string[];
}

export type ProcessTerminationReason =
  | "cancelled"
  | "launch_timeout"
  | "deadline"
  | "lease_expired"
  | "ttl_expired"
  | "deletion"
  | "orchestration_failure";

export interface ObservedProcessTermination {
  readonly kind: "completed" | "crashed" | "terminated";
  readonly observedAtMs: number;
  readonly exitCode: number | null;
  readonly signal: string | null;
}

export type ComputeAuditEventKind =
  | "task_created"
  | "task_create_replayed"
  | "lease_claimed"
  | "lease_heartbeat"
  | "lease_expired"
  | "capacity_rejected"
  | "execution_started"
  | "process_launch_timed_out"
  | "result_published"
  | "stop_requested"
  | "process_termination_observed"
  | "task_terminal"
  | "ttl_expired"
  | "task_delete_requested"
  | "task_deleted";

/**
 * Deliberately allowlisted operational event. It contains no owner fields,
 * object keys, request/result values, error messages, or research identifiers.
 */
export interface ComputeAuditEventV1 {
  readonly version: typeof COMPUTE_AUDIT_EVENT_VERSION;
  readonly kind: ComputeAuditEventKind;
  readonly atMs: number;
  readonly taskRef: string;
  readonly state: ComputeJobState;
  readonly reasonCode?: string;
  readonly leaseEpoch?: number;
  readonly occupiedSlots?: number;
  readonly capacityLimit?: number;
}

export interface CapacitySnapshot {
  readonly limit: number;
  readonly occupied: number;
  readonly slots: readonly Readonly<{
    slotId: string;
    taskRef: string;
    childId?: string;
  }>[];
}

export type ComputeOperationalFailureComponent =
  | "audit_sink"
  | "background_callback"
  | "process_supervisor";

export type ComputeOperationalFailureCode =
  | "AUDIT_EMIT_REJECTED"
  | "BACKGROUND_CALLBACK_REJECTED"
  | "TERMINATION_REQUEST_REJECTED";

/**
 * Fixed, allowlisted operational diagnostic. It can never contain the caught
 * Error, message, stack, cause, owner identity, or object key.
 */
export interface ComputeOperationalFailureV1 {
  readonly version: typeof COMPUTE_OPERATIONAL_FAILURE_VERSION;
  readonly component: ComputeOperationalFailureComponent;
  readonly code: ComputeOperationalFailureCode;
  readonly atMs: number;
}

export interface ComputeOperationalFailureSnapshotV1 {
  readonly version: typeof COMPUTE_OPERATIONAL_FAILURE_SNAPSHOT_VERSION;
  readonly total: number;
  readonly dropped: number;
  readonly records: readonly ComputeOperationalFailureV1[];
}

export interface CreateTaskResult {
  readonly created: boolean;
  readonly record: ComputeJobRecordV1;
}

export interface DeleteTaskResult {
  readonly status: "pending_termination" | "deleted";
  readonly record: ComputeJobRecordV1;
  readonly receipt?: DeletionReceiptV1;
}
