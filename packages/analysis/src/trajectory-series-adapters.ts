import type { PreparedEntityKey, PreparedSpaceResult, PreparedTypedValue } from "./prepared-types";
import {
  TrajectoryStatisticsError,
  type TrajectoryIdentity,
  type TrajectoryIdentityComponent,
  type TrajectorySeriesInput,
  type TrajectoryScalarType
} from "./trajectory-statistics";
import type { AnalysisResult, EntityKey, RawScalar, TypedValue } from "./types";

export interface TrajectorySeriesAdapterOptions {
  /** Canonical group key from the source result's trajectory group order. */
  group: string;
  namespace: string;
  /** Unit identity is the default; paired cross-group work must opt into the caller-confirmed participant label. */
  participantIdentity?: "unit" | "participant-label";
}

function reject(code: string, path: string, message: string): never {
  throw new TrajectoryStatisticsError(code, path, message);
}

function scalarType(value: RawScalar, path: string): TrajectoryScalarType {
  if (value === null) reject("MISSING_ADAPTER_IDENTITY", path, "trajectory identities must not be null");
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (!Number.isFinite(value)) reject("NON_FINITE_ADAPTER_IDENTITY", path, "numeric trajectory identities must be finite");
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) reject("UNSAFE_ADAPTER_IDENTITY", path, "unsafe integer identities must be source strings");
  return "number";
}

function rawEntityIdentity(key: EntityKey, path: string): TrajectoryIdentity {
  if (key.columns.length !== key.values.length) reject("ADAPTER_IDENTITY_SHAPE", path, "columns and values must align");
  return {
    components: key.columns.map((name, index) => {
      const value = key.values[index] ?? null;
      return { name, type: scalarType(value, `${path}.${name}`), value: value as string | number | boolean };
    })
  };
}

function preparedEntityIdentity(key: PreparedEntityKey, path: string): TrajectoryIdentity {
  if (key.columns.length !== key.values.length || key.columnTypes.length !== key.values.length) reject("ADAPTER_IDENTITY_SHAPE", path, "columns, declared types, and values must align");
  return {
    components: key.columns.map((name, index) => {
      const value = key.values[index] ?? null;
      return {
        name,
        type: scalarType(value, `${path}.${name}`),
        value: value as string | number | boolean,
        declaredType: key.columnTypes[index]!
      };
    })
  };
}

function rawTimeIdentity(value: TypedValue): TrajectoryIdentity {
  return {
    components: [{ name: "time", type: scalarType(value.value, "time"), value: value.value as string | number | boolean }]
  };
}

function preparedTimeIdentity(value: PreparedTypedValue): TrajectoryIdentity {
  return {
    components: [{
      name: value.column,
      type: scalarType(value.value, `time.${value.column}`),
      value: value.value as string | number | boolean,
      declaredType: value.columnType
    }]
  };
}

function validateOptions(options: TrajectorySeriesAdapterOptions): void {
  if (!options || typeof options.group !== "string" || options.group.length === 0) reject("INVALID_ADAPTER_GROUP", "options.group", "must be a canonical group key");
  if (typeof options.namespace !== "string" || options.namespace.trim() === "") reject("INVALID_TRAJECTORY_NAMESPACE", "options.namespace", "must be non-empty");
  if (options.participantIdentity !== undefined && options.participantIdentity !== "unit" && options.participantIdentity !== "participant-label") {
    reject("INVALID_PARTICIPANT_IDENTITY", "options.participantIdentity", "must be unit or participant-label");
  }
}

/**
 * Copies one already-computed raw-analysis group into the statistics contract.
 * Full-space coordinates come from the same jENA fit as the selected axes;
 * this adapter never projects or refits the source result.
 */
export function adaptAnalysisResultTrajectorySeries(
  result: AnalysisResult,
  options: TrajectorySeriesAdapterOptions
): TrajectorySeriesInput {
  validateOptions(options);
  const trajectory = result.trajectory;
  if (!trajectory) reject("MISSING_SOURCE_TRAJECTORY", "result.trajectory", "must be present before adapting a group path");
  if (!trajectory.groupOrder.some((group) => group.canonical === options.group)) reject("UNKNOWN_ADAPTER_GROUP", "options.group", "is not present in the source result");
  const points = result.points.filter((point) => point.group?.canonical === options.group);
  if (points.length === 0) reject("EMPTY_ADAPTER_GROUP", "options.group", "contains no source points");
  return {
    namespace: options.namespace,
    dimensions: [...result.dimensions],
    selectedDimensions: [...result.axes],
    timeOrder: trajectory.timeOrder.map(rawTimeIdentity),
    cohortPolicy: trajectory.cohortPolicy,
    points: points.map((point) => {
      if (!point.time) reject("MISSING_ADAPTER_TIME", `result.points[${point.index}].time`, "must be present for trajectory statistics");
      return {
        participant: rawEntityIdentity(
          options.participantIdentity === "participant-label" ? point.participantLabel : point.unit,
          `result.points[${point.index}].${options.participantIdentity === "participant-label" ? "participantLabel" : "unit"}`,
        ),
        time: rawTimeIdentity(point.time),
        coordinates: [...point.fullCoordinates]
      };
    })
  };
}

/** Copies one prepared-space group without projecting, rotating, or refitting coordinates. */
export function adaptPreparedSpaceTrajectorySeries(
  result: PreparedSpaceResult,
  options: TrajectorySeriesAdapterOptions
): TrajectorySeriesInput {
  validateOptions(options);
  const trajectory = result.displaySpace.trajectory;
  if (!trajectory.groupOrder.some((group) => group.canonical === options.group)) reject("UNKNOWN_ADAPTER_GROUP", "options.group", "is not present in the prepared result");
  const points = result.fullSpace.points.filter((point) => point.group.canonical === options.group);
  if (points.length === 0) reject("EMPTY_ADAPTER_GROUP", "options.group", "contains no prepared points");
  return {
    namespace: options.namespace,
    dimensions: [...result.fullSpace.dimensions],
    selectedDimensions: [...result.displaySpace.dimensions],
    timeOrder: trajectory.timeOrder.map(preparedTimeIdentity),
    cohortPolicy: trajectory.cohortPolicy,
    points: points.map((point) => ({
      participant: preparedEntityIdentity(point.participant, `result.fullSpace.points[${point.index}].participant`),
      time: preparedTimeIdentity(point.time),
      coordinates: [...point.coordinates]
    }))
  };
}
