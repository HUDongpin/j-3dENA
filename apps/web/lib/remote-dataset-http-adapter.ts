import {
  ANALYSIS_CONTRACT_VERSION_V1,
  DATASET_RECEIPT_VERSION_V1,
  assertDatasetReceiptV1,
  assertTypedScalarV1,
  hashAnalysisValueV1,
  inspectDataset,
  type AnalysisJobCapabilityV1,
  type DatasetReceiptV1,
} from "@3dena/analysis";
import type {
  ActivatedPreparedImportTaskSpecV1,
  ActivatedAnalysisTaskSpecV1,
  ActivateComputeDatasetRequestV1,
  ComputeDatasetActivationReceiptV1,
  ComputeDatasetCapabilityV1,
  ComputeDatasetMappingReceiptV1,
  ComputeDatasetPreviewResultV1,
  ComputeDatasetUploadResultV1,
  ComputeDatasetWorksheetResultV1,
  CreateActivatedAnalysisJobRequestV1,
  CreateSourceResultAnalysisJobRequestV1,
  CreateComputeDatasetRequestV1,
  ExecuteActivatedAnalysisJobRequestV1,
  ExecutePreparedImportJobRequestV1,
  PreviewComputeDatasetRequestV1,
  PutComputeDatasetMappingRequestV1,
  SelectComputeDatasetWorksheetRequestV1,
  SourceResultAnalysisJobCapabilityV1,
} from "@3dena/compute-service-http";
import { DEFAULT_ENA3D_EXCHANGE_LIMITS } from "@3dena/io";
import {
  createBrowserPreflightReceipt,
  type ActivationIdentityV1,
  type DatasetColumnRoleV1,
  type DatasetRoleMappingV1,
  type ParsedIdentityV1,
} from "@3dena/dataset-workflow";
import type { AnalysisMapping } from "@/lib/analysis-contract";
import {
  PREPARED_EXCHANGE_MAPPING,
  inspectPreparedExchange,
} from "@/lib/prepared-class1";
import {
  REMOTE_DATASET_WORKFLOW_REQUIRED_CONTRACT,
  REMOTE_DERIVED_EXECUTION_REQUIRED_CONTRACT,
  REMOTE_PREPARED_IMPORT_REQUIRED_CONTRACT,
  type RemoteActiveDataset,
  type RemoteDatasetInventory,
  type RemoteDatasetPreview,
  type RemoteDatasetWorkflowAdapter,
  type RemoteEnaSourceResult,
  type RemoteParsedWorksheet,
  type RemotePreparedDataset,
  type RemoteWorkflowProgress,
  type RemoteWorksheetSummary,
} from "@/lib/remote-dataset-workflow";

const SHA256 = /^[a-f0-9]{64}$/u;
const OPAQUE_ID = /^[A-Za-z0-9_-]{8,200}$/u;
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_CLIENT_CODES = new Set(["NETWORK_FAILURE", "REQUEST_TIMEOUT"]);

interface HttpAdapterOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  /** Per-attempt client deadline, including response-body consumption. */
  readonly requestTimeoutMilliseconds?: number;
  /** Maximum attempts for transient GETs and idempotency-keyed mutations. */
  readonly retryMaxAttempts?: number;
  /** Initial bounded exponential-backoff delay. */
  readonly retryBaseDelayMilliseconds?: number;
  /** Maximum client-selected backoff; Retry-After is never shortened. */
  readonly retryMaximumDelayMilliseconds?: number;
  /** Total wall-clock retry window, including Retry-After delays. */
  readonly retryTotalTimeoutMilliseconds?: number;
}

interface DatasetSession {
  readonly capability: ComputeDatasetCapabilityV1;
  readonly preflightSha256: string;
  inspected: ComputeDatasetUploadResultV1 | null;
  parsed: ComputeDatasetWorksheetResultV1 | null;
  mappingReceipt: ComputeDatasetMappingReceiptV1 | null;
  preview: ComputeDatasetPreviewResultV1 | null;
  activation: ComputeDatasetActivationReceiptV1 | null;
}

interface PreparedSession {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly dataset: RemotePreparedDataset;
}

class RemoteDatasetHttpError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly requestId: string | null;
  readonly retryAfterMilliseconds: number | null;

  constructor(
    code: string,
    message: string,
    status: number | null = null,
    requestId: string | null = null,
    retryAfterMilliseconds: number | null = null,
  ) {
    super(message);
    this.name = "RemoteDatasetHttpError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.retryAfterMilliseconds = retryAfterMilliseconds;
  }
}

function aborted(): RemoteDatasetHttpError {
  return new RemoteDatasetHttpError(
    "ABORTED",
    "The remote dataset request was aborted by the caller.",
  );
}

function retryAfterMilliseconds(response: Response, now = Date.now()): number | null {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return null;
  if (/^(?:0|[1-9][0-9]{0,8})$/u.test(value)) {
    const milliseconds = Number(value) * 1_000;
    return Number.isSafeInteger(milliseconds) ? milliseconds : null;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, timestamp - now);
}

function retryable(error: RemoteDatasetHttpError): boolean {
  return RETRYABLE_CLIENT_CODES.has(error.code)
    || (error.status !== null && RETRYABLE_HTTP_STATUSES.has(error.status));
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(aborted());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(aborted());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function readResponseText(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  const onAbort = () => {
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (signal.aborted) {
        throw signal.reason ?? new DOMException("Request aborted", "AbortError");
      }
      if (done) break;
      try {
        chunks.push(decoder.decode(value, { stream: true }));
      } catch {
        throw new RemoteDatasetHttpError(
          "INVALID_RESPONSE",
          "Remote dataset response body is not valid UTF-8.",
          response.status,
          response.headers.get("x-request-id"),
        );
      }
    }
    try {
      chunks.push(decoder.decode());
    } catch {
      throw new RemoteDatasetHttpError(
        "INVALID_RESPONSE",
        "Remote dataset response body is not valid UTF-8.",
        response.status,
        response.headers.get("x-request-id"),
      );
    }
    return chunks.join("");
  } finally {
    signal.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => undefined);
  }
}

function fail(code: string, message: string): never {
  throw new RemoteDatasetHttpError(code, message);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_RESPONSE", `${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exact(
  value: Record<string, unknown>,
  fields: readonly string[],
  path: string,
): void {
  const allowed = new Set(fields);
  const unknown = Object.keys(value).find((field) => !allowed.has(field));
  if (unknown) fail("INVALID_RESPONSE", `${path} contains an unknown field.`);
  const missing = fields.find((field) => !Object.hasOwn(value, field));
  if (missing) fail("INVALID_RESPONSE", `${path} is missing a required field.`);
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail("INVALID_RESPONSE", `${path} must be a non-empty string.`);
  }
  return value;
}

function safeInteger(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail("INVALID_RESPONSE", `${path} must be a safe integer.`);
  }
  return value as number;
}

function safeAbsoluteUrl(value: unknown, path: string): string {
  const raw = stringValue(value, path);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    fail("INVALID_RESPONSE", `${path} must be an absolute URL.`);
  }
  const loopback = parsed.protocol === "http:"
    && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if ((!loopback && parsed.protocol !== "https:")
      || parsed.username || parsed.password || parsed.hash) {
    fail("INVALID_RESPONSE", `${path} is not a safe service URL.`);
  }
  return parsed.toString();
}

function normalizeBaseUrl(value: string): URL {
  const parsed = new URL(safeAbsoluteUrl(value, "baseUrl"));
  if (parsed.search) fail("INVALID_CONFIGURATION", "baseUrl cannot contain a query.");
  parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  return parsed;
}

function randomIdempotencyKey(prefix: string): string {
  const suffix = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function declaredExtension(file: File): ".csv" | ".xlsx" | ".xls" {
  const lower = file.name.toLocaleLowerCase("en-US");
  if (lower.endsWith(".csv")) return ".csv";
  if (lower.endsWith(".xlsx")) return ".xlsx";
  if (lower.endsWith(".xls")) return ".xls";
  if (lower.endsWith(".ena3d.json")) {
    fail(
      "PREPARED_EXCHANGE_NOT_SUPPORTED",
      "The reviewed compute dataset v1 contract currently accepts CSV, XLS, and XLSX only. Prepared .ena3d.json remains fail-closed.",
    );
  }
  fail("UNSUPPORTED_DATASET", "Choose a CSV, XLS, or XLSX dataset.");
}

function worksheetSummary(value: unknown, path: string): RemoteWorksheetSummary {
  const item = record(value, path);
  exact(item, [
    "index",
    "name",
    "visibility",
    "kind",
    "selectable",
    "unselectableReason",
    "declaredRowCount",
    "declaredColumnCount",
  ], path);
  const visibility = stringValue(item.visibility, `${path}.visibility`);
  if (!["visible", "hidden", "very-hidden"].includes(visibility)
      || typeof item.selectable !== "boolean") {
    fail("INVALID_RESPONSE", `${path} contains an invalid worksheet descriptor.`);
  }
  return {
    index: safeInteger(item.index, `${path}.index`),
    name: stringValue(item.name, `${path}.name`),
    hidden: visibility !== "visible",
    selectable: item.selectable,
    declaredRows: safeInteger(item.declaredRowCount, `${path}.declaredRowCount`),
    declaredColumns: safeInteger(item.declaredColumnCount, `${path}.declaredColumnCount`),
  };
}

function assertCapability(value: unknown, expectedOrigin: string): ComputeDatasetCapabilityV1 {
  const item = record(value, "dataset capability");
  exact(item, [
    "schemaVersion",
    "datasetId",
    "generation",
    "capabilityToken",
    "contentUrl",
    "expiresAt",
  ], "dataset capability");
  if (item.schemaVersion !== "3dena.compute-dataset-capability.v1") {
    fail("INVALID_RESPONSE", "Dataset capability version is unsupported.");
  }
  const datasetId = stringValue(item.datasetId, "dataset capability.datasetId");
  const capabilityToken = stringValue(
    item.capabilityToken,
    "dataset capability.capabilityToken",
  );
  const contentUrl = safeAbsoluteUrl(item.contentUrl, "dataset capability.contentUrl");
  if (!OPAQUE_ID.test(datasetId)
      || !/^[A-Za-z0-9_-]{16,512}$/u.test(capabilityToken)
      || new URL(contentUrl).origin !== expectedOrigin
      || Number.isNaN(Date.parse(String(item.expiresAt)))) {
    fail("INVALID_RESPONSE", "Dataset capability identity is invalid.");
  }
  return item as unknown as ComputeDatasetCapabilityV1;
}

function assertJobCapability(value: unknown, expectedOrigin: string): AnalysisJobCapabilityV1 {
  const item = record(value, "analysis job capability");
  exact(item, [
    "schemaVersion",
    "jobId",
    "capabilityToken",
    "uploadUrl",
    "expiresAt",
  ], "analysis job capability");
  const uploadUrl = safeAbsoluteUrl(item.uploadUrl, "analysis job capability.uploadUrl");
  if (item.schemaVersion !== "3dena.job-capability.v1"
      || typeof item.jobId !== "string"
      || !OPAQUE_ID.test(item.jobId)
      || typeof item.capabilityToken !== "string"
      || !/^[A-Za-z0-9_-]{16,512}$/u.test(item.capabilityToken)
      || new URL(uploadUrl).origin !== expectedOrigin
      || Number.isNaN(Date.parse(String(item.expiresAt)))) {
    fail("INVALID_RESPONSE", "Analysis job capability is invalid.");
  }
  return item as unknown as AnalysisJobCapabilityV1;
}

function assertSourceResultJobCapability(
  value: unknown,
  source: RemoteEnaSourceResult,
): SourceResultAnalysisJobCapabilityV1 {
  const item = record(value, "source-result job capability");
  exact(item, [
    "schemaVersion",
    "jobId",
    "capabilityToken",
    "sourceJobId",
    "sourceResultHash",
    "expiresAt",
  ], "source-result job capability");
  if (item.schemaVersion !== "3dena.source-result-job-capability.v1"
      || typeof item.jobId !== "string"
      || !OPAQUE_ID.test(item.jobId)
      || typeof item.capabilityToken !== "string"
      || !/^[A-Za-z0-9_-]{16,512}$/u.test(item.capabilityToken)
      || item.sourceJobId !== source.reference.jobId
      || item.sourceResultHash !== source.sourceResultHash
      || Number.isNaN(Date.parse(String(item.expiresAt)))) {
    fail("INVALID_RESPONSE", "Source-result job capability is invalid.");
  }
  return item as unknown as SourceResultAnalysisJobCapabilityV1;
}

function assertInspected(
  value: unknown,
  session: DatasetSession,
): ComputeDatasetUploadResultV1 {
  const item = record(value, "inspected dataset");
  exact(item, [
    "schemaVersion",
    "productStatus",
    "generation",
    "preflightIdentity",
    "uploadIdentity",
    "inventory",
  ], "inspected dataset");
  const inventory = record(item.inventory, "inspected dataset.inventory");
  exact(inventory, [
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
  ], "inspected dataset.inventory");
  if (item.schemaVersion !== "3dena.inspected-dataset-candidate.v1"
      || item.productStatus !== "IMPLEMENTED_UNVERIFIED"
      || item.generation !== session.capability.generation
      || inventory.schemaVersion !== "3dena.workflow-workbook-inventory.v1"
      || inventory.sha256 !== session.preflightSha256
      || !Array.isArray(inventory.worksheets)
      || inventory.worksheets.length < 1
      || typeof inventory.vbaDetectedAndDiscarded !== "boolean") {
    fail("INVALID_RESPONSE", "Authoritative dataset inventory is inconsistent.");
  }
  inventory.worksheets.forEach((sheet, index) => {
    const normalized = worksheetSummary(sheet, `inspected dataset.inventory.worksheets[${index}]`);
    if (normalized.index !== index) {
      fail("INVALID_RESPONSE", "Worksheet inventory order is inconsistent.");
    }
  });
  return item as unknown as ComputeDatasetUploadResultV1;
}

function assertParsed(
  value: unknown,
  session: DatasetSession,
): ComputeDatasetWorksheetResultV1 {
  const item = record(value, "parsed worksheet");
  exact(item, [
    "schemaVersion",
    "productStatus",
    "generation",
    "uploadIdentity",
    "parsedIdentity",
    "parsedContentSha256",
    "worksheet",
    "headers",
    "rowCount",
    "columnCount",
  ], "parsed worksheet");
  if (item.schemaVersion !== "3dena.parsed-worksheet-candidate.v1"
      || item.productStatus !== "IMPLEMENTED_UNVERIFIED"
      || item.generation !== session.capability.generation
      || typeof item.parsedIdentity !== "string"
      || !String(item.parsedIdentity).startsWith("parsed:sha256:")
      || typeof item.parsedContentSha256 !== "string"
      || !SHA256.test(item.parsedContentSha256)
      || !Array.isArray(item.headers)
      || item.headers.length < 1
      || item.headers.some((header) => typeof header !== "string" || header.length < 1)
      || new Set(item.headers).size !== item.headers.length
      || item.columnCount !== item.headers.length) {
    fail("INVALID_RESPONSE", "Parsed worksheet contract is inconsistent.");
  }
  safeInteger(item.rowCount, "parsed worksheet.rowCount", 1);
  safeInteger(item.columnCount, "parsed worksheet.columnCount", 1);
  worksheetSummary(item.worksheet, "parsed worksheet.worksheet");
  return item as unknown as ComputeDatasetWorksheetResultV1;
}

function assertMappingReceipt(
  value: unknown,
  session: DatasetSession,
  parsedIdentity: string,
): ComputeDatasetMappingReceiptV1 {
  const item = record(value, "mapping receipt");
  exact(item, [
    "schemaVersion",
    "datasetId",
    "generation",
    "parsedIdentity",
    "mappingSha256",
  ], "mapping receipt");
  if (item.schemaVersion !== "3dena.compute-dataset-mapping-receipt.v1"
      || item.datasetId !== session.capability.datasetId
      || item.generation !== session.capability.generation
      || item.parsedIdentity !== parsedIdentity
      || typeof item.mappingSha256 !== "string"
      || !SHA256.test(item.mappingSha256)) {
    fail("INVALID_RESPONSE", "Mapping receipt does not bind the parsed worksheet.");
  }
  return item as unknown as ComputeDatasetMappingReceiptV1;
}

function assertPreview(
  value: unknown,
  session: DatasetSession,
): ComputeDatasetPreviewResultV1 {
  const item = record(value, "dataset preview");
  exact(item, [
    "schemaVersion",
    "datasetId",
    "generation",
    "activationIdentity",
    "preview",
    "candidate",
  ], "dataset preview");
  const preview = record(item.preview, "dataset preview.preview");
  exact(preview, [
    "schemaVersion",
    "headers",
    "rows",
    "totalRowCount",
    "previewRowCount",
  ], "dataset preview.preview");
  const candidate = record(item.candidate, "dataset preview.candidate");
  exact(candidate, [
    "schemaVersion",
    "productStatus",
    "generation",
    "uploadIdentity",
    "parsedIdentity",
    "parsedContentSha256",
    "activationIdentity",
    "worksheet",
    "rowCount",
    "columnCount",
    "schema",
    "preview",
    "diagnostics",
    "activatable",
  ], "dataset preview.candidate");
  if (item.schemaVersion !== "3dena.compute-dataset-preview-result.v1"
      || item.datasetId !== session.capability.datasetId
      || item.generation !== session.capability.generation
      || typeof item.activationIdentity !== "string"
      || !String(item.activationIdentity).startsWith("activation:sha256:")
      || candidate.activationIdentity !== item.activationIdentity
      || candidate.parsedContentSha256 !== session.parsed?.parsedContentSha256
      || typeof candidate.activatable !== "boolean"
      || preview.schemaVersion !== "3dena.typed-dataset-preview.v1"
      || !Array.isArray(preview.headers)
      || !Array.isArray(preview.rows)
      || preview.rows.length > 6
      || preview.previewRowCount !== preview.rows.length
      || !Array.isArray(candidate.diagnostics)) {
    fail("INVALID_RESPONSE", "Typed dataset preview is inconsistent.");
  }
  const previewHeaders = preview.headers as unknown[];
  preview.rows.forEach((rowValue, rowIndex) => {
    const row = record(rowValue, `dataset preview.preview.rows[${rowIndex}]`);
    exact(row, ["rowIndex", "values"], `dataset preview.preview.rows[${rowIndex}]`);
    safeInteger(row.rowIndex, `dataset preview.preview.rows[${rowIndex}].rowIndex`);
    if (!Array.isArray(row.values) || row.values.length !== previewHeaders.length) {
      fail("INVALID_RESPONSE", "Typed preview row width is inconsistent.");
    }
    row.values.forEach((scalar, columnIndex) => {
      assertTypedScalarV1(
        scalar,
        `dataset preview.preview.rows[${rowIndex}].values[${columnIndex}]`,
      );
    });
  });
  return item as unknown as ComputeDatasetPreviewResultV1;
}

function assertActivation(
  value: unknown,
  session: DatasetSession,
): ComputeDatasetActivationReceiptV1 {
  const item = record(value, "activation receipt");
  exact(item, [
    "schemaVersion",
    "datasetId",
    "generation",
    "activationIdentity",
    "uploadIdentity",
    "datasetReceipt",
    "activatedAt",
    "expiresAt",
    "activationReceiptSha256",
  ], "activation receipt");
  try {
    assertDatasetReceiptV1(item.datasetReceipt, "activation receipt.datasetReceipt");
  } catch {
    fail("INVALID_RESPONSE", "Activation dataset receipt is invalid.");
  }
  const receipt = item.datasetReceipt;
  if (item.schemaVersion !== "3dena.compute-dataset-activation-receipt.v1"
      || item.datasetId !== session.capability.datasetId
      || item.generation !== session.capability.generation
      || item.activationIdentity !== session.preview?.activationIdentity
      || receipt.activationIdentity !== item.activationIdentity
      || receipt.sha256 !== session.preflightSha256
      || typeof item.activationReceiptSha256 !== "string"
      || !SHA256.test(item.activationReceiptSha256)
      || Number.isNaN(Date.parse(String(item.activatedAt)))
      || Number.isNaN(Date.parse(String(item.expiresAt)))) {
    fail("INVALID_RESPONSE", "Activation receipt does not bind this dataset candidate.");
  }
  return item as unknown as ComputeDatasetActivationReceiptV1;
}

function roleMapping(
  headers: readonly string[],
  mapping: AnalysisMapping,
): DatasetRoleMappingV1 {
  const assignments = headers.map((header, index) => {
    const roles: DatasetColumnRoleV1[] = [];
    if (mapping.unitColumns.includes(header)) roles.push("unit");
    if (mapping.conversationColumns.includes(header)) roles.push("conversation");
    if (header === mapping.timeColumn) roles.push("time");
    if (mapping.codeColumns.includes(header)) roles.push("code");
    if (header === mapping.groupColumn) roles.push("group");
    if (roles.length === 0) roles.push("unmapped");
    return { index, header, roles };
  });
  return {
    schemaVersion: "3dena.dataset-role-mapping.v1",
    columns: assignments,
  };
}

function mappedInventory(
  session: DatasetSession,
  inspected: ComputeDatasetUploadResultV1,
): RemoteDatasetInventory {
  return {
    workflowId: session.capability.datasetId,
    sha256: inspected.inventory.sha256,
    byteLength: inspected.inventory.byteLength,
    format: inspected.inventory.format,
    worksheets: inspected.inventory.worksheets.map((sheet, index) =>
      worksheetSummary(sheet, `inspected dataset.inventory.worksheets[${index}]`)),
    parserVersion: inspected.inventory.parserVersion,
    warnings: inspected.inventory.vbaDetectedAndDiscarded
      ? ["VBA content was detected and discarded without execution."]
      : [],
  };
}

function mappedParsed(
  session: DatasetSession,
  parsed: ComputeDatasetWorksheetResultV1,
): RemoteParsedWorksheet {
  return {
    workflowId: session.capability.datasetId,
    parseIdentity: parsed.parsedIdentity,
    parsedContentSha256: parsed.parsedContentSha256,
    worksheet: worksheetSummary(parsed.worksheet, "parsed worksheet.worksheet"),
    headers: [...parsed.headers],
    rowCount: parsed.rowCount,
    columnCount: parsed.columnCount,
  };
}

function mappedPreview(
  session: DatasetSession,
  preview: ComputeDatasetPreviewResultV1,
): RemoteDatasetPreview {
  return {
    workflowId: session.capability.datasetId,
    activationIdentity: preview.activationIdentity,
    parsedContentSha256: preview.candidate.parsedContentSha256,
    headers: [...preview.preview.headers],
    rows: preview.preview.rows.map((row) => [...row.values]),
    totalRows: preview.preview.totalRowCount,
    diagnostics: preview.candidate.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      path: diagnostic.path,
      message: diagnostic.message,
    })),
    activatable: preview.candidate.activatable,
  };
}

/**
 * Binds the public Web product to the reviewed dataset HTTP v1 wire contract.
 * The adapter owns capability tokens in memory only and never places them in
 * URLs, logs, receipts, component state, or downloads.
 */
export function createHttpRemoteDatasetWorkflowAdapter(
  options: HttpAdapterOptions,
): RemoteDatasetWorkflowAdapter {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    fail("INVALID_CONFIGURATION", "Remote dataset workflow requires Fetch.");
  }
  const requestTimeout = options.requestTimeoutMilliseconds ?? 30_000;
  const retryMaxAttempts = options.retryMaxAttempts ?? 4;
  const retryBaseDelay = options.retryBaseDelayMilliseconds ?? 250;
  const retryMaximumDelay = options.retryMaximumDelayMilliseconds ?? 4_000;
  const retryTotalTimeout = options.retryTotalTimeoutMilliseconds ?? 30_000;
  if (!Number.isSafeInteger(requestTimeout)
      || requestTimeout < 1
      || requestTimeout > 300_000) {
    fail(
      "INVALID_CONFIGURATION",
      "requestTimeoutMilliseconds must be in [1, 300000].",
    );
  }
  if (!Number.isSafeInteger(retryMaxAttempts)
      || retryMaxAttempts < 1
      || retryMaxAttempts > 8
      || !Number.isSafeInteger(retryBaseDelay)
      || retryBaseDelay < 1
      || retryBaseDelay > 30_000
      || !Number.isSafeInteger(retryMaximumDelay)
      || retryMaximumDelay < retryBaseDelay
      || retryMaximumDelay > 60_000
      || !Number.isSafeInteger(retryTotalTimeout)
      || retryTotalTimeout < 1
      || retryTotalTimeout > 300_000) {
    fail("INVALID_CONFIGURATION", "Remote dataset retry configuration is invalid.");
  }
  const basePath = baseUrl.pathname === "/" ? "" : baseUrl.pathname;
  const serviceUrl = (path: string): string =>
    new URL(`${basePath}${path}`, baseUrl.origin).toString();
  const sessions = new Map<string, DatasetSession>();
  const preparedSessions = new Map<string, PreparedSession>();

  const preparedReceipt = async (
    prepared: RemotePreparedDataset,
  ): Promise<DatasetReceiptV1> => {
    const specHash = await hashAnalysisValueV1({
      kind: "prepared-import",
      mapping: prepared.mapping,
    });
    const dimensions = [...prepared.dimensions];
    const receipt: DatasetReceiptV1 = {
      schemaVersion: DATASET_RECEIPT_VERSION_V1,
      sha256: prepared.sha256,
      byteLength: prepared.byteLength,
      format: "ena3d-json",
      sheet: null,
      rows: prepared.points,
      columns: dimensions.length,
      schema: {
        schemaVersion: "3dena.dataset-schema.v1",
        headers: dimensions,
        columns: dimensions.map((name) => ({
          name,
          inferredType: "number",
          roles: ["unmapped"],
        })),
      },
      limits: {
        schemaVersion: "3dena.dataset-limits.v1",
        maxFileBytes: DEFAULT_ENA3D_EXCHANGE_LIMITS.maxFileBytes,
        maxWorksheets: 1,
        maxRows: DEFAULT_ENA3D_EXCHANGE_LIMITS.maxPointRows,
        maxColumns: DEFAULT_ENA3D_EXCHANGE_LIMITS.maxDimensions,
        maxCells: DEFAULT_ENA3D_EXCHANGE_LIMITS.maxTableCells,
      },
      warnings: [],
      activationIdentity: `prepared:${prepared.sha256}:${specHash}`,
    };
    assertDatasetReceiptV1(receipt);
    return receipt;
  };

  const headers = (
    session?: DatasetSession,
    idempotencyKey?: string,
    contentType = "application/json",
  ): Headers => {
    const output = new Headers({
      accept: "application/json",
      "content-type": contentType,
      "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
    });
    if (session) {
      output.set("authorization", `Bearer ${session.capability.capabilityToken}`);
    }
    if (idempotencyKey) output.set("idempotency-key", idempotencyKey);
    return output;
  };

  const jobHeaders = (
    capabilityToken: string,
    idempotencyKey: string,
  ): Headers => {
    const output = headers(undefined, idempotencyKey);
    output.set("authorization", `Bearer ${capabilityToken}`);
    return output;
  };

  const responseError = async (
    response: Response,
    attemptSignal: AbortSignal,
  ): Promise<RemoteDatasetHttpError> => {
    let code = `HTTP_${response.status}`;
    try {
      const body = JSON.parse(await readResponseText(response, attemptSignal)) as {
        code?: unknown;
      };
      if (typeof body.code === "string" && /^[A-Z0-9_]{1,80}$/u.test(body.code)) {
        code = body.code;
      }
    } catch (error) {
      if (attemptSignal.aborted) throw error;
      // Service error text is intentionally not reflected into the product.
    }
    const requestId = response.headers.get("x-request-id");
    return new RemoteDatasetHttpError(
      code,
      `Remote dataset request failed with HTTP ${response.status}${requestId ? ` (request ${requestId})` : ""}.`,
      response.status,
      requestId,
      retryAfterMilliseconds(response),
    );
  };

  const invokeJson = async (
    url: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    const startedAt = Date.now();
    let lastError: RemoteDatasetHttpError | null = null;
    for (let attempt = 1; attempt <= retryMaxAttempts; attempt += 1) {
      if (signal?.aborted) throw aborted();
      const remaining = retryTotalTimeout - (Date.now() - startedAt);
      if (remaining <= 0 && lastError !== null) throw lastError;

      const controller = new AbortController();
      let requestTimedOut = false;
      let observedRetryAfterMilliseconds: number | null = null;
      const onAbort = () => controller.abort(signal?.reason);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) controller.abort(signal.reason);
      const timer = setTimeout(() => {
        requestTimedOut = true;
        controller.abort(new DOMException("Request deadline exceeded", "TimeoutError"));
      }, Math.min(requestTimeout, Math.max(1, remaining)));
      try {
        const response = await fetchImplementation(url, {
          ...init,
          signal: controller.signal,
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
        });
        observedRetryAfterMilliseconds = retryAfterMilliseconds(response);
        if (signal?.aborted) throw aborted();
        if (!response.ok) {
          lastError = await responseError(response, controller.signal);
        } else {
          const requestId = response.headers.get("x-request-id");
          if (!(response.headers.get("content-type") ?? "")
            .toLocaleLowerCase("en-US").startsWith("application/json")) {
            throw new RemoteDatasetHttpError(
              "INVALID_RESPONSE",
              "Remote dataset response is not JSON.",
              response.status,
              requestId,
            );
          }
          const body = await readResponseText(response, controller.signal);
          if (signal?.aborted) throw aborted();
          try {
            return JSON.parse(body) as unknown;
          } catch {
            throw new RemoteDatasetHttpError(
              "INVALID_RESPONSE",
              "Remote dataset response is malformed JSON.",
              response.status,
              requestId,
            );
          }
        }
      } catch (error) {
        if (error instanceof RemoteDatasetHttpError) {
          lastError = error;
        } else if (signal?.aborted) {
          throw aborted();
        } else if (requestTimedOut) {
          lastError = new RemoteDatasetHttpError(
            "REQUEST_TIMEOUT",
            "The remote dataset request exceeded the client deadline.",
            null,
            null,
            observedRetryAfterMilliseconds,
          );
        } else {
          lastError = new RemoteDatasetHttpError(
            "NETWORK_FAILURE",
            "The remote dataset service could not be reached.",
            null,
            null,
            observedRetryAfterMilliseconds,
          );
        }
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }

      if (lastError === null || !retryable(lastError) || attempt === retryMaxAttempts) {
        throw lastError ?? new RemoteDatasetHttpError(
          "NETWORK_FAILURE",
          "The remote dataset service could not be reached.",
        );
      }
      const exponentialDelay = Math.min(
        retryMaximumDelay,
        retryBaseDelay * (2 ** (attempt - 1)),
      );
      const retryDelay = Math.max(
        exponentialDelay,
        lastError.retryAfterMilliseconds ?? 0,
      );
      if (Date.now() - startedAt + retryDelay > retryTotalTimeout) throw lastError;
      await wait(retryDelay, signal);
    }
    throw lastError ?? new RemoteDatasetHttpError(
      "NETWORK_FAILURE",
      "The remote dataset service could not be reached.",
    );
  };

  const sessionFor = (workflowId: string): DatasetSession => {
    const session = sessions.get(workflowId);
    if (!session) fail("STALE_WORKFLOW", "The dataset workflow capability is no longer available.");
    return session;
  };

  const deleteSession = async (
    session: DatasetSession,
    signal?: AbortSignal,
  ): Promise<void> => {
    const value = await invokeJson(
      serviceUrl(`/v1/datasets/${encodeURIComponent(session.capability.datasetId)}`),
      {
        method: "DELETE",
        headers: headers(session, randomIdempotencyKey("dataset-delete")),
      },
      signal,
    );
    const receipt = record(value, "dataset deletion receipt");
    exact(receipt, ["schemaVersion", "datasetId", "deletedAt", "sourceDeleted"], "dataset deletion receipt");
    if (receipt.schemaVersion !== "3dena.compute-dataset-deletion-receipt.v1"
        || receipt.datasetId !== session.capability.datasetId
        || receipt.sourceDeleted !== true
        || Number.isNaN(Date.parse(String(receipt.deletedAt)))) {
      fail("DELETION_NOT_OBSERVED", "The service did not attest source deletion.");
    }
    sessions.delete(session.capability.datasetId);
  };

  return Object.freeze({
    async capabilities(signal?: AbortSignal) {
      const value = await invokeJson(
        serviceUrl("/build-info"),
        { method: "GET", headers: headers() },
        signal,
      );
      const build = record(value, "compute build info");
      exact(build, [
        "schemaVersion",
        "approvalManifestSha256",
        "releaseId",
        "gitCommit",
        "flyImageDigest",
        "flyBuildId",
        "role",
        "contractVersions",
      ], "compute build info");
      if (build.schemaVersion !== "3dena.compute-build-info.v1"
          || build.role !== "api"
          || typeof build.approvalManifestSha256 !== "string"
          || !SHA256.test(build.approvalManifestSha256)
          || typeof build.gitCommit !== "string"
          || !/^[a-f0-9]{40}$/u.test(build.gitCommit)
          || typeof build.releaseId !== "string"
          || !OPAQUE_ID.test(build.releaseId)
          || typeof build.flyImageDigest !== "string"
          || !/^sha256:[a-f0-9]{64}$/u.test(build.flyImageDigest)
          || typeof build.flyBuildId !== "string"
          || !OPAQUE_ID.test(build.flyBuildId)
          || !Array.isArray(build.contractVersions)
          || build.contractVersions.some((version) => typeof version !== "string")) {
        fail("INVALID_RESPONSE", "Compute build info is invalid.");
      }
      if (!build.contractVersions.includes(REMOTE_DATASET_WORKFLOW_REQUIRED_CONTRACT)) {
        return {
          available: false,
          contractVersion: null,
          blocker: "The allowlisted compute build does not advertise the reviewed dataset workflow contract. No file was uploaded.",
          executionAvailable: false,
          executionBlocker: "Activated service execution is unavailable because the dataset workflow contract is missing.",
        };
      }
      if (!build.contractVersions.includes(REMOTE_DERIVED_EXECUTION_REQUIRED_CONTRACT)) {
        return {
          available: true,
          contractVersion: REMOTE_DATASET_WORKFLOW_REQUIRED_CONTRACT,
          blocker: null,
          executionAvailable: false,
          executionBlocker: "The allowlisted compute build does not advertise the reviewed service-owned source-result job contract. Analysis execution remains fail-closed.",
        };
      }
      if (!build.contractVersions.includes(REMOTE_PREPARED_IMPORT_REQUIRED_CONTRACT)) {
        return {
          available: true,
          contractVersion: REMOTE_DATASET_WORKFLOW_REQUIRED_CONTRACT,
          blocker: null,
          executionAvailable: false,
          executionBlocker: "The allowlisted compute build does not advertise the reviewed prepared-exchange import contract. Analysis execution remains fail-closed.",
        };
      }
      return {
        available: true,
        contractVersion: REMOTE_DATASET_WORKFLOW_REQUIRED_CONTRACT,
        blocker: null,
        executionAvailable: true,
        executionBlocker: null,
      };
    },

    async inspect(
      file: File,
      signal: AbortSignal,
      onProgress: (progress: RemoteWorkflowProgress) => void,
    ) {
      const extension = declaredExtension(file);
      onProgress({
        phase: "browser-preflight",
        completed: 0,
        total: file.size,
        message: "Hashing an owned browser snapshot before service upload…",
      });
      const bytes = await file.arrayBuffer();
      if (signal.aborted) throw signal.reason;
      const preflight = await createBrowserPreflightReceipt({
        schemaVersion: "3dena.browser-preflight-input.v1",
        declaredExtension: extension,
        bytes,
      });
      if (signal.aborted) throw signal.reason;
      const createRequest: CreateComputeDatasetRequestV1 = {
        schemaVersion: "3dena.create-compute-dataset-request.v1",
        preflight,
        processingPolicyConfirmed: true,
      };
      const capability = assertCapability(
        await invokeJson(
          serviceUrl("/v1/datasets"),
          {
            method: "POST",
            headers: headers(undefined, randomIdempotencyKey("dataset-create")),
            body: JSON.stringify(createRequest),
          },
          signal,
        ),
        baseUrl.origin,
      );
      const session: DatasetSession = {
        capability,
        preflightSha256: preflight.sha256,
        inspected: null,
        parsed: null,
        mappingReceipt: null,
        preview: null,
        activation: null,
      };
      sessions.set(capability.datasetId, session);
      try {
        onProgress({
          phase: "service-inventory",
          completed: preflight.byteLength,
          total: preflight.byteLength,
          message: "Uploading exact bytes for authoritative service inspection…",
        });
        const inspected = assertInspected(
          await invokeJson(
            capability.contentUrl,
            {
              method: "PUT",
              headers: headers(
                session,
                randomIdempotencyKey("dataset-content"),
                "application/octet-stream",
              ),
              body: bytes,
            },
            signal,
          ),
          session,
        );
        session.inspected = inspected;
        onProgress({
          phase: "service-inventory",
          completed: preflight.byteLength,
          total: preflight.byteLength,
          message: "Authoritative service inventory received and exact-byte hash matched.",
        });
        return mappedInventory(session, inspected);
      } catch (error) {
        try {
          await deleteSession(session);
        } catch (cleanupError) {
          throw new RemoteDatasetHttpError(
            "UPLOAD_CLEANUP_UNCONFIRMED",
            `${error instanceof Error ? error.message : "Dataset inspection failed."} Service cleanup was not attested: ${cleanupError instanceof Error ? cleanupError.message : "unknown cleanup failure"}`,
          );
        }
        throw error;
      }
    },

    async inspectPrepared(
      file: File,
      signal: AbortSignal,
      onProgress: (progress: RemoteWorkflowProgress) => void,
    ) {
      if (!file.name.toLocaleLowerCase("en-US").endsWith(".ena3d.json")) {
        fail("UNSUPPORTED_DATASET", "Prepared inspection requires a strict .ena3d.json file.");
      }
      onProgress({
        phase: "prepared-preflight",
        completed: 0,
        total: file.size,
        message: "Strictly decoding an owned exact-byte snapshot before activation…",
      });
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (signal.aborted) throw signal.reason;
      const inspection = await inspectDataset(bytes, { name: file.name });
      if (inspection.kind !== "prepared-exchange") {
        fail("INVALID_PREPARED_EXCHANGE", "Prepared inspection returned the wrong dataset variant.");
      }
      const summary = inspectPreparedExchange(inspection.artifact.exchange);
      const workflowId = randomIdempotencyKey("prepared");
      const dataset: RemotePreparedDataset = Object.freeze({
        workflowId,
        sha256: inspection.receipt.sha256,
        byteLength: inspection.receipt.byteLength,
        dimensions: Object.freeze([...inspection.inventory.dimensions]),
        groupVariables: Object.freeze([...inspection.inventory.groupVariables]),
        tables: Object.freeze(inspection.inventory.tables.map((table) => Object.freeze({ ...table }))),
        points: summary.points,
        nodes: summary.nodes,
        edges: summary.edges,
        groups: summary.groups,
        periods: Object.freeze([...summary.periods]),
        mapping: Object.freeze({
          ...PREPARED_EXCHANGE_MAPPING,
          participant: Object.freeze([...PREPARED_EXCHANGE_MAPPING.participant]),
          timeOrder: Object.freeze([...PREPARED_EXCHANGE_MAPPING.timeOrder]),
          displayDimensions: Object.freeze([...PREPARED_EXCHANGE_MAPPING.displayDimensions]),
        }) as typeof PREPARED_EXCHANGE_MAPPING,
      });
      preparedSessions.set(workflowId, {
        bytes: Uint8Array.from(bytes),
        dataset,
      });
      onProgress({
        phase: "prepared-preflight",
        completed: bytes.byteLength,
        total: bytes.byteLength,
        message: "Strict exchange schema, scientific inventory, exact hash, and frozen mapping passed local preflight. No service upload has occurred yet.",
      });
      return dataset;
    },

    async parseWorksheet(
      inventory: RemoteDatasetInventory,
      worksheet: RemoteWorksheetSummary,
      signal: AbortSignal,
    ) {
      const session = sessionFor(inventory.workflowId);
      if (!session.inspected || worksheet.hidden || !worksheet.selectable) {
        fail("INVALID_SELECTION", "Only an inspected visible worksheet can be selected.");
      }
      const request: SelectComputeDatasetWorksheetRequestV1 = {
        schemaVersion: "3dena.select-compute-dataset-worksheet-request.v1",
        selection: { index: worksheet.index, name: worksheet.name },
      };
      const parsed = assertParsed(
        await invokeJson(
          serviceUrl(`/v1/datasets/${encodeURIComponent(inventory.workflowId)}/selection`),
          {
            method: "POST",
            headers: headers(session, randomIdempotencyKey("dataset-selection")),
            body: JSON.stringify(request),
          },
          signal,
        ),
        session,
      );
      if (parsed.worksheet.index !== worksheet.index
          || parsed.worksheet.name !== worksheet.name) {
        fail("INVALID_RESPONSE", "Parsed worksheet does not match the exact selection.");
      }
      session.parsed = parsed;
      session.mappingReceipt = null;
      session.preview = null;
      session.activation = null;
      return mappedParsed(session, parsed);
    },

    async prepare(
      parsed: RemoteParsedWorksheet,
      mapping: AnalysisMapping,
      signal: AbortSignal,
    ) {
      const session = sessionFor(parsed.workflowId);
      if (!session.parsed || session.parsed.parsedIdentity !== parsed.parseIdentity) {
        fail("STALE_WORKFLOW", "The mapping does not belong to the current parsed worksheet.");
      }
      const mappingRequest: PutComputeDatasetMappingRequestV1 = {
        schemaVersion: "3dena.put-compute-dataset-mapping-request.v1",
        parsedIdentity: parsed.parseIdentity as ParsedIdentityV1,
        mapping: roleMapping(parsed.headers, mapping),
      };
      const mappingReceipt = assertMappingReceipt(
        await invokeJson(
          serviceUrl(`/v1/datasets/${encodeURIComponent(parsed.workflowId)}/mapping`),
          {
            method: "PUT",
            headers: headers(session, randomIdempotencyKey("dataset-mapping")),
            body: JSON.stringify(mappingRequest),
          },
          signal,
        ),
        session,
        parsed.parseIdentity,
      );
      session.mappingReceipt = mappingReceipt;
      const previewRequest: PreviewComputeDatasetRequestV1 = {
        schemaVersion: "3dena.preview-compute-dataset-request.v1",
        mappingSha256: mappingReceipt.mappingSha256,
      };
      const preview = assertPreview(
        await invokeJson(
          serviceUrl(`/v1/datasets/${encodeURIComponent(parsed.workflowId)}/preview`),
          {
            method: "POST",
            headers: headers(session, randomIdempotencyKey("dataset-preview")),
            body: JSON.stringify(previewRequest),
          },
          signal,
        ),
        session,
      );
      session.preview = preview;
      session.activation = null;
      return mappedPreview(session, preview);
    },

    async activate(
      preview: RemoteDatasetPreview,
      expectedActiveActivationIdentity: string | null,
      signal: AbortSignal,
    ): Promise<RemoteActiveDataset> {
      const session = sessionFor(preview.workflowId);
      if (!session.preview
          || session.preview.activationIdentity !== preview.activationIdentity
          || !preview.activatable) {
        fail("STALE_WORKFLOW", "The preview is no longer the activatable service candidate.");
      }
      const sessionExpected = session.activation?.activationIdentity ?? null;
      if (sessionExpected !== null
          && expectedActiveActivationIdentity !== sessionExpected) {
        fail("ACTIVATION_CONFLICT", "The active dataset changed before activation.");
      }
      const request: ActivateComputeDatasetRequestV1 = {
        schemaVersion: "3dena.activate-compute-dataset-request.v1",
        activationIdentity: preview.activationIdentity as ActivationIdentityV1,
        expectedActiveActivationIdentity: sessionExpected,
      };
      const activation = assertActivation(
        await invokeJson(
          serviceUrl(`/v1/datasets/${encodeURIComponent(preview.workflowId)}/activate`),
          {
            method: "POST",
            headers: headers(session, randomIdempotencyKey("dataset-activate")),
            body: JSON.stringify(request),
          },
          signal,
        ),
        session,
      );
      session.activation = activation;
      return {
        workflowId: preview.workflowId,
        activationIdentity: activation.activationIdentity,
        receipt: activation.datasetReceipt,
      };
    },

    async bindPreparedExecution(
      prepared: RemotePreparedDataset,
      runId: string,
      deadlineEpochMilliseconds: number,
      signal: AbortSignal,
    ) {
      const session = preparedSessions.get(prepared.workflowId);
      if (!session
          || session.dataset.sha256 !== prepared.sha256
          || session.dataset.byteLength !== prepared.byteLength
          || !OPAQUE_ID.test(runId)
          || !Number.isSafeInteger(deadlineEpochMilliseconds)) {
        fail("STALE_WORKFLOW", "The prepared exchange is no longer bound to its owned exact-byte snapshot.");
      }
      const receipt = await preparedReceipt(prepared);
      const capability = assertJobCapability(
        await invokeJson(
          serviceUrl("/v1/jobs"),
          {
            method: "POST",
            headers: headers(undefined, randomIdempotencyKey("prepared-job")),
            body: JSON.stringify({
              schemaVersion: "3dena.create-job-request.v1",
              dataset: {
                sha256: receipt.sha256,
                byteLength: receipt.byteLength,
                format: "ena3d-json",
              },
              processingPolicyConfirmed: true,
            }),
          },
          signal,
        ),
        baseUrl.origin,
      );
      try {
        const uploadHeaders = jobHeaders(
          capability.capabilityToken,
          randomIdempotencyKey("prepared-content"),
        );
        uploadHeaders.set("content-type", "application/octet-stream");
        const upload = record(await invokeJson(
          capability.uploadUrl,
          {
            method: "PUT",
            headers: uploadHeaders,
            body: session.bytes,
          },
          signal,
        ), "prepared upload receipt");
        exact(upload, ["schemaVersion", "jobId", "sha256", "byteLength", "accepted"], "prepared upload receipt");
        if (upload.schemaVersion !== "3dena.prepared-import-upload-receipt.v1"
            || upload.jobId !== capability.jobId
            || upload.sha256 !== receipt.sha256
            || upload.byteLength !== receipt.byteLength
            || upload.accepted !== true) {
          fail("INVALID_RESPONSE", "Prepared upload receipt does not match the exact-byte reservation.");
        }
      } catch (error) {
        try {
          await invokeJson(
            serviceUrl(`/v1/jobs/${encodeURIComponent(capability.jobId)}`),
            {
              method: "DELETE",
              headers: jobHeaders(
                capability.capabilityToken,
                randomIdempotencyKey("prepared-upload-delete"),
              ),
            },
          );
        } catch (cleanupError) {
          throw new RemoteDatasetHttpError(
            "UPLOAD_CLEANUP_UNCONFIRMED",
            `${error instanceof Error ? error.message : "Prepared upload failed."} Job cleanup was not attested: ${cleanupError instanceof Error ? cleanupError.message : "unknown cleanup failure"}`,
          );
        }
        throw error;
      }
      preparedSessions.delete(prepared.workflowId);
      const task: ActivatedPreparedImportTaskSpecV1 = {
        schemaVersion: "3dena.activated-prepared-import-task-spec.v1",
        kind: "prepared-import",
        runId,
        deadlineEpochMilliseconds,
        mapping: prepared.mapping,
      };
      const executeRequest: ExecutePreparedImportJobRequestV1 = {
        schemaVersion: "3dena.execute-prepared-import-job-request.v1",
        datasetReceipt: receipt,
        task,
      };
      const executeBody = JSON.stringify(executeRequest);
      const executeIdempotencyKey = randomIdempotencyKey("prepared-execute");
      return {
        reference: {
          jobId: capability.jobId,
          capabilityToken: capability.capabilityToken,
        },
        datasetReceipt: receipt,
        taskKind: task.kind,
        runId,
        async start(startSignal?: AbortSignal) {
          await invokeJson(
            serviceUrl(`/v1/jobs/${encodeURIComponent(capability.jobId)}/execute`),
            {
              method: "POST",
              headers: jobHeaders(
                capability.capabilityToken,
                executeIdempotencyKey,
              ),
              body: executeBody,
            },
            startSignal,
          );
        },
      };
    },

    async bindExecution(
      active: RemoteActiveDataset,
      task: ActivatedAnalysisTaskSpecV1,
      signal: AbortSignal,
    ) {
      if (task.kind !== "ena-model") {
        fail(
          "SOURCE_RESULT_REQUIRED",
          "Derived analysis must bind a verified service-owned ENA source result, not a raw activation.",
        );
      }
      const session = sessionFor(active.workflowId);
      const activation = session.activation;
      if (!activation
          || activation.activationIdentity !== active.activationIdentity
          || activation.datasetReceipt.sha256 !== active.receipt.sha256) {
        fail("STALE_WORKFLOW", "The active receipt is no longer bound to this service capability.");
      }
      const createRequest: CreateActivatedAnalysisJobRequestV1 = {
        schemaVersion: "3dena.create-activated-job-request.v1",
        activationReceipt: activation,
        processingPolicyConfirmed: true,
      };
      const capability = assertJobCapability(
        await invokeJson(
          serviceUrl("/v1/jobs"),
          {
            method: "POST",
            headers: headers(session, randomIdempotencyKey("activated-job")),
            body: JSON.stringify(createRequest),
          },
          signal,
        ),
        baseUrl.origin,
      );
      const executeRequest: ExecuteActivatedAnalysisJobRequestV1 = {
        schemaVersion: "3dena.execute-activated-job-request.v1",
        task,
      };
      const executeBody = JSON.stringify(executeRequest);
      const executeIdempotencyKey = randomIdempotencyKey("activated-execute");
      return {
        reference: {
          jobId: capability.jobId,
          capabilityToken: capability.capabilityToken,
        },
        datasetReceipt: active.receipt,
        taskKind: task.kind,
        runId: task.runId,
        async start(startSignal?: AbortSignal) {
          await invokeJson(
            serviceUrl(`/v1/jobs/${encodeURIComponent(capability.jobId)}/execute`),
            {
              method: "POST",
              headers: jobHeaders(
                capability.capabilityToken,
                executeIdempotencyKey,
              ),
              body: executeBody,
            },
            startSignal,
          );
        },
      };
    },

    async bindDerivedExecution(
      source: RemoteEnaSourceResult,
      task: ActivatedAnalysisTaskSpecV1,
      signal: AbortSignal,
    ) {
      if (task.kind === "ena-model"
          || !("sourceResultHash" in task)
          || task.sourceResultHash !== source.sourceResultHash
          || !SHA256.test(source.sourceResultHash)
          || !OPAQUE_ID.test(source.reference.jobId)
          || !/^[A-Za-z0-9_-]{16,512}$/u.test(source.reference.capabilityToken)) {
        fail("SOURCE_RESULT_MISMATCH", "Derived task does not match its verified ENA source binding.");
      }
      assertDatasetReceiptV1(source.datasetReceipt);
      const createRequest: CreateSourceResultAnalysisJobRequestV1 = {
        schemaVersion: "3dena.create-source-result-job-request.v1",
        sourceJobId: source.reference.jobId,
        sourceResultHash: source.sourceResultHash,
        processingPolicyConfirmed: true,
      };
      const capability = assertSourceResultJobCapability(
        await invokeJson(
          serviceUrl("/v1/jobs"),
          {
            method: "POST",
            headers: jobHeaders(
              source.reference.capabilityToken,
              randomIdempotencyKey("source-result-job"),
            ),
            body: JSON.stringify(createRequest),
          },
          signal,
        ),
        source,
      );
      const executeRequest: ExecuteActivatedAnalysisJobRequestV1 = {
        schemaVersion: "3dena.execute-activated-job-request.v1",
        task,
      };
      const executeBody = JSON.stringify(executeRequest);
      const executeIdempotencyKey = randomIdempotencyKey("source-result-execute");
      return {
        reference: {
          jobId: capability.jobId,
          capabilityToken: capability.capabilityToken,
        },
        datasetReceipt: source.datasetReceipt,
        taskKind: task.kind,
        runId: task.runId,
        sourceResultHash: source.sourceResultHash,
        async start(startSignal?: AbortSignal) {
          await invokeJson(
            serviceUrl(`/v1/jobs/${encodeURIComponent(capability.jobId)}/execute`),
            {
              method: "POST",
              headers: jobHeaders(
                capability.capabilityToken,
                executeIdempotencyKey,
              ),
              body: executeBody,
            },
            startSignal,
          );
        },
      };
    },

    async discard(workflowId: string, signal?: AbortSignal) {
      if (preparedSessions.delete(workflowId)) return;
      const session = sessions.get(workflowId);
      if (!session) return;
      await deleteSession(session, signal);
    },
  });
}
