import type {
  PreparedEntityKey,
  PreparedSpaceResult,
  PreparedTypedValue,
  RawScalar,
} from "@3dena/analysis";
import { describe, expect, it } from "vitest";
import {
  PreparedDerivedAnalysisError,
  analyzePreparedChangeNetwork,
  comparePreparedGroupNetworks,
  describePreparedGroups,
  preparedChangeFieldOptions,
} from "@/lib/prepared-derived-analysis";

function typed(value: string, column: string): PreparedTypedValue {
  return {
    canonical: `${column}:string:${value}`,
    display: value,
    column,
    columnType: "character",
    value,
  };
}

function key(group: string, participant: string): PreparedEntityKey {
  return {
    canonical: JSON.stringify([["Group", group], ["Participant", participant]]),
    display: `${group} · ${participant}`,
    columns: ["Group", "Participant"],
    columnTypes: ["character", "character"],
    values: [group, participant],
  };
}

function fixture(): PreparedSpaceResult {
  const rows: Array<{
    group: string;
    participant: string;
    phase: RawScalar;
    coordinates: number[];
    weight: number;
  }> = [
    { group: "A", participant: "P1", phase: 1, coordinates: [1, 10, 100], weight: 1 },
    { group: "A", participant: "P2", phase: "1", coordinates: [3, 14, 104], weight: 3 },
    { group: "B", participant: "P3", phase: 1, coordinates: [2, 18, 108], weight: 2 },
    { group: "B", participant: "P4", phase: "1", coordinates: [6, 22, 112], weight: 4 },
  ];
  const points = rows.map((row, index) => {
    const id = key(row.group, row.participant);
    return {
      index,
      id,
      participant: id,
      participantLabel: typed(row.participant, "Participant"),
      group: typed(row.group, "Group"),
      time: typed("T1", "Time"),
      metadata: { Phase: row.phase },
      coordinates: row.coordinates,
    };
  });
  return {
    schemaVersion: "3dena.prepared-space-result.v1",
    sourceKind: "prepared-exchange",
    rawJenaRecompute: false,
    sourceReceipt: {
      name: "fixture.ena3d.json",
      sha256: "a".repeat(64),
      byteLength: 512,
    },
    artifacts: { rotation: "not-present", eigenvalues: "not-present", variance: "not-present" },
    fullSpace: {
      dimensions: ["SVD1", "SVD2", "SVD3"],
      points,
      nodes: [
        { index: 0, code: "C1", coordinates: [0, 0, 0] },
        { index: 1, code: "C2", coordinates: [1, 1, 1] },
      ],
      edges: [{
        index: 0,
        id: "C1--C2",
        column: "C1 & C2",
        source: "C1",
        target: "C2",
        sourceIndex: 0,
        targetIndex: 1,
        meanWeight: 2.5,
      }],
      lineWeights: {
        rowKeys: points.map((point) => point.id),
        columns: ["C1 & C2"],
        values: rows.map((row) => [row.weight]),
      },
    },
    displaySpace: {
      dimensions: ["SVD1", "SVD2", "SVD3"],
      points: points.map((point) => ({
        pointIndex: point.index,
        id: point.id,
        group: point.group,
        time: point.time,
        coordinates: point.coordinates as [number, number, number],
      })),
      nodes: [],
      trajectory: {
        space: "prepared-exchange-display-space",
        dimensions: ["SVD1", "SVD2", "SVD3"],
        cohortPolicy: "available",
        groupOrder: [typed("A", "Group"), typed("B", "Group")],
        timeOrder: [typed("T1", "Time")],
        participantPeriods: [],
        centroids: [],
        paths: [],
      },
    },
    summary: {
      dimensions: 3,
      points: 4,
      nodes: 2,
      edges: 1,
      lineWeightRows: 4,
      groups: 2,
      timePoints: 1,
      participantPeriods: 0,
      trajectoryCentroids: 0,
    },
    diagnostics: [],
    provenance: {
      adapter: "@3dena/analysis",
      adapterVersion: "0.1.0",
      coordinateSpace: "precomputed-import",
      computation: "reduction-only",
      jenaExecuted: false,
      resolvedMapping: {
        participant: ["Group", "Participant"],
        participantLabel: "Participant",
        group: "Group",
        time: "Time",
        timeOrder: ["T1"],
        cohortPolicy: "available",
        displayDimensions: ["SVD1", "SVD2", "SVD3"],
        missingDisplayCoordinates: "reject",
      },
    },
  };
}

describe("prepared derived reductions", () => {
  it("compares aligned imported line weights without changing the prepared boundary", () => {
    const result = fixture();
    const [groupA, groupB] = result.displaySpace.trajectory.groupOrder;
    const comparison = comparePreparedGroupNetworks(
      result,
      [groupA!.canonical, groupB!.canonical],
    );

    expect(comparison).toMatchObject({
      schemaVersion: "3dena.prepared-network-comparison.v1",
      sourceKind: "prepared-exchange",
      rawJenaRecompute: false,
      meanA: { pointCount: 2, edges: [{ meanWeight: 2 }] },
      meanB: { pointCount: 2, edges: [{ meanWeight: 3 }] },
      differenceEdges: [{ meanWeight: -1, semanticOwner: "group-b" }],
    });
    expect(result.provenance.jenaExecuted).toBe(false);
  });

  it("keeps numeric 1 distinct from string 1 in prepared level selection", () => {
    const result = fixture();
    const phase = preparedChangeFieldOptions(result).find((option) => option.field === "Phase");
    expect(phase?.levels).toHaveLength(2);
    expect(new Set(phase?.levels.map((level) => level.token)).size).toBe(2);

    const numeric = analyzePreparedChangeNetwork(result, { field: "Phase", level: 1 });
    const string = analyzePreparedChangeNetwork(result, { field: "Phase", level: "1" });
    expect(numeric.mean.pointIndexes).toEqual([0, 2]);
    expect(string.mean.pointIndexes).toEqual([1, 3]);
    expect(numeric.levelCanonical).not.toBe(string.levelCanonical);
  });

  it("reports descriptive full-space moments and explicitly withholds inference", () => {
    const result = fixture();
    const [groupA, groupB] = result.displaySpace.trajectory.groupOrder;
    const statistics = describePreparedGroups(
      result,
      [groupA!.canonical, groupB!.canonical],
      ["SVD1", "SVD3"],
    );

    expect(statistics.dimensions[0]).toMatchObject({
      dimension: "SVD1",
      sideA: { count: 2, mean: 2 },
      sideB: { count: 2, mean: 4 },
      meanDifference: -2,
    });
    expect(statistics.dimensions[0]!.sideA.sampleStandardDeviation).toBeCloseTo(Math.sqrt(2), 12);
    expect(statistics.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PREPARED_INFERENTIAL_TASK_UNAVAILABLE" }),
    ]));
  });

  it("fails closed when line-weight identity order is corrupted", () => {
    const result = fixture();
    result.fullSpace.lineWeights.rowKeys.reverse();
    const groups = result.displaySpace.trajectory.groupOrder;
    expect(() => comparePreparedGroupNetworks(
      result,
      [groups[0]!.canonical, groups[1]!.canonical],
    )).toThrowError(expect.objectContaining<Partial<PreparedDerivedAnalysisError>>({
      code: "MISALIGNED_LINE_WEIGHT_IDENTITY",
    }));
  });
});
