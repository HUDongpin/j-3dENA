import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

// @ts-expect-error The source-governance MJS authority intentionally has no declaration file.
import * as headGovernance from "../scripts/public-package-head-governance.mjs";

const {
  PUBLIC_PACKAGE_RECEIPT_PATH,
  PUBLIC_PACKAGE_CI_CUSTODY_PATH,
  PUBLIC_PACKAGE_RUNTIME_INPUT_PATH,
  PUBLIC_PACKAGE_TARBALL_PATH,
  classifyPublicPackageHeadPaths,
  resolveEffectivePublicPackageHead,
  validatePublicRuntimeInput,
} = headGovernance;

const sourceHead = "a".repeat(40);
const runtimeInputHead = "b".repeat(40);
const currentPackageFiles = ["LICENSE", "PROVENANCE.json", "index.js", "package.json"];
const previousPackageFiles = [...currentPackageFiles, "obsolete.txt"];

function classify(changedPaths: string[], hasCurrentReceipt = true) {
  return classifyPublicPackageHeadPaths({
    changedPaths,
    hasCurrentReceipt,
    currentPackageFiles,
    previousPackageFiles,
    runtimeCandidateSourceCommit: runtimeInputHead,
  });
}

describe("public package S/A/C HEAD governance", () => {
  it("classifies source-only HEADs as S only before the v13 receipt exists", () => {
    expect(classify(["packages/analysis/src/index.ts"], false)).toEqual({
      kind: "source",
      stage: "source",
    });
    expect(() => classify(["packages/analysis/src/index.ts"])).toThrow(/receipt already exists/u);
  });

  it("accepts only the exact artifact paths derived from the receipt and prior tree", () => {
    expect(classify([
      "packages/analysis/dist/package/index.js",
      "packages/analysis/dist/package/obsolete.txt",
      PUBLIC_PACKAGE_TARBALL_PATH,
      PUBLIC_PACKAGE_RECEIPT_PATH,
      PUBLIC_PACKAGE_CI_CUSTODY_PATH,
    ])).toEqual({ kind: "generated", stage: "artifact" });

    expect(() => classify([
      "packages/analysis/dist/package/unreceipted.js",
      PUBLIC_PACKAGE_TARBALL_PATH,
      PUBLIC_PACKAGE_RECEIPT_PATH,
      PUBLIC_PACKAGE_CI_CUSTODY_PATH,
    ])).toThrow(/not an exact allowed generated path/u);
  });

  it("rejects a self-consistent artifact A that omits its trusted CI custody tuple", () => {
    expect(() => classify([
      "packages/analysis/dist/package/index.js",
      PUBLIC_PACKAGE_TARBALL_PATH,
      PUBLIC_PACKAGE_RECEIPT_PATH,
    ])).toThrow(/custody/u);
  });

  it("rejects source/generated mixtures and unknown protected generated paths", () => {
    expect(() => classify([
      "packages/analysis/src/index.ts",
      PUBLIC_PACKAGE_RECEIPT_PATH,
    ])).toThrow(/mixes source and generated paths/u);
    expect(() => classify([
      "output/compute-service-candidate-surprise/compute-runtime.mjs",
    ])).toThrow(/not an exact allowed generated path/u);
  });

  it("treats only the exact runtime input example as a source contract", () => {
    const examplePath =
      "packages/compute-service-persistent/deploy/runtime-build-input.example.json";
    expect(classify([examplePath], false)).toEqual({
      kind: "source",
      stage: "source",
    });
    expect(() => classify([examplePath])).toThrow(/receipt already exists/u);
    expect(() => classify([`${examplePath}.backup`], false))
      .toThrow(/not an exact allowed generated path/u);
    expect(() => classify([
      "packages/compute-service-persistent/deploy/runtime-build-input.other.json",
    ], false)).toThrow(/not an exact allowed generated path/u);
  });

  it("requires exact, single-purpose runtime input and candidate commits", () => {
    expect(classify([
      "packages/compute-service-persistent/deploy/runtime-build-input.0.2.0-implemented-unverified.12.json",
      "packages/compute-service-persistent/deploy/runtime-build-input.0.2.0-implemented-unverified.13.json",
    ])).toEqual({ kind: "generated", stage: "runtime-input" });

    const oldCandidate = "output/compute-service-candidate-ed48275";
    const newCandidate = `output/compute-service-candidate-${runtimeInputHead.slice(0, 7)}`;
    const files = ["build-manifest.json", "compute-runtime.mjs", "scientific-worker-entry.mjs"];
    expect(classify(files.flatMap((file) => [
      `${oldCandidate}/${file}`,
      `${newCandidate}/${file}`,
    ]))).toEqual({ kind: "generated", stage: "runtime-candidate" });

    expect(() => classify([
      "packages/compute-service-persistent/deploy/runtime-build-input.0.2.0-implemented-unverified.13.json",
      `${newCandidate}/compute-runtime.mjs`,
    ])).toThrow(/multiple generated stages/u);
  });

  it("strictly binds the runtime input to receipt S and the v13 release", () => {
    const input = {
      schemaVersion: "3dena.compute-runtime-build-input.v4",
      approvedLongitudinalBuild: {
        jenaVersion: "0.7.0-ona.0",
        jenaCommit: "90790856f00bdef63dbd27fc3a5b502e8cffe65f",
        jenaTarballIntegrity: "sha512-gBhKP9d7C3akXTPlU03AJHBs+dBBDt1TUFGx96P/pB/s0GEGGX2aZFLJGWf9HLc+wuBJIjrJn7tIGicg1WQflQ==",
        sdkVersion: "0.2.0-implemented-unverified.13",
        buildId: sourceHead,
      },
      migrations: [
        { path: "packages/compute-service-persistent/migrations/0001_persistent_compute.sql", version: "0001-persistent-compute" },
        { path: "packages/compute-service-persistent/migrations/0002_persistent_control_plane.sql", version: "0002-persistent-control-plane" },
        { path: "packages/compute-service-persistent/migrations/0003_build_approval_v3.sql", version: "0003-build-approval-v3" },
        { path: "packages/compute-service-persistent/migrations/0004_scientific_result_generations.sql", version: "0004-scientific-result-generations" },
        { path: "packages/compute-service-persistent/migrations/0005_build_approval_v4.sql", version: "0005-build-approval-v4" },
      ],
      contractVersions: [
        "3dena.compute-dataset-http.v1",
        "3dena.compute-http.v1",
        "3dena.compute-prepared-import-http.v1",
        "3dena.compute-source-result-job-http.v1",
        "3dena.contract.v1",
        "3dena.longitudinal-compute-submission.v2",
      ],
    };
    expect(validatePublicRuntimeInput(input, sourceHead)).toBe(input);
    expect(PUBLIC_PACKAGE_RUNTIME_INPUT_PATH).toContain("implemented-unverified.13");
    expect(() => validatePublicRuntimeInput({ ...input, unexpected: true }, sourceHead)).toThrow(/exact fields/u);
    expect(() => validatePublicRuntimeInput(input, "c".repeat(40))).toThrow(/receipt source S/u);
    expect(() => validatePublicRuntimeInput({
      ...input,
      migrations: input.migrations.slice(0, -1),
    }, sourceHead)).toThrow(/receipt source S/u);
  });

  it("rejects empty commits instead of guessing a source anchor", () => {
    expect(() => classify([], false)).toThrow(/has no changed paths/u);
  });

  it("accepts only a tree-identical two-parent merge wrapper around second-parent C", () => {
    const mergeHead = "d".repeat(40);
    const mainParent = "e".repeat(40);
    const candidateHead = "f".repeat(40);
    expect(resolveEffectivePublicPackageHead({
      checkoutHead: mergeHead,
      parents: [mainParent, candidateHead],
      checkoutTree: "1".repeat(40),
      secondParentTree: "1".repeat(40),
    })).toEqual({
      checkoutHead: mergeHead,
      effectiveHead: candidateHead,
      mergeWrapper: true,
    });
    expect(() => resolveEffectivePublicPackageHead({
      checkoutHead: mergeHead,
      parents: [mainParent, candidateHead],
      checkoutTree: "1".repeat(40),
      secondParentTree: "2".repeat(40),
    })).toThrow(/tree must exactly equal its second parent/u);
    expect(() => resolveEffectivePublicPackageHead({
      checkoutHead: mergeHead,
      parents: [mainParent, candidateHead, sourceHead],
      checkoutTree: "1".repeat(40),
      secondParentTree: "1".repeat(40),
    })).toThrow(/one-parent commit or a strict two-parent merge wrapper/u);
  });

  it("keeps source S independent from the workflow merge SHA", () => {
    expect(sourceHead).toHaveLength(40);
    expect(PUBLIC_PACKAGE_RECEIPT_PATH).toContain("implemented-unverified.13");
    expect(PUBLIC_PACKAGE_CI_CUSTODY_PATH).toContain("implemented-unverified.13");
  });

  it("keeps generated-stage failure diagnostics aligned with the active release contract", async () => {
    const source = await readFile(
      new URL("../scripts/public-package-head-governance.mjs", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/fail\((?:"|`)[^"`]*\bv(?:6|7|8|9|10|11|12)\b[^"`]*(?:"|`)\)/gu);
    expect(source).toContain('release ${PUBLIC_PACKAGE_RELEASE_VERSION}');
    expect(source).toContain("replace the previous runtime candidate");
  });
});
