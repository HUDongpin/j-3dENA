import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

// The receipt module is JavaScript because it is consumed directly by release
// jobs and the package smoke runner.
// @ts-expect-error The MJS release helper intentionally has no declaration file.
import * as artifactContract from "../scripts/public-package-artifact-receipt.mjs";

const {
  PUBLIC_PACKAGE_ARTIFACT_RECEIPT_SCHEMA_V2,
  comparePublicPackageTrees,
  createPublicPackageArtifactReceiptV2,
  hashRegularFileTree,
  verifyPublicPackageArtifactReceiptV2,
} = artifactContract;
// @ts-expect-error The MJS release generator intentionally has no declaration file.
import { generatePublicPackageArtifact } from "../scripts/generate-public-package-artifact.mjs";

const SOURCE_HEAD = "a".repeat(40);
const PACKAGE_NAME = "j-3dena";
const PACKAGE_VERSION = "0.0.0-receipt-test";

function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  const text = value.toString(8).padStart(length - 1, "0") + "\0";
  buffer.write(text, offset, length, "ascii");
}

function tarHeader(path: string, mode: number, size: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(`package/${path}`, 0, 100, "utf8");
  writeOctal(header, 100, 8, mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write("0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumText = checksum.toString(8).padStart(6, "0");
  header.write(checksumText, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function createTarball(entries: readonly { path: string; mode: number; bytes: Buffer }[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    chunks.push(tarHeader(entry.path, entry.mode, entry.bytes.length), entry.bytes);
    const padding = (512 - entry.bytes.length % 512) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 } as unknown as Parameters<typeof gzipSync>[1]);
}

async function artifactFixture(): Promise<{
  directory: string;
  tarballPath: string;
  npmPackReceipt: Record<string, unknown>;
}> {
  const root = await mkdtemp(join(tmpdir(), "3dena-public-artifact-receipt-"));
  const directory = join(root, "package");
  await mkdir(join(directory, "nested"), { recursive: true });
  const manifestBytes = Buffer.from(`${JSON.stringify({ name: PACKAGE_NAME, version: PACKAGE_VERSION })}\n`);
  const provenanceBytes = Buffer.from(`${JSON.stringify({
    package: { name: PACKAGE_NAME, version: PACKAGE_VERSION, buildId: SOURCE_HEAD },
    source: { repositoryHead: SOURCE_HEAD },
  })}\n`);
  const runtimeBytes = Buffer.from("export const value = 1;\n");
  const entries = [
    { path: "package.json", mode: 0o644, bytes: manifestBytes },
    { path: "PROVENANCE.json", mode: 0o644, bytes: provenanceBytes },
    { path: "nested/\uE000.js", mode: 0o644, bytes: runtimeBytes },
    { path: "nested/\u{10000}.js", mode: 0o644, bytes: runtimeBytes },
  ];
  for (const entry of entries) await writeFile(join(directory, entry.path), entry.bytes, { mode: entry.mode });

  const tarballBytes = createTarball(entries);
  const filename = `${PACKAGE_NAME}-${PACKAGE_VERSION}.tgz`;
  const tarballPath = join(root, filename);
  await writeFile(tarballPath, tarballBytes);
  const npmPackReceipt = {
    id: `${PACKAGE_NAME}@${PACKAGE_VERSION}`,
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    size: tarballBytes.length,
    unpackedSize: entries.reduce((sum, entry) => sum + entry.bytes.length, 0),
    shasum: createHash("sha1").update(tarballBytes).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(tarballBytes).digest("base64")}`,
    filename,
    files: entries
      .map(({ path, mode, bytes }) => ({ path, size: bytes.length, mode }))
      .sort((left, right) => {
        const leftPoints = Array.from(left.path, (value) => value.codePointAt(0) ?? 0);
        const rightPoints = Array.from(right.path, (value) => value.codePointAt(0) ?? 0);
        for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
          if (leftPoints[index] !== rightPoints[index]) return leftPoints[index]! - rightPoints[index]!;
        }
        return leftPoints.length - rightPoints.length;
      }),
    entryCount: entries.length,
    bundled: [],
  };
  return { directory, tarballPath, npmPackReceipt };
}

describe("public package artifact receipt v2", () => {
  it("hashes the whole regular-file tree using stable path, mode, length, and bytes", async () => {
    const first = await artifactFixture();
    const second = await artifactFixture();
    try {
      expect(await hashRegularFileTree(first.directory)).toEqual(await hashRegularFileTree(second.directory));
      await writeFile(join(second.directory, "nested/\uE000.js"), "export const value = 2;\n");
      expect((await hashRegularFileTree(first.directory)).sha256)
        .not.toBe((await hashRegularFileTree(second.directory)).sha256);
    } finally {
      await rm(join(first.directory, ".."), { recursive: true, force: true });
      await rm(join(second.directory, ".."), { recursive: true, force: true });
    }
  });

  it("rejects non-regular entries instead of following them", async () => {
    const fixture = await artifactFixture();
    try {
      await symlink("package.json", join(fixture.directory, "manifest-link"));
      await expect(hashRegularFileTree(fixture.directory)).rejects.toThrow(/unsupported filesystem entry manifest-link/u);
    } finally {
      await rm(join(fixture.directory, ".."), { recursive: true, force: true });
    }
  });

  it("generates and validates a receipt binding source, package tree, tarball, SRI, and npm pack output", async () => {
    const fixture = await artifactFixture();
    try {
      const receipt = await createPublicPackageArtifactReceiptV2({
        packageDirectory: fixture.directory,
        tarballPath: fixture.tarballPath,
        npmPackReceipt: fixture.npmPackReceipt,
        sourceHead: SOURCE_HEAD,
      });
      expect(receipt).toMatchObject({
        schemaVersion: PUBLIC_PACKAGE_ARTIFACT_RECEIPT_SCHEMA_V2,
        source: { repositoryHead: SOURCE_HEAD },
        package: { name: PACKAGE_NAME, version: PACKAGE_VERSION, buildId: SOURCE_HEAD },
        tarball: { filename: basename(fixture.tarballPath) },
        npmPack: fixture.npmPackReceipt,
      });
      await expect(verifyPublicPackageArtifactReceiptV2({
        receipt,
        packageDirectory: fixture.directory,
        tarballPath: fixture.tarballPath,
      })).resolves.toMatchObject({ sourceHead: SOURCE_HEAD, packageVersion: PACKAGE_VERSION });
    } finally {
      await rm(join(fixture.directory, ".."), { recursive: true, force: true });
    }
  });

  it("canonicalizes unordered npm pack files without weakening receipt verification", async () => {
    const fixture = await artifactFixture();
    try {
      const canonicalFiles = fixture.npmPackReceipt.files as Array<{ path: string; size: number; mode: number }>;
      const reversedFiles = [...canonicalFiles].reverse();
      const unorderedPackReceipt = { ...fixture.npmPackReceipt, files: reversedFiles };
      const receipt = await createPublicPackageArtifactReceiptV2({
        packageDirectory: fixture.directory,
        tarballPath: fixture.tarballPath,
        npmPackReceipt: unorderedPackReceipt,
        sourceHead: SOURCE_HEAD,
      });

      expect(receipt.npmPack.files).toEqual(canonicalFiles);
      expect(unorderedPackReceipt.files).toEqual(reversedFiles);
      await expect(verifyPublicPackageArtifactReceiptV2({
        receipt,
        packageDirectory: fixture.directory,
        tarballPath: fixture.tarballPath,
      })).resolves.toMatchObject({ sourceHead: SOURCE_HEAD });

      const nonCanonicalReceipt = {
        ...receipt,
        npmPack: { ...receipt.npmPack, files: [...receipt.npmPack.files].reverse() },
      };
      await expect(verifyPublicPackageArtifactReceiptV2({ receipt: nonCanonicalReceipt }))
        .rejects.toThrow(/unique code-point path order/u);

      const duplicate = canonicalFiles[0]!;
      await expect(createPublicPackageArtifactReceiptV2({
        packageDirectory: fixture.directory,
        tarballPath: fixture.tarballPath,
        npmPackReceipt: {
          ...fixture.npmPackReceipt,
          files: [...reversedFiles, { ...duplicate }],
          entryCount: canonicalFiles.length + 1,
          unpackedSize: Number(fixture.npmPackReceipt.unpackedSize) + duplicate.size,
        },
        sourceHead: SOURCE_HEAD,
      })).rejects.toThrow(/unique code-point path order/u);
    } finally {
      await rm(join(fixture.directory, ".."), { recursive: true, force: true });
    }
  });

  it("rejects unknown fields at every receipt boundary", async () => {
    const fixture = await artifactFixture();
    try {
      const receipt = await createPublicPackageArtifactReceiptV2({
        packageDirectory: fixture.directory,
        tarballPath: fixture.tarballPath,
        npmPackReceipt: fixture.npmPackReceipt,
        sourceHead: SOURCE_HEAD,
      });
      const mutations = [
        { ...receipt, unknown: true },
        { ...receipt, source: { ...receipt.source, unknown: true } },
        { ...receipt, tree: { ...receipt.tree, unknown: true } },
        { ...receipt, tarball: { ...receipt.tarball, unknown: true } },
        { ...receipt, npmPack: { ...receipt.npmPack, unknown: true } },
        {
          ...receipt,
          npmPack: {
            ...receipt.npmPack,
            files: [{ ...receipt.npmPack.files[0], unknown: true }, ...receipt.npmPack.files.slice(1)],
          },
        },
      ];
      for (const mutation of mutations) {
        await expect(verifyPublicPackageArtifactReceiptV2({
          receipt: mutation,
          packageDirectory: fixture.directory,
          tarballPath: fixture.tarballPath,
        })).rejects.toThrow(/unknown field/u);
      }
    } finally {
      await rm(join(fixture.directory, ".."), { recursive: true, force: true });
    }
  });

  it("rejects any package-tree, tarball, or source-anchor mismatch", async () => {
    const fixture = await artifactFixture();
    try {
      const receipt = await createPublicPackageArtifactReceiptV2({
        packageDirectory: fixture.directory,
        tarballPath: fixture.tarballPath,
        npmPackReceipt: fixture.npmPackReceipt,
        sourceHead: SOURCE_HEAD,
      });
      await writeFile(join(fixture.directory, "nested/\uE000.js"), "tampered\n");
      await expect(verifyPublicPackageArtifactReceiptV2({
        receipt,
        packageDirectory: fixture.directory,
        tarballPath: fixture.tarballPath,
      })).rejects.toThrow(/package tree does not match the receipt/u);

      await writeFile(fixture.tarballPath, "tampered tarball");
      await expect(verifyPublicPackageArtifactReceiptV2({ receipt, tarballPath: fixture.tarballPath }))
        .rejects.toThrow(/tarball SHA-256 does not match the receipt/u);

      const wrongSource = { ...receipt, source: { repositoryHead: "b".repeat(40) } };
      await expect(verifyPublicPackageArtifactReceiptV2({ receipt: wrongSource }))
        .rejects.toThrow(/source repositoryHead must equal package buildId/u);
    } finally {
      await rm(join(fixture.directory, ".."), { recursive: true, force: true });
    }
  });

  it("performs an exact path, mode, length, and byte comparison between two trees", async () => {
    const first = await artifactFixture();
    const second = await artifactFixture();
    try {
      await expect(comparePublicPackageTrees(first.directory, second.directory)).resolves.toMatchObject({ identical: true });
      await writeFile(join(second.directory, "nested/\u{10000}.js"), "different but same purpose\n");
      await expect(comparePublicPackageTrees(first.directory, second.directory))
        .rejects.toThrow(/file bytes differ/u);
    } finally {
      await rm(join(first.directory, ".."), { recursive: true, force: true });
      await rm(join(second.directory, ".."), { recursive: true, force: true });
    }
  });

  it("runs one npm pack operation and writes the strict v2 receipt beside its tarball", async () => {
    const fixture = await artifactFixture();
    const outputDirectory = join(fixture.directory, "..");
    const packCalls: string[][] = [];
    try {
      const result = await generatePublicPackageArtifact({
        repositoryRoot: outputDirectory,
        packageDirectory: fixture.directory,
        outputDirectory,
        readRepositoryHead: () => SOURCE_HEAD,
        verifyPackage: async () => ({ directory: fixture.directory }),
        runNpmPack: async (args: string[]) => {
          packCalls.push(args);
          return JSON.stringify([fixture.npmPackReceipt]);
        },
      });
      expect(packCalls).toEqual([[
        "pack",
        fixture.directory,
        "--json",
        "--pack-destination",
        outputDirectory,
      ]]);
      expect(result.tarballPath).toBe(fixture.tarballPath);
      expect(result.receiptPath).toBe(`${fixture.tarballPath}.artifact-receipt.json`);
      await expect(verifyPublicPackageArtifactReceiptV2({
        receipt: JSON.parse(await readFile(result.receiptPath, "utf8")),
        packageDirectory: fixture.directory,
        tarballPath: fixture.tarballPath,
      })).resolves.toMatchObject({ sourceHead: SOURCE_HEAD });
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });
});
