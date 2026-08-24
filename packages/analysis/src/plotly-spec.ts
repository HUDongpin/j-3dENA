import { assertDisplaySpecV1, type DisplaySpecV1 } from "./contracts";
import type { PreparedSpaceResult } from "./prepared-types";
import type { AnalysisDiagnostic, AnalysisResult, Coordinates3D } from "./types";

export type PlotlyTraceRoleV1 =
  | "participant"
  | "node"
  | "network-edge"
  /** @deprecated Historical V1 readback only; compilePlotlySpec no longer emits this role. */
  | "centroid"
  /** @deprecated Historical V1 readback only; compilePlotlySpec no longer emits this role. */
  | "trajectory"
  | "axis-shaft"
  | "axis-arrowhead";

export interface PlotlyTraceV1 extends Record<string, unknown> {
  type: "scatter" | "scatter3d" | "cone";
  meta: {
    role: PlotlyTraceRoleV1;
    groupCanonical?: string;
    edgeId?: string;
    axis?: string;
  };
}

export interface PlotlySpecV1 {
  schemaVersion: "3dena.plotly-spec.v1";
  data: PlotlyTraceV1[];
  layout: Record<string, unknown>;
  config: {
    responsive: true;
    displaylogo: false;
    scrollZoom: true;
  };
  diagnostics: AnalysisDiagnostic[];
}

export class PlotlySpecCompilationError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "PlotlySpecCompilationError";
    this.code = code;
    this.path = path;
  }
}

interface NormalizedPoint {
  label: string;
  groupCanonical: string;
  groupDisplay: string;
  coordinates: Coordinates3D;
}

interface NormalizedNode {
  index: number;
  code: string;
  coordinates: Coordinates3D;
}

interface NormalizedEdge {
  id: string;
  sourceIndex: number;
  targetIndex: number;
  meanWeight: number;
}

interface NormalizedDisplay {
  source: "raw-jena" | "prepared-exchange";
  dimensions: [string, string, string];
  points: NormalizedPoint[];
  nodes: NormalizedNode[];
  edges: NormalizedEdge[];
}

const COLORS = ["#2563eb", "#a16207", "#7c3aed", "#0f766e", "#be123c", "#475569"] as const;
const AXIS_COLORS = ["#b91c1c", "#1d4ed8", "#15803d"] as const;

function reject(code: string, path: string, message: string): never {
  throw new PlotlySpecCompilationError(code, path, message);
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (Math.imul(hash, 31) + value.charCodeAt(index)) >>> 0;
  return hash;
}

function groupColor(canonical: string): string {
  return COLORS[hashString(canonical) % COLORS.length] ?? COLORS[0];
}

function dimensionIndexes(
  available: readonly string[],
  requested: DisplaySpecV1["dimensions"],
  code: "UNKNOWN_DISPLAY_DIMENSION" | "UNKNOWN_PREPARED_DISPLAY_DIMENSION",
): [number, number, number] {
  const indexes = requested.map((dimension, index) => {
    const selected = available.indexOf(dimension);
    if (selected < 0) reject(code, `displaySpec.dimensions[${index}]`, `${JSON.stringify(dimension)} is not present in the fitted coordinate space`);
    return selected;
  });
  return indexes as [number, number, number];
}

function projectCoordinates(
  coordinates: readonly number[],
  indexes: readonly [number, number, number],
  path: string,
): Coordinates3D {
  const selected = indexes.map((index) => coordinates[index]) as Coordinates3D;
  if (selected.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate))) {
    reject("INVALID_DISPLAY_COORDINATE", path, "selected fitted coordinates must be finite numbers");
  }
  return selected;
}

function selectedGroups(
  available: readonly string[],
  requested: readonly string[] | undefined,
  code: "UNKNOWN_DISPLAY_GROUP" | "UNKNOWN_PREPARED_DISPLAY_GROUP",
): Set<string> | null {
  if (requested === undefined) return null;
  const known = new Set(available);
  const unknown = requested.find((group) => !known.has(group));
  if (unknown !== undefined) reject(code, "displaySpec.groups", `unknown canonical group key ${JSON.stringify(unknown)}`);
  return new Set(requested);
}

function rawDisplay(result: AnalysisResult, displaySpec: DisplaySpecV1): NormalizedDisplay {
  const indexes = dimensionIndexes(result.dimensions, displaySpec.dimensions, "UNKNOWN_DISPLAY_DIMENSION");
  const groups = selectedGroups(
    result.points.flatMap((point) => point.group ? [point.group.canonical] : []),
    displaySpec.groups,
    "UNKNOWN_DISPLAY_GROUP",
  );
  const points = result.points.filter((point) => groups === null || (point.group !== undefined && groups.has(point.group.canonical)));
  const selectedIndexes = new Set(points.map((point) => point.index));
  const edges = result.edges.map((edge) => {
    const weights = result.points.filter((point) => selectedIndexes.has(point.index)).map((point) => point.lineWeights[edge.index]!);
    const meanWeight = weights.length === 0 ? edge.meanWeight : weights.reduce((sum, value) => sum + value, 0) / weights.length;
    return { id: edge.id, sourceIndex: edge.sourceIndex, targetIndex: edge.targetIndex, meanWeight };
  });
  return {
    source: "raw-jena",
    dimensions: [...displaySpec.dimensions],
    points: points.map((point) => ({
      label: point.participantLabel.display,
      groupCanonical: point.group?.canonical ?? "@3dena/ungrouped",
      groupDisplay: point.group?.display ?? "All participants",
      coordinates: projectCoordinates(point.fullCoordinates, indexes, `result.points[${point.index}].fullCoordinates`),
    })),
    nodes: result.nodes.map((node) => ({
      index: node.index,
      code: node.code,
      coordinates: projectCoordinates(node.fullCoordinates, indexes, `result.nodes[${node.index}].fullCoordinates`),
    })),
    edges,
  };
}

function preparedDisplay(result: PreparedSpaceResult, displaySpec: DisplaySpecV1): NormalizedDisplay {
  const indexes = dimensionIndexes(result.fullSpace.dimensions, displaySpec.dimensions, "UNKNOWN_PREPARED_DISPLAY_DIMENSION");
  const groups = selectedGroups(
    result.fullSpace.points.map((point) => point.group.canonical),
    displaySpec.groups,
    "UNKNOWN_PREPARED_DISPLAY_GROUP",
  );
  const points = result.fullSpace.points.filter((point) => groups === null || groups.has(point.group.canonical));
  const selectedIndexes = new Set(points.map((point) => point.index));
  const edges = result.fullSpace.edges.map((edge) => {
    const weights = result.fullSpace.lineWeights.values
      .filter((_, index) => selectedIndexes.has(index))
      .map((row) => row[edge.index]!);
    const meanWeight = weights.length === 0 ? edge.meanWeight : weights.reduce((sum, value) => sum + value, 0) / weights.length;
    return { id: edge.id, sourceIndex: edge.sourceIndex, targetIndex: edge.targetIndex, meanWeight };
  });
  return {
    source: "prepared-exchange",
    dimensions: [...displaySpec.dimensions],
    points: points.map((point) => ({
      label: point.participantLabel.display,
      groupCanonical: point.group.canonical,
      groupDisplay: point.group.display,
      coordinates: projectCoordinates(point.coordinates, indexes, `result.fullSpace.points[${point.index}].coordinates`),
    })),
    nodes: result.fullSpace.nodes.map((node) => ({
      index: node.index,
      code: node.code,
      coordinates: projectCoordinates(node.coordinates, indexes, `result.fullSpace.nodes[${node.index}].coordinates`),
    })),
    edges,
  };
}

function normalize(result: AnalysisResult | PreparedSpaceResult, displaySpec: DisplaySpecV1): NormalizedDisplay {
  if (result?.schemaVersion === "3dena.analysis-result.v1") return rawDisplay(result, displaySpec);
  if (result?.schemaVersion === "3dena.prepared-space-result.v1") return preparedDisplay(result, displaySpec);
  reject("UNSUPPORTED_PLOT_RESULT", "result.schemaVersion", "must be a raw jENA or prepared-space result");
}

function coordinateFields(points: Coordinates3D[], dimension: 2 | 3): Record<string, unknown> {
  return {
    x: points.map((point) => point[0]),
    y: points.map((point) => point[1]),
    ...(dimension === 3 ? { z: points.map((point) => point[2]) } : {}),
  };
}

function trace(
  plotDimension: 2 | 3,
  fields: Record<string, unknown>,
  meta: PlotlyTraceV1["meta"],
): PlotlyTraceV1 {
  return {
    type: plotDimension === 3 ? "scatter3d" : "scatter",
    ...fields,
    meta,
  };
}

function pointTraces(display: NormalizedDisplay, spec: DisplaySpecV1): PlotlyTraceV1[] {
  const groups = new Map<string, NormalizedPoint[]>();
  for (const point of display.points) groups.set(point.groupCanonical, [...(groups.get(point.groupCanonical) ?? []), point]);
  return [...groups.entries()].map(([canonical, points]) => trace(spec.plotDimension, {
    mode: "markers",
    name: points[0]!.groupDisplay,
    ...coordinateFields(points.map((point) => point.coordinates), spec.plotDimension),
    text: points.map((point) => point.label),
    hovertemplate: "%{text}<extra></extra>",
    marker: { color: groupColor(canonical), size: spec.style.pointSize, opacity: spec.style.pointOpacity },
  }, { role: "participant", groupCanonical: canonical }));
}

function nodeTrace(display: NormalizedDisplay, spec: DisplaySpecV1): PlotlyTraceV1 {
  return trace(spec.plotDimension, {
    mode: "markers+text",
    name: "Network nodes",
    ...coordinateFields(display.nodes.map((node) => node.coordinates), spec.plotDimension),
    text: display.nodes.map((node) => node.code),
    textposition: "top center",
    hovertemplate: "%{text}<extra></extra>",
    marker: { color: "#f8fafc", line: { color: "#0f172a", width: 2 }, size: spec.style.nodeSize, opacity: spec.style.nodeOpacity },
  }, { role: "node" });
}

function edgeTraces(display: NormalizedDisplay, spec: DisplaySpecV1): PlotlyTraceV1[] {
  const nodes = new Map(display.nodes.map((node) => [node.index, node]));
  return display.edges
    .filter((edge) => Math.abs(edge.meanWeight) >= spec.style.edgeThreshold)
    .map((edge) => {
      const source = nodes.get(edge.sourceIndex);
      const target = nodes.get(edge.targetIndex);
      if (!source || !target) reject("MISSING_EDGE_NODE", `edges.${edge.id}`, "references a node absent from the selected coordinate space");
      return trace(spec.plotDimension, {
        mode: "lines",
        name: edge.id,
        ...coordinateFields([source.coordinates, target.coordinates], spec.plotDimension),
        text: [`${source.code} ↔ ${target.code}: ${edge.meanWeight}`, `${source.code} ↔ ${target.code}: ${edge.meanWeight}`],
        hovertemplate: "%{text}<extra></extra>",
        showlegend: false,
        line: {
          color: edge.meanWeight < 0 ? "#be123c" : "#64748b",
          width: Math.max(0.5, Math.abs(edge.meanWeight) * spec.style.edgeWidthScale),
        },
      }, { role: "network-edge", edgeId: edge.id });
    });
}

function axisTraces(display: NormalizedDisplay, spec: DisplaySpecV1): PlotlyTraceV1[] {
  const coordinates = [
    ...display.points.map((point) => point.coordinates),
    ...display.nodes.map((node) => node.coordinates),
  ];
  const extent = Math.max(1, ...coordinates.flatMap((point) => point.map(Math.abs))) * 1.08;
  const output: PlotlyTraceV1[] = [];
  for (let axis = 0; axis < 3; axis += 1) {
    if (spec.plotDimension === 2 && axis === 2) continue;
    const axisLabel = display.dimensions[axis]!;
    const end: Coordinates3D = [0, 0, 0];
    end[axis] = extent;
    output.push(trace(spec.plotDimension, {
      mode: "lines+text",
      name: `${axisLabel} axis`,
      ...coordinateFields([[0, 0, 0], end], spec.plotDimension),
      text: ["", axisLabel],
      textposition: "top center",
      line: { color: AXIS_COLORS[axis], width: 5 },
      hoverinfo: "skip",
      showlegend: false,
    }, { role: "axis-shaft", axis: axisLabel }));
    if (spec.plotDimension === 3) {
      const direction: Coordinates3D = [0, 0, 0];
      direction[axis] = 1;
      output.push({
        type: "cone",
        x: [end[0]], y: [end[1]], z: [end[2]],
        u: [direction[0]], v: [direction[1]], w: [direction[2]],
        anchor: "tip",
        sizemode: "absolute",
        sizeref: extent * 0.08,
        colorscale: [[0, AXIS_COLORS[axis]], [1, AXIS_COLORS[axis]]],
        showscale: false,
        hoverinfo: "skip",
        showlegend: false,
        meta: { role: "axis-arrowhead", axis: axisLabel },
      });
    }
  }
  return output;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Pure compiler: display changes select retained coordinates and never refit scientific results. */
export function compilePlotlySpec(
  result: AnalysisResult | PreparedSpaceResult,
  displaySpec: DisplaySpecV1,
): PlotlySpecV1 {
  assertDisplaySpecV1(displaySpec);
  const display = normalize(result, displaySpec);
  const data: PlotlyTraceV1[] = [];
  if (displaySpec.showAxes) data.push(...axisTraces(display, displaySpec));
  if (displaySpec.traces.network) data.push(...edgeTraces(display, displaySpec));
  if (displaySpec.traces.points) data.push(...pointTraces(display, displaySpec));
  if (displaySpec.traces.nodes) data.push(nodeTrace(display, displaySpec));
  // `traces.trajectory` and `traces.centroids` remain accepted so saved V1
  // DisplaySpecs stay readable, but the generic ENA presenter deliberately
  // ignores both. V1 has no independent ordinary group-mean artifact, and its
  // available centroids are trajectory group-period time points. Trajectory
  // marks must be compiled through `compileTrajectoryPlotlySpec`.
  const axis = (title: string) => ({ title, showgrid: displaySpec.showGrid, zeroline: displaySpec.showZeroLines });
  const layout: Record<string, unknown> = {
    autosize: true,
    showlegend: true,
    hovermode: "closest",
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    margin: { l: 56, r: 24, t: 24, b: 56 },
    uirevision: "3dena-camera-v1",
    ...(displaySpec.plotDimension === 3
      ? {
          scene: {
            xaxis: axis(display.dimensions[0]),
            yaxis: axis(display.dimensions[1]),
            zaxis: axis(display.dimensions[2]),
            aspectmode: "data",
            ...(displaySpec.camera ? { camera: structuredClone(displaySpec.camera) } : {}),
          },
        }
      : {
          xaxis: axis(display.dimensions[0]),
          yaxis: { ...axis(display.dimensions[1]), scaleanchor: "x", scaleratio: 1 },
        }),
  };
  const diagnostics: AnalysisDiagnostic[] = [];
  if (displaySpec.traces.uncertainty) diagnostics.push({
    code: "UNCERTAINTY_TRACE_NOT_APPLICABLE",
    severity: "info",
    message: "This raw/prepared result does not contain an approved uncertainty artifact; no uncertainty trace was compiled.",
    path: "displaySpec.traces.uncertainty",
  });
  if (display.source === "prepared-exchange") diagnostics.push({
    code: "PRECOMPUTED_COORDINATE_SPACE",
    severity: "info",
    message: "Plot traces use imported prepared coordinates and do not imply raw-row jENA recomputation.",
    path: "result.schemaVersion",
  });
  return deepFreeze({
    schemaVersion: "3dena.plotly-spec.v1",
    data,
    layout,
    config: { responsive: true, displaylogo: false, scrollZoom: true },
    diagnostics,
  });
}
