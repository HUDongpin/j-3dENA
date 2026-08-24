export type ComputeHttpErrorCode =
  | "CORS_ORIGIN_DENIED"
  | "DATASET_NOT_UPLOADED"
  | "DATASET_RECEIPT_MISMATCH"
  | "DATASET_WORKFLOW_REJECTED"
  | "DEADLINE_EXCEEDED"
  | "IDEMPOTENCY_CONFLICT"
  | "INTERNAL_ERROR"
  | "INVALID_AUTHORIZATION"
  | "INVALID_IDEMPOTENCY_KEY"
  | "INVALID_REQUEST"
  | "JOB_EXPIRED"
  | "METHOD_NOT_ALLOWED"
  | "NOT_FOUND"
  | "NOT_READY"
  | "PAYLOAD_TOO_LARGE"
  | "RESULT_CHECKSUM_MISMATCH"
  | "RESULT_NOT_READY"
  | "UNAUTHORIZED"
  | "UNSUPPORTED_CONTRACT_VERSION"
  | "UNSUPPORTED_MEDIA_TYPE";

export class ComputeHttpError extends Error {
  readonly code: ComputeHttpErrorCode;
  readonly status: number;

  constructor(code: ComputeHttpErrorCode, status: number, internalMessage: string) {
    super(internalMessage);
    this.name = "ComputeHttpError";
    this.code = code;
    this.status = status;
  }
}

export function httpError(
  code: ComputeHttpErrorCode,
  status: number,
  internalMessage: string,
): never {
  throw new ComputeHttpError(code, status, internalMessage);
}
