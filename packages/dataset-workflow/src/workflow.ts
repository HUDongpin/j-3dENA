import {
  assertDatasetReceiptV1,
  type DatasetColumnRoleV1,
  type DatasetLimitsReceiptV1,
  type DatasetReceiptV1,
} from "@3dena/analysis";
import { DatasetWorkflowError, workflowError } from "./errors";
import {
  activationIdentity as createActivationIdentity,
  formatForExtension,
  isWorkflowIdentity,
  ownedBytes,
  parsedIdentity as createParsedIdentity,
  parsedContentSha256 as createParsedContentSha256,
  preflightIdentity as createPreflightIdentity,
  rejectRWorkspaceBytes,
  sha256Bytes,
  uploadIdentity as createUploadIdentity,
} from "./hash";
import {
  assertDatasetWorkflowLimitsWithinPolicy,
  resolveDatasetWorkflowLimits,
} from "./limits";
import { materializeMappedRows, shapeDataset } from "./shaping";
import type {
  ActivateDatasetRequestV1,
  ActiveDatasetHandleV1,
  ActiveDatasetPayloadV1,
  ActivationIdentityV1,
  BrowserPreflightInputV1,
  BrowserPreflightReceiptV1,
  DatasetActivationResultV1,
  DatasetRoleMappingV1,
  DatasetWorkflowDependencies,
  DatasetWorkflowLimitsV1,
  DatasetWorkflowSnapshotV1,
  GenerationClaimOutcomeV1,
  ImmutableParsedRecordV1,
  ImmutableUploadRecordV1,
  InspectedDatasetCandidateV1,
  ParsedIdentityV1,
  ParsedWorksheetCandidateV1,
  ParseWorksheetRequestV1,
  PreparedDatasetCandidateV1,
  PrepareDatasetRequestV1,
  StageUploadRequestV1,
  StoredActivationRecordV1,
  UploadIdentityV1,
  WorkflowAuditEventTypeV1,
  WorkflowAuditEventV1,
  WorkflowDiagnosticV1,
  WorkflowParsedWorksheetV1,
  WorkflowWorkbookInventoryV1,
} from "./types";
import {
  assertActivateRequest,
  assertLimitsWithinReceipt,
  assertParseWorksheetRequest,
  assertPrepareRequest,
  assertPreflightReceipt,
  assertStageRequest,
  exactObject,
  validateInventory,
  validateParsed,
  validateStoredActivation,
  validateStoredParsed,
  validateStoredUpload,
} from "./validation";

interface InternalPreparedCandidate {
  readonly result: PreparedDatasetCandidateV1;
  readonly mapping: DatasetRoleMappingV1;
}

function freezeMapping(mapping: DatasetRoleMappingV1): DatasetRoleMappingV1 {
  return Object.freeze({
    schemaVersion: "3dena.dataset-role-mapping.v1",
    columns: Object.freeze(mapping.columns.map((column) => Object.freeze({
      index: column.index,
      header: column.header,
      roles: Object.freeze([...column.roles]),
    }))),
  });
}

function limitsWithoutSchema(
  limits: DatasetWorkflowLimitsV1,
): Omit<DatasetWorkflowLimitsV1, "schemaVersion"> {
  const {
    schemaVersion: _schemaVersion,
    ...values
  } = limits;
  return values;
}

function primaryLimits(
  limits: DatasetWorkflowLimitsV1,
): DatasetLimitsReceiptV1 {
  return Object.freeze({
    schemaVersion: "3dena.dataset-limits.v1",
    maxFileBytes: limits.maxFileBytes,
    maxWorksheets: limits.maxWorksheets,
    maxRows: limits.maxRows,
    maxColumns: limits.maxColumns,
    maxCells: limits.maxCells,
  });
}

function clonePreflight(
  receipt: BrowserPreflightReceiptV1,
  limits: DatasetWorkflowLimitsV1,
): BrowserPreflightReceiptV1 {
  return Object.freeze({
    schemaVersion: "3dena.browser-preflight-receipt.v1",
    productStatus: "IMPLEMENTED_UNVERIFIED",
    preflightIdentity: receipt.preflightIdentity,
    declaredExtension: receipt.declaredExtension,
    format: receipt.format,
    byteLength: receipt.byteLength,
    sha256: receipt.sha256,
    limits,
  });
}

function cloneHandle(handle: ActiveDatasetHandleV1): ActiveDatasetHandleV1 {
  return structuredClone(handle);
}

function cloneActive(
  record: StoredActivationRecordV1 | null,
): ActiveDatasetHandleV1 | null {
  return record ? cloneHandle(record.handle) : null;
}

function adapterFailure(
  error: unknown,
  code: DatasetWorkflowError["code"],
  path: string,
  message: string,
): DatasetWorkflowError {
  return new DatasetWorkflowError(
    error instanceof DatasetWorkflowError ? error.code : code,
    path,
    message,
  );
}

function warningCodes(
  diagnostics: readonly WorkflowDiagnosticV1[],
): string[] {
  return [...new Set(diagnostics
    .filter((diagnostic) => diagnostic.severity === "warning")
    .map((diagnostic) => diagnostic.code))];
}

function assertInventoryLimits(
  inventory: WorkflowWorkbookInventoryV1,
  limits: DatasetWorkflowLimitsV1,
): void {
  if (inventory.worksheets.length > limits.maxWorksheets) {
    workflowError("PARSER_OUTPUT_INVALID", "parser.inventory.worksheets", "exceeds maxWorksheets");
  }
  for (const [index, worksheet] of inventory.worksheets.entries()) {
    const dataRows = Math.max(0, worksheet.declaredRowCount - 1);
    const cells = dataRows * worksheet.declaredColumnCount;
    if (worksheet.name.length > limits.maxStringLength
      || worksheet.declaredColumnCount > limits.maxColumns
      || dataRows > limits.maxRows
      || !Number.isSafeInteger(cells)
      || cells > limits.maxCells) {
      workflowError(
        "PARSER_OUTPUT_INVALID",
        `parser.inventory.worksheets[${index}]`,
        "declares dimensions above the activated limits",
      );
    }
  }
}

function assertParsedLimits(
  parsed: WorkflowParsedWorksheetV1,
  limits: DatasetWorkflowLimitsV1,
): void {
  const cells = parsed.rowCount * parsed.columnCount;
  if (parsed.rowCount > limits.maxRows
    || parsed.columnCount > limits.maxColumns
    || !Number.isSafeInteger(cells)
    || cells > limits.maxCells
    || parsed.worksheet.name.length > limits.maxStringLength
    || parsed.headers.some((header) => header.length > limits.maxStringLength)
    || parsed.rows.some((row) => row.some((value) =>
      typeof value === "string" && value.length > limits.maxStringLength))
    || parsed.worksheet.declaredRowCount < parsed.rowCount + 1
    || parsed.worksheet.declaredColumnCount < parsed.columnCount) {
    workflowError("PARSER_OUTPUT_INVALID", "parser.parsed", "exceeds activated row, column, cell, or string limits");
  }
}

function assertParsedSelection(
  parsed: WorkflowParsedWorksheetV1,
  inventory: WorkflowWorkbookInventoryV1,
  selection: ParseWorksheetRequestV1["selection"],
): void {
  const expected = selection === null
    ? inventory.worksheets.find((worksheet) => worksheet.selectable)
    : inventory.worksheets[selection.index];
  if (!expected
    || parsed.worksheet.index !== expected.index
    || parsed.worksheet.name !== expected.name
    || !parsed.worksheet.selectable) {
    workflowError(
      "PARSER_OUTPUT_INVALID",
      "parser.parsed.worksheet",
      "does not match the exact selected worksheet",
    );
  }
}

function assertSelectionAgainstInventory(
  inventory: WorkflowWorkbookInventoryV1,
  selection: ParseWorksheetRequestV1["selection"],
): void {
  const selectable = inventory.worksheets.filter((worksheet) => worksheet.selectable);
  if (selection === null) {
    if (selectable.length !== 1) {
      workflowError(
        "WORKSHEET_SELECTION_INVALID",
        "request.selection",
        "null selection requires exactly one selectable worksheet",
      );
    }
    return;
  }
  const selected = inventory.worksheets[selection.index];
  if (!selected || selected.name !== selection.name || !selected.selectable) {
    workflowError(
      "WORKSHEET_SELECTION_INVALID",
      "request.selection",
      "must exactly match an inspected selectable worksheet",
    );
  }
}

export async function createBrowserPreflightReceipt(
  input: BrowserPreflightInputV1,
): Promise<BrowserPreflightReceiptV1> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    workflowError("INVALID_REQUEST", "input", "must be an object");
  }
  const record = input as unknown as Record<string, unknown>;
  const allowed = ["schemaVersion", "declaredExtension", "bytes", "limits"];
  const unknown = Object.keys(record).filter((field) => !allowed.includes(field));
  if (unknown.length > 0) {
    workflowError("UNKNOWN_FIELD", "input", "contains an unsupported field");
  }
  for (const required of ["schemaVersion", "declaredExtension", "bytes"]) {
    if (!(required in record)) {
      workflowError("INVALID_REQUEST", "input", "is missing a required field");
    }
  }
  if (record.schemaVersion !== "3dena.browser-preflight-input.v1") {
    workflowError("INVALID_REQUEST", "input.schemaVersion", "must be the browser-preflight v1 schema");
  }
  const { extension, format } = formatForExtension(record.declaredExtension);
  const limits = resolveDatasetWorkflowLimits(record.limits);
  const bytes = ownedBytes(record.bytes as ArrayBuffer | ArrayBufferView, limits.maxFileBytes);
  rejectRWorkspaceBytes(bytes);
  const sha256 = await sha256Bytes(bytes);
  const preflightIdentity = await createPreflightIdentity({
    format,
    byteLength: bytes.byteLength,
    sha256,
    limits,
  });
  return Object.freeze({
    schemaVersion: "3dena.browser-preflight-receipt.v1",
    productStatus: "IMPLEMENTED_UNVERIFIED",
    preflightIdentity,
    declaredExtension: extension,
    format,
    byteLength: bytes.byteLength,
    sha256,
    limits,
  });
}

export class DatasetWorkflow {
  readonly #storage: DatasetWorkflowDependencies["storage"];
  readonly #parser: DatasetWorkflowDependencies["parser"];
  readonly #audit: DatasetWorkflowDependencies["audit"] | undefined;
  readonly #policyLimits: DatasetWorkflowLimitsV1;
  readonly #generationBindings = new Map<number, string>();
  readonly #inspected = new Map<number, InspectedDatasetCandidateV1>();
  readonly #parsedCandidates = new Map<number, Map<ParsedIdentityV1, ParsedWorksheetCandidateV1>>();
  readonly #prepared = new Map<ActivationIdentityV1, InternalPreparedCandidate>();
  #latestGeneration = 0;

  constructor(dependencies: DatasetWorkflowDependencies) {
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
      workflowError("INVALID_REQUEST", "dependencies", "must be an object");
    }
    const dependencyValue = dependencies as unknown as Record<string, unknown>;
    const fields = ["storage", "parser"];
    if (Object.prototype.hasOwnProperty.call(dependencyValue, "audit")) fields.push("audit");
    if (Object.prototype.hasOwnProperty.call(dependencyValue, "limits")) fields.push("limits");
    const record = exactObject(
      dependencies,
      fields,
      "dependencies",
    );
    const storageMethods = [
      "claimGeneration",
      "isGenerationCurrent",
      "putUpload",
      "readUpload",
      "putParsed",
      "readParsed",
      "activateAtomic",
      "readActive",
    ];
    if (!record.storage || typeof record.storage !== "object"
      || !record.parser || typeof record.parser !== "object"
      || typeof (record.parser as { parserVersion?: unknown }).parserVersion !== "string"
      || (record.parser as { parserVersion: string }).parserVersion.length < 1
      || typeof (record.parser as { inspect?: unknown }).inspect !== "function"
      || typeof (record.parser as { parse?: unknown }).parse !== "function"
      || storageMethods.some((method) =>
        typeof (record.storage as Record<string, unknown>)[method] !== "function")
      || (record.audit !== undefined
        && (!record.audit || typeof record.audit !== "object"
          || typeof (record.audit as { record?: unknown }).record !== "function"))) {
      workflowError("INVALID_REQUEST", "dependencies", "requires storage and versioned parser adapters");
    }
    this.#storage = dependencies.storage;
    this.#parser = dependencies.parser;
    this.#audit = dependencies.audit;
    this.#policyLimits = resolveDatasetWorkflowLimits(record.limits);
  }

  #emit(
    event: WorkflowAuditEventTypeV1,
    generation: number,
    identity: WorkflowAuditEventV1["identity"],
    outcome: WorkflowAuditEventV1["outcome"],
    errorCode: WorkflowAuditEventV1["errorCode"] = null,
  ): void {
    try {
      this.#audit?.record(Object.freeze({
        schemaVersion: "3dena.dataset-workflow-audit-event.v1",
        productStatus: "IMPLEMENTED_UNVERIFIED",
        event,
        generation,
        identity,
        outcome,
        errorCode,
      }));
    } catch {
      // Audit adapter failure cannot mutate or block the scientific dataset state.
    }
  }

  async #isCurrent(generation: number): Promise<boolean> {
    try {
      const current = await this.#storage.isGenerationCurrent(generation);
      if (typeof current !== "boolean") {
        workflowError(
          "ACTIVATION_STORAGE_FAILURE",
          "storage.isGenerationCurrent",
          "returned a non-boolean generation result",
        );
      }
      return current;
    } catch (error) {
      throw adapterFailure(
        error,
        "ACTIVATION_STORAGE_FAILURE",
        "storage.generation",
        "generation fencing adapter failed",
      );
    }
  }

  async stageUpload(request: StageUploadRequestV1): Promise<InspectedDatasetCandidateV1> {
    let generation = 0;
    try {
      assertStageRequest(request);
      generation = request.generation;
      const limits = resolveDatasetWorkflowLimits(limitsWithoutSchema(request.preflight.limits));
      assertDatasetWorkflowLimitsWithinPolicy(limits, this.#policyLimits);
      const preflight = clonePreflight(request.preflight, limits);
      assertLimitsWithinReceipt(limits, preflight.byteLength);
      // Own the service-side byte snapshot before the first await. Browser
      // receipt custody and server custody are intentionally independent.
      const bytes = ownedBytes(request.bytes, limits.maxFileBytes);
      rejectRWorkspaceBytes(bytes);
      const expectedPreflightIdentity = await createPreflightIdentity({
        format: preflight.format,
        byteLength: preflight.byteLength,
        sha256: preflight.sha256,
        limits,
      });
      if (expectedPreflightIdentity !== preflight.preflightIdentity) {
        workflowError(
          "INVALID_PREFLIGHT_RECEIPT",
          "preflight.preflightIdentity",
          "does not bind the exact receipt fields",
        );
      }
      const bound = this.#generationBindings.get(generation);
      if (bound !== undefined && bound !== preflight.preflightIdentity) {
        workflowError(
          "GENERATION_CONFLICT",
          "generation",
          "is already bound to a different preflight identity",
        );
      }
      this.#generationBindings.set(generation, preflight.preflightIdentity);
      this.#limitsByPreflight.set(preflight.preflightIdentity, limits);
      let claim: GenerationClaimOutcomeV1;
      try {
        claim = await this.#storage.claimGeneration(generation);
      } catch (error) {
        throw adapterFailure(error, "UPLOAD_STORAGE_FAILURE", "storage.claimGeneration", "generation claim failed");
      }
      if (!(["claimed", "current", "stale"] as unknown[]).includes(claim)) {
        workflowError("UPLOAD_STORAGE_FAILURE", "storage.claimGeneration", "returned an unknown outcome");
      }
      if (claim === "stale") {
        workflowError("STALE_GENERATION", "generation", "is older than the storage generation fence");
      }
      this.#latestGeneration = Math.max(this.#latestGeneration, generation);
      this.#emit("generation-claimed", generation, preflight.preflightIdentity, "ok");

      const serverSha256 = await sha256Bytes(bytes);
      if (bytes.byteLength !== preflight.byteLength) {
        workflowError(
          "BROWSER_SERVER_BYTE_LENGTH_MISMATCH",
          "preflight.byteLength",
          "does not match the server-owned exact bytes",
        );
      }
      if (serverSha256 !== preflight.sha256) {
        workflowError(
          "BROWSER_SERVER_SHA256_MISMATCH",
          "preflight.sha256",
          "does not match the server-owned exact bytes",
        );
      }
      if (!(await this.#isCurrent(generation))) {
        workflowError("STALE_GENERATION", "generation", "became stale before upload custody");
      }
      const uploadIdentity = createUploadIdentity(serverSha256);
      const uploadRecord: ImmutableUploadRecordV1 = {
        schemaVersion: "3dena.immutable-upload-record.v1",
        uploadIdentity,
        format: preflight.format,
        byteLength: bytes.byteLength,
        sha256: serverSha256,
        bytes: ownedBytes(bytes, limits.maxFileBytes),
      };
      try {
        const outcome = await this.#storage.putUpload(uploadRecord);
        if (outcome !== "created" && outcome !== "existing") {
          workflowError("UPLOAD_STORAGE_FAILURE", "storage.putUpload", "returned an unknown outcome");
        }
      } catch (error) {
        throw adapterFailure(error, "UPLOAD_STORAGE_FAILURE", "storage.putUpload", "immutable upload write failed");
      }
      this.#emit("upload-verified", generation, uploadIdentity, "ok");

      let inventoryValue: unknown;
      try {
        inventoryValue = await this.#parser.inspect({
          format: preflight.format,
          bytes: ownedBytes(bytes, limits.maxFileBytes),
          expectedSha256: serverSha256,
          limits,
        });
      } catch (error) {
        throw adapterFailure(error, "PARSER_INSPECTION_FAILURE", "parser.inspect", "parser inspection failed");
      }
      const inventory = validateInventory(inventoryValue, {
        format: preflight.format,
        byteLength: bytes.byteLength,
        sha256: serverSha256,
        parserVersion: this.#parser.parserVersion,
      });
      assertInventoryLimits(inventory, limits);
      if (!(await this.#isCurrent(generation))) {
        workflowError("STALE_GENERATION", "generation", "became stale before inventory publication");
      }
      const result: InspectedDatasetCandidateV1 = Object.freeze({
        schemaVersion: "3dena.inspected-dataset-candidate.v1",
        productStatus: "IMPLEMENTED_UNVERIFIED",
        generation,
        preflightIdentity: preflight.preflightIdentity,
        uploadIdentity,
        inventory,
      });
      this.#inspected.set(generation, result);
      this.#emit("inventory-inspected", generation, uploadIdentity, "ok");
      return result;
    } catch (error) {
      const safe = error instanceof DatasetWorkflowError
        ? error
        : new DatasetWorkflowError("INVALID_REQUEST", "request", "workflow stage failed safely");
      this.#emit("workflow-rejected", generation, null, safe.code === "STALE_GENERATION" ? "stale" : "rejected", safe.code);
      throw safe;
    }
  }

  async parseWorksheet(
    request: ParseWorksheetRequestV1,
  ): Promise<ParsedWorksheetCandidateV1> {
    let generation = 0;
    try {
      assertParseWorksheetRequest(request);
      generation = request.generation;
      const selection = request.selection === null
        ? null
        : Object.freeze({ index: request.selection.index, name: request.selection.name });
      if (!(await this.#isCurrent(generation))) {
        workflowError("STALE_GENERATION", "generation", "cannot parse an older candidate");
      }
      const inspected = this.#inspected.get(generation);
      if (!inspected || inspected.uploadIdentity !== request.uploadIdentity) {
        workflowError("UPLOAD_NOT_FOUND", "request.uploadIdentity", "is not the inspected candidate for this generation");
      }
      assertSelectionAgainstInventory(inspected.inventory, selection);
      const boundLimits = await this.#preflightLimits(generation);

      let uploadValue: ImmutableUploadRecordV1 | null;
      try {
        uploadValue = await this.#storage.readUpload(request.uploadIdentity);
      } catch (error) {
        throw adapterFailure(error, "UPLOAD_STORAGE_FAILURE", "storage.readUpload", "immutable upload read failed");
      }
      if (!uploadValue) {
        workflowError("UPLOAD_NOT_FOUND", "storage.upload", "immutable upload is missing");
      }
      const upload = validateStoredUpload(uploadValue, request.uploadIdentity);
      const uploadBytes = ownedBytes(upload.bytes, boundLimits.maxFileBytes);
      if (upload.byteLength !== uploadBytes.byteLength
        || createUploadIdentity(upload.sha256) !== upload.uploadIdentity
        || await sha256Bytes(uploadBytes) !== upload.sha256) {
        workflowError("UPLOAD_CUSTODY_MISMATCH", "storage.upload", "failed exact-byte custody verification");
      }
      let parsedValue: unknown;
      try {
        parsedValue = await this.#parser.parse({
          format: upload.format,
          bytes: ownedBytes(uploadBytes, boundLimits.maxFileBytes),
          expectedSha256: upload.sha256,
          limits: boundLimits,
          selection,
        });
      } catch (error) {
        throw adapterFailure(error, "PARSER_PARSE_FAILURE", "parser.parse", "worksheet parsing failed");
      }
      const parsed = validateParsed(parsedValue, {
        format: upload.format,
        byteLength: upload.byteLength,
        sha256: upload.sha256,
        parserVersion: this.#parser.parserVersion,
      });
      assertParsedSelection(parsed, inspected.inventory, selection);
      assertParsedLimits(parsed, boundLimits);
      if (!(await this.#isCurrent(generation))) {
        workflowError("STALE_GENERATION", "generation", "became stale before parsed publication");
      }
      const parsedContentSha256 = await createParsedContentSha256({
        headers: parsed.headers,
        rows: parsed.rows,
      });
      const parsedIdentity = await createParsedIdentity({
        uploadIdentity: upload.uploadIdentity,
        parserVersion: parsed.parserVersion,
        format: parsed.format,
        delimiter: parsed.delimiter,
        worksheet: { index: parsed.worksheet.index, name: parsed.worksheet.name },
        headers: parsed.headers,
        parsedContentSha256,
        rowCount: parsed.rowCount,
        columnCount: parsed.columnCount,
        skippedBlankRowCount: parsed.skippedBlankRowCount,
        vbaDetectedAndDiscarded: parsed.vbaDetectedAndDiscarded,
      });
      if (!(await this.#isCurrent(generation))) {
        workflowError("STALE_GENERATION", "generation", "became stale before parsed custody");
      }
      const parsedRecord: ImmutableParsedRecordV1 = {
        schemaVersion: "3dena.immutable-parsed-record.v1",
        uploadIdentity: upload.uploadIdentity,
        parsedIdentity,
        parsedContentSha256,
        parserVersion: parsed.parserVersion,
        format: parsed.format,
        delimiter: parsed.delimiter,
        worksheet: parsed.worksheet,
        headers: parsed.headers,
        rows: parsed.rows,
        rowCount: parsed.rowCount,
        columnCount: parsed.columnCount,
        skippedBlankRowCount: parsed.skippedBlankRowCount,
        vbaDetectedAndDiscarded: parsed.vbaDetectedAndDiscarded,
      };
      try {
        const outcome = await this.#storage.putParsed(parsedRecord);
        if (outcome !== "created" && outcome !== "existing") {
          workflowError("PARSED_STORAGE_FAILURE", "storage.putParsed", "returned an unknown outcome");
        }
      } catch (error) {
        throw adapterFailure(error, "PARSED_STORAGE_FAILURE", "storage.putParsed", "immutable parsed write failed");
      }
      if (!(await this.#isCurrent(generation))) {
        workflowError("STALE_GENERATION", "generation", "became stale before parsed publication");
      }
      const result: ParsedWorksheetCandidateV1 = Object.freeze({
        schemaVersion: "3dena.parsed-worksheet-candidate.v1",
        productStatus: "IMPLEMENTED_UNVERIFIED",
        generation,
        uploadIdentity: upload.uploadIdentity,
        parsedIdentity,
        parsedContentSha256,
        worksheet: Object.freeze({ ...parsed.worksheet }),
        headers: Object.freeze([...parsed.headers]),
        rowCount: parsed.rowCount,
        columnCount: parsed.columnCount,
      });
      const generationCandidates = this.#parsedCandidates.get(generation)
        ?? new Map<ParsedIdentityV1, ParsedWorksheetCandidateV1>();
      generationCandidates.set(parsedIdentity, result);
      this.#parsedCandidates.set(generation, generationCandidates);
      this.#emit("worksheet-parsed", generation, parsedIdentity, "ok");
      return result;
    } catch (error) {
      const safe = error instanceof DatasetWorkflowError
        ? error
        : new DatasetWorkflowError("INVALID_REQUEST", "request", "worksheet parsing failed safely");
      this.#emit("workflow-rejected", generation, null, safe.code === "STALE_GENERATION" ? "stale" : "rejected", safe.code);
      throw safe;
    }
  }

  async prepareDataset(
    request: PrepareDatasetRequestV1,
  ): Promise<PreparedDatasetCandidateV1> {
    let generation = 0;
    try {
      assertPrepareRequest(request);
      generation = request.generation;
      const mapping = freezeMapping(request.mapping);
      if (!(await this.#isCurrent(generation))) {
        workflowError("STALE_GENERATION", "generation", "cannot prepare an older candidate");
      }
      const parsedCandidate = this.#parsedCandidates.get(generation)?.get(request.parsedIdentity);
      if (!parsedCandidate) {
        workflowError(
          "PARSED_NOT_FOUND",
          "request.parsedIdentity",
          "is not a parsed worksheet candidate for this generation",
        );
      }
      let parsedValue: ImmutableParsedRecordV1 | null;
      try {
        parsedValue = await this.#storage.readParsed(request.parsedIdentity);
      } catch (error) {
        throw adapterFailure(error, "PARSED_STORAGE_FAILURE", "storage.readParsed", "immutable parsed read failed");
      }
      if (!parsedValue) {
        workflowError("PARSED_NOT_FOUND", "storage.parsed", "immutable parsed worksheet is missing");
      }
      const parsed = validateStoredParsed(parsedValue, request.parsedIdentity);
      const parsedContentSha256 = await createParsedContentSha256({
        headers: parsed.headers,
        rows: parsed.rows,
      });
      const expectedParsedIdentity = await createParsedIdentity({
        uploadIdentity: parsed.uploadIdentity,
        parserVersion: parsed.parserVersion,
        format: parsed.format,
        delimiter: parsed.delimiter,
        worksheet: { index: parsed.worksheet.index, name: parsed.worksheet.name },
        headers: parsed.headers,
        parsedContentSha256,
        rowCount: parsed.rowCount,
        columnCount: parsed.columnCount,
        skippedBlankRowCount: parsed.skippedBlankRowCount,
        vbaDetectedAndDiscarded: parsed.vbaDetectedAndDiscarded,
      });
      if (parsedContentSha256 !== parsed.parsedContentSha256
        || expectedParsedIdentity !== parsed.parsedIdentity
        || parsed.uploadIdentity !== parsedCandidate.uploadIdentity
        || parsed.parserVersion !== this.#parser.parserVersion) {
        workflowError("PARSED_NOT_FOUND", "storage.parsed", "failed immutable parsed custody verification");
      }
      const shaped = shapeDataset({
        schemaVersion: "3dena.workflow-parsed-worksheet.v1",
        format: parsed.format,
        byteLength: (await this.#requiredUpload(parsed.uploadIdentity)).byteLength,
        sha256: createUploadSha(parsed.uploadIdentity),
        delimiter: parsed.delimiter,
        worksheet: parsed.worksheet,
        headers: parsed.headers,
        rows: parsed.rows,
        previewRows: parsed.rows.slice(0, 6),
        rowCount: parsed.rowCount,
        columnCount: parsed.columnCount,
        skippedBlankRowCount: parsed.skippedBlankRowCount,
        vbaDetectedAndDiscarded: parsed.vbaDetectedAndDiscarded,
        parserVersion: parsed.parserVersion,
      }, mapping);
      const activationLimits = primaryLimits(await this.#preflightLimits(generation));
      const activationWarnings = warningCodes(shaped.diagnostics);
      const activationIdentity = await createActivationIdentity({
        parsedIdentity: parsed.parsedIdentity,
        schema: shaped.schema,
        limits: activationLimits,
        warnings: activationWarnings,
      });
      if (!(await this.#isCurrent(generation))) {
        workflowError("STALE_GENERATION", "generation", "became stale before candidate publication");
      }
      const result: PreparedDatasetCandidateV1 = Object.freeze({
        schemaVersion: "3dena.prepared-dataset-candidate.v1",
        productStatus: "IMPLEMENTED_UNVERIFIED",
        generation,
        uploadIdentity: parsed.uploadIdentity,
        parsedIdentity: parsed.parsedIdentity,
        parsedContentSha256: parsed.parsedContentSha256,
        activationIdentity,
        worksheet: Object.freeze({ ...parsed.worksheet }),
        rowCount: parsed.rowCount,
        columnCount: parsed.columnCount,
        schema: shaped.schema,
        preview: shaped.preview,
        diagnostics: shaped.diagnostics,
        activatable: !shaped.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
      });
      this.#prepared.set(activationIdentity, Object.freeze({ result, mapping }));
      this.#emit("dataset-prepared", generation, parsed.parsedIdentity, "ok");
      return result;
    } catch (error) {
      const safe = error instanceof DatasetWorkflowError
        ? error
        : new DatasetWorkflowError("INVALID_REQUEST", "request", "workflow preparation failed safely");
      this.#emit("workflow-rejected", generation, null, safe.code === "STALE_GENERATION" ? "stale" : "rejected", safe.code);
      throw safe;
    }
  }

  async #preflightLimits(generation: number): Promise<DatasetWorkflowLimitsV1> {
    const inspected = this.#inspected.get(generation);
    if (!inspected) {
      workflowError("UPLOAD_NOT_FOUND", "generation", "has no inspected candidate");
    }
    const binding = this.#generationBindings.get(generation);
    if (!binding || binding !== inspected.preflightIdentity) {
      workflowError("UPLOAD_CUSTODY_MISMATCH", "generation", "lost its immutable preflight binding");
    }
    // The full limits object is recovered from its immutable preflight binding
    // through the staged upload's current receipt cache.
    const limits = this.#limitsByPreflight.get(binding);
    if (!limits) {
      workflowError("UPLOAD_CUSTODY_MISMATCH", "preflight.limits", "is unavailable for the staged candidate");
    }
    return limits;
  }

  readonly #limitsByPreflight = new Map<string, DatasetWorkflowLimitsV1>();

  async activateDataset(
    request: ActivateDatasetRequestV1,
  ): Promise<DatasetActivationResultV1> {
    let generation = 0;
    try {
      assertActivateRequest(request);
      generation = request.generation;
      const activeBefore = await this.#safeReadActive();
      if (!(await this.#isCurrent(generation))) {
        const stale = Object.freeze({
          schemaVersion: "3dena.dataset-activation-result.v1" as const,
          productStatus: "IMPLEMENTED_UNVERIFIED" as const,
          outcome: "stale" as const,
          requestedGeneration: generation,
          active: cloneActive(activeBefore),
        });
        this.#emit("activation-attempted", generation, request.activationIdentity, "stale");
        return stale;
      }
      const prepared = this.#prepared.get(request.activationIdentity);
      if (!prepared || prepared.result.generation !== generation) {
        workflowError("ACTIVATION_CANDIDATE_UNKNOWN", "request.activationIdentity", "is not a prepared candidate for this generation");
      }
      if (!prepared.result.activatable) {
        workflowError("ACTIVATION_BLOCKED", "candidate.diagnostics", "contains one or more activation-blocking diagnostics");
      }
      let parsedValue: ImmutableParsedRecordV1 | null;
      try {
        parsedValue = await this.#storage.readParsed(prepared.result.parsedIdentity);
      } catch (error) {
        throw adapterFailure(error, "ACTIVATION_STORAGE_FAILURE", "storage.readParsed", "parsed custody read failed");
      }
      if (!parsedValue) {
        workflowError("PARSED_NOT_FOUND", "storage.parsed", "prepared dataset payload is unavailable");
      }
      const parsed = validateStoredParsed(parsedValue, prepared.result.parsedIdentity);
      const parsedContentSha256 = await createParsedContentSha256({
        headers: parsed.headers,
        rows: parsed.rows,
      });
      const expectedParsedIdentity = await createParsedIdentity({
        uploadIdentity: parsed.uploadIdentity,
        parserVersion: parsed.parserVersion,
        format: parsed.format,
        delimiter: parsed.delimiter,
        worksheet: { index: parsed.worksheet.index, name: parsed.worksheet.name },
        headers: parsed.headers,
        parsedContentSha256,
        rowCount: parsed.rowCount,
        columnCount: parsed.columnCount,
        skippedBlankRowCount: parsed.skippedBlankRowCount,
        vbaDetectedAndDiscarded: parsed.vbaDetectedAndDiscarded,
      });
      if (parsedContentSha256 !== parsed.parsedContentSha256
        || parsed.parsedContentSha256 !== prepared.result.parsedContentSha256
        || parsed.uploadIdentity !== prepared.result.uploadIdentity
        || parsed.parserVersion !== this.#parser.parserVersion
        || expectedParsedIdentity !== parsed.parsedIdentity) {
        workflowError("PARSED_NOT_FOUND", "storage.parsed", "prepared dataset payload is unavailable");
      }
      const limits = await this.#preflightLimits(generation);
      const expectedActivationIdentity = await createActivationIdentity({
        parsedIdentity: parsed.parsedIdentity,
        schema: prepared.result.schema,
        limits: primaryLimits(limits),
        warnings: warningCodes(prepared.result.diagnostics),
      });
      if (expectedActivationIdentity !== prepared.result.activationIdentity) {
        workflowError("ACTIVATION_CANDIDATE_UNKNOWN", "candidate.activationIdentity", "does not bind its parsed content, schema, limits, and warnings");
      }
      const receipt: DatasetReceiptV1 = {
        schemaVersion: "3dena.dataset-receipt.v1",
        sha256: createUploadSha(prepared.result.uploadIdentity),
        byteLength: (await this.#requiredUpload(prepared.result.uploadIdentity)).byteLength,
        format: parsed.format,
        sheet: parsed.format === "csv"
          ? null
          : { index: parsed.worksheet.index, name: parsed.worksheet.name },
        rows: parsed.rowCount,
        columns: parsed.columnCount,
        schema: prepared.result.schema,
        limits: primaryLimits(limits),
        warnings: warningCodes(prepared.result.diagnostics),
        activationIdentity: prepared.result.activationIdentity,
      };
      assertDatasetReceiptV1(receipt);
      const handle: ActiveDatasetHandleV1 = Object.freeze({
        schemaVersion: "3dena.active-dataset-handle.v1",
        productStatus: "IMPLEMENTED_UNVERIFIED",
        generation,
        uploadIdentity: prepared.result.uploadIdentity,
        parsedIdentity: prepared.result.parsedIdentity,
        activationIdentity: prepared.result.activationIdentity,
        receipt,
      });
      const stored: StoredActivationRecordV1 = {
        schemaVersion: "3dena.stored-activation-record.v1",
        handle,
        mapping: prepared.mapping,
      };
      let outcome: "activated" | "stale" | "conflict";
      try {
        outcome = await this.#storage.activateAtomic({
          generation,
          expectedActiveActivationIdentity: request.expectedActiveActivationIdentity,
          next: stored,
        });
      } catch (error) {
        throw adapterFailure(error, "ACTIVATION_STORAGE_FAILURE", "storage.activateAtomic", "atomic activation failed");
      }
      if (outcome !== "activated" && outcome !== "stale" && outcome !== "conflict") {
        workflowError("ACTIVATION_STORAGE_FAILURE", "storage.activateAtomic", "returned an unknown outcome");
      }
      const activeAfter = await this.#safeReadActive();
      const afterIdentity = activeAfter?.handle.activationIdentity ?? null;
      if (outcome === "activated" && afterIdentity !== request.activationIdentity) {
        workflowError(
          "ACTIVATION_STORAGE_FAILURE",
          "storage.activateAtomic",
          "violated the atomic activation outcome contract",
        );
      }
      const result: DatasetActivationResultV1 = Object.freeze({
        schemaVersion: "3dena.dataset-activation-result.v1",
        productStatus: "IMPLEMENTED_UNVERIFIED",
        outcome,
        requestedGeneration: generation,
        active: cloneActive(activeAfter),
      });
      this.#emit(
        "activation-attempted",
        generation,
        request.activationIdentity,
        outcome === "activated" ? "ok" : outcome,
      );
      return result;
    } catch (error) {
      const safe = error instanceof DatasetWorkflowError
        ? error
        : new DatasetWorkflowError("ACTIVATION_STORAGE_FAILURE", "activation", "activation failed safely");
      this.#emit("workflow-rejected", generation, null, safe.code === "STALE_GENERATION" ? "stale" : "rejected", safe.code);
      throw safe;
    }
  }

  async #requiredUpload(identity: UploadIdentityV1): Promise<ImmutableUploadRecordV1> {
    let uploadValue: ImmutableUploadRecordV1 | null;
    try {
      uploadValue = await this.#storage.readUpload(identity);
    } catch (error) {
      throw adapterFailure(error, "ACTIVATION_STORAGE_FAILURE", "storage.readUpload", "upload custody read failed");
    }
    if (!uploadValue) {
      workflowError("UPLOAD_CUSTODY_MISMATCH", "storage.upload", "active upload custody is invalid");
    }
    const upload = validateStoredUpload(uploadValue, identity);
    const bytes = ownedBytes(upload.bytes, Number.MAX_SAFE_INTEGER);
    if (upload.byteLength !== bytes.byteLength
      || createUploadIdentity(upload.sha256) !== identity
      || await sha256Bytes(bytes) !== upload.sha256) {
      workflowError("UPLOAD_CUSTODY_MISMATCH", "storage.upload", "active upload custody is invalid");
    }
    return { ...upload, bytes };
  }

  async #safeReadActive(): Promise<StoredActivationRecordV1 | null> {
    try {
      const active = await this.#storage.readActive();
      return active === null ? null : validateStoredActivation(active);
    } catch (error) {
      throw adapterFailure(error, "ACTIVATION_STORAGE_FAILURE", "storage.readActive", "active dataset read failed");
    }
  }

  async snapshot(): Promise<DatasetWorkflowSnapshotV1> {
    const active = await this.#safeReadActive();
    return Object.freeze({
      schemaVersion: "3dena.dataset-workflow-snapshot.v1",
      productStatus: "IMPLEMENTED_UNVERIFIED",
      currentGeneration: this.#latestGeneration,
      active: cloneActive(active),
    });
  }

  async readActiveDataset(): Promise<ActiveDatasetPayloadV1 | null> {
    const active = await this.#safeReadActive();
    if (!active) return null;
    let parsedValue: ImmutableParsedRecordV1 | null;
    try {
      parsedValue = await this.#storage.readParsed(active.handle.parsedIdentity);
    } catch (error) {
      throw adapterFailure(error, "ACTIVATION_STORAGE_FAILURE", "storage.readParsed", "active parsed read failed");
    }
    if (!parsedValue) {
      workflowError("PARSED_NOT_FOUND", "storage.parsed", "active parsed payload is unavailable");
    }
    const parsed = validateStoredParsed(parsedValue, active.handle.parsedIdentity);
    const parsedContentSha256 = await createParsedContentSha256({
      headers: parsed.headers,
      rows: parsed.rows,
    });
    if (parsedContentSha256 !== parsed.parsedContentSha256
      || parsed.uploadIdentity !== active.handle.uploadIdentity) {
      workflowError("PARSED_NOT_FOUND", "storage.parsed", "active parsed payload is unavailable");
    }
    const rows = materializeMappedRows(parsed.rows, active.mapping);
    return Object.freeze({
      schemaVersion: "3dena.active-dataset-payload.v1",
      handle: cloneHandle(active.handle),
      headers: Object.freeze([...parsed.headers]),
      rows,
      schema: structuredClone(active.handle.receipt.schema),
    });
  }
}

function createUploadSha(identity: UploadIdentityV1): string {
  if (!isWorkflowIdentity(identity, "upload")) {
    workflowError("INVALID_IDENTITY", "uploadIdentity", "is invalid");
  }
  return identity.slice("upload:sha256:".length);
}

export function createDatasetWorkflow(
  dependencies: DatasetWorkflowDependencies,
): DatasetWorkflow {
  return new DatasetWorkflow(dependencies);
}
