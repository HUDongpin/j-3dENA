import {
  ANALYSIS_CONTRACT_VERSION_V1,
  assertAnalysisTaskV1,
  assertDatasetReceiptV1,
  type AnalysisTaskV1,
  type DatasetReceiptV1,
  type TaskOwnerV1,
} from "./contracts";

export type RemoteJobStateV1 =
  | "CREATED"
  | "UPLOADED"
  | "QUEUED"
  | "RUNNING"
  | "CANCEL_REQUESTED"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";

export interface CreateAnalysisJobRequestV1 {
  schemaVersion: "3dena.create-job-request.v1";
  dataset: {
    sha256: string;
    byteLength: number;
    format: DatasetReceiptV1["format"];
  };
  processingPolicyConfirmed: true;
}

export interface AnalysisJobCapabilityV1 {
  schemaVersion: "3dena.job-capability.v1";
  jobId: string;
  capabilityToken: string;
  uploadUrl: string;
  expiresAt: string;
}

export interface AnalysisJobReferenceV1 {
  jobId: string;
  capabilityToken: string;
}

export interface ExecuteAnalysisJobRequestV1 {
  schemaVersion: "3dena.execute-job-request.v1";
  datasetReceipt: DatasetReceiptV1;
  task: AnalysisTaskV1;
}

export interface AnalysisJobStatusV1 {
  schemaVersion: "3dena.job-status.v1";
  jobId: string;
  state: RemoteJobStateV1;
  owner: TaskOwnerV1 | null;
  progress: { phase: string; completed: number; total: number | null } | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  resultAvailable: boolean;
  errorCode: string | null;
}

export interface AnalysisJobEventV1 {
  schemaVersion: "3dena.job-event.v1";
  sequence: number;
  state: RemoteJobStateV1;
  phase: string;
  completed: number;
  total: number | null;
  emittedAt: string;
}

export interface AnalysisJobResultReferenceV1 {
  schemaVersion: "3dena.job-result-reference.v1";
  jobId: string;
  sha256: string;
  byteLength: number;
  resultUrl: string;
  exportUrl: string | null;
  expiresAt: string;
}

export interface AnalysisDeletionReceiptV1 {
  schemaVersion: "3dena.job-deletion-receipt.v1";
  jobId: string;
  cancelled: boolean;
  inputDeleted: boolean;
  resultDeleted: boolean;
  deletedAt: string;
}

export interface AnalysisDeletionReceiptV2 {
  schemaVersion: "3dena.job-deletion-receipt.v2";
  jobId: string;
  cancelled: boolean;
  inputDeleted: boolean;
  resultDeleted: boolean;
  deletedAt: string | null;
  readonly intentAccepted: true;
  readonly termination: "not_required" | "pending" | "observed";
  readonly capacity: "not_reserved" | "held" | "released";
  readonly objects: "pending" | "deleted";
}

export interface AnalysisComputeBuildInfoV1 {
  schemaVersion: "3dena.compute-build-info.v1";
  approvalManifestSha256: string;
  releaseId: string;
  gitCommit: string;
  flyImageDigest: string;
  flyBuildId: string;
  role: "api";
  contractVersions: string[];
}

export interface AnalysisClientConfig {
  baseUrl: string;
  fetch?: typeof fetch;
  /** Client-side request deadline; the scientific task retains its own deadline. */
  requestTimeoutMilliseconds?: number;
  /** Delay between stable-key V2 deletion reconciliation requests. */
  deletionPollIntervalMilliseconds?: number;
  /** Total time allowed for the durable deletion lifecycle to close. */
  deletionCompletionTimeoutMilliseconds?: number;
}

export interface AnalysisClientV1 {
  createJob(request: CreateAnalysisJobRequestV1, idempotencyKey: string): Promise<AnalysisJobCapabilityV1>;
  executeJob(reference: AnalysisJobReferenceV1, request: ExecuteAnalysisJobRequestV1, idempotencyKey: string): Promise<AnalysisJobStatusV1>;
  getJob(reference: AnalysisJobReferenceV1): Promise<AnalysisJobStatusV1>;
  events(reference: AnalysisJobReferenceV1, signal?: AbortSignal): AsyncGenerator<AnalysisJobEventV1>;
  getResult(reference: AnalysisJobReferenceV1): Promise<AnalysisJobResultReferenceV1>;
  deleteJob(reference: AnalysisJobReferenceV1, idempotencyKey: string): Promise<AnalysisDeletionReceiptV1>;
  getBuildInfo(): Promise<AnalysisComputeBuildInfoV1>;
}

/**
 * Additive durable-deletion client contract. Keeping these methods out of V1
 * preserves source compatibility for existing V1-only client implementations.
 */
export interface AnalysisClientV2 extends AnalysisClientV1 {
  deleteJobV2(reference: AnalysisJobReferenceV1, idempotencyKey: string): Promise<AnalysisDeletionReceiptV2>;
  deleteJobUntilComplete(
    reference: AnalysisJobReferenceV1,
    idempotencyKey: string,
  ): Promise<AnalysisDeletionReceiptV2>;
}

export class AnalysisClientError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly requestId: string | null;

  constructor(code: string, message: string, status: number | null = null, requestId: string | null = null) {
    super(message);
    this.name = "AnalysisClientError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_COMMIT = /^[a-f0-9]{40}$/u;
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const CONTRACT_VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u;
const JOB_STATES = new Set<RemoteJobStateV1>([
  "CREATED", "UPLOADED", "QUEUED", "RUNNING", "CANCEL_REQUESTED", "SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED",
]);

function clientError(code: string, message: string): never {
  throw new AnalysisClientError(code, message);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) clientError("INVALID_RESPONSE", `${path} must be an object.`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, fields: readonly string[], path: string): void {
  const allowed = new Set(fields);
  const unknown = Object.keys(value).find((field) => !allowed.has(field));
  if (unknown) clientError("INVALID_RESPONSE", `${path} contains unknown field ${JSON.stringify(unknown)}.`);
  const missing = fields.find((field) => !Object.hasOwn(value, field));
  if (missing) clientError("INVALID_RESPONSE", `${path} is missing ${JSON.stringify(missing)}.`);
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") clientError("INVALID_RESPONSE", `${path} must be a non-empty string.`);
  return value;
}

function timestamp(value: unknown, path: string): string {
  const result = stringValue(value, path);
  if (Number.isNaN(Date.parse(result))) clientError("INVALID_RESPONSE", `${path} must be an ISO timestamp.`);
  return result;
}

function safeInteger(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) clientError("INVALID_RESPONSE", `${path} must be a safe integer >= ${minimum}.`);
  return value as number;
}

function safeUrl(value: unknown, path: string): string {
  const raw = stringValue(value, path);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    clientError("INVALID_RESPONSE", `${path} must be an absolute URL.`);
  }
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    clientError("INVALID_RESPONSE", `${path} must be HTTPS or loopback HTTP and contain no credentials.`);
  }
  return url.toString();
}

function validateReference(reference: AnalysisJobReferenceV1): void {
  if (!reference || typeof reference.jobId !== "string" || reference.jobId.trim() === "") clientError("INVALID_JOB_REFERENCE", "jobId must be non-empty.");
  if (typeof reference.capabilityToken !== "string" || reference.capabilityToken.trim() === "") clientError("INVALID_JOB_REFERENCE", "capabilityToken must be non-empty.");
}

function validateIdempotencyKey(value: string): void {
  if (typeof value !== "string" || value.length < 8 || value.length > 200 || /[\u0000-\u0020\u007f]/u.test(value)) {
    clientError("INVALID_IDEMPOTENCY_KEY", "Idempotency key must be 8-200 visible non-whitespace characters.");
  }
}

function validateCreateRequest(request: CreateAnalysisJobRequestV1): void {
  const value = record(request, "request");
  exact(value, ["schemaVersion", "dataset", "processingPolicyConfirmed"], "request");
  if (request.schemaVersion !== "3dena.create-job-request.v1") clientError("INVALID_REQUEST", "Unsupported create-job schema version.");
  const dataset = record(request.dataset, "request.dataset");
  exact(dataset, ["sha256", "byteLength", "format"], "request.dataset");
  if (!SHA256.test(request.dataset.sha256)) clientError("INVALID_REQUEST", "Dataset SHA-256 must be lowercase hexadecimal.");
  if (!Number.isSafeInteger(request.dataset.byteLength) || request.dataset.byteLength < 1) clientError("INVALID_REQUEST", "Dataset byteLength must be a positive safe integer.");
  if (!(["csv", "xlsx", "xls", "ena3d-json"] as unknown[]).includes(request.dataset.format)) clientError("INVALID_REQUEST", "Dataset format is unsupported.");
  if (request.processingPolicyConfirmed !== true) clientError("PROCESSING_POLICY_NOT_CONFIRMED", "Server processing policy must be confirmed before creating a job.");
}

function capability(value: unknown): AnalysisJobCapabilityV1 {
  const item = record(value, "response");
  exact(item, ["schemaVersion", "jobId", "capabilityToken", "uploadUrl", "expiresAt"], "response");
  if (item.schemaVersion !== "3dena.job-capability.v1") clientError("INVALID_RESPONSE", "Unsupported job capability schema.");
  return {
    schemaVersion: "3dena.job-capability.v1",
    jobId: stringValue(item.jobId, "response.jobId"),
    capabilityToken: stringValue(item.capabilityToken, "response.capabilityToken"),
    uploadUrl: safeUrl(item.uploadUrl, "response.uploadUrl"),
    expiresAt: timestamp(item.expiresAt, "response.expiresAt"),
  };
}

function owner(value: unknown, path: string): TaskOwnerV1 | null {
  if (value === null) return null;
  const item = record(value, path);
  exact(item, ["contractVersion", "datasetHash", "specHash", "runId", "taskId"], path);
  if (item.contractVersion !== ANALYSIS_CONTRACT_VERSION_V1) clientError("INVALID_RESPONSE", `${path}.contractVersion is unsupported.`);
  if (typeof item.datasetHash !== "string" || typeof item.specHash !== "string" || !SHA256.test(item.datasetHash) || !SHA256.test(item.specHash)) clientError("INVALID_RESPONSE", `${path} hashes are invalid.`);
  return {
    contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
    datasetHash: item.datasetHash,
    specHash: item.specHash,
    runId: stringValue(item.runId, `${path}.runId`),
    taskId: stringValue(item.taskId, `${path}.taskId`),
  };
}

function state(value: unknown, path: string): RemoteJobStateV1 {
  if (typeof value !== "string" || !JOB_STATES.has(value as RemoteJobStateV1)) clientError("INVALID_RESPONSE", `${path} is unsupported.`);
  return value as RemoteJobStateV1;
}

function jobStatus(value: unknown): AnalysisJobStatusV1 {
  const item = record(value, "response");
  exact(item, ["schemaVersion", "jobId", "state", "owner", "progress", "createdAt", "updatedAt", "expiresAt", "resultAvailable", "errorCode"], "response");
  if (item.schemaVersion !== "3dena.job-status.v1") clientError("INVALID_RESPONSE", "Unsupported job-status schema.");
  let progress: AnalysisJobStatusV1["progress"] = null;
  if (item.progress !== null) {
    const source = record(item.progress, "response.progress");
    exact(source, ["phase", "completed", "total"], "response.progress");
    progress = {
      phase: stringValue(source.phase, "response.progress.phase"),
      completed: safeInteger(source.completed, "response.progress.completed"),
      total: source.total === null ? null : safeInteger(source.total, "response.progress.total"),
    };
  }
  if (typeof item.resultAvailable !== "boolean") clientError("INVALID_RESPONSE", "response.resultAvailable must be boolean.");
  if (item.errorCode !== null && typeof item.errorCode !== "string") clientError("INVALID_RESPONSE", "response.errorCode must be string or null.");
  return {
    schemaVersion: "3dena.job-status.v1",
    jobId: stringValue(item.jobId, "response.jobId"),
    state: state(item.state, "response.state"),
    owner: owner(item.owner, "response.owner"),
    progress,
    createdAt: timestamp(item.createdAt, "response.createdAt"),
    updatedAt: timestamp(item.updatedAt, "response.updatedAt"),
    expiresAt: timestamp(item.expiresAt, "response.expiresAt"),
    resultAvailable: item.resultAvailable,
    errorCode: item.errorCode as string | null,
  };
}

function event(value: unknown): AnalysisJobEventV1 {
  const item = record(value, "event");
  exact(item, ["schemaVersion", "sequence", "state", "phase", "completed", "total", "emittedAt"], "event");
  if (item.schemaVersion !== "3dena.job-event.v1") clientError("INVALID_RESPONSE", "Unsupported job-event schema.");
  return {
    schemaVersion: "3dena.job-event.v1",
    sequence: safeInteger(item.sequence, "event.sequence"),
    state: state(item.state, "event.state"),
    phase: stringValue(item.phase, "event.phase"),
    completed: safeInteger(item.completed, "event.completed"),
    total: item.total === null ? null : safeInteger(item.total, "event.total"),
    emittedAt: timestamp(item.emittedAt, "event.emittedAt"),
  };
}

function resultReference(value: unknown): AnalysisJobResultReferenceV1 {
  const item = record(value, "response");
  exact(item, ["schemaVersion", "jobId", "sha256", "byteLength", "resultUrl", "exportUrl", "expiresAt"], "response");
  if (item.schemaVersion !== "3dena.job-result-reference.v1" || typeof item.sha256 !== "string" || !SHA256.test(item.sha256)) clientError("INVALID_RESPONSE", "Invalid result-reference schema or checksum.");
  return {
    schemaVersion: "3dena.job-result-reference.v1",
    jobId: stringValue(item.jobId, "response.jobId"),
    sha256: item.sha256,
    byteLength: safeInteger(item.byteLength, "response.byteLength", 1),
    resultUrl: safeUrl(item.resultUrl, "response.resultUrl"),
    exportUrl: item.exportUrl === null ? null : safeUrl(item.exportUrl, "response.exportUrl"),
    expiresAt: timestamp(item.expiresAt, "response.expiresAt"),
  };
}

function deletionReceipt(value: unknown): AnalysisDeletionReceiptV1 {
  const item = record(value, "response");
  exact(item, ["schemaVersion", "jobId", "cancelled", "inputDeleted", "resultDeleted", "deletedAt"], "response");
  if (item.schemaVersion !== "3dena.job-deletion-receipt.v1") clientError("INVALID_RESPONSE", "Unsupported deletion receipt schema.");
  for (const field of ["cancelled", "inputDeleted", "resultDeleted"] as const) if (typeof item[field] !== "boolean") clientError("INVALID_RESPONSE", `response.${field} must be boolean.`);
  return {
    schemaVersion: "3dena.job-deletion-receipt.v1",
    jobId: stringValue(item.jobId, "response.jobId"),
    cancelled: item.cancelled as boolean,
    inputDeleted: item.inputDeleted as boolean,
    resultDeleted: item.resultDeleted as boolean,
    deletedAt: timestamp(item.deletedAt, "response.deletedAt"),
  };
}

function deletionReceiptV2(value: unknown): AnalysisDeletionReceiptV2 {
  const item = record(value, "response");
  exact(item, ["schemaVersion", "jobId", "cancelled", "inputDeleted", "resultDeleted", "deletedAt", "intentAccepted", "termination", "capacity", "objects"], "response");
  if (item.schemaVersion !== "3dena.job-deletion-receipt.v2") {
    clientError("INVALID_RESPONSE", "Unsupported deletion lifecycle receipt schema.");
  }
  for (const field of ["cancelled", "inputDeleted", "resultDeleted"] as const) {
    if (typeof item[field] !== "boolean") {
      clientError("INVALID_RESPONSE", `response.${field} must be boolean.`);
    }
  }
  if (item.intentAccepted !== true ||
      !["not_required", "pending", "observed"].includes(String(item.termination)) ||
      !["not_reserved", "held", "released"].includes(String(item.capacity)) ||
      !["pending", "deleted"].includes(String(item.objects))) {
    clientError("INVALID_RESPONSE", "Deletion lifecycle receipt is invalid.");
  }
  const deletedAt = item.deletedAt === null
    ? null
    : timestamp(item.deletedAt, "response.deletedAt");
  if ((item.objects === "deleted") !==
      (item.inputDeleted === true && item.resultDeleted === true && deletedAt !== null)) {
    clientError("INVALID_RESPONSE", "Deletion object facts are contradictory.");
  }
  if (item.termination === "pending" && item.capacity !== "held") {
    clientError("INVALID_RESPONSE", "Pending termination must retain capacity.");
  }
  return {
    schemaVersion: "3dena.job-deletion-receipt.v2",
    jobId: stringValue(item.jobId, "response.jobId"),
    cancelled: item.cancelled as boolean,
    inputDeleted: item.inputDeleted as boolean,
    resultDeleted: item.resultDeleted as boolean,
    deletedAt,
    intentAccepted: true,
    termination: item.termination as AnalysisDeletionReceiptV2["termination"],
    capacity: item.capacity as AnalysisDeletionReceiptV2["capacity"],
    objects: item.objects as AnalysisDeletionReceiptV2["objects"],
  };
}

function buildInfo(value: unknown): AnalysisComputeBuildInfoV1 {
  const item = record(value, "response");
  exact(item, ["schemaVersion", "approvalManifestSha256", "releaseId", "gitCommit", "flyImageDigest", "flyBuildId", "role", "contractVersions"], "response");
  if (item.schemaVersion !== "3dena.compute-build-info.v1" || item.role !== "api") clientError("INVALID_RESPONSE", "Unsupported compute build-info response.");
  const contractVersions = item.contractVersions;
  if (typeof item.approvalManifestSha256 !== "string" || !SHA256.test(item.approvalManifestSha256)) clientError("INVALID_RESPONSE", "response.approvalManifestSha256 must be a lowercase SHA-256 digest.");
  if (typeof item.releaseId !== "string" || !OPAQUE_ID.test(item.releaseId)) clientError("INVALID_RESPONSE", "response.releaseId must be an opaque identifier.");
  if (typeof item.gitCommit !== "string" || !GIT_COMMIT.test(item.gitCommit)) clientError("INVALID_RESPONSE", "response.gitCommit must be an exact lowercase Git commit.");
  if (typeof item.flyImageDigest !== "string" || !IMAGE_DIGEST.test(item.flyImageDigest)) clientError("INVALID_RESPONSE", "response.flyImageDigest must be a sha256:<digest> OCI image identity.");
  if (typeof item.flyBuildId !== "string" || !OPAQUE_ID.test(item.flyBuildId)) clientError("INVALID_RESPONSE", "response.flyBuildId must be an opaque identifier.");
  if (
    !Array.isArray(contractVersions) || contractVersions.length === 0 ||
    contractVersions.some((version) => typeof version !== "string" || !CONTRACT_VERSION.test(version)) ||
    new Set(contractVersions).size !== contractVersions.length ||
    [...contractVersions].sort().some((version, index) => version !== contractVersions[index])
  ) clientError("INVALID_RESPONSE", "response.contractVersions must be a non-empty, unique, sorted version array.");
  return {
    schemaVersion: "3dena.compute-build-info.v1",
    approvalManifestSha256: item.approvalManifestSha256,
    releaseId: item.releaseId,
    gitCommit: item.gitCommit,
    flyImageDigest: item.flyImageDigest,
    flyBuildId: item.flyBuildId,
    role: "api",
    contractVersions: [...contractVersions] as string[],
  };
}

function normalizeBaseUrl(value: string): URL {
  const normalized = safeUrl(value, "config.baseUrl");
  const url = new URL(normalized);
  if (url.search || url.hash || url.username || url.password) clientError("INVALID_CLIENT_CONFIG", "baseUrl must not contain query, fragment, or credentials.");
  url.pathname = url.pathname.replace(/\/+$/u, "");
  return url;
}

/** Creates the capability-token remote client used by the public Web product. */
export function createAnalysisClient(config: AnalysisClientConfig): AnalysisClientV2 {
  if (!config || typeof config !== "object" || Array.isArray(config)) clientError("INVALID_CLIENT_CONFIG", "Client config must be an object.");
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const fetchImplementation = config.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") clientError("INVALID_CLIENT_CONFIG", "A Fetch implementation is required.");
  const timeout = config.requestTimeoutMilliseconds ?? 30_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 300_000) clientError("INVALID_CLIENT_CONFIG", "requestTimeoutMilliseconds must be in [1, 300000].");
  const deletionPollInterval = config.deletionPollIntervalMilliseconds ?? 250;
  const deletionCompletionTimeout =
    config.deletionCompletionTimeoutMilliseconds ?? 60_000;
  if (!Number.isSafeInteger(deletionPollInterval) || deletionPollInterval < 1 ||
      deletionPollInterval > 10_000 || !Number.isSafeInteger(deletionCompletionTimeout) ||
      deletionCompletionTimeout < deletionPollInterval ||
      deletionCompletionTimeout > 300_000) {
    clientError("INVALID_CLIENT_CONFIG", "Deletion polling configuration is invalid.");
  }

  const basePath = baseUrl.pathname === "/" ? "" : baseUrl.pathname.replace(/\/+$/u, "");
  const url = (path: string): string => new URL(`${basePath}${path}`, baseUrl.origin).toString();
  const headers = (
    reference?: AnalysisJobReferenceV1,
    idempotencyKey?: string,
    accept = "application/json",
  ): Headers => {
    const output = new Headers({
      accept,
      "content-type": "application/json",
      "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
    });
    if (reference) {
      validateReference(reference);
      output.set("authorization", `Bearer ${reference.capabilityToken}`);
    }
    if (idempotencyKey !== undefined) {
      validateIdempotencyKey(idempotencyKey);
      output.set("idempotency-key", idempotencyKey);
    }
    return output;
  };
  const waitForDeletionPoll = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, deletionPollInterval));
  const deleteV2 = async (
    reference: AnalysisJobReferenceV1,
    idempotencyKey: string,
  ): Promise<AnalysisDeletionReceiptV2> => {
    validateReference(reference);
    const result = deletionReceiptV2(await invoke(
      `/v1/jobs/${encodeURIComponent(reference.jobId)}`,
      {
        method: "DELETE",
        headers: headers(
          reference,
          idempotencyKey,
          "application/vnd.3dena.job-deletion-receipt.v2+json",
        ),
      },
    ));
    if (result.jobId !== reference.jobId) {
      clientError("INVALID_RESPONSE", "Deletion receipt identity does not match the requested job.");
    }
    return result;
  };
  const invoke = async (path: string, init: RequestInit): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException("Request deadline exceeded", "TimeoutError")), timeout);
    try {
      const response = await fetchImplementation(url(path), { ...init, signal: controller.signal, credentials: "omit", redirect: "error" });
      const requestId = response.headers.get("x-request-id");
      if (!response.ok) {
        let code = `HTTP_${response.status}`;
        try {
          const body = await response.json() as { code?: unknown };
          if (typeof body?.code === "string" && /^[A-Z0-9_]{1,80}$/u.test(body.code)) code = body.code;
        } catch {
          // Error bodies are intentionally not reflected to avoid leaking server content or capability tokens.
        }
        throw new AnalysisClientError(code, `Compute request failed with HTTP ${response.status}.`, response.status, requestId);
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLocaleLowerCase("en-US").startsWith("application/json")) throw new AnalysisClientError("INVALID_RESPONSE", "Compute response is not JSON.", response.status, requestId);
      return await response.json();
    } catch (error) {
      if (error instanceof AnalysisClientError) throw error;
      if (controller.signal.aborted) throw new AnalysisClientError("REQUEST_TIMEOUT", "Compute request exceeded the client deadline.");
      throw new AnalysisClientError("NETWORK_FAILURE", "Compute request could not be completed.");
    } finally {
      clearTimeout(timer);
    }
  };

  return Object.freeze({
    async createJob(request: CreateAnalysisJobRequestV1, idempotencyKey: string) {
      validateCreateRequest(request);
      return capability(await invoke("/v1/jobs", { method: "POST", headers: headers(undefined, idempotencyKey), body: JSON.stringify(request) }));
    },
    async executeJob(reference: AnalysisJobReferenceV1, request: ExecuteAnalysisJobRequestV1, idempotencyKey: string) {
      validateReference(reference);
      const requestRecord = record(request, "request");
      exact(requestRecord, ["schemaVersion", "datasetReceipt", "task"], "request");
      if (!request || request.schemaVersion !== "3dena.execute-job-request.v1") clientError("INVALID_REQUEST", "Unsupported execute-job schema version.");
      assertDatasetReceiptV1(request.datasetReceipt, "request.datasetReceipt");
      assertAnalysisTaskV1(request.task, "request.task");
      if (request.datasetReceipt.sha256 !== request.task.owner.datasetHash) clientError("INVALID_REQUEST", "Dataset receipt does not match task owner.");
      const result = jobStatus(await invoke(`/v1/jobs/${encodeURIComponent(reference.jobId)}/execute`, { method: "POST", headers: headers(reference, idempotencyKey), body: JSON.stringify(request) }));
      if (result.jobId !== reference.jobId) clientError("INVALID_RESPONSE", "Job status identity does not match the requested job.");
      return result;
    },
    async getJob(reference: AnalysisJobReferenceV1) {
      validateReference(reference);
      const result = jobStatus(await invoke(`/v1/jobs/${encodeURIComponent(reference.jobId)}`, { method: "GET", headers: headers(reference) }));
      if (result.jobId !== reference.jobId) clientError("INVALID_RESPONSE", "Job status identity does not match the requested job.");
      return result;
    },
    async *events(reference: AnalysisJobReferenceV1, signal?: AbortSignal) {
      validateReference(reference);
      const response = await fetchImplementation(url(`/v1/jobs/${encodeURIComponent(reference.jobId)}/events`), {
        method: "GET",
        headers: new Headers({
          accept: "text/event-stream",
          authorization: `Bearer ${reference.capabilityToken}`,
          "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
        }),
        credentials: "omit",
        redirect: "error",
        ...(signal ? { signal } : {}),
      });
      if (!response.ok || !response.body || !(response.headers.get("content-type") ?? "").toLocaleLowerCase("en-US").startsWith("text/event-stream")) {
        throw new AnalysisClientError("SSE_CONNECTION_FAILED", `Compute event stream failed with HTTP ${response.status}.`, response.status, response.headers.get("x-request-id"));
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          buffer = buffer.replace(/\r\n/gu, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary).replace(/\r/gu, "");
            buffer = buffer.slice(boundary + 2);
            const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
            if (data !== "") {
              let parsed: unknown;
              try { parsed = JSON.parse(data); } catch { clientError("INVALID_RESPONSE", "SSE data is not valid JSON."); }
              yield event(parsed);
            }
            boundary = buffer.indexOf("\n\n");
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      if (buffer.trim() !== "") clientError("INVALID_RESPONSE", "SSE stream ended with an incomplete event.");
    },
    async getResult(reference: AnalysisJobReferenceV1) {
      validateReference(reference);
      const result = resultReference(await invoke(`/v1/jobs/${encodeURIComponent(reference.jobId)}/result`, { method: "GET", headers: headers(reference) }));
      if (result.jobId !== reference.jobId) clientError("INVALID_RESPONSE", "Result reference identity does not match the requested job.");
      return result;
    },
    async deleteJob(reference: AnalysisJobReferenceV1, idempotencyKey: string) {
      validateReference(reference);
      const result = deletionReceipt(await invoke(`/v1/jobs/${encodeURIComponent(reference.jobId)}`, { method: "DELETE", headers: headers(reference, idempotencyKey) }));
      if (result.jobId !== reference.jobId) clientError("INVALID_RESPONSE", "Deletion receipt identity does not match the requested job.");
      return result;
    },
    async deleteJobV2(reference: AnalysisJobReferenceV1, idempotencyKey: string) {
      return deleteV2(reference, idempotencyKey);
    },
    async deleteJobUntilComplete(
      reference: AnalysisJobReferenceV1,
      idempotencyKey: string,
    ) {
      const startedAt = Date.now();
      while (true) {
        const receipt = await deleteV2(reference, idempotencyKey);
        if (receipt.termination !== "pending" && receipt.capacity !== "held" &&
            receipt.objects === "deleted" && receipt.inputDeleted &&
            receipt.resultDeleted && receipt.deletedAt !== null) return receipt;
        if (Date.now() - startedAt >= deletionCompletionTimeout) {
          throw new AnalysisClientError(
            "DELETION_RECONCILIATION_TIMEOUT",
            "Compute deletion did not reach a fully observed durable state.",
          );
        }
        await waitForDeletionPoll();
      }
    },
    async getBuildInfo() {
      return buildInfo(await invoke("/build-info", { method: "GET", headers: headers() }));
    },
  });
}
