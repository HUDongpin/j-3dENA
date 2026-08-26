import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadCapacityOperatorInput,
  runCapacityOperator,
  runCapacityOperatorCli,
  type CapacityOperatorClientV1,
  type CapacityOperatorConnectorV1,
} from "../deploy/capacity-operator.mjs";

const DATABASE_URL = "postgresql://fixture-user:fixture-password-never-real@db.invalid/fixture";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

interface CapacityRow {
  enabled: boolean;
  holderId: string | null;
  quarantined: boolean;
}

class CapacityClient implements CapacityOperatorClientV1 {
  readonly statements: string[] = [];
  readonly rows = new Map<number, CapacityRow>();
  readonly migrationRows: readonly Readonly<{ version: string; sha256: string }>[];
  approval: unknown;
  ended = false;
  #beforeTransaction: Map<number, CapacityRow> | null = null;

  constructor(input: Readonly<{
    migrations: readonly Readonly<{ version: string; sha256: string }>[];
    approval: unknown;
    rows?: readonly Readonly<{ slot: number; enabled: boolean; holderId?: string; quarantined?: boolean }>[];
  }>) {
    this.migrationRows = structuredClone(input.migrations);
    this.approval = structuredClone(input.approval);
    for (const row of input.rows ?? []) {
      this.rows.set(row.slot, {
        enabled: row.enabled,
        holderId: row.holderId ?? null,
        quarantined: row.quarantined ?? false,
      });
    }
  }

  async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[]; readonly rowCount: number }> {
    this.statements.push(text);
    if (text.startsWith("BEGIN TRANSACTION")) {
      this.#beforeTransaction = structuredClone(this.rows);
      return { rows: [], rowCount: 0 };
    }
    if (text === "COMMIT") {
      this.#beforeTransaction = null;
      return { rows: [], rowCount: 0 };
    }
    if (text === "ROLLBACK") {
      if (this.#beforeTransaction !== null) {
        this.rows.clear();
        for (const [slot, row] of this.#beforeTransaction) this.rows.set(slot, row);
      }
      this.#beforeTransaction = null;
      return { rows: [], rowCount: 0 };
    }
    if (text.startsWith("LOCK TABLE")) return { rows: [], rowCount: 0 };
    if (text.startsWith("SELECT version, sha256 FROM compute_schema_migrations")) {
      return { rows: structuredClone(this.migrationRows), rowCount: this.migrationRows.length };
    }
    if (text.startsWith("WITH latest_activation")) {
      return this.approval === undefined
        ? { rows: [], rowCount: 0 }
        : { rows: [{ approval: structuredClone(this.approval) }], rowCount: 1 };
    }
    if (text.includes("AS configured_expected_count") &&
        text.includes("FROM compute_capacity_slots")) {
      const expected = Number(values[0]);
      const configuredExpected = [...this.rows].filter(([slot]) => slot <= expected).length;
      const enabledExpected = [...this.rows].filter(([slot, row]) =>
        slot <= expected && row.enabled && !row.quarantined).length;
      const enabledBeyond = [...this.rows].filter(([slot, row]) =>
        slot > expected && row.enabled).length;
      const occupiedBeyond = [...this.rows].filter(([slot, row]) =>
        slot > expected && row.holderId !== null).length;
      return {
        rows: [{
          configured_expected_count: configuredExpected,
          enabled_expected_count: enabledExpected,
          enabled_beyond_count: enabledBeyond,
          occupied_beyond_count: occupiedBeyond,
        }],
        rowCount: 1,
      };
    }
    if (text.startsWith("INSERT INTO compute_capacity_slots")) {
      const expected = Number(values[0]);
      for (let slot = 1; slot <= expected; slot += 1) {
        const existing = this.rows.get(slot);
        if (existing === undefined) {
          this.rows.set(slot, { enabled: true, holderId: null, quarantined: false });
        } else {
          existing.enabled = !existing.quarantined;
        }
      }
      return { rows: [], rowCount: expected };
    }
    if (text.startsWith("UPDATE compute_capacity_slots SET enabled = false")) {
      const expected = Number(values[0]);
      let rowCount = 0;
      for (const [slot, row] of this.rows) {
        if (slot > expected && row.holderId === null && row.enabled) {
          row.enabled = false;
          rowCount += 1;
        }
      }
      return { rows: [], rowCount };
    }
    throw new Error(`Unexpected SQL in fixture: ${text}`);
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

interface OperatorFixture {
  directory: string;
  configPath: string;
  configRelativePath: string;
  publicKeysPath: string;
  expectedConfigSha256: string;
  expectedPublicKeyRegistrySha256: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly migrations: readonly Readonly<{ version: string; sha256: string }>[];
  readonly approval: unknown;
  approvalManifestSha256: string;
}

async function operatorFixture(operation: "apply" | "verify", capacity = 2): Promise<OperatorFixture> {
  const directory = await mkdtemp(join(tmpdir(), "3dena-capacity-operator-"));
  const migrationPath = join(directory, "0001.sql");
  const migrationBytes = "BEGIN; SELECT 1; COMMIT;\n";
  await writeFile(migrationPath, migrationBytes);
  const migrations = [{
    version: "0001-persistent-compute",
    path: "0001.sql",
    sha256: sha256(migrationBytes),
  }];
  const migrationConfigPath = join(directory, "migration-config.json");
  const migrationConfigText = JSON.stringify({
    databaseUrlEnv: "CAPACITY_OPERATOR_TEST_DATABASE_URL",
    migrations,
  });
  await writeFile(migrationConfigPath, migrationConfigText);
  const migrationManifest = migrations.map(({ version, sha256: digest }) => ({
    sha256: digest,
    version,
  }));
  const migrationManifestSha256 = sha256(JSON.stringify(migrationManifest));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyRegistry = {
    "capacity-fixture-key": {
      algorithm: "Ed25519",
      allowedEnvironments: ["preview"],
      publicKeyPem: String(publicKey.export({ type: "spki", format: "pem" })),
      reviewerId: "reviewer-fixture-1",
      role: "independent-reviewer",
    },
  };
  const publicKeyRegistryText = `${canonical(publicKeyRegistry)}\n`;
  const publicKeysPath = join(directory, "public-keys.json");
  await writeFile(publicKeysPath, publicKeyRegistryText);
  const candidate = {
    version: "3dena.build-approval-candidate.v4",
    releaseId: "capacity-operator-fixture",
    environment: "preview",
    gitCommit: "a".repeat(40),
    vercelDeploymentId: "dpl-capacity-fixture",
    vercelBuildId: "vercel-capacity-fixture",
    flyImageDigest: `sha256:${"b".repeat(64)}`,
    flyBuildId: "fly-capacity-fixture",
    analysisTarballSha256: "c".repeat(64),
    jenaVersion: "0.7.0-ona.0",
    jenaCommit: "d".repeat(40),
    jenaTarballSha256: "e".repeat(64),
    jenaTarballIntegrity: "sha512-Zml4dHVyZS10YXJiYWxs",
    sdkVersion: "0.2.0-fixture",
    buildId: "capacity-fixture-build",
    lockfileSha256: "f".repeat(64),
    sbomSha256: "1".repeat(64),
    schemaBundleSha256: "2".repeat(64),
    migrationManifestSha256,
    publicKeyRegistrySha256: sha256(publicKeyRegistryText),
    materializationManifestSha256: "3".repeat(64),
    contractVersions: ["3dena.contract.fixture.v1"],
    implementationActorIds: ["implementation-fixture-1"],
  };
  const approvalManifestSha256 = sha256(canonical(candidate));
  const unsignedApproval = {
    version: "3dena.build-approval.v4",
    candidate,
    approvalManifestSha256,
    reviewerId: "reviewer-fixture-1",
    approvedAt: "2026-08-26T00:00:00.000Z",
    publicKeyId: "capacity-fixture-key",
    signatureAlgorithm: "Ed25519",
  };
  const approval = {
    ...unsignedApproval,
    signatureBase64: sign(
      null,
      Buffer.from(canonical(unsignedApproval), "utf8"),
      privateKey,
    ).toString("base64"),
  };
  const configPath = join(directory, "capacity.json");
  const configText = JSON.stringify({
    schemaVersion: "3dena.compute-capacity-operator.v1",
    operation,
    expectedCapacity: capacity,
    migrationConfigPath: "migration-config.json",
    migrationConfigSha256: sha256(migrationConfigText),
    buildReadiness: {
      environment: "preview",
      approvalManifestSha256,
      publicKeysPath: "public-keys.json",
      publicKeysSha256: sha256(publicKeyRegistryText),
    },
  });
  await writeFile(configPath, configText);
  return {
    directory,
    configPath,
    configRelativePath: "capacity.json",
    publicKeysPath,
    expectedConfigSha256: sha256(configText),
    expectedPublicKeyRegistrySha256: sha256(publicKeyRegistryText),
    environment: { CAPACITY_OPERATOR_TEST_DATABASE_URL: DATABASE_URL },
    migrations: migrationManifest,
    approval,
    approvalManifestSha256,
  };
}

function capacityPins(fixture: OperatorFixture) {
  return {
    expectedConfigSha256: fixture.expectedConfigSha256,
    expectedApprovalManifestSha256: fixture.approvalManifestSha256,
    expectedPublicKeyRegistrySha256: fixture.expectedPublicKeyRegistrySha256,
  };
}

async function replaceCapacityConfig(
  fixture: OperatorFixture,
  value: Record<string, unknown> | string,
) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  await writeFile(fixture.configPath, text);
  fixture.expectedConfigSha256 = sha256(text);
}

async function replaceCapacityRegistry(fixture: OperatorFixture, text: string) {
  await writeFile(fixture.publicKeysPath, text);
  fixture.expectedPublicKeyRegistrySha256 = sha256(text);
  const input = JSON.parse(await readFile(fixture.configPath, "utf8")) as {
    buildReadiness: Record<string, unknown>;
  };
  input.buildReadiness.publicKeysSha256 = fixture.expectedPublicKeyRegistrySha256;
  await replaceCapacityConfig(fixture, input);
}

async function replaceCapacityMigrationConfig(fixture: OperatorFixture, text: string) {
  await writeFile(join(fixture.directory, "migration-config.json"), text);
  const input = JSON.parse(await readFile(fixture.configPath, "utf8")) as Record<string, unknown>;
  input.migrationConfigSha256 = sha256(text);
  await replaceCapacityConfig(fixture, input);
}

function loadFixture(fixture: OperatorFixture) {
  return loadCapacityOperatorInput(
    fixture.directory,
    fixture.configRelativePath,
    capacityPins(fixture),
    fixture.environment,
  );
}

function runFixture(
  fixture: OperatorFixture,
  connect: CapacityOperatorConnectorV1,
) {
  return runCapacityOperator(
    fixture.directory,
    fixture.configRelativePath,
    capacityPins(fixture),
    connect,
    fixture.environment,
  );
}

describe("persistent compute capacity operator", () => {
  it("requires portable root-relative config, migration, and registry paths", async () => {
    const fixture = await operatorFixture("verify");
    try {
      await expect(loadCapacityOperatorInput(
        fixture.directory,
        fixture.configPath,
        capacityPins(fixture),
        fixture.environment,
      )).rejects.toThrow("capacity operator input is invalid");
      await expect(loadCapacityOperatorInput(
        fixture.directory,
        "../capacity.json",
        capacityPins(fixture),
        fixture.environment,
      )).rejects.toThrow("capacity operator input is invalid");

      const original = JSON.parse(await readFile(fixture.configPath, "utf8")) as {
        migrationConfigPath: string;
        buildReadiness: Record<string, unknown>;
      };
      for (const invalidPath of [fixture.configPath, "../outside.json", "nested/../file.json", "./file.json", "C:/outside.json", "nested\\file.json"]) {
        await replaceCapacityConfig(fixture, { ...original, migrationConfigPath: invalidPath });
        await expect(loadFixture(fixture)).rejects.toThrow("capacity operator input is invalid");
        await replaceCapacityConfig(fixture, {
          ...original,
          buildReadiness: { ...original.buildReadiness, publicKeysPath: invalidPath },
        });
        await expect(loadFixture(fixture)).rejects.toThrow("capacity operator input is invalid");
      }
      await replaceCapacityConfig(fixture, original);
      const migrationConfig = JSON.parse(
        await readFile(join(fixture.directory, "migration-config.json"), "utf8"),
      ) as { migrations: Array<Record<string, unknown>> };
      migrationConfig.migrations[0]!.path = "../outside.sql";
      await replaceCapacityMigrationConfig(fixture, JSON.stringify(migrationConfig));
      await expect(loadFixture(fixture)).rejects.toThrow("migration config is invalid");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects config, migration config, migration, and registry leaf or parent symlinks", async () => {
    for (const [leaf, target] of [
      ["capacity.json", "capacity-real.json"],
      ["migration-config.json", "migration-config-real.json"],
      ["0001.sql", "0001-real.sql"],
      ["public-keys.json", "public-keys-real.json"],
    ] as const) {
      const fixture = await operatorFixture("verify");
      try {
        await rename(join(fixture.directory, leaf), join(fixture.directory, target));
        await symlink(target, join(fixture.directory, leaf));
        await expect(loadFixture(fixture)).rejects.toThrow();
      } finally {
        await rm(fixture.directory, { recursive: true, force: true });
      }
    }

    const configParent = await operatorFixture("verify");
    try {
      await mkdir(join(configParent.directory, "real"));
      await rename(configParent.configPath, join(configParent.directory, "real", "capacity.json"));
      await symlink("real", join(configParent.directory, "linked"));
      await expect(loadCapacityOperatorInput(
        configParent.directory,
        "linked/capacity.json",
        capacityPins(configParent),
        configParent.environment,
      )).rejects.toThrow("capacity operator input is invalid");
    } finally {
      await rm(configParent.directory, { recursive: true, force: true });
    }

    for (const field of ["migrationConfigPath", "publicKeysPath"] as const) {
      const fixture = await operatorFixture("verify");
      try {
        await mkdir(join(fixture.directory, "real"));
        await symlink("real", join(fixture.directory, "linked"));
        const input = JSON.parse(await readFile(fixture.configPath, "utf8")) as {
          migrationConfigPath: string;
          buildReadiness: Record<string, unknown>;
        };
        if (field === "migrationConfigPath") input.migrationConfigPath = "linked/migration-config.json";
        else input.buildReadiness.publicKeysPath = "linked/public-keys.json";
        await replaceCapacityConfig(fixture, input);
        await expect(loadFixture(fixture)).rejects.toThrow();
      } finally {
        await rm(fixture.directory, { recursive: true, force: true });
      }
    }
  });

  it("rejects config and registry replacement plus any external pin drift", async () => {
    const target = await operatorFixture("verify");
    const replacement = await operatorFixture("verify");
    try {
      await writeFile(target.configPath, await readFile(replacement.configPath));
      await writeFile(target.publicKeysPath, await readFile(replacement.publicKeysPath));
      await expect(loadFixture(target)).rejects.toThrow("capacity operator input is invalid");
      for (const field of [
        "expectedConfigSha256",
        "expectedApprovalManifestSha256",
        "expectedPublicKeyRegistrySha256",
      ] as const) {
        await expect(loadCapacityOperatorInput(
          replacement.directory,
          replacement.configRelativePath,
          { ...capacityPins(replacement), [field]: "9".repeat(64) },
          replacement.environment,
        )).rejects.toThrow();
      }
    } finally {
      await rm(target.directory, { recursive: true, force: true });
      await rm(replacement.directory, { recursive: true, force: true });
    }
  });

  it("rejects duplicate JSON keys in config, migration config, and reviewer registry", async () => {
    const fixture = await operatorFixture("verify");
    try {
      const configText = await readFile(fixture.configPath, "utf8");
      await replaceCapacityConfig(
        fixture,
        configText.replace(
          '"operation":"verify"',
          '"operation":"verify","\\u006fperation":"verify"',
        ),
      );
      await expect(loadFixture(fixture)).rejects.toThrow("capacity operator input is invalid");

      await replaceCapacityConfig(fixture, configText);
      const migrationConfigText = await readFile(
        join(fixture.directory, "migration-config.json"),
        "utf8",
      );
      await replaceCapacityMigrationConfig(
        fixture,
        migrationConfigText.replace(
          '"databaseUrlEnv":"CAPACITY_OPERATOR_TEST_DATABASE_URL"',
          '"databaseUrlEnv":"CAPACITY_OPERATOR_TEST_DATABASE_URL","\\u0064atabaseUrlEnv":"CAPACITY_OPERATOR_TEST_DATABASE_URL"',
        ),
      );
      await expect(loadFixture(fixture)).rejects.toThrow("migration config is invalid");

      await replaceCapacityMigrationConfig(fixture, migrationConfigText);
      const registryText = await readFile(fixture.publicKeysPath, "utf8");
      await replaceCapacityRegistry(
        fixture,
        registryText.replace(
          '"capacity-fixture-key":',
          '"capacity-fixture-key":{},"\\u0063apacity-fixture-key":',
        ),
      );
      await expect(loadFixture(fixture))
        .rejects.toThrow("build approval public-key registry is invalid");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("loads one strict explicit JSON input and rejects unknown fields or non-positive capacity", async () => {
    const fixture = await operatorFixture("verify");
    try {
      await expect(loadFixture(fixture))
        .resolves.toMatchObject({
          input: {
            schemaVersion: "3dena.compute-capacity-operator.v1",
            operation: "verify",
            expectedCapacity: 2,
            buildReadiness: {
              environment: "preview",
              approvalManifestSha256: fixture.approvalManifestSha256,
            },
          },
          connectionString: DATABASE_URL,
        });

      const parsed = JSON.parse(await import("node:fs/promises").then(({ readFile }) =>
        readFile(fixture.configPath, "utf8"))) as Record<string, unknown>;
      await replaceCapacityConfig(fixture, { ...parsed, databaseUrl: DATABASE_URL });
      await expect(loadFixture(fixture))
        .rejects.toThrow("capacity operator input is invalid");
      await replaceCapacityConfig(fixture, { ...parsed, expectedCapacity: 0 });
      await expect(loadFixture(fixture))
        .rejects.toThrow("capacity operator input is invalid");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("checks the exact migration and signed active build before atomically initializing rows", async () => {
    const fixture = await operatorFixture("apply", 2);
    try {
      const client = new CapacityClient({
        migrations: fixture.migrations,
        approval: fixture.approval,
      });
      let observedUrl = "";
      const connect: CapacityOperatorConnectorV1 = async (connectionString) => {
        observedUrl = connectionString;
        return client;
      };

      await expect(runFixture(fixture, connect))
        .resolves.toEqual({
          schemaVersion: "3dena.compute-capacity-operator-result.v1",
          operation: "apply",
          expectedCapacity: 2,
          verified: true,
        });
      expect(observedUrl).toBe(DATABASE_URL);
      expect([...client.rows]).toEqual([
        [1, { enabled: true, holderId: null, quarantined: false }],
        [2, { enabled: true, holderId: null, quarantined: false }],
      ]);
      expect(client.ended).toBe(true);
      const migrationIndex = client.statements.findIndex((sql) =>
        sql.startsWith("SELECT version, sha256"));
      const approvalIndex = client.statements.findIndex((sql) =>
        sql.startsWith("WITH latest_activation"));
      const insertIndex = client.statements.findIndex((sql) =>
        sql.startsWith("INSERT INTO compute_capacity_slots"));
      expect(migrationIndex).toBeGreaterThan(0);
      expect(approvalIndex).toBeGreaterThan(migrationIndex);
      expect(insertIndex).toBeGreaterThan(approvalIndex);
      expect(client.statements[0]).toContain("SERIALIZABLE");
      expect(client.statements).toContain(
        "LOCK TABLE compute_capacity_slots IN SHARE ROW EXCLUSIVE MODE",
      );
      expect(client.statements.at(-1)).toBe("COMMIT");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("fails closed before capacity mutation when migration or build readiness is absent", async () => {
    const fixture = await operatorFixture("apply", 2);
    try {
      for (const client of [
        new CapacityClient({ migrations: [], approval: fixture.approval }),
        new CapacityClient({ migrations: fixture.migrations, approval: undefined }),
      ]) {
        await expect(runFixture(fixture, async () => client)).rejects.toThrow();
        expect(client.statements.some((sql) =>
          sql.startsWith("INSERT INTO compute_capacity_slots") ||
          sql.startsWith("UPDATE compute_capacity_slots"))).toBe(false);
        expect(client.statements.at(-1)).toBe("ROLLBACK");
        expect(client.ended).toBe(true);
      }
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects reviewer/time/key/signature-envelope tampering and registry-byte drift", async () => {
    const fixture = await operatorFixture("apply", 2);
    try {
      const approval = fixture.approval as Record<string, unknown>;
      for (const changed of [
        { ...approval, reviewerId: "another-reviewer" },
        { ...approval, approvedAt: "2026-08-26T00:00:01.000Z" },
        { ...approval, publicKeyId: "another-key" },
        { ...approval, signatureBase64: Buffer.alloc(63).toString("base64") },
      ]) {
        const client = new CapacityClient({
          migrations: fixture.migrations,
          approval: changed,
        });
        await expect(runFixture(fixture, async () => client))
          .rejects.toThrow("active build approval is not ready");
        expect(client.statements.some((sql) =>
          sql.startsWith("INSERT INTO compute_capacity_slots"))).toBe(false);
      }

      await replaceCapacityRegistry(fixture, "{}\n");
      await expect(loadFixture(fixture))
        .rejects.toThrow("build approval public-key registry is invalid");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("rolls back a shrink when any slot above the explicit limit remains occupied", async () => {
    const fixture = await operatorFixture("apply", 1);
    try {
      const client = new CapacityClient({
        migrations: fixture.migrations,
        approval: fixture.approval,
        rows: [
          { slot: 1, enabled: true },
          { slot: 2, enabled: true, holderId: "worker-fixture" },
        ],
      });
      const before = structuredClone([...client.rows]);
      await expect(runFixture(fixture, async () => client))
        .rejects.toThrow("capacity rows do not match explicit configuration");
      expect([...client.rows]).toEqual(before);
      expect(client.statements.some((sql) =>
        sql.startsWith("INSERT INTO compute_capacity_slots"))).toBe(false);
      expect(client.statements.at(-1)).toBe("ROLLBACK");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("verifies exact consecutive enabled rows read-only and rejects a quarantined gap", async () => {
    const fixture = await operatorFixture("verify", 2);
    try {
      const passing = new CapacityClient({
        migrations: fixture.migrations,
        approval: fixture.approval,
        rows: [
          { slot: 1, enabled: true },
          { slot: 2, enabled: true },
          { slot: 3, enabled: false },
        ],
      });
      await expect(runFixture(fixture, async () => passing))
        .resolves.toMatchObject({ operation: "verify", verified: true });
      expect(passing.statements[0]).toContain("READ ONLY");
      expect(passing.statements.some((sql) =>
        sql.startsWith("INSERT INTO") || sql.startsWith("UPDATE "))).toBe(false);

      const quarantined = new CapacityClient({
        migrations: fixture.migrations,
        approval: fixture.approval,
        rows: [
          { slot: 1, enabled: true },
          { slot: 2, enabled: false, quarantined: true },
        ],
      });
      await expect(runFixture(fixture, async () => quarantined))
        .rejects.toThrow("capacity rows do not match explicit configuration");
      expect(quarantined.statements.at(-1)).toBe("ROLLBACK");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("emits only a bounded secret-free failure code when connection errors contain credentials", async () => {
    const fixture = await operatorFixture("verify", 2);
    try {
      let stdout = "";
      let stderr = "";
      const exitCode = await runCapacityOperatorCli(
        fixture.directory,
        fixture.configRelativePath,
        capacityPins(fixture),
        {
        environment: fixture.environment,
        connect: async () => {
          throw new Error(`provider failure for ${DATABASE_URL}`);
        },
        writeStdout: (value) => { stdout += value; },
        writeStderr: (value) => { stderr += value; },
        },
      );
      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toBe("COMPUTE_CAPACITY_OPERATOR_FAILED\n");
      expect(`${stdout}${stderr}`).not.toContain("fixture-password-never-real");
      expect(`${stdout}${stderr}`).not.toContain("postgresql://");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });
});
