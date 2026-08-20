import type {
  AnalysisResult,
  Coordinates3D,
  TrajectoryPath,
} from "@3dena/analysis";
import type { Data } from "plotly.js";

const GROUP_COLORS = [
  "#2563eb",
  "#a16207",
  "#7c3aed",
  "#0f766e",
  "#be123c",
  "#475569",
] as const;

const AXES = [
  {
    label: "SVD1",
    color: "#b91c1c",
    direction: [1, 0, 0] as Coordinates3D,
  },
  {
    label: "SVD2",
    color: "#1d4ed8",
    direction: [0, 1, 0] as Coordinates3D,
  },
  {
    label: "SVD3",
    color: "#15803d",
    direction: [0, 0, 1] as Coordinates3D,
  },
] as const;

export type PlotTraceRole =
  | "axis-shaft"
  | "axis-arrowhead"
  | "axis-label"
  | "trajectory-path"
  | "trajectory-direction-3d"
  | "trajectory-direction-2d";

export interface PlotTraceMeta {
  role: PlotTraceRole;
  axis?: "SVD1" | "SVD2" | "SVD3";
  groupCanonical?: string;
  segmentStepPairs?: Array<[number, number]>;
}

export interface TrajectorySegment {
  fromStepIndex: number;
  toStepIndex: number;
  start: Coordinates3D;
  end: Coordinates3D;
  direction: Coordinates3D;
  length3d: number;
}

function traceWithMeta(
  trace: Record<string, unknown>,
  meta: PlotTraceMeta,
): Data {
  return { ...trace, meta } as unknown as Data;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function groupColor(canonical: string): string {
  return GROUP_COLORS[hashString(canonical) % GROUP_COLORS.length] ?? "#2563eb";
}

/** Three shafts, three positive-direction cone heads, and three direct labels. */
export function axisTraces3d(extent: number): Data[] {
  const safeExtent = Math.max(0.001, Math.abs(extent));
  const shaftExtent = safeExtent * 0.88;
  const labelExtent = safeExtent * 1.08;
  const coneSize = safeExtent * 0.1;

  const shafts = AXES.map((axis) =>
    traceWithMeta(
      {
        type: "scatter3d",
        mode: "lines",
        name: `${axis.label} axis shaft`,
        x: [0, axis.direction[0] * shaftExtent],
        y: [0, axis.direction[1] * shaftExtent],
        z: [0, axis.direction[2] * shaftExtent],
        line: { color: axis.color, width: 6 },
        hoverinfo: "skip",
        showlegend: false,
      },
      { role: "axis-shaft", axis: axis.label },
    ),
  );

  const arrowheads = AXES.map((axis) =>
    traceWithMeta(
      {
        type: "cone",
        name: `${axis.label} positive direction`,
        x: [axis.direction[0] * safeExtent],
        y: [axis.direction[1] * safeExtent],
        z: [axis.direction[2] * safeExtent],
        u: [axis.direction[0]],
        v: [axis.direction[1]],
        w: [axis.direction[2]],
        anchor: "tip",
        sizemode: "absolute",
        sizeref: coneSize,
        colorscale: [
          [0, axis.color],
          [1, axis.color],
        ],
        showscale: false,
        hoverinfo: "skip",
        showlegend: false,
      },
      { role: "axis-arrowhead", axis: axis.label },
    ),
  );

  const labels = AXES.map((axis) =>
    traceWithMeta(
      {
        type: "scatter3d",
        mode: "text",
        name: `${axis.label} axis label`,
        x: [axis.direction[0] * labelExtent],
        y: [axis.direction[1] * labelExtent],
        z: [axis.direction[2] * labelExtent],
        text: [axis.label],
        textposition: "middle center",
        textfont: { color: axis.color, size: 13 },
        hoverinfo: "skip",
        showlegend: false,
      },
      { role: "axis-label", axis: axis.label },
    ),
  );

  return [...shafts, ...arrowheads, ...labels];
}

export function trajectorySegments(
  result: AnalysisResult,
  path: TrajectoryPath,
): TrajectorySegment[] {
  const centroidByIndex = new Map(
    (result.trajectory?.centroids ?? []).map((centroid) => [
      centroid.index,
      centroid,
    ]),
  );
  const coordinates = path.steps.map((step) =>
    step.centroidIndex === null
      ? null
      : (centroidByIndex.get(step.centroidIndex)?.coordinates ?? null),
  );
  const segments: TrajectorySegment[] = [];
  for (let toStepIndex = 1; toStepIndex < coordinates.length; toStepIndex += 1) {
    const fromStepIndex = toStepIndex - 1;
    const start = coordinates[fromStepIndex];
    const end = coordinates[toStepIndex];
    if (!start || !end) continue;
    const delta: Coordinates3D = [
      end[0] - start[0],
      end[1] - start[1],
      end[2] - start[2],
    ];
    const length3d = Math.hypot(...delta);
    if (length3d <= Number.EPSILON) continue;
    segments.push({
      fromStepIndex,
      toStepIndex,
      start,
      end,
      direction: [
        delta[0] / length3d,
        delta[1] / length3d,
        delta[2] / length3d,
      ],
      length3d,
    });
  }
  return segments;
}

export function trajectoryTraces(
  result: AnalysisResult,
  dimensions: 2 | 3,
  extent: number,
): Data[] {
  const trajectory = result.trajectory;
  if (!trajectory) return [];
  const centroidByIndex = new Map(
    trajectory.centroids.map((centroid) => [centroid.index, centroid]),
  );
  const traces: Data[] = [];

  for (const path of trajectory.paths) {
    const color = groupColor(path.group.canonical);
    const coordinates = path.steps.map((step) =>
      step.centroidIndex === null
        ? null
        : (centroidByIndex.get(step.centroidIndex)?.coordinates ?? null),
    );
    const hover = path.steps.map((step) => {
      if (step.centroidIndex === null) {
        return `${path.group.display} · ${step.time.display}: no observation`;
      }
      const centroid = centroidByIndex.get(step.centroidIndex);
      return centroid
        ? `<b>${path.group.display}</b><br>${step.time.display}<br>${centroid.participantCount} participants`
        : `${path.group.display} · ${step.time.display}`;
    });
    traces.push(
      traceWithMeta(
        {
          type: dimensions === 3 ? "scatter3d" : "scatter",
          mode: "lines+markers",
          name: `${path.group.display} centroid path`,
          legendgroup: path.group.canonical,
          x: coordinates.map((coordinate) => coordinate?.[0] ?? null),
          y: coordinates.map((coordinate) => coordinate?.[1] ?? null),
          ...(dimensions === 3
            ? { z: coordinates.map((coordinate) => coordinate?.[2] ?? null) }
            : {}),
          text: hover,
          hovertemplate: "%{text}<extra></extra>",
          connectgaps: false,
          line: { color, width: 6 },
          marker: {
            color: "#ffffff",
            line: { color, width: 3 },
            size: dimensions === 3 ? 6 : 10,
            symbol: "square",
          },
        },
        { role: "trajectory-path", groupCanonical: path.group.canonical },
      ),
    );

    const segments = trajectorySegments(result, path);
    const segmentStepPairs = segments.map(
      (segment) =>
        [segment.fromStepIndex, segment.toStepIndex] as [number, number],
    );
    if (dimensions === 3 && segments.length > 0) {
      traces.push(
        traceWithMeta(
          {
            type: "cone",
            name: `${path.group.display} path direction`,
            legendgroup: path.group.canonical,
            x: segments.map((segment) => segment.end[0]),
            y: segments.map((segment) => segment.end[1]),
            z: segments.map((segment) => segment.end[2]),
            u: segments.map((segment) => segment.direction[0]),
            v: segments.map((segment) => segment.direction[1]),
            w: segments.map((segment) => segment.direction[2]),
            anchor: "tip",
            sizemode: "absolute",
            sizeref: Math.max(0.001, Math.abs(extent)) * 0.075,
            colorscale: [
              [0, color],
              [1, color],
            ],
            showscale: false,
            hoverinfo: "skip",
            showlegend: false,
          },
          {
            role: "trajectory-direction-3d",
            groupCanonical: path.group.canonical,
            segmentStepPairs,
          },
        ),
      );
    }

    if (dimensions === 2) {
      const visibleSegments = segments.filter(
        (segment) =>
          Math.hypot(
            segment.end[0] - segment.start[0],
            segment.end[1] - segment.start[1],
          ) > Number.EPSILON,
      );
      if (visibleSegments.length > 0) {
        traces.push(
          traceWithMeta(
            {
              type: "scatter",
              mode: "markers",
              name: `${path.group.display} path direction`,
              legendgroup: path.group.canonical,
              x: visibleSegments.map(
                (segment) => (segment.start[0] + segment.end[0]) / 2,
              ),
              y: visibleSegments.map(
                (segment) => (segment.start[1] + segment.end[1]) / 2,
              ),
              hoverinfo: "skip",
              showlegend: false,
              marker: {
                symbol: "triangle-up",
                angle: visibleSegments.map(
                  (segment) =>
                    (Math.atan2(
                      segment.end[0] - segment.start[0],
                      segment.end[1] - segment.start[1],
                    ) *
                      180) /
                    Math.PI,
                ),
                color,
                line: { color: "#ffffff", width: 1 },
                size: 12,
              },
            },
            {
              role: "trajectory-direction-2d",
              groupCanonical: path.group.canonical,
              segmentStepPairs: visibleSegments.map(
                (segment) => [segment.fromStepIndex, segment.toStepIndex],
              ),
            },
          ),
        );
      }
    }
  }

  return traces;
}
