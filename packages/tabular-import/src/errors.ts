export type TabularImportErrorCode =
  | "INVALID_INPUT"
  | "INVALID_FILE_NAME"
  | "UNSUPPORTED_EXTENSION"
  | "FILE_LIMIT_EXCEEDED"
  | "MAGIC_MISMATCH"
  | "INVALID_LIMIT"
  | "CRYPTO_UNAVAILABLE"
  | "SOURCE_HASH_MISMATCH"
  | "INVALID_UTF8"
  | "CSV_MALFORMED"
  | "CSV_DELIMITER_AMBIGUOUS"
  | "XLSX_ZIP_MALFORMED"
  | "XLSX_ZIP64_UNSUPPORTED"
  | "XLSX_ZIP_ENCRYPTED"
  | "XLSX_ZIP_UNSUPPORTED_COMPRESSION"
  | "XLSX_ZIP_ENTRY_LIMIT"
  | "XLSX_ZIP_EXPANSION_LIMIT"
  | "XLSX_ZIP_ENTRY_SIZE_LIMIT"
  | "XLSX_ZIP_RATIO_LIMIT"
  | "XLSX_ZIP_PATH_REJECTED"
  | "XLSX_REQUIRED_PART_MISSING"
  | "XLS_OLE_MALFORMED"
  | "WORKBOOK_PARSE_FAILED"
  | "WORKSHEET_LIMIT_EXCEEDED"
  | "NO_SELECTABLE_WORKSHEET"
  | "WORKSHEET_SELECTION_REQUIRED"
  | "WORKSHEET_SELECTION_INVALID"
  | "WORKSHEET_NOT_SELECTABLE"
  | "WORKSHEET_EMPTY"
  | "ROW_LIMIT_EXCEEDED"
  | "COLUMN_LIMIT_EXCEEDED"
  | "CELL_LIMIT_EXCEEDED"
  | "EMPTY_HEADER"
  | "NON_STRING_HEADER"
  | "DUPLICATE_HEADER"
  | "STRING_LIMIT_EXCEEDED"
  | "FORMULA_CACHE_MISSING"
  | "CELL_ERROR"
  | "NONFINITE_NUMBER"
  | "UNSUPPORTED_CELL_TYPE"
  | "INVALID_DATE";

/**
 * Safe boundary error. Messages identify format/coordinates/limits, but never
 * include raw row values or participant-like cell contents.
 */
export class TabularImportError extends Error {
  readonly code: TabularImportErrorCode;
  readonly path: string | null;

  constructor(code: TabularImportErrorCode, message: string, path: string | null = null) {
    super(message);
    this.name = "TabularImportError";
    this.code = code;
    this.path = path;
  }
}

export function tabularError(
  code: TabularImportErrorCode,
  message: string,
  path: string | null = null,
): never {
  throw new TabularImportError(code, message, path);
}
