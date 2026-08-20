import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { analyzeRows, selectAnalysisDisplay, type AnalyzeRowsInput, type RawRow } from "./index";

function fixture(): AnalyzeRowsInput {
  const text = readFileSync(new URL("../../parity-contracts/fixtures/small-raw.csv", import.meta.url), "utf8").trim();
  const [header, ...lines] = text.split(/\r?\n/u);
  const columns = header!.split(",").map((value) => value.replace(/^"|"$/gu, ""));
  const rows = lines.map((line) => Object.fromEntries(columns.map((column, index) => {
    const raw = line.split(",")[index]!.replace(/^"|"$/gu, "");
    return [column, ["EC", "ICT", "MCO", "ATT"].includes(column) ? Number(raw) : raw];
  }))) as RawRow[];
  return {
    rows,
    mapping: {
      units: ["Group", "Name"],
      conversation: ["Lesson"],
      codes: ["EC", "ICT", "MCO", "ATT"],
      trajectory: {
        participant: ["Name"],
        group: "Group",
        time: "Lesson",
        timeOrder: ["Lesson 1", "Lesson 2"]
      }
    },
    config: { model: "AccumulatedTrajectory", windowSizeBack: 4 }
  };
}

describe("selectAnalysisDisplay", () => {
  it("reselects any retained three dimensions without mutating the fit", () => {
    const result = analyzeRows(fixture());
    const before = structuredClone(result);
    const selection = selectAnalysisDisplay(result, { dimensions: ["SVD4", "SVD5", "SVD6"] });

    expect(selection.dimensions).toEqual(["SVD4", "SVD5", "SVD6"]);
    expect(selection.points[0]!.coordinates).toEqual(result.points[0]!.fullCoordinates.slice(3, 6));
    expect(selection.nodes[0]!.coordinates).toEqual(result.nodes[0]!.fullCoordinates.slice(3, 6));
    expect(selection.trajectory?.centroids[0]!.coordinates).toEqual(result.trajectory!.centroids[0]!.fullCoordinates.slice(3, 6));
    expect(result).toEqual(before);
  });

  it("applies group filters to display rows only", () => {
    const result = analyzeRows(fixture());
    const group = result.trajectory!.groupOrder[0]!;
    const sourceCount = result.points.length;
    const selection = selectAnalysisDisplay(result, { groups: [group.canonical] });

    expect(selection.points.every((point) => point.group?.canonical === group.canonical)).toBe(true);
    expect(selection.trajectory?.groupOrder).toEqual([group]);
    expect(result.points).toHaveLength(sourceCount);
  });

  it("rejects duplicate, missing, and unknown dimensions", () => {
    const result = analyzeRows(fixture());
    expect(() => selectAnalysisDisplay(result, { dimensions: ["SVD1", "SVD1", "SVD2"] })).toThrow(/distinct/);
    expect(() => selectAnalysisDisplay(result, { dimensions: ["SVD1", "SVD2", "SVD999"] })).toThrow(/not present/);
  });
});
