import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The source-controlled verifier is JavaScript used by release scripts and has
// no declaration file; the test intentionally exercises that runtime module.
// @ts-expect-error release verifier is an MJS build-script module.
import * as publicPackageVerifier from "../scripts/verify-public-package.mjs";

function sha256(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("public package provenance verifier", () => {
  it("binds provenance repositoryHead and package buildId to receipt source S", () => {
    const verifySourceBinding = (
      publicPackageVerifier as typeof publicPackageVerifier & {
        verifyPublicPackageSourceBinding?: (
          provenance: Record<string, unknown>,
          options: { artifactReceipt: Record<string, unknown> },
        ) => string;
      }
    ).verifyPublicPackageSourceBinding;
    expect(verifySourceBinding).toBeTypeOf("function");
    if (!verifySourceBinding) return;
    const sourceHead = "a".repeat(40);
    const artifactReceipt = {
      schemaVersion: "3dena.public-package-artifact-receipt.v2",
      source: { repositoryHead: sourceHead },
      package: { name: "j-3dena", version: "0.0.0-test", buildId: sourceHead },
      tree: {
        serialization: "3dena.regular-file-tree.path-mode-length-bytes.v1",
        sha256: "b".repeat(64),
        fileCount: 1,
        byteLength: 1,
      },
      tarball: {
        filename: "j-3dena-0.0.0-test.tgz",
        byteLength: 1,
        sha256: "c".repeat(64),
        integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
      },
      npmPack: {
        id: "j-3dena@0.0.0-test",
        name: "j-3dena",
        version: "0.0.0-test",
        size: 1,
        unpackedSize: 1,
        shasum: "d".repeat(40),
        integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
        filename: "j-3dena-0.0.0-test.tgz",
        files: [{ path: "index.js", size: 1, mode: 0o644 }],
        entryCount: 1,
        bundled: [],
      },
    };
    const provenance = {
      source: { repositoryHead: sourceHead },
      package: { name: "j-3dena", version: "0.0.0-test", buildId: sourceHead },
    };

    expect(verifySourceBinding(provenance, { artifactReceipt })).toBe(sourceHead);
    expect(() => verifySourceBinding({
      ...provenance,
      package: { ...provenance.package, buildId: "e".repeat(40) },
    }, { artifactReceipt })).toThrow(/source repositoryHead, package buildId, and receipt source must be identical/u);
  });

  it("rejects a source map whose bytes do not match the provenance receipt", async () => {
    const verifyArtifactDigests = (
      publicPackageVerifier as typeof publicPackageVerifier & {
        verifyPublicPackageArtifactDigests?: (
          directory: string,
          provenance: { artifacts: Record<string, string> },
        ) => Promise<void>;
      }
    ).verifyPublicPackageArtifactDigests;
    expect(verifyArtifactDigests).toBeTypeOf("function");
    if (!verifyArtifactDigests) return;

    const directory = await mkdtemp(join(tmpdir(), "3dena-public-package-verifier-"));
    try {
      await writeFile(join(directory, "index.js"), "export const value = 1;\n");
      await writeFile(join(directory, "index.js.map"), "{\"version\":3}\n");
      await mkdir(join(directory, "schemas"));
      await writeFile(join(directory, "schemas", "index.json"), "{\"schemaVersion\":\"test\"}\n");
      const provenance = {
        artifacts: {
          indexJsSha256: sha256("export const value = 1;\n"),
          indexJsMapSha256: "0".repeat(64),
          schemaIndexSha256: sha256("{\"schemaVersion\":\"test\"}\n"),
        },
      };

      await expect(verifyArtifactDigests(directory, provenance)).rejects.toThrow(/source-map digest does not match provenance/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
