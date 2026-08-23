type JsonSchema = Record<string, unknown>;

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const HASH_SCHEMA: JsonSchema = { type: "string", pattern: "^[a-f0-9]{64}$" };
const NON_EMPTY_STRING_SCHEMA: JsonSchema = { type: "string", minLength: 1 };
const FINITE_NUMBER_SCHEMA: JsonSchema = { type: "number" };
const PROBABILITY_SCHEMA: JsonSchema = { type: "number", minimum: 0, maximum: 1 };
const SAFE_NON_NEGATIVE_INTEGER_SCHEMA: JsonSchema = { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER };
const SAFE_POSITIVE_INTEGER_SCHEMA: JsonSchema = { type: "integer", minimum: 1, maximum: MAX_SAFE_INTEGER };
const UINT32_SCHEMA: JsonSchema = { type: "integer", minimum: 0, maximum: 4_294_967_295 };
const DURATION_UNITS = ["milliseconds", "seconds", "minutes", "hours", "days", "weeks"];
const PREPARED_COLUMN_TYPES = ["logical", "integer", "double", "character", "date", "datetime", "difftime", "factor", "ordered"];

function exactObject(required: readonly string[], properties: Record<string, JsonSchema>): JsonSchema {
  return { type: "object", additionalProperties: false, required: [...required], properties };
}

function arrayOf(items: JsonSchema, options: { minItems?: number; maxItems?: number; uniqueItems?: boolean } = {}): JsonSchema {
  return { type: "array", items, ...options };
}

function nullable(schema: JsonSchema): JsonSchema {
  return { oneOf: [{ type: "null" }, schema] };
}

function vector(length?: number): JsonSchema {
  return arrayOf(FINITE_NUMBER_SCHEMA, length === undefined ? { minItems: 1 } : { minItems: length, maxItems: length });
}

function constObject(values: Record<string, unknown>): JsonSchema {
  return exactObject(Object.keys(values), Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { const: value }])));
}

function countObject(fields: readonly string[], positive = false): JsonSchema {
  return exactObject(fields, Object.fromEntries(fields.map((field) => [field, positive ? SAFE_POSITIVE_INTEGER_SCHEMA : SAFE_NON_NEGATIVE_INTEGER_SCHEMA])));
}

const RAW_SCALAR_SCHEMA: JsonSchema = {
  oneOf: [
    { type: "null" },
    { type: "string" },
    { type: "boolean" },
    { type: "integer", minimum: -MAX_SAFE_INTEGER, maximum: MAX_SAFE_INTEGER },
    { type: "number", not: { type: "integer" } },
  ],
};

const RAW_ENTITY_KEY_SCHEMA = exactObject(
  ["canonical", "display", "columns", "values"],
  {
    canonical: NON_EMPTY_STRING_SCHEMA,
    display: { type: "string" },
    columns: arrayOf(NON_EMPTY_STRING_SCHEMA, { minItems: 1, uniqueItems: true }),
    values: arrayOf(RAW_SCALAR_SCHEMA, { minItems: 1 }),
  },
);

const RAW_TYPED_VALUE_SCHEMA = exactObject(
  ["canonical", "display", "value"],
  { canonical: NON_EMPTY_STRING_SCHEMA, display: { type: "string" }, value: RAW_SCALAR_SCHEMA },
);

const DIAGNOSTIC_SCHEMA = exactObject(
  ["code", "severity", "message"],
  {
    code: NON_EMPTY_STRING_SCHEMA,
    severity: { enum: ["info", "warning"] },
    message: NON_EMPTY_STRING_SCHEMA,
    path: NON_EMPTY_STRING_SCHEMA,
    count: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
  },
);

const DIAGNOSTICS_SCHEMA = arrayOf(DIAGNOSTIC_SCHEMA);

const ANALYSIS_EDGE_SCHEMA = exactObject(
  ["index", "id", "column", "source", "target", "sourceIndex", "targetIndex", "meanWeight"],
  {
    index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    id: NON_EMPTY_STRING_SCHEMA,
    column: NON_EMPTY_STRING_SCHEMA,
    source: NON_EMPTY_STRING_SCHEMA,
    target: NON_EMPTY_STRING_SCHEMA,
    sourceIndex: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    targetIndex: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    meanWeight: FINITE_NUMBER_SCHEMA,
  },
);

const ANALYSIS_NODE_SCHEMA = exactObject(
  ["index", "code", "coordinates", "fullCoordinates"],
  {
    index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    code: NON_EMPTY_STRING_SCHEMA,
    coordinates: vector(3),
    fullCoordinates: vector(),
  },
);

const ANALYSIS_POINT_SCHEMA = exactObject(
  ["index", "id", "unit", "participantLabel", "coordinates", "fullCoordinates", "lineWeights", "metadata"],
  {
    index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    id: RAW_ENTITY_KEY_SCHEMA,
    unit: RAW_ENTITY_KEY_SCHEMA,
    participantLabel: RAW_ENTITY_KEY_SCHEMA,
    step: RAW_ENTITY_KEY_SCHEMA,
    group: RAW_TYPED_VALUE_SCHEMA,
    time: RAW_TYPED_VALUE_SCHEMA,
    coordinates: vector(3),
    fullCoordinates: vector(),
    lineWeights: vector(),
    metadata: { type: "object", additionalProperties: RAW_SCALAR_SCHEMA },
  },
);

const ACCUMULATION_TABLE_SCHEMA = exactObject(
  ["rowKeys", "columns", "values"],
  {
    rowKeys: arrayOf(RAW_ENTITY_KEY_SCHEMA),
    columns: arrayOf(NON_EMPTY_STRING_SCHEMA, { minItems: 1, uniqueItems: true }),
    values: arrayOf(vector()),
  },
);

const SHARED_TRAJECTORY_PARTICIPANT_PERIOD_SCHEMA = exactObject(
  ["index", "participant", "participantLabel", "group", "time", "coordinates", "fullCoordinates", "sourcePointIndexes", "includedInCohort"],
  {
    index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    participant: RAW_ENTITY_KEY_SCHEMA,
    participantLabel: RAW_ENTITY_KEY_SCHEMA,
    group: RAW_TYPED_VALUE_SCHEMA,
    time: RAW_TYPED_VALUE_SCHEMA,
    coordinates: vector(3),
    fullCoordinates: vector(),
    sourcePointIndexes: arrayOf(SAFE_NON_NEGATIVE_INTEGER_SCHEMA, { minItems: 1, uniqueItems: true }),
    includedInCohort: { type: "boolean" },
  },
);

const SHARED_TRAJECTORY_CENTROID_SCHEMA = exactObject(
  ["index", "group", "time", "coordinates", "fullCoordinates", "participantCount", "participantPeriodIndexes"],
  {
    index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    group: RAW_TYPED_VALUE_SCHEMA,
    time: RAW_TYPED_VALUE_SCHEMA,
    coordinates: vector(3),
    fullCoordinates: vector(),
    participantCount: SAFE_POSITIVE_INTEGER_SCHEMA,
    participantPeriodIndexes: arrayOf(SAFE_NON_NEGATIVE_INTEGER_SCHEMA, { minItems: 1, uniqueItems: true }),
  },
);

const SHARED_TRAJECTORY_PATH_SCHEMA = exactObject(
  ["group", "steps"],
  {
    group: RAW_TYPED_VALUE_SCHEMA,
    steps: arrayOf(exactObject(
      ["time", "centroidIndex"],
      { time: RAW_TYPED_VALUE_SCHEMA, centroidIndex: nullable(SAFE_NON_NEGATIVE_INTEGER_SCHEMA) },
    ), { minItems: 1 }),
  },
);

const SHARED_TRAJECTORY_SCHEMA = exactObject(
  ["space", "dimensions", "cohortPolicy", "groupOrder", "timeOrder", "participantPeriods", "centroids", "paths"],
  {
    space: { const: "analysis-result-rotation" },
    dimensions: arrayOf(NON_EMPTY_STRING_SCHEMA, { minItems: 3, uniqueItems: true }),
    cohortPolicy: { enum: ["available", "complete"] },
    groupOrder: arrayOf(RAW_TYPED_VALUE_SCHEMA, { minItems: 1 }),
    timeOrder: arrayOf(RAW_TYPED_VALUE_SCHEMA, { minItems: 1 }),
    participantPeriods: arrayOf(SHARED_TRAJECTORY_PARTICIPANT_PERIOD_SCHEMA),
    centroids: arrayOf(SHARED_TRAJECTORY_CENTROID_SCHEMA),
    paths: arrayOf(SHARED_TRAJECTORY_PATH_SCHEMA, { minItems: 1 }),
  },
);

const ANALYSIS_RESOURCE_LIMIT_FIELDS = [
  "maxRows", "maxColumns", "maxCells", "maxAccumulationCells", "maxCodes", "maxEdges", "maxStringLength",
  "maxUnits", "maxGroups", "maxTimePoints", "maxOutputPoints", "maxDimensions", "maxCoordinateCells",
] as const;

const ANALYSIS_PROVENANCE_SCHEMA = exactObject(
  ["adapter", "adapterVersion", "jenaPackage", "jenaVersion", "jenaCommit", "coreGoldenContract", "legacyGoldenContract", "legacyGoldenStatus", "parityContract", "resultSemantics", "resolvedConfig", "resolvedLimits"],
  {
    adapter: { const: "@3dena/analysis" },
    adapterVersion: NON_EMPTY_STRING_SCHEMA,
    jenaPackage: { const: "jena-js" },
    jenaVersion: NON_EMPTY_STRING_SCHEMA,
    jenaCommit: NON_EMPTY_STRING_SCHEMA,
    coreGoldenContract: NON_EMPTY_STRING_SCHEMA,
    legacyGoldenContract: NON_EMPTY_STRING_SCHEMA,
    legacyGoldenStatus: { const: "not-assessed" },
    parityContract: NON_EMPTY_STRING_SCHEMA,
    resultSemantics: NON_EMPTY_STRING_SCHEMA,
    resolvedConfig: exactObject(
      ["model", "window", "weightBy", "windowSizeBack", "windowSizeForward", "centerAlignToOrigin"],
      {
        model: { enum: ["EndPoint", "AccumulatedTrajectory", "SeparateTrajectory"] },
        window: { enum: ["MovingStanzaWindow", "Conversation"] },
        weightBy: { enum: ["binary", "sum"] },
        windowSizeBack: { anyOf: [SAFE_NON_NEGATIVE_INTEGER_SCHEMA, { const: "Infinity" }] },
        windowSizeForward: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
        centerAlignToOrigin: { type: "boolean" },
      },
    ),
    resolvedLimits: countObject(ANALYSIS_RESOURCE_LIMIT_FIELDS, true),
  },
);

export const ENA_MODEL_RESULT_SCHEMA_V1: JsonSchema = {
  ...exactObject(
    ["schemaVersion", "dimensions", "axes", "points", "nodes", "edges", "accumulation", "variance", "rotation", "summary", "diagnostics", "provenance"],
    {
      schemaVersion: { const: "3dena.analysis-result.v1" },
      dimensions: arrayOf(NON_EMPTY_STRING_SCHEMA, { minItems: 3, uniqueItems: true }),
      axes: { type: "array", items: NON_EMPTY_STRING_SCHEMA, minItems: 3, maxItems: 3, uniqueItems: true },
      points: arrayOf(ANALYSIS_POINT_SCHEMA, { minItems: 1 }),
      nodes: arrayOf(ANALYSIS_NODE_SCHEMA, { minItems: 3 }),
      edges: arrayOf(ANALYSIS_EDGE_SCHEMA, { minItems: 1 }),
      accumulation: exactObject(
        ["modelCounts", "rowCounts"],
        { modelCounts: ACCUMULATION_TABLE_SCHEMA, rowCounts: ACCUMULATION_TABLE_SCHEMA },
      ),
      variance: arrayOf(exactObject(
        ["axis", "proportion", "eigenvalue", "displayed"],
        { axis: NON_EMPTY_STRING_SCHEMA, proportion: FINITE_NUMBER_SCHEMA, eigenvalue: FINITE_NUMBER_SCHEMA, displayed: { type: "boolean" } },
      ), { minItems: 3 }),
      rotation: exactObject(
        ["method", "columns", "matrix", "eigenvalues", "centerVector"],
        {
          method: { enum: ["svd", "mean", "reference"] },
          columns: arrayOf(NON_EMPTY_STRING_SCHEMA, { minItems: 3, uniqueItems: true }),
          matrix: arrayOf(vector(), { minItems: 1 }),
          eigenvalues: vector(),
          centerVector: vector(),
        },
      ),
      trajectory: SHARED_TRAJECTORY_SCHEMA,
      summary: countObject(["inputRows", "inputColumns", "units", "points", "nodes", "edges", "modelCountRows", "rowCountRows", "groups", "timePoints", "participantPeriods", "trajectoryCentroids", "dimensions"]),
      diagnostics: DIAGNOSTICS_SCHEMA,
      provenance: ANALYSIS_PROVENANCE_SCHEMA,
    },
  ),
};

const NETWORK_MEAN_EDGE_SCHEMA = exactObject(
  ["index", "id", "column", "source", "target", "meanWeight"],
  {
    index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    id: NON_EMPTY_STRING_SCHEMA,
    column: NON_EMPTY_STRING_SCHEMA,
    source: NON_EMPTY_STRING_SCHEMA,
    target: NON_EMPTY_STRING_SCHEMA,
    meanWeight: FINITE_NUMBER_SCHEMA,
  },
);

const NETWORK_MEAN_SCHEMA = exactObject(
  ["pointCount", "pointIndexes", "meanCoordinates", "edges"],
  {
    pointCount: SAFE_POSITIVE_INTEGER_SCHEMA,
    pointIndexes: arrayOf(SAFE_NON_NEGATIVE_INTEGER_SCHEMA, { minItems: 1, uniqueItems: true }),
    meanCoordinates: vector(),
    edges: arrayOf(NETWORK_MEAN_EDGE_SCHEMA, { minItems: 1 }),
  },
);

const NETWORK_DIFFERENCE_EDGE_SCHEMA = exactObject(
  ["index", "id", "column", "source", "target", "meanWeight", "groupAMeanWeight", "groupBMeanWeight", "semanticOwner"],
  {
    index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    id: NON_EMPTY_STRING_SCHEMA,
    column: NON_EMPTY_STRING_SCHEMA,
    source: NON_EMPTY_STRING_SCHEMA,
    target: NON_EMPTY_STRING_SCHEMA,
    meanWeight: FINITE_NUMBER_SCHEMA,
    groupAMeanWeight: FINITE_NUMBER_SCHEMA,
    groupBMeanWeight: FINITE_NUMBER_SCHEMA,
    semanticOwner: { enum: ["group-a", "group-b", "equal"] },
  },
);

const NETWORK_COMPARISON_RESULT_SCHEMA = exactObject(
  ["schemaVersion", "direction", "groupA", "groupB", "meanA", "meanB", "differenceEdges", "diagnostics"],
  {
    schemaVersion: { const: "3dena.network-comparison.v1" },
    direction: { const: "group-a-minus-group-b" },
    groupA: RAW_TYPED_VALUE_SCHEMA,
    groupB: RAW_TYPED_VALUE_SCHEMA,
    meanA: NETWORK_MEAN_SCHEMA,
    meanB: NETWORK_MEAN_SCHEMA,
    differenceEdges: arrayOf(NETWORK_DIFFERENCE_EDGE_SCHEMA, { minItems: 1 }),
    diagnostics: DIAGNOSTICS_SCHEMA,
  },
);

const CHANGE_NETWORK_RESULT_SCHEMA = exactObject(
  ["schemaVersion", "selector", "levelCanonical", "mean", "diagnostics"],
  {
    schemaVersion: { const: "3dena.change-network.v1" },
    selector: exactObject(["field", "level"], { field: NON_EMPTY_STRING_SCHEMA, level: RAW_SCALAR_SCHEMA }),
    levelCanonical: NON_EMPTY_STRING_SCHEMA,
    mean: NETWORK_MEAN_SCHEMA,
    diagnostics: DIAGNOSTICS_SCHEMA,
  },
);

const STATISTICAL_ALTERNATIVE_SCHEMA: JsonSchema = { enum: ["two-sided", "greater", "less"] };
const ADJUSTMENT_METHOD_SCHEMA: JsonSchema = { enum: ["none", "holm", "bh", "bonferroni"] };
const STATS_CONTRACT_SCHEMA = constObject({
  schemaVersion: "3dena.stats.contract.v1",
  direction: "A-minus-B",
  missing: "drop-explicit-null",
  ties: "exact-value-midrank",
  signedRankZeros: "drop-exact-zero",
  rankInference: "asymptotic-normal",
  continuityCorrection: true,
  independentCohenD: "pooled-sample-standard-deviation",
  pairedCohenD: "mean-paired-difference-over-sample-sd",
  meanDifferenceConfidenceInterval: "alternative-aligned-t-interval-95-percent",
  pValueAdjustmentFamily: "caller-supplied-complete-family",
});

const CONFIDENCE_BOUND_SCHEMA: JsonSchema = {
  oneOf: [
    exactObject(["kind", "value"], { kind: { const: "finite" }, value: FINITE_NUMBER_SCHEMA }),
    ...["negative-infinity", "positive-infinity", "undefined", "unrepresentable"].map((kind) => exactObject(["kind"], { kind: { const: kind } })),
  ],
};

function confidenceIntervalSchema(method: string): JsonSchema {
  return exactObject(
    ["method", "confidenceLevel", "alternative", "lower", "upper"],
    {
      method: { const: method },
      confidenceLevel: { const: 0.95 },
      alternative: STATISTICAL_ALTERNATIVE_SCHEMA,
      lower: CONFIDENCE_BOUND_SCHEMA,
      upper: CONFIDENCE_BOUND_SCHEMA,
    },
  );
}

const ADJUSTMENT_SCHEMA = exactObject(
  ["method", "raw", "adjusted"],
  {
    method: ADJUSTMENT_METHOD_SCHEMA,
    raw: arrayOf(PROBABILITY_SCHEMA, { minItems: 1 }),
    adjusted: arrayOf(PROBABILITY_SCHEMA, { minItems: 1 }),
  },
);

const EFFECTS_SCHEMA = exactObject(
  ["cohensD", "rankBiserial"],
  { cohensD: nullable(FINITE_NUMBER_SCHEMA), rankBiserial: FINITE_NUMBER_SCHEMA },
);

const INDEPENDENT_STATS_RESULT_SCHEMA = exactObject(
  ["schemaVersion", "design", "direction", "contract", "alternative", "samples", "estimates", "welch", "mannWhitney", "effects", "adjustment", "diagnostics"],
  {
    schemaVersion: { const: "3dena.stats.independent-result.v1" },
    design: { const: "independent" },
    direction: { const: "A-minus-B" },
    contract: STATS_CONTRACT_SCHEMA,
    alternative: STATISTICAL_ALTERNATIVE_SCHEMA,
    samples: exactObject(
      ["sideA", "sideB"],
      Object.fromEntries(["sideA", "sideB"].map((side) => [side, exactObject(
        ["label", "input", "valid", "droppedMissing"],
        { label: NON_EMPTY_STRING_SCHEMA, input: SAFE_POSITIVE_INTEGER_SCHEMA, valid: SAFE_POSITIVE_INTEGER_SCHEMA, droppedMissing: SAFE_NON_NEGATIVE_INTEGER_SCHEMA },
      )])),
    ),
    estimates: exactObject(
      ["meanA", "meanB", "meanDifference", "confidenceInterval"],
      { meanA: FINITE_NUMBER_SCHEMA, meanB: FINITE_NUMBER_SCHEMA, meanDifference: nullable(FINITE_NUMBER_SCHEMA), confidenceInterval: confidenceIntervalSchema("welch-t-mean-difference-v1") },
    ),
    welch: exactObject(
      ["method", "alternative", "statistic", "degreesOfFreedom", "pValue"],
      { method: { const: "welch-t-v1" }, alternative: STATISTICAL_ALTERNATIVE_SCHEMA, statistic: nullable(FINITE_NUMBER_SCHEMA), degreesOfFreedom: nullable(FINITE_NUMBER_SCHEMA), pValue: PROBABILITY_SCHEMA },
    ),
    mannWhitney: exactObject(
      ["method", "alternative", "tiePolicy", "continuityCorrection", "uA", "uB", "z", "pValue", "tieGroups", "tiedObservations"],
      {
        method: { const: "mann-whitney-asymptotic-v1" },
        alternative: STATISTICAL_ALTERNATIVE_SCHEMA,
        tiePolicy: { const: "exact-value-midrank" },
        continuityCorrection: { const: true },
        uA: FINITE_NUMBER_SCHEMA,
        uB: FINITE_NUMBER_SCHEMA,
        z: FINITE_NUMBER_SCHEMA,
        pValue: PROBABILITY_SCHEMA,
        tieGroups: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
        tiedObservations: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
      },
    ),
    effects: EFFECTS_SCHEMA,
    adjustment: ADJUSTMENT_SCHEMA,
    diagnostics: DIAGNOSTICS_SCHEMA,
  },
);

const PAIRED_STATS_RESULT_SCHEMA = exactObject(
  ["schemaVersion", "design", "direction", "contract", "alternative", "matching", "estimates", "wilcoxonSignedRank", "effects", "adjustment", "diagnostics"],
  {
    schemaVersion: { const: "3dena.stats.paired-result.v1" },
    design: { const: "paired" },
    direction: { const: "A-minus-B" },
    contract: STATS_CONTRACT_SCHEMA,
    alternative: STATISTICAL_ALTERNATIVE_SCHEMA,
    matching: countObject(["sideAInput", "sideBInput", "matched", "validPairs", "droppedMissingPairs", "unmatchedA", "unmatchedB", "zeroDifferences", "rankedPairs"]),
    estimates: exactObject(
      ["meanDifference", "confidenceInterval"],
      { meanDifference: nullable(FINITE_NUMBER_SCHEMA), confidenceInterval: confidenceIntervalSchema("paired-t-mean-difference-v1") },
    ),
    wilcoxonSignedRank: exactObject(
      ["method", "alternative", "tiePolicy", "zeroPolicy", "continuityCorrection", "statistic", "wPositive", "wNegative", "z", "pValue", "tieGroups", "tiedObservations"],
      {
        method: { const: "wilcoxon-signed-rank-asymptotic-v1" },
        alternative: STATISTICAL_ALTERNATIVE_SCHEMA,
        tiePolicy: { const: "exact-absolute-difference-midrank" },
        zeroPolicy: { const: "drop-exact-zero" },
        continuityCorrection: { const: true },
        statistic: FINITE_NUMBER_SCHEMA,
        wPositive: FINITE_NUMBER_SCHEMA,
        wNegative: FINITE_NUMBER_SCHEMA,
        z: FINITE_NUMBER_SCHEMA,
        pValue: PROBABILITY_SCHEMA,
        tieGroups: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
        tiedObservations: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
      },
    ),
    effects: EFFECTS_SCHEMA,
    adjustment: ADJUSTMENT_SCHEMA,
    diagnostics: DIAGNOSTICS_SCHEMA,
  },
);

const STATISTICS_TASK_RESULT_SCHEMA: JsonSchema = exactObject(
  ["schemaVersion", "design", "direction", "groups", "dimensions"],
  {
    schemaVersion: { const: "3dena.statistics-task-result.v1" },
    design: { enum: ["independent", "paired"] },
    direction: { const: "group-a-minus-group-b" },
    groups: arrayOf(NON_EMPTY_STRING_SCHEMA, { minItems: 2, maxItems: 2, uniqueItems: true }),
    dimensions: arrayOf(exactObject(
      ["dimension", "result"],
      { dimension: NON_EMPTY_STRING_SCHEMA, result: { oneOf: [INDEPENDENT_STATS_RESULT_SCHEMA, PAIRED_STATS_RESULT_SCHEMA] } },
    ), { minItems: 1 }),
  },
);
STATISTICS_TASK_RESULT_SCHEMA.allOf = [
  {
    if: { properties: { design: { const: "independent" } } },
    then: { properties: { dimensions: { items: { properties: { result: INDEPENDENT_STATS_RESULT_SCHEMA } } } } },
  },
  {
    if: { properties: { design: { const: "paired" } } },
    then: { properties: { dimensions: { items: { properties: { result: PAIRED_STATS_RESULT_SCHEMA } } } } },
  },
];

const TRAJECTORY_IDENTITY_COMPONENT_SCHEMA: JsonSchema = {
  oneOf: [
    exactObject(["name", "type", "value"], { name: NON_EMPTY_STRING_SCHEMA, type: { const: "string" }, value: NON_EMPTY_STRING_SCHEMA, declaredType: NON_EMPTY_STRING_SCHEMA }),
    exactObject(["name", "type", "value"], { name: NON_EMPTY_STRING_SCHEMA, type: { const: "number" }, value: FINITE_NUMBER_SCHEMA, declaredType: NON_EMPTY_STRING_SCHEMA }),
    exactObject(["name", "type", "value"], { name: NON_EMPTY_STRING_SCHEMA, type: { const: "boolean" }, value: { type: "boolean" }, declaredType: NON_EMPTY_STRING_SCHEMA }),
  ],
};

const TRAJECTORY_KEY_SCHEMA = exactObject(
  ["components", "canonical", "display"],
  {
    components: arrayOf(TRAJECTORY_IDENTITY_COMPONENT_SCHEMA, { minItems: 1 }),
    canonical: NON_EMPTY_STRING_SCHEMA,
    display: NON_EMPTY_STRING_SCHEMA,
  },
);

const TRAJECTORY_TIME_VALUE_SCHEMA: JsonSchema = {
  oneOf: [
    exactObject(["type", "value", "unit"], { type: { const: "numeric-v1" }, value: FINITE_NUMBER_SCHEMA, unit: NON_EMPTY_STRING_SCHEMA }),
    exactObject(["type", "value"], { type: { const: "date-v1" }, value: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" } }),
    exactObject(
      ["type", "epochMilliseconds", "timeZone", "offsetMinutes", "fold", "elapsedUnit"],
      {
        type: { const: "instant-v1" },
        epochMilliseconds: { type: "string", pattern: "^-?(?:0|[1-9][0-9]*)$" },
        timeZone: NON_EMPTY_STRING_SCHEMA,
        offsetMinutes: { type: "integer", minimum: -1440, maximum: 1440 },
        fold: { enum: [0, 1] },
        elapsedUnit: { enum: DURATION_UNITS },
      },
    ),
    exactObject(
      ["type", "value", "unit", "elapsedUnit"],
      { type: { const: "difftime-v1" }, value: FINITE_NUMBER_SCHEMA, unit: { enum: DURATION_UNITS }, elapsedUnit: { enum: DURATION_UNITS } },
    ),
  ],
};

function distanceMetricsSchema(includeSpeed: boolean): JsonSchema {
  const required = ["dimensions", "delta", "stepDistance", "cumulativeDistance", ...(includeSpeed ? ["speed"] : [])];
  return exactObject(required, {
    dimensions: arrayOf(NON_EMPTY_STRING_SCHEMA, { minItems: 1, uniqueItems: true }),
    delta: nullable(vector()),
    stepDistance: nullable(FINITE_NUMBER_SCHEMA),
    cumulativeDistance: nullable(FINITE_NUMBER_SCHEMA),
    ...(includeSpeed ? { speed: nullable(FINITE_NUMBER_SCHEMA) } : {}),
  });
}

function trajectoryParticipantPeriodSchema(weighted: boolean): JsonSchema {
  const required = ["index", "participant", "time", "selectedCoordinates", "fullCoordinates", "sourceRowIndexes", ...(weighted ? ["participantWeight"] : []), "includedInCohort"];
  return exactObject(required, {
    index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    participant: TRAJECTORY_KEY_SCHEMA,
    time: TRAJECTORY_KEY_SCHEMA,
    selectedCoordinates: vector(3),
    fullCoordinates: vector(),
    sourceRowIndexes: arrayOf(SAFE_NON_NEGATIVE_INTEGER_SCHEMA, { minItems: 1, uniqueItems: true }),
    ...(weighted ? { participantWeight: { type: "number", exclusiveMinimum: 0 } } : {}),
    includedInCohort: { type: "boolean" },
  });
}

const TRAJECTORY_PATH_PERIOD_SCHEMA = exactObject(
  ["index", "time", "selectedCentroid", "fullCentroid", "selected3d", "fullSpace", "nRows", "nTotal", "nUsed", "nDuplicateRows", "nCohortExcluded"],
  {
    index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    time: TRAJECTORY_KEY_SCHEMA,
    selectedCentroid: nullable(vector(3)),
    fullCentroid: nullable(vector()),
    selected3d: distanceMetricsSchema(false),
    fullSpace: distanceMetricsSchema(false),
    nRows: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    nTotal: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    nUsed: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    nDuplicateRows: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    nCohortExcluded: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
  },
);

const TRAJECTORY_PATH_STATISTICS_SCHEMA = exactObject(
  ["schemaVersion", "namespace", "cohortPolicy", "estimand", "dimensions", "selectedDimensions", "distanceSemantics", "participantPeriods", "periods", "diagnostics", "summary", "resolvedLimits"],
  {
    schemaVersion: { const: "3dena.trajectory-path-statistics.v1" },
    namespace: NON_EMPTY_STRING_SCHEMA,
    cohortPolicy: { enum: ["available", "complete"] },
    estimand: { enum: ["equal-participant", "weighted-participant"] },
    dimensions: arrayOf(NON_EMPTY_STRING_SCHEMA, { minItems: 1, uniqueItems: true }),
    selectedDimensions: arrayOf(NON_EMPTY_STRING_SCHEMA, { minItems: 3, maxItems: 3, uniqueItems: true }),
    distanceSemantics: constObject({ selected3d: "euclidean-selected-three-dimensions", fullSpace: "euclidean-all-declared-dimensions" }),
    participantPeriods: arrayOf(trajectoryParticipantPeriodSchema(true)),
    periods: arrayOf(TRAJECTORY_PATH_PERIOD_SCHEMA),
    diagnostics: DIAGNOSTICS_SCHEMA,
    summary: countObject(["inputRows", "participants", "participantPeriods", "periods", "duplicateRows"]),
    resolvedLimits: countObject(["maxPoints", "maxDimensions", "maxPeriods", "maxParticipants", "maxCells", "maxResamples", "maxTests"], true),
  },
);

const TRAJECTORY_TIME_CONTRACT_SCHEMA: JsonSchema = {
  oneOf: [
    exactObject(["kind", "elapsedUnit", "chronology"], { kind: { const: "numeric-v1" }, elapsedUnit: NON_EMPTY_STRING_SCHEMA, chronology: { const: "strictly-increasing-finite-number-v1" } }),
    constObject({ kind: "date-v1", elapsedUnit: "days", calendar: "proleptic-gregorian-v1", chronology: "strictly-increasing-civil-day-v1" }),
    exactObject(
      ["kind", "elapsedUnit", "epoch", "chronology", "zoneRole"],
      { kind: { const: "instant-v1" }, elapsedUnit: { enum: DURATION_UNITS }, epoch: { const: "unix-epoch-milliseconds-int64-v1" }, chronology: { const: "strictly-increasing-exact-epoch-v1" }, zoneRole: { const: "presentation-provenance-only" } },
    ),
    exactObject(
      ["kind", "elapsedUnit", "conversion", "chronology"],
      { kind: { const: "difftime-v1" }, elapsedUnit: { enum: DURATION_UNITS }, conversion: { const: "fixed-duration-unit-ratios-v1" }, chronology: { const: "strictly-increasing-normalized-duration-v1" } },
    ),
  ],
};

const TRAJECTORY_DYNAMICS_PERIOD_SCHEMA = exactObject(
  ["index", "time", "timeValue", "elapsedFromPrevious", "elapsedFromStart", "selectedCentroid", "fullCentroid", "selected3d", "fullSpace", "nRows", "nParticipantPeriods", "nUsed", "nDuplicateRows", "nCohortExcluded", "weightSum", "effectiveParticipantN"],
  {
    index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    time: TRAJECTORY_KEY_SCHEMA,
    timeValue: TRAJECTORY_TIME_VALUE_SCHEMA,
    elapsedFromPrevious: nullable(FINITE_NUMBER_SCHEMA),
    elapsedFromStart: FINITE_NUMBER_SCHEMA,
    selectedCentroid: nullable(vector(3)),
    fullCentroid: nullable(vector()),
    selected3d: distanceMetricsSchema(true),
    fullSpace: distanceMetricsSchema(true),
    nRows: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    nParticipantPeriods: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    nUsed: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    nDuplicateRows: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    nCohortExcluded: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    weightSum: nullable(FINITE_NUMBER_SCHEMA),
    effectiveParticipantN: nullable(FINITE_NUMBER_SCHEMA),
  },
);

const TRAJECTORY_DYNAMICS_RESULT_SCHEMA = exactObject(
  ["schemaVersion", "namespace", "cohortPolicy", "estimand", "dimensions", "selectedDimensions", "timeContract", "contracts", "participantPeriods", "periods", "diagnostics", "diagnosticSummary", "summary", "evidence", "resolvedLimits"],
  {
    schemaVersion: { const: "3dena.trajectory-dynamics.v1" },
    namespace: NON_EMPTY_STRING_SCHEMA,
    cohortPolicy: { enum: ["available", "complete"] },
    estimand: exactObject(["kind"], { kind: { enum: ["equal-participant-v1", "weighted-participant-v1"] } }),
    dimensions: arrayOf(NON_EMPTY_STRING_SCHEMA, { minItems: 1, uniqueItems: true }),
    selectedDimensions: arrayOf(NON_EMPTY_STRING_SCHEMA, { minItems: 3, maxItems: 3, uniqueItems: true }),
    timeContract: TRAJECTORY_TIME_CONTRACT_SCHEMA,
    contracts: constObject({
      duplicateReduction: "equal-row-coordinate-mean-before-centroid-v1",
      weightResolution: "constant-within-participant-period-v1",
      cohort: "available-or-complete-before-centroid-v1",
      distance: "euclidean-selected-and-full-space-v1",
      gap: "expected-period-no-bridge-v1",
      speed: "step-distance-divided-by-positive-adjacent-elapsed-v1",
    }),
    participantPeriods: arrayOf(trajectoryParticipantPeriodSchema(true)),
    periods: arrayOf(TRAJECTORY_DYNAMICS_PERIOD_SCHEMA),
    diagnostics: DIAGNOSTICS_SCHEMA,
    diagnosticSummary: exactObject(
      ["info", "warning", "codes"],
      { info: SAFE_NON_NEGATIVE_INTEGER_SCHEMA, warning: SAFE_NON_NEGATIVE_INTEGER_SCHEMA, codes: arrayOf(NON_EMPTY_STRING_SCHEMA, { uniqueItems: true }) },
    ),
    summary: countObject(["inputRows", "participants", "participantPeriods", "periods", "observedPeriods", "missingPeriods", "duplicateRows", "cohortExcludedParticipants"]),
    evidence: constObject({ status: "IMPLEMENTED_UNVERIFIED", oracleParityClaim: false, scientificAuthority: "successor-definition-pending-review" }),
    resolvedLimits: countObject(["maxPoints", "maxDimensions", "maxPeriods", "maxParticipants", "maxCells"], true),
  },
);

const TRAJECTORY_COMPARISON_PERIOD_FIELDS = [
  "index", "time", "selectedCentroidA", "selectedCentroidB", "selectedDifference", "fullCentroidA", "fullCentroidB", "fullDifference",
  "selectedCentroidSeparation", "fullCentroidSeparation", "selectedStepDistanceA", "selectedStepDistanceB", "selectedStepDistanceDifference",
  "selectedCumulativeDistanceA", "selectedCumulativeDistanceB", "selectedCumulativeDistanceDifference", "fullStepDistanceA", "fullStepDistanceB",
  "fullStepDistanceDifference", "fullCumulativeDistanceA", "fullCumulativeDistanceB", "fullCumulativeDistanceDifference", "nAUsed", "nBUsed", "nMatched",
] as const;

const TRAJECTORY_COMPARISON_PERIOD_SCHEMA = exactObject(
  TRAJECTORY_COMPARISON_PERIOD_FIELDS,
  {
    index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    time: TRAJECTORY_KEY_SCHEMA,
    selectedCentroidA: nullable(vector(3)),
    selectedCentroidB: nullable(vector(3)),
    selectedDifference: nullable(vector(3)),
    fullCentroidA: nullable(vector()),
    fullCentroidB: nullable(vector()),
    fullDifference: nullable(vector()),
    ...Object.fromEntries([
      "selectedCentroidSeparation", "fullCentroidSeparation", "selectedStepDistanceA", "selectedStepDistanceB", "selectedStepDistanceDifference",
      "selectedCumulativeDistanceA", "selectedCumulativeDistanceB", "selectedCumulativeDistanceDifference", "fullStepDistanceA", "fullStepDistanceB",
      "fullStepDistanceDifference", "fullCumulativeDistanceA", "fullCumulativeDistanceB", "fullCumulativeDistanceDifference",
    ].map((field) => [field, nullable(FINITE_NUMBER_SCHEMA)])),
    nAUsed: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    nBUsed: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    nMatched: nullable(SAFE_NON_NEGATIVE_INTEGER_SCHEMA),
  },
);

const TRAJECTORY_COMPARISON_RESULT_SCHEMA: JsonSchema = exactObject(
  ["schemaVersion", "design", "direction", "pairedId", "sideA", "sideB", "periods", "tests", "permutation", "diagnostics"],
  {
    schemaVersion: { const: "3dena.trajectory-comparison.v1" },
    design: { enum: ["paired", "independent"] },
    direction: { const: "B-minus-A" },
    pairedId: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA, arrayOf(NON_EMPTY_STRING_SCHEMA, { minItems: 1, uniqueItems: true })] },
    sideA: TRAJECTORY_PATH_STATISTICS_SCHEMA,
    sideB: TRAJECTORY_PATH_STATISTICS_SCHEMA,
    periods: arrayOf(TRAJECTORY_COMPARISON_PERIOD_SCHEMA),
    tests: arrayOf(exactObject(
      ["id", "timeIndex", "metric", "distanceSpace", "tail", "observed", "pValue", "holmAdjustedPValue", "permutationCount"],
      {
        id: NON_EMPTY_STRING_SCHEMA,
        timeIndex: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
        metric: NON_EMPTY_STRING_SCHEMA,
        distanceSpace: { enum: [null, "selected-3d", "full-space"] },
        tail: { enum: ["two-sided", "upper"] },
        observed: FINITE_NUMBER_SCHEMA,
        pValue: PROBABILITY_SCHEMA,
        holmAdjustedPValue: PROBABILITY_SCHEMA,
        permutationCount: SAFE_POSITIVE_INTEGER_SCHEMA,
      },
    )),
    permutation: exactObject(
      ["status", "planKind", "unitOrder", "replicateCount", "rngParityClaim"],
      {
        status: { enum: ["not-requested", "complete"] },
        planKind: { enum: [null, "paired-swap-indices-v1", "independent-pool-indices-v1"] },
        unitOrder: arrayOf(NON_EMPTY_STRING_SCHEMA, { uniqueItems: true }),
        replicateCount: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
        rngParityClaim: { const: false },
      },
    ),
    diagnostics: DIAGNOSTICS_SCHEMA,
  },
);
TRAJECTORY_COMPARISON_RESULT_SCHEMA.allOf = [
  { if: { properties: { design: { const: "independent" } } }, then: { properties: { pairedId: { type: "null" } } } },
  { if: { properties: { design: { const: "paired" } } }, then: { properties: { pairedId: { oneOf: [NON_EMPTY_STRING_SCHEMA, arrayOf(NON_EMPTY_STRING_SCHEMA, { minItems: 1, uniqueItems: true })] } } } },
];

const BOOTSTRAP_INTERVAL_SCHEMA = exactObject(
  ["estimate", "lower", "upper", "finiteReplicates", "requiredFiniteReplicates", "totalReplicates"],
  {
    estimate: FINITE_NUMBER_SCHEMA,
    lower: FINITE_NUMBER_SCHEMA,
    upper: FINITE_NUMBER_SCHEMA,
    finiteReplicates: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    requiredFiniteReplicates: SAFE_POSITIVE_INTEGER_SCHEMA,
    totalReplicates: SAFE_POSITIVE_INTEGER_SCHEMA,
  },
);

const BOOTSTRAP_PERIOD_SCHEMA = exactObject(
  ["index", "time", "selectedCentroid", "fullCentroid", "selectedStepDistance", "fullStepDistance", "selectedCumulativeDistance", "fullCumulativeDistance"],
  {
    index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    time: TRAJECTORY_KEY_SCHEMA,
    selectedCentroid: arrayOf(nullable(BOOTSTRAP_INTERVAL_SCHEMA), { minItems: 3, maxItems: 3 }),
    fullCentroid: arrayOf(nullable(BOOTSTRAP_INTERVAL_SCHEMA), { minItems: 1 }),
    selectedStepDistance: nullable(BOOTSTRAP_INTERVAL_SCHEMA),
    fullStepDistance: nullable(BOOTSTRAP_INTERVAL_SCHEMA),
    selectedCumulativeDistance: nullable(BOOTSTRAP_INTERVAL_SCHEMA),
    fullCumulativeDistance: nullable(BOOTSTRAP_INTERVAL_SCHEMA),
  },
);

const BOOTSTRAP_GENERATION_SCHEMA: JsonSchema = {
  oneOf: [
    exactObject(["kind"], { kind: { const: "caller-provided" } }),
    exactObject(
      ["kind", "algorithm", "seed", "unitSort", "randomEndpoint"],
      {
        kind: { const: "seeded" },
        algorithm: { const: "mulberry32-uint32-v1" },
        seed: UINT32_SCHEMA,
        unitSort: { const: "utf16-code-unit-ascending" },
        randomEndpoint: { const: "zero-inclusive-one-exclusive" },
      },
    ),
  ],
};

const BOOTSTRAP_RESULT_SCHEMA = exactObject(
  ["schemaVersion", "base", "confidenceLevel", "periods", "quantileRule", "resampling", "diagnostics"],
  {
    schemaVersion: { const: "3dena.trajectory-bootstrap.v1" },
    base: TRAJECTORY_PATH_STATISTICS_SCHEMA,
    confidenceLevel: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1 },
    periods: arrayOf(BOOTSTRAP_PERIOD_SCHEMA),
    quantileRule: constObject({
      id: "linear-type7-v1",
      sort: "ascending-numeric",
      position: "(n-1)*p",
      interpolation: "linear-between-floor-and-ceiling",
      endpoints: "p=0-min-p=1-max",
    }),
    resampling: exactObject(
      ["unit", "stratified", "strata", "replicateCount", "planKind", "generation", "rngParityClaim"],
      {
        unit: { const: "participant-complete-history" },
        stratified: { type: "boolean" },
        strata: arrayOf(exactObject(
          ["key", "unitCount"],
          { key: TRAJECTORY_KEY_SCHEMA, unitCount: SAFE_POSITIVE_INTEGER_SCHEMA },
        ), { minItems: 1 }),
        replicateCount: SAFE_POSITIVE_INTEGER_SCHEMA,
        planKind: { enum: ["participant-history-resample-indices-v1", "global-participant-history-resample-indices-v2"] },
        generation: BOOTSTRAP_GENERATION_SCHEMA,
        rngParityClaim: { const: false },
      },
    ),
    diagnostics: DIAGNOSTICS_SCHEMA,
  },
);

const PREPARED_ENTITY_KEY_SCHEMA = exactObject(
  ["canonical", "display", "columns", "columnTypes", "values"],
  {
    canonical: NON_EMPTY_STRING_SCHEMA,
    display: { type: "string" },
    columns: arrayOf(NON_EMPTY_STRING_SCHEMA, { minItems: 1, uniqueItems: true }),
    columnTypes: arrayOf({ enum: PREPARED_COLUMN_TYPES }, { minItems: 1 }),
    values: arrayOf(RAW_SCALAR_SCHEMA, { minItems: 1 }),
  },
);

const PREPARED_TYPED_VALUE_SCHEMA = exactObject(
  ["canonical", "display", "column", "columnType", "value"],
  {
    canonical: NON_EMPTY_STRING_SCHEMA,
    display: { type: "string" },
    column: NON_EMPTY_STRING_SCHEMA,
    columnType: { enum: PREPARED_COLUMN_TYPES },
    value: RAW_SCALAR_SCHEMA,
  },
);

const PREPARED_MAPPING_SCHEMA = exactObject(
  ["participant", "participantLabel", "group", "time", "timeOrder", "cohortPolicy", "displayDimensions", "missingDisplayCoordinates"],
  {
    participant: arrayOf(NON_EMPTY_STRING_SCHEMA, { minItems: 1, uniqueItems: true }),
    participantLabel: NON_EMPTY_STRING_SCHEMA,
    group: NON_EMPTY_STRING_SCHEMA,
    time: NON_EMPTY_STRING_SCHEMA,
    timeOrder: arrayOf(RAW_SCALAR_SCHEMA, { minItems: 1, uniqueItems: true }),
    cohortPolicy: { enum: ["available", "complete"] },
    displayDimensions: arrayOf(NON_EMPTY_STRING_SCHEMA, { minItems: 3, maxItems: 3, uniqueItems: true }),
    missingDisplayCoordinates: { const: "reject" },
  },
);

const PREPARED_POINT_SCHEMA = exactObject(
  ["index", "id", "participant", "participantLabel", "group", "time", "metadata", "coordinates"],
  {
    index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    id: PREPARED_ENTITY_KEY_SCHEMA,
    participant: PREPARED_ENTITY_KEY_SCHEMA,
    participantLabel: PREPARED_TYPED_VALUE_SCHEMA,
    group: PREPARED_TYPED_VALUE_SCHEMA,
    time: PREPARED_TYPED_VALUE_SCHEMA,
    metadata: { type: "object", additionalProperties: RAW_SCALAR_SCHEMA },
    coordinates: vector(),
  },
);

const PREPARED_NODE_SCHEMA = exactObject(
  ["index", "code", "coordinates"],
  { index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA, code: NON_EMPTY_STRING_SCHEMA, coordinates: vector() },
);

const PREPARED_EDGE_SCHEMA = ANALYSIS_EDGE_SCHEMA;

const PREPARED_DISPLAY_PARTICIPANT_PERIOD_SCHEMA = exactObject(
  ["index", "participant", "participantLabel", "group", "time", "coordinates", "sourcePointIndexes", "includedInCohort"],
  {
    index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    participant: PREPARED_ENTITY_KEY_SCHEMA,
    participantLabel: PREPARED_TYPED_VALUE_SCHEMA,
    group: PREPARED_TYPED_VALUE_SCHEMA,
    time: PREPARED_TYPED_VALUE_SCHEMA,
    coordinates: vector(3),
    sourcePointIndexes: arrayOf(SAFE_NON_NEGATIVE_INTEGER_SCHEMA, { minItems: 1, uniqueItems: true }),
    includedInCohort: { type: "boolean" },
  },
);

const PREPARED_DISPLAY_CENTROID_SCHEMA = exactObject(
  ["index", "group", "time", "coordinates", "participantCount", "participantPeriodIndexes"],
  {
    index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
    group: PREPARED_TYPED_VALUE_SCHEMA,
    time: PREPARED_TYPED_VALUE_SCHEMA,
    coordinates: vector(3),
    participantCount: SAFE_POSITIVE_INTEGER_SCHEMA,
    participantPeriodIndexes: arrayOf(SAFE_NON_NEGATIVE_INTEGER_SCHEMA, { minItems: 1, uniqueItems: true }),
  },
);

const PREPARED_DISPLAY_PATH_SCHEMA = exactObject(
  ["group", "steps"],
  {
    group: PREPARED_TYPED_VALUE_SCHEMA,
    steps: arrayOf(exactObject(
      ["time", "centroidIndex"],
      { time: PREPARED_TYPED_VALUE_SCHEMA, centroidIndex: nullable(SAFE_NON_NEGATIVE_INTEGER_SCHEMA) },
    ), { minItems: 1 }),
  },
);

const PREPARED_TRAJECTORY_SCHEMA = exactObject(
  ["space", "dimensions", "cohortPolicy", "groupOrder", "timeOrder", "participantPeriods", "centroids", "paths"],
  {
    space: { const: "prepared-exchange-display-space" },
    dimensions: arrayOf(NON_EMPTY_STRING_SCHEMA, { minItems: 3, maxItems: 3, uniqueItems: true }),
    cohortPolicy: { enum: ["available", "complete"] },
    groupOrder: arrayOf(PREPARED_TYPED_VALUE_SCHEMA, { minItems: 1 }),
    timeOrder: arrayOf(PREPARED_TYPED_VALUE_SCHEMA, { minItems: 1 }),
    participantPeriods: arrayOf(PREPARED_DISPLAY_PARTICIPANT_PERIOD_SCHEMA),
    centroids: arrayOf(PREPARED_DISPLAY_CENTROID_SCHEMA),
    paths: arrayOf(PREPARED_DISPLAY_PATH_SCHEMA, { minItems: 1 }),
  },
);

export const PREPARED_SPACE_RESULT_SCHEMA_V1: JsonSchema = exactObject(
  ["schemaVersion", "sourceKind", "rawJenaRecompute", "sourceReceipt", "artifacts", "fullSpace", "displaySpace", "summary", "diagnostics", "provenance"],
  {
    schemaVersion: { const: "3dena.prepared-space-result.v1" },
    sourceKind: { const: "prepared-exchange" },
    rawJenaRecompute: { const: false },
    sourceReceipt: exactObject(
      ["name", "sha256", "byteLength"],
      { name: NON_EMPTY_STRING_SCHEMA, sha256: HASH_SCHEMA, byteLength: SAFE_POSITIVE_INTEGER_SCHEMA },
    ),
    artifacts: constObject({ rotation: "not-present", eigenvalues: "not-present", variance: "not-present" }),
    fullSpace: exactObject(
      ["dimensions", "points", "nodes", "edges", "lineWeights"],
      {
        dimensions: arrayOf(NON_EMPTY_STRING_SCHEMA, { minItems: 1, uniqueItems: true }),
        points: arrayOf(PREPARED_POINT_SCHEMA, { minItems: 1 }),
        nodes: arrayOf(PREPARED_NODE_SCHEMA, { minItems: 1 }),
        edges: arrayOf(PREPARED_EDGE_SCHEMA, { minItems: 1 }),
        lineWeights: exactObject(
          ["rowKeys", "columns", "values"],
          {
            rowKeys: arrayOf(PREPARED_ENTITY_KEY_SCHEMA, { minItems: 1 }),
            columns: arrayOf(NON_EMPTY_STRING_SCHEMA, { minItems: 1, uniqueItems: true }),
            values: arrayOf(vector(), { minItems: 1 }),
          },
        ),
      },
    ),
    displaySpace: exactObject(
      ["dimensions", "points", "nodes", "trajectory"],
      {
        dimensions: arrayOf(NON_EMPTY_STRING_SCHEMA, { minItems: 3, maxItems: 3, uniqueItems: true }),
        points: arrayOf(exactObject(
          ["pointIndex", "id", "group", "time", "coordinates"],
          { pointIndex: SAFE_NON_NEGATIVE_INTEGER_SCHEMA, id: PREPARED_ENTITY_KEY_SCHEMA, group: PREPARED_TYPED_VALUE_SCHEMA, time: PREPARED_TYPED_VALUE_SCHEMA, coordinates: vector(3) },
        ), { minItems: 1 }),
        nodes: arrayOf(exactObject(
          ["nodeIndex", "code", "coordinates"],
          { nodeIndex: SAFE_NON_NEGATIVE_INTEGER_SCHEMA, code: NON_EMPTY_STRING_SCHEMA, coordinates: vector(3) },
        ), { minItems: 1 }),
        trajectory: PREPARED_TRAJECTORY_SCHEMA,
      },
    ),
    summary: countObject(["dimensions", "points", "nodes", "edges", "lineWeightRows", "groups", "timePoints", "participantPeriods", "trajectoryCentroids"]),
    diagnostics: DIAGNOSTICS_SCHEMA,
    provenance: exactObject(
      ["adapter", "adapterVersion", "coordinateSpace", "computation", "jenaExecuted", "resolvedMapping"],
      {
        adapter: { const: "@3dena/analysis" },
        adapterVersion: { const: "0.1.0" },
        coordinateSpace: { const: "precomputed-import" },
        computation: { const: "reduction-only" },
        jenaExecuted: { const: false },
        resolvedMapping: PREPARED_MAPPING_SCHEMA,
      },
    ),
  },
);

export const RESULT_VARIANT_SCHEMAS_V1: Readonly<Record<string, JsonSchema>> = Object.freeze({
  "ena-model": ENA_MODEL_RESULT_SCHEMA_V1,
  "prepared-import": PREPARED_SPACE_RESULT_SCHEMA_V1,
  "network-comparison": NETWORK_COMPARISON_RESULT_SCHEMA,
  "change-network": CHANGE_NETWORK_RESULT_SCHEMA,
  statistics: STATISTICS_TASK_RESULT_SCHEMA,
  trajectory: TRAJECTORY_DYNAMICS_RESULT_SCHEMA,
  "trajectory-comparison": TRAJECTORY_COMPARISON_RESULT_SCHEMA,
  bootstrap: BOOTSTRAP_RESULT_SCHEMA,
});

export const ANALYSIS_EXECUTION_DATASET_V2_SCHEMA: JsonSchema = {
  $id: "https://3dena.com/schemas/analysis-execution-dataset.v2.json",
  ...exactObject(
    ["schemaVersion", "receipt", "specHash", "buildId"],
    {
      schemaVersion: { const: "3dena.analysis-execution-dataset.v2" },
      receipt: { $ref: "https://3dena.com/schemas/dataset-receipt.v1.json" },
      specHash: HASH_SCHEMA,
      buildId: NON_EMPTY_STRING_SCHEMA,
      generatedAt: { type: "string", minLength: 1, format: "date-time" },
      sourceResult: {
        oneOf: [
          exactObject(
            ["sourceKind", "hash", "result"],
            { sourceKind: { const: "raw-jena" }, hash: HASH_SCHEMA, result: ENA_MODEL_RESULT_SCHEMA_V1 },
          ),
          exactObject(
            ["sourceKind", "hash", "result"],
            { sourceKind: { const: "prepared-exchange" }, hash: HASH_SCHEMA, result: PREPARED_SPACE_RESULT_SCHEMA_V1 },
          ),
        ],
      },
    },
  ),
  allOf: [
    {
      if: {
        required: ["sourceResult"],
        properties: { sourceResult: { required: ["sourceKind"], properties: { sourceKind: { const: "prepared-exchange" } } } },
      },
      then: { properties: { receipt: { properties: { format: { const: "ena3d-json" } } } } },
    },
  ],
};
