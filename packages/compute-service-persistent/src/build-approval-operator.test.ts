import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadBuildApprovalOperatorInput,
  operatorReadSnapshotIsStable,
  runBuildApprovalOperator,
  runBuildApprovalOperatorCli,
  verifyBuildApprovalBundle,
  verifyIndependentReviewerSignature,
  type BuildApprovalOperatorClientV1,
  type BuildApprovalOperatorConnectorV1,
} from "../deploy/build-approval-operator.mjs";
import { MIGRATION_ADVISORY_LOCK_KEY } from "../deploy/migrate.mjs";

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

interface ApprovalEvent {
  id: number;
  manifest: string;
  environment: "preview" | "production";
  type: "activated" | "revoked";
  actor: string;
  occurredAt: string;
}

class ApprovalOperatorClient implements BuildApprovalOperatorClientV1 {
  readonly statements: string[] = [];
  readonly parameters: unknown[][] = [];
  readonly approvals = new Map<string, unknown>();
  readonly events: ApprovalEvent[] = [];
  readonly migrationRows: readonly Readonly<{ version: string; sha256: string }>[];
  ended = false;
  #snapshot: { approvals: Map<string, unknown>; events: ApprovalEvent[] } | null = null;
  #transientFailures: number;
  readonly #transientCode: "40001" | "40P01" | "23505";

  constructor(input: Readonly<{
    migrations: readonly Readonly<{ version: string; sha256: string }>[];
    approvals?: readonly Readonly<{ manifest: string; approval: unknown }>[];
    events?: readonly ApprovalEvent[];
    transientFailures?: number;
    transientCode?: "40001" | "40P01" | "23505";
  }>) {
    this.migrationRows = structuredClone(input.migrations);
    for (const entry of input.approvals ?? []) {
      this.approvals.set(entry.manifest, structuredClone(entry.approval));
    }
    this.events.push(...structuredClone(input.events ?? []));
    this.#transientFailures = input.transientFailures ?? 0;
    this.#transientCode = input.transientCode ?? "40001";
  }

  async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[]; readonly rowCount: number }> {
    this.statements.push(text);
    this.parameters.push([...values]);
    if (text.startsWith("BEGIN TRANSACTION")) {
      this.#snapshot = {
        approvals: structuredClone(this.approvals),
        events: structuredClone(this.events),
      };
      return { rows: [], rowCount: 0 };
    }
    if (text === "COMMIT") {
      this.#snapshot = null;
      return { rows: [], rowCount: 0 };
    }
    if (text === "ROLLBACK") {
      if (this.#snapshot !== null) {
        this.approvals.clear();
        for (const [manifest, approval] of this.#snapshot.approvals) {
          this.approvals.set(manifest, approval);
        }
        this.events.splice(0, this.events.length, ...this.#snapshot.events);
      }
      this.#snapshot = null;
      return { rows: [], rowCount: 0 };
    }
    if (text.startsWith("SELECT pg_advisory_xact_lock")) {
      if (this.#transientFailures > 0) {
        this.#transientFailures -= 1;
        throw Object.assign(new Error("retryable transaction fixture"), {
          code: this.#transientCode,
        });
      }
      return { rows: [{ pg_advisory_xact_lock: null }], rowCount: 1 };
    }
    if (text.startsWith("LOCK TABLE")) return { rows: [], rowCount: 0 };
    if (text.startsWith("SELECT version, sha256 FROM compute_schema_migrations")) {
      return { rows: structuredClone(this.migrationRows), rowCount: this.migrationRows.length };
    }
    if (text.startsWith("INSERT INTO compute_build_approvals")) {
      const manifest = String(values[0]);
      if (this.approvals.has(manifest)) return { rows: [], rowCount: 0 };
      this.approvals.set(manifest, JSON.parse(String(values[10])) as unknown);
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("SELECT approval FROM compute_build_approvals")) {
      const approval = this.approvals.get(String(values[0]));
      return approval === undefined
        ? { rows: [], rowCount: 0 }
        : { rows: [{ approval: structuredClone(approval) }], rowCount: 1 };
    }
    if (text.startsWith("INSERT INTO compute_build_approval_events")) {
      const candidate: ApprovalEvent = {
        id: this.events.reduce((maximum, event) => Math.max(maximum, event.id), 0) + 1,
        manifest: String(values[0]),
        environment: String(values[1]) as ApprovalEvent["environment"],
        type: "activated",
        actor: String(values[2]),
        occurredAt: String(values[3]),
      };
      if (this.events.some((event) => event.manifest === candidate.manifest &&
          event.type === candidate.type && event.actor === candidate.actor &&
          event.occurredAt === candidate.occurredAt)) {
        return { rows: [], rowCount: 0 };
      }
      this.events.push(candidate);
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("SELECT approval_manifest_sha256, environment, event_type")) {
      const event = this.events.find((entry) => entry.manifest === values[0] &&
        entry.environment === values[1] && entry.type === "activated" &&
        entry.actor === values[2] && entry.occurredAt === values[3]);
      return event === undefined
        ? { rows: [], rowCount: 0 }
        : { rows: [{
          approval_manifest_sha256: event.manifest,
          environment: event.environment,
          event_type: event.type,
          actor_id: event.actor,
          occurred_at_matches: true,
        }], rowCount: 1 };
    }
    if (text.startsWith("WITH latest_activation")) {
      const [manifest, environment, actor, occurredAt] = values.map(String);
      const active = this.events
        .filter((event) => event.environment === environment && event.type === "activated")
        .sort((left, right) => right.id - left.id)[0];
      const revoked = active === undefined ? false : this.events.some((event) =>
        event.manifest === active.manifest && event.type === "revoked" && event.id > active.id);
      const approval = active !== undefined && !revoked && active.manifest === manifest &&
        active.actor === actor && active.occurredAt === occurredAt
        ? this.approvals.get(active.manifest)
        : undefined;
      return approval === undefined
        ? { rows: [], rowCount: 0 }
        : { rows: [{ approval: structuredClone(approval) }], rowCount: 1 };
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
  signedApprovalPath: string;
  publicKeysPath: string;
  expectedConfigSha256: string;
  expectedSignedApprovalSha256: string;
  expectedPublicKeyRegistrySha256: string;
  environment: NodeJS.ProcessEnv;
  migrations: readonly Readonly<{ version: string; sha256: string }>[];
  approval: Record<string, unknown>;
  manifest: string;
}

function approvalEnvelope(approval: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { signatureBase64: _signatureBase64, ...envelope } = approval;
  return envelope;
}

async function operatorFixture(
  operation: "activate" | "verify",
  options: Readonly<{
    reviewerIsImplementation?: boolean;
    keyType?: "ed25519" | "rsa";
    registryReviewerId?: string;
    registryAllowedEnvironments?: readonly ("preview" | "production")[];
    includeSecondKey?: boolean;
  }> = {},
): Promise<OperatorFixture> {
  const directory = await mkdtemp(join(tmpdir(), "3dena-build-approval-operator-"));
  const migrationBytes = "BEGIN; SELECT 1; COMMIT;\n";
  await writeFile(join(directory, "0001.sql"), migrationBytes);
  const configuredMigrations = [{
    version: "0001-persistent-compute",
    path: "0001.sql",
    sha256: sha256(migrationBytes),
  }];
  const migrationConfigText = JSON.stringify({
    databaseUrlEnv: "BUILD_APPROVAL_OPERATOR_TEST_DATABASE_URL",
    migrations: configuredMigrations,
  });
  await writeFile(join(directory, "migration.json"), migrationConfigText);
  const migrations = configuredMigrations.map(({ version, sha256: digest }) => ({
    sha256: digest,
    version,
  }));
  const { privateKey, publicKey } = options.keyType === "rsa"
    ? generateKeyPairSync("rsa", { modulusLength: 2048 })
    : generateKeyPairSync("ed25519");
  const registryEntry = {
    algorithm: "Ed25519",
    allowedEnvironments: options.registryAllowedEnvironments ?? ["preview"],
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
    reviewerId: options.registryReviewerId ?? "reviewer-fixture-1",
    role: "independent-reviewer",
  };
  const publicKeyRegistry: Record<string, typeof registryEntry> = {
    "approval-fixture-key": registryEntry,
  };
  if (options.includeSecondKey) {
    publicKeyRegistry["approval-fixture-key-2"] = structuredClone(registryEntry);
  }
  const publicKeyRegistryText = `${canonical(publicKeyRegistry)}\n`;
  const candidate = {
    version: "3dena.build-approval-candidate.v4",
    releaseId: "approval-operator-fixture",
    environment: "preview",
    gitCommit: "a".repeat(40),
    vercelDeploymentId: "dpl-approval-fixture",
    vercelBuildId: "vercel-approval-fixture",
    flyImageDigest: `sha256:${"b".repeat(64)}`,
    flyBuildId: "fly-approval-fixture",
    analysisTarballSha256: "c".repeat(64),
    jenaVersion: "0.7.0-ona.0",
    jenaCommit: "d".repeat(40),
    jenaTarballSha256: "e".repeat(64),
    jenaTarballIntegrity: "sha512-Zml4dHVyZS10YXJiYWxs",
    sdkVersion: "0.2.0-fixture",
    buildId: "approval-fixture-build",
    lockfileSha256: "f".repeat(64),
    sbomSha256: "1".repeat(64),
    schemaBundleSha256: "2".repeat(64),
    migrationManifestSha256: sha256(JSON.stringify(migrations)),
    publicKeyRegistrySha256: sha256(publicKeyRegistryText),
    materializationManifestSha256: "4".repeat(64),
    contractVersions: ["3dena.contract.fixture.v1"],
    implementationActorIds: options.reviewerIsImplementation
      ? ["reviewer-fixture-1"]
      : ["implementation-fixture-1"],
  };
  const manifest = sha256(canonical(candidate));
  const unsignedApproval = {
    version: "3dena.build-approval.v4",
    candidate,
    approvalManifestSha256: manifest,
    reviewerId: "reviewer-fixture-1",
    approvedAt: "2026-08-26T00:00:00.000Z",
    publicKeyId: "approval-fixture-key",
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
  const signedApprovalPath = join(directory, "signed-approval.json");
  const signedApprovalText = JSON.stringify(approval);
  await writeFile(signedApprovalPath, signedApprovalText);
  const publicKeysPath = join(directory, "public-keys.json");
  await writeFile(publicKeysPath, publicKeyRegistryText);
  const configPath = join(directory, "operator.json");
  const configText = JSON.stringify({
    schemaVersion: "3dena.build-approval-operator.v1",
    operation,
    environment: "preview",
    migrationConfigPath: "migration.json",
    migrationConfigSha256: sha256(migrationConfigText),
    signedApprovalPath: "signed-approval.json",
    signedApprovalSha256: sha256(signedApprovalText),
    publicKeysPath: "public-keys.json",
    publicKeysSha256: sha256(publicKeyRegistryText),
  });
  await writeFile(configPath, configText);
  return {
    directory,
    configPath,
    configRelativePath: "operator.json",
    signedApprovalPath,
    publicKeysPath,
    expectedConfigSha256: sha256(configText),
    expectedSignedApprovalSha256: sha256(signedApprovalText),
    expectedPublicKeyRegistrySha256: sha256(publicKeyRegistryText),
    environment: { BUILD_APPROVAL_OPERATOR_TEST_DATABASE_URL: DATABASE_URL },
    migrations,
    approval,
    manifest,
  };
}

function operatorPins(fixture: OperatorFixture) {
  return {
    expectedConfigSha256: fixture.expectedConfigSha256,
    expectedSignedApprovalSha256: fixture.expectedSignedApprovalSha256,
    expectedPublicKeyRegistrySha256: fixture.expectedPublicKeyRegistrySha256,
  };
}

async function replaceFixtureConfig(
  fixture: OperatorFixture,
  value: Record<string, unknown> | string,
) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  await writeFile(fixture.configPath, text);
  fixture.expectedConfigSha256 = sha256(text);
}

async function replaceFixtureApproval(fixture: OperatorFixture, text: string) {
  await writeFile(fixture.signedApprovalPath, text);
  fixture.expectedSignedApprovalSha256 = sha256(text);
  const input = JSON.parse(await readFile(fixture.configPath, "utf8")) as Record<string, unknown>;
  input.signedApprovalSha256 = fixture.expectedSignedApprovalSha256;
  await replaceFixtureConfig(fixture, input);
}

async function replaceFixtureRegistry(fixture: OperatorFixture, text: string) {
  await writeFile(fixture.publicKeysPath, text);
  fixture.expectedPublicKeyRegistrySha256 = sha256(text);
  const input = JSON.parse(await readFile(fixture.configPath, "utf8")) as Record<string, unknown>;
  input.publicKeysSha256 = fixture.expectedPublicKeyRegistrySha256;
  await replaceFixtureConfig(fixture, input);
}

async function replaceFixtureMigrationConfig(fixture: OperatorFixture, text: string) {
  await writeFile(join(fixture.directory, "migration.json"), text);
  const input = JSON.parse(await readFile(fixture.configPath, "utf8")) as Record<string, unknown>;
  input.migrationConfigSha256 = sha256(text);
  await replaceFixtureConfig(fixture, input);
}

function loadFixture(fixture: OperatorFixture) {
  return loadBuildApprovalOperatorInput(
    fixture.directory,
    fixture.configRelativePath,
    operatorPins(fixture),
    fixture.environment,
  );
}

function runFixture(
  fixture: OperatorFixture,
  connect: BuildApprovalOperatorConnectorV1,
) {
  return runBuildApprovalOperator(
    fixture.directory,
    fixture.configRelativePath,
    operatorPins(fixture),
    connect,
    fixture.environment,
  );
}

describe("signed BuildApproval activation and verification operator", () => {
  it("requires an externally pinned portable config path and portable root-relative input paths", async () => {
    const fixture = await operatorFixture("verify");
    try {
      await expect(loadBuildApprovalOperatorInput(
        fixture.directory,
        fixture.configPath,
        operatorPins(fixture),
        fixture.environment,
      )).rejects.toThrow("build approval operator input is invalid");
      await expect(loadBuildApprovalOperatorInput(
        fixture.directory,
        "../operator.json",
        operatorPins(fixture),
        fixture.environment,
      )).rejects.toThrow("build approval operator input is invalid");

      const original = JSON.parse(await readFile(fixture.configPath, "utf8")) as Record<string, unknown>;
      for (const field of ["migrationConfigPath", "signedApprovalPath", "publicKeysPath"] as const) {
        for (const invalidPath of [fixture.configPath, "../outside.json", "nested/../file.json", "./file.json", "C:/outside.json", "nested\\file.json"]) {
          await replaceFixtureConfig(fixture, { ...original, [field]: invalidPath });
          await expect(loadFixture(fixture))
            .rejects.toThrow("build approval operator input is invalid");
        }
      }
      await replaceFixtureConfig(fixture, original);

      const migrationConfig = JSON.parse(
        await readFile(join(fixture.directory, "migration.json"), "utf8"),
      ) as { migrations: Array<Record<string, unknown>> };
      for (const invalidPath of [fixture.configPath, "../outside.sql", "nested/../file.sql", "./file.sql", "C:/outside.sql", "nested\\file.sql"]) {
        migrationConfig.migrations[0]!.path = invalidPath;
        await replaceFixtureMigrationConfig(fixture, JSON.stringify(migrationConfig));
        await expect(loadFixture(fixture)).rejects.toThrow("migration config is invalid");
      }
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects leaf and parent symlinks for config, migration config, migration, approval, and registry", async () => {
    const leafCases = [
      ["operator.json", "operator-real.json"],
      ["migration.json", "migration-real.json"],
      ["0001.sql", "0001-real.sql"],
      ["signed-approval.json", "signed-approval-real.json"],
      ["public-keys.json", "public-keys-real.json"],
    ] as const;
    for (const [leaf, target] of leafCases) {
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
      await rename(
        configParent.configPath,
        join(configParent.directory, "real", configParent.configRelativePath),
      );
      await symlink("real", join(configParent.directory, "linked"));
      await expect(loadBuildApprovalOperatorInput(
        configParent.directory,
        `linked/${configParent.configRelativePath}`,
        operatorPins(configParent),
        configParent.environment,
      )).rejects.toThrow("build approval operator input is invalid");
    } finally {
      await rm(configParent.directory, { recursive: true, force: true });
    }

    const parentCases = ["migrationConfigPath", "signedApprovalPath", "publicKeysPath"] as const;
    for (const field of parentCases) {
      const fixture = await operatorFixture("verify");
      try {
        await mkdir(join(fixture.directory, "real"));
        await symlink("real", join(fixture.directory, "linked"));
        const input = JSON.parse(await readFile(fixture.configPath, "utf8")) as Record<string, unknown>;
        input[field] = `linked/${String(input[field])}`;
        await replaceFixtureConfig(fixture, input);
        await expect(loadFixture(fixture)).rejects.toThrow();
      } finally {
        await rm(fixture.directory, { recursive: true, force: true });
      }
    }


    const migrationParent = await operatorFixture("verify");
    try {
      await mkdir(join(migrationParent.directory, "real"));
      await symlink("real", join(migrationParent.directory, "linked"));
      const migrationConfig = JSON.parse(
        await readFile(join(migrationParent.directory, "migration.json"), "utf8"),
      ) as { migrations: Array<Record<string, unknown>> };
      migrationConfig.migrations[0]!.path = "linked/0001.sql";
      await replaceFixtureMigrationConfig(migrationParent, JSON.stringify(migrationConfig));
      await expect(loadFixture(migrationParent)).rejects.toThrow("migration config is invalid");
    } finally {
      await rm(migrationParent.directory, { recursive: true, force: true });
    }
  });

  it("requires all three external SHA-256 pins and independently checks their bytes", async () => {
    const fixture = await operatorFixture("verify");
    try {
      for (const field of [
        "expectedConfigSha256",
        "expectedSignedApprovalSha256",
        "expectedPublicKeyRegistrySha256",
      ] as const) {
        await expect(loadBuildApprovalOperatorInput(
          fixture.directory,
          fixture.configRelativePath,
          { ...operatorPins(fixture), [field]: "9".repeat(64) },
          fixture.environment,
        )).rejects.toThrow();
      }
      await expect(loadBuildApprovalOperatorInput(
        fixture.directory,
        fixture.configRelativePath,
        {
          expectedConfigSha256: fixture.expectedConfigSha256,
          expectedSignedApprovalSha256: fixture.expectedSignedApprovalSha256,
        } as ReturnType<typeof operatorPins>,
        fixture.environment,
      )).rejects.toThrow("build approval operator input is invalid");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("bounds operator, migration config, migration, approval, and registry input bytes", async () => {
    const config = await operatorFixture("verify");
    try {
      await replaceFixtureConfig(config, `${await readFile(config.configPath, "utf8")}${" ".repeat(17 * 1024)}`);
      await expect(loadFixture(config)).rejects.toThrow("build approval operator input is invalid");
    } finally {
      await rm(config.directory, { recursive: true, force: true });
    }

    const migration = await operatorFixture("verify");
    try {
      await writeFile(join(migration.directory, "0001.sql"), "x".repeat(1024 * 1024 + 1));
      await expect(loadFixture(migration)).rejects.toThrow("migration config is invalid");
    } finally {
      await rm(migration.directory, { recursive: true, force: true });
    }

    const migrationConfig = await operatorFixture("verify");
    try {
      await replaceFixtureMigrationConfig(
        migrationConfig,
        `${await readFile(join(migrationConfig.directory, "migration.json"), "utf8")}${" ".repeat(65 * 1024)}`,
      );
      await expect(loadFixture(migrationConfig)).rejects.toThrow("migration config is invalid");
    } finally {
      await rm(migrationConfig.directory, { recursive: true, force: true });
    }
  });

  it("rejects a matching config, signed approval, and registry replacement against external pins", async () => {
    const target = await operatorFixture("verify");
    const replacement = await operatorFixture("verify");
    try {
      await writeFile(target.configPath, await readFile(replacement.configPath));
      await writeFile(target.signedApprovalPath, await readFile(replacement.signedApprovalPath));
      await writeFile(target.publicKeysPath, await readFile(replacement.publicKeysPath));
      await expect(loadFixture(target))
        .rejects.toThrow("build approval operator input is invalid");
    } finally {
      await rm(target.directory, { recursive: true, force: true });
      await rm(replacement.directory, { recursive: true, force: true });
    }
  });

  it("deterministically rejects append, truncate, and inode-swap read snapshots", () => {
    const stable = {
      dev: 1n,
      ino: 2n,
      size: 32n,
      mtimeNs: 3n,
      ctimeNs: 4n,
    };
    expect(operatorReadSnapshotIsStable(stable, stable, stable, 32)).toBe(true);
    expect(operatorReadSnapshotIsStable(stable, { ...stable, size: 33n }, stable, 32)).toBe(false);
    expect(operatorReadSnapshotIsStable(stable, { ...stable, size: 31n }, stable, 31)).toBe(false);
    expect(operatorReadSnapshotIsStable(stable, stable, { ...stable, ino: 99n }, 32)).toBe(false);
  });

  it("accepts only strict explicit JSON without private-key, signature, URL, or secret parameters", async () => {
    const fixture = await operatorFixture("verify");
    try {
      await expect(loadFixture(fixture))
        .resolves.toMatchObject({
          input: { operation: "verify", environment: "preview" },
          approval: { approvalManifestSha256: fixture.manifest },
          connectionString: DATABASE_URL,
        });
      const input = JSON.parse(await readFile(fixture.configPath, "utf8")) as Record<string, unknown>;
      for (const forbidden of ["privateKeyPath", "signatureBase64", "databaseUrl", "token"]) {
        await replaceFixtureConfig(fixture, { ...input, [forbidden]: "forbidden" });
        await expect(loadFixture(fixture))
          .rejects.toThrow("build approval operator input is invalid");
      }
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("purely verifies bounded signed-approval and registry bytes without DB configuration", async () => {
    const fixture = await operatorFixture("verify");
    try {
      const expectedRegistrySha256 = String(
        (fixture.approval.candidate as Record<string, unknown>).publicKeyRegistrySha256,
      );
      const approvalBytes = await readFile(fixture.signedApprovalPath);
      const registryBytes = await readFile(fixture.publicKeysPath);
      const result = verifyBuildApprovalBundle(
        approvalBytes,
        registryBytes,
        expectedRegistrySha256,
      );
      expect(result).toMatchObject({
        schemaVersion: "3dena.build-approval-verification.v1",
        approval: { approvalManifestSha256: fixture.manifest },
        publicKeyRegistry: {
          sha256: expectedRegistrySha256,
          publicKeyId: "approval-fixture-key",
          reviewerId: "reviewer-fixture-1",
          role: "independent-reviewer",
          algorithm: "Ed25519",
          allowedEnvironments: ["preview"],
        },
        verified: true,
      });
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.approval)).toBe(true);
      expect(Object.isFrozen(result.approval.candidate)).toBe(true);
      expect(Object.isFrozen(result.publicKeyRegistry)).toBe(true);
      expect(Object.isFrozen(result.publicKeyRegistry.allowedEnvironments)).toBe(true);

      expect(() => verifyBuildApprovalBundle(
        approvalBytes,
        registryBytes,
        "9".repeat(64),
      )).toThrow("signed build approval is invalid");
      expect(() => verifyBuildApprovalBundle(
        Buffer.alloc(64 * 1024 + 1),
        registryBytes,
        expectedRegistrySha256,
      )).toThrow("signed build approval is invalid");
      expect(() => verifyBuildApprovalBundle(
        approvalBytes,
        Buffer.alloc(128 * 1024 + 1),
        expectedRegistrySha256,
      )).toThrow("build approval public-key registry is invalid");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("purely verifies a canonical payload with independent-reviewer authorization", async () => {
    const fixture = await operatorFixture("verify");
    try {
      const candidate = fixture.approval.candidate as Record<string, unknown>;
      const payloadBytes = Buffer.from(
        canonical(approvalEnvelope(fixture.approval)),
        "utf8",
      );
      const registryBytes = await readFile(fixture.publicKeysPath);
      const result = verifyIndependentReviewerSignature({
        canonicalPayloadBytes: payloadBytes,
        signatureBase64: String(fixture.approval.signatureBase64),
        publicKeyId: String(fixture.approval.publicKeyId),
        reviewerId: String(fixture.approval.reviewerId),
        environment: "preview",
        implementationActorIds: candidate.implementationActorIds as string[],
        publicKeyRegistryBytes: registryBytes,
        expectedPublicKeyRegistrySha256: String(candidate.publicKeyRegistrySha256),
      });
      expect(result).toEqual({
        schemaVersion: "3dena.independent-reviewer-signature-verification.v1",
        environment: "preview",
        reviewerId: "reviewer-fixture-1",
        publicKeyRegistry: {
          sha256: candidate.publicKeyRegistrySha256,
          publicKeyId: "approval-fixture-key",
          algorithm: "Ed25519",
          allowedEnvironments: ["preview"],
          reviewerId: "reviewer-fixture-1",
          role: "independent-reviewer",
        },
        verified: true,
      });
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.publicKeyRegistry)).toBe(true);
      expect(Object.isFrozen(result.publicKeyRegistry.allowedEnvironments)).toBe(true);
      expect(canonical(result)).not.toMatch(/BEGIN PUBLIC KEY|signatureBase64/iu);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects non-canonical payloads, tampering, and reviewer authorization drift", async () => {
    const fixture = await operatorFixture("verify");
    try {
      const envelope = approvalEnvelope(fixture.approval);
      const payloadBytes = Buffer.from(canonical(envelope), "utf8");
      const registryBytes = await readFile(fixture.publicKeysPath);
      const candidate = fixture.approval.candidate as Record<string, unknown>;
      const valid = {
        canonicalPayloadBytes: payloadBytes,
        signatureBase64: String(fixture.approval.signatureBase64),
        publicKeyId: String(fixture.approval.publicKeyId),
        reviewerId: String(fixture.approval.reviewerId),
        environment: "preview" as const,
        implementationActorIds: candidate.implementationActorIds as string[],
        publicKeyRegistryBytes: registryBytes,
        expectedPublicKeyRegistrySha256: String(candidate.publicKeyRegistrySha256),
      };
      const invalidInputs = [
        {
          ...valid,
          canonicalPayloadBytes: Buffer.from(`${canonical(envelope)}\n`, "utf8"),
        },
        {
          ...valid,
          canonicalPayloadBytes: Buffer.from(canonical({
            ...envelope,
            approvedAt: "2026-08-26T00:00:01.000Z",
          }), "utf8"),
        },
        {
          ...valid,
          signatureBase64: valid.signatureBase64.replace(/==$/u, ""),
        },
        {
          ...valid,
          reviewerId: "other-independent-reviewer",
        },
        {
          ...valid,
          environment: "production" as const,
        },
        {
          ...valid,
          implementationActorIds: ["reviewer-fixture-1"],
        },
        {
          ...valid,
          expectedPublicKeyRegistrySha256: "9".repeat(64),
        },
      ];
      for (const invalid of invalidInputs) {
        expect(() => verifyIndependentReviewerSignature(invalid))
          .toThrow("independent reviewer signature is invalid");
      }
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects escape-equivalent duplicate keys in operator, approval, and registry JSON", async () => {
    const fixture = await operatorFixture("verify");
    try {
      const inputText = await readFile(fixture.configPath, "utf8");
      await replaceFixtureConfig(
        fixture,
        inputText.replace(
          '"operation":"verify"',
          '"operation":"verify","\\u006fperation":"verify"',
        ),
      );
      await expect(loadFixture(fixture))
        .rejects.toThrow("build approval operator input is invalid");

      await replaceFixtureConfig(fixture, inputText);
      const migrationConfigText = await readFile(
        join(fixture.directory, "migration.json"),
        "utf8",
      );
      await replaceFixtureMigrationConfig(
        fixture,
        migrationConfigText.replace(
          '"databaseUrlEnv":"BUILD_APPROVAL_OPERATOR_TEST_DATABASE_URL"',
          '"databaseUrlEnv":"BUILD_APPROVAL_OPERATOR_TEST_DATABASE_URL","\\u0064atabaseUrlEnv":"BUILD_APPROVAL_OPERATOR_TEST_DATABASE_URL"',
        ),
      );
      await expect(loadFixture(fixture)).rejects.toThrow("migration config is invalid");

      await replaceFixtureMigrationConfig(fixture, migrationConfigText);
      const approvalText = await readFile(fixture.signedApprovalPath, "utf8");
      await replaceFixtureApproval(
        fixture,
        approvalText.replace(
          '"reviewerId":"reviewer-fixture-1"',
          '"reviewerId":"reviewer-fixture-1","\\u0072eviewerId":"reviewer-fixture-1"',
        ),
      );
      await expect(loadFixture(fixture))
        .rejects.toThrow("signed build approval is invalid");

      await replaceFixtureApproval(fixture, approvalText);
      const registryText = await readFile(fixture.publicKeysPath, "utf8");
      await replaceFixtureRegistry(
        fixture,
        registryText.replace(
          '"approval-fixture-key":',
          '"approval-fixture-key":{},"\\u0061pproval-fixture-key":',
        ),
      );
      await expect(loadFixture(fixture))
        .rejects.toThrow("build approval public-key registry is invalid");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("activates only after exact migrations and canonical signed approval validation, then reads both rows back", async () => {
    const fixture = await operatorFixture("activate");
    try {
      const client = new ApprovalOperatorClient({ migrations: fixture.migrations });
      const connect: BuildApprovalOperatorConnectorV1 = async () => client;
      await expect(runFixture(fixture, connect))
        .resolves.toEqual({
          schemaVersion: "3dena.build-approval-operator-result.v1",
          operation: "activate",
          environment: "preview",
          approvalManifestSha256: fixture.manifest,
          verified: true,
        });
      expect(canonical(client.approvals.get(fixture.manifest))).toBe(canonical(fixture.approval));
      expect(client.events).toEqual([expect.objectContaining({
        manifest: fixture.manifest,
        environment: "preview",
        type: "activated",
        actor: "reviewer-fixture-1",
      })]);
      const migration = client.statements.findIndex((sql) => sql.startsWith("SELECT version"));
      const approvalInsert = client.statements.findIndex((sql) =>
        sql.startsWith("INSERT INTO compute_build_approvals"));
      const eventInsert = client.statements.findIndex((sql) =>
        sql.startsWith("INSERT INTO compute_build_approval_events"));
      expect(client.statements[0]).toContain("SERIALIZABLE");
      expect(client.statements[1]).toContain("pg_advisory_xact_lock");
      expect(client.parameters[1]).toEqual([MIGRATION_ADVISORY_LOCK_KEY]);
      expect(client.statements.findIndex((sql) => sql.startsWith("LOCK TABLE")))
        .toBeGreaterThan(1);
      expect(approvalInsert).toBeGreaterThan(migration);
      expect(eventInsert).toBeGreaterThan(approvalInsert);
      expect(client.statements.some((sql) => sql.startsWith("WITH latest_activation")))
        .toBe(true);
      expect(client.statements.at(-1)).toBe("COMMIT");
      expect(client.ended).toBe(true);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects an invalid signature or reviewer segregation before connecting", async () => {
    for (const reviewerIsImplementation of [false, true]) {
      const fixture = await operatorFixture("activate", { reviewerIsImplementation });
      try {
        if (!reviewerIsImplementation) {
          const approval = JSON.parse(await readFile(fixture.signedApprovalPath, "utf8")) as Record<string, unknown>;
          await replaceFixtureApproval(fixture, JSON.stringify({
            ...approval,
            signatureBase64: Buffer.from("invalid-signature-fixture").toString("base64"),
          }));
        }
        let connects = 0;
        await expect(runFixture(
          fixture,
          async () => {
            connects += 1;
            return new ApprovalOperatorClient({ migrations: fixture.migrations });
          },
        )).rejects.toThrow("signed build approval is invalid");
        expect(connects).toBe(0);
      } finally {
        await rm(fixture.directory, { recursive: true, force: true });
      }
    }
  });

  it("binds the canonical approval envelope and reviewer registry authorization", async () => {
    for (const field of ["reviewerId", "approvedAt"] as const) {
      const fixture = await operatorFixture("verify");
      try {
        const approval = JSON.parse(
          await readFile(fixture.signedApprovalPath, "utf8"),
        ) as Record<string, unknown>;
        approval[field] = field === "reviewerId"
          ? "other-independent-reviewer"
          : "2026-08-26T00:00:01.000Z";
        await replaceFixtureApproval(fixture, JSON.stringify(approval));
        await expect(loadFixture(fixture))
          .rejects.toThrow("signed build approval is invalid");
      } finally {
        await rm(fixture.directory, { recursive: true, force: true });
      }
    }

    const fixture = await operatorFixture("verify", {
      registryReviewerId: "other-independent-reviewer",
    });
    try {
      await expect(loadFixture(fixture))
        .rejects.toThrow("signed build approval is invalid");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }

    const publicKeyId = await operatorFixture("verify", { includeSecondKey: true });
    try {
      const approval = JSON.parse(
        await readFile(publicKeyId.signedApprovalPath, "utf8"),
      ) as Record<string, unknown>;
      approval.publicKeyId = "approval-fixture-key-2";
      await replaceFixtureApproval(publicKeyId, JSON.stringify(approval));
      await expect(loadFixture(publicKeyId))
        .rejects.toThrow("signed build approval is invalid");
    } finally {
      await rm(publicKeyId.directory, { recursive: true, force: true });
    }

    const environment = await operatorFixture("verify", {
      registryAllowedEnvironments: ["production"],
    });
    try {
      await expect(loadFixture(environment))
        .rejects.toThrow("signed build approval is invalid");
    } finally {
      await rm(environment.directory, { recursive: true, force: true });
    }
  });

  it("binds the signed V4 candidate to the exact public-key registry bytes", async () => {
    const fixture = await operatorFixture("verify");
    try {
      const registry = JSON.parse(
        await readFile(fixture.publicKeysPath, "utf8"),
      ) as Record<string, unknown>;
      registry["approval-fixture-key-2"] = structuredClone(
        registry["approval-fixture-key"],
      );
      await replaceFixtureRegistry(fixture, `${canonical(registry)}\n`);
      await expect(loadFixture(fixture))
        .rejects.toThrow("signed build approval is invalid");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("requires an actual Ed25519 key and canonical 64-byte base64 signature", async () => {
    const nonCanonical = await operatorFixture("verify");
    try {
      const approval = JSON.parse(
        await readFile(nonCanonical.signedApprovalPath, "utf8"),
      ) as Record<string, unknown>;
      approval.signatureBase64 = String(approval.signatureBase64).replace(/==$/u, "");
      await replaceFixtureApproval(nonCanonical, JSON.stringify(approval));
      await expect(loadFixture(nonCanonical))
        .rejects.toThrow("signed build approval is invalid");
    } finally {
      await rm(nonCanonical.directory, { recursive: true, force: true });
    }

    const rsa = await operatorFixture("verify", { keyType: "rsa" });
    try {
      await expect(loadFixture(rsa))
        .rejects.toThrow("build approval public-key registry is invalid");
    } finally {
      await rm(rsa.directory, { recursive: true, force: true });
    }

    const nonCanonicalRegistry = await operatorFixture("verify");
    try {
      const registry = JSON.parse(
        await readFile(nonCanonicalRegistry.publicKeysPath, "utf8"),
      ) as Record<string, unknown>;
      await replaceFixtureRegistry(nonCanonicalRegistry, JSON.stringify(registry, null, 2));
      await expect(loadFixture(nonCanonicalRegistry))
        .rejects.toThrow("build approval public-key registry is invalid");
    } finally {
      await rm(nonCanonicalRegistry.directory, { recursive: true, force: true });
    }
  });

  it("rolls back without approval writes when the migration registry is not exact", async () => {
    const fixture = await operatorFixture("activate");
    try {
      const client = new ApprovalOperatorClient({ migrations: [] });
      await expect(runFixture(fixture, async () => client))
        .rejects.toThrow("approved migration manifest is not active");
      expect(client.approvals.size).toBe(0);
      expect(client.events).toEqual([]);
      expect(client.statements.at(-1)).toBe("ROLLBACK");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("rolls back when an existing manifest row is not canonical-byte identical", async () => {
    const fixture = await operatorFixture("activate");
    try {
      const conflicting = structuredClone(fixture.approval);
      conflicting.reviewerId = "different-reviewer";
      const client = new ApprovalOperatorClient({
        migrations: fixture.migrations,
        approvals: [{ manifest: fixture.manifest, approval: conflicting }],
      });
      await expect(runFixture(fixture, async () => client))
        .rejects.toThrow("stored build approval does not match signed input");
      expect(client.events).toEqual([]);
      expect(client.statements.at(-1)).toBe("ROLLBACK");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("verifies read-only only when the signed target is the latest active and has no later revocation", async () => {
    const fixture = await operatorFixture("verify");
    try {
      const activation: ApprovalEvent = {
        id: 1,
        manifest: fixture.manifest,
        environment: "preview",
        type: "activated",
        actor: "reviewer-fixture-1",
        occurredAt: "2026-08-26T00:00:00.000Z",
      };
      const active = new ApprovalOperatorClient({
        migrations: fixture.migrations,
        approvals: [{ manifest: fixture.manifest, approval: fixture.approval }],
        events: [activation],
      });
      await expect(runFixture(fixture, async () => active))
        .resolves.toMatchObject({ operation: "verify", verified: true });
      expect(active.statements[0]).toContain("READ ONLY");
      expect(active.statements.some((sql) => sql.startsWith("INSERT"))).toBe(false);

      const revoked = new ApprovalOperatorClient({
        migrations: fixture.migrations,
        approvals: [{ manifest: fixture.manifest, approval: fixture.approval }],
        events: [activation, {
          ...activation,
          id: 2,
          type: "revoked",
          actor: "release-operator-2",
          occurredAt: "2026-08-26T01:00:00.000Z",
        }],
      });
      await expect(runFixture(fixture, async () => revoked))
        .rejects.toThrow("signed build approval is not the latest active build");
      expect(revoked.statements.at(-1)).toBe("ROLLBACK");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("prohibits activation replay after the target was revoked or superseded", async () => {
    const fixture = await operatorFixture("activate");
    try {
      const activation: ApprovalEvent = {
        id: 1,
        manifest: fixture.manifest,
        environment: "preview",
        type: "activated",
        actor: "reviewer-fixture-1",
        occurredAt: "2026-08-26T00:00:00.000Z",
      };
      const revoked = new ApprovalOperatorClient({
        migrations: fixture.migrations,
        approvals: [{ manifest: fixture.manifest, approval: fixture.approval }],
        events: [activation, {
          ...activation,
          id: 2,
          type: "revoked",
          actor: "release-operator-2",
          occurredAt: "2026-08-26T00:30:00.000Z",
        }],
      });
      await expect(runFixture(fixture, async () => revoked))
        .rejects.toThrow("signed build approval is not the latest active build");
      expect(revoked.statements.at(-1)).toBe("ROLLBACK");

      const superseded = new ApprovalOperatorClient({
        migrations: fixture.migrations,
        approvals: [{ manifest: fixture.manifest, approval: fixture.approval }],
        events: [activation, {
          ...activation,
          id: 2,
          manifest: "9".repeat(64),
          actor: "reviewer-fixture-2",
          occurredAt: "2026-08-26T00:30:00.000Z",
        }],
      });
      await expect(runFixture(fixture, async () => superseded))
        .rejects.toThrow("signed build approval is not the latest active build");
      expect(superseded.statements.at(-1)).toBe("ROLLBACK");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("retries only SQLSTATE 40001/40P01 with a fixed three-attempt cap", async () => {
    const fixture = await operatorFixture("activate");
    try {
      const recovered = new ApprovalOperatorClient({
        migrations: fixture.migrations,
        transientFailures: 2,
        transientCode: "40001",
      });
      await expect(runFixture(fixture, async () => recovered))
        .resolves.toMatchObject({ verified: true });
      expect(recovered.statements.filter((sql) => sql.startsWith("BEGIN TRANSACTION")))
        .toHaveLength(3);

      const exhausted = new ApprovalOperatorClient({
        migrations: fixture.migrations,
        transientFailures: 3,
        transientCode: "40P01",
      });
      await expect(runFixture(fixture, async () => exhausted))
        .rejects.toMatchObject({ code: "40P01" });
      expect(exhausted.statements.filter((sql) => sql.startsWith("BEGIN TRANSACTION")))
        .toHaveLength(3);

      const nonRetryable = new ApprovalOperatorClient({
        migrations: fixture.migrations,
        transientFailures: 1,
        transientCode: "23505",
      });
      await expect(runFixture(fixture, async () => nonRetryable))
        .rejects.toMatchObject({ code: "23505" });
      expect(nonRetryable.statements.filter((sql) => sql.startsWith("BEGIN TRANSACTION")))
        .toHaveLength(1);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("emits only a fixed secret-free error when a provider failure contains the database URL", async () => {
    const fixture = await operatorFixture("verify");
    try {
      let stdout = "";
      let stderr = "";
      const exitCode = await runBuildApprovalOperatorCli(
        fixture.directory,
        fixture.configRelativePath,
        operatorPins(fixture),
        {
        environment: fixture.environment,
        connect: async () => { throw new Error(`provider failure for ${DATABASE_URL}`); },
        writeStdout: (value) => { stdout += value; },
        writeStderr: (value) => { stderr += value; },
        },
      );
      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toBe("COMPUTE_BUILD_APPROVAL_OPERATOR_FAILED\n");
      expect(`${stdout}${stderr}`).not.toContain("fixture-password-never-real");
      expect(`${stdout}${stderr}`).not.toContain("postgresql://");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });
});
