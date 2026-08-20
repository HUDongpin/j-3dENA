import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  AnalysisValidationError,
  analyzeRows,
  selectTrajectoryDisplay,
  type AnalyzeRowsInput,
  type RawRow
} from "./index";

function readSmallRaw(): RawRow[] {
  const path = new URL("../../parity-contracts/fixtures/small-raw.csv", import.meta.url);
  const lines = readFileSync(path, "utf8").trim().split(/\r?\n/);
  const headers = lines[0]!.split(",").map((cell) => cell.replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((cell) => cell.replace(/^"|"$/g, ""));
    return Object.fromEntries(headers.map((header, index) => {
      const value = cells[index] ?? "";
      return [header, ["EC", "ICT", "MCO", "ATT"].includes(header) ? Number(value) : value];
    })) as RawRow;
  });
}

function smallRawInput(): AnalyzeRowsInput {
  return {
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
  };
}

function duplicatePeriodRows(): RawRow[] {
  const rows: RawRow[] = [];
  for (const [groupIndex, group] of ["Experimental", "Control"].entries()) {
    for (let participantIndex = 0; participantIndex < 2; participantIndex += 1) {
      for (let timeIndex = 0; timeIndex < 2; timeIndex += 1) {
        for (let sessionIndex = 0; sessionIndex < 2; sessionIndex += 1) {
          const seed = groupIndex * 8 + participantIndex * 4 + timeIndex * 2 + sessionIndex;
          rows.push({
            group,
            person: `P${participantIndex + 1}`,
            time: `T${timeIndex + 1}`,
            session: `S${sessionIndex + 1}`,
            A: seed % 2,
            B: (seed + 1) % 3 === 0 ? 1 : 0,
            C: (seed + 2) % 4 === 0 ? 1 : 0,
            D: (seed + 3) % 5 === 0 ? 1 : 0
          });
        }
      }
    }
  }
  return rows;
}

function duplicatePeriodInput(rows = duplicatePeriodRows(), cohortPolicy: "available" | "complete" = "available"): AnalyzeRowsInput {
  return {
    rows,
    mapping: {
      units: ["group", "person"],
      conversation: ["time", "session"],
      codes: ["A", "B", "C", "D"],
      trajectory: {
        participant: ["person"],
        group: "group",
        time: "time",
        timeOrder: ["T1", "T2"],
        cohortPolicy
      }
    },
    config: {
      model: "AccumulatedTrajectory",
      windowSizeBack: 4
    }
  };
}

describe("analyzeRows", () => {
  it("runs the tracked legacy small-raw configuration in one shared 3D SVD space", () => {
    const result = analyzeRows(smallRawInput());

    expect(result.schemaVersion).toBe("3dena.analysis-result.v1");
    expect(result.axes).toEqual(["SVD1", "SVD2", "SVD3"]);
    expect(result.summary).toMatchObject({
      inputRows: 16,
      units: 8,
      points: 16,
      nodes: 4,
      edges: 6,
      groups: 2,
      timePoints: 2,
      participantPeriods: 16,
      trajectoryCentroids: 4
    });
    expect(result.rotation.columns.slice(0, 3)).toEqual(result.axes);
    expect(result.variance).toHaveLength(6);
    expect(result.variance.reduce((sum, dimension) => sum + dimension.proportion, 0)).toBeCloseTo(1, 9);
    expect(result.variance.filter((dimension) => dimension.displayed).map((dimension) => dimension.axis)).toEqual(result.axes);
    expect(result.points.every((point) => point.coordinates.length === 3 && point.lineWeights.length === 6)).toBe(true);
    expect(result.trajectory?.space).toBe("analysis-result-rotation");
    expect(result.provenance.legacyGoldenStatus).toBe("pending");
    expect(structuredClone(result)).toEqual(result);
  });

  it("reduces duplicate participant-period points before equal-weight group-time centroids", () => {
    const result = analyzeRows(duplicatePeriodInput());
    const trajectory = result.trajectory!;

    expect(result.points).toHaveLength(16);
    expect(trajectory.participantPeriods).toHaveLength(8);
    expect(trajectory.participantPeriods.every((point) => point.sourcePointIndexes.length === 2)).toBe(true);
    expect(trajectory.centroids).toHaveLength(4);
    expect(trajectory.centroids.every((centroid) => centroid.participantCount === 2)).toBe(true);

    for (const centroid of trajectory.centroids) {
      const members = centroid.participantPeriodIndexes.map((index) => trajectory.participantPeriods[index]!);
      const expected = [0, 1, 2].map((dimension) =>
        members.reduce((sum, member) => sum + member.coordinates[dimension]!, 0) / members.length
      );
      expect(centroid.coordinates).toEqual(expected);
    }
  });

  it("keeps complete and available cohort policies distinct", () => {
    const rows = duplicatePeriodRows().filter((row) => !(row.group === "Experimental" && row.person === "P2" && row.time === "T2"));
    const available = analyzeRows(duplicatePeriodInput(rows, "available")).trajectory!;
    const complete = analyzeRows(duplicatePeriodInput(rows, "complete")).trajectory!;

    const experimentalAvailable = available.centroids.find((centroid) => centroid.group.value === "Experimental" && centroid.time.value === "T1");
    const experimentalComplete = complete.centroids.find((centroid) => centroid.group.value === "Experimental" && centroid.time.value === "T1");
    expect(experimentalAvailable?.participantCount).toBe(2);
    expect(experimentalComplete?.participantCount).toBe(1);
    expect(complete.participantPeriods.some((point) => point.participantLabel.display === "P2" && !point.includedInCohort)).toBe(true);
  });

  it("applies display-only group filters without recomputing model or centroid objects", () => {
    const result = analyzeRows(smallRawInput());
    const trajectory = result.trajectory!;
    const selectedGroup = trajectory.groupOrder[0]!;
    const rotationBefore = structuredClone(result.rotation);
    const selection = selectTrajectoryDisplay(trajectory, { groups: [selectedGroup.canonical] });

    expect(selection.groupOrder).toEqual([selectedGroup]);
    expect(selection.paths).toHaveLength(1);
    expect(selection.centroids).toHaveLength(2);
    expect(selection.centroids[0]).toBe(trajectory.centroids.find((centroid) => centroid.group.canonical === selectedGroup.canonical));
    expect(result.rotation).toEqual(rotationBefore);
  });

  it("uses collision-safe typed tuple identities instead of delimiter joins", () => {
    const result = analyzeRows({
      rows: [
        { unitA: "a.b", unitB: "c", conv: "one", A: 1, B: 1, C: 0 },
        { unitA: "a", unitB: "b.c", conv: "one", A: 0, B: 1, C: 1 }
      ],
      mapping: {
        units: ["unitA", "unitB"],
        conversation: ["conv"],
        codes: ["A", "B", "C"]
      },
      config: { model: "EndPoint" }
    });

    expect(result.summary.units).toBe(2);
    expect(new Set(result.points.map((point) => point.unit.canonical)).size).toBe(2);
  });

  it("rejects unsafe numeric identities, invalid mappings, and resource excess before jENA", () => {
    const base = smallRawInput();
    const unsafe = structuredClone(base);
    unsafe.rows[0]!.Name = Number.MAX_SAFE_INTEGER + 1;
    expect(() => analyzeRows(unsafe)).toThrow(AnalysisValidationError);

    const invalidGroup = structuredClone(base);
    invalidGroup.mapping.units = ["Name"];
    expect(() => analyzeRows(invalidGroup)).toThrow(/group must also occur in mapping.units/);

    const tooManyRows = structuredClone(base);
    tooManyRows.limits = { maxRows: 1 };
    expect(() => analyzeRows(tooManyRows)).toThrow(/exceeds maxRows=1/);
  });

  it("rejects metadata that is not constant within a typed unit", () => {
    const input = smallRawInput();
    input.mapping.metadata = ["role"];
    input.rows.forEach((row) => { row.role = "student"; });
    input.rows[2]!.role = "teacher";
    expect(() => analyzeRows(input)).toThrow(/metadata declared as unit-level must be constant/);
  });
});
