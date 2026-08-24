import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { analyzeRows, type RawRow } from "../../analysis/src/index";
import {
  ParityApprovalError,
  compareGoldenAnalysis,
  normalizeAnalysisResult,
  requireApprovedParity,
  type GoldenFixture
} from "./index";

const candidatePath = process.env.THREEDENA_ORACLE_CANDIDATE
  ?? new URL("../fixtures/small-raw.rena-0.2.7.golden.json", import.meta.url);

function readSmallRaw(): RawRow[] {
  const lines = readFileSync(new URL("../fixtures/small-raw.csv", import.meta.url), "utf8").trim().split(/\r?\n/);
  const headers = lines[0]!.split(",").map((cell) => cell.replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((cell) => cell.replace(/^"|"$/g, ""));
    return Object.fromEntries(headers.map((header, index) => {
      const value = cells[index] ?? "";
      return [header, ["EC", "ICT", "MCO", "ATT"].includes(header) ? Number(value) : value];
    })) as RawRow;
  });
}

describe("governed generated oracle candidate", () => {
  it("compares every public DTO numeric field without adopting the candidate", () => {
    const fixtureJson = readFileSync(candidatePath, "utf8");
    const fixture = JSON.parse(fixtureJson) as GoldenFixture;
    expect(fixture.manifest.status).toBe("generated");
    const result = analyzeRows({
      rows: readSmallRaw(),
      mapping: {
        units: ["Group", "Name"],
        conversation: ["Lesson"],
        codes: ["EC", "ICT", "MCO", "ATT"],
        trajectory: {
          participant: ["Name"],
          group: "Group",
          time: "Lesson",
          timeOrder: ["Lesson 1", "Lesson 2"],
          cohortPolicy: "available"
        }
      },
      config: {
        model: "AccumulatedTrajectory",
        window: "MovingStanzaWindow",
        weightBy: "binary",
        windowSizeBack: 4,
        windowSizeForward: 0,
        centerAlignToOrigin: true
      }
    });
    const actual = normalizeAnalysisResult(result);
    const publicFields = fixture.manifest.availableFields.filter((field) => actual[field] !== undefined);
    const oracleOnlyFields = fixture.manifest.availableFields.filter((field) => actual[field] === undefined);
    const comparison = compareGoldenAnalysis(actual, fixture, undefined, {
      fixtureJson,
      inputBytes: readFileSync(new URL("../fixtures/small-raw.csv", import.meta.url)),
      generatorBytes: readFileSync(new URL("../../../oracle-r/generate-small-raw-golden.R", import.meta.url))
    });
    if (process.env.THREEDENA_ORACLE_REPORT === "1") {
      console.info(JSON.stringify({ comparison, oracleOnlyFields }, null, 2));
    }

    expect(publicFields).toEqual([
      "connectionCounts",
      "rowConnectionCounts",
      "lineWeights",
      "centerVector",
      "rotationMatrix",
      "points",
      "nodes",
      "variance",
      "eigenvalues"
    ]);
    expect(oracleOnlyFields).toEqual([]);
    expect(comparison.fixtureStatus).toBe("generated");
    expect(comparison.numericStatus, JSON.stringify(comparison, null, 2)).toBe("pass");
    expect(comparison.comparisonScope).toBe("complete");
    expect(comparison.approvedForParity).toBe(false);
    expect(comparison.status).toBe("candidate-pass");
    expect(comparison.fixtureValidation.valid).toBe(true);
    expect(comparison.fixtureValidation.issues).toEqual([]);
    expect(comparison.fields).toHaveLength(9);
    expect(comparison.fields.every((field) => field.status === "pass")).toBe(true);
    expect(comparison.uncomparedFields).toEqual([]);
    expect(comparison.fixtureValidation.computedHashes.analysisPayloadSha256).toBe(fixture.manifest.analysisPayloadSha256);
    expect(comparison.fixtureValidation.issues.map((entry) => entry.code)).not.toContain("evidence.analysis-hash");
    expect(() => requireApprovedParity(comparison)).toThrow(ParityApprovalError);
  });
});
