export type RawScalar = string | number | boolean | null;

export type TabularImportFormat = "csv" | "xlsx" | "xls";
export type CsvDelimiter = "," | ";" | "\t";

export type TabularInputBytes = ArrayBuffer | ArrayBufferView;

export interface TabularSourceInput {
  /** Basename supplied by the browser File object; paths are rejected. */
  readonly name: string;
  /** Exact source bytes. The importer takes an owned snapshot before awaiting. */
  readonly bytes: TabularInputBytes;
}

export interface TabularImportLimits {
  readonly maxFileBytes: number;
  readonly maxWorksheets: number;
  /** Maximum data rows; the header row is additional. */
  readonly maxRows: number;
  readonly maxColumns: number;
  /** Maximum rectangular data cells (`rows * columns`). */
  readonly maxCells: number;
  readonly maxStringLength: number;
  readonly maxZipEntries: number;
  readonly maxZipTotalUncompressedBytes: number;
  readonly maxZipEntryUncompressedBytes: number;
  readonly maxZipCompressionRatio: number;
  readonly maxZipPathDepth: number;
}

export interface TabularSourceReceipt {
  readonly name: string;
  readonly format: TabularImportFormat;
  readonly byteLength: number;
  /** Lowercase SHA-256 over the exact owned input-byte snapshot. */
  readonly sha256: string;
  /** Deterministically resolved for CSV; binary workbook formats use `null`. */
  readonly delimiter: CsvDelimiter | null;
}

export type WorksheetVisibility = "visible" | "hidden" | "very-hidden";
export type WorksheetKind = "worksheet" | "macro" | "dialog" | "chart" | "unknown";

export interface WorksheetDescriptor {
  readonly index: number;
  readonly name: string;
  readonly visibility: WorksheetVisibility;
  readonly kind: WorksheetKind;
  readonly selectable: boolean;
  readonly unselectableReason: "hidden" | "unsupported-sheet-kind" | null;
  /** Dimensions declared by the workbook; empty worksheets report zero. */
  readonly declaredRowCount: number;
  readonly declaredColumnCount: number;
}

export interface WorksheetSelection {
  /** Both index and name must match the inspected inventory. */
  readonly index: number;
  readonly name: string;
}

export interface TabularFeaturePolicy {
  readonly formulas: "cached-scalar-only-never-evaluated";
  readonly vba: "never-executed-never-returned";
  readonly macrosheets: "listed-not-selectable-never-returned";
  readonly comments: "discarded";
  readonly hyperlinks: "discarded";
  readonly formatting: "discarded";
  readonly dates: "excel-wall-time-iso-string-no-host-timezone";
}

export interface WorkbookInventory {
  readonly receipt: TabularSourceReceipt;
  readonly worksheets: readonly WorksheetDescriptor[];
  readonly visibleSelectableWorksheetCount: number;
  readonly selectionPolicy: "single-visible-auto-otherwise-explicit";
  readonly hiddenWorksheetPolicy: "listed-not-selectable";
  readonly vbaDetectedAndDiscarded: boolean;
  readonly featurePolicy: TabularFeaturePolicy;
}

export interface ParsedTabularWorksheet {
  readonly receipt: TabularSourceReceipt;
  readonly worksheet: WorksheetDescriptor;
  readonly headers: readonly string[];
  /** Data rows only; the header row is not repeated here. */
  readonly rows: readonly (readonly RawScalar[])[];
  /** At most the first six data rows, copied independently from `rows`. */
  readonly previewRows: readonly (readonly RawScalar[])[];
  readonly rowCount: number;
  readonly columnCount: number;
  readonly skippedBlankRowCount: number;
  readonly vbaDetectedAndDiscarded: boolean;
  readonly featurePolicy: TabularFeaturePolicy;
}

export interface InspectTabularSourceOptions {
  readonly limits?: Partial<TabularImportLimits>;
}

export interface ParseTabularWorksheetRequest extends TabularSourceInput {
  /** Receipt from `inspectTabularSource`; prevents selecting from changed bytes. */
  readonly expectedSha256: string;
  /** `null` is accepted only when exactly one visible selectable sheet exists. */
  readonly selection: WorksheetSelection | null;
  readonly limits?: Partial<TabularImportLimits>;
}
