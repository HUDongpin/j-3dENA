import {
  AnalysisValidationError,
  type AnalysisDisplayDimensions,
  type AnalysisDisplayFilter,
  type AnalysisDisplaySelection,
  type AnalysisResult,
  type Coordinates3D
} from "./types";

function reject(code: string, path: string, message: string): never {
  throw new AnalysisValidationError([{ code, path, message }]);
}

function selectDimensions(
  result: AnalysisResult,
  requested: AnalysisDisplayFilter["dimensions"]
): { names: AnalysisDisplayDimensions; indexes: [number, number, number] } {
  const names = requested ?? [...result.axes];
  if (!Array.isArray(names) || names.length !== 3 || names.some((name) => typeof name !== "string" || name.trim() === "")) {
    reject("INVALID_DISPLAY_DIMENSIONS", "filter.dimensions", "must contain exactly three non-empty dimension names");
  }
  if (new Set(names).size !== 3) {
    reject("DUPLICATE_DISPLAY_DIMENSION", "filter.dimensions", "must contain three distinct dimension names");
  }
  const indexes = names.map((name) => result.dimensions.indexOf(name));
  const missing = indexes.findIndex((index) => index < 0);
  if (missing >= 0) {
    reject("UNKNOWN_DISPLAY_DIMENSION", `filter.dimensions[${missing}]`, `${JSON.stringify(names[missing])} is not present in result.dimensions`);
  }
  return {
    names: [...names] as AnalysisDisplayDimensions,
    indexes: indexes as [number, number, number]
  };
}

function project(values: number[], indexes: [number, number, number], path: string): Coordinates3D {
  const selected = indexes.map((index) => values[index]) as Coordinates3D;
  if (selected.some((value) => !Number.isFinite(value))) {
    reject("INVALID_DISPLAY_COORDINATE", path, "selected full-space coordinates must be finite");
  }
  return selected;
}

/**
 * Selects existing coordinates for presentation without raw rows, jENA, or a
 * model callback. The source result and its formal-export rows are untouched.
 */
export function selectAnalysisDisplay(
  result: AnalysisResult,
  filter: AnalysisDisplayFilter = {}
): AnalysisDisplaySelection {
  const dimensions = selectDimensions(result, filter.dimensions);
  const knownGroups = new Set(result.trajectory?.groupOrder.map((group) => group.canonical) ?? []);
  const requestedGroups = filter.groups ?? [...knownGroups];
  if (!Array.isArray(requestedGroups) || requestedGroups.some((group) => typeof group !== "string" || group.length === 0)) {
    reject("INVALID_DISPLAY_GROUP", "filter.groups", "must be an array of canonical group keys");
  }
  if (new Set(requestedGroups).size !== requestedGroups.length) {
    reject("DUPLICATE_DISPLAY_GROUP", "filter.groups", "must not contain duplicate canonical group keys");
  }
  const unknownGroup = requestedGroups.find((group) => !knownGroups.has(group));
  if (unknownGroup !== undefined) {
    reject("UNKNOWN_DISPLAY_GROUP", "filter.groups", `unknown canonical group key ${JSON.stringify(unknownGroup)}`);
  }
  const selectedGroups = new Set(requestedGroups);
  const includesPoint = (group: string | undefined) => filter.groups === undefined || (group !== undefined && selectedGroups.has(group));

  const points = result.points
    .filter((point) => includesPoint(point.group?.canonical))
    .map((point) => ({
      pointIndex: point.index,
      id: point.id,
      ...(point.group ? { group: point.group } : {}),
      ...(point.time ? { time: point.time } : {}),
      coordinates: project(point.fullCoordinates, dimensions.indexes, `result.points[${point.index}].fullCoordinates`)
    }));
  const nodes = result.nodes.map((node) => ({
    nodeIndex: node.index,
    code: node.code,
    coordinates: project(node.fullCoordinates, dimensions.indexes, `result.nodes[${node.index}].fullCoordinates`)
  }));

  const trajectory = result.trajectory;
  return {
    space: "analysis-result-rotation-display",
    dimensions: dimensions.names,
    points,
    nodes,
    ...(trajectory
      ? {
          trajectory: {
            cohortPolicy: trajectory.cohortPolicy,
            groupOrder: trajectory.groupOrder.filter((group) => selectedGroups.has(group.canonical)),
            timeOrder: trajectory.timeOrder,
            participantPeriods: trajectory.participantPeriods
              .filter((point) => selectedGroups.has(point.group.canonical))
              .map((point) => ({
                participantPeriodIndex: point.index,
                participant: point.participant,
                group: point.group,
                time: point.time,
                coordinates: project(point.fullCoordinates, dimensions.indexes, `result.trajectory.participantPeriods[${point.index}].fullCoordinates`),
                includedInCohort: point.includedInCohort
              })),
            centroids: trajectory.centroids
              .filter((centroid) => selectedGroups.has(centroid.group.canonical))
              .map((centroid) => ({
                centroidIndex: centroid.index,
                group: centroid.group,
                time: centroid.time,
                coordinates: project(centroid.fullCoordinates, dimensions.indexes, `result.trajectory.centroids[${centroid.index}].fullCoordinates`),
                participantCount: centroid.participantCount
              })),
            paths: trajectory.paths.filter((path) => selectedGroups.has(path.group.canonical))
          }
        }
      : {})
  };
}
