import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";

const FIXTURE_DIRECTORY = new URL("../fixtures/", import.meta.url);
const FORBIDDEN_SENSITIVE_ARTIFACT_NAMES = [
  "class1-timepoints.ena3d.json",
  "class1-timepoints.ena3d.json.sha256",
  "class1-timepoints.ena3d.json.provenance.json",
] as const;

function fixturePaths(): string[] {
  return readdirSync(FIXTURE_DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(FIXTURE_DIRECTORY.pathname, entry.name));
}

describe("Class 1 public-tree custody boundary", () => {
  it("keeps the unapproved participant-bearing prepared artifact out of the public fixture tree", () => {
    for (const name of FORBIDDEN_SENSITIVE_ARTIFACT_NAMES) {
      expect(existsSync(new URL(`../fixtures/${name}`, import.meta.url))).toBe(false);
    }
    expect(fixturePaths().map((path) => basename(path)).filter((name) => /class.?1/iu.test(name))).toEqual([]);
  });

  it("records only a sensitive-excluded disposition and no scientific approval", () => {
    const parityMatrix = readFileSync(new URL("../PARITY_MATRIX.md", import.meta.url), "utf8");
    expect(parityMatrix).toMatch(/legacy prepared candidate.*quarantined/iu);
    expect(parityMatrix).toMatch(/sensitive-excluded/iu);
    expect(parityMatrix).toMatch(/not (?:a )?committable fixture/iu);
    expect(parityMatrix).toMatch(/no (?:independent )?approval/iu);
    expect(parityMatrix).toMatch(/no raw\s+parity/iu);

    const authority = JSON.parse(
      readFileSync(new URL("../scientific-authority.matrix.v1.json", import.meta.url), "utf8"),
    ) as { status?: unknown; approvals?: unknown[] };
    expect(authority.status).toBe("blocked");
    expect(authority.approvals).toEqual([]);
  });

  it("does not expose the quarantined artifact through package runtime source", () => {
    const runtimeSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(runtimeSource).not.toMatch(/class1-timepoints/iu);
  });
});
