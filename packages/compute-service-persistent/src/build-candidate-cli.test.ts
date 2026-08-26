import { createHash, generateKeyPairSync } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  assertBuildApprovalCandidate,
  buildApprovalManifestSha256,
} from "./build-approval";
import type { BuildApprovalCandidateV1 } from "./contracts";
import {
  BUILD_APPROVAL_ARTIFACT_BOUNDS_V1,
  canonical,
} from "../deploy/build-approval-inputs-lib.mjs";
import { migrationManifestSha256 } from "../deploy/migrate.mjs";

const execute = promisify(execFile);
const candidateCliPath = new URL(
  "../deploy/build-approval-candidate.mjs",
  import.meta.url,
).pathname;
const materializerCliPath = new URL(
  "../deploy/materialize-build-approval-inputs.mjs",
  import.meta.url,
).pathname;

interface ExplicitFile {
  readonly path: string;
  readonly sha256: string;
}

interface CandidateCliFixture {
  readonly directory: string;
  readonly inputPath: string;
  readonly manifestPath: string;
  readonly outputPath: string;
  readonly input: Record<string, any>;
  readonly inputSha256: string;
  readonly manifest: Record<string, any>;
  readonly manifestSha256: string;
  readonly publicKeyRegistry: ExplicitFile;
  readonly artifacts: Record<string, ExplicitFile>;
  readonly migrations: Array<ExplicitFile & { readonly version: string }>;
}

function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function explicitFile(
  directory: string,
  path: string,
  bytes: string,
): Promise<ExplicitFile> {
  await writeFile(join(directory, path), bytes);
  return { path, sha256: sha256(bytes) };
}

async function fixture(): Promise<CandidateCliFixture> {
  const directory = await mkdtemp(join(tmpdir(), "3dena-build-candidate-"));
  const sourceArtifactNames = [
    "analysisTarball", "jenaTarball", "lockfile", "sbom",
  ] as const;
  const sourceArtifacts: Record<string, ExplicitFile> = {};
  for (const name of sourceArtifactNames) {
    sourceArtifacts[name] = await explicitFile(
      directory,
      `${name}.bin`,
      `exact-${name}-bytes`,
    );
  }
  const migrations = [
    {
      version: "0001-persistent-compute",
      ...await explicitFile(directory, "0001.sql", "first migration"),
    },
    {
      version: "0002-persistent-control-plane",
      ...await explicitFile(directory, "0002.sql", "second migration"),
    },
  ];
  const { publicKey } = generateKeyPairSync("ed25519");
  const publicKeyRegistryText = `${canonical({
    "release-key-cli-test": {
      algorithm: "Ed25519",
      allowedEnvironments: ["production"],
      publicKeyPem: String(publicKey.export({ format: "pem", type: "spki" })),
      reviewerId: "reviewer-cli-test",
      role: "independent-reviewer",
    },
  })}\n`;
  const publicKeyRegistry = await explicitFile(
    directory,
    "public-keys.json",
    publicKeyRegistryText,
  );
  await mkdir(join(directory, "schemas"));
  const schema = {
    name: "candidate",
    ...await explicitFile(
      directory,
      "schemas/candidate.v1.json",
      `${canonical({
        $id: "https://3dena.com/schemas/candidate.v1.json",
        additionalProperties: false,
        type: "object",
      })}\n`,
    ),
  };
  const schemaIndex = await explicitFile(
    directory,
    "schemas/index.json",
    `${canonical({
      schemaVersion: "3dena.schema-index.v1",
      schemas: { candidate: "candidate.v1.json" },
    })}\n`,
  );
  const materializationInput = {
    schemaVersion: "3dena.build-approval-materialization-input.v1",
    candidate: {
      releaseId: "release-cli-test",
      environment: "production",
      gitCommit: sha256("candidate-cli-git-commit").slice(0, 40),
      vercelDeploymentId: "dpl-cli-test",
      vercelBuildId: "vercel-cli-test",
      flyImageDigest: `sha256:${sha256("candidate-cli-fly-image")}`,
      flyBuildId: "fly-cli-test",
      jenaVersion: "0.7.0-ona.0",
      jenaCommit: sha256("candidate-cli-jena-commit").slice(0, 40),
      sdkVersion: "0.2.0-implemented-unverified.6",
      buildId: "approved-cli-scientific-build-1",
      migrations,
      contractVersions: ["3dena.compute-http.v1", "3dena.contract.v1"],
      implementationActorIds: ["implementation-actor-1"],
      artifacts: sourceArtifacts,
    },
    schemaBundle: { index: schemaIndex, schemas: [schema] },
    publicKeyRegistry,
  };
  const sourceInputPath = join(directory, "materialization-input.json");
  await writeFile(sourceInputPath, `${canonical(materializationInput)}\n`);
  await execute(process.execPath, [
    materializerCliPath,
    sourceInputPath,
    "materialized",
  ], { cwd: directory });

  const inputPath = join(
    directory,
    "materialized/build-approval-candidate-input.json",
  );
  const manifestPath = join(
    directory,
    "materialized/build-approval-materialization-manifest.json",
  );
  const inputBytes = await readFile(inputPath, "utf8");
  const manifestBytes = await readFile(manifestPath, "utf8");
  const input = JSON.parse(inputBytes) as Record<string, any>;
  const manifest = JSON.parse(manifestBytes) as Record<string, any>;
  const artifacts = input.artifacts as Record<string, ExplicitFile>;
  return {
    directory,
    inputPath,
    manifestPath,
    outputPath: join(directory, "output.json"),
    input,
    inputSha256: sha256(inputBytes),
    manifest,
    manifestSha256: sha256(manifestBytes),
    publicKeyRegistry,
    artifacts,
    migrations,
  };
}

async function refreshManifest(testFixture: CandidateCliFixture): Promise<string> {
  const inputBytes = `${canonical(testFixture.input)}\n`;
  await writeFile(testFixture.inputPath, inputBytes);
  testFixture.manifest.input.publicKeyRegistry = testFixture.input.publicKeyRegistry;
  testFixture.manifest.outputs.candidateInput.sha256 = sha256(inputBytes);
  testFixture.manifest.outputs.schemaBundle = testFixture.input.artifacts.schemaBundle;
  const manifestBytes = `${canonical(testFixture.manifest)}\n`;
  await writeFile(testFixture.manifestPath, manifestBytes);
  return sha256(manifestBytes);
}

describe("build approval candidate CLI", () => {
  it("rejects a self-consistent manifest whose materialization inputs were forged", async () => {
    const testFixture = await fixture();
    try {
      testFixture.manifest.input.candidate = { releaseId: "attacker-release" };
      testFixture.manifest.input.schemaBundle = { attackerControlled: true };
      const manifestBytes = `${canonical(testFixture.manifest)}\n`;
      await writeFile(testFixture.manifestPath, manifestBytes);

      await expect(execute(process.execPath, [
        candidateCliPath,
        testFixture.manifestPath,
        sha256(manifestBytes),
        testFixture.outputPath,
      ], { cwd: testFixture.directory })).rejects.toThrow(
        /materialization|candidate.*fields|schema.*fields/iu,
      );
      expect(await readdir(testFixture.directory)).not.toContain("output.json");
    } finally {
      await rm(testFixture.directory, { recursive: true, force: true });
    }
  });

  it("verifies every explicit artifact hash and cannot emit an approval signature", async () => {
    const testFixture = await fixture();
    try {
      await execute(process.execPath, [
        candidateCliPath,
        testFixture.manifestPath,
        testFixture.manifestSha256,
        testFixture.outputPath,
      ], { cwd: testFixture.directory });
      const text = await readFile(testFixture.outputPath, "utf8");
      const receipt = JSON.parse(text) as {
        candidate: BuildApprovalCandidateV1;
        approvalManifestSha256: string;
        candidateInputSha256: string;
        materializationManifestSha256: string;
        publicKeyRegistrySha256: string;
        signatureBase64?: unknown;
      };
      expect(receipt.signatureBase64).toBeUndefined();
      expect(receipt.candidateInputSha256).toBe(testFixture.inputSha256);
      expect(receipt.materializationManifestSha256).toBe(testFixture.manifestSha256);
      expect(receipt.publicKeyRegistrySha256).toBe(testFixture.publicKeyRegistry.sha256);
      expect(receipt.candidate.materializationManifestSha256)
        .toBe(testFixture.manifestSha256);
      expect(receipt.candidate.publicKeyRegistrySha256)
        .toBe(testFixture.publicKeyRegistry.sha256);
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
        expect(receipt.candidate[field]).toBe(testFixture.artifacts[name]!.sha256);
      }
      expect(receipt.candidate.migrationManifestSha256).toBe(
        migrationManifestSha256(testFixture.migrations.map(({ version, sha256: digest }) => ({
          version,
          sha256: digest,
        }))),
      );
    } finally {
      await rm(testFixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects byte drift after input creation instead of silently binding new bytes", async () => {
    const testFixture = await fixture();
    try {
      await writeFile(
        join(testFixture.directory, testFixture.artifacts.analysisTarball!.path),
        "changed-after-explicit-input",
      );
      await expect(execute(process.execPath, [
        candidateCliPath,
        testFixture.manifestPath,
        testFixture.manifestSha256,
        testFixture.outputPath,
      ], { cwd: testFixture.directory })).rejects.toThrow(/expected.*observed/iu);
      expect(await readdir(testFixture.directory)).not.toContain("output.json");
    } finally {
      await rm(testFixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects a sparse oversized artifact before hashing its changed bytes", async () => {
    const testFixture = await fixture();
    try {
      await truncate(
        join(testFixture.directory, testFixture.artifacts.jenaTarball!.path),
        BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.jenaTarball + 1,
      );
      await expect(execute(process.execPath, [
        candidateCliPath,
        testFixture.manifestPath,
        testFixture.manifestSha256,
        testFixture.outputPath,
      ], { cwd: testFixture.directory })).rejects.toThrow(/8 MiB Jena tarball limit|exceeds/iu);
      expect(await readdir(testFixture.directory)).not.toContain("output.json");
    } finally {
      await rm(testFixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects path-only and unknown artifact descriptor fields", async () => {
    const testFixture = await fixture();
    try {
      testFixture.input.artifacts.sbom = testFixture.artifacts.sbom!.path;
      const pathOnlyManifestSha256 = await refreshManifest(testFixture);
      await expect(execute(process.execPath, [
        candidateCliPath,
        testFixture.manifestPath,
        pathOnlyManifestSha256,
        testFixture.outputPath,
      ], { cwd: testFixture.directory })).rejects.toThrow(
        /materialization manifest.*does not match|explicit sources/iu,
      );

      testFixture.input.artifacts.sbom = {
        ...testFixture.artifacts.sbom,
        unexpected: true,
      };
      const unknownFieldManifestSha256 = await refreshManifest(testFixture);
      await expect(execute(process.execPath, [
        candidateCliPath,
        testFixture.manifestPath,
        unknownFieldManifestSha256,
        testFixture.outputPath,
      ], { cwd: testFixture.directory })).rejects.toThrow(
        /materialization manifest.*does not match|explicit sources/iu,
      );
      expect(await readdir(testFixture.directory)).not.toContain("output.json");
    } finally {
      await rm(testFixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects replacement of the complete candidate input after its manifest hash was fixed", async () => {
    const testFixture = await fixture();
    try {
      const replacement = {
        ...testFixture.input,
        releaseId: "replacement-release",
      };
      await writeFile(testFixture.inputPath, JSON.stringify(replacement));
      await expect(execute(process.execPath, [
        candidateCliPath,
        testFixture.manifestPath,
        testFixture.manifestSha256,
        testFixture.outputPath,
      ], { cwd: testFixture.directory })).rejects.toThrow(
        /candidate-input.*explicit sources|candidate input/iu,
      );
      expect(await readdir(testFixture.directory)).not.toContain("output.json");
    } finally {
      await rm(testFixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects a naked candidate-input hash because V4 is bound to the materialization manifest", async () => {
    const testFixture = await fixture();
    try {
      await expect(execute(process.execPath, [
        candidateCliPath,
        testFixture.inputPath,
        testFixture.inputSha256,
        testFixture.outputPath,
      ], { cwd: testFixture.directory })).rejects.toThrow(
        /manifest fields|materialization manifest/iu,
      );
      expect(await readdir(testFixture.directory)).not.toContain("output.json");
    } finally {
      await rm(testFixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects a public-key registry larger than 128 KiB even when every descriptor hash matches", async () => {
    const testFixture = await fixture();
    try {
      const oversized = Buffer.alloc((128 * 1024) + 1, 0x20);
      await writeFile(join(testFixture.directory, "public-keys.json"), oversized);
      testFixture.input.publicKeyRegistry = {
        path: "public-keys.json",
        sha256: sha256(oversized),
      };
      const manifestSha256 = await refreshManifest(testFixture);
      await expect(execute(process.execPath, [
        candidateCliPath,
        testFixture.manifestPath,
        manifestSha256,
        testFixture.outputPath,
      ], { cwd: testFixture.directory })).rejects.toThrow(/128 KiB|public-key registry/iu);
      expect(await readdir(testFixture.directory)).not.toContain("output.json");
    } finally {
      await rm(testFixture.directory, { recursive: true, force: true });
    }
  });
});
