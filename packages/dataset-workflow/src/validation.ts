import { assertDatasetReceiptV1, type DatasetColumnRoleV1 } from "@3dena/analysis";
import type { RawScalar, WorksheetDescriptor, WorksheetSelection } from "@3dena/tabular-import";
import { workflowError } from "./errors";
import { isSha256, isWorkflowIdentity } from "./hash";
import type {
  ActivateDatasetRequestV1,
  BrowserPreflightReceiptV1,
  DatasetRoleMappingV1,
  DatasetWorkflowLimitsV1,
  ImmutableParsedRecordV1,
  ImmutableUploadRecordV1,
  ParseWorksheetRequestV1,
  PrepareDatasetRequestV1,
  StageUploadRequestV1,
  StoredActivationRecordV1,
  UploadIdentityV1,
  ParsedIdentityV1,
  WorkflowParsedWorksheetV1,
  WorkflowWorkbookInventoryV1,
} from "./types";

export function exactObject(
  value: unknown,
  fields: readonly string[],
  path: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    workflowError("INVALID_REQUEST", path, "must be an object");
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !fields.includes(key));
  const missing = fields.filter((key) => !(key in record));
  if (unknown.length > 0) {
    workflowError("UNKNOWN_FIELD", path, "contains an unsupported field");
  }
  if (missing.length > 0) {
    workflowError("INVALID_REQUEST", path, "is missing a required field");
  }
  return record;
}

export function positiveGeneration(value: unknown, path = "generation"): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    workflowError("INVALID_GENERATION", path, "must be a positive safe integer");
  }
  return value as number;
}

function exactWorksheet(
  value: unknown,
  path: string,
): WorksheetDescriptor {
  const record = exactObject(value, [
    "index",
    "name",
    "visibility",
    "kind",
    "selectable",
    "unselectableReason",
    "declaredRowCount",
    "declaredColumnCount",
  ], path);
  if (!Number.isSafeInteger(record.index) || Number(record.index) < 0
    || typeof record.name !== "string" || record.name.length < 1
    || !["visible", "hidden", "very-hidden"].includes(String(record.visibility))
    || !["worksheet", "macro", "dialog", "chart", "unknown"].includes(String(record.kind))
    || typeof record.selectable !== "boolean"
    || !(record.unselectableReason === null
      || record.unselectableReason === "hidden"
      || record.unselectableReason === "unsupported-sheet-kind")
    || !Number.isSafeInteger(record.declaredRowCount) || Number(record.declaredRowCount) < 0
    || !Number.isSafeInteger(record.declaredColumnCount) || Number(record.declaredColumnCount) < 0) {
    workflowError("PARSER_OUTPUT_INVALID", path, "contains an invalid worksheet descriptor");
  }
  const expectedSelectable = record.visibility === "visible" && record.kind === "worksheet";
  const expectedReason = record.visibility !== "visible"
    ? "hidden"
    : record.kind !== "worksheet"
      ? "unsupported-sheet-kind"
      : null;
  if (record.selectable !== expectedSelectable || record.unselectableReason !== expectedReason) {
    workflowError("PARSER_OUTPUT_INVALID", path, "contains inconsistent worksheet selection metadata");
  }
  return record as unknown as WorksheetDescriptor;
}

export function assertPreflightReceipt(
  value: unknown,
): asserts value is BrowserPreflightReceiptV1 {
  const receipt = exactObject(value, [
    "schemaVersion",
    "productStatus",
    "preflightIdentity",
    "declaredExtension",
    "format",
    "byteLength",
    "sha256",
    "limits",
  ], "preflight");
  if (receipt.schemaVersion !== "3dena.browser-preflight-receipt.v1"
    || receipt.productStatus !== "IMPLEMENTED_UNVERIFIED"
    || !isWorkflowIdentity(receipt.preflightIdentity, "preflight")
    || ![".csv", ".xlsx", ".xls"].includes(String(receipt.declaredExtension))
    || !["csv", "xlsx", "xls"].includes(String(receipt.format))
    || String(receipt.declaredExtension).slice(1) !== receipt.format
    || !Number.isSafeInteger(receipt.byteLength) || Number(receipt.byteLength) < 1
    || !isSha256(receipt.sha256)) {
    workflowError("INVALID_PREFLIGHT_RECEIPT", "preflight", "does not match the v1 receipt contract");
  }
  const limits = exactObject(receipt.limits, [
    "schemaVersion",
    "maxFileBytes",
    "maxWorksheets",
    "maxRows",
    "maxColumns",
    "maxCells",
    "maxStringLength",
    "maxZipEntries",
    "maxZipTotalUncompressedBytes",
    "maxZipEntryUncompressedBytes",
    "maxZipCompressionRatio",
    "maxZipPathDepth",
  ], "preflight.limits");
  if (limits.schemaVersion !== "3dena.dataset-workflow-limits.v1") {
    workflowError("INVALID_PREFLIGHT_RECEIPT", "preflight.limits", "has an invalid schemaVersion");
  }
}

export function assertStageRequest(
  value: unknown,
): asserts value is StageUploadRequestV1 {
  const request = exactObject(value, ["schemaVersion", "generation", "preflight", "bytes"], "request");
  if (request.schemaVersion !== "3dena.stage-upload-request.v1") {
    workflowError("INVALID_REQUEST", "request.schemaVersion", "must be the stage-upload v1 schema");
  }
  positiveGeneration(request.generation);
  assertPreflightReceipt(request.preflight);
  if (!(request.bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(request.bytes)) {
    workflowError("INVALID_REQUEST", "request.bytes", "must be an ArrayBuffer or view");
  }
}

function assertSelection(value: unknown): asserts value is WorksheetSelection | null {
  if (value === null) return;
  const selection = exactObject(value, ["index", "name"], "request.selection");
  if (!Number.isSafeInteger(selection.index) || Number(selection.index) < 0
    || typeof selection.name !== "string" || selection.name.length < 1) {
    workflowError("WORKSHEET_SELECTION_INVALID", "request.selection", "must bind an exact worksheet index and name");
  }
}

const ROLES = new Set<DatasetColumnRoleV1>([
  "unit",
  "conversation",
  "time",
  "code",
  "group",
  "metadata",
  "unmapped",
]);

export function assertRoleMapping(value: unknown): asserts value is DatasetRoleMappingV1 {
  const mapping = exactObject(value, ["schemaVersion", "columns"], "request.mapping");
  if (mapping.schemaVersion !== "3dena.dataset-role-mapping.v1" || !Array.isArray(mapping.columns)) {
    workflowError("MAPPING_INVALID", "request.mapping", "must match the role-mapping v1 schema");
  }
  mapping.columns.forEach((candidate, index) => {
    const assignment = exactObject(candidate, ["index", "header", "roles"], `request.mapping.columns[${index}]`);
    if (assignment.index !== index
      || typeof assignment.header !== "string"
      || assignment.header.length < 1
      || !Array.isArray(assignment.roles)
      || assignment.roles.length < 1
      || assignment.roles.some((role) => !ROLES.has(role as DatasetColumnRoleV1))
      || new Set(assignment.roles).size !== assignment.roles.length
      || (assignment.roles.includes("unmapped") && assignment.roles.length !== 1)) {
      workflowError("MAPPING_INVALID", `request.mapping.columns[${index}]`, "contains an invalid ordered role assignment");
    }
  });
}

export function assertParseWorksheetRequest(
  value: unknown,
): asserts value is ParseWorksheetRequestV1 {
  const request = exactObject(value, [
    "schemaVersion",
    "generation",
    "uploadIdentity",
    "selection",
  ], "request");
  if (request.schemaVersion !== "3dena.parse-worksheet-request.v1") {
    workflowError("INVALID_REQUEST", "request.schemaVersion", "must be the parse-worksheet v1 schema");
  }
  positiveGeneration(request.generation);
  if (!isWorkflowIdentity(request.uploadIdentity, "upload")) {
    workflowError("INVALID_IDENTITY", "request.uploadIdentity", "must be an immutable upload identity");
  }
  assertSelection(request.selection);
}

export function assertPrepareRequest(
  value: unknown,
): asserts value is PrepareDatasetRequestV1 {
  const request = exactObject(value, [
    "schemaVersion",
    "generation",
    "parsedIdentity",
    "mapping",
  ], "request");
  if (request.schemaVersion !== "3dena.prepare-dataset-request.v1") {
    workflowError("INVALID_REQUEST", "request.schemaVersion", "must be the prepare-dataset v1 schema");
  }
  positiveGeneration(request.generation);
  if (!isWorkflowIdentity(request.parsedIdentity, "parsed")) {
    workflowError("INVALID_IDENTITY", "request.parsedIdentity", "must be an immutable parsed identity");
  }
  assertRoleMapping(request.mapping);
}

export function assertActivateRequest(
  value: unknown,
): asserts value is ActivateDatasetRequestV1 {
  const request = exactObject(value, [
    "schemaVersion",
    "generation",
    "activationIdentity",
    "expectedActiveActivationIdentity",
  ], "request");
  if (request.schemaVersion !== "3dena.activate-dataset-request.v1") {
    workflowError("INVALID_REQUEST", "request.schemaVersion", "must be the activate-dataset v1 schema");
  }
  positiveGeneration(request.generation);
  if (!isWorkflowIdentity(request.activationIdentity, "activation")) {
    workflowError("INVALID_IDENTITY", "request.activationIdentity", "must be an immutable activation identity");
  }
  if (request.expectedActiveActivationIdentity !== null
    && !isWorkflowIdentity(request.expectedActiveActivationIdentity, "activation")) {
    workflowError("INVALID_IDENTITY", "request.expectedActiveActivationIdentity", "must be null or an immutable activation identity");
  }
}

function validateRows(
  rows: unknown,
  headers: readonly string[],
  path: string,
): asserts rows is readonly (readonly RawScalar[])[] {
  if (!Array.isArray(rows) || rows.length < 1) {
    workflowError("PARSER_OUTPUT_INVALID", path, "must contain at least one data row");
  }
  rows.forEach((candidate, rowIndex) => {
    if (!Array.isArray(candidate) || candidate.length !== headers.length) {
      workflowError("PARSER_OUTPUT_INVALID", `${path}[${rowIndex}]`, "does not align with headers");
    }
    candidate.forEach((value, columnIndex) => {
      if (!(value === null
        || typeof value === "string"
        || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value)))) {
        workflowError("PARSER_OUTPUT_INVALID", `${path}[${rowIndex}][${columnIndex}]`, "contains an unsupported scalar");
      }
    });
  });
}

export function validateInventory(
  value: unknown,
  expected: { format: string; byteLength: number; sha256: string; parserVersion: string },
): WorkflowWorkbookInventoryV1 {
  const inventory = exactObject(value, [
    "schemaVersion",
    "format",
    "byteLength",
    "sha256",
    "delimiter",
    "worksheets",
    "visibleSelectableWorksheetCount",
    "selectionPolicy",
    "hiddenWorksheetPolicy",
    "vbaDetectedAndDiscarded",
    "parserVersion",
  ], "parser.inventory");
  if (inventory.schemaVersion !== "3dena.workflow-workbook-inventory.v1"
    || inventory.format !== expected.format
    || inventory.byteLength !== expected.byteLength
    || inventory.sha256 !== expected.sha256
    || inventory.parserVersion !== expected.parserVersion
    || !(inventory.delimiter === null || [",", ";", "\t"].includes(String(inventory.delimiter)))
    || !Array.isArray(inventory.worksheets)
    || !Number.isSafeInteger(inventory.visibleSelectableWorksheetCount)
    || inventory.selectionPolicy !== "single-visible-auto-otherwise-explicit"
    || inventory.hiddenWorksheetPolicy !== "listed-not-selectable"
    || typeof inventory.vbaDetectedAndDiscarded !== "boolean") {
    workflowError("PARSER_OUTPUT_INVALID", "parser.inventory", "does not match the inspected upload contract");
  }
  const worksheets = inventory.worksheets.map((sheet, index) => exactWorksheet(sheet, `parser.inventory.worksheets[${index}]`));
  if (worksheets.length < 1
    || worksheets.some((sheet, index) => sheet.index !== index)
    || new Set(worksheets.map((sheet) => sheet.name)).size !== worksheets.length
    || worksheets.filter((sheet) => sheet.selectable).length !== inventory.visibleSelectableWorksheetCount) {
    workflowError("PARSER_OUTPUT_INVALID", "parser.inventory.worksheets", "has inconsistent worksheet order or counts");
  }
  return Object.freeze({
    schemaVersion: "3dena.workflow-workbook-inventory.v1",
    format: inventory.format as WorkflowWorkbookInventoryV1["format"],
    byteLength: inventory.byteLength as number,
    sha256: inventory.sha256 as string,
    delimiter: inventory.delimiter as WorkflowWorkbookInventoryV1["delimiter"],
    worksheets: Object.freeze(worksheets.map((sheet) => Object.freeze({ ...sheet }))),
    visibleSelectableWorksheetCount: inventory.visibleSelectableWorksheetCount as number,
    selectionPolicy: "single-visible-auto-otherwise-explicit",
    hiddenWorksheetPolicy: "listed-not-selectable",
    vbaDetectedAndDiscarded: inventory.vbaDetectedAndDiscarded as boolean,
    parserVersion: inventory.parserVersion as string,
  });
}

export function validateParsed(
  value: unknown,
  expected: { format: string; byteLength: number; sha256: string; parserVersion: string },
): WorkflowParsedWorksheetV1 {
  const parsed = exactObject(value, [
    "schemaVersion",
    "format",
    "byteLength",
    "sha256",
    "delimiter",
    "worksheet",
    "headers",
    "rows",
    "previewRows",
    "rowCount",
    "columnCount",
    "skippedBlankRowCount",
    "vbaDetectedAndDiscarded",
    "parserVersion",
  ], "parser.parsed");
  if (parsed.schemaVersion !== "3dena.workflow-parsed-worksheet.v1"
    || parsed.format !== expected.format
    || parsed.byteLength !== expected.byteLength
    || parsed.sha256 !== expected.sha256
    || parsed.parserVersion !== expected.parserVersion
    || !(parsed.delimiter === null || [",", ";", "\t"].includes(String(parsed.delimiter)))
    || !Array.isArray(parsed.headers)
    || parsed.headers.length < 1
    || parsed.headers.some((header) => typeof header !== "string" || header.length < 1)
    || new Set(parsed.headers).size !== parsed.headers.length
    || !Number.isSafeInteger(parsed.rowCount) || Number(parsed.rowCount) < 1
    || !Number.isSafeInteger(parsed.columnCount) || Number(parsed.columnCount) < 1
    || parsed.columnCount !== parsed.headers.length
    || !Number.isSafeInteger(parsed.skippedBlankRowCount) || Number(parsed.skippedBlankRowCount) < 0
    || typeof parsed.vbaDetectedAndDiscarded !== "boolean") {
    workflowError("PARSER_OUTPUT_INVALID", "parser.parsed", "does not match the parsed worksheet contract");
  }
  const worksheet = exactWorksheet(parsed.worksheet, "parser.parsed.worksheet");
  validateRows(parsed.rows, parsed.headers as string[], "parser.parsed.rows");
  if ((parsed.rows as unknown[]).length !== parsed.rowCount) {
    workflowError("PARSER_OUTPUT_INVALID", "parser.parsed.rowCount", "does not match rows");
  }
  if (!Array.isArray(parsed.previewRows) || parsed.previewRows.length > 6) {
    workflowError("PARSER_OUTPUT_INVALID", "parser.parsed.previewRows", "must contain at most six rows");
  }
  if (parsed.previewRows.length > 0) {
    validateRows(parsed.previewRows, parsed.headers as string[], "parser.parsed.previewRows");
  }
  return Object.freeze({
    schemaVersion: "3dena.workflow-parsed-worksheet.v1",
    format: parsed.format as WorkflowParsedWorksheetV1["format"],
    byteLength: parsed.byteLength as number,
    sha256: parsed.sha256 as string,
    delimiter: parsed.delimiter as WorkflowParsedWorksheetV1["delimiter"],
    worksheet: Object.freeze({ ...worksheet }),
    headers: Object.freeze([...(parsed.headers as string[])]),
    rows: Object.freeze((parsed.rows as RawScalar[][]).map((row) => Object.freeze([...row]))),
    previewRows: Object.freeze((parsed.previewRows as RawScalar[][]).map((row) => Object.freeze([...row]))),
    rowCount: parsed.rowCount as number,
    columnCount: parsed.columnCount as number,
    skippedBlankRowCount: parsed.skippedBlankRowCount as number,
    vbaDetectedAndDiscarded: parsed.vbaDetectedAndDiscarded as boolean,
    parserVersion: parsed.parserVersion as string,
  });
}

export function assertLimitsWithinReceipt(
  limits: DatasetWorkflowLimitsV1,
  byteLength: number,
): void {
  if (byteLength > limits.maxFileBytes) {
    workflowError("FILE_LIMIT_EXCEEDED", "preflight.byteLength", "exceeds the activated maxFileBytes limit");
  }
}

export function validateStoredUpload(
  value: unknown,
  expectedIdentity: UploadIdentityV1,
): ImmutableUploadRecordV1 {
  const upload = exactObject(value, [
    "schemaVersion",
    "uploadIdentity",
    "format",
    "byteLength",
    "sha256",
    "bytes",
  ], "storage.upload");
  if (upload.schemaVersion !== "3dena.immutable-upload-record.v1"
    || upload.uploadIdentity !== expectedIdentity
    || !isWorkflowIdentity(upload.uploadIdentity, "upload")
    || !["csv", "xlsx", "xls"].includes(String(upload.format))
    || !Number.isSafeInteger(upload.byteLength) || Number(upload.byteLength) < 1
    || !isSha256(upload.sha256)
    || (!(upload.bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(upload.bytes))) {
    workflowError("UPLOAD_CUSTODY_MISMATCH", "storage.upload", "does not match the immutable upload record contract");
  }
  const source = upload.bytes instanceof ArrayBuffer
    ? new Uint8Array(upload.bytes)
    : new Uint8Array(upload.bytes.buffer, upload.bytes.byteOffset, upload.bytes.byteLength);
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  return Object.freeze({
    schemaVersion: "3dena.immutable-upload-record.v1",
    uploadIdentity: upload.uploadIdentity as ImmutableUploadRecordV1["uploadIdentity"],
    format: upload.format as ImmutableUploadRecordV1["format"],
    byteLength: upload.byteLength as number,
    sha256: upload.sha256 as string,
    bytes,
  });
}

export function validateStoredParsed(
  value: unknown,
  expectedIdentity: ParsedIdentityV1,
): ImmutableParsedRecordV1 {
  const parsed = exactObject(value, [
    "schemaVersion",
    "uploadIdentity",
    "parsedIdentity",
    "parsedContentSha256",
    "parserVersion",
    "format",
    "delimiter",
    "worksheet",
    "headers",
    "rows",
    "rowCount",
    "columnCount",
    "skippedBlankRowCount",
    "vbaDetectedAndDiscarded",
  ], "storage.parsed");
  if (parsed.schemaVersion !== "3dena.immutable-parsed-record.v1"
    || parsed.parsedIdentity !== expectedIdentity
    || !isWorkflowIdentity(parsed.parsedIdentity, "parsed")
    || !isSha256(parsed.parsedContentSha256)
    || !isWorkflowIdentity(parsed.uploadIdentity, "upload")
    || typeof parsed.parserVersion !== "string" || parsed.parserVersion.length < 1
    || !["csv", "xlsx", "xls"].includes(String(parsed.format))
    || !(parsed.delimiter === null || [",", ";", "\t"].includes(String(parsed.delimiter)))
    || !Array.isArray(parsed.headers) || parsed.headers.length < 1
    || parsed.headers.some((header) => typeof header !== "string" || header.length < 1)
    || new Set(parsed.headers).size !== parsed.headers.length
    || !Number.isSafeInteger(parsed.rowCount) || Number(parsed.rowCount) < 1
    || !Number.isSafeInteger(parsed.columnCount) || Number(parsed.columnCount) !== parsed.headers.length
    || !Number.isSafeInteger(parsed.skippedBlankRowCount) || Number(parsed.skippedBlankRowCount) < 0
    || typeof parsed.vbaDetectedAndDiscarded !== "boolean") {
    workflowError("PARSED_NOT_FOUND", "storage.parsed", "does not match the immutable parsed record contract");
  }
  const worksheet = exactWorksheet(parsed.worksheet, "storage.parsed.worksheet");
  validateRows(parsed.rows, parsed.headers as string[], "storage.parsed.rows");
  if ((parsed.rows as unknown[]).length !== parsed.rowCount) {
    workflowError("PARSED_NOT_FOUND", "storage.parsed.rowCount", "does not match stored rows");
  }
  return Object.freeze({
    schemaVersion: "3dena.immutable-parsed-record.v1",
    uploadIdentity: parsed.uploadIdentity as ImmutableParsedRecordV1["uploadIdentity"],
    parsedIdentity: parsed.parsedIdentity as ImmutableParsedRecordV1["parsedIdentity"],
    parsedContentSha256: parsed.parsedContentSha256 as string,
    parserVersion: parsed.parserVersion as string,
    format: parsed.format as ImmutableParsedRecordV1["format"],
    delimiter: parsed.delimiter as ImmutableParsedRecordV1["delimiter"],
    worksheet: Object.freeze({ ...worksheet }),
    headers: Object.freeze([...(parsed.headers as string[])]),
    rows: Object.freeze((parsed.rows as RawScalar[][]).map((row) => Object.freeze([...row]))),
    rowCount: parsed.rowCount as number,
    columnCount: parsed.columnCount as number,
    skippedBlankRowCount: parsed.skippedBlankRowCount as number,
    vbaDetectedAndDiscarded: parsed.vbaDetectedAndDiscarded as boolean,
  });
}

export function validateStoredActivation(
  value: unknown,
): StoredActivationRecordV1 {
  const activation = exactObject(value, ["schemaVersion", "handle", "mapping"], "storage.active");
  if (activation.schemaVersion !== "3dena.stored-activation-record.v1") {
    workflowError("ACTIVATION_STORAGE_FAILURE", "storage.active.schemaVersion", "is unsupported");
  }
  const handle = exactObject(activation.handle, [
    "schemaVersion",
    "productStatus",
    "generation",
    "uploadIdentity",
    "parsedIdentity",
    "activationIdentity",
    "receipt",
  ], "storage.active.handle");
  if (handle.schemaVersion !== "3dena.active-dataset-handle.v1"
    || handle.productStatus !== "IMPLEMENTED_UNVERIFIED"
    || !Number.isSafeInteger(handle.generation) || Number(handle.generation) < 1
    || !isWorkflowIdentity(handle.uploadIdentity, "upload")
    || !isWorkflowIdentity(handle.parsedIdentity, "parsed")
    || !isWorkflowIdentity(handle.activationIdentity, "activation")) {
    workflowError("ACTIVATION_STORAGE_FAILURE", "storage.active.handle", "is invalid");
  }
  assertDatasetReceiptV1(handle.receipt, "storage.active.handle.receipt");
  if ((handle.receipt as { activationIdentity: string }).activationIdentity !== handle.activationIdentity) {
    workflowError("ACTIVATION_STORAGE_FAILURE", "storage.active.handle", "has inconsistent activation identity");
  }
  assertRoleMapping(activation.mapping);
  const receipt = structuredClone(handle.receipt) as StoredActivationRecordV1["handle"]["receipt"];
  const mapping = activation.mapping as DatasetRoleMappingV1;
  return Object.freeze({
    schemaVersion: "3dena.stored-activation-record.v1",
    handle: Object.freeze({
      schemaVersion: "3dena.active-dataset-handle.v1",
      productStatus: "IMPLEMENTED_UNVERIFIED",
      generation: handle.generation as number,
      uploadIdentity: handle.uploadIdentity as StoredActivationRecordV1["handle"]["uploadIdentity"],
      parsedIdentity: handle.parsedIdentity as StoredActivationRecordV1["handle"]["parsedIdentity"],
      activationIdentity: handle.activationIdentity as StoredActivationRecordV1["handle"]["activationIdentity"],
      receipt,
    }),
    mapping: Object.freeze({
      schemaVersion: "3dena.dataset-role-mapping.v1",
      columns: Object.freeze(mapping.columns.map((column) => Object.freeze({
        index: column.index,
        header: column.header,
        roles: Object.freeze([...column.roles]),
      }))),
    }),
  });
}
