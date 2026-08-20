import type {
  AnalysisDiagnostic,
  PreparedEntityKey,
  PreparedSpaceEdge,
  PreparedSpacePoint,
  PreparedSpaceResult,
  PreparedTypedValue,
  RawScalar,
} from "@3dena/analysis";

/**
 * @deprecated Compatibility-only reducers retained for their historical unit
 * fixtures. The Web product no longer imports them: prepared Comparison,
 * Change, and Stats execute through @3dena/analysis executeAnalysisTask V2.
 */

export const PREPARED_DERIVED_CONTRACT =
  "3dena.prepared-derived-reduction.v1" as const;

export interface PreparedNetworkMeanEdge {
  index: number;
  id: string;
  column: string;
  source: string;
  target: string;
  meanWeight: number;
}

export interface PreparedNetworkMean {
  pointCount: number;
  pointIndexes: number[];
  meanCoordinates: number[];
  edges: PreparedNetworkMeanEdge[];
}

export interface PreparedNetworkDifferenceEdge extends PreparedNetworkMeanEdge {
  groupAMeanWeight: number;
  groupBMeanWeight: number;
  semanticOwner: "group-a" | "group-b" | "equal";
}

export interface PreparedNetworkComparisonResult {
  schemaVersion: "3dena.prepared-network-comparison.v1";
  contract: typeof PREPARED_DERIVED_CONTRACT;
  sourceKind: "prepared-exchange";
  rawJenaRecompute: false;
  direction: "group-a-minus-group-b";
  groupA: PreparedTypedValue;
  groupB: PreparedTypedValue;
  meanA: PreparedNetworkMean;
  meanB: PreparedNetworkMean;
  differenceEdges: PreparedNetworkDifferenceEdge[];
  diagnostics: AnalysisDiagnostic[];
}

export interface PreparedChangeSelector {
  field: string;
  level: RawScalar;
}

export interface PreparedChangeNetworkResult {
  schemaVersion: "3dena.prepared-change-network.v1";
  contract: typeof PREPARED_DERIVED_CONTRACT;
  sourceKind: "prepared-exchange";
  rawJenaRecompute: false;
  selector: PreparedChangeSelector;
  levelCanonical: string;
  mean: PreparedNetworkMean;
  diagnostics: AnalysisDiagnostic[];
}

export interface PreparedDescriptiveDimension {
  dimension: string;
  sideA: { count: number; mean: number; sampleStandardDeviation: number | null };
  sideB: { count: number; mean: number; sampleStandardDeviation: number | null };
  meanDifference: number;
}

export interface PreparedDescriptiveStatisticsResult {
  schemaVersion: "3dena.prepared-descriptive-statistics.v1";
  contract: typeof PREPARED_DERIVED_CONTRACT;
  sourceKind: "prepared-exchange";
  rawJenaRecompute: false;
  design: "descriptive-independent-groups";
  direction: "group-a-minus-group-b";
  groups: [PreparedTypedValue, PreparedTypedValue];
  dimensions: PreparedDescriptiveDimension[];
  diagnostics: AnalysisDiagnostic[];
}

export type PreparedDerivedResult =
  | PreparedNetworkComparisonResult
  | PreparedChangeNetworkResult
  | PreparedDescriptiveStatisticsResult;

export interface PreparedChangeLevelOption {
  token: string;
  level: RawScalar;
  label: string;
}

export interface PreparedChangeFieldOption {
  field: string;
  label: string;
  levels: PreparedChangeLevelOption[];
}

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

function scalarCanonical(value: RawScalar, path = "level"): string {
  if (value === null) return JSON.stringify(["null"]);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) reject("NON_FINITE_VALUE", path, "must be finite");
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      reject(
        "UNSAFE_INTEGER_VALUE",
        path,
        "unsafe integer identities must be represented as source strings",
      );
    }
    return JSON.stringify(["number", Object.is(value, -0) ? "-0" : value]);
  }
  return JSON.stringify([typeof value, value]);
}

function scalarLabel(value: RawScalar): string {
  if (value === null) return "Missing (null)";
  if (typeof value === "string") return value === "" ? "Empty string" : value;
  if (typeof value === "boolean") return value ? "true" : "false";
  return Object.is(value, -0) ? "-0" : String(value);
}

function compensatedMean(values: readonly number[], path: string): number {
  if (values.length === 0) reject("EMPTY_SELECTION", path, "contains no points");
  let sum = 0;
  let correction = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) reject("NON_FINITE_SOURCE", path, "contains a non-finite value");
    const adjusted = value - correction;
    const next = sum + adjusted;
    correction = next - sum - adjusted;
    sum = next;
  }
  return sum / values.length;
}

function sampleStandardDeviation(values: readonly number[], mean: number): number | null {
  if (values.length < 2) return null;
  let sum = 0;
  let correction = 0;
  for (const value of values) {
    const squared = (value - mean) ** 2;
    const adjusted = squared - correction;
    const next = sum + adjusted;
    correction = next - sum - adjusted;
    sum = next;
  }
  return Math.sqrt(Math.max(0, sum / (values.length - 1)));
}

function validatePreparedResult(result: PreparedSpaceResult): void {
  if (!result || result.schemaVersion !== "3dena.prepared-space-result.v1") {
    reject(
      "INVALID_PREPARED_SOURCE",
      "result.schemaVersion",
      "must be 3dena.prepared-space-result.v1",
    );
  }
  if (result.sourceKind !== "prepared-exchange" || result.rawJenaRecompute !== false) {
    reject(
      "INVALID_PREPARED_BOUNDARY",
      "result",
      "must remain an imported prepared exchange without raw jENA recomputation",
    );
  }
  const { points, edges, dimensions, lineWeights } = result.fullSpace;
  if (points.length === 0) reject("EMPTY_POINT_SET", "result.fullSpace.points", "must not be empty");
  if (edges.length === 0) reject("EMPTY_EDGE_SET", "result.fullSpace.edges", "must not be empty");
  if (dimensions.length === 0) reject("EMPTY_DIMENSION_SET", "result.fullSpace.dimensions", "must not be empty");
  if (lineWeights.rowKeys.length !== points.length || lineWeights.values.length !== points.length) {
    reject(
      "MISALIGNED_LINE_WEIGHT_ROWS",
      "result.fullSpace.lineWeights",
      "row keys and values must align one-to-one with points",
    );
  }
  if (lineWeights.columns.length !== edges.length) {
    reject(
      "MISALIGNED_LINE_WEIGHT_COLUMNS",
      "result.fullSpace.lineWeights.columns",
      "must align one-to-one with source edges",
    );
  }
  points.forEach((point, index) => {
    if (point.coordinates.length !== dimensions.length) {
      reject(
        "MISALIGNED_COORDINATES",
        `result.fullSpace.points[${index}].coordinates`,
        "must align one-to-one with full-space dimensions",
      );
    }
    if (lineWeights.rowKeys[index]?.canonical !== point.id.canonical) {
      reject(
        "MISALIGNED_LINE_WEIGHT_IDENTITY",
        `result.fullSpace.lineWeights.rowKeys[${index}]`,
        "must retain the exact point identity and order",
      );
    }
    if (lineWeights.values[index]?.length !== edges.length) {
      reject(
        "MISALIGNED_LINE_WEIGHT_VALUES",
        `result.fullSpace.lineWeights.values[${index}]`,
        "must align one-to-one with source edges",
      );
    }
  });
  edges.forEach((edge, index) => {
    if (edge.index !== index || lineWeights.columns[index] !== edge.column) {
      reject(
        "MISALIGNED_EDGE_ORDER",
        `result.fullSpace.edges[${index}]`,
        "must preserve the imported line-weight column order",
      );
    }
  });
}

function groupValue(
  result: PreparedSpaceResult,
  canonical: string,
  path: string,
): PreparedTypedValue {
  if (typeof canonical !== "string" || canonical === "") {
    reject("INVALID_GROUP", path, "must be a non-empty canonical group key");
  }
  const value = result.displaySpace.trajectory.groupOrder.find(
    (candidate) => candidate.canonical === canonical,
  ) ?? result.fullSpace.points.find((point) => point.group.canonical === canonical)?.group;
  if (!value) reject("UNKNOWN_GROUP", path, "is not present in the prepared result");
  return { ...value };
}

function pointsForGroup(
  result: PreparedSpaceResult,
  canonical: string,
  path: string,
): PreparedSpacePoint[] {
  const points = result.fullSpace.points.filter(
    (point) => point.group.canonical === canonical,
  );
  if (points.length === 0) reject("EMPTY_GROUP", path, "contains no prepared points");
  return points;
}

function rowIndexByPoint(result: PreparedSpaceResult): Map<string, number> {
  return new Map(
    result.fullSpace.lineWeights.rowKeys.map((key: PreparedEntityKey, index) => [
      key.canonical,
      index,
    ]),
  );
}

function meanEdge(
  result: PreparedSpaceResult,
  edge: PreparedSpaceEdge,
  points: readonly PreparedSpacePoint[],
  rowIndexes: ReadonlyMap<string, number>,
): PreparedNetworkMeanEdge {
  const values = points.map((point) => {
    const rowIndex = rowIndexes.get(point.id.canonical);
    if (rowIndex === undefined) {
      reject(
        "MISSING_LINE_WEIGHT_ROW",
        `point.${point.id.canonical}`,
        "does not have an aligned line-weight row",
      );
    }
    return result.fullSpace.lineWeights.values[rowIndex]![edge.index]!;
  });
  return {
    index: edge.index,
    id: edge.id,
    column: edge.column,
    source: edge.source,
    target: edge.target,
    meanWeight: compensatedMean(values, `edges[${edge.index}]`),
  };
}

function networkMean(
  result: PreparedSpaceResult,
  points: readonly PreparedSpacePoint[],
): PreparedNetworkMean {
  if (points.length === 0) reject("EMPTY_SELECTION", "selection", "contains no points");
  const rows = rowIndexByPoint(result);
  return {
    pointCount: points.length,
    pointIndexes: points.map((point) => point.index),
    meanCoordinates: result.fullSpace.dimensions.map((_, dimensionIndex) =>
      compensatedMean(
        points.map((point) => point.coordinates[dimensionIndex]!),
        `dimensions[${dimensionIndex}]`,
      ),
    ),
    edges: result.fullSpace.edges.map((edge) => meanEdge(result, edge, points, rows)),
  };
}

const PREPARED_REDUCTION_DIAGNOSTIC: AnalysisDiagnostic = {
  code: "PREPARED_PRECOMPUTED_REDUCTION",
  severity: "info",
  message:
    "This result reduces imported coordinates and line weights only; it does not refit jENA or establish raw-row parity.",
  path: "sourceKind",
};

export function comparePreparedGroupNetworks(
  result: PreparedSpaceResult,
  groups: readonly [string, string],
): PreparedNetworkComparisonResult {
  validatePreparedResult(result);
  if (!Array.isArray(groups) || groups.length !== 2 || groups[0] === groups[1]) {
    reject("INVALID_GROUP_PAIR", "groups", "must contain two different canonical groups");
  }
  const groupA = groupValue(result, groups[0], "groups[0]");
  const groupB = groupValue(result, groups[1], "groups[1]");
  const meanA = networkMean(result, pointsForGroup(result, groupA.canonical, "groups[0]"));
  const meanB = networkMean(result, pointsForGroup(result, groupB.canonical, "groups[1]"));
  return {
    schemaVersion: "3dena.prepared-network-comparison.v1",
    contract: PREPARED_DERIVED_CONTRACT,
    sourceKind: "prepared-exchange",
    rawJenaRecompute: false,
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
        semanticOwner:
          difference > 0 ? "group-a" : difference < 0 ? "group-b" : "equal",
      };
    }),
    diagnostics: [
      { ...PREPARED_REDUCTION_DIAGNOSTIC },
      {
        code: "PREPARED_CONFIDENCE_BOX_WITHHELD",
        severity: "warning",
        message:
          "No prepared-space confidence-box authority is configured; this comparison reports exact descriptive mean differences only.",
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
  selector: PreparedChangeSelector,
): PreparedChangeNetworkResult {
  validatePreparedResult(result);
  if (!selector || typeof selector.field !== "string" || selector.field.trim() === "") {
    reject("INVALID_CHANGE_FIELD", "selector.field", "must be a non-empty field");
  }
  const levelCanonical = scalarCanonical(selector.level, "selector.level");
  const points = result.fullSpace.points.filter((point) => {
    const value = selectedValue(point, selector.field);
    return value !== undefined && scalarCanonical(value) === levelCanonical;
  });
  if (points.length === 0) {
    reject("UNKNOWN_CHANGE_LEVEL", "selector.level", "does not select any prepared points");
  }
  return {
    schemaVersion: "3dena.prepared-change-network.v1",
    contract: PREPARED_DERIVED_CONTRACT,
    sourceKind: "prepared-exchange",
    rawJenaRecompute: false,
    selector: { ...selector },
    levelCanonical,
    mean: networkMean(result, points),
    diagnostics: [
      { ...PREPARED_REDUCTION_DIAGNOSTIC },
      {
        code: "PREPARED_CHANGE_INFERENCE_WITHHELD",
        severity: "warning",
        message:
          "This is one exact level-network reduction. It is not a longitudinal contrast and carries no inferential interval.",
        path: "selector",
      },
    ],
  };
}

export function describePreparedGroups(
  result: PreparedSpaceResult,
  groups: readonly [string, string],
  dimensions: readonly string[],
): PreparedDescriptiveStatisticsResult {
  validatePreparedResult(result);
  if (!Array.isArray(groups) || groups.length !== 2 || groups[0] === groups[1]) {
    reject("INVALID_GROUP_PAIR", "groups", "must contain two different canonical groups");
  }
  if (!Array.isArray(dimensions) || dimensions.length === 0) {
    reject("EMPTY_DIMENSION_SELECTION", "dimensions", "must contain at least one dimension");
  }
  if (new Set(dimensions).size !== dimensions.length) {
    reject("DUPLICATE_DIMENSION", "dimensions", "must not contain duplicates");
  }
  const groupA = groupValue(result, groups[0], "groups[0]");
  const groupB = groupValue(result, groups[1], "groups[1]");
  const sideA = pointsForGroup(result, groupA.canonical, "groups[0]");
  const sideB = pointsForGroup(result, groupB.canonical, "groups[1]");
  const described = dimensions.map((dimension, selectionIndex): PreparedDescriptiveDimension => {
    const dimensionIndex = result.fullSpace.dimensions.indexOf(dimension);
    if (dimensionIndex < 0) {
      reject(
        "UNKNOWN_DIMENSION",
        `dimensions[${selectionIndex}]`,
        `is not present in the imported full space: ${JSON.stringify(dimension)}`,
      );
    }
    const valuesA = sideA.map((point) => point.coordinates[dimensionIndex]!);
    const valuesB = sideB.map((point) => point.coordinates[dimensionIndex]!);
    const meanA = compensatedMean(valuesA, `${dimension}.sideA`);
    const meanB = compensatedMean(valuesB, `${dimension}.sideB`);
    return {
      dimension,
      sideA: {
        count: valuesA.length,
        mean: meanA,
        sampleStandardDeviation: sampleStandardDeviation(valuesA, meanA),
      },
      sideB: {
        count: valuesB.length,
        mean: meanB,
        sampleStandardDeviation: sampleStandardDeviation(valuesB, meanB),
      },
      meanDifference: meanA - meanB,
    };
  });
  return {
    schemaVersion: "3dena.prepared-descriptive-statistics.v1",
    contract: PREPARED_DERIVED_CONTRACT,
    sourceKind: "prepared-exchange",
    rawJenaRecompute: false,
    design: "descriptive-independent-groups",
    direction: "group-a-minus-group-b",
    groups: [groupA, groupB],
    dimensions: described,
    diagnostics: [
      { ...PREPARED_REDUCTION_DIAGNOSTIC },
      {
        code: "PREPARED_INFERENTIAL_TASK_UNAVAILABLE",
        severity: "warning",
        message:
          "This deprecated app-local compatibility reducer is descriptive only. The Web product now uses the public PreparedSpaceResult AnalysisTask contract for inference.",
        path: "statistics",
      },
    ],
  };
}

function uniqueLevels(values: readonly RawScalar[]): PreparedChangeLevelOption[] {
  const output = new Map<string, PreparedChangeLevelOption>();
  for (const level of values) {
    const token = scalarCanonical(level);
    if (!output.has(token)) {
      output.set(token, { token, level, label: scalarLabel(level) });
    }
  }
  return [...output.values()].sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { numeric: true }),
  );
}

export function preparedChangeFieldOptions(
  result: PreparedSpaceResult,
): PreparedChangeFieldOption[] {
  const structural: PreparedChangeFieldOption[] = [
    {
      field: "@group",
      label: `Group (${result.provenance.resolvedMapping.group})`,
      levels: uniqueLevels(result.fullSpace.points.map((point) => point.group.value)),
    },
    {
      field: "@time",
      label: `Time (${result.provenance.resolvedMapping.time})`,
      levels: uniqueLevels(result.fullSpace.points.map((point) => point.time.value)),
    },
  ];
  const metadataFields = [...new Set(
    result.fullSpace.points.flatMap((point) => Object.keys(point.metadata)),
  )].sort((left, right) => left.localeCompare(right));
  return [
    ...structural,
    ...metadataFields.map((field) => ({
      field,
      label: field,
      levels: uniqueLevels(
        result.fullSpace.points.flatMap((point) =>
          Object.hasOwn(point.metadata, field) ? [point.metadata[field] ?? null] : [],
        ),
      ),
    })),
  ].filter((option) => option.levels.length > 0);
}
