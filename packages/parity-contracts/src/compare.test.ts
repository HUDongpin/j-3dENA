import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  PARITY_BASELINE_V1,
  ParityApprovalError,
  compareApprovedGoldenAnalysis,
  compareGoldenAnalysis,
  requireApprovedParity,
  validateParityFixture,
  type ApprovedParityEvidence,
  type GoldenAnalysis,
  type GoldenFixture,
  type ParityFixtureStatus
} from "./index";

const golden: GoldenAnalysis = {
  rotationMatrix: { rowKeys: ["A & B", "A & C"], columns: ["SVD1", "SVD2"], values: [[0.8, 0.6], [0.6, -0.8]] },
  points: { rowKeys: ["u1", "u2"], columns: ["SVD1", "SVD2"], values: [[1, 2], [-1, -2]] },
  nodes: { rowKeys: ["A", "B"], columns: ["SVD1", "SVD2"], values: [[0.4, 0.5], [-0.4, -0.5]] },
  variance: { columns: ["SVD1", "SVD2"], values: [0.7, 0.3] }
};

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function governedFixture(status: Exclude<ParityFixtureStatus, "pending">, analysis: GoldenAnalysis = golden): {
  fixture: GoldenFixture;
  fixtureJson: string;
  evidence: ApprovedParityEvidence;
} {
  const inputBytes = "Group,Lesson,Name,EC\nA,L1,u1,1\n";
  const generatorBytes = "# frozen synthetic generator\n";
  const inputSha256 = digest(inputBytes);
  const generatorSha256 = digest(generatorBytes);
  const analysisPayloadSha256 = digest(JSON.stringify(analysis));
  const generatorGitCommit = "a".repeat(40);
  const fixture: GoldenFixture = {
    manifest: {
      schemaVersion: "3dena.parity-fixture.v1",
      fixtureId: "synthetic-sign-alignment",
      status,
      availableFields: ["rotationMatrix", "points", "nodes", "variance"],
      legacyCommit: PARITY_BASELINE_V1.legacyCommit,
      rVersion: PARITY_BASELINE_V1.rVersion,
      rENAVersion: PARITY_BASELINE_V1.rENAVersion,
      jenaCommit: PARITY_BASELINE_V1.jenaCommit,
      jenaVersion: PARITY_BASELINE_V1.jenaVersion,
      scientificOracle: {
        role: PARITY_BASELINE_V1.oracleRole,
        legacyProductCommit: PARITY_BASELINE_V1.legacyCommit,
        R: PARITY_BASELINE_V1.rVersion,
        rENA: PARITY_BASELINE_V1.rENAVersion,
        jsonlite: PARITY_BASELINE_V1.jsonliteVersion,
        digest: PARITY_BASELINE_V1.digestVersion,
        platform: "test-platform"
      },
      generator: {
        path: PARITY_BASELINE_V1.generatorPath,
        gitCommit: generatorGitCommit,
        sha256: generatorSha256
      },
      generatedAtUtc: "2026-08-20T00:00:00Z",
      numericalRuntime: {
        platform: "test-platform",
        BLAS: "test-blas",
        LAPACK: "test-lapack"
      },
      command: "test-only generator command",
      input: {
        path: "synthetic.csv",
        bytes: Buffer.byteLength(inputBytes),
        sha256: inputSha256
      },
      spec: {
        model: "AccumulatedTrajectory",
        units: ["Group", "Name"],
        conversation: "Lesson",
        codes: ["EC"],
        group: "Group",
        participant: "Name",
        time: "Lesson",
        window: "MovingStanzaWindow",
        windowSizeBack: 4,
        windowSizeForward: 0,
        weightBy: "binary",
        rotation: "svd",
        dimensions: 2,
        centerAlignToOrigin: true
      },
      analysisPayloadSha256,
      analysisPayload: {
        hashAlgorithm: "sha256",
        hashScope: PARITY_BASELINE_V1.analysisHashScope,
        sha256: analysisPayloadSha256
      },
      ...(status === "approved" ? {
        approval: {
          schemaVersion: "3dena.parity-approval.v1" as const,
          reviewedBy: "independent-reviewer",
          reviewedAtUtc: "2026-08-20T01:00:00Z",
          decisionRecord: "reviews/synthetic-sign-alignment.md",
          inputSha256,
          analysisPayloadSha256,
          generatorGitCommit
        }
      } : {})
    },
    analysis
  };
  const fixtureJson = JSON.stringify(fixture, null, 2);
  return { fixture, fixtureJson, evidence: { inputBytes, generatorBytes, fixtureJson } };
}

function signFlippedActual(): GoldenAnalysis {
  return {
    rotationMatrix: { rowKeys: ["A & B", "A & C"], columns: ["SVD1", "SVD2"], values: [[-0.8, 0.6], [-0.6, -0.8]] },
    points: { rowKeys: ["u1", "u2"], columns: ["SVD1", "SVD2"], values: [[-1, 2], [1, -2]] },
    nodes: { rowKeys: ["A", "B"], columns: ["SVD1", "SVD2"], values: [[-0.4, 0.5], [0.4, -0.5]] },
    variance: { columns: ["SVD1", "SVD2"], values: [0.7, 0.3] }
  };
}

describe("fixture custody and comparison", () => {
  it("binds the tracked CSV bytes to the provenance and governed manifest", () => {
    const csvPath = new URL("../fixtures/small-raw.csv", import.meta.url);
    const provenancePath = new URL("../fixtures/small-raw.provenance.json", import.meta.url);
    const goldenPath = new URL("../fixtures/small-raw.rena-0.2.7.golden.json", import.meta.url);
    const csv = readFileSync(csvPath);
    const provenance = JSON.parse(readFileSync(provenancePath, "utf8")) as { artifact: { sha256: string; bytes: number; rowsExcludingHeader: number } };
    const trackedGolden = JSON.parse(readFileSync(goldenPath, "utf8")) as GoldenFixture;
    const csvDigest = digest(csv);

    expect(csvDigest).toBe("163ee849ac316d380e2664067e7389a8114e30d97877c97d6d912e3706c72f16");
    expect(provenance.artifact.sha256).toBe(csvDigest);
    expect(provenance.artifact.bytes).toBe(csv.byteLength);
    expect(provenance.artifact.rowsExcludingHeader).toBe(csv.toString("utf8").trim().split(/\r?\n/).length - 1);
    expect((trackedGolden.manifest.input as { sha256: string }).sha256).toBe(csvDigest);
  });

  it("labels a valid generated numeric pass as candidate-only", () => {
    const { fixture, evidence } = governedFixture("generated");
    const comparison = compareGoldenAnalysis(signFlippedActual(), fixture, undefined, evidence);

    expect(comparison.status).toBe("candidate-pass");
    expect(comparison.fixtureStatus).toBe("generated");
    expect(comparison.numericStatus).toBe("pass");
    expect(comparison.fixtureValidation.valid).toBe(true);
    expect(comparison.approvedForParity).toBe(false);
    expect(comparison.axisSigns).toEqual({ SVD1: -1, SVD2: 1 });
    expect(() => requireApprovedParity(comparison)).toThrow(ParityApprovalError);
  });

  it("returns from the strict gate only for a complete approved pass", () => {
    const { fixture, evidence } = governedFixture("approved");
    const comparison = compareApprovedGoldenAnalysis(signFlippedActual(), fixture, evidence);

    expect(comparison.status).toBe("approved-pass");
    expect(comparison.fixtureStatus).toBe("approved");
    expect(comparison.approvedForParity).toBe(true);
    expect(comparison.comparisonScope).toBe("complete");
  });

  it("does not approve a status flip without a bound review record or a partial comparison", () => {
    const generated = governedFixture("generated");
    const statusOnly = structuredClone(generated.fixture) as GoldenFixture;
    statusOnly.manifest.status = "approved";
    const statusOnlyJson = JSON.stringify(statusOnly);
    const unreviewed = compareGoldenAnalysis(golden, statusOnly, undefined, {
      ...generated.evidence,
      fixtureJson: statusOnlyJson
    });
    expect(unreviewed.status).toBe("approved-invalid");
    expect(unreviewed.fixtureValidation.issues.map((entry) => entry.code)).toContain("manifest.approval");
    expect(() => requireApprovedParity(unreviewed)).toThrow(ParityApprovalError);

    const approved = governedFixture("approved");
    const partial = compareGoldenAnalysis(golden, approved.fixture, undefined, {
      ...approved.evidence,
      fields: ["points"]
    });
    expect(partial.status).toBe("approved-invalid");
    expect(partial.numericStatus).toBe("pass");
    expect(partial.comparisonScope).toBe("partial");
    expect(partial.approvedForParity).toBe(false);
    expect(partial.actualValidationIssues.map((entry) => entry.code)).toContain("comparison.partial-approved");
  });

  it("rejects input and lexical analysis-payload tampering even when numerics match", () => {
    const approved = governedFixture("approved");
    const wrongInput = compareGoldenAnalysis(golden, approved.fixture, undefined, {
      ...approved.evidence,
      inputBytes: "different bytes"
    });
    expect(wrongInput.status).toBe("approved-invalid");
    expect(wrongInput.numericStatus).toBe("pass");
    expect(wrongInput.fixtureValidation.issues.map((entry) => entry.code)).toContain("evidence.input-hash");
    expect(() => requireApprovedParity(wrongInput)).toThrow(ParityApprovalError);

    const tamperedJson = approved.fixtureJson.replace("0.8,", "0.81,");
    const tamperedFixture = JSON.parse(tamperedJson) as GoldenFixture;
    const tampered = compareGoldenAnalysis(tamperedFixture.analysis!, tamperedFixture, undefined, {
      ...approved.evidence,
      fixtureJson: tamperedJson
    });
    expect(tampered.status).toBe("approved-invalid");
    expect(tampered.numericStatus).toBe("pass");
    expect(tampered.fixtureValidation.issues.map((entry) => entry.code)).toContain("evidence.analysis-hash");
  });

  it("rejects incomplete generator provenance and generator-byte drift", () => {
    const generated = governedFixture("generated");
    const missingCommit = structuredClone(generated.fixture) as GoldenFixture;
    delete (missingCommit.manifest.generator as Record<string, unknown>).gitCommit;
    const missingCommitJson = JSON.stringify(missingCommit);
    const result = validateParityFixture(missingCommit, { ...generated.evidence, fixtureJson: missingCommitJson });
    expect(result.valid).toBe(false);
    expect(result.issues.map((entry) => entry.code)).toContain("manifest.generator-commit");

    const changedGenerator = validateParityFixture(generated.fixture, { ...generated.evidence, generatorBytes: "changed generator" });
    expect(changedGenerator.valid).toBe(false);
    expect(changedGenerator.issues.map((entry) => entry.code)).toContain("evidence.generator-hash");
  });

  it("rejects duplicate row keys and non-finite cells in fixture or actual payloads", () => {
    const generated = governedFixture("generated");
    const duplicate = structuredClone(generated.fixture) as GoldenFixture;
    duplicate.analysis!.points!.rowKeys = ["u1", "u1"];
    const duplicateValidation = validateParityFixture(duplicate, {
      ...generated.evidence,
      fixtureJson: JSON.stringify(duplicate)
    });
    expect(duplicateValidation.issues.some((entry) => entry.path === "analysis.points.rowKeys" && entry.code === "schema.duplicate")).toBe(true);

    const actual = signFlippedActual();
    actual.points!.values[0]![0] = Number.POSITIVE_INFINITY;
    const comparison = compareGoldenAnalysis(actual, generated.fixture, undefined, generated.evidence);
    expect(comparison.status).toBe("candidate-invalid");
    expect(comparison.actualValidationIssues.map((entry) => entry.code)).toContain("analysis.non-finite");
  });

  it("fails exact row-order changes even when numeric values are equal", () => {
    const generated = governedFixture("generated");
    const actual = structuredClone(golden);
    actual.points!.rowKeys.reverse();
    const comparison = compareGoldenAnalysis(actual, generated.fixture, undefined, generated.evidence);
    expect(comparison.status).toBe("candidate-fail");
    expect(comparison.fields.find((field) => field.field === "points")?.message).toMatch(/row keys or order differ/);
  });

  it("validates the tracked generated fixture without treating an empty comparison as approval", () => {
    const path = new URL("../fixtures/small-raw.rena-0.2.7.golden.json", import.meta.url);
    const fixtureJson = readFileSync(path, "utf8");
    const fixture = JSON.parse(fixtureJson) as GoldenFixture;
    const evidence = {
      fixtureJson,
      inputBytes: readFileSync(new URL("../fixtures/small-raw.csv", import.meta.url)),
      generatorBytes: readFileSync(new URL("../../../oracle-r/generate-small-raw-golden.R", import.meta.url))
    };
    const validation = validateParityFixture(fixture, evidence);
    const comparison = compareGoldenAnalysis({}, fixture, undefined, evidence);
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);
    expect(comparison.status).toBe("candidate-invalid");
    expect(comparison.fixtureStatus).toBe("generated");
    expect(comparison.numericStatus).toBe("fail");
    expect(comparison.approvedForParity).toBe(false);
    expect(fixture.manifest.approval).toBeUndefined();
  });

  it("returns validation diagnostics instead of throwing on a malformed runtime envelope", () => {
    const malformed = {
      manifest: {
        schemaVersion: "wrong",
        fixtureId: "malformed",
        status: "generated"
      },
      analysis: { points: { rowKeys: ["x", "x"], columns: ["SVD1"], values: [[1], [2]] } }
    } as unknown as GoldenFixture;
    const comparison = compareGoldenAnalysis({}, malformed);
    expect(comparison.status).toBe("candidate-invalid");
    expect(comparison.fixtureStatus).toBe("generated");
    expect(comparison.fixtureValidation.valid).toBe(false);
    expect(comparison.fixtureValidation.issues.map((entry) => entry.code)).toContain("manifest.value");
  });
});
