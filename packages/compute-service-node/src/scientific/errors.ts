export type ScientificComputeWorkerErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_EXECUTION_INPUT"
  | "INVALID_WORKER_MESSAGE"
  | "ARTIFACT_TOO_LARGE"
  | "ARTIFACT_CHECKSUM_MISMATCH"
  | "ARTIFACT_BINDING_MISMATCH"
  | "IMMUTABLE_ARTIFACT_CONFLICT"
  | "PUBLICATION_RECEIPT_MISMATCH"
  | "SESSION_ABORTED"
  | "STORE_OPERATION_FAILED";

const MESSAGES: Readonly<Record<ScientificComputeWorkerErrorCode, string>> =
  Object.freeze({
    INVALID_CONFIGURATION: "The scientific worker configuration is invalid.",
    INVALID_EXECUTION_INPUT: "The scientific execution input is invalid.",
    INVALID_WORKER_MESSAGE: "The scientific worker message is invalid.",
    ARTIFACT_TOO_LARGE: "The scientific result artifact exceeds its fixed limit.",
    ARTIFACT_CHECKSUM_MISMATCH:
      "The scientific result artifact checksum does not match.",
    ARTIFACT_BINDING_MISMATCH:
      "The scientific result artifact does not match its execution owner.",
    IMMUTABLE_ARTIFACT_CONFLICT:
      "The immutable scientific result artifact conflicts with existing bytes.",
    PUBLICATION_RECEIPT_MISMATCH:
      "The scientific publication receipt does not match the request.",
    SESSION_ABORTED: "The scientific worker session was aborted.",
    STORE_OPERATION_FAILED: "The scientific artifact store operation failed.",
  });

export class ScientificComputeWorkerError extends Error {
  readonly code: ScientificComputeWorkerErrorCode;

  constructor(code: ScientificComputeWorkerErrorCode) {
    super(MESSAGES[code]);
    this.name = "ScientificComputeWorkerError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function scientificWorkerError(
  code: ScientificComputeWorkerErrorCode,
): never {
  throw new ScientificComputeWorkerError(code);
}
