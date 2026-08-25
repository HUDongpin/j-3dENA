import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

// The build-governance module is source-controlled JavaScript shared by the
// release scripts. Tests exercise that exact runtime authority.
// @ts-expect-error The MJS build helper intentionally has no declaration file.
import * as buildGovernance from "../scripts/public-package-build-governance.mjs";

const {
  DETERMINISTIC_SCHEMA_MODULE_QUERY,
  PUBLIC_METADATA_TEXT_MAX_LENGTH,
  PUBLIC_METADATA_URL_COMPONENT_MAX_LENGTH,
  PUBLIC_METADATA_URL_DECODE_MAX_ITERATIONS,
  assertSourceSnapshotUnchanged,
  captureCleanSourceSnapshot,
  cleanPublicPackageBuildOutputs,
  compareCodePoints,
  extractGzipTarEntry,
  assertPublicMetadataHygiene,
  decodePublicMetadataPercentEscapesToFixedPoint,
  scanStandaloneHttpUrls,
  sanitizeRedistributedJenaProvenance,
} = buildGovernance;

const repositoryRoot = resolve(import.meta.dirname, "../../..");

function encodeRepeated(value: string, count: number): string {
  let encoded = value;
  for (let iteration = 0; iteration < count; iteration += 1) {
    encoded = encodeURIComponent(encoded);
  }
  return encoded;
}

function fullyPercentEncode(value: string): string {
  return [...Buffer.from(value, "utf8")]
    .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`)
    .join("");
}

function reviewedReceiptFor(text: string): Record<string, string> {
  return {
    package: "jena-js",
    version: "0.7.0-ona.0",
    officialCommit: "a".repeat(40),
    tarballSha256: "b".repeat(64),
    provenanceSha256: createHash("sha256").update(text).digest("hex"),
  };
}

function git(cwd: string, args: readonly string[], environment: NodeJS.ProcessEnv = {}): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  }).trim();
}

async function cleanRepository(): Promise<{ directory: string; epoch: string }> {
  const directory = await mkdtemp(join(tmpdir(), "3dena-public-build-source-"));
  git(directory, ["init", "--quiet"]);
  git(directory, ["config", "user.email", "public-package@example.invalid"]);
  git(directory, ["config", "user.name", "Public Package Test"]);
  await writeFile(join(directory, "source.txt"), "source\n", "utf8");
  git(directory, ["add", "source.txt"]);
  const epoch = "1700000000";
  git(directory, ["commit", "--quiet", "-m", "source"], {
    GIT_AUTHOR_DATE: `@${epoch}`,
    GIT_COMMITTER_DATE: `@${epoch}`,
  });
  return { directory, epoch };
}

describe("public package clean-HEAD build governance", () => {
  it.each(["THREEDENA_PACKAGE_BUILD_ID", "THREEDENA_PUBLIC_VERSION"])(
    "rejects the caller-controlled %s identity override even when empty",
    async (variable) => {
      const fixture = await cleanRepository();
      try {
        expect(() => captureCleanSourceSnapshot({
          repositoryRoot: fixture.directory,
          environment: { [variable]: "" },
        })).toThrow(new RegExp(`${variable} is forbidden`, "u"));
      } finally {
        await rm(fixture.directory, { recursive: true, force: true });
      }
    },
  );

  it("accepts only the exact HEAD timestamp as SOURCE_DATE_EPOCH", async () => {
    const fixture = await cleanRepository();
    try {
      expect(() => captureCleanSourceSnapshot({
        repositoryRoot: fixture.directory,
        environment: { SOURCE_DATE_EPOCH: String(Number(fixture.epoch) + 1) },
      })).toThrow(/SOURCE_DATE_EPOCH must equal the HEAD commit timestamp/u);

      const snapshot = captureCleanSourceSnapshot({
        repositoryRoot: fixture.directory,
        environment: { SOURCE_DATE_EPOCH: fixture.epoch },
      });
      expect(snapshot).toMatchObject({
        repositoryHead: git(fixture.directory, ["rev-parse", "HEAD"]),
        sourceDateEpoch: fixture.epoch,
        dirtyWorktree: false,
        generatedAt: "2023-11-14T22:13:20.000Z",
      });
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects a changed HEAD or worktree after the build", async () => {
    const fixture = await cleanRepository();
    try {
      const snapshot = captureCleanSourceSnapshot({
        repositoryRoot: fixture.directory,
        environment: {},
      });
      await writeFile(join(fixture.directory, "source.txt"), "changed\n", "utf8");
      expect(() => assertSourceSnapshotUnchanged(snapshot, { repositoryRoot: fixture.directory }))
        .toThrow(/source worktree changed during the build/u);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("permits only the declared generated output path in the post-build check", async () => {
    const fixture = await cleanRepository();
    try {
      await writeFile(join(fixture.directory, "dist.txt"), "old\n", "utf8");
      git(fixture.directory, ["add", "dist.txt"]);
      git(fixture.directory, ["commit", "--quiet", "-m", "generated baseline"]);
      const snapshot = captureCleanSourceSnapshot({
        repositoryRoot: fixture.directory,
        environment: {},
      });
      await writeFile(join(fixture.directory, "dist.txt"), "new\n", "utf8");
      expect(() => assertSourceSnapshotUnchanged(snapshot, {
        repositoryRoot: fixture.directory,
        allowedDirtyPaths: ["dist.txt"],
      })).not.toThrow();
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("cleans only rebuildable public-package directories and preserves historical custody", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "3dena-public-build-dist-"));
    const analysisDirectory = join(fixture, "packages", "analysis");
    const distributionDirectory = join(analysisDirectory, "dist");
    const packageDirectory = join(distributionDirectory, "package");
    const schemaRuntimeDirectory = join(distributionDirectory, "schema-runtime");
    const historicalTarball = join(distributionDirectory, "j-3dena-0.2.0-implemented-unverified.9.tgz");
    const historicalReceipt = `${historicalTarball}.artifact-receipt.json`;
    const historicalCustody = `${historicalTarball}.ci-custody.json`;

    try {
      await mkdir(packageDirectory, { recursive: true });
      await mkdir(schemaRuntimeDirectory, { recursive: true });
      await writeFile(join(packageDirectory, "stale.js"), "stale\n", "utf8");
      await writeFile(join(schemaRuntimeDirectory, "stale.js"), "stale\n", "utf8");
      await writeFile(historicalTarball, "tarball\n", "utf8");
      await writeFile(historicalReceipt, "receipt\n", "utf8");
      await writeFile(historicalCustody, "custody\n", "utf8");

      await cleanPublicPackageBuildOutputs({ analysisDirectory, distributionDirectory });

      await expect(access(packageDirectory)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(schemaRuntimeDirectory)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(historicalTarball, "utf8")).resolves.toBe("tarball\n");
      await expect(readFile(historicalReceipt, "utf8")).resolves.toBe("receipt\n");
      await expect(readFile(historicalCustody, "utf8")).resolves.toBe("custody\n");
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("rejects unexpected or symbolic-link distribution paths before deleting bytes", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "3dena-public-build-clean-safety-"));
    const analysisDirectory = join(fixture, "packages", "analysis");
    const outsideDistribution = join(fixture, "outside-dist");
    const sentinel = join(outsideDistribution, "package", "sentinel.txt");

    try {
      await mkdir(join(outsideDistribution, "package"), { recursive: true });
      await mkdir(analysisDirectory, { recursive: true });
      await writeFile(sentinel, "preserve\n", "utf8");

      await expect(cleanPublicPackageBuildOutputs({
        analysisDirectory,
        distributionDirectory: outsideDistribution,
      })).rejects.toThrow(/unexpected distribution path/u);

      await symlink(outsideDistribution, join(analysisDirectory, "dist"));
      await expect(cleanPublicPackageBuildOutputs({
        analysisDirectory,
        distributionDirectory: join(analysisDirectory, "dist"),
      })).rejects.toThrow(/symbolic-link distribution path/u);
      await expect(readFile(sentinel, "utf8")).resolves.toBe("preserve\n");
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("uses a locale-independent Unicode code-point order and fixed module query", () => {
    expect(["\u{10000}", "\uE000", "a"].sort(compareCodePoints)).toEqual(["a", "\uE000", "\u{10000}"]);
    expect(DETERMINISTIC_SCHEMA_MODULE_QUERY).toBe("?schemas=public-package-contract-v1");
    expect(DETERMINISTIC_SCHEMA_MODULE_QUERY).not.toMatch(/\d{10,}/u);
  });

  it("verifies upstream original jENA provenance identity before sanitizing redistribution", async () => {
    const receipt = JSON.parse(await readFile(join(repositoryRoot, "vendor/jena-js/RECEIPT.json"), "utf8"));
    const archive = await readFile(join(repositoryRoot, "vendor/jena-js", receipt.tarball));
    const provenance = extractGzipTarEntry(archive, "package/PROVENANCE.md");
    const license = extractGzipTarEntry(archive, "package/LICENSE");

    expect(createHash("sha256").update(provenance).digest("hex")).toBe(receipt.provenanceSha256);
    expect(license.subarray(0, 100).toString("utf8")).toContain("GNU GENERAL PUBLIC LICENSE");
  });

  it("sanitizes all four reviewed local provenance paths while retaining transparent artifact identity", async () => {
    const receipt = JSON.parse(await readFile(join(repositoryRoot, "vendor/jena-js/RECEIPT.json"), "utf8"));
    const archive = await readFile(join(repositoryRoot, "vendor/jena-js", receipt.tarball));
    const original = extractGzipTarEntry(archive, "package/PROVENANCE.md");
    const originalText = original.toString("utf8");

    expect(originalText.match(/\/Volumes\/Starship\/ONA/gu)).toHaveLength(4);
    expect(createHash("sha256").update(original).digest("hex")).toBe(receipt.provenanceSha256);

    const sanitized = sanitizeRedistributedJenaProvenance(original, receipt);
    expect(sanitized).toBe(sanitizeRedistributedJenaProvenance(original, receipt));
    expect(sanitized).not.toMatch(
      /(?:\/(?:Volumes|Users|home)\/|(?<![A-Za-z0-9+.-])[A-Za-z]:[\\/])/u,
    );
    expect(sanitized).toContain("deterministic privacy-sanitized copy");
    expect(sanitized).toContain("[LOCAL_PATH_REDACTED]");
    expect(sanitized).toContain(`Upstream original provenance SHA-256: ${receipt.provenanceSha256}`);
    expect(sanitized).toContain(`Reviewed artifact: ${receipt.package}@${receipt.version}`);
    expect(sanitized).toContain(`Official source commit: ${receipt.officialCommit}`);
    expect(sanitized).toContain(`Reviewed tarball SHA-256: ${receipt.tarballSha256}`);
    expect(sanitized).toContain("https://github.com/HUDongpin/jENA");
    expect(sanitized).not.toContain("\r");
    expect(sanitized.endsWith("\n")).toBe(true);
  });

  it("replaces synthetic macOS, Linux, and Windows absolute paths without retaining their components", () => {
    const original = [
      "mac-volume `/Volumes/Research Vault/private/data.csv`",
      "mac-home \"/Users/alice/Secret Notes/key.pem\"",
      "linux /home/bob/private/run.json",
      "windows `C:\\Users\\Carol\\Private Folder\\token.txt`",
    ].join("\r\n");
    const receipt = {
      package: "jena-js",
      version: "0.7.0-ona.0",
      officialCommit: "a".repeat(40),
      tarballSha256: "b".repeat(64),
      provenanceSha256: createHash("sha256").update(original).digest("hex"),
    };

    const sanitized = sanitizeRedistributedJenaProvenance(Buffer.from(original, "utf8"), receipt);
    const sanitizedBody = sanitized.split("\n---\n\n", 2)[1] ?? "";
    expect(sanitizedBody.match(/\[LOCAL_PATH_REDACTED\]/gu)).toHaveLength(4);
    for (const privateComponent of [
      "Research Vault", "data.csv", "alice", "Secret Notes", "key.pem",
      "bob", "run.json", "Carol", "Private Folder", "token.txt",
    ]) {
      expect(sanitized).not.toContain(privateComponent);
    }
  });

  it("fully replaces quoted POSIX, drive, UNC, and extended UNC paths", () => {
    const privatePaths = [
      "/private/var/folders/Secret Notes/key.pem",
      "/var/lib/Private Cache/receipt.json",
      "/mnt/research/Participant Data/raw.csv",
      String.raw`D:\Research Vault\Carol\token.txt`,
      String.raw`\\server\share\Secret Notes\key.pem`,
      String.raw`\\?\UNC\server\share\Private Folder\receipt.json`,
      String.raw`\\?\C:\Users\Alice\Private Folder\token.txt`,
    ];
    const original = privatePaths
      .map((path, index) => `${index % 2 === 0 ? "`" : "\""}${path}${index % 2 === 0 ? "`" : "\""}`)
      .join("\n");

    const sanitized = sanitizeRedistributedJenaProvenance(
      Buffer.from(original),
      reviewedReceiptFor(original),
    );
    const sanitizedBody = sanitized.split("\n---\n\n", 2)[1] ?? "";
    expect(sanitizedBody.match(/\[LOCAL_PATH_REDACTED\]/gu)).toHaveLength(privatePaths.length);
    for (const component of [
      "private", "folders", "Secret Notes", "key.pem", "var", "Private Cache",
      "receipt.json", "mnt", "Participant Data", "raw.csv", "Research Vault",
      "Carol", "token.txt", "server", "share", "Private Folder", "Alice",
    ]) {
      expect(sanitized).not.toContain(component);
    }
  });

  it("sanitizes unquoted high-confidence and explicitly path-labeled POSIX values", () => {
    const original = [
      "p0=/tmp/build/cache.bin",
      "p1=/opt/service/config.json",
      "p2=/etc/ssh/host_key",
      "p3=/usr/local/bin/tool",
      "p4=/srv/data/receipt.json",
      "cwd /custom/private.txt",
    ].join("\n");
    const sanitized = sanitizeRedistributedJenaProvenance(
      Buffer.from(original),
      reviewedReceiptFor(original),
    );
    const sanitizedBody = sanitized.split("\n---\n\n", 2)[1] ?? "";

    expect(sanitizedBody.match(/\[LOCAL_PATH_REDACTED\]/gu)).toHaveLength(6);
    for (const component of ["tmp", "cache.bin", "opt", "config.json", "etc", "host_key", "usr", "tool", "srv", "receipt.json", "custom", "private.txt"]) {
      expect(sanitizedBody).not.toContain(component);
    }
  });

  it.each([
    "source=/Users/alice/Secret Notes/key.pem",
    String.raw`source=C:\Users\Alice\Secret Notes\key.pem`,
    String.raw`source=\\server\share\Secret Notes\key.pem`,
  ])("rejects an unquoted path whose whitespace makes its endpoint ambiguous: %s", (original) => {
    expect(() => sanitizeRedistributedJenaProvenance(
      Buffer.from(original),
      reviewedReceiptFor(original),
    )).toThrow(/ambiguous unquoted absolute path/u);
  });

  it("preserves ordinary root-relative routes outside HTTP URLs", () => {
    const original = [
      "API route /api/v1/users",
      "Guide route /docs/getting-started.md",
    ].join("\n");

    expect(() => assertPublicMetadataHygiene(original, "route fixture")).not.toThrow();
    const sanitized = sanitizeRedistributedJenaProvenance(
      Buffer.from(original),
      reviewedReceiptFor(original),
    );
    expect(sanitized).toContain("/api/v1/users");
    expect(sanitized).toContain("/docs/getting-started.md");
  });

  it.each([
    "Home /about/team",
    "File /download/report",
    "Source /docs/reference",
    "source /custom/private",
    "not-a-path /api/v1/users",
    "épath /api/v1/users",
    "٣path /api/v1/users",
    "_path /api/v1/users",
  ])("preserves a route after an ambiguous or compound-word pseudo-label: %s", (original) => {
    expect(() => assertPublicMetadataHygiene(original, "pseudo-label route fixture"))
      .not.toThrow();
    expect(sanitizeRedistributedJenaProvenance(
      Buffer.from(original),
      reviewedReceiptFor(original),
    )).toContain(original);
  });

  it.each([
    ["NFC letter", "épath /api/v1/users"],
    ["NFD combining mark", "e\u0301path /api/v1/users"],
    ["supplementary combining mark", "x\u{1D165}path /api/v1/users"],
    ["connector punctuation", "x\u2054path /api/v1/users"],
  ])("preserves a route when a path-label suffix follows a %s", (_label, original) => {
    expect(() => assertPublicMetadataHygiene(original, "Unicode label-boundary fixture"))
      .not.toThrow();
    expect(sanitizeRedistributedJenaProvenance(
      Buffer.from(original),
      reviewedReceiptFor(original),
    )).toContain(original);
  });

  it.each([
    "/users/alice/private.txt",
    "cwd /app/repo",
    "cwd /custom/private",
    "source: /custom/private",
    "input=/custom/private.csv",
    "CWD -> /app/repo",
    "Home: /custom/private",
    "File=/custom/private",
    "Source -> /custom/private",
    "**cwd:** /app/repo",
    "**cwd**: /app/repo",
    "*cwd*: /app/repo",
    "`cwd`: /app/repo",
  ])("recognizes a high-confidence or explicitly path-labeled POSIX value: %s", (original) => {
    expect(() => assertPublicMetadataHygiene(original, "path contract fixture"))
      .toThrow(/local absolute path/u);
    const sanitized = sanitizeRedistributedJenaProvenance(
      Buffer.from(original),
      reviewedReceiptFor(original),
    );
    const sanitizedBody = sanitized.split("\n---\n\n", 2)[1] ?? "";
    expect(sanitizedBody).toContain("[LOCAL_PATH_REDACTED]");
    for (const component of ["users", "alice", "private.txt", "/app/repo", "/custom/private"]) {
      expect(sanitizedBody).not.toContain(component);
    }
  });

  it("fail-closes an explicitly path-labeled value with an ambiguous whitespace endpoint", () => {
    const original = "cwd /custom/Secret Notes/key.pem";
    expect(() => sanitizeRedistributedJenaProvenance(
      Buffer.from(original),
      reviewedReceiptFor(original),
    )).toThrow(/ambiguous unquoted absolute path/u);
  });

  it("replaces forward-slash UNC values before POSIX path matching", () => {
    const original = [
      "source=//Users/share/private.csv",
      "output=//server/share/receipt.json",
    ].join("\n");
    const sanitized = sanitizeRedistributedJenaProvenance(
      Buffer.from(original),
      reviewedReceiptFor(original),
    );
    const sanitizedBody = sanitized.split("\n---\n\n", 2)[1] ?? "";
    expect(sanitizedBody.match(/\[LOCAL_PATH_REDACTED\]/gu)).toHaveLength(2);
    for (const component of ["Users", "server", "share", "private.csv", "receipt.json"]) {
      expect(sanitizedBody).not.toContain(component);
    }
  });

  it.each([
    "https://example.com/home/docs",
    "https://example.com/Users/docs",
    "https://example.com/Volumes/docs",
    "https://[2001:db8::1]/home/docs",
    "https://reader@[2001:db8::1]/home/docs",
    "https://reader:public@[2001:db8::1]/Users/docs",
  ])("preserves ordinary HTTP(S) URL pathname %s", (url) => {
    const original = `Public documentation: ${url}\n`;
    const receipt = {
      package: "jena-js",
      version: "0.7.0-ona.0",
      officialCommit: "a".repeat(40),
      tarballSha256: "b".repeat(64),
      provenanceSha256: createHash("sha256").update(original).digest("hex"),
    };

    expect(() => assertPublicMetadataHygiene(original, "URL fixture")).not.toThrow();
    expect(sanitizeRedistributedJenaProvenance(Buffer.from(original), receipt)).toContain(url);
  });

  it("scans complete standalone HTTP(S) tokens with balanced URL delimiters", () => {
    expect(scanStandaloneHttpUrls).toBeTypeOf("function");
    if (typeof scanStandaloneHttpUrls !== "function") return;

    const fixtures = [
      {
        text: "See https://example.com/docs?q=a(b) for details.",
        url: "https://example.com/docs?q=a(b)",
      },
      {
        text: "See https://example.com/docs?q=a[b] for details.",
        url: "https://example.com/docs?q=a[b]",
      },
      {
        text: "See https://example.com/docs?q=a{b} for details.",
        url: "https://example.com/docs?q=a{b}",
      },
      {
        text: "See (https://example.com/docs?q=a(b)).",
        url: "https://example.com/docs?q=a(b)",
      },
      {
        text: "See [documentation](https://example.com/docs?q=a[b]).",
        url: "https://example.com/docs?q=a[b]",
      },
    ];

    for (const { text, url } of fixtures) {
      expect(scanStandaloneHttpUrls(text).map(({ text: token }: { text: string }) => token))
        .toEqual([url]);
      expect(() => assertPublicMetadataHygiene(text, "balanced URL fixture")).not.toThrow();
      expect(sanitizeRedistributedJenaProvenance(Buffer.from(text), reviewedReceiptFor(text)))
        .toContain(url);
    }
  });

  it("keeps balanced URL punctuation inside the query hygiene boundary", () => {
    const unsafe = [
      "https://example.com/docs?key=a(-----BEGIN%20OPENSSH PRIVATE KEY-----)",
      "https://example.com/docs?key=a[-----BEGIN%20OPENSSH PRIVATE KEY-----]",
      "https://example.com/docs?key=a{-----BEGIN%20OPENSSH PRIVATE KEY-----}",
    ];
    for (const url of unsafe) {
      expect(() => assertPublicMetadataHygiene(url, "balanced sensitive URL fixture"))
        .toThrow(/private-key marker/u);
      expect(() => sanitizeRedistributedJenaProvenance(
        Buffer.from(url),
        reviewedReceiptFor(url),
      )).toThrow(/private-key marker/u);
    }
  });

  it.each([
    "_https://example.com/Users/alice/private.txt",
    "éhttps://example.com/Users/alice/private.txt",
    "٣https://example.com/Users/alice/private.txt",
    "𝟙https://example.com/Users/alice/private.txt",
  ])("does not grant an HTTP path exemption after a Unicode-aware scheme prefix: %s", (text) => {
    if (typeof scanStandaloneHttpUrls === "function") {
      expect(scanStandaloneHttpUrls(text)).toEqual([]);
    }
    expect(() => assertPublicMetadataHygiene(text, "prefixed URL fixture"))
      .toThrow(/malformed or non-standalone HTTP\(S\) URL/u);
    expect(() => sanitizeRedistributedJenaProvenance(
      Buffer.from(text),
      reviewedReceiptFor(text),
    )).toThrow(/PUBLIC_METADATA_HYGIENE_FAILED/u);
  });

  it.each([
    ["NFC letter", "éhttps://example.com/Users/alice/private.txt"],
    ["NFD combining mark", "e\u0301https://example.com/Users/alice/private.txt"],
    ["supplementary combining mark", "x\u{1D165}https://example.com/Users/alice/private.txt"],
    ["connector punctuation", "x\u2054https://example.com/Users/alice/private.txt"],
  ])("does not grant an HTTP path exemption when the scheme follows a %s", (_label, text) => {
    expect(scanStandaloneHttpUrls(text)).toEqual([]);
    expect(() => assertPublicMetadataHygiene(text, "Unicode scheme-boundary fixture"))
      .toThrow(/malformed or non-standalone HTTP\(S\) URL/u);
    expect(() => sanitizeRedistributedJenaProvenance(
      Buffer.from(text),
      reviewedReceiptFor(text),
    )).toThrow(/PUBLIC_METADATA_HYGIENE_FAILED/u);
  });

  it("uses one Unicode-aware continuation helper for URL and path-label boundaries", async () => {
    const source = await readFile(
      join(repositoryRoot, "packages/analysis/scripts/public-package-build-governance.mjs"),
      "utf8",
    );
    expect(source).toContain("function isMetadataContinuationCharacter");
    expect(source.match(/isMetadataContinuationCharacter/gu)?.length ?? 0)
      .toBeGreaterThanOrEqual(3);
    expect(source).not.toContain("schemePrefixContinuationPattern");
    expect(source).not.toContain("pathLabelCompoundCharacterPattern");
  });

  it("uses a linearly structured path-label scan for slash-heavy metadata up to 1 MiB", async () => {
    const source = await readFile(
      join(repositoryRoot, "packages/analysis/scripts/public-package-build-governance.mjs"),
      "utf8",
    );
    expect(source).not.toContain("semanticPathLabelPrefix");
    expect(source).not.toMatch(/lastIndexOf\([^\n]*pathStart/u);

    const slashHeavyMetadata = (size: number): string => {
      const segment = "api/v1/items/";
      return `/${segment.repeat(Math.ceil(size / segment.length))}`.slice(0, size);
    };
    const startedAt = performance.now();
    for (const size of [4, 64, 256, 1_024].map((kibibytes) => kibibytes * 1_024)) {
      const fixture = slashHeavyMetadata(size);
      expect(fixture).toHaveLength(size);
      expect(() => assertPublicMetadataHygiene(fixture, `${size} byte slash-heavy fixture`))
        .not.toThrow();
    }
    const sanitizerFixture = slashHeavyMetadata(256 * 1_024);
    expect(sanitizeRedistributedJenaProvenance(
      Buffer.from(sanitizerFixture),
      reviewedReceiptFor(sanitizerFixture),
    )).toContain(sanitizerFixture);
    expect(performance.now() - startedAt).toBeLessThan(20_000);
  }, 30_000);

  it("uses a small explicit HTTP scanner instead of a delimiter-excluding URL regex", async () => {
    const source = await readFile(
      join(repositoryRoot, "packages/analysis/scripts/public-package-build-governance.mjs"),
      "utf8",
    );
    expect(source).toContain("function scanStandaloneHttpUrls");
    expect(source).not.toContain("httpUrlTokenPattern");
  });

  it("sanitizes raw root-home paths and rejects them from public metadata", () => {
    const original = "superuser-home `/root/private.txt`\n";
    const receipt = {
      package: "jena-js",
      version: "0.7.0-ona.0",
      officialCommit: "a".repeat(40),
      tarballSha256: "b".repeat(64),
      provenanceSha256: createHash("sha256").update(original).digest("hex"),
    };

    expect(() => assertPublicMetadataHygiene(original, "root fixture"))
      .toThrow(/local absolute path/u);
    const sanitized = sanitizeRedistributedJenaProvenance(Buffer.from(original), receipt);
    expect(sanitized).toContain("[LOCAL_PATH_REDACTED]");
    expect(sanitized).not.toContain("root");
    expect(sanitized).not.toContain("private.txt");
  });

  it.each([
    "file:///Users/alice/private.txt",
    String.raw`file:C:\Users\Alice\private.txt`,
    "https://example.com/docs?source=/Users/alice/private.txt",
    "https://example.com/docs#source=/root/private.txt",
    "https://example.com/docs?source=%2Fhome%2Falice%2Fprivate.txt",
    "https://example.com/docs?source=C%3A%5CUsers%5CAlice%5Cprivate.txt",
  ])("fail-closes when URL metadata carries a local path: %s", (url) => {
    const original = `Source: ${url}\n`;
    const receipt = {
      package: "jena-js",
      version: "0.7.0-ona.0",
      officialCommit: "a".repeat(40),
      tarballSha256: "b".repeat(64),
      provenanceSha256: createHash("sha256").update(original).digest("hex"),
    };

    expect(() => assertPublicMetadataHygiene(original, "unsafe URL fixture"))
      .toThrow(/PUBLIC_METADATA_HYGIENE_FAILED/u);
    expect(() => sanitizeRedistributedJenaProvenance(Buffer.from(original), receipt))
      .toThrow(/PUBLIC_METADATA_HYGIENE_FAILED/u);
  });

  it("does not grant HTTP(S) pathname exemptions to a scheme substring", () => {
    const original = "source=xhttps://example.com/Users/alice/private.txt";
    expect(() => assertPublicMetadataHygiene(original, "prefixed-scheme fixture"))
      .toThrow(/malformed or non-standalone HTTP\(S\) URL/u);
    expect(() => sanitizeRedistributedJenaProvenance(
      Buffer.from(original),
      reviewedReceiptFor(original),
    )).toThrow(/PUBLIC_METADATA_HYGIENE_FAILED/u);
  });

  it.each([
    ["query POSIX", `https://example.com/docs?source=${encodeRepeated("/root/private.txt", 4)}`],
    ["fragment POSIX", `https://example.com/docs#source=${encodeRepeated("/Users/alice/private.txt", 4)}`],
    ["query Windows", `https://example.com/docs?source=${encodeRepeated("C:\\Users\\Alice\\private.txt", 4)}`],
    ["fragment Windows", `https://example.com/docs#source=${encodeRepeated("C:\\Users\\Alice\\private.txt", 4)}`],
    ["query file URL", `https://example.com/docs?source=${encodeRepeated("file:///Users/alice/private.txt", 4)}`],
    ["fragment file URL", `https://example.com/docs#source=${encodeRepeated("file:///root/private.txt", 4)}`],
  ])("fail-closes after fixed-point decoding of fourfold-encoded %s metadata", (_label, url) => {
    const original = `Source: ${url}\n`;
    const receipt = {
      package: "jena-js",
      version: "0.7.0-ona.0",
      officialCommit: "a".repeat(40),
      tarballSha256: "b".repeat(64),
      provenanceSha256: createHash("sha256").update(original).digest("hex"),
    };

    expect(() => assertPublicMetadataHygiene(original, "fourfold URL fixture"))
      .toThrow(/PUBLIC_METADATA_HYGIENE_FAILED/u);
    expect(() => sanitizeRedistributedJenaProvenance(Buffer.from(original), receipt))
      .toThrow(/PUBLIC_METADATA_HYGIENE_FAILED/u);
  });

  it("uses explicit URL metadata decoding limits and rejects components that do not stabilize", () => {
    expect(PUBLIC_METADATA_URL_DECODE_MAX_ITERATIONS).toBe(8);
    expect(PUBLIC_METADATA_URL_COMPONENT_MAX_LENGTH).toBe(16_384);

    for (const [label, component] of [
      ["benign", encodeRepeated("release notes", PUBLIC_METADATA_URL_DECODE_MAX_ITERATIONS)],
      ["hostile", encodeRepeated("/root/private.txt", PUBLIC_METADATA_URL_DECODE_MAX_ITERATIONS)],
    ] as const) {
      const url = `https://example.com/docs?source=${component}`;
      const receipt = {
        package: "jena-js",
        version: "0.7.0-ona.0",
        officialCommit: "a".repeat(40),
        tarballSha256: "b".repeat(64),
        provenanceSha256: createHash("sha256").update(url).digest("hex"),
      };
      expect(() => assertPublicMetadataHygiene(url, `${label} over-depth fixture`))
        .toThrow(/did not stabilize within 8 decoding iterations/u);
      expect(() => sanitizeRedistributedJenaProvenance(Buffer.from(url), receipt))
        .toThrow(/did not stabilize within 8 decoding iterations/u);
    }
  });

  it("fail-closes on overlong and malformed HTTP(S) metadata components", () => {
    const exactLimit = `https://example.com/docs?${"a".repeat(16_384)}`;
    const overlong = `https://example.com/docs?${"a".repeat(16_385)}`;
    expect(() => assertPublicMetadataHygiene(exactLimit, "exact-limit URL fixture"))
      .not.toThrow();
    expect(() => assertPublicMetadataHygiene(overlong, "overlong URL fixture"))
      .toThrow(/exceeds 16384 UTF-16 code units/u);
    expect(() => assertPublicMetadataHygiene(
      "https://example.com/docs?source=%ZZ",
      "malformed URL fixture",
    )).toThrow(/contains malformed URL escaping/u);
  });

  it("measures raw and semantically decoded URL metadata without URL serialization expansion", () => {
    const cjkUrl = `https://example.com/docs?notes=${"漢".repeat(3_000)}`;
    const emojiUrl = `https://example.com/docs#notes=${"🧭".repeat(3_000)}`;
    for (const url of [cjkUrl, emojiUrl]) {
      expect(() => assertPublicMetadataHygiene(url, "Unicode URL fixture")).not.toThrow();
      expect(sanitizeRedistributedJenaProvenance(Buffer.from(url), reviewedReceiptFor(url)))
        .toContain(url);
    }
  });

  it("bounded-canonicalizes legal percent escapes across the complete metadata context", () => {
    expect(PUBLIC_METADATA_TEXT_MAX_LENGTH).toBe(1_048_576);
    expect(decodePublicMetadataPercentEscapesToFixedPoint).toBeTypeOf("function");
    if (typeof decodePublicMetadataPercentEscapesToFixedPoint !== "function") return;

    const original = "Coverage 95%\nkey=-----BEGIN%2520OPENSSH PRIVATE KEY-----\nraw=%ZZ";
    const layers = decodePublicMetadataPercentEscapesToFixedPoint(original, "canonical fixture");
    expect(layers[0]).toBe(original);
    expect(layers.at(-1)).toBe(
      "Coverage 95%\nkey=-----BEGIN OPENSSH PRIVATE KEY-----\nraw=%ZZ",
    );
  });

  it.each([
    "key=-----BEGIN%20OPENSSH PRIVATE KEY-----",
    "key=-----BEGIN OPENSSH%20PRIVATE KEY-----",
    "note before\nkey=-----BEGIN%2520OPENSSH PRIVATE KEY-----\nnote after",
  ])("rejects a partially percent-encoded private-key marker across metadata whitespace: %s", (text) => {
    expect(() => assertPublicMetadataHygiene(text, "partial PEM fixture"))
      .toThrow(/private-key marker/u);
    expect(() => sanitizeRedistributedJenaProvenance(
      Buffer.from(text),
      reviewedReceiptFor(text),
    )).toThrow(/private-key marker/u);
  });

  it("preserves bare and malformed percent prose while decoding other legal escapes", () => {
    const text = "Coverage is 95%; sample alpha%20beta%ZZ remains public; bare %.";
    expect(() => assertPublicMetadataHygiene(text, "mixed percent prose fixture")).not.toThrow();
    expect(sanitizeRedistributedJenaProvenance(Buffer.from(text), reviewedReceiptFor(text)))
      .toContain(text);
  });

  it("enforces an explicit total metadata input bound before canonicalization", () => {
    expect(() => assertPublicMetadataHygiene(
      "a".repeat(PUBLIC_METADATA_TEXT_MAX_LENGTH),
      "exact total metadata limit fixture",
    )).not.toThrow();
    expect(() => assertPublicMetadataHygiene(
      "a".repeat(PUBLIC_METADATA_TEXT_MAX_LENGTH + 1),
      "overlong total metadata fixture",
    )).toThrow(/exceeds 1048576 UTF-16 code units/u);
  });

  it("bounded-decodes percent-encoded sensitive tokens outside HTTP(S) without rejecting bare percent prose", () => {
    const barePercentProse = "Coverage is 95% complete; modulo examples may contain a bare % sign.";
    expect(() => assertPublicMetadataHygiene(barePercentProse, "percent prose fixture"))
      .not.toThrow();
    expect(sanitizeRedistributedJenaProvenance(
      Buffer.from(barePercentProse),
      reviewedReceiptFor(barePercentProse),
    )).toContain(barePercentProse);

    for (const encoded of [
      encodeURIComponent("file:///private/var/folders/key.pem"),
      encodeRepeated("/tmp/private/cache.bin", 4),
    ]) {
      const original = `source=${encoded}`;
      expect(() => assertPublicMetadataHygiene(original, "encoded outside-URL fixture"))
        .toThrow(/PUBLIC_METADATA_HYGIENE_FAILED/u);
      expect(() => sanitizeRedistributedJenaProvenance(
        Buffer.from(original),
        reviewedReceiptFor(original),
      )).toThrow(/PUBLIC_METADATA_HYGIENE_FAILED/u);
    }
  });

  it("applies malformed, length, and stabilization limits to encoded outside-HTTP tokens", () => {
    for (const [label, encoded, expected] of [
      ["benign over-depth", encodeRepeated("release notes", 8), /did not stabilize within 8/u],
      ["hostile over-depth", encodeRepeated("/tmp/private.bin", 8), /did not stabilize within 8/u],
      ["overlong", `${"a".repeat(16_382)}%20`, /exceeds 16384 UTF-16 code units/u],
      ["mixed valid and malformed file URL", "file%3A%2F%2F%ZZ", /contains a file URL/u],
    ] as const) {
      expect(() => assertPublicMetadataHygiene(encoded, `${label} outside-token fixture`))
        .toThrow(expected);
    }
  });

  it.each([
    ["raw query GitHub token", `https://example.com/docs?token=ghp_${"C".repeat(36)}`],
    ["raw fragment OpenAI token", `https://example.com/docs#token=sk-proj-${"D".repeat(32)}`],
    ["query GitHub token", `https://example.com/docs?token=${fullyPercentEncode(`ghp_${"A".repeat(36)}`)}`],
    ["fragment OpenAI token", `https://example.com/docs#token=${fullyPercentEncode(`sk-proj-${"B".repeat(32)}`)}`],
    ["query private key", `https://example.com/docs?key=${fullyPercentEncode("-----BEGIN OPENSSH PRIVATE KEY-----")}`],
    ["fragment private key", `https://example.com/docs#key=${fullyPercentEncode("-----BEGIN RSA PRIVATE KEY-----")}`],
  ])("rejects fully percent-encoded sensitive %s", (_label, url) => {
    expect(() => assertPublicMetadataHygiene(url, "encoded sensitive URL fixture"))
      .toThrow(/PUBLIC_METADATA_HYGIENE_FAILED/u);
    expect(() => sanitizeRedistributedJenaProvenance(
      Buffer.from(url),
      reviewedReceiptFor(url),
    )).toThrow(/PUBLIC_METADATA_HYGIENE_FAILED/u);
  });

  it.each([
    ["query", "https://example.com/docs?key=-----BEGIN OPENSSH PRIVATE KEY-----"],
    ["fragment", "https://example.com/docs#key=-----BEGIN RSA PRIVATE KEY-----"],
  ])("rejects a raw-space private-key marker spanning HTTP %s tokenization", (_label, url) => {
    expect(() => assertPublicMetadataHygiene(url, "raw-space key fixture"))
      .toThrow(/private-key marker/u);
    expect(() => sanitizeRedistributedJenaProvenance(
      Buffer.from(url),
      reviewedReceiptFor(url),
    )).toThrow(/private-key marker/u);
  });

  it.each([
    "https://example.com/docs?key=-----BEGIN+OPENSSH+PRIVATE+KEY-----",
    "https://example.com/docs?key=-----BEGIN%2BOPENSSH%2BPRIVATE%2BKEY-----",
  ])("applies form-style plus-to-space semantics to every query decoding layer: %s", (url) => {
    expect(() => assertPublicMetadataHygiene(url, "form query fixture"))
      .toThrow(/private-key marker/u);
    expect(() => sanitizeRedistributedJenaProvenance(
      Buffer.from(url),
      reviewedReceiptFor(url),
    )).toThrow(/private-key marker/u);
  });

  it.each([
    [
      "encoded credential pathname",
      `https://example.com/download/${fullyPercentEncode(`ghp_${"P".repeat(36)}`)}`,
      /high-confidence credential/u,
    ],
    [
      "encoded private-key pathname",
      `https://example.com/download/${fullyPercentEncode("-----BEGIN OPENSSH PRIVATE KEY-----")}`,
      /private-key marker/u,
    ],
    [
      "encoded file-URL pathname",
      `https://example.com/download/${fullyPercentEncode("file:///Users/alice/private.txt")}`,
      /file URL/u,
    ],
    [
      "encoded credential username",
      `https://${fullyPercentEncode(`ghp_${"U".repeat(36)}`)}@example.com/home/docs`,
      /high-confidence credential/u,
    ],
    [
      "encoded credential IPv6 username",
      `https://${fullyPercentEncode(`ghp_${"V".repeat(36)}`)}@[2001:db8::1]/home/docs`,
      /high-confidence credential/u,
    ],
    [
      "encoded credential IPv6 password",
      `https://reader:${fullyPercentEncode(`sk-proj-${"W".repeat(32)}`)}@[2001:db8::1]/home/docs`,
      /high-confidence credential/u,
    ],
    [
      "encoded private-key password",
      `https://reader:${fullyPercentEncode("-----BEGIN RSA PRIVATE KEY-----")}@example.com/home/docs`,
      /private-key marker/u,
    ],
    [
      "encoded file-URL username",
      `https://${fullyPercentEncode("file:///Users/alice/private.txt")}@example.com/home/docs`,
      /file URL/u,
    ],
  ])("bounded-decodes sensitive HTTP %s", (_label, url, expected) => {
    expect(() => assertPublicMetadataHygiene(url, "HTTP component fixture"))
      .toThrow(expected);
    expect(() => sanitizeRedistributedJenaProvenance(
      Buffer.from(url),
      reviewedReceiptFor(url),
    )).toThrow(expected);
  });

  it.each([
    ["plain AWS hostname", `AKIA${"H".repeat(16)}`],
    ["fully encoded AWS hostname", fullyPercentEncode(`AKIA${"I".repeat(16)}`)],
    ["partially encoded AWS hostname", `AKIA${"J".repeat(15)}%4A`],
    ["fully encoded OpenAI hostname", fullyPercentEncode(`sk-proj-${"K".repeat(24)}`)],
    ["partially encoded Google hostname", `AIza${"L".repeat(34)}%4C`],
  ])("rejects a high-confidence credential in a raw/decoded %s", (_label, hostname) => {
    const url = `https://${hostname}.example.invalid/docs`;
    expect(() => assertPublicMetadataHygiene(url, "hostname credential fixture"))
      .toThrow(/high-confidence credential/u);
    expect(() => sanitizeRedistributedJenaProvenance(
      Buffer.from(url),
      reviewedReceiptFor(url),
    )).toThrow(/high-confidence credential/u);
  });

  it.each([
    "https://MiXeD.Example.COM:8443/docs",
    "https://reader:public@MiXeD.Example.COM:8443/docs",
    "https://[2001:db8::1]:8443/docs",
  ])("preserves a clean raw hostname, userinfo, brackets, and port: %s", (url) => {
    expect(() => assertPublicMetadataHygiene(url, "clean hostname fixture")).not.toThrow();
    expect(sanitizeRedistributedJenaProvenance(Buffer.from(url), reviewedReceiptFor(url)))
      .toContain(url);
  });

  it.each([
    [
      "over-depth pathname",
      `https://example.com/download/${encodeRepeated("release notes", PUBLIC_METADATA_URL_DECODE_MAX_ITERATIONS)}`,
      /did not stabilize within 8 decoding iterations/u,
    ],
    [
      "over-depth username",
      `https://${encodeRepeated("reader name", PUBLIC_METADATA_URL_DECODE_MAX_ITERATIONS)}@example.com/home/docs`,
      /did not stabilize within 8 decoding iterations/u,
    ],
    [
      "overlong pathname",
      `https://example.com/${"a".repeat(PUBLIC_METADATA_URL_COMPONENT_MAX_LENGTH)}`,
      /exceeds 16384 UTF-16 code units/u,
    ],
    [
      "malformed pathname",
      "https://example.com/download/%ZZ",
      /contains malformed URL escaping/u,
    ],
  ])("applies fixed-point safety bounds to an HTTP %s", (_label, url, expected) => {
    expect(() => assertPublicMetadataHygiene(url, "bounded HTTP component fixture"))
      .toThrow(expected);
    expect(() => sanitizeRedistributedJenaProvenance(
      Buffer.from(url),
      reviewedReceiptFor(url),
    )).toThrow(expected);
  });

  it.each([
    `https://example.com/download/ghp_${"E".repeat(36)}`,
    "https://example.com/docs/file:///Users/alice/private.txt",
  ])("does not exempt non-path sensitive text in an HTTP(S) URL token: %s", (url) => {
    expect(() => assertPublicMetadataHygiene(url, "sensitive URL token fixture"))
      .toThrow(/PUBLIC_METADATA_HYGIENE_FAILED/u);
    expect(() => sanitizeRedistributedJenaProvenance(
      Buffer.from(url),
      reviewedReceiptFor(url),
    )).toThrow(/PUBLIC_METADATA_HYGIENE_FAILED/u);
  });

  it("accepts clean public metadata and rejects local paths, private keys, and high-confidence credentials", () => {
    expect(() => assertPublicMetadataHygiene(
      "Public provenance for https://github.com/HUDongpin/jENA at SHA-256: " + "a".repeat(64),
      "clean fixture",
    )).not.toThrow();

    for (const unsafe of [
      "local=/Users/alice/private.txt",
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      `token=ghp_${"A".repeat(36)}`,
      `api_key=sk-proj-${"B".repeat(32)}`,
    ]) {
      expect(() => assertPublicMetadataHygiene(unsafe, "unsafe fixture"))
        .toThrow(/PUBLIC_METADATA_HYGIENE_FAILED/u);
    }
  });

  it("keeps the build script free of wall-clock module imports and installed jENA notices", async () => {
    const source = await readFile(join(repositoryRoot, "packages/analysis/scripts/build-public-package.mjs"), "utf8");
    expect(source).not.toContain("Date.now()");
    expect(source).not.toContain("node_modules/jena-js/LICENSE");
    expect(source).not.toContain("node_modules/jena-js/PROVENANCE.md");
    expect(source).toContain("assertSourceSnapshotUnchanged");
    expect(source).toContain("DETERMINISTIC_SCHEMA_MODULE_QUERY");
    expect(source).toContain("sanitizeRedistributedJenaProvenance");
    expect(source).toContain('allowedDirtyPaths: ["packages/analysis/dist/package"]');
    expect(source).not.toContain('allowedDirtyPaths: ["packages/analysis/dist"]');
  });

  it("states the bounded recognized-path privacy contract without claiming all paths", async () => {
    const original = "source=/Users/alice/private.txt";
    const sanitized = sanitizeRedistributedJenaProvenance(
      Buffer.from(original),
      reviewedReceiptFor(original),
    );
    expect(sanitized).toContain(
      "Recognized high-confidence or explicitly path-labeled local filesystem paths",
    );
    expect(sanitized).toContain("ambiguous unquoted path-like values fail closed");
    expect(sanitized).not.toContain("Local absolute filesystem paths are replaced in full");

    const notices = await readFile(join(repositoryRoot, "packages/analysis/THIRD_PARTY_NOTICES.md"), "utf8");
    expect(notices).toContain(
      "Recognized high-confidence or explicitly path-labeled local filesystem paths",
    );
    expect(notices).toContain("ambiguous unquoted path-like values fail closed");
    expect(notices).not.toContain("local absolute filesystem paths are replaced in full");
  });
});
