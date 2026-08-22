import type { CsvDelimiter, TabularImportLimits } from "./types.js";
export interface ParsedCsvRows {
    readonly delimiter: CsvDelimiter;
    readonly rows: string[][];
    readonly skippedBlankRowCount: number;
}
export declare function parseCsvRows(bytes: Uint8Array, limits: Readonly<TabularImportLimits>): ParsedCsvRows;
//# sourceMappingURL=csv.d.ts.map