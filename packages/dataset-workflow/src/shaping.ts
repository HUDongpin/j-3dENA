import {
  typedDoubleV1,
  type DatasetColumnRoleV1,
  type DatasetColumnTypeV1,
  type DatasetSchemaV1,
  type RawScalar,
  type TypedScalarV1,
} from "@3dena/analysis";
import { workflowError } from "./errors";
import type {
  DatasetRoleMappingV1,
  TypedDatasetPreviewV1,
  WorkflowDiagnosticV1,
  WorkflowParsedWorksheetV1,
} from "./types";

const STRICT_DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

function freezeRows(rows: readonly (readonly RawScalar[])[]): readonly (readonly RawScalar[])[] {
  return Object.freeze(rows.map((row) => Object.freeze([...row])));
}

function normalizeCodeValue(value: RawScalar): RawScalar {
  if (typeof value !== "string") return value;
  if (!STRICT_DECIMAL.test(value)) return value;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

export function materializeMappedRows(
  rows: readonly (readonly RawScalar[])[],
  mapping: DatasetRoleMappingV1,
): readonly (readonly RawScalar[])[] {
  return freezeRows(rows.map((row) => row.map((value, columnIndex) =>
    mapping.columns[columnIndex]?.roles.includes("code")
      ? normalizeCodeValue(value)
      : value)));
}

function inferColumnType(values: readonly RawScalar[]): DatasetColumnTypeV1 {
  const nonNull = values.filter((value) => value !== null);
  if (nonNull.length === 0) return "null";
  const types = new Set(nonNull.map((value) => typeof value));
  if (types.size !== 1) return "mixed";
  const [type] = types;
  if (type === "string" || type === "number" || type === "boolean") return type;
  return "mixed";
}

function typedScalar(value: RawScalar): TypedScalarV1 {
  if (value === null) return { type: "null" };
  if (typeof value === "string") return { type: "string", value };
  if (typeof value === "boolean") return { type: "boolean", value };
  return typedDoubleV1(value);
}

function diagnostic(
  code: WorkflowDiagnosticV1["code"],
  severity: WorkflowDiagnosticV1["severity"],
  path: string,
  message: string,
  affectedCount: number,
): WorkflowDiagnosticV1 {
  return Object.freeze({ code, severity, path, message, affectedCount });
}

export interface ShapedDataset {
  readonly schema: DatasetSchemaV1;
  readonly rows: readonly (readonly RawScalar[])[];
  readonly preview: TypedDatasetPreviewV1;
  readonly diagnostics: readonly WorkflowDiagnosticV1[];
}

export function shapeDataset(
  parsed: WorkflowParsedWorksheetV1,
  mapping: DatasetRoleMappingV1,
): ShapedDataset {
  if (mapping.columns.length !== parsed.headers.length) {
    workflowError("MAPPING_INVALID", "request.mapping.columns", "must contain one assignment per header");
  }
  mapping.columns.forEach((assignment, index) => {
    if (assignment.index !== index || assignment.header !== parsed.headers[index]) {
      workflowError(
        "MAPPING_INVALID",
        `request.mapping.columns[${index}]`,
        "must match the parsed header at the same index",
      );
    }
  });
  const groupColumns = mapping.columns.filter((column) => column.roles.includes("group"));
  if (groupColumns.length > 1) {
    workflowError("MAPPING_INVALID", "request.mapping.columns", "may declare at most one primary group column");
  }

  const rows = materializeMappedRows(parsed.rows, mapping);
  const diagnostics: WorkflowDiagnosticV1[] = [];
  const unitColumns = mapping.columns.filter((column) => column.roles.includes("unit"));
  const codeColumns = mapping.columns.filter((column) => column.roles.includes("code"));
  if (unitColumns.length === 0) {
    diagnostics.push(diagnostic(
      "MAPPING_REQUIRES_UNIT",
      "error",
      "mapping.roles.unit",
      "Activation requires at least one unit column.",
      0,
    ));
  }
  if (groupColumns.length === 0) {
    diagnostics.push(diagnostic(
      "MAPPING_REQUIRES_GROUP",
      "error",
      "mapping.roles.group",
      "Activation requires one primary group column.",
      0,
    ));
  } else if (!groupColumns[0]!.roles.includes("unit")) {
    diagnostics.push(diagnostic(
      "GROUP_MUST_BE_PART_OF_UNIT",
      "error",
      `mapping.columns[${groupColumns[0]!.index}].roles`,
      "The primary group column must also be part of the complete unit tuple.",
      1,
    ));
  }
  if (codeColumns.length < 3) {
    diagnostics.push(diagnostic(
      "MAPPING_REQUIRES_THREE_CODES",
      "error",
      "mapping.roles.code",
      "Activation requires at least three code columns.",
      codeColumns.length,
    ));
  }
  if (parsed.vbaDetectedAndDiscarded) {
    diagnostics.push(diagnostic(
      "VBA_DISCARDED",
      "warning",
      "workbook.vba",
      "VBA was detected and discarded by the parser boundary.",
      1,
    ));
  }
  if (parsed.skippedBlankRowCount > 0) {
    diagnostics.push(diagnostic(
      "BLANK_ROWS_SKIPPED",
      "warning",
      "worksheet.rows",
      "Fully blank data rows were skipped before activation.",
      parsed.skippedBlankRowCount,
    ));
  }

  const identityIndexes = new Set(mapping.columns
    .filter((column) => column.roles.some((role) =>
      (["unit", "conversation", "time", "group"] as DatasetColumnRoleV1[]).includes(role)))
    .map((column) => column.index));
  for (const column of mapping.columns) {
    const values = rows.map((row) => row[column.index] ?? null);
    const inferredType = inferColumnType(values);
    if (inferredType === "mixed") {
      diagnostics.push(diagnostic(
        "MIXED_COLUMN_TYPE",
        "warning",
        `schema.columns[${column.index}]`,
        "The column contains more than one non-null scalar type.",
        values.length,
      ));
    }
    if (identityIndexes.has(column.index)) {
      const missingCount = values.filter((value) => value === null).length;
      if (missingCount > 0) {
        diagnostics.push(diagnostic(
          "IDENTITY_VALUE_MISSING",
          "error",
          `schema.columns[${column.index}]`,
          "Identity-like columns must not contain missing values.",
          missingCount,
        ));
      }
      const unsafeCount = values.filter((value) =>
        typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)).length;
      if (unsafeCount > 0) {
        diagnostics.push(diagnostic(
          "UNSAFE_NUMERIC_IDENTITY",
          "error",
          `schema.columns[${column.index}]`,
          "Unsafe integer identities must arrive as source strings.",
          unsafeCount,
        ));
      }
    }
    if (column.roles.includes("code")) {
      const invalidCount = values.filter((value) => value !== null && typeof value !== "number").length;
      if (invalidCount > 0) {
        diagnostics.push(diagnostic(
          "CODE_VALUE_NOT_NUMERIC",
          "error",
          `schema.columns[${column.index}]`,
          "Code columns must contain only finite numeric values or null.",
          invalidCount,
        ));
      }
    }
  }

  const schema: DatasetSchemaV1 = Object.freeze({
    schemaVersion: "3dena.dataset-schema.v1",
    headers: Object.freeze([...parsed.headers]) as unknown as string[],
    columns: Object.freeze(mapping.columns.map((assignment) => Object.freeze({
      name: assignment.header,
      inferredType: inferColumnType(rows.map((row) => row[assignment.index] ?? null)),
      roles: Object.freeze([...assignment.roles]) as unknown as DatasetColumnRoleV1[],
    }))) as unknown as DatasetSchemaV1["columns"],
  });
  const previewRows = rows.slice(0, 6).map((row, rowIndex) => Object.freeze({
    rowIndex,
    values: Object.freeze(row.map(typedScalar)),
  }));
  const preview: TypedDatasetPreviewV1 = Object.freeze({
    schemaVersion: "3dena.typed-dataset-preview.v1",
    headers: Object.freeze([...parsed.headers]),
    rows: Object.freeze(previewRows),
    totalRowCount: rows.length,
    previewRowCount: previewRows.length,
  });
  return Object.freeze({
    schema,
    rows,
    preview,
    diagnostics: Object.freeze(diagnostics),
  });
}
