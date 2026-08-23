import { type DeterministicZipLimits } from "../../export/src/index.js";
import type { TrajectoryDynamicsResultV1 } from "../../trajectory/src/index.js";
import { type ProvenanceManifestV1 } from "./contracts.js";
import type { ChangeNetworkResultV1, NetworkComparisonResultV1 } from "./network-analysis.js";
import type { PreparedSpaceResult } from "./prepared-types.js";
import { type StatisticsTaskResultV1 } from "./task-executor.js";
import type { TrajectoryBootstrapResult, TrajectoryComparisonResult, TrajectoryPathStatistics } from "./trajectory-statistics.js";
import type { AnalysisResult } from "./types.js";
import { type LongitudinalAnalysisBundleV2, type TrajectoryPlotlySpecV2 } from "./longitudinal-v2.js";
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
    sdk: {
        version: string;
        buildId: string;
    };
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
export declare class ExportBundleError extends Error {
    readonly code: string;
    readonly path: string;
    constructor(code: string, path: string, message: string);
}
/** Creates a deterministic formal scientific CSV/ZIP bundle for raw or prepared results. */
export declare function createExportBundle(result: LongitudinalAnalysisBundleV2, options: CreateLongitudinalExportBundleOptionsV2): Promise<LongitudinalExportBundleV2>;
export declare function createExportBundle(result: AnalysisExportInputV1, options: CreateExportBundleOptionsV1): Promise<ExportBundleV1>;
//# sourceMappingURL=export-bundle.d.ts.map