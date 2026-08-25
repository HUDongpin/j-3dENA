import { describe, expect, it } from "vitest";

// The release contract is deliberately a source-controlled MJS module shared
// by the public build and verifier; tests import that exact authority instead
// of duplicating the candidate identity in TypeScript production code.
// @ts-expect-error The source-controlled MJS contract intentionally has no declaration file.
import { PUBLIC_PACKAGE_RELEASE_VERSION, PUBLIC_PACKAGE_SOURCE_VERSION } from "../scripts/public-package-release-contract.mjs";

describe("public package release contract", () => {
  it("assigns the changed public surface a new prerelease identity", () => {
    expect(PUBLIC_PACKAGE_SOURCE_VERSION).toBe("0.2.0");
    expect(PUBLIC_PACKAGE_RELEASE_VERSION).toBe("0.2.0-implemented-unverified.9");
  });
});
