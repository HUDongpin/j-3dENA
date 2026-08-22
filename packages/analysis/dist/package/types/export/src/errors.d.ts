export type ExportEncodingErrorCode = "INVALID_CSV_TABLE" | "INVALID_CSV_OPTION" | "INVALID_CSV_TEXT" | "INVALID_CSV_CELL" | "NON_FINITE_CSV_NUMBER" | "SPREADSHEET_FORMULA" | "INVALID_ZIP_ENTRIES" | "INVALID_ZIP_ENTRY" | "INVALID_ZIP_PATH" | "DUPLICATE_ZIP_PATH" | "INVALID_ZIP_LIMIT" | "ZIP_LIMIT_EXCEEDED" | "ZIP_FORMAT_LIMIT_EXCEEDED";
export declare class ExportEncodingError extends Error {
    readonly code: ExportEncodingErrorCode;
    readonly path?: string;
    constructor(code: ExportEncodingErrorCode, message: string, path?: string);
}
export declare function exportError(code: ExportEncodingErrorCode, message: string, path?: string): never;
//# sourceMappingURL=errors.d.ts.map