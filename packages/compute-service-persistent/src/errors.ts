export type PersistentComputeErrorCode =
  | "BUILD_APPROVAL_INVALID"
  | "BUILD_NOT_APPROVED"
  | "CONFIGURATION_INVALID"
  | "DATABASE_CONFLICT"
  | "DATABASE_FAILURE"
  | "IMMUTABLE_OBJECT_CONFLICT"
  | "OBJECT_DELETION_NOT_OBSERVED"
  | "OBJECT_INTEGRITY_FAILURE"
  | "OBJECT_STORE_FAILURE"
  | "RECOVERY_CONFLICT";

export class PersistentComputeError extends Error {
  readonly code: PersistentComputeErrorCode;

  constructor(code: PersistentComputeErrorCode) {
    super(code);
    this.name = "PersistentComputeError";
    this.code = code;
  }
}

export function persistentError(code: PersistentComputeErrorCode): never {
  throw new PersistentComputeError(code);
}
