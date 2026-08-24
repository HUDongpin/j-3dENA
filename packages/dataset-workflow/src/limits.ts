import {
  DEFAULT_TABULAR_IMPORT_LIMITS,
  HARD_TABULAR_IMPORT_LIMITS,
  resolveTabularImportLimits,
  type TabularImportLimits,
} from "@3dena/tabular-import";
import { workflowError } from "./errors";
import type { DatasetWorkflowLimitsV1 } from "./types";

const LIMIT_FIELDS = [
  "maxFileBytes",
  "maxWorksheets",
  "maxRows",
  "maxColumns",
  "maxCells",
  "maxStringLength",
  "maxZipEntries",
  "maxZipTotalUncompressedBytes",
  "maxZipEntryUncompressedBytes",
  "maxZipCompressionRatio",
  "maxZipPathDepth",
] as const satisfies readonly (keyof TabularImportLimits)[];

function workflowLimits(
  limits: Readonly<TabularImportLimits>,
): Readonly<DatasetWorkflowLimitsV1> {
  return Object.freeze({
    schemaVersion: "3dena.dataset-workflow-limits.v1",
    ...limits,
  });
}

export const DEFAULT_DATASET_WORKFLOW_LIMITS = workflowLimits(
  DEFAULT_TABULAR_IMPORT_LIMITS,
);

export const HARD_DATASET_WORKFLOW_LIMITS = workflowLimits(
  HARD_TABULAR_IMPORT_LIMITS,
);

export function resolveDatasetWorkflowLimits(
  requested?: unknown,
): Readonly<DatasetWorkflowLimitsV1> {
  if (requested === undefined) return DEFAULT_DATASET_WORKFLOW_LIMITS;
  if (requested === null || typeof requested !== "object" || Array.isArray(requested)) {
    workflowError("INVALID_LIMIT", "limits", "must be an object");
  }
  const record = requested as Record<string, unknown>;
  const unknown = Object.keys(record).filter(
    (field) => !LIMIT_FIELDS.includes(field as keyof TabularImportLimits),
  );
  if (unknown.length > 0) {
    workflowError("UNKNOWN_FIELD", "limits", "contains an unsupported field");
  }
  try {
    return workflowLimits(
      resolveTabularImportLimits(record as Partial<TabularImportLimits>),
    );
  } catch {
    workflowError(
      "INVALID_LIMIT",
      "limits",
      "contains a value outside the versioned tabular-import ceilings",
    );
  }
}

export function parserLimits(
  limits: DatasetWorkflowLimitsV1,
): Readonly<TabularImportLimits> {
  return Object.freeze(Object.fromEntries(
    LIMIT_FIELDS.map((field) => [field, limits[field]]),
  ) as unknown as TabularImportLimits);
}

export function assertDatasetWorkflowLimitsWithinPolicy(
  requested: DatasetWorkflowLimitsV1,
  policy: DatasetWorkflowLimitsV1,
): void {
  const exceeds = LIMIT_FIELDS.some((field) => requested[field] > policy[field]);
  if (exceeds) {
    workflowError(
      "INVALID_LIMIT",
      "preflight.limits",
      "exceeds the trusted workflow limit policy",
    );
  }
}
