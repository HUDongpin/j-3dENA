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
  jenaCommit: "a".repeat(40),
  jenaTarballIntegrity: "sha512-ZXhhY3QtamVuYS10YXJiYWxs",
  sdkVersion: "0.2.0-implemented-unverified.1",
  buildId: "approved-runtime-scientific-build-1",
});

function manifest(): ComputeRuntimeBuildManifestV1 {
  const migrationManifest = [{
    version: "0001-persistent-compute",
    sha256: "b".repeat(64),
  }];
  return {
    schemaVersion: "3dena.compute-runtime-build-manifest.v3",
    migrationManifest,
    migrationManifestSha256: sha256Text(canonicalStringify(migrationManifest)),
    contractVersions: ["3dena.compute-http.v1", "3dena.contract.v1"],
    runtimeDependencies: { "@vercel/blob": "2.8.0", pg: "8.22.0" },
    approvedLongitudinalBuild: scientificBuild,
    runtimeBundleSha256: "c".repeat(64),
    scientificWorkerBundleSha256: "d".repeat(64),
  };
}

describe("compute runtime V3 configuration", () => {
  it("takes the scientific identity only from the immutable manifest and requires a root base URL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "3dena-runtime-config-"));
    try {
      const manifestPath = join(directory, "build-manifest.json");
      await writeFile(manifestPath, JSON.stringify(manifest()));
      const environment: NodeJS.ProcessEnv = {
        BUILD_MANIFEST_PATH: manifestPath,
        NEON_POOLED_DATABASE_URL: "postgresql://database.example/compute",
        DEPLOYMENT_ENV: "production",
        ALLOWED_ORIGINS_JSON: JSON.stringify(["https://app.example"]),
        BUILD_APPROVAL_MANIFEST_SHA256: "e".repeat(64),
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
        BUILD_APPROVAL_PUBLIC_KEYS_PATH: "/app/public-keys.json",
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
      expect(loaded.longitudinalServiceTokenSha256).toBe("2".repeat(64));

      await expect(loadComputeRuntimeConfiguration("api", {
        ...environment,
        PUBLIC_COMPUTE_BASE_URL: "https://compute.example/compute",
      })).rejects.toThrow("root HTTPS origin");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects missing, extra, or changed V3 scientific identity fields", () => {
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
  });
});
