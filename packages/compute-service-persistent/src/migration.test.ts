import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyMigration,
  loadMigrationConfig,
  migrationManifestSha256,
  verifyMigration,
} from "../deploy/migrate.mjs";
import { verifyPersistentComputeMigration } from "./migration";
import type { SqlQueryExecutor, SqlQueryResult } from "./postgres";

const digest = (bytes: string | Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

class MigrationExecutor implements SqlQueryExecutor {
  constructor(private readonly rows: readonly Record<string, unknown>[]) {}

  async query<Row extends Record<string, unknown>>(): Promise<SqlQueryResult<Row>> {
    return {
      rows: structuredClone(this.rows) as Row[],
      rowCount: this.rows.length,
    };
  }
}

describe("persistent compute migration chain", () => {
  it("binds the checked-in ordered 0001/0002/0003/0004 migration example to exact bytes", async () => {
    const loaded = await loadMigrationConfig(
      new URL("../deploy/migration-config.example.json", import.meta.url).pathname,
      { NEON_DIRECT_DATABASE_URL: "postgresql://example.invalid/db" },
    );
    expect(loaded.config.migrations.map(({ version, sha256 }) => ({ version, sha256 })))
      .toEqual([
        {
          version: "0001-persistent-compute",
          sha256: "2ada0828852d69dfebfaf3da96d41ba69dd91b522117fd868fad1665239e568e",
        },
        {
          version: "0002-persistent-control-plane",
          sha256: "3df697fed6ca0ad6e4106d2f1c649b877e16a64ea3228ef23aea8d5540a30a21",
        },
        {
          version: "0003-build-approval-v3",
          sha256: "104cdcb19e043d8bd65d717dc19fb0285a45627260278f1bee8e4a5197218326",
        },
        {
          version: "0004-scientific-result-generations",
          sha256: "ff61b7f367f7e03e790725fb766f1e29c4b89d03fe586901f866c3bbebde8ce7",
        },
      ]);
  });

  it("re-hashes every ordered migration and rejects drift or reordering before connecting", async () => {
    const directory = await mkdtemp(join(tmpdir(), "3dena-migration-"));
    try {
      const firstPath = join(directory, "0001.sql");
      const secondPath = join(directory, "0002.sql");
      const configPath = join(directory, "config.json");
      const first = Buffer.from("BEGIN; SELECT 1; COMMIT;\n");
      const second = Buffer.from("BEGIN; SELECT 2; COMMIT;\n");
      await writeFile(firstPath, first);
      await writeFile(secondPath, second);
      const migrations = [
        { version: "0001-persistent-compute", path: firstPath, sha256: digest(first) },
        { version: "0002-persistent-control-plane", path: secondPath, sha256: digest(second) },
      ];
      await writeFile(configPath, JSON.stringify({
        databaseUrlEnv: "TEST_NEON_URL",
        migrations,
      }));
      await expect(loadMigrationConfig(configPath, {
        TEST_NEON_URL: "postgresql://example.invalid/db",
      })).resolves.toMatchObject({
        config: { migrations },
        migrationManifestSha256: migrationManifestSha256(migrations),
        connectionString: "postgresql://example.invalid/db",
      });

      await writeFile(secondPath, "mutated");
      await expect(loadMigrationConfig(configPath, {
        TEST_NEON_URL: "postgresql://example.invalid/db",
      })).rejects.toThrow("migration SHA-256 mismatch");

      await writeFile(secondPath, second);
      await writeFile(configPath, JSON.stringify({
        databaseUrlEnv: "TEST_NEON_URL",
        migrations: [...migrations].reverse(),
      }));
      await expect(loadMigrationConfig(configPath, {
        TEST_NEON_URL: "postgresql://example.invalid/db",
      })).rejects.toThrow("migration config is invalid");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("applies only a missing suffix, verifies after each append, and is idempotent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "3dena-migration-"));
    try {
      const firstPath = join(directory, "0001.sql");
      const secondPath = join(directory, "0002.sql");
      const configPath = join(directory, "config.json");
      const firstSql = "BEGIN; SELECT 1; COMMIT;\n";
      const secondSql = "BEGIN; SELECT 2; COMMIT;\n";
      const migrations = [
        { version: "0001-persistent-compute", path: firstPath, sha256: digest(firstSql) },
        { version: "0002-persistent-control-plane", path: secondPath, sha256: digest(secondSql) },
      ];
      await writeFile(firstPath, firstSql);
      await writeFile(secondPath, secondSql);
      await writeFile(configPath, JSON.stringify({ databaseUrlEnv: "TEST_NEON_URL", migrations }));

      const statements: string[] = [];
      const rows = [{ version: migrations[0]!.version, sha256: migrations[0]!.sha256 }];
      const connect = async () => ({
        async query(sql: string, values: readonly unknown[] = []) {
          statements.push(sql);
          if (sql.startsWith("INSERT INTO compute_schema_migrations")) {
            if (!rows.some((row) => row.version === values[0])) {
              rows.push({ version: String(values[0]), sha256: String(values[1]) });
            }
          }
          if (sql.startsWith("SELECT version, sha256")) return { rows: structuredClone(rows) };
          return { rows: [] };
        },
        async end() {},
      });
      const previous = process.env.TEST_NEON_URL;
      process.env.TEST_NEON_URL = "postgresql://example.invalid/db";
      try {
        await applyMigration(configPath, connect);
        await applyMigration(configPath, connect);
        await verifyMigration(configPath, connect);
      } finally {
        if (previous === undefined) delete process.env.TEST_NEON_URL;
        else process.env.TEST_NEON_URL = previous;
      }

      expect(statements).not.toContain(firstSql);
      expect(statements.filter((sql) => sql === secondSql)).toHaveLength(1);
      expect(statements.filter((sql) => sql.startsWith("INSERT INTO compute_schema_migrations")))
        .toHaveLength(1);
      expect(rows).toEqual(migrations.map(({ version, sha256 }) => ({ version, sha256 })));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when migration rows are missing, extra, out of order, or hash-mismatched", async () => {
    const expected = [
      { version: "0001-persistent-compute", sha256: "a".repeat(64) },
      { version: "0002-persistent-control-plane", sha256: "b".repeat(64) },
    ] as const;
    for (const rows of [
      [],
      [expected[0]],
      [{ version: expected[0].version, sha256: "c".repeat(64) }, expected[1]],
      [expected[1], expected[0]],
      [...expected, { version: "0003-extra", sha256: "c".repeat(64) }],
    ]) {
      await expect(verifyPersistentComputeMigration(
        new MigrationExecutor(rows),
        expected,
      )).resolves.toBe(false);
    }
    await expect(verifyPersistentComputeMigration(
      new MigrationExecutor(expected),
      expected,
    )).resolves.toBe(true);
  });
});
