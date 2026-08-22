import type { Data, Layout } from "plotly.js";

export const PREPARED_EXCHANGE_PLOT_CONTRACT =
  "prepared-exchange-plot-v1" as const;
/** @deprecated Use the generic prepared-exchange contract name. */
export const PREPARED_CLASS1_PLOT_CANDIDATE_CONTRACT =
  PREPARED_EXCHANGE_PLOT_CONTRACT;

export const PREPARED_CLASS1_DIMENSIONS = ["SVD1", "SVD2", "SVD3"] as const;

export const PREPARED_CLASS1_DIRECTION_POSITION = 0.62;
export const PREPARED_CLASS1_DIRECTION_CONE_SIZE = 0.13;
export const PREPARED_CLASS1_AXIS_CONE_SIZE = 0.21;

const AXIS_PADDING = 0.1;
const MINIMUM_POSITIVE_AXIS_LENGTH = 0.9;
const SEGMENT_TOLERANCE = Math.sqrt(Number.EPSILON);

const AXES = [
  {
    dimension: "SVD1",
    color: "#E00000",
    direction: [1, 0, 0],
    labelOffset: [0, 0.32, -0.22],
  },
  {
    dimension: "SVD2",
    color: "#0000D0",
    direction: [0, 1, 0],
    labelOffset: [0, -0.02, 0.28],
  },
  {
    dimension: "SVD3",
    color: "#008B00",
    direction: [0, 0, 1],
    labelOffset: [0, 0.34, -0.02],
  },
] as const satisfies ReadonlyArray<{
  dimension: PreparedClass1Dimension;
  color: string;
  direction: PreparedClass1Coordinate;
  labelOffset: PreparedClass1Coordinate;
}>;

export type PreparedClass1Dimension =
  (typeof PREPARED_CLASS1_DIMENSIONS)[number];

export type PreparedClass1Coordinate = readonly [
  svd1: number,
  svd2: number,
  svd3: number,
];

export interface PreparedClass1UnitPoint {
  key: string;
  label: string;
  periodLabel: string;
  coordinates: PreparedClass1Coordinate;
  color: string;
}

export interface PreparedClass1CodeNode {
  key: string;
  label: string;
  coordinates: PreparedClass1Coordinate;
  color?: string;
  size?: number;
}

export interface PreparedClass1PathStep {
  periodKey: string;
  periodLabel: string;
  timeOrder: number;
  coordinates: PreparedClass1Coordinate | null;
  participantCount?: number;
  markerColor?: string;
}

export interface PreparedClass1Path {
  key: string;
  label: string;
  color: string;
  steps: readonly PreparedClass1PathStep[];
}

export interface PreparedClass1PlotCandidateInput {
  unitPoints: readonly PreparedClass1UnitPoint[];
  codeNodes: readonly PreparedClass1CodeNode[];
  paths: readonly PreparedClass1Path[];
}

export type PreparedClass1TraceRole =
  | "unit_points"
  | "path"
  | "direction_arrows"
  | "coordinate_axis_shaft"
  | "coordinate_axis_arrowhead"
  | "coordinate_axis_label"
  | "node_markers"
  | "code_nodes";

export interface PreparedClass1TraceMeta {
  candidate_contract: typeof PREPARED_CLASS1_PLOT_CANDIDATE_CONTRACT;
  trajectory_role: PreparedClass1TraceRole;
  trajectory_key?: string;
  axis?: PreparedClass1Dimension;
  color?: string;
  point_count?: number;
  segment_count?: number;
  segment_step_pairs?: Array<[number, number]>;
  position?: number;
}

export interface PreparedClass1AxisGeometry {
  labels: typeof PREPARED_CLASS1_DIMENSIONS;
  colors: readonly [string, string, string];
  lower: PreparedClass1Coordinate;
  upperData: PreparedClass1Coordinate;
  lengths: PreparedClass1Coordinate;
  upper: PreparedClass1Coordinate;
  ranges: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ];
}

export interface PreparedClass1TrajectorySegment {
  fromStepIndex: number;
  toStepIndex: number;
  start: PreparedClass1Coordinate;
  end: PreparedClass1Coordinate;
  anchor: PreparedClass1Coordinate;
  direction: PreparedClass1Coordinate;
}

export interface PreparedClass1PlotCandidateAudit {
  contract: typeof PREPARED_CLASS1_PLOT_CANDIDATE_CONTRACT;
  dimensions: typeof PREPARED_CLASS1_DIMENSIONS;
  axisGeometry: PreparedClass1AxisGeometry;
  trajectoryDirection: {
    anchor: "center";
    position: typeof PREPARED_CLASS1_DIRECTION_POSITION;
    sizemode: "absolute";
    sizeref: typeof PREPARED_CLASS1_DIRECTION_CONE_SIZE;
  };
  axisArrowhead: {
    anchor: "tip";
    sizemode: "absolute";
    sizeref: typeof PREPARED_CLASS1_AXIS_CONE_SIZE;
  };
}

export interface PreparedClass1PlotCandidate {
  data: Data[];
  layout: Partial<Layout>;
  audit: PreparedClass1PlotCandidateAudit;
}

function traceWithMeta(
  trace: Record<string, unknown>,
  meta: Omit<PreparedClass1TraceMeta, "candidate_contract">,
): Data {
  return {
    ...trace,
    meta: {
      candidate_contract: PREPARED_CLASS1_PLOT_CANDIDATE_CONTRACT,
      ...meta,
    },
  } as unknown as Data;
}

function finiteCoordinate(
  coordinate: PreparedClass1Coordinate,
  source: string,
): PreparedClass1Coordinate {
  if (
    coordinate.length !== PREPARED_CLASS1_DIMENSIONS.length ||
    coordinate.some((value) => !Number.isFinite(value))
  ) {
    throw new TypeError(`${source} must contain three finite SVD coordinates.`);
  }
  return coordinate;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function allSceneCoordinates(
  input: PreparedClass1PlotCandidateInput,
): PreparedClass1Coordinate[] {
  const coordinates: PreparedClass1Coordinate[] = [];
  input.unitPoints.forEach((point, index) => {
    coordinates.push(
      finiteCoordinate(point.coordinates, `unitPoints[${index}].coordinates`),
    );
  });
  input.codeNodes.forEach((node, index) => {
    coordinates.push(
      finiteCoordinate(node.coordinates, `codeNodes[${index}].coordinates`),
    );
  });
  input.paths.forEach((path, pathIndex) => {
    path.steps.forEach((step, stepIndex) => {
      if (step.coordinates !== null) {
        coordinates.push(
          finiteCoordinate(
            step.coordinates,
            `paths[${pathIndex}].steps[${stepIndex}].coordinates`,
          ),
        );
      }
    });
  });
  return coordinates;
}

/** Deterministic origin-axis geometry derived only from imported coordinates. */
export function preparedClass1AxisGeometry(
  input: PreparedClass1PlotCandidateInput,
): PreparedClass1AxisGeometry {
  const coordinates = allSceneCoordinates(input);
  const valuesForAxis = (axisIndex: 0 | 1 | 2): number[] =>
    coordinates.length > 0
      ? coordinates.map((coordinate) => coordinate[axisIndex])
      : [-0.8, 0.8];
  const geometryForAxis = (values: readonly number[]) => {
    const lower = Math.min(...values, 0) - AXIS_PADDING;
    const upperData = Math.max(...values, 0) + AXIS_PADDING;
    const length = Math.max(upperData, MINIMUM_POSITIVE_AXIS_LENGTH);
    const upper = Math.max(upperData, length + AXIS_PADDING);
    return { lower, upperData, length, upper };
  };
  const x = geometryForAxis(valuesForAxis(0));
  const y = geometryForAxis(valuesForAxis(1));
  const z = geometryForAxis(valuesForAxis(2));
  const lower: PreparedClass1Coordinate = [x.lower, y.lower, z.lower];
  const upperData: PreparedClass1Coordinate = [
    x.upperData,
    y.upperData,
    z.upperData,
  ];
  const lengths: PreparedClass1Coordinate = [x.length, y.length, z.length];
  const upper: PreparedClass1Coordinate = [x.upper, y.upper, z.upper];
  const ranges: PreparedClass1AxisGeometry["ranges"] = [
    [x.lower, x.upper],
    [y.lower, y.upper],
    [z.lower, z.upper],
  ];

  return {
    labels: PREPARED_CLASS1_DIMENSIONS,
    colors: AXES.map((axis) => axis.color) as [string, string, string],
    lower,
    upperData,
    lengths,
    upper,
    ranges,
  };
}

export function preparedClass1TrajectorySegments(
  path: PreparedClass1Path,
): PreparedClass1TrajectorySegment[] {
  const segments: PreparedClass1TrajectorySegment[] = [];
  for (let toStepIndex = 1; toStepIndex < path.steps.length; toStepIndex += 1) {
    const fromStepIndex = toStepIndex - 1;
    const from = path.steps[fromStepIndex];
    const to = path.steps[toStepIndex];
    if (
      !from ||
      !to ||
      from.coordinates === null ||
      to.coordinates === null ||
      !Number.isFinite(from.timeOrder) ||
      !Number.isFinite(to.timeOrder) ||
      to.timeOrder <= from.timeOrder
    ) {
      continue;
    }
    const start = finiteCoordinate(
      from.coordinates,
      `path.steps[${fromStepIndex}].coordinates`,
    );
    const end = finiteCoordinate(
      to.coordinates,
      `path.steps[${toStepIndex}].coordinates`,
    );
    const vector: PreparedClass1Coordinate = [
      end[0] - start[0],
      end[1] - start[1],
      end[2] - start[2],
    ];
    const magnitude = Math.hypot(...vector);
    if (!Number.isFinite(magnitude) || magnitude <= SEGMENT_TOLERANCE) {
      continue;
    }
    const direction: PreparedClass1Coordinate = [
      vector[0] / magnitude,
      vector[1] / magnitude,
      vector[2] / magnitude,
    ];
    const anchor: PreparedClass1Coordinate = [
      start[0] + PREPARED_CLASS1_DIRECTION_POSITION * vector[0],
      start[1] + PREPARED_CLASS1_DIRECTION_POSITION * vector[1],
      start[2] + PREPARED_CLASS1_DIRECTION_POSITION * vector[2],
    ];

    segments.push({
      fromStepIndex,
      toStepIndex,
      start,
      end,
      anchor,
      direction,
    });
  }
  return segments;
}

export function preparedClass1AxisTraces(
  geometry: PreparedClass1AxisGeometry,
): Data[] {
  const traces: Data[] = [];
  AXES.forEach((axis, axisIndex) => {
    const length = geometry.lengths[axisIndex] ?? 0;
    const tip = axis.direction.map(
      (value) => value * length,
    ) as unknown as PreparedClass1Coordinate;
    const label = tip.map(
      (value, coordinateIndex) =>
        value + (axis.labelOffset[coordinateIndex] ?? 0),
    ) as unknown as PreparedClass1Coordinate;

    traces.push(
      traceWithMeta(
        {
          type: "scatter3d",
          mode: "lines",
          x: [0, tip[0]],
          y: [0, tip[1]],
          z: [0, tip[2]],
          line: { color: axis.color, width: 4.4 },
          hoverinfo: "skip",
          showlegend: false,
          name: `${axis.dimension} positive axis`,
        },
        {
          trajectory_role: "coordinate_axis_shaft",
          axis: axis.dimension,
          color: axis.color,
        },
      ),
      traceWithMeta(
        {
          type: "cone",
          x: [tip[0]],
          y: [tip[1]],
          z: [tip[2]],
          u: [axis.direction[0]],
          v: [axis.direction[1]],
          w: [axis.direction[2]],
          sizemode: "absolute",
          sizeref: PREPARED_CLASS1_AXIS_CONE_SIZE,
          anchor: "tip",
          colorscale: [
            [0, axis.color],
            [1, axis.color],
          ],
          showscale: false,
          hoverinfo: "skip",
          showlegend: false,
          name: `${axis.dimension} positive arrowhead`,
        },
        {
          trajectory_role: "coordinate_axis_arrowhead",
          axis: axis.dimension,
          color: axis.color,
        },
      ),
      traceWithMeta(
        {
          type: "scatter3d",
          mode: "text",
          x: [label[0]],
          y: [label[1]],
          z: [label[2]],
          text: [axis.dimension],
          textfont: {
            family: "Times New Roman, Times, serif",
            size: 17,
            color: axis.color,
          },
          hoverinfo: "skip",
          showlegend: false,
          name: `${axis.dimension} positive axis label`,
        },
        {
          trajectory_role: "coordinate_axis_label",
          axis: axis.dimension,
          color: axis.color,
        },
      ),
    );
  });
  return traces;
}

function unitPointTrace(points: readonly PreparedClass1UnitPoint[]): Data[] {
  if (points.length === 0) return [];
  return [
    traceWithMeta(
      {
        type: "scatter3d",
        mode: "markers",
        name: "Unit networks",
        x: points.map((point) => point.coordinates[0]),
        y: points.map((point) => point.coordinates[1]),
        z: points.map((point) => point.coordinates[2]),
        text: points.map(
          (point) =>
            `<b>${escapeHtml(point.label)}</b><br>Period: ${escapeHtml(point.periodLabel)}`,
        ),
        hovertemplate: "%{text}<extra>Unit network</extra>",
        hoverinfo: "text",
        showlegend: false,
        marker: {
          size: 5.5,
          color: points.map((point) => point.color),
          opacity: 0.88,
          line: { color: "#FFFFFF", width: 0.8 },
        },
      },
      {
        trajectory_role: "unit_points",
        point_count: points.length,
      },
    ),
  ];
}

function pathTraces(path: PreparedClass1Path): Data[] {
  const coordinates = path.steps.map((step) =>
    step.coordinates === null
      ? null
      : finiteCoordinate(step.coordinates, `${path.key} path coordinate`),
  );
  const hover = path.steps.map((step) =>
    step.coordinates === null
      ? `${escapeHtml(path.label)} · ${escapeHtml(step.periodLabel)}: no observation`
      : `<b>${escapeHtml(path.label)}</b><br>${escapeHtml(step.periodLabel)}${
          step.participantCount === undefined
            ? ""
            : `<br>${step.participantCount} participants`
        }`,
  );
  const markerColors = path.steps.map(
    (step) => step.markerColor ?? path.color,
  );
  const traces: Data[] = [
    traceWithMeta(
      {
        type: "scatter3d",
        mode: "lines+markers",
        name: path.label,
        legendgroup: path.key,
        showlegend: true,
        x: coordinates.map((coordinate) => coordinate?.[0] ?? null),
        y: coordinates.map((coordinate) => coordinate?.[1] ?? null),
        z: coordinates.map((coordinate) => coordinate?.[2] ?? null),
        text: hover,
        hovertemplate: "%{text}<extra></extra>",
        hoverinfo: "text",
        connectgaps: false,
        line: { color: path.color, width: 3 },
        marker: {
          color: markerColors,
          size: 7,
          symbol: "square",
          line: { color: path.color, width: 1 },
        },
      },
      {
        trajectory_role: "path",
        trajectory_key: path.key,
      },
    ),
  ];

  const segments = preparedClass1TrajectorySegments(path);
  if (segments.length > 0) {
    traces.push(
      traceWithMeta(
        {
          type: "cone",
          x: segments.map((segment) => segment.anchor[0]),
          y: segments.map((segment) => segment.anchor[1]),
          z: segments.map((segment) => segment.anchor[2]),
          u: segments.map((segment) => segment.direction[0]),
          v: segments.map((segment) => segment.direction[1]),
          w: segments.map((segment) => segment.direction[2]),
          sizemode: "absolute",
          sizeref: PREPARED_CLASS1_DIRECTION_CONE_SIZE,
          anchor: "center",
          colorscale: [
            [0, path.color],
            [1, path.color],
          ],
          showscale: false,
          name: `${path.label} direction`,
          legendgroup: path.key,
          showlegend: false,
          hoverinfo: "skip",
        },
        {
          trajectory_role: "direction_arrows",
          trajectory_key: path.key,
          segment_count: segments.length,
          segment_step_pairs: segments.map((segment) => [
            segment.fromStepIndex,
            segment.toStepIndex,
          ]),
          position: PREPARED_CLASS1_DIRECTION_POSITION,
        },
      ),
    );
  }
  return traces;
}

function centroidNodeTrace(path: PreparedClass1Path): Data {
  const coordinates = path.steps.map((step) => step.coordinates);
  return traceWithMeta(
    {
      type: "scatter3d",
      mode: "markers",
      name: `${path.label} centroid nodes`,
      legendgroup: path.key,
      showlegend: false,
      x: coordinates.map((coordinate) => coordinate?.[0] ?? null),
      y: coordinates.map((coordinate) => coordinate?.[1] ?? null),
      z: coordinates.map((coordinate) => coordinate?.[2] ?? null),
      marker: {
        color: path.steps.map((step) => step.markerColor ?? path.color),
        size: 7,
        symbol: "square",
        line: { color: path.color, width: 1 },
      },
    },
    {
      trajectory_role: "node_markers",
      trajectory_key: path.key,
    },
  );
}

function codeNodeTrace(nodes: readonly PreparedClass1CodeNode[]): Data[] {
  if (nodes.length === 0) return [];
  return [
    traceWithMeta(
      {
        type: "scatter3d",
        mode: "markers+text",
        name: "Code nodes",
        legendgroup: "__trajectory_code_nodes__",
        showlegend: false,
        x: nodes.map((node) => node.coordinates[0]),
        y: nodes.map((node) => node.coordinates[1]),
        z: nodes.map((node) => node.coordinates[2]),
        text: nodes.map((node) => node.label),
        textposition: "top center",
        hovertemplate: "%{text}<extra>Code node</extra>",
        textfont: {
          family:
            "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          size: 15,
          color: "#171717",
        },
        marker: {
          color: nodes.map((node) => node.color ?? "#F7F7F7"),
          size: nodes.map((node) => node.size ?? 7.5),
          line: { color: "#333333", width: 2 },
        },
      },
      { trajectory_role: "code_nodes" },
    ),
  ];
}

function plotAxis(range: readonly [number, number]) {
  return {
    title: {
      text: "",
      font: {
        family:
          "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        size: 16,
        color: "#25282d",
      },
    },
    tickfont: {
      family:
        "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      size: 14,
      color: "#25282d",
    },
    gridcolor: "#D7D7D7",
    zerolinecolor: "#969696",
    showbackground: true,
    backgroundcolor: "#FFFFFF",
    showspikes: false,
    range: [...range],
  };
}

/**
 * Builds traces for a strictly prepared Class 1 shared-space candidate.
 * It consumes SVD coordinates as provided and performs no rotation or analysis.
 */
export function buildPreparedClass1PlotCandidate(
  input: PreparedClass1PlotCandidateInput,
): PreparedClass1PlotCandidate {
  const axisGeometry = preparedClass1AxisGeometry(input);
  const pathData = input.paths.flatMap(pathTraces);

  return {
    data: [
      ...unitPointTrace(input.unitPoints),
      ...pathData,
      ...preparedClass1AxisTraces(axisGeometry),
      ...input.paths.map(centroidNodeTrace),
      ...codeNodeTrace(input.codeNodes),
    ],
    layout: {
      scene: {
        xaxis: plotAxis(axisGeometry.ranges[0]),
        yaxis: plotAxis(axisGeometry.ranges[1]),
        zaxis: plotAxis(axisGeometry.ranges[2]),
        aspectmode: "data",
        bgcolor: "#FFFFFF",
      },
      margin: { l: 0, r: 0, b: 0, t: 20 },
      paper_bgcolor: "#FFFFFF",
      plot_bgcolor: "#FFFFFF",
    },
    audit: {
      contract: PREPARED_CLASS1_PLOT_CANDIDATE_CONTRACT,
      dimensions: PREPARED_CLASS1_DIMENSIONS,
      axisGeometry,
      trajectoryDirection: {
        anchor: "center",
        position: PREPARED_CLASS1_DIRECTION_POSITION,
        sizemode: "absolute",
        sizeref: PREPARED_CLASS1_DIRECTION_CONE_SIZE,
      },
      axisArrowhead: {
        anchor: "tip",
        sizemode: "absolute",
        sizeref: PREPARED_CLASS1_AXIS_CONE_SIZE,
      },
    },
  };
}

/** Generic product entry point over imported prepared-space coordinates. */
export function buildPreparedExchangePlotCandidate(
  input: PreparedClass1PlotCandidateInput,
): PreparedClass1PlotCandidate {
  return buildPreparedClass1PlotCandidate(input);
}
