import {
  assertAnalysisResultEnvelopeV1,
  assertDatasetReceiptV1,
  type AnalysisResult,
  type AnalysisResultEnvelopeV1,
  type AnalysisTaskResultV1,
  type DatasetLimitsReceiptV1,
  type DatasetReceiptV1,
  type DatasetSchemaV1,
  type PreparedSpaceResult,
  type RawScalar,
} from "@3dena/analysis";
import type {
  RunOwner,
} from "@/lib/worker-protocol";

export type DerivedTaskKind =
  | "network-comparison"
  | "change-network"
  | "statistics";

export interface RawComparisonIntent {
  kind: "network-comparison";
  groups: [string, string];
}

export interface RawChangeIntent {
  kind: "change-network";
  field: string;
  level: string;
}

export interface RawStatisticsIntent {
  kind: "statistics";
  design: "independent" | "paired";
  groups: [string, string];
  dimensions: string[];
  alternative: "two-sided" | "greater" | "less";
  adjustment: "none" | "holm" | "bh" | "bonferroni";
  samePhysicalEntityConfirmed: boolean;
}

export type RawDerivedIntent =
  | RawComparisonIntent
  | RawChangeIntent
  | RawStatisticsIntent;

export interface PreparedComparisonIntent {
  kind: "network-comparison";
  groups: [string, string];
}

export interface PreparedChangeIntent {
  kind: "change-network";
  field: string;
  level: RawScalar;
}

export interface PreparedStatisticsIntent {
  kind: "statistics";
  design: "independent" | "paired";
  groups: [string, string];
  dimensions: string[];
  alternative: "two-sided" | "greater" | "less";
  adjustment: "none" | "holm" | "bh" | "bonferroni";
  samePhysicalEntityConfirmed: boolean;
}

export type PreparedDerivedIntent =
  | PreparedComparisonIntent
  | PreparedChangeIntent
  | PreparedStatisticsIntent;

export interface DerivedTaskOwner extends RunOwner {
  taskId: string;
}

export interface RawDerivedWorkerRequest {
  v: 1;
  kind: "execute-raw-derived";
  owner: DerivedTaskOwner;
  buildId: string;
  source: {
    name: string;
    byteLength: number;
    rows: number;
    columns: number;
    schema: DatasetSchemaV1;
    limits: DatasetLimitsReceiptV1;
    result: AnalysisResult;
  };
  intent: RawDerivedIntent;
}

export interface PreparedDerivedWorkerRequest {
  v: 1;
  kind: "execute-prepared-derived";
  owner: DerivedTaskOwner;
  buildId: string;
  source: {
    receipt: DatasetReceiptV1;
    result: PreparedSpaceResult;
  };
  intent: PreparedDerivedIntent;
}

export type DerivedAnalysisWorkerRequest =
  | RawDerivedWorkerRequest
  | PreparedDerivedWorkerRequest;

export interface RawDerivedWorkerResult {
  type: "raw-derived-result";
  owner: DerivedTaskOwner;
  envelope: AnalysisResultEnvelopeV1<AnalysisTaskResultV1>;
}

export interface PreparedDerivedWorkerResult {
  type: "prepared-derived-result";
  owner: DerivedTaskOwner;
  envelope: AnalysisResultEnvelopeV1<AnalysisTaskResultV1>;
}

export interface DerivedWorkerError {
  type: "derived-error";
  owner: DerivedTaskOwner;
  code: string;
  message: string;
}

export type DerivedAnalysisWorkerResponse =
  | RawDerivedWorkerResult
  | PreparedDerivedWorkerResult
  | DerivedWorkerError;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function validOwner(value: unknown): value is DerivedTaskOwner {
  return isRecord(value)
    && isHash(value.datasetHash)
    && isHash(value.specHash)
    && typeof value.runId === "string"
    && value.runId.length > 0
    && typeof value.taskId === "string"
    && value.taskId.length > 0;
}

function validPair(value: unknown): value is [string, string] {
  return Array.isArray(value)
    && value.length === 2
    && typeof value[0] === "string"
    && value[0].length > 0
    && typeof value[1] === "string"
    && value[1].length > 0
    && value[0] !== value[1];
}

function validDimensions(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((dimension) => typeof dimension === "string" && dimension.length > 0)
    && new Set(value).size === value.length;
}

function validRawSource(value: unknown): value is RawDerivedWorkerRequest["source"] {
  if (!isRecord(value)
    || typeof value.name !== "string"
    || value.name.length === 0
    || !Number.isSafeInteger(value.byteLength)
    || Number(value.byteLength) < 1
    || !Number.isSafeInteger(value.rows)
    || Number(value.rows) < 1
    || !Number.isSafeInteger(value.columns)
    || Number(value.columns) < 1
    || !isRecord(value.schema)
    || value.schema.schemaVersion !== "3dena.dataset-schema.v1"
    || !Array.isArray(value.schema.headers)
    || !Array.isArray(value.schema.columns)
    || value.schema.headers.length !== value.columns
    || value.schema.columns.length !== value.columns
    || !isRecord(value.limits)
    || value.limits.schemaVersion !== "3dena.dataset-limits.v1"
    || !isRecord(value.result)
    || value.result.schemaVersion !== "3dena.analysis-result.v1") {
    return false;
  }

  const limits = value.limits;
  const positiveLimitFields = [
    "maxFileBytes",
    "maxWorksheets",
    "maxRows",
    "maxColumns",
    "maxCells",
  ] as const;
  if (positiveLimitFields.some((field) =>
    !Number.isSafeInteger(limits[field]) || Number(limits[field]) < 1)) {
    return false;
  }
  const cells = Number(value.rows) * Number(value.columns);
  return Number(value.byteLength) <= Number(limits.maxFileBytes)
    && Number(value.rows) <= Number(limits.maxRows)
    && Number(value.columns) <= Number(limits.maxColumns)
    && Number.isSafeInteger(cells)
    && cells <= Number(limits.maxCells);
}

function validRawIntent(value: unknown): value is RawDerivedIntent {
  if (!isRecord(value)) return false;
  if (value.kind === "network-comparison") return validPair(value.groups);
  if (value.kind === "change-network") {
    return typeof value.field === "string"
      && value.field.length > 0
      && typeof value.level === "string";
  }
  return value.kind === "statistics"
    && (value.design === "independent" || value.design === "paired")
    && validPair(value.groups)
    && validDimensions(value.dimensions)
    && ["two-sided", "greater", "less"].includes(String(value.alternative))
    && ["none", "holm", "bh", "bonferroni"].includes(String(value.adjustment))
    && typeof value.samePhysicalEntityConfirmed === "boolean"
    && (value.design === "paired"
      ? value.samePhysicalEntityConfirmed === true
      : value.samePhysicalEntityConfirmed === false);
}

function validPreparedIntent(value: unknown): value is PreparedDerivedIntent {
  if (!isRecord(value)) return false;
  if (value.kind === "network-comparison") return validPair(value.groups);
  if (value.kind === "change-network") {
    return typeof value.field === "string"
      && value.field.length > 0
      && (value.level === null
        || typeof value.level === "string"
        || typeof value.level === "boolean"
        || (typeof value.level === "number" && Number.isFinite(value.level)));
  }
  return value.kind === "statistics"
    && (value.design === "independent" || value.design === "paired")
    && validPair(value.groups)
    && validDimensions(value.dimensions)
    && ["two-sided", "greater", "less"].includes(String(value.alternative))
    && ["none", "holm", "bh", "bonferroni"].includes(String(value.adjustment))
    && typeof value.samePhysicalEntityConfirmed === "boolean"
    && (value.design === "paired"
      ? value.samePhysicalEntityConfirmed === true
      : value.samePhysicalEntityConfirmed === false);
}

const PREPARED_DATASET_LIMITS: DatasetLimitsReceiptV1 = Object.freeze({
  schemaVersion: "3dena.dataset-limits.v1",
  maxFileBytes: 5 * 1024 * 1024,
  maxWorksheets: 32,
  maxRows: 100_000,
  maxColumns: 256,
  maxCells: 5_000_000,
});

/**
 * Binds the prepared task to the exact validated upload while describing the
 * immutable full-space coordinate table consumed by the task executor.
 */
export function createPreparedDatasetReceipt(
  result: PreparedSpaceResult,
): DatasetReceiptV1 {
  const headers = [...result.fullSpace.dimensions];
  return {
    schemaVersion: "3dena.dataset-receipt.v1",
    sha256: result.sourceReceipt.sha256,
    byteLength: result.sourceReceipt.byteLength,
    format: "ena3d-json",
    sheet: null,
    rows: result.fullSpace.points.length,
    columns: headers.length,
    schema: {
      schemaVersion: "3dena.dataset-schema.v1",
      headers,
      columns: headers.map((name) => ({
        name,
        inferredType: "number",
        roles: ["unmapped"],
      })),
    },
    limits: { ...PREPARED_DATASET_LIMITS },
    warnings: [],
    activationIdentity: `prepared:${result.sourceReceipt.sha256}`,
  };
}

function validPreparedSource(
  value: unknown,
  owner: DerivedTaskOwner,
): value is PreparedDerivedWorkerRequest["source"] {
  if (!isRecord(value) || !isRecord(value.result)) return false;
  const result = value.result;
  if (
    result.schemaVersion !== "3dena.prepared-space-result.v1"
    || result.sourceKind !== "prepared-exchange"
    || result.rawJenaRecompute !== false
    || !isRecord(result.sourceReceipt)
    || !isRecord(result.fullSpace)
    || !Array.isArray(result.fullSpace.dimensions)
    || !Array.isArray(result.fullSpace.points)
  ) return false;
  try {
    assertDatasetReceiptV1(value.receipt, "request.source.receipt");
  } catch {
    return false;
  }
  const receipt = value.receipt as DatasetReceiptV1;
  const expected = createPreparedDatasetReceipt(result as unknown as PreparedSpaceResult);
  return owner.datasetHash === receipt.sha256
    && receipt.sha256 === result.sourceReceipt.sha256
    && receipt.byteLength === result.sourceReceipt.byteLength
    && JSON.stringify(receipt) === JSON.stringify(expected);
}

export function isDerivedAnalysisWorkerRequest(
  value: unknown,
): value is DerivedAnalysisWorkerRequest {
  if (!isRecord(value) || value.v !== 1 || !validOwner(value.owner)) return false;
  if (value.kind === "execute-raw-derived") {
    return typeof value.buildId === "string"
      && value.buildId.length > 0
      && validRawSource(value.source)
      && validRawIntent(value.intent);
  }
  return value.kind === "execute-prepared-derived"
    && typeof value.buildId === "string"
    && value.buildId.length > 0
    && validPreparedSource(value.source, value.owner)
    && validPreparedIntent(value.intent);
}

function sameOwner(
  envelopeOwner: AnalysisResultEnvelopeV1["owner"],
  responseOwner: DerivedTaskOwner,
): boolean {
  return envelopeOwner.datasetHash === responseOwner.datasetHash
    && envelopeOwner.specHash === responseOwner.specHash
    && envelopeOwner.runId === responseOwner.runId
    && envelopeOwner.taskId === responseOwner.taskId;
}

export function isDerivedAnalysisWorkerResponse(
  value: unknown,
): value is DerivedAnalysisWorkerResponse {
  if (!isRecord(value) || !validOwner(value.owner)) return false;
  if (value.type === "derived-error") {
    return typeof value.code === "string"
      && value.code.length > 0
      && typeof value.message === "string"
      && value.message.length > 0;
  }
  if (value.type !== "raw-derived-result" && value.type !== "prepared-derived-result") {
    return false;
  }
  try {
    assertAnalysisResultEnvelopeV1(value.envelope, "response.envelope");
  } catch {
    return false;
  }
  const envelope = value.envelope as AnalysisResultEnvelopeV1<AnalysisTaskResultV1>;
  if (!sameOwner(envelope.owner, value.owner)) return false;
  if (value.type === "prepared-derived-result") {
    return envelope.provenance.sourceKind === "prepared-exchange"
      && envelope.provenance.jenaExecuted === false
      && envelope.evidence.status === "IMPLEMENTED_UNVERIFIED"
      && envelope.evidence.approvedForParity === false;
  }
  return envelope.provenance.sourceKind === "raw-jena"
    && envelope.provenance.jenaExecuted === true;
}
