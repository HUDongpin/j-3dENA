import type { AnalysisResult, TypedValue } from "@3dena/analysis";
import type { Data } from "plotly.js";
import { describe, expect, it } from "vitest";
import {
  axisTraces3d,
  groupColor,
  trajectorySegments,
  trajectoryTraces,
  type PlotTraceMeta,
} from "@/lib/plot-traces";

interface TraceInspection {
  type?: string;
  mode?: string;
  x?: Array<number | null>;
  y?: Array<number | null>;
  z?: Array<number | null>;
  u?: number[];
  v?: number[];
  w?: number[];
  text?: string[];
  anchor?: string;
  sizemode?: string;
  sizeref?: number;
  connectgaps?: boolean;
  line?: { color?: string; width?: number };
  marker?: {
    symbol?: string;
    angle?: number[];
    color?: string;
    line?: { color?: string; width?: number };
  };
  colorscale?: Array<[number, string]>;
  textfont?: { color?: string };
  meta?: PlotTraceMeta;
}

function inspect(trace: Data): TraceInspection {
  return trace as unknown as TraceInspection;
}

function typed(canonical: string, display: string): TypedValue {
  return { canonical, display, value: display };
}

const group = typed("group-a", "Group A");
const times = [
  typed("time-1", "Time 1"),
  typed("time-2", "Time 2"),
  typed("time-3", "Time 3"),
  typed("time-4", "Time 4"),
  typed("time-5", "Time 5"),
];

const trajectoryResult = {
  trajectory: {
    centroids: [
      {
        index: 0,
        group,
        time: times[0],
        coordinates: [0, 0, 0],
        participantCount: 4,
        participantPeriodIndexes: [],
      },
      {
        index: 1,
        group,
        time: times[1],
        coordinates: [3, 4, 0],
        participantCount: 4,
        participantPeriodIndexes: [],
      },
      {
        index: 2,
        group,
        time: times[3],
        coordinates: [9, 9, 9],
        participantCount: 3,
        participantPeriodIndexes: [],
      },
      {
        index: 3,
        group,
        time: times[4],
        coordinates: [9, 12, 13],
        participantCount: 3,
        participantPeriodIndexes: [],
      },
    ],
    paths: [
      {
        group,
        steps: [
          { time: times[0], centroidIndex: 0 },
          { time: times[1], centroidIndex: 1 },
          { time: times[2], centroidIndex: null },
          { time: times[3], centroidIndex: 2 },
          { time: times[4], centroidIndex: 3 },
        ],
      },
    ],
  },
} as unknown as AnalysisResult;

function byRole(traces: Data[], role: PlotTraceMeta["role"]): TraceInspection[] {
  return traces.map(inspect).filter((trace) => trace.meta?.role === role);
}

describe("scientific Plotly trace geometry", () => {
  it("builds three colored SVD shafts, cone heads, and direct labels", () => {
    const traces = axisTraces3d(10);
    const shafts = byRole(traces, "axis-shaft");
    const arrowheads = byRole(traces, "axis-arrowhead");
    const labels = byRole(traces, "axis-label");
    const colors = {
      SVD1: "#b91c1c",
      SVD2: "#1d4ed8",
      SVD3: "#15803d",
    } as const;

    expect(traces).toHaveLength(9);
    expect(shafts).toHaveLength(3);
    expect(arrowheads).toHaveLength(3);
    expect(labels).toHaveLength(3);

    for (const axis of ["SVD1", "SVD2", "SVD3"] as const) {
      const shaft = shafts.find((trace) => trace.meta?.axis === axis);
      const arrowhead = arrowheads.find((trace) => trace.meta?.axis === axis);
      const label = labels.find((trace) => trace.meta?.axis === axis);
      expect(shaft).toMatchObject({
        type: "scatter3d",
        mode: "lines",
        line: { color: colors[axis], width: 6 },
      });
      expect(arrowhead).toMatchObject({
        type: "cone",
        anchor: "tip",
        sizemode: "absolute",
        sizeref: 1,
        colorscale: [
          [0, colors[axis]],
          [1, colors[axis]],
        ],
      });
      expect(label).toMatchObject({
        type: "scatter3d",
        mode: "text",
        text: [axis],
        textfont: { color: colors[axis] },
      });
    }

    expect(shafts.find((trace) => trace.meta?.axis === "SVD1")?.x).toEqual([
      0, 8.8,
    ]);
    expect(arrowheads.find((trace) => trace.meta?.axis === "SVD2")).toMatchObject(
      {
        x: [0],
        y: [10],
        z: [0],
        u: [0],
        v: [1],
        w: [0],
      },
    );
    expect(labels.find((trace) => trace.meta?.axis === "SVD3")?.z).toEqual([
      10.8,
    ]);
  });

  it("creates one 3D direction cone per adjacent segment without crossing gaps", () => {
    const path = trajectoryResult.trajectory?.paths[0];
    expect(path).toBeDefined();
    const segments = trajectorySegments(trajectoryResult, path!);
    const traces = trajectoryTraces(trajectoryResult, 3, 20);
    const pathTrace = byRole(traces, "trajectory-path")[0];
    const directionTrace = byRole(traces, "trajectory-direction-3d")[0];

    expect(segments.map(({ fromStepIndex, toStepIndex }) => [
      fromStepIndex,
      toStepIndex,
    ])).toEqual([
      [0, 1],
      [3, 4],
    ]);
    expect(pathTrace).toMatchObject({
      type: "scatter3d",
      connectgaps: false,
      x: [0, 3, null, 9, 9],
      y: [0, 4, null, 9, 12],
      z: [0, 0, null, 9, 13],
      marker: {
        symbol: "square",
        color: "#ffffff",
        line: { color: groupColor(group.canonical), width: 3 },
      },
    });
    expect(directionTrace).toMatchObject({
      type: "cone",
      x: [3, 9],
      y: [4, 12],
      z: [0, 13],
      u: [0.6, 0],
      v: [0.8, 0.6],
      w: [0, 0.8],
      anchor: "tip",
      sizemode: "absolute",
      sizeref: 1.5,
      colorscale: [
        [0, groupColor(group.canonical)],
        [1, groupColor(group.canonical)],
      ],
      meta: {
        role: "trajectory-direction-3d",
        groupCanonical: group.canonical,
        segmentStepPairs: [
          [0, 1],
          [3, 4],
        ],
      },
    });
  });

  it("projects the same result into 2D and adds rotated midpoint direction markers", () => {
    const coordinatesBefore = trajectoryResult.trajectory?.centroids.map(
      (centroid) => [...centroid.coordinates],
    );
    const traces = trajectoryTraces(trajectoryResult, 2, 20);
    const pathTrace = byRole(traces, "trajectory-path")[0];
    const directionTrace = byRole(traces, "trajectory-direction-2d")[0];

    expect(pathTrace).toMatchObject({
      type: "scatter",
      connectgaps: false,
      x: [0, 3, null, 9, 9],
      y: [0, 4, null, 9, 12],
      marker: { symbol: "square" },
    });
    expect(pathTrace).not.toHaveProperty("z");
    expect(directionTrace).toMatchObject({
      type: "scatter",
      mode: "markers",
      x: [1.5, 9],
      y: [2, 10.5],
      marker: {
        symbol: "triangle-up",
        color: groupColor(group.canonical),
        size: 12,
      },
      meta: {
        role: "trajectory-direction-2d",
        segmentStepPairs: [
          [0, 1],
          [3, 4],
        ],
      },
    });
    expect(directionTrace?.marker?.angle?.[0]).toBeCloseTo(36.86989765, 7);
    expect(directionTrace?.marker?.angle?.[1]).toBeCloseTo(0, 7);
    expect(trajectoryResult.trajectory?.centroids.map((centroid) => [
      ...centroid.coordinates,
    ])).toEqual(coordinatesBefore);
  });
});
