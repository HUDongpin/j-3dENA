import { TabularImportError, tabularError } from "./errors";
import type { CsvDelimiter, TabularImportLimits } from "./types";

export interface ParsedCsvRows {
  readonly delimiter: CsvDelimiter;
  readonly rows: string[][];
  readonly skippedBlankRowCount: number;
}

interface CandidateSuccess extends ParsedCsvRows {
  readonly kind: "success";
  readonly width: number;
}

interface CandidateSingleColumn {
  readonly kind: "single-column";
}

interface CandidateFailure {
  readonly kind: "failure";
  readonly error: TabularImportError;
  readonly sawMultiColumnHeader: boolean;
}

type CandidateOutcome = CandidateSuccess | CandidateSingleColumn | CandidateFailure;

const DELIMITERS: readonly CsvDelimiter[] = [",", ";", "\t"];

function decodeCsvUtf8(bytes: Uint8Array): string {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const withoutBom = decoded.startsWith("\uFEFF") ? decoded.slice(1) : decoded;
    if (withoutBom.includes("\0")) {
      tabularError("CSV_MALFORMED", "CSV text must not contain NUL characters.", "csv");
    }
    return withoutBom;
  } catch (error) {
    if (error instanceof TabularImportError) throw error;
    tabularError("INVALID_UTF8", "CSV bytes must be valid UTF-8.", "csv");
  }
}

function parseCandidate(
  source: string,
  delimiter: CsvDelimiter,
  limits: Readonly<TabularImportLimits>,
): CandidateOutcome {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let quoteClosed = false;
  let lastWasRowTerminator = false;
  let headerWidth: number | null = null;
  let dataCellCount = 0;
  let dataRowCount = 0;
  let skippedBlankRowCount = 0;

  const append = (value: string): void => {
    field += value;
    if (field.length > limits.maxStringLength) {
      tabularError(
        "STRING_LIMIT_EXCEEDED",
        `CSV field length exceeds maxStringLength=${limits.maxStringLength}.`,
        `csv.rows[${dataRowCount}].fields[${row.length}]`,
      );
    }
  };
  const finishField = (): void => {
    row.push(field);
    if (row.length > limits.maxColumns) {
      tabularError(
        "COLUMN_LIMIT_EXCEEDED",
        `CSV row width exceeds maxColumns=${limits.maxColumns}.`,
        `csv.rows[${dataRowCount}]`,
      );
    }
    field = "";
    quoteClosed = false;
  };
  const finishRow = (): void => {
    finishField();
    const candidate = row;
    row = [];
    if (!candidate.some((value) => value.trim().length > 0)) {
      skippedBlankRowCount += 1;
      return;
    }
    if (headerWidth === null) {
      headerWidth = candidate.length;
      if (headerWidth === 1) return;
      rows.push(candidate);
      return;
    }
    if (headerWidth === 1) return;
    if (candidate.length !== headerWidth) {
      tabularError(
        "CSV_MALFORMED",
        "CSV rows must have one consistent width for the resolved delimiter.",
        `csv.rows[${dataRowCount + 1}]`,
      );
    }
    dataRowCount += 1;
    if (dataRowCount > limits.maxRows) {
      tabularError(
        "ROW_LIMIT_EXCEEDED",
        `CSV data rows exceed maxRows=${limits.maxRows}.`,
        "csv.rows",
      );
    }
    dataCellCount += headerWidth;
    if (!Number.isSafeInteger(dataCellCount) || dataCellCount > limits.maxCells) {
      tabularError(
        "CELL_LIMIT_EXCEEDED",
        `CSV data cells exceed maxCells=${limits.maxCells}.`,
        "csv.rows",
      );
    }
    rows.push(candidate);
  };

  try {
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (inQuotes) {
        if (character === '"') {
          if (source[index + 1] === '"') {
            append('"');
            index += 1;
          } else {
            inQuotes = false;
            quoteClosed = true;
          }
        } else if (character !== undefined) {
          append(character);
        }
        lastWasRowTerminator = false;
        continue;
      }

      if (
        quoteClosed &&
        character !== delimiter &&
        character !== "\r" &&
        character !== "\n"
      ) {
        tabularError(
          "CSV_MALFORMED",
          "CSV quoted fields may only be followed by the resolved delimiter or a row terminator.",
          `csv.offset[${index}]`,
        );
      }
      if (character === '"') {
        if (field.length !== 0 || quoteClosed) {
          tabularError(
            "CSV_MALFORMED",
            "CSV quote appears inside an unquoted field.",
            `csv.offset[${index}]`,
          );
        }
        inQuotes = true;
        lastWasRowTerminator = false;
      } else if (character === delimiter) {
        finishField();
        lastWasRowTerminator = false;
      } else if (character === "\r" || character === "\n") {
        if (character === "\r" && source[index + 1] === "\n") index += 1;
        finishRow();
        lastWasRowTerminator = true;
      } else if (character !== undefined) {
        append(character);
        lastWasRowTerminator = false;
      }
    }

    if (inQuotes) {
      tabularError("CSV_MALFORMED", "CSV ends inside a quoted field.", "csv");
    }
    if (!lastWasRowTerminator || field.length > 0 || row.length > 0 || quoteClosed) {
      finishRow();
    }
    if (headerWidth === null) {
      tabularError("WORKSHEET_EMPTY", "CSV does not contain a header row.", "csv");
    }
    if (headerWidth === 1) return { kind: "single-column" };
    return {
      kind: "success",
      delimiter,
      rows,
      skippedBlankRowCount,
      width: headerWidth,
    };
  } catch (error) {
    if (!(error instanceof TabularImportError)) throw error;
    return {
      kind: "failure",
      error,
      sawMultiColumnHeader: headerWidth !== null && headerWidth > 1,
    };
  }
}

export function parseCsvRows(
  bytes: Uint8Array,
  limits: Readonly<TabularImportLimits>,
): ParsedCsvRows {
  const source = decodeCsvUtf8(bytes);
  const outcomes = DELIMITERS.map((delimiter) =>
    parseCandidate(source, delimiter, limits),
  );
  const successes = outcomes.filter(
    (outcome): outcome is CandidateSuccess => outcome.kind === "success",
  );
  if (successes.length > 0) {
    const widest = Math.max(...successes.map((candidate) => candidate.width));
    const selected = successes.find((candidate) => candidate.width === widest);
    if (selected === undefined) throw new Error("Unreachable CSV delimiter state.");
    return {
      delimiter: selected.delimiter,
      rows: selected.rows,
      skippedBlankRowCount: selected.skippedBlankRowCount,
    };
  }

  const plausibleFailure = outcomes.find(
    (outcome): outcome is CandidateFailure =>
      outcome.kind === "failure" && outcome.sawMultiColumnHeader,
  );
  if (plausibleFailure !== undefined) throw plausibleFailure.error;
  const universalFailure = outcomes.find(
    (outcome): outcome is CandidateFailure => outcome.kind === "failure",
  );
  if (outcomes.every((outcome) => outcome.kind === "failure") && universalFailure !== undefined) {
    throw universalFailure.error;
  }
  tabularError(
    "CSV_DELIMITER_AMBIGUOUS",
    "CSV delimiter could not be resolved: single-column input is ambiguous among comma, semicolon, and tab.",
    "csv.delimiter",
  );
}
