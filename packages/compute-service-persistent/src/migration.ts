import type { SqlQueryExecutor } from "./postgres";
import { LOWER_SHA256 } from "./util";

export interface PersistentComputeMigrationBindingV1 {
  readonly version: string;
  readonly sha256: string;
}

export type PersistentComputeMigrationManifestV1 =
  readonly PersistentComputeMigrationBindingV1[];

interface MigrationRow extends Record<string, unknown> {
  readonly version?: unknown;
  readonly sha256?: unknown;
}

/** Runtime startup is verify-only. Schema mutation is reserved for migrate.mjs apply. */
export async function verifyPersistentComputeMigration(
  database: SqlQueryExecutor,
  expected: PersistentComputeMigrationManifestV1,
): Promise<boolean> {
  if (expected.length < 1 || expected.some((entry) =>
    !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u.test(entry.version) ||
    !LOWER_SHA256.test(entry.sha256)
  ) || new Set(expected.map((entry) => entry.version)).size !== expected.length ||
    [...expected].sort((left, right) => left.version.localeCompare(right.version))
      .some((entry, index) => entry.version !== expected[index]?.version)) return false;
  try {
    const result = await database.query<MigrationRow>(
      "SELECT version, sha256 FROM compute_schema_migrations ORDER BY applied_at, version",
    );
    return result.rows.length === expected.length && result.rows.every((row, index) =>
      row.version === expected[index]?.version && row.sha256 === expected[index]?.sha256,
    );
  } catch {
    return false;
  }
}
