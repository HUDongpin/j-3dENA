import {
  SSF,
  read,
  set_cptable,
  utils,
  type WorkBook,
  type WorkSheet,
} from "xlsx";
import * as cptableModule from "xlsx/dist/cpexcel.full.mjs";
import {
  isLowercaseSha256,
  sha256OwnedBytes,
  takeOwnedByteSnapshot,
  validateExtensionMagic,
  validateSourceName,
} from "./bytes";
import { preflightXlsOle, preflightXlsxZip } from "./container-preflight";
import { parseCsvRows } from "./csv";
import { TabularImportError, tabularError } from "./errors";
import { resolveTabularImportLimits } from "./limits";
import type {
  InspectTabularSourceOptions,
  ParsedTabularWorksheet,
  ParseTabularWorksheetRequest,
  RawScalar,
  TabularFeaturePolicy,
  CsvDelimiter,
  TabularImportFormat,
  TabularImportLimits,
  TabularSourceInput,
  TabularSourceReceipt,
  WorkbookInventory,
  WorksheetDescriptor,
  WorksheetKind,
  WorksheetSelection,
  WorksheetVisibility,
} from "./types";

// SheetJS' ESM codepage module exposes `utils` on its module namespace. Passing
// that namespace is the official browser/ESM wiring; passing only its named
// `cptable` table omits the decoder and breaks BIFF8 strings.
set_cptable(cptableModule);

export const TABULAR_FEATURE_POLICY: Readonly<TabularFeaturePolicy> = Object.freeze({
  formulas: "cached-scalar-only-never-evaluated",
  vba: "never-executed-never-returned",
  macrosheets: "listed-not-selectable-never-returned",
  comments: "discarded",
  hyperlinks: "discarded",
  formatting: "discarded",
  dates: "excel-wall-time-iso-string-no-host-timezone",
});

interface PreparedSource {
  readonly name: string;
  readonly format: TabularImportFormat;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly limits: Readonly<TabularImportLimits>;
  readonly receipt: TabularSourceReceipt;
  readonly xlsxContainsVbaPart: boolean;
}

interface ParsedWorkbookContext {
  readonly workbook: WorkBook;
  readonly worksheets: readonly WorksheetDescriptor[];
  readonly vbaDetectedAndDiscarded: boolean;
}

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

function freezeReceipt(
  name: string,
  format: TabularImportFormat,
  bytes: Uint8Array,
  sha256: string,
  delimiter: CsvDelimiter | null = null,
): TabularSourceReceipt {
  return Object.freeze({
    name,
    format,
    byteLength: bytes.byteLength,
    sha256,
    delimiter,
  });
}

function withCsvDelimiter(
  source: PreparedSource,
  delimiter: CsvDelimiter,
): PreparedSource {
  return {
    ...source,
    receipt: freezeReceipt(
      source.name,
      source.format,
      source.bytes,
      source.receipt.sha256,
      delimiter,
    ),
  };
}

async function prepareSource(
  input: TabularSourceInput,
  requestedLimits?: Partial<TabularImportLimits>,
): Promise<PreparedSource> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    tabularError("INVALID_INPUT", "Tabular source input must be an object.");
  }
  const limits = resolveTabularImportLimits(requestedLimits);
  const format = validateSourceName(input.name);
  const bytes = takeOwnedByteSnapshot(input.bytes, limits);
  validateExtensionMagic(bytes, format);

  let xlsxContainsVbaPart = false;
  if (format === "xlsx") {
    xlsxContainsVbaPart = preflightXlsxZip(bytes, limits).containsVbaPart;
  } else if (format === "xls") {
    preflightXlsOle(bytes);
  }

  const sha256 = await sha256OwnedBytes(bytes);
  return {
    name: input.name,
    format,
    bytes,
    limits,
    receipt: freezeReceipt(input.name, format, bytes, sha256),
    xlsxContainsVbaPart,
  };
}

function workbookReadOptions(limits: Readonly<TabularImportLimits>) {
  return {
    type: "array" as const,
    UTC: true,
    WTF: true,
    raw: true,
    dense: false,
    cellDates: false,
    cellFormula: true,
    cellHTML: false,
    cellNF: true,
    cellStyles: false,
    cellText: false,
    sheetStubs: true,
    bookDeps: false,
    bookFiles: false,
    bookVBA: true,
    sheetRows: limits.maxRows + 1,
  };
}

function parseWorkbook(bytes: Uint8Array, limits: Readonly<TabularImportLimits>): WorkBook {
  try {
    return read(bytes, workbookReadOptions(limits));
  } catch {
    tabularError(
      "WORKBOOK_PARSE_FAILED",
      "Spreadsheet bytes could not be parsed under the strict workbook contract.",
      "workbook",
    );
  }
}

function worksheetVisibility(hidden: unknown): WorksheetVisibility {
  if (hidden === 1) return "hidden";
  if (hidden === 2) return "very-hidden";
  return "visible";
}

function worksheetKind(sheet: WorkSheet | undefined): WorksheetKind {
  const rawType: unknown = sheet?.["!type"];
  if (rawType === undefined || rawType === "sheet") return "worksheet";
  if (rawType === "macro") return "macro";
  if (rawType === "dialog") return "dialog";
  if (rawType === "chart") return "chart";
  return "unknown";
}

function decodeDeclaredRange(
  worksheet: WorkSheet | undefined,
  path: string,
): { readonly rowCount: number; readonly columnCount: number } {
  const fullRef: unknown = worksheet?.["!fullref"];
  const ref: unknown = typeof fullRef === "string" ? fullRef : worksheet?.["!ref"];
  if (ref === undefined) return { rowCount: 0, columnCount: 0 };
  if (typeof ref !== "string" || ref.length > 128) {
    tabularError("WORKBOOK_PARSE_FAILED", "Worksheet declared range is malformed.", path);
  }
  try {
    const range = utils.decode_range(ref);
    const rowCount = range.e.r - range.s.r + 1;
    const columnCount = range.e.c - range.s.c + 1;
    if (
      !Number.isSafeInteger(rowCount) ||
      !Number.isSafeInteger(columnCount) ||
      rowCount < 1 ||
      columnCount < 1
    ) {
      tabularError("WORKBOOK_PARSE_FAILED", "Worksheet declared range is invalid.", path);
    }
    return { rowCount, columnCount };
  } catch (error) {
    if (error instanceof TabularImportError) throw error;
    tabularError("WORKBOOK_PARSE_FAILED", "Worksheet declared range is malformed.", path);
  }
}

function buildWorkbookContext(source: PreparedSource): ParsedWorkbookContext {
  const workbook = parseWorkbook(source.bytes, source.limits);
  if (!Array.isArray(workbook.SheetNames) || workbook.SheetNames.length < 1) {
    tabularError("NO_SELECTABLE_WORKSHEET", "Workbook does not contain worksheets.", "workbook.sheets");
  }
  if (workbook.SheetNames.length > source.limits.maxWorksheets) {
    tabularError(
      "WORKSHEET_LIMIT_EXCEEDED",
      `Workbook contains more than maxWorksheets=${source.limits.maxWorksheets}.`,
      "workbook.sheets",
    );
  }

  const seenNames = new Set<string>();
  const worksheets = workbook.SheetNames.map((name, index): WorksheetDescriptor => {
    if (
      typeof name !== "string" ||
      name.length < 1 ||
      name.length > source.limits.maxStringLength ||
      seenNames.has(name)
    ) {
      tabularError("WORKBOOK_PARSE_FAILED", "Workbook worksheet names are invalid or duplicated.", `workbook.sheets[${index}]`);
    }
    seenNames.add(name);
    const sheet = workbook.Sheets[name];
    const visibility = worksheetVisibility(workbook.Workbook?.Sheets?.[index]?.Hidden);
    const kind = worksheetKind(sheet);
    const selectable = visibility === "visible" && kind === "worksheet";
    const dimensions = decodeDeclaredRange(sheet, `workbook.sheets[${index}].range`);
    validateShape(
      Math.max(0, dimensions.rowCount - 1),
      dimensions.columnCount,
      source.limits,
      `workbook.sheets[${index}].range`,
    );
    return Object.freeze({
      index,
      name,
      visibility,
      kind,
      selectable,
      unselectableReason:
        visibility !== "visible"
          ? "hidden"
          : kind !== "worksheet"
            ? "unsupported-sheet-kind"
            : null,
      declaredRowCount: dimensions.rowCount,
      declaredColumnCount: dimensions.columnCount,
    });
  });

  if (!worksheets.some((worksheet) => worksheet.selectable)) {
    tabularError(
      "NO_SELECTABLE_WORKSHEET",
      "Workbook has no visible, ordinary worksheet available for import.",
      "workbook.sheets",
    );
  }
  return {
    workbook,
    worksheets: Object.freeze(worksheets),
    vbaDetectedAndDiscarded:
      source.xlsxContainsVbaPart || workbook.vbaraw !== undefined,
  };
}

function csvDescriptor(rows: readonly string[][]): WorksheetDescriptor {
  const widest = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  return Object.freeze({
    index: 0,
    name: "CSV",
    visibility: "visible",
    kind: "worksheet",
    selectable: true,
    unselectableReason: null,
    declaredRowCount: rows.length,
    declaredColumnCount: widest,
  });
}

function freezeInventory(
  receipt: TabularSourceReceipt,
  worksheets: readonly WorksheetDescriptor[],
  vbaDetectedAndDiscarded: boolean,
): WorkbookInventory {
  return Object.freeze({
    receipt,
    worksheets,
    visibleSelectableWorksheetCount: worksheets.filter((worksheet) => worksheet.selectable).length,
    selectionPolicy: "single-visible-auto-otherwise-explicit",
    hiddenWorksheetPolicy: "listed-not-selectable",
    vbaDetectedAndDiscarded,
    featurePolicy: TABULAR_FEATURE_POLICY,
  });
}

export async function inspectTabularSource(
  input: TabularSourceInput,
  options: InspectTabularSourceOptions = {},
): Promise<WorkbookInventory> {
  const source = await prepareSource(input, options.limits);
  if (source.format === "csv") {
    const parsed = parseCsvRows(source.bytes, source.limits);
    const resolvedSource = withCsvDelimiter(source, parsed.delimiter);
    return freezeInventory(
      resolvedSource.receipt,
      Object.freeze([csvDescriptor(parsed.rows)]),
      false,
    );
  }
  const context = buildWorkbookContext(source);
  return freezeInventory(
    source.receipt,
    context.worksheets,
    context.vbaDetectedAndDiscarded,
  );
}

function validateSelectionShape(selection: WorksheetSelection): void {
  if (
    selection === null ||
    typeof selection !== "object" ||
    Array.isArray(selection) ||
    !Number.isSafeInteger(selection.index) ||
    selection.index < 0 ||
    typeof selection.name !== "string" ||
    Object.keys(selection).some((key) => key !== "index" && key !== "name")
  ) {
    tabularError(
      "WORKSHEET_SELECTION_INVALID",
      "Worksheet selection must contain matching non-negative index and name fields.",
      "selection",
    );
  }
}

function selectWorksheet(
  worksheets: readonly WorksheetDescriptor[],
  selection: WorksheetSelection | null,
): WorksheetDescriptor {
  const selectable = worksheets.filter((worksheet) => worksheet.selectable);
  if (selectable.length < 1) {
    tabularError("NO_SELECTABLE_WORKSHEET", "Source has no selectable worksheet.", "selection");
  }
  if (selection === null) {
    if (selectable.length !== 1) {
      tabularError(
        "WORKSHEET_SELECTION_REQUIRED",
        "Multiple visible worksheets require an explicit inspected worksheet selection.",
        "selection",
      );
    }
    return selectable[0] as WorksheetDescriptor;
  }
  validateSelectionShape(selection);
  const descriptor = worksheets[selection.index];
  if (descriptor === undefined || descriptor.name !== selection.name) {
    tabularError(
      "WORKSHEET_SELECTION_INVALID",
      "Worksheet selection does not match the inspected workbook order and name.",
      "selection",
    );
  }
  if (!descriptor.selectable) {
    tabularError(
      "WORKSHEET_NOT_SELECTABLE",
      "Hidden and non-worksheet workbook entries cannot be selected.",
      "selection",
    );
  }
  return descriptor;
}

function normalizeHeader(
  value: RawScalar,
  index: number,
  limits: Readonly<TabularImportLimits>,
): string {
  if (typeof value !== "string") {
    tabularError(
      "NON_STRING_HEADER",
      "Every worksheet header must be a cached string scalar.",
      `headers[${index}]`,
    );
  }
  const withoutBom = index === 0 ? value.replace(/^\uFEFF/u, "") : value;
  const normalized = withoutBom.trim().normalize("NFC");
  if (normalized.length < 1) {
    tabularError("EMPTY_HEADER", "Worksheet headers must not be empty.", `headers[${index}]`);
  }
  if (normalized.length > limits.maxStringLength) {
    tabularError(
      "STRING_LIMIT_EXCEEDED",
      `Worksheet header length exceeds maxStringLength=${limits.maxStringLength}.`,
      `headers[${index}]`,
    );
  }
  return normalized;
}

function validateHeaders(
  values: readonly RawScalar[],
  limits: Readonly<TabularImportLimits>,
): readonly string[] {
  const headers = values.map((value, index) => normalizeHeader(value, index, limits));
  if (new Set(headers).size !== headers.length) {
    tabularError("DUPLICATE_HEADER", "Worksheet headers must be unique after normalization.", "headers");
  }
  return Object.freeze(headers);
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function excelDateString(value: number, date1904: boolean, path: string): string {
  const parsed: unknown = SSF.parse_date_code(value, { date1904 });
  if (parsed === null || typeof parsed !== "object") {
    tabularError("INVALID_DATE", "Excel date serial could not be normalized.", path);
  }
  const record = parsed as Record<string, unknown>;
  const y = record.y;
  const m = record.m;
  const d = record.d;
  const H = record.H;
  const M = record.M;
  const S = record.S;
  const u = record.u;
  if (
    ![y, m, d, H, M, S, u].every((part) => typeof part === "number" && Number.isFinite(part))
  ) {
    tabularError("INVALID_DATE", "Excel date serial produced invalid calendar fields.", path);
  }
  let milliseconds = Math.round((u as number) * 1_000);
  let seconds = S as number;
  let minutes = M as number;
  let hours = H as number;
  if (milliseconds === 1_000) {
    milliseconds = 0;
    seconds += 1;
  }
  if (seconds === 60) {
    seconds = 0;
    minutes += 1;
  }
  if (minutes === 60) {
    minutes = 0;
    hours += 1;
  }
  if (hours === 24) {
    hours = 0;
    const advanced = new Date(Date.UTC(y as number, (m as number) - 1, (d as number) + 1));
    return `${pad(advanced.getUTCFullYear(), 4)}-${pad(advanced.getUTCMonth() + 1, 2)}-${pad(advanced.getUTCDate(), 2)}T00:00:00.000`;
  }
  return `${pad(y as number, 4)}-${pad(m as number, 2)}-${pad(d as number, 2)}T${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(milliseconds, 3)}`;
}

function dateObjectString(value: Date, path: string): string {
  if (!Number.isFinite(value.getTime())) {
    tabularError("INVALID_DATE", "Date cell is invalid.", path);
  }
  return value.toISOString().replace(/Z$/u, "");
}

function isElapsedDurationFormat(format: string): boolean {
  return /\[(?:h+|m+|s+)\]/iu.test(format);
}

/** Internal export supports focused formula/error/date policy tests. */
export function materializeCellScalar(
  cell: CachedWorksheetCell | undefined,
  date1904: boolean,
  limits: Readonly<TabularImportLimits>,
  path: string,
): RawScalar {
  if (cell === undefined) return null;
  // SheetJS represents an OOXML formula with no cached `<v>` as a stub
  // (`t: "z", f: ..., v: 0`). Treating the synthetic zero as a cache would
  // silently invent scientific data, so formula-bearing stubs fail closed.
  if (cell.t === "z") {
    if (cell.f !== undefined) {
      tabularError(
        "FORMULA_CACHE_MISSING",
        "Formula cells require an existing cached scalar and are never evaluated.",
        path,
      );
    }
    return null;
  }
  if (cell.f !== undefined && !Object.prototype.hasOwnProperty.call(cell, "v")) {
    tabularError(
      "FORMULA_CACHE_MISSING",
      "Formula cells require an existing cached scalar and are never evaluated.",
      path,
    );
  }
  if (cell.t === "e") {
    tabularError("CELL_ERROR", "Spreadsheet error cells are not accepted.", path);
  }
  const value = cell.v;
  if (value === undefined) {
    if (cell.f !== undefined) {
      tabularError(
        "FORMULA_CACHE_MISSING",
        "Formula cells require an existing cached scalar and are never evaluated.",
        path,
      );
    }
    return null;
  }

  if (cell.t === "s") {
    if (typeof value !== "string") {
      tabularError("UNSUPPORTED_CELL_TYPE", "String cell cache has an invalid type.", path);
    }
    if (value.length > limits.maxStringLength) {
      tabularError(
        "STRING_LIMIT_EXCEEDED",
        `Spreadsheet string length exceeds maxStringLength=${limits.maxStringLength}.`,
        path,
      );
    }
    return value;
  }
  if (cell.t === "b") {
    if (typeof value !== "boolean") {
      tabularError("UNSUPPORTED_CELL_TYPE", "Boolean cell cache has an invalid type.", path);
    }
    return value;
  }
  if (cell.t === "d") {
    if (!(value instanceof Date)) {
      tabularError("UNSUPPORTED_CELL_TYPE", "Date cell cache has an invalid type.", path);
    }
    return dateObjectString(value, path);
  }
  if (cell.t === "n") {
    if (typeof value !== "number") {
      tabularError("UNSUPPORTED_CELL_TYPE", "Numeric cell cache has an invalid type.", path);
    }
    if (!Number.isFinite(value)) {
      tabularError("NONFINITE_NUMBER", "Non-finite spreadsheet numbers are not accepted.", path);
    }
    const format = typeof cell.z === "string" ? cell.z : "";
    if (format.length > 0 && SSF.is_date(format) && !isElapsedDurationFormat(format)) {
      return excelDateString(value, date1904, path);
    }
    return value;
  }
  tabularError("UNSUPPORTED_CELL_TYPE", "Spreadsheet cell type is outside the raw scalar contract.", path);
}

function validateShape(
  dataRowCount: number,
  columnCount: number,
  limits: Readonly<TabularImportLimits>,
  path: string,
): void {
  if (dataRowCount > limits.maxRows) {
    tabularError(
      "ROW_LIMIT_EXCEEDED",
      `Worksheet data rows exceed maxRows=${limits.maxRows}.`,
      path,
    );
  }
  if (columnCount > limits.maxColumns) {
    tabularError(
      "COLUMN_LIMIT_EXCEEDED",
      `Worksheet width exceeds maxColumns=${limits.maxColumns}.`,
      path,
    );
  }
  const cells = dataRowCount * columnCount;
  if (!Number.isSafeInteger(cells) || cells > limits.maxCells) {
    tabularError(
      "CELL_LIMIT_EXCEEDED",
      `Worksheet data cells exceed maxCells=${limits.maxCells}.`,
      path,
    );
  }
}

function freezeRows(rows: RawScalar[][]): readonly (readonly RawScalar[])[] {
  return Object.freeze(rows.map((row) => Object.freeze(row)));
}

function freezeResult(
  source: PreparedSource,
  worksheet: WorksheetDescriptor,
  headers: readonly string[],
  rows: RawScalar[][],
  skippedBlankRowCount: number,
  vbaDetectedAndDiscarded: boolean,
): ParsedTabularWorksheet {
  validateShape(rows.length, headers.length, source.limits, "worksheet");
  const frozenRows = freezeRows(rows);
  const previewRows = Object.freeze(
    frozenRows.slice(0, 6).map((row) => Object.freeze([...row])),
  );
  return Object.freeze({
    receipt: source.receipt,
    worksheet,
    headers,
    rows: frozenRows,
    previewRows,
    rowCount: rows.length,
    columnCount: headers.length,
    skippedBlankRowCount,
    vbaDetectedAndDiscarded,
    featurePolicy: TABULAR_FEATURE_POLICY,
  });
}

function materializeCsv(
  source: PreparedSource,
  descriptor: WorksheetDescriptor,
  lexicalRows: string[][],
  skippedBlankRowCount: number,
): ParsedTabularWorksheet {
  const headerLexemes = lexicalRows[0];
  if (headerLexemes === undefined) {
    tabularError("WORKSHEET_EMPTY", "CSV does not contain a header row.", "csv");
  }
  const headers = validateHeaders(headerLexemes, source.limits);
  const rows: RawScalar[][] = [];
  lexicalRows.slice(1).forEach((lexemes, rowIndex) => {
    if (lexemes.length !== headers.length) {
      tabularError(
        "CSV_MALFORMED",
        "CSV rows must have exactly the normalized header width.",
        `csv.rows[${rowIndex + 1}]`,
      );
    }
    rows.push([...lexemes]);
  });
  if (rows.length < 1) {
    tabularError("WORKSHEET_EMPTY", "CSV must contain at least one data row.", "csv");
  }
  return freezeResult(
    source,
    descriptor,
    headers,
    rows,
    skippedBlankRowCount,
    false,
  );
}

function materializeWorksheet(
  source: PreparedSource,
  context: ParsedWorkbookContext,
  descriptor: WorksheetDescriptor,
): ParsedTabularWorksheet {
  const worksheet = context.workbook.Sheets[descriptor.name];
  if (worksheet === undefined || typeof worksheet["!ref"] !== "string") {
    tabularError("WORKSHEET_EMPTY", "Selected worksheet does not contain a table.", "worksheet");
  }
  const fullRef: unknown = worksheet["!fullref"];
  const declaredRef = typeof fullRef === "string" ? fullRef : worksheet["!ref"];
  let declaredRange;
  let parsedRange;
  try {
    declaredRange = utils.decode_range(declaredRef);
    parsedRange = utils.decode_range(worksheet["!ref"]);
  } catch {
    tabularError("WORKBOOK_PARSE_FAILED", "Selected worksheet range is malformed.", "worksheet.range");
  }
  const declaredRows = declaredRange.e.r - declaredRange.s.r;
  const declaredColumns = declaredRange.e.c - declaredRange.s.c + 1;
  validateShape(declaredRows, declaredColumns, source.limits, "worksheet.range");
  if (declaredRange.s.r !== parsedRange.s.r || declaredRange.s.c !== parsedRange.s.c) {
    tabularError("WORKBOOK_PARSE_FAILED", "Truncated worksheet origin is inconsistent.", "worksheet.range");
  }

  const date1904 = context.workbook.Workbook?.WBProps?.date1904 === true;
  const headerValues: RawScalar[] = [];
  for (let column = declaredRange.s.c; column <= declaredRange.e.c; column += 1) {
    const address = utils.encode_cell({ r: declaredRange.s.r, c: column });
    headerValues.push(
      materializeCellScalar(worksheet[address] as CachedWorksheetCell | undefined, date1904, source.limits, `worksheet.${address}`),
    );
  }
  const headers = validateHeaders(headerValues, source.limits);

  const rows: RawScalar[][] = [];
  let skippedBlankRowCount = 0;
  for (let rowIndex = declaredRange.s.r + 1; rowIndex <= declaredRange.e.r; rowIndex += 1) {
    const row: RawScalar[] = [];
    for (let column = declaredRange.s.c; column <= declaredRange.e.c; column += 1) {
      const address = utils.encode_cell({ r: rowIndex, c: column });
      row.push(
        materializeCellScalar(worksheet[address] as CachedWorksheetCell | undefined, date1904, source.limits, `worksheet.${address}`),
      );
    }
    if (row.every((value) => value === null)) {
      skippedBlankRowCount += 1;
    } else {
      rows.push(row);
    }
  }
  if (rows.length < 1) {
    tabularError("WORKSHEET_EMPTY", "Selected worksheet must contain at least one data row.", "worksheet");
  }
  return freezeResult(
    source,
    descriptor,
    headers,
    rows,
    skippedBlankRowCount,
    context.vbaDetectedAndDiscarded,
  );
}

export async function parseTabularWorksheet(
  request: ParseTabularWorksheetRequest,
): Promise<ParsedTabularWorksheet> {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    tabularError("INVALID_INPUT", "Tabular worksheet request must be an object.");
  }
  if (!isLowercaseSha256(request.expectedSha256)) {
    tabularError(
      "SOURCE_HASH_MISMATCH",
      "Expected source SHA-256 must be a lowercase digest from inspection.",
      "expectedSha256",
    );
  }
  const source = await prepareSource(request, request.limits);
  if (source.receipt.sha256 !== request.expectedSha256) {
    tabularError(
      "SOURCE_HASH_MISMATCH",
      "Exact source bytes changed after worksheet inspection.",
      "expectedSha256",
    );
  }

  if (source.format === "csv") {
    const parsed = parseCsvRows(source.bytes, source.limits);
    const resolvedSource = withCsvDelimiter(source, parsed.delimiter);
    const descriptor = csvDescriptor(parsed.rows);
    selectWorksheet([descriptor], request.selection);
    return materializeCsv(
      resolvedSource,
      descriptor,
      parsed.rows,
      parsed.skippedBlankRowCount,
    );
  }

  const context = buildWorkbookContext(source);
  const descriptor = selectWorksheet(context.worksheets, request.selection);
  return materializeWorksheet(source, context, descriptor);
}
