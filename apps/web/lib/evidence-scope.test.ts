import { describe, expect, it } from "vitest";
import {
  assessRawEvidenceScope,
  PRODUCT_STATUS,
  RAW_EVIDENCE_SCOPE_VERSION,
  SMALL_RAW_PARITY_BINDING,
} from "@/lib/evidence-scope";
import { createRunOwner } from "@/lib/run-ownership";
import {
  BUILT_IN_SAMPLE_CSV,
  LEGACY_DEFAULT_MAPPING,
} from "@/lib/sample-data";

const governedResult = {
  schemaVersion: "3dena.analysis-result.v1",
  axes: ["SVD1", "SVD2", "SVD3"],
  trajectory: {
    space: "analysis-result-rotation",
    cohortPolicy: "available",
  },
  provenance: {
    adapter: "@3dena/analysis",
    adapterVersion: "0.1.0",
    jenaPackage: "jena-js",
    jenaVersion: "0.6.3",
    jenaCommit: "57b7794ec3873c251c33086454523e5a3949836f",
    parityContract: "3dena.parity-contract.v1",
    legacyGoldenContract: "legacy-application-golden-v1",
    legacyGoldenStatus: "not-assessed",
    resolvedConfig: {
      model: "AccumulatedTrajectory",
      window: "MovingStanzaWindow",
      weightBy: "binary",
      windowSizeBack: 4,
      windowSizeForward: 0,
      centerAlignToOrigin: true,
    },
  },
};

const GOVERNED_BUILD_ID = "test-governed-build";

describe("raw scientific evidence scope", () => {
  it("binds the exact built-in fixture and mapping to the reviewed hashes", async () => {
    const owner = await createRunOwner(
      BUILT_IN_SAMPLE_CSV,
      LEGACY_DEFAULT_MAPPING,
      "governed-run",
    );

    expect(owner).toMatchObject({
      datasetHash: SMALL_RAW_PARITY_BINDING.datasetSha256,
      specHash: SMALL_RAW_PARITY_BINDING.specificationSha256,
    });
    expect(assessRawEvidenceScope(governedResult, owner, GOVERNED_BUILD_ID)).toEqual({
      productStatus: PRODUCT_STATUS,
      evidenceStatus: "PARITY_CANDIDATE",
      scopeVersion: RAW_EVIDENCE_SCOPE_VERSION,
      fixtureId: SMALL_RAW_PARITY_BINDING.fixtureId,
      buildId: GOVERNED_BUILD_ID,
      mismatches: [],
    });
  });

  it.each([
    ["different bytes", { datasetHash: "f".repeat(64) }, "dataset"],
    ["different specification", { specHash: "e".repeat(64) }, "specification"],
  ])("does not inherit the candidate for %s", (_label, patch, mismatch) => {
    const assessment = assessRawEvidenceScope(governedResult, {
      datasetHash: SMALL_RAW_PARITY_BINDING.datasetSha256,
      specHash: SMALL_RAW_PARITY_BINDING.specificationSha256,
      ...patch,
    }, GOVERNED_BUILD_ID);

    expect(assessment.evidenceStatus).toBe(PRODUCT_STATUS);
    expect(assessment.scopeVersion).toBeNull();
    expect(assessment.mismatches).toContain(mismatch);
  });

  it("fails closed when a frozen jENA or contract version changes", () => {
    const assessment = assessRawEvidenceScope(
      {
        ...governedResult,
        provenance: { ...governedResult.provenance, jenaVersion: "0.6.2" },
      },
      {
        datasetHash: SMALL_RAW_PARITY_BINDING.datasetSha256,
        specHash: SMALL_RAW_PARITY_BINDING.specificationSha256,
      },
      GOVERNED_BUILD_ID,
    );

    expect(assessment).toMatchObject({
      productStatus: PRODUCT_STATUS,
      evidenceStatus: PRODUCT_STATUS,
      scopeVersion: null,
      mismatches: ["version-set"],
    });
  });

  it("fails closed when an effective analysis option changes outside the UI mapping", () => {
    const assessment = assessRawEvidenceScope(
      {
        ...governedResult,
        provenance: {
          ...governedResult.provenance,
          resolvedConfig: {
            ...governedResult.provenance.resolvedConfig,
            weightBy: "sum",
          },
        },
      },
      {
        datasetHash: SMALL_RAW_PARITY_BINDING.datasetSha256,
        specHash: SMALL_RAW_PARITY_BINDING.specificationSha256,
      },
      GOVERNED_BUILD_ID,
    );

    expect(assessment.evidenceStatus).toBe(PRODUCT_STATUS);
    expect(assessment.mismatches).toContain("resolved-analysis");
  });

  it.each([undefined, null, "", " local-build ", "local-development"])(
    "withholds candidate evidence when the build identity is not explicit: %s",
    (buildId) => {
      const assessment = assessRawEvidenceScope(
        governedResult,
        {
          datasetHash: SMALL_RAW_PARITY_BINDING.datasetSha256,
          specHash: SMALL_RAW_PARITY_BINDING.specificationSha256,
        },
        buildId,
      );

      expect(assessment).toMatchObject({
        evidenceStatus: PRODUCT_STATUS,
        scopeVersion: null,
        buildId: null,
      });
      expect(assessment.mismatches).toContain("build-identity");
    },
  );
});
