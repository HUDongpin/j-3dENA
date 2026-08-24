export const DEGENERATE_SUBSPACE_COMPARISON_VERSION_V1 =
  "3dena.degenerate-subspace-comparison.v1" as const;

export interface SubspaceBasisV1 {
  /** Scientific row identity and order, for example the edge inventory. */
  rowKeys: string[];
  /** Complete axis inventory for one near-degenerate singular-value block. */
  columns: string[];
  /** Row-major matrix. Columns span the subspace under comparison. */
  values: number[][];
}

export interface SubspaceToleranceV1 {
  /** Maximum absolute difference between entries of the two projection matrices. */
  projectionMaxAbsolute: number;
  /** Frobenius norm of the projection-matrix difference. */
  projectionFrobenius: number;
  /** Modified Gram-Schmidt rank threshold relative to the largest input column norm. */
  rankRelative: number;
}

export interface CompareDegenerateSubspacesInputV1 {
  schemaVersion: "3dena.degenerate-subspace-input.v1";
  blockId: string;
  actual: SubspaceBasisV1;
  expected: SubspaceBasisV1;
  tolerance: SubspaceToleranceV1;
}

export interface DegenerateSubspaceComparisonV1 {
  schemaVersion: typeof DEGENERATE_SUBSPACE_COMPARISON_VERSION_V1;
  blockId: string;
  status: "candidate-pass" | "candidate-fail";
  /** This numerical diagnostic can never approve its own scientific contract. */
  approvedForParity: false;
  rowCount: number;
  dimension: number;
  axes: readonly string[];
  projectionMaxAbsoluteError: number;
  projectionFrobeniusError: number;
  tolerance: Readonly<SubspaceToleranceV1>;
  diagnostics: ReadonlyArray<Readonly<{
    code: "SUBSPACE_MATCH" | "SUBSPACE_MISMATCH";
    severity: "info" | "warning";
    message: string;
  }>>;
}

export class DegenerateSubspaceComparisonError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "DegenerateSubspaceComparisonError";
    this.code = code;
    this.path = path;
  }
}

function reject(code: string, path: string, message: string): never {
  throw new DegenerateSubspaceComparisonError(code, path, message);
}

function assertExactKeys(value: unknown, path: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0) {
    reject("INVALID_KEY_INVENTORY", path, "must be a non-empty string array");
  }
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      reject("INVALID_KEY", `${path}[${index}]`, "must be a non-empty string");
    }
    if (seen.has(entry)) reject("DUPLICATE_KEY", `${path}[${index}]`, "duplicates an earlier key");
    seen.add(entry);
  });
}

function assertBasis(value: unknown, path: string): asserts value is SubspaceBasisV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    reject("INVALID_BASIS", path, "must be an object");
  }
  const basis = value as Record<string, unknown>;
  const allowed = new Set(["rowKeys", "columns", "values"]);
  for (const key of Object.keys(basis)) {
    if (!allowed.has(key)) reject("UNKNOWN_FIELD", `${path}.${key}`, "is not allowed by the v1 basis contract");
  }
  const rowKeys = basis.rowKeys;
  const columns = basis.columns;
  assertExactKeys(rowKeys, `${path}.rowKeys`);
  assertExactKeys(columns, `${path}.columns`);
  if (!Array.isArray(basis.values) || basis.values.length !== rowKeys.length) {
    reject("INVALID_MATRIX_SHAPE", `${path}.values`, `must contain ${rowKeys.length} rows`);
  }
  basis.values.forEach((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== columns.length) {
      reject("INVALID_MATRIX_SHAPE", `${path}.values[${rowIndex}]`, `must contain ${columns.length} columns`);
    }
    row.forEach((cell, columnIndex) => {
      if (typeof cell !== "number" || !Number.isFinite(cell)) {
        reject("NON_FINITE_BASIS", `${path}.values[${rowIndex}][${columnIndex}]`, "must be finite");
      }
    });
  });
}

function assertTolerance(value: unknown): asserts value is SubspaceToleranceV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    reject("INVALID_TOLERANCE", "input.tolerance", "must be an object");
  }
  const tolerance = value as Record<string, unknown>;
  const allowed = new Set(["projectionMaxAbsolute", "projectionFrobenius", "rankRelative"]);
  for (const key of Object.keys(tolerance)) {
    if (!allowed.has(key)) reject("UNKNOWN_FIELD", `input.tolerance.${key}`, "is not allowed by the v1 tolerance contract");
  }
  for (const key of allowed) {
    const candidate = tolerance[key];
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0) {
      reject("INVALID_TOLERANCE", `input.tolerance.${key}`, "must be a finite non-negative number");
    }
  }
  if (tolerance.rankRelative === 0) {
    reject("INVALID_TOLERANCE", "input.tolerance.rankRelative", "must be greater than zero");
  }
}

function column(matrix: number[][], index: number): number[] {
  return matrix.map((row) => row[index]!);
}

function dot(left: number[], right: number[]): number {
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result += left[index]! * right[index]!;
  return result;
}

function norm(vector: number[]): number {
  return Math.sqrt(dot(vector, vector));
}

/**
 * Deterministic modified Gram-Schmidt with a second orthogonalization pass.
 * Scaling, signs, permutations, and rotations inside the block are immaterial;
 * rank deficiency is rejected rather than silently reducing the estimand.
 */
function orthonormalBasis(
  matrix: number[][],
  dimension: number,
  rankRelative: number,
  path: string,
): number[][] {
  const source = Array.from({ length: dimension }, (_, index) => column(matrix, index));
  const largestNorm = Math.max(...source.map(norm));
  if (!(largestNorm > 0)) reject("RANK_DEFICIENT_SUBSPACE", path, "contains no non-zero basis column");
  const threshold = largestNorm * rankRelative;
  const output: number[][] = [];
  source.forEach((candidate, columnIndex) => {
    const residual = [...candidate];
    for (let pass = 0; pass < 2; pass += 1) {
      for (const existing of output) {
        const projection = dot(residual, existing);
        for (let row = 0; row < residual.length; row += 1) {
          residual[row] = residual[row]! - projection * existing[row]!;
        }
      }
    }
    const residualNorm = norm(residual);
    if (!(residualNorm > threshold)) {
      reject(
        "RANK_DEFICIENT_SUBSPACE",
        `${path}.columns[${columnIndex}]`,
        `is linearly dependent at relative rank threshold ${rankRelative}`,
      );
    }
    output.push(residual.map((entry) => entry / residualNorm));
  });
  return output;
}

function projection(basisColumns: number[][], rowCount: number): number[][] {
  return Array.from({ length: rowCount }, (_, row) =>
    Array.from({ length: rowCount }, (_, columnIndex) => {
      let value = 0;
      for (const basis of basisColumns) value += basis[row]! * basis[columnIndex]!;
      return value;
    }),
  );
}

/**
 * Compares two near-degenerate SVD blocks by their orthogonal projectors.
 * The result is deliberately candidate-only; approval remains a separate
 * custody and independent-review action in the parity contract.
 */
export function compareDegenerateSubspacesV1(
  input: CompareDegenerateSubspacesInputV1,
): DegenerateSubspaceComparisonV1 {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    reject("INVALID_INPUT", "input", "must be an object");
  }
  const record = input as unknown as Record<string, unknown>;
  const allowed = new Set(["schemaVersion", "blockId", "actual", "expected", "tolerance"]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) reject("UNKNOWN_FIELD", `input.${key}`, "is not allowed by the v1 contract");
  }
  if (input.schemaVersion !== "3dena.degenerate-subspace-input.v1") {
    reject("UNKNOWN_VERSION", "input.schemaVersion", "must be 3dena.degenerate-subspace-input.v1");
  }
  if (typeof input.blockId !== "string" || input.blockId.trim() === "") {
    reject("INVALID_BLOCK_ID", "input.blockId", "must be a non-empty string");
  }
  assertBasis(input.actual, "input.actual");
  assertBasis(input.expected, "input.expected");
  assertTolerance(input.tolerance);
  if (JSON.stringify(input.actual.rowKeys) !== JSON.stringify(input.expected.rowKeys)) {
    reject("ROW_IDENTITY_MISMATCH", "input.actual.rowKeys", "must exactly match expected row identity and order");
  }
  if (input.actual.columns.length !== input.expected.columns.length) {
    reject("DIMENSION_MISMATCH", "input.actual.columns", "must contain the same number of axes as expected");
  }
  if (JSON.stringify([...input.actual.columns].sort()) !== JSON.stringify([...input.expected.columns].sort())) {
    reject("AXIS_INVENTORY_MISMATCH", "input.actual.columns", "must contain the same unique axis inventory as expected");
  }
  if (input.actual.columns.length > input.actual.rowKeys.length) {
    reject("IMPOSSIBLE_SUBSPACE", "input.actual.columns", "dimension cannot exceed row count");
  }

  const actualBasis = orthonormalBasis(
    input.actual.values,
    input.actual.columns.length,
    input.tolerance.rankRelative,
    "input.actual",
  );
  const expectedBasis = orthonormalBasis(
    input.expected.values,
    input.expected.columns.length,
    input.tolerance.rankRelative,
    "input.expected",
  );
  const actualProjection = projection(actualBasis, input.actual.rowKeys.length);
  const expectedProjection = projection(expectedBasis, input.expected.rowKeys.length);
  let projectionMaxAbsoluteError = 0;
  let squaredError = 0;
  for (let row = 0; row < actualProjection.length; row += 1) {
    for (let columnIndex = 0; columnIndex < actualProjection.length; columnIndex += 1) {
      const difference = actualProjection[row]![columnIndex]! - expectedProjection[row]![columnIndex]!;
      projectionMaxAbsoluteError = Math.max(projectionMaxAbsoluteError, Math.abs(difference));
      squaredError += difference * difference;
    }
  }
  const projectionFrobeniusError = Math.sqrt(squaredError);
  const passed = projectionMaxAbsoluteError <= input.tolerance.projectionMaxAbsolute
    && projectionFrobeniusError <= input.tolerance.projectionFrobenius;
  return Object.freeze({
    schemaVersion: DEGENERATE_SUBSPACE_COMPARISON_VERSION_V1,
    blockId: input.blockId,
    status: passed ? "candidate-pass" : "candidate-fail",
    approvedForParity: false,
    rowCount: input.actual.rowKeys.length,
    dimension: input.actual.columns.length,
    axes: Object.freeze([...input.expected.columns]),
    projectionMaxAbsoluteError,
    projectionFrobeniusError,
    tolerance: Object.freeze({ ...input.tolerance }),
    diagnostics: Object.freeze([Object.freeze(passed ? {
      code: "SUBSPACE_MATCH" as const,
      severity: "info" as const,
      message: "Projection matrices agree within the versioned candidate tolerance; independent approval is still required.",
    } : {
      code: "SUBSPACE_MISMATCH" as const,
      severity: "warning" as const,
      message: "Projection matrices do not agree within the versioned candidate tolerance.",
    })]),
  });
}
