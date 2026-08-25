import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error The MJS CLI contract intentionally has no declaration file.
import { parsePublicPackageSmokeArguments } from "../scripts/public-package-smoke-contract.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

describe("public package smoke input governance", () => {
  it("requires explicit tarball and receipt paths and rejects positional or duplicate inputs", () => {
    expect(parsePublicPackageSmokeArguments([
      "--tarball", "/tmp/package.tgz",
      "--receipt", "/tmp/package.receipt.json",
    ])).toEqual({
      tarballPath: "/tmp/package.tgz",
      receiptPath: "/tmp/package.receipt.json",
    });
    expect(() => parsePublicPackageSmokeArguments(["./dist/package"]))
      .toThrow(/unknown argument/u);
    expect(() => parsePublicPackageSmokeArguments(["--tarball", "a.tgz", "--tarball", "b.tgz", "--receipt", "r.json"]))
      .toThrow(/may be supplied only once/u);
    expect(() => parsePublicPackageSmokeArguments(["--tarball", "a.tgz"]))
      .toThrow(/--receipt is required/u);
  });

  it("never invokes npm pack and consumes the strict artifact receipt", async () => {
    const source = await readFile(joinScript("smoke-public-package.mjs"), "utf8");
    expect(source).not.toMatch(/runNpm\(\s*\[\s*["']pack["']/u);
    expect(source).not.toContain("--pack-destination");
    expect(source).toContain("verifyPublicPackageArtifactReceiptV2");
    expect(source).toContain("parsePublicPackageSmokeArguments");
  });
});

function joinScript(name: string): string {
  return resolve(repositoryRoot, "packages/analysis/scripts", name);
}
