import { describe, expect, it } from "vitest";

import {
  TrajectoryStatisticsError,
  analyzeTrajectoryPath,
  compareTrajectoryPaths,
  getTrajectoryPermutationUnits,
  holmAdjust,
  type IndependentTrajectoryComparisonInput,
  type PairedTrajectoryComparisonInput,
  type TrajectoryIdentity,
  type TrajectorySeriesInput,
  type TrajectoryStatisticsPoint
} from "./trajectory-statistics";

const time = (value: string): TrajectoryIdentity => ({ components: [{ name: "Period", type: "string", value }] });
const participant = (value: string, group = "G"): TrajectoryIdentity => ({
  components: [
    { name: "Group", type: "string", value: group },
    { name: "StableId", type: "string", value }
  ]
});

function point(id: string, period: string, coordinates: number[], group = "G"): TrajectoryStatisticsPoint {
  return { participant: participant(id, group), time: time(period), coordinates };
}

function series(
  points: TrajectoryStatisticsPoint[],
  overrides: Partial<TrajectorySeriesInput> = {}
): TrajectorySeriesInput {
  return {
    namespace: "sample",
    points,
    dimensions: ["SVD1", "SVD2", "SVD3", "SVD4"],
    selectedDimensions: ["SVD1", "SVD2", "SVD3"],
    timeOrder: [time("A"), time("B"), time("C")],
    cohortPolicy: "available",
    ...overrides
  };
}

describe("trajectory descriptive/path statistics", () => {
  it("supports an explicit weighted-participant estimand without giving duplicate source rows extra weight", () => {
    const weighted = series([
      { ...point("P1", "A", [0, 0, 0, 0]), weight: 1 },
      { ...point("P1", "A", [2, 0, 0, 2]), weight: 1 },
      { ...point("P2", "A", [10, 0, 0, 10]), weight: 3 },
    ], {
      timeOrder: [time("A")],
      estimand: "weighted-participant",
    });
    const result = analyzeTrajectoryPath(weighted);

    expect(result.estimand).toBe("weighted-participant");
    expect(result.participantPeriods.map((row) => row.participantWeight)).toEqual([1, 3]);
    expect(result.periods[0]!.selectedCentroid).toEqual([7.75, 0, 0]);
    expect(result.periods[0]!.fullCentroid).toEqual([7.75, 0, 0, 7.75]);

    const unstable = structuredClone(weighted);
    unstable.points[1]!.weight = 2;
    expect(() => analyzeTrajectoryPath(unstable)).toThrowError(expect.objectContaining({ code: "UNSTABLE_PARTICIPANT_PERIOD_WEIGHT" }));
    const nonPositive = structuredClone(weighted);
    nonPositive.points[0]!.weight = 0;
    expect(() => analyzeTrajectoryPath(nonPositive)).toThrowError(expect.objectContaining({ code: "INVALID_PARTICIPANT_WEIGHT" }));
  });

  it("reduces duplicates, preserves lossless string IDs, and distinguishes selected from full distance", () => {
    const input = series([
      point("9007199254740992", "A", [0, 0, 0, 0]),
      point("9007199254740992", "A", [2, 0, 0, 2]),
      point("9007199254740992", "C", [4, 0, 0, 8]),
      point("9007199254740993", "A", [2, 0, 0, 0]),
      point("9007199254740993", "B", [3, 0, 0, 6]),
      point("9007199254740993", "C", [4, 0, 0, 8])
    ]);
    const result = analyzeTrajectoryPath(input);

    expect(result.summary).toEqual({ inputRows: 6, participants: 2, participantPeriods: 5, periods: 3, duplicateRows: 1 });
    expect(result.participantPeriods.find((row) => row.participant.display.endsWith("9007199254740992") && row.time.display === "A")).toMatchObject({
      selectedCoordinates: [1, 0, 0],
      fullCoordinates: [1, 0, 0, 1],
      sourceRowIndexes: [0, 1]
    });
    expect(new Set(result.participantPeriods.map((row) => row.participant.canonical)).size).toBe(2);
    expect(result.periods.map((period) => period.nUsed)).toEqual([2, 1, 2]);
    expect(result.periods[1]!.selected3d.stepDistance).toBeCloseTo(1.5, 12);
    expect(result.periods[1]!.fullSpace.stepDistance).toBeCloseTo(Math.sqrt(1.5 ** 2 + 5.5 ** 2), 12);
    expect(result.periods[1]!.fullSpace.stepDistance).toBeGreaterThan(result.periods[1]!.selected3d.stepDistance!);
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "DUPLICATE_PARTICIPANT_PERIOD_ROWS",
      "CHANGING_AVAILABLE_COHORT"
    ]));
    expect(structuredClone(result)).toEqual(result);
  });

  it("applies complete cohorts and represents expected missing periods as non-bridged gaps", () => {
    const complete = analyzeTrajectoryPath(series([
      point("P1", "A", [0, 0, 0, 0]),
      point("P1", "C", [2, 0, 0, 2]),
      point("P2", "A", [10, 0, 0, 10]),
      point("P2", "B", [11, 0, 0, 11]),
      point("P2", "C", [12, 0, 0, 12])
    ], { cohortPolicy: "complete" }));
    expect(complete.periods.map((period) => period.nUsed)).toEqual([1, 1, 1]);
    expect(complete.periods.map((period) => period.nCohortExcluded)).toEqual([1, 0, 1]);
    expect(complete.participantPeriods.filter((row) => row.participant.display.endsWith("P1")).every((row) => !row.includedInCohort)).toBe(true);

    const gap = analyzeTrajectoryPath(series([
      point("P1", "A", [0, 0, 0, 0]),
      point("P1", "C", [2, 0, 0, 4])
    ]));
    expect(gap.periods[1]).toMatchObject({ selectedCentroid: null, fullCentroid: null });
    expect(gap.periods[1]!.selected3d).toMatchObject({ delta: null, stepDistance: null, cumulativeDistance: null });
    expect(gap.periods[2]!.selected3d).toMatchObject({ delta: null, stepDistance: null, cumulativeDistance: null });
    expect(gap.diagnostics).toContainEqual(expect.objectContaining({ code: "MISSING_TRAJECTORY_PERIOD" }));
  });

  it("keeps finite extreme centroids representable and retains compensated cancellation residuals", () => {
    const cancellation = analyzeTrajectoryPath(series([
      point("P1", "A", [1e308, 0, 0, 0]),
      point("P1", "A", [1, 0, 0, 0]),
      point("P1", "A", [-1e308, 0, 0, 0])
    ], { timeOrder: [time("A")] }));
    expect(cancellation.participantPeriods[0]!.fullCoordinates[0]).toBeCloseTo(1 / 3, 15);
    expect(cancellation.periods[0]!.fullCentroid![0]).toBeCloseTo(1 / 3, 15);

    const balanced = analyzeTrajectoryPath(series([
      point("positive", "A", [1e308, 1e308, 1e308, 1e308]),
      point("negative", "A", [-1e308, -1e308, -1e308, -1e308])
    ], { timeOrder: [time("A")] }));
    expect(balanced.periods[0]!.fullCentroid).toEqual([0, 0, 0, 0]);
    expect(balanced.periods[0]!.selected3d.stepDistance).toBe(0);

    const sameSign = analyzeTrajectoryPath(series([
      point("P1", "A", [1e308, 1e308, 1e308, 1e308]),
      point("P1", "A", [1e308, 1e308, 1e308, 1e308])
    ], { timeOrder: [time("A")] }));
    expect(sameSign.participantPeriods[0]!.fullCoordinates).toEqual([1e308, 1e308, 1e308, 1e308]);
  });

  it("keeps tuple boundaries/types distinct and rejects unsafe, non-finite, and excessive inputs", () => {
    const typed = analyzeTrajectoryPath(series([
      {
        participant: { components: [{ name: "a", type: "string", value: "x.y" }, { name: "b", type: "string", value: "z" }] },
        time: time("A"), coordinates: [0, 0, 0, 0]
      },
      {
        participant: { components: [{ name: "a", type: "string", value: "x" }, { name: "b", type: "string", value: "y.z" }] },
        time: time("A"), coordinates: [1, 0, 0, 0]
      },
      {
        participant: { components: [{ name: "n", type: "number", value: -0 }] },
        time: time("A"), coordinates: [2, 0, 0, 0]
      },
      {
        participant: { components: [{ name: "n", type: "number", value: 0 }] },
        time: time("A"), coordinates: [3, 0, 0, 0]
      }
    ]));
    expect(typed.summary.participants).toBe(4);

    const unsafe = series([point("P", "A", [0, 0, 0, 0])]);
    unsafe.points[0]!.participant = { components: [{ name: "id", type: "number", value: 9_007_199_254_740_992 }] };
    expect(() => analyzeTrajectoryPath(unsafe)).toThrowError(expect.objectContaining({ code: "UNSAFE_INTEGER_IDENTITY" }));

    const nonFinite = series([point("P", "A", [0, 0, 0, Number.NaN])]);
    expect(() => analyzeTrajectoryPath(nonFinite)).toThrowError(expect.objectContaining({ code: "NON_FINITE_TRAJECTORY_COORDINATE" }));

    const limited = series([point("P", "A", [0, 0, 0, 0])], { limits: { maxPoints: 1, maxCells: 3 } });
    expect(() => analyzeTrajectoryPath(limited)).toThrowError(expect.objectContaining({ code: "TRAJECTORY_CELL_LIMIT" }));
  });
});

function pairedSide(label: "A" | "B", offset: number): TrajectorySeriesInput {
  return series([
    point("P1", "A", [offset, 0, 0, 0], label),
    point("P1", "B", [offset + 1, 0, 0, 2], label),
    point("P1", "C", [offset + 2, 0, 0, 4], label),
    point("P2", "A", [offset + 2, 0, 0, 0], label),
    point("P2", "B", [offset + 3, 0, 0, 2], label),
    point("P2", "C", [offset + 4, 0, 0, 4], label)
  ], { namespace: `paired-${label}` });
}

describe("paired trajectory comparison", () => {
  it("requires explicit exact pairing, computes B-minus-A, and applies caller-bound swaps plus Holm", () => {
    const base: PairedTrajectoryComparisonInput = {
      design: "paired",
      pairedId: "StableId",
      sideA: { label: "A", series: pairedSide("A", 0) },
      sideB: { label: "B", series: pairedSide("B", 10) }
    };
    const units = getTrajectoryPermutationUnits(base);
    expect(units).toMatchObject({ design: "paired", sideACount: null });
    expect(units.unitOrder).toHaveLength(2);
    const result = compareTrajectoryPaths({
      ...base,
      permutationPlan: {
        kind: "paired-swap-indices-v1",
        unitOrder: units.unitOrder,
        replicates: [[], [0], [1], [0, 1]]
      }
    });

    expect(result.design).toBe("paired");
    expect(result.direction).toBe("B-minus-A");
    expect(result.periods.every((period) => period.selectedDifference?.[0] === 10)).toBe(true);
    expect(result.periods.every((period) => period.nMatched === 2)).toBe(true);
    expect(result.tests.length).toBeGreaterThan(0);
    expect(result.tests.every((test) => test.permutationCount === 4 && test.holmAdjustedPValue >= test.pValue)).toBe(true);
    expect(result.permutation).toMatchObject({ status: "complete", rngParityClaim: false, replicateCount: 4 });
    expect(structuredClone(result)).toEqual(result);
  });

  it("rejects missing, duplicate, and unmatched exact pairs", () => {
    const missingId = pairedSide("A", 0);
    missingId.points[0]!.participant = { components: [{ name: "Group", type: "string", value: "A" }] };
    expect(() => compareTrajectoryPaths({
      design: "paired", pairedId: "StableId",
      sideA: { label: "A", series: missingId },
      sideB: { label: "B", series: pairedSide("B", 1) }
    })).toThrowError(expect.objectContaining({ code: "MISSING_PAIRED_ID" }));

    const duplicate = pairedSide("A", 0);
    duplicate.points.push({
      participant: { components: [{ name: "Group", type: "string", value: "A" }, { name: "StableId", type: "string", value: "P1" }, { name: "Clone", type: "string", value: "2" }] },
      time: time("A"), coordinates: [0, 0, 0, 0]
    });
    expect(() => compareTrajectoryPaths({
      design: "paired", pairedId: "StableId",
      sideA: { label: "A", series: duplicate },
      sideB: { label: "B", series: pairedSide("B", 1) }
    })).toThrowError(expect.objectContaining({ code: "DUPLICATE_PAIRED_ID_TIME" }));

    const unmatched = pairedSide("B", 1);
    unmatched.points = unmatched.points.filter((entry) => !(entry.participant.components[1]!.value === "P2" && entry.time.components[0]!.value === "B"));
    expect(() => compareTrajectoryPaths({
      design: "paired", pairedId: "StableId",
      sideA: { label: "A", series: pairedSide("A", 0) },
      sideB: { label: "B", series: unmatched }
    })).toThrowError(expect.objectContaining({ code: "UNMATCHED_PAIRED_ID_TIME" }));
  });
});

describe("independent trajectory comparison", () => {
  it("keeps identical raw IDs in separate namespaces and uses whole-history pool permutations", () => {
    const input: IndependentTrajectoryComparisonInput = {
      design: "independent",
      sideA: { label: "A", series: { ...pairedSide("A", 0), namespace: "independent-A" } },
      sideB: { label: "B", series: { ...pairedSide("A", 4), namespace: "independent-B" } }
    };
    const units = getTrajectoryPermutationUnits(input);
    expect(units).toMatchObject({ design: "independent", sideACount: 2 });
    expect(units.unitOrder).toHaveLength(4);
    expect(new Set(units.unitOrder).size).toBe(4);
    const result = compareTrajectoryPaths({
      ...input,
      permutationPlan: {
        kind: "independent-pool-indices-v1",
        unitOrder: units.unitOrder,
        replicates: [
          [0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2],
          [1, 2, 0, 3], [1, 3, 0, 2], [2, 3, 0, 1]
        ]
      }
    });
    expect(result.design).toBe("independent");
    expect(result.pairedId).toBeNull();
    expect(result.periods.every((period) => period.nMatched === null)).toBe(true);
    expect(result.tests.every((test) => test.permutationCount === 6)).toBe(true);
  });

  it("rejects namespace collisions and reports degenerate groups", () => {
    const sameNamespace: IndependentTrajectoryComparisonInput = {
      design: "independent",
      sideA: { label: "A", series: pairedSide("A", 0) },
      sideB: { label: "B", series: pairedSide("B", 1) }
    };
    sameNamespace.sideB.series.namespace = sameNamespace.sideA.series.namespace;
    expect(() => compareTrajectoryPaths(sameNamespace)).toThrowError(expect.objectContaining({ code: "INDEPENDENT_NAMESPACE_COLLISION" }));

    const oneA = series([point("P1", "A", [0, 0, 0, 0])], { namespace: "one-A", timeOrder: [time("A")] });
    const oneB = series([point("P2", "A", [1, 0, 0, 0])], { namespace: "one-B", timeOrder: [time("A")] });
    const degenerate = compareTrajectoryPaths({ design: "independent", sideA: { label: "A", series: oneA }, sideB: { label: "B", series: oneB } });
    expect(degenerate.diagnostics).toContainEqual(expect.objectContaining({ code: "DEGENERATE_COMPARISON_GROUP" }));
    expect(degenerate.tests).toEqual([]);
  });

  it("validates exact permutation custody and Holm adjustment", () => {
    expect(holmAdjust([0.01, 0.04, 0.03])).toEqual([0.03, 0.06, 0.06]);
    expect(() => holmAdjust([1.1])).toThrowError(TrajectoryStatisticsError);

    const input: IndependentTrajectoryComparisonInput = {
      design: "independent",
      sideA: { label: "A", series: { ...pairedSide("A", 0), namespace: "A" } },
      sideB: { label: "B", series: { ...pairedSide("B", 1), namespace: "B" } }
    };
    expect(() => compareTrajectoryPaths({
      ...input,
      permutationPlan: { kind: "independent-pool-indices-v1", unitOrder: ["forged"], replicates: [[0]] }
    })).toThrowError(expect.objectContaining({ code: "PERMUTATION_UNIT_ORDER_MISMATCH" }));
  });
});
