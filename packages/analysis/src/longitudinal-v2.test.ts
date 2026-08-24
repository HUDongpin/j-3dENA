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
    requestHash: HASH_D,
    resultHash: HASH_D,
    runId: "run-trajectory-v2",
    jenaBuildId: "jena-js@0.7.0-ona.0+94ea8519b6b2742b791924bc449e1b795135c5a0:test-build",
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
  codeGeometry: {
    schemaVersion: "3dena.longitudinal-code-geometry.v2",
    dimensions: ["SVD1", "SVD2", "SVD3"],
    nodes: [
      { index: 0, code: "RE", coordinates: [-0.5, 0.1, 0.2] },
      { index: 1, code: "IN", coordinates: [0.4, -0.2, 0.3] },
    ],
  },
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
  it("preserves an orthographic Plotly camera projection without changing the scientific result", () => {
    const scientific = bundle();
    const spec = displaySpec("3d");
    spec.camera = {
      eye: { x: 0, y: 0, z: 2.5 },
      center: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      projection: { type: "orthographic" },
    };

    const plot = compileTrajectoryPlotlySpec(scientific, spec);
    const scene = plot.layout.scene as { camera?: unknown };

    expect(scene.camera).toEqual(spec.camera);
    expect(plot.resultHash).toBe(scientific.identity.resultHash);
  });

  it("gives every distinct 3D camera a deterministic scene UI revision", () => {
    const scientific = bundle();
    const before = structuredClone(scientific);
    const base = {
      eye: { x: 1.35, y: 1.35, z: 1.2 },
      center: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 0, z: 1 },
      projection: { type: "perspective" as const },
    };
    const cameras: NonNullable<TrajectoryDisplaySpecV2["camera"]>[] = [
      base,
      { ...base, eye: { ...base.eye, x: 0 } },
      { ...base, center: { ...base.center, y: 0.25 } },
      { ...base, up: { ...base.up, z: -1 } },
      { ...base, projection: { type: "orthographic" } },
    ];
    const compiled = cameras.map((camera) => {
      const spec = displaySpec("3d");
      spec.camera = camera;
      const plot = compileTrajectoryPlotlySpec(scientific, spec);
      expect(plot.resultHash).toBe(scientific.identity.resultHash);
      return plot;
    });
    const revisions = compiled.map((plot) => (plot.layout.scene as { uirevision?: unknown }).uirevision);
    const repeated = displaySpec("3d");
    repeated.camera = structuredClone(base);
    const repeatedRevision = (compileTrajectoryPlotlySpec(scientific, repeated).layout.scene as { uirevision?: unknown }).uirevision;
    const twoDimensional = displaySpec("xy");
    twoDimensional.camera = base;
    const twoDimensionalPlot = compileTrajectoryPlotlySpec(scientific, twoDimensional);

    expect(revisions.every((revision) => typeof revision === "string")).toBe(true);
    expect(new Set(revisions)).toHaveLength(cameras.length);
    expect(repeatedRevision).toBe(revisions[0]);
    expect(new Set(compiled.map((plot) => plot.layout.uirevision))).toHaveLength(1);
    expect(twoDimensionalPlot.layout.scene).toBeUndefined();
    expect(twoDimensionalPlot.layout.uirevision).toBe(`${scientific.identity.resultHash}:xy`);
    expect(twoDimensionalPlot.resultHash).toBe(scientific.identity.resultHash);
    expect(scientific).toEqual(before);
  });

  it("keeps existing V2 cameras without an explicit projection readable", () => {
    const spec = displaySpec("3d");
    spec.camera = {
      eye: { x: 1.35, y: 1.35, z: 1.2 },
      center: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 0, z: 1 },
    };

    const plot = compileTrajectoryPlotlySpec(bundle(), spec);
    const scene = plot.layout.scene as { camera?: unknown };
    expect(scene.camera).toEqual(spec.camera);
  });

  it("rejects unsupported Plotly camera projection types", () => {
    const invalid = {
      ...displaySpec("3d"),
      camera: {
        eye: { x: 0, y: 0, z: 2.5 },
        center: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
        projection: { type: "fisheye" },
      },
    } as unknown as TrajectoryDisplaySpecV2;

    expect(() => compileTrajectoryPlotlySpec(bundle(), invalid)).toThrow(/camera\.projection\.type/i);
  });

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
    expect(trajectory.mode).toBe("lines");
    expect(trajectory).not.toHaveProperty("marker");
    expect(centroid).toMatchObject({ marker: { symbol: "square" } });
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

  it("shows fitted ENA code references while legacy mean-network display flags fail closed", () => {
    const scientific = bundle();
    scientific.networkOverlays = [{
      status: "available",
      reason: null,
      groupCanonical: null,
      periodCanonical: "time:T1",
      dimensions: ["SVD1", "SVD2", "SVD3"],
      estimand: "equal-participant",
      sourceRows: 2,
      participantPeriods: 2,
      effectiveParticipantN: 2,
      edges: [{ id: "RE-IN", sourceIndex: 0, targetIndex: 1, weight: 0.5 }],
    }];
    const codesOnly = displaySpec("3d");
    codesOnly.traces.codeNodes = true;
    codesOnly.traces.networkOverlay = false;

    const three = compileTrajectoryPlotlySpec(scientific, codesOnly);
    const threeCodeNodes = three.data.filter((trace) => trace.meta.role === "network-node");
    expect(threeCodeNodes).toHaveLength(1);
    expect(threeCodeNodes[0]!.text).toEqual(["RE", "IN"]);
    expect(threeCodeNodes[0]).toMatchObject({
      textfont: { color: "#0f172a", size: 13 },
      marker: { size: 7, symbol: "circle-open", color: "#ffffff" },
    });
    expect(three.data.map((trace) => trace.meta.role)).not.toContain("network-edge");

    const twoCodesOnly = structuredClone(codesOnly);
    twoCodesOnly.projection = "xy";
    const two = compileTrajectoryPlotlySpec(scientific, twoCodesOnly);
    expect(two.data.find((trace) => trace.meta.role === "network-node")?.text).toEqual(["RE", "IN"]);
    expect(two.data.map((trace) => trace.meta.role)).not.toContain("network-edge");

    const withEdges = structuredClone(codesOnly);
    withEdges.traces.networkOverlay = true;
    const edgePlot = compileTrajectoryPlotlySpec(scientific, withEdges);
    expect(edgePlot.data.filter((trace) => trace.meta.role === "network-node")).toHaveLength(1);
    expect(edgePlot.data.map((trace) => trace.meta.role)).not.toContain("network-edge");
  });

  it("shows fitted ENA codes by default for legacy V2 display specs without codeNodes", () => {
    const scientific = bundle();
    const legacy = displaySpec("3d");
    delete legacy.traces.codeNodes;
    legacy.traces.networkOverlay = false;

    const legacyPlot = compileTrajectoryPlotlySpec(scientific, legacy);
    expect(legacyPlot.data.filter((trace) => trace.meta.role === "network-node")).toHaveLength(1);

    const explicitlyHidden = structuredClone(legacy);
    explicitlyHidden.traces.codeNodes = false;
    const hiddenPlot = compileTrajectoryPlotlySpec(scientific, explicitlyHidden);
    expect(hiddenPlot.data.filter((trace) => trace.meta.role === "network-node")).toHaveLength(0);
  });

  it("keeps fitted ENA codes when a mean network is not estimable or its group is hidden", () => {
    const scientific = bundle();
    scientific.networkOverlays = [{
      status: "not-estimable",
      reason: "no-observed-participant-period-network",
      groupCanonical: "group:A",
      periodCanonical: "time:T2",
      dimensions: ["SVD1", "SVD2", "SVD3"],
      estimand: "equal-participant",
      sourceRows: 0,
      participantPeriods: 0,
      effectiveParticipantN: null,
      edges: [],
    }];
    const hiddenGroup = displaySpec("3d");
    hiddenGroup.displayedGroups = ["group:hidden"];
    hiddenGroup.traces.codeNodes = true;
    hiddenGroup.traces.networkOverlay = true;

    for (const projection of ["3d", "xy"] as const) {
      const current = structuredClone(hiddenGroup);
      current.projection = projection;
      const plot = compileTrajectoryPlotlySpec(scientific, current);
      expect(plot.data.filter((trace) => trace.meta.role === "network-node")).toHaveLength(1);
      expect(plot.data.find((trace) => trace.meta.role === "network-node")?.text).toEqual(["RE", "IN"]);
      expect(plot.data.map((trace) => trace.meta.role)).not.toContain("network-edge");
    }
  });

  it("keeps bootstrap intervals numerical while trajectory plots render no CI in 3D or projected 2D", async () => {
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
      requiredFiniteReplicates: 20,
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
    scientific.execution.resamplingPlanHashes = [HASH_A];

    const three = compileTrajectoryPlotlySpec(scientific, displaySpec("3d"));
    const threeUncertainty = three.data.find((trace) => trace.meta.role === "uncertainty");
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
    expect(threeUncertainty).toBeUndefined();
    expect(scientific.bootstrap[0]!.result.periods).toHaveLength(3);
    expect(scientific.bootstrap[0]!.result.periods[0]!.selectedCentroid[0]).not.toBeNull();
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
    expect(two.data.find((trace) => trace.meta.role === "uncertainty")).toBeUndefined();
  });
});
