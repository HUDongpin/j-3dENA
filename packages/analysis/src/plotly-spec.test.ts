import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { analyzeRows } from "./analyze";
import type { DisplaySpecV1 } from "./contracts";
import { compilePlotlySpec } from "./plotly-spec";
import type { AnalyzeRowsInput, RawRow } from "./types";
import {
  createSyntheticPreparedFixture,
  SYNTHETIC_PREPARED_PERIODS,
} from "../test-support/synthetic-prepared-exchange";

function rawInput(): AnalyzeRowsInput {
  const text = readFileSync(new URL("../../parity-contracts/fixtures/small-raw.csv", import.meta.url), "utf8").trim();
  const [header = "", ...lines] = text.split(/\r?\n/u);
  const columns = header.split(",").map((cell) => cell.replace(/^"|"$/gu, ""));
  const rows = lines.map((line) => {
    const cells = line.split(",").map((cell) => cell.replace(/^"|"$/gu, ""));
    return Object.fromEntries(columns.map((column, index) => [
      column,
      ["EC", "ICT", "MCO", "ATT"].includes(column) ? Number(cells[index]) : cells[index] ?? "",
    ])) as RawRow;
  });
  return {
    rows,
    mapping: {
      units: ["Group", "Name"], conversation: ["Lesson"], codes: ["EC", "ICT", "MCO", "ATT"],
      trajectory: { participant: ["Name"], group: "Group", time: "Lesson", timeOrder: ["Lesson 1", "Lesson 2"] },
    },
    config: { model: "AccumulatedTrajectory", windowSizeBack: 4 },
  };
}

function display(overrides: Partial<DisplaySpecV1> = {}): DisplaySpecV1 {
  return {
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
    camera: {
      eye: { x: 1.25, y: 1.25, z: 1.25 },
      center: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 0, z: 1 },
    },
    ...overrides,
  };
}

describe("compilePlotlySpec", () => {
  it("fails closed on raw trajectory-derived centroids and time-point labels", () => {
    const result = analyzeRows(rawInput());
    const before = structuredClone(result);
    const periodLabels = result.trajectory?.timeOrder.map((period) => period.display) ?? [];
    const spec = compilePlotlySpec(result, display({
      traces: { ...display().traces, centroids: true, trajectory: true },
    }));
    const roles = spec.data.map((trace) => trace.meta.role);
    const serialized = JSON.stringify(spec);

    expect(roles).toEqual(expect.arrayContaining([
      "axis-shaft", "axis-arrowhead", "network-edge", "participant", "node",
    ]));
    expect(roles).not.toContain("centroid");
    expect(roles).not.toContain("trajectory");
    for (const label of periodLabels) expect(serialized).not.toContain(label);
    expect(result).toEqual(before);
  });

  it("ignores legacy trajectory and centroid display flags while preserving the ordinary ENA plot", () => {
    const result = analyzeRows(rawInput());
    const legacyEnabled = display({
      traces: { ...display().traces, network: true, trajectory: true },
    });
    const legacyDisabled = structuredClone(legacyEnabled);
    legacyDisabled.traces.trajectory = false;
    legacyDisabled.traces.centroids = false;
    const spec = compilePlotlySpec(result, legacyEnabled);
    const withoutLegacyTrajectory = compilePlotlySpec(result, legacyDisabled);

    expect(spec).toEqual(withoutLegacyTrajectory);
    expect(spec.data.some((trace) => trace.meta.role === "network-edge")).toBe(true);
    expect(spec.data.some((trace) => trace.meta.role === "participant")).toBe(true);
    expect(spec.data.some((trace) => trace.meta.role === "node")).toBe(true);
    expect(spec.data.some((trace) => trace.meta.role === "centroid")).toBe(false);
    expect(spec.data.filter((trace) => trace.meta.role.startsWith("trajectory"))).toHaveLength(0);
  });

  it("compiles structural 3D roles and arbitrary retained axes without mutating the result", () => {
    const result = analyzeRows(rawInput());
    const before = structuredClone(result);
    const spec = compilePlotlySpec(result, display({ dimensions: ["SVD4", "SVD5", "SVD6"] }));
    const roles = spec.data.map((trace) => trace.meta.role);

    expect(spec.schemaVersion).toBe("3dena.plotly-spec.v1");
    expect(roles).toEqual(expect.arrayContaining([
      "axis-shaft", "axis-arrowhead", "network-edge", "participant", "node",
    ]));
    expect(roles).not.toContain("centroid");
    expect(roles).not.toContain("trajectory");
    expect(spec.data.filter((trace) => trace.meta.role === "axis-shaft").map((trace) => trace.meta.axis)).toEqual(["SVD4", "SVD5", "SVD6"]);
    expect(spec.data.filter((trace) => trace.meta.role === "axis-arrowhead")).toHaveLength(3);
    expect(spec.layout).toMatchObject({
      uirevision: "3dena-camera-v1",
      scene: {
        xaxis: { title: "SVD4" },
        yaxis: { title: "SVD5" },
        zaxis: { title: "SVD6" },
        aspectmode: "data",
        camera: { eye: { x: 1.25, y: 1.25, z: 1.25 } },
      },
    });
    expect(result).toEqual(before);
    expect(Object.isFrozen(spec)).toBe(true);
    expect(Object.isFrozen(spec.data)).toBe(true);
  });

  it.each([
    { source: "raw", plotDimension: 2 },
    { source: "raw", plotDimension: 3 },
    { source: "prepared", plotDimension: 2 },
    { source: "prepared", plotDimension: 3 },
  ] as const)("keeps $source $plotDimension-D generic plots free of trajectory time points", async ({ source, plotDimension }) => {
    const result = source === "raw"
      ? analyzeRows(rawInput())
      : (await createSyntheticPreparedFixture()).result;
    const before = structuredClone(result);
    const periodLabels = result.schemaVersion === "3dena.analysis-result.v1"
      ? result.trajectory?.timeOrder.map((period) => period.display) ?? []
      : SYNTHETIC_PREPARED_PERIODS;
    const spec = compilePlotlySpec(result, display({
      plotDimension,
      camera: plotDimension === 2 ? null : display().camera,
      traces: { ...display().traces, centroids: true, trajectory: true },
    }));
    const legacyDisabled = display({
      plotDimension,
      camera: plotDimension === 2 ? null : display().camera,
      traces: { ...display().traces, centroids: false, trajectory: false },
    });
    const withoutLegacyTimePoints = compilePlotlySpec(result, legacyDisabled);
    const roles = spec.data.map((trace) => trace.meta.role);
    const serialized = JSON.stringify(spec);

    expect(spec).toEqual(withoutLegacyTimePoints);
    expect(roles).toEqual(expect.arrayContaining(["axis-shaft", "network-edge", "participant", "node"]));
    expect(roles).not.toContain("centroid");
    expect(roles).not.toContain("trajectory");
    expect(serialized).not.toContain("direction-arrow");
    expect(spec.data.filter((trace) => trace.meta.role === "participant").every((trace) => !("customdata" in trace))).toBe(true);
    expect(spec.data.filter((trace) => trace.meta.role === "axis-shaft")).toHaveLength(plotDimension);
    expect(spec.data.filter((trace) => trace.meta.role === "axis-arrowhead")).toHaveLength(plotDimension === 3 ? 3 : 0);
    if (source === "prepared") {
      expect(spec.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "PRECOMPUTED_COORDINATE_SPACE" }),
      ]));
    }
    for (const label of periodLabels) expect(serialized).not.toContain(label);
    if (plotDimension === 2) expect(spec.data.every((trace) => trace.type === "scatter" && !("z" in trace))).toBe(true);
    expect(result).toEqual(before);
  });

  it("applies display-only group and edge filters while leaving formal rows untouched", () => {
    const result = analyzeRows(rawInput());
    const group = result.trajectory!.groupOrder[0]!;
    const formalPointCount = result.points.length;
    const spec = compilePlotlySpec(result, display({
      groups: [group.canonical],
      style: { ...display().style, edgeThreshold: 1_000_000 },
    }));

    expect(spec.data.filter((trace) => trace.meta.role === "participant").map((trace) => trace.meta.groupCanonical)).toEqual([group.canonical]);
    expect(spec.data.map((trace) => trace.meta.role)).not.toContain("trajectory");
    expect(spec.data.filter((trace) => trace.meta.role === "network-edge")).toHaveLength(0);
    expect(result.points).toHaveLength(formalPointCount);
  });

  it("compiles an equal-scale 2D view without z coordinate arrays", () => {
    const result = analyzeRows(rawInput());
    const spec = compilePlotlySpec(result, display({ plotDimension: 2, camera: null }));

    expect(spec.layout).toMatchObject({
      xaxis: { title: "SVD1" },
      yaxis: { title: "SVD2", scaleanchor: "x", scaleratio: 1 },
    });
    expect(spec.layout).not.toHaveProperty("scene");
    expect(spec.data.every((trace) => trace.type === "scatter" && !("z" in trace))).toBe(true);
  });

  it("marks prepared exchange traces as precomputed rather than raw jENA", async () => {
    const { result } = await createSyntheticPreparedFixture();
    const spec = compilePlotlySpec(result, display({ traces: { ...display().traces, uncertainty: true } }));

    expect(spec.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PRECOMPUTED_COORDINATE_SPACE" }),
      expect.objectContaining({ code: "UNCERTAINTY_TRACE_NOT_APPLICABLE" }),
    ]));
    expect(spec.data.some((trace) => trace.meta.role === "network-edge")).toBe(true);
  });

  it("rejects unknown display-contract fields", () => {
    const result = analyzeRows(rawInput());
    expect(() => compilePlotlySpec(result, { ...display(), unsupported: true } as never)).toThrow(/unknown field/);
  });
});
