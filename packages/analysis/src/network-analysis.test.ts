import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { analyzeRows } from "./analyze";
import { analyzeChangeNetwork, compareGroupNetworks, NetworkAnalysisError } from "./network-analysis";
import type { AnalyzeRowsInput, RawRow } from "./types";

function readSmallRaw(): RawRow[] {
  const text = readFileSync(new URL("../../parity-contracts/fixtures/small-raw.csv", import.meta.url), "utf8").trim();
  const [header = "", ...lines] = text.split(/\r?\n/u);
  const columns = header.split(",").map((cell) => cell.replace(/^"|"$/gu, ""));
  return lines.map((line) => {
    const cells = line.split(",").map((cell) => cell.replace(/^"|"$/gu, ""));
    return Object.fromEntries(columns.map((column, index) => [
      column,
      ["EC", "ICT", "MCO", "ATT"].includes(column) ? Number(cells[index]) : cells[index] ?? "",
    ])) as RawRow;
  });
}

function input(): AnalyzeRowsInput {
  return {
    rows: readSmallRaw().map((row) => ({ ...row, Phase: row.Group === "Experimental" ? "early" : "late" })),
    mapping: {
      units: ["Group", "Name"],
      conversation: ["Lesson"],
      codes: ["EC", "ICT", "MCO", "ATT"],
      metadata: ["Phase"],
      trajectory: {
        participant: ["Name"],
        group: "Group",
        time: "Lesson",
        timeOrder: ["Lesson 1", "Lesson 2"],
      },
    },
    config: { model: "AccumulatedTrajectory", windowSizeBack: 4 },
  };
}

describe("network product analysis", () => {
  it("computes group A minus group B in stable edge and full-dimension order", () => {
    const result = analyzeRows(input());
    const [groupA, groupB] = result.trajectory!.groupOrder;
    const comparison = compareGroupNetworks(result, [groupA!.canonical, groupB!.canonical]);

    expect(comparison.direction).toBe("group-a-minus-group-b");
    expect(comparison.groupA.canonical).toBe(groupA!.canonical);
    expect(comparison.groupB.canonical).toBe(groupB!.canonical);
    expect(comparison.meanA.meanCoordinates).toHaveLength(result.dimensions.length);
    expect(comparison.meanB.meanCoordinates).toHaveLength(result.dimensions.length);
    expect(comparison.differenceEdges.map((edge) => edge.id)).toEqual(result.edges.map((edge) => edge.id));
    comparison.differenceEdges.forEach((edge, index) => {
      expect(edge.meanWeight).toBeCloseTo(
        comparison.meanA.edges[index]!.meanWeight - comparison.meanB.edges[index]!.meanWeight,
        14,
      );
      expect(edge.semanticOwner).toBe(edge.meanWeight > 0 ? "group-a" : edge.meanWeight < 0 ? "group-b" : "equal");
    });
    expect(comparison.diagnostics).toContainEqual(expect.objectContaining({ code: "CONFIDENCE_BOX_PENDING_AUTHORITY" }));
  });

  it("rejects selecting the same group twice", () => {
    const result = analyzeRows(input());
    const group = result.trajectory!.groupOrder[0]!.canonical;
    expect(() => compareGroupNetworks(result, [group, group])).toThrowError(
      expect.objectContaining<Partial<NetworkAnalysisError>>({ code: "IDENTICAL_GROUPS" }),
    );
  });

  it("selects Change levels with exact scalar identity and preserves the source result", () => {
    const result = analyzeRows(input());
    const before = structuredClone(result);
    const change = analyzeChangeNetwork(result, { field: "Phase", level: "early" });

    expect(change.mean.pointCount).toBeGreaterThan(0);
    expect(change.mean.pointIndexes.every((index) => result.points[index]!.metadata.Phase === "early")).toBe(true);
    expect(change.mean.edges.map((edge) => edge.id)).toEqual(result.edges.map((edge) => edge.id));
    expect(result).toEqual(before);
  });

  it("does not collapse numeric and string levels", () => {
    const result = analyzeRows(input());
    result.points[0]!.metadata.Mixed = 1;
    result.points[1]!.metadata.Mixed = "1";

    expect(analyzeChangeNetwork(result, { field: "Mixed", level: 1 }).mean.pointIndexes).toEqual([0]);
    expect(analyzeChangeNetwork(result, { field: "Mixed", level: "1" }).mean.pointIndexes).toEqual([1]);
  });
});
