import {
  createDeterministicZip,
  encodeCsvUtf8,
  type CsvCell,
  type CsvTable,
  type DeterministicZipLimits,
} from "@3dena/export";
import type { TrajectoryDynamicsResultV1 } from "@3dena/trajectory";

import { assertProvenanceManifestV1, typedDoubleV1, type ProvenanceManifestV1 } from "./contracts";
import type { ChangeNetworkResultV1, NetworkComparisonResultV1 } from "./network-analysis";
import type { PreparedSpaceResult } from "./prepared-types";
import { hashAnalysisValueV1, type StatisticsTaskResultV1 } from "./task-executor";
import { adaptPreparedSpaceTrajectorySeries } from "./trajectory-series-adapters";
import { analyzeTrajectoryPath } from "./trajectory-statistics";
import type {
  TrajectoryBootstrapInterval,
  TrajectoryBootstrapResult,
  TrajectoryComparisonResult,
  TrajectoryPathStatistics,
} from "./trajectory-statistics";
import type { AnalysisDiagnostic, AnalysisResult, RawScalar } from "./types";

export interface AnalysisExportPortfolioV1 {
  schemaVersion: "3dena.analysis-export-portfolio.v1";
  analysis: AnalysisResult | PreparedSpaceResult;
  comparison?: NetworkComparisonResultV1;
  change?: ChangeNetworkResultV1;
  statistics?: StatisticsTaskResultV1;
  trajectory?: TrajectoryPathStatistics | TrajectoryDynamicsResultV1;
  trajectoryComparison?: TrajectoryComparisonResult;
  bootstrap?: TrajectoryBootstrapResult;
}

export type AnalysisExportInputV1 = AnalysisResult | PreparedSpaceResult | AnalysisExportPortfolioV1;

export interface CreateExportBundleOptionsV1 {
  provenance: ProvenanceManifestV1;
  fileName?: string;
  zipLimits?: Partial<DeterministicZipLimits>;
}

export interface ExportEntryReceiptV1 {
  path: string;
  mediaType: "text/csv" | "application/json";
  byteLength: number;
  sha256: string;
}

export interface ExportManifestV1 {
  schemaVersion: "3dena.export-manifest.v1";
  formalScientificExport: true;
  displayFilteringApplied: false;
  sourceResultSchema: string;
  provenance: ProvenanceManifestV1;
  scientificEntries: ExportEntryReceiptV1[];
  contentSetHash: string;
}

export interface ExportBundleV1 {
  schemaVersion: "3dena.export-bundle.v1";
  fileName: string;
  bytes: Uint8Array<ArrayBuffer>;
  sha256: string;
  byteLength: number;
  entries: ExportEntryReceiptV1[];
  manifest: ExportManifestV1;
}

export class ExportBundleError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "ExportBundleError";
    this.code = code;
    this.path = path;
  }
}

interface PendingEntry {
  path: string;
  mediaType: ExportEntryReceiptV1["mediaType"];
  data: Uint8Array<ArrayBuffer>;
}

const ENCODER = new TextEncoder();

function reject(code: string, path: string, message: string): never {
  throw new ExportBundleError(code, path, message);
}

function typedRaw(value: RawScalar): string {
  if (value === null) return JSON.stringify({ type: "null" });
  if (typeof value === "string") return JSON.stringify({ type: "string", value });
  if (typeof value === "boolean") return JSON.stringify({ type: "boolean", value });
  return JSON.stringify(typedDoubleV1(value));
}

function stableJson(value: unknown, path = "value"): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) reject("NON_FINITE_JSON", path, "cannot be emitted in deterministic JSON");
    return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry, index) => stableJson(entry, `${path}[${index}]`)).join(",")}]`;
  if (!value || typeof value !== "object") reject("INVALID_JSON_VALUE", path, "contains an unsupported value");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => {
    if (record[key] === undefined) reject("INVALID_JSON_VALUE", `${path}.${key}`, "must not be undefined");
    return `${JSON.stringify(key)}:${stableJson(record[key], `${path}.${key}`)}`;
  }).join(",")}}`;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) reject("CRYPTO_UNAVAILABLE", "crypto.subtle", "WebCrypto SHA-256 is required");
  const snapshot = new Uint8Array(bytes.byteLength);
  snapshot.set(bytes);
  return [...new Uint8Array(await subtle.digest("SHA-256", snapshot))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function csv(path: string, table: CsvTable): PendingEntry {
  return { path, mediaType: "text/csv", data: encodeCsvUtf8(table) };
}

function json(path: string, value: unknown): PendingEntry {
  return { path, mediaType: "application/json", data: ENCODER.encode(`${stableJson(value)}\n`) };
}

function diagnosticsTable(diagnostics: AnalysisDiagnostic[]): CsvTable {
  return {
    columns: ["code", "severity", "path", "message"],
    rows: diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.severity, diagnostic.path ?? null, diagnostic.message]),
  };
}

function rawEntries(result: AnalysisResult): PendingEntry[] {
  const metadata = [...new Set(result.points.flatMap((point) => Object.keys(point.metadata)))].sort();
  const entries: PendingEntry[] = [
    csv("coordinates.csv", {
      columns: ["point_index", "point_key_v1", "unit_key_v1", "participant_key_v1", "group_key_v1", "time_key_v1", ...result.dimensions, ...metadata.map((name) => `metadata:${name}:typed-v1`)],
      rows: result.points.map((point) => [
        point.index, point.id.canonical, point.unit.canonical, point.participantLabel.canonical,
        point.group?.canonical ?? null, point.time?.canonical ?? null,
        ...point.fullCoordinates, ...metadata.map((name) => typedRaw(point.metadata[name] ?? null)),
      ]),
    }),
    csv("nodes.csv", {
      columns: ["node_index", "code", ...result.dimensions],
      rows: result.nodes.map((node) => [node.index, node.code, ...node.fullCoordinates]),
    }),
    csv("edges.csv", {
      columns: ["edge_index", "edge_id", "column", "source", "target", "source_index", "target_index", "mean_weight"],
      rows: result.edges.map((edge) => [edge.index, edge.id, edge.column, edge.source, edge.target, edge.sourceIndex, edge.targetIndex, edge.meanWeight]),
    }),
    csv("lineweights.csv", {
      columns: ["point_index", "point_key_v1", ...result.edges.map((edge) => edge.column)],
      rows: result.points.map((point) => [point.index, point.id.canonical, ...point.lineWeights]),
    }),
    csv("variance.csv", {
      columns: ["axis", "proportion", "eigenvalue", "displayed"],
      rows: result.variance.map((row) => [row.axis, row.proportion, row.eigenvalue, row.displayed]),
    }),
    csv("rotation.csv", {
      columns: ["rotation_row", "edge_column", "center", ...result.rotation.columns],
      rows: result.rotation.matrix.map((row, index) => [index, result.edges[index]?.column ?? null, result.rotation.centerVector[index] ?? null, ...row]),
    }),
    csv("model-counts.csv", {
      columns: ["row_key_v1", ...result.accumulation.modelCounts.columns],
      rows: result.accumulation.modelCounts.values.map((row, index) => [result.accumulation.modelCounts.rowKeys[index]!.canonical, ...row]),
    }),
    csv("source-row-counts.csv", {
      columns: ["row_key_v1", ...result.accumulation.rowCounts.columns],
      rows: result.accumulation.rowCounts.values.map((row, index) => [result.accumulation.rowCounts.rowKeys[index]!.canonical, ...row]),
    }),
    csv("diagnostics.csv", diagnosticsTable(result.diagnostics)),
    json("summary.json", result.summary),
  ];
  if (result.trajectory) {
    entries.push(csv("centroids.csv", {
      columns: ["centroid_index", "group_key_v1", "time_key_v1", "participant_count", ...result.dimensions],
      rows: result.trajectory.centroids.map((centroid) => [
        centroid.index, centroid.group.canonical, centroid.time.canonical, centroid.participantCount, ...centroid.fullCoordinates,
      ]),
    }));
  }
  return entries;
}

function preparedEntries(result: PreparedSpaceResult): PendingEntry[] {
  const metadata = [...new Set(result.fullSpace.points.flatMap((point) => Object.keys(point.metadata)))].sort();
  let centroidIndex = 0;
  const fullCentroidRows = result.displaySpace.trajectory.groupOrder.flatMap((group) => {
    const series = adaptPreparedSpaceTrajectorySeries(result, { group: group.canonical, namespace: `export:${group.canonical}` });
    const path = analyzeTrajectoryPath(series);
    return path.periods.map((period) => [
      centroidIndex++, group.canonical, period.time.canonical, period.nUsed,
      ...(period.fullCentroid ?? result.fullSpace.dimensions.map(() => null)),
    ] as CsvCell[]);
  });
  const entries: PendingEntry[] = [
    csv("coordinates.csv", {
      columns: ["point_index", "point_key_v1", "participant_key_v1", "participant_label", "group_key_v1", "time_key_v1", ...result.fullSpace.dimensions, ...metadata.map((name) => `metadata:${name}:typed-v1`)],
      rows: result.fullSpace.points.map((point) => [
        point.index, point.id.canonical, point.participant.canonical, point.participantLabel.display,
        point.group.canonical, point.time.canonical, ...point.coordinates,
        ...metadata.map((name) => typedRaw(point.metadata[name] ?? null)),
      ]),
    }),
    csv("nodes.csv", {
      columns: ["node_index", "code", ...result.fullSpace.dimensions],
      rows: result.fullSpace.nodes.map((node) => [node.index, node.code, ...node.coordinates]),
    }),
    csv("edges.csv", {
      columns: ["edge_index", "edge_id", "column", "source", "target", "source_index", "target_index", "mean_weight"],
      rows: result.fullSpace.edges.map((edge) => [edge.index, edge.id, edge.column, edge.source, edge.target, edge.sourceIndex, edge.targetIndex, edge.meanWeight]),
    }),
    csv("lineweights.csv", {
      columns: ["row_key_v1", ...result.fullSpace.lineWeights.columns],
      rows: result.fullSpace.lineWeights.values.map((row, index) => [result.fullSpace.lineWeights.rowKeys[index]!.canonical, ...row]),
    }),
    csv("centroids.csv", {
      columns: ["centroid_index", "group_key_v1", "time_key_v1", "participant_count", ...result.fullSpace.dimensions],
      rows: fullCentroidRows,
    }),
    csv("diagnostics.csv", diagnosticsTable(result.diagnostics)),
    json("summary.json", result.summary),
    json("prepared-artifacts.json", {
      sourceKind: result.sourceKind,
      rawJenaRecompute: result.rawJenaRecompute,
      artifacts: result.artifacts,
      provenance: result.provenance,
    }),
  ];
  return entries;
}

function comparisonEntry(result: NetworkComparisonResultV1): PendingEntry {
  return csv("comparison.csv", {
    columns: ["edge_index", "edge_id", "column", "source", "target", "group_a_mean", "group_b_mean", "difference_a_minus_b", "semantic_owner"],
    rows: result.differenceEdges.map((edge) => [
      edge.index, edge.id, edge.column, edge.source, edge.target,
      edge.groupAMeanWeight, edge.groupBMeanWeight, edge.meanWeight, edge.semanticOwner,
    ]),
  });
}

function changeEntry(result: ChangeNetworkResultV1): PendingEntry {
  return csv("change.csv", {
    columns: ["field", "level_typed_v1", "point_count", "edge_index", "edge_id", "column", "source", "target", "mean_weight"],
    rows: result.mean.edges.map((edge) => [
      result.selector.field, typedRaw(result.selector.level), result.mean.pointCount,
      edge.index, edge.id, edge.column, edge.source, edge.target, edge.meanWeight,
    ]),
  });
}

function statisticsEntry(result: StatisticsTaskResultV1): PendingEntry {
  const rows: CsvCell[][] = [];
  for (const dimension of result.dimensions) {
    if (dimension.result.design === "independent") {
      const interval = dimension.result.estimates.confidenceInterval;
      rows.push([
        dimension.dimension, "independent", dimension.result.welch.method,
        dimension.result.estimates.meanDifference, interval.method, interval.confidenceLevel, interval.alternative,
        interval.lower.kind, interval.lower.kind === "finite" ? interval.lower.value : null,
        interval.upper.kind, interval.upper.kind === "finite" ? interval.upper.value : null,
        dimension.result.welch.statistic,
        dimension.result.welch.pValue, dimension.result.adjustment.adjusted[0]!, dimension.result.effects.cohensD,
        dimension.result.effects.rankBiserial, dimension.result.samples.sideA.valid, dimension.result.samples.sideB.valid,
        dimension.result.samples.sideA.droppedMissing + dimension.result.samples.sideB.droppedMissing, null,
      ]);
      rows.push([
        dimension.dimension, "independent", dimension.result.mannWhitney.method,
        dimension.result.estimates.meanDifference, null, null, null, null, null, null, null,
        dimension.result.mannWhitney.uA,
        dimension.result.mannWhitney.pValue, dimension.result.adjustment.adjusted[1]!, dimension.result.effects.cohensD,
        dimension.result.effects.rankBiserial, dimension.result.samples.sideA.valid, dimension.result.samples.sideB.valid,
        dimension.result.samples.sideA.droppedMissing + dimension.result.samples.sideB.droppedMissing, null,
      ]);
    } else {
      const interval = dimension.result.estimates.confidenceInterval;
      rows.push([
        dimension.dimension, "paired", dimension.result.wilcoxonSignedRank.method,
        dimension.result.estimates.meanDifference, interval.method, interval.confidenceLevel, interval.alternative,
        interval.lower.kind, interval.lower.kind === "finite" ? interval.lower.value : null,
        interval.upper.kind, interval.upper.kind === "finite" ? interval.upper.value : null,
        dimension.result.wilcoxonSignedRank.statistic,
        dimension.result.wilcoxonSignedRank.pValue, dimension.result.adjustment.adjusted[0]!, dimension.result.effects.cohensD,
        dimension.result.effects.rankBiserial, dimension.result.matching.validPairs, dimension.result.matching.validPairs,
        dimension.result.matching.droppedMissingPairs, dimension.result.matching.unmatchedA + dimension.result.matching.unmatchedB,
      ]);
    }
  }
  return csv("statistics.csv", {
    columns: [
      "dimension", "design", "method", "mean_difference", "mean_difference_ci_method", "confidence_level",
      "ci_alternative", "ci_lower_kind", "ci_lower_value", "ci_upper_kind", "ci_upper_value", "statistic",
      "p_value", "adjusted_p_value", "cohens_d", "rank_biserial", "valid_a", "valid_b", "dropped_missing",
      "unmatched",
    ],
    rows,
  });
}

function trajectoryEntry(result: TrajectoryPathStatistics | TrajectoryDynamicsResultV1): PendingEntry {
  if (result.schemaVersion === "3dena.trajectory-dynamics.v1") {
    return csv("trajectory.csv", {
      columns: [
        "period_index", "time_key_v1", "time_display", "time_value_v1", "elapsed_from_previous", "elapsed_from_start",
        "estimand", ...result.selectedDimensions.map((dimension) => `selected:${dimension}`),
        ...result.dimensions.map((dimension) => `full:${dimension}`), "selected_step_distance", "selected_cumulative_distance",
        "selected_speed", "full_step_distance", "full_cumulative_distance", "full_speed", "n_rows", "n_participant_periods",
        "n_used", "n_duplicate_rows", "n_cohort_excluded", "weight_sum", "effective_participant_n",
      ],
      rows: result.periods.map((period) => [
        period.index, period.time.canonical, period.time.display, stableJson(period.timeValue), period.elapsedFromPrevious,
        period.elapsedFromStart, result.estimand.kind, ...(period.selectedCentroid ?? [null, null, null]),
        ...(period.fullCentroid ?? result.dimensions.map(() => null)), period.selected3d.stepDistance,
        period.selected3d.cumulativeDistance, period.selected3d.speed, period.fullSpace.stepDistance,
        period.fullSpace.cumulativeDistance, period.fullSpace.speed, period.nRows, period.nParticipantPeriods,
        period.nUsed, period.nDuplicateRows, period.nCohortExcluded, period.weightSum, period.effectiveParticipantN,
      ]),
    });
  }
  return csv("trajectory.csv", {
    columns: [
      "period_index", "time_key_v1", "time_display", ...result.selectedDimensions.map((dimension) => `selected:${dimension}`),
      ...result.dimensions.map((dimension) => `full:${dimension}`), "selected_step_distance", "selected_cumulative_distance",
      "full_step_distance", "full_cumulative_distance", "n_rows", "n_total", "n_used", "n_duplicate_rows", "n_cohort_excluded",
    ],
    rows: result.periods.map((period) => [
      period.index, period.time.canonical, period.time.display, ...(period.selectedCentroid ?? [null, null, null]),
      ...(period.fullCentroid ?? result.dimensions.map(() => null)), period.selected3d.stepDistance, period.selected3d.cumulativeDistance,
      period.fullSpace.stepDistance, period.fullSpace.cumulativeDistance, period.nRows, period.nTotal, period.nUsed,
      period.nDuplicateRows, period.nCohortExcluded,
    ]),
  });
}

function trajectoryComparisonEntry(result: TrajectoryComparisonResult): PendingEntry {
  return csv("trajectory-comparison.csv", {
    columns: [
      "period_index", "time_key_v1", "time_display", "selected_centroid_separation", "full_centroid_separation",
      "selected_step_difference_b_minus_a", "selected_cumulative_difference_b_minus_a", "full_step_difference_b_minus_a",
      "full_cumulative_difference_b_minus_a", "n_a_used", "n_b_used", "n_matched",
    ],
    rows: result.periods.map((period) => [
      period.index, period.time.canonical, period.time.display, period.selectedCentroidSeparation, period.fullCentroidSeparation,
      period.selectedStepDistanceDifference, period.selectedCumulativeDistanceDifference, period.fullStepDistanceDifference,
      period.fullCumulativeDistanceDifference, period.nAUsed, period.nBUsed, period.nMatched,
    ]),
  });
}

function intervalRow(
  periodIndex: number,
  timeKey: string,
  metric: string,
  dimension: string | null,
  interval: TrajectoryBootstrapInterval | null,
): CsvCell[] {
  return [
    periodIndex, timeKey, metric, dimension, interval?.estimate ?? null, interval?.lower ?? null, interval?.upper ?? null,
    interval?.finiteReplicates ?? null, interval?.requiredFiniteReplicates ?? null, interval?.totalReplicates ?? null,
  ];
}

function bootstrapEntry(result: TrajectoryBootstrapResult): PendingEntry {
  const rows = result.periods.flatMap((period) => [
    ...period.selectedCentroid.map((interval, index) => intervalRow(period.index, period.time.canonical, "selected-centroid", result.base.selectedDimensions[index] ?? null, interval)),
    ...period.fullCentroid.map((interval, index) => intervalRow(period.index, period.time.canonical, "full-centroid", result.base.dimensions[index] ?? null, interval)),
    intervalRow(period.index, period.time.canonical, "selected-step-distance", null, period.selectedStepDistance),
    intervalRow(period.index, period.time.canonical, "full-step-distance", null, period.fullStepDistance),
    intervalRow(period.index, period.time.canonical, "selected-cumulative-distance", null, period.selectedCumulativeDistance),
    intervalRow(period.index, period.time.canonical, "full-cumulative-distance", null, period.fullCumulativeDistance),
  ]);
  return csv("uncertainty.csv", {
    columns: ["period_index", "time_key_v1", "metric", "dimension", "estimate", "lower", "upper", "finite_replicates", "required_finite_replicates", "total_replicates"],
    rows,
  });
}

function validatePortfolio(value: AnalysisExportInputV1): AnalysisExportPortfolioV1 {
  if (value.schemaVersion === "3dena.analysis-result.v1" || value.schemaVersion === "3dena.prepared-space-result.v1") {
    return { schemaVersion: "3dena.analysis-export-portfolio.v1", analysis: value };
  }
  if (value.schemaVersion !== "3dena.analysis-export-portfolio.v1") reject("UNSUPPORTED_EXPORT_RESULT", "result.schemaVersion", "is unsupported");
  const allowed = new Set(["schemaVersion", "analysis", "comparison", "change", "statistics", "trajectory", "trajectoryComparison", "bootstrap"]);
  const unknown = Object.keys(value).find((field) => !allowed.has(field));
  if (unknown) reject("INVALID_EXPORT_PORTFOLIO", "result", `contains unknown field ${JSON.stringify(unknown)}`);
  if (value.analysis.schemaVersion !== "3dena.analysis-result.v1" && value.analysis.schemaVersion !== "3dena.prepared-space-result.v1") reject("INVALID_EXPORT_PORTFOLIO", "result.analysis", "must contain a raw or prepared result");
  return value;
}

function bundleName(value: string | undefined): string {
  const name = value ?? "3dena-analysis.zip";
  if (name.length > 255 || !name.toLocaleLowerCase("en-US").endsWith(".zip") || name.includes("/") || name.includes("\\") || /[\u0000-\u001f\u007f]/u.test(name)) {
    reject("INVALID_EXPORT_FILE_NAME", "options.fileName", "must be a safe .zip basename");
  }
  return name;
}

/** Creates a deterministic formal scientific CSV/ZIP bundle for raw or prepared results. */
export async function createExportBundle(
  result: AnalysisExportInputV1,
  options: CreateExportBundleOptionsV1,
): Promise<ExportBundleV1> {
  if (!options || typeof options !== "object" || Array.isArray(options)) reject("INVALID_EXPORT_OPTIONS", "options", "must be an object");
  assertProvenanceManifestV1(options.provenance, "options.provenance");
  const actualResultHash = await hashAnalysisValueV1(result);
  if (actualResultHash !== options.provenance.resultHash) reject("RESULT_HASH_MISMATCH", "options.provenance.resultHash", "does not match the exported result or portfolio");
  const portfolio = validatePortfolio(result);
  const prepared = portfolio.analysis.schemaVersion === "3dena.prepared-space-result.v1";
  if (prepared !== (options.provenance.sourceKind === "prepared-exchange")) reject("PROVENANCE_SOURCE_MISMATCH", "options.provenance.sourceKind", "does not match the exported analysis source");
  const pending = portfolio.analysis.schemaVersion === "3dena.prepared-space-result.v1"
    ? preparedEntries(portfolio.analysis)
    : rawEntries(portfolio.analysis);
  if (portfolio.comparison) pending.push(comparisonEntry(portfolio.comparison));
  if (portfolio.change) pending.push(changeEntry(portfolio.change));
  if (portfolio.statistics) pending.push(statisticsEntry(portfolio.statistics));
  if (portfolio.trajectory) pending.push(trajectoryEntry(portfolio.trajectory));
  if (portfolio.trajectoryComparison) pending.push(trajectoryComparisonEntry(portfolio.trajectoryComparison));
  if (portfolio.bootstrap) pending.push(bootstrapEntry(portfolio.bootstrap));
  const sorted = [...pending].sort((left, right) => left.path.localeCompare(right.path, "en"));
  const scientificEntries: ExportEntryReceiptV1[] = [];
  for (const entry of sorted) scientificEntries.push({
    path: entry.path,
    mediaType: entry.mediaType,
    byteLength: entry.data.byteLength,
    sha256: await sha256Bytes(entry.data),
  });
  const contentSetHash = await hashAnalysisValueV1(scientificEntries);
  const manifest: ExportManifestV1 = {
    schemaVersion: "3dena.export-manifest.v1",
    formalScientificExport: true,
    displayFilteringApplied: false,
    sourceResultSchema: result.schemaVersion,
    provenance: structuredClone(options.provenance),
    scientificEntries,
    contentSetHash,
  };
  const manifestEntry = json("manifest.json", manifest);
  const manifestReceipt: ExportEntryReceiptV1 = {
    path: manifestEntry.path,
    mediaType: manifestEntry.mediaType,
    byteLength: manifestEntry.data.byteLength,
    sha256: await sha256Bytes(manifestEntry.data),
  };
  const bytes = createDeterministicZip([...sorted, manifestEntry].map((entry) => ({ path: entry.path, data: entry.data })), options.zipLimits);
  return Object.freeze({
    schemaVersion: "3dena.export-bundle.v1",
    fileName: bundleName(options.fileName),
    bytes,
    sha256: await sha256Bytes(bytes),
    byteLength: bytes.byteLength,
    entries: Object.freeze([...scientificEntries, manifestReceipt]),
    manifest: Object.freeze(manifest),
  }) as ExportBundleV1;
}
