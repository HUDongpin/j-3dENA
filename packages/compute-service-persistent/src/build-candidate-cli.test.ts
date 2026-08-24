import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  assertBuildApprovalCandidate,
  buildApprovalManifestSha256,
} from "./build-approval";
import type { BuildApprovalCandidateV1 } from "./contracts";
import { migrationManifestSha256 } from "../deploy/migrate.mjs";

const execute = promisify(execFile);

describe("build approval candidate CLI", () => {
  it("re-hashes every explicit artifact and cannot emit an approval signature", async () => {
    const directory = await mkdtemp(join(tmpdir(), "3dena-build-candidate-"));
    try {
      const artifactNames = [
        "analysisTarball", "jenaTarball", "lockfile", "sbom", "schemaBundle",
      ] as const;
      const artifacts: Record<string, string> = {};
      for (const name of artifactNames) {
        const path = join(directory, `${name}.bin`);
        await writeFile(path, `exact-${name}-bytes`);
        artifacts[name] = path;
      }
      const input = join(directory, "input.json");
      const output = join(directory, "output.json");
      const migrationOne = join(directory, "0001.sql");
      const migrationTwo = join(directory, "0002.sql");
      await writeFile(migrationOne, "first migration");
      await writeFile(migrationTwo, "second migration");
      const migrations = [
        { version: "0001-persistent-compute", path: migrationOne },
        { version: "0002-persistent-control-plane", path: migrationTwo },
      ];
      await writeFile(input, JSON.stringify({
        releaseId: "release-cli-test",
        environment: "production",
        gitCommit: "a".repeat(40),
        vercelDeploymentId: "dpl-cli-test",
        vercelBuildId: "vercel-cli-test",
        flyImageDigest: `sha256:${"b".repeat(64)}`,
        flyBuildId: "fly-cli-test",
        jenaVersion: "0.7.0-ona.0",
        jenaCommit: "c".repeat(40),
        sdkVersion: "0.2.0-implemented-unverified.5",
        buildId: "approved-cli-scientific-build-1",
        migrations,
        contractVersions: ["3dena.compute-http.v1", "3dena.contract.v1"],
        implementationActorIds: ["implementation-actor-1"],
        artifacts,
      }));
      await execute(process.execPath, [
        new URL("../deploy/build-approval-candidate.mjs", import.meta.url).pathname,
        input,
        output,
      ]);
      const text = await readFile(output, "utf8");
      const receipt = JSON.parse(text) as {
        candidate: BuildApprovalCandidateV1;
        approvalManifestSha256: string;
        signatureBase64?: unknown;
      };
      expect(receipt.signatureBase64).toBeUndefined();
      expect(() => assertBuildApprovalCandidate(receipt.candidate)).not.toThrow();
      expect(receipt.approvalManifestSha256).toBe(
        buildApprovalManifestSha256(receipt.candidate),
      );
      for (const [field, name] of [
        ["analysisTarballSha256", "analysisTarball"],
        ["jenaTarballSha256", "jenaTarball"],
        ["lockfileSha256", "lockfile"],
        ["sbomSha256", "sbom"],
        ["schemaBundleSha256", "schemaBundle"],
      ] as const) {
        const expected = createHash("sha256")
          .update(await readFile(artifacts[name]!))
          .digest("hex");
        expect(receipt.candidate[field]).toBe(expected);
      }
      expect(receipt.candidate.migrationManifestSha256).toBe(
        migrationManifestSha256(await Promise.all(migrations.map(async (entry) => ({
          version: entry.version,
          sha256: createHash("sha256").update(await readFile(entry.path)).digest("hex"),
        })))),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
