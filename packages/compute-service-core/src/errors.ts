export type ComputeServiceCoreErrorCode =
  | "CAPACITY_EXHAUSTED"
  | "IDEMPOTENCY_CONFLICT"
  | "IMMUTABLE_OBJECT_CONFLICT"
  | "INVALID_ARGUMENT"
  | "INVALID_STATE_TRANSITION"
  | "LEASE_CONFLICT"
  | "OBJECT_NOT_FOUND"
  | "OBJECT_RECEIPT_MISMATCH"
  | "PROCESS_START_FAILED"
  | "PUBLICATION_CONFLICT"
  | "REPOSITORY_CONFLICT"
  | "STALE_LEASE"
  | "TASK_NOT_FOUND";

export class ComputeServiceCoreError extends Error {
  readonly code: ComputeServiceCoreErrorCode;

  constructor(code: ComputeServiceCoreErrorCode, message: string) {
    super(message);
    this.name = "ComputeServiceCoreError";
    this.code = code;
  }
}

export function coreError(
  code: ComputeServiceCoreErrorCode,
  message: string,
): never {
  throw new ComputeServiceCoreError(code, message);
}
