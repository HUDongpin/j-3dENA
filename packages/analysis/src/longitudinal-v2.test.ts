import { describe, expect, it } from "vitest";
import { analyzeTrajectoryDynamicsV1, type TrajectoryIdentityV1 } from "@3dena/trajectory";
import {
  bootstrapTrajectoryPath,
  createSeededTrajectoryBootstrapPlan,
  getTrajectoryBootstrapUnits,
  type TrajectorySeriesInput,
} from "./trajectory-statistics";

import {
  assertTrajectoryRunSpecV2,
  compileTrajectoryPlotlySpec,
  type LongitudinalAnalysisBundleV2,
  type TrajectoryDisplaySpecV2,
  type TrajectoryRunSpecV2,
} from "./longitudinal-v2";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);

const identity = (name: string, value: string): TrajectoryIdentityV1 => ({
  components: [{ name, type: "string", value }],
});

const runSpec = (): TrajectoryRunSpecV2 => ({
  schemaVersion: "3dena.trajectory-run-spec.v2",
  sourceResultHash: HASH_A,
  participantColumns: ["Class", "Student"],
  timeColumn: "Time",
  groupColumn: "Condition",
  orderedPeriods: [
    {
      identity: identity("Time", "T1"),
      sourceTimeCanonical: "time:T1",
      displayLabel: "T1",
      expected: true,
      value: { type: "ordered-index-v2", index: 0 },
    },
    {
      identity: identity("Time", "T2"),
      sourceTimeCanonical: "time:T2",
      displayLabel: "T2",
      expected: true,
      value: { type: "ordered-index-v2", index: 1 },
    },
    {
      identity: identity("Time", "T3"),
      sourceTimeCanonical: "time:T3",
      displayLabel: "T3",
      expected: true,
      value: { type: "ordered-index-v2", index: 2 },
    },
  ],
  selectedDimensions: ["SVD1", "SVD2", "SVD3"],
  cohortPolicy: "available",
  missingValuePolicy: "complete-analytical-rows",
  estimand: { kind: "equal-participant" },
});

const path = analyzeTrajectoryDynamicsV1({
  schemaVersion: "3dena.trajectory-dynamics-input.v1",
  namespace: "group-a",
  dimensions: ["SVD1", "SVD2", "SVD3", "SVD4"],
  selectedDimensions: ["SVD1", "SVD2", "SVD3"],
  periods: [
    { time: identity("Time", "T1"), value: { type: "numeric-v1", value: 0, unit: "ordered-period" } },
    { time: identity("Time", "T2"), value: { type: "numeric-v1", value: 1, unit: "ordered-period" } },
    { time: identity("Time", "T3"), value: { type: "numeric-v1", value: 2, unit: "ordered-period" } },
  ],
  cohortPolicy: "available",
  estimand: { kind: "equal-participant-v1" },
  points: [
    { participant: identity("Student", "P1"), time: identity("Time", "T1"), coordinates: [0, 1, 2, 10] },
    { participant: identity("Student", "P2"), time: identity("Time", "T1"), coordinates: [2, 3, 4, 14] },
    { participant: identity("Student", "P1"), time: identity("Time", "T3"), coordinates: [4, 5, 6, 20] },
  ],
});

const bundle = (): LongitudinalAnalysisBundleV2 => ({
  schemaVersion: "3dena.longitudinal-analysis-bundle.v2",
  identity: {
    datasetHash: HASH_B,
    specHash: HASH_C,
    sourceResultHash: HASH_A,
    resultHash: HASH_D,
    runId: "run-trajectory-v2",
    jenaBuildId: "jena-js@0.7.0-ona.0+94ea851",
  },
  runSpec: runSpec(),
  model: {
    type: "SeparateTrajectory",
    fullRotationDimensions: ["SVD1", "SVD2", "SVD3", "SVD4"],
    selectedDimensions: ["SVD1", "SVD2", "SVD3"],
  },
  paths: [{
    group: { canonical: "group:A", display: "Group A" },
    dynamics: path,
  }],
  inference: [],
  pathComparisons: [],
  bootstrap: [],
  networkOverlays: [],
  diagnostics: [],
  execution: {
    target: "browser-worker",
    jenaVersion: "0.7.0-ona.0",
    jenaCommit: "94ea8519b6b2742b791924bc449e1b795135c5a0",
    jenaTarballIntegrity: "sha512-fixture",
    sdkVersion: "0.2.0",
    buildId: "test-build",
    seed: 2026,
    permutationPlanHashes: [],
    resamplingPlanHashes: [],
    evidenceStatus: "IMPLEMENTED_UNVERIFIED",
  },
});

const displaySpec = (projection: TrajectoryDisplaySpecV2["projection"]): TrajectoryDisplaySpecV2 => ({
  schemaVersion: "3dena.trajectory-display-spec.v2",
  projection,
  displayedGroups: ["group:A"],
  traces: {
    participants: true,
    individualPaths: true,
    centroids: true,
    paths: true,
    directionArrows: true,
    uncertainty: true,
    networkOverlay: false,
    labels: true,
  },
  axisFlips: [false, false, false],
  camera: null,
  style: {
    participantSize: 5,
    participantOpacity: 0.55,
    centroidSize: 10,
    pathWidth: 5,
  },
});

describe("trajectory V2 contract", () => {
  it("accepts the frozen mapping semantics and rejects unknown or ambiguous fields", () => {
    expect(() => assertTrajectoryRunSpecV2(runSpec())).not.toThrow();
    expect(() => assertTrajectoryRunSpecV2({ ...runSpec(), unknown: true })).toThrow(/unknown field/i);
    expect(() => assertTrajectoryRunSpecV2({
      ...runSpec(),
      selectedDimensions: ["SVD1", "SVD1", "SVD3"],
    })).toThrow(/distinct/i);
    expect(() => assertTrajectoryRunSpecV2({
      ...runSpec(),
      estimand: { kind: "weighted-participant", metadataField: "" },
    })).toThrow(/metadataField/i);
    const reordered = runSpec();
    reordered.orderedPeriods[1]!.value = { type: "ordered-index-v2", index: 0 };
    expect(() => assertTrajectoryRunSpecV2(reordered)).toThrow(/strictly increasing/i);
  });
});

describe("dedicated trajectory Plotly compiler", () => {
  it("compiles 3D axes, points, centroids, paths, arrows and explicit gaps without changing the bundle", () => {
    const scientific = bundle();
    const before = structuredClone(scientific);
    const plot = compileTrajectoryPlotlySpec(scientific, displaySpec("3d"));

    expect(plot.schemaVersion).toBe("3dena.trajectory-plotly-spec.v2");
    expect(plot.resultHash).toBe(HASH_D);
    expect(plot.data.filter((trace) => trace.meta.role === "axis-shaft")).toHaveLength(3);
    expect(plot.data.filter((trace) => trace.meta.role === "axis-arrowhead")).toHaveLength(3);
    expect(plot.data.some((trace) => trace.meta.role === "participant")).toBe(true);
    expect(plot.data.some((trace) => trace.meta.role === "centroid")).toBe(true);
    expect(plot.data.some((trace) => trace.meta.role === "trajectory-path")).toBe(true);
    expect(plot.data.some((trace) => trace.meta.role === "direction-arrow")).toBe(false);
    const trajectory = plot.data.find((trace) => trace.meta.role === "trajectory-path")!;
    const individualPath = plot.data.find((trace) => trace.meta.role === "individual-path")!;
    const participant = plot.data.find((trace) => trace.meta.role === "participant")!;
    const centroid = plot.data.find((trace) => trace.meta.role === "centroid")!;
    expect(trajectory.x).toEqual([1, null, 4]);
    expect(trajectory.connectgaps).toBe(false);
    expect(trajectory).toMatchObject({ line: { color: "#000000" } });
    expect(individualPath).toMatchObject({ line: { color: "#000000" } });
    expect(trajectory).toMatchObject({ marker: { symbol: "square" } });
    expect(trajectory).not.toMatchObject({ marker: { color: "#000000" } });
    expect(individualPath).not.toMatchObject({ marker: { color: "#000000" } });
    expect(participant).not.toMatchObject({ marker: { color: "#000000" } });
    expect(centroid).not.toMatchObject({ marker: { color: "#000000" } });
    expect(scientific).toEqual(before);
    expect(Object.isFrozen(plot)).toBe(true);
  });

  it("projects the same canonical bundle into a 2D X-Z plane without running scientific arithmetic", () => {
    const scientific = bundle();
    const plot = compileTrajectoryPlotlySpec(scientific, displaySpec("xz"));
    const trajectory = plot.data.find((trace) => trace.meta.role === "trajectory-path")!;

    expect(trajectory.type).toBe("scatter");
    expect(trajectory.x).toEqual([1, null, 4]);
    expect(trajectory.y).toEqual([3, null, 6]);
    expect(trajectory.z).toBeUndefined();
    expect(plot.layout.meta).toMatchObject({
      scientificResultHash: HASH_D,
      scientificTaskExecuted: false,
      projection: "xz",
    });
  });

  it("renders pointwise centroid uncertainty and direction arrows in both 3D and projected 2D without a confidence tube", async () => {
    const completePath = analyzeTrajectoryDynamicsV1({
      schemaVersion: "3dena.trajectory-dynamics-input.v1",
      namespace: "group-a-complete",
      dimensions: ["SVD1", "SVD2", "SVD3", "SVD4"],
      selectedDimensions: ["SVD1", "SVD2", "SVD3"],
      periods: ["T1", "T2", "T3"].map((value, index) => ({ time: identity("Time", value), value: { type: "numeric-v1" as const, value: index, unit: "ordered-period" } })),
      cohortPolicy: "available",
      estimand: { kind: "equal-participant-v1" },
      points: [
        ["P1", "T1", 0], ["P1", "T2", 1], ["P1", "T3", 2],
        ["P2", "T1", 2], ["P2", "T2", 4], ["P2", "T3", 6],
      ].map(([participant, time, value]) => ({
        participant: identity("Student", String(participant)),
        time: identity("Time", String(time)),
        coordinates: [Number(value), Number(value) + 1, Number(value) + 2, Number(value) * 3],
      })),
    });
    const series: TrajectorySeriesInput = {
      namespace: "group-a-complete",
      dimensions: ["SVD1", "SVD2", "SVD3", "SVD4"],
      selectedDimensions: ["SVD1", "SVD2", "SVD3"],
      timeOrder: ["T1", "T2", "T3"].map((value) => identity("Time", value)),
      cohortPolicy: "available",
      points: completePath.participantPeriods.map((point) => ({ participant: point.participant, time: point.time, coordinates: point.fullCoordinates })),
    };
    const units = getTrajectoryBootstrapUnits({ series, stratifyBy: "none" });
    const plan = createSeededTrajectoryBootstrapPlan({ units, repetitions: 20, seed: 2026 });
    const uncertainty = bootstrapTrajectoryPath({ series, stratifyBy: "none", confidenceLevel: 0.5, plan });
    const scientific = bundle();
    scientific.paths[0]!.dynamics = completePath;
    scientific.bootstrap = [{
      groupCanonical: "group:A",
      status: "available",
      notEstimableReason: null,
      seed: 2026,
      planHash: HASH_A,
      finiteReplicates: 20,
      requiredFiniteReplicates: 16,
      totalReplicates: 20,
      confidenceLevel: 0.5,
      requestedResamplingDesign: "within-group",
      resolvedResamplingDesign: "within-group",
      resamplingAlgorithm: "participant-complete-history-mulberry32-uint32-v1",
      intervalContract: "pointwise-percentile-linear-type7",
      rotationPolicy: "fixed-same-fit-projection",
      speedIntervals: uncertainty.periods.map((period) => ({ periodCanonical: period.time.canonical, selected: period.selectedStepDistance, full: period.fullStepDistance })),
      result: uncertainty,
    }];

    const three = compileTrajectoryPlotlySpec(scientific, displaySpec("3d"));
    const threeUncertainty = three.data.find((trace) => trace.meta.role === "uncertainty")!;
    const threeArrows = three.data.filter((trace) => trace.meta.role === "direction-arrow");
    expect(threeArrows).toHaveLength(2);
    expect(threeArrows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ colorscale: [[0, "#000000"], [1, "#000000"]] }),
      ]),
    );
    expect(threeArrows.map((trace) => [trace.x, trace.y, trace.z])).toEqual([
      [[1.75], [2.75], [3.75]],
      [[3.25], [4.25], [5.25]],
    ]);
    expect(threeUncertainty).toMatchObject({ type: "scatter3d", error_x: { type: "data", symmetric: false }, error_y: { type: "data", symmetric: false }, error_z: { type: "data", symmetric: false } });
    expect(threeUncertainty).not.toMatchObject({ marker: { color: "#000000" } });
    expect(three.data.some((trace) => String(trace.meta.role).includes("tube"))).toBe(false);

    const two = compileTrajectoryPlotlySpec(scientific, displaySpec("xy"));
    const twoArrows = two.data.filter((trace) => trace.meta.role === "direction-arrow");
    expect(twoArrows).toHaveLength(2);
    expect(twoArrows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          line: expect.objectContaining({ color: "#000000" }),
          marker: expect.objectContaining({ color: "#000000" }),
        }),
      ]),
    );
    expect(twoArrows.map((trace) => [trace.x, trace.y])).toEqual([
      [[1.525, 1.75], [2.525, 2.75]],
      [[3.025, 3.25], [4.025, 4.25]],
    ]);
    expect(two.data.find((trace) => trace.meta.role === "uncertainty")).toMatchObject({ type: "scatter", error_x: { type: "data", symmetric: false }, error_y: { type: "data", symmetric: false } });
  });
});
