#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u;
const LOWER_SHA256 = /^[a-f0-9]{64}$/u;

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
        typeof entry.path !== "string" || entry.path.trim() === "" ||
        typeof entry.sha256 !== "string" || !LOWER_SHA256.test(entry.sha256) ||
        typeof entry.version !== "string" || !VERSION.test(entry.version)) return false;
    versions.push(entry.version);
  }
  return new Set(versions).size === versions.length &&
    [...versions].sort().every((version, index) => version === versions[index]);
}

export async function loadMigrationConfig(configPath, environment = process.env) {
  const absoluteConfigPath = resolve(configPath);
  const config = JSON.parse(await readFile(absoluteConfigPath, "utf8"));
  if (!exact(config, ["databaseUrlEnv", "migrations"]) ||
      typeof config.databaseUrlEnv !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(config.databaseUrlEnv) ||
      !validMigrations(config.migrations)) {
    throw new Error("migration config is invalid");
  }
  const migrations = [];
  for (const entry of config.migrations) {
    const bytes = await readFile(resolve(dirname(absoluteConfigPath), entry.path));
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
  try {
    const result = await client.query(
      "SELECT version, sha256 FROM compute_schema_migrations ORDER BY applied_at, version",
    );
    return result.rows;
  } catch (error) {
    if (allowMissingTable && error !== null && typeof error === "object" && error.code === "42P01") {
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

export async function verifyMigration(configPath, connect = pgClient) {
  const { config, connectionString } = await loadMigrationConfig(configPath);
  const client = await connect(connectionString);
  try {
    const rows = await registryRows(client, false);
    if (!exactRegistry(rows, config.migrations)) {
      throw new Error("approved migration manifest is not active");
    }
  } finally {
    await client.end();
  }
}

export async function applyMigration(configPath, connect = pgClient) {
  const { config, migrations, connectionString } = await loadMigrationConfig(configPath);
  const client = await connect(connectionString);
  try {
    let rows = await registryRows(client, true);
    if (!exactPrefix(rows, config.migrations)) {
      throw new Error("migration registry is not an exact approved prefix");
    }
    for (let index = rows.length; index < migrations.length; index += 1) {
      const migration = migrations[index];
      if (migration === undefined) throw new Error("migration config is invalid");
      await client.query(migration.bytes.toString("utf8"));
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
  } finally {
    await client.end();
  }
}

const [command, configPath] = process.argv.slice(2);
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!configPath || (command !== "apply" && command !== "verify")) {
    throw new Error("usage: migrate.mjs <apply|verify> <explicit-config.json>");
  }
  if (command === "apply") await applyMigration(configPath);
  else await verifyMigration(configPath);
}
