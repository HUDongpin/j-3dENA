import { exportError } from "./errors";
import { isWellFormedUnicode } from "./unicode";

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

export const DEFAULT_CSV_ENCODING_OPTIONS: Readonly<ResolvedCsvEncodingOptions> =
  Object.freeze({
    nullValue: "",
    nonFiniteNumbers: "reject",
    spreadsheetFormulas: "neutralize",
    includeFinalRecordTerminator: true,
  });

const CSV_OPTION_KEYS = Object.freeze([
  "nullValue",
  "nonFiniteNumbers",
  "spreadsheetFormulas",
  "includeFinalRecordTerminator",
] as const);
const NON_FINITE_POLICIES = new Set<NonFiniteNumberPolicy>([
  "reject",
  "as-null",
  "string",
]);
const FORMULA_POLICIES = new Set<SpreadsheetFormulaPolicy>([
  "neutralize",
  "reject",
  "allow",
]);
const SPREADSHEET_FORMULA_PREFIX =
  /^'*(?:[\t\r\n]|\s*[=+\-@])/u;
const UTF8_ENCODER = new TextEncoder();

/** Encode one ordered table as canonical RFC 4180 text. */
export function encodeCsvText(
  table: CsvTable,
  options?: CsvEncodingOptions,
): string {
  const resolved = resolveCsvOptions(options);
  validateCsvTable(table);

  const records: string[] = [];
  records.push(
    table.columns
      .map((column, index) =>
        quoteCsvField(
          protectText(column, resolved, `columns[${index}]`),
        ),
      )
      .join(","),
  );

  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
    const row = table.rows[rowIndex];
    if (!Array.isArray(row) || row.length !== table.columns.length) {
      exportError(
        "INVALID_CSV_TABLE",
        "Every CSV row must be an array with exactly the declared column count.",
        `rows[${rowIndex}]`,
      );
    }
    const fields: string[] = [];
    for (let columnIndex = 0; columnIndex < table.columns.length; columnIndex += 1) {
      fields.push(
        quoteCsvField(
          renderCsvCell(
            row[columnIndex],
            resolved,
            `rows[${rowIndex}][${columnIndex}]`,
          ),
        ),
      );
    }
    records.push(fields.join(","));
  }

  const text = records.join("\r\n");
  return resolved.includeFinalRecordTerminator ? `${text}\r\n` : text;
}

/** UTF-8 bytes without a BOM. */
export function encodeCsvUtf8(
  table: CsvTable,
  options?: CsvEncodingOptions,
): Uint8Array<ArrayBuffer> {
  return UTF8_ENCODER.encode(encodeCsvText(table, options));
}

function resolveCsvOptions(
  requested?: CsvEncodingOptions,
): Readonly<ResolvedCsvEncodingOptions> {
  if (requested !== undefined) {
    if (
      requested === null ||
      typeof requested !== "object" ||
      Array.isArray(requested)
    ) {
      exportError("INVALID_CSV_OPTION", "CSV options must be an object.");
    }
    const unknown = Object.keys(requested).filter(
      (key) => !CSV_OPTION_KEYS.includes(key as (typeof CSV_OPTION_KEYS)[number]),
    );
    if (unknown.length > 0) {
      exportError(
        "INVALID_CSV_OPTION",
        "CSV options contain an unsupported field.",
      );
    }
  }

  const nullValue = requested?.nullValue ?? DEFAULT_CSV_ENCODING_OPTIONS.nullValue;
  if (typeof nullValue !== "string") {
    exportError("INVALID_CSV_OPTION", "nullValue must be a string.", "nullValue");
  }
  validateCsvText(nullValue, "nullValue", "INVALID_CSV_OPTION");

  const nonFiniteNumbers =
    requested?.nonFiniteNumbers ??
    DEFAULT_CSV_ENCODING_OPTIONS.nonFiniteNumbers;
  if (!NON_FINITE_POLICIES.has(nonFiniteNumbers)) {
    exportError(
      "INVALID_CSV_OPTION",
      "nonFiniteNumbers must be reject, as-null, or string.",
      "nonFiniteNumbers",
    );
  }

  const spreadsheetFormulas =
    requested?.spreadsheetFormulas ??
    DEFAULT_CSV_ENCODING_OPTIONS.spreadsheetFormulas;
  if (!FORMULA_POLICIES.has(spreadsheetFormulas)) {
    exportError(
      "INVALID_CSV_OPTION",
      "spreadsheetFormulas must be neutralize, reject, or allow.",
      "spreadsheetFormulas",
    );
  }

  const includeFinalRecordTerminator =
    requested?.includeFinalRecordTerminator ??
    DEFAULT_CSV_ENCODING_OPTIONS.includeFinalRecordTerminator;
  if (typeof includeFinalRecordTerminator !== "boolean") {
    exportError(
      "INVALID_CSV_OPTION",
      "includeFinalRecordTerminator must be boolean.",
      "includeFinalRecordTerminator",
    );
  }

  return Object.freeze({
    nullValue,
    nonFiniteNumbers,
    spreadsheetFormulas,
    includeFinalRecordTerminator,
  });
}

function validateCsvTable(table: CsvTable): void {
  if (table === null || typeof table !== "object" || Array.isArray(table)) {
    exportError("INVALID_CSV_TABLE", "CSV table must be an object.");
  }
  if (!Array.isArray(table.columns) || table.columns.length === 0) {
    exportError(
      "INVALID_CSV_TABLE",
      "CSV columns must be a non-empty ordered array.",
      "columns",
    );
  }
  if (!Array.isArray(table.rows)) {
    exportError("INVALID_CSV_TABLE", "CSV rows must be an array.", "rows");
  }

  const seen = new Set<string>();
  for (let index = 0; index < table.columns.length; index += 1) {
    const column = table.columns[index];
    if (typeof column !== "string" || column.length === 0) {
      exportError(
        "INVALID_CSV_TABLE",
        "Every CSV column name must be a non-empty string.",
        `columns[${index}]`,
      );
    }
    validateCsvText(column, `columns[${index}]`, "INVALID_CSV_TEXT");
    if (seen.has(column)) {
      exportError(
        "INVALID_CSV_TABLE",
        "CSV column names must be unique before encoding.",
        "columns",
      );
    }
    seen.add(column);
  }
}

function renderCsvCell(
  value: unknown,
  options: Readonly<ResolvedCsvEncodingOptions>,
  path: string,
): string {
  if (value === null) return protectText(options.nullValue, options, path);
  if (typeof value === "string") {
    validateCsvText(value, path, "INVALID_CSV_TEXT");
    return protectText(value, options, path);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "number") {
    if (Number.isFinite(value)) return Object.is(value, -0) ? "-0" : String(value);
    if (options.nonFiniteNumbers === "reject") {
      exportError(
        "NON_FINITE_CSV_NUMBER",
        "CSV numbers must be finite under the active policy.",
        path,
      );
    }
    const text =
      options.nonFiniteNumbers === "as-null"
        ? options.nullValue
        : String(value);
    return protectText(text, options, path);
  }
  exportError(
    "INVALID_CSV_CELL",
    "CSV cells must be string, number, bigint, boolean, or null.",
    path,
  );
}

function protectText(
  value: string,
  options: Readonly<ResolvedCsvEncodingOptions>,
  path: string,
): string {
  if (!SPREADSHEET_FORMULA_PREFIX.test(value)) return value;
  if (options.spreadsheetFormulas === "allow") return value;
  if (options.spreadsheetFormulas === "reject") {
    exportError(
      "SPREADSHEET_FORMULA",
      "CSV text could be interpreted as a spreadsheet formula.",
      path,
    );
  }
  return `'${value}`;
}

function quoteCsvField(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function validateCsvText(
  value: string,
  path: string,
  code: "INVALID_CSV_TEXT" | "INVALID_CSV_OPTION",
): void {
  if (!isWellFormedUnicode(value) || value.includes("\0")) {
    exportError(
      code,
      "CSV text must be well-formed Unicode and may not contain NUL.",
      path,
    );
  }
}
