export interface DeterministicZipEntry {
    readonly path: string;
    readonly data: Uint8Array;
}
export interface DeterministicZipLimits {
    readonly maxFiles: number;
    readonly maxFileBytes: number;
    readonly maxTotalBytes: number;
    readonly maxPathBytes: number;
}
export declare const DEFAULT_DETERMINISTIC_ZIP_LIMITS: Readonly<DeterministicZipLimits>;
export declare const HARD_DETERMINISTIC_ZIP_LIMITS: Readonly<DeterministicZipLimits>;
export declare const DETERMINISTIC_ZIP_EPOCH = "1980-01-01T00:00:00Z";
/**
 * Create a deterministic, uncompressed ZIP32 archive entirely in memory.
 * Entry data is snapshotted before CRC calculation and output construction.
 */
export declare function createDeterministicZip(entries: readonly DeterministicZipEntry[], limits?: Partial<DeterministicZipLimits>): Uint8Array<ArrayBuffer>;
//# sourceMappingURL=zip.d.ts.map