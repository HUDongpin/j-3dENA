import { assertDisplaySpecV1, type DisplaySpecV1 } from "./contracts";
import { selectAnalysisDisplay } from "./display";
import { selectPreparedSpaceDisplay } from "./prepared-space";
import type { PreparedSpaceResult } from "./prepared-types";
import type { AnalysisDiagnostic, AnalysisResult, Coordinates3D } from "./types";

export type PlotlyTraceRoleV1 =
  | "participant"
  | "node"
  | "network-edge"
  | "centroid"
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
  index: number;
  label: string;
  groupCanonical: string;
  groupDisplay: string;
  timeDisplay: string | null;
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

interface NormalizedCentroid {
  index: number;
  groupCanonical: string;
  groupDisplay: string;
  timeDisplay: string;
  participantCount: number;
  coordinates: Coordinates3D;
}

interface NormalizedPath {
  groupCanonical: string;
  groupDisplay: string;
  centroidIndexes: Array<number | null>;
}

interface NormalizedDisplay {
  source: "raw-jena" | "prepared-exchange";
  dimensions: [string, string, string];
  points: NormalizedPoint[];
  nodes: NormalizedNode[];
  edges: NormalizedEdge[];
  centroids: NormalizedCentroid[];
  paths: NormalizedPath[];
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

function rawDisplay(result: AnalysisResult, displaySpec: DisplaySpecV1): NormalizedDisplay {
  const selection = selectAnalysisDisplay(result, {
    dimensions: [...displaySpec.dimensions],
    ...(displaySpec.groups ? { groups: [...displaySpec.groups] } : {}),
  });
  const originalPoints = new Map(result.points.map((point) => [point.index, point]));
  const selectedIndexes = new Set(selection.points.map((point) => point.pointIndex));
  const edges = result.edges.map((edge) => {
    const weights = result.points.filter((point) => selectedIndexes.has(point.index)).map((point) => point.lineWeights[edge.index]!);
    const meanWeight = weights.length === 0 ? edge.meanWeight : weights.reduce((sum, value) => sum + value, 0) / weights.length;
    return { id: edge.id, sourceIndex: edge.sourceIndex, targetIndex: edge.targetIndex, meanWeight };
  });
  return {
    source: "raw-jena",
    dimensions: [...selection.dimensions],
    points: selection.points.map((point) => ({
      index: point.pointIndex,
      label: point.id.display,
      groupCanonical: point.group?.canonical ?? "@3dena/ungrouped",
      groupDisplay: point.group?.display ?? "All participants",
      timeDisplay: point.time?.display ?? null,
      coordinates: [...point.coordinates],
    })),
    nodes: selection.nodes.map((node) => ({ index: node.nodeIndex, code: node.code, coordinates: [...node.coordinates] })),
    edges,
    centroids: selection.trajectory?.centroids.map((centroid) => ({
      index: centroid.centroidIndex,
      groupCanonical: centroid.group.canonical,
      groupDisplay: centroid.group.display,
      timeDisplay: centroid.time.display,
      participantCount: centroid.participantCount,
      coordinates: [...centroid.coordinates],
    })) ?? [],
    paths: selection.trajectory?.paths.map((path) => ({
      groupCanonical: path.group.canonical,
      groupDisplay: path.group.display,
      centroidIndexes: path.steps.map((step) => step.centroidIndex),
    })) ?? [],
  };
}

function preparedDisplay(result: PreparedSpaceResult, displaySpec: DisplaySpecV1): NormalizedDisplay {
  const selection = selectPreparedSpaceDisplay(result, {
    dimensions: [...displaySpec.dimensions],
    ...(displaySpec.groups ? { groups: [...displaySpec.groups] } : {}),
  });
  const selectedIndexes = new Set(selection.points.map((point) => point.pointIndex));
  const edges = result.fullSpace.edges.map((edge) => {
    const weights = result.fullSpace.lineWeights.values
      .filter((_, index) => selectedIndexes.has(index))
      .map((row) => row[edge.index]!);
    const meanWeight = weights.length === 0 ? edge.meanWeight : weights.reduce((sum, value) => sum + value, 0) / weights.length;
    return { id: edge.id, sourceIndex: edge.sourceIndex, targetIndex: edge.targetIndex, meanWeight };
  });
  return {
    source: "prepared-exchange",
    dimensions: [...selection.dimensions],
    points: selection.points.map((point) => ({
      index: point.pointIndex,
      label: point.id.display,
      groupCanonical: point.group.canonical,
      groupDisplay: point.group.display,
      timeDisplay: point.time.display,
      coordinates: [...point.coordinates],
    })),
    nodes: selection.nodes.map((node) => ({ index: node.nodeIndex, code: node.code, coordinates: [...node.coordinates] })),
    edges,
    centroids: selection.centroids.map((centroid) => ({
      index: centroid.index,
      groupCanonical: centroid.group.canonical,
      groupDisplay: centroid.group.display,
      timeDisplay: centroid.time.display,
      participantCount: centroid.participantCount,
      coordinates: [...centroid.coordinates],
    })),
    paths: selection.paths.map((path) => ({
      groupCanonical: path.group.canonical,
      groupDisplay: path.group.display,
      centroidIndexes: path.steps.map((step) => step.centroidIndex),
    })),
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
    customdata: points.map((point) => [point.timeDisplay]),
    hovertemplate: "%{text}<br>%{customdata[0]}<extra></extra>",
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

function centroidTraces(display: NormalizedDisplay, spec: DisplaySpecV1): PlotlyTraceV1[] {
  const groups = new Map<string, NormalizedCentroid[]>();
  for (const centroid of display.centroids) groups.set(centroid.groupCanonical, [...(groups.get(centroid.groupCanonical) ?? []), centroid]);
  return [...groups.entries()].map(([canonical, centroids]) => trace(spec.plotDimension, {
    mode: "markers+text",
    name: `${centroids[0]!.groupDisplay} centroids`,
    ...coordinateFields(centroids.map((centroid) => centroid.coordinates), spec.plotDimension),
    text: centroids.map((centroid) => centroid.timeDisplay),
    customdata: centroids.map((centroid) => [centroid.participantCount]),
    hovertemplate: "%{text}<br>n=%{customdata[0]}<extra></extra>",
    marker: { symbol: "square", color: groupColor(canonical), size: spec.style.pointSize + 4, line: { color: "#ffffff", width: 1.5 } },
  }, { role: "centroid", groupCanonical: canonical }));
}

function trajectoryTraces(display: NormalizedDisplay, spec: DisplaySpecV1): PlotlyTraceV1[] {
  const centroids = new Map(display.centroids.map((centroid) => [centroid.index, centroid]));
  return display.paths.map((path) => {
    const coordinates = path.centroidIndexes.map((index) => index === null ? null : centroids.get(index)?.coordinates ?? null);
    const fields: Record<string, unknown> = {
      x: coordinates.map((point) => point?.[0] ?? null),
      y: coordinates.map((point) => point?.[1] ?? null),
      ...(spec.plotDimension === 3 ? { z: coordinates.map((point) => point?.[2] ?? null) } : {}),
    };
    return trace(spec.plotDimension, {
      mode: "lines+markers",
      name: `${path.groupDisplay} trajectory`,
      ...fields,
      connectgaps: false,
      line: { color: groupColor(path.groupCanonical), width: spec.style.trajectoryWidth },
      marker: { color: groupColor(path.groupCanonical), size: Math.max(4, spec.style.pointSize - 1), symbol: "square" },
      hovertemplate: `${path.groupDisplay}<extra></extra>`,
    }, { role: "trajectory", groupCanonical: path.groupCanonical });
  });
}

function axisTraces(display: NormalizedDisplay, spec: DisplaySpecV1): PlotlyTraceV1[] {
  const coordinates = [
    ...display.points.map((point) => point.coordinates),
    ...display.nodes.map((node) => node.coordinates),
    ...display.centroids.map((centroid) => centroid.coordinates),
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
  if (displaySpec.traces.trajectory) data.push(...trajectoryTraces(display, displaySpec));
  if (displaySpec.traces.centroids) data.push(...centroidTraces(display, displaySpec));
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
