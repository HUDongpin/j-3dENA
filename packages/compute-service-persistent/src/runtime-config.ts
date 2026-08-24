import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type {
  ApprovedLongitudinalExecutionBuildV2,
  ComputeHttpBuildIdentityV1,
} from "@3dena/compute-service-http";

import type { ExpectedRuntimeBuildV1 } from "./contracts";
import {
  canonicalStringify,
  hasExactKeys,
  isRecord,
  LOWER_SHA256,
  OPAQUE_ID,
  sha256Text,
} from "./util";

const GIT_COMMIT = /^[a-f0-9]{40}$/u;
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u;
const REQUIRED_JENA_VERSION = "0.7.0-ona.0";
const REQUIRED_JENA_COMMIT = "90790856f00bdef63dbd27fc3a5b502e8cffe65f";
const REQUIRED_JENA_TARBALL_INTEGRITY = "sha512-gBhKP9d7C3akXTPlU03AJHBs+dBBDt1TUFGx96P/pB/s0GEGGX2aZFLJGWf9HLc+wuBJIjrJn7tIGicg1WQflQ==";
const REQUIRED_CONTRACT_VERSIONS = [
  "3dena.compute-dataset-http.v1",
  "3dena.compute-http.v1",
  "3dena.compute-prepared-import-http.v1",
  "3dena.compute-source-result-job-http.v1",
  "3dena.contract.v1",
  "3dena.longitudinal-compute-submission.v2",
] as const;
const REQUIRED_MIGRATION_VERSIONS = [
  "0001-persistent-compute",
  "0002-persistent-control-plane",
  "0003-build-approval-v3",
] as const;
const RUNTIME_MANIFEST_FIELDS = [
  "schemaVersion",
  "sourceCommit",
  "migrationManifest",
  "migrationManifestSha256",
  "contractVersions",
  "runtimeDependencies",
  "approvedLongitudinalBuild",
  "runtimeBundleSha256",
  "scientificWorkerBundleSha256",
] as const;

export interface ComputeRuntimeBuildManifestV1 {
  readonly schemaVersion: "3dena.compute-runtime-build-manifest.v4";
  readonly sourceCommit: string;
  readonly migrationManifest: readonly Readonly<{
    readonly sha256: string;
    readonly version: string;
  }>[];
  readonly migrationManifestSha256: string;
  readonly contractVersions: readonly string[];
  readonly runtimeDependencies: Readonly<{
    "@vercel/blob": "2.8.0";
    pg: "8.22.0";
  }>;
  readonly approvedLongitudinalBuild: ApprovedLongitudinalExecutionBuildV2;
  readonly runtimeBundleSha256: string;
  readonly scientificWorkerBundleSha256: string;
}

export interface ComputeRuntimeConfigurationV1 {
  readonly role: "api" | "worker";
  readonly databaseUrl: string;
  readonly blobToken: string;
  readonly blobNamespace: string;
  readonly capabilityHmacSecret: string;
  readonly longitudinalServiceTokenSha256: string;
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
  readonly approvedLongitudinalBuild: ApprovedLongitudinalExecutionBuildV2;
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

function rootHttpsBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("PUBLIC_COMPUTE_BASE_URL is invalid.");
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" ||
      parsed.password !== "" || parsed.pathname !== "/" ||
      parsed.search !== "" || parsed.hash !== "") {
    throw new TypeError("PUBLIC_COMPUTE_BASE_URL must be one root HTTPS origin.");
  }
  return parsed.origin;
}

function assertVersions(value: unknown, path: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length < 1 ||
      value.some((entry) => typeof entry !== "string" || !VERSION.test(entry)) ||
      new Set(value).size !== value.length ||
      [...value].sort().some((entry, index) => entry !== value[index])) {
    throw new TypeError(`${path} must be a non-empty unique sorted version list.`);
  }
}

function isMigrationManifest(
  value: unknown,
): value is Array<{ sha256: string; version: string }> {
  return Array.isArray(value) && value.length > 0 &&
    value.every((entry) => isRecord(entry) &&
      hasExactKeys(entry, ["sha256", "version"]) &&
      typeof entry.version === "string" && VERSION.test(entry.version) &&
      typeof entry.sha256 === "string" && LOWER_SHA256.test(entry.sha256)) &&
    new Set(value.map((entry) => entry.version)).size === value.length &&
    [...value].sort((left, right) => left.version.localeCompare(right.version))
      .every((entry, index) => entry.version === value[index]?.version);
}

export function assertComputeRuntimeBuildManifestV1(
  value: unknown,
): asserts value is ComputeRuntimeBuildManifestV1 {
  if (!isRecord(value) || !hasExactKeys(value, RUNTIME_MANIFEST_FIELDS) ||
      value.schemaVersion !== "3dena.compute-runtime-build-manifest.v4" ||
      typeof value.sourceCommit !== "string" || !GIT_COMMIT.test(value.sourceCommit) ||
      !isMigrationManifest(value.migrationManifest) ||
      typeof value.migrationManifestSha256 !== "string" ||
        !LOWER_SHA256.test(value.migrationManifestSha256) ||
      sha256Text(canonicalStringify(value.migrationManifest)) !==
        value.migrationManifestSha256 ||
      typeof value.runtimeBundleSha256 !== "string" || !LOWER_SHA256.test(value.runtimeBundleSha256) ||
      typeof value.scientificWorkerBundleSha256 !== "string" || !LOWER_SHA256.test(value.scientificWorkerBundleSha256) ||
      !isRecord(value.runtimeDependencies) ||
      !hasExactKeys(value.runtimeDependencies, ["@vercel/blob", "pg"]) ||
      value.runtimeDependencies["@vercel/blob"] !== "2.8.0" ||
      value.runtimeDependencies.pg !== "8.22.0" ||
      !isRecord(value.approvedLongitudinalBuild) ||
      !hasExactKeys(value.approvedLongitudinalBuild, [
        "jenaVersion", "jenaCommit", "jenaTarballIntegrity", "sdkVersion", "buildId",
      ]) ||
      value.approvedLongitudinalBuild.jenaVersion !== REQUIRED_JENA_VERSION ||
      value.approvedLongitudinalBuild.jenaCommit !== REQUIRED_JENA_COMMIT ||
      value.approvedLongitudinalBuild.jenaTarballIntegrity !== REQUIRED_JENA_TARBALL_INTEGRITY ||
      typeof value.approvedLongitudinalBuild.sdkVersion !== "string" ||
        !VERSION.test(value.approvedLongitudinalBuild.sdkVersion) ||
      typeof value.approvedLongitudinalBuild.buildId !== "string" ||
        !OPAQUE_ID.test(value.approvedLongitudinalBuild.buildId)) {
    throw new TypeError("Runtime build manifest is invalid.");
  }
  assertVersions(value.contractVersions, "manifest.contractVersions");
  if (value.contractVersions.length !== REQUIRED_CONTRACT_VERSIONS.length ||
      value.contractVersions.some((entry, index) => entry !== REQUIRED_CONTRACT_VERSIONS[index]) ||
      value.migrationManifest.length !== REQUIRED_MIGRATION_VERSIONS.length ||
      value.migrationManifest.some((entry, index) => entry.version !== REQUIRED_MIGRATION_VERSIONS[index])) {
    throw new TypeError("Runtime build manifest contract or migration set is not current.");
  }
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
  if (gitCommit !== manifest.sourceCommit) {
    throw new TypeError("Runtime source commit does not match GIT_COMMIT.");
  }
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
    migrationManifestSha256: manifest.migrationManifestSha256,
    contractVersions: [...manifest.contractVersions],
    ...manifest.approvedLongitudinalBuild,
  });
  return Object.freeze({
    role,
    databaseUrl,
    blobToken: exactEnvironment(environment, "BLOB_READ_WRITE_TOKEN"),
    blobNamespace: exactEnvironment(environment, "BLOB_NAMESPACE", /^[a-z0-9][a-z0-9-]{0,62}$/u),
    capabilityHmacSecret: exactEnvironment(environment, "CAPABILITY_HMAC_SECRET"),
    longitudinalServiceTokenSha256: exactEnvironment(
      environment,
      "LONGITUDINAL_SERVICE_TOKEN_SHA256",
      LOWER_SHA256,
    ),
    publicBaseUrl: rootHttpsBaseUrl(
      exactEnvironment(environment, "PUBLIC_COMPUTE_BASE_URL", /^https:\/\//u),
    ),
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
    approvedLongitudinalBuild: Object.freeze({ ...manifest.approvedLongitudinalBuild }),
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
