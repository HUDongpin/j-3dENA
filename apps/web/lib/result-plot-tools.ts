import type { Config, Data } from "plotly.js";

export const RESULT_SECTIONS = [
  { id: "overall", label: "Overall" },
  { id: "networks", label: "Networks" },
  { id: "comparison", label: "Comparison" },
  { id: "change", label: "Change" },
  { id: "statistics", label: "Stats" },
  { id: "trajectory", label: "Trajectory" },
  { id: "plot-tools", label: "Plot Tools" },
] as const;

export type ResultSection = (typeof RESULT_SECTIONS)[number]["id"];
export type PlotDimension = "2d" | "3d";
export type AxisSlot = "x" | "y" | "z";
export type CameraPreset = "isometric" | "top" | "front" | "side";
export type CoordinateIndex = 0 | 1 | 2;
export type CoordinateIndexes = readonly [
  CoordinateIndex,
  CoordinateIndex,
  CoordinateIndex,
];

export interface AxisMapping {
  x: string;
  y: string;
  z: string;
}

export interface PlotCamera {
  center: { x: number; y: number; z: number };
  eye: { x: number; y: number; z: number };
  up: { x: number; y: number; z: number };
  projection: { type: "perspective" | "orthographic" };
}

export interface PlotToolState {
  dimension: PlotDimension;
  axes: AxisMapping;
  cameraPreset: CameraPreset;
  showModeBar: boolean;
}

const CAMERA_PRESETS: Record<CameraPreset, PlotCamera> = {
  isometric: {
    center: { x: 0, y: 0, z: 0 },
    eye: { x: 1.35, y: 1.35, z: 1.35 },
    up: { x: 0, y: 0, z: 1 },
    projection: { type: "perspective" },
  },
  top: {
    center: { x: 0, y: 0, z: 0 },
    eye: { x: 0, y: 0, z: 2.5 },
    up: { x: 0, y: 1, z: 0 },
    projection: { type: "orthographic" },
  },
  front: {
    center: { x: 0, y: 0, z: 0 },
    eye: { x: 0, y: 2.5, z: 0 },
    up: { x: 0, y: 0, z: 1 },
    projection: { type: "orthographic" },
  },
  side: {
    center: { x: 0, y: 0, z: 0 },
    eye: { x: 2.5, y: 0, z: 0 },
    up: { x: 0, y: 0, z: 1 },
    projection: { type: "orthographic" },
  },
};

export function createPlotToolState(
  dimensions: readonly [string, string, string],
): PlotToolState {
  return {
    dimension: "3d",
    axes: { x: dimensions[0], y: dimensions[1], z: dimensions[2] },
    cameraPreset: "isometric",
    showModeBar: false,
  };
}

/**
 * Assigns an imported/computed dimension to a physical plot axis. When the
 * dimension is already assigned, the two slots are swapped so the mapping
 * remains a complete, non-duplicated display permutation.
 */
export function selectAxisDimension(
  current: AxisMapping,
  slot: AxisSlot,
  dimension: string,
  available: readonly [string, string, string],
): AxisMapping {
  if (!available.includes(dimension) || current[slot] === dimension) {
    return current;
  }
  const next = { ...current };
  const duplicateSlot = (["x", "y", "z"] as const).find(
    (candidate) => candidate !== slot && current[candidate] === dimension,
  );
  if (duplicateSlot) {
    next[duplicateSlot] = current[slot];
  }
  next[slot] = dimension;
  return next;
}

export function axisMappingIndexes(
  available: readonly [string, string, string],
  mapping: AxisMapping,
): CoordinateIndexes {
  const indexes = ([mapping.x, mapping.y, mapping.z] as const).map((dimension) =>
    available.indexOf(dimension),
  );
  if (indexes.some((index) => index < 0) || new Set(indexes).size !== 3) {
    throw new TypeError("Plot axes must be a unique permutation of the available dimensions.");
  }
  return indexes as unknown as CoordinateIndexes;
}

export function permuteCoordinate(
  coordinate: readonly [number, number, number],
  indexes: CoordinateIndexes,
): [number, number, number] {
  return [
    coordinate[indexes[0]],
    coordinate[indexes[1]],
    coordinate[indexes[2]],
  ];
}

export function cameraForPreset(preset: CameraPreset): PlotCamera {
  const camera = CAMERA_PRESETS[preset];
  return {
    center: { ...camera.center },
    eye: { ...camera.eye },
    up: { ...camera.up },
    projection: { ...camera.projection },
  };
}

export function safePlotFileName(value: string): string {
  const sanitized = value
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase();
  return sanitized || "3dena-result";
}

export function buildResultPlotConfig(options: {
  showModeBar: boolean;
  fileName: string;
}): Partial<Config> {
  return {
    responsive: true,
    displaylogo: false,
    scrollZoom: true,
    displayModeBar: options.showModeBar ? true : "hover",
    modeBarButtonsToRemove: ["sendDataToCloud", "lasso2d", "select2d"],
    toImageButtonOptions: {
      format: "png",
      filename: safePlotFileName(options.fileName),
    },
  };
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function permutedFields(
  source: Record<string, unknown>,
  fields: readonly [string, string, string],
  indexes: CoordinateIndexes,
): [unknown[], unknown[], unknown[]] {
  const values: [unknown[], unknown[], unknown[]] = [
    arrayValue(source[fields[0]]),
    arrayValue(source[fields[1]]),
    arrayValue(source[fields[2]]),
  ];
  return [values[indexes[0]], values[indexes[1]], values[indexes[2]]];
}

/** Reorders an existing Plotly 3D trace without deriving new scientific values. */
export function permutePlotly3dTrace(
  trace: Data,
  indexes: CoordinateIndexes,
): Data {
  const source = trace as unknown as Record<string, unknown>;
  const [x, y, z] = permutedFields(source, ["x", "y", "z"], indexes);
  const next: Record<string, unknown> = { ...source, x, y, z };
  if (source.type === "cone") {
    const [u, v, w] = permutedFields(source, ["u", "v", "w"], indexes);
    next.u = u;
    next.v = v;
    next.w = w;
  }
  return next as unknown as Data;
}

/**
 * Projects an existing prepared 3D trace into two selected axes. Cones become
 * directional triangle markers; coordinates are selected, never refit.
 */
export function projectPlotly3dTrace2d(
  trace: Data,
  indexes: CoordinateIndexes,
): Data {
  const permuted = permutePlotly3dTrace(trace, indexes) as unknown as Record<
    string,
    unknown
  >;
  const rest = { ...permuted };
  delete rest.z;
  delete rest.u;
  delete rest.v;
  delete rest.w;
  if (permuted.type !== "cone") {
    return { ...rest, type: "scatter" } as unknown as Data;
  }
  const u = arrayValue(permuted.u).map(Number);
  const v = arrayValue(permuted.v).map(Number);
  const meta = (permuted.meta ?? {}) as Record<string, unknown>;
  const colorscale = arrayValue(permuted.colorscale);
  const firstScale = Array.isArray(colorscale[0]) ? colorscale[0] : [];
  const color =
    typeof meta.color === "string"
      ? meta.color
      : typeof firstScale[1] === "string"
        ? firstScale[1]
        : "#334155";
  delete rest.anchor;
  delete rest.colorscale;
  delete rest.showscale;
  delete rest.sizemode;
  delete rest.sizeref;
  return {
    ...rest,
    type: "scatter",
    mode: "markers",
    marker: {
      symbol: "triangle-up",
      angle: u.map(
        (xDirection, index) =>
          (Math.atan2(xDirection, v[index] ?? 0) * 180) / Math.PI,
      ),
      color,
      line: { color: "#ffffff", width: 1 },
      size: 11,
    },
  } as unknown as Data;
}
