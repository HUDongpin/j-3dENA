import {
  inspectTabularSource,
  parseTabularWorksheet,
  type ParsedTabularWorksheet,
  type TabularImportFormat,
  type WorkbookInventory,
  type WorksheetDescriptor,
} from "@3dena/tabular-import";
import { parserLimits } from "./limits";
import type {
  DatasetWorkflowParser,
  ParserInspectRequestV1,
  ParserParseRequestV1,
  WorkflowParsedWorksheetV1,
  WorkflowWorkbookInventoryV1,
} from "./types";

export const TABULAR_IMPORT_PARSER_VERSION =
  "3dena.tabular-import-adapter.v1" as const;

function syntheticName(format: TabularImportFormat): string {
  return `workflow-source.${format}`;
}

function cloneWorksheet(
  worksheet: WorksheetDescriptor,
): WorksheetDescriptor {
  return Object.freeze({ ...worksheet });
}

function inventoryResult(
  inventory: WorkbookInventory,
): WorkflowWorkbookInventoryV1 {
  return Object.freeze({
    schemaVersion: "3dena.workflow-workbook-inventory.v1",
    format: inventory.receipt.format,
    byteLength: inventory.receipt.byteLength,
    sha256: inventory.receipt.sha256,
    delimiter: inventory.receipt.delimiter,
    worksheets: Object.freeze(inventory.worksheets.map(cloneWorksheet)),
    visibleSelectableWorksheetCount: inventory.visibleSelectableWorksheetCount,
    selectionPolicy: inventory.selectionPolicy,
    hiddenWorksheetPolicy: inventory.hiddenWorksheetPolicy,
    vbaDetectedAndDiscarded: inventory.vbaDetectedAndDiscarded,
    parserVersion: TABULAR_IMPORT_PARSER_VERSION,
  });
}

function parsedResult(
  parsed: ParsedTabularWorksheet,
): WorkflowParsedWorksheetV1 {
  return Object.freeze({
    schemaVersion: "3dena.workflow-parsed-worksheet.v1",
    format: parsed.receipt.format,
    byteLength: parsed.receipt.byteLength,
    sha256: parsed.receipt.sha256,
    delimiter: parsed.receipt.delimiter,
    worksheet: cloneWorksheet(parsed.worksheet),
    headers: Object.freeze([...parsed.headers]),
    rows: Object.freeze(parsed.rows.map((row) => Object.freeze([...row]))),
    previewRows: Object.freeze(parsed.previewRows.map((row) => Object.freeze([...row]))),
    rowCount: parsed.rowCount,
    columnCount: parsed.columnCount,
    skippedBlankRowCount: parsed.skippedBlankRowCount,
    vbaDetectedAndDiscarded: parsed.vbaDetectedAndDiscarded,
    parserVersion: TABULAR_IMPORT_PARSER_VERSION,
  });
}

export function createTabularImportParserAdapter(): DatasetWorkflowParser {
  return Object.freeze({
    parserVersion: TABULAR_IMPORT_PARSER_VERSION,
    async inspect(request: ParserInspectRequestV1) {
      const inventory = await inspectTabularSource(
        {
          name: syntheticName(request.format),
          bytes: request.bytes,
        },
        { limits: parserLimits(request.limits) },
      );
      return inventoryResult(inventory);
    },
    async parse(request: ParserParseRequestV1) {
      const parsed = await parseTabularWorksheet({
        name: syntheticName(request.format),
        bytes: request.bytes,
        expectedSha256: request.expectedSha256,
        selection: request.selection,
        limits: parserLimits(request.limits),
      });
      return parsedResult(parsed);
    },
  });
}
