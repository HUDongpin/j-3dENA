import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyMigration,
  loadMigrationConfig,
  verifyMigration,
} from "../deploy/migrate.mjs";
import { verifyPersistentComputeMigration } from "./migration";
import type { SqlQueryExecutor, SqlQueryResult } from "./postgres";

class MigrationExecutor implements SqlQueryExecutor {
  constructor(private readonly rows: readonly Record<string, unknown>[]) {}

  async query<Row extends Record<string, unknown>>(): Promise<SqlQueryResult<Row>> {
    return {
      rows: structuredClone(this.rows) as Row[],
      rowCount: this.rows.length,
    };
  }
}

describe("persistent compute migration commands", () => {
  it("re-hashes the exact SQL and rejects config drift before connecting", async () => {
    const directory = await mkdtemp(join(tmpdir(), "3dena-migration-"));
    try {
      const migrationPath = join(directory, "0001.sql");
      const configPath = join(directory, "config.json");
      const bytes = Buffer.from("BEGIN; SELECT 1; COMMIT;\n");
      await writeFile(migrationPath, bytes);
      await writeFile(configPath, JSON.stringify({
        databaseUrlEnv: "TEST_NEON_URL",
        migrationPath,
        migrationSha256: createHash("sha256").update(bytes).digest("hex"),
        migrationVersion: "0001-persistent-compute",
      }));
      await expect(loadMigrationConfig(configPath, {
        TEST_NEON_URL: "postgresql://example.invalid/db",
      })).resolves.toMatchObject({
        config: { migrationVersion: "0001-persistent-compute" },
        connectionString: "postgresql://example.invalid/db",
      });
      await writeFile(migrationPath, "mutated");
      await expect(loadMigrationConfig(configPath, {
        TEST_NEON_URL: "postgresql://example.invalid/db",
      })).rejects.toThrow("migration SHA-256 mismatch");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("apply records then verifies the sole approved migration and startup never applies", async () => {
    const directory = await mkdtemp(join(tmpdir(), "3dena-migration-"));
    try {
      const migrationPath = join(directory, "0001.sql");
      const configPath = join(directory, "config.json");
      const migrationSql = "BEGIN; SELECT 1; COMMIT;\n";
      const migrationSha256 = createHash("sha256").update(migrationSql).digest("hex");
      await writeFile(migrationPath, migrationSql);
      await writeFile(configPath, JSON.stringify({
        databaseUrlEnv: "TEST_NEON_URL",
        migrationPath,
        migrationSha256,
        migrationVersion: "0001-persistent-compute",
      }));
      const statements: string[] = [];
      let recorded = false;
      const connect = async () => ({
        async query(sql: string) {
          statements.push(sql);
          if (sql.startsWith("INSERT INTO compute_schema_migrations")) recorded = true;
          if (sql.startsWith("SELECT version, sha256")) {
            return { rows: recorded ? [{ version: "0001-persistent-compute", sha256: migrationSha256 }] : [] };
          }
          return { rows: [] };
        },
        async end() {},
      });
      const previous = process.env.TEST_NEON_URL;
      process.env.TEST_NEON_URL = "postgresql://example.invalid/db";
      try {
        await applyMigration(configPath, connect);
        await verifyMigration(configPath, connect);
      } finally {
        if (previous === undefined) delete process.env.TEST_NEON_URL;
        else process.env.TEST_NEON_URL = previous;
      }
      expect(statements[0]).toBe(migrationSql);
      expect(statements.filter((sql) => sql.startsWith("INSERT INTO compute_schema_migrations"))).toHaveLength(1);
      expect(statements.at(-1)).toMatch(/^SELECT version, sha256/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when migration rows are missing, extra, or hash-mismatched", async () => {
    const expected = { version: "0001-persistent-compute", sha256: "a".repeat(64) };
    for (const rows of [
      [],
      [{ version: expected.version, sha256: "b".repeat(64) }],
      [expected, { version: "0002", sha256: "b".repeat(64) }],
    ]) {
      await expect(verifyPersistentComputeMigration(
        new MigrationExecutor(rows),
        expected,
      )).resolves.toBe(false);
    }
    await expect(verifyPersistentComputeMigration(
      new MigrationExecutor([expected]),
      expected,
    )).resolves.toBe(true);
  });
});
