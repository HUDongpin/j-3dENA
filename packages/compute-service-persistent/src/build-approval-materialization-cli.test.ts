import { createHash, generateKeyPairSync } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { BUILD_APPROVAL_ARTIFACT_BOUNDS_V1 } from
  "../deploy/build-approval-inputs-lib.mjs";

const execute = promisify(execFile);
const materializerPath = new URL(
  "../deploy/materialize-build-approval-inputs.mjs",
  import.meta.url,
).pathname;
const verifierPath = new URL(
  "../deploy/verify-build-approval-inputs.mjs",
  import.meta.url,
).pathname;
const publicKeyMaterializerPath = new URL(
  "../deploy/materialize-build-approval-public-keys.mjs",
  import.meta.url,
).pathname;
const publicKeyVerifierPath = new URL(
  "../deploy/verify-build-approval-public-keys.mjs",
  import.meta.url,
).pathname;
const candidatePath = new URL(
  "../deploy/build-approval-candidate.mjs",
  import.meta.url,
).pathname;

function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

interface ExplicitFile {
  readonly path: string;
  readonly sha256: string;
}

interface MutableExplicitFile {
  path: string;
  sha256: string;
}

interface MutableMaterializationInput {
  candidate: {
    artifacts: Record<
      "analysisTarball" | "jenaTarball" | "lockfile" | "sbom",
      MutableExplicitFile
    >;
    migrations: MutableExplicitFile[];
  };
  schemaBundle: {
    index: MutableExplicitFile;
    schemas: MutableExplicitFile[];
  };
}

interface Fixture {
  readonly root: string;
  readonly inputPath: string;
  readonly outputDirectory: string;
  readonly publicKeyInputPath: string;
  readonly publicKeyOutputDirectory: string;
}

async function writeExplicitFile(
  root: string,
  relativePath: string,
  bytes: string | Uint8Array,
): Promise<ExplicitFile> {
  const path = join(root, relativePath);
  await writeFile(path, bytes);
  return { path: relativePath, sha256: sha256(bytes) };
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "3dena-build-approval-materials-"));
  for (const directory of [
    "artifacts", "migrations", "schemas", "keys", "inputs", "output", "registry",
  ]) {
    await mkdir(join(root, directory));
  }

  const artifacts = {
    analysisTarball: await writeExplicitFile(root, "artifacts/analysis.tgz", "analysis-v10"),
    jenaTarball: await writeExplicitFile(root, "artifacts/jena.tgz", "jena-v10"),
    lockfile: await writeExplicitFile(root, "artifacts/package-lock.json", "lock-v10"),
    sbom: await writeExplicitFile(root, "artifacts/sbom.cdx.json", "sbom-v10"),
  };
  const migrations = [
    {
      version: "0001-persistent-compute",
      ...await writeExplicitFile(root, "migrations/0001.sql", "migration-one"),
    },
    {
      version: "0002-persistent-control-plane",
      ...await writeExplicitFile(root, "migrations/0002.sql", "migration-two"),
    },
  ];
  const schemaDocuments = {
    analysisSpec: {
      $id: "https://3dena.com/schemas/analysis-spec.v1.json",
      additionalProperties: false,
      type: "object",
    },
    taskOwner: {
      $id: "https://3dena.com/schemas/task-owner.v1.json",
      required: ["taskId"],
      type: "object",
    },
  };
  const schemas = await Promise.all([
    writeExplicitFile(
      root,
      "schemas/analysis-spec.v1.json",
      `${JSON.stringify(schemaDocuments.analysisSpec, null, 2)}\n`,
    ).then((file) => ({ name: "analysisSpec", ...file })),
    writeExplicitFile(
      root,
      "schemas/task-owner.v1.json",
      `${JSON.stringify(schemaDocuments.taskOwner, null, 2)}\n`,
    ).then((file) => ({ name: "taskOwner", ...file })),
  ]);
  const index = await writeExplicitFile(
    root,
    "schemas/index.json",
    `${JSON.stringify({
      schemaVersion: "3dena.schema-index.v1",
      schemas: {
        taskOwner: "task-owner.v1.json",
        analysisSpec: "analysis-spec.v1.json",
      },
    }, null, 2)}\n`,
  );
  const { publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = String(publicKey.export({ format: "pem", type: "spki" }));
  const publicKeyFile = await writeExplicitFile(
    root,
    "keys/release-key-20260826.pem",
    publicKeyPem,
  );
  const publicKeyOutputDirectory = "registry/release-v10";
  const publicKeyRegistryText = `${JSON.stringify({
    "release-key-20260826": {
      algorithm: "Ed25519",
      allowedEnvironments: ["production"],
      publicKeyPem,
      reviewerId: "reviewer-independent-20260826",
      role: "independent-reviewer",
    },
  })}\n`;
  const publicKeyInputPath = join(root, "inputs/public-keys.json");
  await writeFile(publicKeyInputPath, `${JSON.stringify({
    schemaVersion: "3dena.build-approval-public-key-materialization-input.v1",
    publicKeys: [{
      publicKeyId: "release-key-20260826",
      allowedEnvironments: ["production"],
      reviewerId: "reviewer-independent-20260826",
      role: "independent-reviewer",
      ...publicKeyFile,
    }],
  }, null, 2)}\n`);

  const input = {
    schemaVersion: "3dena.build-approval-materialization-input.v1",
    candidate: {
      releaseId: "release-20260826-v10",
      environment: "production",
      gitCommit: sha256("git-commit-v10").slice(0, 40),
      vercelDeploymentId: "dpl-20260826-v10",
      vercelBuildId: "vercel-build-20260826-v10",
      flyImageDigest: `sha256:${sha256("fly-image-v10")}`,
      flyBuildId: "fly-build-20260826-v10",
      jenaVersion: "0.7.0-ona.0",
      jenaCommit: sha256("jena-commit-v10").slice(0, 40),
      sdkVersion: "0.2.0-implemented-unverified.10",
      buildId: "public-sdk-build-v10",
      migrations,
      contractVersions: ["3dena.compute-http.v1", "3dena.contract.v1"],
      implementationActorIds: ["compute-implementer-v10"],
      artifacts,
    },
    schemaBundle: { index, schemas },
    publicKeyRegistry: {
      path: `${publicKeyOutputDirectory}/build-approval-public-keys.json`,
      sha256: sha256(publicKeyRegistryText),
    },
  };
  const inputPath = join(root, "inputs/materialization.json");
  await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`);
  return {
    root,
    inputPath,
    outputDirectory: "output/release-v10",
    publicKeyInputPath,
    publicKeyOutputDirectory,
  };
}

async function materializePublicKeys(testFixture: Fixture): Promise<void> {
  await execute(process.execPath, [
    publicKeyMaterializerPath,
    testFixture.publicKeyInputPath,
    testFixture.publicKeyOutputDirectory,
  ], { cwd: testFixture.root });
  await execute(process.execPath, [
    publicKeyVerifierPath,
    join(
      testFixture.publicKeyOutputDirectory,
      "build-approval-public-keys-manifest.json",
    ),
  ], { cwd: testFixture.root });
}

describe("BuildApproval candidate input materialization", () => {
  it("materializes and verifies the public-key registry before any image identity exists", async () => {
    const testFixture = await fixture();
    try {
      const candidateInput = JSON.parse(await readFile(testFixture.inputPath, "utf8"));
      delete candidateInput.candidate.flyImageDigest;
      delete candidateInput.candidate.flyBuildId;
      await writeFile(testFixture.inputPath, `${JSON.stringify(candidateInput, null, 2)}\n`);

      await materializePublicKeys(testFixture);
      const registryRoot = join(testFixture.root, testFixture.publicKeyOutputDirectory);
      expect((await readdir(registryRoot)).sort()).toEqual([
        "build-approval-public-keys-manifest.json",
        "build-approval-public-keys.json",
      ]);
      const registry = JSON.parse(await readFile(
        join(registryRoot, "build-approval-public-keys.json"),
        "utf8",
      ));
      expect(Object.keys(registry)).toEqual(["release-key-20260826"]);
      expect(registry["release-key-20260826"]).toMatchObject({
        algorithm: "Ed25519",
        allowedEnvironments: ["production"],
        reviewerId: "reviewer-independent-20260826",
        role: "independent-reviewer",
      });
      expect(registry["release-key-20260826"].publicKeyPem)
        .toMatch(/^-----BEGIN PUBLIC KEY-----/u);
    } finally {
      await rm(testFixture.root, { recursive: true, force: true });
    }
  });

  it("materializes deterministic schema and hash-pinned candidate input without approval authority", async () => {
    const testFixture = await fixture();
    try {
      await materializePublicKeys(testFixture);
      await execute(process.execPath, [
        materializerPath,
        testFixture.inputPath,
        testFixture.outputDirectory,
      ], { cwd: testFixture.root });

      const outputRoot = join(testFixture.root, testFixture.outputDirectory);
      expect((await readdir(outputRoot)).sort()).toEqual([
        "build-approval-candidate-input.json",
        "build-approval-materialization-manifest.json",
        "schema-bundle.json",
      ]);
      const firstBytes = Object.fromEntries(await Promise.all(
        (await readdir(outputRoot)).sort().map(async (name) => [
          name,
          await readFile(join(outputRoot, name), "utf8"),
        ]),
      ));
      await execute(process.execPath, [
        verifierPath,
        join(testFixture.outputDirectory, "build-approval-materialization-manifest.json"),
      ], { cwd: testFixture.root });

      const manifest = JSON.parse(
        firstBytes["build-approval-materialization-manifest.json"]!,
      );
      expect(manifest.input.candidate.artifacts.analysisTarball).toEqual({
        path: "artifacts/analysis.tgz",
        sha256: sha256("analysis-v10"),
      });
      expect(manifest.outputs.schemaBundle).toMatchObject({
        path: "output/release-v10/schema-bundle.json",
        sha256: sha256(firstBytes["schema-bundle.json"]!),
      });
      expect(manifest.input.publicKeyRegistry).toEqual({
        path: "registry/release-v10/build-approval-public-keys.json",
        sha256: sha256(await readFile(join(
          testFixture.root,
          "registry/release-v10/build-approval-public-keys.json",
        ))),
      });
      const candidateInput = JSON.parse(
        firstBytes["build-approval-candidate-input.json"]!,
      );
      expect(candidateInput.artifacts.analysisTarball).toEqual({
        path: "artifacts/analysis.tgz",
        sha256: sha256("analysis-v10"),
      });
      expect(candidateInput.artifacts.schemaBundle).toEqual({
        path: "output/release-v10/schema-bundle.json",
        sha256: sha256(firstBytes["schema-bundle.json"]!),
      });
      expect(candidateInput.publicKeyRegistry).toEqual(
        manifest.input.publicKeyRegistry,
      );
      expect(candidateInput.migrations[0]).toEqual({
        version: "0001-persistent-compute",
        path: "migrations/0001.sql",
        sha256: sha256("migration-one"),
      });
      expect(firstBytes["build-approval-candidate-input.json"]).not.toMatch(
        /approvedAt|reviewerId|signatureAlgorithm|signatureBase64|activation/iu,
      );

      await rm(outputRoot, { recursive: true, force: true });
      await execute(process.execPath, [
        materializerPath,
        testFixture.inputPath,
        testFixture.outputDirectory,
      ], { cwd: testFixture.root });
      const secondBytes = Object.fromEntries(await Promise.all(
        (await readdir(outputRoot)).sort().map(async (name) => [
          name,
          await readFile(join(outputRoot, name), "utf8"),
        ]),
      ));
      expect(secondBytes).toEqual(firstBytes);

      const materializationManifestPath = join(
        outputRoot,
        "build-approval-materialization-manifest.json",
      );
      const materializationManifestBytes = await readFile(materializationManifestPath);
      const candidateOutputPath = join(outputRoot, "unsigned-candidate.json");
      await execute(process.execPath, [
        candidatePath,
        materializationManifestPath,
        sha256(materializationManifestBytes),
        candidateOutputPath,
      ], { cwd: testFixture.root });
      const receipt = JSON.parse(await readFile(candidateOutputPath, "utf8"));
      expect(receipt.candidate.version).toBe("3dena.build-approval-candidate.v4");
      expect(receipt.materializationManifestSha256).toBe(
        sha256(materializationManifestBytes),
      );
      expect(receipt.publicKeyRegistrySha256).toBe(
        manifest.input.publicKeyRegistry.sha256,
      );
      expect(receipt.candidate.materializationManifestSha256)
        .toBe(receipt.materializationManifestSha256);
      expect(receipt.candidate.publicKeyRegistrySha256)
        .toBe(receipt.publicKeyRegistrySha256);
    } finally {
      await rm(testFixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a placeholder-like external commit before materialization", async () => {
    const testFixture = await fixture();
    try {
      const input = JSON.parse(await readFile(testFixture.inputPath, "utf8"));
      input.candidate.gitCommit = "a".repeat(40);
      await writeFile(testFixture.inputPath, `${JSON.stringify(input, null, 2)}\n`);

      await expect(execute(process.execPath, [
        materializerPath,
        testFixture.inputPath,
        testFixture.outputDirectory,
      ], { cwd: testFixture.root })).rejects.toThrow(/placeholder|commit/iu);
      expect(await readdir(join(testFixture.root, "output"))).toEqual([]);
    } finally {
      await rm(testFixture.root, { recursive: true, force: true });
    }
  });

  it("rejects source drift after materialization verification and before candidate creation", async () => {
    const testFixture = await fixture();
    try {
      await materializePublicKeys(testFixture);
      await execute(process.execPath, [
        materializerPath,
        testFixture.inputPath,
        testFixture.outputDirectory,
      ], { cwd: testFixture.root });
      await execute(process.execPath, [
        verifierPath,
        join(testFixture.outputDirectory, "build-approval-materialization-manifest.json"),
      ], { cwd: testFixture.root });

      await writeFile(join(testFixture.root, "artifacts/analysis.tgz"), "post-verify-drift");
      const outputRoot = join(testFixture.root, testFixture.outputDirectory);
      const materializationManifestPath = join(
        outputRoot,
        "build-approval-materialization-manifest.json",
      );
      await expect(execute(process.execPath, [
        candidatePath,
        materializationManifestPath,
        sha256(await readFile(materializationManifestPath)),
        join(outputRoot, "unsigned-candidate.json"),
      ], { cwd: testFixture.root })).rejects.toThrow(/expected.*observed/iu);
      expect((await readdir(outputRoot)).sort()).toEqual([
        "build-approval-candidate-input.json",
        "build-approval-materialization-manifest.json",
        "schema-bundle.json",
      ]);
    } finally {
      await rm(testFixture.root, { recursive: true, force: true });
    }
  });

  it("rejects unknown input fields before creating output", async () => {
    const testFixture = await fixture();
    try {
      const input = JSON.parse(await readFile(testFixture.inputPath, "utf8"));
      input.candidate.reviewerId = "not-authorized-here";
      await writeFile(testFixture.inputPath, `${JSON.stringify(input, null, 2)}\n`);
      await expect(execute(process.execPath, [
        materializerPath,
        testFixture.inputPath,
        testFixture.outputDirectory,
      ], { cwd: testFixture.root })).rejects.toThrow(/fields are not exact/iu);
      expect(await readdir(join(testFixture.root, "output"))).toEqual([]);
    } finally {
      await rm(testFixture.root, { recursive: true, force: true });
    }
  });

  it("rejects escape-equivalent duplicate keys before materializing any output", async () => {
    const testFixture = await fixture();
    try {
      const inputText = await readFile(testFixture.inputPath, "utf8");
      await writeFile(
        testFixture.inputPath,
        inputText.replace(
          '"schemaVersion": "3dena.build-approval-materialization-input.v1",',
          '"schemaVersion":"3dena.build-approval-materialization-input.v1",' +
            '"\\u0073chemaVersion":"3dena.build-approval-materialization-input.v1",',
        ),
      );
      await expect(execute(process.execPath, [
        materializerPath,
        testFixture.inputPath,
        testFixture.outputDirectory,
      ], { cwd: testFixture.root })).rejects.toThrow(/strict JSON|duplicate object keys/iu);
      expect(await readdir(join(testFixture.root, "output"))).toEqual([]);
    } finally {
      await rm(testFixture.root, { recursive: true, force: true });
    }
  });

  it("rejects escape-equivalent duplicate keys in public-key materialization input", async () => {
    const testFixture = await fixture();
    try {
      const inputText = await readFile(testFixture.publicKeyInputPath, "utf8");
      await writeFile(
        testFixture.publicKeyInputPath,
        inputText.replace(
          '"publicKeys": [',
          '"publicKeys":[],' + '"\\u0070ublicKeys":[',
        ),
      );
      await expect(execute(process.execPath, [
        publicKeyMaterializerPath,
        testFixture.publicKeyInputPath,
        testFixture.publicKeyOutputDirectory,
      ], { cwd: testFixture.root })).rejects.toThrow(/strict JSON|duplicate object keys/iu);
      expect(await readdir(join(testFixture.root, "registry"))).toEqual([]);
    } finally {
      await rm(testFixture.root, { recursive: true, force: true });
    }
  });

  it("rejects escape-equivalent duplicate keys in a hash-bound schema input", async () => {
    const testFixture = await fixture();
    try {
      await materializePublicKeys(testFixture);
      const input = JSON.parse(await readFile(testFixture.inputPath, "utf8"));
      const indexPath = join(testFixture.root, input.schemaBundle.index.path);
      const indexText = await readFile(indexPath, "utf8");
      const duplicateIndexText = indexText.replace(
        '"schemas": {',
        '"schemas":{},' + '"\\u0073chemas":{',
      );
      await writeFile(indexPath, duplicateIndexText);
      input.schemaBundle.index.sha256 = sha256(duplicateIndexText);
      await writeFile(testFixture.inputPath, `${JSON.stringify(input, null, 2)}\n`);
      await expect(execute(process.execPath, [
        materializerPath,
        testFixture.inputPath,
        testFixture.outputDirectory,
      ], { cwd: testFixture.root })).rejects.toThrow(/valid JSON|strict JSON|duplicate object keys/iu);
      expect(await readdir(join(testFixture.root, "output"))).toEqual([]);
    } finally {
      await rm(testFixture.root, { recursive: true, force: true });
    }
  });

  it("rejects source-byte drift against an explicit artifact hash", async () => {
    const testFixture = await fixture();
    try {
      await materializePublicKeys(testFixture);
      await writeFile(join(testFixture.root, "artifacts/analysis.tgz"), "drifted-analysis");
      await expect(execute(process.execPath, [
        materializerPath,
        testFixture.inputPath,
        testFixture.outputDirectory,
      ], { cwd: testFixture.root })).rejects.toThrow(/expected.*observed/iu);
      expect(await readdir(join(testFixture.root, "output"))).toEqual([]);
    } finally {
      await rm(testFixture.root, { recursive: true, force: true });
    }
  });

  it("rejects sparse oversized materialization sources before hashing them", async () => {
    const cases = [
      {
        descriptor: (input: MutableMaterializationInput) =>
          input.candidate.artifacts.analysisTarball,
        maximumBytes: BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.analysisTarball,
      },
      {
        descriptor: (input: MutableMaterializationInput) =>
          input.candidate.artifacts.jenaTarball,
        maximumBytes: BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.jenaTarball,
      },
      {
        descriptor: (input: MutableMaterializationInput) =>
          input.candidate.artifacts.lockfile,
        maximumBytes: BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.lockfile,
      },
      {
        descriptor: (input: MutableMaterializationInput) =>
          input.candidate.artifacts.sbom,
        maximumBytes: BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.sbom,
      },
      {
        descriptor: (input: MutableMaterializationInput) =>
          input.candidate.migrations[0]!,
        maximumBytes: BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.migration,
      },
      {
        descriptor: (input: MutableMaterializationInput) =>
          input.schemaBundle.index,
        maximumBytes: BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.schemaIndex,
      },
      {
        descriptor: (input: MutableMaterializationInput) =>
          input.schemaBundle.schemas[0]!,
        maximumBytes: BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.schemaDocument,
      },
    ];
    for (const testCase of cases) {
      const testFixture = await fixture();
      try {
        await materializePublicKeys(testFixture);
        const input = JSON.parse(
          await readFile(testFixture.inputPath, "utf8"),
        ) as MutableMaterializationInput;
        const descriptor = testCase.descriptor(input);
        await truncate(
          join(testFixture.root, descriptor.path),
          testCase.maximumBytes + 1,
        );
        descriptor.sha256 = "a".repeat(64);
        await writeFile(testFixture.inputPath, `${JSON.stringify(input, null, 2)}\n`);
        await expect(execute(process.execPath, [
          materializerPath,
          testFixture.inputPath,
          testFixture.outputDirectory,
        ], { cwd: testFixture.root })).rejects.toThrow(/limit|exceeds/iu);
        expect(await readdir(join(testFixture.root, "output"))).toEqual([]);
      } finally {
        await rm(testFixture.root, { recursive: true, force: true });
      }
    }
  }, 30_000);

  it("refuses to overwrite an existing materialization directory", async () => {
    const testFixture = await fixture();
    try {
      await materializePublicKeys(testFixture);
      const invocation = [
        materializerPath,
        testFixture.inputPath,
        testFixture.outputDirectory,
      ];
      await execute(process.execPath, invocation, { cwd: testFixture.root });
      const manifestPath = join(
        testFixture.root,
        testFixture.outputDirectory,
        "build-approval-materialization-manifest.json",
      );
      const before = await readFile(manifestPath, "utf8");
      await expect(execute(process.execPath, invocation, {
        cwd: testFixture.root,
      })).rejects.toThrow(/exist/iu);
      expect(await readFile(manifestPath, "utf8")).toBe(before);
    } finally {
      await rm(testFixture.root, { recursive: true, force: true });
    }
  });

  it("fails verification after any materialized schema-bundle byte changes", async () => {
    const testFixture = await fixture();
    try {
      await materializePublicKeys(testFixture);
      await execute(process.execPath, [
        materializerPath,
        testFixture.inputPath,
        testFixture.outputDirectory,
      ], { cwd: testFixture.root });
      const schemaBundlePath = join(
        testFixture.root,
        testFixture.outputDirectory,
        "schema-bundle.json",
      );
      await writeFile(schemaBundlePath, `${await readFile(schemaBundlePath, "utf8")} `);
      await expect(execute(process.execPath, [
        verifierPath,
        join(testFixture.outputDirectory, "build-approval-materialization-manifest.json"),
      ], { cwd: testFixture.root })).rejects.toThrow(/bytes|explicit sources/iu);
    } finally {
      await rm(testFixture.root, { recursive: true, force: true });
    }
  });

  it("rejects private-key material even when its explicit hash matches", async () => {
    const testFixture = await fixture();
    try {
      const input = JSON.parse(await readFile(testFixture.publicKeyInputPath, "utf8"));
      const { privateKey } = generateKeyPairSync("ed25519");
      const privateKeyPem = String(privateKey.export({ format: "pem", type: "pkcs8" }));
      const privateKeyPath = join(testFixture.root, input.publicKeys[0].path);
      await writeFile(privateKeyPath, privateKeyPem);
      input.publicKeys[0].sha256 = sha256(privateKeyPem);
      await writeFile(testFixture.publicKeyInputPath, `${JSON.stringify(input, null, 2)}\n`);

      await expect(execute(process.execPath, [
        publicKeyMaterializerPath,
        testFixture.publicKeyInputPath,
        testFixture.publicKeyOutputDirectory,
      ], { cwd: testFixture.root })).rejects.toThrow(/private-key material/iu);
      expect(await readdir(join(testFixture.root, "registry"))).toEqual([]);
    } finally {
      await rm(testFixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a symlink source replacement even when the target bytes preserve the hash", async () => {
    const testFixture = await fixture();
    try {
      await materializePublicKeys(testFixture);
      const sourcePath = join(testFixture.root, "artifacts/analysis.tgz");
      const replacementPath = join(testFixture.root, "artifacts/analysis-real.tgz");
      await writeFile(replacementPath, "analysis-v10");
      await rm(sourcePath);
      await symlink("analysis-real.tgz", sourcePath);
      await expect(execute(process.execPath, [
        materializerPath,
        testFixture.inputPath,
        testFixture.outputDirectory,
      ], { cwd: testFixture.root })).rejects.toThrow(/symbolic|symlink|secure open/iu);
      expect(await readdir(join(testFixture.root, "output"))).toEqual([]);
    } finally {
      await rm(testFixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked output parent instead of writing through it", async () => {
    const testFixture = await fixture();
    try {
      await materializePublicKeys(testFixture);
      await symlink("output", join(testFixture.root, "output-link"));
      await expect(execute(process.execPath, [
        materializerPath,
        testFixture.inputPath,
        "output-link/release-v10",
      ], { cwd: testFixture.root })).rejects.toThrow(/output|symbolic|symlink/iu);
      expect(await readdir(join(testFixture.root, "output"))).toEqual([]);
    } finally {
      await rm(testFixture.root, { recursive: true, force: true });
    }
  });

  it("refuses to materialize a canonical public-key registry larger than 128 KiB", async () => {
    const testFixture = await fixture();
    try {
      const input = JSON.parse(await readFile(testFixture.publicKeyInputPath, "utf8"));
      input.publicKeys = Array.from({ length: 1_024 }, (_, index) => ({
        publicKeyId: `release-key-${String(index).padStart(4, "0")}`,
        allowedEnvironments: ["production"],
        reviewerId: `reviewer-${String(index).padStart(4, "0")}`,
        role: "independent-reviewer",
        path: input.publicKeys[0].path,
        sha256: input.publicKeys[0].sha256,
      }));
      await writeFile(testFixture.publicKeyInputPath, `${JSON.stringify(input, null, 2)}\n`);
      await expect(execute(process.execPath, [
        publicKeyMaterializerPath,
        testFixture.publicKeyInputPath,
        testFixture.publicKeyOutputDirectory,
      ], { cwd: testFixture.root })).rejects.toThrow(/128 KiB|public-key registry/iu);
      expect(await readdir(join(testFixture.root, "registry"))).toEqual([]);
    } finally {
      await rm(testFixture.root, { recursive: true, force: true });
    }
  }, 30_000);
});
