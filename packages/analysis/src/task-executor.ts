import {
  analyzeIndependentSamples,
  analyzePairedSamples,
  type IndependentStatisticsResult,
  type PairedStatisticsResult,
  type StatisticalIdentity,
  type StatisticalIdentityComponent,
} from "@3dena/stats";
import {
  TrajectoryDynamicsError,
  analyzeTrajectoryDynamicsV1,
  type TrajectoryDynamicsResultV1,
} from "@3dena/trajectory";
import { decodeEna3dExchangeV1WithSha256 } from "@3dena/io";

import { analyzeRows } from "./analyze";
import {
  ANALYSIS_CONTRACT_VERSION_V1,
  PROVENANCE_MANIFEST_VERSION_V1,
  RESULT_ENVELOPE_VERSION_V1,
  assertAnalysisResultEnvelopeV1,
  assertAnalysisTaskResultV1,
  assertAnalysisTaskV1,
  assertDatasetReceiptV1,
  type AnalysisResultEnvelopeV1,
  type AnalysisTaskV1,
  type DatasetReceiptV1,
  type TrajectoryTaskV1,
} from "./contracts";
import { analyzeChangeNetwork, compareGroupNetworks, type ChangeNetworkResultV1, type NetworkComparisonResultV1 } from "./network-analysis";
import {
  analyzePreparedChangeNetwork,
  assertPreparedDerivedSource,
  comparePreparedGroupNetworks,
  preparedDimensionIndex,
  preparedPointsForGroup,
  preparedReductionDiagnostic,
} from "./prepared-derived";
import { analyzePreparedSpace } from "./prepared-space";
import type { PreparedSpacePoint, PreparedSpaceResult } from "./prepared-types";
import {
  adaptAnalysisResultTrajectorySeries,
  adaptPreparedSpaceTrajectorySeries,
} from "./trajectory-series-adapters";
import {
  bootstrapTrajectoryPath,
  compareTrajectoryPaths,
  createSeededTrajectoryBootstrapPlan,
  getTrajectoryBootstrapUnits,
  type TrajectoryBootstrapResult,
  type TrajectoryComparisonResult,
  type TrajectoryPathStatistics,
  type TrajectorySeriesInput,
} from "./trajectory-statistics";
import type { AnalysisDiagnostic, AnalysisPoint, AnalysisResult, RawScalar } from "./types";

const SHA256 = /^[a-f0-9]{64}$/u;
export const ANALYSIS_EXECUTION_DATASET_VERSION_V2 = "3dena.analysis-execution-dataset.v2" as const;

export interface AnalysisExecutionDatasetV1 {
  schemaVersion: "3dena.analysis-execution-dataset.v1";
  receipt: DatasetReceiptV1;
  /** Exact scientific-spec hash bound to this activated dataset. */
  specHash: string;
  /** Immutable build identity supplied by the local consumer or compute service. */
  buildId: string;
  /** Optional frozen clock for deterministic receipts and tests. */
  generatedAt?: string;
  sourceResult?: {
    hash: string;
    result: AnalysisResult;
  };
}

export interface RawAnalysisExecutionSourceResultV2 {
  sourceKind: "raw-jena";
  hash: string;
  result: AnalysisResult;
}

export interface PreparedAnalysisExecutionSourceResultV2 {
  sourceKind: "prepared-exchange";
  hash: string;
  result: PreparedSpaceResult;
}

export type AnalysisExecutionSourceResultV2 =
  | RawAnalysisExecutionSourceResultV2
  | PreparedAnalysisExecutionSourceResultV2;

/**
 * Versioned execution binding with an explicit raw/prepared source
 * discriminant. V1 remains supported for existing raw-only callers.
 */
export interface AnalysisExecutionDatasetV2 {
  schemaVersion: typeof ANALYSIS_EXECUTION_DATASET_VERSION_V2;
  receipt: DatasetReceiptV1;
  specHash: string;
  buildId: string;
  generatedAt?: string;
  sourceResult?: AnalysisExecutionSourceResultV2;
}

export type AnalysisExecutionDataset =
  | AnalysisExecutionDatasetV1
  | AnalysisExecutionDatasetV2;

type ResolvedExecutionSource =
  | { sourceKind: "raw-jena"; hash: string; result: AnalysisResult }
  | { sourceKind: "prepared-exchange"; hash: string; result: PreparedSpaceResult };

export interface StatisticsDimensionResultV1 {
  dimension: string;
  result: IndependentStatisticsResult | PairedStatisticsResult;
}

export interface StatisticsTaskResultV1 {
  schemaVersion: "3dena.statistics-task-result.v1";
  design: "independent" | "paired";
  direction: "group-a-minus-group-b";
  groups: [string, string];
  dimensions: StatisticsDimensionResultV1[];
}

export type AnalysisTaskResultV1 =
  | AnalysisResult
  | PreparedSpaceResult
  | NetworkComparisonResultV1
  | ChangeNetworkResultV1
  | StatisticsTaskResultV1
  | TrajectoryDynamicsResultV1
  | TrajectoryPathStatistics
  | TrajectoryComparisonResult
  | TrajectoryBootstrapResult;

export class AnalysisTaskExecutionError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "AnalysisTaskExecutionError";
    this.code = code;
    this.path = path;
  }
}

function reject(code: string, path: string, message: string): never {
  throw new AnalysisTaskExecutionError(code, path, message);
}

function canonicalJson(value: unknown, path = "value"): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) reject("NON_FINITE_HASH_VALUE", path, "cannot be hashed canonically");
    return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry, index) => canonicalJson(entry, `${path}[${index}]`)).join(",")}]`;
  }
  if (typeof value !== "object" || value === undefined) {
    reject("UNSUPPORTED_HASH_VALUE", path, "contains an unsupported canonical JSON value");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => {
    if (record[key] === undefined) reject("UNSUPPORTED_HASH_VALUE", `${path}.${key}`, "must not be undefined");
    return `${JSON.stringify(key)}:${canonicalJson(record[key], `${path}.${key}`)}`;
  }).join(",")}}`;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 over the v1 lexicographically-keyed canonical JSON encoding. */
export async function hashAnalysisValueV1(value: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) reject("CRYPTO_UNAVAILABLE", "crypto.subtle", "WebCrypto SHA-256 is required by Node >=20.9 and supported browsers");
  const bytes = new TextEncoder().encode(canonicalJson(value));
  return hex(new Uint8Array(await subtle.digest("SHA-256", bytes)));
}

function exactFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find((field) => !allowedSet.has(field));
  if (unknown) reject("UNKNOWN_EXECUTION_FIELD", path, `contains unknown field ${JSON.stringify(unknown)}`);
  const missing = required.find((field) => !Object.hasOwn(value, field));
  if (missing) reject("MISSING_EXECUTION_FIELD", path, `is missing required field ${JSON.stringify(missing)}`);
}

/**
 * Standalone V2 execution-dataset validator shared by local SDK callers,
 * remote compute boundaries, and publication workers. It validates the exact
 * source discriminant and complete raw result fields before any task runs.
 */
export function assertAnalysisExecutionDatasetV2(
  value: unknown,
  path = "dataset",
): asserts value is AnalysisExecutionDatasetV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    reject("INVALID_EXECUTION_DATASET", path, "must be an object");
  }
  const dataset = value as Record<string, unknown>;
  exactFields(
    dataset,
    ["schemaVersion", "receipt", "specHash", "buildId", "generatedAt", "sourceResult"],
    ["schemaVersion", "receipt", "specHash", "buildId"],
    path,
  );
  if (dataset.schemaVersion !== ANALYSIS_EXECUTION_DATASET_VERSION_V2) {
    reject("INVALID_EXECUTION_DATASET", `${path}.schemaVersion`, `must be ${ANALYSIS_EXECUTION_DATASET_VERSION_V2}`);
  }
  assertDatasetReceiptV1(dataset.receipt, `${path}.receipt`);
  if (typeof dataset.specHash !== "string" || !SHA256.test(dataset.specHash)) reject("INVALID_SPEC_HASH", `${path}.specHash`, "must be a lowercase SHA-256 digest");
  if (typeof dataset.buildId !== "string" || dataset.buildId.trim() === "") reject("INVALID_BUILD_ID", `${path}.buildId`, "must be non-empty");
  if (dataset.generatedAt !== undefined && (typeof dataset.generatedAt !== "string" || Number.isNaN(Date.parse(dataset.generatedAt)))) {
    reject("INVALID_GENERATED_AT", `${path}.generatedAt`, "must be an ISO timestamp");
  }
  if (dataset.sourceResult === undefined) return;
  if (!dataset.sourceResult || typeof dataset.sourceResult !== "object" || Array.isArray(dataset.sourceResult)) reject("INVALID_SOURCE_RESULT", `${path}.sourceResult`, "must be an object");
  const source = dataset.sourceResult as Record<string, unknown>;
  exactFields(source, ["sourceKind", "hash", "result"], ["sourceKind", "hash", "result"], `${path}.sourceResult`);
  if (typeof source.hash !== "string" || !SHA256.test(source.hash)) reject("INVALID_SOURCE_RESULT_HASH", `${path}.sourceResult.hash`, "must be a lowercase SHA-256 digest");
  if (source.sourceKind === "raw-jena") {
    if (!source.result || typeof source.result !== "object" || (source.result as { schemaVersion?: unknown }).schemaVersion !== "3dena.analysis-result.v1") {
      reject("SOURCE_KIND_RESULT_MISMATCH", `${path}.sourceResult.result`, "raw-jena must contain 3dena.analysis-result.v1");
    }
    assertAnalysisTaskResultV1(source.result, "ena-model", `${path}.sourceResult.result`);
    return;
  }
  if (source.sourceKind !== "prepared-exchange") reject("INVALID_SOURCE_KIND", `${path}.sourceResult.sourceKind`, "must be raw-jena or prepared-exchange");
  if (!source.result || typeof source.result !== "object" || (source.result as { schemaVersion?: unknown }).schemaVersion !== "3dena.prepared-space-result.v1") {
    reject("SOURCE_KIND_RESULT_MISMATCH", `${path}.sourceResult.result`, "prepared-exchange must contain 3dena.prepared-space-result.v1");
  }
  assertPreparedDerivedSource(source.result as PreparedSpaceResult);
  const prepared = source.result as PreparedSpaceResult;
  const receipt = dataset.receipt as DatasetReceiptV1;
  if (receipt.format !== "ena3d-json") reject("PREPARED_RECEIPT_FORMAT_MISMATCH", `${path}.receipt.format`, "must be ena3d-json for a prepared-exchange source");
  if (prepared.sourceReceipt.sha256 !== receipt.sha256 || prepared.sourceReceipt.byteLength !== receipt.byteLength) {
    reject("PREPARED_SOURCE_RECEIPT_MISMATCH", `${path}.sourceResult.result.sourceReceipt`, "does not match the activated exact-byte dataset receipt");
  }
}

function validateDataset(dataset: AnalysisExecutionDataset, task: AnalysisTaskV1): string {
  if (!dataset || (
    dataset.schemaVersion !== "3dena.analysis-execution-dataset.v1"
    && dataset.schemaVersion !== ANALYSIS_EXECUTION_DATASET_VERSION_V2
  )) {
    reject(
      "INVALID_EXECUTION_DATASET",
      "dataset.schemaVersion",
      "must be 3dena.analysis-execution-dataset.v1 or 3dena.analysis-execution-dataset.v2",
    );
  }
  if (dataset.schemaVersion === ANALYSIS_EXECUTION_DATASET_VERSION_V2) {
    assertAnalysisExecutionDatasetV2(dataset);
    if (task.kind === "ena-model" && dataset.sourceResult?.sourceKind === "prepared-exchange") {
      reject(
        "PREPARED_TASK_UNSUPPORTED",
        "dataset.sourceResult.sourceKind",
        "ena-model cannot consume PreparedSpaceResult as though it were raw rows",
      );
    }
  }
  assertDatasetReceiptV1(dataset.receipt, "dataset.receipt");
  if (!SHA256.test(dataset.specHash)) reject("INVALID_SPEC_HASH", "dataset.specHash", "must be a lowercase SHA-256 digest");
  if (typeof dataset.buildId !== "string" || dataset.buildId.trim() === "") reject("INVALID_BUILD_ID", "dataset.buildId", "must be non-empty");
  if (dataset.receipt.sha256 !== task.owner.datasetHash) reject("DATASET_OWNER_MISMATCH", "task.owner.datasetHash", "does not match the activated dataset receipt");
  if (dataset.specHash !== task.owner.specHash) reject("SPEC_OWNER_MISMATCH", "task.owner.specHash", "does not match the activated scientific spec");
  if (Date.now() > task.deadlineEpochMilliseconds) reject("TASK_DEADLINE_EXCEEDED", "task.deadlineEpochMilliseconds", "expired before execution began");
  const generatedAt = dataset.generatedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(generatedAt))) reject("INVALID_GENERATED_AT", "dataset.generatedAt", "must be an ISO timestamp");
  return generatedAt;
}

async function sourceResult(
  dataset: AnalysisExecutionDataset,
  task: Exclude<AnalysisTaskV1, { kind: "ena-model" } | { kind: "prepared-import" }>,
): Promise<ResolvedExecutionSource> {
  const source = dataset.sourceResult;
  if (!source) reject("MISSING_SOURCE_RESULT", "dataset.sourceResult", `is required for ${task.kind}`);
  let resolved: ResolvedExecutionSource;
  if (dataset.schemaVersion === "3dena.analysis-execution-dataset.v1") {
    if (source.result?.schemaVersion !== "3dena.analysis-result.v1") {
      reject("INVALID_RAW_SOURCE_RESULT", "dataset.sourceResult.result.schemaVersion", "V1 execution datasets accept raw AnalysisResult only");
    }
    resolved = { sourceKind: "raw-jena", hash: source.hash, result: source.result };
  } else {
    const sourceV2 = dataset.sourceResult;
    if (!sourceV2) reject("MISSING_SOURCE_RESULT", "dataset.sourceResult", `is required for ${task.kind}`);
    exactFields(
      sourceV2 as unknown as Record<string, unknown>,
      ["sourceKind", "hash", "result"],
      ["sourceKind", "hash", "result"],
      "dataset.sourceResult",
    );
    if (sourceV2.sourceKind === "raw-jena") {
      if (sourceV2.result?.schemaVersion !== "3dena.analysis-result.v1") {
        reject("SOURCE_KIND_RESULT_MISMATCH", "dataset.sourceResult", "raw-jena must contain 3dena.analysis-result.v1");
      }
      resolved = sourceV2;
    } else if (sourceV2.sourceKind === "prepared-exchange") {
      if (sourceV2.result?.schemaVersion !== "3dena.prepared-space-result.v1") {
        reject("SOURCE_KIND_RESULT_MISMATCH", "dataset.sourceResult", "prepared-exchange must contain 3dena.prepared-space-result.v1");
      }
      resolved = sourceV2;
    } else {
      reject("INVALID_SOURCE_KIND", "dataset.sourceResult.sourceKind", "must be raw-jena or prepared-exchange");
    }
  }
  if (!SHA256.test(resolved.hash)) reject("INVALID_SOURCE_RESULT_HASH", "dataset.sourceResult.hash", "must be a lowercase SHA-256 digest");
  if (resolved.hash !== task.sourceResultHash) reject("SOURCE_RESULT_OWNER_MISMATCH", "task.sourceResultHash", "does not match dataset.sourceResult.hash");
  const computed = await hashAnalysisValueV1(resolved.result);
  if (computed !== resolved.hash) reject("SOURCE_RESULT_HASH_MISMATCH", "dataset.sourceResult", "result bytes do not match the immutable source hash");
  if (resolved.sourceKind === "prepared-exchange") {
    assertPreparedDerivedSource(resolved.result);
    if (dataset.receipt.format !== "ena3d-json") {
      reject("PREPARED_RECEIPT_FORMAT_MISMATCH", "dataset.receipt.format", "must be ena3d-json for a prepared-exchange source");
    }
    if (
      resolved.result.sourceReceipt.sha256 !== dataset.receipt.sha256
      || resolved.result.sourceReceipt.byteLength !== dataset.receipt.byteLength
    ) {
      reject(
        "PREPARED_SOURCE_RECEIPT_MISMATCH",
        "dataset.sourceResult.result.sourceReceipt",
        "does not match the activated exact-byte dataset receipt",
      );
    }
  }
  return resolved;
}

function dimensionIndex(result: AnalysisResult, dimension: string, path: string): number {
  const index = result.dimensions.indexOf(dimension);
  if (index < 0) reject("UNKNOWN_DIMENSION", path, `is not retained in the source result: ${JSON.stringify(dimension)}`);
  return index;
}

function groupPoints(result: AnalysisResult, canonical: string, path: string): AnalysisPoint[] {
  const points = result.points.filter((point) => point.group?.canonical === canonical);
  if (points.length === 0) reject("UNKNOWN_OR_EMPTY_GROUP", path, "does not select any source points");
  return points;
}

function identityComponent(name: string, value: RawScalar, path: string): StatisticalIdentityComponent {
  if (value === null) reject("MISSING_PAIRED_IDENTITY", path, "paired identity components must not be null");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) reject("NON_FINITE_PAIRED_IDENTITY", path, "must be finite");
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) reject("UNSAFE_PAIRED_IDENTITY", path, "unsafe integer IDs must be source strings");
    return { name, type: "number", value };
  }
  if (typeof value === "boolean") return { name, type: "boolean", value };
  return { name, type: "string", value };
}

function pointPairIdentity(point: AnalysisPoint): StatisticalIdentity {
  const components = point.participantLabel.columns.map((name, index) =>
    identityComponent(name, point.participantLabel.values[index] ?? null, `points[${point.index}].participantLabel.${name}`),
  );
  if (point.time) {
    components.push(identityComponent("@3dena/time", point.time.value, `points[${point.index}].time`));
  }
  return { components };
}

function executeStatistics(
  result: AnalysisResult,
  task: Extract<AnalysisTaskV1, { kind: "statistics" }>,
): StatisticsTaskResultV1 {
  const sideA = groupPoints(result, task.groups[0], "task.groups[0]");
  const sideB = groupPoints(result, task.groups[1], "task.groups[1]");
  const dimensions = task.dimensions.map((dimension, dimensionPosition): StatisticsDimensionResultV1 => {
    const index = dimensionIndex(result, dimension, `task.dimensions[${dimensionPosition}]`);
    if (task.design === "independent") {
      return {
        dimension,
        result: analyzeIndependentSamples({
          schemaVersion: "3dena.stats.independent-input.v1",
          sideA: { label: task.groups[0], values: sideA.map((point) => point.fullCoordinates[index]!) },
          sideB: { label: task.groups[1], values: sideB.map((point) => point.fullCoordinates[index]!) },
          alternative: task.alternative,
          adjustment: task.adjustment,
        }),
      };
    }
    return {
      dimension,
      result: analyzePairedSamples({
        schemaVersion: "3dena.stats.paired-input.v1",
        sideA: {
          label: task.groups[0],
          observations: sideA.map((point) => ({ id: pointPairIdentity(point), value: point.fullCoordinates[index]! })),
        },
        sideB: {
          label: task.groups[1],
          observations: sideB.map((point) => ({ id: pointPairIdentity(point), value: point.fullCoordinates[index]! })),
        },
        alternative: task.alternative,
        adjustment: task.adjustment,
      }),
    };
  });
  return {
    schemaVersion: "3dena.statistics-task-result.v1",
    design: task.design,
    direction: "group-a-minus-group-b",
    groups: [...task.groups],
    dimensions,
  };
}

function preparedPointPairIdentity(point: PreparedSpacePoint): StatisticalIdentity {
  return {
    components: [
      {
        name: "@3dena/prepared-participant",
        type: "string",
        value: point.participant.canonical,
      },
      {
        name: "@3dena/prepared-time",
        type: "string",
        value: point.time.canonical,
      },
    ],
  };
}

function executePreparedStatistics(
  result: PreparedSpaceResult,
  task: Extract<AnalysisTaskV1, { kind: "statistics" }>,
): StatisticsTaskResultV1 {
  const sideA = preparedPointsForGroup(result, task.groups[0], "task.groups[0]");
  const sideB = preparedPointsForGroup(result, task.groups[1], "task.groups[1]");
  const dimensions = task.dimensions.map((dimension, dimensionPosition): StatisticsDimensionResultV1 => {
    const index = preparedDimensionIndex(result, dimension, `task.dimensions[${dimensionPosition}]`);
    if (task.design === "independent") {
      const analyzed = analyzeIndependentSamples({
        schemaVersion: "3dena.stats.independent-input.v1",
        sideA: { label: task.groups[0], values: sideA.map((point) => point.coordinates[index]!) },
        sideB: { label: task.groups[1], values: sideB.map((point) => point.coordinates[index]!) },
        alternative: task.alternative,
        adjustment: task.adjustment,
      });
      return {
        dimension,
        result: {
          ...analyzed,
          diagnostics: [...analyzed.diagnostics, preparedReductionDiagnostic()],
        },
      };
    }
    const analyzed = analyzePairedSamples({
      schemaVersion: "3dena.stats.paired-input.v1",
      sideA: {
        label: task.groups[0],
        observations: sideA.map((point) => ({ id: preparedPointPairIdentity(point), value: point.coordinates[index]! })),
      },
      sideB: {
        label: task.groups[1],
        observations: sideB.map((point) => ({ id: preparedPointPairIdentity(point), value: point.coordinates[index]! })),
      },
      alternative: task.alternative,
      adjustment: task.adjustment,
    });
    return {
      dimension,
      result: {
        ...analyzed,
        diagnostics: [...analyzed.diagnostics, preparedReductionDiagnostic()],
      },
    };
  });
  return {
    schemaVersion: "3dena.statistics-task-result.v1",
    design: task.design,
    direction: "group-a-minus-group-b",
    groups: [...task.groups],
    dimensions,
  };
}

function trajectorySeries(
  result: AnalysisResult,
  group: string,
  namespace: string,
  participantIdentity: "unit" | "participant-label" = "unit",
): TrajectorySeriesInput {
  return adaptAnalysisResultTrajectorySeries(result, { group, namespace, participantIdentity });
}

function executeTrajectoryDynamics(source: AnalysisResult, task: TrajectoryTaskV1): TrajectoryDynamicsResultV1 {
  const trajectory = source.trajectory;
  if (!trajectory) reject("MISSING_SOURCE_TRAJECTORY", "sourceResult.trajectory", "is required for a trajectory task");
  const series = trajectorySeries(source, task.group, `${task.owner.taskId}:trajectory`);
  if (task.periods.length !== trajectory.timeOrder.length || task.periods.length !== series.timeOrder.length) {
    reject("TRAJECTORY_PERIOD_BINDING_MISMATCH", "task.periods", "must bind every source period exactly once in source order");
  }
  const periods = task.periods.map((period, index) => {
    const sourceTime = trajectory.timeOrder[index];
    const seriesTime = series.timeOrder[index];
    if (!sourceTime || !seriesTime || sourceTime.canonical !== period.sourceTimeCanonical) {
      reject("TRAJECTORY_PERIOD_BINDING_MISMATCH", `task.periods[${index}].sourceTimeCanonical`, "does not match the immutable source trajectory time key at this index");
    }
    return { time: seriesTime, value: structuredClone(period.value) };
  });
  const sourcePoints = groupPoints(source, task.group, "task.group");
  if (sourcePoints.length !== series.points.length) {
    reject("TRAJECTORY_ADAPTER_SHAPE_MISMATCH", "sourceResult.points", "adapter point order does not match the immutable source group");
  }
  const points = series.points.map((point, index) => {
    if (task.estimand.kind === "equal-participant-v1") return { ...point };
    const value = sourcePoints[index]!.metadata[task.estimand.metadataField];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      reject(
        "INVALID_TRAJECTORY_WEIGHT",
        `sourceResult.points[${sourcePoints[index]!.index}].metadata.${task.estimand.metadataField}`,
        "weighted trajectories require a finite, strictly positive numeric metadata value for every point",
      );
    }
    return { ...point, weight: value };
  });
  try {
    return analyzeTrajectoryDynamicsV1({
      schemaVersion: "3dena.trajectory-dynamics-input.v1",
      namespace: series.namespace,
      points,
      dimensions: [...series.dimensions],
      selectedDimensions: [...task.selectedDimensions],
      periods,
      cohortPolicy: task.cohortPolicy,
      estimand: { kind: task.estimand.kind },
    });
  } catch (error) {
    if (error instanceof TrajectoryDynamicsError) {
      reject(error.code, `trajectory.${error.path}`, error.message);
    }
    throw error;
  }
}

function withPreparedDiagnostic<T extends { diagnostics: AnalysisDiagnostic[] }>(result: T): T {
  return { ...result, diagnostics: [...result.diagnostics, preparedReductionDiagnostic()] };
}

function executePreparedTrajectoryDynamics(source: PreparedSpaceResult, task: TrajectoryTaskV1): TrajectoryDynamicsResultV1 {
  const series = adaptPreparedSpaceTrajectorySeries(source, {
    group: task.group,
    namespace: `${task.owner.taskId}:prepared-trajectory`,
  });
  task.selectedDimensions.forEach((dimension, index) => preparedDimensionIndex(source, dimension, `task.selectedDimensions[${index}]`));
  const sourceTimeOrder = source.displaySpace.trajectory.timeOrder;
  if (task.periods.length !== sourceTimeOrder.length || task.periods.length !== series.timeOrder.length) {
    reject("TRAJECTORY_PERIOD_BINDING_MISMATCH", "task.periods", "must bind every prepared source period exactly once in source order");
  }
  const periods = task.periods.map((period, index) => {
    const sourceTime = sourceTimeOrder[index];
    const seriesTime = series.timeOrder[index];
    if (!sourceTime || !seriesTime || sourceTime.canonical !== period.sourceTimeCanonical) {
      reject("TRAJECTORY_PERIOD_BINDING_MISMATCH", `task.periods[${index}].sourceTimeCanonical`, "does not match the immutable prepared time key at this index");
    }
    return { time: seriesTime, value: structuredClone(period.value) };
  });
  const sourcePoints = preparedPointsForGroup(source, task.group, "task.group");
  const points = series.points.map((point, index) => {
    if (task.estimand.kind === "equal-participant-v1") return { ...point };
    const weight = sourcePoints[index]?.metadata[task.estimand.metadataField];
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) {
      reject("INVALID_TRAJECTORY_WEIGHT", `sourceResult.fullSpace.points[${sourcePoints[index]?.index ?? index}].metadata.${task.estimand.metadataField}`, "weighted prepared trajectories require one finite, strictly positive numeric metadata value per point");
    }
    return { ...point, weight };
  });
  try {
    const result = analyzeTrajectoryDynamicsV1({
      schemaVersion: "3dena.trajectory-dynamics-input.v1",
      namespace: series.namespace,
      points,
      dimensions: [...series.dimensions],
      selectedDimensions: [...task.selectedDimensions],
      periods,
      cohortPolicy: task.cohortPolicy,
      estimand: { kind: task.estimand.kind },
    });
    const diagnostics = [...result.diagnostics, preparedReductionDiagnostic()];
    return {
      ...result,
      diagnostics,
      diagnosticSummary: {
        info: diagnostics.filter((diagnostic) => diagnostic.severity === "info").length,
        warning: diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
        codes: [...new Set(diagnostics.map((diagnostic) => diagnostic.code))],
      },
    };
  } catch (error) {
    if (error instanceof TrajectoryDynamicsError) reject(error.code, `trajectory.${error.path}`, error.message);
    throw error;
  }
}

function diagnosticsFor(result: AnalysisTaskResultV1): AnalysisDiagnostic[] {
  if (result.schemaVersion === "3dena.analysis-result.v1"
    || result.schemaVersion === "3dena.prepared-space-result.v1"
    || result.schemaVersion === "3dena.network-comparison.v1"
    || result.schemaVersion === "3dena.change-network.v1"
    || result.schemaVersion === "3dena.trajectory-dynamics.v1"
    || result.schemaVersion === "3dena.trajectory-path-statistics.v1"
    || result.schemaVersion === "3dena.trajectory-comparison.v1"
    || result.schemaVersion === "3dena.trajectory-bootstrap.v1") {
    return result.diagnostics.map((diagnostic) => ({ ...diagnostic }));
  }
  return result.dimensions.flatMap(({ dimension, result: dimensionResult }) =>
    dimensionResult.diagnostics.map((diagnostic) => ({ ...diagnostic, path: diagnostic.path ?? `dimensions.${dimension}` })),
  );
}

function decodePreparedBase64(value: string): Uint8Array<ArrayBuffer> {
  let binary: string;
  try {
    binary = globalThis.atob(value);
  } catch {
    reject("INVALID_PREPARED_BASE64", "task.input.exactBytesBase64", "must decode as canonical base64");
  }
  if (globalThis.btoa(binary) !== value) {
    reject("INVALID_PREPARED_BASE64", "task.input.exactBytesBase64", "must use canonical padding and trailing bits");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function executePreparedImport(
  dataset: AnalysisExecutionDataset,
  task: Extract<AnalysisTaskV1, { kind: "prepared-import" }>,
): Promise<PreparedSpaceResult> {
  if (dataset.receipt.format !== "ena3d-json") {
    reject("PREPARED_RECEIPT_FORMAT_MISMATCH", "dataset.receipt.format", "must be ena3d-json for prepared-import");
  }
  const bytes = decodePreparedBase64(task.input.exactBytesBase64);
  const artifact = await decodeEna3dExchangeV1WithSha256(bytes);
  if (artifact.sha256 !== dataset.receipt.sha256
      || artifact.byteLength !== dataset.receipt.byteLength) {
    reject("PREPARED_SOURCE_RECEIPT_MISMATCH", "task.input.exactBytesBase64", "does not match the immutable upload receipt");
  }
  const result = analyzePreparedSpace({
    source: { artifact, name: task.input.sourceName },
    mapping: task.input.mapping,
  });
  const dimensions = result.fullSpace.dimensions;
  if (dataset.receipt.rows !== result.fullSpace.points.length
      || dataset.receipt.columns !== dimensions.length
      || dataset.receipt.schema.headers.length !== dimensions.length
      || dataset.receipt.schema.columns.length !== dimensions.length
      || dimensions.some((dimension, index) =>
        dataset.receipt.schema.headers[index] !== dimension
        || dataset.receipt.schema.columns[index]?.name !== dimension
        || dataset.receipt.schema.columns[index]?.inferredType !== "number"
        || dataset.receipt.schema.columns[index]?.roles.length !== 1
        || dataset.receipt.schema.columns[index]?.roles[0] !== "unmapped")) {
    reject("PREPARED_INVENTORY_MISMATCH", "dataset.receipt", "does not match the service-decoded prepared exchange result");
  }
  return result;
}

async function executeTaskResult(
  dataset: AnalysisExecutionDataset,
  task: AnalysisTaskV1,
): Promise<{ result: AnalysisTaskResultV1; sourceKind: "raw-jena" | "prepared-exchange" }> {
  switch (task.kind) {
    case "ena-model":
      return { result: analyzeRows(task.input), sourceKind: "raw-jena" };
    case "prepared-import":
      return { result: await executePreparedImport(dataset, task), sourceKind: "prepared-exchange" };
    case "network-comparison": {
      const source = await sourceResult(dataset, task);
      return {
        result: source.sourceKind === "raw-jena"
          ? compareGroupNetworks(source.result, task.groups)
          : comparePreparedGroupNetworks(source.result, task.groups),
        sourceKind: source.sourceKind,
      };
    }
    case "change-network": {
      const source = await sourceResult(dataset, task);
      const selector = { field: task.field, level: task.level };
      return {
        result: source.sourceKind === "raw-jena"
          ? analyzeChangeNetwork(source.result, selector)
          : analyzePreparedChangeNetwork(source.result, selector),
        sourceKind: source.sourceKind,
      };
    }
    case "statistics": {
      const source = await sourceResult(dataset, task);
      return {
        result: source.sourceKind === "raw-jena"
          ? executeStatistics(source.result, task)
          : executePreparedStatistics(source.result, task),
        sourceKind: source.sourceKind,
      };
    }
    case "trajectory": {
      const source = await sourceResult(dataset, task);
      if (source.sourceKind === "prepared-exchange") {
        return { result: executePreparedTrajectoryDynamics(source.result, task), sourceKind: "prepared-exchange" };
      }
      for (const [index, dimension] of task.selectedDimensions.entries()) dimensionIndex(source.result, dimension, `task.selectedDimensions[${index}]`);
      return { result: executeTrajectoryDynamics(source.result, task), sourceKind: "raw-jena" };
    }
    case "trajectory-comparison": {
      const source = await sourceResult(dataset, task);
      const paired = task.design === "paired";
      const sideA = source.sourceKind === "raw-jena"
        ? trajectorySeries(source.result, task.groups[0], `${task.owner.taskId}:A`, paired ? "participant-label" : "unit")
        : adaptPreparedSpaceTrajectorySeries(source.result, { group: task.groups[0], namespace: `${task.owner.taskId}:prepared:A` });
      const sideB = source.sourceKind === "raw-jena"
        ? trajectorySeries(source.result, task.groups[1], `${task.owner.taskId}:B`, paired ? "participant-label" : "unit")
        : adaptPreparedSpaceTrajectorySeries(source.result, { group: task.groups[1], namespace: `${task.owner.taskId}:prepared:B` });
      if (paired) {
        const pairedId = source.sourceKind === "raw-jena"
          ? source.result.points.find((point) => point.group?.canonical === task.groups[0])?.participantLabel.columns ?? []
          : source.result.fullSpace.points.find((point) => point.group.canonical === task.groups[0])?.participant.columns ?? [];
        if (pairedId.length === 0) reject("MISSING_PAIRED_ID", "sourceResult.points", "does not expose a participant-label identity");
        return {
          result: source.sourceKind === "prepared-exchange" ? withPreparedDiagnostic(compareTrajectoryPaths({
            design: "paired",
            pairedId,
            sideA: { label: task.groups[0], series: sideA },
            sideB: { label: task.groups[1], series: sideB },
          })) : compareTrajectoryPaths({
            design: "paired",
            pairedId,
            sideA: { label: task.groups[0], series: sideA },
            sideB: { label: task.groups[1], series: sideB },
          }),
          sourceKind: source.sourceKind,
        };
      }
      const comparison = compareTrajectoryPaths({
        design: "independent",
        sideA: { label: task.groups[0], series: sideA },
        sideB: { label: task.groups[1], series: sideB },
      });
      return {
        result: source.sourceKind === "prepared-exchange" ? withPreparedDiagnostic(comparison) : comparison,
        sourceKind: source.sourceKind,
      };
    }
    case "bootstrap": {
      const source = await sourceResult(dataset, task);
      const series = source.sourceKind === "raw-jena"
        ? trajectorySeries(source.result, task.group, `${task.owner.taskId}:bootstrap`)
        : adaptPreparedSpaceTrajectorySeries(source.result, { group: task.group, namespace: `${task.owner.taskId}:prepared-bootstrap` });
      const units = getTrajectoryBootstrapUnits({ series, stratifyBy: "none" });
      const plan = createSeededTrajectoryBootstrapPlan({ units, repetitions: task.replicates, seed: task.seed });
      const bootstrap = bootstrapTrajectoryPath({
        series,
        stratifyBy: "none",
        confidenceLevel: task.confidenceLevel,
        plan,
      });
      return {
        result: source.sourceKind === "prepared-exchange" ? withPreparedDiagnostic(bootstrap) : bootstrap,
        sourceKind: source.sourceKind,
      };
    }
  }
}

/**
 * Executes one public SDK task locally using the same TypeScript core as the
 * compute worker. Remote clients submit the identical task envelope instead.
 */
export async function executeAnalysisTask(
  dataset: AnalysisExecutionDataset,
  task: AnalysisTaskV1,
): Promise<AnalysisResultEnvelopeV1<AnalysisTaskResultV1>> {
  assertAnalysisTaskV1(task);
  const generatedAt = validateDataset(dataset, task);
  const execution = await executeTaskResult(dataset, task);
  const { result, sourceKind } = execution;
  if (Date.now() > task.deadlineEpochMilliseconds) reject("TASK_DEADLINE_EXCEEDED", "task.deadlineEpochMilliseconds", "expired before result publication");
  assertAnalysisTaskResultV1(result, task.kind);
  const resultHash = await hashAnalysisValueV1(result);
  const sourceSchemaVersion = task.kind === "ena-model"
    ? null
    : dataset.sourceResult?.result.schemaVersion ?? null;
  const envelope: AnalysisResultEnvelopeV1<AnalysisTaskResultV1> = {
    schemaVersion: RESULT_ENVELOPE_VERSION_V1,
    owner: { ...task.owner },
    taskKind: task.kind,
    result,
    diagnostics: diagnosticsFor(result),
    evidence: {
      schemaVersion: "3dena.evidence-stamp.v1",
      scope: "feature",
      status: "IMPLEMENTED_UNVERIFIED",
      datasetHash: task.owner.datasetHash,
      specHash: task.owner.specHash,
      buildId: dataset.buildId,
      approvedForParity: false,
    },
    provenance: {
      schemaVersion: PROVENANCE_MANIFEST_VERSION_V1,
      datasetHash: task.owner.datasetHash,
      specHash: task.owner.specHash,
      resultHash,
      adapterVersion: "0.1.0",
      jenaPackage: "jena-js",
      jenaVersion: "0.6.2",
      jenaCommit: "2f63db4c6ccf5684afc8437ae81ed1a3ccd0c1a3",
      sourceKind,
      jenaExecuted: sourceKind === "raw-jena",
      sdkPackage: "@3dena/analysis",
      sdkVersion: "0.1.0",
      appVersion: "sdk-local",
      contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
      buildId: dataset.buildId,
      seed: task.kind === "bootstrap" ? task.seed : null,
      toleranceContract: null,
      schemaVersions: [...new Set([
        task.schemaVersion,
        ...(sourceSchemaVersion ? [sourceSchemaVersion] : []),
        result.schemaVersion,
        RESULT_ENVELOPE_VERSION_V1,
      ])],
      generatedAt,
    },
  };
  assertAnalysisResultEnvelopeV1(envelope);
  return envelope;
}
