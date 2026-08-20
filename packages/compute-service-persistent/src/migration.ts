import type { SqlQueryExecutor } from "./postgres";
import { LOWER_SHA256 } from "./util";

export interface PersistentComputeMigrationBindingV1 {
  readonly version: string;
  readonly sha256: string;
}

interface MigrationRow extends Record<string, unknown> {
  readonly version?: unknown;
  readonly sha256?: unknown;
}

/** Runtime startup is verify-only. Schema mutation is reserved for migrate.mjs apply. */
export async function verifyPersistentComputeMigration(
  database: SqlQueryExecutor,
  expected: PersistentComputeMigrationBindingV1,
): Promise<boolean> {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u.test(expected.version) ||
    !LOWER_SHA256.test(expected.sha256)
  ) return false;
  try {
    const result = await database.query<MigrationRow>(
      "SELECT version, sha256 FROM compute_schema_migrations ORDER BY applied_at, version",
    );
    return result.rows.length === 1 &&
      result.rows[0]?.version === expected.version &&
      result.rows[0]?.sha256 === expected.sha256;
  } catch {
    return false;
  }
}
