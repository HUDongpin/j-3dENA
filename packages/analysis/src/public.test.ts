import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { analyzeTrajectoryDynamicsV1, type TrajectoryIdentityV1 } from "@3dena/trajectory";

import * as publicFacade from "./public";
import type { DisplaySpecV1, LongitudinalAnalysisBundleV2, TrajectoryDisplaySpecV2 } from "./public";
// The verifier's source-controlled MJS export list intentionally has no declaration file.
// @ts-expect-error Runtime public-contract authority is JavaScript consumed by build scripts and tests.
import { PUBLIC_PACKAGE_RUNTIME_EXPORT_NAMES } from "../scripts/verify-public-package.mjs";
import {
  createSyntheticPreparedFixture,
  SYNTHETIC_PREPARED_PERIODS,
} from "../test-support/synthetic-prepared-exchange";

const identity = (name: string, value: string): TrajectoryIdentityV1 => ({
  components: [{ name, type: "string", value }],
});

function legacyOverlayBundle(): LongitudinalAnalysisBundleV2 {
  const periods = ["T1", "T2"];
  const dynamics = analyzeTrajectoryDynamicsV1({
    schemaVersion: "3dena.trajectory-dynamics-input.v1",
    namespace: "group-a",
    dimensions: ["SVD1", "SVD2", "SVD3"],
    selectedDimensions: ["SVD1", "SVD2", "SVD3"],
    periods: periods.map((value, index) => ({
      time: identity("Time", value),
      value: { type: "numeric-v1" as const, value: index, unit: "ordered-period" },
    })),
    cohortPolicy: "available",
    estimand: { kind: "equal-participant-v1" },
    points: periods.map((value, index) => ({
      participant: identity("Student", "P1"),
      time: identity("Time", value),
      coordinates: [index, index + 1, index + 2],
    })),
  });
  return {
    schemaVersion: "3dena.longitudinal-analysis-bundle.v2",
    identity: {
      datasetHash: "a".repeat(64),
      specHash: "b".repeat(64),
      sourceResultHash: "c".repeat(64),
      requestHash: "d".repeat(64),
      resultHash: "e".repeat(64),
      runId: "public-boundary-test",
      jenaBuildId: "jena-js@0.7.0-ona.0+94ea8519b6b2742b791924bc449e1b795135c5a0:test-build",
    },
    runSpec: {
      schemaVersion: "3dena.trajectory-run-spec.v2",
      sourceResultHash: "c".repeat(64),
      participantColumns: ["Student"],
      timeColumn: "Time",
      groupColumn: "Condition",
      orderedPeriods: periods.map((value, index) => ({
        identity: identity("Time", value),
        sourceTimeCanonical: `time:${value}`,
        displayLabel: value,
        expected: true,
        value: { type: "ordered-index-v2" as const, index },
      })),
      selectedDimensions: ["SVD1", "SVD2", "SVD3"],
      cohortPolicy: "available",
      missingValuePolicy: "complete-analytical-rows",
      estimand: { kind: "equal-participant" },
    },
    model: {
      type: "SeparateTrajectory",
      fullRotationDimensions: ["SVD1", "SVD2", "SVD3"],
      selectedDimensions: ["SVD1", "SVD2", "SVD3"],
    },
    paths: [{ group: { canonical: "group:A", display: "Group A" }, dynamics }],
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
    networkOverlays: [{
      status: "available",
      reason: null,
      groupCanonical: null,
      periodCanonical: "time:T1",
      dimensions: ["SVD1", "SVD2", "SVD3"],
      estimand: "equal-participant",
      sourceRows: 1,
      participantPeriods: 1,
      effectiveParticipantN: 1,
      edges: [{ id: "RE-IN", sourceIndex: 0, targetIndex: 1, weight: 0.5 }],
    }],
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
  };
}

const legacyOverlayDisplay: TrajectoryDisplaySpecV2 = {
  schemaVersion: "3dena.trajectory-display-spec.v2",
  projection: "3d",
  displayedGroups: [],
  traces: {
    participants: false,
    individualPaths: false,
    centroids: true,
    paths: true,
    directionArrows: true,
    uncertainty: false,
    networkOverlay: true,
    labels: true,
  },
  axisFlips: [false, false, false],
  camera: null,
  style: { participantSize: 5, participantOpacity: 0.5, centroidSize: 10, pathWidth: 4 },
};

const genericDisplay: DisplaySpecV1 = {
  schemaVersion: "3dena.display-spec.v1",
  dimensions: ["SVD1", "SVD2", "SVD3"],
  plotDimension: 3,
  showGrid: true,
  showZeroLines: true,
  showAxes: true,
  traces: { points: true, nodes: true, network: true, centroids: true, trajectory: true, uncertainty: false },
  style: {
    pointSize: 7,
    pointOpacity: 0.75,
    nodeSize: 11,
    nodeOpacity: 1,
    edgeThreshold: 0,
    edgeWidthScale: 8,
    trajectoryWidth: 4,
  },
  camera: null,
};

function readmeRuntimeExportNames(): string[] {
  const readme = readFileSync(new URL("../PUBLIC_PACKAGE_README.md", import.meta.url), "utf8");
  const section = /The supported runtime root exports are exactly:\r?\n\r?\n([\s\S]*?)(?:\r?\n\r?\n|$)/u.exec(readme)?.[1];
  if (!section) throw new Error("public package README is missing its exact runtime root export list");
  return section.split(/\r?\n/u).map((line) => {
    const name = /^- `([A-Za-z_$][A-Za-z0-9_$]*)\([^`]*\)`$/u.exec(line)?.[1];
    if (!name) throw new Error(`invalid public runtime root export documentation: ${JSON.stringify(line)}`);
    return name;
  });
}

describe("public npm facade", () => {
  it("documents exactly the runtime root exports enforced by the verifier", () => {
    const facadeNames = Object.keys(publicFacade).sort();
    const readmeNames = readmeRuntimeExportNames();
    const verifierNames = [...PUBLIC_PACKAGE_RUNTIME_EXPORT_NAMES];

    expect(new Set(readmeNames).size).toBe(readmeNames.length);
    expect(new Set(verifierNames).size).toBe(verifierNames.length);
    expect([...readmeNames].sort()).toEqual(facadeNames);
    expect([...verifierNames].sort()).toEqual(facadeNames);
  });

  it("exposes the reviewed runtime functions plus strict dataset and result validators", () => {
    expect(Object.keys(publicFacade).sort()).toEqual([
      "adaptFittedJenaTrajectoryResultV2",
      "assertAnalysisExecutionDatasetV2",
      "assertAnalysisResultEnvelopeV1",
      "assertLongitudinalAnalysisBundleV2",
      "assertLongitudinalExecutionRequestV2",
      "assertTrajectoryRunSpecV2",
      "compilePlotlySpec",
      "compileTrajectoryPlotlySpec",
      "createAnalysisClient",
      "createExportBundle",
      "executeAnalysisTask",
      "executeLongitudinalAnalysisV2",
      "getAnalysisBuildIdentityV2",
      "hashAnalysisValueV1",
      "hashLongitudinalExecutionRequestV2",
      "inspectDataset",
      "verifyLongitudinalAnalysisBundleV2",
    ]);
    for (const value of Object.values(publicFacade)) expect(typeof value).toBe("function");
  });

  it("keeps the public generic facade free of prepared trajectory time points", async () => {
    const { result } = await createSyntheticPreparedFixture();
    const before = structuredClone(result);
    const spec = publicFacade.compilePlotlySpec(result, genericDisplay);
    const roles = spec.data.map((trace) => trace.meta.role);
    const serialized = JSON.stringify(spec);

    expect(roles).toEqual(expect.arrayContaining([
      "axis-shaft", "axis-arrowhead", "network-edge", "participant", "node",
    ]));
    expect(roles).not.toContain("centroid");
    expect(roles).not.toContain("trajectory");
    expect(serialized).not.toContain("direction-arrow");
    expect(spec.data.filter((trace) => trace.meta.role === "participant").every((trace) => !("customdata" in trace))).toBe(true);
    for (const period of SYNTHETIC_PREPARED_PERIODS) expect(serialized).not.toContain(period);
    expect(result).toEqual(before);
  });

  it("retains the dedicated trajectory facade's codes, time points, centroids, paths, and arrows", () => {
    const bundle = legacyOverlayBundle();
    const before = structuredClone(bundle);
    for (const projection of ["3d", "xy"] as const) {
      const dedicatedDisplay = structuredClone(legacyOverlayDisplay);
      dedicatedDisplay.projection = projection;
      dedicatedDisplay.traces.participants = true;
      dedicatedDisplay.traces.individualPaths = true;
      dedicatedDisplay.traces.codeNodes = true;
      const spec = publicFacade.compileTrajectoryPlotlySpec(bundle, dedicatedDisplay);
      const roles = spec.data.map((trace) => trace.meta.role);
      const centroid = spec.data.find((trace) => trace.meta.role === "centroid");
      const participant = spec.data.find((trace) => trace.meta.role === "participant");

      expect(roles).toEqual(expect.arrayContaining([
        "network-node", "participant", "individual-path", "centroid", "trajectory-path", "direction-arrow",
      ]));
      expect(roles).not.toContain("network-edge");
      expect(centroid?.text).toEqual(["T1", "T2"]);
      expect(participant?.customdata).toEqual([["T1"], ["T2"]]);
    }
    expect(bundle).toEqual(before);
  });

  it("fails closed on legacy trajectory network overlays while preserving fitted code references", () => {
    const bundle = legacyOverlayBundle();
    const before = structuredClone(bundle);
    const spec = publicFacade.compileTrajectoryPlotlySpec(bundle, legacyOverlayDisplay);
    const overlayDisabled = structuredClone(legacyOverlayDisplay);
    overlayDisabled.traces.networkOverlay = false;
    const withoutLegacyOverlay = publicFacade.compileTrajectoryPlotlySpec(bundle, overlayDisabled);

    expect(spec.data.filter((trace) => trace.meta.role === "network-node")).toHaveLength(1);
    expect(spec.data.find((trace) => trace.meta.role === "network-node")?.text).toEqual(["RE", "IN"]);
    expect(spec.data.map((trace) => trace.meta.role)).not.toContain("network-edge");
    expect(spec).toEqual(withoutLegacyOverlay);
    expect(spec.resultHash).toBe(before.identity.resultHash);
    expect(bundle.networkOverlays).toEqual(before.networkOverlays);
    expect(bundle.identity.resultHash).toBe(before.identity.resultHash);
    expect(bundle).toEqual(before);
  });
});
