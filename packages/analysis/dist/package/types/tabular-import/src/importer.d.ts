import type { InspectTabularSourceOptions, ParsedTabularWorksheet, ParseTabularWorksheetRequest, RawScalar, TabularFeaturePolicy, TabularImportLimits, TabularSourceInput, WorkbookInventory } from "./types.js";
export declare const TABULAR_FEATURE_POLICY: Readonly<TabularFeaturePolicy>;
/**
 * Public cached-value boundary used by focused parser policy tests. It is
 * deliberately independent from SheetJS' internal `CellObject` declaration.
 */
export interface CachedWorksheetCell {
    readonly t?: unknown;
    readonly v?: unknown;
    readonly f?: unknown;
    readonly z?: unknown;
}
export declare function inspectTabularSource(input: TabularSourceInput, options?: InspectTabularSourceOptions): Promise<WorkbookInventory>;
/** Internal export supports focused formula/error/date policy tests. */
export declare function materializeCellScalar(cell: CachedWorksheetCell | undefined, date1904: boolean, limits: Readonly<TabularImportLimits>, path: string): RawScalar;
export declare function parseTabularWorksheet(request: ParseTabularWorksheetRequest): Promise<ParsedTabularWorksheet>;
//# sourceMappingURL=importer.d.ts.map