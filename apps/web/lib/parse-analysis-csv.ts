import {
  DEFAULT_ANALYSIS_LIMITS,
  type RawRow,
  type RawScalar,
} from "@3dena/analysis";
import Papa from "papaparse";
import type { AnalysisMapping } from "@/lib/analysis-contract";

export interface CsvLexemeTable {
  headers: string[];
  dataRows: string[][];
}

function parseCodeLexeme(
  value: string,
  rowNumber: number,
  column: string,
): RawScalar {
  const trimmed = value.trim();
  if (/^(?:true|false)$/iu.test(trimmed)) {
    return trimmed.toLowerCase() === "true";
  }
  const numeric = Number(trimmed);
  if (trimmed !== "" && Number.isFinite(numeric) && numeric >= 0) {
    return numeric;
  }
  throw new Error(
    `CSV row ${rowNumber}, code column “${column}” must be a finite non-negative number or boolean.`,
  );
}

/**
 * Parse the complete CSV into uncoerced string lexemes and validate its shape.
 * Keeping this separate lets file import validate a candidate transaction once,
 * while the analysis Worker can independently parse its immutable snapshot.
 */
export function parseCsvLexemeTable(csvText: string): CsvLexemeTable {
  const parsed = Papa.parse<string[]>(csvText, {
    header: false,
    dynamicTyping: false,
    skipEmptyLines: "greedy",
  });

  if (parsed.errors.length > 0) {
    const detail = parsed.errors
      .slice(0, 3)
      .map((error) => `row ${error.row ?? "?"}: ${error.message}`)
      .join("; ");
    throw new Error(`CSV parsing failed: ${detail}`);
  }

  const headerRow = parsed.data[0];
  if (!headerRow || headerRow.length === 0) {
    throw new Error("The CSV file does not contain a header row.");
  }
  if (headerRow.length > DEFAULT_ANALYSIS_LIMITS.maxColumns) {
    throw new Error(
      `CSV has ${headerRow.length} columns; maximum is ${DEFAULT_ANALYSIS_LIMITS.maxColumns}.`,
    );
  }
  const headers = headerRow.map((header, index) => {
    if (header.length > DEFAULT_ANALYSIS_LIMITS.maxStringLength) {
      throw new Error(
        `CSV header column ${index + 1} length exceeds maxStringLength=${DEFAULT_ANALYSIS_LIMITS.maxStringLength}.`,
      );
    }
    const normalized = header.replace(/^\uFEFF/u, "").trim();
    if (!normalized) {
      throw new Error(`CSV column ${index + 1} has an empty header.`);
    }
    return normalized;
  });
  if (new Set(headers).size !== headers.length) {
    throw new Error("CSV headers must be unique.");
  }

  const dataRows = parsed.data.slice(1);
  if (dataRows.length === 0) {
    throw new Error("The CSV file must contain at least one data row.");
  }
  if (dataRows.length > DEFAULT_ANALYSIS_LIMITS.maxRows) {
    throw new Error(
      `CSV has ${dataRows.length} data rows; maximum is ${DEFAULT_ANALYSIS_LIMITS.maxRows}.`,
    );
  }
  const cellCount = dataRows.length * headers.length;
  if (
    !Number.isSafeInteger(cellCount) ||
    cellCount > DEFAULT_ANALYSIS_LIMITS.maxCells
  ) {
    throw new Error(
      `CSV has ${cellCount} data cells; maximum is ${DEFAULT_ANALYSIS_LIMITS.maxCells}.`,
    );
  }
  dataRows.forEach((cells, rowIndex) => {
    if (cells.length !== headers.length) {
      throw new Error(
        `CSV row ${rowIndex + 2} has ${cells.length} cells; expected ${headers.length}.`,
      );
    }
    cells.forEach((lexeme, columnIndex) => {
      if (lexeme.length > DEFAULT_ANALYSIS_LIMITS.maxStringLength) {
        throw new Error(
          `CSV row ${rowIndex + 2}, column “${headers[columnIndex] ?? columnIndex + 1}” length exceeds maxStringLength=${DEFAULT_ANALYSIS_LIMITS.maxStringLength}.`,
        );
      }
    });
  });

  return { headers, dataRows };
}

export function materializeAnalysisRows(
  table: CsvLexemeTable,
  mapping: AnalysisMapping,
): RawRow[] {
  const codeColumns = new Set(mapping.codeColumns);
  return table.dataRows.map((cells, rowIndex) => {
    const row: RawRow = {};
    table.headers.forEach((header, columnIndex) => {
      const lexeme = cells[columnIndex];
      if (lexeme === undefined) {
        throw new Error(
          `CSV row ${rowIndex + 2}, column “${header}” is missing.`,
        );
      }
      row[header] = codeColumns.has(header)
        ? parseCodeLexeme(lexeme, rowIndex + 2, header)
        : lexeme;
    });
    return row;
  });
}

/**
 * Parse CSV for analysis without ever auto-coercing identity-bearing lexemes.
 * Only columns explicitly mapped as codes can become numbers or booleans.
 */
export function parseAnalysisCsv(
  csvText: string,
  mapping: AnalysisMapping,
): RawRow[] {
  return materializeAnalysisRows(parseCsvLexemeTable(csvText), mapping);
}
