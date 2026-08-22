import type { TabularImportFormat, TabularImportLimits, TabularInputBytes } from "./types.js";
export declare function validateSourceName(name: string): TabularImportFormat;
export declare function takeOwnedByteSnapshot(input: TabularInputBytes, limits: Readonly<TabularImportLimits>): Uint8Array<ArrayBuffer>;
export declare function validateExtensionMagic(bytes: Uint8Array, format: TabularImportFormat): void;
export declare function sha256OwnedBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string>;
export declare function isLowercaseSha256(value: string): boolean;
//# sourceMappingURL=bytes.d.ts.map