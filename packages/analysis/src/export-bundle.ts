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
import {
  verifyLongitudinalAnalysisBundleV2,
  type LongitudinalAnalysisBundleV2,
  type TrajectoryPlotlySpecV2,
} from "./longitudinal-v2";

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

export interface CreateLongitudinalExportBundleOptionsV2 {
  /** Exact presenter spec shown to the researcher; it remains separate from the scientific envelope. */
  plotlySpec: TrajectoryPlotlySpecV2;
  /** Participant identifiers and histories are omitted unless the researcher explicitly opts in. */
  includeParticipantLevel?: boolean;
  fileName?: string;
  zipLimits?: Partial<DeterministicZipLimits>;
}

export interface LongitudinalProvenanceManifestV2 {
  schemaVersion: "3dena.longitudinal-provenance-manifest.v2";
  datasetHash: string;
  specHash: string;
  sourceResultHash: string;
  resultHash: string;
  runId: string;
  jenaBuildId: string;
  jena: {
    version: string;
    commit: string;
    tarballIntegrity: string;
  };
  sdk: { version: string; buildId: string };
  executionTarget: LongitudinalAnalysisBundleV2["execution"]["target"];
  seed: number;
  permutationPlanHashes: string[];
  resamplingPlanHashes: string[];
  evidenceStatus: LongitudinalAnalysisBundleV2["execution"]["evidenceStatus"];
  selectedDimensions: [string, string, string];
  fullRotationDimensions: string[];
  participantLevelIncluded: boolean;
  privacyWarning: string | null;
  members: ExportEntryReceiptV1[];
  contentSetHash: string;
}

export interface LongitudinalExportBundleV2 {
  schemaVersion: "3dena.longitudinal-export-bundle.v2";
  fileName: string;
  bytes: Uint8Array<ArrayBuffer>;
  sha256: string;
  byteLength: number;
  entries: ExportEntryReceiptV1[];
  manifest: LongitudinalProvenanceManifestV2;
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

function aggregateTrajectoryEnvelope(bundle: LongitudinalAnalysisBundleV2) {
  const redactPath = <T extends { participantPeriods: unknown[] }>(path: T) => ({ ...path, participantPeriods: [] });
  return {
    schemaVersion: "3dena.longitudinal-aggregate-export.v2",
    sourceEnvelopeSchemaVersion: bundle.schemaVersion,
    identity: structuredClone(bundle.identity),
    runSpec: structuredClone(bundle.runSpec),
    model: structuredClone(bundle.model),
    paths: bundle.paths.map((path) => ({
      group: structuredClone(path.group),
      dynamics: redactPath(structuredClone(path.dynamics)),
    })),
    inference: structuredClone(bundle.inference),
    pathComparisons: bundle.pathComparisons.map((comparison) => ({
      ...structuredClone(comparison),
      result: {
        ...structuredClone(comparison.result),
        sideA: redactPath(structuredClone(comparison.result.sideA)),
        sideB: redactPath(structuredClone(comparison.result.sideB)),
        permutation: { ...structuredClone(comparison.result.permutation), unitOrder: [] },
      },
    })),
    bootstrap: bundle.bootstrap.map((entry) => ({
      ...structuredClone(entry),
      result: { ...structuredClone(entry.result), base: redactPath(structuredClone(entry.result.base)) },
    })),
    networkOverlays: structuredClone(bundle.networkOverlays),
    diagnostics: structuredClone(bundle.diagnostics),
    execution: structuredClone(bundle.execution),
    privacy: {
      participantLevelIncluded: false,
      omittedFields: [
        "paths[].dynamics.participantPeriods",
        "pathComparisons[].result.sideA.participantPeriods",
        "pathComparisons[].result.sideB.participantPeriods",
        "pathComparisons[].result.permutation.unitOrder",
        "bootstrap[].result.base.participantPeriods",
      ],
    },
  };
}

function contributorSet(bundle: LongitudinalAnalysisBundleV2, groupIndex: number, periodCanonical: string): Set<string> {
  const dynamics = bundle.paths[groupIndex]!.dynamics;
  return new Set(dynamics.participantPeriods
    .filter((row) => row.includedInCohort && row.time.canonical === periodCanonical)
    .map((row) => row.participant.canonical));
}

function completeParticipantCount(bundle: LongitudinalAnalysisBundleV2, groupIndex: number): number {
  const dynamics = bundle.paths[groupIndex]!.dynamics;
  const observed = new Map<string, Set<string>>();
  for (const row of dynamics.participantPeriods) {
    const periods = observed.get(row.participant.canonical) ?? new Set<string>();
    periods.add(row.time.canonical);
    observed.set(row.participant.canonical, periods);
  }
  const expected = new Set(dynamics.periods.map((period) => period.time.canonical));
  return [...observed.values()].filter((periods) => [...expected].every((period) => periods.has(period))).length;
}

function longitudinalPathEntry(bundle: LongitudinalAnalysisBundleV2): PendingEntry {
  const fullColumns = bundle.model.fullRotationDimensions.map((dimension) => `full:${dimension}`);
  return csv("trajectory-path.csv", {
    columns: [
      "group_key_v1", "group_display", "period_index", "time_key_v1", "time_display", "time_value_v1",
      "rows", "participant_periods", "available", "complete", "included", "excluded", "duplicate_rows",
      "contributor_overlap_previous", ...bundle.model.selectedDimensions.map((dimension) => `selected:${dimension}`),
      ...bundle.model.selectedDimensions.map((dimension) => `delta:${dimension}`), ...fullColumns,
      "selected_step_distance", "selected_cumulative_distance", "selected_elapsed", "selected_speed",
      "full_step_distance", "full_cumulative_distance", "full_elapsed", "full_speed", "weight_sum", "effective_participant_n",
    ],
    rows: bundle.paths.flatMap((path, groupIndex) => {
      const complete = completeParticipantCount(bundle, groupIndex);
      return path.dynamics.periods.map((period, periodIndex) => {
        const current = contributorSet(bundle, groupIndex, period.time.canonical);
        const overlap = periodIndex === 0
          ? null
          : [...current].filter((participant) => contributorSet(bundle, groupIndex, path.dynamics.periods[periodIndex - 1]!.time.canonical).has(participant)).length;
        return [
          path.group.canonical, path.group.display, period.index, period.time.canonical, period.time.display,
          stableJson(period.timeValue), period.nRows, period.nParticipantPeriods, period.nParticipantPeriods, complete,
          period.nUsed, period.nCohortExcluded, period.nDuplicateRows, overlap,
          ...(period.selectedCentroid ?? [null, null, null]), ...(period.selected3d.delta ?? [null, null, null]),
          ...(period.fullCentroid ?? bundle.model.fullRotationDimensions.map(() => null)),
          period.selected3d.stepDistance, period.selected3d.cumulativeDistance, period.elapsedFromPrevious, period.selected3d.speed,
          period.fullSpace.stepDistance, period.fullSpace.cumulativeDistance, period.elapsedFromPrevious, period.fullSpace.speed,
          period.weightSum, period.effectiveParticipantN,
        ];
      });
    }),
  });
}

function longitudinalMetadataEntry(bundle: LongitudinalAnalysisBundleV2): PendingEntry {
  const rows: CsvCell[][] = [
    ["mapping", "participant_columns", stableJson(bundle.runSpec.participantColumns)],
    ["mapping", "time_column", bundle.runSpec.timeColumn],
    ["mapping", "group_column", bundle.runSpec.groupColumn],
    ["cohort", "policy", bundle.runSpec.cohortPolicy],
    ["missing", "policy", bundle.runSpec.missingValuePolicy],
    ["estimand", "contract", stableJson(bundle.runSpec.estimand)],
    ["dimensions", "selected", stableJson(bundle.model.selectedDimensions)],
    ["dimensions", "full_rotation", stableJson(bundle.model.fullRotationDimensions)],
    ["time", "ordered_periods", stableJson(bundle.runSpec.orderedPeriods)],
    ["execution", "target", bundle.execution.target],
    ["execution", "evidence_status", bundle.execution.evidenceStatus],
  ];
  for (const [groupIndex, path] of bundle.paths.entries()) {
    rows.push(["time-contract", path.group.canonical, stableJson(path.dynamics.timeContract)]);
    rows.push(["cohort-complete-count", path.group.canonical, completeParticipantCount(bundle, groupIndex)]);
  }
  for (const diagnostic of bundle.diagnostics) rows.push([`diagnostic:${diagnostic.severity}`, diagnostic.code, stableJson(diagnostic)]);
  return csv("trajectory-metadata.csv", { columns: ["section", "key", "value"], rows });
}

function longitudinalInferenceEntry(bundle: LongitudinalAnalysisBundleV2): PendingEntry {
  const rows: CsvCell[][] = [];
  for (const inference of bundle.inference) {
    if (inference.rows.length === 0) {
      rows.push([inference.request.kind, inference.status, inference.reason, inference.familyId, inference.familySize, null, null, null, null, null, null, null, null, null, stableJson(inference.request)]);
      continue;
    }
    for (const row of inference.rows) rows.push([
      inference.request.kind, inference.status, inference.reason, String(row.familyId ?? inference.familyId), Number(row.familySize ?? inference.familySize),
      String(row.memberId ?? ""), String(row.test ?? ""), String(row.design ?? ""), String(row.estimand ?? ""),
      typeof row.n === "number" ? row.n : typeof row.nPrimary === "number" && typeof row.nSecondary === "number" ? `${row.nPrimary}/${row.nSecondary}` : null,
      typeof row.effect === "number" ? row.effect : null, typeof row.statistic === "number" ? row.statistic : null,
      typeof row.pRaw === "number" ? row.pRaw : null, typeof row.pHolm === "number" ? row.pHolm : null, stableJson(row),
    ]);
  }
  for (const comparison of bundle.pathComparisons) {
    for (const test of comparison.result.tests) rows.push([
      "path-comparison", "available", null, `path-comparison:${comparison.groups.join(":")}`, comparison.result.tests.length,
      test.id, "permutation", comparison.design, bundle.runSpec.estimand.kind, null, test.observed, test.observed,
      test.pValue, test.holmAdjustedPValue, stableJson({ groups: comparison.groups, seed: comparison.seed, planHash: comparison.planHash, test }),
    ]);
  }
  return csv("trajectory-inference.csv", {
    columns: ["request_kind", "status", "reason", "family_id", "family_size", "member_id", "test", "design", "estimand", "n", "effect", "statistic", "p_raw", "p_holm", "audit_json"],
    rows,
  });
}

function longitudinalBootstrapEntry(bundle: LongitudinalAnalysisBundleV2): PendingEntry {
  const rows: CsvCell[][] = [];
  for (const entry of bundle.bootstrap) {
    for (const period of entry.result.periods) {
      const add = (metric: string, dimension: string | null, interval: TrajectoryBootstrapInterval | null) => rows.push([
        entry.groupCanonical, period.index, period.time.canonical, metric, dimension, interval?.estimate ?? null,
        interval?.lower ?? null, interval?.upper ?? null, interval?.finiteReplicates ?? 0,
        interval?.requiredFiniteReplicates ?? null, entry.totalReplicates, entry.result.confidenceLevel,
        entry.seed, entry.planHash, entry.result.resampling.unit, entry.result.resampling.stratified,
        entry.status, entry.notEstimableReason, entry.requestedResamplingDesign, entry.resolvedResamplingDesign,
      ]);
      period.selectedCentroid.forEach((interval, index) => add("selected-centroid", bundle.model.selectedDimensions[index] ?? null, interval));
      period.fullCentroid.forEach((interval, index) => add("full-centroid", bundle.model.fullRotationDimensions[index] ?? null, interval));
      add("selected-step-distance", null, period.selectedStepDistance);
      add("full-step-distance", null, period.fullStepDistance);
      add("selected-cumulative-distance", null, period.selectedCumulativeDistance);
      add("full-cumulative-distance", null, period.fullCumulativeDistance);
      add("selected-speed", null, entry.speedIntervals[period.index]?.selected ?? null);
      add("full-speed", null, entry.speedIntervals[period.index]?.full ?? null);
    }
  }
  return csv("trajectory-bootstrap.csv", {
    columns: ["group_key_v1", "period_index", "time_key_v1", "metric", "dimension", "estimate", "lower", "upper", "finite_replicates", "required_finite_replicates", "total_replicates", "confidence_level", "seed", "plan_hash", "resampling_unit", "stratified", "status", "not_estimable_reason", "requested_resampling_design", "resolved_resampling_design"],
    rows,
  });
}

function longitudinalParticipantEntry(bundle: LongitudinalAnalysisBundleV2): PendingEntry {
  return csv("trajectory-participants.csv", {
    columns: ["group_key_v1", "participant_key_v1", "participant_display", "time_key_v1", "time_display", "included", "source_row_count", ...bundle.model.selectedDimensions.map((dimension) => `selected:${dimension}`), ...bundle.model.fullRotationDimensions.map((dimension) => `full:${dimension}`), "participant_weight"],
    rows: bundle.paths.flatMap((path) => path.dynamics.participantPeriods.map((row) => [
      path.group.canonical, row.participant.canonical, row.participant.display, row.time.canonical, row.time.display,
      row.includedInCohort, row.sourceRowIndexes.length, ...row.selectedCoordinates, ...row.fullCoordinates, row.participantWeight,
    ])),
  });
}

async function createLongitudinalExportBundleV2(
  bundle: LongitudinalAnalysisBundleV2,
  options: CreateLongitudinalExportBundleOptionsV2,
): Promise<LongitudinalExportBundleV2> {
  if (!options || typeof options !== "object" || Array.isArray(options)) reject("INVALID_EXPORT_OPTIONS", "options", "must be an object");
  await verifyLongitudinalAnalysisBundleV2(bundle);
  if (!options.plotlySpec || options.plotlySpec.schemaVersion !== "3dena.trajectory-plotly-spec.v2") reject("INVALID_TRAJECTORY_PLOTLY_SPEC", "options.plotlySpec", "must be a compiled V2 trajectory Plotly spec");
  if (options.plotlySpec.resultHash !== bundle.identity.resultHash) reject("PLOTLY_RESULT_BINDING_MISMATCH", "options.plotlySpec.resultHash", "does not match the exported longitudinal result");
  if (options.includeParticipantLevel !== undefined && typeof options.includeParticipantLevel !== "boolean") reject("INVALID_PARTICIPANT_EXPORT_OPTION", "options.includeParticipantLevel", "must be boolean");
  const participantLevelIncluded = options.includeParticipantLevel === true;
  const pending: PendingEntry[] = [
    json("analysis.json", aggregateTrajectoryEnvelope(bundle)),
    longitudinalPathEntry(bundle),
    longitudinalMetadataEntry(bundle),
    longitudinalInferenceEntry(bundle),
    longitudinalBootstrapEntry(bundle),
    json("plotly-spec.json", options.plotlySpec),
  ];
  if (participantLevelIncluded) pending.push(longitudinalParticipantEntry(bundle));
  const sorted = [...pending].sort((left, right) => left.path.localeCompare(right.path, "en"));
  const members: ExportEntryReceiptV1[] = [];
  for (const entry of sorted) members.push({ path: entry.path, mediaType: entry.mediaType, byteLength: entry.data.byteLength, sha256: await sha256Bytes(entry.data) });
  const manifest: LongitudinalProvenanceManifestV2 = {
    schemaVersion: "3dena.longitudinal-provenance-manifest.v2",
    datasetHash: bundle.identity.datasetHash,
    specHash: bundle.identity.specHash,
    sourceResultHash: bundle.identity.sourceResultHash,
    resultHash: bundle.identity.resultHash,
    runId: bundle.identity.runId,
    jenaBuildId: bundle.identity.jenaBuildId,
    jena: { version: bundle.execution.jenaVersion, commit: bundle.execution.jenaCommit, tarballIntegrity: bundle.execution.jenaTarballIntegrity },
    sdk: { version: bundle.execution.sdkVersion, buildId: bundle.execution.buildId },
    executionTarget: bundle.execution.target,
    seed: bundle.execution.seed,
    permutationPlanHashes: [...bundle.execution.permutationPlanHashes],
    resamplingPlanHashes: [...bundle.execution.resamplingPlanHashes],
    evidenceStatus: bundle.execution.evidenceStatus,
    selectedDimensions: [...bundle.model.selectedDimensions],
    fullRotationDimensions: [...bundle.model.fullRotationDimensions],
    participantLevelIncluded,
    privacyWarning: participantLevelIncluded
      ? "Participant-level histories can increase privacy and re-identification risk; handle this opt-in file under the applicable data-governance controls."
      : null,
    members,
    contentSetHash: await hashAnalysisValueV1(members),
  };
  const manifestEntry = json("provenance-manifest.json", manifest);
  const manifestReceipt: ExportEntryReceiptV1 = { path: manifestEntry.path, mediaType: manifestEntry.mediaType, byteLength: manifestEntry.data.byteLength, sha256: await sha256Bytes(manifestEntry.data) };
  const bytes = createDeterministicZip([...sorted, manifestEntry].map((entry) => ({ path: entry.path, data: entry.data })), options.zipLimits);
  return Object.freeze({
    schemaVersion: "3dena.longitudinal-export-bundle.v2",
    fileName: bundleName(options.fileName ?? "3dena-longitudinal-analysis.zip"),
    bytes,
    sha256: await sha256Bytes(bytes),
    byteLength: bytes.byteLength,
    entries: Object.freeze([...members, manifestReceipt]),
    manifest: Object.freeze(manifest),
  }) as LongitudinalExportBundleV2;
}

/** Creates a deterministic formal scientific CSV/ZIP bundle for raw or prepared results. */
export function createExportBundle(
  result: LongitudinalAnalysisBundleV2,
  options: CreateLongitudinalExportBundleOptionsV2,
): Promise<LongitudinalExportBundleV2>;
export function createExportBundle(
  result: AnalysisExportInputV1,
  options: CreateExportBundleOptionsV1,
): Promise<ExportBundleV1>;
export async function createExportBundle(
  result: AnalysisExportInputV1 | LongitudinalAnalysisBundleV2,
  options: CreateExportBundleOptionsV1 | CreateLongitudinalExportBundleOptionsV2,
): Promise<ExportBundleV1 | LongitudinalExportBundleV2> {
  if (result.schemaVersion === "3dena.longitudinal-analysis-bundle.v2") {
    return createLongitudinalExportBundleV2(result, options as CreateLongitudinalExportBundleOptionsV2);
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) reject("INVALID_EXPORT_OPTIONS", "options", "must be an object");
  const legacyOptions = options as CreateExportBundleOptionsV1;
  assertProvenanceManifestV1(legacyOptions.provenance, "options.provenance");
  const actualResultHash = await hashAnalysisValueV1(result);
  if (actualResultHash !== legacyOptions.provenance.resultHash) reject("RESULT_HASH_MISMATCH", "options.provenance.resultHash", "does not match the exported result or portfolio");
  const portfolio = validatePortfolio(result);
  const prepared = portfolio.analysis.schemaVersion === "3dena.prepared-space-result.v1";
  if (prepared !== (legacyOptions.provenance.sourceKind === "prepared-exchange")) reject("PROVENANCE_SOURCE_MISMATCH", "options.provenance.sourceKind", "does not match the exported analysis source");
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
    provenance: structuredClone(legacyOptions.provenance),
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
  const bytes = createDeterministicZip([...sorted, manifestEntry].map((entry) => ({ path: entry.path, data: entry.data })), legacyOptions.zipLimits);
  return Object.freeze({
    schemaVersion: "3dena.export-bundle.v1",
    fileName: bundleName(legacyOptions.fileName),
    bytes,
    sha256: await sha256Bytes(bytes),
    byteLength: bytes.byteLength,
    entries: Object.freeze([...scientificEntries, manifestReceipt]),
    manifest: Object.freeze(manifest),
  }) as ExportBundleV1;
}
