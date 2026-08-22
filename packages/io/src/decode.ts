import { exchangeError } from "./errors";
import { preflightJsonText } from "./json-preflight";
import {
  resolveEna3dExchangeLimits,
  type Ena3dExchangeLimits,
} from "./limits";
import {
  VALIDATED_ENA3D_EXCHANGE_V1,
  type Ena3dCharacterColumn,
  type Ena3dExchangeBytes,
  type Ena3dExchangeColumn,
  type Ena3dExchangeColumnType,
  type Ena3dExchangeTable,
  type Ena3dExchangeTablesV1,
  type Ena3dExchangeV1,
  type HashedEna3dExchangeV1,
  type ValidatedEna3dExchangeV1,
} from "./types";

const TOP_LEVEL_FIELDS = [
  "format",
  "version",
  "dimensions",
  "group_variables",
  "tables",
] as const;
const TABLE_FIELDS = [
  "meta_data",
  "points",
  "line_weights",
  "nodes",
  "adjacency_key",
] as const;
const COLUMN_TYPES = new Set<Ena3dExchangeColumnType>([
  "logical",
  "integer",
  "double",
  "character",
  "date",
  "datetime",
  "difftime",
  "factor",
  "ordered",
]);
const BASIC_COLUMN_TYPES = new Set<Ena3dExchangeColumnType>([
  "logical",
  "integer",
  "double",
  "character",
  "date",
]);
const NUMERIC_COLUMN_TYPES = new Set<Ena3dExchangeColumnType>([
  "integer",
  "double",
]);
const DIFFTIME_UNITS = new Set(["secs", "mins", "hours", "days", "weeks"]);
const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
const IDENTIFIER_CONTROL = /[\u0000-\u001f\u007f]/;
const UTF8_ENCODER = new TextEncoder();

type JsonObject = Record<string, unknown>;
type TableName = (typeof TABLE_FIELDS)[number];

interface ValidatedTable {
  readonly table: Ena3dExchangeTable;
  readonly rowCount: number;
}

interface CellBudget {
  used: number;
}

// Receipt provenance is process-local by design. A structured clone, object
// spread, or hand-authored lookalike is not a receipt issued by this decoder.
// Prepared analysis therefore decodes and consumes exact bytes in one Worker.
const HASHED_RECEIPTS = new WeakSet<object>();

/**
 * Decode an exact ENA3D exchange v1 byte snapshot into a deeply frozen,
 * branded DTO. No hashing or Node API is needed on this synchronous path.
 */
export function decodeEna3dExchangeV1(
  bytes: Ena3dExchangeBytes,
  limits?: Partial<Ena3dExchangeLimits>,
): ValidatedEna3dExchangeV1 {
  const resolvedLimits = resolveEna3dExchangeLimits(limits);
  const snapshot = snapshotAndCheckBytes(bytes, resolvedLimits.maxFileBytes);
  return decodeSnapshot(snapshot, resolvedLimits);
}

/**
 * Decode and bind a SHA-256 receipt to the exact immutable byte snapshot used
 * for validation. Uses browser WebCrypto and remains safe in a Web Worker.
 */
export async function decodeEna3dExchangeV1WithSha256(
  bytes: Ena3dExchangeBytes,
  limits?: Partial<Ena3dExchangeLimits>,
): Promise<HashedEna3dExchangeV1> {
  const resolvedLimits = resolveEna3dExchangeLimits(limits);
  const snapshot = snapshotAndCheckBytes(bytes, resolvedLimits.maxFileBytes);
  const exchange = decodeSnapshot(snapshot, resolvedLimits);
  const sha256 = await sha256Snapshot(snapshot);
  const receipt = Object.freeze({
    exchange,
    byteLength: snapshot.byteLength,
    sha256,
  });
  HASHED_RECEIPTS.add(receipt);
  return receipt;
}

/** True only for a hashed receipt issued by this module instance. */
export function isHashedEna3dExchangeV1(
  value: unknown,
): value is HashedEna3dExchangeV1 {
  return typeof value === "object" && value !== null && HASHED_RECEIPTS.has(value);
}

/** SHA-256 of exact raw bytes, constrained by the same file-size policy. */
export async function sha256Ena3dExchangeBytes(
  bytes: Ena3dExchangeBytes,
  limits?: Partial<Ena3dExchangeLimits>,
): Promise<string> {
  const resolvedLimits = resolveEna3dExchangeLimits(limits);
  const snapshot = snapshotAndCheckBytes(bytes, resolvedLimits.maxFileBytes);
  return sha256Snapshot(snapshot);
}

function snapshotAndCheckBytes(
  bytes: Ena3dExchangeBytes,
  maximumBytes: number,
): Uint8Array<ArrayBuffer> {
  let source: Uint8Array;
  try {
    if (bytes instanceof ArrayBuffer) {
      source = new Uint8Array(bytes);
    } else if (ArrayBuffer.isView(bytes)) {
      source = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    } else {
      exchangeError(
        "INVALID_BYTES",
        "Exchange input must be an ArrayBuffer or ArrayBuffer view.",
      );
    }
  } catch {
    exchangeError(
      "INVALID_BYTES",
      "Exchange input is not an accessible ArrayBuffer or ArrayBuffer view.",
    );
  }
  if (source.byteLength === 0) {
    exchangeError("EMPTY_INPUT", "The exchange byte input is empty.");
  }
  if (source.byteLength > maximumBytes) {
    exchangeError(
      "FILE_TOO_LARGE",
      "The .ena3d.json byte input exceeds the configured file-size limit.",
    );
  }
  const snapshot = new Uint8Array(source.byteLength);
  try {
    snapshot.set(source);
  } catch {
    exchangeError(
      "INVALID_BYTES",
      "Exchange input changed while its byte snapshot was being captured.",
    );
  }
  return snapshot;
}

function decodeSnapshot(
  bytes: Uint8Array<ArrayBuffer>,
  limits: Readonly<Ena3dExchangeLimits>,
): ValidatedEna3dExchangeV1 {
  if (
    bytes.byteLength >= UTF8_BOM.length &&
    UTF8_BOM.every((value, index) => bytes[index] === value)
  ) {
    exchangeError("BOM_FORBIDDEN", "UTF-8 byte-order marks are not permitted.");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    exchangeError("INVALID_UTF8", "The exchange is not valid UTF-8 text.");
  }

  preflightJsonText(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    exchangeError("INVALID_JSON", "The JSON syntax is invalid.");
  }
  const validated = validateExchange(parsed, limits);
  Object.defineProperty(validated, VALIDATED_ENA3D_EXCHANGE_V1, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return deepFreeze(validated) as ValidatedEna3dExchangeV1;
}

function validateExchange(
  value: unknown,
  limits: Readonly<Ena3dExchangeLimits>,
): Ena3dExchangeV1 {
  const root = requireObject(value, "$", TOP_LEVEL_FIELDS);
  if (root.format !== "ena3d-exchange") {
    exchangeError(
      "SCHEMA_MISMATCH",
      "format must be exactly 'ena3d-exchange'.",
      "$.format",
    );
  }
  if (root.version !== 1 || typeof root.version !== "number") {
    exchangeError("SCHEMA_MISMATCH", "version must be the number 1.", "$.version");
  }

  const dimensions = requireUniqueIdentifierArray(root.dimensions, "$.dimensions");
  if (dimensions.length < 3) {
    exchangeError(
      "SCHEMA_MISMATCH",
      "At least three dimensions are required.",
      "$.dimensions",
    );
  }
  enforceLimit(
    dimensions.length,
    limits.maxDimensions,
    "ENA dimension count",
    "$.dimensions",
  );
  const groupVariables = requireUniqueIdentifierArray(
    root.group_variables,
    "$.group_variables",
  );

  const tablesObject = requireObject(root.tables, "$.tables", TABLE_FIELDS);
  const cellBudget: CellBudget = { used: 0 };
  const maximumTableColumns =
    limits.maxMetadataColumns +
    limits.maxDimensions +
    (limits.maxNodes * (limits.maxNodes - 1)) / 2 +
    1;
  const decodedTables = {} as Record<TableName, ValidatedTable>;
  for (const tableName of TABLE_FIELDS) {
    decodedTables[tableName] = validateTable(
      tablesObject[tableName],
      tableName,
      limits,
      maximumTableColumns,
      cellBudget,
    );
  }

  validateTableRelationships(decodedTables, dimensions, groupVariables, limits);

  return root as unknown as Ena3dExchangeV1;
}

function validateTable(
  value: unknown,
  tableName: TableName,
  limits: Readonly<Ena3dExchangeLimits>,
  maximumColumns: number,
  cellBudget: CellBudget,
): ValidatedTable {
  const path = `$.tables.${tableName}`;
  const tableObject = requireObject(value, path, ["columns"]);
  if (!Array.isArray(tableObject.columns) || tableObject.columns.length === 0) {
    exchangeError(
      "SCHEMA_MISMATCH",
      "A table must contain a non-empty columns array.",
      `${path}.columns`,
    );
  }
  if (tableObject.columns.length > maximumColumns) {
    exchangeError(
      "RESOURCE_LIMIT_EXCEEDED",
      "Table column count exceeds the configured structural ceiling.",
      `${path}.columns`,
    );
  }

  const columns: Ena3dExchangeColumn[] = [];
  const names = new Set<string>();
  let rowCount: number | undefined;
  const rowLimit =
    tableName === "nodes"
      ? limits.maxNodes
      : tableName === "adjacency_key"
        ? 2
        : limits.maxPointRows;
  for (let index = 0; index < tableObject.columns.length; index += 1) {
    const column = validateColumn(
      tableObject.columns[index],
      `${path}.columns[${index}]`,
      rowLimit,
      rowCount,
      limits,
      cellBudget,
    );
    rowCount ??= column.values.length;
    if (names.has(column.name)) {
      exchangeError(
        "SCHEMA_MISMATCH",
        "A table contains duplicate column names.",
        `${path}.columns`,
      );
    }
    names.add(column.name);
    columns.push(column);
  }
  return {
    table: tableObject as unknown as Ena3dExchangeTable,
    rowCount: rowCount ?? 0,
  };
}

function validateColumn(
  value: unknown,
  path: string,
  rowLimit: number,
  expectedRows: number | undefined,
  limits: Readonly<Ena3dExchangeLimits>,
  cellBudget: CellBudget,
): Ena3dExchangeColumn {
  const column = requireObject(value, path);
  if (!("name" in column) || !("type" in column) || !("values" in column)) {
    exchangeError(
      "SCHEMA_MISMATCH",
      "A column must contain name, type, and values.",
      path,
    );
  }
  requireIdentifier(column.name, `${path}.name`);
  if (typeof column.type !== "string" || !COLUMN_TYPES.has(column.type as Ena3dExchangeColumnType)) {
    exchangeError(
      "COLUMN_TYPE_MISMATCH",
      "Column type is not supported by exchange v1.",
      `${path}.type`,
    );
  }
  const type = column.type as Ena3dExchangeColumnType;
  const fields = BASIC_COLUMN_TYPES.has(type)
    ? ["name", "type", "values"]
    : type === "datetime"
      ? ["name", "type", "timezone", "values"]
      : type === "difftime"
        ? ["name", "type", "units", "values"]
        : ["name", "type", "levels", "values"];
  assertExactFields(column, fields, path);

  if (!Array.isArray(column.values) || column.values.length === 0) {
    exchangeError(
      "COLUMN_TYPE_MISMATCH",
      "Column values must be a non-empty array.",
      `${path}.values`,
    );
  }
  if (column.values.length > rowLimit) {
    exchangeError(
      "RESOURCE_LIMIT_EXCEEDED",
      "Table row count exceeds its configured ceiling.",
      `${path}.values`,
    );
  }
  if (expectedRows !== undefined && column.values.length !== expectedRows) {
    exchangeError(
      "TABLE_ALIGNMENT_MISMATCH",
      "Columns in one table must have an identical non-zero row count.",
      `${path}.values`,
    );
  }
  cellBudget.used += column.values.length;
  enforceLimit(
    cellBudget.used,
    limits.maxTableCells,
    "total exchange table cell count",
    path,
  );

  if (type === "datetime") {
    validateTimezone(column.timezone, `${path}.timezone`);
  } else if (type === "difftime") {
    if (typeof column.units !== "string" || !DIFFTIME_UNITS.has(column.units)) {
      exchangeError(
        "COLUMN_TYPE_MISMATCH",
        "difftime units are not supported by exchange v1.",
        `${path}.units`,
      );
    }
  } else if (type === "factor" || type === "ordered") {
    validateFactorLevels(column.levels, `${path}.levels`);
  }

  const factorLevels =
    type === "factor" || type === "ordered"
      ? new Set(column.levels as string[])
      : undefined;
  for (let index = 0; index < column.values.length; index += 1) {
    validateCell(
      column.values[index],
      type,
      `${path}.values[${index}]`,
      factorLevels,
    );
  }
  return column as unknown as Ena3dExchangeColumn;
}

function validateCell(
  value: unknown,
  type: Ena3dExchangeColumnType,
  path: string,
  factorLevels?: ReadonlySet<string>,
): void {
  if (value === null) return;
  if (type === "logical") {
    if (typeof value !== "boolean") cellTypeError(path);
    return;
  }
  if (type === "integer") {
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < -2_147_483_647 ||
      value > 2_147_483_647
    ) {
      cellTypeError(path);
    }
    return;
  }
  if (type === "double" || type === "datetime" || type === "difftime") {
    if (typeof value !== "number" || !Number.isFinite(value)) cellTypeError(path);
    return;
  }
  if (typeof value !== "string" || !isWellFormedUnicode(value)) cellTypeError(path);
  if (type === "date" && !isIsoCalendarDate(value)) cellTypeError(path);
  if ((type === "factor" || type === "ordered") && !factorLevels?.has(value)) {
    cellTypeError(path);
  }
}

function validateTableRelationships(
  tables: Record<TableName, ValidatedTable>,
  dimensions: readonly string[],
  groupVariables: readonly string[],
  limits: Readonly<Ena3dExchangeLimits>,
): void {
  const metadataColumns = tables.meta_data.table.columns;
  const pointColumns = tables.points.table.columns;
  const weightColumns = tables.line_weights.table.columns;
  const nodeColumns = tables.nodes.table.columns;
  const adjacencyColumns = tables.adjacency_key.table.columns;
  const metadataNames = metadataColumns.map(({ name }) => name);

  enforceLimit(
    metadataColumns.length,
    limits.maxMetadataColumns,
    "metadata column count",
    "$.tables.meta_data.columns",
  );
  if (!metadataNames.includes("ENA_UNIT")) {
    exchangeError(
      "TABLE_ALIGNMENT_MISMATCH",
      "meta_data must contain ENA_UNIT.",
      "$.tables.meta_data.columns",
    );
  }
  if (!groupVariables.every((name) => metadataNames.includes(name))) {
    exchangeError(
      "TABLE_ALIGNMENT_MISMATCH",
      "Every group variable must name a metadata column.",
      "$.group_variables",
    );
  }
  assertColumnOrder(
    pointColumns,
    [...metadataNames, ...dimensions],
    "Points must contain metadata followed by dimensions in declared order.",
    "$.tables.points.columns",
  );
  assertColumnOrder(
    nodeColumns,
    ["code", ...dimensions],
    "Nodes must contain code followed by dimensions in declared order.",
    "$.tables.nodes.columns",
  );
  if (
    tables.meta_data.rowCount !== tables.points.rowCount ||
    tables.meta_data.rowCount !== tables.line_weights.rowCount
  ) {
    exchangeError(
      "TABLE_ALIGNMENT_MISMATCH",
      "meta_data, points, and line_weights must have identical row counts.",
      "$.tables",
    );
  }
  if (tables.adjacency_key.rowCount !== 2) {
    exchangeError(
      "ADJACENCY_MISMATCH",
      "adjacency_key must have exactly two rows.",
      "$.tables.adjacency_key",
    );
  }

  for (let index = 0; index < metadataColumns.length; index += 1) {
    const metadata = metadataColumns[index];
    const point = pointColumns[index];
    const weight = weightColumns[index];
    if (
      metadata === undefined ||
      point === undefined ||
      weight === undefined ||
      !columnsEqual(metadata, point) ||
      !columnsEqual(metadata, weight)
    ) {
      exchangeError(
        "METADATA_ALIGNMENT_MISMATCH",
        "Metadata type, attributes, and values must align across all row tables.",
        `$.tables.meta_data.columns[${index}]`,
      );
    }
  }

  const dimensionOffset = metadataColumns.length;
  for (let index = 0; index < dimensions.length; index += 1) {
    const pointDimension = pointColumns[dimensionOffset + index];
    const nodeDimension = nodeColumns[index + 1];
    if (
      pointDimension === undefined ||
      nodeDimension === undefined ||
      !NUMERIC_COLUMN_TYPES.has(pointDimension.type) ||
      !NUMERIC_COLUMN_TYPES.has(nodeDimension.type)
    ) {
      exchangeError(
        "COLUMN_TYPE_MISMATCH",
        "Point and node dimensions must be numeric columns.",
        "$.tables",
      );
    }
    requireCompleteFiniteColumn(
      nodeDimension,
      "Node dimensions must be complete finite numbers.",
      `$.tables.nodes.columns[${index + 1}]`,
    );
  }

  const codeColumn = nodeColumns[0];
  if (codeColumn?.type !== "character") {
    exchangeError(
      "COLUMN_TYPE_MISMATCH",
      "nodes.code must be a character column.",
      "$.tables.nodes.columns[0]",
    );
  }
  const nodeCodes = requireNodeCodes(codeColumn);
  validateAdjacencyAndWeights(
    nodeCodes,
    adjacencyColumns,
    weightColumns,
    metadataNames,
  );
  validateIdentityResourceCeilings(
    metadataColumns,
    groupVariables,
    limits,
  );
}

function validateAdjacencyAndWeights(
  nodeCodes: readonly string[],
  adjacencyColumns: readonly Ena3dExchangeColumn[],
  weightColumns: readonly Ena3dExchangeColumn[],
  metadataNames: readonly string[],
): void {
  const expectedEdges = (nodeCodes.length * (nodeCodes.length - 1)) / 2;
  if (adjacencyColumns.length !== expectedEdges) {
    exchangeError(
      "ADJACENCY_MISMATCH",
      "Adjacency must contain exactly one edge for every unordered node pair.",
      "$.tables.adjacency_key.columns",
    );
  }
  const nodeIndex = new Map(nodeCodes.map((code, index) => [code, index]));
  const seenPairs = new Set<string>();
  const edgeNames: string[] = [];
  for (let index = 0; index < adjacencyColumns.length; index += 1) {
    const edge = adjacencyColumns[index];
    if (edge?.type !== "character" || edge.values.length !== 2) {
      exchangeError(
        "ADJACENCY_MISMATCH",
        "Every adjacency column must contain two character endpoints.",
        `$.tables.adjacency_key.columns[${index}]`,
      );
    }
    const from = edge.values[0];
    const to = edge.values[1];
    if (
      typeof from !== "string" ||
      typeof to !== "string" ||
      from.length === 0 ||
      to.length === 0 ||
      !nodeIndex.has(from) ||
      !nodeIndex.has(to) ||
      from === to
    ) {
      exchangeError(
        "ADJACENCY_MISMATCH",
        "Adjacency endpoints must be distinct, known, non-empty node codes.",
        `$.tables.adjacency_key.columns[${index}]`,
      );
    }
    if (edge.name !== `${from} & ${to}`) {
      exchangeError(
        "ADJACENCY_MISMATCH",
        "Adjacency column names must preserve '<from> & <to>' endpoint order.",
        `$.tables.adjacency_key.columns[${index}].name`,
      );
    }
    const left = nodeIndex.get(from);
    const right = nodeIndex.get(to);
    if (left === undefined || right === undefined) {
      exchangeError("ADJACENCY_MISMATCH", "Adjacency endpoint is unknown.");
    }
    const pair = left < right ? `${left}:${right}` : `${right}:${left}`;
    if (seenPairs.has(pair)) {
      exchangeError(
        "ADJACENCY_MISMATCH",
        "Adjacency contains a duplicate unordered node pair.",
        "$.tables.adjacency_key.columns",
      );
    }
    seenPairs.add(pair);
    edgeNames.push(edge.name);
  }
  for (let left = 0; left < nodeCodes.length; left += 1) {
    for (let right = left + 1; right < nodeCodes.length; right += 1) {
      if (!seenPairs.has(`${left}:${right}`)) {
        exchangeError(
          "ADJACENCY_MISMATCH",
          "Adjacency does not contain every unordered node pair.",
          "$.tables.adjacency_key.columns",
        );
      }
    }
  }

  assertColumnOrder(
    weightColumns,
    [...metadataNames, ...edgeNames],
    "Line weights must contain metadata followed by adjacency edges in exact order.",
    "$.tables.line_weights.columns",
  );
  for (let index = metadataNames.length; index < weightColumns.length; index += 1) {
    const edge = weightColumns[index];
    if (edge === undefined || !NUMERIC_COLUMN_TYPES.has(edge.type)) {
      exchangeError(
        "COLUMN_TYPE_MISMATCH",
        "Line-weight edge columns must be numeric.",
        `$.tables.line_weights.columns[${index}]`,
      );
    }
    requireCompleteFiniteColumn(
      edge,
      "Line-weight edges must be complete finite numbers.",
      `$.tables.line_weights.columns[${index}]`,
    );
  }
}

function validateIdentityResourceCeilings(
  metadataColumns: readonly Ena3dExchangeColumn[],
  groupVariables: readonly string[],
  limits: Readonly<Ena3dExchangeLimits>,
): void {
  const byName = new Map(metadataColumns.map((column) => [column.name, column]));
  for (let index = 0; index < groupVariables.length; index += 1) {
    const column = byName.get(groupVariables[index] ?? "");
    if (column === undefined) continue;
    for (const value of column.values) {
      if (value === null || (typeof value === "string" && value.trim() === "")) {
        exchangeError(
          "TABLE_ALIGNMENT_MISMATCH",
          "Grouping columns must not contain missing or blank values.",
          `$.group_variables[${index}]`,
        );
      }
    }
    enforceLimit(
      countUniqueScalars(column.values),
      limits.maxGroupLevels,
      "grouping-column level count",
      `$.group_variables[${index}]`,
    );
  }
  const unitColumn = byName.get("ENA_UNIT");
  if (unitColumn !== undefined) {
    enforceLimit(
      countUniqueScalars(unitColumn.values),
      limits.maxUnits,
      "unique ENA unit count",
      "$.tables.meta_data",
    );
  }
}

function requireNodeCodes(column: Ena3dCharacterColumn): readonly string[] {
  const codes: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < column.values.length; index += 1) {
    const value = column.values[index];
    if (typeof value !== "string" || value.length === 0 || seen.has(value)) {
      exchangeError(
        "ADJACENCY_MISMATCH",
        "Node codes must be non-missing, non-empty, and unique.",
        `$.tables.nodes.columns[0].values[${index}]`,
      );
    }
    seen.add(value);
    codes.push(value);
  }
  return codes;
}

function requireCompleteFiniteColumn(
  column: Ena3dExchangeColumn,
  message: string,
  path: string,
): void {
  if (
    column.values.some(
      (value) => value === null || typeof value !== "number" || !Number.isFinite(value),
    )
  ) {
    exchangeError("COLUMN_TYPE_MISMATCH", message, path);
  }
}

function columnsEqual(
  left: Ena3dExchangeColumn,
  right: Ena3dExchangeColumn,
): boolean {
  if (left.name !== right.name || left.type !== right.type) return false;
  if (left.type === "datetime" && right.type === "datetime") {
    if (left.timezone !== right.timezone) return false;
  } else if (left.type === "difftime" && right.type === "difftime") {
    if (left.units !== right.units) return false;
  } else if (
    (left.type === "factor" || left.type === "ordered") &&
    (right.type === "factor" || right.type === "ordered")
  ) {
    if (!arraysEqual(left.levels, right.levels)) return false;
  }
  return arraysEqual(left.values, right.values);
}

function assertColumnOrder(
  columns: readonly Ena3dExchangeColumn[],
  expected: readonly string[],
  message: string,
  path: string,
): void {
  if (
    columns.length !== expected.length ||
    columns.some((column, index) => column.name !== expected[index])
  ) {
    exchangeError("TABLE_ALIGNMENT_MISMATCH", message, path);
  }
}

function requireUniqueIdentifierArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    exchangeError(
      "SCHEMA_MISMATCH",
      "Expected a non-empty array of identifiers.",
      path,
    );
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const item = requireIdentifier(value[index], `${path}[${index}]`);
    if (seen.has(item)) {
      exchangeError("SCHEMA_MISMATCH", "Identifier array contains duplicates.", path);
    }
    seen.add(item);
    result.push(item);
  }
  return result;
}

function requireIdentifier(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !isWellFormedUnicode(value) ||
    UTF8_ENCODER.encode(value).byteLength < 1 ||
    UTF8_ENCODER.encode(value).byteLength > 256 ||
    IDENTIFIER_CONTROL.test(value)
  ) {
    exchangeError(
      "SCHEMA_MISMATCH",
      "Identifier must be 1-256 UTF-8 bytes without control characters.",
      path,
    );
  }
  return value;
}

function validateFactorLevels(value: unknown, path: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    exchangeError(
      "COLUMN_TYPE_MISMATCH",
      "Factor levels must be a non-empty array.",
      path,
    );
  }
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const level = value[index];
    if (typeof level !== "string" || !isWellFormedUnicode(level) || seen.has(level)) {
      exchangeError(
        "COLUMN_TYPE_MISMATCH",
        "Factor levels must be unique well-formed strings.",
        `${path}[${index}]`,
      );
    }
    seen.add(level);
  }
}

function validateTimezone(value: unknown, path: string): void {
  if (
    typeof value !== "string" ||
    !isWellFormedUnicode(value) ||
    value.length === 0 ||
    UTF8_ENCODER.encode(value).byteLength > 128
  ) {
    exchangeError("COLUMN_TYPE_MISMATCH", "Timezone is invalid.", path);
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
  } catch {
    exchangeError(
      "COLUMN_TYPE_MISMATCH",
      "Timezone must be UTC or an installed IANA timezone.",
      path,
    );
  }
}

function requireObject(
  value: unknown,
  path: string,
  fields?: readonly string[],
): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    exchangeError("SCHEMA_MISMATCH", "Expected a JSON object.", path);
  }
  const object = value as JsonObject;
  if (fields !== undefined) assertExactFields(object, fields, path);
  return object;
}

function assertExactFields(
  object: JsonObject,
  fields: readonly string[],
  path: string,
): void {
  const keys = Object.keys(object);
  if (
    keys.length !== fields.length ||
    fields.some((field) => !Object.hasOwn(object, field)) ||
    keys.some((key) => !fields.includes(key))
  ) {
    exchangeError(
      "SCHEMA_MISMATCH",
      "JSON object fields do not exactly match exchange v1.",
      path,
    );
  }
}

function enforceLimit(
  actual: number,
  maximum: number,
  label: string,
  path: string,
): void {
  if (!Number.isSafeInteger(actual) || actual > maximum) {
    exchangeError(
      "RESOURCE_LIMIT_EXCEEDED",
      `${label} exceeds the configured ceiling.`,
      path,
    );
  }
}

function countUniqueScalars(values: readonly unknown[]): number {
  return new Set(
    values.map((value) =>
      value === null ? "null" : `${typeof value}:${String(value)}`,
    ),
  ).size;
}

function arraysEqual(
  left: readonly unknown[],
  right: readonly unknown[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function cellTypeError(path: string): never {
  exchangeError(
    "COLUMN_TYPE_MISMATCH",
    "Cell value does not match its declared exchange column type.",
    path,
  );
}

function isIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (days[month - 1] ?? 0);
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

async function sha256Snapshot(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    exchangeError(
      "CRYPTO_UNAVAILABLE",
      "WebCrypto SubtleCrypto is unavailable in this runtime.",
    );
  }
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
  return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
}
