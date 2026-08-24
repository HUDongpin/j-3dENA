export type Ena3dExchangeErrorCode = "INVALID_BYTES" | "EMPTY_INPUT" | "FILE_TOO_LARGE" | "INVALID_LIMIT" | "BOM_FORBIDDEN" | "INVALID_UTF8" | "JSON_TOO_DEEP" | "DUPLICATE_JSON_KEY" | "INVALID_JSON" | "SCHEMA_MISMATCH" | "COLUMN_TYPE_MISMATCH" | "TABLE_ALIGNMENT_MISMATCH" | "METADATA_ALIGNMENT_MISMATCH" | "ADJACENCY_MISMATCH" | "RESOURCE_LIMIT_EXCEEDED" | "CRYPTO_UNAVAILABLE";
export declare class Ena3dExchangeDecodeError extends Error {
    readonly code: Ena3dExchangeErrorCode;
    readonly path?: string;
    constructor(code: Ena3dExchangeErrorCode, message: string, path?: string);
}
export declare function exchangeError(code: Ena3dExchangeErrorCode, message: string, path?: string): never;
//# sourceMappingURL=errors.d.ts.map