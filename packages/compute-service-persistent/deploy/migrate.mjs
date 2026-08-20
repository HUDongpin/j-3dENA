#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function loadMigrationConfig(configPath, environment = process.env) {
  const config = JSON.parse(await readFile(resolve(configPath), "utf8"));
  const fields = ["databaseUrlEnv", "migrationPath", "migrationSha256", "migrationVersion"];
  if (!config || typeof config !== "object" || Array.isArray(config) ||
      Object.keys(config).sort().join("\0") !== fields.sort().join("\0") ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(config.databaseUrlEnv) ||
      !/^[a-f0-9]{64}$/u.test(config.migrationSha256) ||
      !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u.test(config.migrationVersion)) {
    throw new Error("migration config is invalid");
  }
  const bytes = await readFile(resolve(config.migrationPath));
  if (sha256(bytes) !== config.migrationSha256) throw new Error("migration SHA-256 mismatch");
  const connectionString = environment[config.databaseUrlEnv];
  if (!connectionString) throw new Error("configured database URL environment variable is missing");
  return { config, bytes, connectionString };
}

async function pgClient(connectionString) {
  // Kept dynamic so source/type checks do not silently install a dependency.
  // Production packaging must provide a reviewed exact `pg` version.
  const { Client } = await import("pg");
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: true } });
  await client.connect();
  return client;
}

export async function verifyMigration(configPath, connect = pgClient) {
  const { config, connectionString } = await loadMigrationConfig(configPath);
  const client = await connect(connectionString);
  try {
    const result = await client.query(
      "SELECT version, sha256 FROM compute_schema_migrations ORDER BY applied_at, version",
    );
    if (result.rows.length !== 1 ||
        result.rows[0]?.version !== config.migrationVersion ||
        result.rows[0]?.sha256 !== config.migrationSha256) {
      throw new Error("approved migration version/hash is not active");
    }
  } finally {
    await client.end();
  }
}

export async function applyMigration(configPath, connect = pgClient) {
  const { config, bytes, connectionString } = await loadMigrationConfig(configPath);
  const client = await connect(connectionString);
  try {
    await client.query(bytes.toString("utf8"));
    await client.query(
      `INSERT INTO compute_schema_migrations (version, sha256)
       VALUES ($1,$2) ON CONFLICT (version) DO NOTHING`,
      [config.migrationVersion, config.migrationSha256],
    );
    const result = await client.query(
      "SELECT version, sha256 FROM compute_schema_migrations ORDER BY applied_at, version",
    );
    if (result.rows.length !== 1 ||
        result.rows[0]?.version !== config.migrationVersion ||
        result.rows[0]?.sha256 !== config.migrationSha256) {
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
