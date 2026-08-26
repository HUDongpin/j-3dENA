#!/usr/bin/env node
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  canonicalOperatorCustodyRoot,
  portableOperatorPath,
  readOperatorCustodiedFile,
} from "./operator-path-custody.mjs";
import { parseStrictJson } from "./strict-json.mjs";

const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u;
const LOWER_SHA256 = /^[a-f0-9]{64}$/u;
const RETRYABLE_TRANSACTION_CODES = new Set(["40001", "40P01"]);
const MAXIMUM_TRANSACTION_ATTEMPTS = 3;
const MAX_MIGRATION_CONFIG_BYTES = 64 * 1024;
const MAX_MIGRATION_BYTES = 1024 * 1024;

// One reviewed lock identity shared by migration application/verification and
// build-approval activation/verification. It is passed as text and cast by
// PostgreSQL so there is no JavaScript integer-precision ambiguity.
export const MIGRATION_ADVISORY_LOCK_KEY = "357324491953618";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exact(value, fields) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...fields].sort().join("\0");
}

export function migrationManifestSha256(migrations) {
  const binding = migrations.map(({ version, sha256: migrationSha256 }) => ({
    sha256: migrationSha256,
    version,
  }));
  return sha256(Buffer.from(JSON.stringify(binding), "utf8"));
}

function validMigrations(value) {
  if (!Array.isArray(value) || value.length < 1) return false;
  const versions = [];
  for (const entry of value) {
    if (!exact(entry, ["path", "sha256", "version"]) ||
        !portableOperatorPath(entry.path) ||
        typeof entry.sha256 !== "string" || !LOWER_SHA256.test(entry.sha256) ||
        typeof entry.version !== "string" || !VERSION.test(entry.version)) return false;
    versions.push(entry.version);
  }
  return new Set(versions).size === versions.length &&
    [...versions].sort().every((version, index) => version === versions[index]);
}

export async function loadMigrationConfig(
  sourceRoot,
  configPath,
  expectedConfigSha256,
  environment = process.env,
) {
  if (!portableOperatorPath(configPath) ||
      typeof expectedConfigSha256 !== "string" ||
      !LOWER_SHA256.test(expectedConfigSha256)) {
    throw new Error("migration config is invalid");
  }
  const rootRealPath = await canonicalOperatorCustodyRoot(
    sourceRoot,
    "migration config is invalid",
  );
  let configBytes;
  let config;
  try {
    configBytes = await readOperatorCustodiedFile(
      rootRealPath,
      configPath,
      MAX_MIGRATION_CONFIG_BYTES,
      "migration config is invalid",
    );
    if (sha256(configBytes) !== expectedConfigSha256) {
      throw new Error("migration config is invalid");
    }
    config = parseStrictJson(configBytes);
  } catch {
    throw new Error("migration config is invalid");
  }
  if (!exact(config, ["databaseUrlEnv", "migrations"]) ||
      typeof config.databaseUrlEnv !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(config.databaseUrlEnv) ||
      !validMigrations(config.migrations)) {
    throw new Error("migration config is invalid");
  }
  const migrations = [];
  for (const entry of config.migrations) {
    const bytes = await readOperatorCustodiedFile(
      rootRealPath,
      entry.path,
      MAX_MIGRATION_BYTES,
      "migration config is invalid",
    );
    if (sha256(bytes) !== entry.sha256) {
      throw new Error(`migration SHA-256 mismatch: ${entry.version}`);
    }
    migrations.push({ ...entry, bytes });
  }
  const connectionString = environment[config.databaseUrlEnv];
  if (!connectionString) throw new Error("configured database URL environment variable is missing");
  return {
    config,
    migrations,
    migrationManifestSha256: migrationManifestSha256(config.migrations),
    connectionString,
  };
}

async function pgClient(connectionString) {
  // Kept dynamic so source/type checks do not silently install a dependency.
  // Production packaging must provide a reviewed exact `pg` version.
  const { Client } = await import("pg");
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: true } });
  await client.connect();
  return client;
}

async function registryRows(client, allowMissingTable) {
  if (allowMissingTable) await client.query("SAVEPOINT compute_migration_registry_probe");
  try {
    const result = await client.query(
      "SELECT version, sha256 FROM compute_schema_migrations ORDER BY applied_at, version",
    );
    if (allowMissingTable) await client.query("RELEASE SAVEPOINT compute_migration_registry_probe");
    return result.rows;
  } catch (error) {
    if (allowMissingTable && error !== null && typeof error === "object" && error.code === "42P01") {
      await client.query("ROLLBACK TO SAVEPOINT compute_migration_registry_probe");
      await client.query("RELEASE SAVEPOINT compute_migration_registry_probe");
      return [];
    }
    throw error;
  }
}

function exactRegistry(rows, expected) {
  return rows.length === expected.length && rows.every((row, index) =>
    row?.version === expected[index]?.version && row?.sha256 === expected[index]?.sha256,
  );
}

function exactPrefix(rows, expected) {
  return rows.length <= expected.length && rows.every((row, index) =>
    row?.version === expected[index]?.version && row?.sha256 === expected[index]?.sha256,
  );
}

function retryableTransactionError(error) {
  return error !== null && typeof error === "object" &&
    RETRYABLE_TRANSACTION_CODES.has(error.code);
}

async function runLockedTransaction(client, beginStatement, operation) {
  for (let attempt = 1; attempt <= MAXIMUM_TRANSACTION_ATTEMPTS; attempt += 1) {
    let transactionStarted = false;
    let committed = false;
    try {
      await client.query(beginStatement);
      transactionStarted = true;
      await client.query(
        "SELECT pg_advisory_xact_lock($1::bigint)",
        [MIGRATION_ADVISORY_LOCK_KEY],
      );
      await operation();
      await client.query("COMMIT");
      committed = true;
      return;
    } catch (error) {
      if (transactionStarted && !committed) {
        try {
          await client.query("ROLLBACK");
        } catch {
          throw new Error("migration transaction rollback failed");
        }
      }
      if (attempt < MAXIMUM_TRANSACTION_ATTEMPTS && retryableTransactionError(error)) continue;
      throw error;
    }
  }
}

function migrationBody(bytes) {
  const text = bytes.toString("utf8");
  const match = /^\s*BEGIN\s*;\s*([\s\S]*?)\s*COMMIT\s*;\s*$/iu.exec(text);
  if (match?.[1] === undefined || match[1].trim() === "") {
    throw new Error("migration transaction wrapper is invalid");
  }
  return `${match[1].trim()}\n`;
}

export async function verifyMigration(
  sourceRoot,
  configPath,
  expectedConfigSha256,
  connect = pgClient,
) {
  const { config, connectionString } = await loadMigrationConfig(
    sourceRoot,
    configPath,
    expectedConfigSha256,
  );
  const client = await connect(connectionString);
  try {
    await runLockedTransaction(
      client,
      "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY",
      async () => {
        const rows = await registryRows(client, false);
        if (!exactRegistry(rows, config.migrations)) {
          throw new Error("approved migration manifest is not active");
        }
      },
    );
  } finally {
    await client.end();
  }
}

export async function applyMigration(
  sourceRoot,
  configPath,
  expectedConfigSha256,
  connect = pgClient,
) {
  const { config, migrations, connectionString } = await loadMigrationConfig(
    sourceRoot,
    configPath,
    expectedConfigSha256,
  );
  const migrationBodies = migrations.map(({ bytes }) => migrationBody(bytes));
  const client = await connect(connectionString);
  try {
    await runLockedTransaction(
      client,
      "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE",
      async () => {
        let rows = await registryRows(client, true);
        if (!exactPrefix(rows, config.migrations)) {
          throw new Error("migration registry is not an exact approved prefix");
        }
        for (let index = rows.length; index < migrations.length; index += 1) {
          const migration = migrations[index];
          const body = migrationBodies[index];
          if (migration === undefined || body === undefined) {
            throw new Error("migration config is invalid");
          }
          await client.query(body);
          await client.query(
            `INSERT INTO compute_schema_migrations (version, sha256)
             VALUES ($1,$2) ON CONFLICT (version) DO NOTHING`,
            [migration.version, migration.sha256],
          );
          rows = await registryRows(client, false);
          if (!exactRegistry(rows, config.migrations.slice(0, index + 1))) {
            throw new Error("migration registry mismatch after append");
          }
        }
        if (!exactRegistry(rows, config.migrations)) {
          throw new Error("migration registry mismatch after apply");
        }
      },
    );
  } finally {
    await client.end();
  }
}

const [command, configPath, expectedConfigSha256] = process.argv.slice(2);
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!configPath || !expectedConfigSha256 || process.argv.slice(2).length !== 3 ||
      (command !== "apply" && command !== "verify")) {
    throw new Error(
      "usage: migrate.mjs <apply|verify> <portable-config-path> <expected-config-sha256>",
    );
  }
  if (command === "apply") {
    await applyMigration(process.cwd(), configPath, expectedConfigSha256);
  } else {
    await verifyMigration(process.cwd(), configPath, expectedConfigSha256);
  }
}
