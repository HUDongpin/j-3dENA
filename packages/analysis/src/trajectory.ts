import {
  AnalysisValidationError,
  type AnalysisPoint,
  type Coordinates3D,
  type CoordinatesND,
  type EntityKey,
  type ParticipantPeriodPoint,
  type SharedSpaceTrajectories,
  type TrajectoryCentroid,
  type TrajectoryDisplayFilter,
  type TrajectoryDisplaySelection,
  type TrajectoryMapping,
  type TrajectoryPath,
  type TypedValue
} from "./types";
import { canonicalScalars, typedValue } from "./validation";

interface ReductionAccumulator {
  participant: EntityKey;
  participantLabel: EntityKey;
  group: TypedValue;
  time: TypedValue;
  sourcePointIndexes: number[];
  sums: Coordinates3D;
  fullSums: CoordinatesND;
}

function meanCoordinates(points: Coordinates3D[]): Coordinates3D {
  if (points.length === 0) return [0, 0, 0];
  const sums: Coordinates3D = [0, 0, 0];
  for (const point of points) {
    sums[0] += point[0];
    sums[1] += point[1];
    sums[2] += point[2];
  }
  return [sums[0] / points.length, sums[1] / points.length, sums[2] / points.length];
}

function meanCoordinatesND(points: CoordinatesND[], dimensions: number): CoordinatesND {
  if (points.length === 0) return Array.from({ length: dimensions }, () => 0);
  return Array.from({ length: dimensions }, (_, dimension) =>
    points.reduce((sum, point) => sum + (point[dimension] ?? 0), 0) / points.length
  );
}

function stableTypedValues(values: TypedValue[]): TypedValue[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.canonical)) return false;
    seen.add(value.canonical);
    return true;
  });
}

function participantPeriodKey(point: AnalysisPoint): string {
  return JSON.stringify([point.unit.canonical, point.time?.canonical]);
}

function participantInCompleteCohort(
  point: ParticipantPeriodPoint,
  periodsByGroupParticipant: Map<string, Set<string>>,
  expectedTimeKeys: Set<string>
): boolean {
  const key = JSON.stringify([point.group.canonical, point.participant.canonical]);
  const periods = periodsByGroupParticipant.get(key);
  if (!periods || periods.size !== expectedTimeKeys.size) return false;
  for (const expected of expectedTimeKeys) if (!periods.has(expected)) return false;
  return true;
}

export function buildSharedSpaceTrajectories(
  points: AnalysisPoint[],
  mapping: TrajectoryMapping,
  dimensions: string[]
): SharedSpaceTrajectories {
  const eligible = points.filter((point) => point.group && point.time);
  if (eligible.length !== points.length) {
    throw new Error("Trajectory construction requires a typed group and period on every model point.");
  }

  const groupOrder = stableTypedValues(eligible.map((point) => point.group!));
  const inferredTimeOrder = stableTypedValues(eligible.map((point) => point.time!));
  const timeOrder = mapping.timeOrder?.map(typedValue) ?? inferredTimeOrder;
  const timeKeys = new Set(timeOrder.map((time) => time.canonical));
  const reductions = new Map<string, ReductionAccumulator>();

  for (const point of eligible) {
    const group = point.group!;
    const time = point.time!;
    if (!timeKeys.has(time.canonical)) {
      throw new Error(`Observed period ${time.display} is absent from the validated time order.`);
    }
    const key = participantPeriodKey(point);
    const current = reductions.get(key);
    if (current) {
      if (current.group.canonical !== group.canonical) {
        throw new Error("A typed participant-period maps to multiple groups.");
      }
      current.sums[0] += point.coordinates[0];
      current.sums[1] += point.coordinates[1];
      current.sums[2] += point.coordinates[2];
      if (current.fullSums.length !== point.fullCoordinates.length) {
        throw new Error("Trajectory points do not share one full-dimensional rotation shape.");
      }
      point.fullCoordinates.forEach((value, dimension) => {
        current.fullSums[dimension] = (current.fullSums[dimension] ?? 0) + value;
      });
      current.sourcePointIndexes.push(point.index);
    } else {
      reductions.set(key, {
        participant: point.unit,
        participantLabel: point.participantLabel,
        group,
        time,
        sourcePointIndexes: [point.index],
        sums: [...point.coordinates],
        fullSums: [...point.fullCoordinates]
      });
    }
  }

  const participantPeriods: ParticipantPeriodPoint[] = [...reductions.values()].map((reduction, index) => ({
    index,
    participant: reduction.participant,
    participantLabel: reduction.participantLabel,
    group: reduction.group,
    time: reduction.time,
    coordinates: [
      reduction.sums[0] / reduction.sourcePointIndexes.length,
      reduction.sums[1] / reduction.sourcePointIndexes.length,
      reduction.sums[2] / reduction.sourcePointIndexes.length
    ],
    fullCoordinates: reduction.fullSums.map((value) => value / reduction.sourcePointIndexes.length),
    sourcePointIndexes: reduction.sourcePointIndexes,
    includedInCohort: true
  }));

  const cohortPolicy = mapping.cohortPolicy ?? "available";
  if (cohortPolicy === "complete") {
    const periodsByGroupParticipant = new Map<string, Set<string>>();
    for (const point of participantPeriods) {
      const key = JSON.stringify([point.group.canonical, point.participant.canonical]);
      const periods = periodsByGroupParticipant.get(key) ?? new Set<string>();
      periods.add(point.time.canonical);
      periodsByGroupParticipant.set(key, periods);
    }
    for (const point of participantPeriods) {
      point.includedInCohort = participantInCompleteCohort(point, periodsByGroupParticipant, timeKeys);
    }
  }

  const centroids: TrajectoryCentroid[] = [];
  const centroidIndexByGroupTime = new Map<string, number>();
  for (const group of groupOrder) {
    for (const time of timeOrder) {
      const members = participantPeriods.filter((point) =>
        point.includedInCohort && point.group.canonical === group.canonical && point.time.canonical === time.canonical
      );
      if (members.length === 0) continue;
      const index = centroids.length;
      const centroid: TrajectoryCentroid = {
        index,
        group,
        time,
        coordinates: meanCoordinates(members.map((member) => member.coordinates)),
        fullCoordinates: meanCoordinatesND(members.map((member) => member.fullCoordinates), dimensions.length),
        participantCount: members.length,
        participantPeriodIndexes: members.map((member) => member.index)
      };
      centroids.push(centroid);
      centroidIndexByGroupTime.set(JSON.stringify([group.canonical, time.canonical]), index);
    }
  }

  const paths: TrajectoryPath[] = groupOrder.map((group) => ({
    group,
    steps: timeOrder.map((time) => ({
      time,
      centroidIndex: centroidIndexByGroupTime.get(JSON.stringify([group.canonical, time.canonical])) ?? null
    }))
  }));

  return {
    space: "analysis-result-rotation",
    dimensions: [...dimensions],
    cohortPolicy,
    groupOrder,
    timeOrder,
    participantPeriods,
    centroids,
    paths
  };
}

/**
 * Selects already-computed trajectory rows for presentation. This function
 * has no raw rows, jENA options, or model callback, so it cannot refit SVD or
 * recompute centroids. Returned centroid/path objects retain their identities.
 */
export function selectTrajectoryDisplay(
  trajectory: SharedSpaceTrajectories,
  filter: TrajectoryDisplayFilter = {}
): TrajectoryDisplaySelection {
  const requested = filter.groups ?? trajectory.groupOrder.map((group) => group.canonical);
  const requestedSet = new Set(requested);
  if (requestedSet.size !== requested.length) {
    throw new AnalysisValidationError([{ code: "DUPLICATE_DISPLAY_GROUP", path: "filter.groups", message: "must not contain duplicate canonical group keys" }]);
  }
  const known = new Set(trajectory.groupOrder.map((group) => group.canonical));
  const unknown = requested.filter((group) => !known.has(group));
  if (unknown.length > 0) {
    throw new AnalysisValidationError([{ code: "UNKNOWN_DISPLAY_GROUP", path: "filter.groups", message: `unknown canonical group key ${JSON.stringify(unknown[0])}` }]);
  }
  return {
    space: trajectory.space,
    groupOrder: trajectory.groupOrder.filter((group) => requestedSet.has(group.canonical)),
    timeOrder: trajectory.timeOrder,
    centroids: trajectory.centroids.filter((centroid) => requestedSet.has(centroid.group.canonical)),
    paths: trajectory.paths.filter((path) => requestedSet.has(path.group.canonical))
  };
}
