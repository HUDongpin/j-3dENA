export type CsvCell = string | number | bigint | boolean | null;
export interface CsvTable {
    /** Formal export order. Object property order is never consulted. */
    readonly columns: readonly string[];
    readonly rows: readonly (readonly CsvCell[])[];
}
export type SpreadsheetFormulaPolicy = "neutralize" | "reject" | "allow";
export type NonFiniteNumberPolicy = "reject" | "as-null" | "string";
export interface CsvEncodingOptions {
    /** Text emitted for null and for non-finite values under `as-null`. */
    readonly nullValue?: string;
    readonly nonFiniteNumbers?: NonFiniteNumberPolicy;
    readonly spreadsheetFormulas?: SpreadsheetFormulaPolicy;
    /** RFC 4180 permits either form; canonical 3DENA output includes it. */
    readonly includeFinalRecordTerminator?: boolean;
}
interface ResolvedCsvEncodingOptions {
    readonly nullValue: string;
    readonly nonFiniteNumbers: NonFiniteNumberPolicy;
    readonly spreadsheetFormulas: SpreadsheetFormulaPolicy;
    readonly includeFinalRecordTerminator: boolean;
}
export declare const DEFAULT_CSV_ENCODING_OPTIONS: Readonly<ResolvedCsvEncodingOptions>;
/** Encode one ordered table as canonical RFC 4180 text. */
export declare function encodeCsvText(table: CsvTable, options?: CsvEncodingOptions): string;
/** UTF-8 bytes without a BOM. */
export declare function encodeCsvUtf8(table: CsvTable, options?: CsvEncodingOptions): Uint8Array<ArrayBuffer>;
export {};
//# sourceMappingURL=csv.d.ts.map