import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { ComputeHttpBuildIdentityV1 } from "@3dena/compute-service-http";

import type { ExpectedRuntimeBuildV1 } from "./contracts";
import { hasExactKeys, isRecord, LOWER_SHA256, OPAQUE_ID } from "./util";

const GIT_COMMIT = /^[a-f0-9]{40}$/u;
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u;
const RUNTIME_MANIFEST_FIELDS = [
  "schemaVersion",
  "migrationVersion",
  "migrationSha256",
  "contractVersions",
  "runtimeDependencies",
  "runtimeBundleSha256",
  "scientificWorkerBundleSha256",
] as const;

export interface ComputeRuntimeBuildManifestV1 {
  readonly schemaVersion: "3dena.compute-runtime-build-manifest.v1";
  readonly migrationVersion: string;
  readonly migrationSha256: string;
  readonly contractVersions: readonly string[];
  readonly runtimeDependencies: Readonly<{
    "@vercel/blob": "2.8.0";
    pg: "8.22.0";
  }>;
  readonly runtimeBundleSha256: string;
  readonly scientificWorkerBundleSha256: string;
}

export interface ComputeRuntimeConfigurationV1 {
  readonly role: "api" | "worker";
  readonly databaseUrl: string;
  readonly blobToken: string;
  readonly blobNamespace: string;
  readonly capabilityHmacSecret: string;
  readonly publicBaseUrl: string;
  readonly allowedOrigins: readonly string[];
  readonly publicKeysPath: string;
  readonly workerEntryPath: string;
  readonly port: number;
  readonly holderId: string;
  readonly globalCapacity: number;
  readonly manifest: ComputeRuntimeBuildManifestV1;
  readonly expectedBuild: ExpectedRuntimeBuildV1;
  readonly publicBuildIdentity: ComputeHttpBuildIdentityV1;
}

function exactEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
  pattern?: RegExp,
): string {
  const value = environment[name];
  if (value === undefined || value.length === 0 || (pattern !== undefined && !pattern.test(value))) {
    throw new TypeError(`Required runtime environment ${name} is invalid.`);
  }
  return value;
}

function positiveInteger(value: string, name: string, maximum: number): number {
  if (!/^[1-9][0-9]{0,8}$/u.test(value)) throw new TypeError(`${name} is invalid.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) throw new TypeError(`${name} is invalid.`);
  return parsed;
}

function assertVersions(value: unknown, path: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length < 1 ||
      value.some((entry) => typeof entry !== "string" || !VERSION.test(entry)) ||
      new Set(value).size !== value.length ||
      [...value].sort().some((entry, index) => entry !== value[index])) {
    throw new TypeError(`${path} must be a non-empty unique sorted version list.`);
  }
}

export function assertComputeRuntimeBuildManifestV1(
  value: unknown,
): asserts value is ComputeRuntimeBuildManifestV1 {
  if (!isRecord(value) || !hasExactKeys(value, RUNTIME_MANIFEST_FIELDS) ||
      value.schemaVersion !== "3dena.compute-runtime-build-manifest.v1" ||
      typeof value.migrationVersion !== "string" || !VERSION.test(value.migrationVersion) ||
      typeof value.migrationSha256 !== "string" || !LOWER_SHA256.test(value.migrationSha256) ||
      typeof value.runtimeBundleSha256 !== "string" || !LOWER_SHA256.test(value.runtimeBundleSha256) ||
      typeof value.scientificWorkerBundleSha256 !== "string" || !LOWER_SHA256.test(value.scientificWorkerBundleSha256) ||
      !isRecord(value.runtimeDependencies) ||
      !hasExactKeys(value.runtimeDependencies, ["@vercel/blob", "pg"]) ||
      value.runtimeDependencies["@vercel/blob"] !== "2.8.0" ||
      value.runtimeDependencies.pg !== "8.22.0") {
    throw new TypeError("Runtime build manifest is invalid.");
  }
  assertVersions(value.contractVersions, "manifest.contractVersions");
}

export async function loadComputeRuntimeConfiguration(
  role: "api" | "worker",
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ComputeRuntimeConfigurationV1> {
  const manifestPath = exactEnvironment(environment, "BUILD_MANIFEST_PATH");
  const manifestValue = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  assertComputeRuntimeBuildManifestV1(manifestValue);
  const manifest = structuredClone(manifestValue);
  const databaseUrl = exactEnvironment(
    environment,
    role === "api" ? "NEON_POOLED_DATABASE_URL" : "NEON_DIRECT_DATABASE_URL",
    /^postgres(?:ql)?:\/\//u,
  );
  const environmentName = exactEnvironment(environment, "DEPLOYMENT_ENV");
  if (environmentName !== "preview" && environmentName !== "production") {
    throw new TypeError("DEPLOYMENT_ENV is invalid.");
  }
  const allowedOriginsValue = JSON.parse(
    exactEnvironment(environment, "ALLOWED_ORIGINS_JSON"),
  ) as unknown;
  if (!Array.isArray(allowedOriginsValue) || allowedOriginsValue.length < 1 ||
      allowedOriginsValue.some((value) => typeof value !== "string")) {
    throw new TypeError("ALLOWED_ORIGINS_JSON is invalid.");
  }
  const allowedOrigins = allowedOriginsValue as string[];
  const approvalManifestSha256 = exactEnvironment(
    environment,
    "BUILD_APPROVAL_MANIFEST_SHA256",
    LOWER_SHA256,
  );
  const releaseId = exactEnvironment(environment, "RELEASE_ID", OPAQUE_ID);
  const gitCommit = exactEnvironment(environment, "GIT_COMMIT", GIT_COMMIT);
  const flyImageDigest = exactEnvironment(environment, "FLY_IMAGE_DIGEST", IMAGE_DIGEST);
  const flyBuildId = exactEnvironment(environment, "FLY_BUILD_ID", OPAQUE_ID);
  const expectedBuild: ExpectedRuntimeBuildV1 = Object.freeze({
    approvalManifestSha256,
    releaseId,
    environment: environmentName,
    gitCommit,
    vercelDeploymentId: exactEnvironment(environment, "VERCEL_DEPLOYMENT_ID", OPAQUE_ID),
    vercelBuildId: exactEnvironment(environment, "VERCEL_BUILD_ID", OPAQUE_ID),
    flyImageDigest,
    flyBuildId,
    migrationVersion: manifest.migrationVersion,
    migrationSha256: manifest.migrationSha256,
    contractVersions: [...manifest.contractVersions],
  });
  return Object.freeze({
    role,
    databaseUrl,
    blobToken: exactEnvironment(environment, "BLOB_READ_WRITE_TOKEN"),
    blobNamespace: exactEnvironment(environment, "BLOB_NAMESPACE", /^[a-z0-9][a-z0-9-]{0,62}$/u),
    capabilityHmacSecret: exactEnvironment(environment, "CAPABILITY_HMAC_SECRET"),
    publicBaseUrl: exactEnvironment(environment, "PUBLIC_COMPUTE_BASE_URL", /^https:\/\//u),
    allowedOrigins: Object.freeze([...allowedOrigins]),
    publicKeysPath: exactEnvironment(environment, "BUILD_APPROVAL_PUBLIC_KEYS_PATH"),
    workerEntryPath: exactEnvironment(environment, "SCIENTIFIC_WORKER_ENTRY_PATH"),
    port: positiveInteger(exactEnvironment(environment, "PORT"), "PORT", 65_535),
    holderId: exactEnvironment(environment, "FLY_MACHINE_ID", OPAQUE_ID),
    globalCapacity: positiveInteger(
      exactEnvironment(environment, "GLOBAL_COMPUTE_CAPACITY"),
      "GLOBAL_COMPUTE_CAPACITY",
      10_000,
    ),
    manifest,
    expectedBuild,
    publicBuildIdentity: Object.freeze({
      approvalManifestSha256,
      releaseId,
      gitCommit,
      flyImageDigest,
      flyBuildId,
      contractVersions: [...manifest.contractVersions],
    }),
  });
}

export async function verifyComputeRuntimeArtifactHashes(
  manifest: ComputeRuntimeBuildManifestV1,
  runtimePath: string,
  workerPath: string,
): Promise<boolean> {
  try {
    const [runtime, worker] = await Promise.all([
      readFile(runtimePath),
      readFile(workerPath),
    ]);
    return createHash("sha256").update(runtime).digest("hex") === manifest.runtimeBundleSha256 &&
      createHash("sha256").update(worker).digest("hex") === manifest.scientificWorkerBundleSha256;
  } catch {
    return false;
  }
}
