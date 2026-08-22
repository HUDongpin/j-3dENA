export type DatasetWorkflowErrorCode =
  | "INVALID_REQUEST"
  | "UNKNOWN_FIELD"
  | "INVALID_LIMIT"
  | "INVALID_GENERATION"
  | "INVALID_IDENTITY"
  | "INVALID_PREFLIGHT_RECEIPT"
  | "R_WORKSPACE_REJECTED"
  | "FILE_LIMIT_EXCEEDED"
  | "CRYPTO_UNAVAILABLE"
  | "BROWSER_SERVER_BYTE_LENGTH_MISMATCH"
  | "BROWSER_SERVER_SHA256_MISMATCH"
  | "GENERATION_CONFLICT"
  | "STALE_GENERATION"
  | "UPLOAD_STORAGE_FAILURE"
  | "UPLOAD_NOT_FOUND"
  | "UPLOAD_CUSTODY_MISMATCH"
  | "PARSER_INSPECTION_FAILURE"
  | "PARSER_OUTPUT_INVALID"
  | "WORKSHEET_SELECTION_INVALID"
  | "PARSER_PARSE_FAILURE"
  | "PARSED_STORAGE_FAILURE"
  | "PARSED_NOT_FOUND"
  | "MAPPING_INVALID"
  | "ACTIVATION_CANDIDATE_UNKNOWN"
  | "ACTIVATION_BLOCKED"
  | "ACTIVATION_CONFLICT"
  | "ACTIVATION_STORAGE_FAILURE";

/**
 * Boundary-safe workflow error. Messages and paths describe contracts only;
 * raw filenames, rows, cell values, and participant-like identifiers are
 * never interpolated.
 */
export class DatasetWorkflowError extends Error {
  readonly code: DatasetWorkflowErrorCode;
  readonly path: string;

  constructor(code: DatasetWorkflowErrorCode, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "DatasetWorkflowError";
    this.code = code;
    this.path = path;
  }
}

export function workflowError(
  code: DatasetWorkflowErrorCode,
  path: string,
  message: string,
): never {
  throw new DatasetWorkflowError(code, path, message);
}
