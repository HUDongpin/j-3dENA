import {
  DatasetWorkflowError,
  type ActiveDatasetPayloadV1,
} from "@3dena/dataset-workflow";
import {
  ANALYSIS_CONTRACT_VERSION_V1,
  ANALYSIS_EXECUTION_DATASET_VERSION_V2,
  ANALYSIS_TASK_VERSION_V1,
  HARD_ANALYSIS_LIMITS,
  assertAnalysisExecutionDatasetV2,
  assertAnalysisSpecV1,
  assertAnalysisTaskV1,
  assertDatasetReceiptV1,
  assertTaskOwnerV1,
  hashAnalysisValueV1,
  type AnalysisExecutionDatasetV1,
  type AnalysisExecutionDatasetV2,
  type AnalysisResourceLimits,
  type AnalysisSpecV1,
  type DatasetColumnRoleV1,
  type AnalysisDeletionReceiptV1,
  type AnalysisJobCapabilityV1,
  type AnalysisJobEventV1,
  type AnalysisJobResultReferenceV1,
  type AnalysisJobStatusV1,
  type AnalysisTaskV1,
  type EnaModelTaskV1,
  type RawRow,
  type RawRowMapping,
  type CreateAnalysisJobRequestV1,
  type ExecuteAnalysisJobRequestV1,
  type RemoteJobStateV1,
} from "@3dena/analysis";
import {
  COMPUTE_TASK_OWNER_CONTRACT_VERSION,
  COMPUTE_TASK_REQUEST_VERSION,
  ComputeServiceCore,
  ComputeServiceCoreError,
  type ComputeJobRecordV1,
  type ImmutableObjectDescriptor,
} from "@3dena/compute-service-core";

import {
  COMPUTE_HTTP_CONTRACT_VERSION,
  COMPUTE_HTTP_EXECUTION_INPUT_VERSION,
  COMPUTE_HTTP_JOB_VERSION,
  type ComputeExecutionInputV1,
  type ComputeHttpBuildIdentityV1,
  type ComputeHttpJobRecordV1,
  type ReservedDatasetV1,
} from "./contracts";
import {
  COMPUTE_DATASET_ACTIVATION_RECEIPT_VERSION,
  type ActivateComputeDatasetRequestV1,
  type ComputeDatasetActivationReceiptV1,
  type ComputeDatasetCapabilityV1,
  type CreateActivatedAnalysisJobRequestV1,
  type CreateSourceResultAnalysisJobRequestV1,
  type CreateComputeDatasetRequestV1,
  type ExecuteActivatedAnalysisJobRequestV1,
  type PreviewComputeDatasetRequestV1,
  type PutComputeDatasetMappingRequestV1,
  type SelectComputeDatasetWorksheetRequestV1,
  type SourceResultAnalysisJobCapabilityV1,
} from "./dataset-contracts";
import {
  ComputeHttpError,
  httpError,
  type ComputeHttpErrorCode,
} from "./errors";
import type { ComputeHttpRouterInfrastructure } from "./interfaces";
import type { ComputeHttpRateLimitClassV1 } from "./interfaces";
import {
  LOWER_SHA256,
  OPAQUE_ID,
  assertExactFields,
  assertSafeAbsoluteUrl,
  canonicalStringify,
  cloneFrozen,
  descriptorsEqual,
  isoTimestamp,
  sha256Bytes,
  sha256Text,
} from "./util";

const MAX_CAS_ATTEMPTS = 24;
const MAX_DATASET_BYTES = 5 * 1024 * 1024;
const MAX_JOB_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_TASK_RUNTIME_MS = 60 * 60 * 1_000;
const DEFAULT_JSON_BYTES = 5 * 1024 * 1024;
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/iu;
const IDEMPOTENCY_KEY = /^[^\u0000-\u0020\u007f]{8,200}$/u;
const GIT_COMMIT = /^[a-f0-9]{40}$/u;
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const CONTRACT_VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u;
const TERMINAL_REMOTE_STATES = new Set<RemoteJobStateV1>([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
]);
const HTTP_ALLOWED_METHODS = Object.freeze([
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "OPTIONS",
]);
const CORS_ALLOWED_HEADERS = new Set([
  "accept",
  "authorization",
  "content-type",
  "idempotency-key",
  "last-event-id",
  "x-3dena-contract-version",
]);
const SUPPORTED_TASK_KINDS = new Set<AnalysisTaskV1["kind"]>([
  "ena-model",
  "network-comparison",
  "change-network",
  "statistics",
  "trajectory",
  "trajectory-comparison",
  "bootstrap",
]);

export interface ComputeV1HttpRouterOptions {
  readonly core: ComputeServiceCore;
  readonly infrastructure: ComputeHttpRouterInfrastructure;
  readonly allowedOrigins: readonly string[];
  readonly buildIdentity: ComputeHttpBuildIdentityV1;
  readonly jobTtlMs?: number;
  readonly maxTaskRuntimeMs?: number;
  readonly maxJsonBodyBytes?: number;
}

interface RequestContext {
  readonly requestId: string;
  readonly origin: string | null;
}

interface StatusSnapshot {
  readonly job: ComputeHttpJobRecordV1;
  readonly core: ComputeJobRecordV1 | null;
  readonly status: AnalysisJobStatusV1;
}

interface JsonErrorBody {
  readonly code: ComputeHttpErrorCode;
  readonly requestId: string;
}

function normalizeAllowedOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("Each allowed CORS origin must be an absolute URL origin.");
  }
  const loopback =
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (
    (parsed.protocol !== "https:" && !loopback) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new TypeError(
      "Allowed CORS origins must be HTTPS or loopback HTTP origins without paths.",
    );
  }
  return parsed.origin;
}

function validatePositiveInteger(
  value: number,
  name: string,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${name} must be a positive safe integer <= ${maximum}.`);
  }
  return value;
}

function isDatasetFormat(
  value: unknown,
): value is ReservedDatasetV1["format"] {
  return (
    value === "csv" ||
    value === "xlsx" ||
    value === "xls"
  );
}

const ANALYSIS_LIMIT_FIELDS = Object.freeze(
  Object.keys(HARD_ANALYSIS_LIMITS) as Array<keyof AnalysisResourceLimits>,
);

function assertActivatedTaskSpec(
  value: unknown,
): asserts value is ExecuteActivatedAnalysisJobRequestV1["task"] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    httpError("INVALID_REQUEST", 400, "Activated ENA task spec must be an object.");
  }
  const task = value as Record<string, unknown>;
  if (
    typeof task.kind !== "string" || !SUPPORTED_TASK_KINDS.has(task.kind as AnalysisTaskV1["kind"]) ||
    typeof task.runId !== "string" ||
    !OPAQUE_ID.test(task.runId) ||
    !Number.isSafeInteger(task.deadlineEpochMilliseconds)
  ) {
    httpError("INVALID_REQUEST", 400, "Activated analysis task spec is invalid.");
  }
  if (task.kind !== "ena-model") {
    const fieldsByKind: Record<string, readonly string[]> = {
      "network-comparison": ["schemaVersion", "kind", "runId", "deadlineEpochMilliseconds", "sourceResultHash", "groups"],
      "change-network": ["schemaVersion", "kind", "runId", "deadlineEpochMilliseconds", "sourceResultHash", "field", "level"],
      statistics: ["schemaVersion", "kind", "runId", "deadlineEpochMilliseconds", "sourceResultHash", "design", "groups", "dimensions", "alternative", "adjustment", "samePhysicalEntityConfirmed"],
      trajectory: ["schemaVersion", "kind", "runId", "deadlineEpochMilliseconds", "sourceResultHash", "group", "selectedDimensions", "cohortPolicy", "periods", "estimand"],
      "trajectory-comparison": ["schemaVersion", "kind", "runId", "deadlineEpochMilliseconds", "sourceResultHash", "design", "groups", "samePhysicalEntityConfirmed"],
      bootstrap: ["schemaVersion", "kind", "runId", "deadlineEpochMilliseconds", "sourceResultHash", "group", "replicates", "confidenceLevel", "seed", "interval", "rotationPolicy"],
    };
    const fields = fieldsByKind[task.kind];
    if (fields === undefined) httpError("INVALID_REQUEST", 400, "Activated task kind is unsupported.");
    assertExactFields(task, fields, "activated analysis task spec");
    if (task.schemaVersion !== `3dena.activated-${task.kind}-task-spec.v1`) {
      httpError("INVALID_REQUEST", 400, "Activated task schema does not match its kind.");
    }
    const { runId: _runId, ...taskWithoutRun } = task;
    try {
      assertAnalysisTaskV1({
        ...taskWithoutRun,
        schemaVersion: ANALYSIS_TASK_VERSION_V1,
        owner: {
          contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
          datasetHash: "0".repeat(64),
          specHash: "1".repeat(64),
          runId: task.runId,
          taskId: "validation-task",
        },
      }, "request.task");
    } catch {
      httpError("INVALID_REQUEST", 400, "Activated derived task violates analysis contracts.");
    }
    return;
  }
  const allowed = new Set([
    "schemaVersion", "kind", "runId", "deadlineEpochMilliseconds", "spec", "limits",
  ]);
  if (
    !["schemaVersion", "kind", "runId", "deadlineEpochMilliseconds", "spec"].every(
      (field) => Object.hasOwn(task, field),
    ) ||
    Object.keys(task).some((field) => !allowed.has(field)) ||
    task.schemaVersion !== "3dena.activated-ena-model-task-spec.v1"
  ) httpError("INVALID_REQUEST", 400, "Activated ENA task spec is invalid.");
  try {
    assertAnalysisSpecV1(task.spec, "request.task.spec");
  } catch {
    httpError("INVALID_REQUEST", 400, "Activated ENA scientific spec is invalid.");
  }
  if (task.limits === undefined) return;
  if (task.limits === null || typeof task.limits !== "object" || Array.isArray(task.limits)) {
    httpError("INVALID_REQUEST", 400, "Activated ENA limits must be an object.");
  }
  const limits = task.limits as Record<string, unknown>;
  if (Object.keys(limits).some((field) => !ANALYSIS_LIMIT_FIELDS.includes(field as keyof AnalysisResourceLimits))) {
    httpError("INVALID_REQUEST", 400, "Activated ENA limits contain an unknown field.");
  }
  for (const field of ANALYSIS_LIMIT_FIELDS) {
    const requested = limits[field];
    if (
      requested !== undefined &&
      (!Number.isSafeInteger(requested) ||
        (requested as number) < 1 ||
        (requested as number) > HARD_ANALYSIS_LIMITS[field])
    ) {
      httpError("INVALID_REQUEST", 400, `Activated ENA limit ${field} is invalid.`);
    }
  }
}

function materializeActivatedRows(
  payload: ActiveDatasetPayloadV1,
  spec: AnalysisSpecV1,
): Readonly<{ rows: RawRow[]; mapping: RawRowMapping }> {
  if (
    payload.headers.length !== payload.schema.columns.length ||
    payload.headers.some(
      (header, index) =>
        header !== payload.schema.columns[index]?.name || header.trim() === "",
    )
  ) {
    httpError("DATASET_RECEIPT_MISMATCH", 409, "Activated schema and parsed headers diverge.");
  }
  const columnsFor = (role: DatasetColumnRoleV1): string[] =>
    payload.schema.columns
      .filter((column) => column.roles.includes(role))
      .map((column) => column.name);
  const units = columnsFor("unit");
  const conversation = columnsFor("conversation");
  const codes = columnsFor("code");
  const metadata = columnsFor("metadata").filter(
    (column) =>
      !units.includes(column) &&
      !conversation.includes(column) &&
      !codes.includes(column),
  );
  const groups = columnsFor("group");
  const times = columnsFor("time");
  if (units.length < 1 || conversation.length < 1 || codes.length < 3) {
    httpError("DATASET_WORKFLOW_REJECTED", 409, "Activated roles cannot form an ENA input mapping.");
  }
  if (groups.length > 1 || times.length > 1) {
    httpError("DATASET_WORKFLOW_REJECTED", 409, "Activated trajectory roles must be singular.");
  }
  const requiresTrajectory = spec.model !== "EndPoint";
  if (requiresTrajectory && (groups.length !== 1 || times.length !== 1)) {
    httpError(
      "DATASET_WORKFLOW_REJECTED",
      409,
      "Trajectory ENA requires one activated group role and one activated time role.",
    );
  }
  const mapping: RawRowMapping = {
    units,
    conversation,
    codes,
    ...(metadata.length === 0 ? {} : { metadata }),
    ...(requiresTrajectory
      ? {
          trajectory: {
            participant: units.filter((column) => column !== groups[0]),
            group: groups[0]!,
            time: times[0]!,
            cohortPolicy: spec.cohortPolicy,
          },
        }
      : {}),
  };
  if (mapping.trajectory !== undefined && mapping.trajectory.participant.length < 1) {
    httpError("DATASET_WORKFLOW_REJECTED", 409, "Trajectory participant identity is empty.");
  }
  const rows = payload.rows.map((values) => {
    if (values.length !== payload.headers.length) {
      httpError("DATASET_RECEIPT_MISMATCH", 409, "Activated row width diverges from its schema.");
    }
    return Object.fromEntries(
      payload.headers.map((header, index) => [header, values[index] ?? null]),
    ) as RawRow;
  });
  if (rows.length !== payload.handle.receipt.rows) {
    httpError("DATASET_RECEIPT_MISMATCH", 409, "Activated row count diverges from its receipt.");
  }
  return { rows, mapping };
}

function taskFailureCode(record: ComputeJobRecordV1 | null): string | null {
  if (record === null) return null;
  if (record.state === "timed_out") return "TASK_DEADLINE_EXCEEDED";
  if (record.state === "failed") return record.failure?.code ?? "TASK_FAILED";
  return null;
}

function sameTaskOwner(left: AnalysisTaskV1["owner"], right: AnalysisTaskV1["owner"]): boolean {
  return left.contractVersion === right.contractVersion &&
    left.datasetHash === right.datasetHash &&
    left.specHash === right.specHash &&
    left.runId === right.runId &&
    left.taskId === right.taskId;
}

function rateLimitClass(pathname: string, method: string): ComputeHttpRateLimitClassV1 | null {
  if (pathname === "/v1/datasets") return "dataset-mutation";
  if (pathname === "/v1/jobs") return "job-create";
  if (/^\/v1\/datasets\/[^/]+\/content$/u.test(pathname)) return "dataset-upload";
  if (pathname.startsWith("/v1/datasets/")) return "dataset-mutation";
  if (/^\/v1\/jobs\/[^/]+\/execute$/u.test(pathname)) return "job-execute";
  if (pathname.startsWith("/v1/jobs/") && (method === "POST" || method === "DELETE")) {
    return "job-control";
  }
  if (pathname.startsWith("/v1/jobs/")) return "job-read";
  return null;
}

function publicState(
  job: ComputeHttpJobRecordV1,
  core: ComputeJobRecordV1 | null,
  uploaded: boolean,
  now: number,
): RemoteJobStateV1 {
  if (core === null) {
    if (job.deleteRequestedAtMs !== undefined) return "CANCELLED";
    if (now >= job.expiresAtMs) return "EXPIRED";
    return uploaded ? "UPLOADED" : "CREATED";
  }
  switch (core.state) {
    case "queued":
    case "leased":
      return "QUEUED";
    case "starting":
    case "running":
      return "RUNNING";
    case "cancelling":
    case "deleting":
      return "CANCEL_REQUESTED";
    case "succeeded":
      return "SUCCEEDED";
    case "failed":
    case "timed_out":
      return "FAILED";
    case "cancelled":
    case "deleted":
      return "CANCELLED";
    case "expired":
      return "EXPIRED";
  }
}

function progressForState(
  state: RemoteJobStateV1,
): AnalysisJobStatusV1["progress"] {
  switch (state) {
    case "CREATED":
      return { phase: "created", completed: 0, total: 1 };
    case "UPLOADED":
      return { phase: "uploaded", completed: 0, total: 1 };
    case "QUEUED":
      return { phase: "queued", completed: 0, total: 1 };
    case "RUNNING":
      return { phase: "running", completed: 0, total: 1 };
    case "CANCEL_REQUESTED":
      return { phase: "cancelling", completed: 0, total: 1 };
    case "SUCCEEDED":
      return { phase: "completed", completed: 1, total: 1 };
    case "FAILED":
      return { phase: "failed", completed: 1, total: 1 };
    case "CANCELLED":
      return { phase: "cancelled", completed: 1, total: 1 };
    case "EXPIRED":
      return { phase: "expired", completed: 1, total: 1 };
  }
}

function mapCoreError(error: ComputeServiceCoreError): ComputeHttpError {
  switch (error.code) {
    case "IDEMPOTENCY_CONFLICT":
      return new ComputeHttpError(
        "IDEMPOTENCY_CONFLICT",
        409,
        "Core task identity is already bound to another request.",
      );
    case "INVALID_ARGUMENT":
    case "OBJECT_RECEIPT_MISMATCH":
      return new ComputeHttpError(
        "INVALID_REQUEST",
        400,
        "Core rejected the versioned compute request.",
      );
    case "OBJECT_NOT_FOUND":
      return new ComputeHttpError(
        "DATASET_NOT_UPLOADED",
        409,
        "The immutable execution object is missing.",
      );
    default:
      return new ComputeHttpError(
        "INTERNAL_ERROR",
        500,
        `Core operation failed with ${error.code}.`,
      );
  }
}

export class ComputeV1HttpRouter {
  readonly #core: ComputeServiceCore;
  readonly #infrastructure: ComputeHttpRouterInfrastructure;
  readonly #allowedOrigins: ReadonlySet<string>;
  readonly #buildIdentity: ComputeHttpBuildIdentityV1;
  readonly #jobTtlMs: number;
  readonly #maxTaskRuntimeMs: number;
  readonly #maxJsonBodyBytes: number;

  constructor(options: ComputeV1HttpRouterOptions) {
    if (!(options.core instanceof ComputeServiceCore)) {
      throw new TypeError("ComputeV1HttpRouter requires a ComputeServiceCore.");
    }
    if (!Array.isArray(options.allowedOrigins) || options.allowedOrigins.length < 1) {
      throw new TypeError("At least one explicit CORS origin is required.");
    }
    const origins = options.allowedOrigins.map(normalizeAllowedOrigin);
    if (new Set(origins).size !== origins.length) {
      throw new TypeError("Allowed CORS origins must not contain duplicates.");
    }
    if (
      !LOWER_SHA256.test(options.buildIdentity.approvalManifestSha256) ||
      !OPAQUE_ID.test(options.buildIdentity.releaseId) ||
      !GIT_COMMIT.test(options.buildIdentity.gitCommit) ||
      !IMAGE_DIGEST.test(options.buildIdentity.flyImageDigest) ||
      !OPAQUE_ID.test(options.buildIdentity.flyBuildId) ||
      !Array.isArray(options.buildIdentity.contractVersions) ||
      options.buildIdentity.contractVersions.length < 1 ||
      options.buildIdentity.contractVersions.some(
        (version) => typeof version !== "string" || !CONTRACT_VERSION.test(version),
      ) ||
      new Set(options.buildIdentity.contractVersions).size !== options.buildIdentity.contractVersions.length ||
      [...options.buildIdentity.contractVersions].sort().some(
        (version, index) => version !== options.buildIdentity.contractVersions[index],
      )
    ) {
      throw new TypeError("buildIdentity must be one exact approved runtime identity.");
    }
    this.#core = options.core;
    this.#infrastructure = options.infrastructure;
    this.#allowedOrigins = new Set(origins);
    this.#buildIdentity = cloneFrozen(options.buildIdentity);
    this.#jobTtlMs = validatePositiveInteger(
      options.jobTtlMs ?? MAX_JOB_TTL_MS,
      "jobTtlMs",
      MAX_JOB_TTL_MS,
    );
    this.#maxTaskRuntimeMs = validatePositiveInteger(
      options.maxTaskRuntimeMs ?? DEFAULT_TASK_RUNTIME_MS,
      "maxTaskRuntimeMs",
      MAX_JOB_TTL_MS,
    );
    this.#maxJsonBodyBytes = validatePositiveInteger(
      options.maxJsonBodyBytes ?? DEFAULT_JSON_BYTES,
      "maxJsonBodyBytes",
      MAX_DATASET_BYTES,
    );
  }

  /** Web-standard entry point that a Node HTTP or Fastify shell can adapt. */
  async handle(request: Request): Promise<Response> {
    const requestId = this.#infrastructure.idFactory.nextId("request");
    const origin = request.headers.get("origin");
    const context = { requestId, origin };
    try {
      this.#assertCorsOrigin(origin);
      if (request.method.toUpperCase() === "OPTIONS") {
        return this.#preflight(request, context);
      }

      const url = new URL(request.url);
      if (url.search !== "" || url.hash !== "") {
        httpError("NOT_FOUND", 404, "Compute routes do not accept query strings.");
      }
      const method = request.method.toUpperCase();
      const limitClass = rateLimitClass(url.pathname, method);
      if (limitClass !== null) {
        const authorization = request.headers.get("authorization") ?? "anonymous";
        const keyHash = this.#infrastructure.capabilityCodec.hashSecret(
          `rate\0${origin ?? "no-origin"}\0${authorization}`,
        );
        const limit = await this.#infrastructure.rateLimiter.consume({
          keyHash,
          routeClass: limitClass,
        });
        if (
          !Number.isSafeInteger(limit.retryAfterSeconds) ||
          limit.retryAfterSeconds < 1 ||
          limit.retryAfterSeconds > 86_400
        ) httpError("INTERNAL_ERROR", 500, "Rate limiter returned an invalid decision.");
        if (!limit.allowed) {
          return this.#json(429, { code: "RATE_LIMITED", requestId }, context, {
            "retry-after": String(limit.retryAfterSeconds),
          });
        }
      }
      if (method === "GET" || method === "DELETE") {
        this.#assertNoBody(request);
      }
      if (url.pathname === "/healthz") {
        this.#assertMethod(method, ["GET"]);
        return this.#json(200, { status: "ok" }, context);
      }
      if (url.pathname === "/readyz") {
        this.#assertMethod(method, ["GET"]);
        const ready = await this.#infrastructure.readiness.check();
        if (!ready) httpError("NOT_READY", 503, "A required dependency is unavailable.");
        return this.#json(200, {
          schemaVersion: "3dena.compute-readiness.v1",
          status: "ready",
          ...this.#publicBuildIdentity(),
        }, context);
      }
      if (url.pathname === "/build-info") {
        this.#assertMethod(method, ["GET"]);
        this.#assertContract(request);
        return this.#json(
          200,
          {
            schemaVersion: "3dena.compute-build-info.v1",
            ...this.#publicBuildIdentity(),
          },
          context,
        );
      }

      // All capability-scoped operations fail closed when the exact compute
      // build or any required durable dependency is not approved/ready.
      // `/healthz` and `/build-info` remain available for diagnosis and
      // candidate approval; `/readyz` is the explicit readiness probe above.
      if (
        url.pathname === "/v1/jobs" || url.pathname.startsWith("/v1/jobs/") ||
        url.pathname === "/v1/datasets" || url.pathname.startsWith("/v1/datasets/")
      ) {
        const ready = await this.#infrastructure.readiness.check();
        if (!ready) {
          httpError("NOT_READY", 503, "The approved compute runtime is unavailable.");
        }
      }

      this.#assertContract(request);
      if (url.pathname === "/v1/datasets") {
        this.#assertMethod(method, ["POST"]);
        return await this.#createDataset(request, url, context);
      }
      const datasetMatch = /^\/v1\/datasets\/([^/]+)(?:\/(content|selection|mapping|preview|activate))?$/u.exec(
        url.pathname,
      );
      if (datasetMatch !== null) {
        const encodedDatasetId = datasetMatch[1];
        if (encodedDatasetId === undefined) httpError("NOT_FOUND", 404, "Dataset route is malformed.");
        let datasetId: string;
        try {
          datasetId = decodeURIComponent(encodedDatasetId);
        } catch {
          httpError("NOT_FOUND", 404, "Dataset identifier is malformed.");
        }
        if (!OPAQUE_ID.test(datasetId)) httpError("NOT_FOUND", 404, "Dataset identifier is invalid.");
        const session = await this.#authorizeDataset(request, datasetId, origin);
        const action = datasetMatch[2] ?? null;
        if (action === "content") {
          this.#assertMethod(method, ["PUT"]);
          this.#requireIdempotencyKey(request);
          const bytes = await this.#parseRawDataset(request, session.preflight.byteLength);
          const result = await this.#requireDatasetService().uploadContent(session, bytes);
          return this.#json(201, result, context);
        }
        if (action === "selection") {
          this.#assertMethod(method, ["POST"]);
          this.#requireIdempotencyKey(request);
          const parsed = await this.#parseJson(request);
          assertExactFields(parsed, ["schemaVersion", "selection"], "dataset selection request");
          if (parsed.schemaVersion !== "3dena.select-compute-dataset-worksheet-request.v1") {
            httpError("INVALID_REQUEST", 400, "Unsupported dataset selection request.");
          }
          const result = await this.#requireDatasetService().selectWorksheet(
            session,
            parsed as unknown as SelectComputeDatasetWorksheetRequestV1,
          );
          return this.#json(200, result, context);
        }
        if (action === "mapping") {
          this.#assertMethod(method, ["PUT"]);
          this.#requireIdempotencyKey(request);
          const parsed = await this.#parseJson(request);
          assertExactFields(parsed, ["schemaVersion", "parsedIdentity", "mapping"], "dataset mapping request");
          if (parsed.schemaVersion !== "3dena.put-compute-dataset-mapping-request.v1") {
            httpError("INVALID_REQUEST", 400, "Unsupported dataset mapping request.");
          }
          const result = await this.#requireDatasetService().putMapping(
            session,
            parsed as unknown as PutComputeDatasetMappingRequestV1,
          );
          return this.#json(200, result, context);
        }
        if (action === "preview") {
          this.#assertMethod(method, ["POST"]);
          this.#requireIdempotencyKey(request);
          const parsed = await this.#parseJson(request);
          assertExactFields(parsed, ["schemaVersion", "mappingSha256"], "dataset preview request");
          if (parsed.schemaVersion !== "3dena.preview-compute-dataset-request.v1" ||
              typeof parsed.mappingSha256 !== "string" || !LOWER_SHA256.test(parsed.mappingSha256)) {
            httpError("INVALID_REQUEST", 400, "Unsupported dataset preview request.");
          }
          const result = await this.#requireDatasetService().preview(
            session,
            parsed as unknown as PreviewComputeDatasetRequestV1,
          );
          return this.#json(200, result, context);
        }
        if (action === "activate") {
          this.#assertMethod(method, ["POST"]);
          this.#requireIdempotencyKey(request);
          const parsed = await this.#parseJson(request);
          assertExactFields(parsed, ["schemaVersion", "activationIdentity", "expectedActiveActivationIdentity"], "dataset activation request");
          if (parsed.schemaVersion !== "3dena.activate-compute-dataset-request.v1") {
            httpError("INVALID_REQUEST", 400, "Unsupported dataset activation request.");
          }
          const result = await this.#requireDatasetService().activate(
            session,
            parsed as unknown as ActivateComputeDatasetRequestV1,
          );
          return this.#json(200, result, context);
        }
        if (method === "DELETE") {
          this.#requireIdempotencyKey(request);
          await this.#requireDatasetService().delete(session);
          return this.#json(200, {
            schemaVersion: "3dena.compute-dataset-deletion-receipt.v1",
            datasetId,
            deletedAt: isoTimestamp(this.#infrastructure.clock.now()),
            sourceDeleted: true,
          }, context);
        }
        this.#assertMethod(method, ["DELETE"]);
      }
      if (url.pathname === "/v1/jobs") {
        this.#assertMethod(method, ["POST"]);
        return await this.#createJob(request, context);
      }

      const match = /^\/v1\/jobs\/([^/]+)(?:\/(execute|events|result|artifact))?$/u.exec(
        url.pathname,
      );
      if (match === null) httpError("NOT_FOUND", 404, "No compute route matched.");
      const encodedJobId = match[1];
      if (encodedJobId === undefined) {
        httpError("NOT_FOUND", 404, "The compute job route is malformed.");
      }
      let jobId: string;
      try {
        jobId = decodeURIComponent(encodedJobId);
      } catch {
        httpError("NOT_FOUND", 404, "The compute job identifier is malformed.");
      }
      if (!OPAQUE_ID.test(jobId)) {
        httpError("NOT_FOUND", 404, "The compute job identifier is invalid.");
      }
      const action = match[2] ?? null;

      if (action === "execute") {
        this.#assertMethod(method, ["POST"]);
        const job = await this.#authorize(request, jobId, origin, false);
        return await this.#executeJob(request, job, context);
      }
      if (action === "events") {
        this.#assertMethod(method, ["GET"]);
        const job = await this.#authorize(request, jobId, origin, false);
        return await this.#events(request, job, context);
      }
      if (action === "result") {
        this.#assertMethod(method, ["GET"]);
        const job = await this.#authorize(request, jobId, origin, false);
        return await this.#result(job, context);
      }
      if (action === "artifact") {
        this.#assertMethod(method, ["GET"]);
        const job = await this.#authorize(request, jobId, origin, false);
        return await this.#artifact(job, context);
      }
      if (method === "GET") {
        const job = await this.#authorize(request, jobId, origin, false);
        const snapshot = await this.#statusSnapshot(job);
        await this.#publishStatus(snapshot.status);
        return this.#json(200, snapshot.status, context);
      }
      if (method === "DELETE") {
        const job = await this.#authorize(request, jobId, origin, true);
        return await this.#deleteJob(request, job, context);
      }
      this.#assertMethod(method, ["GET", "DELETE"]);
      throw new Error("Unreachable method branch.");
    } catch (error) {
      const normalized =
        error instanceof ComputeHttpError
          ? error
          : error instanceof ComputeServiceCoreError
            ? mapCoreError(error)
            : error instanceof DatasetWorkflowError
              ? new ComputeHttpError(
                  "DATASET_WORKFLOW_REJECTED",
                  ["STALE_GENERATION", "GENERATION_CONFLICT", "ACTIVATION_CONFLICT"].includes(error.code)
                    ? 409
                    : 400,
                  `Dataset workflow rejected ${error.code}.`,
                )
            : new ComputeHttpError(
                "INTERNAL_ERROR",
                500,
                "An unclassified compute HTTP failure occurred.",
              );
      const body: JsonErrorBody = {
        code: normalized.code,
        requestId,
      };
      return this.#json(normalized.status, body, context);
    }
  }

  /** Internal API/worker reconciliation hook; it does not authorize a user. */
  async reconcileJob(jobId: string): Promise<AnalysisJobStatusV1> {
    if (!OPAQUE_ID.test(jobId)) {
      httpError("INVALID_REQUEST", 400, "jobId is invalid for reconciliation.");
    }
    const job = await this.#infrastructure.repository.get(jobId);
    if (job === null) httpError("NOT_FOUND", 404, "Job does not exist.");
    const snapshot = await this.#statusSnapshot(job);
    await this.#publishStatus(snapshot.status);
    return snapshot.status;
  }

  /** Worker-facing progress hook; only aggregate progress fields are accepted. */
  async publishProgress(
    jobId: string,
    progress: Readonly<{
      phase: string;
      completed: number;
      total: number | null;
    }>,
  ): Promise<AnalysisJobEventV1> {
    if (!OPAQUE_ID.test(jobId) || !/^[A-Za-z0-9._-]{1,80}$/u.test(progress.phase)) {
      httpError("INVALID_REQUEST", 400, "Progress identity or phase is invalid.");
    }
    if (
      !Number.isSafeInteger(progress.completed) ||
      progress.completed < 0 ||
      (progress.total !== null &&
        (!Number.isSafeInteger(progress.total) ||
          progress.total < progress.completed))
    ) {
      httpError("INVALID_REQUEST", 400, "Progress counts are invalid.");
    }
    const job = await this.#infrastructure.repository.get(jobId);
    if (job === null) httpError("NOT_FOUND", 404, "Progress job does not exist.");
    const snapshot = await this.#statusSnapshot(job);
    if (TERMINAL_REMOTE_STATES.has(snapshot.status.state)) {
      httpError("INVALID_REQUEST", 409, "Terminal jobs cannot publish progress.");
    }
    return this.#infrastructure.events.publish(jobId, {
      state: snapshot.status.state,
      phase: progress.phase,
      completed: progress.completed,
      total: progress.total,
      emittedAt: isoTimestamp(this.#infrastructure.clock.now()),
    });
  }

  async #createDataset(
    request: Request,
    requestUrl: URL,
    context: RequestContext,
  ): Promise<Response> {
    const service = this.#requireDatasetService();
    const idempotencyKey = this.#requireIdempotencyKey(request);
    const parsed = await this.#parseJson(request);
    assertExactFields(
      parsed,
      ["schemaVersion", "preflight", "processingPolicyConfirmed"],
      "create dataset request",
    );
    if (
      parsed.schemaVersion !== "3dena.create-compute-dataset-request.v1" ||
      parsed.processingPolicyConfirmed !== true
    ) {
      httpError("INVALID_REQUEST", 400, "Unsupported dataset create request.");
    }
    assertExactFields(
      parsed.preflight,
      ["schemaVersion", "productStatus", "preflightIdentity", "declaredExtension",
        "format", "byteLength", "sha256", "limits"],
      "dataset preflight receipt",
    );
    if (
      parsed.preflight.schemaVersion !== "3dena.browser-preflight-receipt.v1" ||
      parsed.preflight.productStatus !== "IMPLEMENTED_UNVERIFIED" ||
      typeof parsed.preflight.preflightIdentity !== "string" ||
      !parsed.preflight.preflightIdentity.startsWith("preflight:sha256:") ||
      ![".csv", ".xlsx", ".xls"].includes(parsed.preflight.declaredExtension as string) ||
      !["csv", "xlsx", "xls"].includes(parsed.preflight.format as string) ||
      !Number.isSafeInteger(parsed.preflight.byteLength) ||
      (parsed.preflight.byteLength as number) < 1 ||
      (parsed.preflight.byteLength as number) > MAX_DATASET_BYTES ||
      typeof parsed.preflight.sha256 !== "string" ||
      !LOWER_SHA256.test(parsed.preflight.sha256)
    ) {
      httpError("INVALID_REQUEST", 400, "Dataset preflight receipt is invalid.");
    }
    const createRequest = parsed as unknown as CreateComputeDatasetRequestV1;
    const createIdempotencyHash = this.#infrastructure.capabilityCodec.hashSecret(
      `dataset-create\0${context.origin ?? "server"}\0${idempotencyKey}`,
    );
    const datasetId = `dataset-${createIdempotencyHash.slice(0, 32)}`;
    const capabilityToken = this.#infrastructure.capabilityCodec.issue(datasetId);
    const now = this.#infrastructure.clock.now();
    const expiresAtMs = now + this.#jobTtlMs;
    const session = await service.create({
      datasetId,
      capabilityHash: this.#infrastructure.capabilityCodec.hashSecret(capabilityToken),
      boundOrigin: context.origin,
      request: createRequest,
      createdAtMs: now,
      expiresAtMs,
    });
    const contentUrl = new URL(
      `/v1/datasets/${encodeURIComponent(datasetId)}/content`,
      requestUrl.origin,
    ).toString();
    const response: ComputeDatasetCapabilityV1 = {
      schemaVersion: "3dena.compute-dataset-capability.v1",
      datasetId,
      generation: session.generation,
      capabilityToken,
      contentUrl: assertSafeAbsoluteUrl(contentUrl, "dataset content URL"),
      expiresAt: isoTimestamp(session.expiresAtMs),
    };
    return this.#json(201, response, context);
  }

  async #createJob(
    request: Request,
    context: RequestContext,
  ): Promise<Response> {
    if (this.#infrastructure.datasetWorkflow !== undefined) {
      return this.#createActivatedJob(request, context);
    }
    const idempotencyKey = this.#requireIdempotencyKey(request);
    const parsed = await this.#parseJson(request);
    assertExactFields(
      parsed,
      ["schemaVersion", "dataset", "processingPolicyConfirmed"],
      "create request",
    );
    if (parsed.schemaVersion !== "3dena.create-job-request.v1") {
      httpError("INVALID_REQUEST", 400, "Unsupported create request version.");
    }
    if (parsed.processingPolicyConfirmed !== true) {
      httpError("INVALID_REQUEST", 400, "Processing policy was not confirmed.");
    }
    assertExactFields(
      parsed.dataset,
      ["sha256", "byteLength", "format"],
      "create request dataset",
    );
    if (!LOWER_SHA256.test(parsed.dataset.sha256 as string)) {
      httpError("INVALID_REQUEST", 400, "Dataset digest is invalid.");
    }
    if (
      !Number.isSafeInteger(parsed.dataset.byteLength) ||
      (parsed.dataset.byteLength as number) < 1 ||
      (parsed.dataset.byteLength as number) > MAX_DATASET_BYTES
    ) {
      httpError("INVALID_REQUEST", 400, "Dataset size is outside the v1 limit.");
    }
    const datasetFormat = parsed.dataset.format;
    if (!isDatasetFormat(datasetFormat)) {
      httpError("INVALID_REQUEST", 400, "Dataset format is unsupported.");
    }
    const createRequest = parsed as unknown as CreateAnalysisJobRequestV1;
    const createRequestFingerprint = sha256Text(
      canonicalStringify({ request: createRequest, origin: context.origin }),
    );
    const createIdempotencyHash =
      this.#infrastructure.capabilityCodec.hashSecret(
        `create\0${idempotencyKey}`,
      );
    const replay =
      await this.#infrastructure.repository.findByCreateIdempotencyHash(
        createIdempotencyHash,
      );
    if (replay !== null) {
      if (replay.createRequestFingerprint !== createRequestFingerprint) {
        httpError(
          "IDEMPOTENCY_CONFLICT",
          409,
          "Create idempotency key is bound to another request.",
        );
      }
      return await this.#jobCapabilityResponse(replay, false, context);
    }

    const now = this.#infrastructure.clock.now();
    const jobId = this.#infrastructure.idFactory.nextId("job");
    if (!OPAQUE_ID.test(jobId)) {
      httpError("INTERNAL_ERROR", 500, "Job ID factory returned an unsafe value.");
    }
    const capability = this.#infrastructure.capabilityCodec.issue(jobId);
    const expiresAtMs = now + this.#jobTtlMs;
    if (!Number.isSafeInteger(expiresAtMs)) {
      httpError("INTERNAL_ERROR", 500, "Job expiry exceeds safe time range.");
    }
    const dataset: ReservedDatasetV1 = cloneFrozen({
      sha256: createRequest.dataset.sha256,
      byteLength: createRequest.dataset.byteLength,
      format: datasetFormat,
    });
    const upload = await this.#infrastructure.objectUrls.createUploadTarget({
      jobId,
      dataset,
      expiresAtMs,
    });
    assertSafeAbsoluteUrl(upload.uploadUrl, "upload URL");
    if (
      typeof upload.objectKey !== "string" ||
      !upload.objectKey.startsWith(`compute-inputs/${jobId}/`)
    ) {
      httpError("INTERNAL_ERROR", 500, "Upload issuer returned an unowned key.");
    }
    const record: ComputeHttpJobRecordV1 = cloneFrozen({
      version: COMPUTE_HTTP_JOB_VERSION,
      jobId,
      revision: 0,
      capabilityHash:
        this.#infrastructure.capabilityCodec.hashSecret(capability),
      boundOrigin: context.origin,
      createIdempotencyHash,
      createRequestFingerprint,
      dataset,
      inputObjectKey: upload.objectKey,
      createdAtMs: now,
      updatedAtMs: now,
      expiresAtMs,
    });
    const created =
      await this.#infrastructure.repository.createIfAbsent(record);
    if (
      !created.created &&
      (created.record.createIdempotencyHash !== createIdempotencyHash ||
        created.record.createRequestFingerprint !== createRequestFingerprint)
    ) {
      httpError(
        "IDEMPOTENCY_CONFLICT",
        409,
        "Concurrent create conflicted with this request.",
      );
    }
    if (created.created) {
      const status = await this.#statusSnapshot(created.record);
      await this.#publishStatus(status.status);
    }
    return await this.#jobCapabilityResponse(
      created.record,
      created.created,
      context,
    );
  }

  async #createActivatedJob(
    request: Request,
    context: RequestContext,
  ): Promise<Response> {
    const idempotencyKey = this.#requireIdempotencyKey(request);
    const capabilityToken = this.#bearerToken(request);
    const parsed = await this.#parseJson(request);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      (parsed as { schemaVersion?: unknown }).schemaVersion ===
        "3dena.create-source-result-job-request.v1"
    ) {
      return this.#createSourceResultJob(
        request,
        parsed,
        idempotencyKey,
        context,
      );
    }
    assertExactFields(
      parsed,
      ["schemaVersion", "activationReceipt", "processingPolicyConfirmed"],
      "activated job create request",
    );
    if (parsed.schemaVersion !== "3dena.create-activated-job-request.v1" ||
        parsed.processingPolicyConfirmed !== true) {
      httpError("INVALID_REQUEST", 400, "Unsupported activated job create request.");
    }
    assertExactFields(
      parsed.activationReceipt,
      ["schemaVersion", "datasetId", "generation", "activationIdentity",
        "uploadIdentity", "datasetReceipt", "activatedAt", "expiresAt",
        "activationReceiptSha256"],
      "dataset activation receipt",
    );
    if (parsed.activationReceipt.schemaVersion !== COMPUTE_DATASET_ACTIVATION_RECEIPT_VERSION ||
        typeof parsed.activationReceipt.datasetId !== "string" ||
        !OPAQUE_ID.test(parsed.activationReceipt.datasetId) ||
        typeof parsed.activationReceipt.activationReceiptSha256 !== "string" ||
        !LOWER_SHA256.test(parsed.activationReceipt.activationReceiptSha256)) {
      httpError("INVALID_REQUEST", 400, "Dataset activation receipt is invalid.");
    }
    const createRequest = parsed as unknown as CreateActivatedAnalysisJobRequestV1;
    const activation = await this.#requireDatasetService().resolveActivation(
      createRequest.activationReceipt,
      capabilityToken,
      context.origin,
    );
    if (activation === null) {
      httpError("UNAUTHORIZED", 401, "Dataset activation receipt is not authorized or current.");
    }
    const createRequestFingerprint = sha256Text(canonicalStringify({
      request: createRequest,
      origin: context.origin,
    }));
    const createIdempotencyHash = this.#infrastructure.capabilityCodec.hashSecret(
      `activated-create\0${activation.session.datasetId}\0${idempotencyKey}`,
    );
    const replay = await this.#infrastructure.repository.findByCreateIdempotencyHash(
      createIdempotencyHash,
    );
    if (replay !== null) {
      if (replay.createRequestFingerprint !== createRequestFingerprint) {
        httpError("IDEMPOTENCY_CONFLICT", 409, "Activated job create key is bound to another request.");
      }
      return this.#jobCapabilityResponse(replay, false, context);
    }
    const now = this.#infrastructure.clock.now();
    const jobId = this.#infrastructure.idFactory.nextId("job");
    if (!OPAQUE_ID.test(jobId)) httpError("INTERNAL_ERROR", 500, "Job ID is unsafe.");
    const jobCapability = this.#infrastructure.capabilityCodec.issue(jobId);
    const expiresAtMs = Math.min(activation.session.expiresAtMs, now + this.#jobTtlMs);
    const activatedDatasetFormat = activation.receipt.datasetReceipt.format;
    if (!isDatasetFormat(activatedDatasetFormat)) {
      httpError("INVALID_REQUEST", 400, "Activated dataset format is not supported remotely.");
    }
    const dataset: ReservedDatasetV1 = cloneFrozen({
      sha256: activation.receipt.datasetReceipt.sha256,
      byteLength: activation.receipt.datasetReceipt.byteLength,
      format: activatedDatasetFormat,
    });
    const contentUrl = new URL(
      `/v1/datasets/${encodeURIComponent(activation.session.datasetId)}/content`,
      request.url,
    ).toString();
    const record: ComputeHttpJobRecordV1 = cloneFrozen({
      version: COMPUTE_HTTP_JOB_VERSION,
      jobId,
      revision: 0,
      capabilityHash: this.#infrastructure.capabilityCodec.hashSecret(jobCapability),
      boundOrigin: context.origin,
      createIdempotencyHash,
      createRequestFingerprint,
      dataset,
      inputObjectKey: activation.object.key,
      inputObjectOwnedByJob: false,
      activatedDatasetId: activation.session.datasetId,
      activationReceiptSha256: activation.receipt.activationReceiptSha256,
      activatedDatasetContentUrl: contentUrl,
      activatedDatasetReceipt: activation.receipt.datasetReceipt,
      createdAtMs: now,
      updatedAtMs: now,
      expiresAtMs,
    });
    const created = await this.#infrastructure.repository.createIfAbsent(record);
    if (!created.created && created.record.createRequestFingerprint !== createRequestFingerprint) {
      httpError("IDEMPOTENCY_CONFLICT", 409, "Concurrent activated create conflicted.");
    }
    if (created.created) {
      const status = await this.#statusSnapshot(created.record);
      await this.#publishStatus(status.status);
    }
    return this.#jobCapabilityResponse(created.record, created.created, context);
  }

  async #createSourceResultJob(
    request: Request,
    parsed: unknown,
    idempotencyKey: string,
    context: RequestContext,
  ): Promise<Response> {
    assertExactFields(
      parsed,
      ["schemaVersion", "sourceJobId", "sourceResultHash", "processingPolicyConfirmed"],
      "source-result job create request",
    );
    const candidate = parsed as Record<string, unknown>;
    if (
      candidate.schemaVersion !== "3dena.create-source-result-job-request.v1" ||
      candidate.processingPolicyConfirmed !== true ||
      typeof candidate.sourceJobId !== "string" ||
      !OPAQUE_ID.test(candidate.sourceJobId) ||
      typeof candidate.sourceResultHash !== "string" ||
      !LOWER_SHA256.test(candidate.sourceResultHash)
    ) {
      httpError("INVALID_REQUEST", 400, "Source-result job request is invalid.");
    }
    const createRequest = parsed as unknown as CreateSourceResultAnalysisJobRequestV1;
    const sourceJob = await this.#authorize(
      request,
      createRequest.sourceJobId,
      context.origin,
      false,
    );
    const sourceSnapshot = await this.#statusSnapshot(sourceJob);
    const receipt = sourceSnapshot.job.activatedDatasetReceipt;
    const sourceOwner = sourceSnapshot.job.owner;
    if (
      sourceSnapshot.status.state !== "SUCCEEDED" ||
      !sourceSnapshot.status.resultAvailable ||
      sourceSnapshot.job.taskKind !== "ena-model" ||
      sourceOwner === undefined ||
      receipt === undefined
    ) {
      httpError(
        "DATASET_WORKFLOW_REJECTED",
        409,
        "A successful service-owned ENA source job is required.",
      );
    }
    try {
      assertDatasetReceiptV1(receipt, "source.datasetReceipt");
      assertTaskOwnerV1(sourceOwner, "source.owner");
    } catch {
      httpError("DATASET_RECEIPT_MISMATCH", 409, "Source job metadata is invalid.");
    }
    const resolver = this.#infrastructure.sourceResults;
    if (resolver === undefined) {
      httpError("DATASET_WORKFLOW_REJECTED", 409, "Service-owned source result resolution is unavailable.");
    }
    const now = this.#infrastructure.clock.now();
    const sourceBinding = await resolver.resolve({
      sourceResultHash: createRequest.sourceResultHash,
      activatedDatasetSha256: receipt.sha256,
      requiredBuildId: this.#buildIdentity.flyBuildId,
      nowMs: now,
    });
    if (
      sourceBinding === null ||
      sourceBinding.source.sourceKind !== "raw-jena" ||
      sourceBinding.source.hash !== createRequest.sourceResultHash ||
      sourceBinding.buildId !== this.#buildIdentity.flyBuildId ||
      !sameTaskOwner(sourceBinding.owner, sourceOwner) ||
      sourceBinding.publishedAtMs > now ||
      sourceBinding.expiresAtMs <= now ||
      await hashAnalysisValueV1(sourceBinding.source.result) !== createRequest.sourceResultHash
    ) {
      httpError(
        "DATASET_RECEIPT_MISMATCH",
        409,
        "The requested ENA source result is unavailable or not owned by the source job.",
      );
    }
    const createRequestFingerprint = sha256Text(canonicalStringify({
      request: createRequest,
      origin: context.origin,
    }));
    const createIdempotencyHash = this.#infrastructure.capabilityCodec.hashSecret(
      `source-create\0${sourceJob.jobId}\0${createRequest.sourceResultHash}\0${idempotencyKey}`,
    );
    const replay = await this.#infrastructure.repository.findByCreateIdempotencyHash(
      createIdempotencyHash,
    );
    if (replay !== null) {
      if (replay.createRequestFingerprint !== createRequestFingerprint) {
        httpError("IDEMPOTENCY_CONFLICT", 409, "Source-result create key is bound to another request.");
      }
      return this.#sourceResultJobCapabilityResponse(replay, false, context);
    }
    const jobId = this.#infrastructure.idFactory.nextId("job");
    if (!OPAQUE_ID.test(jobId)) httpError("INTERNAL_ERROR", 500, "Job ID is unsafe.");
    const jobCapability = this.#infrastructure.capabilityCodec.issue(jobId);
    const expiresAtMs = Math.min(
      sourceJob.expiresAtMs,
      sourceBinding.expiresAtMs,
      now + this.#jobTtlMs,
    );
    if (expiresAtMs <= now) httpError("JOB_EXPIRED", 410, "Source result has expired.");
    const record: ComputeHttpJobRecordV1 = cloneFrozen({
      version: COMPUTE_HTTP_JOB_VERSION,
      jobId,
      revision: 0,
      capabilityHash: this.#infrastructure.capabilityCodec.hashSecret(jobCapability),
      boundOrigin: context.origin,
      createIdempotencyHash,
      createRequestFingerprint,
      dataset: sourceJob.dataset,
      inputObjectKey: sourceJob.inputObjectKey,
      inputObjectOwnedByJob: false,
      activatedDatasetReceipt: receipt,
      sourceJobId: sourceJob.jobId,
      sourceResultHash: createRequest.sourceResultHash,
      createdAtMs: now,
      updatedAtMs: now,
      expiresAtMs,
    });
    const created = await this.#infrastructure.repository.createIfAbsent(record);
    if (!created.created && created.record.createRequestFingerprint !== createRequestFingerprint) {
      httpError("IDEMPOTENCY_CONFLICT", 409, "Concurrent source-result create conflicted.");
    }
    if (created.created) {
      const status = await this.#statusSnapshot(created.record);
      await this.#publishStatus(status.status);
    }
    return this.#sourceResultJobCapabilityResponse(created.record, created.created, context);
  }

  #sourceResultJobCapabilityResponse(
    job: ComputeHttpJobRecordV1,
    created: boolean,
    context: RequestContext,
  ): Response {
    if (job.sourceJobId === undefined || job.sourceResultHash === undefined) {
      httpError("INTERNAL_ERROR", 500, "Source-result job binding is unavailable.");
    }
    const capability = this.#infrastructure.capabilityCodec.issue(job.jobId);
    if (!this.#infrastructure.capabilityCodec.verify(capability, job.capabilityHash)) {
      httpError("INTERNAL_ERROR", 500, "Stored source-result capability is inconsistent.");
    }
    const response: SourceResultAnalysisJobCapabilityV1 = {
      schemaVersion: "3dena.source-result-job-capability.v1",
      jobId: job.jobId,
      capabilityToken: capability,
      sourceJobId: job.sourceJobId,
      sourceResultHash: job.sourceResultHash,
      expiresAt: isoTimestamp(job.expiresAtMs),
    };
    return this.#json(created ? 201 : 200, response, context);
  }

  async #jobCapabilityResponse(
    job: ComputeHttpJobRecordV1,
    created: boolean,
    context: RequestContext,
  ): Promise<Response> {
    const capability = this.#infrastructure.capabilityCodec.issue(job.jobId);
    if (
      !this.#infrastructure.capabilityCodec.verify(
        capability,
        job.capabilityHash,
      )
    ) {
      httpError("INTERNAL_ERROR", 500, "Stored capability digest is inconsistent.");
    }
    let uploadUrl = job.activatedDatasetContentUrl;
    if (job.activatedDatasetContentUrl === undefined) {
      const upload = await this.#infrastructure.objectUrls.createUploadTarget({
        jobId: job.jobId,
        dataset: job.dataset,
        expiresAtMs: job.expiresAtMs,
      });
      if (upload.objectKey !== job.inputObjectKey) {
        httpError("INTERNAL_ERROR", 500, "Upload target is not deterministic.");
      }
      uploadUrl = upload.uploadUrl;
    }
    if (uploadUrl === undefined) httpError("INTERNAL_ERROR", 500, "Upload URL is unavailable.");
    const response: AnalysisJobCapabilityV1 = {
      schemaVersion: "3dena.job-capability.v1",
      jobId: job.jobId,
      capabilityToken: capability,
      uploadUrl: assertSafeAbsoluteUrl(uploadUrl, "upload URL"),
      expiresAt: isoTimestamp(job.expiresAtMs),
    };
    return this.#json(created ? 201 : 200, response, context);
  }

  async #executeJob(
    request: Request,
    authorizedJob: ComputeHttpJobRecordV1,
    context: RequestContext,
  ): Promise<Response> {
    if (
      authorizedJob.inputObjectOwnedByJob === false &&
      ((authorizedJob.activatedDatasetId !== undefined &&
        authorizedJob.activationReceiptSha256 !== undefined) ||
        (authorizedJob.sourceJobId !== undefined &&
          authorizedJob.sourceResultHash !== undefined &&
          authorizedJob.activatedDatasetReceipt !== undefined))
    ) {
      return this.#executeActivatedJob(request, authorizedJob, context);
    }
    const idempotencyKey = this.#requireIdempotencyKey(request);
    const parsed = await this.#parseJson(request);
    assertExactFields(
      parsed,
      ["schemaVersion", "datasetReceipt", "task"],
      "execute request",
    );
    if (parsed.schemaVersion !== "3dena.execute-job-request.v1") {
      httpError("INVALID_REQUEST", 400, "Unsupported execute request version.");
    }
    try {
      assertDatasetReceiptV1(parsed.datasetReceipt, "request.datasetReceipt");
      assertAnalysisTaskV1(parsed.task, "request.task");
    } catch {
      httpError("INVALID_REQUEST", 400, "Execute request violates analysis contracts.");
    }
    const executeRequest = parsed as unknown as ExecuteAnalysisJobRequestV1;
    const receipt = executeRequest.datasetReceipt;
    const task = executeRequest.task;
    if (!SUPPORTED_TASK_KINDS.has(task.kind)) {
      httpError("INVALID_REQUEST", 400, "Analysis task kind is not supported.");
    }
    if (
      receipt.sha256 !== authorizedJob.dataset.sha256 ||
      receipt.byteLength !== authorizedJob.dataset.byteLength ||
      receipt.format !== authorizedJob.dataset.format ||
      task.owner.datasetHash !== receipt.sha256
    ) {
      httpError(
        "DATASET_RECEIPT_MISMATCH",
        409,
        "Activated dataset receipt does not match the reserved upload.",
      );
    }
    const now = this.#infrastructure.clock.now();
    if (now >= authorizedJob.expiresAtMs) {
      httpError("JOB_EXPIRED", 410, "Job expired before task binding.");
    }
    if (
      task.deadlineEpochMilliseconds <= now ||
      task.deadlineEpochMilliseconds > authorizedJob.expiresAtMs ||
      task.deadlineEpochMilliseconds - now > this.#maxTaskRuntimeMs
    ) {
      httpError(
        "DEADLINE_EXCEEDED",
        400,
        "Task deadline is outside the configured runtime and TTL.",
      );
    }

    const requestFingerprint = sha256Text(canonicalStringify(executeRequest));
    const idempotencyHash = this.#infrastructure.capabilityCodec.hashSecret(
      `execute\0${authorizedJob.jobId}\0${idempotencyKey}`,
    );
    if (authorizedJob.executeRequestFingerprint !== undefined) {
      if (
        authorizedJob.executeRequestFingerprint !== requestFingerprint ||
        (authorizedJob.executeIdempotencyHash === idempotencyHash &&
          authorizedJob.owner?.taskId !== task.owner.taskId)
      ) {
        httpError(
          "IDEMPOTENCY_CONFLICT",
          409,
          "Job is already bound to another execute request.",
        );
      }
      const replay = await this.#statusSnapshot(authorizedJob);
      await this.#publishStatus(replay.status);
      return this.#json(202, replay.status, context);
    }

    const uploaded = await this.#infrastructure.objectStore.head(
      authorizedJob.inputObjectKey,
    );
    const expectedUpload: ImmutableObjectDescriptor = {
      key: authorizedJob.inputObjectKey,
      sha256: authorizedJob.dataset.sha256,
      byteLength: authorizedJob.dataset.byteLength,
    };
    if (uploaded === null) {
      httpError(
        "DATASET_NOT_UPLOADED",
        409,
        "The reserved dataset object has not been uploaded.",
      );
    }
    if (!descriptorsEqual(uploaded, expectedUpload)) {
      httpError(
        "DATASET_RECEIPT_MISMATCH",
        409,
        "Uploaded object does not match the reserved exact-byte receipt.",
      );
    }

    const executionObjectKey =
      `compute-inputs/${authorizedJob.jobId}/${requestFingerprint}.json`;
    const executionDataset: AnalysisExecutionDatasetV1 = {
      schemaVersion: "3dena.analysis-execution-dataset.v1",
      receipt,
      specHash: task.owner.specHash,
      buildId: this.#buildIdentity.flyBuildId,
      generatedAt: isoTimestamp(now),
    };
    const executionInput: ComputeExecutionInputV1 = {
      version: COMPUTE_HTTP_EXECUTION_INPUT_VERSION,
      dataset: executionDataset,
      task,
    };
    const executionObject = await this.#infrastructure.objectStore.putImmutable(
      executionObjectKey,
      new TextEncoder().encode(canonicalStringify(executionInput)),
    );
    const coreTaskId = authorizedJob.jobId;
    try {
      await this.#core.createTask({
        version: COMPUTE_TASK_REQUEST_VERSION,
        owner: {
          contractVersion: COMPUTE_TASK_OWNER_CONTRACT_VERSION,
          datasetHash: task.owner.datasetHash,
          specHash: task.owner.specHash,
          runId: task.owner.runId,
          taskId: coreTaskId,
        },
        taskKind: task.kind,
        input: executionObject.descriptor,
        deadlineAtMs: task.deadlineEpochMilliseconds,
        expiresAtMs: authorizedJob.expiresAtMs,
      });
    } catch (error) {
      if (error instanceof ComputeServiceCoreError) throw mapCoreError(error);
      throw error;
    }

    let bound: ComputeHttpJobRecordV1 | null = null;
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const current = await this.#requireJob(authorizedJob.jobId);
      if (current.executeRequestFingerprint !== undefined) {
        if (current.executeRequestFingerprint !== requestFingerprint) {
          httpError(
            "IDEMPOTENCY_CONFLICT",
            409,
            "Concurrent execute bound another immutable task.",
          );
        }
        bound = current;
        break;
      }
      const next: ComputeHttpJobRecordV1 = cloneFrozen({
        ...current,
        revision: current.revision + 1,
        updatedAtMs: now,
        owner: task.owner,
        taskKind: task.kind,
        coreTaskId,
        executionObjectKey,
        executeIdempotencyHash: idempotencyHash,
        executeRequestFingerprint: requestFingerprint,
      });
      const changed = await this.#infrastructure.repository.compareAndSet(
        current.jobId,
        current.revision,
        next,
      );
      if (!changed.applied) continue;
      bound = changed.record;
      break;
    }
    if (bound === null) {
      httpError("INTERNAL_ERROR", 500, "Execute binding exceeded the CAS limit.");
    }
    const snapshot = await this.#statusSnapshot(bound);
    await this.#publishStatus(snapshot.status);
    return this.#json(202, snapshot.status, context);
  }

  async #executeActivatedJob(
    request: Request,
    authorizedJob: ComputeHttpJobRecordV1,
    context: RequestContext,
  ): Promise<Response> {
    const idempotencyKey = this.#requireIdempotencyKey(request);
    const parsed = await this.#parseJson(request);
    assertExactFields(parsed, ["schemaVersion", "task"], "activated execute request");
    if (parsed.schemaVersion !== "3dena.execute-activated-job-request.v1") {
      httpError("INVALID_REQUEST", 400, "Unsupported activated execute request version.");
    }
    assertActivatedTaskSpec(parsed.task);
    const executeRequest = parsed as unknown as ExecuteActivatedAnalysisJobRequestV1;
    const requested = executeRequest.task;
    const now = this.#infrastructure.clock.now();
    if (now >= authorizedJob.expiresAtMs) {
      httpError("JOB_EXPIRED", 410, "Job expired before task binding.");
    }
    if (
      requested.deadlineEpochMilliseconds <= now ||
      requested.deadlineEpochMilliseconds > authorizedJob.expiresAtMs ||
      requested.deadlineEpochMilliseconds - now > this.#maxTaskRuntimeMs
    ) {
      httpError(
        "DEADLINE_EXCEEDED",
        400,
        "Task deadline is outside the configured runtime and TTL.",
      );
    }

    const requestFingerprint = sha256Text(canonicalStringify(executeRequest));
    const idempotencyHash = this.#infrastructure.capabilityCodec.hashSecret(
      `execute\0${authorizedJob.jobId}\0${idempotencyKey}`,
    );
    if (authorizedJob.executeRequestFingerprint !== undefined) {
      if (authorizedJob.executeRequestFingerprint !== requestFingerprint) {
        httpError("IDEMPOTENCY_CONFLICT", 409, "Job is already bound to another execute request.");
      }
      const replay = await this.#statusSnapshot(authorizedJob);
      await this.#publishStatus(replay.status);
      return this.#json(202, replay.status, context);
    }

    const sourceJobBacked = authorizedJob.sourceJobId !== undefined &&
      authorizedJob.sourceResultHash !== undefined &&
      authorizedJob.activatedDatasetReceipt !== undefined;
    let activatedPayload: ActiveDatasetPayloadV1 | undefined;
    let datasetReceipt = authorizedJob.activatedDatasetReceipt;
    if (sourceJobBacked) {
      if (
        requested.kind === "ena-model" ||
        requested.sourceResultHash !== authorizedJob.sourceResultHash
      ) {
        httpError("DATASET_RECEIPT_MISMATCH", 409, "Derived task does not match its source-result job binding.");
      }
    } else {
      const datasetId = authorizedJob.activatedDatasetId;
      const activationReceiptSha256 = authorizedJob.activationReceiptSha256;
      if (datasetId === undefined || activationReceiptSha256 === undefined) {
        httpError("DATASET_WORKFLOW_REJECTED", 409, "Activated dataset binding is unavailable.");
      }
      const resolved = await this.#requireDatasetService().resolveActivatedExecution(
        datasetId,
        activationReceiptSha256,
      );
      if (resolved === null || !descriptorsEqual(resolved.object, {
        key: authorizedJob.inputObjectKey,
        sha256: authorizedJob.dataset.sha256,
        byteLength: authorizedJob.dataset.byteLength,
      })) {
        httpError(
          "DATASET_RECEIPT_MISMATCH",
          409,
          "Activated service-owned dataset no longer matches the job binding.",
        );
      }
      activatedPayload = resolved.payload;
      datasetReceipt = resolved.receipt.datasetReceipt;
    }
    if (datasetReceipt === undefined) {
      httpError("DATASET_RECEIPT_MISMATCH", 409, "Dataset receipt is unavailable for execution.");
    }
    const scientificSpec = requested.kind === "ena-model"
      ? requested.spec
      : Object.fromEntries(Object.entries(requested).filter(
          ([field]) => !["schemaVersion", "runId", "deadlineEpochMilliseconds"].includes(field),
        ));
    const specHash = await hashAnalysisValueV1(scientificSpec);
    const owner = {
      contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
      datasetHash: datasetReceipt.sha256,
      specHash,
      runId: requested.runId,
      taskId: authorizedJob.jobId,
    } as const;
    let task: AnalysisTaskV1;
    let sourceResult: AnalysisExecutionDatasetV2["sourceResult"] = undefined;
    if (requested.kind === "ena-model") {
      if (activatedPayload === undefined) {
        httpError("DATASET_WORKFLOW_REJECTED", 409, "ENA execution requires an active service-owned dataset.");
      }
      const materialized = materializeActivatedRows(activatedPayload, requested.spec);
      task = {
        schemaVersion: ANALYSIS_TASK_VERSION_V1,
        kind: "ena-model",
        owner,
        deadlineEpochMilliseconds: requested.deadlineEpochMilliseconds,
        input: {
          rows: materialized.rows,
          mapping: materialized.mapping,
          config: {
            model: requested.spec.model,
            window: requested.spec.window,
            weightBy: requested.spec.weightBy,
            windowSizeBack: requested.spec.windowSizeBack,
            windowSizeForward: requested.spec.windowSizeForward,
            centerAlignToOrigin: requested.spec.centerAlignToOrigin,
          },
          ...(requested.limits === undefined ? {} : { limits: requested.limits }),
        },
      } satisfies EnaModelTaskV1;
    } else {
      const resolver = this.#infrastructure.sourceResults;
      if (resolver === undefined) {
        httpError("DATASET_WORKFLOW_REJECTED", 409, "Service-owned source result resolution is unavailable.");
      }
      const sourceBinding = await resolver.resolve({
        sourceResultHash: requested.sourceResultHash,
        activatedDatasetSha256: datasetReceipt.sha256,
        requiredBuildId: this.#buildIdentity.flyBuildId,
        nowMs: now,
      });
      try {
        if (sourceBinding !== null) assertTaskOwnerV1(sourceBinding.owner, "source.owner");
      } catch {
        httpError("DATASET_RECEIPT_MISMATCH", 409, "Source result ownership receipt is invalid.");
      }
      const resolvedSource = sourceBinding?.source ?? null;
      if (
        sourceBinding === null ||
        sourceBinding.owner.datasetHash !== datasetReceipt.sha256 ||
        sourceBinding.buildId !== this.#buildIdentity.flyBuildId ||
        !Number.isSafeInteger(sourceBinding.publishedAtMs) ||
        !Number.isSafeInteger(sourceBinding.expiresAtMs) ||
        sourceBinding.publishedAtMs > now ||
        sourceBinding.expiresAtMs <= now ||
        resolvedSource === null ||
        resolvedSource.hash !== requested.sourceResultHash ||
        await hashAnalysisValueV1(resolvedSource.result) !== requested.sourceResultHash
      ) {
        httpError("DATASET_RECEIPT_MISMATCH", 409, "Source result is missing or fails its canonical hash.");
      }
      sourceResult = resolvedSource;
      const { schemaVersion: _schemaVersion, runId: _runId, ...scientificTask } = requested;
      task = {
        ...scientificTask,
        schemaVersion: ANALYSIS_TASK_VERSION_V1,
        owner,
      } as AnalysisTaskV1;
    }
    const dataset: AnalysisExecutionDatasetV2 = {
      schemaVersion: ANALYSIS_EXECUTION_DATASET_VERSION_V2,
      receipt: datasetReceipt,
      specHash,
      buildId: this.#buildIdentity.flyBuildId,
      generatedAt: isoTimestamp(now),
      ...(sourceResult === undefined ? {} : { sourceResult }),
    };
    try {
      assertAnalysisTaskV1(task, "service.task");
      assertAnalysisExecutionDatasetV2(dataset, "service.dataset");
    } catch {
      httpError("DATASET_WORKFLOW_REJECTED", 409, "Activated dataset cannot form a valid worker input.");
    }

    const executionObjectKey =
      `compute-inputs/${authorizedJob.jobId}/${requestFingerprint}.json`;
    const executionInput: ComputeExecutionInputV1 = {
      version: COMPUTE_HTTP_EXECUTION_INPUT_VERSION,
      dataset,
      task,
    };
    const executionObject = await this.#infrastructure.objectStore.putImmutable(
      executionObjectKey,
      new TextEncoder().encode(canonicalStringify(executionInput)),
    );
    try {
      await this.#core.createTask({
        version: COMPUTE_TASK_REQUEST_VERSION,
        owner: {
          contractVersion: COMPUTE_TASK_OWNER_CONTRACT_VERSION,
          datasetHash: task.owner.datasetHash,
          specHash: task.owner.specHash,
          runId: task.owner.runId,
          taskId: task.owner.taskId,
        },
        taskKind: task.kind,
        input: executionObject.descriptor,
        deadlineAtMs: task.deadlineEpochMilliseconds,
        expiresAtMs: authorizedJob.expiresAtMs,
      });
    } catch (error) {
      if (error instanceof ComputeServiceCoreError) throw mapCoreError(error);
      throw error;
    }

    let bound: ComputeHttpJobRecordV1 | null = null;
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const current = await this.#requireJob(authorizedJob.jobId);
      if (current.executeRequestFingerprint !== undefined) {
        if (current.executeRequestFingerprint !== requestFingerprint) {
          httpError("IDEMPOTENCY_CONFLICT", 409, "Concurrent execute bound another immutable task.");
        }
        bound = current;
        break;
      }
      const next: ComputeHttpJobRecordV1 = cloneFrozen({
        ...current,
        revision: current.revision + 1,
        updatedAtMs: now,
        owner: task.owner,
        taskKind: task.kind,
        coreTaskId: task.owner.taskId,
        executionObjectKey,
        executeIdempotencyHash: idempotencyHash,
        executeRequestFingerprint: requestFingerprint,
      });
      const changed = await this.#infrastructure.repository.compareAndSet(
        current.jobId,
        current.revision,
        next,
      );
      if (!changed.applied) continue;
      bound = changed.record;
      break;
    }
    if (bound === null) {
      httpError("INTERNAL_ERROR", 500, "Activated execute binding exceeded the CAS limit.");
    }
    const snapshot = await this.#statusSnapshot(bound);
    await this.#publishStatus(snapshot.status);
    return this.#json(202, snapshot.status, context);
  }

  async #result(
    job: ComputeHttpJobRecordV1,
    context: RequestContext,
  ): Promise<Response> {
    const snapshot = await this.#statusSnapshot(job);
    await this.#publishStatus(snapshot.status);
    if (
      snapshot.status.state !== "SUCCEEDED" ||
      snapshot.core?.result === undefined
    ) {
      httpError("RESULT_NOT_READY", 409, "No successful result is available.");
    }
    const object = snapshot.core.result.object;
    if (object.byteLength < 1) {
      httpError("RESULT_CHECKSUM_MISMATCH", 500, "Published result is empty.");
    }
    const stored = await this.#infrastructure.objectStore.head(object.key);
    if (stored === null || !descriptorsEqual(stored, object)) {
      httpError(
        "RESULT_CHECKSUM_MISMATCH",
        500,
        "Published result object does not match its checksum receipt.",
      );
    }
    const urls = await this.#infrastructure.objectUrls.createResultReference({
      jobId: job.jobId,
      object,
      expiresAtMs: job.expiresAtMs,
    });
    const response: AnalysisJobResultReferenceV1 = {
      schemaVersion: "3dena.job-result-reference.v1",
      jobId: job.jobId,
      sha256: object.sha256,
      byteLength: object.byteLength,
      resultUrl: assertSafeAbsoluteUrl(urls.resultUrl, "result URL"),
      exportUrl:
        urls.exportUrl === null
          ? null
          : assertSafeAbsoluteUrl(urls.exportUrl, "export URL"),
      expiresAt: isoTimestamp(job.expiresAtMs),
    };
    return this.#json(200, response, context, {
      "x-3dena-result-sha256": object.sha256,
    });
  }

  async #artifact(
    job: ComputeHttpJobRecordV1,
    context: RequestContext,
  ): Promise<Response> {
    const snapshot = await this.#statusSnapshot(job);
    if (
      snapshot.status.state !== "SUCCEEDED" ||
      snapshot.core?.result === undefined
    ) {
      httpError("RESULT_NOT_READY", 409, "No successful result is available.");
    }
    const descriptor = snapshot.core.result.object;
    const [head, bytes] = await Promise.all([
      this.#infrastructure.objectStore.head(descriptor.key),
      this.#infrastructure.objectStore.get(descriptor.key),
    ]);
    if (
      head === null ||
      bytes === null ||
      !descriptorsEqual(head, descriptor) ||
      bytes.byteLength !== descriptor.byteLength ||
      sha256Bytes(bytes) !== descriptor.sha256
    ) {
      httpError("RESULT_CHECKSUM_MISMATCH", 500, "Result bytes do not match their receipt.");
    }
    const responseBytes = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(responseBytes).set(bytes);
    return new Response(responseBytes, {
      status: 200,
      headers: this.#responseHeaders(context, {
        "content-type": "application/json; charset=utf-8",
        "content-length": String(bytes.byteLength),
        "content-disposition": `attachment; filename="3dena-result-${descriptor.sha256.slice(0, 12)}.json"`,
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
        "x-3dena-result-sha256": descriptor.sha256,
      }),
    });
  }

  async #deleteJob(
    request: Request,
    job: ComputeHttpJobRecordV1,
    context: RequestContext,
  ): Promise<Response> {
    const idempotencyKey = this.#requireIdempotencyKey(request);
    const idempotencyHash = this.#infrastructure.capabilityCodec.hashSecret(
      `delete\0${job.jobId}\0${idempotencyKey}`,
    );
    const before = await this.#statusSnapshot(job);
    let pendingTermination = false;
    let resultKeys: readonly string[] = [];
    if (job.coreTaskId !== undefined) {
      const currentCore = await this.#core.getTask(job.coreTaskId);
      resultKeys = currentCore?.ownedResultObjectKeys ?? [];
      const deletion = await this.#core.deleteTask(job.coreTaskId);
      pendingTermination = deletion.status === "pending_termination";
      resultKeys = deletion.record.ownedResultObjectKeys;
    }

    if (
      job.inputObjectOwnedByJob === false &&
      job.activatedDatasetId !== undefined &&
      job.activationReceiptSha256 !== undefined
    ) {
      await this.#requireDatasetService().deleteActivated(
        job.activatedDatasetId,
        job.activationReceiptSha256,
      );
    }
    const inputKeys = [
      job.inputObjectOwnedByJob === false ? undefined : job.inputObjectKey,
      job.executionObjectKey,
    ].filter(
      (key): key is string => key !== undefined,
    );
    for (const key of [...inputKeys, ...resultKeys]) {
      await this.#infrastructure.objectStore.delete(key);
    }
    for (const key of [...inputKeys, ...resultKeys]) {
      if ((await this.#infrastructure.objectStore.head(key)) !== null) {
        httpError("INTERNAL_ERROR", 500, "Deletion was not observed in object storage.");
      }
    }
    const now = this.#infrastructure.clock.now();
    const updated = await this.#patchJob(job.jobId, (current) => ({
      ...current,
      revision: current.revision + 1,
      updatedAtMs: now,
      inputDeletedAtMs: current.inputDeletedAtMs ?? now,
      deleteIdempotencyHash: current.deleteIdempotencyHash ?? idempotencyHash,
      deleteRequestedAtMs: current.deleteRequestedAtMs ?? now,
      deleteCancelled:
        current.deleteCancelled ??
        (before.status.state !== "SUCCEEDED" && before.status.state !== "FAILED"),
    }));
    const after = await this.#statusSnapshot(updated);
    await this.#publishStatus(after.status);
    const receipt: AnalysisDeletionReceiptV1 = {
      schemaVersion: "3dena.job-deletion-receipt.v1",
      jobId: job.jobId,
      cancelled: updated.deleteCancelled ?? false,
      inputDeleted: true,
      resultDeleted: true,
      deletedAt: isoTimestamp(updated.deleteRequestedAtMs ?? now),
    };
    return this.#json(pendingTermination ? 202 : 200, receipt, context);
  }

  async #events(
    request: Request,
    job: ComputeHttpJobRecordV1,
    context: RequestContext,
  ): Promise<Response> {
    const accept = request.headers.get("accept") ?? "";
    if (!accept.toLocaleLowerCase("en-US").includes("text/event-stream")) {
      httpError("UNSUPPORTED_MEDIA_TYPE", 406, "SSE endpoint requires text/event-stream.");
    }
    const lastEventId = request.headers.get("last-event-id");
    let afterSequence = 0;
    if (lastEventId !== null) {
      if (!/^(?:0|[1-9][0-9]{0,14})$/u.test(lastEventId)) {
        httpError("INVALID_REQUEST", 400, "Last-Event-ID is invalid.");
      }
      afterSequence = Number(lastEventId);
      if (!Number.isSafeInteger(afterSequence)) {
        httpError("INVALID_REQUEST", 400, "Last-Event-ID exceeds safe range.");
      }
    }
    const snapshot = await this.#statusSnapshot(job);
    await this.#publishStatus(snapshot.status);

    const abortController = new AbortController();
    const abort = (): void => abortController.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    const iterator = this.#infrastructure.events
      .subscribe(job.jobId, afterSequence, abortController.signal)
      [Symbol.asyncIterator]();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(
          encoder.encode(
            `id: ${next.value.sequence}\nevent: progress\ndata: ${JSON.stringify(next.value)}\n\n`,
          ),
        );
        if (TERMINAL_REMOTE_STATES.has(next.value.state)) {
          abortController.abort();
          await iterator.return?.();
          request.signal.removeEventListener("abort", abort);
          controller.close();
        }
      },
      async cancel() {
        abortController.abort();
        await iterator.return?.();
        request.signal.removeEventListener("abort", abort);
      },
    });
    return new Response(stream, {
      status: 200,
      headers: this.#responseHeaders(context, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      }),
    });
  }

  async #statusSnapshot(
    initialJob: ComputeHttpJobRecordV1,
  ): Promise<StatusSnapshot> {
    let job = initialJob;
    let core =
      job.coreTaskId === undefined
        ? null
        : await this.#core.getTask(job.coreTaskId);
    if (job.coreTaskId !== undefined && core === null) {
      httpError("INTERNAL_ERROR", 500, "Bound core task is missing.");
    }
    const now = this.#infrastructure.clock.now();
    const uploadedObject =
      job.inputDeletedAtMs === undefined && job.sourceResultHash === undefined
        ? await this.#infrastructure.objectStore.head(job.inputObjectKey)
        : null;
    let uploaded = job.sourceResultHash !== undefined;
    if (uploadedObject !== null) {
      const expected = {
        key: job.inputObjectKey,
        sha256: job.dataset.sha256,
        byteLength: job.dataset.byteLength,
      };
      if (!descriptorsEqual(uploadedObject, expected)) {
        httpError(
          "DATASET_RECEIPT_MISMATCH",
          409,
          "Stored upload does not match its reservation.",
        );
      }
      uploaded = true;
    }
    const state = publicState(job, core, uploaded, now);
    if (
      job.inputDeletedAtMs === undefined &&
      (TERMINAL_REMOTE_STATES.has(state) || state === "CANCEL_REQUESTED")
    ) {
      job = await this.#deleteOwnedInputs(job);
      core =
        job.coreTaskId === undefined
          ? null
          : await this.#core.getTask(job.coreTaskId);
    }
    const updatedAtMs = Math.max(job.updatedAtMs, core?.updatedAtMs ?? 0);
    const status: AnalysisJobStatusV1 = {
      schemaVersion: "3dena.job-status.v1",
      jobId: job.jobId,
      state,
      owner: job.owner ?? null,
      progress: progressForState(state),
      createdAt: isoTimestamp(job.createdAtMs),
      updatedAt: isoTimestamp(updatedAtMs),
      expiresAt: isoTimestamp(job.expiresAtMs),
      resultAvailable: state === "SUCCEEDED" && core?.result !== undefined,
      errorCode: taskFailureCode(core),
    };
    return Object.freeze({ job, core, status: cloneFrozen(status) });
  }

  async #deleteOwnedInputs(
    job: ComputeHttpJobRecordV1,
  ): Promise<ComputeHttpJobRecordV1> {
    if (
      job.inputObjectOwnedByJob === false &&
      job.activatedDatasetId !== undefined &&
      job.activationReceiptSha256 !== undefined
    ) {
      await this.#requireDatasetService().deleteActivated(
        job.activatedDatasetId,
        job.activationReceiptSha256,
      );
    }
    const keys = [
      job.inputObjectOwnedByJob === false ? undefined : job.inputObjectKey,
      job.executionObjectKey,
    ].filter(
      (key): key is string => key !== undefined,
    );
    for (const key of keys) await this.#infrastructure.objectStore.delete(key);
    for (const key of keys) {
      if ((await this.#infrastructure.objectStore.head(key)) !== null) {
        httpError("INTERNAL_ERROR", 500, "Input deletion was not observed.");
      }
    }
    const now = this.#infrastructure.clock.now();
    return this.#patchJob(job.jobId, (current) => {
      if (current.inputDeletedAtMs !== undefined) return current;
      return {
        ...current,
        revision: current.revision + 1,
        updatedAtMs: now,
        inputDeletedAtMs: now,
      };
    });
  }

  async #publishStatus(status: AnalysisJobStatusV1): Promise<void> {
    const progress = status.progress ?? {
      phase: status.state.toLocaleLowerCase("en-US"),
      completed: TERMINAL_REMOTE_STATES.has(status.state) ? 1 : 0,
      total: 1,
    };
    await this.#infrastructure.events.publish(status.jobId, {
      state: status.state,
      phase: progress.phase,
      completed: progress.completed,
      total: progress.total,
      emittedAt: status.updatedAt,
    });
  }

  async #authorize(
    request: Request,
    jobId: string,
    origin: string | null,
    allowExpired: boolean,
  ): Promise<ComputeHttpJobRecordV1> {
    const authorization = request.headers.get("authorization");
    const match = authorization === null
      ? null
      : /^Bearer ([A-Za-z0-9_-]{16,512})$/u.exec(authorization);
    if (match?.[1] === undefined) {
      httpError("INVALID_AUTHORIZATION", 401, "Bearer capability is missing or malformed.");
    }
    const job = await this.#infrastructure.repository.get(jobId);
    if (
      job === null ||
      !this.#infrastructure.capabilityCodec.verify(
        match[1],
        job.capabilityHash,
      )
    ) {
      httpError("UNAUTHORIZED", 401, "Job capability is invalid.");
    }
    if (job.boundOrigin !== origin) {
      httpError("UNAUTHORIZED", 401, "Job capability is not valid for this origin.");
    }
    if (!allowExpired && this.#infrastructure.clock.now() >= job.expiresAtMs) {
      httpError("JOB_EXPIRED", 410, "Job capability has expired.");
    }
    return job;
  }

  #requireDatasetService(): NonNullable<ComputeHttpRouterInfrastructure["datasetWorkflow"]> {
    const service = this.#infrastructure.datasetWorkflow;
    if (service === undefined) {
      httpError("NOT_READY", 503, "Dataset workflow service is unavailable.");
    }
    return service;
  }

  #bearerToken(request: Request): string {
    const authorization = request.headers.get("authorization");
    const match = authorization === null
      ? null
      : /^Bearer ([A-Za-z0-9_-]{16,512})$/u.exec(authorization);
    if (match?.[1] === undefined) {
      httpError("INVALID_AUTHORIZATION", 401, "Bearer capability is missing or malformed.");
    }
    return match[1];
  }

  async #authorizeDataset(
    request: Request,
    datasetId: string,
    origin: string | null,
  ) {
    const session = await this.#requireDatasetService().authorize(
      datasetId,
      this.#bearerToken(request),
      origin,
    );
    if (session === null) {
      httpError("UNAUTHORIZED", 401, "Dataset capability is invalid or expired.");
    }
    return session;
  }

  async #requireJob(jobId: string): Promise<ComputeHttpJobRecordV1> {
    const job = await this.#infrastructure.repository.get(jobId);
    if (job === null) httpError("INTERNAL_ERROR", 500, "HTTP job record is missing.");
    return job;
  }

  async #patchJob(
    jobId: string,
    patch: (record: ComputeHttpJobRecordV1) => ComputeHttpJobRecordV1,
  ): Promise<ComputeHttpJobRecordV1> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const current = await this.#requireJob(jobId);
      const next = cloneFrozen(patch(current));
      if (next === current || next.revision === current.revision) return current;
      const changed = await this.#infrastructure.repository.compareAndSet(
        jobId,
        current.revision,
        next,
      );
      if (!changed.applied) continue;
      return changed.record;
    }
    httpError("INTERNAL_ERROR", 500, "HTTP job update exceeded the CAS limit.");
  }

  #assertCorsOrigin(origin: string | null): void {
    if (origin === null) return;
    if (origin === "null" || !this.#allowedOrigins.has(origin)) {
      httpError("CORS_ORIGIN_DENIED", 403, "Request origin is not allowed.");
    }
  }

  #preflight(request: Request, context: RequestContext): Response {
    if (context.origin === null) {
      httpError("CORS_ORIGIN_DENIED", 403, "CORS preflight requires an Origin.");
    }
    const method = request.headers.get("access-control-request-method")?.toUpperCase();
    if (method === undefined || !HTTP_ALLOWED_METHODS.includes(method)) {
      httpError("METHOD_NOT_ALLOWED", 405, "Preflight method is not allowed.");
    }
    const requestedHeaders = (request.headers.get(
      "access-control-request-headers",
    ) ?? "")
      .split(",")
      .map((header) => header.trim().toLocaleLowerCase("en-US"))
      .filter((header) => header !== "");
    if (requestedHeaders.some((header) => !CORS_ALLOWED_HEADERS.has(header))) {
      httpError("CORS_ORIGIN_DENIED", 403, "Preflight header is not allowed.");
    }
    return new Response(null, {
      status: 204,
      headers: this.#responseHeaders(context, {
        "access-control-allow-methods": HTTP_ALLOWED_METHODS.join(", "),
        "access-control-allow-headers": [...CORS_ALLOWED_HEADERS].sort().join(", "),
        "access-control-max-age": "600",
        vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
      }),
    });
  }

  #assertContract(request: Request): void {
    if (
      request.headers.get("x-3dena-contract-version") !==
      ANALYSIS_CONTRACT_VERSION_V1
    ) {
      httpError(
        "UNSUPPORTED_CONTRACT_VERSION",
        406,
        "Request contract version is not supported.",
      );
    }
  }

  #assertMethod(actual: string, allowed: readonly string[]): void {
    if (!allowed.includes(actual)) {
      httpError("METHOD_NOT_ALLOWED", 405, "HTTP method is not allowed for route.");
    }
  }

  #requireIdempotencyKey(request: Request): string {
    const value = request.headers.get("idempotency-key");
    if (value === null || !IDEMPOTENCY_KEY.test(value)) {
      httpError(
        "INVALID_IDEMPOTENCY_KEY",
        400,
        "Idempotency key must contain 8-200 visible characters.",
      );
    }
    return value;
  }

  #assertNoBody(request: Request): void {
    const contentLength = request.headers.get("content-length");
    if (
      request.body !== null ||
      (contentLength !== null && contentLength !== "0")
    ) {
      httpError(
        "INVALID_REQUEST",
        400,
        "GET and DELETE routes do not accept request bodies.",
      );
    }
  }

  async #parseJson(request: Request): Promise<unknown> {
    const contentType = request.headers.get("content-type") ?? "";
    if (!JSON_CONTENT_TYPE.test(contentType)) {
      httpError("UNSUPPORTED_MEDIA_TYPE", 415, "Request body must be JSON UTF-8.");
    }
    const contentLength = request.headers.get("content-length");
    let declaredLength: number | null = null;
    if (contentLength !== null) {
      if (!/^(?:0|[1-9][0-9]{0,14})$/u.test(contentLength)) {
        httpError("INVALID_REQUEST", 400, "Content-Length is malformed.");
      }
      const declared = Number(contentLength);
      if (!Number.isSafeInteger(declared) || declared > this.#maxJsonBodyBytes) {
        httpError("PAYLOAD_TOO_LARGE", 413, "JSON body exceeds configured limit.");
      }
      declaredLength = declared;
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > this.#maxJsonBodyBytes) {
      httpError("PAYLOAD_TOO_LARGE", 413, "JSON body exceeds configured limit.");
    }
    if (declaredLength !== null && declaredLength !== bytes.byteLength) {
      httpError("INVALID_REQUEST", 400, "Content-Length does not match the JSON body.");
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      httpError("INVALID_REQUEST", 400, "JSON body is not valid UTF-8.");
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      httpError("INVALID_REQUEST", 400, "JSON body is malformed.");
    }
  }

  async #parseRawDataset(request: Request, expectedBytes: number): Promise<Uint8Array> {
    if (request.headers.get("content-type") !== "application/octet-stream") {
      httpError("UNSUPPORTED_MEDIA_TYPE", 415, "Dataset content must be application/octet-stream.");
    }
    const contentLength = request.headers.get("content-length");
    if (contentLength !== null) {
      if (!/^[1-9][0-9]{0,14}$/u.test(contentLength) || Number(contentLength) !== expectedBytes) {
        httpError("DATASET_RECEIPT_MISMATCH", 409, "Dataset Content-Length does not match preflight.");
      }
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAX_DATASET_BYTES) {
      httpError("PAYLOAD_TOO_LARGE", 413, "Dataset content exceeds configured limit.");
    }
    if (bytes.byteLength !== expectedBytes) {
      httpError("DATASET_RECEIPT_MISMATCH", 409, "Dataset bytes do not match preflight length.");
    }
    return bytes;
  }

  #publicBuildIdentity(): Readonly<{
    approvalManifestSha256: string;
    releaseId: string;
    gitCommit: string;
    flyImageDigest: string;
    flyBuildId: string;
    role: "api";
    contractVersions: string[];
  }> {
    return {
      approvalManifestSha256: this.#buildIdentity.approvalManifestSha256,
      releaseId: this.#buildIdentity.releaseId,
      gitCommit: this.#buildIdentity.gitCommit,
      flyImageDigest: this.#buildIdentity.flyImageDigest,
      flyBuildId: this.#buildIdentity.flyBuildId,
      role: "api",
      contractVersions: [...new Set([
        ANALYSIS_CONTRACT_VERSION_V1,
        COMPUTE_HTTP_CONTRACT_VERSION,
        ...this.#buildIdentity.contractVersions,
      ])].sort(),
    };
  }

  #json(
    status: number,
    body: unknown,
    context: RequestContext,
    extraHeaders: Readonly<Record<string, string>> = {},
  ): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: this.#responseHeaders(context, {
        "content-type": "application/json; charset=utf-8",
        ...extraHeaders,
      }),
    });
  }

  #responseHeaders(
    context: RequestContext,
    values: Readonly<Record<string, string>>,
  ): Headers {
    const headers = new Headers({
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-request-id": context.requestId,
      "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
      vary: "Origin",
      ...values,
    });
    if (context.origin !== null && this.#allowedOrigins.has(context.origin)) {
      headers.set("access-control-allow-origin", context.origin);
      headers.set(
        "access-control-expose-headers",
        "x-request-id, x-3dena-contract-version, x-3dena-result-sha256",
      );
    }
    return headers;
  }
}
