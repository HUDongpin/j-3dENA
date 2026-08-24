import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

function deployFile(name: string): string {
  return readFileSync(new URL(`../deploy/${name}`, import.meta.url), "utf8");
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

describe("compute container boundary", () => {
  it("requires a reviewed immutable base, tini, non-root runtime, and narrow bundle copy", () => {
    const dockerfile = deployFile("Dockerfile");
    expect(dockerfile).toContain("ARG NODE_BASE_IMAGE");
    expect(dockerfile).toContain("FROM ${NODE_BASE_IMAGE}");
    expect(dockerfile).toContain("ARG SOURCE_COMMIT");
    expect(dockerfile).toContain("ARG RUNTIME_BUNDLE_DIR");
    expect(dockerfile).not.toContain("ARG RUNTIME_BUNDLE_DIR=");
    expect(dockerfile).toContain("ARG EXPECTED_SDK_VERSION");
    expect(dockerfile).toContain('org.opencontainers.image.revision="${SOURCE_COMMIT}"');
    expect(dockerfile).toContain('org.opencontainers.image.source="https://github.com/HUDongpin/j-3dENA"');
    expect(dockerfile).toContain("grep -Eq '^[a-f0-9]{40}$'");
    expect(dockerfile).not.toMatch(/^FROM\s+[^$].*:[^@\s]+\s*$/mu);
    expect(dockerfile).toContain("test -x /sbin/tini");
    expect(dockerfile).toContain("USER 10001:10001");
    expect(dockerfile).toContain("chmod -R a-w /app");
    expect(dockerfile).toContain("compute-runtime.mjs");
    expect(dockerfile).toContain("scientific-worker-entry.mjs");
    expect(dockerfile).toContain("BUILD_MANIFEST_PATH=/app/build-manifest.json");
    expect(dockerfile).toContain("SCIENTIFIC_WORKER_ENTRY_PATH=/app/scientific-worker-entry.mjs");
    expect(dockerfile).toContain("node /usr/local/bin/verify-runtime-bundle /app \"$EXPECTED_SDK_VERSION\"");
    expect(dockerfile).not.toMatch(/COPY\s+\.\s+/u);
    expect(dockerfile).not.toMatch(/apt-get|apk add|dnf install|Rscript|rENA|Shiny/iu);
    expect(dockerfile).toContain("/readyz");
  });

  it("denies the dirty repository and admits only the frozen build inputs", () => {
    const dockerignore = readFileSync(new URL("../../../.dockerignore", import.meta.url), "utf8");
    expect(dockerignore.trimStart()).toMatch(/^#/u);
    expect(dockerignore).toMatch(/^\*\*$/mu);
    expect(dockerignore).not.toContain("!output/compute-service/compute-runtime.mjs");
    expect(dockerignore).toContain("!output/compute-service-candidate-*/compute-runtime.mjs");
    expect(dockerignore).toContain("!output/compute-service-candidate-*/scientific-worker-entry.mjs");
    expect(dockerignore).toContain("!output/compute-service-candidate-*/build-manifest.json");
    expect(dockerignore).toContain("!packages/compute-service-persistent/deploy/Dockerfile");
    expect(dockerignore).toContain("!packages/compute-service-persistent/deploy/entrypoint.sh");
    expect(dockerignore).toContain("!packages/compute-service-persistent/deploy/verify-runtime-bundle.mjs");
    expect(dockerignore).not.toMatch(/!oracle|!evidence|!apps\/|!\.git|!.*test-fixtures/iu);
  });

  it("rejects a stale runtime bundle before Docker can label it as the current source", async () => {
    const verifier = new URL("../deploy/verify-runtime-bundle.mjs", import.meta.url);
    expect(existsSync(verifier)).toBe(true);
    if (!existsSync(verifier)) return;

    const directory = await mkdtemp(join(tmpdir(), "3dena-runtime-container-boundary-"));
    try {
      const runtime = Buffer.from("current runtime\n", "utf8");
      const worker = Buffer.from("current worker\n", "utf8");
      const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
      await writeFile(join(directory, "compute-runtime.mjs"), runtime);
      await writeFile(join(directory, "scientific-worker-entry.mjs"), worker);
      await writeFile(join(directory, "build-manifest.json"), JSON.stringify({
        schemaVersion: "3dena.compute-runtime-build-manifest.v1",
        contractVersions: ["3dena.compute-http.v1", "3dena.contract.v1"],
        approvedLongitudinalBuild: { sdkVersion: "0.1.0" },
        runtimeBundleSha256: sha256(runtime),
        scientificWorkerBundleSha256: sha256(worker),
      }));

      const result = spawnSync(process.execPath, [verifier.pathname, directory, "0.2.0-implemented-unverified.5"], {
        encoding: "utf8",
      });
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/RUNTIME_BUNDLE_REJECTED.*manifest\.v3/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts a current runtime bundle whose scientific identity and bytes match", async () => {
    const verifier = new URL("../deploy/verify-runtime-bundle.mjs", import.meta.url);
    expect(existsSync(verifier)).toBe(true);
    if (!existsSync(verifier)) return;

    const directory = await mkdtemp(join(tmpdir(), "3dena-runtime-container-boundary-"));
    try {
      const runtime = Buffer.from("current runtime\n", "utf8");
      const worker = Buffer.from("current worker\n", "utf8");
      const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
      const migrationManifest = [
        { sha256: "a".repeat(64), version: "0001-persistent-compute" },
        { sha256: "b".repeat(64), version: "0002-persistent-control-plane" },
        { sha256: "c".repeat(64), version: "0003-build-approval-v3" },
      ];
      await writeFile(join(directory, "compute-runtime.mjs"), runtime);
      await writeFile(join(directory, "scientific-worker-entry.mjs"), worker);
      await writeFile(join(directory, "build-manifest.json"), JSON.stringify({
        schemaVersion: "3dena.compute-runtime-build-manifest.v3",
        migrationManifest,
        migrationManifestSha256: sha256(canonical(migrationManifest)),
        contractVersions: [
          "3dena.compute-dataset-http.v1",
          "3dena.compute-http.v1",
          "3dena.compute-prepared-import-http.v1",
          "3dena.compute-source-result-job-http.v1",
          "3dena.contract.v1",
          "3dena.longitudinal-compute-submission.v2",
        ],
        runtimeDependencies: { "@vercel/blob": "2.8.0", pg: "8.22.0" },
        approvedLongitudinalBuild: {
          jenaVersion: "0.7.0-ona.0",
          jenaCommit: "a".repeat(40),
          jenaTarballIntegrity: `sha512-${"A".repeat(84)}==`,
          sdkVersion: "0.2.0-implemented-unverified.5",
          buildId: "reviewed-build-v5",
        },
        runtimeBundleSha256: sha256(runtime),
        scientificWorkerBundleSha256: sha256(worker),
      }));

      const result = spawnSync(process.execPath, [verifier.pathname, directory, "0.2.0-implemented-unverified.5"], {
        encoding: "utf8",
      });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        schemaVersion: "3dena.compute-runtime-build-manifest.v3",
        sdkVersion: "0.2.0-implemented-unverified.5",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("defines distinct api/worker process groups and bounded candidate VMs", () => {
    const fly = deployFile("fly.toml");
    expect(fly).toContain('[processes]');
    expect(fly).toContain('api = "api"');
    expect(fly).toContain('worker = "worker"');
    expect(fly).toContain('processes = ["api"]');
    expect(fly).toContain('processes = ["worker"]');
    expect(fly).toContain('path = "/readyz"');
    expect(fly).toContain('swap_size_mb = 0');
    expect(fly).not.toMatch(/^\s*app\s*=/mu);
    expect(fly).not.toMatch(/^\s*primary_region\s*=/mu);
  });

  it("hard-fails entrypoint resource and filesystem checks before Node", () => {
    const entrypoint = deployFile("entrypoint.sh");
    expect(entrypoint).toContain("set -eu");
    expect(entrypoint).toContain("umask 077");
    expect(entrypoint).toContain('ulimit -n "${MAX_OPEN_FILES}"');
    expect(entrypoint).toContain('ulimit -u "${MAX_PROCESSES}"');
    expect(entrypoint).toContain("test ! -w /app");
    expect(entrypoint).toContain('test -w "${TMPDIR}"');
    expect(entrypoint).toContain("exec /sbin/tini -- node /app/compute-runtime.mjs");
  });
});
