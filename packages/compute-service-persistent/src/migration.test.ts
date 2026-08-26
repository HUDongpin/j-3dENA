import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "pg";
import { describe, expect, it } from "vitest";

import {
  applyMigration,
  loadMigrationConfig,
  MIGRATION_ADVISORY_LOCK_KEY,
  migrationManifestSha256,
  verifyMigration,
} from "../deploy/migrate.mjs";
import { verifyPersistentComputeMigration } from "./migration";
import type { SqlQueryExecutor, SqlQueryResult } from "./postgres";

const digest = (bytes: string | Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
const REAL_POSTGRES_TEST_DATABASE_URL =
  process.env.BUILD_APPROVAL_POSTGRES_TEST_DATABASE_URL;
const REPOSITORY_ROOT = new URL("../../../", import.meta.url).pathname;
const EXAMPLE_CONFIG_PATH =
  "packages/compute-service-persistent/deploy/migration-config.example.json";

async function writeMigrationConfig(
  directory: string,
  value: Record<string, unknown> | string,
): Promise<string> {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  await writeFile(join(directory, "config.json"), text);
  return digest(text);
}

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
  it("binds the checked-in ordered 0001 through 0005 migration example to exact bytes", async () => {
    const configBytes = await readFile(join(REPOSITORY_ROOT, EXAMPLE_CONFIG_PATH));
    const loaded = await loadMigrationConfig(
      REPOSITORY_ROOT,
      EXAMPLE_CONFIG_PATH,
      digest(configBytes),
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
        {
          version: "0005-build-approval-v4",
          sha256: "41baae6414181e90d8d3f8510aa4e807f1d76fb879de394498a5780f840195fa",
        },
      ]);
  });

  it("requires an externally pinned portable config and rejects unsafe migration paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "3dena-migration-custody-"));
    try {
      const migration = "BEGIN; SELECT 1; COMMIT;\n";
      await writeFile(join(directory, "0001.sql"), migration);
      const configSha256 = await writeMigrationConfig(directory, {
        databaseUrlEnv: "TEST_NEON_URL",
        migrations: [{ version: "0001", path: "0001.sql", sha256: digest(migration) }],
      });
      const environment = { TEST_NEON_URL: "postgresql://example.invalid/db" };
      await expect(loadMigrationConfig(
        directory,
        "config.json",
        configSha256,
        environment,
      )).resolves.toMatchObject({ connectionString: environment.TEST_NEON_URL });
      for (const invalidConfigPath of [
        join(directory, "config.json"),
        "../config.json",
        "./config.json",
        "C:/config.json",
      ]) {
        await expect(loadMigrationConfig(
          directory,
          invalidConfigPath,
          configSha256,
          environment,
        )).rejects.toThrow("migration config is invalid");
      }
      await expect(loadMigrationConfig(
        directory,
        "config.json",
        "9".repeat(64),
        environment,
      )).rejects.toThrow("migration config is invalid");

      for (const invalidMigrationPath of [
        join(directory, "0001.sql"),
        "../0001.sql",
        "./0001.sql",
        "C:/0001.sql",
        "nested\\0001.sql",
      ]) {
        const invalidConfigSha256 = await writeMigrationConfig(directory, {
          databaseUrlEnv: "TEST_NEON_URL",
          migrations: [{
            version: "0001",
            path: invalidMigrationPath,
            sha256: digest(migration),
          }],
        });
        await expect(loadMigrationConfig(
          directory,
          "config.json",
          invalidConfigSha256,
          environment,
        )).rejects.toThrow("migration config is invalid");
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects config and migration parent or leaf symlinks", async () => {
    for (const [leaf, target] of [
      ["config.json", "config-real.json"],
      ["0001.sql", "0001-real.sql"],
    ] as const) {
      const directory = await mkdtemp(join(tmpdir(), "3dena-migration-custody-"));
      try {
        const migration = "BEGIN; SELECT 1; COMMIT;\n";
        await writeFile(join(directory, "0001.sql"), migration);
        const configSha256 = await writeMigrationConfig(directory, {
          databaseUrlEnv: "TEST_NEON_URL",
          migrations: [{ version: "0001", path: "0001.sql", sha256: digest(migration) }],
        });
        await rename(join(directory, leaf), join(directory, target));
        await symlink(target, join(directory, leaf));
        await expect(loadMigrationConfig(
          directory,
          "config.json",
          configSha256,
          { TEST_NEON_URL: "postgresql://example.invalid/db" },
        )).rejects.toThrow("migration config is invalid");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }

    const configParentDirectory = await mkdtemp(join(tmpdir(), "3dena-migration-custody-"));
    try {
      const migration = "BEGIN; SELECT 1; COMMIT;\n";
      await writeFile(join(configParentDirectory, "0001.sql"), migration);
      const configSha256 = await writeMigrationConfig(configParentDirectory, {
        databaseUrlEnv: "TEST_NEON_URL",
        migrations: [{ version: "0001", path: "0001.sql", sha256: digest(migration) }],
      });
      await mkdir(join(configParentDirectory, "real"));
      await rename(
        join(configParentDirectory, "config.json"),
        join(configParentDirectory, "real", "config.json"),
      );
      await symlink("real", join(configParentDirectory, "linked"));
      await expect(loadMigrationConfig(
        configParentDirectory,
        "linked/config.json",
        configSha256,
        { TEST_NEON_URL: "postgresql://example.invalid/db" },
      )).rejects.toThrow("migration config is invalid");
    } finally {
      await rm(configParentDirectory, { recursive: true, force: true });
    }

    const directory = await mkdtemp(join(tmpdir(), "3dena-migration-custody-"));
    try {
      await mkdir(join(directory, "real"));
      await symlink("real", join(directory, "linked"));
      const migration = "BEGIN; SELECT 1; COMMIT;\n";
      const configSha256 = await writeMigrationConfig(directory, {
        databaseUrlEnv: "TEST_NEON_URL",
        migrations: [{ version: "0001", path: "linked/0001.sql", sha256: digest(migration) }],
      });
      await expect(loadMigrationConfig(
        directory,
        "config.json",
        configSha256,
        { TEST_NEON_URL: "postgresql://example.invalid/db" },
      )).rejects.toThrow("migration config is invalid");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("re-hashes every ordered migration and rejects drift or reordering before connecting", async () => {
    const directory = await mkdtemp(join(tmpdir(), "3dena-migration-"));
    try {
      const firstPath = join(directory, "0001.sql");
      const secondPath = join(directory, "0002.sql");
      const first = Buffer.from("BEGIN; SELECT 1; COMMIT;\n");
      const second = Buffer.from("BEGIN; SELECT 2; COMMIT;\n");
      await writeFile(firstPath, first);
      await writeFile(secondPath, second);
      const migrations = [
        { version: "0001-persistent-compute", path: "0001.sql", sha256: digest(first) },
        { version: "0002-persistent-control-plane", path: "0002.sql", sha256: digest(second) },
      ];
      let configSha256 = await writeMigrationConfig(directory, {
        databaseUrlEnv: "TEST_NEON_URL",
        migrations,
      });
      await expect(loadMigrationConfig(directory, "config.json", configSha256, {
        TEST_NEON_URL: "postgresql://example.invalid/db",
      })).resolves.toMatchObject({
        config: { migrations },
        migrationManifestSha256: migrationManifestSha256(migrations),
        connectionString: "postgresql://example.invalid/db",
      });

      await writeFile(secondPath, "mutated");
      await expect(loadMigrationConfig(directory, "config.json", configSha256, {
        TEST_NEON_URL: "postgresql://example.invalid/db",
      })).rejects.toThrow("migration SHA-256 mismatch");

      await writeFile(secondPath, second);
      configSha256 = await writeMigrationConfig(directory, {
        databaseUrlEnv: "TEST_NEON_URL",
        migrations: [...migrations].reverse(),
      });
      await expect(loadMigrationConfig(directory, "config.json", configSha256, {
        TEST_NEON_URL: "postgresql://example.invalid/db",
      })).rejects.toThrow("migration config is invalid");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects escape-equivalent duplicate migration config keys before connecting", async () => {
    const directory = await mkdtemp(join(tmpdir(), "3dena-migration-"));
    try {
      const migrationPath = join(directory, "0001.sql");
      const migration = "BEGIN; SELECT 1; COMMIT;\n";
      await writeFile(migrationPath, migration);
      const configSha256 = await writeMigrationConfig(
        directory,
        `{"databaseUrlEnv":"TEST_NEON_URL","\\u0064atabaseUrlEnv":"TEST_NEON_URL",` +
          `"migrations":[{"version":"0001","path":"0001.sql",` +
          `"sha256":"${digest(migration)}"}]}`,
      );
      let connects = 0;
      await expect(applyMigration(directory, "config.json", configSha256, async () => {
        connects += 1;
        throw new Error("must not connect");
      })).rejects.toThrow("migration config is invalid");
      expect(connects).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("applies only a missing suffix, verifies after each append, and is idempotent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "3dena-migration-"));
    try {
      const firstPath = join(directory, "0001.sql");
      const secondPath = join(directory, "0002.sql");
      const firstSql = "BEGIN; SELECT 1; COMMIT;\n";
      const secondSql = "BEGIN; CREATE TABLE migration_fixture(id integer); COMMIT;\n";
      const migrations = [
        { version: "0001-persistent-compute", path: "0001.sql", sha256: digest(firstSql) },
        { version: "0002-persistent-control-plane", path: "0002.sql", sha256: digest(secondSql) },
      ];
      await writeFile(firstPath, firstSql);
      await writeFile(secondPath, secondSql);
      const configSha256 = await writeMigrationConfig(
        directory,
        { databaseUrlEnv: "TEST_NEON_URL", migrations },
      );

      const statements: string[] = [];
      const rows = [{ version: migrations[0]!.version, sha256: migrations[0]!.sha256 }];
      let transientFailures = 2;
      const connect = async () => ({
        async query(sql: string, values: readonly unknown[] = []) {
          statements.push(sql);
          if (sql.startsWith("SELECT pg_advisory_xact_lock") && transientFailures > 0) {
            transientFailures -= 1;
            throw Object.assign(new Error("serialization fixture"), { code: "40001" });
          }
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
        await applyMigration(directory, "config.json", configSha256, connect);
        await applyMigration(directory, "config.json", configSha256, connect);
        await verifyMigration(directory, "config.json", configSha256, connect);
      } finally {
        if (previous === undefined) delete process.env.TEST_NEON_URL;
        else process.env.TEST_NEON_URL = previous;
      }

      expect(statements).not.toContain(firstSql);
      expect(statements.filter((sql) => sql.includes("CREATE TABLE migration_fixture")))
        .toHaveLength(1);
      expect(statements.filter((sql) => sql.startsWith("INSERT INTO compute_schema_migrations")))
        .toHaveLength(1);
      expect(statements.filter((sql) => sql.startsWith("BEGIN TRANSACTION"))).toHaveLength(5);
      expect(statements.filter((sql) => sql === "ROLLBACK")).toHaveLength(2);
      const ddl = statements.findIndex((sql) => sql.includes("CREATE TABLE migration_fixture"));
      const successfulBegin = statements.slice(0, ddl).lastIndexOf(
        "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE",
      );
      const lock = statements.findIndex(
        (sql, index) => index > successfulBegin && index < ddl &&
          sql.startsWith("SELECT pg_advisory_xact_lock"),
      );
      expect(lock).toBeGreaterThan(successfulBegin);
      expect(ddl).toBeGreaterThan(lock);
      expect(statements[lock]).toContain("$1::bigint");
      expect(MIGRATION_ADVISORY_LOCK_KEY).toMatch(/^[0-9]+$/u);
      expect(rows).toEqual(migrations.map(({ version, sha256 }) => ({ version, sha256 })));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("caps retryable migration deadlocks at three transaction attempts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "3dena-migration-"));
    try {
      const migrationPath = join(directory, "0001.sql");
      const migration = "BEGIN; SELECT 1; COMMIT;\n";
      await writeFile(migrationPath, migration);
      const configSha256 = await writeMigrationConfig(directory, {
        databaseUrlEnv: "TEST_NEON_URL",
        migrations: [{ version: "0001", path: "0001.sql", sha256: digest(migration) }],
      });
      const statements: string[] = [];
      const previous = process.env.TEST_NEON_URL;
      process.env.TEST_NEON_URL = "postgresql://example.invalid/db";
      try {
        await expect(applyMigration(directory, "config.json", configSha256, async () => ({
          async query(sql: string) {
            statements.push(sql);
            if (sql.startsWith("SELECT pg_advisory_xact_lock")) {
              throw Object.assign(new Error("deadlock fixture"), { code: "40P01" });
            }
            return { rows: [] };
          },
          async end() {},
        }))).rejects.toMatchObject({ code: "40P01" });
      } finally {
        if (previous === undefined) delete process.env.TEST_NEON_URL;
        else process.env.TEST_NEON_URL = previous;
      }
      expect(statements.filter((sql) => sql.startsWith("BEGIN TRANSACTION"))).toHaveLength(3);
      expect(statements.filter((sql) => sql === "ROLLBACK")).toHaveLength(3);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.runIf(REAL_POSTGRES_TEST_DATABASE_URL)(
    "serializes two real PostgreSQL connections with the shared transaction-scoped lock",
    async () => {
      const first = new Client({ connectionString: REAL_POSTGRES_TEST_DATABASE_URL });
      const second = new Client({ connectionString: REAL_POSTGRES_TEST_DATABASE_URL });
      await Promise.all([first.connect(), second.connect()]);
      try {
        await first.query("BEGIN");
        await first.query("SELECT pg_advisory_xact_lock($1::bigint)", [
          MIGRATION_ADVISORY_LOCK_KEY,
        ]);
        await second.query("BEGIN");
        await second.query("SET LOCAL lock_timeout = '100ms'");
        await expect(second.query("SELECT pg_advisory_xact_lock($1::bigint)", [
          MIGRATION_ADVISORY_LOCK_KEY,
        ])).rejects.toMatchObject({ code: "55P03" });
        await second.query("ROLLBACK");
        await first.query("ROLLBACK");

        await second.query("BEGIN");
        await expect(second.query("SELECT pg_advisory_xact_lock($1::bigint)", [
          MIGRATION_ADVISORY_LOCK_KEY,
        ])).resolves.toMatchObject({ rowCount: 1 });
        await second.query("ROLLBACK");
      } finally {
        await Promise.allSettled([
          first.query("ROLLBACK"),
          second.query("ROLLBACK"),
        ]);
        await Promise.all([first.end(), second.end()]);
      }
    },
  );

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
