import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The source-controlled verifier is JavaScript used by release scripts and has
// no declaration file; the test intentionally exercises that runtime module.
// @ts-expect-error release verifier is an MJS build-script module.
import * as publicPackageVerifier from "../scripts/verify-public-package.mjs";

const publicPackageVersion = "0.2.0-implemented-unverified.7";

function createValidPublicPackageManifest(): Record<string, unknown> {
  return {
    name: "j-3dena",
    version: publicPackageVersion,
    description: "Public TypeScript analysis facade for the j-3dENA successor",
    type: "module",
    license: "GPL-3.0-only",
    sideEffects: false,
    peerDependencies: {
      "jena-js": "0.7.0-ona.0",
    },
    engines: {
      node: ">=20.9.0",
    },
    exports: {
      ".": {
        types: "./index.d.ts",
        import: "./index.js",
      },
    },
    files: [
      "index.js",
      "index.js.map",
      "index.d.ts",
      "types",
      "README.md",
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
      "THIRD_PARTY",
      "schemas",
      "PROVENANCE.json",
    ],
    publishConfig: {
      access: "public",
      provenance: true,
    },
    repository: {
      type: "git",
      url: "git+https://github.com/HUDongpin/j-3dENA.git",
    },
  };
}

function verifyManifest(manifest: Record<string, unknown>): unknown {
  const verifyPublicPackageManifest = (
    publicPackageVerifier as typeof publicPackageVerifier & {
      verifyPublicPackageManifest?: (candidate: Record<string, unknown>) => unknown;
    }
  ).verifyPublicPackageManifest;
  expect(verifyPublicPackageManifest).toBeTypeOf("function");
  if (!verifyPublicPackageManifest) return undefined;
  return verifyPublicPackageManifest(manifest);
}

function sha256(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("public package provenance verifier", () => {
  it("accepts only the exact public manifest regardless of object key order", () => {
    const manifest = createValidPublicPackageManifest();
    const reversedManifest = Object.fromEntries(Object.entries(manifest).reverse());
    reversedManifest.engines = Object.fromEntries(Object.entries(manifest.engines as Record<string, unknown>).reverse());
    reversedManifest.exports = {
      ".": Object.fromEntries(Object.entries(
        (manifest.exports as { ".": Record<string, unknown> })["."],
      ).reverse()),
    };
    reversedManifest.publishConfig = Object.fromEntries(Object.entries(manifest.publishConfig as Record<string, unknown>).reverse());
    reversedManifest.repository = Object.fromEntries(Object.entries(manifest.repository as Record<string, unknown>).reverse());

    expect(() => verifyManifest(reversedManifest)).not.toThrow();
  });

  it("rejects lifecycle scripts explicitly", () => {
    expect(() => verifyManifest({
      ...createValidPublicPackageManifest(),
      scripts: { preinstall: "node ./exfiltrate.mjs" },
    })).toThrow(/lifecycle scripts/u);
  });

  it.each([
    ["an unknown top-level field", { arbitrary: true }],
    ["development dependencies", { devDependencies: { attacker: "1.0.0" } }],
    ["peer dependency metadata", { peerDependenciesMeta: { "jena-js": { optional: true } } }],
  ])("rejects %s", (_label, addition) => {
    expect(() => verifyManifest({ ...createValidPublicPackageManifest(), ...addition })).toThrow(/PUBLIC_PACKAGE_INVALID/u);
  });

  it.each([
    ["peerDependencies", "peerDependencies", { "jena-js": "0.7.0-ona.0", attacker: "1.0.0" }],
    ["engines", "engines", { node: ">=20.9.0", npm: ">=11" }],
    ["exports", "exports", { ".": { types: "./index.d.ts", import: "./index.js" }, "./internal": "./index.js" }],
    ["root export", "exports", { ".": { types: "./index.d.ts", import: "./index.js", require: "./index.js" } }],
    ["publishConfig", "publishConfig", { access: "public", provenance: true, registry: "https://registry.example.invalid" }],
    ["repository", "repository", { type: "git", url: "git+https://github.com/HUDongpin/j-3dENA.git", directory: "packages/analysis" }],
  ])("rejects an unknown nested key in %s", (_label, field, value) => {
    expect(() => verifyManifest({ ...createValidPublicPackageManifest(), [field]: value })).toThrow(/PUBLIC_PACKAGE_INVALID/u);
  });

  it.each([
    ["peerDependencies.jena-js", "peerDependencies", {}],
    ["engines.node", "engines", {}],
    ["exports root", "exports", {}],
    ["exports root import", "exports", { ".": { types: "./index.d.ts" } }],
    ["publishConfig.provenance", "publishConfig", { access: "public" }],
    ["repository.url", "repository", { type: "git" }],
  ])("rejects a manifest missing nested field %s", (_label, field, value) => {
    expect(() => verifyManifest({ ...createValidPublicPackageManifest(), [field]: value })).toThrow(/PUBLIC_PACKAGE_INVALID/u);
  });

  it.each([
    ["peerDependencies", null],
    ["engines", []],
    ["exports", "./index.js"],
    ["publishConfig", false],
    ["repository", null],
  ])("rejects malformed nested object %s", (field, value) => {
    expect(() => verifyManifest({ ...createValidPublicPackageManifest(), [field]: value })).toThrow(/PUBLIC_PACKAGE_INVALID/u);
  });

  it.each([
    "name",
    "version",
    "description",
    "type",
    "license",
    "sideEffects",
    "peerDependencies",
    "engines",
    "exports",
    "files",
    "publishConfig",
    "repository",
  ])("rejects a manifest missing required field %s", (field) => {
    const manifest = createValidPublicPackageManifest();
    delete manifest[field];
    expect(() => verifyManifest(manifest)).toThrow(/PUBLIC_PACKAGE_INVALID/u);
  });

  it.each([
    ["name", "not-j-3dena"],
    ["version", "0.2.0-implemented-unverified.6"],
    ["description", "drifted description"],
    ["type", "commonjs"],
    ["license", "MIT"],
    ["sideEffects", true],
    ["peerDependencies", { "jena-js": "0.6.3" }],
    ["engines", { node: ">=18" }],
    ["exports", { ".": { types: "./other.d.ts", import: "./index.js" } }],
    ["files", ["index.js"]],
    ["publishConfig", { access: "restricted", provenance: true }],
    ["repository", { type: "git", url: "git+https://example.invalid/attacker/repo.git" }],
  ])("rejects value drift in %s", (field, value) => {
    expect(() => verifyManifest({ ...createValidPublicPackageManifest(), [field]: value })).toThrow(/PUBLIC_PACKAGE_INVALID/u);
  });

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
