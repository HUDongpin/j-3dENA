import type {
  DatasetColumnRoleV1,
  DatasetLimitsReceiptV1,
  DatasetSchemaV1,
} from "@3dena/analysis";
import { DEFAULT_ANALYSIS_LIMITS } from "@3dena/analysis";
import type { AnalysisMapping } from "@/lib/analysis-contract";

export const RAW_BROWSER_DATASET_LIMITS: DatasetLimitsReceiptV1 = Object.freeze({
  schemaVersion: "3dena.dataset-limits.v1",
  maxFileBytes: 5 * 1024 * 1024,
  maxWorksheets: 1,
  maxRows: DEFAULT_ANALYSIS_LIMITS.maxRows,
  maxColumns: DEFAULT_ANALYSIS_LIMITS.maxColumns,
  maxCells: DEFAULT_ANALYSIS_LIMITS.maxCells,
});

function rolesForColumn(
  column: string,
  mapping: AnalysisMapping,
): DatasetColumnRoleV1[] {
  const roles: DatasetColumnRoleV1[] = [];
  if (mapping.unitColumns.includes(column)) roles.push("unit");
  if (mapping.conversationColumns.includes(column)) roles.push("conversation");
  if (mapping.timeColumn === column) roles.push("time");
  if (mapping.codeColumns.includes(column)) roles.push("code");
  if (mapping.groupColumn === column) roles.push("group");
  return roles.length > 0 ? roles : ["unmapped"];
}

export function rawDatasetSchema(
  headers: readonly string[],
  mapping: AnalysisMapping,
): DatasetSchemaV1 {
  return {
    schemaVersion: "3dena.dataset-schema.v1",
    headers: [...headers],
    columns: headers.map((name) => ({
      name,
      inferredType: mapping.codeColumns.includes(name) ? "number" : "string",
      roles: rolesForColumn(name, mapping),
    })),
  };
}

export function fallbackRawDatasetSchema(columnCount: number): DatasetSchemaV1 {
  const headers = Array.from(
    { length: Math.max(1, columnCount) },
    (_, index) => `column-${index + 1}`,
  );
  return {
    schemaVersion: "3dena.dataset-schema.v1",
    headers,
    columns: headers.map((name) => ({
      name,
      inferredType: "mixed",
      roles: ["unmapped"],
    })),
  };
}
