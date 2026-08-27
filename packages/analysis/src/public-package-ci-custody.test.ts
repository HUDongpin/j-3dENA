import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

const SOURCE_HEAD = "a".repeat(40);
const TARBALL_ARTIFACT_ID = 101;
const RECEIPT_ARTIFACT_ID = 102;
const PRODUCER_RUN_ID = 201;
const REPOSITORY_ID = 301;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sri512(bytes: Uint8Array): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

async function custodyContract() {
  // @ts-expect-error The CI custody MJS authority intentionally has no declaration file.
  return import("../scripts/public-package-ci-custody.mjs");
}

function fixture() {
  const tarballBytes = Buffer.from("trusted producer tarball bytes\n");
  const tarballSha256 = sha256(tarballBytes);
  const artifactReceipt = {
    schemaVersion: "3dena.public-package-artifact-receipt.v2",
    source: { repositoryHead: SOURCE_HEAD },
    package: {
      name: "j-3dena",
      version: "0.2.0-implemented-unverified.12",
      buildId: SOURCE_HEAD,
    },
    tree: {
      serialization: "3dena.regular-file-tree.path-mode-length-bytes.v1",
      sha256: "b".repeat(64),
      fileCount: 1,
      byteLength: 1,
    },
    tarball: {
      filename: "j-3dena-0.2.0-implemented-unverified.12.tgz",
      byteLength: tarballBytes.length,
      sha256: tarballSha256,
      integrity: sri512(tarballBytes),
    },
    npmPack: {
      id: "j-3dena@0.2.0-implemented-unverified.12",
      name: "j-3dena",
      version: "0.2.0-implemented-unverified.12",
      size: tarballBytes.length,
      unpackedSize: 1,
      shasum: createHash("sha1").update(tarballBytes).digest("hex"),
      integrity: sri512(tarballBytes),
      filename: "j-3dena-0.2.0-implemented-unverified.12.tgz",
      files: [{ path: "index.js", size: 1, mode: 0o644 }],
      entryCount: 1,
      bundled: [],
    },
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(artifactReceipt)}\n`);
  const manifest = {
    schemaVersion: "3dena.public-package-ci-custody.v1",
    repository: "HUDongpin/j-3dENA",
    workflowPath: ".github/workflows/ci.yml",
    sourceHead: SOURCE_HEAD,
    producerRunId: PRODUCER_RUN_ID,
    producerRunAttempt: 1,
    tarball: {
      artifactId: TARBALL_ARTIFACT_ID,
      sha256: tarballSha256,
    },
    receipt: {
      artifactId: RECEIPT_ARTIFACT_ID,
      sha256: sha256(receiptBytes),
    },
  };
  const run = {
    id: PRODUCER_RUN_ID,
    run_attempt: 1,
    status: "completed",
    conclusion: "success",
    event: "pull_request",
    path: ".github/workflows/ci.yml",
    head_sha: SOURCE_HEAD,
    repository: {
      id: REPOSITORY_ID,
      full_name: "HUDongpin/j-3dENA",
    },
  };
  const artifact = (id: number, digest: string, name: string) => ({
    id,
    name,
    expired: false,
    digest: `sha256:${digest}`,
    workflow_run: {
      id: PRODUCER_RUN_ID,
      repository_id: REPOSITORY_ID,
      head_repository_id: REPOSITORY_ID,
      head_sha: SOURCE_HEAD,
    },
  });
  return {
    artifactReceipt,
    manifest,
    run,
    tarballArtifact: artifact(
      TARBALL_ARTIFACT_ID,
      manifest.tarball.sha256,
      "j-3dena-0.2.0-implemented-unverified.12.tgz",
    ),
    receiptArtifact: artifact(
      RECEIPT_ARTIFACT_ID,
      manifest.receipt.sha256,
      "j-3dena-0.2.0-implemented-unverified.12.tgz.artifact-receipt.json",
    ),
    tarballBytes,
    receiptBytes,
  };
}

describe("public package CI custody manifest", () => {
  it("accepts only the exact trusted-repository manifest schema", async () => {
    const { validatePublicPackageCiCustodyV1 } = await custodyContract();
    const { manifest } = fixture();
    expect(validatePublicPackageCiCustodyV1(manifest)).toBe(manifest);

    const mutations = [
      { ...manifest, unknown: true },
      { ...manifest, repository: "attacker/fork" },
      { ...manifest, workflowPath: ".github/workflows/untrusted.yml" },
      { ...manifest, producerRunId: "201" },
      { ...manifest, producerRunAttempt: 0 },
      { ...manifest, tarball: { ...manifest.tarball, unknown: true } },
      { ...manifest, receipt: { ...manifest.receipt, artifactId: TARBALL_ARTIFACT_ID } },
    ];
    for (const mutation of mutations) {
      expect(() => validatePublicPackageCiCustodyV1(mutation)).toThrow(/CI_CUSTODY_INVALID/u);
    }
  });

  it("rejects a custody manifest from workflow run attempt 2", async () => {
    const { validatePublicPackageCiCustodyV1 } = await custodyContract();
    const { manifest } = fixture();

    expect(() => validatePublicPackageCiCustodyV1({
      ...manifest,
      producerRunAttempt: 2,
    })).toThrow(/producerRunAttempt must equal 1/u);
  });

  it("binds tracked tarball and receipt bytes to exact S", async () => {
    const { verifyLocalPublicPackageCiCustodyV1 } = await custodyContract();
    const value = fixture();
    await expect(verifyLocalPublicPackageCiCustodyV1(value)).resolves.toMatchObject({
      sourceHead: SOURCE_HEAD,
      producerRunId: PRODUCER_RUN_ID,
    });
    await expect(verifyLocalPublicPackageCiCustodyV1({
      ...value,
      tarballBytes: Buffer.from("attacker tarball\n"),
    })).rejects.toThrow(/tarball SHA-256/u);

    const wrongReceipt = {
      ...value.artifactReceipt,
      source: { repositoryHead: "c".repeat(40) },
      package: { ...value.artifactReceipt.package, buildId: "c".repeat(40) },
    };
    const wrongReceiptBytes = Buffer.from(`${JSON.stringify(wrongReceipt)}\n`);
    await expect(verifyLocalPublicPackageCiCustodyV1({
      ...value,
      manifest: {
        ...value.manifest,
        receipt: { ...value.manifest.receipt, sha256: sha256(wrongReceiptBytes) },
      },
      receiptBytes: wrongReceiptBytes,
    })).rejects.toThrow(/receipt source/u);
  });
});

describe("trusted GitHub Actions producer custody", () => {
  it("accepts only a completed successful exact-S run and its numeric artifacts", async () => {
    const { verifyGitHubPublicPackageCiCustodyV1 } = await custodyContract();
    const value = fixture();
    expect(verifyGitHubPublicPackageCiCustodyV1(value)).toMatchObject({
      sourceHead: SOURCE_HEAD,
      producerRunId: PRODUCER_RUN_ID,
      tarballArtifactId: TARBALL_ARTIFACT_ID,
      receiptArtifactId: RECEIPT_ARTIFACT_ID,
    });
  });

  it("rejects forged run repository, workflow, head, attempt, or outcome", async () => {
    const { verifyGitHubPublicPackageCiCustodyV1 } = await custodyContract();
    const value = fixture();
    const runMutations = [
      { ...value.run, id: 999 },
      { ...value.run, run_attempt: 2 },
      { ...value.run, status: "in_progress" },
      { ...value.run, conclusion: "failure" },
      { ...value.run, path: ".github/workflows/untrusted.yml" },
      { ...value.run, head_sha: "c".repeat(40) },
      { ...value.run, repository: { ...value.run.repository, full_name: "attacker/fork" } },
    ];
    for (const run of runMutations) {
      expect(() => verifyGitHubPublicPackageCiCustodyV1({ ...value, run }))
        .toThrow(/CI_CUSTODY_INVALID/u);
    }
  });

  it("rejects cross-attempt reuse even when artifact workflow metadata says attempt 1", async () => {
    const { verifyGitHubPublicPackageCiCustodyV1 } = await custodyContract();
    const value = fixture();
    const artifactFromAttemptOne = <T extends typeof value.tarballArtifact>(artifact: T): T => ({
      ...artifact,
      workflow_run: {
        ...artifact.workflow_run,
        run_attempt: 1,
      },
    });

    expect(() => verifyGitHubPublicPackageCiCustodyV1({
      ...value,
      manifest: { ...value.manifest, producerRunAttempt: 2 },
      run: { ...value.run, run_attempt: 2 },
      tarballArtifact: artifactFromAttemptOne(value.tarballArtifact),
      receiptArtifact: artifactFromAttemptOne(value.receiptArtifact),
    })).toThrow(/producerRunAttempt must equal 1/u);
  });

  it("rejects wrong, expired, cross-run, cross-repository, or digest-mismatched artifacts", async () => {
    const { verifyGitHubPublicPackageCiCustodyV1 } = await custodyContract();
    const value = fixture();
    const artifactMutations = [
      { ...value.tarballArtifact, id: 999 },
      { ...value.tarballArtifact, name: value.receiptArtifact.name },
      { ...value.tarballArtifact, expired: true },
      { ...value.tarballArtifact, digest: "sha256:" + "d".repeat(64) },
      { ...value.tarballArtifact, digest: value.manifest.tarball.sha256 },
      {
        ...value.tarballArtifact,
        workflow_run: { ...value.tarballArtifact.workflow_run, id: 999 },
      },
      {
        ...value.tarballArtifact,
        workflow_run: { ...value.tarballArtifact.workflow_run, repository_id: 999 },
      },
      {
        ...value.tarballArtifact,
        workflow_run: { ...value.tarballArtifact.workflow_run, head_sha: "d".repeat(40) },
      },
    ];
    for (const tarballArtifact of artifactMutations) {
      expect(() => verifyGitHubPublicPackageCiCustodyV1({ ...value, tarballArtifact }))
        .toThrow(/CI_CUSTODY_INVALID/u);
    }
  });
});
