import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execute = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("immutable compute runtime artifact", () => {
  it("executes the production worker artifact with the exact signed scientific identity", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "3dena-runtime-artifact-"));
    const output = join(repositoryRoot, "output", `runtime-artifact-${randomUUID()}`);
    const approvedLongitudinalBuild = {
      jenaVersion: "0.7.0-ona.0",
      jenaCommit: "a".repeat(40),
      jenaTarballIntegrity: "sha512-ZXhhY3QtamVuYS10YXJiYWxs",
      sdkVersion: "0.2.0-implemented-unverified.2",
      buildId: "signed-artifact-build-1",
    };
    try {
      const inputPath = join(temporary, "runtime-input.json");
      await writeFile(inputPath, JSON.stringify({
        schemaVersion: "3dena.compute-runtime-build-input.v3",
        approvedLongitudinalBuild,
        migrations: [
          {
            path: join(
              repositoryRoot,
              "packages/compute-service-persistent/migrations/0001_persistent_compute.sql",
            ),
            version: "0001-persistent-compute",
          },
          {
            path: join(
              repositoryRoot,
              "packages/compute-service-persistent/migrations/0002_persistent_control_plane.sql",
            ),
            version: "0002-persistent-control-plane",
          },
          {
            path: join(
              repositoryRoot,
              "packages/compute-service-persistent/migrations/0003_build_approval_v3.sql",
            ),
            version: "0003-build-approval-v3",
          },
        ],
        contractVersions: [
          "3dena.compute-dataset-http.v1",
          "3dena.compute-http.v1",
          "3dena.compute-prepared-import-http.v1",
          "3dena.compute-source-result-job-http.v1",
          "3dena.contract.v1",
          "3dena.longitudinal-compute-submission.v2",
        ],
      }));
      await execute(process.execPath, [
        join(
          repositoryRoot,
          "packages/compute-service-persistent/scripts/build-runtime.mjs",
        ),
        inputPath,
        output,
      ], { cwd: repositoryRoot, timeout: 60_000 });

      const runtimePath = join(output, "compute-runtime.mjs");
      const workerPath = join(output, "scientific-worker-entry.mjs");
      const runtime = await readFile(runtimePath, "utf8");
      const worker = await readFile(workerPath, "utf8");
      const manifest = JSON.parse(
        await readFile(join(output, "build-manifest.json"), "utf8"),
      ) as {
        approvedLongitudinalBuild: unknown;
        runtimeBundleSha256: string;
        scientificWorkerBundleSha256: string;
      };
      expect(manifest.approvedLongitudinalBuild).toEqual(approvedLongitudinalBuild);
      expect(manifest.runtimeBundleSha256).toBe(
        createHash("sha256").update(runtime).digest("hex"),
      );
      expect(manifest.scientificWorkerBundleSha256).toBe(
        createHash("sha256").update(worker).digest("hex"),
      );

      const invocation = "startScientificWorkerProcess();\n//#endregion\nexport {};";
      expect(worker).toContain(invocation);
      const probeSource = worker.replace(
        invocation,
        "const __artifactIdentity = getAnalysisBuildIdentityV2();\n" +
          "export { __artifactIdentity };\n//#endregion",
      );
      const probePath = join(temporary, "scientific-worker-identity-probe.mjs");
      await writeFile(probePath, probeSource);
      const imported = await import(
        `${pathToFileURL(probePath).href}?identity=${randomUUID()}`
      ) as { __artifactIdentity: unknown };
      expect(imported.__artifactIdentity).toEqual({
        ...approvedLongitudinalBuild,
        bound: true,
      });
      const runtimeEntryMarker = "var role = process.argv[2];";
      const runtimeEntryOffset = runtime.lastIndexOf(runtimeEntryMarker);
      expect(runtimeEntryOffset).toBeGreaterThan(0);
      const runtimeProbeSource = `${runtime.slice(0, runtimeEntryOffset)}\n` +
        "const __runtimeArtifactIdentity = getAnalysisBuildIdentityV2();\n" +
        "export { __runtimeArtifactIdentity };\n";
      const runtimeProbePath = join(temporary, "compute-runtime-identity-probe.mjs");
      await writeFile(runtimeProbePath, runtimeProbeSource);
      const runtimeImported = await import(
        `${pathToFileURL(runtimeProbePath).href}?identity=${randomUUID()}`
      ) as { __runtimeArtifactIdentity: unknown };
      expect(runtimeImported.__runtimeArtifactIdentity).toEqual({
        ...approvedLongitudinalBuild,
        bound: true,
      });
      expect(worker).toContain(
        'process.env.NODE_ENV === "production" && !build.bound',
      );
      for (const value of Object.values(approvedLongitudinalBuild)) {
        expect(worker).toContain(JSON.stringify(value));
        expect(runtime).toContain(JSON.stringify(value));
      }
    } finally {
      await rm(output, { recursive: true, force: true });
      await rm(temporary, { recursive: true, force: true });
    }
  }, 90_000);
});
