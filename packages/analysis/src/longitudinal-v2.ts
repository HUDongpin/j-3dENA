import type {
  TrajectoryDynamicsResultV1,
  TrajectoryIdentityV1,
  TrajectoryTimeValueV1,
} from "@3dena/trajectory";
import {
  analyzeTrajectoryPathSetV2,
  TrajectoryDynamicsError,
  type TrajectoryDynamicsPointV1,
  type TrajectoryPathSetGroupInputV2,
} from "@3dena/trajectory";
import {
  friedmanRankTestV2,
  holmAdjustFamilyV2,
  mannWhitneyRankTestV2,
  wilcoxonSignedRankTestV2,
} from "@3dena/stats";

import { adaptAnalysisResultTrajectorySeries } from "./trajectory-series-adapters";
import {
  bootstrapTrajectoryPath,
  analyzeTrajectoryPath,
  compareTrajectoryPaths,
  createSeededTrajectoryBootstrapPlan,
  getTrajectoryBootstrapUnits,
  getTrajectoryPermutationUnits,
  trajectoryPercentile,
  type IndependentPoolPermutationPlan,
  type PairedSwapPermutationPlan,
  type TrajectoryBootstrapInterval,
  type TrajectoryBootstrapResult,
  type TrajectoryComparisonResult,
  type TrajectoryPathStatistics,
  type TrajectorySeriesInput,
} from "./trajectory-statistics";
import {
  assertAnalysisExecutionDatasetV2,
  hashAnalysisValueV1,
  type AnalysisExecutionDatasetV2,
} from "./task-executor";
import type { AnalysisPoint, RawScalar } from "./types";

const SHA256 = /^[a-f0-9]{64}$/u;

export const TRAJECTORY_RUN_SPEC_VERSION_V2 = "3dena.trajectory-run-spec.v2" as const;
export const LONGITUDINAL_BUNDLE_VERSION_V2 = "3dena.longitudinal-analysis-bundle.v2" as const;
export const TRAJECTORY_DISPLAY_SPEC_VERSION_V2 = "3dena.trajectory-display-spec.v2" as const;

export type OrderedPeriodValueV2 =
  | { type: "ordered-index-v2"; index: number }
  | TrajectoryTimeValueV1;

export interface OrderedTrajectoryPeriodV2 {
  identity: TrajectoryIdentityV1;
  sourceTimeCanonical: string;
  displayLabel: string;
  expected: boolean;
  value: OrderedPeriodValueV2;
}

export type TrajectoryEstimandV2 =
  | { kind: "equal-participant" }
  | { kind: "weighted-participant"; metadataField: string };

export interface TrajectoryRunSpecV2 {
  schemaVersion: typeof TRAJECTORY_RUN_SPEC_VERSION_V2;
  sourceResultHash: string;
  participantColumns: string[];
  timeColumn: string;
  groupColumn: string | null;
  orderedPeriods: OrderedTrajectoryPeriodV2[];
  selectedDimensions: [string, string, string];
  cohortPolicy: "available" | "complete";
  missingValuePolicy: "complete-analytical-rows";
  estimand: TrajectoryEstimandV2;
}

export interface TrajectoryPathTaskV2 {
  schemaVersion: "3dena.trajectory-path-task.v2";
  kind: "trajectory-path-v2";
  datasetHash: string;
  specHash: string;
  runId: string;
  runSpec: TrajectoryRunSpecV2;
}

export type TrajectoryInferenceRequestV2 =
  | {
      kind: "independent-period";
      groups: [string, string];
      periodCanonical: string;
    }
  | {
      kind: "paired-periods";
      group: string | null;
      earlierPeriodCanonical: string;
      laterPeriodCanonical: string;
      samePhysicalEntityConfirmed: boolean;
    }
  | {
      kind: "repeated-periods";
      group: string | null;
      periodCanonicals: string[];
      samePhysicalEntityConfirmed: boolean;
    }
  | {
      kind: "path-comparison";
      design: "independent" | "paired";
      groups: [string, string];
      repetitions: number;
      seed: number;
      samePhysicalEntityConfirmed: boolean;
    };

export interface TrajectoryInferenceTaskV2 {
  schemaVersion: "3dena.trajectory-inference-task.v2";
  kind: "trajectory-inference-v2";
  datasetHash: string;
  specHash: string;
  sourceResultHash: string;
  runId: string;
  requests: TrajectoryInferenceRequestV2[];
  adjustment: "holm";
}

export interface TrajectoryBootstrapTaskV2 {
  schemaVersion: "3dena.trajectory-bootstrap-task.v2";
  kind: "trajectory-bootstrap-v2";
  datasetHash: string;
  specHash: string;
  sourceResultHash: string;
  runId: string;
  repetitions: number;
  confidenceLevel: number;
  seed: number;
  resamplingDesign: "auto" | "global-participant" | "within-group" | "explicit-strata";
  explicitStrataField: string | null;
  interval: "pointwise-percentile-linear-type7";
  rotationPolicy: "fixed-same-fit-projection";
}

export interface TrajectoryNetworkOverlayTaskV2 {
  schemaVersion: "3dena.trajectory-network-overlay-task.v2";
  kind: "trajectory-network-overlay-v2";
  datasetHash: string;
  specHash: string;
  sourceResultHash: string;
  runId: string;
  requests: Array<{
    periodCanonical: string;
    groupCanonical: string | null;
  }>;
}

export interface LongitudinalGroupPathV2 {
  group: { canonical: string; display: string };
  dynamics: TrajectoryDynamicsResultV1;
}

export interface LongitudinalInferenceResultV2 {
  request: TrajectoryInferenceRequestV2;
  status: "available" | "not-estimable" | "disabled";
  familyId: string;
  familySize: number;
  rows: ReadonlyArray<Record<string, unknown>>;
  reason: string | null;
}

export interface LongitudinalPathComparisonV2 {
  groups: [string, string];
  design: "independent" | "paired";
  seed: number;
  planHash: string;
  identityOverlapAudit: {
    sideAEntities: number;
    sideBEntities: number;
    overlappingEntities: number;
    pairedCompleteEntities: number;
    sideAOnly: number;
    sideBOnly: number;
    excludedIncompleteOverlap: number;
    samePhysicalEntityConfirmed: true;
  } | null;
  result: TrajectoryComparisonResult;
}

export interface LongitudinalBootstrapResultV2 {
  groupCanonical: string;
  status: "available" | "not-estimable";
  notEstimableReason: string | null;
  seed: number;
  planHash: string;
  finiteReplicates: number;
  requiredFiniteReplicates: number;
  totalReplicates: number;
  confidenceLevel: number;
  requestedResamplingDesign: TrajectoryBootstrapTaskV2["resamplingDesign"];
  resolvedResamplingDesign: Exclude<TrajectoryBootstrapTaskV2["resamplingDesign"], "auto">;
  resamplingAlgorithm:
    | "participant-complete-history-mulberry32-uint32-v1"
    | "global-participant-complete-history-mulberry32-uint32-v2";
  intervalContract: "pointwise-percentile-linear-type7";
  rotationPolicy: "fixed-same-fit-projection";
  speedIntervals: Array<{
    periodCanonical: string;
    selected: TrajectoryBootstrapResult["periods"][number]["selectedStepDistance"];
    full: TrajectoryBootstrapResult["periods"][number]["fullStepDistance"];
  }>;
  result: TrajectoryBootstrapResult;
}

export interface LongitudinalNetworkOverlayV2 {
  status: "available" | "not-estimable";
  reason: string | null;
  groupCanonical: string | null;
  periodCanonical: string;
  dimensions: [string, string, string];
  estimand: TrajectoryEstimandV2["kind"];
  sourceRows: number;
  participantPeriods: number;
  effectiveParticipantN: number | null;
  nodes: Array<{
    code: string;
    coordinates: [number, number, number];
    weight: number;
  }>;
  edges: Array<{
    id: string;
    sourceIndex: number;
    targetIndex: number;
    weight: number;
  }>;
}

export type LongitudinalEvidenceStatusV2 =
  | "IMPLEMENTED_UNVERIFIED"
  | "PARITY_CANDIDATE"
  | "PRODUCTION_CANDIDATE"
  | "PRODUCTION_READY";

export interface LongitudinalAnalysisBundleV2 {
  schemaVersion: typeof LONGITUDINAL_BUNDLE_VERSION_V2;
  identity: {
    datasetHash: string;
    specHash: string;
    sourceResultHash: string;
    resultHash: string;
    runId: string;
    jenaBuildId: string;
  };
  runSpec: TrajectoryRunSpecV2;
  model: {
    type: "SeparateTrajectory" | "AccumulatedTrajectory";
    fullRotationDimensions: string[];
    selectedDimensions: [string, string, string];
  };
  paths: LongitudinalGroupPathV2[];
  inference: LongitudinalInferenceResultV2[];
  pathComparisons: LongitudinalPathComparisonV2[];
  bootstrap: LongitudinalBootstrapResultV2[];
  networkOverlays: LongitudinalNetworkOverlayV2[];
  diagnostics: Array<{
    code: string;
    severity: "error" | "warning" | "info";
    message: string;
    path?: string;
  }>;
  execution: {
    target: "browser-worker" | "persistent-compute-service" | "node-service";
    jenaVersion: string;
    jenaCommit: string;
    jenaTarballIntegrity: string;
    sdkVersion: string;
    buildId: string;
    seed: number;
    permutationPlanHashes: string[];
    resamplingPlanHashes: string[];
    evidenceStatus: LongitudinalEvidenceStatusV2;
  };
}

export interface LongitudinalExecutionRequestV2 {
  dataset: AnalysisExecutionDatasetV2;
  pathTask: TrajectoryPathTaskV2;
  inferenceTask?: TrajectoryInferenceTaskV2;
  bootstrapTask?: TrajectoryBootstrapTaskV2;
  networkOverlayTask?: TrajectoryNetworkOverlayTaskV2;
  execution: {
    target: LongitudinalAnalysisBundleV2["execution"]["target"];
    jenaVersion: string;
    jenaCommit: string;
    jenaTarballIntegrity: string;
    sdkVersion: string;
    buildId: string;
    seed: number;
  };
}

export class LongitudinalExecutionErrorV2 extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "LongitudinalExecutionErrorV2";
    this.code = code;
    this.path = path;
  }
}

export type TrajectoryProjectionV2 = "3d" | "xy" | "xz" | "yz" | "yx" | "zx" | "zy";

export interface TrajectoryDisplaySpecV2 {
  schemaVersion: typeof TRAJECTORY_DISPLAY_SPEC_VERSION_V2;
  projection: TrajectoryProjectionV2;
  displayedGroups: string[];
  traces: {
    participants: boolean;
    individualPaths: boolean;
    centroids: boolean;
    paths: boolean;
    directionArrows: boolean;
    uncertainty: boolean;
    networkOverlay: boolean;
    labels: boolean;
  };
  axisFlips: [boolean, boolean, boolean];
  camera: {
    eye: { x: number; y: number; z: number };
    center: { x: number; y: number; z: number };
    up: { x: number; y: number; z: number };
  } | null;
  style: {
    participantSize: number;
    participantOpacity: number;
    centroidSize: number;
    pathWidth: number;
  };
}

export type TrajectoryPlotlyTraceRoleV2 =
  | "participant"
  | "individual-path"
  | "centroid"
  | "trajectory-path"
  | "direction-arrow"
  | "uncertainty"
  | "network-node"
  | "network-edge"
  | "axis-shaft"
  | "axis-arrowhead";

export interface TrajectoryPlotlyTraceV2 extends Record<string, unknown> {
  type: "scatter" | "scatter3d" | "cone";
  meta: {
    role: TrajectoryPlotlyTraceRoleV2;
    groupCanonical?: string;
    participantCanonical?: string;
    axis?: string;
    resultHash: string;
  };
}

export interface TrajectoryPlotlySpecV2 {
  schemaVersion: "3dena.trajectory-plotly-spec.v2";
  resultHash: string;
  data: TrajectoryPlotlyTraceV2[];
  layout: Record<string, unknown>;
  config: {
    responsive: true;
    displaylogo: false;
    scrollZoom: true;
    toImageButtonOptions: { format: "png"; filename: "3dena-longitudinal-trajectory" };
  };
  diagnostics: LongitudinalAnalysisBundleV2["diagnostics"];
}

function contractError(path: string, message: string): never {
  throw new TypeError(`${path}: ${message}`);
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) contractError(path, "must be an object");
  return value as Record<string, unknown>;
}

function exactFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find((field) => !allowedSet.has(field));
  if (unknown) contractError(path, `contains unknown field ${JSON.stringify(unknown)}`);
  const missing = required.find((field) => !Object.hasOwn(value, field));
  if (missing) contractError(path, `is missing required field ${JSON.stringify(missing)}`);
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") contractError(path, "must be a non-empty string");
  return value;
}

function stringList(value: unknown, path: string, exactLength?: number): string[] {
  if (!Array.isArray(value) || value.length === 0) contractError(path, "must be a non-empty string array");
  if (exactLength !== undefined && value.length !== exactLength) contractError(path, `must contain exactly ${exactLength} values`);
  const output = value.map((entry, index) => nonEmptyString(entry, `${path}[${index}]`));
  if (new Set(output).size !== output.length) contractError(path, "must contain distinct values");
  return output;
}

function assertIdentity(value: unknown, path: string): void {
  const identity = objectAt(value, path);
  exactFields(identity, ["components"], ["components"], path);
  if (!Array.isArray(identity.components) || identity.components.length === 0) {
    contractError(`${path}.components`, "must be a non-empty array");
  }
  const names = new Set<string>();
  identity.components.forEach((candidate, index) => {
    const componentPath = `${path}.components[${index}]`;
    const component = objectAt(candidate, componentPath);
    exactFields(component, ["name", "type", "value", "declaredType"], ["name", "type", "value"], componentPath);
    const name = nonEmptyString(component.name, `${componentPath}.name`);
    if (names.has(name)) contractError(`${componentPath}.name`, "duplicates an earlier component name");
    names.add(name);
    if (component.type === "string" && typeof component.value === "string") return;
    if (component.type === "boolean" && typeof component.value === "boolean") return;
    if (component.type === "number" && typeof component.value === "number" && Number.isFinite(component.value)) {
      if (Number.isInteger(component.value) && !Number.isSafeInteger(component.value)) {
        contractError(`${componentPath}.value`, "unsafe integer identities must be supplied as strings");
      }
      return;
    }
    contractError(componentPath, "declared identity type must match its finite value");
  });
}

function assertOrderedPeriodValue(value: unknown, path: string): string {
  const period = objectAt(value, path);
  const type = nonEmptyString(period.type, `${path}.type`);
  if (type === "ordered-index-v2") {
    exactFields(period, ["type", "index"], ["type", "index"], path);
    if (!Number.isSafeInteger(period.index) || (period.index as number) < 0) contractError(`${path}.index`, "must be a non-negative safe integer");
    return type;
  }
  if (type === "numeric-v1") {
    exactFields(period, ["type", "value", "unit"], ["type", "value", "unit"], path);
    if (typeof period.value !== "number" || !Number.isFinite(period.value)) contractError(`${path}.value`, "must be finite");
    nonEmptyString(period.unit, `${path}.unit`);
    return type;
  }
  if (type === "date-v1") {
    exactFields(period, ["type", "value"], ["type", "value"], path);
    const date = nonEmptyString(period.value, `${path}.value`);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      contractError(`${path}.value`, "must be a valid ISO civil date");
    }
    return type;
  }
  if (type === "instant-v1") {
    exactFields(period, ["type", "epochMilliseconds", "timeZone", "offsetMinutes", "fold", "elapsedUnit"], ["type", "epochMilliseconds", "timeZone", "offsetMinutes", "fold", "elapsedUnit"], path);
    if (typeof period.epochMilliseconds !== "string" || !/^-?(?:0|[1-9]\d*)$/u.test(period.epochMilliseconds)) contractError(`${path}.epochMilliseconds`, "must be a canonical integer string");
    nonEmptyString(period.timeZone, `${path}.timeZone`);
    if (!Number.isInteger(period.offsetMinutes) || (period.offsetMinutes as number) < -840 || (period.offsetMinutes as number) > 840) contractError(`${path}.offsetMinutes`, "must be an integer in [-840, 840]");
    if (period.fold !== 0 && period.fold !== 1) contractError(`${path}.fold`, "must be 0 or 1");
    nonEmptyString(period.elapsedUnit, `${path}.elapsedUnit`);
    return type;
  }
  if (type === "difftime-v1") {
    exactFields(period, ["type", "value", "unit", "elapsedUnit"], ["type", "value", "unit", "elapsedUnit"], path);
    if (typeof period.value !== "number" || !Number.isFinite(period.value)) contractError(`${path}.value`, "must be finite");
    nonEmptyString(period.unit, `${path}.unit`);
    nonEmptyString(period.elapsedUnit, `${path}.elapsedUnit`);
    return type;
  }
  contractError(`${path}.type`, `unsupported ordered-period value ${JSON.stringify(type)}`);
}

function periodCoordinate(value: OrderedPeriodValueV2): number | bigint {
  if (value.type === "ordered-index-v2") return value.index;
  if (value.type === "numeric-v1") return value.value;
  if (value.type === "date-v1") return Date.parse(`${value.value}T00:00:00Z`);
  if (value.type === "instant-v1") return BigInt(value.epochMilliseconds);
  const milliseconds = { milliseconds: 1, seconds: 1_000, minutes: 60_000, hours: 3_600_000, days: 86_400_000, weeks: 604_800_000 } as const;
  return value.value * milliseconds[value.unit] / milliseconds[value.elapsedUnit];
}

export function assertTrajectoryRunSpecV2(value: unknown, path = "runSpec"): asserts value is TrajectoryRunSpecV2 {
  const spec = objectAt(value, path);
  exactFields(spec, [
    "schemaVersion", "sourceResultHash", "participantColumns", "timeColumn", "groupColumn", "orderedPeriods",
    "selectedDimensions", "cohortPolicy", "missingValuePolicy", "estimand",
  ], [
    "schemaVersion", "sourceResultHash", "participantColumns", "timeColumn", "groupColumn", "orderedPeriods",
    "selectedDimensions", "cohortPolicy", "missingValuePolicy", "estimand",
  ], path);
  if (spec.schemaVersion !== TRAJECTORY_RUN_SPEC_VERSION_V2) contractError(`${path}.schemaVersion`, `must be ${TRAJECTORY_RUN_SPEC_VERSION_V2}`);
  if (typeof spec.sourceResultHash !== "string" || !SHA256.test(spec.sourceResultHash)) contractError(`${path}.sourceResultHash`, "must be a lowercase SHA-256 digest");
  stringList(spec.participantColumns, `${path}.participantColumns`);
  nonEmptyString(spec.timeColumn, `${path}.timeColumn`);
  if (spec.groupColumn !== null) nonEmptyString(spec.groupColumn, `${path}.groupColumn`);
  const selected = stringList(spec.selectedDimensions, `${path}.selectedDimensions`, 3);
  if (new Set(selected).size !== 3) contractError(`${path}.selectedDimensions`, "must contain three distinct dimensions");
  if (spec.cohortPolicy !== "available" && spec.cohortPolicy !== "complete") contractError(`${path}.cohortPolicy`, "must be available or complete");
  if (spec.missingValuePolicy !== "complete-analytical-rows") contractError(`${path}.missingValuePolicy`, "must be complete-analytical-rows");
  const estimand = objectAt(spec.estimand, `${path}.estimand`);
  if (estimand.kind === "equal-participant") exactFields(estimand, ["kind"], ["kind"], `${path}.estimand`);
  else if (estimand.kind === "weighted-participant") {
    exactFields(estimand, ["kind", "metadataField"], ["kind", "metadataField"], `${path}.estimand`);
    nonEmptyString(estimand.metadataField, `${path}.estimand.metadataField`);
  } else contractError(`${path}.estimand.kind`, "must be equal-participant or weighted-participant");
  if (!Array.isArray(spec.orderedPeriods) || spec.orderedPeriods.length === 0) contractError(`${path}.orderedPeriods`, "must be a non-empty array");
  const sourceCanonicals = new Set<string>();
  const identityCanonicals = new Set<string>();
  let valueType: string | null = null;
  let priorCoordinate: number | bigint | null = null;
  spec.orderedPeriods.forEach((candidate, index) => {
    const periodPath = `${path}.orderedPeriods[${index}]`;
    const period = objectAt(candidate, periodPath);
    exactFields(period, ["identity", "sourceTimeCanonical", "displayLabel", "expected", "value"], ["identity", "sourceTimeCanonical", "displayLabel", "expected", "value"], periodPath);
    assertIdentity(period.identity, `${periodPath}.identity`);
    const canonicalIdentity = JSON.stringify(period.identity);
    if (identityCanonicals.has(canonicalIdentity)) contractError(`${periodPath}.identity`, "duplicates an earlier typed identity");
    identityCanonicals.add(canonicalIdentity);
    const sourceCanonical = nonEmptyString(period.sourceTimeCanonical, `${periodPath}.sourceTimeCanonical`);
    if (sourceCanonicals.has(sourceCanonical)) contractError(`${periodPath}.sourceTimeCanonical`, "duplicates an earlier source identity");
    sourceCanonicals.add(sourceCanonical);
    nonEmptyString(period.displayLabel, `${periodPath}.displayLabel`);
    if (typeof period.expected !== "boolean") contractError(`${periodPath}.expected`, "must be boolean");
    const currentType = assertOrderedPeriodValue(period.value, `${periodPath}.value`);
    if (valueType !== null && currentType !== valueType) contractError(`${periodPath}.value.type`, `must use ${valueType} for every ordered period`);
    valueType = currentType;
    const coordinate = periodCoordinate(period.value as OrderedPeriodValueV2);
    if (priorCoordinate !== null) {
      const increasing = typeof coordinate === "bigint" && typeof priorCoordinate === "bigint"
        ? coordinate > priorCoordinate
        : typeof coordinate === "number" && typeof priorCoordinate === "number" && coordinate > priorCoordinate;
      if (!increasing) contractError(`${periodPath}.value`, "period values must be strictly increasing");
    }
    priorCoordinate = coordinate;
  });
}

/** Strict structural guard for persisted or remotely returned V2 envelopes. */
export function assertLongitudinalAnalysisBundleV2(
  value: unknown,
  path = "bundle",
): asserts value is LongitudinalAnalysisBundleV2 {
  const bundle = objectAt(value, path);
  exactFields(bundle, [
    "schemaVersion", "identity", "runSpec", "model", "paths", "inference", "pathComparisons",
    "bootstrap", "networkOverlays", "diagnostics", "execution",
  ], [
    "schemaVersion", "identity", "runSpec", "model", "paths", "inference", "pathComparisons",
    "bootstrap", "networkOverlays", "diagnostics", "execution",
  ], path);
  if (bundle.schemaVersion !== LONGITUDINAL_BUNDLE_VERSION_V2) {
    contractError(`${path}.schemaVersion`, `must be ${LONGITUDINAL_BUNDLE_VERSION_V2}`);
  }
  const identity = objectAt(bundle.identity, `${path}.identity`);
  exactFields(identity, ["datasetHash", "specHash", "sourceResultHash", "resultHash", "runId", "jenaBuildId"], ["datasetHash", "specHash", "sourceResultHash", "resultHash", "runId", "jenaBuildId"], `${path}.identity`);
  for (const field of ["datasetHash", "specHash", "sourceResultHash", "resultHash"] as const) {
    if (typeof identity[field] !== "string" || !SHA256.test(identity[field])) contractError(`${path}.identity.${field}`, "must be a lowercase SHA-256 digest");
  }
  nonEmptyString(identity.runId, `${path}.identity.runId`);
  nonEmptyString(identity.jenaBuildId, `${path}.identity.jenaBuildId`);
  assertTrajectoryRunSpecV2(bundle.runSpec, `${path}.runSpec`);
  const model = objectAt(bundle.model, `${path}.model`);
  exactFields(model, ["type", "fullRotationDimensions", "selectedDimensions"], ["type", "fullRotationDimensions", "selectedDimensions"], `${path}.model`);
  if (model.type !== "SeparateTrajectory" && model.type !== "AccumulatedTrajectory") contractError(`${path}.model.type`, "must be SeparateTrajectory or AccumulatedTrajectory");
  stringList(model.fullRotationDimensions, `${path}.model.fullRotationDimensions`);
  stringList(model.selectedDimensions, `${path}.model.selectedDimensions`, 3);
  if (JSON.stringify(model.selectedDimensions) !== JSON.stringify((bundle.runSpec as TrajectoryRunSpecV2).selectedDimensions)) {
    contractError(`${path}.model.selectedDimensions`, "must match runSpec.selectedDimensions");
  }
  for (const field of ["paths", "inference", "pathComparisons", "bootstrap", "networkOverlays", "diagnostics"] as const) {
    if (!Array.isArray(bundle[field])) contractError(`${path}.${field}`, "must be an array");
  }
  if ((bundle.paths as unknown[]).length === 0) contractError(`${path}.paths`, "must contain at least one computed group path");
  (bundle.paths as unknown[]).forEach((candidate, index) => {
    const groupPath = objectAt(candidate, `${path}.paths[${index}]`);
    exactFields(groupPath, ["group", "dynamics"], ["group", "dynamics"], `${path}.paths[${index}]`);
    const group = objectAt(groupPath.group, `${path}.paths[${index}].group`);
    exactFields(group, ["canonical", "display"], ["canonical", "display"], `${path}.paths[${index}].group`);
    nonEmptyString(group.canonical, `${path}.paths[${index}].group.canonical`);
    nonEmptyString(group.display, `${path}.paths[${index}].group.display`);
    const dynamics = objectAt(groupPath.dynamics, `${path}.paths[${index}].dynamics`);
    if (dynamics.schemaVersion !== "3dena.trajectory-dynamics.v1") contractError(`${path}.paths[${index}].dynamics.schemaVersion`, "must be 3dena.trajectory-dynamics.v1");
  });
  const execution = objectAt(bundle.execution, `${path}.execution`);
  exactFields(execution, [
    "target", "jenaVersion", "jenaCommit", "jenaTarballIntegrity", "sdkVersion", "buildId", "seed",
    "permutationPlanHashes", "resamplingPlanHashes", "evidenceStatus",
  ], [
    "target", "jenaVersion", "jenaCommit", "jenaTarballIntegrity", "sdkVersion", "buildId", "seed",
    "permutationPlanHashes", "resamplingPlanHashes", "evidenceStatus",
  ], `${path}.execution`);
  validateExecutionMetadata(execution as unknown as LongitudinalExecutionRequestV2["execution"]);
  for (const [field, values] of [["permutationPlanHashes", execution.permutationPlanHashes], ["resamplingPlanHashes", execution.resamplingPlanHashes]] as const) {
    if (!Array.isArray(values) || values.some((hash) => typeof hash !== "string" || !SHA256.test(hash))) contractError(`${path}.execution.${field}`, "must be an array of lowercase SHA-256 digests");
  }
  if (!["IMPLEMENTED_UNVERIFIED", "PARITY_CANDIDATE", "PRODUCTION_CANDIDATE", "PRODUCTION_READY"].includes(String(execution.evidenceStatus))) {
    contractError(`${path}.execution.evidenceStatus`, "is unsupported");
  }
  const typed = bundle as unknown as LongitudinalAnalysisBundleV2;
  if (typed.identity.sourceResultHash !== typed.runSpec.sourceResultHash) {
    contractError(`${path}.identity.sourceResultHash`, "must match runSpec.sourceResultHash");
  }
}

function scientificCoreFromBundleV2(bundle: LongitudinalAnalysisBundleV2) {
  const { resultHash: _resultHash, ...identity } = bundle.identity;
  const { target: _target, ...scientificExecution } = bundle.execution;
  return {
    schemaVersion: bundle.schemaVersion,
    identity,
    runSpec: bundle.runSpec,
    model: bundle.model,
    paths: bundle.paths,
    inference: bundle.inference,
    pathComparisons: bundle.pathComparisons,
    bootstrap: bundle.bootstrap,
    networkOverlays: bundle.networkOverlays,
    diagnostics: bundle.diagnostics,
    scientificExecution,
  };
}

/** Recomputes the canonical scientific hash; execution target is intentionally display/transport provenance only. */
export async function verifyLongitudinalAnalysisBundleV2(bundle: unknown): Promise<void> {
  assertLongitudinalAnalysisBundleV2(bundle);
  const actual = await hashAnalysisValueV1(scientificCoreFromBundleV2(bundle));
  if (actual !== bundle.identity.resultHash) {
    executionReject("LONGITUDINAL_RESULT_HASH_MISMATCH", "bundle.identity.resultHash", "does not match the canonical scientific envelope");
  }
}

function assertDisplaySpec(value: TrajectoryDisplaySpecV2): void {
  const spec = objectAt(value, "displaySpec");
  exactFields(spec, ["schemaVersion", "projection", "displayedGroups", "traces", "axisFlips", "camera", "style"], ["schemaVersion", "projection", "displayedGroups", "traces", "axisFlips", "camera", "style"], "displaySpec");
  if (spec.schemaVersion !== TRAJECTORY_DISPLAY_SPEC_VERSION_V2) contractError("displaySpec.schemaVersion", `must be ${TRAJECTORY_DISPLAY_SPEC_VERSION_V2}`);
  if (!["3d", "xy", "xz", "yz", "yx", "zx", "zy"].includes(String(spec.projection))) contractError("displaySpec.projection", "is unsupported");
  if (!Array.isArray(spec.displayedGroups) || spec.displayedGroups.some((group) => typeof group !== "string")) contractError("displaySpec.displayedGroups", "must be a string array");
  if (!Array.isArray(spec.axisFlips) || spec.axisFlips.length !== 3 || spec.axisFlips.some((entry) => typeof entry !== "boolean")) contractError("displaySpec.axisFlips", "must contain three booleans");
  const traces = objectAt(spec.traces, "displaySpec.traces");
  const traceFields = ["participants", "individualPaths", "centroids", "paths", "directionArrows", "uncertainty", "networkOverlay", "labels"] as const;
  exactFields(traces, traceFields, traceFields, "displaySpec.traces");
  if (traceFields.some((field) => typeof traces[field] !== "boolean")) contractError("displaySpec.traces", "all trace controls must be boolean");
  const style = objectAt(spec.style, "displaySpec.style");
  exactFields(style, ["participantSize", "participantOpacity", "centroidSize", "pathWidth"], ["participantSize", "participantOpacity", "centroidSize", "pathWidth"], "displaySpec.style");
  if (typeof style.participantSize !== "number" || style.participantSize <= 0) contractError("displaySpec.style.participantSize", "must be positive");
  if (typeof style.participantOpacity !== "number" || style.participantOpacity < 0 || style.participantOpacity > 1) contractError("displaySpec.style.participantOpacity", "must be in [0,1]");
  if (typeof style.centroidSize !== "number" || style.centroidSize <= 0) contractError("displaySpec.style.centroidSize", "must be positive");
  if (typeof style.pathWidth !== "number" || style.pathWidth <= 0) contractError("displaySpec.style.pathWidth", "must be positive");
}

const GROUP_COLORS = ["#2563eb", "#b45309", "#7c3aed", "#0f766e", "#be123c", "#475569"] as const;
const AXIS_COLORS = ["#dc2626", "#2563eb", "#16a34a"] as const;

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (Math.imul(hash, 31) + value.charCodeAt(index)) >>> 0;
  return hash;
}

function groupColor(canonical: string): string {
  return GROUP_COLORS[hashString(canonical) % GROUP_COLORS.length] ?? GROUP_COLORS[0];
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function projectionIndexes(projection: TrajectoryProjectionV2): [number, number] | null {
  if (projection === "3d") return null;
  const indexes = { xy: [0, 1], xz: [0, 2], yz: [1, 2], yx: [1, 0], zx: [2, 0], zy: [2, 1] } as const;
  return [...indexes[projection]];
}

function trace(
  dimension: 2 | 3,
  resultHash: string,
  role: TrajectoryPlotlyTraceRoleV2,
  fields: Record<string, unknown>,
  meta: Omit<TrajectoryPlotlyTraceV2["meta"], "role" | "resultHash"> = {},
): TrajectoryPlotlyTraceV2 {
  return {
    type: dimension === 3 ? "scatter3d" : "scatter",
    ...fields,
    meta: { role, resultHash, ...meta },
  };
}

function projectedFields(
  coordinates: Array<[number, number, number] | null>,
  projection: TrajectoryProjectionV2,
  flips: [boolean, boolean, boolean],
): Record<string, unknown> {
  const flip = (value: number, index: number) => flips[index] ? -value : value;
  const indexes = projectionIndexes(projection);
  if (indexes === null) {
    return {
      x: coordinates.map((point) => point === null ? null : flip(point[0], 0)),
      y: coordinates.map((point) => point === null ? null : flip(point[1], 1)),
      z: coordinates.map((point) => point === null ? null : flip(point[2], 2)),
    };
  }
  return {
    x: coordinates.map((point) => point === null ? null : flip(point[indexes[0]]!, indexes[0])),
    y: coordinates.map((point) => point === null ? null : flip(point[indexes[1]]!, indexes[1])),
  };
}

function canonical3(coordinates: readonly number[]): [number, number, number] {
  return [coordinates[0]!, coordinates[1]!, coordinates[2]!];
}

/**
 * Pure presenter compiler. It accepts only a completed longitudinal bundle;
 * projection, filtering, labels, camera and axis flips cannot execute or alter
 * any scientific task.
 */
export function compileTrajectoryPlotlySpec(
  bundle: LongitudinalAnalysisBundleV2,
  displaySpec: TrajectoryDisplaySpecV2,
): TrajectoryPlotlySpecV2 {
  assertLongitudinalAnalysisBundleV2(bundle);
  assertDisplaySpec(displaySpec);
  const resultHash = bundle.identity.resultHash;
  const dimension = displaySpec.projection === "3d" ? 3 : 2;
  const selectedGroups = new Set(displaySpec.displayedGroups);
  const groups = bundle.paths.filter(({ group }) => selectedGroups.size === 0 || selectedGroups.has(group.canonical));
  const data: TrajectoryPlotlyTraceV2[] = [];

  const allCoordinates = groups.flatMap(({ dynamics }) => [
    ...dynamics.participantPeriods.map((point) => point.selectedCoordinates),
    ...dynamics.periods.flatMap((period) => period.selectedCentroid ? [period.selectedCentroid] : []),
  ]);
  const extent = Math.max(1, ...allCoordinates.flatMap((coordinate) => coordinate.map(Math.abs))) * 1.08;
  const axes = projectionIndexes(displaySpec.projection) ?? [0, 1, 2];
  for (const axisIndex of axes) {
    const axisName = bundle.model.selectedDimensions[axisIndex]!;
    const end: [number, number, number] = [0, 0, 0];
    end[axisIndex] = extent;
    data.push(trace(dimension, resultHash, "axis-shaft", {
      mode: "lines+text",
      name: `${axisName} axis`,
      ...projectedFields([[0, 0, 0], end], displaySpec.projection, displaySpec.axisFlips),
      text: ["", axisName],
      line: { color: AXIS_COLORS[axisIndex], width: 5 },
      showlegend: false,
      hoverinfo: "skip",
    }, { axis: axisName }));
    if (dimension === 3) {
      const direction: [number, number, number] = [0, 0, 0];
      direction[axisIndex] = displaySpec.axisFlips[axisIndex] ? -1 : 1;
      const projectedEnd = projectedFields([end], "3d", displaySpec.axisFlips);
      data.push({
        type: "cone",
        x: projectedEnd.x,
        y: projectedEnd.y,
        z: projectedEnd.z,
        u: [direction[0]],
        v: [direction[1]],
        w: [direction[2]],
        anchor: "tip",
        sizemode: "absolute",
        sizeref: extent * 0.08,
        colorscale: [[0, AXIS_COLORS[axisIndex]], [1, AXIS_COLORS[axisIndex]]],
        showscale: false,
        showlegend: false,
        hoverinfo: "skip",
        meta: { role: "axis-arrowhead", resultHash, axis: axisName },
      });
    }
  }

  for (const { group, dynamics } of groups) {
    const color = groupColor(group.canonical);
    if (displaySpec.traces.participants) {
      const points = dynamics.participantPeriods.filter((point) => point.includedInCohort);
      data.push(trace(dimension, resultHash, "participant", {
        mode: "markers",
        name: `${group.display} participant-periods`,
        ...projectedFields(points.map((point) => point.selectedCoordinates), displaySpec.projection, displaySpec.axisFlips),
        text: points.map((point) => point.participant.display),
        customdata: points.map((point) => [point.time.display]),
        hovertemplate: "%{text}<br>%{customdata[0]}<extra></extra>",
        marker: { color, size: displaySpec.style.participantSize, opacity: displaySpec.style.participantOpacity },
      }, { groupCanonical: group.canonical }));
    }
    if (displaySpec.traces.individualPaths) {
      const periodIndex = new Map(dynamics.periods.map((period) => [period.time.canonical, period.index]));
      const participants = new Map<string, typeof dynamics.participantPeriods>();
      for (const point of dynamics.participantPeriods.filter((entry) => entry.includedInCohort)) {
        participants.set(point.participant.canonical, [...(participants.get(point.participant.canonical) ?? []), point]);
      }
      for (const [participantCanonical, participantPoints] of participants) {
        const byPeriod = new Map(participantPoints.map((point) => [periodIndex.get(point.time.canonical), point]));
        const coordinates = dynamics.periods.map((period) => {
          const point = byPeriod.get(period.index);
          return point ? point.selectedCoordinates : null;
        });
        data.push(trace(dimension, resultHash, "individual-path", {
          mode: "lines+markers",
          name: participantPoints[0]!.participant.display,
          ...projectedFields(coordinates, displaySpec.projection, displaySpec.axisFlips),
          connectgaps: false,
          showlegend: false,
          line: { color, width: Math.max(1, displaySpec.style.pathWidth * 0.35) },
          marker: { color, size: Math.max(3, displaySpec.style.participantSize - 1) },
        }, { groupCanonical: group.canonical, participantCanonical }));
      }
    }
    const centroidCoordinates = dynamics.periods.map((period) => period.selectedCentroid);
    if (displaySpec.traces.paths) {
      data.push(trace(dimension, resultHash, "trajectory-path", {
        mode: "lines+markers",
        name: `${group.display} trajectory`,
        ...projectedFields(centroidCoordinates, displaySpec.projection, displaySpec.axisFlips),
        connectgaps: false,
        line: { color, width: displaySpec.style.pathWidth },
        marker: { color, size: displaySpec.style.centroidSize },
        text: dynamics.periods.map((period) => period.time.display),
        hovertemplate: "%{text}<extra></extra>",
      }, { groupCanonical: group.canonical }));
    }
    if (displaySpec.traces.centroids) {
      const available = dynamics.periods.filter((period) => period.selectedCentroid !== null);
      data.push(trace(dimension, resultHash, "centroid", {
        mode: displaySpec.traces.labels ? "markers+text" : "markers",
        name: `${group.display} centroids`,
        ...projectedFields(available.map((period) => period.selectedCentroid), displaySpec.projection, displaySpec.axisFlips),
        text: available.map((period) => period.time.display),
        customdata: available.map((period) => [period.nUsed]),
        marker: { color, size: displaySpec.style.centroidSize, symbol: "square", line: { color: "#ffffff", width: 1.5 } },
        hovertemplate: "%{text}<br>n=%{customdata[0]}<extra></extra>",
      }, { groupCanonical: group.canonical }));
    }
    if (displaySpec.traces.uncertainty) {
      const bootstrap = bundle.bootstrap.find((entry) => entry.groupCanonical === group.canonical);
      if (bootstrap) {
        const projectedIndexes = projectionIndexes(displaySpec.projection) ?? [0, 1, 2];
        const available = bootstrap.result.periods.filter((period) => projectedIndexes.every((axisIndex) => period.selectedCentroid[axisIndex] !== null));
        if (available.length > 0) {
          const estimates = available.map((period) => [0, 1, 2].map((axisIndex) => period.selectedCentroid[axisIndex]?.estimate ?? 0) as [number, number, number]);
          const error = (axisIndex: number) => {
            const intervals = available.map((period) => period.selectedCentroid[axisIndex]!);
            const positive = intervals.map((interval) => interval.upper - interval.estimate);
            const negative = intervals.map((interval) => interval.estimate - interval.lower);
            return {
              type: "data",
              symmetric: false,
              visible: true,
              color,
              thickness: 2,
              width: 4,
              array: displaySpec.axisFlips[axisIndex] ? negative : positive,
              arrayminus: displaySpec.axisFlips[axisIndex] ? positive : negative,
            };
          };
          const projected = projectedFields(estimates, displaySpec.projection, displaySpec.axisFlips);
          data.push(trace(dimension, resultHash, "uncertainty", {
            mode: "markers",
            name: `${group.display} pointwise ${Math.round(bootstrap.result.confidenceLevel * 100)}% intervals`,
            ...projected,
            marker: { color, size: Math.max(3, displaySpec.style.centroidSize * 0.45), opacity: 0.32 },
            error_x: error(projectedIndexes[0]!),
            error_y: error(projectedIndexes[1]!),
            ...(dimension === 3 ? { error_z: error(projectedIndexes[2]!) } : {}),
            text: available.map((period) => period.time.display),
            hovertemplate: "%{text}<br>pointwise centroid interval<extra></extra>",
          }, { groupCanonical: group.canonical }));
        }
      }
    }
    if (displaySpec.traces.directionArrows) {
      for (let index = 1; index < dynamics.periods.length; index += 1) {
        const previous = dynamics.periods[index - 1]!.selectedCentroid;
        const current = dynamics.periods[index]!.selectedCentroid;
        if (previous === null || current === null || dynamics.periods[index]!.selected3d.stepDistance === null) continue;
        if (dimension === 3) {
          const currentProjected = projectedFields([current], "3d", displaySpec.axisFlips);
          const delta = current.map((value, axisIndex) => {
            const raw = value - previous[axisIndex]!;
            return displaySpec.axisFlips[axisIndex] ? -raw : raw;
          });
          data.push({
            type: "cone",
            x: currentProjected.x,
            y: currentProjected.y,
            z: currentProjected.z,
            u: [delta[0]],
            v: [delta[1]],
            w: [delta[2]],
            anchor: "tip",
            sizemode: "absolute",
            sizeref: Math.max(0.06, extent * 0.06),
            colorscale: [[0, color], [1, color]],
            showscale: false,
            showlegend: false,
            hoverinfo: "skip",
            meta: { role: "direction-arrow", resultHash, groupCanonical: group.canonical },
          });
        } else {
          const indexes = projectionIndexes(displaySpec.projection)!;
          const projected = projectedFields([previous, current], displaySpec.projection, displaySpec.axisFlips);
          const dx = (current[indexes[0]]! - previous[indexes[0]]!) * (displaySpec.axisFlips[indexes[0]] ? -1 : 1);
          const dy = (current[indexes[1]]! - previous[indexes[1]]!) * (displaySpec.axisFlips[indexes[1]] ? -1 : 1);
          const angle = 90 - Math.atan2(dy, dx) * 180 / Math.PI;
          data.push(trace(2, resultHash, "direction-arrow", {
            mode: "lines+markers",
            name: `${group.display} direction`,
            ...projected,
            line: { color, width: Math.max(1, displaySpec.style.pathWidth * 0.45) },
            marker: {
              color,
              size: [0, Math.max(9, displaySpec.style.centroidSize * 0.85)],
              symbol: ["circle", "arrow-up"],
              angle: [0, angle],
            },
            showlegend: false,
            hoverinfo: "skip",
          }, { groupCanonical: group.canonical }));
        }
      }
    }
  }

  if (displaySpec.traces.networkOverlay) {
    const overlays = bundle.networkOverlays.filter((overlay) => (
      overlay.status === "available"
      && (overlay.groupCanonical === null || selectedGroups.size === 0 || selectedGroups.has(overlay.groupCanonical))
    ));
    for (const overlay of overlays) {
      const nodes = overlay.nodes;
      data.push(trace(dimension, resultHash, "network-node", {
        mode: "markers+text",
        name: "Mean network nodes",
        ...projectedFields(nodes.map((node) => node.coordinates), displaySpec.projection, displaySpec.axisFlips),
        text: nodes.map((node) => node.code),
        marker: { size: nodes.map((node) => 8 + Math.sqrt(Math.max(0, node.weight)) * 4), color: "#f8fafc", line: { color: "#0f172a", width: 2 } },
      }, { ...(overlay.groupCanonical ? { groupCanonical: overlay.groupCanonical } : {}) }));
      for (const edge of overlay.edges) {
        const source = nodes[edge.sourceIndex];
        const target = nodes[edge.targetIndex];
        if (!source || !target) continue;
        data.push(trace(dimension, resultHash, "network-edge", {
          mode: "lines",
          name: edge.id,
          ...projectedFields([source.coordinates, target.coordinates], displaySpec.projection, displaySpec.axisFlips),
          line: { width: Math.max(0.75, Math.abs(edge.weight) * 5), color: edge.weight < 0 ? "#be123c" : "#64748b" },
          showlegend: false,
        }, { ...(overlay.groupCanonical ? { groupCanonical: overlay.groupCanonical } : {}) }));
      }
    }
  }

  const axisTitle = (index: number) => `${displaySpec.axisFlips[index] ? "−" : ""}${bundle.model.selectedDimensions[index]}`;
  const layout: Record<string, unknown> = {
    autosize: true,
    showlegend: true,
    hovermode: "closest",
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    margin: { l: 56, r: 24, t: 32, b: 56 },
    uirevision: `${resultHash}:${displaySpec.projection}`,
    meta: { scientificResultHash: resultHash, scientificTaskExecuted: false, projection: displaySpec.projection },
    ...(dimension === 3
      ? {
          scene: {
            xaxis: { title: axisTitle(0), zeroline: true, showgrid: true },
            yaxis: { title: axisTitle(1), zeroline: true, showgrid: true },
            zaxis: { title: axisTitle(2), zeroline: true, showgrid: true },
            aspectmode: "data",
            ...(displaySpec.camera ? { camera: structuredClone(displaySpec.camera) } : {}),
          },
        }
      : {
          xaxis: { title: axisTitle(axes[0]!), zeroline: true, showgrid: true },
          yaxis: { title: axisTitle(axes[1]!), zeroline: true, showgrid: true, scaleanchor: "x", scaleratio: 1 },
        }),
  };
  return deepFreeze({
    schemaVersion: "3dena.trajectory-plotly-spec.v2",
    resultHash,
    data,
    layout,
    config: {
      responsive: true,
      displaylogo: false,
      scrollZoom: true,
      toImageButtonOptions: { format: "png", filename: "3dena-longitudinal-trajectory" },
    },
    diagnostics: structuredClone(bundle.diagnostics),
  });
}

function executionReject(code: string, path: string, message: string): never {
  throw new LongitudinalExecutionErrorV2(code, path, message);
}

function assertPathTaskV2(task: unknown, path = "pathTask"): asserts task is TrajectoryPathTaskV2 {
  const record = objectAt(task, path);
  exactFields(record, ["schemaVersion", "kind", "datasetHash", "specHash", "runId", "runSpec"], ["schemaVersion", "kind", "datasetHash", "specHash", "runId", "runSpec"], path);
  if (record.schemaVersion !== "3dena.trajectory-path-task.v2") contractError(`${path}.schemaVersion`, "must be 3dena.trajectory-path-task.v2");
  if (record.kind !== "trajectory-path-v2") contractError(`${path}.kind`, "must be trajectory-path-v2");
  for (const field of ["datasetHash", "specHash"] as const) {
    if (typeof record[field] !== "string" || !SHA256.test(record[field])) contractError(`${path}.${field}`, "must be a lowercase SHA-256 digest");
  }
  nonEmptyString(record.runId, `${path}.runId`);
  assertTrajectoryRunSpecV2(record.runSpec, `${path}.runSpec`);
}

function scalarType(value: RawScalar, path: string): "string" | "number" | "boolean" {
  if (value === null) executionReject("MISSING_TRAJECTORY_IDENTITY", path, "must not be null");
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (!Number.isFinite(value)) executionReject("NON_FINITE_TRAJECTORY_IDENTITY", path, "must be finite");
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) executionReject("UNSAFE_TRAJECTORY_IDENTITY", path, "unsafe integer identities must be source strings");
  return "number";
}

function rawGroupIdentity(value: RawScalar, column: string | null): TrajectoryIdentityV1 {
  return {
    components: [{
      name: column ?? "@3dena/group",
      type: scalarType(value, "sourceResult.trajectory.group"),
      value: value as string | number | boolean,
    }],
  };
}

function toTrajectoryTimeValueV1(value: OrderedPeriodValueV2): TrajectoryTimeValueV1 {
  if (value.type === "ordered-index-v2") {
    return { type: "numeric-v1", value: value.index, unit: "ordered-period" };
  }
  return structuredClone(value);
}

function validateExecutionMetadata(input: LongitudinalExecutionRequestV2["execution"]): void {
  if (!["browser-worker", "persistent-compute-service", "node-service"].includes(input.target)) {
    executionReject("INVALID_EXECUTION_TARGET", "execution.target", "is unsupported");
  }
  for (const field of ["jenaVersion", "jenaCommit", "jenaTarballIntegrity", "sdkVersion", "buildId"] as const) {
    if (typeof input[field] !== "string" || input[field].trim() === "") executionReject("INVALID_BUILD_METADATA", `execution.${field}`, "must be non-empty");
  }
  if (!Number.isSafeInteger(input.seed) || input.seed < 0 || input.seed > 0xffff_ffff) {
    executionReject("INVALID_EXECUTION_SEED", "execution.seed", "must be a uint32 safe integer");
  }
}

function validateMappingBinding(
  point: AnalysisPoint,
  runSpec: TrajectoryRunSpecV2,
): void {
  if (JSON.stringify(point.participantLabel.columns) !== JSON.stringify(runSpec.participantColumns)) {
    executionReject("TRAJECTORY_PARTICIPANT_MAPPING_MISMATCH", "pathTask.runSpec.participantColumns", "does not match the immutable fitted participant identity columns");
  }
  if (runSpec.groupColumn !== null && !point.unit.columns.includes(runSpec.groupColumn)) {
    executionReject("TRAJECTORY_GROUP_MAPPING_MISMATCH", "pathTask.runSpec.groupColumn", "is absent from the immutable fitted unit mapping");
  }
  if (!point.id.columns.includes(runSpec.timeColumn) || point.unit.columns.includes(runSpec.timeColumn)) {
    executionReject("TRAJECTORY_TIME_MAPPING_MISMATCH", "pathTask.runSpec.timeColumn", "does not match the immutable fitted time/conversation mapping");
  }
}

function sourcePointsForGroup(points: AnalysisPoint[], groupCanonical: string): AnalysisPoint[] {
  return points.filter((point) => point.group?.canonical === groupCanonical);
}

function buildGroupInputsV2(
  source: AnalysisExecutionDatasetV2["sourceResult"] & { sourceKind: "raw-jena" },
  runSpec: TrajectoryRunSpecV2,
): {
  groups: TrajectoryPathSetGroupInputV2[];
  sourcePoints: AnalysisPoint[][];
  sourceGroups: Array<{ canonical: string; display: string }>;
  periods: Array<{ time: TrajectoryIdentityV1; value: TrajectoryTimeValueV1 }>;
  fullDimensions: string[];
  model: "SeparateTrajectory" | "AccumulatedTrajectory";
} {
  const result = source.result;
  const trajectory = result.trajectory;
  if (!trajectory) executionReject("MISSING_SOURCE_TRAJECTORY", "dataset.sourceResult.result.trajectory", "is required for a longitudinal task");
  const model = result.provenance.resolvedConfig.model;
  if (model !== "SeparateTrajectory" && model !== "AccumulatedTrajectory") {
    executionReject("UNSUPPORTED_LONGITUDINAL_MODEL", "dataset.sourceResult.result.provenance.resolvedConfig.model", "must be SeparateTrajectory or AccumulatedTrajectory");
  }
  if (result.points.length === 0) executionReject("EMPTY_SOURCE_RESULT", "dataset.sourceResult.result.points", "must contain fitted points");
  validateMappingBinding(result.points[0]!, runSpec);
  for (const [index, dimension] of runSpec.selectedDimensions.entries()) {
    if (!result.dimensions.includes(dimension)) executionReject("UNKNOWN_SELECTED_DIMENSION", `pathTask.runSpec.selectedDimensions[${index}]`, "is absent from the fitted full rotation");
  }
  if (result.dimensions.length < 3) executionReject("INSUFFICIENT_LONGITUDINAL_DIMENSIONS", "dataset.sourceResult.result.dimensions", "3D trajectory requires at least three fitted dimensions");
  const sourceTimes = trajectory.timeOrder;
  if (model === "AccumulatedTrajectory") {
    const fittedTimes = new Set(sourceTimes.map((time) => time.canonical));
    const requestedObserved = runSpec.orderedPeriods
      .map((period) => period.sourceTimeCanonical)
      .filter((canonical) => fittedTimes.has(canonical));
    const requestedSet = new Set(requestedObserved);
    const fittedObserved = sourceTimes.map((time) => time.canonical).filter((canonical) => requestedSet.has(canonical));
    if (JSON.stringify(requestedObserved) !== JSON.stringify(fittedObserved)) {
      executionReject("ACCUMULATED_TRAJECTORY_ORDER_MISMATCH", "pathTask.runSpec.orderedPeriods", "must preserve the immutable fitted chronology because later accumulated points contain earlier history");
    }
  }
  const firstGroup = trajectory.groupOrder[0];
  if (!firstGroup) executionReject("EMPTY_TRAJECTORY_GROUPS", "dataset.sourceResult.result.trajectory.groupOrder", "must contain at least one group");
  const firstSeries = adaptAnalysisResultTrajectorySeries(result, {
    group: firstGroup.canonical,
    namespace: `${runSpec.sourceResultHash}:period-binding`,
    participantIdentity: "participant-label",
  });
  const periods = runSpec.orderedPeriods.map((period, index) => {
    const observedIndex = sourceTimes.findIndex((sourceTime) => sourceTime.canonical === period.sourceTimeCanonical);
    if (observedIndex >= 0) {
      const time = firstSeries.timeOrder[observedIndex];
      if (!time) executionReject("TRAJECTORY_PERIOD_BINDING_MISMATCH", `pathTask.runSpec.orderedPeriods[${index}]`, "does not align with the fitted trajectory time order");
      return { time, value: toTrajectoryTimeValueV1(period.value) };
    }
    return {
      time: structuredClone(period.identity),
      value: toTrajectoryTimeValueV1(period.value),
    };
  });
  const groups = trajectory.groupOrder.map((group, groupIndex): TrajectoryPathSetGroupInputV2 => {
    const series = adaptAnalysisResultTrajectorySeries(result, {
      group: group.canonical,
      namespace: `longitudinal-v2:${runSpec.sourceResultHash}:group:${groupIndex}`,
      participantIdentity: "participant-label",
    });
    const rawPoints = sourcePointsForGroup(result.points, group.canonical);
    if (rawPoints.length !== series.points.length) {
      executionReject("TRAJECTORY_ADAPTER_SHAPE_MISMATCH", `dataset.sourceResult.result.trajectory.groupOrder[${groupIndex}]`, "adapter point order does not match fitted source points");
    }
    const points: TrajectoryDynamicsPointV1[] = series.points.map((point, pointIndex) => {
      if (runSpec.estimand.kind === "equal-participant") return { ...point, coordinates: [...point.coordinates] };
      const weight = rawPoints[pointIndex]!.metadata[runSpec.estimand.metadataField];
      if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) {
        executionReject("INVALID_TRAJECTORY_WEIGHT", `dataset.sourceResult.result.points[${rawPoints[pointIndex]!.index}].metadata.${runSpec.estimand.metadataField}`, "must be finite and strictly positive for every point");
      }
      return { ...point, coordinates: [...point.coordinates], weight };
    });
    return {
      group: rawGroupIdentity(group.value, runSpec.groupColumn),
      namespace: series.namespace,
      points,
    };
  });
  return {
    groups,
    sourcePoints: trajectory.groupOrder.map((group) => sourcePointsForGroup(result.points, group.canonical)),
    sourceGroups: trajectory.groupOrder.map((group) => ({ canonical: group.canonical, display: group.display })),
    periods,
    fullDimensions: [...result.dimensions],
    model,
  };
}

interface LongitudinalGroupContextV2 {
  group: { canonical: string; display: string };
  dynamics: TrajectoryDynamicsResultV1;
  series: TrajectorySeriesInput;
  sourcePoints: AnalysisPoint[];
}

function groupContextsV2(
  built: ReturnType<typeof buildGroupInputsV2>,
  paths: LongitudinalGroupPathV2[],
): LongitudinalGroupContextV2[] {
  return paths.map((path, index) => ({
    group: path.group,
    dynamics: path.dynamics,
    series: {
      namespace: built.groups[index]!.namespace,
      dimensions: [...built.fullDimensions],
      selectedDimensions: [...path.dynamics.selectedDimensions],
      timeOrder: built.periods.map((period) => structuredClone(period.time)),
      cohortPolicy: path.dynamics.cohortPolicy,
      estimand: path.dynamics.estimand.kind === "weighted-participant-v1" ? "weighted-participant" : "equal-participant",
      points: built.groups[index]!.points.map((point) => ({
        participant: structuredClone(point.participant),
        time: structuredClone(point.time),
        coordinates: [...point.coordinates],
        ...(point.weight === undefined ? {} : { weight: point.weight }),
      })),
    },
    sourcePoints: built.sourcePoints[index]!.map((point) => structuredClone(point)),
  }));
}

function assertDerivedTaskBinding(
  task: { datasetHash: string; specHash: string; sourceResultHash: string; runId: string },
  pathTask: TrajectoryPathTaskV2,
  path: string,
): void {
  if (task.datasetHash !== pathTask.datasetHash) executionReject("TRAJECTORY_DATASET_BINDING_MISMATCH", `${path}.datasetHash`, "does not match the path task");
  if (task.specHash !== pathTask.specHash) executionReject("TRAJECTORY_SPEC_BINDING_MISMATCH", `${path}.specHash`, "does not match the path task");
  if (task.sourceResultHash !== pathTask.runSpec.sourceResultHash) executionReject("TRAJECTORY_SOURCE_BINDING_MISMATCH", `${path}.sourceResultHash`, "does not match the path task");
  if (task.runId !== pathTask.runId) executionReject("TRAJECTORY_RUN_BINDING_MISMATCH", `${path}.runId`, "does not match the path task");
}

function assertInferenceTaskV2(task: unknown, pathTask: TrajectoryPathTaskV2): asserts task is TrajectoryInferenceTaskV2 {
  const record = objectAt(task, "inferenceTask");
  exactFields(record, ["schemaVersion", "kind", "datasetHash", "specHash", "sourceResultHash", "runId", "requests", "adjustment"], ["schemaVersion", "kind", "datasetHash", "specHash", "sourceResultHash", "runId", "requests", "adjustment"], "inferenceTask");
  if (record.schemaVersion !== "3dena.trajectory-inference-task.v2" || record.kind !== "trajectory-inference-v2") contractError("inferenceTask", "must use the V2 inference task contract");
  if (record.adjustment !== "holm") contractError("inferenceTask.adjustment", "must be holm");
  for (const field of ["datasetHash", "specHash", "sourceResultHash"] as const) {
    if (typeof record[field] !== "string" || !SHA256.test(record[field])) contractError(`inferenceTask.${field}`, "must be a lowercase SHA-256 digest");
  }
  nonEmptyString(record.runId, "inferenceTask.runId");
  if (!Array.isArray(record.requests) || record.requests.length === 0) contractError("inferenceTask.requests", "must be a non-empty array");
  record.requests.forEach((candidate, index) => {
    const path = `inferenceTask.requests[${index}]`;
    const request = objectAt(candidate, path);
    if (request.kind === "independent-period") {
      exactFields(request, ["kind", "groups", "periodCanonical"], ["kind", "groups", "periodCanonical"], path);
      stringList(request.groups, `${path}.groups`, 2);
      nonEmptyString(request.periodCanonical, `${path}.periodCanonical`);
      return;
    }
    if (request.kind === "paired-periods") {
      exactFields(request, ["kind", "group", "earlierPeriodCanonical", "laterPeriodCanonical", "samePhysicalEntityConfirmed"], ["kind", "group", "earlierPeriodCanonical", "laterPeriodCanonical", "samePhysicalEntityConfirmed"], path);
      if (request.group !== null) nonEmptyString(request.group, `${path}.group`);
      const earlier = nonEmptyString(request.earlierPeriodCanonical, `${path}.earlierPeriodCanonical`);
      const later = nonEmptyString(request.laterPeriodCanonical, `${path}.laterPeriodCanonical`);
      if (earlier === later) contractError(path, "paired periods must differ");
      if (typeof request.samePhysicalEntityConfirmed !== "boolean") contractError(`${path}.samePhysicalEntityConfirmed`, "must be boolean");
      return;
    }
    if (request.kind === "repeated-periods") {
      exactFields(request, ["kind", "group", "periodCanonicals", "samePhysicalEntityConfirmed"], ["kind", "group", "periodCanonicals", "samePhysicalEntityConfirmed"], path);
      if (request.group !== null) nonEmptyString(request.group, `${path}.group`);
      stringList(request.periodCanonicals, `${path}.periodCanonicals`);
      if ((request.periodCanonicals as unknown[]).length < 3) contractError(`${path}.periodCanonicals`, "must contain at least three periods");
      if (typeof request.samePhysicalEntityConfirmed !== "boolean") contractError(`${path}.samePhysicalEntityConfirmed`, "must be boolean");
      return;
    }
    if (request.kind === "path-comparison") {
      exactFields(request, ["kind", "design", "groups", "repetitions", "seed", "samePhysicalEntityConfirmed"], ["kind", "design", "groups", "repetitions", "seed", "samePhysicalEntityConfirmed"], path);
      if (request.design !== "independent" && request.design !== "paired") contractError(`${path}.design`, "must be independent or paired");
      stringList(request.groups, `${path}.groups`, 2);
      if (!Number.isSafeInteger(request.repetitions) || (request.repetitions as number) < 1 || (request.repetitions as number) > 10_000) contractError(`${path}.repetitions`, "must be an integer in [1, 10000]");
      if (!Number.isSafeInteger(request.seed) || (request.seed as number) < 0 || (request.seed as number) > 0xffff_ffff) contractError(`${path}.seed`, "must be a uint32 integer");
      if (typeof request.samePhysicalEntityConfirmed !== "boolean") contractError(`${path}.samePhysicalEntityConfirmed`, "must be boolean");
      if (request.design === "independent" && request.samePhysicalEntityConfirmed !== false) contractError(`${path}.samePhysicalEntityConfirmed`, "must be false for independent comparison");
      return;
    }
    contractError(`${path}.kind`, "is unsupported");
  });
  assertDerivedTaskBinding(record as unknown as TrajectoryInferenceTaskV2, pathTask, "inferenceTask");
}

function assertBootstrapTaskV2(task: unknown, pathTask: TrajectoryPathTaskV2): asserts task is TrajectoryBootstrapTaskV2 {
  const record = objectAt(task, "bootstrapTask");
  exactFields(record, ["schemaVersion", "kind", "datasetHash", "specHash", "sourceResultHash", "runId", "repetitions", "confidenceLevel", "seed", "resamplingDesign", "explicitStrataField", "interval", "rotationPolicy"], ["schemaVersion", "kind", "datasetHash", "specHash", "sourceResultHash", "runId", "repetitions", "confidenceLevel", "seed", "resamplingDesign", "explicitStrataField", "interval", "rotationPolicy"], "bootstrapTask");
  if (record.schemaVersion !== "3dena.trajectory-bootstrap-task.v2" || record.kind !== "trajectory-bootstrap-v2") contractError("bootstrapTask", "must use the V2 bootstrap task contract");
  for (const field of ["datasetHash", "specHash", "sourceResultHash"] as const) {
    if (typeof record[field] !== "string" || !SHA256.test(record[field])) contractError(`bootstrapTask.${field}`, "must be a lowercase SHA-256 digest");
  }
  nonEmptyString(record.runId, "bootstrapTask.runId");
  if (!Number.isSafeInteger(record.repetitions) || (record.repetitions as number) < 1 || (record.repetitions as number) > 10_000) contractError("bootstrapTask.repetitions", "must be an integer in [1, 10000]");
  if (typeof record.confidenceLevel !== "number" || !Number.isFinite(record.confidenceLevel) || record.confidenceLevel <= 0 || record.confidenceLevel >= 1) contractError("bootstrapTask.confidenceLevel", "must be finite and in (0,1)");
  if (!Number.isSafeInteger(record.seed) || (record.seed as number) < 0 || (record.seed as number) > 0xffff_ffff) contractError("bootstrapTask.seed", "must be a uint32 integer");
  if (!["auto", "global-participant", "within-group", "explicit-strata"].includes(String(record.resamplingDesign))) contractError("bootstrapTask.resamplingDesign", "is unsupported");
  if (record.resamplingDesign === "explicit-strata") nonEmptyString(record.explicitStrataField, "bootstrapTask.explicitStrataField");
  else if (record.explicitStrataField !== null) contractError("bootstrapTask.explicitStrataField", "must be null unless explicit-strata is selected");
  if (record.interval !== "pointwise-percentile-linear-type7") contractError("bootstrapTask.interval", "must be pointwise-percentile-linear-type7");
  if (record.rotationPolicy !== "fixed-same-fit-projection") contractError("bootstrapTask.rotationPolicy", "must be fixed-same-fit-projection");
  assertDerivedTaskBinding(record as unknown as TrajectoryBootstrapTaskV2, pathTask, "bootstrapTask");
}

function assertNetworkOverlayTaskV2(
  task: unknown,
  pathTask: TrajectoryPathTaskV2,
): asserts task is TrajectoryNetworkOverlayTaskV2 {
  const record = objectAt(task, "networkOverlayTask");
  exactFields(
    record,
    ["schemaVersion", "kind", "datasetHash", "specHash", "sourceResultHash", "runId", "requests"],
    ["schemaVersion", "kind", "datasetHash", "specHash", "sourceResultHash", "runId", "requests"],
    "networkOverlayTask",
  );
  if (
    record.schemaVersion !== "3dena.trajectory-network-overlay-task.v2"
    || record.kind !== "trajectory-network-overlay-v2"
  ) contractError("networkOverlayTask", "must use the V2 network-overlay task contract");
  for (const field of ["datasetHash", "specHash", "sourceResultHash"] as const) {
    if (typeof record[field] !== "string" || !SHA256.test(record[field])) contractError(`networkOverlayTask.${field}`, "must be a lowercase SHA-256 digest");
  }
  nonEmptyString(record.runId, "networkOverlayTask.runId");
  if (!Array.isArray(record.requests) || record.requests.length === 0) contractError("networkOverlayTask.requests", "must be a non-empty array");
  const unique = new Set<string>();
  record.requests.forEach((candidate, index) => {
    const path = `networkOverlayTask.requests[${index}]`;
    const request = objectAt(candidate, path);
    exactFields(request, ["periodCanonical", "groupCanonical"], ["periodCanonical", "groupCanonical"], path);
    const period = nonEmptyString(request.periodCanonical, `${path}.periodCanonical`);
    const group = request.groupCanonical === null ? null : nonEmptyString(request.groupCanonical, `${path}.groupCanonical`);
    const key = JSON.stringify([period, group]);
    if (unique.has(key)) contractError(path, "duplicates an earlier overlay request");
    unique.add(key);
  });
  assertDerivedTaskBinding(record as unknown as TrajectoryNetworkOverlayTaskV2, pathTask, "networkOverlayTask");
}

function resolvePeriodIndex(runSpec: TrajectoryRunSpecV2, canonical: string, path: string): number {
  const index = runSpec.orderedPeriods.findIndex((period) => period.sourceTimeCanonical === canonical);
  if (index < 0) executionReject("UNKNOWN_TRAJECTORY_PERIOD", path, "is absent from the ordered-period contract");
  return index;
}

function selectContexts(
  contexts: LongitudinalGroupContextV2[],
  canonical: string | null,
  path: string,
): LongitudinalGroupContextV2[] {
  if (canonical === null) return contexts;
  const selected = contexts.find((context) => context.group.canonical === canonical);
  if (!selected) executionReject("UNKNOWN_TRAJECTORY_GROUP", path, "is absent from the computed path set");
  return [selected];
}

function participantRowsAtPeriod(context: LongitudinalGroupContextV2, periodIndex: number) {
  const period = context.dynamics.periods[periodIndex];
  if (!period) executionReject("UNKNOWN_TRAJECTORY_PERIOD", `paths.${context.group.canonical}.periods[${periodIndex}]`, "is absent");
  return context.dynamics.participantPeriods.filter((row) => row.includedInCohort && row.time.canonical === period.time.canonical);
}

function selectedCoordinateAt(coordinates: readonly number[], axisIndex: number, path: string): number {
  const value = coordinates[axisIndex];
  if (value === undefined || !Number.isFinite(value)) {
    executionReject("INVALID_SELECTED_COORDINATE", path, "must resolve to a finite selected-axis coordinate");
  }
  return value;
}

function withHolmRows<T extends Record<string, unknown> & { memberId: string; pRaw: number | null }>(
  rows: T[],
  familyId: string,
): Array<T & {
  familyId: string;
  familySize: number;
  pHolm: number | null;
  holmRank: number | null;
  holmMultiplier: number | null;
}> {
  const adjusted = holmAdjustFamilyV2(rows.map(({ memberId, pRaw }) => ({ memberId, pRaw })));
  return rows.map((row, index) => ({
    ...row,
    familyId,
    familySize: adjusted[index]!.familySizePlanned,
    pHolm: adjusted[index]!.pHolm,
    holmRank: adjusted[index]!.holmRank,
    holmMultiplier: adjusted[index]!.holmMultiplier,
  }));
}

function independentPeriodInference(
  request: Extract<TrajectoryInferenceRequestV2, { kind: "independent-period" }>,
  contexts: LongitudinalGroupContextV2[],
  runSpec: TrajectoryRunSpecV2,
): LongitudinalInferenceResultV2 {
  const [groupA, groupB] = request.groups.map((group, index) => selectContexts(contexts, group, `request.groups[${index}]`)[0]!) as [LongitudinalGroupContextV2, LongitudinalGroupContextV2];
  const periodIndex = resolvePeriodIndex(runSpec, request.periodCanonical, "request.periodCanonical");
  const rows = runSpec.selectedDimensions.map((axis, axisIndex) => {
    const result = mannWhitneyRankTestV2(
      participantRowsAtPeriod(groupA, periodIndex).map((row, rowIndex) => selectedCoordinateAt(row.selectedCoordinates, axisIndex, `groupA[${rowIndex}].selectedCoordinates[${axisIndex}]`)),
      participantRowsAtPeriod(groupB, periodIndex).map((row, rowIndex) => selectedCoordinateAt(row.selectedCoordinates, axisIndex, `groupB[${rowIndex}].selectedCoordinates[${axisIndex}]`)),
    );
    return {
      memberId: `axis:${axis}`,
      test: "mann-whitney",
      design: "independent",
      estimand: "participant-period-coordinate-distribution",
      axis,
      axisIndex,
      periodCanonical: request.periodCanonical,
      status: result.status,
      reason: result.reason,
      nPrimary: result.nPrimary,
      nSecondary: result.nSecondary,
      effect: result.rankBiserialPrimaryVsSecondary,
      statistic: result.uPrimary,
      pRaw: result.pValueTwoSided,
      method: result.resolvedPMethod,
      ties: { groups: result.tieGroupCount, observations: result.tiedObservationCount, correctionSum: result.tieCorrectionSum },
      zeros: null,
      exactTail: result.exactTail,
    };
  });
  const familyId = `independent-period:${request.periodCanonical}:${request.groups.join(":")}`;
  return {
    request: structuredClone(request),
    status: rows.some((row) => row.status === "available") ? "available" : "not-estimable",
    familyId,
    familySize: rows.length,
    rows: withHolmRows(rows, familyId),
    reason: rows.some((row) => row.status === "available") ? null : "no-estimable-axis",
  };
}

function entityPeriodMaps(
  contexts: LongitudinalGroupContextV2[],
  periodIndexes: number[],
): Map<string, Map<number, [number, number, number]>> {
  const output = new Map<string, Map<number, [number, number, number]>>();
  for (const context of contexts) {
    for (const periodIndex of periodIndexes) {
      for (const row of participantRowsAtPeriod(context, periodIndex)) {
        const entity = JSON.stringify([context.group.canonical, row.participant.canonical]);
        const periods = output.get(entity) ?? new Map<number, [number, number, number]>();
        if (periods.has(periodIndex)) executionReject("ENTITY_PERIOD_INSTABILITY", "paths.participantPeriods", "contains a duplicate reduced participant-period");
        periods.set(periodIndex, [...row.selectedCoordinates]);
        output.set(entity, periods);
      }
    }
  }
  return output;
}

function disabledInference(request: TrajectoryInferenceRequestV2): LongitudinalInferenceResultV2 {
  return {
    request: structuredClone(request),
    status: "disabled",
    familyId: `${request.kind}:disabled`,
    familySize: 0,
    rows: [],
    reason: "same-physical-entity-not-confirmed",
  };
}

function pairedPeriodInference(
  request: Extract<TrajectoryInferenceRequestV2, { kind: "paired-periods" }>,
  contexts: LongitudinalGroupContextV2[],
  runSpec: TrajectoryRunSpecV2,
): LongitudinalInferenceResultV2 {
  if (!request.samePhysicalEntityConfirmed) return disabledInference(request);
  const selected = selectContexts(contexts, request.group, "request.group");
  const earlier = resolvePeriodIndex(runSpec, request.earlierPeriodCanonical, "request.earlierPeriodCanonical");
  const later = resolvePeriodIndex(runSpec, request.laterPeriodCanonical, "request.laterPeriodCanonical");
  const maps = entityPeriodMaps(selected, [earlier, later]);
  const earlierCount = [...maps.values()].filter((periods) => periods.has(earlier)).length;
  const laterCount = [...maps.values()].filter((periods) => periods.has(later)).length;
  const complete = [...maps.values()].filter((periods) => periods.has(earlier) && periods.has(later));
  const audit = {
    earlier: earlierCount,
    later: laterCount,
    overlap: complete.length,
    earlierOnly: earlierCount - complete.length,
    laterOnly: laterCount - complete.length,
    samePhysicalEntityConfirmed: true,
  };
  const rows = runSpec.selectedDimensions.map((axis, axisIndex) => {
    const differences = complete.map((periods, participantIndex) => (
      selectedCoordinateAt(periods.get(later)!, axisIndex, `paired[${participantIndex}].later[${axisIndex}]`)
      - selectedCoordinateAt(periods.get(earlier)!, axisIndex, `paired[${participantIndex}].earlier[${axisIndex}]`)
    ));
    const result = wilcoxonSignedRankTestV2(differences, { missingPairs: maps.size - complete.length });
    return {
      memberId: `axis:${axis}`,
      test: "wilcoxon-signed-rank",
      design: "paired",
      estimand: "later-minus-earlier-participant-coordinate",
      axis,
      axisIndex,
      earlierPeriodCanonical: request.earlierPeriodCanonical,
      laterPeriodCanonical: request.laterPeriodCanonical,
      status: result.status,
      reason: result.reason,
      n: result.nRanked,
      effect: result.rankBiserialLaterVsEarlier,
      statistic: result.t,
      pRaw: result.pValueTwoSided,
      method: result.resolvedPMethod,
      ties: { groups: result.tieGroupCount, observations: result.tiedObservationCount, correctionSum: result.tieCorrectionSum },
      zeros: result.nZero,
      exactTail: result.exactTail,
      identityOverlapAudit: audit,
    };
  });
  const familyId = `paired-periods:${request.group ?? "all"}:${request.earlierPeriodCanonical}:${request.laterPeriodCanonical}`;
  return {
    request: structuredClone(request),
    status: rows.some((row) => row.status === "available") ? "available" : "not-estimable",
    familyId,
    familySize: rows.length,
    rows: withHolmRows(rows, familyId),
    reason: rows.some((row) => row.status === "available") ? null : "no-estimable-axis",
  };
}

function repeatedPeriodInference(
  request: Extract<TrajectoryInferenceRequestV2, { kind: "repeated-periods" }>,
  contexts: LongitudinalGroupContextV2[],
  runSpec: TrajectoryRunSpecV2,
): LongitudinalInferenceResultV2 {
  if (!request.samePhysicalEntityConfirmed) return disabledInference(request);
  const selected = selectContexts(contexts, request.group, "request.group");
  const periodIndexes = request.periodCanonicals.map((canonical, index) => resolvePeriodIndex(runSpec, canonical, `request.periodCanonicals[${index}]`));
  const maps = entityPeriodMaps(selected, periodIndexes);
  const complete = [...maps.values()].filter((periods) => periodIndexes.every((period) => periods.has(period)));
  const omnibusRows = runSpec.selectedDimensions.map((axis, axisIndex) => {
    const result = friedmanRankTestV2(
      complete.map((periods, participantIndex) => periodIndexes.map((period, periodIndex) => (
        selectedCoordinateAt(periods.get(period)!, axisIndex, `repeated[${participantIndex}].periods[${periodIndex}][${axisIndex}]`)
      ))),
      { missingCompleteBlocks: maps.size - complete.length, periodCountWhenEmpty: periodIndexes.length },
    );
    return {
      memberId: `friedman:${axis}`,
      test: "friedman",
      design: "repeated",
      estimand: "all-period-complete-participant-coordinate-ranks",
      axis,
      axisIndex,
      selectedPeriodCanonicals: [...request.periodCanonicals],
      status: result.status,
      reason: result.reason,
      n: result.nComplete,
      effect: result.kendallsW,
      statistic: result.q,
      pRaw: result.pValueUpperTail,
      method: result.resolvedPMethod,
      ties: { groups: result.tieGroupCount, observations: result.tiedObservationCount, correctionSum: result.tieCorrectionSum },
      zeros: null,
      exactTail: result.exactTail,
      identityOverlapAudit: { totalEntities: maps.size, completeBlocks: complete.length, excludedIncomplete: maps.size - complete.length, samePhysicalEntityConfirmed: true },
    };
  });
  const omnibusFamily = `repeated-omnibus:${request.group ?? "all"}:${request.periodCanonicals.join(":")}`;
  const omnibus = withHolmRows(omnibusRows, omnibusFamily);
  const posthocRows: Array<Record<string, unknown> & { memberId: string; pRaw: number | null }> = [];
  for (let earlierIndex = 0; earlierIndex < periodIndexes.length - 1; earlierIndex += 1) {
    for (let laterIndex = earlierIndex + 1; laterIndex < periodIndexes.length; laterIndex += 1) {
      for (const [axisIndex, axis] of runSpec.selectedDimensions.entries()) {
        const differences = complete.map((periods, participantIndex) => (
          selectedCoordinateAt(periods.get(periodIndexes[laterIndex]!)!, axisIndex, `posthoc[${participantIndex}].later[${axisIndex}]`)
          - selectedCoordinateAt(periods.get(periodIndexes[earlierIndex]!)!, axisIndex, `posthoc[${participantIndex}].earlier[${axisIndex}]`)
        ));
        const result = wilcoxonSignedRankTestV2(differences, { missingPairs: maps.size - complete.length });
        posthocRows.push({
          memberId: `posthoc:${earlierIndex}:${laterIndex}:${axis}`,
          test: "wilcoxon-signed-rank",
          design: "repeated-posthoc",
          estimand: "later-minus-earlier-all-period-complete-coordinate",
          axis,
          axisIndex,
          earlierPeriodCanonical: request.periodCanonicals[earlierIndex],
          laterPeriodCanonical: request.periodCanonicals[laterIndex],
          status: result.status,
          reason: result.reason,
          n: result.nRanked,
          effect: result.rankBiserialLaterVsEarlier,
          statistic: result.t,
          pRaw: result.pValueTwoSided,
          method: result.resolvedPMethod,
          ties: { groups: result.tieGroupCount, observations: result.tiedObservationCount, correctionSum: result.tieCorrectionSum },
          zeros: result.nZero,
          exactTail: result.exactTail,
          identityOverlapAudit: { totalEntities: maps.size, completeBlocks: complete.length, excludedIncomplete: maps.size - complete.length, samePhysicalEntityConfirmed: true },
        });
      }
    }
  }
  const posthocFamily = `repeated-posthoc:${request.group ?? "all"}:${request.periodCanonicals.join(":")}`;
  const posthoc = withHolmRows(posthocRows, posthocFamily);
  const rows = [...omnibus, ...posthoc];
  return {
    request: structuredClone(request),
    status: rows.some((row) => row.status === "available") ? "available" : "not-estimable",
    familyId: `repeated-periods:${request.group ?? "all"}`,
    familySize: rows.length,
    rows,
    reason: rows.some((row) => row.status === "available") ? null : "no-estimable-test",
  };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function createPermutationPlanV2(
  request: Extract<TrajectoryInferenceRequestV2, { kind: "path-comparison" }>,
  sideA: TrajectorySeriesInput,
  sideB: TrajectorySeriesInput,
): PairedSwapPermutationPlan | IndependentPoolPermutationPlan {
  const comparison = request.design === "paired"
    ? { design: "paired" as const, pairedId: [] as string[], sideA: { label: request.groups[0], series: sideA }, sideB: { label: request.groups[1], series: sideB } }
    : { design: "independent" as const, sideA: { label: request.groups[0], series: sideA }, sideB: { label: request.groups[1], series: sideB } };
  if (request.design === "paired") comparison.pairedId = sideA.points[0]?.participant.components.map((component) => component.name) ?? [];
  const units = getTrajectoryPermutationUnits(comparison);
  const random = mulberry32(request.seed);
  if (request.design === "paired") {
    return {
      kind: "paired-swap-indices-v1",
      unitOrder: units.unitOrder,
      replicates: Array.from({ length: request.repetitions }, () => units.unitOrder
        .map((_, index) => index)
        .filter(() => random() < 0.5)),
    };
  }
  return {
    kind: "independent-pool-indices-v1",
    unitOrder: units.unitOrder,
    replicates: Array.from({ length: request.repetitions }, () => {
      const indexes = units.unitOrder.map((_, index) => index);
      for (let index = indexes.length - 1; index > 0; index -= 1) {
        const selected = Math.floor(random() * (index + 1));
        [indexes[index], indexes[selected]] = [indexes[selected]!, indexes[index]!];
      }
      return indexes;
    }),
  };
}

function physicalTimeKey(point: TrajectorySeriesInput["points"][number]): string {
  return JSON.stringify(point.time.components.map((component) => [
    component.name,
    component.type,
    component.value,
    component.declaredType ?? null,
  ]));
}

function pairedWholePathSeriesV2(
  sideA: TrajectorySeriesInput,
  sideB: TrajectorySeriesInput,
): {
  sideA: TrajectorySeriesInput;
  sideB: TrajectorySeriesInput;
  audit: NonNullable<LongitudinalPathComparisonV2["identityOverlapAudit"]>;
} {
  const histories = (series: TrajectorySeriesInput) => {
    const output = new Map<string, Set<string>>();
    for (const point of series.points) {
      const participant = physicalParticipantKey(point);
      const times = output.get(participant) ?? new Set<string>();
      times.add(physicalTimeKey(point));
      output.set(participant, times);
    }
    return output;
  };
  const a = histories(sideA);
  const b = histories(sideB);
  const aKeys = new Set(a.keys());
  const bKeys = new Set(b.keys());
  const overlapping = [...aKeys].filter((key) => bKeys.has(key));
  const requiredPeriods = new Set([
    ...sideA.points.map(physicalTimeKey),
    ...sideB.points.map(physicalTimeKey),
  ]);
  const pairedComplete = new Set(overlapping.filter((key) => (
    [...requiredPeriods].every((period) => a.get(key)!.has(period) && b.get(key)!.has(period))
  )));
  const filter = (series: TrajectorySeriesInput): TrajectorySeriesInput => ({
    ...series,
    points: series.points.filter((point) => pairedComplete.has(physicalParticipantKey(point))),
  });
  return {
    sideA: filter(sideA),
    sideB: filter(sideB),
    audit: {
      sideAEntities: aKeys.size,
      sideBEntities: bKeys.size,
      overlappingEntities: overlapping.length,
      pairedCompleteEntities: pairedComplete.size,
      sideAOnly: [...aKeys].filter((key) => !bKeys.has(key)).length,
      sideBOnly: [...bKeys].filter((key) => !aKeys.has(key)).length,
      excludedIncompleteOverlap: overlapping.length - pairedComplete.size,
      samePhysicalEntityConfirmed: true,
    },
  };
}

async function runInferenceV2(
  task: TrajectoryInferenceTaskV2 | undefined,
  pathTask: TrajectoryPathTaskV2,
  contexts: LongitudinalGroupContextV2[],
): Promise<{
  inference: LongitudinalInferenceResultV2[];
  comparisons: LongitudinalPathComparisonV2[];
  planHashes: string[];
}> {
  if (!task) return { inference: [], comparisons: [], planHashes: [] };
  assertInferenceTaskV2(task, pathTask);
  const inference: LongitudinalInferenceResultV2[] = [];
  const comparisons: LongitudinalPathComparisonV2[] = [];
  const planHashes: string[] = [];
  for (const request of task.requests) {
    if (request.kind === "independent-period") {
      inference.push(independentPeriodInference(request, contexts, pathTask.runSpec));
      continue;
    }
    if (request.kind === "paired-periods") {
      inference.push(pairedPeriodInference(request, contexts, pathTask.runSpec));
      continue;
    }
    if (request.kind === "repeated-periods") {
      inference.push(repeatedPeriodInference(request, contexts, pathTask.runSpec));
      continue;
    }
    if (request.design === "paired" && !request.samePhysicalEntityConfirmed) {
      inference.push(disabledInference(request));
      continue;
    }
    const sideA = selectContexts(contexts, request.groups[0], "request.groups[0]")[0]!;
    const sideB = selectContexts(contexts, request.groups[1], "request.groups[1]")[0]!;
    const paired = request.design === "paired" ? pairedWholePathSeriesV2(sideA.series, sideB.series) : null;
    if (paired && paired.audit.pairedCompleteEntities === 0) {
      inference.push({
        request: structuredClone(request),
        status: "not-estimable",
        familyId: `path-comparison:${request.groups.join(":")}`,
        familySize: 0,
        rows: [{ memberId: "identity-overlap-audit", ...paired.audit }],
        reason: "no-complete-paired-participant-histories",
      });
      continue;
    }
    const comparisonSideA = paired?.sideA ?? sideA.series;
    const comparisonSideB = paired?.sideB ?? sideB.series;
    const plan = createPermutationPlanV2(request, comparisonSideA, comparisonSideB);
    const planHash = await hashAnalysisValueV1(plan);
    const result = request.design === "paired"
      ? compareTrajectoryPaths({
          design: "paired",
          pairedId: pathTask.runSpec.participantColumns,
          sideA: { label: sideA.group.display, series: comparisonSideA },
          sideB: { label: sideB.group.display, series: comparisonSideB },
          permutationPlan: plan as PairedSwapPermutationPlan,
        })
      : compareTrajectoryPaths({
          design: "independent",
          sideA: { label: sideA.group.display, series: comparisonSideA },
          sideB: { label: sideB.group.display, series: comparisonSideB },
          permutationPlan: plan as IndependentPoolPermutationPlan,
        });
    comparisons.push({
      groups: [...request.groups],
      design: request.design,
      seed: request.seed,
      planHash,
      identityOverlapAudit: paired?.audit ?? null,
      result,
    });
    planHashes.push(planHash);
  }
  return { inference, comparisons, planHashes };
}

function finiteReplicateAudit(result: TrajectoryBootstrapResult): number {
  const counts = result.periods.flatMap((period) => [
    ...period.selectedCentroid,
    ...period.fullCentroid,
    period.selectedStepDistance,
    period.fullStepDistance,
    period.selectedCumulativeDistance,
    period.fullCumulativeDistance,
  ]).filter((interval): interval is NonNullable<typeof interval> => interval !== null)
    .map((interval) => interval.finiteReplicates);
  return counts.length === 0 ? 0 : Math.min(...counts);
}

function scaleBootstrapInterval(
  interval: TrajectoryBootstrapInterval | null,
  elapsed: number | null,
): TrajectoryBootstrapInterval | null {
  if (interval === null || elapsed === null || !Number.isFinite(elapsed) || elapsed <= 0) return null;
  return {
    ...interval,
    estimate: interval.estimate / elapsed,
    lower: interval.lower / elapsed,
    upper: interval.upper / elapsed,
  };
}

interface GlobalParticipantBootstrapUnitV2 {
  key: string;
  historiesByGroup: Map<number, TrajectorySeriesInput["points"]>;
}

interface GlobalParticipantBootstrapPlanV2 {
  schemaVersion: "3dena.global-participant-bootstrap-plan.v2";
  unitOrder: string[];
  replicates: number[][];
  generation: {
    kind: "seeded";
    algorithm: "mulberry32-uint32-v1";
    seed: number;
    unitSort: "utf16-code-unit-ascending";
    randomEndpoint: "zero-inclusive-one-exclusive";
  };
}

function physicalParticipantKey(point: TrajectorySeriesInput["points"][number]): string {
  return JSON.stringify(point.participant.components.map((component) => [
    component.name,
    component.type,
    component.value,
    component.declaredType ?? null,
  ]));
}

function buildGlobalParticipantUnitsV2(contexts: LongitudinalGroupContextV2[]): GlobalParticipantBootstrapUnitV2[] {
  const units = new Map<string, GlobalParticipantBootstrapUnitV2>();
  contexts.forEach((context, groupIndex) => {
    for (const point of context.series.points) {
      const key = physicalParticipantKey(point);
      const unit = units.get(key) ?? { key, historiesByGroup: new Map<number, TrajectorySeriesInput["points"]>() };
      const history = unit.historiesByGroup.get(groupIndex) ?? [];
      history.push(point);
      unit.historiesByGroup.set(groupIndex, history);
      units.set(key, unit);
    }
  });
  return [...units.values()].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}

function createGlobalParticipantPlanV2(
  units: GlobalParticipantBootstrapUnitV2[],
  repetitions: number,
  seed: number,
): GlobalParticipantBootstrapPlanV2 {
  if (units.length === 0) executionReject("EMPTY_GLOBAL_BOOTSTRAP_POOL", "bootstrapTask.resamplingDesign", "requires at least one physical participant history");
  const random = mulberry32(seed);
  return {
    schemaVersion: "3dena.global-participant-bootstrap-plan.v2",
    unitOrder: units.map(({ key }) => key),
    replicates: Array.from({ length: repetitions }, () => (
      Array.from({ length: units.length }, () => Math.floor(random() * units.length))
    )),
    generation: {
      kind: "seeded",
      algorithm: "mulberry32-uint32-v1",
      seed,
      unitSort: "utf16-code-unit-ascending",
      randomEndpoint: "zero-inclusive-one-exclusive",
    },
  };
}

function globalReplicateSeriesV2(
  context: LongitudinalGroupContextV2,
  groupIndex: number,
  units: GlobalParticipantBootstrapUnitV2[],
  draw: number[],
): TrajectorySeriesInput | null {
  const points: TrajectorySeriesInput["points"] = [];
  draw.forEach((unitIndex, drawIndex) => {
    const history = units[unitIndex]?.historiesByGroup.get(groupIndex);
    if (!history) return;
    for (const point of history) {
      points.push({
        ...point,
        participant: {
          components: [
            ...point.participant.components.map((component) => ({ ...component })),
            { name: "@3dena/global-bootstrap-draw", type: "number", value: drawIndex },
          ],
        },
        time: { components: point.time.components.map((component) => ({ ...component })) },
        coordinates: [...point.coordinates],
      });
    }
  });
  if (points.length === 0) return null;
  return {
    ...context.series,
    points,
    dimensions: [...context.series.dimensions],
    selectedDimensions: [...context.series.selectedDimensions],
    timeOrder: context.series.timeOrder.map((time) => ({
      components: time.components.map((component) => ({ ...component })),
    })),
    ...(context.series.limits ? { limits: { ...context.series.limits } } : {}),
  };
}

function globalBootstrapIntervalV2(
  estimate: number | null,
  values: Array<number | null>,
  eligible: boolean,
  confidenceLevel: number,
  repetitions: number,
  requiredFiniteReplicates: number,
): TrajectoryBootstrapInterval | null {
  if (estimate === null || !eligible) return null;
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (finite.length < requiredFiniteReplicates) return null;
  const alpha = 1 - confidenceLevel;
  return {
    estimate,
    lower: trajectoryPercentile(finite, alpha / 2),
    upper: trajectoryPercentile(finite, 1 - alpha / 2),
    finiteReplicates: finite.length,
    requiredFiniteReplicates,
    totalReplicates: repetitions,
  };
}

function summarizeGlobalParticipantBootstrapV2(
  context: LongitudinalGroupContextV2,
  replicatePaths: Array<TrajectoryPathStatistics | null>,
  task: TrajectoryBootstrapTaskV2,
  globalUnitCount: number,
): TrajectoryBootstrapResult {
  const base = analyzeTrajectoryPath(context.series);
  const requiredFiniteReplicates = Math.max(
    Math.ceil(task.repetitions * 0.8),
    Math.ceil(10 / (1 - task.confidenceLevel) - 1e-12),
  );
  let insufficientClusters = false;
  let insufficientReplicates = false;
  let anyCentroidVariation = false;
  const periods = base.periods.map((basePeriod, periodIndex) => {
    const centroidEligible = basePeriod.nUsed >= 2;
    const stepEligible = periodIndex > 0 && centroidEligible && base.periods[periodIndex - 1]!.nUsed >= 2;
    const cumulativeEligible = centroidEligible && base.periods.slice(0, periodIndex + 1).every((period) => period.nUsed >= 2);
    if (!centroidEligible || (periodIndex > 0 && (!stepEligible || !cumulativeEligible))) insufficientClusters = true;
    const interval = (
      estimate: number | null,
      selector: (path: TrajectoryPathStatistics) => number | null,
      eligible: boolean,
    ) => {
      const result = globalBootstrapIntervalV2(
        estimate,
        replicatePaths.map((path) => path === null ? null : selector(path)),
        eligible,
        task.confidenceLevel,
        task.repetitions,
        requiredFiniteReplicates,
      );
      if (eligible && estimate !== null && result === null) insufficientReplicates = true;
      return result;
    };
    const selectedCentroid = Array.from({ length: 3 }, (_, dimension) => interval(
      basePeriod.selectedCentroid?.[dimension] ?? null,
      (path) => path.periods[periodIndex]!.selectedCentroid?.[dimension] ?? null,
      centroidEligible,
    ));
    const fullCentroid = Array.from({ length: context.series.dimensions.length }, (_, dimension) => {
      const values = replicatePaths.map((path) => path?.periods[periodIndex]!.fullCentroid?.[dimension] ?? null)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      if (values.length > 1 && values.some((value) => value !== values[0])) anyCentroidVariation = true;
      return interval(
        basePeriod.fullCentroid?.[dimension] ?? null,
        (path) => path.periods[periodIndex]!.fullCentroid?.[dimension] ?? null,
        centroidEligible,
      );
    });
    return {
      index: periodIndex,
      time: basePeriod.time,
      selectedCentroid,
      fullCentroid,
      selectedStepDistance: interval(basePeriod.selected3d.stepDistance, (path) => path.periods[periodIndex]!.selected3d.stepDistance, stepEligible),
      fullStepDistance: interval(basePeriod.fullSpace.stepDistance, (path) => path.periods[periodIndex]!.fullSpace.stepDistance, stepEligible),
      selectedCumulativeDistance: interval(basePeriod.selected3d.cumulativeDistance, (path) => path.periods[periodIndex]!.selected3d.cumulativeDistance, cumulativeEligible),
      fullCumulativeDistance: interval(basePeriod.fullSpace.cumulativeDistance, (path) => path.periods[periodIndex]!.fullSpace.cumulativeDistance, cumulativeEligible),
    };
  });
  const diagnostics: TrajectoryBootstrapResult["diagnostics"] = [];
  if (insufficientClusters) diagnostics.push({ code: "BOOTSTRAP_INSUFFICIENT_CLUSTERS", severity: "warning", message: "Intervals requiring fewer than two participant clusters were withheld." });
  if (globalUnitCount === 1) diagnostics.push({ code: "BOOTSTRAP_SINGLETON_STRATUM", severity: "warning", message: "The global participant pool contains one physical participant and has no resampling variation." });
  if (globalUnitCount >= 2 && !anyCentroidVariation) diagnostics.push({ code: "BOOTSTRAP_DEGENERATE_DISTRIBUTION", severity: "warning", message: "All finite global-participant bootstrap centroid replicates are identical." });
  if (insufficientReplicates) diagnostics.push({ code: "BOOTSTRAP_INSUFFICIENT_REPLICATES", severity: "warning", message: `Intervals with fewer than ${requiredFiniteReplicates} finite replicates were withheld.` });
  return {
    schemaVersion: "3dena.trajectory-bootstrap.v1",
    base,
    confidenceLevel: task.confidenceLevel,
    periods,
    quantileRule: {
      id: "linear-type7-v1",
      sort: "ascending-numeric",
      position: "(n-1)*p",
      interpolation: "linear-between-floor-and-ceiling",
      endpoints: "p=0-min-p=1-max",
    },
    resampling: {
      unit: "participant-complete-history",
      stratified: false,
      strata: [{
        key: {
          components: [{ name: "@3dena/bootstrap", type: "string", value: "global-participant" }],
          canonical: "3dena:bootstrap:global-participant:v2",
          display: "Global participants",
        },
        unitCount: globalUnitCount,
      }],
      replicateCount: task.repetitions,
      planKind: "global-participant-history-resample-indices-v2",
      generation: {
        kind: "seeded",
        algorithm: "mulberry32-uint32-v1",
        seed: task.seed,
        unitSort: "utf16-code-unit-ascending",
        randomEndpoint: "zero-inclusive-one-exclusive",
      },
      rngParityClaim: false,
    },
    diagnostics,
  };
}

async function runBootstrapV2(
  task: TrajectoryBootstrapTaskV2 | undefined,
  pathTask: TrajectoryPathTaskV2,
  contexts: LongitudinalGroupContextV2[],
): Promise<{ results: LongitudinalBootstrapResultV2[]; planHashes: string[] }> {
  if (!task) return { results: [], planHashes: [] };
  assertBootstrapTaskV2(task, pathTask);
  const results: LongitudinalBootstrapResultV2[] = [];
  const planHashes: string[] = [];
  const resolvedResamplingDesign = task.resamplingDesign === "auto"
    ? (contexts.length > 1 ? "within-group" : "global-participant")
    : task.resamplingDesign;
  if (resolvedResamplingDesign === "global-participant") {
    const units = buildGlobalParticipantUnitsV2(contexts);
    const plan = createGlobalParticipantPlanV2(units, task.repetitions, task.seed);
    const planHash = await hashAnalysisValueV1(plan);
    for (const [groupIndex, context] of contexts.entries()) {
      const replicatePaths = plan.replicates.map((draw) => {
        const series = globalReplicateSeriesV2(context, groupIndex, units, draw);
        return series === null ? null : analyzeTrajectoryPath(series);
      });
      const result = summarizeGlobalParticipantBootstrapV2(context, replicatePaths, task, units.length);
      const finiteReplicates = finiteReplicateAudit(result);
      const requiredFiniteReplicates = Math.max(
        Math.ceil(task.repetitions * 0.8),
        Math.ceil(10 / (1 - task.confidenceLevel) - 1e-12),
      );
      const status = finiteReplicates >= requiredFiniteReplicates ? "available" as const : "not-estimable" as const;
      results.push({
        groupCanonical: context.group.canonical,
        status,
        notEstimableReason: status === "available" ? null : "insufficient-finite-replicates-or-participant-clusters",
        seed: task.seed,
        planHash,
        finiteReplicates,
        requiredFiniteReplicates,
        totalReplicates: task.repetitions,
        confidenceLevel: task.confidenceLevel,
        requestedResamplingDesign: task.resamplingDesign,
        resolvedResamplingDesign,
        resamplingAlgorithm: "global-participant-complete-history-mulberry32-uint32-v2",
        intervalContract: task.interval,
        rotationPolicy: task.rotationPolicy,
        speedIntervals: result.periods.map((period, periodIndex) => ({
          periodCanonical: period.time.canonical,
          selected: scaleBootstrapInterval(period.selectedStepDistance, context.dynamics.periods[periodIndex]!.elapsedFromPrevious),
          full: scaleBootstrapInterval(period.fullStepDistance, context.dynamics.periods[periodIndex]!.elapsedFromPrevious),
        })),
        result,
      });
    }
    return { results, planHashes: [planHash] };
  }
  for (const context of contexts) {
    const explicit = task.resamplingDesign === "explicit-strata";
    const series: TrajectorySeriesInput = explicit
      ? {
          ...context.series,
          points: context.series.points.map((point, pointIndex) => {
            const sourcePoint = context.sourcePoints[pointIndex];
            if (!sourcePoint) executionReject("TRAJECTORY_ADAPTER_SHAPE_MISMATCH", `paths.${context.group.canonical}.points[${pointIndex}]`, "has no aligned fitted source point");
            const field = task.explicitStrataField!;
            const value = sourcePoint.metadata[field];
            if (value === undefined || value === null) executionReject("MISSING_BOOTSTRAP_STRATUM", `dataset.sourceResult.result.points[${sourcePoint.index}].metadata.${field}`, "must be present and non-null for every participant history");
            return {
              ...point,
              stratum: {
                components: [{ name: field, type: scalarType(value, `metadata.${field}`), value: value as string | number | boolean }],
              },
            };
          }),
        }
      : context.series;
    const stratifyBy = explicit ? "explicit" as const : "none" as const;
    const units = getTrajectoryBootstrapUnits({ series, stratifyBy });
    const plan = createSeededTrajectoryBootstrapPlan({ units, repetitions: task.repetitions, seed: task.seed });
    const planHash = await hashAnalysisValueV1(plan);
    const result = bootstrapTrajectoryPath({
      series,
      stratifyBy,
      confidenceLevel: task.confidenceLevel,
      plan,
    });
    const finiteReplicates = finiteReplicateAudit(result);
    const requiredFiniteReplicates = Math.max(
      Math.ceil(task.repetitions * 0.8),
      Math.ceil(10 / (1 - task.confidenceLevel) - 1e-12),
    );
    const status = finiteReplicates >= requiredFiniteReplicates ? "available" as const : "not-estimable" as const;
    results.push({
      groupCanonical: context.group.canonical,
      status,
      notEstimableReason: status === "available" ? null : "insufficient-finite-replicates-or-participant-clusters",
      seed: task.seed,
      planHash,
      finiteReplicates,
      requiredFiniteReplicates,
      totalReplicates: task.repetitions,
      confidenceLevel: task.confidenceLevel,
      requestedResamplingDesign: task.resamplingDesign,
      resolvedResamplingDesign,
      resamplingAlgorithm: "participant-complete-history-mulberry32-uint32-v1",
      intervalContract: task.interval,
      rotationPolicy: task.rotationPolicy,
      speedIntervals: result.periods.map((period, periodIndex) => ({
        periodCanonical: period.time.canonical,
        selected: scaleBootstrapInterval(period.selectedStepDistance, context.dynamics.periods[periodIndex]!.elapsedFromPrevious),
        full: scaleBootstrapInterval(period.fullStepDistance, context.dynamics.periods[periodIndex]!.elapsedFromPrevious),
      })),
      result,
    });
    planHashes.push(planHash);
  }
  return { results, planHashes };
}

function meanFinite(values: number[], path: string): number {
  if (values.length === 0) executionReject("EMPTY_NETWORK_MEAN", path, "must contain at least one value");
  const total = values.reduce((sum, value, index) => {
    if (!Number.isFinite(value)) executionReject("NON_FINITE_NETWORK_WEIGHT", `${path}[${index}]`, "must be finite");
    const next = sum + value;
    if (!Number.isFinite(next)) executionReject("NETWORK_WEIGHT_OVERFLOW", path, "sum exceeds finite arithmetic");
    return next;
  }, 0);
  return total / values.length;
}

function runNetworkOverlaysV2(
  task: TrajectoryNetworkOverlayTaskV2 | undefined,
  pathTask: TrajectoryPathTaskV2,
  source: AnalysisExecutionDatasetV2["sourceResult"] & { sourceKind: "raw-jena" },
): { overlays: LongitudinalNetworkOverlayV2[]; diagnostics: LongitudinalAnalysisBundleV2["diagnostics"] } {
  if (!task) return { overlays: [], diagnostics: [] };
  assertNetworkOverlayTaskV2(task, pathTask);
  const result = source.result;
  const selectedIndexes = pathTask.runSpec.selectedDimensions.map((dimension, index) => {
    const selected = result.dimensions.indexOf(dimension);
    if (selected < 0) executionReject("UNKNOWN_SELECTED_DIMENSION", `pathTask.runSpec.selectedDimensions[${index}]`, "is absent from jENA node geometry");
    return selected;
  }) as [number, number, number];
  const knownGroups = new Set(result.trajectory?.groupOrder.map((group) => group.canonical) ?? []);
  const knownPeriods = new Set(pathTask.runSpec.orderedPeriods.map((period) => period.sourceTimeCanonical));
  const networkWeightField = pathTask.runSpec.estimand.kind === "weighted-participant"
    ? pathTask.runSpec.estimand.metadataField
    : null;
  const diagnostics: LongitudinalAnalysisBundleV2["diagnostics"] = [];
  const overlays = task.requests.map((request, requestIndex): LongitudinalNetworkOverlayV2 => {
    if (!knownPeriods.has(request.periodCanonical)) executionReject("UNKNOWN_TRAJECTORY_PERIOD", `networkOverlayTask.requests[${requestIndex}].periodCanonical`, "is absent from the ordered-period contract");
    if (request.groupCanonical !== null && !knownGroups.has(request.groupCanonical)) executionReject("UNKNOWN_TRAJECTORY_GROUP", `networkOverlayTask.requests[${requestIndex}].groupCanonical`, "is absent from the fitted trajectory groups");
    const rows = result.points.filter((point) => (
      point.time?.canonical === request.periodCanonical
      && (request.groupCanonical === null || point.group?.canonical === request.groupCanonical)
    ));
    if (rows.length === 0) {
      diagnostics.push({
        code: "NETWORK_OVERLAY_NOT_ESTIMABLE",
        severity: "warning",
        message: `No fitted participant-period network is available for overlay request ${requestIndex + 1}.`,
        path: `networkOverlayTask.requests[${requestIndex}]`,
      });
      return {
        status: "not-estimable",
        reason: "no-observed-participant-period-network",
        groupCanonical: request.groupCanonical,
        periodCanonical: request.periodCanonical,
        dimensions: [...pathTask.runSpec.selectedDimensions],
        estimand: pathTask.runSpec.estimand.kind,
        sourceRows: 0,
        participantPeriods: 0,
        effectiveParticipantN: null,
        nodes: [],
        edges: [],
      };
    }
    const grouped = new Map<string, AnalysisPoint[]>();
    for (const point of rows) {
      if (point.lineWeights.length !== result.edges.length) executionReject("NETWORK_EDGE_SHAPE_MISMATCH", `dataset.sourceResult.result.points[${point.index}].lineWeights`, "must align with the fitted edge inventory");
      const key = point.participantLabel.canonical;
      const current = grouped.get(key) ?? [];
      current.push(point);
      grouped.set(key, current);
    }
    const participantNetworks = [...grouped.values()].map((participantRows, participantIndex) => {
      const weight = networkWeightField === null
        ? 1
        : (() => {
            const values = participantRows.map((point) => point.metadata[networkWeightField]);
            const distinct = new Set(values);
            if (distinct.size !== 1 || typeof values[0] !== "number" || !Number.isFinite(values[0]) || values[0] <= 0) {
              executionReject("UNSTABLE_NETWORK_PARTICIPANT_WEIGHT", `networkOverlayTask.requests[${requestIndex}].participants[${participantIndex}]`, "requires one constant, finite, positive participant-period weight");
            }
            return values[0];
          })();
      return {
        weight,
        edges: result.edges.map((_, edgeIndex) => meanFinite(
          participantRows.map((point) => point.lineWeights[edgeIndex]!),
          `networkOverlayTask.requests[${requestIndex}].participants[${participantIndex}].edges[${edgeIndex}]`,
        )),
      };
    });
    const weightSum = participantNetworks.reduce((sum, participant) => sum + participant.weight, 0);
    const weightSquareSum = participantNetworks.reduce((sum, participant) => sum + participant.weight ** 2, 0);
    if (!Number.isFinite(weightSum) || weightSum <= 0 || !Number.isFinite(weightSquareSum) || weightSquareSum <= 0) {
      executionReject("NETWORK_WEIGHT_OVERFLOW", `networkOverlayTask.requests[${requestIndex}]`, "participant weight accumulation is invalid");
    }
    const edgeWeights = result.edges.map((_, edgeIndex) => (
      participantNetworks.reduce((sum, participant) => sum + participant.edges[edgeIndex]! * participant.weight, 0) / weightSum
    ));
    if (edgeWeights.some((weight) => !Number.isFinite(weight))) executionReject("NETWORK_WEIGHT_OVERFLOW", `networkOverlayTask.requests[${requestIndex}].edges`, "weighted mean is non-finite");
    const nodeWeights = result.nodes.map((node) => result.edges.reduce((sum, edge, edgeIndex) => (
      edge.sourceIndex === node.index || edge.targetIndex === node.index ? sum + Math.abs(edgeWeights[edgeIndex]!) : sum
    ), 0));
    return {
      status: "available",
      reason: null,
      groupCanonical: request.groupCanonical,
      periodCanonical: request.periodCanonical,
      dimensions: [...pathTask.runSpec.selectedDimensions],
      estimand: pathTask.runSpec.estimand.kind,
      sourceRows: rows.length,
      participantPeriods: participantNetworks.length,
      effectiveParticipantN: weightSum ** 2 / weightSquareSum,
      nodes: result.nodes.map((node, nodeIndex) => ({
        code: node.code,
        coordinates: selectedIndexes.map((dimensionIndex) => node.fullCoordinates[dimensionIndex]!) as [number, number, number],
        weight: nodeWeights[nodeIndex]!,
      })),
      edges: result.edges.map((edge, edgeIndex) => ({
        id: edge.id,
        sourceIndex: edge.sourceIndex,
        targetIndex: edge.targetIndex,
        weight: edgeWeights[edgeIndex]!,
      })),
    };
  });
  return { overlays, diagnostics };
}

/**
 * Executes the display-independent base path against one immutable fitted
 * jENA result. Inference and bootstrap tasks are added to the same envelope by
 * the versioned task coordinator; presenter changes never enter this function.
 */
export async function executeLongitudinalAnalysisV2(
  input: LongitudinalExecutionRequestV2,
): Promise<LongitudinalAnalysisBundleV2> {
  if (!input || typeof input !== "object") executionReject("INVALID_LONGITUDINAL_REQUEST", "input", "must be an object");
  assertAnalysisExecutionDatasetV2(input.dataset);
  assertPathTaskV2(input.pathTask);
  validateExecutionMetadata(input.execution);
  const { dataset, pathTask } = input;
  if (pathTask.datasetHash !== dataset.receipt.sha256) {
    executionReject("TRAJECTORY_DATASET_BINDING_MISMATCH", "pathTask.datasetHash", "does not match the immutable dataset receipt");
  }
  if (pathTask.specHash !== dataset.specHash) {
    executionReject("TRAJECTORY_SPEC_BINDING_MISMATCH", "pathTask.specHash", "does not match the immutable fitted spec hash");
  }
  const source = dataset.sourceResult;
  if (!source) executionReject("MISSING_SOURCE_RESULT", "dataset.sourceResult", "is required");
  if (source.hash !== pathTask.runSpec.sourceResultHash) {
    executionReject("TRAJECTORY_SOURCE_BINDING_MISMATCH", "pathTask.runSpec.sourceResultHash", "does not match dataset.sourceResult.hash");
  }
  const computedSourceHash = await hashAnalysisValueV1(source.result);
  if (computedSourceHash !== source.hash) {
    executionReject("TRAJECTORY_SOURCE_HASH_MISMATCH", "dataset.sourceResult", "scientific result bytes do not match the bound source hash");
  }
  if (source.sourceKind !== "raw-jena") {
    executionReject("PREPARED_RESULT_V2_READ_ONLY", "dataset.sourceResult.sourceKind", "new V2 longitudinal runs require a fitted raw-jena result; prepared V1 artifacts remain readable only");
  }
  const built = buildGroupInputsV2(source, pathTask.runSpec);
  let pathSet;
  try {
    pathSet = analyzeTrajectoryPathSetV2({
      schemaVersion: "3dena.trajectory-path-set-input.v2",
      dimensions: built.fullDimensions,
      selectedDimensions: [...pathTask.runSpec.selectedDimensions],
      periods: built.periods,
      cohortPolicy: pathTask.runSpec.cohortPolicy,
      estimand: pathTask.runSpec.estimand.kind === "equal-participant"
        ? { kind: "equal-participant-v1" }
        : { kind: "weighted-participant-v1" },
      groups: built.groups,
    });
  } catch (error) {
    if (error instanceof TrajectoryDynamicsError) executionReject(error.code, `trajectory.${error.path}`, error.message);
    throw error;
  }
  const paths: LongitudinalGroupPathV2[] = pathSet.groups.map((group, index) => ({
    group: structuredClone(built.sourceGroups[index]!),
    dynamics: group.dynamics,
  }));
  const contexts = groupContextsV2(built, paths);
  const derivedInference = await runInferenceV2(input.inferenceTask, pathTask, contexts);
  const derivedBootstrap = await runBootstrapV2(input.bootstrapTask, pathTask, contexts);
  const derivedNetworks = runNetworkOverlaysV2(input.networkOverlayTask, pathTask, source);
  const jenaBuildId = `jena-js@${input.execution.jenaVersion}+${input.execution.jenaCommit}:${input.execution.buildId}`;
  const scientificCore = {
    schemaVersion: LONGITUDINAL_BUNDLE_VERSION_V2,
    identity: {
      datasetHash: pathTask.datasetHash,
      specHash: pathTask.specHash,
      sourceResultHash: source.hash,
      runId: pathTask.runId,
      jenaBuildId,
    },
    runSpec: structuredClone(pathTask.runSpec),
    model: {
      type: built.model,
      fullRotationDimensions: built.fullDimensions,
      selectedDimensions: [...pathTask.runSpec.selectedDimensions] as [string, string, string],
    },
    paths,
    inference: derivedInference.inference,
    pathComparisons: derivedInference.comparisons,
    bootstrap: derivedBootstrap.results,
    networkOverlays: derivedNetworks.overlays,
    diagnostics: [
      ...pathSet.groups.flatMap((group) => group.dynamics.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        severity: diagnostic.severity,
      }))),
      ...derivedNetworks.diagnostics,
    ],
    scientificExecution: {
      jenaVersion: input.execution.jenaVersion,
      jenaCommit: input.execution.jenaCommit,
      jenaTarballIntegrity: input.execution.jenaTarballIntegrity,
      sdkVersion: input.execution.sdkVersion,
      buildId: input.execution.buildId,
      seed: input.execution.seed,
      permutationPlanHashes: derivedInference.planHashes,
      resamplingPlanHashes: derivedBootstrap.planHashes,
      evidenceStatus: "IMPLEMENTED_UNVERIFIED" as const,
    },
  };
  const resultHash = await hashAnalysisValueV1(scientificCore);
  return deepFreeze({
    schemaVersion: LONGITUDINAL_BUNDLE_VERSION_V2,
    identity: { ...scientificCore.identity, resultHash },
    runSpec: scientificCore.runSpec,
    model: scientificCore.model,
    paths: scientificCore.paths,
    inference: scientificCore.inference,
    pathComparisons: scientificCore.pathComparisons,
    bootstrap: scientificCore.bootstrap,
    networkOverlays: scientificCore.networkOverlays,
    diagnostics: scientificCore.diagnostics,
    execution: {
      target: input.execution.target,
      ...scientificCore.scientificExecution,
    },
  });
}
