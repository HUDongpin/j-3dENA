/** Browser-safe descriptive and comparison statistics for preprojected trajectories. */

export type TrajectoryScalarType = "string" | "number" | "boolean";
export type TrajectoryScalar = string | number | boolean;
export type TrajectoryCohortPolicy = "available" | "complete";

export interface TrajectoryIdentityComponent {
  name: string;
  type: TrajectoryScalarType;
  value: TrajectoryScalar;
  /** Optional source semantic type, included in the collision-safe canonical key. */
  declaredType?: string;
}

export interface TrajectoryIdentity {
  components: TrajectoryIdentityComponent[];
}

export interface TrajectoryKey extends TrajectoryIdentity {
  canonical: string;
  display: string;
}

export interface TrajectoryStatisticsPoint {
  participant: TrajectoryIdentity;
  time: TrajectoryIdentity;
  /** Required and participant-stable only when explicit stratification is requested. */
  stratum?: TrajectoryIdentity;
  /** Coordinates in the exact order declared by the containing series. */
  coordinates: number[];
  /** Required, finite, and strictly positive for the weighted-participant estimand. */
  weight?: number;
}

export interface TrajectoryStatisticsLimits {
  maxPoints: number;
  maxDimensions: number;
  maxPeriods: number;
  maxParticipants: number;
  maxCells: number;
  maxResamples: number;
  maxTests: number;
}

export interface TrajectorySeriesInput {
  /** A stable namespace for this sample; required to isolate independent sides. */
  namespace: string;
  points: TrajectoryStatisticsPoint[];
  dimensions: string[];
  selectedDimensions: [string, string, string];
  timeOrder: TrajectoryIdentity[];
  cohortPolicy: TrajectoryCohortPolicy;
  /** Defaults to equal-participant for V1 readers. */
  estimand?: "equal-participant" | "weighted-participant";
  limits?: Partial<TrajectoryStatisticsLimits>;
}

export interface TrajectoryParticipantPeriod {
  index: number;
  participant: TrajectoryKey;
  time: TrajectoryKey;
  selectedCoordinates: [number, number, number];
  fullCoordinates: number[];
  sourceRowIndexes: number[];
  participantWeight: number;
  includedInCohort: boolean;
}

export interface TrajectoryDistanceMetrics {
  dimensions: string[];
  delta: number[] | null;
  stepDistance: number | null;
  cumulativeDistance: number | null;
}

export interface TrajectoryPathPeriodStatistics {
  index: number;
  time: TrajectoryKey;
  selectedCentroid: [number, number, number] | null;
  fullCentroid: number[] | null;
  selected3d: TrajectoryDistanceMetrics;
  fullSpace: TrajectoryDistanceMetrics;
  nRows: number;
  nTotal: number;
  nUsed: number;
  nDuplicateRows: number;
  nCohortExcluded: number;
}

export interface TrajectoryStatisticsDiagnostic {
  code: string;
  severity: "info" | "warning";
  message: string;
  path?: string;
}

export interface TrajectoryPathStatistics {
  schemaVersion: "3dena.trajectory-path-statistics.v1";
  namespace: string;
  cohortPolicy: TrajectoryCohortPolicy;
  estimand: "equal-participant" | "weighted-participant";
  dimensions: string[];
  selectedDimensions: [string, string, string];
  distanceSemantics: {
    selected3d: "euclidean-selected-three-dimensions";
    fullSpace: "euclidean-all-declared-dimensions";
  };
  participantPeriods: TrajectoryParticipantPeriod[];
  periods: TrajectoryPathPeriodStatistics[];
  diagnostics: TrajectoryStatisticsDiagnostic[];
  summary: {
    inputRows: number;
    participants: number;
    participantPeriods: number;
    periods: number;
    duplicateRows: number;
  };
  resolvedLimits: TrajectoryStatisticsLimits;
}

export interface TrajectoryComparisonSide {
  label: string;
  series: TrajectorySeriesInput;
}

export interface PairedSwapPermutationPlan {
  kind: "paired-swap-indices-v1";
  /** Exact deterministic order returned by `getTrajectoryPermutationUnits()`. */
  unitOrder: string[];
  /** Each replicate lists matched-pair indexes whose A/B histories are swapped. */
  replicates: number[][];
}

export interface IndependentPoolPermutationPlan {
  kind: "independent-pool-indices-v1";
  /** Exact deterministic order returned by `getTrajectoryPermutationUnits()`. */
  unitOrder: string[];
  /** Each replicate is a complete permutation; the first original-A count becomes A. */
  replicates: number[][];
}

interface TrajectoryComparisonInputBase {
  sideA: TrajectoryComparisonSide;
  sideB: TrajectoryComparisonSide;
}

export interface PairedTrajectoryComparisonInput extends TrajectoryComparisonInputBase {
  design: "paired";
  /** Caller-selected identity component or collision-safe tuple shared across conditions. */
  pairedId: string | string[];
  permutationPlan?: PairedSwapPermutationPlan;
}

export interface IndependentTrajectoryComparisonInput extends TrajectoryComparisonInputBase {
  design: "independent";
  permutationPlan?: IndependentPoolPermutationPlan;
}

export type TrajectoryComparisonInput =
  | PairedTrajectoryComparisonInput
  | IndependentTrajectoryComparisonInput;

export interface TrajectoryComparisonPeriod {
  index: number;
  time: TrajectoryKey;
  selectedCentroidA: [number, number, number] | null;
  selectedCentroidB: [number, number, number] | null;
  selectedDifference: [number, number, number] | null;
  fullCentroidA: number[] | null;
  fullCentroidB: number[] | null;
  fullDifference: number[] | null;
  selectedCentroidSeparation: number | null;
  fullCentroidSeparation: number | null;
  selectedStepDistanceA: number | null;
  selectedStepDistanceB: number | null;
  selectedStepDistanceDifference: number | null;
  selectedCumulativeDistanceA: number | null;
  selectedCumulativeDistanceB: number | null;
  selectedCumulativeDistanceDifference: number | null;
  fullStepDistanceA: number | null;
  fullStepDistanceB: number | null;
  fullStepDistanceDifference: number | null;
  fullCumulativeDistanceA: number | null;
  fullCumulativeDistanceB: number | null;
  fullCumulativeDistanceDifference: number | null;
  nAUsed: number;
  nBUsed: number;
  nMatched: number | null;
}

export interface TrajectoryPermutationTest {
  id: string;
  timeIndex: number;
  metric: string;
  distanceSpace: "selected-3d" | "full-space" | null;
  tail: "two-sided" | "upper";
  observed: number;
  pValue: number;
  holmAdjustedPValue: number;
  permutationCount: number;
}

export interface TrajectoryComparisonResult {
  schemaVersion: "3dena.trajectory-comparison.v1";
  design: "paired" | "independent";
  direction: "B-minus-A";
  pairedId: string | string[] | null;
  sideA: TrajectoryPathStatistics;
  sideB: TrajectoryPathStatistics;
  periods: TrajectoryComparisonPeriod[];
  tests: TrajectoryPermutationTest[];
  permutation: {
    status: "not-requested" | "complete";
    planKind: PairedSwapPermutationPlan["kind"] | IndependentPoolPermutationPlan["kind"] | null;
    unitOrder: string[];
    replicateCount: number;
    rngParityClaim: false;
  };
  diagnostics: TrajectoryStatisticsDiagnostic[];
}

export interface TrajectoryPermutationUnits {
  design: "paired" | "independent";
  unitOrder: string[];
  sideACount: number | null;
}

export type TrajectoryBootstrapStratification = "none" | "explicit";

export interface TrajectoryBootstrapStratumUnits {
  key: TrajectoryKey;
  unitIndexes: number[];
}

export interface TrajectoryBootstrapUnits {
  schemaVersion: "3dena.trajectory-bootstrap-units.v1";
  unitOrder: string[];
  strata: TrajectoryBootstrapStratumUnits[];
  cohortPolicy: TrajectoryCohortPolicy;
  stratifyBy: TrajectoryBootstrapStratification;
}

export interface TrajectoryBootstrapStratumPlan {
  key: TrajectoryKey;
  unitIndexes: number[];
  /** Global unit indexes, sampled with replacement, one draw per original stratum unit. */
  replicates: number[][];
}

export interface TrajectoryBootstrapPlan {
  kind: "participant-history-resample-indices-v1";
  unitOrder: string[];
  strata: TrajectoryBootstrapStratumPlan[];
  generation:
    | { kind: "caller-provided" }
    | {
        kind: "seeded";
        algorithm: "mulberry32-uint32-v1";
        seed: number;
        unitSort: "utf16-code-unit-ascending";
        randomEndpoint: "zero-inclusive-one-exclusive";
      };
}

export interface GetTrajectoryBootstrapUnitsInput {
  series: TrajectorySeriesInput;
  stratifyBy: TrajectoryBootstrapStratification;
}

export interface CreateSeededTrajectoryBootstrapPlanInput {
  units: TrajectoryBootstrapUnits;
  repetitions: number;
  seed: number;
  limits?: Partial<TrajectoryStatisticsLimits>;
}

export interface TrajectoryBootstrapInput {
  series: TrajectorySeriesInput;
  stratifyBy: TrajectoryBootstrapStratification;
  confidenceLevel: number;
  plan: TrajectoryBootstrapPlan;
}

export interface TrajectoryBootstrapInterval {
  estimate: number;
  lower: number;
  upper: number;
  finiteReplicates: number;
  requiredFiniteReplicates: number;
  totalReplicates: number;
}

export interface TrajectoryBootstrapPeriod {
  index: number;
  time: TrajectoryKey;
  selectedCentroid: Array<TrajectoryBootstrapInterval | null>;
  fullCentroid: Array<TrajectoryBootstrapInterval | null>;
  selectedStepDistance: TrajectoryBootstrapInterval | null;
  fullStepDistance: TrajectoryBootstrapInterval | null;
  selectedCumulativeDistance: TrajectoryBootstrapInterval | null;
  fullCumulativeDistance: TrajectoryBootstrapInterval | null;
}

export interface TrajectoryBootstrapResult {
  schemaVersion: "3dena.trajectory-bootstrap.v1";
  base: TrajectoryPathStatistics;
  confidenceLevel: number;
  periods: TrajectoryBootstrapPeriod[];
  quantileRule: {
    id: "linear-type7-v1";
    sort: "ascending-numeric";
    position: "(n-1)*p";
    interpolation: "linear-between-floor-and-ceiling";
    endpoints: "p=0-min-p=1-max";
  };
  resampling: {
    unit: "participant-complete-history";
    stratified: boolean;
    strata: Array<{ key: TrajectoryKey; unitCount: number }>;
    replicateCount: number;
    planKind: "participant-history-resample-indices-v1" | "global-participant-history-resample-indices-v2";
    generation: TrajectoryBootstrapPlan["generation"];
    rngParityClaim: false;
  };
  diagnostics: TrajectoryStatisticsDiagnostic[];
}

const DEFAULT_LIMITS: TrajectoryStatisticsLimits = Object.freeze({
  maxPoints: 100_000,
  maxDimensions: 200,
  maxPeriods: 1_000,
  maxParticipants: 50_000,
  maxCells: 5_000_000,
  maxResamples: 10_000,
  maxTests: 10_000
});

const HARD_LIMITS: TrajectoryStatisticsLimits = Object.freeze({
  maxPoints: 500_000,
  maxDimensions: 500,
  maxPeriods: 10_000,
  maxParticipants: 200_000,
  maxCells: 100_000_000,
  maxResamples: 100_000,
  maxTests: 100_000
});

export class TrajectoryStatisticsError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "TrajectoryStatisticsError";
    this.code = code;
    this.path = path;
  }
}

function reject(code: string, path: string, message: string): never {
  throw new TrajectoryStatisticsError(code, path, message);
}

function resolveLimits(input?: Partial<TrajectoryStatisticsLimits>): TrajectoryStatisticsLimits {
  const result = {} as TrajectoryStatisticsLimits;
  for (const key of Object.keys(DEFAULT_LIMITS) as Array<keyof TrajectoryStatisticsLimits>) {
    const value = input?.[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
      reject("INVALID_TRAJECTORY_LIMIT", `limits.${key}`, "must be a positive safe integer");
    }
    if (value !== undefined && value > HARD_LIMITS[key]) {
      reject("TRAJECTORY_LIMIT_ABOVE_CEILING", `limits.${key}`, `must not exceed ${HARD_LIMITS[key]}`);
    }
    result[key] = value ?? DEFAULT_LIMITS[key];
  }
  return result;
}

function scalarToken(component: TrajectoryIdentityComponent, path: string): [string, string, string, string] {
  if (typeof component.name !== "string" || component.name.trim() === "") {
    reject("INVALID_IDENTITY_COMPONENT", `${path}.name`, "must be a non-empty string");
  }
  if (component.declaredType !== undefined && (typeof component.declaredType !== "string" || component.declaredType.trim() === "" || component.declaredType.length > 256)) {
    reject("INVALID_IDENTITY_COMPONENT", `${path}.declaredType`, "must be a non-empty string of at most 256 UTF-16 code units when present");
  }
  if (component.type === "string") {
    if (typeof component.value !== "string" || component.value.length === 0) {
      reject("INVALID_IDENTITY_VALUE", `${path}.value`, "must be a non-empty string for a string component");
    }
    return [component.name, "string", component.declaredType ?? "string", component.value];
  }
  if (component.type === "boolean") {
    if (typeof component.value !== "boolean") reject("INVALID_IDENTITY_VALUE", `${path}.value`, "must be boolean");
    return [component.name, "boolean", component.declaredType ?? "boolean", component.value ? "true" : "false"];
  }
  if (component.type !== "number" || typeof component.value !== "number" || !Number.isFinite(component.value)) {
    reject("INVALID_IDENTITY_VALUE", `${path}.value`, "must be a finite number with type number");
  }
  if (Number.isInteger(component.value) && !Number.isSafeInteger(component.value)) {
    reject("UNSAFE_INTEGER_IDENTITY", `${path}.value`, "integer identities above Number.MAX_SAFE_INTEGER must be strings");
  }
  return [component.name, "number", component.declaredType ?? "number", Object.is(component.value, -0) ? "-0" : String(component.value)];
}

function normalizeIdentity(identity: TrajectoryIdentity, path: string): TrajectoryKey {
  if (!identity || !Array.isArray(identity.components) || identity.components.length === 0) {
    reject("INVALID_TRAJECTORY_IDENTITY", path, "must contain at least one typed component");
  }
  const seen = new Set<string>();
  const components = identity.components.map((component, index) => {
    if (!component || typeof component !== "object") reject("INVALID_IDENTITY_COMPONENT", `${path}.components[${index}]`, "must be an object");
    const token = scalarToken(component, `${path}.components[${index}]`);
    if (seen.has(component.name)) reject("DUPLICATE_IDENTITY_COMPONENT", `${path}.components[${index}].name`, "duplicates an earlier component name");
    seen.add(component.name);
    return { component: { ...component }, token };
  });
  return {
    components: components.map((entry) => entry.component),
    canonical: JSON.stringify(components.map((entry) => entry.token)),
    display: components.map((entry) => String(entry.component.value)).join(" · ")
  };
}

function normalizeNamespace(value: string, path: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 256) {
    reject("INVALID_TRAJECTORY_NAMESPACE", path, "must be a non-empty string of at most 256 UTF-16 code units");
  }
  return value;
}

interface NormalizedSeries {
  input: TrajectorySeriesInput;
  namespace: string;
  dimensions: string[];
  selectedDimensions: [string, string, string];
  selectedIndexes: [number, number, number];
  timeOrder: TrajectoryKey[];
  estimand: "equal-participant" | "weighted-participant";
  points: Array<{ participant: TrajectoryKey; time: TrajectoryKey; stratum?: TrajectoryKey; coordinates: number[]; weight: number; rowIndex: number }>;
  limits: TrajectoryStatisticsLimits;
}

function normalizeSeries(input: TrajectorySeriesInput): NormalizedSeries {
  if (!input || typeof input !== "object") reject("INVALID_TRAJECTORY_INPUT", "input", "must be an object");
  const limits = resolveLimits(input.limits);
  const namespace = normalizeNamespace(input.namespace, "input.namespace");
  if (!Array.isArray(input.points) || input.points.length === 0) reject("EMPTY_TRAJECTORY_POINTS", "input.points", "must contain at least one point");
  if (input.points.length > limits.maxPoints) reject("TRAJECTORY_POINT_LIMIT", "input.points", `exceeds maxPoints=${limits.maxPoints}`);
  if (!Array.isArray(input.dimensions) || input.dimensions.length === 0) reject("INVALID_TRAJECTORY_DIMENSIONS", "input.dimensions", "must be non-empty");
  if (input.dimensions.length > limits.maxDimensions) reject("TRAJECTORY_DIMENSION_LIMIT", "input.dimensions", `exceeds maxDimensions=${limits.maxDimensions}`);
  if (input.dimensions.some((dimension) => typeof dimension !== "string" || dimension.trim() === "")) reject("INVALID_TRAJECTORY_DIMENSIONS", "input.dimensions", "must contain non-empty strings");
  if (new Set(input.dimensions).size !== input.dimensions.length) reject("DUPLICATE_TRAJECTORY_DIMENSION", "input.dimensions", "must be unique");
  if (!Array.isArray(input.selectedDimensions) || input.selectedDimensions.length !== 3 || new Set(input.selectedDimensions).size !== 3) {
    reject("INVALID_SELECTED_DIMENSIONS", "input.selectedDimensions", "must contain exactly three distinct dimensions");
  }
  const selectedIndexes = input.selectedDimensions.map((dimension, index) => {
    const found = input.dimensions.indexOf(dimension);
    if (found < 0) reject("UNKNOWN_SELECTED_DIMENSION", `input.selectedDimensions[${index}]`, `${JSON.stringify(dimension)} is not declared`);
    return found;
  }) as [number, number, number];
  if (!Array.isArray(input.timeOrder) || input.timeOrder.length === 0) reject("INVALID_TRAJECTORY_TIME_ORDER", "input.timeOrder", "must be non-empty");
  if (input.timeOrder.length > limits.maxPeriods) reject("TRAJECTORY_PERIOD_LIMIT", "input.timeOrder", `exceeds maxPeriods=${limits.maxPeriods}`);
  const timeOrder = input.timeOrder.map((time, index) => normalizeIdentity(time, `input.timeOrder[${index}]`));
  if (new Set(timeOrder.map((time) => time.canonical)).size !== timeOrder.length) reject("DUPLICATE_TRAJECTORY_TIME", "input.timeOrder", "contains duplicate typed periods");
  if (input.cohortPolicy !== "available" && input.cohortPolicy !== "complete") reject("INVALID_TRAJECTORY_COHORT", "input.cohortPolicy", "must be available or complete");
  const estimand = input.estimand ?? "equal-participant";
  if (estimand !== "equal-participant" && estimand !== "weighted-participant") reject("INVALID_TRAJECTORY_ESTIMAND", "input.estimand", "must be equal-participant or weighted-participant");
  const timeKeys = new Set(timeOrder.map((time) => time.canonical));
  const cells = input.points.length * input.dimensions.length;
  if (!Number.isSafeInteger(cells) || cells > limits.maxCells) reject("TRAJECTORY_CELL_LIMIT", "input.points", `exceeds maxCells=${limits.maxCells}`);
  const points = input.points.map((point, rowIndex) => {
    const participant = normalizeIdentity(point.participant, `input.points[${rowIndex}].participant`);
    const time = normalizeIdentity(point.time, `input.points[${rowIndex}].time`);
    const stratum = point.stratum === undefined ? undefined : normalizeIdentity(point.stratum, `input.points[${rowIndex}].stratum`);
    if (!timeKeys.has(time.canonical)) reject("TRAJECTORY_TIME_ORDER_INCOMPLETE", `input.points[${rowIndex}].time`, "observed period is absent from timeOrder");
    if (!Array.isArray(point.coordinates) || point.coordinates.length !== input.dimensions.length) reject("TRAJECTORY_COORDINATE_SHAPE", `input.points[${rowIndex}].coordinates`, "must align with dimensions");
    const coordinates = point.coordinates.map((value, dimensionIndex) => {
      if (typeof value !== "number" || !Number.isFinite(value)) reject("NON_FINITE_TRAJECTORY_COORDINATE", `input.points[${rowIndex}].coordinates[${dimensionIndex}]`, "must be finite");
      return value;
    });
    if (estimand === "weighted-participant" && (typeof point.weight !== "number" || !Number.isFinite(point.weight) || point.weight <= 0)) {
      reject("INVALID_PARTICIPANT_WEIGHT", `input.points[${rowIndex}].weight`, "must be finite and strictly positive for weighted-participant");
    }
    if (estimand === "equal-participant" && point.weight !== undefined) {
      reject("UNEXPECTED_PARTICIPANT_WEIGHT", `input.points[${rowIndex}].weight`, "must be omitted for equal-participant");
    }
    return { participant, time, ...(stratum ? { stratum } : {}), coordinates, weight: point.weight ?? 1, rowIndex };
  });
  if (new Set(points.map((point) => point.participant.canonical)).size > limits.maxParticipants) {
    reject("TRAJECTORY_PARTICIPANT_LIMIT", "input.points", `exceeds maxParticipants=${limits.maxParticipants}`);
  }
  return {
    input,
    namespace,
    dimensions: [...input.dimensions],
    selectedDimensions: [...input.selectedDimensions],
    selectedIndexes,
    estimand,
    timeOrder,
    points,
    limits
  };
}

function euclidean(delta: number[]): number {
  const result = Math.hypot(...delta);
  if (!Number.isFinite(result)) reject("TRAJECTORY_NUMERIC_OVERFLOW", "trajectory.computation.distance", "Euclidean distance is outside the finite numeric range");
  return result;
}

function subtract(right: number[], left: number[]): number[] {
  return right.map((value, index) => {
    const difference = value - left[index]!;
    if (!Number.isFinite(difference)) reject("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.computation.delta[${index}]`, "coordinate difference is outside the finite numeric range");
    return difference;
  });
}

function scalarDifference(right: number, left: number, path: string): number {
  const difference = right - left;
  if (!Number.isFinite(difference)) reject("TRAJECTORY_NUMERIC_OVERFLOW", path, "difference is outside the finite numeric range");
  return difference;
}

function compareCanonical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function mean(rows: number[][], dimensions: number): number[] | null {
  if (rows.length === 0) return null;
  return Array.from({ length: dimensions }, (_, index) => {
    // Divide before summing so same-sign finite inputs cannot overflow merely
    // because their unscaled total exceeds Number.MAX_VALUE. Neumaier's
    // correction also retains small residuals across severe cancellation.
    let sum = 0;
    let correction = 0;
    for (const row of rows) {
      const scaled = row[index]! / rows.length;
      const next = sum + scaled;
      if (!Number.isFinite(next)) reject("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.computation.mean[${index}]`, "centroid accumulation is outside the finite numeric range");
      correction += Math.abs(sum) >= Math.abs(scaled)
        ? (sum - next) + scaled
        : (scaled - next) + sum;
      if (!Number.isFinite(correction)) reject("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.computation.mean[${index}]`, "centroid correction is outside the finite numeric range");
      sum = next;
    }
    const result = sum + correction;
    if (!Number.isFinite(result)) reject("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.computation.mean[${index}]`, "centroid is outside the finite numeric range");
    return result;
  });
}

function weightedMean(rows: number[][], weights: number[], dimensions: number): number[] | null {
  if (rows.length === 0) return null;
  if (rows.length !== weights.length) reject("TRAJECTORY_WEIGHT_SHAPE", "trajectory.computation.weightedMean", "rows and weights must align");
  const weightSum = weights.reduce((sum, weight, index) => {
    if (!Number.isFinite(weight) || weight <= 0) reject("INVALID_PARTICIPANT_WEIGHT", `trajectory.computation.weights[${index}]`, "must be finite and strictly positive");
    const next = sum + weight;
    if (!Number.isFinite(next)) reject("TRAJECTORY_NUMERIC_OVERFLOW", "trajectory.computation.weightSum", "is outside the finite numeric range");
    return next;
  }, 0);
  return Array.from({ length: dimensions }, (_, index) => {
    let sum = 0;
    let correction = 0;
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const scaled = rows[rowIndex]![index]! * (weights[rowIndex]! / weightSum);
      const next = sum + scaled;
      if (!Number.isFinite(next)) reject("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.computation.weightedMean[${index}]`, "centroid accumulation is outside the finite numeric range");
      correction += Math.abs(sum) >= Math.abs(scaled) ? (sum - next) + scaled : (scaled - next) + sum;
      if (!Number.isFinite(correction)) reject("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.computation.weightedMean[${index}]`, "centroid correction is outside the finite numeric range");
      sum = next;
    }
    const result = sum + correction;
    if (!Number.isFinite(result)) reject("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.computation.weightedMean[${index}]`, "centroid is outside the finite numeric range");
    return result;
  });
}

function participantCentroid(
  rows: TrajectoryParticipantPeriod[],
  coordinates: (row: TrajectoryParticipantPeriod) => number[],
  dimensions: number,
  estimand: NormalizedSeries["estimand"],
): number[] | null {
  const values = rows.map(coordinates);
  return estimand === "weighted-participant"
    ? weightedMean(values, rows.map((row) => row.participantWeight), dimensions)
    : mean(values, dimensions);
}

function reduceParticipantPeriods(series: NormalizedSeries): TrajectoryParticipantPeriod[] {
  const grouped = new Map<string, { participant: TrajectoryKey; time: TrajectoryKey; rows: typeof series.points }>();
  for (const point of series.points) {
    const key = JSON.stringify([series.namespace, point.participant.canonical, point.time.canonical]);
    const group = grouped.get(key);
    if (group) group.rows.push(point);
    else grouped.set(key, { participant: point.participant, time: point.time, rows: [point] });
  }
  const expected = new Set(series.timeOrder.map((time) => time.canonical));
  const observedByParticipant = new Map<string, Set<string>>();
  for (const group of grouped.values()) {
    const observed = observedByParticipant.get(group.participant.canonical) ?? new Set<string>();
    observed.add(group.time.canonical);
    observedByParticipant.set(group.participant.canonical, observed);
  }
  const complete = new Set([...observedByParticipant.entries()].filter(([, observed]) => [...expected].every((time) => observed.has(time))).map(([participant]) => participant));
  const timeIndex = new Map(series.timeOrder.map((time, index) => [time.canonical, index]));
  return [...grouped.values()]
    .sort((left, right) => compareCanonical(left.participant.canonical, right.participant.canonical) || timeIndex.get(left.time.canonical)! - timeIndex.get(right.time.canonical)!)
    .map((group, index) => {
      const distinctWeights = new Set(group.rows.map((row) => row.weight));
      if (distinctWeights.size !== 1) {
        reject("UNSTABLE_PARTICIPANT_PERIOD_WEIGHT", `input.participantPeriods[${index}].weight`, "must remain constant within a participant-period");
      }
      const fullCoordinates = mean(group.rows.map((row) => row.coordinates), series.dimensions.length)!;
      return {
        index,
        participant: group.participant,
        time: group.time,
        selectedCoordinates: series.selectedIndexes.map((selected) => fullCoordinates[selected]!) as [number, number, number],
        fullCoordinates,
        sourceRowIndexes: group.rows.map((row) => row.rowIndex).sort((a, b) => a - b),
        participantWeight: group.rows[0]!.weight,
        includedInCohort: series.input.cohortPolicy === "available" || complete.has(group.participant.canonical)
      };
    });
}

function distanceMetrics(
  centroids: Array<number[] | null>,
  dimensions: string[]
): TrajectoryDistanceMetrics[] {
  let continuous = true;
  let cumulative = 0;
  return centroids.map((centroid, index) => {
    if (centroid === null) {
      continuous = false;
      return { dimensions: [...dimensions], delta: null, stepDistance: null, cumulativeDistance: null };
    }
    if (index === 0) return { dimensions: [...dimensions], delta: null, stepDistance: 0, cumulativeDistance: 0 };
    const previous = centroids[index - 1];
    if (previous === null || previous === undefined) {
      continuous = false;
      return { dimensions: [...dimensions], delta: null, stepDistance: null, cumulativeDistance: null };
    }
    const delta = subtract(centroid, previous);
    const stepDistance = euclidean(delta);
    if (continuous) {
      const nextCumulative = cumulative + stepDistance;
      if (!Number.isFinite(nextCumulative)) reject("TRAJECTORY_NUMERIC_OVERFLOW", "trajectory.computation.cumulativeDistance", "cumulative path distance is outside the finite numeric range");
      cumulative = nextCumulative;
    }
    return { dimensions: [...dimensions], delta, stepDistance, cumulativeDistance: continuous ? cumulative : null };
  });
}

function analyzeNormalizedSeries(series: NormalizedSeries): TrajectoryPathStatistics {
  const participantPeriods = reduceParticipantPeriods(series);
  const periods = series.timeOrder.map((time, index) => {
    const rawRows = series.points.filter((point) => point.time.canonical === time.canonical);
    const allParticipantPeriods = participantPeriods.filter((point) => point.time.canonical === time.canonical);
    const used = allParticipantPeriods.filter((point) => point.includedInCohort);
    const fullCentroid = participantCentroid(used, (point) => point.fullCoordinates, series.dimensions.length, series.estimand);
    const selectedCentroid = fullCentroid === null ? null : series.selectedIndexes.map((selected) => fullCentroid[selected]!) as [number, number, number];
    return {
      index,
      time,
      selectedCentroid,
      fullCentroid,
      nRows: rawRows.length,
      nTotal: allParticipantPeriods.length,
      nUsed: used.length,
      nDuplicateRows: rawRows.length - allParticipantPeriods.length,
      nCohortExcluded: allParticipantPeriods.length - used.length
    };
  });
  const selectedMetrics = distanceMetrics(periods.map((period) => period.selectedCentroid), series.selectedDimensions);
  const fullMetrics = distanceMetrics(periods.map((period) => period.fullCentroid), series.dimensions);
  const outputPeriods: TrajectoryPathPeriodStatistics[] = periods.map((period, index) => ({
    ...period,
    selected3d: selectedMetrics[index]!,
    fullSpace: fullMetrics[index]!
  }));
  const participantCount = new Set(participantPeriods.map((point) => point.participant.canonical)).size;
  const duplicateRows = outputPeriods.reduce((sum, period) => sum + period.nDuplicateRows, 0);
  const diagnostics: TrajectoryStatisticsDiagnostic[] = [];
  if (duplicateRows > 0) diagnostics.push({ code: "DUPLICATE_PARTICIPANT_PERIOD_ROWS", severity: "info", message: "Duplicate rows were averaged before centroid calculation." });
  if (outputPeriods.some((period) => period.nUsed === 0)) diagnostics.push({ code: "MISSING_TRAJECTORY_PERIOD", severity: "warning", message: "At least one requested period has no usable centroid; paths do not bridge gaps." });
  if (series.input.cohortPolicy === "available") {
    const signatures = outputPeriods.map((period) => participantPeriods.filter((point) => point.includedInCohort && point.time.canonical === period.time.canonical).map((point) => point.participant.canonical).sort().join("\u0000"));
    if (new Set(signatures).size > 1) diagnostics.push({ code: "CHANGING_AVAILABLE_COHORT", severity: "warning", message: "Participant composition changes across requested periods." });
  }
  return deepFreeze({
    schemaVersion: "3dena.trajectory-path-statistics.v1",
    namespace: series.namespace,
    cohortPolicy: series.input.cohortPolicy,
    estimand: series.estimand,
    dimensions: [...series.dimensions],
    selectedDimensions: [...series.selectedDimensions],
    distanceSemantics: {
      selected3d: "euclidean-selected-three-dimensions",
      fullSpace: "euclidean-all-declared-dimensions"
    },
    participantPeriods,
    periods: outputPeriods,
    diagnostics,
    summary: {
      inputRows: series.points.length,
      participants: participantCount,
      participantPeriods: participantPeriods.length,
      periods: series.timeOrder.length,
      duplicateRows
    },
    resolvedLimits: { ...series.limits }
  });
}

export function analyzeTrajectoryPath(input: TrajectorySeriesInput): TrajectoryPathStatistics {
  return analyzeNormalizedSeries(normalizeSeries(input));
}

function assertComparable(left: NormalizedSeries, right: NormalizedSeries): void {
  if (JSON.stringify(left.dimensions) !== JSON.stringify(right.dimensions)) reject("INCOMPATIBLE_TRAJECTORY_DIMENSIONS", "input.sideB.series.dimensions", "must exactly match side A order");
  if (JSON.stringify(left.selectedDimensions) !== JSON.stringify(right.selectedDimensions)) reject("INCOMPATIBLE_SELECTED_DIMENSIONS", "input.sideB.series.selectedDimensions", "must exactly match side A");
  if (JSON.stringify(left.timeOrder.map((time) => time.canonical)) !== JSON.stringify(right.timeOrder.map((time) => time.canonical))) reject("INCOMPATIBLE_TRAJECTORY_TIME", "input.sideB.series.timeOrder", "must exactly match side A typed order");
  if (left.input.cohortPolicy !== right.input.cohortPolicy) reject("INCOMPATIBLE_COHORT_POLICY", "input.sideB.series.cohortPolicy", "must match side A");
  if (left.estimand !== right.estimand) reject("INCOMPATIBLE_TRAJECTORY_ESTIMAND", "input.sideB.series.estimand", "must match side A");
}

function pairedIdNames(pairedId: string | string[], path: string): string[] {
  const names = typeof pairedId === "string" ? [pairedId] : pairedId;
  if (!Array.isArray(names) || names.length === 0 || names.some((name) => typeof name !== "string" || name.trim() === "")) {
    reject("INVALID_PAIRED_ID", path, "must be a non-empty component name or non-empty component-name tuple");
  }
  if (new Set(names).size !== names.length) reject("INVALID_PAIRED_ID", path, "component-name tuple must not contain duplicates");
  return [...names];
}

function pairingToken(participant: TrajectoryKey, pairedId: string | string[], path: string): string {
  const names = pairedIdNames(pairedId, "input.pairedId");
  return JSON.stringify(names.map((name) => {
    const matches = participant.components.filter((component) => component.name === name);
    if (matches.length !== 1) reject("MISSING_PAIRED_ID", path, `participant identity must contain exactly one ${JSON.stringify(name)} component`);
    return [name, scalarToken(matches[0]!, `${path}.${name}`)];
  }));
}

interface ComparisonData {
  left: NormalizedSeries;
  right: NormalizedSeries;
  pathA: TrajectoryPathStatistics;
  pathB: TrajectoryPathStatistics;
  unitOrder: string[];
  sideACount: number | null;
  pairedMaps?: Array<Map<string, [TrajectoryParticipantPeriod, TrajectoryParticipantPeriod]>>;
  independentUnits?: Array<{ key: string; periods: TrajectoryParticipantPeriod[] }>;
}

function buildComparisonData(input: TrajectoryComparisonInput): ComparisonData {
  if (!input || (input.design !== "paired" && input.design !== "independent")) reject("INVALID_COMPARISON_DESIGN", "input.design", "must be paired or independent");
  if (typeof input.sideA?.label !== "string" || input.sideA.label.trim() === "" || typeof input.sideB?.label !== "string" || input.sideB.label.trim() === "") reject("INVALID_COMPARISON_LABEL", "input.sideA.label", "both sides require non-empty labels");
  const left = normalizeSeries(input.sideA.series);
  const right = normalizeSeries(input.sideB.series);
  assertComparable(left, right);
  const pathA = analyzeNormalizedSeries(left);
  const pathB = analyzeNormalizedSeries(right);
  if (input.design === "paired") {
    pairedIdNames(input.pairedId, "input.pairedId");
    const maps: Array<Map<string, [TrajectoryParticipantPeriod, TrajectoryParticipantPeriod]>> = [];
    const allPairs = new Set<string>();
    for (let timeIndex = 0; timeIndex < left.timeOrder.length; timeIndex += 1) {
      const time = left.timeOrder[timeIndex]!;
      const aRows = pathA.participantPeriods.filter((row) => row.time.canonical === time.canonical);
      const bRows = pathB.participantPeriods.filter((row) => row.time.canonical === time.canonical);
      const a = new Map<string, TrajectoryParticipantPeriod>();
      const b = new Map<string, TrajectoryParticipantPeriod>();
      for (const row of aRows) {
        const pair = pairingToken(row.participant, input.pairedId, `input.sideA.series.participantPeriods[${row.index}]`);
        if (a.has(pair)) reject("DUPLICATE_PAIRED_ID_TIME", `input.sideA.series`, "more than one participant has the paired ID at one time");
        a.set(pair, row);
      }
      for (const row of bRows) {
        const pair = pairingToken(row.participant, input.pairedId, `input.sideB.series.participantPeriods[${row.index}]`);
        if (b.has(pair)) reject("DUPLICATE_PAIRED_ID_TIME", `input.sideB.series`, "more than one participant has the paired ID at one time");
        b.set(pair, row);
      }
      const aKeys = [...a.keys()].sort();
      const bKeys = [...b.keys()].sort();
      if (JSON.stringify(aKeys) !== JSON.stringify(bKeys)) reject("UNMATCHED_PAIRED_ID_TIME", `input.timeOrder[${timeIndex}]`, "paired sides must contain exactly the same paired IDs at every observed slice");
      const matched = new Map<string, [TrajectoryParticipantPeriod, TrajectoryParticipantPeriod]>();
      for (const key of aKeys) {
        matched.set(key, [a.get(key)!, b.get(key)!]);
        allPairs.add(key);
      }
      maps.push(matched);
    }
    const eligiblePairs = [...allPairs].filter((pair) =>
      left.input.cohortPolicy === "available" || maps.every((map) => {
        const matched = map.get(pair);
        return matched !== undefined && matched[0].includedInCohort && matched[1].includedInCohort;
      })
    );
    return { left, right, pathA, pathB, unitOrder: eligiblePairs.sort(), sideACount: null, pairedMaps: maps };
  }
  if (left.namespace === right.namespace) reject("INDEPENDENT_NAMESPACE_COLLISION", "input.sideB.series.namespace", "independent sides must use distinct namespaces");
  const sideAUnits = groupParticipantPeriods(pathA.participantPeriods, left.namespace);
  const sideBUnits = groupParticipantPeriods(pathB.participantPeriods, right.namespace);
  const units = [...sideAUnits, ...sideBUnits].sort((a, b) => compareCanonical(a.key, b.key));
  return {
    left,
    right,
    pathA,
    pathB,
    unitOrder: units.map((unit) => unit.key),
    sideACount: sideAUnits.length,
    independentUnits: units
  };
}

function groupParticipantPeriods(rows: TrajectoryParticipantPeriod[], namespace: string): Array<{ key: string; periods: TrajectoryParticipantPeriod[] }> {
  const groups = new Map<string, TrajectoryParticipantPeriod[]>();
  for (const row of rows.filter((entry) => entry.includedInCohort)) {
    const key = JSON.stringify([namespace, row.participant.canonical]);
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }
  return [...groups.entries()].map(([key, periods]) => ({ key, periods }));
}

export function getTrajectoryPermutationUnits(input: TrajectoryComparisonInput): TrajectoryPermutationUnits {
  const data = buildComparisonData(input);
  return { design: input.design, unitOrder: [...data.unitOrder], sideACount: data.sideACount };
}

interface CentroidPairRow {
  time: TrajectoryKey;
  selectedA: number[] | null;
  selectedB: number[] | null;
  fullA: number[] | null;
  fullB: number[] | null;
  nA: number;
  nB: number;
  nMatched: number | null;
}

function baseCentroidRows(data: ComparisonData, design: "paired" | "independent"): CentroidPairRow[] {
  if (design === "paired") {
    return data.left.timeOrder.map((time, timeIndex) => {
      const entries = [...data.pairedMaps![timeIndex]!.values()];
      // The caller-facing paired path already applied complete cohorts. With
      // exact per-time set equality, intersection by inclusion is sufficient.
      const accepted = entries.filter(([a, b]) => a.includedInCohort && b.includedInCohort);
      return {
        time,
        selectedA: participantCentroid(accepted.map(([a]) => a), (row) => row.selectedCoordinates, 3, data.left.estimand),
        selectedB: participantCentroid(accepted.map(([, b]) => b), (row) => row.selectedCoordinates, 3, data.right.estimand),
        fullA: participantCentroid(accepted.map(([a]) => a), (row) => row.fullCoordinates, data.left.dimensions.length, data.left.estimand),
        fullB: participantCentroid(accepted.map(([, b]) => b), (row) => row.fullCoordinates, data.left.dimensions.length, data.right.estimand),
        nA: accepted.length,
        nB: accepted.length,
        nMatched: accepted.length
      };
    });
  }
  return data.left.timeOrder.map((time) => {
    const a = data.pathA.participantPeriods.filter((row) => row.includedInCohort && row.time.canonical === time.canonical);
    const b = data.pathB.participantPeriods.filter((row) => row.includedInCohort && row.time.canonical === time.canonical);
    return {
      time,
      selectedA: participantCentroid(a, (row) => row.selectedCoordinates, 3, data.left.estimand),
      selectedB: participantCentroid(b, (row) => row.selectedCoordinates, 3, data.right.estimand),
      fullA: participantCentroid(a, (row) => row.fullCoordinates, data.left.dimensions.length, data.left.estimand),
      fullB: participantCentroid(b, (row) => row.fullCoordinates, data.left.dimensions.length, data.right.estimand),
      nA: a.length,
      nB: b.length,
      nMatched: null
    };
  });
}

function comparisonPeriods(rows: CentroidPairRow[]): TrajectoryComparisonPeriod[] {
  const selectedStepA = distanceMetrics(rows.map((row) => row.selectedA), ["x", "y", "z"]);
  const selectedStepB = distanceMetrics(rows.map((row) => row.selectedB), ["x", "y", "z"]);
  const fullStepA = distanceMetrics(rows.map((row) => row.fullA), []);
  const fullStepB = distanceMetrics(rows.map((row) => row.fullB), []);
  return rows.map((row, index) => {
    const selectedDifference = row.selectedA && row.selectedB ? subtract(row.selectedB, row.selectedA) as [number, number, number] : null;
    const fullDifference = row.fullA && row.fullB ? subtract(row.fullB, row.fullA) : null;
    const selectedA = selectedStepA[index]!.stepDistance;
    const selectedB = selectedStepB[index]!.stepDistance;
    const selectedCumulativeA = selectedStepA[index]!.cumulativeDistance;
    const selectedCumulativeB = selectedStepB[index]!.cumulativeDistance;
    const fullA = fullStepA[index]!.stepDistance;
    const fullB = fullStepB[index]!.stepDistance;
    const fullCumulativeA = fullStepA[index]!.cumulativeDistance;
    const fullCumulativeB = fullStepB[index]!.cumulativeDistance;
    return {
      index,
      time: row.time,
      selectedCentroidA: row.selectedA as [number, number, number] | null,
      selectedCentroidB: row.selectedB as [number, number, number] | null,
      selectedDifference,
      fullCentroidA: row.fullA,
      fullCentroidB: row.fullB,
      fullDifference,
      selectedCentroidSeparation: selectedDifference ? euclidean(selectedDifference) : null,
      fullCentroidSeparation: fullDifference ? euclidean(fullDifference) : null,
      selectedStepDistanceA: selectedA,
      selectedStepDistanceB: selectedB,
      selectedStepDistanceDifference: selectedA !== null && selectedB !== null ? scalarDifference(selectedB, selectedA, `comparison.periods[${index}].selectedStepDistanceDifference`) : null,
      selectedCumulativeDistanceA: selectedCumulativeA,
      selectedCumulativeDistanceB: selectedCumulativeB,
      selectedCumulativeDistanceDifference: selectedCumulativeA !== null && selectedCumulativeB !== null ? scalarDifference(selectedCumulativeB, selectedCumulativeA, `comparison.periods[${index}].selectedCumulativeDistanceDifference`) : null,
      fullStepDistanceA: fullA,
      fullStepDistanceB: fullB,
      fullStepDistanceDifference: fullA !== null && fullB !== null ? scalarDifference(fullB, fullA, `comparison.periods[${index}].fullStepDistanceDifference`) : null,
      fullCumulativeDistanceA: fullCumulativeA,
      fullCumulativeDistanceB: fullCumulativeB,
      fullCumulativeDistanceDifference: fullCumulativeA !== null && fullCumulativeB !== null ? scalarDifference(fullCumulativeB, fullCumulativeA, `comparison.periods[${index}].fullCumulativeDistanceDifference`) : null,
      nAUsed: row.nA,
      nBUsed: row.nB,
      nMatched: row.nMatched
    };
  });
}

interface MetricDescriptor {
  id: string;
  timeIndex: number;
  metric: string;
  distanceSpace: "selected-3d" | "full-space" | null;
  tail: "two-sided" | "upper";
  observed: number;
}

function metricDescriptors(periods: TrajectoryComparisonPeriod[], selectedDimensions: [string, string, string]): MetricDescriptor[] {
  const output: MetricDescriptor[] = [];
  for (const period of periods) {
    period.selectedDifference?.forEach((value, dimensionIndex) => output.push({
      id: `t${period.index}:coordinate:${selectedDimensions[dimensionIndex]}`,
      timeIndex: period.index,
      metric: `coordinate:${selectedDimensions[dimensionIndex]}`,
      distanceSpace: null,
      tail: "two-sided",
      observed: value
    }));
    if (period.selectedCentroidSeparation !== null) output.push({ id: `t${period.index}:centroid-separation:selected`, timeIndex: period.index, metric: "centroid-separation", distanceSpace: "selected-3d", tail: "upper", observed: period.selectedCentroidSeparation });
    if (period.fullCentroidSeparation !== null) output.push({ id: `t${period.index}:centroid-separation:full`, timeIndex: period.index, metric: "centroid-separation", distanceSpace: "full-space", tail: "upper", observed: period.fullCentroidSeparation });
    if (period.index > 0 && period.selectedStepDistanceDifference !== null) output.push({ id: `t${period.index}:step-distance:selected`, timeIndex: period.index, metric: "step-distance-difference", distanceSpace: "selected-3d", tail: "two-sided", observed: period.selectedStepDistanceDifference });
    if (period.index > 0 && period.fullStepDistanceDifference !== null) output.push({ id: `t${period.index}:step-distance:full`, timeIndex: period.index, metric: "step-distance-difference", distanceSpace: "full-space", tail: "two-sided", observed: period.fullStepDistanceDifference });
    if (period.index > 0 && period.selectedCumulativeDistanceDifference !== null) output.push({ id: `t${period.index}:cumulative-distance:selected`, timeIndex: period.index, metric: "cumulative-distance-difference", distanceSpace: "selected-3d", tail: "two-sided", observed: period.selectedCumulativeDistanceDifference });
    if (period.index > 0 && period.fullCumulativeDistanceDifference !== null) output.push({ id: `t${period.index}:cumulative-distance:full`, timeIndex: period.index, metric: "cumulative-distance-difference", distanceSpace: "full-space", tail: "two-sided", observed: period.fullCumulativeDistanceDifference });
  }
  return output;
}

function metricMap(periods: TrajectoryComparisonPeriod[], selectedDimensions: [string, string, string]): Map<string, number> {
  return new Map(metricDescriptors(periods, selectedDimensions).map((metric) => [metric.id, metric.observed]));
}

function validateUnitOrder(actual: string[], expected: string[], path: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) reject("PERMUTATION_UNIT_ORDER_MISMATCH", path, "must exactly match getTrajectoryPermutationUnits()");
}

function validateIndexList(indexes: number[], size: number, path: string, requirePermutation: boolean): void {
  if (!Array.isArray(indexes) || indexes.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= size)) reject("INVALID_PERMUTATION_INDEX", path, `indexes must be safe integers in [0, ${size})`);
  if (new Set(indexes).size !== indexes.length) reject("DUPLICATE_PERMUTATION_INDEX", path, "must not repeat indexes");
  if (requirePermutation && indexes.length !== size) reject("INCOMPLETE_PERMUTATION", path, "must contain every unit index exactly once");
}

function permutedCentroidRows(data: ComparisonData, input: TrajectoryComparisonInput, replicate: number[]): CentroidPairRow[] {
  if (input.design === "paired") {
    const swaps = new Set(replicate);
    return data.left.timeOrder.map((time, timeIndex) => {
      const entries = [...data.pairedMaps![timeIndex]!.entries()].filter(([, [a, b]]) => a.includedInCohort && b.includedInCohort);
      const aRows: TrajectoryParticipantPeriod[] = [];
      const bRows: TrajectoryParticipantPeriod[] = [];
      for (const [pair, [a, b]] of entries) {
        const swap = swaps.has(data.unitOrder.indexOf(pair));
        aRows.push(swap ? b : a);
        bRows.push(swap ? a : b);
      }
      return {
        time,
        selectedA: participantCentroid(aRows, (row) => row.selectedCoordinates, 3, data.left.estimand),
        selectedB: participantCentroid(bRows, (row) => row.selectedCoordinates, 3, data.right.estimand),
        fullA: participantCentroid(aRows, (row) => row.fullCoordinates, data.left.dimensions.length, data.left.estimand),
        fullB: participantCentroid(bRows, (row) => row.fullCoordinates, data.left.dimensions.length, data.right.estimand),
        nA: entries.length,
        nB: entries.length,
        nMatched: entries.length,
      };
    });
  }
  const aIndexes = new Set(replicate.slice(0, data.sideACount!));
  const sideA = data.independentUnits!.filter((_, index) => aIndexes.has(index)).flatMap((unit) => unit.periods);
  const sideB = data.independentUnits!.filter((_, index) => !aIndexes.has(index)).flatMap((unit) => unit.periods);
  return data.left.timeOrder.map((time) => {
    const a = sideA.filter((row) => row.time.canonical === time.canonical);
    const b = sideB.filter((row) => row.time.canonical === time.canonical);
    return {
      time,
      selectedA: participantCentroid(a, (row) => row.selectedCoordinates, 3, data.left.estimand),
      selectedB: participantCentroid(b, (row) => row.selectedCoordinates, 3, data.right.estimand),
      fullA: participantCentroid(a, (row) => row.fullCoordinates, data.left.dimensions.length, data.left.estimand),
      fullB: participantCentroid(b, (row) => row.fullCoordinates, data.left.dimensions.length, data.right.estimand),
      nA: a.length,
      nB: b.length,
      nMatched: null,
    };
  });
}

export function holmAdjust(pValues: number[]): number[] {
  pValues.forEach((value, index) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) reject("INVALID_P_VALUE", `pValues[${index}]`, "must be finite in [0, 1]");
  });
  const ordered = pValues.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value || a.index - b.index);
  const adjusted = Array.from({ length: pValues.length }, () => 0);
  let running = 0;
  ordered.forEach((entry, rank) => {
    running = Math.max(running, Math.min(1, entry.value * (pValues.length - rank)));
    adjusted[entry.index] = running;
  });
  return adjusted;
}

function permutationTests(data: ComparisonData, input: TrajectoryComparisonInput, observedPeriods: TrajectoryComparisonPeriod[]): TrajectoryPermutationTest[] {
  const plan = input.permutationPlan;
  if (!plan) return [];
  validateUnitOrder(plan.unitOrder, data.unitOrder, "input.permutationPlan.unitOrder");
  const limit = Math.min(data.left.limits.maxResamples, data.right.limits.maxResamples);
  if (!Array.isArray(plan.replicates) || plan.replicates.length === 0 || plan.replicates.length > limit) reject("INVALID_PERMUTATION_PLAN", "input.permutationPlan.replicates", `must contain 1..${limit} replicates`);
  if (input.design === "paired" && plan.kind !== "paired-swap-indices-v1") reject("PERMUTATION_DESIGN_MISMATCH", "input.permutationPlan.kind", "paired comparison requires paired-swap-indices-v1");
  if (input.design === "independent" && plan.kind !== "independent-pool-indices-v1") reject("PERMUTATION_DESIGN_MISMATCH", "input.permutationPlan.kind", "independent comparison requires independent-pool-indices-v1");
  plan.replicates.forEach((replicate, index) => validateIndexList(replicate, data.unitOrder.length, `input.permutationPlan.replicates[${index}]`, input.design === "independent"));
  const observed = metricDescriptors(observedPeriods, data.left.selectedDimensions);
  if (observed.length > Math.min(data.left.limits.maxTests, data.right.limits.maxTests)) reject("TRAJECTORY_TEST_LIMIT", "comparison.tests", "exceeds configured maxTests");
  const values = observed.map(() => [] as number[]);
  for (const replicate of plan.replicates) {
    const map = metricMap(comparisonPeriods(permutedCentroidRows(data, input, replicate)), data.left.selectedDimensions);
    observed.forEach((metric, index) => {
      const value = map.get(metric.id);
      if (value !== undefined && Number.isFinite(value)) values[index]!.push(value);
    });
  }
  const raw = observed.map((metric, index) => {
    const permutations = values[index]!;
    const exceedances = permutations.filter((value) => metric.tail === "upper" ? value >= metric.observed : Math.abs(value) >= Math.abs(metric.observed)).length;
    return (1 + exceedances) / (1 + permutations.length);
  });
  const adjusted = holmAdjust(raw);
  return observed.map((metric, index) => ({
    ...metric,
    pValue: raw[index]!,
    holmAdjustedPValue: adjusted[index]!,
    permutationCount: values[index]!.length
  }));
}

export function compareTrajectoryPaths(input: TrajectoryComparisonInput): TrajectoryComparisonResult {
  const data = buildComparisonData(input);
  const rows = baseCentroidRows(data, input.design);
  const periods = comparisonPeriods(rows);
  const tests = permutationTests(data, input, periods);
  const diagnostics: TrajectoryStatisticsDiagnostic[] = [];
  if (periods.some((period) => period.nAUsed < 2 || period.nBUsed < 2)) diagnostics.push({ code: "DEGENERATE_COMPARISON_GROUP", severity: "warning", message: "At least one comparison slice has fewer than two participant clusters." });
  if (!input.permutationPlan) diagnostics.push({ code: "PERMUTATION_NOT_REQUESTED", severity: "info", message: "No p-values were computed because no caller-bound permutation plan was supplied." });
  return deepFreeze({
    schemaVersion: "3dena.trajectory-comparison.v1",
    design: input.design,
    direction: "B-minus-A",
    pairedId: input.design === "paired"
      ? (Array.isArray(input.pairedId) ? [...input.pairedId] : input.pairedId)
      : null,
    sideA: data.pathA,
    sideB: data.pathB,
    periods,
    tests,
    permutation: {
      status: input.permutationPlan ? "complete" : "not-requested",
      planKind: input.permutationPlan?.kind ?? null,
      unitOrder: [...data.unitOrder],
      replicateCount: input.permutationPlan?.replicates.length ?? 0,
      rngParityClaim: false
    },
    diagnostics
  });
}

interface BootstrapHistory {
  key: string;
  participant: TrajectoryKey;
  stratum: TrajectoryKey;
  points: NormalizedSeries["points"];
}

interface BootstrapContext {
  series: NormalizedSeries;
  base: TrajectoryPathStatistics;
  histories: BootstrapHistory[];
  units: TrajectoryBootstrapUnits;
}

const BOOTSTRAP_DRAW_COMPONENT = "@3dena/bootstrap-draw-v1";

function allStratum(): TrajectoryKey {
  return normalizeIdentity(
    { components: [{ name: "@3dena/bootstrap-stratum", type: "string", value: "all" }] },
    "bootstrap.stratum"
  );
}

function buildBootstrapContext(input: GetTrajectoryBootstrapUnitsInput): BootstrapContext {
  if (input.stratifyBy !== "none" && input.stratifyBy !== "explicit") {
    reject("INVALID_BOOTSTRAP_STRATIFICATION", "input.stratifyBy", "must be none or explicit");
  }
  const series = normalizeSeries(input.series);
  const base = analyzeNormalizedSeries(series);
  const eligible = new Set(base.participantPeriods.filter((row) => row.includedInCohort).map((row) => row.participant.canonical));
  const grouped = new Map<string, NormalizedSeries["points"]>();
  for (const point of series.points) {
    if (!eligible.has(point.participant.canonical)) continue;
    if (point.participant.components.some((component) => component.name === BOOTSTRAP_DRAW_COMPONENT)) {
      reject("RESERVED_BOOTSTRAP_IDENTITY", `input.series.points[${point.rowIndex}].participant`, `must not contain ${BOOTSTRAP_DRAW_COMPONENT}`);
    }
    const current = grouped.get(point.participant.canonical) ?? [];
    current.push(point);
    grouped.set(point.participant.canonical, current);
  }
  const histories: BootstrapHistory[] = [...grouped.entries()].map(([participantCanonical, points]) => {
    const participant = points[0]!.participant;
    let stratum = allStratum();
    if (input.stratifyBy === "explicit") {
      if (points.some((point) => point.stratum === undefined)) {
        reject("MISSING_BOOTSTRAP_STRATUM", `input.series.participant.${participant.display}`, "every eligible participant row requires an explicit stratum");
      }
      const strata = new Map(points.map((point) => [point.stratum!.canonical, point.stratum!]));
      if (strata.size !== 1) {
        reject("UNSTABLE_BOOTSTRAP_STRATUM", `input.series.participant.${participant.display}`, "stratum must remain constant across the complete participant history");
      }
      stratum = [...strata.values()][0]!;
    }
    return {
      key: JSON.stringify([series.namespace, participantCanonical]),
      participant,
      stratum,
      points: [...points].sort((left, right) => left.rowIndex - right.rowIndex)
    };
  }).sort((left, right) => compareCanonical(left.key, right.key));
  if (histories.length === 0) reject("EMPTY_BOOTSTRAP_POOL", "input.series", "cohort policy leaves no eligible participant histories");
  const stratumMap = new Map<string, { key: TrajectoryKey; unitIndexes: number[] }>();
  histories.forEach((history, index) => {
    const current = stratumMap.get(history.stratum.canonical) ?? { key: history.stratum, unitIndexes: [] };
    current.unitIndexes.push(index);
    stratumMap.set(history.stratum.canonical, current);
  });
  const strata = [...stratumMap.values()].sort((left, right) => compareCanonical(left.key.canonical, right.key.canonical));
  const units: TrajectoryBootstrapUnits = {
    schemaVersion: "3dena.trajectory-bootstrap-units.v1",
    unitOrder: histories.map((history) => history.key),
    strata: strata.map((stratum) => ({ key: stratum.key, unitIndexes: [...stratum.unitIndexes] })),
    cohortPolicy: input.series.cohortPolicy,
    stratifyBy: input.stratifyBy
  };
  return { series, base, histories, units: deepFreeze(units) };
}

export function getTrajectoryBootstrapUnits(input: GetTrajectoryBootstrapUnitsInput): TrajectoryBootstrapUnits {
  return buildBootstrapContext(input).units;
}

function validateBootstrapUnits(units: TrajectoryBootstrapUnits): void {
  if (!units || units.schemaVersion !== "3dena.trajectory-bootstrap-units.v1" || !Array.isArray(units.unitOrder) || units.unitOrder.length === 0) {
    reject("INVALID_BOOTSTRAP_UNITS", "input.units", "must come from getTrajectoryBootstrapUnits()");
  }
  if (new Set(units.unitOrder).size !== units.unitOrder.length) reject("DUPLICATE_BOOTSTRAP_UNIT", "input.units.unitOrder", "must contain unique units");
  const strata = new Set<string>();
  const indexes = new Set<number>();
  for (const [stratumIndex, stratum] of units.strata.entries()) {
    if (strata.has(stratum.key.canonical)) reject("DUPLICATE_BOOTSTRAP_STRATUM", `input.units.strata[${stratumIndex}]`, "duplicates a stratum key");
    strata.add(stratum.key.canonical);
    if (stratum.unitIndexes.length === 0) reject("EMPTY_BOOTSTRAP_STRATUM", `input.units.strata[${stratumIndex}]`, "must contain at least one unit");
    for (const index of stratum.unitIndexes) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= units.unitOrder.length) reject("INVALID_BOOTSTRAP_INDEX", `input.units.strata[${stratumIndex}].unitIndexes`, "contains an out-of-range index");
      if (indexes.has(index)) reject("DUPLICATE_BOOTSTRAP_UNIT", `input.units.strata[${stratumIndex}].unitIndexes`, "a unit may belong to only one stratum");
      indexes.add(index);
    }
  }
  if (indexes.size !== units.unitOrder.length) reject("MISSING_BOOTSTRAP_UNIT", "input.units.strata", "strata must partition every unit exactly once");
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

export function createSeededTrajectoryBootstrapPlan(
  input: CreateSeededTrajectoryBootstrapPlanInput
): TrajectoryBootstrapPlan {
  validateBootstrapUnits(input.units);
  const limits = resolveLimits(input.limits);
  if (!Number.isSafeInteger(input.repetitions) || input.repetitions < 1 || input.repetitions > limits.maxResamples) {
    reject("BOOTSTRAP_RESAMPLE_LIMIT", "input.repetitions", `must be a safe integer in [1, ${limits.maxResamples}]`);
  }
  if (!Number.isSafeInteger(input.seed) || input.seed < 0 || input.seed > 0xffff_ffff) {
    reject("INVALID_BOOTSTRAP_SEED", "input.seed", "must be an unsigned 32-bit integer");
  }
  const planCells = input.repetitions * input.units.unitOrder.length;
  if (!Number.isSafeInteger(planCells) || planCells > limits.maxCells) {
    reject("BOOTSTRAP_CELL_LIMIT", "input.repetitions", `plan indexes exceed maxCells=${limits.maxCells}`);
  }
  const random = mulberry32(input.seed);
  return deepFreeze({
    kind: "participant-history-resample-indices-v1",
    unitOrder: [...input.units.unitOrder],
    strata: input.units.strata.map((stratum) => ({
      key: stratum.key,
      unitIndexes: [...stratum.unitIndexes],
      replicates: Array.from({ length: input.repetitions }, () =>
        Array.from({ length: stratum.unitIndexes.length }, () =>
          stratum.unitIndexes[Math.floor(random() * stratum.unitIndexes.length)]!
        )
      )
    })),
    generation: {
      kind: "seeded",
      algorithm: "mulberry32-uint32-v1",
      seed: input.seed,
      unitSort: "utf16-code-unit-ascending",
      randomEndpoint: "zero-inclusive-one-exclusive"
    }
  });
}

interface ValidatedBootstrapPlan {
  repetitions: number;
  generation: TrajectoryBootstrapPlan["generation"];
}

function validateBootstrapPlan(
  plan: TrajectoryBootstrapPlan,
  context: BootstrapContext
): ValidatedBootstrapPlan {
  if (!plan || plan.kind !== "participant-history-resample-indices-v1") reject("INVALID_BOOTSTRAP_PLAN", "input.plan.kind", "must be participant-history-resample-indices-v1");
  if (JSON.stringify(plan.unitOrder) !== JSON.stringify(context.units.unitOrder)) {
    reject("BOOTSTRAP_UNIT_ORDER_MISMATCH", "input.plan.unitOrder", "must exactly match getTrajectoryBootstrapUnits()");
  }
  const seenStrata = new Set<string>();
  if (!Array.isArray(plan.strata) || plan.strata.length !== context.units.strata.length) reject("BOOTSTRAP_STRATA_MISMATCH", "input.plan.strata", "must exactly match the resolved strata");
  let repetitions: number | undefined;
  let planIndexCells = 0;
  plan.strata.forEach((stratum, stratumIndex) => {
    if (seenStrata.has(stratum.key.canonical)) reject("DUPLICATE_BOOTSTRAP_STRATUM", `input.plan.strata[${stratumIndex}]`, "duplicates a stratum key");
    seenStrata.add(stratum.key.canonical);
    const expected = context.units.strata[stratumIndex]!;
    if (stratum.key.canonical !== expected.key.canonical || JSON.stringify(stratum.unitIndexes) !== JSON.stringify(expected.unitIndexes)) {
      reject("BOOTSTRAP_STRATA_MISMATCH", `input.plan.strata[${stratumIndex}]`, "key and unitIndexes must exactly match getTrajectoryBootstrapUnits()");
    }
    if (!Array.isArray(stratum.replicates) || stratum.replicates.length === 0) reject("INVALID_BOOTSTRAP_PLAN", `input.plan.strata[${stratumIndex}].replicates`, "must be non-empty");
    if (repetitions === undefined) repetitions = stratum.replicates.length;
    if (stratum.replicates.length !== repetitions) reject("BOOTSTRAP_REPLICATE_MISMATCH", `input.plan.strata[${stratumIndex}].replicates`, "every stratum must have the same replicate count");
    const allowed = new Set(expected.unitIndexes);
    stratum.replicates.forEach((draw, replicateIndex) => {
      if (!Array.isArray(draw) || draw.length !== expected.unitIndexes.length) reject("BOOTSTRAP_SAMPLE_SIZE_MISMATCH", `input.plan.strata[${stratumIndex}].replicates[${replicateIndex}]`, "must preserve the original stratum sample size");
      draw.forEach((index, drawIndex) => {
        if (!Number.isSafeInteger(index) || !allowed.has(index)) reject("INVALID_BOOTSTRAP_INDEX", `input.plan.strata[${stratumIndex}].replicates[${replicateIndex}][${drawIndex}]`, "must reference a unit inside the same stratum");
      });
      planIndexCells += draw.length;
      if (!Number.isSafeInteger(planIndexCells)) reject("BOOTSTRAP_OVERFLOW", "input.plan", "index cell count overflowed safe integer arithmetic");
    });
  });
  const count = repetitions ?? 0;
  if (count > context.series.limits.maxResamples) reject("BOOTSTRAP_RESAMPLE_LIMIT", "input.plan", `exceeds maxResamples=${context.series.limits.maxResamples}`);
  if (planIndexCells > context.series.limits.maxCells) reject("BOOTSTRAP_CELL_LIMIT", "input.plan", `plan indexes exceed maxCells=${context.series.limits.maxCells}`);
  if (!plan.generation || typeof plan.generation !== "object") {
    reject("INVALID_BOOTSTRAP_GENERATION", "input.plan.generation", "must identify caller-provided or seeded plan custody");
  }
  if (plan.generation.kind === "caller-provided") {
    return { repetitions: count, generation: { kind: "caller-provided" } };
  }
  if (
    plan.generation.kind !== "seeded"
    || plan.generation.algorithm !== "mulberry32-uint32-v1"
    || plan.generation.unitSort !== "utf16-code-unit-ascending"
    || plan.generation.randomEndpoint !== "zero-inclusive-one-exclusive"
    || !Number.isSafeInteger(plan.generation.seed)
    || plan.generation.seed < 0
    || plan.generation.seed > 0xffff_ffff
  ) {
    reject("INVALID_BOOTSTRAP_GENERATION", "input.plan.generation", "seeded custody must use the frozen v1 algorithm, sort, endpoint, and uint32 seed");
  }
  const expected = createSeededTrajectoryBootstrapPlan({
    units: context.units,
    repetitions: count,
    seed: plan.generation.seed,
    limits: context.series.limits
  });
  const suppliedDraws = plan.strata.map((stratum) => stratum.replicates);
  const expectedDraws = expected.strata.map((stratum) => stratum.replicates);
  if (JSON.stringify(suppliedDraws) !== JSON.stringify(expectedDraws)) {
    reject("SEEDED_BOOTSTRAP_PLAN_MISMATCH", "input.plan.strata", "draws do not match the declared frozen algorithm and seed; mark an exact custom plan caller-provided instead");
  }
  return { repetitions: count, generation: { ...expected.generation } };
}

export function trajectoryPercentile(values: number[], probability: number): number {
  if (!Array.isArray(values) || values.length === 0) reject("EMPTY_BOOTSTRAP_VALUES", "values", "must contain at least one finite number");
  if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) reject("INVALID_BOOTSTRAP_PROBABILITY", "probability", "must be finite in [0, 1]");
  const ordered = values.map((value, index) => {
    if (typeof value !== "number" || !Number.isFinite(value)) reject("NON_FINITE_BOOTSTRAP_VALUE", `values[${index}]`, "must be finite");
    return value;
  }).sort((left, right) => left - right);
  if (probability === 0) return ordered[0]!;
  if (probability === 1) return ordered[ordered.length - 1]!;
  const position = (ordered.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return ordered[lower]!;
  const fraction = position - lower;
  const result = ordered[lower]! * (1 - fraction) + ordered[upper]! * fraction;
  if (!Number.isFinite(result)) reject("TRAJECTORY_NUMERIC_OVERFLOW", "values", "interpolated percentile is outside the finite numeric range");
  return result;
}

function cloneBootstrapSeries(
  context: BootstrapContext,
  plan: TrajectoryBootstrapPlan,
  replicateIndex: number
): TrajectorySeriesInput {
  const points: TrajectoryStatisticsPoint[] = [];
  let drawSequence = 0;
  for (const stratum of plan.strata) {
    for (const unitIndex of stratum.replicates[replicateIndex]!) {
      const history = context.histories[unitIndex]!;
      const clonedParticipant: TrajectoryIdentity = {
        components: [
          ...history.participant.components.map((component) => ({ ...component })),
          { name: BOOTSTRAP_DRAW_COMPONENT, type: "number", value: drawSequence }
        ]
      };
      drawSequence += 1;
      for (const point of history.points) {
        points.push({
          participant: clonedParticipant,
          time: { components: point.time.components.map((component) => ({ ...component })) },
          coordinates: [...point.coordinates],
          ...(context.series.estimand === "weighted-participant" ? { weight: point.weight } : {}),
        });
      }
    }
  }
  if (points.length > context.series.limits.maxPoints) reject("BOOTSTRAP_POINT_LIMIT", `replicates[${replicateIndex}]`, `exceeds maxPoints=${context.series.limits.maxPoints}`);
  return {
    namespace: context.series.namespace,
    points,
    dimensions: [...context.series.dimensions],
    selectedDimensions: [...context.series.selectedDimensions],
    timeOrder: context.series.timeOrder.map((time) => ({ components: time.components.map((component) => ({ ...component })) })),
    cohortPolicy: context.series.input.cohortPolicy,
    estimand: context.series.estimand,
    limits: { ...context.series.input.limits }
  };
}

function bootstrapInterval(
  estimate: number | null,
  values: Array<number | null>,
  clusterEligible: boolean,
  confidenceLevel: number,
  repetitions: number,
  requiredFinite: number
): TrajectoryBootstrapInterval | null {
  if (estimate === null || !clusterEligible) return null;
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (finite.length < requiredFinite) return null;
  const alpha = 1 - confidenceLevel;
  return {
    estimate,
    lower: trajectoryPercentile(finite, alpha / 2),
    upper: trajectoryPercentile(finite, 1 - alpha / 2),
    finiteReplicates: finite.length,
    requiredFiniteReplicates: requiredFinite,
    totalReplicates: repetitions
  };
}

export function bootstrapTrajectoryPath(input: TrajectoryBootstrapInput): TrajectoryBootstrapResult {
  if (typeof input.confidenceLevel !== "number" || !Number.isFinite(input.confidenceLevel) || input.confidenceLevel <= 0 || input.confidenceLevel >= 1) {
    reject("INVALID_BOOTSTRAP_CONFIDENCE", "input.confidenceLevel", "must be finite and strictly between 0 and 1");
  }
  const context = buildBootstrapContext({ series: input.series, stratifyBy: input.stratifyBy });
  const validatedPlan = validateBootstrapPlan(input.plan, context);
  const repetitions = validatedPlan.repetitions;
  let computationalCells = 0;
  for (let replicate = 0; replicate < repetitions; replicate += 1) {
    for (const stratum of input.plan.strata) {
      for (const unitIndex of stratum.replicates[replicate]!) {
        const rowCount = context.histories[unitIndex]!.points.length;
        const cells = rowCount * context.series.dimensions.length;
        if (!Number.isSafeInteger(cells) || computationalCells > Number.MAX_SAFE_INTEGER - cells) reject("BOOTSTRAP_OVERFLOW", "input.plan", "resampled coordinate cell count overflowed safe integer arithmetic");
        computationalCells += cells;
      }
    }
  }
  if (computationalCells > context.series.limits.maxCells) reject("BOOTSTRAP_CELL_LIMIT", "input.plan", `resampled coordinates exceed maxCells=${context.series.limits.maxCells}`);
  const replicatePaths = Array.from({ length: repetitions }, (_, replicate) => analyzeTrajectoryPath(cloneBootstrapSeries(context, input.plan, replicate)));
  const requiredFinite = Math.max(
    Math.ceil(0.8 * repetitions),
    Math.ceil(10 / (1 - input.confidenceLevel) - 1e-12),
  );
  let insufficientClusters = false;
  let insufficientReplicates = false;
  let anyCentroidVariation = false;
  const periods: TrajectoryBootstrapPeriod[] = context.base.periods.map((basePeriod, periodIndex) => {
    const centroidEligible = basePeriod.nUsed >= 2;
    const stepEligible = periodIndex > 0 && centroidEligible && context.base.periods[periodIndex - 1]!.nUsed >= 2;
    const cumulativeEligible = centroidEligible && context.base.periods.slice(0, periodIndex + 1).every((period) => period.nUsed >= 2);
    if (!centroidEligible || (periodIndex > 0 && (!stepEligible || !cumulativeEligible))) insufficientClusters = true;
    const selectedCentroid = Array.from({ length: 3 }, (_, dimension) => {
      const values = replicatePaths.map((path) => path.periods[periodIndex]!.selectedCentroid?.[dimension] ?? null);
      const interval = bootstrapInterval(basePeriod.selectedCentroid?.[dimension] ?? null, values, centroidEligible, input.confidenceLevel, repetitions, requiredFinite);
      if (centroidEligible && basePeriod.selectedCentroid !== null && interval === null) insufficientReplicates = true;
      return interval;
    });
    const fullCentroid = Array.from({ length: context.series.dimensions.length }, (_, dimension) => {
      const values = replicatePaths.map((path) => path.periods[periodIndex]!.fullCentroid?.[dimension] ?? null);
      const finiteValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      if (finiteValues.length > 1 && finiteValues.some((value) => value !== finiteValues[0])) anyCentroidVariation = true;
      const interval = bootstrapInterval(basePeriod.fullCentroid?.[dimension] ?? null, values, centroidEligible, input.confidenceLevel, repetitions, requiredFinite);
      if (centroidEligible && basePeriod.fullCentroid !== null && interval === null) insufficientReplicates = true;
      return interval;
    });
    const scalar = (
      estimate: number | null,
      selector: (path: TrajectoryPathStatistics) => number | null,
      eligible: boolean
    ) => {
      const interval = bootstrapInterval(estimate, replicatePaths.map(selector), eligible, input.confidenceLevel, repetitions, requiredFinite);
      if (eligible && estimate !== null && interval === null) insufficientReplicates = true;
      return interval;
    };
    return {
      index: periodIndex,
      time: basePeriod.time,
      selectedCentroid,
      fullCentroid,
      selectedStepDistance: scalar(basePeriod.selected3d.stepDistance, (path) => path.periods[periodIndex]!.selected3d.stepDistance, stepEligible),
      fullStepDistance: scalar(basePeriod.fullSpace.stepDistance, (path) => path.periods[periodIndex]!.fullSpace.stepDistance, stepEligible),
      selectedCumulativeDistance: scalar(basePeriod.selected3d.cumulativeDistance, (path) => path.periods[periodIndex]!.selected3d.cumulativeDistance, cumulativeEligible),
      fullCumulativeDistance: scalar(basePeriod.fullSpace.cumulativeDistance, (path) => path.periods[periodIndex]!.fullSpace.cumulativeDistance, cumulativeEligible)
    };
  });
  const diagnostics: TrajectoryStatisticsDiagnostic[] = [];
  if (insufficientClusters) diagnostics.push({ code: "BOOTSTRAP_INSUFFICIENT_CLUSTERS", severity: "warning", message: "Intervals requiring fewer than two participant clusters were withheld." });
  if (context.units.strata.some((stratum) => stratum.unitIndexes.length === 1)) diagnostics.push({ code: "BOOTSTRAP_SINGLETON_STRATUM", severity: "warning", message: "At least one resampling stratum has one participant cluster and contributes no within-stratum resampling variation." });
  if (context.histories.length >= 2 && !anyCentroidVariation) diagnostics.push({ code: "BOOTSTRAP_DEGENERATE_DISTRIBUTION", severity: "warning", message: "All finite bootstrap centroid replicates are identical; percentile intervals cannot express sampling variation." });
  if (insufficientReplicates) diagnostics.push({ code: "BOOTSTRAP_INSUFFICIENT_REPLICATES", severity: "warning", message: `Intervals with fewer than ${requiredFinite} finite replicates were withheld.` });
  return deepFreeze({
    schemaVersion: "3dena.trajectory-bootstrap.v1",
    base: context.base,
    confidenceLevel: input.confidenceLevel,
    periods,
    quantileRule: {
      id: "linear-type7-v1",
      sort: "ascending-numeric",
      position: "(n-1)*p",
      interpolation: "linear-between-floor-and-ceiling",
      endpoints: "p=0-min-p=1-max"
    },
    resampling: {
      unit: "participant-complete-history",
      stratified: input.stratifyBy === "explicit",
      strata: context.units.strata.map((stratum) => ({ key: stratum.key, unitCount: stratum.unitIndexes.length })),
      replicateCount: repetitions,
      planKind: "participant-history-resample-indices-v1",
      generation: validatedPlan.generation,
      rngParityClaim: false
    },
    diagnostics
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
