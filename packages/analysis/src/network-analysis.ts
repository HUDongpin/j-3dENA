import type {
  AnalysisDiagnostic,
  AnalysisEdge,
  AnalysisPoint,
  AnalysisResult,
  RawScalar,
  TypedValue,
} from "./types";

export interface NetworkMeanEdgeV1 {
  index: number;
  id: string;
  column: string;
  source: string;
  target: string;
  meanWeight: number;
}

export interface NetworkMeanV1 {
  pointCount: number;
  pointIndexes: number[];
  meanCoordinates: number[];
  edges: NetworkMeanEdgeV1[];
}

export interface NetworkDifferenceEdgeV1 extends NetworkMeanEdgeV1 {
  groupAMeanWeight: number;
  groupBMeanWeight: number;
  /** Positive values belong to A; negative values belong to B. */
  semanticOwner: "group-a" | "group-b" | "equal";
}

export interface NetworkComparisonResultV1 {
  schemaVersion: "3dena.network-comparison.v1";
  direction: "group-a-minus-group-b";
  groupA: TypedValue;
  groupB: TypedValue;
  meanA: NetworkMeanV1;
  meanB: NetworkMeanV1;
  differenceEdges: NetworkDifferenceEdgeV1[];
  diagnostics: AnalysisDiagnostic[];
}

export interface ChangeNetworkSelectorV1 {
  /** Metadata column name, or `@group` for the analysis group identity. */
  field: string;
  /** Exact raw scalar identity; string rendering is never used for matching. */
  level: RawScalar;
}

export interface ChangeNetworkResultV1 {
  schemaVersion: "3dena.change-network.v1";
  selector: ChangeNetworkSelectorV1;
  levelCanonical: string;
  mean: NetworkMeanV1;
  diagnostics: AnalysisDiagnostic[];
}

export class NetworkAnalysisError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "NetworkAnalysisError";
    this.code = code;
    this.path = path;
  }
}

function reject(code: string, path: string, message: string): never {
  throw new NetworkAnalysisError(code, path, message);
}

function rawScalarCanonical(value: RawScalar): string {
  if (value === null) return JSON.stringify(["null"]);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) reject("NON_FINITE_LEVEL", "selector.level", "must be finite");
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      reject("UNSAFE_INTEGER_LEVEL", "selector.level", "unsafe integer identities must be supplied as source strings");
    }
    if (Object.is(value, -0)) return JSON.stringify(["number", "-0"]);
  }
  return JSON.stringify([typeof value, value]);
}

function validateSource(result: AnalysisResult): void {
  if (!result || result.schemaVersion !== "3dena.analysis-result.v1") {
    reject("INVALID_SOURCE_RESULT", "result", "must be a validated raw analysis result");
  }
  if (result.edges.length === 0) reject("EMPTY_EDGE_SET", "result.edges", "must contain at least one edge");
  if (result.points.length === 0) reject("EMPTY_POINT_SET", "result.points", "must contain at least one point");
  if (result.dimensions.length === 0) reject("EMPTY_DIMENSION_SET", "result.dimensions", "must contain at least one dimension");
  for (const point of result.points) {
    if (point.lineWeights.length !== result.edges.length) {
      reject("MISALIGNED_LINE_WEIGHTS", `result.points[${point.index}].lineWeights`, "must align one-to-one with result.edges");
    }
    if (point.fullCoordinates.length !== result.dimensions.length) {
      reject("MISALIGNED_COORDINATES", `result.points[${point.index}].fullCoordinates`, "must align one-to-one with result.dimensions");
    }
  }
}

function mean(values: number[], path: string): number {
  if (values.length === 0) reject("EMPTY_NETWORK_SELECTION", path, "contains no analysis points");
  let sum = 0;
  let correction = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) reject("NON_FINITE_SOURCE_VALUE", path, "contains a non-finite model value");
    const adjusted = value - correction;
    const next = sum + adjusted;
    correction = next - sum - adjusted;
    sum = next;
  }
  return sum / values.length;
}

function edgeMean(edge: AnalysisEdge, points: AnalysisPoint[]): NetworkMeanEdgeV1 {
  return {
    index: edge.index,
    id: edge.id,
    column: edge.column,
    source: edge.source,
    target: edge.target,
    meanWeight: mean(points.map((point) => point.lineWeights[edge.index]!), `edges[${edge.index}]`),
  };
}

function networkMean(result: AnalysisResult, points: AnalysisPoint[]): NetworkMeanV1 {
  if (points.length === 0) reject("EMPTY_NETWORK_SELECTION", "selection", "contains no analysis points");
  return {
    pointCount: points.length,
    pointIndexes: points.map((point) => point.index),
    meanCoordinates: result.dimensions.map((_, dimensionIndex) =>
      mean(points.map((point) => point.fullCoordinates[dimensionIndex]!), `dimensions[${dimensionIndex}]`),
    ),
    edges: result.edges.map((edge) => edgeMean(edge, points)),
  };
}

function groupValue(result: AnalysisResult, canonical: string, path: string): TypedValue {
  if (typeof canonical !== "string" || canonical.length === 0) reject("INVALID_GROUP", path, "must be a non-empty canonical group key");
  const group = result.trajectory?.groupOrder.find((candidate) => candidate.canonical === canonical)
    ?? result.points.find((point) => point.group?.canonical === canonical)?.group;
  if (!group) reject("UNKNOWN_GROUP", path, "is not present in the source result");
  return group;
}

/**
 * Computes the formal `mean(groupA) - mean(groupB)` network over already fitted
 * point line weights. It never refits jENA and preserves source edge order.
 */
export function compareGroupNetworks(
  result: AnalysisResult,
  groups: readonly [string, string],
): NetworkComparisonResultV1 {
  validateSource(result);
  if (!Array.isArray(groups) || groups.length !== 2) reject("INVALID_GROUP_PAIR", "groups", "must contain exactly two canonical group keys");
  if (groups[0] === groups[1]) reject("IDENTICAL_GROUPS", "groups", "must select two different groups");
  const groupA = groupValue(result, groups[0], "groups[0]");
  const groupB = groupValue(result, groups[1], "groups[1]");
  const meanA = networkMean(result, result.points.filter((point) => point.group?.canonical === groupA.canonical));
  const meanB = networkMean(result, result.points.filter((point) => point.group?.canonical === groupB.canonical));
  const differenceEdges = meanA.edges.map((edgeA, index): NetworkDifferenceEdgeV1 => {
    const edgeB = meanB.edges[index]!;
    const difference = edgeA.meanWeight - edgeB.meanWeight;
    return {
      ...edgeA,
      meanWeight: difference,
      groupAMeanWeight: edgeA.meanWeight,
      groupBMeanWeight: edgeB.meanWeight,
      semanticOwner: difference > 0 ? "group-a" : difference < 0 ? "group-b" : "equal",
    };
  });
  return {
    schemaVersion: "3dena.network-comparison.v1",
    direction: "group-a-minus-group-b",
    groupA: { ...groupA },
    groupB: { ...groupB },
    meanA,
    meanB,
    differenceEdges,
    diagnostics: [{
      code: "CONFIDENCE_BOX_PENDING_AUTHORITY",
      severity: "warning",
      message: "Confidence-box inference is withheld until its scientific authority and interval contract are approved.",
      path: "confidenceBox",
    }],
  };
}

/** Selects one exact metadata/group level and computes its mean network. */
export function analyzeChangeNetwork(
  result: AnalysisResult,
  selector: ChangeNetworkSelectorV1,
): ChangeNetworkResultV1 {
  validateSource(result);
  if (!selector || typeof selector.field !== "string" || selector.field.trim() === "") {
    reject("INVALID_CHANGE_FIELD", "selector.field", "must be a non-empty metadata column name or @group");
  }
  const levelCanonical = rawScalarCanonical(selector.level);
  const selected = result.points.filter((point) => {
    const value = selector.field === "@group" ? point.group?.value : point.metadata[selector.field];
    return value !== undefined && rawScalarCanonical(value) === levelCanonical;
  });
  if (selected.length === 0) reject("UNKNOWN_CHANGE_LEVEL", "selector.level", "does not select any analysis points");
  return {
    schemaVersion: "3dena.change-network.v1",
    selector: { field: selector.field, level: selector.level },
    levelCanonical,
    mean: networkMean(result, selected),
    diagnostics: [{
      code: "CONFIDENCE_BOX_PENDING_AUTHORITY",
      severity: "warning",
      message: "Confidence-box inference is withheld until its scientific authority and interval contract are approved.",
      path: "confidenceBox",
    }],
  };
}
