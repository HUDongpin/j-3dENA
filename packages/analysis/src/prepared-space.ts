import type {
  Ena3dExchangeColumn,
  Ena3dExchangeColumnType,
  Ena3dExchangeTable,
  ValidatedEna3dExchangeV1,
} from "@3dena/io";
import { isHashedEna3dExchangeV1 } from "@3dena/io";

import {
  AnalysisValidationError,
  type AnalysisDiagnostic,
  type AnalysisValidationIssue,
  type Coordinates3D,
  type RawScalar,
} from "./types";
import type {
  AnalyzePreparedSpaceInput,
  PreparedEntityKey,
  PreparedParticipantPeriodPoint,
  PreparedSpaceDisplayFilter,
  PreparedSpaceDisplaySelection,
  PreparedSpaceEdge,
  PreparedSpaceMapping,
  PreparedSpaceNode,
  PreparedSpacePoint,
  PreparedSpaceResult,
  PreparedTrajectoryCentroid,
  PreparedTrajectoryPath,
  PreparedTypedValue,
} from "./prepared-types";

const SOURCE_ROW_OCCURRENCE = "@3dena/source-row-occurrence";
const SOURCE_NAME_MAX_UTF8_BYTES = 1_024;
const IDENTITY_STRING_MAX_UTF8_BYTES = 32_768;
const PREPARED_PARTICIPANT_COLUMN_LIMIT = 500;
const PREPARED_TIME_ORDER_LIMIT = 10_000;
const PREPARED_GROUP_LIMIT = 200;
const PREPARED_TRAJECTORY_CELL_LIMIT = 1_000_000;
const UTF8_ENCODER = new TextEncoder();

interface ParticipantPeriodAccumulator {
  participant: PreparedEntityKey;
  participantLabel: PreparedTypedValue;
  group: PreparedTypedValue;
  time: PreparedTypedValue;
  coordinateMeans: Coordinates3D;
  count: number;
  sourcePointIndexes: number[];
}

function issue(code: string, path: string, message: string): AnalysisValidationIssue {
  return { code, path, message };
}

function reject(code: string, path: string, message: string): never {
  throw new AnalysisValidationError([issue(code, path, message)]);
}

function columnMap(table: Ena3dExchangeTable): Map<string, Ena3dExchangeColumn> {
  return new Map(table.columns.map((column) => [column.name, column]));
}

function requiredColumn(
  columns: ReadonlyMap<string, Ena3dExchangeColumn>,
  name: string,
  path: string,
): Ena3dExchangeColumn {
  const column = columns.get(name);
  if (!column) {
    reject("MISSING_PREPARED_COLUMN", path, `column ${JSON.stringify(name)} is required`);
  }
  return column;
}

function rawValue(
  column: Ena3dExchangeColumn,
  rowIndex: number,
  path: string,
): RawScalar {
  const value = column.values[rowIndex];
  if (
    value !== null &&
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    reject("INVALID_PREPARED_SCALAR", path, "must be a scalar exchange value");
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    reject("NON_FINITE_PREPARED_VALUE", path, "must be finite");
  }
  return value ?? null;
}

function validateIdentityScalar(value: RawScalar, path: string): void {
  if (
    value !== null &&
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    reject("INVALID_PREPARED_IDENTITY", path, "must be a scalar value");
  }
  if (value === null) {
    reject("MISSING_PREPARED_IDENTITY", path, "identity values must not be null");
  }
  if (typeof value === "string" && value.trim().length === 0) {
    reject("BLANK_PREPARED_IDENTITY", path, "identity strings must not be blank");
  }
  if (
    typeof value === "string" &&
    UTF8_ENCODER.encode(value).byteLength > IDENTITY_STRING_MAX_UTF8_BYTES
  ) {
    reject(
      "PREPARED_IDENTITY_TOO_LONG",
      path,
      `must not exceed ${IDENTITY_STRING_MAX_UTF8_BYTES} UTF-8 bytes`,
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    reject("NON_FINITE_PREPARED_IDENTITY", path, "numeric identities must be finite");
  }
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    !Number.isSafeInteger(value)
  ) {
    reject(
      "UNSAFE_PREPARED_INTEGER_IDENTITY",
      path,
      "integer identities outside the JavaScript safe range must be encoded as strings",
    );
  }
}

function scalarToken(value: RawScalar): readonly [string, string] {
  if (value === null) return ["null", ""];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "boolean") return ["boolean", value ? "true" : "false"];
  if (Object.is(value, -0)) return ["number", "-0"];
  return ["number", String(value)];
}

function canonicalTuple(
  columns: readonly string[],
  columnTypes: readonly Ena3dExchangeColumnType[],
  values: readonly RawScalar[],
): string {
  return JSON.stringify(
    values.map((value, index) => [
      columns[index],
      columnTypes[index],
      ...scalarToken(value),
    ]),
  );
}

function displayScalar(value: RawScalar): string {
  return value === null ? "" : String(value);
}

function entityKeyFromColumns(
  columns: readonly Ena3dExchangeColumn[],
  rowIndex: number,
  path: string,
): PreparedEntityKey {
  const names = columns.map((column) => column.name);
  const types = columns.map((column) => column.type);
  const values = columns.map((column) => {
    const value = rawValue(column, rowIndex, `${path}.${column.name}`);
    validateIdentityScalar(value, `${path}.${column.name}`);
    return value;
  });
  return {
    canonical: canonicalTuple(names, types, values),
    display: values.map(displayScalar).join(" · "),
    columns: [...names],
    columnTypes: [...types],
    values,
  };
}

function appendOccurrence(
  key: PreparedEntityKey,
  occurrence: number,
): PreparedEntityKey {
  const columns = [...key.columns, SOURCE_ROW_OCCURRENCE];
  const columnTypes: Ena3dExchangeColumnType[] = [...key.columnTypes, "integer"];
  const values: RawScalar[] = [...key.values, occurrence];
  return {
    canonical: canonicalTuple(columns, columnTypes, values),
    display: `${key.display} · ${occurrence}`,
    columns,
    columnTypes,
    values,
  };
}

function typedValueFromColumn(
  column: Ena3dExchangeColumn,
  rowIndex: number,
  path: string,
): PreparedTypedValue {
  const value = rawValue(column, rowIndex, path);
  validateIdentityScalar(value, path);
  return typedValue(column.name, column.type, value);
}

function typedValue(
  column: string,
  columnType: Ena3dExchangeColumnType,
  value: RawScalar,
): PreparedTypedValue {
  validateIdentityScalar(value, `mapping.timeOrder[${displayScalar(value)}]`);
  return {
    canonical: canonicalTuple([column], [columnType], [value]),
    display: displayScalar(value),
    column,
    columnType,
    value,
  };
}

function sameTypedValue(left: PreparedTypedValue, right: PreparedTypedValue): boolean {
  return left.canonical === right.canonical;
}

function numericColumnValue(
  column: Ena3dExchangeColumn,
  rowIndex: number,
  path: string,
): number {
  const value = rawValue(column, rowIndex, path);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    reject(
      "INVALID_PREPARED_COORDINATE",
      path,
      "prepared coordinates and weights must be present finite numbers",
    );
  }
  return value;
}

function validateSourceName(name: string): void {
  if (typeof name !== "string" || name.trim().length === 0) {
    reject("INVALID_PREPARED_SOURCE_NAME", "source.name", "must be a non-blank string");
  }
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(name)) {
    reject("INVALID_PREPARED_SOURCE_NAME", "source.name", "must not contain control characters");
  }
  if (/[\\/]/u.test(name)) {
    reject("INVALID_PREPARED_SOURCE_NAME", "source.name", "must be a file name, not a path");
  }
  if (UTF8_ENCODER.encode(name).byteLength > SOURCE_NAME_MAX_UTF8_BYTES) {
    reject(
      "PREPARED_SOURCE_NAME_TOO_LONG",
      "source.name",
      `must not exceed ${SOURCE_NAME_MAX_UTF8_BYTES} UTF-8 bytes`,
    );
  }
}

function validateMapping(
  exchange: ValidatedEna3dExchangeV1,
  mapping: PreparedSpaceMapping,
): {
  metadataColumns: Map<string, Ena3dExchangeColumn>;
  participantColumns: Ena3dExchangeColumn[];
  participantLabelColumn: Ena3dExchangeColumn;
  groupColumn: Ena3dExchangeColumn;
  timeColumn: Ena3dExchangeColumn;
  timeOrder: PreparedTypedValue[];
  displayDimensionIndexes: [number, number, number];
} {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    reject("INVALID_PREPARED_MAPPING", "mapping", "must be an object");
  }
  if (!Array.isArray(mapping.participant) || mapping.participant.length === 0) {
    reject("INVALID_PREPARED_MAPPING", "mapping.participant", "must name at least one column");
  }
  if (mapping.participant.length > PREPARED_PARTICIPANT_COLUMN_LIMIT) {
    reject(
      "PREPARED_MAPPING_LIMIT_EXCEEDED",
      "mapping.participant",
      `must not exceed ${PREPARED_PARTICIPANT_COLUMN_LIMIT} columns`,
    );
  }
  if (
    mapping.participant.some(
      (name) => typeof name !== "string" || name.trim().length === 0,
    )
  ) {
    reject("INVALID_PREPARED_MAPPING", "mapping.participant", "must contain non-blank column names");
  }
  if (new Set(mapping.participant).size !== mapping.participant.length) {
    reject("DUPLICATE_PREPARED_MAPPING", "mapping.participant", "must not contain duplicate columns");
  }
  if (!mapping.participant.includes(mapping.group)) {
    reject(
      "GROUP_OUTSIDE_PREPARED_PARTICIPANT",
      "mapping.group",
      "the trajectory group must be part of the complete participant identity",
    );
  }
  if (!Array.isArray(mapping.displayDimensions) || mapping.displayDimensions.length !== 3) {
    reject("INVALID_PREPARED_MAPPING", "mapping.displayDimensions", "must select exactly three dimensions");
  }
  if (
    mapping.displayDimensions.some(
      (name) => typeof name !== "string" || name.trim().length === 0,
    )
  ) {
    reject("INVALID_PREPARED_MAPPING", "mapping.displayDimensions", "must contain dimension names");
  }
  for (const [path, value] of [
    ["mapping.participantLabel", mapping.participantLabel],
    ["mapping.group", mapping.group],
    ["mapping.time", mapping.time],
  ] as const) {
    if (typeof value !== "string" || value.trim().length === 0) {
      reject("INVALID_PREPARED_MAPPING", path, "must name a non-blank metadata column");
    }
  }
  if (new Set(mapping.displayDimensions).size !== 3) {
    reject("DUPLICATE_PREPARED_MAPPING", "mapping.displayDimensions", "must contain three distinct dimensions");
  }
  if (mapping.missingDisplayCoordinates !== undefined && mapping.missingDisplayCoordinates !== "reject") {
    reject("INVALID_PREPARED_MAPPING", "mapping.missingDisplayCoordinates", "only the reject policy is supported");
  }
  if (mapping.cohortPolicy !== "available" && mapping.cohortPolicy !== "complete") {
    reject("INVALID_PREPARED_MAPPING", "mapping.cohortPolicy", "must be available or complete");
  }

  const metadataColumns = columnMap(exchange.tables.meta_data);
  const participantColumns = mapping.participant.map((name, index) =>
    requiredColumn(metadataColumns, name, `mapping.participant[${index}]`),
  );
  const participantLabelColumn = requiredColumn(
    metadataColumns,
    mapping.participantLabel,
    "mapping.participantLabel",
  );
  const groupColumn = requiredColumn(metadataColumns, mapping.group, "mapping.group");
  const timeColumn = requiredColumn(metadataColumns, mapping.time, "mapping.time");

  if (!Array.isArray(mapping.timeOrder) || mapping.timeOrder.length === 0) {
    reject("INVALID_PREPARED_TIME_ORDER", "mapping.timeOrder", "must contain at least one expected period");
  }
  if (mapping.timeOrder.length > PREPARED_TIME_ORDER_LIMIT) {
    reject(
      "PREPARED_TIME_ORDER_LIMIT_EXCEEDED",
      "mapping.timeOrder",
      `must not exceed ${PREPARED_TIME_ORDER_LIMIT} expected periods`,
    );
  }
  const timeOrder = mapping.timeOrder.map((value, index) => {
    validateIdentityScalar(value, `mapping.timeOrder[${index}]`);
    return typedValue(timeColumn.name, timeColumn.type, value);
  });
  if (new Set(timeOrder.map((time) => time.canonical)).size !== timeOrder.length) {
    reject("DUPLICATE_PREPARED_TIME", "mapping.timeOrder", "must not contain duplicate typed periods");
  }

  const displayDimensionIndexes = mapping.displayDimensions.map((dimension, index) => {
    const dimensionIndex = exchange.dimensions.indexOf(dimension);
    if (dimensionIndex < 0) {
      reject(
        "MISSING_PREPARED_DIMENSION",
        `mapping.displayDimensions[${index}]`,
        `dimension ${JSON.stringify(dimension)} is not present`,
      );
    }
    return dimensionIndex;
  }) as [number, number, number];

  return {
    metadataColumns,
    participantColumns,
    participantLabelColumn,
    groupColumn,
    timeColumn,
    timeOrder,
    displayDimensionIndexes,
  };
}

function metadataRecord(
  columns: readonly Ena3dExchangeColumn[],
  rowIndex: number,
): Record<string, RawScalar> {
  return Object.fromEntries(
    columns.map((column) => [
      column.name,
      rawValue(column, rowIndex, `tables.meta_data.${column.name}[${rowIndex}]`),
    ]),
  );
}

function buildRowKeys(
  sourceIdColumn: Ena3dExchangeColumn,
  rowCount: number,
): PreparedEntityKey[] {
  const base = Array.from({ length: rowCount }, (_, rowIndex) =>
    entityKeyFromColumns(
      [sourceIdColumn],
      rowIndex,
      `tables.meta_data.${sourceIdColumn.name}[${rowIndex}]`,
    ),
  );
  const totals = new Map<string, number>();
  for (const key of base) totals.set(key.canonical, (totals.get(key.canonical) ?? 0) + 1);
  const occurrences = new Map<string, number>();
  return base.map((key) => {
    if ((totals.get(key.canonical) ?? 0) === 1) return key;
    const occurrence = (occurrences.get(key.canonical) ?? 0) + 1;
    occurrences.set(key.canonical, occurrence);
    return appendOccurrence(key, occurrence);
  });
}

function stableMean(values: readonly number[], path: string): number {
  if (values.length === 0) {
    reject("EMPTY_PREPARED_REDUCTION", path, "cannot reduce an empty numeric set");
  }
  let result = 0;
  for (let index = 0; index < values.length; index += 1) {
    const count = index + 1;
    result += values[index]! / count - result / count;
    if (!Number.isFinite(result)) {
      reject("NON_FINITE_PREPARED_REDUCTION", path, "finite inputs produced a non-finite reduction");
    }
  }
  return result;
}

function buildParticipantPeriods(
  points: readonly PreparedSpacePoint[],
  timeOrder: readonly PreparedTypedValue[],
  cohortPolicy: PreparedSpaceMapping["cohortPolicy"],
): PreparedParticipantPeriodPoint[] {
  const expectedTimes = new Set(timeOrder.map((time) => time.canonical));
  const byParticipantPeriod = new Map<string, ParticipantPeriodAccumulator>();
  const participantAttributes = new Map<
    string,
    { group: PreparedTypedValue; participantLabel: PreparedTypedValue }
  >();

  for (const point of points) {
    if (!expectedTimes.has(point.time.canonical)) {
      reject(
        "UNDECLARED_PREPARED_TIME",
        `tables.meta_data.${point.time.column}[${point.index}]`,
        `observed period ${JSON.stringify(point.time.display)} is absent from mapping.timeOrder`,
      );
    }
    const knownAttributes = participantAttributes.get(point.participant.canonical);
    if (!knownAttributes) {
      participantAttributes.set(point.participant.canonical, {
        group: point.group,
        participantLabel: point.participantLabel,
      });
    } else {
      if (!sameTypedValue(knownAttributes.group, point.group)) {
        reject(
          "UNSTABLE_PREPARED_GROUP",
          `tables.meta_data.${point.group.column}[${point.index}]`,
          "one participant cannot change groups across periods",
        );
      }
      if (!sameTypedValue(knownAttributes.participantLabel, point.participantLabel)) {
        reject(
          "UNSTABLE_PREPARED_PARTICIPANT_LABEL",
          `tables.meta_data.${point.participantLabel.column}[${point.index}]`,
          "one participant cannot change display labels across periods",
        );
      }
    }
    const key = JSON.stringify([point.participant.canonical, point.time.canonical]);
    const existing = byParticipantPeriod.get(key);
    const displayCoordinates = point.coordinates.slice(0, 3) as Coordinates3D;
    if (!existing) {
      byParticipantPeriod.set(key, {
        participant: point.participant,
        participantLabel: point.participantLabel,
        group: point.group,
        time: point.time,
        coordinateMeans: [...displayCoordinates],
        count: 1,
        sourcePointIndexes: [point.index],
      });
      continue;
    }
    if (!sameTypedValue(existing.group, point.group)) {
      reject(
        "UNSTABLE_PREPARED_GROUP",
        `tables.meta_data.${point.group.column}[${point.index}]`,
        "one participant-period cannot belong to multiple groups",
      );
    }
    if (!sameTypedValue(existing.participantLabel, point.participantLabel)) {
      reject(
        "UNSTABLE_PREPARED_PARTICIPANT_LABEL",
        `tables.meta_data.${point.participantLabel.column}[${point.index}]`,
        "one participant cannot have conflicting labels within a period",
      );
    }
    const count = existing.count + 1;
    existing.coordinateMeans = existing.coordinateMeans.map(
      (current, axis) =>
        current + (displayCoordinates[axis]! / count - current / count),
    ) as Coordinates3D;
    if (existing.coordinateMeans.some((coordinate) => !Number.isFinite(coordinate))) {
      reject(
        "NON_FINITE_PREPARED_REDUCTION",
        `tables.points[${point.index}]`,
        "finite participant-period coordinates produced a non-finite mean",
      );
    }
    existing.count = count;
    existing.sourcePointIndexes.push(point.index);
  }

  const periodsByParticipant = new Map<string, Set<string>>();
  for (const entry of byParticipantPeriod.values()) {
    const periods = periodsByParticipant.get(entry.participant.canonical) ?? new Set<string>();
    periods.add(entry.time.canonical);
    periodsByParticipant.set(entry.participant.canonical, periods);
  }
  const completeParticipants = new Set(
    [...periodsByParticipant]
      .filter(([, periods]) => periods.size === timeOrder.length)
      .map(([participant]) => participant),
  );

  return [...byParticipantPeriod.values()].map((entry, index) => ({
    index,
    participant: entry.participant,
    participantLabel: entry.participantLabel,
    group: entry.group,
    time: entry.time,
    coordinates: [...entry.coordinateMeans],
    sourcePointIndexes: [...entry.sourcePointIndexes],
    includedInCohort:
      cohortPolicy === "available" || completeParticipants.has(entry.participant.canonical),
  }));
}

function buildTrajectories(
  participantPeriods: readonly PreparedParticipantPeriodPoint[],
  timeOrder: readonly PreparedTypedValue[],
): {
  groupOrder: PreparedTypedValue[];
  centroids: PreparedTrajectoryCentroid[];
  paths: PreparedTrajectoryPath[];
} {
  const groupOrder: PreparedTypedValue[] = [];
  const seenGroups = new Set<string>();
  for (const point of participantPeriods) {
    if (!seenGroups.has(point.group.canonical)) {
      seenGroups.add(point.group.canonical);
      groupOrder.push(point.group);
    }
  }

  const centroids: PreparedTrajectoryCentroid[] = [];
  const centroidIndex = new Map<string, number>();
  const membersByGroupTime = new Map<string, PreparedParticipantPeriodPoint[]>();
  for (const point of participantPeriods) {
    if (!point.includedInCohort) continue;
    const key = JSON.stringify([point.group.canonical, point.time.canonical]);
    const members = membersByGroupTime.get(key) ?? [];
    members.push(point);
    membersByGroupTime.set(key, members);
  }
  for (const group of groupOrder) {
    for (const time of timeOrder) {
      const key = JSON.stringify([group.canonical, time.canonical]);
      const members = membersByGroupTime.get(key) ?? [];
      if (members.length === 0) continue;
      const coordinates: Coordinates3D = [
        stableMean(
          members.map((point) => point.coordinates[0]),
          `trajectory.${group.display}.${time.display}.SVD1`,
        ),
        stableMean(
          members.map((point) => point.coordinates[1]),
          `trajectory.${group.display}.${time.display}.SVD2`,
        ),
        stableMean(
          members.map((point) => point.coordinates[2]),
          `trajectory.${group.display}.${time.display}.SVD3`,
        ),
      ];
      const index = centroids.length;
      centroids.push({
        index,
        group,
        time,
        coordinates,
        participantCount: members.length,
        participantPeriodIndexes: members.map((point) => point.index),
      });
      centroidIndex.set(key, index);
    }
  }

  const paths = groupOrder.map((group) => ({
    group,
    steps: timeOrder.map((time) => ({
      time,
      centroidIndex:
        centroidIndex.get(JSON.stringify([group.canonical, time.canonical])) ?? null,
    })),
  }));
  return { groupOrder, centroids, paths };
}

/**
 * Reduces a validated, precomputed ENA exchange without invoking jENA or
 * fitting a new rotation. Full source coordinates and line weights are
 * preserved; only participant-period and group-time summaries are computed.
 */
export function analyzePreparedSpace(input: AnalyzePreparedSpaceInput): PreparedSpaceResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    reject("INVALID_PREPARED_INPUT", "input", "must be an object");
  }
  if (!input.source || typeof input.source !== "object") {
    reject("INVALID_PREPARED_SOURCE", "source", "must contain a validated hashed artifact");
  }
  validateSourceName(input.source.name);
  const artifact = input.source.artifact;
  if (
    !isHashedEna3dExchangeV1(artifact) ||
    !/^[a-f0-9]{64}$/u.test(artifact.sha256) ||
    !Number.isSafeInteger(artifact.byteLength) ||
    artifact.byteLength < 1 ||
    !artifact.exchange ||
    typeof artifact.exchange !== "object"
  ) {
    reject(
      "INVALID_PREPARED_RECEIPT",
      "source.artifact",
      "must be a validated exchange with lowercase SHA-256 and positive byte length",
    );
  }
  const exchange = artifact.exchange;
  const resolved = validateMapping(exchange, input.mapping);
  const metadataRows = exchange.tables.meta_data.columns[0]?.values.length ?? 0;
  if (metadataRows < 1) {
    reject("EMPTY_PREPARED_SPACE", "tables.meta_data", "must contain at least one point row");
  }

  const metadataSourceId = requiredColumn(
    resolved.metadataColumns,
    "ENA_UNIT",
    "tables.meta_data.ENA_UNIT",
  );
  const pointColumns = columnMap(exchange.tables.points);
  const lineWeightColumns = columnMap(exchange.tables.line_weights);
  const nodeColumns = columnMap(exchange.tables.nodes);
  const pointDimensionColumns = exchange.dimensions.map((dimension) =>
    requiredColumn(pointColumns, dimension, `tables.points.${dimension}`),
  );
  const nodeDimensionColumns = exchange.dimensions.map((dimension) =>
    requiredColumn(nodeColumns, dimension, `tables.nodes.${dimension}`),
  );
  const sourceRowKeys = buildRowKeys(metadataSourceId, metadataRows);

  const points: PreparedSpacePoint[] = Array.from(
    { length: metadataRows },
    (_, rowIndex) => ({
      index: rowIndex,
      id: sourceRowKeys[rowIndex]!,
      participant: entityKeyFromColumns(
        resolved.participantColumns,
        rowIndex,
        `tables.meta_data[${rowIndex}]`,
      ),
      participantLabel: typedValueFromColumn(
        resolved.participantLabelColumn,
        rowIndex,
        `tables.meta_data.${resolved.participantLabelColumn.name}[${rowIndex}]`,
      ),
      group: typedValueFromColumn(
        resolved.groupColumn,
        rowIndex,
        `tables.meta_data.${resolved.groupColumn.name}[${rowIndex}]`,
      ),
      time: typedValueFromColumn(
        resolved.timeColumn,
        rowIndex,
        `tables.meta_data.${resolved.timeColumn.name}[${rowIndex}]`,
      ),
      metadata: metadataRecord(exchange.tables.meta_data.columns, rowIndex),
      coordinates: pointDimensionColumns.map((column) =>
        numericColumnValue(
          column,
          rowIndex,
          `tables.points.${column.name}[${rowIndex}]`,
        ),
      ),
    }),
  );

  const codeColumn = requiredColumn(nodeColumns, "code", "tables.nodes.code");
  const nodeCount = codeColumn.values.length;
  const nodes: PreparedSpaceNode[] = Array.from({ length: nodeCount }, (_, rowIndex) => {
    const code = rawValue(codeColumn, rowIndex, `tables.nodes.code[${rowIndex}]`);
    validateIdentityScalar(code, `tables.nodes.code[${rowIndex}]`);
    if (typeof code !== "string") {
      reject("INVALID_PREPARED_NODE_CODE", `tables.nodes.code[${rowIndex}]`, "must be a string");
    }
    return {
      index: rowIndex,
      code,
      coordinates: nodeDimensionColumns.map((column) =>
        numericColumnValue(
          column,
          rowIndex,
          `tables.nodes.${column.name}[${rowIndex}]`,
        ),
      ),
    };
  });
  const nodeIndexByCode = new Map(nodes.map((node) => [node.code, node.index]));

  const edgeColumns = exchange.tables.adjacency_key.columns;
  const lineWeightValues = edgeColumns.map((edgeColumn) => {
    const weightColumn = requiredColumn(
      lineWeightColumns,
      edgeColumn.name,
      `tables.line_weights.${edgeColumn.name}`,
    );
    return Array.from({ length: metadataRows }, (_, rowIndex) =>
      numericColumnValue(
        weightColumn,
        rowIndex,
        `tables.line_weights.${edgeColumn.name}[${rowIndex}]`,
      ),
    );
  });
  const edges: PreparedSpaceEdge[] = edgeColumns.map((edgeColumn, index) => {
    const sourceValue = rawValue(edgeColumn, 0, `tables.adjacency_key.${edgeColumn.name}[0]`);
    const targetValue = rawValue(edgeColumn, 1, `tables.adjacency_key.${edgeColumn.name}[1]`);
    if (typeof sourceValue !== "string" || typeof targetValue !== "string") {
      reject(
        "INVALID_PREPARED_EDGE",
        `tables.adjacency_key.${edgeColumn.name}`,
        "edge endpoints must be string node codes",
      );
    }
    const sourceIndex = nodeIndexByCode.get(sourceValue);
    const targetIndex = nodeIndexByCode.get(targetValue);
    if (sourceIndex === undefined || targetIndex === undefined) {
      reject(
        "INVALID_PREPARED_EDGE",
        `tables.adjacency_key.${edgeColumn.name}`,
        "edge endpoints must reference existing nodes",
      );
    }
    return {
      index,
      id: canonicalTuple(
        ["source", "target"],
        ["character", "character"],
        [sourceValue, targetValue],
      ),
      column: edgeColumn.name,
      source: sourceValue,
      target: targetValue,
      sourceIndex,
      targetIndex,
      meanWeight: stableMean(
        lineWeightValues[index]!,
        `tables.line_weights.${edgeColumn.name}`,
      ),
    };
  });

  const displayPoints = points.map((point) => ({
    pointIndex: point.index,
    id: point.id,
    group: point.group,
    time: point.time,
    coordinates: resolved.displayDimensionIndexes.map(
      (dimensionIndex) => point.coordinates[dimensionIndex],
    ) as Coordinates3D,
  }));
  const displayNodes = nodes.map((node) => ({
    nodeIndex: node.index,
    code: node.code,
    coordinates: resolved.displayDimensionIndexes.map(
      (dimensionIndex) => node.coordinates[dimensionIndex],
    ) as Coordinates3D,
  }));

  const pointsForReduction = points.map((point, index) => ({
    ...point,
    coordinates: displayPoints[index]!.coordinates,
  }));
  const participantPeriods = buildParticipantPeriods(
    pointsForReduction,
    resolved.timeOrder,
    input.mapping.cohortPolicy,
  );
  const observedGroupCount = new Set(
    participantPeriods.map((point) => point.group.canonical),
  ).size;
  if (observedGroupCount > PREPARED_GROUP_LIMIT) {
    reject(
      "PREPARED_GROUP_LIMIT_EXCEEDED",
      "mapping.group",
      `mapped groups must not exceed ${PREPARED_GROUP_LIMIT}`,
    );
  }
  if (observedGroupCount * resolved.timeOrder.length > PREPARED_TRAJECTORY_CELL_LIMIT) {
    reject(
      "PREPARED_TRAJECTORY_LIMIT_EXCEEDED",
      "mapping.timeOrder",
      `group-by-time path cells must not exceed ${PREPARED_TRAJECTORY_CELL_LIMIT}`,
    );
  }
  const trajectory = buildTrajectories(participantPeriods, resolved.timeOrder);

  const diagnostics: AnalysisDiagnostic[] = [
    {
      code: "PRECOMPUTED_SPACE_IMPORT",
      severity: "info",
      message:
        "Coordinates were imported from a validated exchange; no raw accumulation, rotation, eigenvalue, or variance computation was performed.",
    },
    {
      code: "PRECOMPUTED_COMPATIBILITY_NOT_PARITY",
      severity: "warning",
      message:
        "Prepared coordinates are generic precomputed compatibility input and have no raw-recomputation or parity approval claim.",
    },
  ];

  return {
    schemaVersion: "3dena.prepared-space-result.v1",
    sourceKind: "prepared-exchange",
    rawJenaRecompute: false,
    sourceReceipt: {
      name: input.source.name,
      sha256: artifact.sha256,
      byteLength: artifact.byteLength,
    },
    artifacts: {
      rotation: "not-present",
      eigenvalues: "not-present",
      variance: "not-present",
    },
    fullSpace: {
      dimensions: [...exchange.dimensions],
      points,
      nodes,
      edges,
      lineWeights: {
        rowKeys: sourceRowKeys,
        columns: edgeColumns.map((column) => column.name),
        values: Array.from({ length: metadataRows }, (_, rowIndex) =>
          lineWeightValues.map((column) => column[rowIndex]!),
        ),
      },
    },
    displaySpace: {
      dimensions: [...input.mapping.displayDimensions],
      points: displayPoints,
      nodes: displayNodes,
      trajectory: {
        space: "prepared-exchange-display-space",
        dimensions: [...input.mapping.displayDimensions],
        cohortPolicy: input.mapping.cohortPolicy,
        groupOrder: trajectory.groupOrder,
        timeOrder: resolved.timeOrder,
        participantPeriods,
        centroids: trajectory.centroids,
        paths: trajectory.paths,
      },
    },
    summary: {
      dimensions: exchange.dimensions.length,
      points: points.length,
      nodes: nodes.length,
      edges: edges.length,
      lineWeightRows: metadataRows,
      groups: trajectory.groupOrder.length,
      timePoints: resolved.timeOrder.length,
      participantPeriods: participantPeriods.length,
      trajectoryCentroids: trajectory.centroids.length,
    },
    diagnostics,
    provenance: {
      adapter: "@3dena/analysis",
      adapterVersion: "0.1.0",
      coordinateSpace: "precomputed-import",
      computation: "reduction-only",
      jenaExecuted: false,
      resolvedMapping: {
        participant: [...input.mapping.participant],
        participantLabel: input.mapping.participantLabel,
        group: input.mapping.group,
        time: input.mapping.time,
        timeOrder: [...input.mapping.timeOrder],
        cohortPolicy: input.mapping.cohortPolicy,
        displayDimensions: [...input.mapping.displayDimensions],
        missingDisplayCoordinates: "reject",
      },
    },
  };
}

function selectedDisplayDimensions(
  result: PreparedSpaceResult,
  filter: PreparedSpaceDisplayFilter,
): { names: [string, string, string]; indexes: [number, number, number]; reselect: boolean } {
  if (filter.dimensions === undefined) {
    const names = [...result.displaySpace.dimensions] as [string, string, string];
    return {
      names,
      indexes: names.map((dimension) => result.fullSpace.dimensions.indexOf(dimension)) as [
        number,
        number,
        number,
      ],
      reselect: false,
    };
  }
  const candidate: unknown = filter.dimensions;
  if (!Array.isArray(candidate) || candidate.length !== 3) {
    reject(
      "INVALID_PREPARED_DISPLAY_DIMENSIONS",
      "filter.dimensions",
      "must select exactly three dimensions",
    );
  }
  if (candidate.some((dimension) => typeof dimension !== "string" || dimension.trim() === "")) {
    reject(
      "INVALID_PREPARED_DISPLAY_DIMENSIONS",
      "filter.dimensions",
      "must contain three non-blank dimension names",
    );
  }
  const names = [candidate[0], candidate[1], candidate[2]] as [string, string, string];
  if (new Set(names).size !== 3) {
    reject(
      "DUPLICATE_PREPARED_DISPLAY_DIMENSION",
      "filter.dimensions",
      "must contain three distinct dimensions",
    );
  }
  const indexes = names.map((dimension, index) => {
    const dimensionIndex = result.fullSpace.dimensions.indexOf(dimension);
    if (dimensionIndex < 0) {
      reject(
        "UNKNOWN_PREPARED_DISPLAY_DIMENSION",
        `filter.dimensions[${index}]`,
        `dimension ${JSON.stringify(dimension)} is not present in fullSpace.dimensions`,
      );
    }
    return dimensionIndex;
  }) as [number, number, number];
  return { names, indexes, reselect: true };
}

function projectPreparedCoordinates(
  coordinates: readonly number[],
  indexes: readonly [number, number, number],
  path: string,
): Coordinates3D {
  const selected = indexes.map((index) => coordinates[index]) as Coordinates3D;
  if (selected.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate))) {
    reject(
      "INVALID_PREPARED_DISPLAY_COORDINATE",
      path,
      "selected full-space coordinates must be present finite numbers",
    );
  }
  return selected;
}

function deepFreezePreparedSelection<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreezePreparedSelection(nested);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * Display-only group/dimension selection in the already imported coordinate
 * space. Dimension reselection redoes reductions but never fits or rotates.
 */
export function selectPreparedSpaceDisplay(
  result: PreparedSpaceResult,
  filter: PreparedSpaceDisplayFilter = {},
): PreparedSpaceDisplaySelection {
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
    reject("INVALID_PREPARED_DISPLAY_FILTER", "filter", "must be an object");
  }
  const groupCandidate: unknown = filter.groups;
  if (
    groupCandidate !== undefined &&
    (!Array.isArray(groupCandidate) ||
      groupCandidate.some((group) => typeof group !== "string" || group.trim() === ""))
  ) {
    reject(
      "INVALID_PREPARED_DISPLAY_GROUP",
      "filter.groups",
      "must contain non-blank canonical group keys",
    );
  }
  const allowed = filter.groups ? new Set(filter.groups) : null;
  if (filter.groups && allowed!.size !== filter.groups.length) {
    reject("DUPLICATE_PREPARED_DISPLAY_GROUP", "filter.groups", "contains duplicate group keys");
  }
  if (allowed) {
    const known = new Set(
      result.displaySpace.trajectory.groupOrder.map((group) => group.canonical),
    );
    const unknown = [...allowed].filter((group) => !known.has(group));
    if (unknown.length > 0) {
      reject(
        "UNKNOWN_PREPARED_DISPLAY_GROUP",
        "filter.groups",
        `contains unknown group keys: ${unknown.join(", ")}`,
      );
    }
  }
  const dimensions = selectedDisplayDimensions(result, filter);
  const displayPoints = dimensions.reselect
    ? result.fullSpace.points.map((point) => ({
        pointIndex: point.index,
        id: point.id,
        group: point.group,
        time: point.time,
        coordinates: projectPreparedCoordinates(
          point.coordinates,
          dimensions.indexes,
          `fullSpace.points[${point.index}].coordinates`,
        ),
      }))
    : [...result.displaySpace.points];
  const displayNodes = dimensions.reselect
    ? result.fullSpace.nodes.map((node) => ({
        nodeIndex: node.index,
        code: node.code,
        coordinates: projectPreparedCoordinates(
          node.coordinates,
          dimensions.indexes,
          `fullSpace.nodes[${node.index}].coordinates`,
        ),
      }))
    : [...result.displaySpace.nodes];
  const reduced = dimensions.reselect
    ? (() => {
        const pointsForReduction = result.fullSpace.points.map((point, index) => ({
          ...point,
          coordinates: displayPoints[index]!.coordinates,
        }));
        const participantPeriods = buildParticipantPeriods(
          pointsForReduction,
          result.displaySpace.trajectory.timeOrder,
          result.displaySpace.trajectory.cohortPolicy,
        );
        const trajectory = buildTrajectories(
          participantPeriods,
          result.displaySpace.trajectory.timeOrder,
        );
        return {
          participantPeriods,
          groupOrder: trajectory.groupOrder,
          centroids: trajectory.centroids,
          paths: trajectory.paths,
        };
      })()
    : {
        participantPeriods: [...result.displaySpace.trajectory.participantPeriods],
        groupOrder: [...result.displaySpace.trajectory.groupOrder],
        centroids: [...result.displaySpace.trajectory.centroids],
        paths: [...result.displaySpace.trajectory.paths],
      };
  const groupOrder = allowed
    ? reduced.groupOrder.filter((group) =>
        allowed.has(group.canonical),
      )
    : [...reduced.groupOrder];
  const selected = new Set(groupOrder.map((group) => group.canonical));
  return deepFreezePreparedSelection(structuredClone({
    space: "prepared-exchange-display-space",
    dimensions: dimensions.names,
    points: allowed
      ? displayPoints.filter((point) => selected.has(point.group.canonical))
      : displayPoints,
    nodes: displayNodes,
    cohortPolicy: result.displaySpace.trajectory.cohortPolicy,
    groupOrder,
    timeOrder: [...result.displaySpace.trajectory.timeOrder],
    participantPeriods: allowed
      ? reduced.participantPeriods.filter((point) =>
          selected.has(point.group.canonical),
        )
      : reduced.participantPeriods,
    centroids: allowed
      ? reduced.centroids.filter((centroid) =>
          selected.has(centroid.group.canonical),
        )
      : reduced.centroids,
    paths: allowed
      ? reduced.paths.filter((path) =>
          selected.has(path.group.canonical),
        )
      : reduced.paths,
  }));
}
