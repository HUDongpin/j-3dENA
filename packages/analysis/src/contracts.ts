import type {
  AnalysisDiagnostic,
  AnalyzeRowsInput,
  CohortPolicy,
  ENAModel,
  ENAWeight,
  ENAWindow,
  RawScalar,
} from "./types";
import type { TrajectoryTimeValueV1 } from "@3dena/trajectory";
import type { PreparedSpaceMapping } from "./prepared-types";
import { assertPreparedDerivedSource } from "./prepared-derived";

import {
  ANALYSIS_EXECUTION_DATASET_V2_SCHEMA,
  RESULT_VARIANT_SCHEMAS_V1,
} from "./scientific-result-schemas";

export const ANALYSIS_CONTRACT_VERSION_V1 = "3dena.contract.v1" as const;
export const DATASET_RECEIPT_VERSION_V1 = "3dena.dataset-receipt.v1" as const;
export const ANALYSIS_TASK_VERSION_V1 = "3dena.analysis-task.v1" as const;
export const RESULT_ENVELOPE_VERSION_V1 = "3dena.analysis-result-envelope.v1" as const;
export const PROVENANCE_MANIFEST_VERSION_V1 = "3dena.provenance-manifest.v1" as const;

export const RESULT_SCHEMA_VERSION_BY_TASK_KIND_V1 = Object.freeze({
  "ena-model": "3dena.analysis-result.v1",
  "prepared-import": "3dena.prepared-space-result.v1",
  "network-comparison": "3dena.network-comparison.v1",
  "change-network": "3dena.change-network.v1",
  statistics: "3dena.statistics-task-result.v1",
  trajectory: "3dena.trajectory-dynamics.v1",
  "trajectory-comparison": "3dena.trajectory-comparison.v1",
  bootstrap: "3dena.trajectory-bootstrap.v1",
} as const);

export type DurationUnitV1 =
  | "nanoseconds"
  | "microseconds"
  | "milliseconds"
  | "seconds"
  | "minutes"
  | "hours"
  | "days";

/** JSON-safe scalar representation for scientific identities and metadata. */
export type TypedScalarV1 =
  | { type: "null" }
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "int64"; value: string }
  | { type: "double"; ieee754Hex: string }
  | { type: "date"; value: string }
  | {
      type: "instant";
      epochMilliseconds: string;
      timeZone: string;
      offsetMinutes: number;
      fold: 0 | 1;
    }
  | { type: "duration"; value: string; unit: DurationUnitV1 }
  | { type: "factor"; value: string; levels: string[]; ordered: boolean };

export interface TypedKeyComponentV1 {
  name: string;
  value: TypedScalarV1;
}

export interface TypedKeyV1 {
  schemaVersion: "3dena.typed-key.v1";
  components: TypedKeyComponentV1[];
  /** Canonical JSON over normalized tagged values; never a display-label join. */
  canonical: string;
}

export type DatasetColumnTypeV1 = "string" | "number" | "boolean" | "mixed" | "null";
export type DatasetColumnRoleV1 = "unit" | "conversation" | "time" | "code" | "group" | "metadata" | "unmapped";

export interface DatasetColumnSchemaV1 {
  name: string;
  inferredType: DatasetColumnTypeV1;
  /** A column can have multiple scientific roles; `unmapped` must stand alone. */
  roles: DatasetColumnRoleV1[];
}

export interface DatasetSchemaV1 {
  schemaVersion: "3dena.dataset-schema.v1";
  headers: string[];
  columns: DatasetColumnSchemaV1[];
}

export interface DatasetLimitsReceiptV1 {
  schemaVersion: "3dena.dataset-limits.v1";
  maxFileBytes: number;
  maxWorksheets: number;
  maxRows: number;
  maxColumns: number;
  maxCells: number;
}

export interface DatasetReceiptV1 {
  schemaVersion: typeof DATASET_RECEIPT_VERSION_V1;
  sha256: string;
  byteLength: number;
  format: "csv" | "xlsx" | "xls" | "ena3d-json";
  sheet: { index: number; name: string } | null;
  rows: number;
  columns: number;
  schema: DatasetSchemaV1;
  limits: DatasetLimitsReceiptV1;
  warnings: string[];
  activationIdentity: string;
}

export interface TaskOwnerV1 {
  contractVersion: typeof ANALYSIS_CONTRACT_VERSION_V1;
  datasetHash: string;
  specHash: string;
  runId: string;
  taskId: string;
}

export interface AnalysisSpecV1 {
  schemaVersion: "3dena.analysis-spec.v1";
  model: ENAModel;
  window: ENAWindow;
  weightBy: ENAWeight;
  windowSizeBack: number;
  windowSizeForward: number;
  centerAlignToOrigin: boolean;
  cohortPolicy: CohortPolicy;
}

export interface DisplaySpecV1 {
  schemaVersion: "3dena.display-spec.v1";
  dimensions: [string, string, string];
  plotDimension: 2 | 3;
  groups?: string[];
  showGrid: boolean;
  showZeroLines: boolean;
  showAxes: boolean;
  traces: {
    points: boolean;
    nodes: boolean;
    network: boolean;
    centroids: boolean;
    /** Legacy saved-display field; accepted on read but ignored by the generic ENA presenter. */
    trajectory: boolean;
    uncertainty: boolean;
  };
  style: {
    pointSize: number;
    pointOpacity: number;
    nodeSize: number;
    nodeOpacity: number;
    edgeThreshold: number;
    edgeWidthScale: number;
    trajectoryWidth: number;
  };
  camera: {
    eye: { x: number; y: number; z: number };
    center: { x: number; y: number; z: number };
    up: { x: number; y: number; z: number };
  } | null;
}

interface AnalysisTaskBaseV1 {
  schemaVersion: typeof ANALYSIS_TASK_VERSION_V1;
  owner: TaskOwnerV1;
  deadlineEpochMilliseconds: number;
}

export interface EnaModelTaskV1 extends AnalysisTaskBaseV1 {
  kind: "ena-model";
  input: AnalyzeRowsInput;
}

/**
 * Internal exact-byte prepared-exchange import. The browser-facing HTTP
 * contract never carries `exactBytesBase64`; the service injects bytes read
 * back from its immutable upload object only after matching the receipt hash.
 */
export interface PreparedImportTaskV1 extends AnalysisTaskBaseV1 {
  kind: "prepared-import";
  input: {
    sourceName: "uploaded.ena3d.json";
    exactBytesBase64: string;
    mapping: PreparedSpaceMapping;
  };
}

export interface NetworkComparisonTaskV1 extends AnalysisTaskBaseV1 {
  kind: "network-comparison";
  sourceResultHash: string;
  groups: [string, string];
}

export interface ChangeNetworkTaskV1 extends AnalysisTaskBaseV1 {
  kind: "change-network";
  sourceResultHash: string;
  field: string;
  level: RawScalar;
}

export interface StatisticsTaskV1 extends AnalysisTaskBaseV1 {
  kind: "statistics";
  sourceResultHash: string;
  design: "independent" | "paired";
  groups: [string, string];
  dimensions: string[];
  alternative: "two-sided" | "greater" | "less";
  adjustment: "none" | "holm" | "bh" | "bonferroni";
  /** Required true for paired work; independent work must set false. */
  samePhysicalEntityConfirmed: boolean;
}

export interface TrajectoryTaskV1 extends AnalysisTaskBaseV1 {
  kind: "trajectory";
  sourceResultHash: string;
  group: string;
  selectedDimensions: [string, string, string];
  cohortPolicy: CohortPolicy;
  /** Exact order and identity binding for every source trajectory period. */
  periods: Array<{
    sourceTimeCanonical: string;
    value: TrajectoryTimeValueV1;
  }>;
  estimand:
    | { kind: "equal-participant-v1" }
    | { kind: "weighted-participant-v1"; metadataField: string };
}

export interface TrajectoryComparisonTaskV1 extends AnalysisTaskBaseV1 {
  kind: "trajectory-comparison";
  sourceResultHash: string;
  design: "independent" | "paired";
  groups: [string, string];
  samePhysicalEntityConfirmed: boolean;
}

export interface BootstrapTaskV1 extends AnalysisTaskBaseV1 {
  kind: "bootstrap";
  sourceResultHash: string;
  group: string;
  replicates: number;
  confidenceLevel: number;
  seed: number;
  interval: "pointwise-percentile-type7";
  rotationPolicy: "fixed-preprojected";
}

export type AnalysisTaskV1 =
  | EnaModelTaskV1
  | PreparedImportTaskV1
  | NetworkComparisonTaskV1
  | ChangeNetworkTaskV1
  | StatisticsTaskV1
  | TrajectoryTaskV1
  | TrajectoryComparisonTaskV1
  | BootstrapTaskV1;

export type EvidenceStatusV1 =
  | "IMPLEMENTED_UNVERIFIED"
  | "PARITY_CANDIDATE"
  | "VERIFIED_PARITY"
  | "PRODUCTION_CANDIDATE"
  | "PRODUCTION_READY"
  | "PRECOMPUTED_COMPATIBILITY_CANDIDATE";

export interface EvidenceStampV1 {
  schemaVersion: "3dena.evidence-stamp.v1";
  scope: "fixture" | "feature" | "build" | "deployment";
  status: EvidenceStatusV1;
  datasetHash?: string;
  specHash?: string;
  fixtureId?: string;
  buildId?: string;
  approvedForParity: boolean;
}

export interface ProvenanceManifestV1 {
  schemaVersion: typeof PROVENANCE_MANIFEST_VERSION_V1;
  datasetHash: string;
  specHash: string;
  resultHash: string;
  adapterVersion: string;
  jenaPackage: "jena-js";
  jenaVersion: string;
  jenaCommit: string;
  sourceKind: "raw-jena" | "prepared-exchange";
  jenaExecuted: boolean;
  sdkPackage: "@3dena/analysis";
  sdkVersion: string;
  appVersion: string;
  contractVersion: typeof ANALYSIS_CONTRACT_VERSION_V1;
  buildId: string;
  seed: number | null;
  toleranceContract: string | null;
  schemaVersions: string[];
  generatedAt: string;
}

export interface AnalysisResultEnvelopeV1<Result = unknown> {
  schemaVersion: typeof RESULT_ENVELOPE_VERSION_V1;
  owner: TaskOwnerV1;
  taskKind: AnalysisTaskV1["kind"];
  result: Result;
  diagnostics: AnalysisDiagnostic[];
  evidence: EvidenceStampV1;
  provenance: ProvenanceManifestV1;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const SIGNED_INTEGER = /^-?(?:0|[1-9][0-9]*)$/u;
const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const HEX_DOUBLE = /^[a-f0-9]{16}$/u;
const DURATION_UNITS = new Set<DurationUnitV1>([
  "nanoseconds",
  "microseconds",
  "milliseconds",
  "seconds",
  "minutes",
  "hours",
  "days"
]);
const TRAJECTORY_DURATION_UNITS = new Set([
  "milliseconds",
  "seconds",
  "minutes",
  "hours",
  "days",
  "weeks"
]);

function contractError(path: string, message: string): never {
  throw new TypeError(`${path}: ${message}`);
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    contractError(path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function exactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  path: string,
): void {
  const allowed = new Set(fields);
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length > 0) {
    contractError(path, `contains unknown field ${JSON.stringify(unknown[0])}`);
  }
  const missing = fields.filter((field) => !Object.hasOwn(value, field));
  if (missing.length > 0) {
    contractError(path, `is missing required field ${JSON.stringify(missing[0])}`);
  }
}

function allowedFields(
  value: Record<string, unknown>,
  allowedFieldsList: readonly string[],
  requiredFieldsList: readonly string[],
  path: string,
): void {
  const allowed = new Set(allowedFieldsList);
  const unknown = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknown.length > 0) contractError(path, `contains unknown field ${JSON.stringify(unknown[0])}`);
  const missing = requiredFieldsList.filter((field) => !Object.hasOwn(value, field));
  if (missing.length > 0) contractError(path, `is missing required field ${JSON.stringify(missing[0])}`);
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") contractError(path, "must be a non-empty string");
  return value;
}

function validateSignedInteger(value: string, path: string): bigint {
  if (!SIGNED_INTEGER.test(value)) contractError(path, "must be a canonical signed decimal integer");
  return BigInt(value);
}

function validateInt64(value: string, path: string): void {
  const parsed = validateSignedInteger(value, path);
  if (parsed < -9_223_372_036_854_775_808n || parsed > 9_223_372_036_854_775_807n) {
    contractError(path, "must fit signed int64");
  }
}

function validateDate(value: string, path: string): void {
  const match = ISO_DATE.exec(value);
  if (!match) contractError(path, "must be an ISO calendar date YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const instant = new Date(0);
  instant.setUTCHours(0, 0, 0, 0);
  instant.setUTCFullYear(year, month - 1, day);
  if (instant.getUTCFullYear() !== year || instant.getUTCMonth() !== month - 1 || instant.getUTCDate() !== day) {
    contractError(path, "must be a real calendar date");
  }
}

function decodeDouble(hex: string): number {
  const bytes = new Uint8Array(8);
  for (let index = 0; index < 8; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return new DataView(bytes.buffer).getFloat64(0, false);
}

/** Encodes the exact IEEE-754 bit pattern, preserving -0 and adjacent doubles. */
export function typedDoubleV1(value: number): TypedScalarV1 {
  if (!Number.isFinite(value)) contractError("value", "double identities must be finite");
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, false);
  const ieee754Hex = [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { type: "double", ieee754Hex };
}

export function assertTypedScalarV1(value: unknown, path = "value"): asserts value is TypedScalarV1 {
  const scalar = objectAt(value, path);
  const type = nonEmptyString(scalar.type, `${path}.type`);
  switch (type) {
    case "null":
      exactFields(scalar, ["type"], path);
      return;
    case "string":
      exactFields(scalar, ["type", "value"], path);
      if (typeof scalar.value !== "string") contractError(`${path}.value`, "must be a string");
      return;
    case "boolean":
      exactFields(scalar, ["type", "value"], path);
      if (typeof scalar.value !== "boolean") contractError(`${path}.value`, "must be boolean");
      return;
    case "int64":
      exactFields(scalar, ["type", "value"], path);
      validateInt64(nonEmptyString(scalar.value, `${path}.value`), `${path}.value`);
      return;
    case "double": {
      exactFields(scalar, ["type", "ieee754Hex"], path);
      const hex = nonEmptyString(scalar.ieee754Hex, `${path}.ieee754Hex`);
      if (!HEX_DOUBLE.test(hex) || !Number.isFinite(decodeDouble(hex))) contractError(`${path}.ieee754Hex`, "must encode one finite IEEE-754 double");
      return;
    }
    case "date":
      exactFields(scalar, ["type", "value"], path);
      validateDate(nonEmptyString(scalar.value, `${path}.value`), `${path}.value`);
      return;
    case "instant":
      exactFields(scalar, ["type", "epochMilliseconds", "timeZone", "offsetMinutes", "fold"], path);
      validateSignedInteger(nonEmptyString(scalar.epochMilliseconds, `${path}.epochMilliseconds`), `${path}.epochMilliseconds`);
      nonEmptyString(scalar.timeZone, `${path}.timeZone`);
      if (!Number.isInteger(scalar.offsetMinutes) || (scalar.offsetMinutes as number) < -1_440 || (scalar.offsetMinutes as number) > 1_440) {
        contractError(`${path}.offsetMinutes`, "must be an integer from -1440 through 1440");
      }
      if (scalar.fold !== 0 && scalar.fold !== 1) contractError(`${path}.fold`, "must be 0 or 1");
      return;
    case "duration":
      exactFields(scalar, ["type", "value", "unit"], path);
      if (!DECIMAL.test(nonEmptyString(scalar.value, `${path}.value`))) contractError(`${path}.value`, "must be a canonical finite decimal");
      if (!DURATION_UNITS.has(scalar.unit as DurationUnitV1)) contractError(`${path}.unit`, "is not a supported duration unit");
      return;
    case "factor": {
      exactFields(scalar, ["type", "value", "levels", "ordered"], path);
      if (typeof scalar.value !== "string") contractError(`${path}.value`, "must be a string");
      const factorValue = scalar.value;
      if (!Array.isArray(scalar.levels) || scalar.levels.some((level) => typeof level !== "string")) contractError(`${path}.levels`, "must be a string array");
      if (new Set(scalar.levels as string[]).size !== (scalar.levels as string[]).length) contractError(`${path}.levels`, "must not contain duplicates");
      if (!(scalar.levels as string[]).includes(factorValue)) contractError(`${path}.value`, "must occur in levels");
      if (typeof scalar.ordered !== "boolean") contractError(`${path}.ordered`, "must be boolean");
      return;
    }
    default:
      contractError(`${path}.type`, `unsupported typed scalar ${JSON.stringify(type)}`);
  }
}

function normalizedScalar(value: TypedScalarV1): TypedScalarV1 {
  assertTypedScalarV1(value);
  if (value.type === "factor") return { ...value, levels: [...value.levels] };
  return { ...value };
}

export function createTypedKeyV1(components: readonly TypedKeyComponentV1[]): TypedKeyV1 {
  if (!Array.isArray(components) || components.length === 0) contractError("components", "must be a non-empty array");
  const names = new Set<string>();
  const normalized = components.map((component, index) => {
    const row = objectAt(component, `components[${index}]`);
    exactFields(row, ["name", "value"], `components[${index}]`);
    const name = nonEmptyString(row.name, `components[${index}].name`);
    if (names.has(name)) contractError(`components[${index}].name`, "duplicates an earlier component name");
    names.add(name);
    assertTypedScalarV1(row.value, `components[${index}].value`);
    return { name, value: normalizedScalar(row.value) };
  });
  const canonical = JSON.stringify({ schemaVersion: "3dena.typed-key.v1", components: normalized });
  return { schemaVersion: "3dena.typed-key.v1", components: normalized, canonical };
}

export function assertTypedKeyV1(value: unknown, path = "key"): asserts value is TypedKeyV1 {
  const key = objectAt(value, path);
  exactFields(key, ["schemaVersion", "components", "canonical"], path);
  if (key.schemaVersion !== "3dena.typed-key.v1") contractError(`${path}.schemaVersion`, "must be 3dena.typed-key.v1");
  if (!Array.isArray(key.components)) contractError(`${path}.components`, "must be an array");
  const computed = createTypedKeyV1(key.components as TypedKeyComponentV1[]);
  if (key.canonical !== computed.canonical) contractError(`${path}.canonical`, "does not match the canonical typed component encoding");
}

export function assertTaskOwnerV1(value: unknown, path = "owner"): asserts value is TaskOwnerV1 {
  const owner = objectAt(value, path);
  exactFields(owner, ["contractVersion", "datasetHash", "specHash", "runId", "taskId"], path);
  if (owner.contractVersion !== ANALYSIS_CONTRACT_VERSION_V1) contractError(`${path}.contractVersion`, `must be ${ANALYSIS_CONTRACT_VERSION_V1}`);
  for (const field of ["datasetHash", "specHash"] as const) {
    const hash = nonEmptyString(owner[field], `${path}.${field}`);
    if (!SHA256.test(hash)) contractError(`${path}.${field}`, "must be a lowercase SHA-256 hex digest");
  }
  nonEmptyString(owner.runId, `${path}.runId`);
  nonEmptyString(owner.taskId, `${path}.taskId`);
}

export function assertDatasetReceiptV1(value: unknown, path = "receipt"): asserts value is DatasetReceiptV1 {
  const receipt = objectAt(value, path);
  exactFields(receipt, ["schemaVersion", "sha256", "byteLength", "format", "sheet", "rows", "columns", "schema", "limits", "warnings", "activationIdentity"], path);
  if (receipt.schemaVersion !== DATASET_RECEIPT_VERSION_V1) contractError(`${path}.schemaVersion`, `must be ${DATASET_RECEIPT_VERSION_V1}`);
  if (typeof receipt.sha256 !== "string" || !SHA256.test(receipt.sha256)) contractError(`${path}.sha256`, "must be a lowercase SHA-256 hex digest");
  for (const field of ["byteLength", "rows", "columns"] as const) {
    if (!Number.isSafeInteger(receipt[field]) || (receipt[field] as number) < 1) contractError(`${path}.${field}`, "must be a positive safe integer");
  }
  if (!["csv", "xlsx", "xls", "ena3d-json"].includes(receipt.format as string)) contractError(`${path}.format`, "is unsupported");
  if (receipt.sheet !== null) {
    const sheet = objectAt(receipt.sheet, `${path}.sheet`);
    exactFields(sheet, ["index", "name"], `${path}.sheet`);
    if (!Number.isSafeInteger(sheet.index) || (sheet.index as number) < 0) contractError(`${path}.sheet.index`, "must be a non-negative safe integer");
    nonEmptyString(sheet.name, `${path}.sheet.name`);
  }
  const schema = objectAt(receipt.schema, `${path}.schema`);
  exactFields(schema, ["schemaVersion", "headers", "columns"], `${path}.schema`);
  if (schema.schemaVersion !== "3dena.dataset-schema.v1") contractError(`${path}.schema.schemaVersion`, "must be 3dena.dataset-schema.v1");
  const headers = stringList(schema.headers, `${path}.schema.headers`);
  if (headers.length !== receipt.columns) contractError(`${path}.schema.headers`, "length must equal receipt.columns");
  if (!Array.isArray(schema.columns) || schema.columns.length !== receipt.columns) contractError(`${path}.schema.columns`, "length must equal receipt.columns");
  const allowedTypes = new Set<DatasetColumnTypeV1>(["string", "number", "boolean", "mixed", "null"]);
  const allowedRoles = new Set<DatasetColumnRoleV1>(["unit", "conversation", "time", "code", "group", "metadata", "unmapped"]);
  schema.columns.forEach((candidate, index) => {
    const column = objectAt(candidate, `${path}.schema.columns[${index}]`);
    exactFields(column, ["name", "inferredType", "roles"], `${path}.schema.columns[${index}]`);
    if (nonEmptyString(column.name, `${path}.schema.columns[${index}].name`) !== headers[index]) {
      contractError(`${path}.schema.columns[${index}].name`, "must match the ordered header at the same index");
    }
    if (!allowedTypes.has(column.inferredType as DatasetColumnTypeV1)) contractError(`${path}.schema.columns[${index}].inferredType`, "is unsupported");
    if (!Array.isArray(column.roles) || column.roles.length === 0 || column.roles.some((role) => !allowedRoles.has(role as DatasetColumnRoleV1))) {
      contractError(`${path}.schema.columns[${index}].roles`, "must be a non-empty array of supported roles");
    }
    if (new Set(column.roles).size !== column.roles.length) contractError(`${path}.schema.columns[${index}].roles`, "must not contain duplicates");
    if (column.roles.includes("unmapped") && column.roles.length !== 1) contractError(`${path}.schema.columns[${index}].roles`, "unmapped must stand alone");
  });
  const limits = objectAt(receipt.limits, `${path}.limits`);
  exactFields(limits, ["schemaVersion", "maxFileBytes", "maxWorksheets", "maxRows", "maxColumns", "maxCells"], `${path}.limits`);
  if (limits.schemaVersion !== "3dena.dataset-limits.v1") contractError(`${path}.limits.schemaVersion`, "must be 3dena.dataset-limits.v1");
  for (const field of ["maxFileBytes", "maxWorksheets", "maxRows", "maxColumns", "maxCells"] as const) {
    if (!Number.isSafeInteger(limits[field]) || (limits[field] as number) < 1) contractError(`${path}.limits.${field}`, "must be a positive safe integer");
  }
  if ((receipt.byteLength as number) > (limits.maxFileBytes as number)) contractError(`${path}.byteLength`, "exceeds the activated limits contract");
  if ((receipt.rows as number) > (limits.maxRows as number)) contractError(`${path}.rows`, "exceeds the activated limits contract");
  if ((receipt.columns as number) > (limits.maxColumns as number)) contractError(`${path}.columns`, "exceeds the activated limits contract");
  const cells = (receipt.rows as number) * (receipt.columns as number);
  if (!Number.isSafeInteger(cells) || cells > (limits.maxCells as number)) contractError(`${path}.rows`, "implies cells above the activated limits contract");
  if (!Array.isArray(receipt.warnings) || receipt.warnings.some((warning) => typeof warning !== "string")) contractError(`${path}.warnings`, "must be a string array");
  if (new Set(receipt.warnings).size !== receipt.warnings.length) contractError(`${path}.warnings`, "must not contain duplicates");
  nonEmptyString(receipt.activationIdentity, `${path}.activationIdentity`);
}

export function assertAnalysisSpecV1(value: unknown, path = "spec"): asserts value is AnalysisSpecV1 {
  const spec = objectAt(value, path);
  exactFields(spec, [
    "schemaVersion", "model", "window", "weightBy", "windowSizeBack", "windowSizeForward", "centerAlignToOrigin", "cohortPolicy",
  ], path);
  if (spec.schemaVersion !== "3dena.analysis-spec.v1") contractError(`${path}.schemaVersion`, "must be 3dena.analysis-spec.v1");
  if (!(spec.model === "EndPoint" || spec.model === "AccumulatedTrajectory" || spec.model === "SeparateTrajectory")) contractError(`${path}.model`, "is unsupported");
  if (!(spec.window === "MovingStanzaWindow" || spec.window === "Conversation")) contractError(`${path}.window`, "is unsupported");
  if (!(spec.weightBy === "binary" || spec.weightBy === "sum")) contractError(`${path}.weightBy`, "is unsupported");
  for (const field of ["windowSizeBack", "windowSizeForward"] as const) {
    if (!Number.isSafeInteger(spec[field]) || (spec[field] as number) < 0) contractError(`${path}.${field}`, "must be a non-negative safe integer");
  }
  if (typeof spec.centerAlignToOrigin !== "boolean") contractError(`${path}.centerAlignToOrigin`, "must be boolean");
  if (spec.cohortPolicy !== "available" && spec.cohortPolicy !== "complete") contractError(`${path}.cohortPolicy`, "must be available or complete");
}

function lowercaseSha256(value: unknown, path: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    contractError(path, "must be a lowercase SHA-256 hex digest");
  }
  return value;
}

function stringPair(value: unknown, path: string): [string, string] {
  if (!Array.isArray(value) || value.length !== 2) contractError(path, "must contain exactly two strings");
  const left = nonEmptyString(value[0], `${path}[0]`);
  const right = nonEmptyString(value[1], `${path}[1]`);
  if (left === right) contractError(path, "must contain two different values");
  return [left, right];
}

function stringList(value: unknown, path: string, minimum = 1): string[] {
  if (!Array.isArray(value) || value.length < minimum) contractError(path, `must contain at least ${minimum} strings`);
  const output = value.map((entry, index) => nonEmptyString(entry, `${path}[${index}]`));
  if (new Set(output).size !== output.length) contractError(path, "must not contain duplicates");
  return output;
}

function rawScalar(value: unknown, path: string): asserts value is RawScalar {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value !== "number" || !Number.isFinite(value)) contractError(path, "must be a finite JSON scalar or null");
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
    contractError(path, "unsafe integer identities must be supplied as strings");
  }
}

function assertPreparedMapping(value: unknown, path: string): asserts value is PreparedSpaceMapping {
  const mapping = objectAt(value, path);
  exactFields(mapping, [
    "participant", "participantLabel", "group", "time", "timeOrder",
    "cohortPolicy", "displayDimensions", "missingDisplayCoordinates",
  ], path);
  stringList(mapping.participant, `${path}.participant`);
  nonEmptyString(mapping.participantLabel, `${path}.participantLabel`);
  nonEmptyString(mapping.group, `${path}.group`);
  nonEmptyString(mapping.time, `${path}.time`);
  if (!Array.isArray(mapping.timeOrder) || mapping.timeOrder.length === 0) {
    contractError(`${path}.timeOrder`, "must contain at least one ordered period");
  }
  mapping.timeOrder.forEach((candidate, index) => rawScalar(candidate, `${path}.timeOrder[${index}]`));
  if (mapping.cohortPolicy !== "available" && mapping.cohortPolicy !== "complete") {
    contractError(`${path}.cohortPolicy`, "must be available or complete");
  }
  if (stringList(mapping.displayDimensions, `${path}.displayDimensions`, 3).length !== 3) {
    contractError(`${path}.displayDimensions`, "must contain exactly three dimensions");
  }
  if (mapping.missingDisplayCoordinates !== "reject") {
    contractError(`${path}.missingDisplayCoordinates`, "must be reject");
  }
}

function trajectoryDurationUnit(value: unknown, path: string): void {
  if (typeof value !== "string" || !TRAJECTORY_DURATION_UNITS.has(value)) {
    contractError(path, "must be milliseconds, seconds, minutes, hours, days, or weeks");
  }
}

function assertTrajectoryTimeValue(value: unknown, path: string): asserts value is TrajectoryTimeValueV1 {
  const time = objectAt(value, path);
  const type = nonEmptyString(time.type, `${path}.type`);
  switch (type) {
    case "numeric-v1":
      exactFields(time, ["type", "value", "unit"], path);
      if (typeof time.value !== "number" || !Number.isFinite(time.value)) contractError(`${path}.value`, "must be finite");
      nonEmptyString(time.unit, `${path}.unit`);
      return;
    case "date-v1":
      exactFields(time, ["type", "value"], path);
      validateDate(nonEmptyString(time.value, `${path}.value`), `${path}.value`);
      return;
    case "instant-v1":
      exactFields(time, ["type", "epochMilliseconds", "timeZone", "offsetMinutes", "fold", "elapsedUnit"], path);
      validateInt64(nonEmptyString(time.epochMilliseconds, `${path}.epochMilliseconds`), `${path}.epochMilliseconds`);
      nonEmptyString(time.timeZone, `${path}.timeZone`);
      if (!Number.isInteger(time.offsetMinutes) || (time.offsetMinutes as number) < -1_440 || (time.offsetMinutes as number) > 1_440) {
        contractError(`${path}.offsetMinutes`, "must be an integer from -1440 through 1440");
      }
      if (time.fold !== 0 && time.fold !== 1) contractError(`${path}.fold`, "must be 0 or 1");
      trajectoryDurationUnit(time.elapsedUnit, `${path}.elapsedUnit`);
      return;
    case "difftime-v1":
      exactFields(time, ["type", "value", "unit", "elapsedUnit"], path);
      if (typeof time.value !== "number" || !Number.isFinite(time.value)) contractError(`${path}.value`, "must be finite");
      trajectoryDurationUnit(time.unit, `${path}.unit`);
      trajectoryDurationUnit(time.elapsedUnit, `${path}.elapsedUnit`);
      return;
    default:
      contractError(`${path}.type`, `unsupported trajectory time type ${JSON.stringify(type)}`);
  }
}

/** Strict runtime validator shared by SDK, remote client, service, and Worker. */
export function assertAnalysisTaskV1(value: unknown, path = "task"): asserts value is AnalysisTaskV1 {
  const task = objectAt(value, path);
  if (task.schemaVersion !== ANALYSIS_TASK_VERSION_V1) contractError(`${path}.schemaVersion`, `must be ${ANALYSIS_TASK_VERSION_V1}`);
  assertTaskOwnerV1(task.owner, `${path}.owner`);
  if (!Number.isSafeInteger(task.deadlineEpochMilliseconds) || (task.deadlineEpochMilliseconds as number) < 0) {
    contractError(`${path}.deadlineEpochMilliseconds`, "must be a non-negative safe integer");
  }
  const kind = nonEmptyString(task.kind, `${path}.kind`);
  const base = ["schemaVersion", "kind", "owner", "deadlineEpochMilliseconds"] as const;
  switch (kind) {
    case "ena-model":
      exactFields(task, [...base, "input"], path);
      objectAt(task.input, `${path}.input`);
      return;
    case "prepared-import": {
      exactFields(task, [...base, "input"], path);
      const input = objectAt(task.input, `${path}.input`);
      exactFields(input, ["sourceName", "exactBytesBase64", "mapping"], `${path}.input`);
      if (input.sourceName !== "uploaded.ena3d.json") contractError(`${path}.input.sourceName`, "must be the non-identifying service source name");
      if (typeof input.exactBytesBase64 !== "string"
          || input.exactBytesBase64.length < 4
          || input.exactBytesBase64.length > 7_000_000
          || input.exactBytesBase64.length % 4 !== 0
          || !/^[A-Za-z0-9+/]+={0,2}$/u.test(input.exactBytesBase64)) {
        contractError(`${path}.input.exactBytesBase64`, "must be bounded canonical base64");
      }
      assertPreparedMapping(input.mapping, `${path}.input.mapping`);
      return;
    }
    case "network-comparison":
      exactFields(task, [...base, "sourceResultHash", "groups"], path);
      lowercaseSha256(task.sourceResultHash, `${path}.sourceResultHash`);
      stringPair(task.groups, `${path}.groups`);
      return;
    case "change-network":
      exactFields(task, [...base, "sourceResultHash", "field", "level"], path);
      lowercaseSha256(task.sourceResultHash, `${path}.sourceResultHash`);
      nonEmptyString(task.field, `${path}.field`);
      rawScalar(task.level, `${path}.level`);
      return;
    case "statistics":
      exactFields(task, [...base, "sourceResultHash", "design", "groups", "dimensions", "alternative", "adjustment", "samePhysicalEntityConfirmed"], path);
      lowercaseSha256(task.sourceResultHash, `${path}.sourceResultHash`);
      if (task.design !== "independent" && task.design !== "paired") contractError(`${path}.design`, "must be independent or paired");
      stringPair(task.groups, `${path}.groups`);
      stringList(task.dimensions, `${path}.dimensions`);
      if (!(["two-sided", "greater", "less"] as unknown[]).includes(task.alternative)) contractError(`${path}.alternative`, "is unsupported");
      if (!(["none", "holm", "bh", "bonferroni"] as unknown[]).includes(task.adjustment)) contractError(`${path}.adjustment`, "is unsupported");
      if (typeof task.samePhysicalEntityConfirmed !== "boolean") contractError(`${path}.samePhysicalEntityConfirmed`, "must be boolean");
      if (task.design === "paired" && task.samePhysicalEntityConfirmed !== true) contractError(`${path}.samePhysicalEntityConfirmed`, "must be true for paired statistics");
      if (task.design === "independent" && task.samePhysicalEntityConfirmed !== false) contractError(`${path}.samePhysicalEntityConfirmed`, "must be false for independent statistics");
      return;
    case "trajectory":
      exactFields(task, [...base, "sourceResultHash", "group", "selectedDimensions", "cohortPolicy", "periods", "estimand"], path);
      lowercaseSha256(task.sourceResultHash, `${path}.sourceResultHash`);
      nonEmptyString(task.group, `${path}.group`);
      if (stringList(task.selectedDimensions, `${path}.selectedDimensions`, 3).length !== 3) contractError(`${path}.selectedDimensions`, "must contain exactly three dimensions");
      if (task.cohortPolicy !== "available" && task.cohortPolicy !== "complete") contractError(`${path}.cohortPolicy`, "must be available or complete");
      if (!Array.isArray(task.periods) || task.periods.length === 0) contractError(`${path}.periods`, "must contain at least one period");
      {
        const seen = new Set<string>();
        task.periods.forEach((candidate, index) => {
          const period = objectAt(candidate, `${path}.periods[${index}]`);
          exactFields(period, ["sourceTimeCanonical", "value"], `${path}.periods[${index}]`);
          const canonical = nonEmptyString(period.sourceTimeCanonical, `${path}.periods[${index}].sourceTimeCanonical`);
          if (seen.has(canonical)) contractError(`${path}.periods[${index}].sourceTimeCanonical`, "duplicates an earlier source time key");
          seen.add(canonical);
          assertTrajectoryTimeValue(period.value, `${path}.periods[${index}].value`);
        });
      }
      {
        const estimand = objectAt(task.estimand, `${path}.estimand`);
        if (estimand.kind === "equal-participant-v1") {
          exactFields(estimand, ["kind"], `${path}.estimand`);
        } else if (estimand.kind === "weighted-participant-v1") {
          exactFields(estimand, ["kind", "metadataField"], `${path}.estimand`);
          nonEmptyString(estimand.metadataField, `${path}.estimand.metadataField`);
        } else {
          contractError(`${path}.estimand.kind`, "must be equal-participant-v1 or weighted-participant-v1");
        }
      }
      return;
    case "trajectory-comparison":
      exactFields(task, [...base, "sourceResultHash", "design", "groups", "samePhysicalEntityConfirmed"], path);
      lowercaseSha256(task.sourceResultHash, `${path}.sourceResultHash`);
      if (task.design !== "independent" && task.design !== "paired") contractError(`${path}.design`, "must be independent or paired");
      stringPair(task.groups, `${path}.groups`);
      if (typeof task.samePhysicalEntityConfirmed !== "boolean") contractError(`${path}.samePhysicalEntityConfirmed`, "must be boolean");
      if (task.design === "paired" && task.samePhysicalEntityConfirmed !== true) contractError(`${path}.samePhysicalEntityConfirmed`, "must be true for paired comparison");
      return;
    case "bootstrap":
      exactFields(task, [...base, "sourceResultHash", "group", "replicates", "confidenceLevel", "seed", "interval", "rotationPolicy"], path);
      lowercaseSha256(task.sourceResultHash, `${path}.sourceResultHash`);
      nonEmptyString(task.group, `${path}.group`);
      if (!Number.isSafeInteger(task.replicates) || (task.replicates as number) < 200 || (task.replicates as number) > 500) contractError(`${path}.replicates`, "must be a safe integer from 200 through 500");
      if (typeof task.confidenceLevel !== "number" || !Number.isFinite(task.confidenceLevel) || task.confidenceLevel <= 0 || task.confidenceLevel >= 1) contractError(`${path}.confidenceLevel`, "must be finite and strictly between 0 and 1");
      if (!Number.isSafeInteger(task.seed) || (task.seed as number) < 0 || (task.seed as number) > 0xffff_ffff) contractError(`${path}.seed`, "must be an unsigned 32-bit integer");
      if (task.interval !== "pointwise-percentile-type7") contractError(`${path}.interval`, "is unsupported in task v1");
      if (task.rotationPolicy !== "fixed-preprojected") contractError(`${path}.rotationPolicy`, "is unsupported in task v1");
      return;
    default:
      contractError(`${path}.kind`, `unsupported analysis task ${JSON.stringify(kind)}`);
  }
}

function finiteRange(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    contractError(path, `must be finite and in [${minimum}, ${maximum}]`);
  }
  return value;
}

function vector3(value: unknown, path: string): void {
  const vector = objectAt(value, path);
  exactFields(vector, ["x", "y", "z"], path);
  for (const axis of ["x", "y", "z"] as const) finiteRange(vector[axis], `${path}.${axis}`, -1_000_000, 1_000_000);
}

export function assertDisplaySpecV1(value: unknown, path = "displaySpec"): asserts value is DisplaySpecV1 {
  const spec = objectAt(value, path);
  allowedFields(
    spec,
    ["schemaVersion", "dimensions", "plotDimension", "groups", "showGrid", "showZeroLines", "showAxes", "traces", "style", "camera"],
    ["schemaVersion", "dimensions", "plotDimension", "showGrid", "showZeroLines", "showAxes", "traces", "style", "camera"],
    path,
  );
  if (spec.schemaVersion !== "3dena.display-spec.v1") contractError(`${path}.schemaVersion`, "must be 3dena.display-spec.v1");
  if (stringList(spec.dimensions, `${path}.dimensions`, 3).length !== 3) contractError(`${path}.dimensions`, "must contain exactly three dimensions");
  if (spec.plotDimension !== 2 && spec.plotDimension !== 3) contractError(`${path}.plotDimension`, "must be 2 or 3");
  if (spec.groups !== undefined) stringList(spec.groups, `${path}.groups`);
  for (const field of ["showGrid", "showZeroLines", "showAxes"] as const) {
    if (typeof spec[field] !== "boolean") contractError(`${path}.${field}`, "must be boolean");
  }
  const traces = objectAt(spec.traces, `${path}.traces`);
  exactFields(traces, ["points", "nodes", "network", "centroids", "trajectory", "uncertainty"], `${path}.traces`);
  for (const field of ["points", "nodes", "network", "centroids", "trajectory", "uncertainty"] as const) {
    if (typeof traces[field] !== "boolean") contractError(`${path}.traces.${field}`, "must be boolean");
  }
  const style = objectAt(spec.style, `${path}.style`);
  exactFields(style, ["pointSize", "pointOpacity", "nodeSize", "nodeOpacity", "edgeThreshold", "edgeWidthScale", "trajectoryWidth"], `${path}.style`);
  finiteRange(style.pointSize, `${path}.style.pointSize`, 1, 100);
  finiteRange(style.pointOpacity, `${path}.style.pointOpacity`, 0, 1);
  finiteRange(style.nodeSize, `${path}.style.nodeSize`, 1, 100);
  finiteRange(style.nodeOpacity, `${path}.style.nodeOpacity`, 0, 1);
  finiteRange(style.edgeThreshold, `${path}.style.edgeThreshold`, 0, 1_000_000_000);
  finiteRange(style.edgeWidthScale, `${path}.style.edgeWidthScale`, 0.01, 1_000);
  finiteRange(style.trajectoryWidth, `${path}.style.trajectoryWidth`, 0.1, 100);
  if (spec.camera !== null) {
    const camera = objectAt(spec.camera, `${path}.camera`);
    exactFields(camera, ["eye", "center", "up"], `${path}.camera`);
    vector3(camera.eye, `${path}.camera.eye`);
    vector3(camera.center, `${path}.camera.center`);
    vector3(camera.up, `${path}.camera.up`);
  }
}

export function assertEvidenceStampV1(value: unknown, path = "evidence"): asserts value is EvidenceStampV1 {
  const evidence = objectAt(value, path);
  allowedFields(
    evidence,
    ["schemaVersion", "scope", "status", "datasetHash", "specHash", "fixtureId", "buildId", "approvedForParity"],
    ["schemaVersion", "scope", "status", "approvedForParity"],
    path,
  );
  if (evidence.schemaVersion !== "3dena.evidence-stamp.v1") contractError(`${path}.schemaVersion`, "must be 3dena.evidence-stamp.v1");
  if (!(evidence.scope === "fixture" || evidence.scope === "feature" || evidence.scope === "build" || evidence.scope === "deployment")) contractError(`${path}.scope`, "is unsupported");
  const statuses = new Set<EvidenceStatusV1>([
    "IMPLEMENTED_UNVERIFIED", "PARITY_CANDIDATE", "VERIFIED_PARITY", "PRODUCTION_CANDIDATE", "PRODUCTION_READY",
    "PRECOMPUTED_COMPATIBILITY_CANDIDATE",
  ]);
  if (!statuses.has(evidence.status as EvidenceStatusV1)) contractError(`${path}.status`, "is unsupported");
  if (typeof evidence.approvedForParity !== "boolean") contractError(`${path}.approvedForParity`, "must be boolean");
  for (const field of ["datasetHash", "specHash"] as const) {
    if (evidence[field] !== undefined) lowercaseSha256(evidence[field], `${path}.${field}`);
  }
  for (const field of ["fixtureId", "buildId"] as const) {
    if (evidence[field] !== undefined) nonEmptyString(evidence[field], `${path}.${field}`);
  }
  if (evidence.scope === "fixture") {
    for (const field of ["datasetHash", "specHash", "fixtureId"] as const) {
      if (evidence[field] === undefined) contractError(`${path}.${field}`, "is required for fixture-scoped evidence");
    }
  }
  if ((evidence.scope === "build" || evidence.scope === "deployment") && evidence.buildId === undefined) {
    contractError(`${path}.buildId`, `is required for ${evidence.scope}-scoped evidence`);
  }
  if (evidence.approvedForParity === true && !(["VERIFIED_PARITY", "PRODUCTION_CANDIDATE", "PRODUCTION_READY"] as unknown[]).includes(evidence.status)) {
    contractError(`${path}.approvedForParity`, "cannot be true below VERIFIED_PARITY");
  }
}

export function assertAnalysisResultEnvelopeV1(value: unknown, path = "envelope"): asserts value is AnalysisResultEnvelopeV1 {
  const envelope = objectAt(value, path);
  exactFields(envelope, ["schemaVersion", "owner", "taskKind", "result", "diagnostics", "evidence", "provenance"], path);
  if (envelope.schemaVersion !== RESULT_ENVELOPE_VERSION_V1) contractError(`${path}.schemaVersion`, `must be ${RESULT_ENVELOPE_VERSION_V1}`);
  assertTaskOwnerV1(envelope.owner, `${path}.owner`);
  if (!(["ena-model", "prepared-import", "network-comparison", "change-network", "statistics", "trajectory", "trajectory-comparison", "bootstrap"] as unknown[]).includes(envelope.taskKind)) {
    contractError(`${path}.taskKind`, "is unsupported");
  }
  const taskKind = envelope.taskKind as AnalysisTaskV1["kind"];
  const expectedResultSchemaVersion = RESULT_SCHEMA_VERSION_BY_TASK_KIND_V1[taskKind];
  const result = objectAt(envelope.result, `${path}.result`);
  if (result.schemaVersion !== expectedResultSchemaVersion) {
    contractError(`${path}.result.schemaVersion`, `must be ${expectedResultSchemaVersion} for taskKind ${taskKind}`);
  }
  assertAnalysisTaskResultV1(result, taskKind, `${path}.result`);
  if (!Array.isArray(envelope.diagnostics)) contractError(`${path}.diagnostics`, "must be an array");
  envelope.diagnostics.forEach((candidate, index) => {
    const diagnostic = objectAt(candidate, `${path}.diagnostics[${index}]`);
    allowedFields(diagnostic, ["code", "severity", "message", "path", "count"], ["code", "severity", "message"], `${path}.diagnostics[${index}]`);
    nonEmptyString(diagnostic.code, `${path}.diagnostics[${index}].code`);
    if (diagnostic.severity !== "info" && diagnostic.severity !== "warning") contractError(`${path}.diagnostics[${index}].severity`, "is unsupported");
    nonEmptyString(diagnostic.message, `${path}.diagnostics[${index}].message`);
    if (diagnostic.path !== undefined) nonEmptyString(diagnostic.path, `${path}.diagnostics[${index}].path`);
    if (diagnostic.count !== undefined && (!Number.isSafeInteger(diagnostic.count) || (diagnostic.count as number) < 0)) contractError(`${path}.diagnostics[${index}].count`, "must be a non-negative safe integer");
  });
  assertEvidenceStampV1(envelope.evidence, `${path}.evidence`);
  assertProvenanceManifestV1(envelope.provenance, `${path}.provenance`);
  const owner = envelope.owner as unknown as TaskOwnerV1;
  const provenance = envelope.provenance as unknown as ProvenanceManifestV1;
  const evidence = envelope.evidence as unknown as EvidenceStampV1;
  if (owner.datasetHash !== provenance.datasetHash || owner.specHash !== provenance.specHash) contractError(`${path}.provenance`, "dataset/spec ownership does not match envelope.owner");
  if (evidence.datasetHash !== undefined && evidence.datasetHash !== owner.datasetHash) contractError(`${path}.evidence.datasetHash`, "does not match envelope.owner");
  if (evidence.specHash !== undefined && evidence.specHash !== owner.specHash) contractError(`${path}.evidence.specHash`, "does not match envelope.owner");
  for (const requiredSchemaVersion of [ANALYSIS_TASK_VERSION_V1, expectedResultSchemaVersion, RESULT_ENVELOPE_VERSION_V1]) {
    if (!provenance.schemaVersions.includes(requiredSchemaVersion)) {
      contractError(`${path}.provenance.schemaVersions`, `must include ${requiredSchemaVersion}`);
    }
  }
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) contractError(path, "must be a finite number");
  return value;
}

function finiteOrNull(value: unknown, path: string): number | null {
  if (value === null) return null;
  return finiteNumber(value, path);
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) contractError(path, "must be a non-negative safe integer");
  return value as number;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) contractError(path, "must be a positive safe integer");
  return value as number;
}

function finiteVector(value: unknown, path: string, length?: number): number[] {
  if (!Array.isArray(value)) contractError(path, "must be an array");
  if (length !== undefined && value.length !== length) contractError(path, `must contain exactly ${length} values`);
  return value.map((entry, index) => finiteNumber(entry, `${path}[${index}]`));
}

function optionalFiniteVector(value: unknown, path: string, length: number): number[] | null {
  if (value === null) return null;
  return finiteVector(value, path, length);
}

function sameOrderedStrings(actual: readonly string[], expected: readonly string[], path: string): void {
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    contractError(path, "must preserve the declared order exactly");
  }
}

function assertRawEntityKey(value: unknown, path: string): { canonical: string; columns: string[]; values: RawScalar[] } {
  const key = objectAt(value, path);
  exactFields(key, ["canonical", "display", "columns", "values"], path);
  const canonical = nonEmptyString(key.canonical, `${path}.canonical`);
  if (typeof key.display !== "string") contractError(`${path}.display`, "must be a string");
  const columns = stringList(key.columns, `${path}.columns`);
  if (!Array.isArray(key.values) || key.values.length !== columns.length) contractError(`${path}.values`, "must align one-to-one with columns");
  key.values.forEach((entry, index) => rawScalar(entry, `${path}.values[${index}]`));
  return { canonical, columns, values: key.values as RawScalar[] };
}

function assertRawTypedValue(value: unknown, path: string): { canonical: string } {
  const typed = objectAt(value, path);
  exactFields(typed, ["canonical", "display", "value"], path);
  const canonical = nonEmptyString(typed.canonical, `${path}.canonical`);
  if (typeof typed.display !== "string") contractError(`${path}.display`, "must be a string");
  rawScalar(typed.value, `${path}.value`);
  return { canonical };
}

function assertDiagnostic(value: unknown, path: string): void {
  const diagnostic = objectAt(value, path);
  allowedFields(diagnostic, ["code", "severity", "message", "path", "count"], ["code", "severity", "message"], path);
  nonEmptyString(diagnostic.code, `${path}.code`);
  if (diagnostic.severity !== "info" && diagnostic.severity !== "warning") contractError(`${path}.severity`, "must be info or warning");
  nonEmptyString(diagnostic.message, `${path}.message`);
  if (diagnostic.path !== undefined) nonEmptyString(diagnostic.path, `${path}.path`);
  if (diagnostic.count !== undefined) nonNegativeInteger(diagnostic.count, `${path}.count`);
}

function assertDiagnostics(value: unknown, path: string): void {
  if (!Array.isArray(value)) contractError(path, "must be an array");
  value.forEach((entry, index) => assertDiagnostic(entry, `${path}[${index}]`));
}

function assertAnalysisResult(value: unknown, path: string): void {
  const result = objectAt(value, path);
  allowedFields(
    result,
    ["schemaVersion", "dimensions", "axes", "points", "nodes", "edges", "accumulation", "variance", "rotation", "trajectory", "summary", "diagnostics", "provenance"],
    ["schemaVersion", "dimensions", "axes", "points", "nodes", "edges", "accumulation", "variance", "rotation", "summary", "diagnostics", "provenance"],
    path,
  );
  if (result.schemaVersion !== "3dena.analysis-result.v1") contractError(`${path}.schemaVersion`, "must be 3dena.analysis-result.v1");
  const dimensions = stringList(result.dimensions, `${path}.dimensions`, 3);
  if (new Set(dimensions).size !== dimensions.length) contractError(`${path}.dimensions`, "must not contain duplicates");
  const axes = stringList(result.axes, `${path}.axes`, 3);
  if (axes.length !== 3 || axes.some((axis, index) => axis !== dimensions[index])) {
    contractError(`${path}.axes`, "must be the first three fitted rotation dimensions in order");
  }
  if (!Array.isArray(result.edges) || result.edges.length === 0) contractError(`${path}.edges`, "must be a non-empty array");
  const edgeColumns: string[] = [];
  const edgeIds = new Set<string>();
  result.edges.forEach((candidate, index) => {
    const edge = objectAt(candidate, `${path}.edges[${index}]`);
    exactFields(edge, ["index", "id", "column", "source", "target", "sourceIndex", "targetIndex", "meanWeight"], `${path}.edges[${index}]`);
    if (nonNegativeInteger(edge.index, `${path}.edges[${index}].index`) !== index) contractError(`${path}.edges[${index}].index`, "must equal its array position");
    const id = nonEmptyString(edge.id, `${path}.edges[${index}].id`);
    if (edgeIds.has(id)) contractError(`${path}.edges[${index}].id`, "duplicates an earlier edge identity");
    edgeIds.add(id);
    edgeColumns.push(nonEmptyString(edge.column, `${path}.edges[${index}].column`));
    nonEmptyString(edge.source, `${path}.edges[${index}].source`);
    nonEmptyString(edge.target, `${path}.edges[${index}].target`);
    nonNegativeInteger(edge.sourceIndex, `${path}.edges[${index}].sourceIndex`);
    nonNegativeInteger(edge.targetIndex, `${path}.edges[${index}].targetIndex`);
    finiteNumber(edge.meanWeight, `${path}.edges[${index}].meanWeight`);
  });
  if (new Set(edgeColumns).size !== edgeColumns.length) contractError(`${path}.edges`, "edge columns must be unique");
  if (!Array.isArray(result.nodes) || result.nodes.length < 3) contractError(`${path}.nodes`, "must contain at least three nodes");
  const nodeCodes: string[] = [];
  result.nodes.forEach((candidate, index) => {
    const node = objectAt(candidate, `${path}.nodes[${index}]`);
    exactFields(node, ["index", "code", "coordinates", "fullCoordinates"], `${path}.nodes[${index}]`);
    if (nonNegativeInteger(node.index, `${path}.nodes[${index}].index`) !== index) contractError(`${path}.nodes[${index}].index`, "must equal its array position");
    nodeCodes.push(nonEmptyString(node.code, `${path}.nodes[${index}].code`));
    finiteVector(node.coordinates, `${path}.nodes[${index}].coordinates`, 3);
    finiteVector(node.fullCoordinates, `${path}.nodes[${index}].fullCoordinates`, dimensions.length);
  });
  if (new Set(nodeCodes).size !== nodeCodes.length) contractError(`${path}.nodes`, "node codes must be unique");
  result.edges.forEach((candidate, index) => {
    const edge = candidate as Record<string, unknown>;
    const sourceIndex = edge.sourceIndex as number;
    const targetIndex = edge.targetIndex as number;
    if (nodeCodes[sourceIndex] !== edge.source || nodeCodes[targetIndex] !== edge.target) contractError(`${path}.edges[${index}]`, "node indexes and code identities must align");
  });
  if (!Array.isArray(result.points) || result.points.length === 0) contractError(`${path}.points`, "must be a non-empty array");
  const pointIds = new Set<string>();
  result.points.forEach((candidate, index) => {
    const point = objectAt(candidate, `${path}.points[${index}]`);
    allowedFields(point, ["index", "id", "unit", "participantLabel", "step", "group", "time", "coordinates", "fullCoordinates", "lineWeights", "metadata"], ["index", "id", "unit", "participantLabel", "coordinates", "fullCoordinates", "lineWeights", "metadata"], `${path}.points[${index}]`);
    if (nonNegativeInteger(point.index, `${path}.points[${index}].index`) !== index) contractError(`${path}.points[${index}].index`, "must equal its array position");
    const pointId = assertRawEntityKey(point.id, `${path}.points[${index}].id`).canonical;
    if (pointIds.has(pointId)) contractError(`${path}.points[${index}].id`, "duplicates an earlier point identity");
    pointIds.add(pointId);
    assertRawEntityKey(point.unit, `${path}.points[${index}].unit`);
    assertRawEntityKey(point.participantLabel, `${path}.points[${index}].participantLabel`);
    if (point.step !== undefined) assertRawEntityKey(point.step, `${path}.points[${index}].step`);
    if (point.group !== undefined) assertRawTypedValue(point.group, `${path}.points[${index}].group`);
    if (point.time !== undefined) assertRawTypedValue(point.time, `${path}.points[${index}].time`);
    finiteVector(point.coordinates, `${path}.points[${index}].coordinates`, 3);
    finiteVector(point.fullCoordinates, `${path}.points[${index}].fullCoordinates`, dimensions.length);
    finiteVector(point.lineWeights, `${path}.points[${index}].lineWeights`, edgeColumns.length);
    const metadata = objectAt(point.metadata, `${path}.points[${index}].metadata`);
    for (const [field, entry] of Object.entries(metadata)) rawScalar(entry, `${path}.points[${index}].metadata.${field}`);
  });
  const accumulation = objectAt(result.accumulation, `${path}.accumulation`);
  exactFields(accumulation, ["modelCounts", "rowCounts"], `${path}.accumulation`);
  for (const tableName of ["modelCounts", "rowCounts"] as const) {
    const table = objectAt(accumulation[tableName], `${path}.accumulation.${tableName}`);
    exactFields(table, ["rowKeys", "columns", "values"], `${path}.accumulation.${tableName}`);
    const columns = stringList(table.columns, `${path}.accumulation.${tableName}.columns`);
    if (tableName === "modelCounts") {
      sameOrderedStrings(columns, edgeColumns, `${path}.accumulation.${tableName}.columns`);
    } else {
      const edgeTail = columns.slice(columns.length - edgeColumns.length);
      sameOrderedStrings(edgeTail, edgeColumns, `${path}.accumulation.${tableName}.columns`);
    }
    if (!Array.isArray(table.rowKeys) || !Array.isArray(table.values) || table.rowKeys.length !== table.values.length) contractError(`${path}.accumulation.${tableName}`, "rowKeys and values must align");
    table.rowKeys.forEach((entry, index) => {
      assertRawEntityKey(entry, `${path}.accumulation.${tableName}.rowKeys[${index}]`);
      finiteVector((table.values as unknown[])[index], `${path}.accumulation.${tableName}.values[${index}]`, columns.length);
    });
  }
  if (!Array.isArray(result.variance) || result.variance.length !== dimensions.length) contractError(`${path}.variance`, "must align one-to-one with dimensions");
  result.variance.forEach((candidate, index) => {
    const variance = objectAt(candidate, `${path}.variance[${index}]`);
    exactFields(variance, ["axis", "proportion", "eigenvalue", "displayed"], `${path}.variance[${index}]`);
    if (variance.axis !== dimensions[index]) contractError(`${path}.variance[${index}].axis`, "must match the dimension at this index");
    finiteNumber(variance.proportion, `${path}.variance[${index}].proportion`);
    finiteNumber(variance.eigenvalue, `${path}.variance[${index}].eigenvalue`);
    if (typeof variance.displayed !== "boolean") contractError(`${path}.variance[${index}].displayed`, "must be boolean");
  });
  const rotation = objectAt(result.rotation, `${path}.rotation`);
  exactFields(rotation, ["method", "columns", "matrix", "eigenvalues", "centerVector"], `${path}.rotation`);
  if (rotation.method !== "svd" && rotation.method !== "mean" && rotation.method !== "reference") {
    contractError(`${path}.rotation.method`, "must be svd, mean, or reference");
  }
  sameOrderedStrings(stringList(rotation.columns, `${path}.rotation.columns`), dimensions, `${path}.rotation.columns`);
  if (!Array.isArray(rotation.matrix) || rotation.matrix.length !== edgeColumns.length) contractError(`${path}.rotation.matrix`, "must contain one row per edge column");
  rotation.matrix.forEach((row, index) => finiteVector(row, `${path}.rotation.matrix[${index}]`, dimensions.length));
  finiteVector(rotation.eigenvalues, `${path}.rotation.eigenvalues`, dimensions.length);
  finiteVector(rotation.centerVector, `${path}.rotation.centerVector`, edgeColumns.length);
  if (result.trajectory !== undefined) assertSharedTrajectory(result.trajectory, dimensions, result.points as unknown[], `${path}.trajectory`);
  const summary = objectAt(result.summary, `${path}.summary`);
  exactFields(summary, ["inputRows", "inputColumns", "units", "points", "nodes", "edges", "modelCountRows", "rowCountRows", "groups", "timePoints", "participantPeriods", "trajectoryCentroids", "dimensions"], `${path}.summary`);
  for (const field of Object.keys(summary)) nonNegativeInteger(summary[field], `${path}.summary.${field}`);
  if (summary.points !== result.points.length || summary.nodes !== result.nodes.length || summary.edges !== result.edges.length || summary.dimensions !== dimensions.length) contractError(`${path}.summary`, "point, node, edge, and dimension counts must match the public tables");
  const modelCounts = accumulation.modelCounts as { rowKeys: unknown[] };
  const rowCounts = accumulation.rowCounts as { rowKeys: unknown[] };
  if (summary.modelCountRows !== modelCounts.rowKeys.length || summary.rowCountRows !== rowCounts.rowKeys.length) contractError(`${path}.summary`, "accumulation row counts must match the public tables");
  assertDiagnostics(result.diagnostics, `${path}.diagnostics`);
  assertAnalysisProvenance(result.provenance, `${path}.provenance`);
}

function assertSharedTrajectory(value: unknown, dimensions: string[], points: unknown[], path: string): void {
  const trajectory = objectAt(value, path);
  exactFields(trajectory, ["space", "dimensions", "cohortPolicy", "groupOrder", "timeOrder", "participantPeriods", "centroids", "paths"], path);
  if (trajectory.space !== "analysis-result-rotation") contractError(`${path}.space`, "must be analysis-result-rotation");
  sameOrderedStrings(stringList(trajectory.dimensions, `${path}.dimensions`), dimensions, `${path}.dimensions`);
  if (trajectory.cohortPolicy !== "available" && trajectory.cohortPolicy !== "complete") contractError(`${path}.cohortPolicy`, "must be available or complete");
  if (!Array.isArray(trajectory.groupOrder) || !Array.isArray(trajectory.timeOrder)) contractError(path, "groupOrder and timeOrder must be arrays");
  const groups = trajectory.groupOrder.map((entry, index) => assertRawTypedValue(entry, `${path}.groupOrder[${index}]`).canonical);
  const times = trajectory.timeOrder.map((entry, index) => assertRawTypedValue(entry, `${path}.timeOrder[${index}]`).canonical);
  if (new Set(groups).size !== groups.length || new Set(times).size !== times.length) contractError(path, "group and time inventories must not contain duplicates");
  if (!Array.isArray(trajectory.participantPeriods) || !Array.isArray(trajectory.centroids) || !Array.isArray(trajectory.paths)) contractError(path, "trajectory tables must be arrays");
  trajectory.participantPeriods.forEach((candidate, index) => {
    const row = objectAt(candidate, `${path}.participantPeriods[${index}]`);
    exactFields(row, ["index", "participant", "participantLabel", "group", "time", "coordinates", "fullCoordinates", "sourcePointIndexes", "includedInCohort"], `${path}.participantPeriods[${index}]`);
    if (nonNegativeInteger(row.index, `${path}.participantPeriods[${index}].index`) !== index) contractError(`${path}.participantPeriods[${index}].index`, "must equal its array position");
    assertRawEntityKey(row.participant, `${path}.participantPeriods[${index}].participant`);
    assertRawEntityKey(row.participantLabel, `${path}.participantPeriods[${index}].participantLabel`);
    if (!groups.includes(assertRawTypedValue(row.group, `${path}.participantPeriods[${index}].group`).canonical)) contractError(`${path}.participantPeriods[${index}].group`, "must occur in groupOrder");
    if (!times.includes(assertRawTypedValue(row.time, `${path}.participantPeriods[${index}].time`).canonical)) contractError(`${path}.participantPeriods[${index}].time`, "must occur in timeOrder");
    finiteVector(row.coordinates, `${path}.participantPeriods[${index}].coordinates`, 3);
    finiteVector(row.fullCoordinates, `${path}.participantPeriods[${index}].fullCoordinates`, dimensions.length);
    if (!Array.isArray(row.sourcePointIndexes) || row.sourcePointIndexes.length === 0) contractError(`${path}.participantPeriods[${index}].sourcePointIndexes`, "must be non-empty");
    row.sourcePointIndexes.forEach((entry, itemIndex) => {
      const pointIndex = nonNegativeInteger(entry, `${path}.participantPeriods[${index}].sourcePointIndexes[${itemIndex}]`);
      if (pointIndex >= points.length) contractError(`${path}.participantPeriods[${index}].sourcePointIndexes[${itemIndex}]`, "is outside the point table");
    });
    if (typeof row.includedInCohort !== "boolean") contractError(`${path}.participantPeriods[${index}].includedInCohort`, "must be boolean");
  });
  trajectory.centroids.forEach((candidate, index) => {
    const row = objectAt(candidate, `${path}.centroids[${index}]`);
    exactFields(row, ["index", "group", "time", "coordinates", "fullCoordinates", "participantCount", "participantPeriodIndexes"], `${path}.centroids[${index}]`);
    if (nonNegativeInteger(row.index, `${path}.centroids[${index}].index`) !== index) contractError(`${path}.centroids[${index}].index`, "must equal its array position");
    if (!groups.includes(assertRawTypedValue(row.group, `${path}.centroids[${index}].group`).canonical)) contractError(`${path}.centroids[${index}].group`, "must occur in groupOrder");
    if (!times.includes(assertRawTypedValue(row.time, `${path}.centroids[${index}].time`).canonical)) contractError(`${path}.centroids[${index}].time`, "must occur in timeOrder");
    finiteVector(row.coordinates, `${path}.centroids[${index}].coordinates`, 3);
    finiteVector(row.fullCoordinates, `${path}.centroids[${index}].fullCoordinates`, dimensions.length);
    positiveInteger(row.participantCount, `${path}.centroids[${index}].participantCount`);
    if (!Array.isArray(row.participantPeriodIndexes) || row.participantPeriodIndexes.length !== row.participantCount) contractError(`${path}.centroids[${index}].participantPeriodIndexes`, "must align with participantCount");
    row.participantPeriodIndexes.forEach((entry, itemIndex) => {
      const participantPeriodIndex = nonNegativeInteger(entry, `${path}.centroids[${index}].participantPeriodIndexes[${itemIndex}]`);
      if (participantPeriodIndex >= (trajectory.participantPeriods as unknown[]).length) contractError(`${path}.centroids[${index}].participantPeriodIndexes[${itemIndex}]`, "is outside the participant-period table");
    });
  });
  trajectory.paths.forEach((candidate, index) => {
    const row = objectAt(candidate, `${path}.paths[${index}]`);
    exactFields(row, ["group", "steps"], `${path}.paths[${index}]`);
    const group = assertRawTypedValue(row.group, `${path}.paths[${index}].group`).canonical;
    if (group !== groups[index]) contractError(`${path}.paths[${index}].group`, "must preserve groupOrder");
    if (!Array.isArray(row.steps) || row.steps.length !== times.length) contractError(`${path}.paths[${index}].steps`, "must contain every expected time in order");
    row.steps.forEach((candidateStep, stepIndex) => {
      const step = objectAt(candidateStep, `${path}.paths[${index}].steps[${stepIndex}]`);
      exactFields(step, ["time", "centroidIndex"], `${path}.paths[${index}].steps[${stepIndex}]`);
      if (assertRawTypedValue(step.time, `${path}.paths[${index}].steps[${stepIndex}].time`).canonical !== times[stepIndex]) contractError(`${path}.paths[${index}].steps[${stepIndex}].time`, "must preserve timeOrder");
      if (step.centroidIndex !== null) {
        const centroidIndex = nonNegativeInteger(step.centroidIndex, `${path}.paths[${index}].steps[${stepIndex}].centroidIndex`);
        if (centroidIndex >= (trajectory.centroids as unknown[]).length) contractError(`${path}.paths[${index}].steps[${stepIndex}].centroidIndex`, "is outside the centroid table");
      }
    });
  });
}

function assertAnalysisProvenance(value: unknown, path: string): void {
  const provenance = objectAt(value, path);
  exactFields(provenance, ["adapter", "adapterVersion", "jenaPackage", "jenaVersion", "jenaCommit", "coreGoldenContract", "legacyGoldenContract", "legacyGoldenStatus", "parityContract", "resultSemantics", "resolvedConfig", "resolvedLimits"], path);
  if (provenance.adapter !== "@3dena/analysis" || provenance.jenaPackage !== "jena-js") contractError(path, "contains an unsupported analysis adapter identity");
  nonEmptyString(provenance.adapterVersion, `${path}.adapterVersion`);
  for (const field of ["jenaVersion", "jenaCommit", "coreGoldenContract", "legacyGoldenContract", "parityContract", "resultSemantics"] as const) nonEmptyString(provenance[field], `${path}.${field}`);
  if (provenance.legacyGoldenStatus !== "not-assessed") contractError(`${path}.legacyGoldenStatus`, "must remain not-assessed in the scientific DTO");
  const config = objectAt(provenance.resolvedConfig, `${path}.resolvedConfig`);
  exactFields(config, ["model", "window", "weightBy", "windowSizeBack", "windowSizeForward", "centerAlignToOrigin"], `${path}.resolvedConfig`);
  if (!(config.model === "EndPoint" || config.model === "AccumulatedTrajectory" || config.model === "SeparateTrajectory")) contractError(`${path}.resolvedConfig.model`, "is unsupported");
  if (!(config.window === "MovingStanzaWindow" || config.window === "Conversation")) contractError(`${path}.resolvedConfig.window`, "is unsupported");
  if (config.weightBy !== "binary" && config.weightBy !== "sum") contractError(`${path}.resolvedConfig.weightBy`, "is unsupported");
  if (config.windowSizeBack === "Infinity") {
    if (config.window !== "Conversation") contractError(`${path}.resolvedConfig.windowSizeBack`, "may be Infinity only for Conversation windows");
  } else {
    nonNegativeInteger(config.windowSizeBack, `${path}.resolvedConfig.windowSizeBack`);
  }
  nonNegativeInteger(config.windowSizeForward, `${path}.resolvedConfig.windowSizeForward`);
  if (typeof config.centerAlignToOrigin !== "boolean") contractError(`${path}.resolvedConfig.centerAlignToOrigin`, "must be boolean");
  const limits = objectAt(provenance.resolvedLimits, `${path}.resolvedLimits`);
  exactFields(limits, ["maxRows", "maxColumns", "maxCells", "maxAccumulationCells", "maxCodes", "maxEdges", "maxStringLength", "maxUnits", "maxGroups", "maxTimePoints", "maxOutputPoints", "maxDimensions", "maxCoordinateCells"], `${path}.resolvedLimits`);
  for (const field of Object.keys(limits)) positiveInteger(limits[field], `${path}.resolvedLimits.${field}`);
}

function assertNetworkMean(value: unknown, dimensions: number, path: string): { edgeColumns: string[] } {
  const mean = objectAt(value, path);
  exactFields(mean, ["pointCount", "pointIndexes", "meanCoordinates", "edges"], path);
  const pointCount = positiveInteger(mean.pointCount, `${path}.pointCount`);
  if (!Array.isArray(mean.pointIndexes) || mean.pointIndexes.length !== pointCount) contractError(`${path}.pointIndexes`, "must align with pointCount");
  mean.pointIndexes.forEach((entry, index) => nonNegativeInteger(entry, `${path}.pointIndexes[${index}]`));
  finiteVector(mean.meanCoordinates, `${path}.meanCoordinates`, dimensions);
  if (!Array.isArray(mean.edges) || mean.edges.length === 0) contractError(`${path}.edges`, "must be a non-empty array");
  const edgeColumns: string[] = [];
  mean.edges.forEach((candidate, index) => {
    const edge = objectAt(candidate, `${path}.edges[${index}]`);
    exactFields(edge, ["index", "id", "column", "source", "target", "meanWeight"], `${path}.edges[${index}]`);
    if (nonNegativeInteger(edge.index, `${path}.edges[${index}].index`) !== index) contractError(`${path}.edges[${index}].index`, "must equal its array position");
    nonEmptyString(edge.id, `${path}.edges[${index}].id`);
    edgeColumns.push(nonEmptyString(edge.column, `${path}.edges[${index}].column`));
    nonEmptyString(edge.source, `${path}.edges[${index}].source`);
    nonEmptyString(edge.target, `${path}.edges[${index}].target`);
    finiteNumber(edge.meanWeight, `${path}.edges[${index}].meanWeight`);
  });
  return { edgeColumns };
}

function assertNetworkComparison(value: unknown, path: string): void {
  const result = objectAt(value, path);
  exactFields(result, ["schemaVersion", "direction", "groupA", "groupB", "meanA", "meanB", "differenceEdges", "diagnostics"], path);
  if (result.schemaVersion !== "3dena.network-comparison.v1" || result.direction !== "group-a-minus-group-b") contractError(path, "contains an unsupported network-comparison contract");
  const groupA = assertRawTypedValue(result.groupA, `${path}.groupA`).canonical;
  const groupB = assertRawTypedValue(result.groupB, `${path}.groupB`).canonical;
  if (groupA === groupB) contractError(path, "groupA and groupB must differ");
  const meanA = objectAt(result.meanA, `${path}.meanA`);
  if (!Array.isArray(meanA.meanCoordinates)) contractError(`${path}.meanA.meanCoordinates`, "must be an array");
  const dimensions = meanA.meanCoordinates.length;
  if (dimensions < 1) contractError(`${path}.meanA.meanCoordinates`, "must not be empty");
  const a = assertNetworkMean(result.meanA, dimensions, `${path}.meanA`);
  const b = assertNetworkMean(result.meanB, dimensions, `${path}.meanB`);
  sameOrderedStrings(b.edgeColumns, a.edgeColumns, `${path}.meanB.edges`);
  if (!Array.isArray(result.differenceEdges) || result.differenceEdges.length !== a.edgeColumns.length) contractError(`${path}.differenceEdges`, "must align with the group mean edges");
  result.differenceEdges.forEach((candidate, index) => {
    const edge = objectAt(candidate, `${path}.differenceEdges[${index}]`);
    exactFields(edge, ["index", "id", "column", "source", "target", "meanWeight", "groupAMeanWeight", "groupBMeanWeight", "semanticOwner"], `${path}.differenceEdges[${index}]`);
    if (nonNegativeInteger(edge.index, `${path}.differenceEdges[${index}].index`) !== index || edge.column !== a.edgeColumns[index]) contractError(`${path}.differenceEdges[${index}]`, "must preserve edge order");
    for (const field of ["id", "column", "source", "target"] as const) nonEmptyString(edge[field], `${path}.differenceEdges[${index}].${field}`);
    const difference = finiteNumber(edge.meanWeight, `${path}.differenceEdges[${index}].meanWeight`);
    const groupAMean = finiteNumber(edge.groupAMeanWeight, `${path}.differenceEdges[${index}].groupAMeanWeight`);
    const groupBMean = finiteNumber(edge.groupBMeanWeight, `${path}.differenceEdges[${index}].groupBMeanWeight`);
    if (Math.abs(difference - (groupAMean - groupBMean)) > Number.EPSILON * Math.max(1, Math.abs(difference), Math.abs(groupAMean), Math.abs(groupBMean)) * 8) contractError(`${path}.differenceEdges[${index}].meanWeight`, "must equal group A mean minus group B mean");
    const owner = difference > 0 ? "group-a" : difference < 0 ? "group-b" : "equal";
    if (edge.semanticOwner !== owner) contractError(`${path}.differenceEdges[${index}].semanticOwner`, "does not match the signed difference");
  });
  assertDiagnostics(result.diagnostics, `${path}.diagnostics`);
}

function assertChangeNetwork(value: unknown, path: string): void {
  const result = objectAt(value, path);
  exactFields(result, ["schemaVersion", "selector", "levelCanonical", "mean", "diagnostics"], path);
  if (result.schemaVersion !== "3dena.change-network.v1") contractError(`${path}.schemaVersion`, "must be 3dena.change-network.v1");
  const selector = objectAt(result.selector, `${path}.selector`);
  exactFields(selector, ["field", "level"], `${path}.selector`);
  nonEmptyString(selector.field, `${path}.selector.field`);
  rawScalar(selector.level, `${path}.selector.level`);
  nonEmptyString(result.levelCanonical, `${path}.levelCanonical`);
  const mean = objectAt(result.mean, `${path}.mean`);
  if (!Array.isArray(mean.meanCoordinates) || mean.meanCoordinates.length < 1) contractError(`${path}.mean.meanCoordinates`, "must be a non-empty array");
  assertNetworkMean(result.mean, mean.meanCoordinates.length, `${path}.mean`);
  assertDiagnostics(result.diagnostics, `${path}.diagnostics`);
}

function assertStatsContract(value: unknown, path: string): void {
  const contract = objectAt(value, path);
  const expected = {
    schemaVersion: "3dena.stats.contract.v1", direction: "A-minus-B", missing: "drop-explicit-null", ties: "exact-value-midrank",
    signedRankZeros: "drop-exact-zero", rankInference: "asymptotic-normal", continuityCorrection: true,
    independentCohenD: "pooled-sample-standard-deviation", pairedCohenD: "mean-paired-difference-over-sample-sd",
    meanDifferenceConfidenceInterval: "alternative-aligned-t-interval-95-percent", pValueAdjustmentFamily: "caller-supplied-complete-family",
  } as const;
  exactFields(contract, Object.keys(expected), path);
  for (const [field, expectedValue] of Object.entries(expected)) if (contract[field] !== expectedValue) contractError(`${path}.${field}`, `must be ${JSON.stringify(expectedValue)}`);
}

function probability(value: unknown, path: string): number {
  const number = finiteNumber(value, path);
  if (number < 0 || number > 1) contractError(path, "must be in [0, 1]");
  return number;
}

function assertConfidenceBound(value: unknown, path: string): void {
  const bound = objectAt(value, path);
  const kind = nonEmptyString(bound.kind, `${path}.kind`);
  if (kind === "finite") {
    exactFields(bound, ["kind", "value"], path);
    finiteNumber(bound.value, `${path}.value`);
  } else if (["negative-infinity", "positive-infinity", "undefined", "unrepresentable"].includes(kind)) {
    exactFields(bound, ["kind"], path);
  } else contractError(`${path}.kind`, "is unsupported");
}

function assertConfidenceInterval(value: unknown, path: string): void {
  const interval = objectAt(value, path);
  exactFields(interval, ["method", "confidenceLevel", "alternative", "lower", "upper"], path);
  if (interval.method !== "welch-t-mean-difference-v1" && interval.method !== "paired-t-mean-difference-v1") contractError(`${path}.method`, "is unsupported");
  if (interval.confidenceLevel !== 0.95) contractError(`${path}.confidenceLevel`, "must be 0.95");
  if (!["two-sided", "greater", "less"].includes(interval.alternative as string)) contractError(`${path}.alternative`, "is unsupported");
  assertConfidenceBound(interval.lower, `${path}.lower`);
  assertConfidenceBound(interval.upper, `${path}.upper`);
}

function assertAdjustment(value: unknown, path: string): void {
  const adjustment = objectAt(value, path);
  exactFields(adjustment, ["method", "raw", "adjusted"], path);
  if (!["none", "holm", "bh", "bonferroni"].includes(adjustment.method as string)) contractError(`${path}.method`, "is unsupported");
  if (!Array.isArray(adjustment.raw) || !Array.isArray(adjustment.adjusted) || adjustment.raw.length !== adjustment.adjusted.length || adjustment.raw.length === 0) contractError(path, "raw and adjusted p-value families must be non-empty and aligned");
  adjustment.raw.forEach((entry, index) => probability(entry, `${path}.raw[${index}]`));
  adjustment.adjusted.forEach((entry, index) => probability(entry, `${path}.adjusted[${index}]`));
}

function assertStatsResult(value: unknown, expectedDesign: "independent" | "paired", path: string): void {
  const result = objectAt(value, path);
  if (expectedDesign === "independent") {
    exactFields(result, ["schemaVersion", "design", "direction", "contract", "alternative", "samples", "estimates", "welch", "mannWhitney", "effects", "adjustment", "diagnostics"], path);
    if (result.schemaVersion !== "3dena.stats.independent-result.v1" || result.design !== "independent") contractError(path, "must be an independent statistics result");
    const samples = objectAt(result.samples, `${path}.samples`);
    exactFields(samples, ["sideA", "sideB"], `${path}.samples`);
    for (const side of ["sideA", "sideB"] as const) {
      const sample = objectAt(samples[side], `${path}.samples.${side}`);
      exactFields(sample, ["label", "input", "valid", "droppedMissing"], `${path}.samples.${side}`);
      nonEmptyString(sample.label, `${path}.samples.${side}.label`);
      const input = positiveInteger(sample.input, `${path}.samples.${side}.input`);
      const valid = positiveInteger(sample.valid, `${path}.samples.${side}.valid`);
      const dropped = nonNegativeInteger(sample.droppedMissing, `${path}.samples.${side}.droppedMissing`);
      if (valid + dropped !== input) contractError(`${path}.samples.${side}`, "valid plus droppedMissing must equal input");
    }
    const estimates = objectAt(result.estimates, `${path}.estimates`);
    exactFields(estimates, ["meanA", "meanB", "meanDifference", "confidenceInterval"], `${path}.estimates`);
    finiteNumber(estimates.meanA, `${path}.estimates.meanA`); finiteNumber(estimates.meanB, `${path}.estimates.meanB`); finiteOrNull(estimates.meanDifference, `${path}.estimates.meanDifference`); assertConfidenceInterval(estimates.confidenceInterval, `${path}.estimates.confidenceInterval`);
    const welch = objectAt(result.welch, `${path}.welch`);
    exactFields(welch, ["method", "alternative", "statistic", "degreesOfFreedom", "pValue"], `${path}.welch`);
    if (welch.method !== "welch-t-v1") contractError(`${path}.welch.method`, "must be welch-t-v1");
    finiteOrNull(welch.statistic, `${path}.welch.statistic`); finiteOrNull(welch.degreesOfFreedom, `${path}.welch.degreesOfFreedom`); probability(welch.pValue, `${path}.welch.pValue`);
    const mann = objectAt(result.mannWhitney, `${path}.mannWhitney`);
    exactFields(mann, ["method", "alternative", "tiePolicy", "continuityCorrection", "uA", "uB", "z", "pValue", "tieGroups", "tiedObservations"], `${path}.mannWhitney`);
    if (mann.method !== "mann-whitney-asymptotic-v1" || mann.tiePolicy !== "exact-value-midrank" || mann.continuityCorrection !== true) contractError(`${path}.mannWhitney`, "contains unsupported rank-test semantics");
    for (const field of ["uA", "uB", "z"] as const) finiteNumber(mann[field], `${path}.mannWhitney.${field}`);
    probability(mann.pValue, `${path}.mannWhitney.pValue`); nonNegativeInteger(mann.tieGroups, `${path}.mannWhitney.tieGroups`); nonNegativeInteger(mann.tiedObservations, `${path}.mannWhitney.tiedObservations`);
  } else {
    exactFields(result, ["schemaVersion", "design", "direction", "contract", "alternative", "matching", "estimates", "wilcoxonSignedRank", "effects", "adjustment", "diagnostics"], path);
    if (result.schemaVersion !== "3dena.stats.paired-result.v1" || result.design !== "paired") contractError(path, "must be a paired statistics result");
    const matching = objectAt(result.matching, `${path}.matching`);
    exactFields(matching, ["sideAInput", "sideBInput", "matched", "validPairs", "droppedMissingPairs", "unmatchedA", "unmatchedB", "zeroDifferences", "rankedPairs"], `${path}.matching`);
    for (const field of Object.keys(matching)) nonNegativeInteger(matching[field], `${path}.matching.${field}`);
    if (matching.matched !== (matching.validPairs as number) + (matching.droppedMissingPairs as number) || matching.rankedPairs !== (matching.validPairs as number) - (matching.zeroDifferences as number)) contractError(`${path}.matching`, "pair counts are inconsistent");
    const estimates = objectAt(result.estimates, `${path}.estimates`);
    exactFields(estimates, ["meanDifference", "confidenceInterval"], `${path}.estimates`);
    finiteOrNull(estimates.meanDifference, `${path}.estimates.meanDifference`); assertConfidenceInterval(estimates.confidenceInterval, `${path}.estimates.confidenceInterval`);
    const signed = objectAt(result.wilcoxonSignedRank, `${path}.wilcoxonSignedRank`);
    exactFields(signed, ["method", "alternative", "tiePolicy", "zeroPolicy", "continuityCorrection", "statistic", "wPositive", "wNegative", "z", "pValue", "tieGroups", "tiedObservations"], `${path}.wilcoxonSignedRank`);
    if (signed.method !== "wilcoxon-signed-rank-asymptotic-v1" || signed.tiePolicy !== "exact-absolute-difference-midrank" || signed.zeroPolicy !== "drop-exact-zero" || signed.continuityCorrection !== true) contractError(`${path}.wilcoxonSignedRank`, "contains unsupported signed-rank semantics");
    for (const field of ["statistic", "wPositive", "wNegative", "z"] as const) finiteNumber(signed[field], `${path}.wilcoxonSignedRank.${field}`);
    probability(signed.pValue, `${path}.wilcoxonSignedRank.pValue`); nonNegativeInteger(signed.tieGroups, `${path}.wilcoxonSignedRank.tieGroups`); nonNegativeInteger(signed.tiedObservations, `${path}.wilcoxonSignedRank.tiedObservations`);
  }
  if (result.direction !== "A-minus-B") contractError(`${path}.direction`, "must be A-minus-B");
  if (!["two-sided", "greater", "less"].includes(result.alternative as string)) contractError(`${path}.alternative`, "is unsupported");
  assertStatsContract(result.contract, `${path}.contract`);
  const effects = objectAt(result.effects, `${path}.effects`);
  exactFields(effects, ["cohensD", "rankBiserial"], `${path}.effects`);
  finiteOrNull(effects.cohensD, `${path}.effects.cohensD`); finiteNumber(effects.rankBiserial, `${path}.effects.rankBiserial`);
  assertAdjustment(result.adjustment, `${path}.adjustment`);
  assertDiagnostics(result.diagnostics, `${path}.diagnostics`);
}

function assertStatisticsTaskResult(value: unknown, path: string): void {
  const result = objectAt(value, path);
  exactFields(result, ["schemaVersion", "design", "direction", "groups", "dimensions"], path);
  if (result.schemaVersion !== "3dena.statistics-task-result.v1") contractError(`${path}.schemaVersion`, "must be 3dena.statistics-task-result.v1");
  if (result.design !== "independent" && result.design !== "paired") contractError(`${path}.design`, "must be independent or paired");
  if (result.direction !== "group-a-minus-group-b") contractError(`${path}.direction`, "must be group-a-minus-group-b");
  stringPair(result.groups, `${path}.groups`);
  if (!Array.isArray(result.dimensions) || result.dimensions.length === 0) contractError(`${path}.dimensions`, "must be non-empty");
  const seen = new Set<string>();
  result.dimensions.forEach((candidate, index) => {
    const dimension = objectAt(candidate, `${path}.dimensions[${index}]`);
    exactFields(dimension, ["dimension", "result"], `${path}.dimensions[${index}]`);
    const name = nonEmptyString(dimension.dimension, `${path}.dimensions[${index}].dimension`);
    if (seen.has(name)) contractError(`${path}.dimensions[${index}].dimension`, "duplicates an earlier dimension");
    seen.add(name);
    assertStatsResult(dimension.result, result.design as "independent" | "paired", `${path}.dimensions[${index}].result`);
  });
}

function assertTrajectoryIdentity(value: unknown, path: string, key: boolean): string | null {
  const identity = objectAt(value, path);
  allowedFields(identity, key ? ["components", "canonical", "display"] : ["components"], key ? ["components", "canonical", "display"] : ["components"], path);
  if (!Array.isArray(identity.components) || identity.components.length === 0) contractError(`${path}.components`, "must be non-empty");
  const names = new Set<string>();
  identity.components.forEach((candidate, index) => {
    const component = objectAt(candidate, `${path}.components[${index}]`);
    allowedFields(component, ["name", "type", "value", "declaredType"], ["name", "type", "value"], `${path}.components[${index}]`);
    const name = nonEmptyString(component.name, `${path}.components[${index}].name`);
    if (names.has(name)) contractError(`${path}.components[${index}].name`, "duplicates an earlier component"); names.add(name);
    if (!["string", "number", "boolean"].includes(component.type as string)) contractError(`${path}.components[${index}].type`, "is unsupported");
    if (component.type === "string" && (typeof component.value !== "string" || component.value.length === 0)) contractError(`${path}.components[${index}].value`, "must be a non-empty string");
    if (component.type === "boolean" && typeof component.value !== "boolean") contractError(`${path}.components[${index}].value`, "must be boolean");
    if (component.type === "number") rawScalar(component.value, `${path}.components[${index}].value`);
    if (component.declaredType !== undefined) nonEmptyString(component.declaredType, `${path}.components[${index}].declaredType`);
  });
  if (!key) return null;
  nonEmptyString(identity.display, `${path}.display`);
  return nonEmptyString(identity.canonical, `${path}.canonical`);
}

function assertDistanceMetrics(value: unknown, dimensions: string[], path: string, includeSpeed: boolean): void {
  const metrics = objectAt(value, path);
  const fields = includeSpeed ? ["dimensions", "delta", "stepDistance", "cumulativeDistance", "speed"] : ["dimensions", "delta", "stepDistance", "cumulativeDistance"];
  exactFields(metrics, fields, path);
  sameOrderedStrings(stringList(metrics.dimensions, `${path}.dimensions`), dimensions, `${path}.dimensions`);
  if (metrics.delta !== null) finiteVector(metrics.delta, `${path}.delta`, dimensions.length);
  finiteOrNull(metrics.stepDistance, `${path}.stepDistance`); finiteOrNull(metrics.cumulativeDistance, `${path}.cumulativeDistance`);
  if (includeSpeed) finiteOrNull(metrics.speed, `${path}.speed`);
}

function assertTrajectoryPathStatistics(value: unknown, path: string): void {
  const result = objectAt(value, path);
  exactFields(result, ["schemaVersion", "namespace", "cohortPolicy", "estimand", "dimensions", "selectedDimensions", "distanceSemantics", "participantPeriods", "periods", "diagnostics", "summary", "resolvedLimits"], path);
  if (result.schemaVersion !== "3dena.trajectory-path-statistics.v1") contractError(`${path}.schemaVersion`, "must be 3dena.trajectory-path-statistics.v1");
  nonEmptyString(result.namespace, `${path}.namespace`);
  if (result.cohortPolicy !== "available" && result.cohortPolicy !== "complete") contractError(`${path}.cohortPolicy`, "is unsupported");
  if (result.estimand !== "equal-participant" && result.estimand !== "weighted-participant") contractError(`${path}.estimand`, "is unsupported");
  const dimensions = stringList(result.dimensions, `${path}.dimensions`);
  const selected = stringList(result.selectedDimensions, `${path}.selectedDimensions`, 3);
  if (selected.length !== 3 || selected.some((entry) => !dimensions.includes(entry))) contractError(`${path}.selectedDimensions`, "must contain three declared dimensions");
  const semantics = objectAt(result.distanceSemantics, `${path}.distanceSemantics`);
  exactFields(semantics, ["selected3d", "fullSpace"], `${path}.distanceSemantics`);
  if (semantics.selected3d !== "euclidean-selected-three-dimensions" || semantics.fullSpace !== "euclidean-all-declared-dimensions") contractError(`${path}.distanceSemantics`, "is unsupported");
  assertTrajectoryParticipantPeriods(result.participantPeriods, dimensions, `${path}.participantPeriods`, true);
  if (!Array.isArray(result.periods)) contractError(`${path}.periods`, "must be an array");
  result.periods.forEach((candidate, index) => {
    const period = objectAt(candidate, `${path}.periods[${index}]`);
    exactFields(period, ["index", "time", "selectedCentroid", "fullCentroid", "selected3d", "fullSpace", "nRows", "nTotal", "nUsed", "nDuplicateRows", "nCohortExcluded"], `${path}.periods[${index}]`);
    if (nonNegativeInteger(period.index, `${path}.periods[${index}].index`) !== index) contractError(`${path}.periods[${index}].index`, "must equal its array position");
    assertTrajectoryIdentity(period.time, `${path}.periods[${index}].time`, true);
    optionalFiniteVector(period.selectedCentroid, `${path}.periods[${index}].selectedCentroid`, 3);
    optionalFiniteVector(period.fullCentroid, `${path}.periods[${index}].fullCentroid`, dimensions.length);
    assertDistanceMetrics(period.selected3d, selected, `${path}.periods[${index}].selected3d`, false);
    assertDistanceMetrics(period.fullSpace, dimensions, `${path}.periods[${index}].fullSpace`, false);
    for (const field of ["nRows", "nTotal", "nUsed", "nDuplicateRows", "nCohortExcluded"] as const) nonNegativeInteger(period[field], `${path}.periods[${index}].${field}`);
  });
  assertDiagnostics(result.diagnostics, `${path}.diagnostics`);
  assertTrajectorySummary(result.summary, `${path}.summary`, false);
  assertLimits(result.resolvedLimits, ["maxPoints", "maxDimensions", "maxPeriods", "maxParticipants", "maxCells", "maxResamples", "maxTests"], `${path}.resolvedLimits`);
}

function assertTrajectoryParticipantPeriods(value: unknown, dimensions: string[], path: string, weighted: boolean): void {
  if (!Array.isArray(value)) contractError(path, "must be an array");
  value.forEach((candidate, index) => {
    const row = objectAt(candidate, `${path}[${index}]`);
    const fields = weighted ? ["index", "participant", "time", "selectedCoordinates", "fullCoordinates", "sourceRowIndexes", "participantWeight", "includedInCohort"] : ["index", "participant", "time", "selectedCoordinates", "fullCoordinates", "sourceRowIndexes", "includedInCohort"];
    exactFields(row, fields, `${path}[${index}]`);
    if (nonNegativeInteger(row.index, `${path}[${index}].index`) !== index) contractError(`${path}[${index}].index`, "must equal its array position");
    assertTrajectoryIdentity(row.participant, `${path}[${index}].participant`, true); assertTrajectoryIdentity(row.time, `${path}[${index}].time`, true);
    finiteVector(row.selectedCoordinates, `${path}[${index}].selectedCoordinates`, 3); finiteVector(row.fullCoordinates, `${path}[${index}].fullCoordinates`, dimensions.length);
    if (!Array.isArray(row.sourceRowIndexes) || row.sourceRowIndexes.length === 0) contractError(`${path}[${index}].sourceRowIndexes`, "must be non-empty");
    row.sourceRowIndexes.forEach((entry, itemIndex) => nonNegativeInteger(entry, `${path}[${index}].sourceRowIndexes[${itemIndex}]`));
    if (weighted && finiteNumber(row.participantWeight, `${path}[${index}].participantWeight`) <= 0) contractError(`${path}[${index}].participantWeight`, "must be positive");
    if (typeof row.includedInCohort !== "boolean") contractError(`${path}[${index}].includedInCohort`, "must be boolean");
  });
}

function assertTrajectorySummary(value: unknown, path: string, dynamics: boolean): void {
  const summary = objectAt(value, path);
  const fields = dynamics ? ["inputRows", "participants", "participantPeriods", "periods", "observedPeriods", "missingPeriods", "duplicateRows", "cohortExcludedParticipants"] : ["inputRows", "participants", "participantPeriods", "periods", "duplicateRows"];
  exactFields(summary, fields, path);
  for (const field of fields) nonNegativeInteger(summary[field], `${path}.${field}`);
  if (dynamics && summary.periods !== (summary.observedPeriods as number) + (summary.missingPeriods as number)) contractError(path, "observed and missing period counts must sum to periods");
}

function assertLimits(value: unknown, fields: readonly string[], path: string): void {
  const limits = objectAt(value, path); exactFields(limits, fields, path); for (const field of fields) positiveInteger(limits[field], `${path}.${field}`);
}

function assertTrajectoryDynamics(value: unknown, path: string): void {
  const result = objectAt(value, path);
  exactFields(result, ["schemaVersion", "namespace", "cohortPolicy", "estimand", "dimensions", "selectedDimensions", "timeContract", "contracts", "participantPeriods", "periods", "diagnostics", "diagnosticSummary", "summary", "evidence", "resolvedLimits"], path);
  if (result.schemaVersion !== "3dena.trajectory-dynamics.v1") contractError(`${path}.schemaVersion`, "must be 3dena.trajectory-dynamics.v1");
  nonEmptyString(result.namespace, `${path}.namespace`);
  if (result.cohortPolicy !== "available" && result.cohortPolicy !== "complete") contractError(`${path}.cohortPolicy`, "is unsupported");
  const estimand = objectAt(result.estimand, `${path}.estimand`); exactFields(estimand, ["kind"], `${path}.estimand`);
  if (estimand.kind !== "equal-participant-v1" && estimand.kind !== "weighted-participant-v1") contractError(`${path}.estimand.kind`, "is unsupported");
  const dimensions = stringList(result.dimensions, `${path}.dimensions`); const selected = stringList(result.selectedDimensions, `${path}.selectedDimensions`, 3);
  if (selected.length !== 3 || selected.some((entry) => !dimensions.includes(entry))) contractError(`${path}.selectedDimensions`, "must contain three declared dimensions");
  assertTimeContract(result.timeContract, `${path}.timeContract`);
  const contracts = objectAt(result.contracts, `${path}.contracts`);
  const expectedContracts = { duplicateReduction: "equal-row-coordinate-mean-before-centroid-v1", weightResolution: "constant-within-participant-period-v1", cohort: "available-or-complete-before-centroid-v1", distance: "euclidean-selected-and-full-space-v1", gap: "expected-period-no-bridge-v1", speed: "step-distance-divided-by-positive-adjacent-elapsed-v1" } as const;
  exactFields(contracts, Object.keys(expectedContracts), `${path}.contracts`); for (const [field, expected] of Object.entries(expectedContracts)) if (contracts[field] !== expected) contractError(`${path}.contracts.${field}`, `must be ${expected}`);
  assertTrajectoryParticipantPeriods(result.participantPeriods, dimensions, `${path}.participantPeriods`, true);
  if (!Array.isArray(result.periods)) contractError(`${path}.periods`, "must be an array");
  result.periods.forEach((candidate, index) => {
    const period = objectAt(candidate, `${path}.periods[${index}]`);
    exactFields(period, ["index", "time", "timeValue", "elapsedFromPrevious", "elapsedFromStart", "selectedCentroid", "fullCentroid", "selected3d", "fullSpace", "nRows", "nParticipantPeriods", "nUsed", "nDuplicateRows", "nCohortExcluded", "weightSum", "effectiveParticipantN"], `${path}.periods[${index}]`);
    if (nonNegativeInteger(period.index, `${path}.periods[${index}].index`) !== index) contractError(`${path}.periods[${index}].index`, "must equal its array position");
    assertTrajectoryIdentity(period.time, `${path}.periods[${index}].time`, true); assertTrajectoryTimeValue(period.timeValue, `${path}.periods[${index}].timeValue`);
    finiteOrNull(period.elapsedFromPrevious, `${path}.periods[${index}].elapsedFromPrevious`); finiteNumber(period.elapsedFromStart, `${path}.periods[${index}].elapsedFromStart`);
    optionalFiniteVector(period.selectedCentroid, `${path}.periods[${index}].selectedCentroid`, 3); optionalFiniteVector(period.fullCentroid, `${path}.periods[${index}].fullCentroid`, dimensions.length);
    assertDistanceMetrics(period.selected3d, selected, `${path}.periods[${index}].selected3d`, true); assertDistanceMetrics(period.fullSpace, dimensions, `${path}.periods[${index}].fullSpace`, true);
    for (const field of ["nRows", "nParticipantPeriods", "nUsed", "nDuplicateRows", "nCohortExcluded"] as const) nonNegativeInteger(period[field], `${path}.periods[${index}].${field}`);
    finiteOrNull(period.weightSum, `${path}.periods[${index}].weightSum`); finiteOrNull(period.effectiveParticipantN, `${path}.periods[${index}].effectiveParticipantN`);
  });
  assertDiagnostics(result.diagnostics, `${path}.diagnostics`);
  const diagnosticSummary = objectAt(result.diagnosticSummary, `${path}.diagnosticSummary`); exactFields(diagnosticSummary, ["info", "warning", "codes"], `${path}.diagnosticSummary`); nonNegativeInteger(diagnosticSummary.info, `${path}.diagnosticSummary.info`); nonNegativeInteger(diagnosticSummary.warning, `${path}.diagnosticSummary.warning`); stringList(diagnosticSummary.codes, `${path}.diagnosticSummary.codes`, 0);
  assertTrajectorySummary(result.summary, `${path}.summary`, true);
  const evidence = objectAt(result.evidence, `${path}.evidence`); exactFields(evidence, ["status", "oracleParityClaim", "scientificAuthority"], `${path}.evidence`); if (evidence.status !== "IMPLEMENTED_UNVERIFIED" || evidence.oracleParityClaim !== false || evidence.scientificAuthority !== "successor-definition-pending-review") contractError(`${path}.evidence`, "must not claim unapproved scientific authority");
  assertLimits(result.resolvedLimits, ["maxPoints", "maxDimensions", "maxPeriods", "maxParticipants", "maxCells"], `${path}.resolvedLimits`);
}

function assertTimeContract(value: unknown, path: string): void {
  const contract = objectAt(value, path); const kind = nonEmptyString(contract.kind, `${path}.kind`);
  if (kind === "numeric-v1") { exactFields(contract, ["kind", "elapsedUnit", "chronology"], path); nonEmptyString(contract.elapsedUnit, `${path}.elapsedUnit`); if (contract.chronology !== "strictly-increasing-finite-number-v1") contractError(`${path}.chronology`, "is unsupported"); }
  else if (kind === "date-v1") { exactFields(contract, ["kind", "elapsedUnit", "calendar", "chronology"], path); if (contract.elapsedUnit !== "days" || contract.calendar !== "proleptic-gregorian-v1" || contract.chronology !== "strictly-increasing-civil-day-v1") contractError(path, "contains unsupported civil-date semantics"); }
  else if (kind === "instant-v1") { exactFields(contract, ["kind", "elapsedUnit", "epoch", "chronology", "zoneRole"], path); trajectoryDurationUnit(contract.elapsedUnit, `${path}.elapsedUnit`); if (contract.epoch !== "unix-epoch-milliseconds-int64-v1" || contract.chronology !== "strictly-increasing-exact-epoch-v1" || contract.zoneRole !== "presentation-provenance-only") contractError(path, "contains unsupported instant semantics"); }
  else if (kind === "difftime-v1") { exactFields(contract, ["kind", "elapsedUnit", "conversion", "chronology"], path); trajectoryDurationUnit(contract.elapsedUnit, `${path}.elapsedUnit`); if (contract.conversion !== "fixed-duration-unit-ratios-v1" || contract.chronology !== "strictly-increasing-normalized-duration-v1") contractError(path, "contains unsupported duration semantics"); }
  else contractError(`${path}.kind`, "is unsupported");
}

function assertTrajectoryComparison(value: unknown, path: string): void {
  const result = objectAt(value, path); exactFields(result, ["schemaVersion", "design", "direction", "pairedId", "sideA", "sideB", "periods", "tests", "permutation", "diagnostics"], path);
  if (result.schemaVersion !== "3dena.trajectory-comparison.v1" || (result.design !== "paired" && result.design !== "independent") || result.direction !== "B-minus-A") contractError(path, "contains an unsupported trajectory-comparison contract");
  if (result.design === "paired") { if (typeof result.pairedId !== "string" && (!Array.isArray(result.pairedId) || result.pairedId.length === 0)) contractError(`${path}.pairedId`, "must declare the exact paired identity"); }
  else if (result.pairedId !== null) contractError(`${path}.pairedId`, "must be null for independent comparison");
  assertTrajectoryPathStatistics(result.sideA, `${path}.sideA`); assertTrajectoryPathStatistics(result.sideB, `${path}.sideB`);
  const sideA = result.sideA as { dimensions: string[]; periods: unknown[] }; const sideB = result.sideB as { dimensions: string[]; periods: unknown[] };
  sameOrderedStrings(sideB.dimensions, sideA.dimensions, `${path}.sideB.dimensions`);
  if (!Array.isArray(result.periods) || result.periods.length !== sideA.periods.length || result.periods.length !== sideB.periods.length) contractError(`${path}.periods`, "must align one-to-one with both paths");
  const periods = result.periods;
  periods.forEach((candidate, index) => assertTrajectoryComparisonPeriod(candidate, sideA.dimensions.length, index, `${path}.periods[${index}]`));
  if (!Array.isArray(result.tests)) contractError(`${path}.tests`, "must be an array");
  result.tests.forEach((candidate, index) => {
    const test = objectAt(candidate, `${path}.tests[${index}]`); exactFields(test, ["id", "timeIndex", "metric", "distanceSpace", "tail", "observed", "pValue", "holmAdjustedPValue", "permutationCount"], `${path}.tests[${index}]`);
    nonEmptyString(test.id, `${path}.tests[${index}].id`); const timeIndex = nonNegativeInteger(test.timeIndex, `${path}.tests[${index}].timeIndex`); if (timeIndex >= periods.length) contractError(`${path}.tests[${index}].timeIndex`, "is outside the period table"); nonEmptyString(test.metric, `${path}.tests[${index}].metric`);
    if (test.distanceSpace !== null && test.distanceSpace !== "selected-3d" && test.distanceSpace !== "full-space") contractError(`${path}.tests[${index}].distanceSpace`, "is unsupported"); if (test.tail !== "two-sided" && test.tail !== "upper") contractError(`${path}.tests[${index}].tail`, "is unsupported"); finiteNumber(test.observed, `${path}.tests[${index}].observed`); probability(test.pValue, `${path}.tests[${index}].pValue`); probability(test.holmAdjustedPValue, `${path}.tests[${index}].holmAdjustedPValue`); positiveInteger(test.permutationCount, `${path}.tests[${index}].permutationCount`);
  });
  const permutation = objectAt(result.permutation, `${path}.permutation`); exactFields(permutation, ["status", "planKind", "unitOrder", "replicateCount", "rngParityClaim"], `${path}.permutation`); if (permutation.status !== "not-requested" && permutation.status !== "complete") contractError(`${path}.permutation.status`, "is unsupported"); if (permutation.planKind !== null && permutation.planKind !== "paired-swap-indices-v1" && permutation.planKind !== "independent-pool-indices-v1") contractError(`${path}.permutation.planKind`, "is unsupported"); stringList(permutation.unitOrder, `${path}.permutation.unitOrder`, 0); nonNegativeInteger(permutation.replicateCount, `${path}.permutation.replicateCount`); if (permutation.rngParityClaim !== false) contractError(`${path}.permutation.rngParityClaim`, "must remain false until independently approved");
  assertDiagnostics(result.diagnostics, `${path}.diagnostics`);
}

function assertTrajectoryComparisonPeriod(value: unknown, dimensions: number, index: number, path: string): void {
  const period = objectAt(value, path); exactFields(period, ["index", "time", "selectedCentroidA", "selectedCentroidB", "selectedDifference", "fullCentroidA", "fullCentroidB", "fullDifference", "selectedCentroidSeparation", "fullCentroidSeparation", "selectedStepDistanceA", "selectedStepDistanceB", "selectedStepDistanceDifference", "selectedCumulativeDistanceA", "selectedCumulativeDistanceB", "selectedCumulativeDistanceDifference", "fullStepDistanceA", "fullStepDistanceB", "fullStepDistanceDifference", "fullCumulativeDistanceA", "fullCumulativeDistanceB", "fullCumulativeDistanceDifference", "nAUsed", "nBUsed", "nMatched"], path);
  if (nonNegativeInteger(period.index, `${path}.index`) !== index) contractError(`${path}.index`, "must equal its array position"); assertTrajectoryIdentity(period.time, `${path}.time`, true);
  for (const field of ["selectedCentroidA", "selectedCentroidB", "selectedDifference"] as const) optionalFiniteVector(period[field], `${path}.${field}`, 3);
  for (const field of ["fullCentroidA", "fullCentroidB", "fullDifference"] as const) optionalFiniteVector(period[field], `${path}.${field}`, dimensions);
  for (const field of ["selectedCentroidSeparation", "fullCentroidSeparation", "selectedStepDistanceA", "selectedStepDistanceB", "selectedStepDistanceDifference", "selectedCumulativeDistanceA", "selectedCumulativeDistanceB", "selectedCumulativeDistanceDifference", "fullStepDistanceA", "fullStepDistanceB", "fullStepDistanceDifference", "fullCumulativeDistanceA", "fullCumulativeDistanceB", "fullCumulativeDistanceDifference"] as const) finiteOrNull(period[field], `${path}.${field}`);
  nonNegativeInteger(period.nAUsed, `${path}.nAUsed`); nonNegativeInteger(period.nBUsed, `${path}.nBUsed`); if (period.nMatched !== null) nonNegativeInteger(period.nMatched, `${path}.nMatched`);
}

function assertBootstrapInterval(value: unknown, path: string): void {
  const interval = objectAt(value, path); exactFields(interval, ["estimate", "lower", "upper", "finiteReplicates", "requiredFiniteReplicates", "totalReplicates"], path); finiteNumber(interval.estimate, `${path}.estimate`); finiteNumber(interval.lower, `${path}.lower`); finiteNumber(interval.upper, `${path}.upper`); if ((interval.lower as number) > (interval.upper as number)) contractError(path, "lower must not exceed upper"); const finite = nonNegativeInteger(interval.finiteReplicates, `${path}.finiteReplicates`); const required = positiveInteger(interval.requiredFiniteReplicates, `${path}.requiredFiniteReplicates`); const total = positiveInteger(interval.totalReplicates, `${path}.totalReplicates`); if (finite > total || required > total) contractError(path, "replicate counts are inconsistent");
}

function assertBootstrap(value: unknown, path: string): void {
  const result = objectAt(value, path); exactFields(result, ["schemaVersion", "base", "confidenceLevel", "periods", "quantileRule", "resampling", "diagnostics"], path); if (result.schemaVersion !== "3dena.trajectory-bootstrap.v1") contractError(`${path}.schemaVersion`, "must be 3dena.trajectory-bootstrap.v1"); assertTrajectoryPathStatistics(result.base, `${path}.base`); probability(result.confidenceLevel, `${path}.confidenceLevel`);
  const base = result.base as { dimensions: string[]; periods: unknown[] }; if (!Array.isArray(result.periods) || result.periods.length !== base.periods.length) contractError(`${path}.periods`, "must align one-to-one with the base path");
  result.periods.forEach((candidate, index) => { const period = objectAt(candidate, `${path}.periods[${index}]`); exactFields(period, ["index", "time", "selectedCentroid", "fullCentroid", "selectedStepDistance", "fullStepDistance", "selectedCumulativeDistance", "fullCumulativeDistance"], `${path}.periods[${index}]`); if (nonNegativeInteger(period.index, `${path}.periods[${index}].index`) !== index) contractError(`${path}.periods[${index}].index`, "must equal its array position"); assertTrajectoryIdentity(period.time, `${path}.periods[${index}].time`, true); for (const [field, length] of [["selectedCentroid", 3], ["fullCentroid", base.dimensions.length]] as const) { if (!Array.isArray(period[field]) || period[field].length !== length) contractError(`${path}.periods[${index}].${field}`, `must contain ${length} interval slots`); period[field].forEach((entry, itemIndex) => { if (entry !== null) assertBootstrapInterval(entry, `${path}.periods[${index}].${field}[${itemIndex}]`); }); } for (const field of ["selectedStepDistance", "fullStepDistance", "selectedCumulativeDistance", "fullCumulativeDistance"] as const) if (period[field] !== null) assertBootstrapInterval(period[field], `${path}.periods[${index}].${field}`); });
  const quantile = objectAt(result.quantileRule, `${path}.quantileRule`); const expectedQuantile = { id: "linear-type7-v1", sort: "ascending-numeric", position: "(n-1)*p", interpolation: "linear-between-floor-and-ceiling", endpoints: "p=0-min-p=1-max" } as const; exactFields(quantile, Object.keys(expectedQuantile), `${path}.quantileRule`); for (const [field, expected] of Object.entries(expectedQuantile)) if (quantile[field] !== expected) contractError(`${path}.quantileRule.${field}`, `must be ${expected}`);
  const resampling = objectAt(result.resampling, `${path}.resampling`); exactFields(resampling, ["unit", "stratified", "strata", "replicateCount", "planKind", "generation", "rngParityClaim"], `${path}.resampling`); if (resampling.unit !== "participant-complete-history" || !["participant-history-resample-indices-v1", "global-participant-history-resample-indices-v2"].includes(String(resampling.planKind)) || resampling.rngParityClaim !== false) contractError(`${path}.resampling`, "contains unsupported or unapproved resampling semantics"); if (typeof resampling.stratified !== "boolean") contractError(`${path}.resampling.stratified`, "must be boolean"); const replicateCount = positiveInteger(resampling.replicateCount, `${path}.resampling.replicateCount`); if (!Array.isArray(resampling.strata) || resampling.strata.length === 0) contractError(`${path}.resampling.strata`, "must be non-empty"); resampling.strata.forEach((candidate, index) => { const stratum = objectAt(candidate, `${path}.resampling.strata[${index}]`); exactFields(stratum, ["key", "unitCount"], `${path}.resampling.strata[${index}]`); assertTrajectoryIdentity(stratum.key, `${path}.resampling.strata[${index}].key`, true); positiveInteger(stratum.unitCount, `${path}.resampling.strata[${index}].unitCount`); }); const generation = objectAt(resampling.generation, `${path}.resampling.generation`); if (generation.kind === "caller-provided") exactFields(generation, ["kind"], `${path}.resampling.generation`); else { exactFields(generation, ["kind", "algorithm", "seed", "unitSort", "randomEndpoint"], `${path}.resampling.generation`); if (generation.kind !== "seeded" || generation.algorithm !== "mulberry32-uint32-v1" || generation.unitSort !== "utf16-code-unit-ascending" || generation.randomEndpoint !== "zero-inclusive-one-exclusive") contractError(`${path}.resampling.generation`, "contains unsupported seeded-generation semantics"); const seed = nonNegativeInteger(generation.seed, `${path}.resampling.generation.seed`); if (seed > 0xffff_ffff) contractError(`${path}.resampling.generation.seed`, "must fit uint32"); }
  result.periods.forEach((period) => { const candidate = period as Record<string, unknown>; for (const field of ["selectedStepDistance", "fullStepDistance", "selectedCumulativeDistance", "fullCumulativeDistance"] as const) { const interval = candidate[field] as Record<string, unknown> | null; if (interval && interval.totalReplicates !== replicateCount) contractError(`${path}.periods.${field}`, "must bind the declared replicate count"); } });
  assertDiagnostics(result.diagnostics, `${path}.diagnostics`);
}

/** Strict per-field validator for all seven public result variants. */
export function assertAnalysisTaskResultV1(value: unknown, taskKind: AnalysisTaskV1["kind"], path = "result"): asserts value is { schemaVersion: string } {
  switch (taskKind) {
    case "ena-model": assertAnalysisResult(value, path); return;
    case "prepared-import": assertPreparedDerivedSource(value as import("./prepared-types").PreparedSpaceResult); return;
    case "network-comparison": assertNetworkComparison(value, path); return;
    case "change-network": assertChangeNetwork(value, path); return;
    case "statistics": assertStatisticsTaskResult(value, path); return;
    case "trajectory": assertTrajectoryDynamics(value, path); return;
    case "trajectory-comparison": assertTrajectoryComparison(value, path); return;
    case "bootstrap": assertBootstrap(value, path); return;
    default: contractError("taskKind", "is unsupported");
  }
}

export function assertProvenanceManifestV1(value: unknown, path = "provenance"): asserts value is ProvenanceManifestV1 {
  const manifest = objectAt(value, path);
  exactFields(manifest, [
    "schemaVersion", "datasetHash", "specHash", "resultHash", "adapterVersion", "jenaPackage", "jenaVersion", "jenaCommit",
    "sourceKind", "jenaExecuted", "sdkPackage", "sdkVersion", "appVersion", "contractVersion", "buildId", "seed",
    "toleranceContract", "schemaVersions", "generatedAt",
  ], path);
  if (manifest.schemaVersion !== PROVENANCE_MANIFEST_VERSION_V1) contractError(`${path}.schemaVersion`, `must be ${PROVENANCE_MANIFEST_VERSION_V1}`);
  lowercaseSha256(manifest.datasetHash, `${path}.datasetHash`);
  lowercaseSha256(manifest.specHash, `${path}.specHash`);
  lowercaseSha256(manifest.resultHash, `${path}.resultHash`);
  for (const field of ["adapterVersion", "jenaVersion", "jenaCommit", "sdkVersion", "appVersion", "buildId"] as const) nonEmptyString(manifest[field], `${path}.${field}`);
  if (manifest.jenaPackage !== "jena-js") contractError(`${path}.jenaPackage`, "must be jena-js");
  if (manifest.sourceKind !== "raw-jena" && manifest.sourceKind !== "prepared-exchange") contractError(`${path}.sourceKind`, "must be raw-jena or prepared-exchange");
  if (typeof manifest.jenaExecuted !== "boolean") contractError(`${path}.jenaExecuted`, "must be boolean");
  if (manifest.sourceKind === "raw-jena" && manifest.jenaExecuted !== true) contractError(`${path}.jenaExecuted`, "must be true for raw-jena");
  if (manifest.sourceKind === "prepared-exchange" && manifest.jenaExecuted !== false) contractError(`${path}.jenaExecuted`, "must be false for prepared-exchange");
  if (manifest.sdkPackage !== "@3dena/analysis") contractError(`${path}.sdkPackage`, "must be @3dena/analysis");
  if (manifest.contractVersion !== ANALYSIS_CONTRACT_VERSION_V1) contractError(`${path}.contractVersion`, `must be ${ANALYSIS_CONTRACT_VERSION_V1}`);
  if (manifest.seed !== null && (!Number.isSafeInteger(manifest.seed) || (manifest.seed as number) < 0 || (manifest.seed as number) > 0xffff_ffff)) contractError(`${path}.seed`, "must be null or an unsigned 32-bit integer");
  if (manifest.toleranceContract !== null && (typeof manifest.toleranceContract !== "string" || manifest.toleranceContract.trim() === "")) contractError(`${path}.toleranceContract`, "must be null or non-empty");
  stringList(manifest.schemaVersions, `${path}.schemaVersions`);
  const generatedAt = nonEmptyString(manifest.generatedAt, `${path}.generatedAt`);
  if (Number.isNaN(Date.parse(generatedAt))) contractError(`${path}.generatedAt`, "must be an ISO timestamp");
}

const HASH_SCHEMA = { type: "string", pattern: "^[a-f0-9]{64}$" } as const;
const NON_EMPTY_STRING_SCHEMA = { type: "string", minLength: 1 } as const;
const RAW_SCALAR_SCHEMA = {
  oneOf: [
    { type: "null" },
    { type: "string" },
    { type: "boolean" },
    { type: "number" },
  ],
} as const;
const SAFE_NON_NEGATIVE_INTEGER_SCHEMA = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER } as const;
const SAFE_POSITIVE_INTEGER_SCHEMA = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER } as const;
const TASK_OWNER_SCHEMA_REF = { $ref: "https://3dena.com/schemas/task-owner.v1.json" } as const;
const TRAJECTORY_V2_IDENTITY_COMPONENT_SCHEMA = {
  oneOf: [
    { type: "object", additionalProperties: false, required: ["name", "type", "value"], properties: { name: NON_EMPTY_STRING_SCHEMA, type: { const: "string" }, value: { type: "string" }, declaredType: NON_EMPTY_STRING_SCHEMA } },
    { type: "object", additionalProperties: false, required: ["name", "type", "value"], properties: { name: NON_EMPTY_STRING_SCHEMA, type: { const: "number" }, value: { type: "number" }, declaredType: NON_EMPTY_STRING_SCHEMA } },
    { type: "object", additionalProperties: false, required: ["name", "type", "value"], properties: { name: NON_EMPTY_STRING_SCHEMA, type: { const: "boolean" }, value: { type: "boolean" }, declaredType: NON_EMPTY_STRING_SCHEMA } },
  ],
} as const;
const TRAJECTORY_V2_IDENTITY_SCHEMA = {
  type: "object", additionalProperties: false, required: ["components"],
  properties: { components: { type: "array", minItems: 1, items: TRAJECTORY_V2_IDENTITY_COMPONENT_SCHEMA } },
} as const;
const TRAJECTORY_V2_TIME_VALUE_SCHEMA = {
  oneOf: [
    { type: "object", additionalProperties: false, required: ["type", "index"], properties: { type: { const: "ordered-index-v2" }, index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA } },
    { type: "object", additionalProperties: false, required: ["type", "value", "unit"], properties: { type: { const: "numeric-v1" }, value: { type: "number" }, unit: NON_EMPTY_STRING_SCHEMA } },
    { type: "object", additionalProperties: false, required: ["type", "value"], properties: { type: { const: "date-v1" }, value: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" } } },
    { type: "object", additionalProperties: false, required: ["type", "epochMilliseconds", "timeZone", "offsetMinutes", "fold", "elapsedUnit"], properties: { type: { const: "instant-v1" }, epochMilliseconds: { type: "string", pattern: "^-?(?:0|[1-9][0-9]*)$" }, timeZone: NON_EMPTY_STRING_SCHEMA, offsetMinutes: { type: "integer", minimum: -1440, maximum: 1440 }, fold: { enum: [0, 1] }, elapsedUnit: { enum: [...TRAJECTORY_DURATION_UNITS] } } },
    { type: "object", additionalProperties: false, required: ["type", "value", "unit", "elapsedUnit"], properties: { type: { const: "difftime-v1" }, value: { type: "number" }, unit: { enum: [...TRAJECTORY_DURATION_UNITS] }, elapsedUnit: { enum: [...TRAJECTORY_DURATION_UNITS] } } },
  ],
} as const;
const TRAJECTORY_RUN_SPEC_V2_SCHEMA = {
  $id: "https://3dena.com/schemas/trajectory-run-spec.v2.json",
  type: "object", additionalProperties: false,
  required: ["schemaVersion", "sourceResultHash", "participantColumns", "timeColumn", "groupColumn", "orderedPeriods", "selectedDimensions", "cohortPolicy", "missingValuePolicy", "estimand"],
  properties: {
    schemaVersion: { const: "3dena.trajectory-run-spec.v2" }, sourceResultHash: HASH_SCHEMA,
    participantColumns: { type: "array", minItems: 1, uniqueItems: true, items: NON_EMPTY_STRING_SCHEMA },
    timeColumn: NON_EMPTY_STRING_SCHEMA, groupColumn: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] },
    orderedPeriods: {
      type: "array", minItems: 1,
      items: {
        type: "object", additionalProperties: false,
        required: ["identity", "sourceTimeCanonical", "displayLabel", "expected", "value"],
        properties: { identity: TRAJECTORY_V2_IDENTITY_SCHEMA, sourceTimeCanonical: NON_EMPTY_STRING_SCHEMA, displayLabel: NON_EMPTY_STRING_SCHEMA, expected: { type: "boolean" }, value: TRAJECTORY_V2_TIME_VALUE_SCHEMA },
      },
    },
    selectedDimensions: { type: "array", minItems: 3, maxItems: 3, uniqueItems: true, items: NON_EMPTY_STRING_SCHEMA },
    cohortPolicy: { enum: ["available", "complete"] }, missingValuePolicy: { const: "complete-analytical-rows" },
    estimand: {
      oneOf: [
        { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { const: "equal-participant" } } },
        { type: "object", additionalProperties: false, required: ["kind", "metadataField"], properties: { kind: { const: "weighted-participant" }, metadataField: NON_EMPTY_STRING_SCHEMA } },
      ],
    },
  },
} as const;
const TRAJECTORY_V2_TASK_BINDING_PROPERTIES = {
  datasetHash: HASH_SCHEMA, specHash: HASH_SCHEMA, sourceResultHash: HASH_SCHEMA, runId: NON_EMPTY_STRING_SCHEMA,
} as const;
const LONGITUDINAL_NULLABLE_NUMBER_SCHEMA = {
  oneOf: [{ type: "null" }, { type: "number" }],
} as const;
const LONGITUDINAL_NULLABLE_PROBABILITY_SCHEMA = {
  oneOf: [{ type: "null" }, { type: "number", minimum: 0, maximum: 1 }],
} as const;
const LONGITUDINAL_NULLABLE_POSITIVE_INTEGER_SCHEMA = {
  oneOf: [{ type: "null" }, SAFE_POSITIVE_INTEGER_SCHEMA],
} as const;
const LONGITUDINAL_RANK_TIES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["groups", "observations", "correctionSum"],
  properties: {
    groups: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    observations: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    correctionSum: { type: "number", minimum: 0 },
  },
} as const;
const LONGITUDINAL_RANK_EXACT_TAIL_SCHEMA = {
  oneOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      required: ["extremeAssignmentCount", "totalAssignmentCount", "inclusive", "midP"],
      properties: {
        extremeAssignmentCount: { type: "string", pattern: "^(?:0|[1-9][0-9]*)$" },
        totalAssignmentCount: { type: "string", pattern: "^(?:0|[1-9][0-9]*)$" },
        inclusive: { const: true },
        midP: { const: false },
      },
    },
  ],
} as const;
const LONGITUDINAL_PAIRED_IDENTITY_AUDIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["earlier", "later", "overlap", "earlierOnly", "laterOnly", "samePhysicalEntityConfirmed"],
  properties: {
    earlier: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    later: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    overlap: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    earlierOnly: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    laterOnly: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    samePhysicalEntityConfirmed: { const: true },
  },
} as const;
const LONGITUDINAL_REPEATED_IDENTITY_AUDIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["totalEntities", "completeBlocks", "excludedIncomplete", "samePhysicalEntityConfirmed"],
  properties: {
    totalEntities: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    completeBlocks: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    excludedIncomplete: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    samePhysicalEntityConfirmed: { const: true },
  },
} as const;
const LONGITUDINAL_RANK_ROW_COMMON_REQUIRED = [
  "memberId", "test", "design", "estimand", "axis", "axisIndex", "status", "reason",
  "effect", "statistic", "pRaw", "method", "ties", "zeros", "exactTail", "familyId",
  "familySize", "pHolm", "holmRank", "holmMultiplier",
] as const;
const LONGITUDINAL_RANK_ROW_COMMON_PROPERTIES = {
  memberId: NON_EMPTY_STRING_SCHEMA,
  estimand: NON_EMPTY_STRING_SCHEMA,
  axis: NON_EMPTY_STRING_SCHEMA,
  axisIndex: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
  status: { enum: ["available", "not-estimable"] },
  reason: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] },
  effect: LONGITUDINAL_NULLABLE_NUMBER_SCHEMA,
  statistic: LONGITUDINAL_NULLABLE_NUMBER_SCHEMA,
  pRaw: LONGITUDINAL_NULLABLE_PROBABILITY_SCHEMA,
  method: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] },
  ties: LONGITUDINAL_RANK_TIES_SCHEMA,
  zeros: { oneOf: [{ type: "null" }, SAFE_NON_NEGATIVE_INTEGER_SCHEMA] },
  exactTail: LONGITUDINAL_RANK_EXACT_TAIL_SCHEMA,
  familyId: NON_EMPTY_STRING_SCHEMA,
  familySize: SAFE_POSITIVE_INTEGER_SCHEMA,
  pHolm: LONGITUDINAL_NULLABLE_PROBABILITY_SCHEMA,
  holmRank: LONGITUDINAL_NULLABLE_POSITIVE_INTEGER_SCHEMA,
  holmMultiplier: LONGITUDINAL_NULLABLE_POSITIVE_INTEGER_SCHEMA,
} as const;
const LONGITUDINAL_INFERENCE_ROW_SCHEMA = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["memberId", "sideAEntities", "sideBEntities", "overlappingEntities", "pairedCompleteEntities", "sideAOnly", "sideBOnly", "excludedIncompleteOverlap", "samePhysicalEntityConfirmed"],
      properties: {
        memberId: { const: "identity-overlap-audit" },
        sideAEntities: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
        sideBEntities: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
        overlappingEntities: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
        pairedCompleteEntities: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
        sideAOnly: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
        sideBOnly: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
        excludedIncompleteOverlap: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
        samePhysicalEntityConfirmed: { const: true },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: [...LONGITUDINAL_RANK_ROW_COMMON_REQUIRED, "periodCanonical", "nPrimary", "nSecondary"],
      properties: {
        ...LONGITUDINAL_RANK_ROW_COMMON_PROPERTIES,
        test: { const: "mann-whitney" },
        design: { const: "independent" },
        periodCanonical: NON_EMPTY_STRING_SCHEMA,
        nPrimary: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
        nSecondary: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: [...LONGITUDINAL_RANK_ROW_COMMON_REQUIRED, "earlierPeriodCanonical", "laterPeriodCanonical", "n", "identityOverlapAudit"],
      properties: {
        ...LONGITUDINAL_RANK_ROW_COMMON_PROPERTIES,
        test: { const: "wilcoxon-signed-rank" },
        design: { const: "paired" },
        earlierPeriodCanonical: NON_EMPTY_STRING_SCHEMA,
        laterPeriodCanonical: NON_EMPTY_STRING_SCHEMA,
        n: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
        identityOverlapAudit: LONGITUDINAL_PAIRED_IDENTITY_AUDIT_SCHEMA,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: [...LONGITUDINAL_RANK_ROW_COMMON_REQUIRED, "selectedPeriodCanonicals", "n", "identityOverlapAudit"],
      properties: {
        ...LONGITUDINAL_RANK_ROW_COMMON_PROPERTIES,
        test: { const: "friedman" },
        design: { const: "repeated" },
        selectedPeriodCanonicals: { type: "array", minItems: 3, uniqueItems: true, items: NON_EMPTY_STRING_SCHEMA },
        n: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
        identityOverlapAudit: LONGITUDINAL_REPEATED_IDENTITY_AUDIT_SCHEMA,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: [...LONGITUDINAL_RANK_ROW_COMMON_REQUIRED, "earlierPeriodCanonical", "laterPeriodCanonical", "n", "identityOverlapAudit"],
      properties: {
        ...LONGITUDINAL_RANK_ROW_COMMON_PROPERTIES,
        test: { const: "wilcoxon-signed-rank" },
        design: { const: "repeated-posthoc" },
        earlierPeriodCanonical: NON_EMPTY_STRING_SCHEMA,
        laterPeriodCanonical: NON_EMPTY_STRING_SCHEMA,
        n: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
        identityOverlapAudit: LONGITUDINAL_REPEATED_IDENTITY_AUDIT_SCHEMA,
      },
    },
  ],
} as const;
const LONGITUDINAL_BOOTSTRAP_INTERVAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["estimate", "lower", "upper", "finiteReplicates", "requiredFiniteReplicates", "totalReplicates"],
  properties: {
    estimate: { type: "number" },
    lower: { type: "number" },
    upper: { type: "number" },
    finiteReplicates: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    requiredFiniteReplicates: SAFE_POSITIVE_INTEGER_SCHEMA,
    totalReplicates: SAFE_POSITIVE_INTEGER_SCHEMA,
  },
} as const;
const PREPARED_MAPPING_TASK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "participant", "participantLabel", "group", "time", "timeOrder",
    "cohortPolicy", "displayDimensions", "missingDisplayCoordinates",
  ],
  properties: {
    participant: { type: "array", minItems: 1, uniqueItems: true, items: NON_EMPTY_STRING_SCHEMA },
    participantLabel: NON_EMPTY_STRING_SCHEMA,
    group: NON_EMPTY_STRING_SCHEMA,
    time: NON_EMPTY_STRING_SCHEMA,
    timeOrder: { type: "array", minItems: 1, uniqueItems: true, items: RAW_SCALAR_SCHEMA },
    cohortPolicy: { enum: ["available", "complete"] },
    displayDimensions: { type: "array", minItems: 3, maxItems: 3, uniqueItems: true, items: NON_EMPTY_STRING_SCHEMA },
    missingDisplayCoordinates: { const: "reject" },
  },
} as const;

function analysisTaskSchema(kind: AnalysisTaskV1["kind"], required: string[], properties: Record<string, unknown>) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "kind", "owner", "deadlineEpochMilliseconds", ...required],
    properties: {
      schemaVersion: { const: ANALYSIS_TASK_VERSION_V1 },
      kind: { const: kind },
      owner: TASK_OWNER_SCHEMA_REF,
      deadlineEpochMilliseconds: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
      ...properties,
    },
  };
}

const DIAGNOSTIC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["code", "severity", "message"],
  properties: {
    code: NON_EMPTY_STRING_SCHEMA,
    severity: { enum: ["info", "warning"] },
    message: NON_EMPTY_STRING_SCHEMA,
    path: NON_EMPTY_STRING_SCHEMA,
    count: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
  },
} as const;

export const CONTRACT_SCHEMAS_V1 = Object.freeze({
  typedScalar: Object.freeze({
    $id: "https://3dena.com/schemas/typed-scalar.v1.json",
    oneOf: [
      { type: "object", additionalProperties: false, required: ["type"], properties: { type: { const: "null" } } },
      { type: "object", additionalProperties: false, required: ["type", "value"], properties: { type: { const: "string" }, value: { type: "string" } } },
      { type: "object", additionalProperties: false, required: ["type", "value"], properties: { type: { const: "boolean" }, value: { type: "boolean" } } },
      { type: "object", additionalProperties: false, required: ["type", "value"], properties: { type: { const: "int64" }, value: { type: "string", pattern: "^-?(?:0|[1-9][0-9]*)$" } } },
      { type: "object", additionalProperties: false, required: ["type", "ieee754Hex"], properties: { type: { const: "double" }, ieee754Hex: { type: "string", pattern: "^[a-f0-9]{16}$" } } },
      { type: "object", additionalProperties: false, required: ["type", "value"], properties: { type: { const: "date" }, value: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" } } },
      {
        type: "object", additionalProperties: false,
        required: ["type", "epochMilliseconds", "timeZone", "offsetMinutes", "fold"],
        properties: {
          type: { const: "instant" }, epochMilliseconds: { type: "string", pattern: "^-?(?:0|[1-9][0-9]*)$" },
          timeZone: NON_EMPTY_STRING_SCHEMA, offsetMinutes: { type: "integer", minimum: -1440, maximum: 1440 }, fold: { enum: [0, 1] },
        },
      },
      {
        type: "object", additionalProperties: false, required: ["type", "value", "unit"],
        properties: { type: { const: "duration" }, value: { type: "string", pattern: "^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$" }, unit: { enum: [...DURATION_UNITS] } },
      },
      {
        type: "object", additionalProperties: false, required: ["type", "value", "levels", "ordered"],
        properties: { type: { const: "factor" }, value: { type: "string" }, levels: { type: "array", uniqueItems: true, items: { type: "string" } }, ordered: { type: "boolean" } },
      },
    ],
  }),
  typedKey: Object.freeze({
    $id: "https://3dena.com/schemas/typed-key.v1.json",
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "components", "canonical"],
    properties: {
      schemaVersion: { const: "3dena.typed-key.v1" },
      components: {
        type: "array", minItems: 1,
        items: {
          type: "object", additionalProperties: false, required: ["name", "value"],
          properties: { name: NON_EMPTY_STRING_SCHEMA, value: { $ref: "https://3dena.com/schemas/typed-scalar.v1.json" } },
        },
      },
      canonical: NON_EMPTY_STRING_SCHEMA,
    },
  }),
  taskOwner: Object.freeze({
    $id: "https://3dena.com/schemas/task-owner.v1.json",
    type: "object",
    additionalProperties: false,
    required: ["contractVersion", "datasetHash", "specHash", "runId", "taskId"],
    properties: {
      contractVersion: { const: ANALYSIS_CONTRACT_VERSION_V1 },
      datasetHash: HASH_SCHEMA,
      specHash: HASH_SCHEMA,
      runId: NON_EMPTY_STRING_SCHEMA,
      taskId: NON_EMPTY_STRING_SCHEMA,
    },
  }),
  datasetReceipt: Object.freeze({
    $id: "https://3dena.com/schemas/dataset-receipt.v1.json",
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "sha256", "byteLength", "format", "sheet", "rows", "columns", "schema", "limits", "warnings", "activationIdentity"],
    properties: {
      schemaVersion: { const: DATASET_RECEIPT_VERSION_V1 }, sha256: HASH_SCHEMA, byteLength: SAFE_POSITIVE_INTEGER_SCHEMA,
      format: { enum: ["csv", "xlsx", "xls", "ena3d-json"] },
      sheet: {
        oneOf: [
          { type: "null" },
          { type: "object", additionalProperties: false, required: ["index", "name"], properties: { index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA, name: NON_EMPTY_STRING_SCHEMA } },
        ],
      },
      rows: SAFE_POSITIVE_INTEGER_SCHEMA, columns: SAFE_POSITIVE_INTEGER_SCHEMA,
      schema: {
        type: "object", additionalProperties: false, required: ["schemaVersion", "headers", "columns"],
        properties: {
          schemaVersion: { const: "3dena.dataset-schema.v1" },
          headers: { type: "array", minItems: 1, uniqueItems: true, items: NON_EMPTY_STRING_SCHEMA },
          columns: {
            type: "array", minItems: 1,
            items: {
              type: "object", additionalProperties: false, required: ["name", "inferredType", "roles"],
              properties: {
                name: NON_EMPTY_STRING_SCHEMA, inferredType: { enum: ["string", "number", "boolean", "mixed", "null"] },
                roles: { type: "array", minItems: 1, uniqueItems: true, items: { enum: ["unit", "conversation", "time", "code", "group", "metadata", "unmapped"] } },
              },
            },
          },
        },
      },
      limits: {
        type: "object", additionalProperties: false,
        required: ["schemaVersion", "maxFileBytes", "maxWorksheets", "maxRows", "maxColumns", "maxCells"],
        properties: {
          schemaVersion: { const: "3dena.dataset-limits.v1" }, maxFileBytes: SAFE_POSITIVE_INTEGER_SCHEMA,
          maxWorksheets: SAFE_POSITIVE_INTEGER_SCHEMA, maxRows: SAFE_POSITIVE_INTEGER_SCHEMA,
          maxColumns: SAFE_POSITIVE_INTEGER_SCHEMA, maxCells: SAFE_POSITIVE_INTEGER_SCHEMA,
        },
      },
      warnings: { type: "array", uniqueItems: true, items: { type: "string" } },
      activationIdentity: NON_EMPTY_STRING_SCHEMA,
    },
  }),
  analysisExecutionDatasetV2: Object.freeze(ANALYSIS_EXECUTION_DATASET_V2_SCHEMA),
  trajectoryRunSpecV2: Object.freeze(TRAJECTORY_RUN_SPEC_V2_SCHEMA),
  trajectoryPathTaskV2: Object.freeze({
    $id: "https://3dena.com/schemas/trajectory-path-task.v2.json",
    type: "object", additionalProperties: false,
    required: ["schemaVersion", "kind", "datasetHash", "specHash", "runId", "runSpec"],
    properties: {
      schemaVersion: { const: "3dena.trajectory-path-task.v2" }, kind: { const: "trajectory-path-v2" },
      datasetHash: HASH_SCHEMA, specHash: HASH_SCHEMA, runId: NON_EMPTY_STRING_SCHEMA,
      runSpec: { $ref: "https://3dena.com/schemas/trajectory-run-spec.v2.json" },
    },
  }),
  trajectoryInferenceTaskV2: Object.freeze({
    $id: "https://3dena.com/schemas/trajectory-inference-task.v2.json",
    type: "object", additionalProperties: false,
    required: ["schemaVersion", "kind", "datasetHash", "specHash", "sourceResultHash", "runId", "requests", "adjustment"],
    properties: {
      schemaVersion: { const: "3dena.trajectory-inference-task.v2" }, kind: { const: "trajectory-inference-v2" },
      ...TRAJECTORY_V2_TASK_BINDING_PROPERTIES, adjustment: { const: "holm" },
      requests: {
        type: "array", minItems: 1,
        items: {
          oneOf: [
            { type: "object", additionalProperties: false, required: ["kind", "groups", "periodCanonical"], properties: { kind: { const: "independent-period" }, groups: { type: "array", minItems: 2, maxItems: 2, uniqueItems: true, items: NON_EMPTY_STRING_SCHEMA }, periodCanonical: NON_EMPTY_STRING_SCHEMA } },
            { type: "object", additionalProperties: false, required: ["kind", "group", "earlierPeriodCanonical", "laterPeriodCanonical", "samePhysicalEntityConfirmed"], properties: { kind: { const: "paired-periods" }, group: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] }, earlierPeriodCanonical: NON_EMPTY_STRING_SCHEMA, laterPeriodCanonical: NON_EMPTY_STRING_SCHEMA, samePhysicalEntityConfirmed: { type: "boolean" } } },
            { type: "object", additionalProperties: false, required: ["kind", "group", "periodCanonicals", "samePhysicalEntityConfirmed"], properties: { kind: { const: "repeated-periods" }, group: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] }, periodCanonicals: { type: "array", minItems: 3, uniqueItems: true, items: NON_EMPTY_STRING_SCHEMA }, samePhysicalEntityConfirmed: { type: "boolean" } } },
            { type: "object", additionalProperties: false, required: ["kind", "design", "groups", "repetitions", "seed", "samePhysicalEntityConfirmed"], properties: { kind: { const: "path-comparison" }, design: { enum: ["independent", "paired"] }, groups: { type: "array", minItems: 2, maxItems: 2, uniqueItems: true, items: NON_EMPTY_STRING_SCHEMA }, repetitions: { type: "integer", minimum: 1, maximum: 10_000 }, seed: { type: "integer", minimum: 0, maximum: 4_294_967_295 }, samePhysicalEntityConfirmed: { type: "boolean" } } },
          ],
        },
      },
    },
  }),
  trajectoryBootstrapTaskV2: Object.freeze({
    $id: "https://3dena.com/schemas/trajectory-bootstrap-task.v2.json",
    type: "object", additionalProperties: false,
    required: ["schemaVersion", "kind", "datasetHash", "specHash", "sourceResultHash", "runId", "repetitions", "confidenceLevel", "seed", "resamplingDesign", "explicitStrataField", "interval", "rotationPolicy"],
    properties: {
      schemaVersion: { const: "3dena.trajectory-bootstrap-task.v2" }, kind: { const: "trajectory-bootstrap-v2" },
      ...TRAJECTORY_V2_TASK_BINDING_PROPERTIES,
      repetitions: { type: "integer", minimum: 1, maximum: 10_000 }, confidenceLevel: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1 },
      seed: { type: "integer", minimum: 0, maximum: 4_294_967_295 }, resamplingDesign: { enum: ["auto", "global-participant", "within-group", "explicit-strata"] },
      explicitStrataField: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] }, interval: { const: "pointwise-percentile-linear-type7" }, rotationPolicy: { const: "fixed-same-fit-projection" },
    },
    allOf: [{ if: { properties: { resamplingDesign: { const: "explicit-strata" } } }, then: { properties: { explicitStrataField: NON_EMPTY_STRING_SCHEMA } }, else: { properties: { explicitStrataField: { type: "null" } } } }],
  }),
  trajectoryNetworkOverlayTaskV2: Object.freeze({
    $id: "https://3dena.com/schemas/trajectory-network-overlay-task.v2.json",
    type: "object", additionalProperties: false,
    required: ["schemaVersion", "kind", "datasetHash", "specHash", "sourceResultHash", "runId", "requests"],
    properties: {
      schemaVersion: { const: "3dena.trajectory-network-overlay-task.v2" }, kind: { const: "trajectory-network-overlay-v2" },
      ...TRAJECTORY_V2_TASK_BINDING_PROPERTIES,
      requests: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["periodCanonical", "groupCanonical"], properties: { periodCanonical: NON_EMPTY_STRING_SCHEMA, groupCanonical: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] } } } },
    },
  }),
  trajectoryDisplaySpecV2: Object.freeze({
    $id: "https://3dena.com/schemas/trajectory-display-spec.v2.json",
    type: "object", additionalProperties: false,
    required: ["schemaVersion", "projection", "displayedGroups", "traces", "axisFlips", "camera", "style"],
    properties: {
      schemaVersion: { const: "3dena.trajectory-display-spec.v2" }, projection: { enum: ["3d", "xy", "xz", "yz", "yx", "zx", "zy"] },
      displayedGroups: { type: "array", uniqueItems: true, items: NON_EMPTY_STRING_SCHEMA },
      traces: { type: "object", additionalProperties: false, required: ["participants", "individualPaths", "centroids", "paths", "directionArrows", "uncertainty", "networkOverlay", "labels"], properties: Object.fromEntries(["participants", "individualPaths", "centroids", "paths", "directionArrows", "uncertainty", "networkOverlay", "codeNodes", "labels"].map((field) => [field, { type: "boolean" }])) },
      axisFlips: { type: "array", minItems: 3, maxItems: 3, items: { type: "boolean" } },
      camera: {
        oneOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["eye", "center", "up"],
            properties: {
              ...Object.fromEntries(["eye", "center", "up"].map((field) => [field, { type: "object", additionalProperties: false, required: ["x", "y", "z"], properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } } }])),
              projection: {
                type: "object",
                additionalProperties: false,
                required: ["type"],
                properties: { type: { enum: ["perspective", "orthographic"] } },
              },
            },
          },
        ],
      },
      style: { type: "object", additionalProperties: false, required: ["participantSize", "participantOpacity", "centroidSize", "pathWidth"], properties: { participantSize: { type: "number", exclusiveMinimum: 0 }, participantOpacity: { type: "number", minimum: 0, maximum: 1 }, centroidSize: { type: "number", exclusiveMinimum: 0 }, pathWidth: { type: "number", exclusiveMinimum: 0 } } },
    },
  }),
  longitudinalAnalysisBundleV2: Object.freeze({
    $id: "https://3dena.com/schemas/longitudinal-analysis-bundle.v2.json",
    type: "object", additionalProperties: false,
    required: ["schemaVersion", "identity", "runSpec", "model", "paths", "inference", "pathComparisons", "bootstrap", "codeGeometry", "networkOverlays", "diagnostics", "execution"],
    properties: {
      schemaVersion: { const: "3dena.longitudinal-analysis-bundle.v2" },
      identity: { type: "object", additionalProperties: false, required: ["datasetHash", "specHash", "sourceResultHash", "requestHash", "resultHash", "runId", "jenaBuildId"], properties: { datasetHash: HASH_SCHEMA, specHash: HASH_SCHEMA, sourceResultHash: HASH_SCHEMA, requestHash: HASH_SCHEMA, resultHash: HASH_SCHEMA, runId: NON_EMPTY_STRING_SCHEMA, jenaBuildId: NON_EMPTY_STRING_SCHEMA } },
      runSpec: { $ref: "https://3dena.com/schemas/trajectory-run-spec.v2.json" },
      model: { type: "object", additionalProperties: false, required: ["type", "fullRotationDimensions", "selectedDimensions"], properties: { type: { enum: ["SeparateTrajectory", "AccumulatedTrajectory"] }, fullRotationDimensions: { type: "array", minItems: 3, uniqueItems: true, items: NON_EMPTY_STRING_SCHEMA }, selectedDimensions: { type: "array", minItems: 3, maxItems: 3, uniqueItems: true, items: NON_EMPTY_STRING_SCHEMA } } },
      paths: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["group", "dynamics"], properties: { group: { type: "object", additionalProperties: false, required: ["canonical", "display"], properties: { canonical: NON_EMPTY_STRING_SCHEMA, display: NON_EMPTY_STRING_SCHEMA } }, dynamics: RESULT_VARIANT_SCHEMAS_V1.trajectory } } },
      inference: { type: "array", items: { type: "object", additionalProperties: false, required: ["request", "status", "familyId", "familySize", "rows", "reason"], properties: { request: { $ref: "https://3dena.com/schemas/trajectory-inference-task.v2.json#/properties/requests/items" }, status: { enum: ["available", "not-estimable", "disabled"] }, familyId: NON_EMPTY_STRING_SCHEMA, familySize: SAFE_NON_NEGATIVE_INTEGER_SCHEMA, rows: { type: "array", items: LONGITUDINAL_INFERENCE_ROW_SCHEMA }, reason: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] } } } },
      pathComparisons: { type: "array", items: { type: "object", additionalProperties: false, required: ["groups", "design", "seed", "planHash", "identityOverlapAudit", "result"], properties: { groups: { type: "array", minItems: 2, maxItems: 2, uniqueItems: true, items: NON_EMPTY_STRING_SCHEMA }, design: { enum: ["independent", "paired"] }, seed: { type: "integer", minimum: 0, maximum: 4_294_967_295 }, planHash: HASH_SCHEMA, identityOverlapAudit: { oneOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["sideAEntities", "sideBEntities", "overlappingEntities", "pairedCompleteEntities", "sideAOnly", "sideBOnly", "excludedIncompleteOverlap", "samePhysicalEntityConfirmed"], properties: { sideAEntities: SAFE_NON_NEGATIVE_INTEGER_SCHEMA, sideBEntities: SAFE_NON_NEGATIVE_INTEGER_SCHEMA, overlappingEntities: SAFE_NON_NEGATIVE_INTEGER_SCHEMA, pairedCompleteEntities: SAFE_NON_NEGATIVE_INTEGER_SCHEMA, sideAOnly: SAFE_NON_NEGATIVE_INTEGER_SCHEMA, sideBOnly: SAFE_NON_NEGATIVE_INTEGER_SCHEMA, excludedIncompleteOverlap: SAFE_NON_NEGATIVE_INTEGER_SCHEMA, samePhysicalEntityConfirmed: { const: true } } }] }, result: RESULT_VARIANT_SCHEMAS_V1["trajectory-comparison"] } } },
      bootstrap: { type: "array", items: { type: "object", additionalProperties: false, required: ["groupCanonical", "status", "notEstimableReason", "seed", "planHash", "finiteReplicates", "requiredFiniteReplicates", "totalReplicates", "confidenceLevel", "requestedResamplingDesign", "resolvedResamplingDesign", "resamplingAlgorithm", "intervalContract", "rotationPolicy", "speedIntervals", "result"], properties: { groupCanonical: NON_EMPTY_STRING_SCHEMA, status: { enum: ["available", "not-estimable"] }, notEstimableReason: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] }, seed: { type: "integer", minimum: 0, maximum: 4_294_967_295 }, planHash: HASH_SCHEMA, finiteReplicates: SAFE_NON_NEGATIVE_INTEGER_SCHEMA, requiredFiniteReplicates: SAFE_POSITIVE_INTEGER_SCHEMA, totalReplicates: SAFE_POSITIVE_INTEGER_SCHEMA, confidenceLevel: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1 }, requestedResamplingDesign: { enum: ["auto", "global-participant", "within-group", "explicit-strata"] }, resolvedResamplingDesign: { enum: ["global-participant", "within-group", "explicit-strata"] }, resamplingAlgorithm: { enum: ["participant-complete-history-mulberry32-uint32-v1", "global-participant-complete-history-mulberry32-uint32-v2"] }, intervalContract: { const: "pointwise-percentile-linear-type7" }, rotationPolicy: { const: "fixed-same-fit-projection" }, speedIntervals: { type: "array", items: { type: "object", additionalProperties: false, required: ["periodCanonical", "selected", "full"], properties: { periodCanonical: NON_EMPTY_STRING_SCHEMA, selected: { oneOf: [{ type: "null" }, LONGITUDINAL_BOOTSTRAP_INTERVAL_SCHEMA] }, full: { oneOf: [{ type: "null" }, LONGITUDINAL_BOOTSTRAP_INTERVAL_SCHEMA] } } } }, result: RESULT_VARIANT_SCHEMAS_V1.bootstrap } } },
      codeGeometry: {
        type: "object", additionalProperties: false, required: ["schemaVersion", "dimensions", "nodes"],
        properties: {
          schemaVersion: { const: "3dena.longitudinal-code-geometry.v2" },
          dimensions: { type: "array", minItems: 3, maxItems: 3, uniqueItems: true, items: NON_EMPTY_STRING_SCHEMA },
          nodes: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["index", "code", "coordinates"], properties: { index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA, code: NON_EMPTY_STRING_SCHEMA, coordinates: { type: "array", minItems: 3, maxItems: 3, items: { type: "number" } } } } },
        },
      },
      networkOverlays: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
            required: ["status", "reason", "groupCanonical", "periodCanonical", "dimensions", "estimand", "sourceRows", "participantPeriods", "effectiveParticipantN", "edges"],
          properties: {
            status: { enum: ["available", "not-estimable"] },
            reason: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] },
            groupCanonical: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] },
            periodCanonical: NON_EMPTY_STRING_SCHEMA,
            dimensions: { type: "array", minItems: 3, maxItems: 3, uniqueItems: true, items: NON_EMPTY_STRING_SCHEMA },
            estimand: { enum: ["equal-participant", "weighted-participant"] },
            sourceRows: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
            participantPeriods: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
            effectiveParticipantN: { oneOf: [{ type: "null" }, { type: "number", exclusiveMinimum: 0 }] },
            edges: {
              type: "array",
              items: {
                type: "object", additionalProperties: false, required: ["id", "sourceIndex", "targetIndex", "weight"],
                properties: { id: NON_EMPTY_STRING_SCHEMA, sourceIndex: SAFE_NON_NEGATIVE_INTEGER_SCHEMA, targetIndex: SAFE_NON_NEGATIVE_INTEGER_SCHEMA, weight: { type: "number" } },
              },
            },
          },
        },
      },
      diagnostics: { type: "array", items: { type: "object", additionalProperties: false, required: ["code", "severity", "message"], properties: { code: NON_EMPTY_STRING_SCHEMA, severity: { enum: ["error", "warning", "info"] }, message: NON_EMPTY_STRING_SCHEMA, path: NON_EMPTY_STRING_SCHEMA } } },
      execution: { type: "object", additionalProperties: false, required: ["target", "jenaVersion", "jenaCommit", "jenaTarballIntegrity", "sdkVersion", "buildId", "seed", "permutationPlanHashes", "resamplingPlanHashes", "evidenceStatus"], properties: { target: { enum: ["browser-worker", "persistent-compute-service", "node-service"] }, jenaVersion: NON_EMPTY_STRING_SCHEMA, jenaCommit: NON_EMPTY_STRING_SCHEMA, jenaTarballIntegrity: NON_EMPTY_STRING_SCHEMA, sdkVersion: NON_EMPTY_STRING_SCHEMA, buildId: NON_EMPTY_STRING_SCHEMA, seed: { type: "integer", minimum: 0, maximum: 4_294_967_295 }, permutationPlanHashes: { type: "array", items: HASH_SCHEMA }, resamplingPlanHashes: { type: "array", items: HASH_SCHEMA }, evidenceStatus: { enum: ["IMPLEMENTED_UNVERIFIED", "PARITY_CANDIDATE", "PRODUCTION_CANDIDATE", "PRODUCTION_READY"] } } },
    },
  }),
  analysisSpec: Object.freeze({
    $id: "https://3dena.com/schemas/analysis-spec.v1.json",
    type: "object", additionalProperties: false,
    required: ["schemaVersion", "model", "window", "weightBy", "windowSizeBack", "windowSizeForward", "centerAlignToOrigin", "cohortPolicy"],
    properties: {
      schemaVersion: { const: "3dena.analysis-spec.v1" }, model: { enum: ["EndPoint", "AccumulatedTrajectory", "SeparateTrajectory"] },
      window: { enum: ["MovingStanzaWindow", "Conversation"] }, weightBy: { enum: ["binary", "sum"] },
      windowSizeBack: SAFE_NON_NEGATIVE_INTEGER_SCHEMA, windowSizeForward: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
      centerAlignToOrigin: { type: "boolean" }, cohortPolicy: { enum: ["available", "complete"] },
    },
  }),
  displaySpec: Object.freeze({
    $id: "https://3dena.com/schemas/display-spec.v1.json",
    type: "object", additionalProperties: false,
    required: ["schemaVersion", "dimensions", "plotDimension", "showGrid", "showZeroLines", "showAxes", "traces", "style", "camera"],
    properties: {
      schemaVersion: { const: "3dena.display-spec.v1" },
      dimensions: { type: "array", minItems: 3, maxItems: 3, uniqueItems: true, items: NON_EMPTY_STRING_SCHEMA },
      plotDimension: { enum: [2, 3] }, groups: { type: "array", minItems: 1, uniqueItems: true, items: NON_EMPTY_STRING_SCHEMA },
      showGrid: { type: "boolean" }, showZeroLines: { type: "boolean" }, showAxes: { type: "boolean" },
      traces: {
        type: "object", additionalProperties: false, required: ["points", "nodes", "network", "centroids", "trajectory", "uncertainty"],
        properties: Object.fromEntries(["points", "nodes", "network", "centroids", "trajectory", "uncertainty"].map((name) => [name, { type: "boolean" }])),
      },
      style: {
        type: "object", additionalProperties: false,
        required: ["pointSize", "pointOpacity", "nodeSize", "nodeOpacity", "edgeThreshold", "edgeWidthScale", "trajectoryWidth"],
        properties: {
          pointSize: { type: "number", minimum: 1, maximum: 100 }, pointOpacity: { type: "number", minimum: 0, maximum: 1 },
          nodeSize: { type: "number", minimum: 1, maximum: 100 }, nodeOpacity: { type: "number", minimum: 0, maximum: 1 },
          edgeThreshold: { type: "number", minimum: 0, maximum: 1_000_000_000 }, edgeWidthScale: { type: "number", minimum: 0.01, maximum: 1_000 },
          trajectoryWidth: { type: "number", minimum: 0.1, maximum: 100 },
        },
      },
      camera: {
        oneOf: [
          { type: "null" },
          {
            type: "object", additionalProperties: false, required: ["eye", "center", "up"],
            properties: Object.fromEntries(["eye", "center", "up"].map((name) => [name, {
              type: "object", additionalProperties: false, required: ["x", "y", "z"],
              properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
            }])),
          },
        ],
      },
    },
  }),
  analysisTask: Object.freeze({
    $id: "https://3dena.com/schemas/analysis-task.v1.json",
    discriminator: { propertyName: "kind" },
    $defs: {
      stringPair: { type: "array", minItems: 2, maxItems: 2, uniqueItems: true, items: NON_EMPTY_STRING_SCHEMA },
      timeValue: {
        oneOf: [
          { type: "object", additionalProperties: false, required: ["type", "value", "unit"], properties: { type: { const: "numeric-v1" }, value: { type: "number" }, unit: NON_EMPTY_STRING_SCHEMA } },
          { type: "object", additionalProperties: false, required: ["type", "value"], properties: { type: { const: "date-v1" }, value: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" } } },
          {
            type: "object", additionalProperties: false, required: ["type", "epochMilliseconds", "timeZone", "offsetMinutes", "fold", "elapsedUnit"],
            properties: { type: { const: "instant-v1" }, epochMilliseconds: { type: "string", pattern: "^-?(?:0|[1-9][0-9]*)$" }, timeZone: NON_EMPTY_STRING_SCHEMA, offsetMinutes: { type: "integer", minimum: -1440, maximum: 1440 }, fold: { enum: [0, 1] }, elapsedUnit: { enum: [...TRAJECTORY_DURATION_UNITS] } },
          },
          {
            type: "object", additionalProperties: false, required: ["type", "value", "unit", "elapsedUnit"],
            properties: { type: { const: "difftime-v1" }, value: { type: "number" }, unit: { enum: [...TRAJECTORY_DURATION_UNITS] }, elapsedUnit: { enum: [...TRAJECTORY_DURATION_UNITS] } },
          },
        ],
      },
    },
    oneOf: [
      analysisTaskSchema("ena-model", ["input"], { input: { type: "object" } }),
      analysisTaskSchema("prepared-import", ["input"], {
        input: {
          type: "object", additionalProperties: false,
          required: ["sourceName", "exactBytesBase64", "mapping"],
          properties: {
            sourceName: { const: "uploaded.ena3d.json" },
            exactBytesBase64: { type: "string", minLength: 4, maxLength: 7_000_000, pattern: "^[A-Za-z0-9+/]+={0,2}$" },
            mapping: PREPARED_MAPPING_TASK_SCHEMA,
          },
        },
      }),
      analysisTaskSchema("network-comparison", ["sourceResultHash", "groups"], { sourceResultHash: HASH_SCHEMA, groups: { $ref: "#/$defs/stringPair" } }),
      analysisTaskSchema("change-network", ["sourceResultHash", "field", "level"], { sourceResultHash: HASH_SCHEMA, field: NON_EMPTY_STRING_SCHEMA, level: RAW_SCALAR_SCHEMA }),
      analysisTaskSchema("statistics", ["sourceResultHash", "design", "groups", "dimensions", "alternative", "adjustment", "samePhysicalEntityConfirmed"], {
        sourceResultHash: HASH_SCHEMA, design: { enum: ["independent", "paired"] }, groups: { $ref: "#/$defs/stringPair" },
        dimensions: { type: "array", minItems: 1, uniqueItems: true, items: NON_EMPTY_STRING_SCHEMA }, alternative: { enum: ["two-sided", "greater", "less"] },
        adjustment: { enum: ["none", "holm", "bh", "bonferroni"] }, samePhysicalEntityConfirmed: { type: "boolean" },
      }),
      analysisTaskSchema("trajectory", ["sourceResultHash", "group", "selectedDimensions", "cohortPolicy", "periods", "estimand"], {
        sourceResultHash: HASH_SCHEMA, group: NON_EMPTY_STRING_SCHEMA,
        selectedDimensions: { type: "array", minItems: 3, maxItems: 3, uniqueItems: true, items: NON_EMPTY_STRING_SCHEMA }, cohortPolicy: { enum: ["available", "complete"] },
        periods: {
          type: "array", minItems: 1,
          items: { type: "object", additionalProperties: false, required: ["sourceTimeCanonical", "value"], properties: { sourceTimeCanonical: NON_EMPTY_STRING_SCHEMA, value: { $ref: "#/$defs/timeValue" } } },
        },
        estimand: {
          oneOf: [
            { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { const: "equal-participant-v1" } } },
            { type: "object", additionalProperties: false, required: ["kind", "metadataField"], properties: { kind: { const: "weighted-participant-v1" }, metadataField: NON_EMPTY_STRING_SCHEMA } },
          ],
        },
      }),
      analysisTaskSchema("trajectory-comparison", ["sourceResultHash", "design", "groups", "samePhysicalEntityConfirmed"], {
        sourceResultHash: HASH_SCHEMA, design: { enum: ["independent", "paired"] }, groups: { $ref: "#/$defs/stringPair" }, samePhysicalEntityConfirmed: { type: "boolean" },
      }),
      analysisTaskSchema("bootstrap", ["sourceResultHash", "group", "replicates", "confidenceLevel", "seed", "interval", "rotationPolicy"], {
        sourceResultHash: HASH_SCHEMA, group: NON_EMPTY_STRING_SCHEMA, replicates: { type: "integer", minimum: 200, maximum: 500 },
        confidenceLevel: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1 }, seed: { type: "integer", minimum: 0, maximum: 4_294_967_295 },
        interval: { const: "pointwise-percentile-type7" }, rotationPolicy: { const: "fixed-preprojected" },
      }),
    ],
  }),
  evidenceStamp: Object.freeze({
    $id: "https://3dena.com/schemas/evidence-stamp.v1.json",
    type: "object", additionalProperties: false, required: ["schemaVersion", "scope", "status", "approvedForParity"],
    properties: {
      schemaVersion: { const: "3dena.evidence-stamp.v1" }, scope: { enum: ["fixture", "feature", "build", "deployment"] },
      status: { enum: ["IMPLEMENTED_UNVERIFIED", "PARITY_CANDIDATE", "VERIFIED_PARITY", "PRODUCTION_CANDIDATE", "PRODUCTION_READY", "PRECOMPUTED_COMPATIBILITY_CANDIDATE"] },
      datasetHash: HASH_SCHEMA, specHash: HASH_SCHEMA, fixtureId: NON_EMPTY_STRING_SCHEMA, buildId: NON_EMPTY_STRING_SCHEMA,
      approvedForParity: { type: "boolean" },
    },
  }),
  provenanceManifest: Object.freeze({
    $id: "https://3dena.com/schemas/provenance-manifest.v1.json",
    type: "object", additionalProperties: false,
    required: ["schemaVersion", "datasetHash", "specHash", "resultHash", "adapterVersion", "jenaPackage", "jenaVersion", "jenaCommit", "sourceKind", "jenaExecuted", "sdkPackage", "sdkVersion", "appVersion", "contractVersion", "buildId", "seed", "toleranceContract", "schemaVersions", "generatedAt"],
    properties: {
      schemaVersion: { const: PROVENANCE_MANIFEST_VERSION_V1 }, datasetHash: HASH_SCHEMA, specHash: HASH_SCHEMA, resultHash: HASH_SCHEMA,
      adapterVersion: NON_EMPTY_STRING_SCHEMA, jenaPackage: { const: "jena-js" }, jenaVersion: NON_EMPTY_STRING_SCHEMA, jenaCommit: NON_EMPTY_STRING_SCHEMA,
      sourceKind: { enum: ["raw-jena", "prepared-exchange"] }, jenaExecuted: { type: "boolean" }, sdkPackage: { const: "@3dena/analysis" },
      sdkVersion: NON_EMPTY_STRING_SCHEMA, appVersion: NON_EMPTY_STRING_SCHEMA, contractVersion: { const: ANALYSIS_CONTRACT_VERSION_V1 }, buildId: NON_EMPTY_STRING_SCHEMA,
      seed: { oneOf: [{ type: "null" }, { type: "integer", minimum: 0, maximum: 4_294_967_295 }] }, toleranceContract: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] },
      schemaVersions: { type: "array", minItems: 1, uniqueItems: true, items: NON_EMPTY_STRING_SCHEMA }, generatedAt: { type: "string", format: "date-time" },
    },
  }),
  resultEnvelope: Object.freeze({
    $id: "https://3dena.com/schemas/analysis-result-envelope.v1.json",
    discriminator: { propertyName: "taskKind" },
    type: "object", additionalProperties: false,
    required: ["schemaVersion", "owner", "taskKind", "result", "diagnostics", "evidence", "provenance"],
    properties: {
      schemaVersion: { const: RESULT_ENVELOPE_VERSION_V1 }, owner: TASK_OWNER_SCHEMA_REF,
      taskKind: { enum: ["ena-model", "prepared-import", "network-comparison", "change-network", "statistics", "trajectory", "trajectory-comparison", "bootstrap"] },
      result: { oneOf: Object.values(RESULT_VARIANT_SCHEMAS_V1) },
      diagnostics: {
        type: "array", items: {
          type: "object", additionalProperties: false, required: ["code", "severity", "message"],
          properties: { code: NON_EMPTY_STRING_SCHEMA, severity: { enum: ["info", "warning"] }, message: NON_EMPTY_STRING_SCHEMA, path: NON_EMPTY_STRING_SCHEMA, count: SAFE_NON_NEGATIVE_INTEGER_SCHEMA },
        },
      },
      evidence: { $ref: "https://3dena.com/schemas/evidence-stamp.v1.json" }, provenance: { $ref: "https://3dena.com/schemas/provenance-manifest.v1.json" },
    },
    allOf: [
      {
        properties: {
          provenance: {
            properties: {
              schemaVersions: { contains: { const: ANALYSIS_TASK_VERSION_V1 } },
            },
          },
        },
      },
      {
        properties: {
          provenance: {
            properties: {
              schemaVersions: { contains: { const: RESULT_ENVELOPE_VERSION_V1 } },
            },
          },
        },
      },
    ],
    oneOf: Object.entries(RESULT_VARIANT_SCHEMAS_V1).map(([taskKind, resultSchema]) => ({
      properties: {
        taskKind: { const: taskKind },
        result: resultSchema,
        provenance: {
          properties: {
            schemaVersions: { contains: { const: RESULT_SCHEMA_VERSION_BY_TASK_KIND_V1[taskKind as AnalysisTaskV1["kind"]] } },
          },
        },
      },
      required: ["taskKind", "result", "provenance"],
    })),
  }),
});
