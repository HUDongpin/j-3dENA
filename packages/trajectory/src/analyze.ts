import { rejectTrajectoryDynamics } from "./errors";
import type {
  TrajectoryDistanceAndSpeedV1,
  TrajectoryDurationUnitV1,
  TrajectoryDynamicsDiagnosticV1,
  TrajectoryDynamicsInputV1,
  TrajectoryDynamicsLimitsV1,
  TrajectoryDynamicsResultV1,
  TrajectoryIdentityComponentV1,
  TrajectoryIdentityV1,
  TrajectoryKeyV1,
  TrajectoryParticipantPeriodV1,
  TrajectoryPeriodDefinitionV1,
  TrajectoryPeriodDynamicsV1,
  TrajectoryTimeContractV1,
  TrajectoryTimeValueV1
} from "./types";

const DEFAULT_LIMITS: TrajectoryDynamicsLimitsV1 = Object.freeze({
  maxPoints: 100_000,
  maxDimensions: 200,
  maxPeriods: 1_000,
  maxParticipants: 50_000,
  maxCells: 5_000_000
});

const HARD_LIMITS: TrajectoryDynamicsLimitsV1 = Object.freeze({
  maxPoints: 500_000,
  maxDimensions: 500,
  maxPeriods: 10_000,
  maxParticipants: 200_000,
  maxCells: 100_000_000
});

const DURATION_MILLISECONDS: Readonly<Record<TrajectoryDurationUnitV1, number>> = Object.freeze({
  milliseconds: 1,
  seconds: 1_000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 604_800_000
});

const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;

interface NormalizedTimePeriod {
  definition: TrajectoryPeriodDefinitionV1;
  key: TrajectoryKeyV1;
  coordinate: number | bigint;
}

interface NormalizedPoint {
  participant: TrajectoryKeyV1;
  time: TrajectoryKeyV1;
  coordinates: number[];
  weight?: number;
  rowIndex: number;
}

interface NormalizedInput {
  input: TrajectoryDynamicsInputV1;
  namespace: string;
  dimensions: string[];
  selectedDimensions: [string, string, string];
  selectedIndexes: [number, number, number];
  periods: NormalizedTimePeriod[];
  timeContract: TrajectoryTimeContractV1;
  elapsedFromPrevious: Array<number | null>;
  elapsedFromStart: number[];
  points: NormalizedPoint[];
  limits: TrajectoryDynamicsLimitsV1;
}

interface CentroidResult {
  centroid: number[] | null;
  weightSum: number | null;
  effectiveParticipantN: number | null;
}

function resolveLimits(input?: Partial<TrajectoryDynamicsLimitsV1>): TrajectoryDynamicsLimitsV1 {
  const output = {} as TrajectoryDynamicsLimitsV1;
  for (const key of Object.keys(DEFAULT_LIMITS) as Array<keyof TrajectoryDynamicsLimitsV1>) {
    const value = input?.[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
      rejectTrajectoryDynamics("INVALID_TRAJECTORY_LIMIT", `input.limits.${key}`, "must be a positive safe integer");
    }
    if (value !== undefined && value > HARD_LIMITS[key]) {
      rejectTrajectoryDynamics("TRAJECTORY_LIMIT_ABOVE_CEILING", `input.limits.${key}`, `must not exceed ${HARD_LIMITS[key]}`);
    }
    output[key] = value ?? DEFAULT_LIMITS[key];
  }
  return output;
}

function finiteDoubleBits(value: number): string {
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  view.setFloat64(0, value, false);
  return view.getBigUint64(0, false).toString(16).padStart(16, "0");
}

function identityToken(component: TrajectoryIdentityComponentV1, path: string): [string, string, string, string] {
  if (!component || typeof component !== "object") {
    rejectTrajectoryDynamics("INVALID_IDENTITY_COMPONENT", path, "must be an object");
  }
  if (typeof component.name !== "string" || component.name.trim() === "" || component.name.length > 256) {
    rejectTrajectoryDynamics("INVALID_IDENTITY_COMPONENT", `${path}.name`, "must be a non-empty string of at most 256 UTF-16 code units");
  }
  if (
    component.declaredType !== undefined
    && (typeof component.declaredType !== "string" || component.declaredType.trim() === "" || component.declaredType.length > 256)
  ) {
    rejectTrajectoryDynamics("INVALID_IDENTITY_COMPONENT", `${path}.declaredType`, "must be a non-empty string of at most 256 UTF-16 code units when present");
  }
  if (component.type === "string") {
    if (typeof component.value !== "string" || component.value.length === 0) {
      rejectTrajectoryDynamics("INVALID_IDENTITY_VALUE", `${path}.value`, "must be a non-empty string for a string component");
    }
    return [component.name, "string", component.declaredType ?? "string", component.value];
  }
  if (component.type === "boolean") {
    if (typeof component.value !== "boolean") {
      rejectTrajectoryDynamics("INVALID_IDENTITY_VALUE", `${path}.value`, "must be boolean for a boolean component");
    }
    return [component.name, "boolean", component.declaredType ?? "boolean", component.value ? "true" : "false"];
  }
  if (component.type !== "number" || typeof component.value !== "number" || !Number.isFinite(component.value)) {
    rejectTrajectoryDynamics("INVALID_IDENTITY_VALUE", `${path}.value`, "must be a finite number for a number component");
  }
  if (Number.isInteger(component.value) && !Number.isSafeInteger(component.value)) {
    rejectTrajectoryDynamics("UNSAFE_INTEGER_IDENTITY", `${path}.value`, "integer identities above Number.MAX_SAFE_INTEGER must be lossless strings");
  }
  return [component.name, "number", component.declaredType ?? "double", finiteDoubleBits(component.value)];
}

function normalizeIdentity(identity: TrajectoryIdentityV1, path: string): TrajectoryKeyV1 {
  if (!identity || !Array.isArray(identity.components) || identity.components.length === 0) {
    rejectTrajectoryDynamics("INVALID_TRAJECTORY_IDENTITY", path, "must contain at least one typed component");
  }
  const names = new Set<string>();
  const entries = identity.components.map((component, index) => {
    const token = identityToken(component, `${path}.components[${index}]`);
    if (names.has(component.name)) {
      rejectTrajectoryDynamics("DUPLICATE_IDENTITY_COMPONENT", `${path}.components[${index}].name`, "duplicates an earlier component name");
    }
    names.add(component.name);
    return { component: { ...component }, token };
  });
  return {
    components: entries.map(({ component }) => component),
    canonical: JSON.stringify(entries.map(({ token }) => token)),
    display: entries.map(({ component }) => String(component.value)).join(" · ")
  };
}

function normalizeNamespace(value: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 256) {
    rejectTrajectoryDynamics("INVALID_TRAJECTORY_NAMESPACE", "input.namespace", "must be a non-empty string of at most 256 UTF-16 code units");
  }
  return value;
}

function isDurationUnit(value: unknown): value is TrajectoryDurationUnitV1 {
  return typeof value === "string" && Object.hasOwn(DURATION_MILLISECONDS, value);
}

function parseCivilDate(value: unknown, path: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    rejectTrajectoryDynamics("INVALID_TRAJECTORY_DATE", path, "must use strict YYYY-MM-DD syntax");
  }
  const [yearText, monthText, dayText] = value.split("-") as [string, string, string];
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    rejectTrajectoryDynamics("INVALID_TRAJECTORY_DATE", path, "must be a real proleptic-Gregorian calendar date");
  }
  return date.getTime() / DURATION_MILLISECONDS.days;
}

function parseInt64(value: unknown, path: string): bigint {
  if (typeof value !== "string" || value.length > 20 || !/^-?(0|[1-9]\d*)$/.test(value) || value === "-0") {
    rejectTrajectoryDynamics("INVALID_INSTANT_EPOCH", path, "must be a canonical signed decimal integer string");
  }
  const parsed = BigInt(value);
  if (parsed < INT64_MIN || parsed > INT64_MAX) {
    rejectTrajectoryDynamics("INSTANT_EPOCH_OUT_OF_RANGE", path, "must fit signed int64 epoch milliseconds");
  }
  return parsed;
}

function cloneTimeValue(value: TrajectoryTimeValueV1): TrajectoryTimeValueV1 {
  return { ...value };
}

function normalizeTimeValues(
  definitions: TrajectoryPeriodDefinitionV1[],
  limits: TrajectoryDynamicsLimitsV1
): {
  periods: NormalizedTimePeriod[];
  contract: TrajectoryTimeContractV1;
  elapsedFromPrevious: Array<number | null>;
  elapsedFromStart: number[];
} {
  if (!Array.isArray(definitions) || definitions.length === 0) {
    rejectTrajectoryDynamics("INVALID_TRAJECTORY_PERIODS", "input.periods", "must contain at least one expected period");
  }
  if (definitions.length > limits.maxPeriods) {
    rejectTrajectoryDynamics("TRAJECTORY_PERIOD_LIMIT", "input.periods", `exceeds maxPeriods=${limits.maxPeriods}`);
  }
  const firstDefinition = definitions[0];
  if (!firstDefinition || typeof firstDefinition !== "object") {
    rejectTrajectoryDynamics("INVALID_TRAJECTORY_PERIOD", "input.periods[0]", "must be an object");
  }
  const first = firstDefinition.value;
  if (!first || typeof first !== "object") {
    rejectTrajectoryDynamics("INVALID_TRAJECTORY_TIME_VALUE", "input.periods[0].value", "must be a versioned time value");
  }
  let contract: TrajectoryTimeContractV1;
  if (first.type === "numeric-v1") {
    if (typeof first.unit !== "string" || first.unit.trim() === "" || first.unit.length > 128) {
      rejectTrajectoryDynamics("INVALID_NUMERIC_TIME_UNIT", "input.periods[0].value.unit", "must be a non-empty label of at most 128 UTF-16 code units");
    }
    contract = { kind: "numeric-v1", elapsedUnit: first.unit, chronology: "strictly-increasing-finite-number-v1" };
  } else if (first.type === "date-v1") {
    contract = { kind: "date-v1", elapsedUnit: "days", calendar: "proleptic-gregorian-v1", chronology: "strictly-increasing-civil-day-v1" };
  } else if (first.type === "instant-v1") {
    if (!isDurationUnit(first.elapsedUnit)) {
      rejectTrajectoryDynamics("INVALID_INSTANT_ELAPSED_UNIT", "input.periods[0].value.elapsedUnit", "must be a supported fixed-duration unit");
    }
    contract = {
      kind: "instant-v1",
      elapsedUnit: first.elapsedUnit,
      epoch: "unix-epoch-milliseconds-int64-v1",
      chronology: "strictly-increasing-exact-epoch-v1",
      zoneRole: "presentation-provenance-only"
    };
  } else if (first.type === "difftime-v1") {
    if (!isDurationUnit(first.elapsedUnit)) {
      rejectTrajectoryDynamics("INVALID_DIFFTIME_ELAPSED_UNIT", "input.periods[0].value.elapsedUnit", "must be a supported fixed-duration unit");
    }
    contract = {
      kind: "difftime-v1",
      elapsedUnit: first.elapsedUnit,
      conversion: "fixed-duration-unit-ratios-v1",
      chronology: "strictly-increasing-normalized-duration-v1"
    };
  } else {
    rejectTrajectoryDynamics("UNKNOWN_TRAJECTORY_TIME_VERSION", "input.periods[0].value.type", "is not a supported versioned time type");
  }

  const seen = new Set<string>();
  const periods = definitions.map((definition, index): NormalizedTimePeriod => {
    if (!definition || typeof definition !== "object") {
      rejectTrajectoryDynamics("INVALID_TRAJECTORY_PERIOD", `input.periods[${index}]`, "must be an object");
    }
    const key = normalizeIdentity(definition.time, `input.periods[${index}].time`);
    if (seen.has(key.canonical)) {
      rejectTrajectoryDynamics("DUPLICATE_TRAJECTORY_TIME", `input.periods[${index}].time`, "duplicates an earlier typed period identity");
    }
    seen.add(key.canonical);
    const value = definition.value;
    if (!value || typeof value !== "object" || value.type !== contract.kind) {
      rejectTrajectoryDynamics("MIXED_TRAJECTORY_TIME_TYPES", `input.periods[${index}].value`, `must use ${contract.kind} for every period`);
    }
    let coordinate: number | bigint;
    if (value.type === "numeric-v1" && contract.kind === "numeric-v1") {
      if (typeof value.value !== "number" || !Number.isFinite(value.value)) {
        rejectTrajectoryDynamics("INVALID_NUMERIC_TIME", `input.periods[${index}].value.value`, "must be finite");
      }
      if (value.unit !== contract.elapsedUnit) {
        rejectTrajectoryDynamics("MIXED_NUMERIC_TIME_UNITS", `input.periods[${index}].value.unit`, "must exactly match the first period unit");
      }
      coordinate = value.value;
    } else if (value.type === "date-v1" && contract.kind === "date-v1") {
      coordinate = parseCivilDate(value.value, `input.periods[${index}].value.value`);
    } else if (value.type === "instant-v1" && contract.kind === "instant-v1") {
      if (value.elapsedUnit !== contract.elapsedUnit) {
        rejectTrajectoryDynamics("MIXED_INSTANT_ELAPSED_UNITS", `input.periods[${index}].value.elapsedUnit`, "must exactly match the first period elapsedUnit");
      }
      if (typeof value.timeZone !== "string" || value.timeZone.trim() === "" || value.timeZone.length > 256) {
        rejectTrajectoryDynamics("INVALID_INSTANT_TIME_ZONE", `input.periods[${index}].value.timeZone`, "must be a non-empty provenance label of at most 256 UTF-16 code units");
      }
      if (!Number.isInteger(value.offsetMinutes) || value.offsetMinutes < -840 || value.offsetMinutes > 840) {
        rejectTrajectoryDynamics("INVALID_INSTANT_OFFSET", `input.periods[${index}].value.offsetMinutes`, "must be an integer in [-840, 840]");
      }
      if (value.fold !== 0 && value.fold !== 1) {
        rejectTrajectoryDynamics("INVALID_INSTANT_FOLD", `input.periods[${index}].value.fold`, "must be 0 or 1");
      }
      coordinate = parseInt64(value.epochMilliseconds, `input.periods[${index}].value.epochMilliseconds`);
    } else if (value.type === "difftime-v1" && contract.kind === "difftime-v1") {
      if (typeof value.value !== "number" || !Number.isFinite(value.value)) {
        rejectTrajectoryDynamics("INVALID_DIFFTIME_VALUE", `input.periods[${index}].value.value`, "must be finite");
      }
      if (!isDurationUnit(value.unit) || !isDurationUnit(value.elapsedUnit)) {
        rejectTrajectoryDynamics("INVALID_DIFFTIME_UNIT", `input.periods[${index}].value`, "unit and elapsedUnit must be supported fixed-duration units");
      }
      if (value.elapsedUnit !== contract.elapsedUnit) {
        rejectTrajectoryDynamics("MIXED_DIFFTIME_ELAPSED_UNITS", `input.periods[${index}].value.elapsedUnit`, "must exactly match the first period elapsedUnit");
      }
      coordinate = value.value * (DURATION_MILLISECONDS[value.unit] / DURATION_MILLISECONDS[value.elapsedUnit]);
      if (!Number.isFinite(coordinate)) {
        rejectTrajectoryDynamics("TRAJECTORY_TIME_OVERFLOW", `input.periods[${index}].value`, "normalized difftime is outside the finite numeric range");
      }
    } else {
      rejectTrajectoryDynamics("MIXED_TRAJECTORY_TIME_TYPES", `input.periods[${index}].value`, `must use ${contract.kind} for every period`);
    }
    return {
      definition: { time: { components: key.components.map((component) => ({ ...component })) }, value: cloneTimeValue(value) },
      key,
      coordinate
    };
  });

  const difference = (right: number | bigint, left: number | bigint, path: string): number => {
    if (typeof right === "bigint" && typeof left === "bigint" && contract.kind === "instant-v1") {
      const deltaMilliseconds = right - left;
      if (deltaMilliseconds <= 0n) {
        rejectTrajectoryDynamics("NON_INCREASING_TRAJECTORY_TIME", path, "period values must be strictly increasing");
      }
      if (deltaMilliseconds > BigInt(Number.MAX_SAFE_INTEGER)) {
        rejectTrajectoryDynamics("TRAJECTORY_TIME_PRECISION_LIMIT", path, "adjacent epoch difference exceeds exact JavaScript integer conversion");
      }
      const output = Number(deltaMilliseconds) / DURATION_MILLISECONDS[contract.elapsedUnit];
      if (!Number.isFinite(output) || output <= 0) {
        rejectTrajectoryDynamics("TRAJECTORY_TIME_OVERFLOW", path, "elapsed interval is outside the positive finite numeric range");
      }
      return output;
    }
    if (typeof right !== "number" || typeof left !== "number") {
      rejectTrajectoryDynamics("MIXED_TRAJECTORY_TIME_TYPES", path, "normalized coordinates must use one numeric representation");
    }
    const output = right - left;
    if (!Number.isFinite(output)) {
      rejectTrajectoryDynamics("TRAJECTORY_TIME_OVERFLOW", path, "elapsed interval is outside the finite numeric range");
    }
    if (output <= 0) {
      rejectTrajectoryDynamics("NON_INCREASING_TRAJECTORY_TIME", path, "period values must be strictly increasing");
    }
    return output;
  };

  const elapsedFromPrevious = periods.map((period, index) => index === 0
    ? null
    : difference(period.coordinate, periods[index - 1]!.coordinate, `input.periods[${index}].value`));
  const elapsedFromStart = periods.map((period, index) => index === 0
    ? 0
    : difference(period.coordinate, periods[0]!.coordinate, `input.periods[${index}].value`));
  return { periods, contract, elapsedFromPrevious, elapsedFromStart };
}

function normalizeInput(input: TrajectoryDynamicsInputV1): NormalizedInput {
  if (!input || typeof input !== "object") {
    rejectTrajectoryDynamics("INVALID_TRAJECTORY_INPUT", "input", "must be an object");
  }
  if (input.schemaVersion !== "3dena.trajectory-dynamics-input.v1") {
    rejectTrajectoryDynamics("UNKNOWN_TRAJECTORY_INPUT_VERSION", "input.schemaVersion", "must be 3dena.trajectory-dynamics-input.v1");
  }
  const limits = resolveLimits(input.limits);
  const namespace = normalizeNamespace(input.namespace);
  if (!Array.isArray(input.dimensions) || input.dimensions.length === 0) {
    rejectTrajectoryDynamics("INVALID_TRAJECTORY_DIMENSIONS", "input.dimensions", "must contain at least one dimension");
  }
  if (input.dimensions.length > limits.maxDimensions) {
    rejectTrajectoryDynamics("TRAJECTORY_DIMENSION_LIMIT", "input.dimensions", `exceeds maxDimensions=${limits.maxDimensions}`);
  }
  if (input.dimensions.some((dimension) => typeof dimension !== "string" || dimension.trim() === "" || dimension.length > 256)) {
    rejectTrajectoryDynamics("INVALID_TRAJECTORY_DIMENSIONS", "input.dimensions", "must contain non-empty strings of at most 256 UTF-16 code units");
  }
  if (new Set(input.dimensions).size !== input.dimensions.length) {
    rejectTrajectoryDynamics("DUPLICATE_TRAJECTORY_DIMENSION", "input.dimensions", "must be unique and ordered");
  }
  if (!Array.isArray(input.selectedDimensions) || input.selectedDimensions.length !== 3 || new Set(input.selectedDimensions).size !== 3) {
    rejectTrajectoryDynamics("INVALID_SELECTED_DIMENSIONS", "input.selectedDimensions", "must contain exactly three distinct dimensions");
  }
  const selectedIndexes = input.selectedDimensions.map((dimension, index) => {
    const resolved = input.dimensions.indexOf(dimension);
    if (resolved < 0) {
      rejectTrajectoryDynamics("UNKNOWN_SELECTED_DIMENSION", `input.selectedDimensions[${index}]`, `${JSON.stringify(dimension)} is not declared`);
    }
    return resolved;
  }) as [number, number, number];
  if (input.cohortPolicy !== "available" && input.cohortPolicy !== "complete") {
    rejectTrajectoryDynamics("INVALID_TRAJECTORY_COHORT", "input.cohortPolicy", "must be available or complete");
  }
  if (input.estimand?.kind !== "equal-participant-v1" && input.estimand?.kind !== "weighted-participant-v1") {
    rejectTrajectoryDynamics("INVALID_TRAJECTORY_ESTIMAND", "input.estimand.kind", "must be equal-participant-v1 or weighted-participant-v1");
  }
  const normalizedTime = normalizeTimeValues(input.periods, limits);
  if (!Array.isArray(input.points) || input.points.length === 0) {
    rejectTrajectoryDynamics("EMPTY_TRAJECTORY_POINTS", "input.points", "must contain at least one preprojected point");
  }
  if (input.points.length > limits.maxPoints) {
    rejectTrajectoryDynamics("TRAJECTORY_POINT_LIMIT", "input.points", `exceeds maxPoints=${limits.maxPoints}`);
  }
  const cells = input.points.length * input.dimensions.length;
  if (!Number.isSafeInteger(cells) || cells > limits.maxCells) {
    rejectTrajectoryDynamics("TRAJECTORY_CELL_LIMIT", "input.points", `exceeds maxCells=${limits.maxCells}`);
  }
  const expectedTimes = new Set(normalizedTime.periods.map(({ key }) => key.canonical));
  const points = input.points.map((point, rowIndex): NormalizedPoint => {
    if (!point || typeof point !== "object") {
      rejectTrajectoryDynamics("INVALID_TRAJECTORY_POINT", `input.points[${rowIndex}]`, "must be an object");
    }
    const participant = normalizeIdentity(point.participant, `input.points[${rowIndex}].participant`);
    const time = normalizeIdentity(point.time, `input.points[${rowIndex}].time`);
    if (!expectedTimes.has(time.canonical)) {
      rejectTrajectoryDynamics("TRAJECTORY_TIME_ORDER_INCOMPLETE", `input.points[${rowIndex}].time`, "observed typed period is absent from input.periods");
    }
    if (!Array.isArray(point.coordinates) || point.coordinates.length !== input.dimensions.length) {
      rejectTrajectoryDynamics("TRAJECTORY_COORDINATE_SHAPE", `input.points[${rowIndex}].coordinates`, "must align exactly with dimensions");
    }
    const coordinates = point.coordinates.map((value, dimensionIndex) => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        rejectTrajectoryDynamics("NON_FINITE_TRAJECTORY_COORDINATE", `input.points[${rowIndex}].coordinates[${dimensionIndex}]`, "must be finite");
      }
      return value;
    });
    if (point.weight !== undefined && (typeof point.weight !== "number" || !Number.isFinite(point.weight) || point.weight <= 0)) {
      rejectTrajectoryDynamics("INVALID_PARTICIPANT_WEIGHT", `input.points[${rowIndex}].weight`, "must be finite and strictly positive when present");
    }
    if (input.estimand.kind === "weighted-participant-v1" && point.weight === undefined) {
      rejectTrajectoryDynamics("MISSING_PARTICIPANT_WEIGHT", `input.points[${rowIndex}].weight`, "is required by weighted-participant-v1");
    }
    return {
      participant,
      time,
      coordinates,
      ...(point.weight === undefined ? {} : { weight: point.weight }),
      rowIndex
    };
  });
  if (new Set(points.map(({ participant }) => participant.canonical)).size > limits.maxParticipants) {
    rejectTrajectoryDynamics("TRAJECTORY_PARTICIPANT_LIMIT", "input.points", `exceeds maxParticipants=${limits.maxParticipants}`);
  }
  return {
    input,
    namespace,
    dimensions: [...input.dimensions],
    selectedDimensions: [...input.selectedDimensions],
    selectedIndexes,
    periods: normalizedTime.periods,
    timeContract: normalizedTime.contract,
    elapsedFromPrevious: normalizedTime.elapsedFromPrevious,
    elapsedFromStart: normalizedTime.elapsedFromStart,
    points,
    limits
  };
}

function compareCanonical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compensatedMean(rows: number[][], dimensions: number): number[] {
  return Array.from({ length: dimensions }, (_, dimension) => {
    let sum = 0;
    let correction = 0;
    for (const row of rows) {
      const term = row[dimension]! / rows.length;
      const next = sum + term;
      if (!Number.isFinite(next)) {
        rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.mean[${dimension}]`, "centroid accumulation is outside the finite numeric range");
      }
      correction += Math.abs(sum) >= Math.abs(term) ? (sum - next) + term : (term - next) + sum;
      if (!Number.isFinite(correction)) {
        rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.mean[${dimension}]`, "centroid correction is outside the finite numeric range");
      }
      sum = next;
    }
    const result = sum + correction;
    if (!Number.isFinite(result)) {
      rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.mean[${dimension}]`, "centroid is outside the finite numeric range");
    }
    return result;
  });
}

function reduceParticipantPeriods(series: NormalizedInput): {
  participantPeriods: TrajectoryParticipantPeriodV1[];
  duplicateRows: number;
  cohortExcludedParticipants: number;
  timeVaryingWeights: number;
} {
  const grouped = new Map<string, { participant: TrajectoryKeyV1; time: TrajectoryKeyV1; rows: NormalizedPoint[] }>();
  for (const point of series.points) {
    const key = JSON.stringify([series.namespace, point.participant.canonical, point.time.canonical]);
    const existing = grouped.get(key);
    if (existing) existing.rows.push(point);
    else grouped.set(key, { participant: point.participant, time: point.time, rows: [point] });
  }
  const expectedTimes = new Set(series.periods.map(({ key }) => key.canonical));
  const observedByParticipant = new Map<string, Set<string>>();
  for (const group of grouped.values()) {
    const observed = observedByParticipant.get(group.participant.canonical) ?? new Set<string>();
    observed.add(group.time.canonical);
    observedByParticipant.set(group.participant.canonical, observed);
  }
  const complete = new Set(
    [...observedByParticipant.entries()]
      .filter(([, observed]) => observed.size === expectedTimes.size)
      .map(([participant]) => participant)
  );
  const periodIndex = new Map(series.periods.map(({ key }, index) => [key.canonical, index]));
  let duplicateRows = 0;
  const weightsByParticipant = new Map<string, Set<number>>();
  const participantPeriods = [...grouped.values()]
    .sort((left, right) => compareCanonical(left.participant.canonical, right.participant.canonical)
      || periodIndex.get(left.time.canonical)! - periodIndex.get(right.time.canonical)!)
    .map((group, index): TrajectoryParticipantPeriodV1 => {
      duplicateRows += group.rows.length - 1;
      const fullCoordinates = compensatedMean(group.rows.map(({ coordinates }) => coordinates), series.dimensions.length);
      let participantWeight = 1;
      if (series.input.estimand.kind === "weighted-participant-v1") {
        const distinctWeights = new Set(group.rows.map(({ weight }) => weight!));
        if (distinctWeights.size !== 1) {
          rejectTrajectoryDynamics(
            "INCONSISTENT_PARTICIPANT_PERIOD_WEIGHT",
            `input.participantPeriods.${group.participant.display}.${group.time.display}`,
            "duplicate source rows must declare one constant participant-period weight"
          );
        }
        participantWeight = group.rows[0]!.weight!;
      }
      const includedInCohort = series.input.cohortPolicy === "available" || complete.has(group.participant.canonical);
      if (series.input.estimand.kind === "weighted-participant-v1" && includedInCohort) {
        const participantWeights = weightsByParticipant.get(group.participant.canonical) ?? new Set<number>();
        participantWeights.add(participantWeight);
        weightsByParticipant.set(group.participant.canonical, participantWeights);
      }
      return {
        index,
        participant: group.participant,
        time: group.time,
        selectedCoordinates: series.selectedIndexes.map((selected) => fullCoordinates[selected]!) as [number, number, number],
        fullCoordinates,
        sourceRowIndexes: group.rows.map(({ rowIndex }) => rowIndex).sort((left, right) => left - right),
        participantWeight,
        includedInCohort
      };
    });
  const cohortExcludedParticipants = series.input.cohortPolicy === "complete"
    ? observedByParticipant.size - complete.size
    : 0;
  const timeVaryingWeights = [...weightsByParticipant.values()].filter((weights) => weights.size > 1).length;
  return { participantPeriods, duplicateRows, cohortExcludedParticipants, timeVaryingWeights };
}

function finiteWeightedCentroid(rows: TrajectoryParticipantPeriodV1[], dimensions: number, weighted: boolean): CentroidResult {
  if (rows.length === 0) {
    return { centroid: null, weightSum: null, effectiveParticipantN: null };
  }
  if (!weighted) {
    return {
      centroid: compensatedMean(rows.map(({ fullCoordinates }) => fullCoordinates), dimensions),
      weightSum: rows.length,
      effectiveParticipantN: rows.length
    };
  }
  const maximumWeight = rows.reduce((maximum, { participantWeight }) => Math.max(maximum, participantWeight), 0);
  const scaledWeights = rows.map(({ participantWeight }) => participantWeight / maximumWeight);
  const scaledWeightSum = scaledWeights.reduce((sum, value) => sum + value, 0);
  const squaredScaledWeightSum = scaledWeights.reduce((sum, value) => sum + value * value, 0);
  if (!Number.isFinite(scaledWeightSum) || scaledWeightSum <= 0 || !Number.isFinite(squaredScaledWeightSum) || squaredScaledWeightSum <= 0) {
    rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", "trajectory.weights", "normalized participant weights are not representable");
  }
  const centroid = Array.from({ length: dimensions }, (_, dimension) => {
    let sum = 0;
    let correction = 0;
    rows.forEach((row, index) => {
      const term = row.fullCoordinates[dimension]! * (scaledWeights[index]! / scaledWeightSum);
      const next = sum + term;
      if (!Number.isFinite(next)) {
        rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.weightedMean[${dimension}]`, "weighted centroid accumulation is outside the finite numeric range");
      }
      correction += Math.abs(sum) >= Math.abs(term) ? (sum - next) + term : (term - next) + sum;
      if (!Number.isFinite(correction)) {
        rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.weightedMean[${dimension}]`, "weighted centroid correction is outside the finite numeric range");
      }
      sum = next;
    });
    const result = sum + correction;
    if (!Number.isFinite(result)) {
      rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.weightedMean[${dimension}]`, "weighted centroid is outside the finite numeric range");
    }
    return result;
  });
  const weightSum = maximumWeight * scaledWeightSum;
  const effectiveParticipantN = (scaledWeightSum * scaledWeightSum) / squaredScaledWeightSum;
  if (!Number.isFinite(effectiveParticipantN)) {
    rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", "trajectory.effectiveParticipantN", "effective sample size is outside the finite numeric range");
  }
  return {
    centroid,
    weightSum: Number.isFinite(weightSum) ? weightSum : null,
    effectiveParticipantN
  };
}

function subtract(right: number[], left: number[]): number[] {
  return right.map((value, dimension) => {
    const output = value - left[dimension]!;
    if (!Number.isFinite(output)) {
      rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.delta[${dimension}]`, "coordinate delta is outside the finite numeric range");
    }
    return output;
  });
}

function distance(delta: number[]): number {
  const output = Math.hypot(...delta);
  if (!Number.isFinite(output)) {
    rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", "trajectory.distance", "Euclidean distance is outside the finite numeric range");
  }
  return output;
}

function pathMetrics(
  centroids: Array<number[] | null>,
  dimensions: string[],
  elapsedFromPrevious: Array<number | null>
): TrajectoryDistanceAndSpeedV1[] {
  let continuous = true;
  let cumulative = 0;
  return centroids.map((centroid, index) => {
    if (centroid === null) {
      continuous = false;
      return { dimensions: [...dimensions], delta: null, stepDistance: null, cumulativeDistance: null, speed: null };
    }
    if (index === 0) {
      return { dimensions: [...dimensions], delta: null, stepDistance: 0, cumulativeDistance: 0, speed: null };
    }
    const previous = centroids[index - 1];
    if (previous === null || previous === undefined) {
      continuous = false;
      return { dimensions: [...dimensions], delta: null, stepDistance: null, cumulativeDistance: null, speed: null };
    }
    const delta = subtract(centroid, previous);
    const stepDistance = distance(delta);
    const elapsed = elapsedFromPrevious[index]!;
    const speed = stepDistance / elapsed;
    if (!Number.isFinite(speed)) {
      rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.periods[${index}].speed`, "speed is outside the finite numeric range");
    }
    if (continuous) {
      cumulative += stepDistance;
      if (!Number.isFinite(cumulative)) {
        rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.periods[${index}].cumulativeDistance`, "cumulative distance is outside the finite numeric range");
      }
    }
    return {
      dimensions: [...dimensions],
      delta,
      stepDistance,
      cumulativeDistance: continuous ? cumulative : null,
      speed
    };
  });
}

function diagnosticSummary(diagnostics: TrajectoryDynamicsDiagnosticV1[]): TrajectoryDynamicsResultV1["diagnosticSummary"] {
  return {
    info: diagnostics.filter(({ severity }) => severity === "info").length,
    warning: diagnostics.filter(({ severity }) => severity === "warning").length,
    codes: [...new Set(diagnostics.map(({ code }) => code))]
  };
}

function buildDiagnostics(
  series: NormalizedInput,
  participantPeriods: TrajectoryParticipantPeriodV1[],
  periods: TrajectoryPeriodDynamicsV1[],
  duplicateRows: number,
  cohortExcludedParticipants: number,
  timeVaryingWeights: number
): TrajectoryDynamicsDiagnosticV1[] {
  const diagnostics: TrajectoryDynamicsDiagnosticV1[] = [
    {
      code: "TIME_SEMANTICS_RESOLVED",
      severity: "info",
      message: `Elapsed time uses ${series.timeContract.kind} with unit ${series.timeContract.elapsedUnit}.`
    },
    {
      code: series.input.estimand.kind === "equal-participant-v1" ? "EQUAL_PARTICIPANT_ESTIMAND" : "WEIGHTED_PARTICIPANT_ESTIMAND",
      severity: "info",
      message: series.input.estimand.kind === "equal-participant-v1"
        ? "Each included participant-period contributes equal centroid weight after duplicate reduction."
        : "Each included participant-period contributes its explicit positive weight after duplicate reduction."
    }
  ];
  if (duplicateRows > 0) {
    diagnostics.push({
      code: "DUPLICATE_PARTICIPANT_PERIOD_ROWS",
      severity: "warning",
      message: `${duplicateRows} duplicate source rows were reduced before centroid estimation.`,
      count: duplicateRows
    });
  }
  const providedWeights = series.points.filter(({ weight }) => weight !== undefined).length;
  if (series.input.estimand.kind === "equal-participant-v1" && providedWeights > 0) {
    diagnostics.push({
      code: "PARTICIPANT_WEIGHTS_IGNORED",
      severity: "warning",
      message: `${providedWeights} source rows provided weights that equal-participant-v1 intentionally ignored.`,
      count: providedWeights
    });
  }
  if (cohortExcludedParticipants > 0) {
    diagnostics.push({
      code: "INCOMPLETE_PARTICIPANTS_EXCLUDED",
      severity: "warning",
      message: `${cohortExcludedParticipants} participants were excluded from every period by complete cohort policy.`,
      count: cohortExcludedParticipants
    });
  }
  if (timeVaryingWeights > 0) {
    diagnostics.push({
      code: "TIME_VARYING_PARTICIPANT_WEIGHT",
      severity: "warning",
      message: `${timeVaryingWeights} participants use different weights across periods; the weighted estimand is period-specific.`,
      count: timeVaryingWeights
    });
  }
  for (const period of periods) {
    if (period.nParticipantPeriods === 0) {
      diagnostics.push({
        code: "MISSING_TRAJECTORY_PERIOD",
        severity: "warning",
        message: "No participant-period was observed for this expected period; centroids and path metrics are withheld.",
        path: `periods[${period.index}]`
      });
    } else if (period.nUsed === 0) {
      diagnostics.push({
        code: "EMPTY_TRAJECTORY_PERIOD_AFTER_COHORT",
        severity: "warning",
        message: "Participant-period rows exist, but cohort policy excludes all of them from this centroid.",
        path: `periods[${period.index}]`
      });
    } else if (period.nUsed === 1) {
      diagnostics.push({
        code: "SINGLE_PARTICIPANT_PERIOD",
        severity: "warning",
        message: "This centroid is determined by one participant-period.",
        path: `periods[${period.index}]`
      });
    }
    if (period.weightSum === null && period.nUsed > 0) {
      diagnostics.push({
        code: "UNREPRESENTABLE_WEIGHT_SUM",
        severity: "warning",
        message: "The weighted centroid is finite, but the unscaled sum of weights exceeds the finite numeric range.",
        path: `periods[${period.index}].weightSum`
      });
    }
    if (period.effectiveParticipantN !== null && period.effectiveParticipantN < 2 && period.nUsed > 1) {
      diagnostics.push({
        code: "LOW_EFFECTIVE_PARTICIPANT_N",
        severity: "warning",
        message: "Weight concentration reduces the effective participant count below two.",
        path: `periods[${period.index}].effectiveParticipantN`
      });
    }
  }
  const hasInternalGap = periods.some(({ nUsed }, index) => nUsed === 0 && periods.slice(index + 1).some((later) => later.nUsed > 0));
  if (hasInternalGap) {
    diagnostics.push({
      code: "TRAJECTORY_GAP_BREAKS_PATH",
      severity: "warning",
      message: "Expected periods without a centroid are not bridged; downstream cumulative distance remains unavailable."
    });
  }
  if (series.input.cohortPolicy === "available") {
    const participantsByTime = new Map<string, string[]>();
    for (const participantPeriod of participantPeriods) {
      if (!participantPeriod.includedInCohort) continue;
      const participants = participantsByTime.get(participantPeriod.time.canonical) ?? [];
      participants.push(participantPeriod.participant.canonical);
      participantsByTime.set(participantPeriod.time.canonical, participants);
    }
    const signatures = periods.map((period) => (participantsByTime.get(period.time.canonical) ?? [])
      .sort(compareCanonical)
      .join("\u0000"));
    if (new Set(signatures).size > 1) {
      diagnostics.push({
        code: "CHANGING_AVAILABLE_COHORT",
        severity: "warning",
        message: "Participant composition changes across requested periods."
      });
    }
  }
  return diagnostics;
}

export function analyzeTrajectoryDynamicsV1(input: TrajectoryDynamicsInputV1): TrajectoryDynamicsResultV1 {
  const series = normalizeInput(input);
  const reduction = reduceParticipantPeriods(series);
  const weighted = series.input.estimand.kind === "weighted-participant-v1";
  const rawCountByTime = new Map<string, number>();
  for (const point of series.points) {
    rawCountByTime.set(point.time.canonical, (rawCountByTime.get(point.time.canonical) ?? 0) + 1);
  }
  const participantPeriodsByTime = new Map<string, TrajectoryParticipantPeriodV1[]>();
  for (const participantPeriod of reduction.participantPeriods) {
    const entries = participantPeriodsByTime.get(participantPeriod.time.canonical) ?? [];
    entries.push(participantPeriod);
    participantPeriodsByTime.set(participantPeriod.time.canonical, entries);
  }
  const periodRows = series.periods.map(({ key }, index) => {
    const nRows = rawCountByTime.get(key.canonical) ?? 0;
    const all = participantPeriodsByTime.get(key.canonical) ?? [];
    const used = all.filter(({ includedInCohort }) => includedInCohort);
    const centroid = finiteWeightedCentroid(used, series.dimensions.length, weighted);
    return { index, nRows, all, used, centroid };
  });
  const fullCentroids = periodRows.map(({ centroid }) => centroid.centroid);
  const selectedCentroids = fullCentroids.map((centroid) => centroid === null
    ? null
    : series.selectedIndexes.map((selected) => centroid[selected]!) as [number, number, number]);
  const selectedMetrics = pathMetrics(selectedCentroids, series.selectedDimensions, series.elapsedFromPrevious);
  const fullMetrics = pathMetrics(fullCentroids, series.dimensions, series.elapsedFromPrevious);
  const periods: TrajectoryPeriodDynamicsV1[] = periodRows.map(({ index, nRows, all, used, centroid }) => ({
    index,
    time: series.periods[index]!.key,
    timeValue: cloneTimeValue(series.periods[index]!.definition.value),
    elapsedFromPrevious: series.elapsedFromPrevious[index]!,
    elapsedFromStart: series.elapsedFromStart[index]!,
    selectedCentroid: selectedCentroids[index]!,
    fullCentroid: centroid.centroid,
    selected3d: selectedMetrics[index]!,
    fullSpace: fullMetrics[index]!,
    nRows,
    nParticipantPeriods: all.length,
    nUsed: used.length,
    nDuplicateRows: nRows - all.length,
    nCohortExcluded: all.length - used.length,
    weightSum: centroid.weightSum,
    effectiveParticipantN: centroid.effectiveParticipantN
  }));
  const diagnostics = buildDiagnostics(
    series,
    reduction.participantPeriods,
    periods,
    reduction.duplicateRows,
    reduction.cohortExcludedParticipants,
    reduction.timeVaryingWeights
  );
  return deepFreeze({
    schemaVersion: "3dena.trajectory-dynamics.v1",
    namespace: series.namespace,
    cohortPolicy: series.input.cohortPolicy,
    estimand: { ...series.input.estimand },
    dimensions: [...series.dimensions],
    selectedDimensions: [...series.selectedDimensions],
    timeContract: { ...series.timeContract },
    contracts: {
      duplicateReduction: "equal-row-coordinate-mean-before-centroid-v1",
      weightResolution: "constant-within-participant-period-v1",
      cohort: "available-or-complete-before-centroid-v1",
      distance: "euclidean-selected-and-full-space-v1",
      gap: "expected-period-no-bridge-v1",
      speed: "step-distance-divided-by-positive-adjacent-elapsed-v1"
    },
    participantPeriods: reduction.participantPeriods,
    periods,
    diagnostics,
    diagnosticSummary: diagnosticSummary(diagnostics),
    summary: {
      inputRows: series.points.length,
      participants: new Set(series.points.map(({ participant }) => participant.canonical)).size,
      participantPeriods: reduction.participantPeriods.length,
      periods: series.periods.length,
      observedPeriods: periods.filter(({ nParticipantPeriods }) => nParticipantPeriods > 0).length,
      missingPeriods: periods.filter(({ nParticipantPeriods }) => nParticipantPeriods === 0).length,
      duplicateRows: reduction.duplicateRows,
      cohortExcludedParticipants: reduction.cohortExcludedParticipants
    },
    evidence: {
      status: "IMPLEMENTED_UNVERIFIED",
      oracleParityClaim: false,
      scientificAuthority: "successor-definition-pending-review"
    },
    resolvedLimits: { ...series.limits }
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
