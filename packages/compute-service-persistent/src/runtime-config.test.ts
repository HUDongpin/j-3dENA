import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertComputeRuntimeBuildManifestV1,
  loadComputeRuntimeConfiguration,
  type ComputeRuntimeBuildManifestV1,
} from "./runtime-config";
import { canonicalStringify, sha256Text } from "./util";

const scientificBuild = Object.freeze({
  jenaVersion: "0.7.0-ona.0",
  jenaCommit: "90790856f00bdef63dbd27fc3a5b502e8cffe65f",
  jenaTarballIntegrity: "sha512-gBhKP9d7C3akXTPlU03AJHBs+dBBDt1TUFGx96P/pB/s0GEGGX2aZFLJGWf9HLc+wuBJIjrJn7tIGicg1WQflQ==",
  sdkVersion: "0.2.0-implemented-unverified.6",
  buildId: "approved-runtime-scientific-build-1",
});

function manifest(): ComputeRuntimeBuildManifestV1 {
  const migrationManifest = [
    { version: "0001-persistent-compute", sha256: "a".repeat(64) },
    { version: "0002-persistent-control-plane", sha256: "b".repeat(64) },
    { version: "0003-build-approval-v3", sha256: "c".repeat(64) },
    { version: "0004-scientific-result-generations", sha256: "d".repeat(64) },
    { version: "0005-build-approval-v4", sha256: "e".repeat(64) },
  ];
  return {
    schemaVersion: "3dena.compute-runtime-build-manifest.v4",
    sourceCommit: "f".repeat(40),
    migrationManifest,
    migrationManifestSha256: sha256Text(canonicalStringify(migrationManifest)),
    contractVersions: [
      "3dena.compute-dataset-http.v1",
      "3dena.compute-http.v1",
      "3dena.compute-prepared-import-http.v1",
      "3dena.compute-source-result-job-http.v1",
      "3dena.contract.v1",
      "3dena.longitudinal-compute-submission.v2",
    ],
    runtimeDependencies: { "@vercel/blob": "2.8.0", pg: "8.22.0" },
    approvedLongitudinalBuild: scientificBuild,
    runtimeBundleSha256: "c".repeat(64),
    scientificWorkerBundleSha256: "d".repeat(64),
  };
}

describe("compute runtime V4 configuration", () => {
  it("takes the scientific identity only from the immutable manifest and requires a root base URL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "3dena-runtime-config-"));
    try {
      const manifestPath = join(directory, "build-manifest.json");
      await writeFile(manifestPath, JSON.stringify(manifest()));
      const { publicKey } = generateKeyPairSync("ed25519");
      const publicKeysPath = join(directory, "public-keys.json");
      const publicKeyRegistry = `${JSON.stringify({
        "release-key-runtime-v4": {
          algorithm: "Ed25519",
          allowedEnvironments: ["production"],
          publicKeyPem: String(publicKey.export({ format: "pem", type: "spki" })),
          reviewerId: "reviewer-runtime-v4",
          role: "independent-reviewer",
        },
      })}\n`;
      await writeFile(publicKeysPath, publicKeyRegistry);
      const environment: NodeJS.ProcessEnv = {
        BUILD_MANIFEST_PATH: manifestPath,
        NEON_POOLED_DATABASE_URL: "postgresql://database.example/compute",
        DEPLOYMENT_ENV: "production",
        ALLOWED_ORIGINS_JSON: JSON.stringify(["https://app.example"]),
        BUILD_APPROVAL_MANIFEST_SHA256: "e".repeat(64),
        BUILD_APPROVAL_MATERIALIZATION_MANIFEST_SHA256: "4".repeat(64),
        RELEASE_ID: "release-runtime-v3",
        GIT_COMMIT: "f".repeat(40),
        FLY_IMAGE_DIGEST: `sha256:${"1".repeat(64)}`,
        FLY_BUILD_ID: "fly-build-runtime-v3",
        VERCEL_DEPLOYMENT_ID: "dpl-runtime-v3",
        VERCEL_BUILD_ID: "vercel-build-runtime-v3",
        BLOB_READ_WRITE_TOKEN: "fixture-blob-token",
        BLOB_NAMESPACE: "fixture-compute",
        CAPABILITY_HMAC_SECRET: "fixture-capability-secret",
        LONGITUDINAL_SERVICE_TOKEN_SHA256: "2".repeat(64),
        PUBLIC_COMPUTE_BASE_URL: "https://compute.example/",
        BUILD_APPROVAL_PUBLIC_KEYS_PATH: publicKeysPath,
        SCIENTIFIC_WORKER_ENTRY_PATH: "/app/scientific-worker-entry.mjs",
        PORT: "8080",
        FLY_MACHINE_ID: "machine-runtime-v3",
        GLOBAL_COMPUTE_CAPACITY: "2",
        // Untrusted, unsigned drift variables must have no effect.
        JENA_VERSION: "attacker-drift",
        JENA_COMMIT: "0".repeat(40),
        THREEDENA_PACKAGE_BUILD_ID: "attacker-build-id",
      };
      const loaded = await loadComputeRuntimeConfiguration("api", environment);
      expect(loaded.publicBaseUrl).toBe("https://compute.example");
      expect(loaded.approvedLongitudinalBuild).toEqual(scientificBuild);
      expect(loaded.expectedBuild).toMatchObject(scientificBuild);
      expect(loaded.expectedBuild.publicKeyRegistrySha256).toBe(
        createHash("sha256").update(publicKeyRegistry).digest("hex"),
      );
      expect(loaded.expectedBuild.materializationManifestSha256).toBe("4".repeat(64));
      // compute-build-info.v1 remains exact: approvalManifestSha256 addresses the
      // signed V4 candidate which directly contains materializationManifestSha256.
      expect(loaded.publicBuildIdentity.approvalManifestSha256).toBe("e".repeat(64));
      expect(loaded.publicBuildIdentity).not.toHaveProperty("materializationManifestSha256");
      expect(loaded.longitudinalServiceTokenSha256).toBe("2".repeat(64));

      await expect(loadComputeRuntimeConfiguration("api", {
        ...environment,
        BUILD_APPROVAL_MATERIALIZATION_MANIFEST_SHA256: undefined,
      })).rejects.toThrow(/BUILD_APPROVAL_MATERIALIZATION_MANIFEST_SHA256/iu);

      await expect(loadComputeRuntimeConfiguration("api", {
        ...environment,
        PUBLIC_COMPUTE_BASE_URL: "https://compute.example/compute",
      })).rejects.toThrow("root HTTPS origin");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a public-key registry larger than 128 KiB before readiness identity is built", async () => {
    const directory = await mkdtemp(join(tmpdir(), "3dena-runtime-config-registry-limit-"));
    try {
      const manifestPath = join(directory, "build-manifest.json");
      const publicKeysPath = join(directory, "public-keys.json");
      await writeFile(manifestPath, JSON.stringify(manifest()));
      await writeFile(publicKeysPath, Buffer.alloc((128 * 1024) + 1, 0x20));
      await expect(loadComputeRuntimeConfiguration("api", {
        BUILD_MANIFEST_PATH: manifestPath,
        BUILD_APPROVAL_PUBLIC_KEYS_PATH: publicKeysPath,
        NEON_POOLED_DATABASE_URL: "postgresql://database.example/compute",
        DEPLOYMENT_ENV: "production",
        ALLOWED_ORIGINS_JSON: JSON.stringify(["https://app.example"]),
        BUILD_APPROVAL_MANIFEST_SHA256: "e".repeat(64),
        BUILD_APPROVAL_MATERIALIZATION_MANIFEST_SHA256: "4".repeat(64),
        RELEASE_ID: "release-runtime-v4-limit",
        GIT_COMMIT: "f".repeat(40),
      })).rejects.toThrow(/128 KiB|public-key registry/iu);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects missing, extra, or changed V4 scientific identity fields", () => {
    const valid = manifest();
    expect(() => assertComputeRuntimeBuildManifestV1(valid)).not.toThrow();
    const missing = structuredClone(valid) as unknown as Record<string, unknown>;
    delete (missing.approvedLongitudinalBuild as Record<string, unknown>).buildId;
    expect(() => assertComputeRuntimeBuildManifestV1(missing)).toThrow();
    expect(() => assertComputeRuntimeBuildManifestV1({
      ...valid,
      approvedLongitudinalBuild: {
        ...valid.approvedLongitudinalBuild,
        unsignedOverride: "forbidden",
      },
    })).toThrow();
    expect(() => assertComputeRuntimeBuildManifestV1({
      ...valid,
      contractVersions: valid.contractVersions.slice(1),
    })).toThrow();
    const staleMigrations = valid.migrationManifest.slice(0, 2);
    expect(() => assertComputeRuntimeBuildManifestV1({
      ...valid,
      migrationManifest: staleMigrations,
      migrationManifestSha256: sha256Text(canonicalStringify(staleMigrations)),
    })).toThrow();
    expect(() => assertComputeRuntimeBuildManifestV1({ ...valid, unexpected: true })).toThrow();
    expect(() => assertComputeRuntimeBuildManifestV1({
      ...valid,
      approvedLongitudinalBuild: {
        ...valid.approvedLongitudinalBuild,
        jenaCommit: "a".repeat(40),
      },
    })).toThrow();
    expect(() => assertComputeRuntimeBuildManifestV1({
      ...valid,
      approvedLongitudinalBuild: {
        ...valid.approvedLongitudinalBuild,
        jenaTarballIntegrity: "sha512-ZXhhY3QtamVuYS10YXJiYWxs",
      },
    })).toThrow();
  });

  it("rejects a runtime environment whose Git identity differs from the artifact source", async () => {
    const directory = await mkdtemp(join(tmpdir(), "3dena-runtime-config-source-"));
    try {
      const manifestPath = join(directory, "build-manifest.json");
      const publicKeysPath = join(directory, "public-keys.json");
      const { publicKey } = generateKeyPairSync("ed25519");
      await writeFile(manifestPath, JSON.stringify(manifest()));
      await writeFile(publicKeysPath, `${JSON.stringify({
        "release-key-runtime-v4": {
          algorithm: "Ed25519",
          allowedEnvironments: ["production"],
          publicKeyPem: String(publicKey.export({ format: "pem", type: "spki" })),
          reviewerId: "reviewer-runtime-v4",
          role: "independent-reviewer",
        },
      })}\n`);
      await expect(loadComputeRuntimeConfiguration("api", {
        BUILD_MANIFEST_PATH: manifestPath,
        BUILD_APPROVAL_PUBLIC_KEYS_PATH: publicKeysPath,
        NEON_POOLED_DATABASE_URL: "postgresql://database.example/compute",
        DEPLOYMENT_ENV: "production",
        ALLOWED_ORIGINS_JSON: JSON.stringify(["https://app.example"]),
        BUILD_APPROVAL_MANIFEST_SHA256: "e".repeat(64),
        BUILD_APPROVAL_MATERIALIZATION_MANIFEST_SHA256: "4".repeat(64),
        RELEASE_ID: "release-runtime-v4",
        GIT_COMMIT: "0".repeat(40),
      })).rejects.toThrow(/source commit/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
