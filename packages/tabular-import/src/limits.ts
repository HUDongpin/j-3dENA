import { tabularError } from "./errors";
import type { TabularImportLimits } from "./types";

const MIB = 1024 * 1024;

export const DEFAULT_TABULAR_IMPORT_LIMITS: Readonly<TabularImportLimits> =
  Object.freeze({
    maxFileBytes: 5 * MIB,
    maxWorksheets: 32,
    maxRows: 100_000,
    maxColumns: 256,
    maxCells: 5_000_000,
    maxStringLength: 32_768,
    maxZipEntries: 512,
    maxZipTotalUncompressedBytes: 64 * MIB,
    maxZipEntryUncompressedBytes: 32 * MIB,
    maxZipCompressionRatio: 250,
    maxZipPathDepth: 16,
  });

export const HARD_TABULAR_IMPORT_LIMITS: Readonly<TabularImportLimits> =
  Object.freeze({
    maxFileBytes: 25 * MIB,
    maxWorksheets: 256,
    maxRows: 500_000,
    maxColumns: 1_024,
    maxCells: 20_000_000,
    maxStringLength: 1_000_000,
    maxZipEntries: 4_096,
    maxZipTotalUncompressedBytes: 256 * MIB,
    maxZipEntryUncompressedBytes: 128 * MIB,
    maxZipCompressionRatio: 2_000,
    maxZipPathDepth: 32,
  });

const LIMIT_KEYS = Object.freeze(
  Object.keys(DEFAULT_TABULAR_IMPORT_LIMITS) as (keyof TabularImportLimits)[],
);

export function resolveTabularImportLimits(
  requested?: Partial<TabularImportLimits>,
): Readonly<TabularImportLimits> {
  if (requested !== undefined) {
    if (requested === null || typeof requested !== "object" || Array.isArray(requested)) {
      tabularError("INVALID_LIMIT", "Tabular import limits must be an object.", "limits");
    }
    const unknown = Object.keys(requested).filter(
      (key) => !LIMIT_KEYS.includes(key as keyof TabularImportLimits),
    );
    if (unknown.length > 0) {
      tabularError(
        "INVALID_LIMIT",
        "Tabular import limits contain an unsupported field.",
        "limits",
      );
    }
  }

  const resolved = { ...DEFAULT_TABULAR_IMPORT_LIMITS };
  for (const key of LIMIT_KEYS) {
    const value = requested?.[key] ?? resolved[key];
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > HARD_TABULAR_IMPORT_LIMITS[key]
    ) {
      tabularError(
        "INVALID_LIMIT",
        `Tabular import limit must be a positive safe integer no greater than ${HARD_TABULAR_IMPORT_LIMITS[key]}.`,
        `limits.${key}`,
      );
    }
    resolved[key] = value;
  }

  return Object.freeze(resolved);
}
