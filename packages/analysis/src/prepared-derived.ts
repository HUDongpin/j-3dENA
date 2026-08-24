import type {
  ChangeNetworkResultV1,
  ChangeNetworkSelectorV1,
  NetworkMeanEdgeV1,
  NetworkMeanV1,
  NetworkComparisonResultV1,
} from "./network-analysis";
import type {
  PreparedSpaceEdge,
  PreparedSpacePoint,
  PreparedSpaceResult,
  PreparedTypedValue,
} from "./prepared-types";
import type { AnalysisDiagnostic, RawScalar, TypedValue } from "./types";

const SHA256 = /^[a-f0-9]{64}$/u;

export class PreparedDerivedAnalysisError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "PreparedDerivedAnalysisError";
    this.code = code;
    this.path = path;
  }
}

function reject(code: string, path: string, message: string): never {
  throw new PreparedDerivedAnalysisError(code, path, message);
}

function finiteMean(values: readonly number[], path: string): number {
  if (values.length === 0) reject("EMPTY_PREPARED_SELECTION", path, "contains no prepared points");
  const scale = values.reduce((maximum, value) => {
    if (!Number.isFinite(value)) reject("NON_FINITE_PREPARED_SOURCE", path, "contains a non-finite value");
    return Math.max(maximum, Math.abs(value));
  }, 0) || 1;
  let sum = 0;
  let correction = 0;
  for (const value of values) {
    const normalized = value / scale;
    const next = sum + normalized;
    if (Math.abs(sum) >= Math.abs(normalized)) correction += (sum - next) + normalized;
    else correction += (normalized - next) + sum;
    sum = next;
  }
  const mean = ((sum + correction) / values.length) * scale;
  if (!Number.isFinite(mean)) reject("PREPARED_NUMERIC_OVERFLOW", path, "mean is outside the finite numeric range");
  return mean;
}

function scalarCanonical(value: RawScalar, path = "selector.level"): string {
  if (value === null) return JSON.stringify(["null"]);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) reject("NON_FINITE_PREPARED_LEVEL", path, "must be finite");
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      reject("UNSAFE_PREPARED_LEVEL", path, "unsafe integer identities must be supplied as source strings");
    }
    if (Object.is(value, -0)) return JSON.stringify(["number", "-0"]);
  }
  return JSON.stringify([typeof value, value]);
}

function typedValue(value: PreparedTypedValue): TypedValue {
  return { canonical: value.canonical, display: value.display, value: value.value };
}

/**
 * Validates the immutable prepared reduction boundary without claiming that
 * imported coordinates were recomputed from raw rows.
 */
export function assertPreparedDerivedSource(result: PreparedSpaceResult): void {
  if (!result || typeof result !== "object" || result.schemaVersion !== "3dena.prepared-space-result.v1") {
    reject("INVALID_PREPARED_SOURCE", "result.schemaVersion", "must be 3dena.prepared-space-result.v1");
  }
  const provenance = result.provenance;
  if (
    result.sourceKind !== "prepared-exchange"
    || result.rawJenaRecompute !== false
    || !provenance
    || typeof provenance !== "object"
    || provenance.jenaExecuted !== false
    || provenance.coordinateSpace !== "precomputed-import"
    || provenance.computation !== "reduction-only"
  ) {
    reject(
      "INVALID_PREPARED_BOUNDARY",
      "result",
      "must remain a precomputed prepared exchange with jENA execution disabled",
    );
  }
  const sourceReceipt = result.sourceReceipt;
  if (
    !sourceReceipt
    || typeof sourceReceipt !== "object"
    || !SHA256.test(sourceReceipt.sha256)
    || !Number.isSafeInteger(sourceReceipt.byteLength)
    || sourceReceipt.byteLength < 1
  ) {
    reject("INVALID_PREPARED_RECEIPT", "result.sourceReceipt", "must contain an exact SHA-256 and positive byte length");
  }
  const fullSpace = result.fullSpace;
  if (!fullSpace || typeof fullSpace !== "object") {
    reject("INVALID_PREPARED_FULL_SPACE", "result.fullSpace", "must contain the imported full-space reduction");
  }
  const { dimensions, points, edges, lineWeights } = fullSpace;
  if (!Array.isArray(dimensions) || dimensions.length === 0 || dimensions.some((dimension) => typeof dimension !== "string" || dimension.trim() === "")) {
    reject("INVALID_PREPARED_DIMENSIONS", "result.fullSpace.dimensions", "must contain non-empty dimension names");
  }
  if (new Set(dimensions).size !== dimensions.length) {
    reject("DUPLICATE_PREPARED_DIMENSION", "result.fullSpace.dimensions", "must not contain duplicates");
  }
  if (!Array.isArray(points) || points.length === 0) reject("EMPTY_PREPARED_POINT_SET", "result.fullSpace.points", "must not be empty");
  if (!Array.isArray(edges) || edges.length === 0) reject("EMPTY_PREPARED_EDGE_SET", "result.fullSpace.edges", "must not be empty");
  if (
    !lineWeights
    || typeof lineWeights !== "object"
    || !Array.isArray(lineWeights.rowKeys)
    || !Array.isArray(lineWeights.values)
    || !Array.isArray(lineWeights.columns)
    || lineWeights.rowKeys.length !== points.length
    || lineWeights.values.length !== points.length
    || lineWeights.columns.length !== edges.length
  ) {
    reject(
      "MISALIGNED_PREPARED_LINE_WEIGHTS",
      "result.fullSpace.lineWeights",
      "row keys, values, columns, points, and edges must remain exactly aligned",
    );
  }
  const pointKeys = new Set<string>();
  points.forEach((point, index) => {
    if (!point || typeof point !== "object") {
      reject("INVALID_PREPARED_POINT", `result.fullSpace.points[${index}]`, "must be an object");
    }
    if (point.index !== index) reject("MISALIGNED_PREPARED_POINT_ORDER", `result.fullSpace.points[${index}].index`, "must equal its array position");
    if (
      typeof point.id?.canonical !== "string"
      || point.id.canonical.length === 0
      || typeof point.participant?.canonical !== "string"
      || point.participant.canonical.length === 0
      || typeof point.participantLabel?.canonical !== "string"
      || point.participantLabel.canonical.length === 0
      || typeof point.group?.canonical !== "string"
      || point.group.canonical.length === 0
      || typeof point.time?.canonical !== "string"
      || point.time.canonical.length === 0
    ) {
      reject("INVALID_PREPARED_POINT_IDENTITY", `result.fullSpace.points[${index}]`, "must preserve non-empty point, participant, label, group, and time identities");
    }
    if (pointKeys.has(point.id.canonical)) {
      reject("DUPLICATE_PREPARED_POINT_IDENTITY", `result.fullSpace.points[${index}].id`, "duplicates an earlier prepared point identity");
    }
    pointKeys.add(point.id.canonical);
    if (!Array.isArray(point.coordinates) || point.coordinates.length !== dimensions.length || point.coordinates.some((value) => !Number.isFinite(value))) {
      reject("INVALID_PREPARED_COORDINATES", `result.fullSpace.points[${index}].coordinates`, "must contain one finite value per dimension");
    }
    if (lineWeights.rowKeys[index]?.canonical !== point.id.canonical) {
      reject("MISALIGNED_PREPARED_IDENTITY", `result.fullSpace.lineWeights.rowKeys[${index}]`, "must match the exact point identity and order");
    }
    const weights = lineWeights.values[index];
    if (!weights || weights.length !== edges.length || weights.some((value) => !Number.isFinite(value))) {
      reject("INVALID_PREPARED_LINE_WEIGHT_ROW", `result.fullSpace.lineWeights.values[${index}]`, "must contain one finite value per edge");
    }
  });
  const edgeKeys = new Set<string>();
  edges.forEach((edge, index) => {
    if (!edge || typeof edge !== "object" || typeof edge.id !== "string" || edge.id.length === 0 || typeof edge.column !== "string" || edge.column.length === 0) {
      reject("INVALID_PREPARED_EDGE", `result.fullSpace.edges[${index}]`, "must preserve non-empty edge and column identities");
    }
    if (edge.index !== index || lineWeights.columns[index] !== edge.column) {
      reject("MISALIGNED_PREPARED_EDGE_ORDER", `result.fullSpace.edges[${index}]`, "must preserve imported edge and line-weight column order");
    }
    const edgeKey = JSON.stringify([edge.id, edge.column]);
    if (edgeKeys.has(edgeKey)) {
      reject("DUPLICATE_PREPARED_EDGE_IDENTITY", `result.fullSpace.edges[${index}]`, "duplicates an earlier prepared edge identity");
    }
    edgeKeys.add(edgeKey);
  });
  if (!result.displaySpace?.trajectory || !Array.isArray(result.displaySpace.trajectory.groupOrder)) {
    reject("INVALID_PREPARED_GROUP_ORDER", "result.displaySpace.trajectory.groupOrder", "must preserve the prepared canonical group inventory");
  }
}

export function preparedReductionDiagnostic(): AnalysisDiagnostic {
  return {
    code: "PREPARED_PRECOMPUTED_REDUCTION",
    severity: "info",
    message: "This task reduces imported prepared coordinates and line weights only; it does not execute jENA or establish raw-row parity.",
    path: "sourceKind",
  };
}

export function preparedGroupValue(
  result: PreparedSpaceResult,
  canonical: string,
  path: string,
): TypedValue {
  if (typeof canonical !== "string" || canonical.trim() === "") {
    reject("INVALID_PREPARED_GROUP", path, "must be a non-empty canonical group key");
  }
  const value = result.displaySpace.trajectory.groupOrder.find((candidate) => candidate.canonical === canonical)
    ?? result.fullSpace.points.find((point) => point.group.canonical === canonical)?.group;
  if (!value) reject("UNKNOWN_PREPARED_GROUP", path, "is not present in the prepared result");
  return typedValue(value);
}

export function preparedPointsForGroup(
  result: PreparedSpaceResult,
  canonical: string,
  path: string,
): PreparedSpacePoint[] {
  preparedGroupValue(result, canonical, path);
  const points = result.fullSpace.points.filter((point) => point.group.canonical === canonical);
  if (points.length === 0) reject("EMPTY_PREPARED_GROUP", path, "contains no prepared points");
  return points;
}

export function preparedDimensionIndex(
  result: PreparedSpaceResult,
  dimension: string,
  path: string,
): number {
  const index = result.fullSpace.dimensions.indexOf(dimension);
  if (index < 0) reject("UNKNOWN_PREPARED_DIMENSION", path, `is not present in the imported full space: ${JSON.stringify(dimension)}`);
  return index;
}

function rowIndexByPoint(result: PreparedSpaceResult): Map<string, number> {
  return new Map(result.fullSpace.lineWeights.rowKeys.map((key, index) => [key.canonical, index]));
}

function preparedEdgeMean(
  result: PreparedSpaceResult,
  edge: PreparedSpaceEdge,
  points: readonly PreparedSpacePoint[],
  rows: ReadonlyMap<string, number>,
): NetworkMeanEdgeV1 {
  return {
    index: edge.index,
    id: edge.id,
    column: edge.column,
    source: edge.source,
    target: edge.target,
    meanWeight: finiteMean(points.map((point) => {
      const row = rows.get(point.id.canonical);
      if (row === undefined) reject("MISSING_PREPARED_LINE_WEIGHT_ROW", `point.${point.id.canonical}`, "does not have an aligned line-weight row");
      return result.fullSpace.lineWeights.values[row]![edge.index]!;
    }), `edges[${edge.index}]`),
  };
}

function preparedNetworkMean(
  result: PreparedSpaceResult,
  points: readonly PreparedSpacePoint[],
): NetworkMeanV1 {
  if (points.length === 0) reject("EMPTY_PREPARED_SELECTION", "selection", "contains no prepared points");
  const rows = rowIndexByPoint(result);
  return {
    pointCount: points.length,
    pointIndexes: points.map((point) => point.index),
    meanCoordinates: result.fullSpace.dimensions.map((_, dimensionIndex) =>
      finiteMean(points.map((point) => point.coordinates[dimensionIndex]!), `dimensions[${dimensionIndex}]`)),
    edges: result.fullSpace.edges.map((edge) => preparedEdgeMean(result, edge, points, rows)),
  };
}

export function comparePreparedGroupNetworks(
  result: PreparedSpaceResult,
  groups: readonly [string, string],
): NetworkComparisonResultV1 {
  assertPreparedDerivedSource(result);
  if (!Array.isArray(groups) || groups.length !== 2 || groups[0] === groups[1]) {
    reject("INVALID_PREPARED_GROUP_PAIR", "groups", "must contain two different canonical groups");
  }
  const groupA = preparedGroupValue(result, groups[0], "groups[0]");
  const groupB = preparedGroupValue(result, groups[1], "groups[1]");
  const meanA = preparedNetworkMean(result, preparedPointsForGroup(result, groupA.canonical, "groups[0]"));
  const meanB = preparedNetworkMean(result, preparedPointsForGroup(result, groupB.canonical, "groups[1]"));
  return {
    schemaVersion: "3dena.network-comparison.v1",
    direction: "group-a-minus-group-b",
    groupA,
    groupB,
    meanA,
    meanB,
    differenceEdges: meanA.edges.map((edgeA, index) => {
      const edgeB = meanB.edges[index]!;
      const difference = edgeA.meanWeight - edgeB.meanWeight;
      return {
        ...edgeA,
        meanWeight: difference,
        groupAMeanWeight: edgeA.meanWeight,
        groupBMeanWeight: edgeB.meanWeight,
        semanticOwner: difference > 0 ? "group-a" : difference < 0 ? "group-b" : "equal",
      };
    }),
    diagnostics: [
      preparedReductionDiagnostic(),
      {
        code: "PREPARED_CONFIDENCE_BOX_WITHHELD",
        severity: "warning",
        message: "No prepared-space confidence-box authority is configured; this comparison reports exact descriptive mean differences only.",
        path: "confidenceBox",
      },
    ],
  };
}

function selectedValue(point: PreparedSpacePoint, field: string): RawScalar | undefined {
  if (field === "@group") return point.group.value;
  if (field === "@time") return point.time.value;
  return point.metadata[field];
}

export function analyzePreparedChangeNetwork(
  result: PreparedSpaceResult,
  selector: ChangeNetworkSelectorV1,
): ChangeNetworkResultV1 {
  assertPreparedDerivedSource(result);
  if (!selector || typeof selector.field !== "string" || selector.field.trim() === "") {
    reject("INVALID_PREPARED_CHANGE_FIELD", "selector.field", "must be a non-empty metadata column name, @group, or @time");
  }
  const levelCanonical = scalarCanonical(selector.level);
  const selected = result.fullSpace.points.filter((point) => {
    const value = selectedValue(point, selector.field);
    return value !== undefined && scalarCanonical(value) === levelCanonical;
  });
  if (selected.length === 0) reject("UNKNOWN_PREPARED_CHANGE_LEVEL", "selector.level", "does not select any prepared points");
  return {
    schemaVersion: "3dena.change-network.v1",
    selector: { field: selector.field, level: selector.level },
    levelCanonical,
    mean: preparedNetworkMean(result, selected),
    diagnostics: [
      preparedReductionDiagnostic(),
      {
        code: "PREPARED_CHANGE_INFERENCE_WITHHELD",
        severity: "warning",
        message: "This is one exact prepared level-network reduction; it is not a longitudinal contrast and carries no inferential interval.",
        path: "selector",
      },
    ],
  };
}
