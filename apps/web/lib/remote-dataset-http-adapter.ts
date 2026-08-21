import {
  ANALYSIS_CONTRACT_VERSION_V1,
  assertDatasetReceiptV1,
  assertTypedScalarV1,
  type AnalysisJobCapabilityV1,
} from "@3dena/analysis";
import type {
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
  PreviewComputeDatasetRequestV1,
  PutComputeDatasetMappingRequestV1,
  SelectComputeDatasetWorksheetRequestV1,
  SourceResultAnalysisJobCapabilityV1,
} from "@3dena/compute-service-http";
import {
  createBrowserPreflightReceipt,
  type ActivationIdentityV1,
  type DatasetColumnRoleV1,
  type DatasetRoleMappingV1,
  type ParsedIdentityV1,
} from "@3dena/dataset-workflow";
import type { AnalysisMapping } from "@/lib/analysis-contract";
import {
  REMOTE_DATASET_WORKFLOW_REQUIRED_CONTRACT,
  REMOTE_DERIVED_EXECUTION_REQUIRED_CONTRACT,
  type RemoteActiveDataset,
  type RemoteDatasetInventory,
  type RemoteDatasetPreview,
  type RemoteDatasetWorkflowAdapter,
  type RemoteEnaSourceResult,
  type RemoteParsedWorksheet,
  type RemoteWorkflowProgress,
  type RemoteWorksheetSummary,
} from "@/lib/remote-dataset-workflow";

const SHA256 = /^[a-f0-9]{64}$/u;
const OPAQUE_ID = /^[A-Za-z0-9_-]{8,200}$/u;

interface HttpAdapterOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
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

class RemoteDatasetHttpError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RemoteDatasetHttpError";
    this.code = code;
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
  const basePath = baseUrl.pathname === "/" ? "" : baseUrl.pathname;
  const serviceUrl = (path: string): string =>
    new URL(`${basePath}${path}`, baseUrl.origin).toString();
  const sessions = new Map<string, DatasetSession>();

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

  const invokeJson = async (
    url: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetchImplementation(url, {
        ...init,
        ...(signal ? { signal } : {}),
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      if (signal?.aborted) throw signal.reason;
      throw new RemoteDatasetHttpError(
        "NETWORK_FAILURE",
        "The remote dataset service could not be reached.",
      );
    }
    const requestId = response.headers.get("x-request-id");
    if (!response.ok) {
      let code = `HTTP_${response.status}`;
      try {
        const body = await response.json() as { code?: unknown };
        if (typeof body.code === "string" && /^[A-Z0-9_]{1,80}$/u.test(body.code)) {
          code = body.code;
        }
      } catch {
        // Service error text is intentionally not reflected into the product.
      }
      throw new RemoteDatasetHttpError(
        code,
        `Remote dataset request failed with HTTP ${response.status}${requestId ? ` (request ${requestId})` : ""}.`,
      );
    }
    if (!(response.headers.get("content-type") ?? "")
      .toLocaleLowerCase("en-US").startsWith("application/json")) {
      fail("INVALID_RESPONSE", "Remote dataset response is not JSON.");
    }
    try {
      return await response.json();
    } catch {
      fail("INVALID_RESPONSE", "Remote dataset response is malformed JSON.");
    }
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
      return {
        reference: {
          jobId: capability.jobId,
          capabilityToken: capability.capabilityToken,
        },
        datasetReceipt: active.receipt,
        taskKind: task.kind,
        runId: task.runId,
        async start(startSignal?: AbortSignal) {
          const jobHeaders = new Headers({
            accept: "application/json",
            "content-type": "application/json",
            "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
            authorization: `Bearer ${capability.capabilityToken}`,
            "idempotency-key": randomIdempotencyKey("activated-execute"),
          });
          await invokeJson(
            serviceUrl(`/v1/jobs/${encodeURIComponent(capability.jobId)}/execute`),
            {
              method: "POST",
              headers: jobHeaders,
              body: JSON.stringify(executeRequest),
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
                randomIdempotencyKey("source-result-execute"),
              ),
              body: JSON.stringify(executeRequest),
            },
            startSignal,
          );
        },
      };
    },

    async discard(workflowId: string, signal?: AbortSignal) {
      const session = sessions.get(workflowId);
      if (!session) return;
      await deleteSession(session, signal);
    },
  });
}
