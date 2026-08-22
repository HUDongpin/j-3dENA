import type { TabularImportLimits } from "./types.js";
export interface XlsxZipPreflight {
    readonly entryCount: number;
    readonly totalUncompressedBytes: number;
    readonly containsVbaPart: boolean;
}
export declare function preflightXlsxZip(bytes: Uint8Array, limits: Readonly<TabularImportLimits>): Readonly<XlsxZipPreflight>;
export declare function preflightXlsOle(bytes: Uint8Array): void;
//# sourceMappingURL=container-preflight.d.ts.map