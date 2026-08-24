import { describe, expect, it } from "vitest";

import { analyzeRows } from "./analyze";
import {
  adaptAnalysisResultTrajectorySeries,
  adaptPreparedSpaceTrajectorySeries
} from "./trajectory-series-adapters";
import {
  TrajectoryStatisticsError,
  bootstrapTrajectoryPath,
  createSeededTrajectoryBootstrapPlan,
  getTrajectoryBootstrapUnits,
  trajectoryPercentile,
  type TrajectoryBootstrapInput,
  type TrajectoryBootstrapPlan,
  type TrajectoryIdentity,
  type TrajectorySeriesInput,
  type TrajectoryStatisticsPoint
} from "./trajectory-statistics";
import { createSyntheticPreparedFixture } from "../test-support/synthetic-prepared-exchange";

const identity = (name: string, value: string): TrajectoryIdentity => ({
  components: [{ name, type: "string", value }]
});

function bootstrapPoint(
  participant: string,
  period: string,
  coordinates: number[],
  stratum?: string
): TrajectoryStatisticsPoint {
  return {
    participant: identity("StableId", participant),
    time: identity("Period", period),
    coordinates,
    ...(stratum ? { stratum: identity("Site", stratum) } : {})
  };
}

function bootstrapSeries(overrides: Partial<TrajectorySeriesInput> = {}): TrajectorySeriesInput {
  return {
    namespace: "bootstrap-sample",
    dimensions: ["SVD1", "SVD2", "SVD3", "SVD4"],
    selectedDimensions: ["SVD1", "SVD2", "SVD3"],
    timeOrder: [identity("Period", "T1"), identity("Period", "T2")],
    cohortPolicy: "available",
    points: [
      bootstrapPoint("9007199254740992", "T1", [0, 0, 0, 0], "North"),
      bootstrapPoint("9007199254740992", "T2", [1, 0, 0, 4], "North"),
      bootstrapPoint("9007199254740993", "T1", [2, 0, 0, 0], "North"),
      bootstrapPoint("9007199254740993", "T2", [3, 0, 0, 4], "North"),
      bootstrapPoint("P3", "T1", [8, 0, 0, 0], "South"),
      bootstrapPoint("P3", "T2", [10, 0, 0, 8], "South"),
      bootstrapPoint("P4", "T1", [12, 0, 0, 0], "South"),
      bootstrapPoint("P4", "T2", [14, 0, 0, 8], "South")
    ],
    ...overrides
  };
}

describe("participant-history trajectory bootstrap", () => {
  it("builds deterministic seeded whole-history plans and versioned selected/full percentile intervals", () => {
    const series = bootstrapSeries();
    const units = getTrajectoryBootstrapUnits({ series, stratifyBy: "explicit" });
    expect(units.unitOrder).toHaveLength(4);
    expect(units.strata.map((stratum) => [stratum.key.display, stratum.unitIndexes.length])).toEqual([
      ["North", 2],
      ["South", 2]
    ]);
    const plan = createSeededTrajectoryBootstrapPlan({ units, repetitions: 20, seed: 2026 });
    expect(createSeededTrajectoryBootstrapPlan({ units, repetitions: 20, seed: 2026 })).toEqual(plan);
    expect(plan.generation).toMatchObject({
      kind: "seeded",
      algorithm: "mulberry32-uint32-v1",
      seed: 2026,
      unitSort: "utf16-code-unit-ascending",
      randomEndpoint: "zero-inclusive-one-exclusive"
    });
    for (const stratum of plan.strata) {
      expect(stratum.replicates).toHaveLength(20);
      expect(stratum.replicates.every((draw) => draw.length === stratum.unitIndexes.length)).toBe(true);
      expect(stratum.replicates.flat().every((index) => stratum.unitIndexes.includes(index))).toBe(true);
    }

    const result = bootstrapTrajectoryPath({
      series,
      stratifyBy: "explicit",
      confidenceLevel: 0.5,
      plan
    });
    expect(result.schemaVersion).toBe("3dena.trajectory-bootstrap.v1");
    expect(result.resampling).toMatchObject({
      unit: "participant-complete-history",
      stratified: true,
      replicateCount: 20,
      rngParityClaim: false
    });
    expect(result.quantileRule).toEqual({
      id: "linear-type7-v1",
      sort: "ascending-numeric",
      position: "(n-1)*p",
      interpolation: "linear-between-floor-and-ceiling",
      endpoints: "p=0-min-p=1-max"
    });
    expect(result.periods[0]!.selectedCentroid.every((interval) => interval !== null)).toBe(true);
    expect(result.periods[1]!.fullCentroid).toHaveLength(4);
    expect(result.periods[1]!.selectedStepDistance).not.toBeNull();
    expect(result.periods[1]!.fullStepDistance).not.toBeNull();
    expect(result.periods[1]!.fullStepDistance!.upper).toBeGreaterThanOrEqual(result.periods[1]!.selectedStepDistance!.upper);
    expect(structuredClone(result)).toEqual(result);
  });

  it("freezes the linear type-7 quantile endpoints, sorting, and interpolation", () => {
    expect(trajectoryPercentile([10, 0], 0)).toBe(0);
    expect(trajectoryPercentile([10, 0], 1)).toBe(10);
    expect(trajectoryPercentile([10, 0], 0.25)).toBe(2.5);
    expect(trajectoryPercentile([0, 10, 20, 30], 0.5)).toBe(15);
    expect(() => trajectoryPercentile([0, Number.NaN], 0.5)).toThrowError(expect.objectContaining({ code: "NON_FINITE_BOOTSTRAP_VALUE" }));
  });

  it("keeps representable extreme bootstrap estimates and percentile endpoints finite", () => {
    const series = bootstrapSeries({
      timeOrder: [identity("Period", "T1")],
      points: [
        bootstrapPoint("positive", "T1", [1e308, 1e308, 1e308, 1e308]),
        bootstrapPoint("residual", "T1", [1, 1, 1, 1]),
        bootstrapPoint("negative", "T1", [-1e308, -1e308, -1e308, -1e308])
      ]
    });
    const units = getTrajectoryBootstrapUnits({ series, stratifyBy: "none" });
    const plan = createSeededTrajectoryBootstrapPlan({ units, repetitions: 40, seed: 44 });
    const result = bootstrapTrajectoryPath({ series, stratifyBy: "none", confidenceLevel: 0.5, plan });
    expect(result.base.periods[0]!.fullCentroid![0]).toBeCloseTo(1 / 3, 15);
    for (const interval of result.periods[0]!.fullCentroid) {
      expect(interval).not.toBeNull();
      expect([interval!.estimate, interval!.lower, interval!.upper].every(Number.isFinite)).toBe(true);
    }
  });

  it("executes an exact caller-provided plan while preserving available-cohort history gaps", () => {
    const series = bootstrapSeries({
      points: [
        bootstrapPoint("complete", "T1", [0, 0, 0, 0]),
        bootstrapPoint("complete", "T2", [1, 0, 0, 1]),
        bootstrapPoint("missing", "T1", [4, 0, 0, 4])
      ]
    });
    const units = getTrajectoryBootstrapUnits({ series, stratifyBy: "none" });
    const exactDraw = [...units.strata[0]!.unitIndexes];
    const plan: TrajectoryBootstrapPlan = {
      kind: "participant-history-resample-indices-v1",
      unitOrder: [...units.unitOrder],
      strata: [{
        key: units.strata[0]!.key,
        unitIndexes: [...units.strata[0]!.unitIndexes],
        replicates: Array.from({ length: 20 }, () => [...exactDraw])
      }],
      generation: { kind: "caller-provided" }
    };
    const result = bootstrapTrajectoryPath({ series, stratifyBy: "none", confidenceLevel: 0.5, plan });
    expect(result.base.periods.map((period) => period.nUsed)).toEqual([2, 1]);
    expect(result.periods[0]!.selectedCentroid.every((interval) => interval !== null)).toBe(true);
    expect(result.periods[1]!.selectedCentroid.every((interval) => interval === null)).toBe(true);
    expect(result.resampling.generation).toEqual({ kind: "caller-provided" });
    const reordered = structuredClone(plan);
    reordered.unitOrder.reverse();
    expect(() => bootstrapTrajectoryPath({ series, stratifyBy: "none", confidenceLevel: 0.5, plan: reordered })).toThrowError(expect.objectContaining({ code: "BOOTSTRAP_UNIT_ORDER_MISMATCH" }));
  });

  it("keeps complete-cohort exclusions out of the cluster pool and diagnoses a single cluster", () => {
    const complete = bootstrapSeries({
      cohortPolicy: "complete",
      points: [
        bootstrapPoint("complete", "T1", [0, 0, 0, 0]),
        bootstrapPoint("complete", "T2", [1, 0, 0, 1]),
        bootstrapPoint("missing", "T1", [5, 0, 0, 5])
      ]
    });
    const units = getTrajectoryBootstrapUnits({ series: complete, stratifyBy: "none" });
    expect(units.unitOrder).toHaveLength(1);
    expect(units.unitOrder[0]).toContain("complete");
    const plan = createSeededTrajectoryBootstrapPlan({ units, repetitions: 20, seed: 1 });
    const result = bootstrapTrajectoryPath({ series: complete, stratifyBy: "none", confidenceLevel: 0.5, plan });
    expect(result.base.periods.map((period) => period.nUsed)).toEqual([1, 1]);
    expect(result.periods.every((period) => period.selectedCentroid.every((interval) => interval === null))).toBe(true);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "BOOTSTRAP_INSUFFICIENT_CLUSTERS" }));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "BOOTSTRAP_SINGLETON_STRATUM" }));
  });

  it("reports a degenerate bootstrap distribution when distinct clusters have identical histories", () => {
    const series = bootstrapSeries({
      points: [
        bootstrapPoint("P1", "T1", [1, 2, 3, 4]),
        bootstrapPoint("P1", "T2", [2, 3, 4, 5]),
        bootstrapPoint("P2", "T1", [1, 2, 3, 4]),
        bootstrapPoint("P2", "T2", [2, 3, 4, 5])
      ]
    });
    const units = getTrajectoryBootstrapUnits({ series, stratifyBy: "none" });
    const plan = createSeededTrajectoryBootstrapPlan({ units, repetitions: 20, seed: 17 });
    const result = bootstrapTrajectoryPath({ series, stratifyBy: "none", confidenceLevel: 0.5, plan });
    expect(result.periods[1]!.fullCentroid.every((interval) => interval !== null)).toBe(true);
    expect(result.periods[1]!.fullCentroid.every((interval) => interval!.lower === interval!.upper)).toBe(true);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "BOOTSTRAP_DEGENERATE_DISTRIBUTION" }));
  });

  it("rejects missing/unstable/duplicate strata and plan or resource overflow", () => {
    const missing = bootstrapSeries();
    delete missing.points[0]!.stratum;
    expect(() => getTrajectoryBootstrapUnits({ series: missing, stratifyBy: "explicit" })).toThrowError(expect.objectContaining({ code: "MISSING_BOOTSTRAP_STRATUM" }));

    const unstable = bootstrapSeries();
    unstable.points[1]!.stratum = identity("Site", "South");
    expect(() => getTrajectoryBootstrapUnits({ series: unstable, stratifyBy: "explicit" })).toThrowError(expect.objectContaining({ code: "UNSTABLE_BOOTSTRAP_STRATUM" }));

    const duplicateComponents = bootstrapSeries();
    duplicateComponents.points[0]!.stratum = {
      components: [
        { name: "Site", type: "string", value: "North" },
        { name: "Site", type: "string", value: "North" }
      ]
    };
    expect(() => getTrajectoryBootstrapUnits({ series: duplicateComponents, stratifyBy: "explicit" })).toThrowError(expect.objectContaining({ code: "DUPLICATE_IDENTITY_COMPONENT" }));

    const nonFinite = bootstrapSeries();
    nonFinite.points[0]!.coordinates[0] = Number.POSITIVE_INFINITY;
    expect(() => getTrajectoryBootstrapUnits({ series: nonFinite, stratifyBy: "none" })).toThrowError(expect.objectContaining({ code: "NON_FINITE_TRAJECTORY_COORDINATE" }));

    const numericOverflow = bootstrapSeries({
      points: [
        bootstrapPoint("P1", "T1", [-1e308, 0, 0, 0]),
        bootstrapPoint("P1", "T2", [1e308, 0, 0, 0]),
        bootstrapPoint("P2", "T1", [-1e308, 0, 0, 0]),
        bootstrapPoint("P2", "T2", [1e308, 0, 0, 0])
      ]
    });
    expect(() => getTrajectoryBootstrapUnits({ series: numericOverflow, stratifyBy: "none" })).toThrowError(expect.objectContaining({ code: "TRAJECTORY_NUMERIC_OVERFLOW" }));

    const series = bootstrapSeries();
    const units = getTrajectoryBootstrapUnits({ series, stratifyBy: "explicit" });
    const valid = createSeededTrajectoryBootstrapPlan({ units, repetitions: 2, seed: 9 });
    const duplicateStrata: TrajectoryBootstrapInput = {
      series,
      stratifyBy: "explicit",
      confidenceLevel: 0.5,
      plan: { ...valid, strata: [valid.strata[0]!, valid.strata[0]!] }
    };
    expect(() => bootstrapTrajectoryPath(duplicateStrata)).toThrowError(expect.objectContaining({ code: "DUPLICATE_BOOTSTRAP_STRATUM" }));

    const badIndex = structuredClone(valid);
    badIndex.strata[0]!.replicates[0]![0] = 99;
    expect(() => bootstrapTrajectoryPath({ series, stratifyBy: "explicit", confidenceLevel: 0.5, plan: badIndex })).toThrowError(expect.objectContaining({ code: "INVALID_BOOTSTRAP_INDEX" }));

    const falseSeedCustody = structuredClone(valid);
    const allowed = falseSeedCustody.strata[0]!.unitIndexes;
    falseSeedCustody.strata[0]!.replicates[0]![0] = allowed.find((index) => index !== falseSeedCustody.strata[0]!.replicates[0]![0])!;
    expect(() => bootstrapTrajectoryPath({ series, stratifyBy: "explicit", confidenceLevel: 0.5, plan: falseSeedCustody })).toThrowError(expect.objectContaining({ code: "SEEDED_BOOTSTRAP_PLAN_MISMATCH" }));

    const limited = bootstrapSeries({ limits: { maxResamples: 2, maxCells: 40 } });
    const limitedUnits = getTrajectoryBootstrapUnits({ series: limited, stratifyBy: "none" });
    expect(() => createSeededTrajectoryBootstrapPlan({ units: limitedUnits, repetitions: 3, seed: 1, limits: limited.limits! })).toThrowError(expect.objectContaining({ code: "BOOTSTRAP_RESAMPLE_LIMIT" }));
    const overflowingPlan = createSeededTrajectoryBootstrapPlan({ units: limitedUnits, repetitions: 2, seed: 1, limits: limited.limits! });
    expect(() => bootstrapTrajectoryPath({ series: limited, stratifyBy: "none", confidenceLevel: 0.5, plan: overflowingPlan })).toThrowError(expect.objectContaining({ code: "BOOTSTRAP_CELL_LIMIT" }));
  });
});

describe("trajectory series adapters", () => {
  it("copies one raw AnalysisResult group without changing its existing 3D coordinates", () => {
    const raw = analyzeRows({
      rows: [
        { Group: "A", Name: "P1", Lesson: "T1", X: 1, Y: 1, Z: 0 },
        { Group: "A", Name: "P1", Lesson: "T2", X: 1, Y: 0, Z: 1 },
        { Group: "B", Name: "P2", Lesson: "T1", X: 0, Y: 1, Z: 1 },
        { Group: "B", Name: "P2", Lesson: "T2", X: 1, Y: 1, Z: 1 }
      ],
      mapping: {
        units: ["Group", "Name"], conversation: ["Lesson"], codes: ["X", "Y", "Z"],
        trajectory: { participant: ["Name"], group: "Group", time: "Lesson", timeOrder: ["T1", "T2"], cohortPolicy: "available" }
      },
      config: { model: "AccumulatedTrajectory", windowSizeBack: 1 }
    });
    const group = raw.trajectory!.groupOrder.find((entry) => entry.display === "A")!;
    const before = structuredClone(raw);
    const adapted = adaptAnalysisResultTrajectorySeries(raw, { group: group.canonical, namespace: "raw-A" });
    const source = raw.points.filter((entry) => entry.group?.canonical === group.canonical);
    expect(adapted.dimensions).toEqual(["SVD1", "SVD2", "SVD3"]);
    expect(adapted.selectedDimensions).toEqual(adapted.dimensions);
    expect(adapted.points.map((entry) => entry.coordinates)).toEqual(source.map((entry) => entry.coordinates));
    expect(raw).toEqual(before);
  });

  it("copies one synthetic prepared group with all imported dimensions and the selected display axes", async () => {
    const { result: prepared } = await createSyntheticPreparedFixture();
    const group = prepared.displaySpace.trajectory.groupOrder[0]!;
    const before = structuredClone(prepared);
    const adapted = adaptPreparedSpaceTrajectorySeries(prepared, { group: group.canonical, namespace: "prepared-synthetic" });
    const source = prepared.fullSpace.points.filter((entry) => entry.group.canonical === group.canonical);
    expect(adapted.dimensions).toHaveLength(5);
    expect(adapted.selectedDimensions).toEqual(["SVD1", "SVD2", "SVD3"]);
    expect(adapted.points).toHaveLength(9);
    expect(adapted.points.map((entry) => entry.coordinates)).toEqual(source.map((entry) => entry.coordinates));
    expect(prepared).toEqual(before);
    expect(() => adaptPreparedSpaceTrajectorySeries(prepared, { group: "missing", namespace: "x" })).toThrowError(TrajectoryStatisticsError);
  });
});
