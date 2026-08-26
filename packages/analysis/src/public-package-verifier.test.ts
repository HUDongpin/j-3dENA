import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The source-controlled verifier is JavaScript used by release scripts and has
// no declaration file; the test intentionally exercises that runtime module.
// @ts-expect-error release verifier is an MJS build-script module.
import * as publicPackageVerifier from "../scripts/verify-public-package.mjs";

const publicPackageVersion = "0.2.0-implemented-unverified.11";

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

function fullyPercentEncode(value: string): string {
  return [...Buffer.from(value, "utf8")]
    .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`)
    .join("");
}

describe("public package provenance verifier", () => {
  it("preserves Unicode-continuation pseudo-label routes in verifier metadata", () => {
    const verifyMetadataHygiene = (
      publicPackageVerifier as typeof publicPackageVerifier & {
        verifyPublicPackageMetadataHygiene?: (metadata: Record<string, string>) => unknown;
      }
    ).verifyPublicPackageMetadataHygiene;
    expect(verifyMetadataHygiene).toBeTypeOf("function");
    if (!verifyMetadataHygiene) return;

    const clean = {
      "README.md": "Public package metadata.\n",
      "THIRD_PARTY_NOTICES.md": "Reviewed dependency notices.\n",
      "THIRD_PARTY/jena-js-PROVENANCE.md": "Privacy-sanitized upstream provenance.\n",
      "PROVENANCE.json": JSON.stringify({ sha256: "a".repeat(64) }),
    };

    for (const route of [
      "épath /api/v1/users",
      "e\u0301path /api/v1/users",
      "x\u{1D165}path /api/v1/users",
      "x\u2054path /api/v1/users",
    ]) {
      expect(() => verifyMetadataHygiene({ ...clean, "README.md": route })).not.toThrow();
    }
  });

  it.each([
    ["NFC letter", "éhttps://example.com/Users/alice/private.txt"],
    ["NFD combining mark", "e\u0301https://example.com/Users/alice/private.txt"],
    ["supplementary combining mark", "x\u{1D165}https://example.com/Users/alice/private.txt"],
    ["connector punctuation", "x\u2054https://example.com/Users/alice/private.txt"],
  ])("rejects an HTTP local-path exemption after a %s in verifier metadata", (_label, text) => {
    const verifyMetadataHygiene = (
      publicPackageVerifier as typeof publicPackageVerifier & {
        verifyPublicPackageMetadataHygiene?: (metadata: Record<string, string>) => unknown;
      }
    ).verifyPublicPackageMetadataHygiene;
    expect(verifyMetadataHygiene).toBeTypeOf("function");
    if (!verifyMetadataHygiene) return;

    expect(() => verifyMetadataHygiene({
      "README.md": text,
      "THIRD_PARTY_NOTICES.md": "Reviewed dependency notices.\n",
      "THIRD_PARTY/jena-js-PROVENANCE.md": "Privacy-sanitized upstream provenance.\n",
      "PROVENANCE.json": JSON.stringify({ sha256: "a".repeat(64) }),
    }))
      .toThrow(/PUBLIC_PACKAGE_INVALID.*metadata hygiene/u);
  });

  it("fail-closes over public metadata text without scanning bundled JavaScript", () => {
    const verifyMetadataHygiene = (
      publicPackageVerifier as typeof publicPackageVerifier & {
        verifyPublicPackageMetadataHygiene?: (metadata: Record<string, string>) => unknown;
      }
    ).verifyPublicPackageMetadataHygiene;
    expect(verifyMetadataHygiene).toBeTypeOf("function");
    if (!verifyMetadataHygiene) return;

    const clean = {
      "README.md": [
        "https://example.com/home/docs",
        "https://example.com/Users/docs",
        "https://example.com/Volumes/docs",
        "https://[2001:db8::1]/home/docs",
        "https://reader@[2001:db8::1]/home/docs",
        "https://reader:public@[2001:db8::1]/Users/docs",
        "https://MiXeD.Example.COM:8443/docs?q=a(b)",
        "[documentation](https://example.com/docs?q=a[b])",
        "https://example.com/docs?q=a{b}",
        `https://example.com/docs?notes=${"漢".repeat(3_000)}`,
        "/api/v1/users",
        "/docs/getting-started.md",
        "Home /about/team",
        "File /download/report",
        "Source /docs/reference",
        "not-a-path /api/v1/users",
        "Coverage is 95% complete.",
        "Sample alpha%20beta%ZZ remains public.",
        "",
      ].join("\n"),
      "THIRD_PARTY_NOTICES.md": "Reviewed dependency notices.\n",
      "THIRD_PARTY/jena-js-PROVENANCE.md": "Privacy-sanitized upstream provenance.\n",
      "PROVENANCE.json": JSON.stringify({ sha256: "a".repeat(64) }),
    };
    expect(() => verifyMetadataHygiene(clean)).not.toThrow();

    const unsafeMetadata: ReadonlyArray<readonly [string, string]> = [
      ["THIRD_PARTY/jena-js-PROVENANCE.md", "source=/home/alice/private.csv"],
      ["THIRD_PARTY/jena-js-PROVENANCE.md", "source=/root/private.csv"],
      ["THIRD_PARTY/jena-js-PROVENANCE.md", "source=/private/var/folders/private.csv"],
      ["THIRD_PARTY/jena-js-PROVENANCE.md", "source=/tmp/private.csv"],
      ["THIRD_PARTY/jena-js-PROVENANCE.md", "/users/alice/private.csv"],
      ["THIRD_PARTY/jena-js-PROVENANCE.md", "cwd /custom/private"],
      ["THIRD_PARTY/jena-js-PROVENANCE.md", "source=//Users/share/private.csv"],
      ["THIRD_PARTY/jena-js-PROVENANCE.md", String.raw`source=\\server\share\private.csv`],
      ["THIRD_PARTY/jena-js-PROVENANCE.md", String.raw`source=\\?\UNC\server\share\private.csv`],
      ["README.md", "-----BEGIN RSA PRIVATE KEY-----"],
      ["THIRD_PARTY_NOTICES.md", `github_pat_${"A".repeat(82)}`],
      ["README.md", "file:///Users/alice/private.csv"],
      ["README.md", encodeURIComponent("file:///private/var/private.csv")],
      ["README.md", "https://example.com/docs?source=%2FUsers%2Falice%2Fprivate.csv"],
      ["README.md", `https://example.com/docs?token=${fullyPercentEncode(`ghp_${"A".repeat(36)}`)}`],
      ["README.md", `https://example.com/docs#token=${fullyPercentEncode(`sk-proj-${"B".repeat(32)}`)}`],
      ["README.md", `https://example.com/docs?key=${fullyPercentEncode("-----BEGIN OPENSSH PRIVATE KEY-----")}`],
      ["README.md", `https://example.com/docs#key=${fullyPercentEncode("-----BEGIN RSA PRIVATE KEY-----")}`],
      ["README.md", "https://example.com/docs?key=-----BEGIN OPENSSH PRIVATE KEY-----"],
      ["README.md", "https://example.com/docs#key=-----BEGIN RSA PRIVATE KEY-----"],
      ["README.md", "https://example.com/docs?key=-----BEGIN+OPENSSH+PRIVATE+KEY-----"],
      ["README.md", "https://example.com/docs?key=-----BEGIN%2BOPENSSH%2BPRIVATE%2BKEY-----"],
      ["README.md", `https://example.com/download/${fullyPercentEncode(`ghp_${"P".repeat(36)}`)}`],
      ["README.md", `https://example.com/download/${fullyPercentEncode("-----BEGIN OPENSSH PRIVATE KEY-----")}`],
      ["README.md", `https://example.com/download/${fullyPercentEncode("file:///Users/alice/private.txt")}`],
      ["README.md", `https://${fullyPercentEncode(`ghp_${"U".repeat(36)}`)}@example.com/home/docs`],
      ["README.md", `https://${fullyPercentEncode(`ghp_${"V".repeat(36)}`)}@[2001:db8::1]/home/docs`],
      ["README.md", `https://reader:${fullyPercentEncode(`sk-proj-${"W".repeat(32)}`)}@[2001:db8::1]/home/docs`],
      ["README.md", `https://${fullyPercentEncode("file:///Users/alice/private.txt")}@example.com/home/docs`],
      ["README.md", "key=-----BEGIN%20OPENSSH PRIVATE KEY-----"],
      ["README.md", "https://example.com/docs?key=a(-----BEGIN%20OPENSSH PRIVATE KEY-----)"],
      ["README.md", "éhttps://example.com/Users/alice/private.txt"],
      ["README.md", `https://${fullyPercentEncode(`AKIA${"H".repeat(16)}`)}.example.invalid/docs`],
      ["README.md", `https://${fullyPercentEncode(`sk-proj-${"K".repeat(24)}`)}.example.invalid/docs`],
      ["README.md", "CWD -> /app/repo"],
      ["README.md", "**cwd:** /app/repo"],
      ["README.md", "Source -> /custom/private"],
    ];
    for (const [path, text] of unsafeMetadata) {
      expect(() => verifyMetadataHygiene({ ...clean, [path]: text }))
        .toThrow(/PUBLIC_PACKAGE_INVALID.*metadata hygiene/u);
    }
  });

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
