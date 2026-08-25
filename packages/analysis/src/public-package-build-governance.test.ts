import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

// The build-governance module is source-controlled JavaScript shared by the
// release scripts. Tests exercise that exact runtime authority.
// @ts-expect-error The MJS build helper intentionally has no declaration file.
import * as buildGovernance from "../scripts/public-package-build-governance.mjs";

const {
  DETERMINISTIC_SCHEMA_MODULE_QUERY,
  assertSourceSnapshotUnchanged,
  captureCleanSourceSnapshot,
  compareCodePoints,
  extractGzipTarEntry,
} = buildGovernance;

const repositoryRoot = resolve(import.meta.dirname, "../../..");

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

  it("uses a locale-independent Unicode code-point order and fixed module query", () => {
    expect(["\u{10000}", "\uE000", "a"].sort(compareCodePoints)).toEqual(["a", "\uE000", "\u{10000}"]);
    expect(DETERMINISTIC_SCHEMA_MODULE_QUERY).toBe("?schemas=public-package-contract-v1");
    expect(DETERMINISTIC_SCHEMA_MODULE_QUERY).not.toMatch(/\d{10,}/u);
  });

  it("extracts jENA license and provenance bytes from the exact reviewed tarball", async () => {
    const receipt = JSON.parse(await readFile(join(repositoryRoot, "vendor/jena-js/RECEIPT.json"), "utf8"));
    const archive = await readFile(join(repositoryRoot, "vendor/jena-js", receipt.tarball));
    const provenance = extractGzipTarEntry(archive, "package/PROVENANCE.md");
    const license = extractGzipTarEntry(archive, "package/LICENSE");

    expect(createHash("sha256").update(provenance).digest("hex")).toBe(receipt.provenanceSha256);
    expect(license.subarray(0, 100).toString("utf8")).toContain("GNU GENERAL PUBLIC LICENSE");
  });

  it("keeps the build script free of wall-clock module imports and installed jENA notices", async () => {
    const source = await readFile(join(repositoryRoot, "packages/analysis/scripts/build-public-package.mjs"), "utf8");
    expect(source).not.toContain("Date.now()");
    expect(source).not.toContain("node_modules/jena-js/LICENSE");
    expect(source).not.toContain("node_modules/jena-js/PROVENANCE.md");
    expect(source).toContain("assertSourceSnapshotUnchanged");
    expect(source).toContain("DETERMINISTIC_SCHEMA_MODULE_QUERY");
  });
});
