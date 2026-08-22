import { type IndependentStatisticsResult, type PairedStatisticsResult } from "../../stats/src/index.js";
import { type TrajectoryDynamicsResultV1 } from "../../trajectory/src/index.js";
import { type AnalysisResultEnvelopeV1, type AnalysisTaskV1, type DatasetReceiptV1 } from "./contracts.js";
import { type ChangeNetworkResultV1, type NetworkComparisonResultV1 } from "./network-analysis.js";
import type { PreparedSpaceResult } from "./prepared-types.js";
import { type TrajectoryBootstrapResult, type TrajectoryComparisonResult, type TrajectoryPathStatistics } from "./trajectory-statistics.js";
import type { AnalysisResult } from "./types.js";
export declare const ANALYSIS_EXECUTION_DATASET_VERSION_V2: "3dena.analysis-execution-dataset.v2";
export interface AnalysisExecutionDatasetV1 {
    schemaVersion: "3dena.analysis-execution-dataset.v1";
    receipt: DatasetReceiptV1;
    /** Exact scientific-spec hash bound to this activated dataset. */
    specHash: string;
    /** Immutable build identity supplied by the local consumer or compute service. */
    buildId: string;
    /** Optional frozen clock for deterministic receipts and tests. */
    generatedAt?: string;
    sourceResult?: {
        hash: string;
        result: AnalysisResult;
    };
}
export interface RawAnalysisExecutionSourceResultV2 {
    sourceKind: "raw-jena";
    hash: string;
    result: AnalysisResult;
}
export interface PreparedAnalysisExecutionSourceResultV2 {
    sourceKind: "prepared-exchange";
    hash: string;
    result: PreparedSpaceResult;
}
export type AnalysisExecutionSourceResultV2 = RawAnalysisExecutionSourceResultV2 | PreparedAnalysisExecutionSourceResultV2;
/**
 * Versioned execution binding with an explicit raw/prepared source
 * discriminant. V1 remains supported for existing raw-only callers.
 */
export interface AnalysisExecutionDatasetV2 {
    schemaVersion: typeof ANALYSIS_EXECUTION_DATASET_VERSION_V2;
    receipt: DatasetReceiptV1;
    specHash: string;
    buildId: string;
    generatedAt?: string;
    sourceResult?: AnalysisExecutionSourceResultV2;
}
export type AnalysisExecutionDataset = AnalysisExecutionDatasetV1 | AnalysisExecutionDatasetV2;
export interface StatisticsDimensionResultV1 {
    dimension: string;
    result: IndependentStatisticsResult | PairedStatisticsResult;
}
export interface StatisticsTaskResultV1 {
    schemaVersion: "3dena.statistics-task-result.v1";
    design: "independent" | "paired";
    direction: "group-a-minus-group-b";
    groups: [string, string];
    dimensions: StatisticsDimensionResultV1[];
}
export type AnalysisTaskResultV1 = AnalysisResult | PreparedSpaceResult | NetworkComparisonResultV1 | ChangeNetworkResultV1 | StatisticsTaskResultV1 | TrajectoryDynamicsResultV1 | TrajectoryPathStatistics | TrajectoryComparisonResult | TrajectoryBootstrapResult;
export declare class AnalysisTaskExecutionError extends Error {
    readonly code: string;
    readonly path: string;
    constructor(code: string, path: string, message: string);
}
/** SHA-256 over the v1 lexicographically-keyed canonical JSON encoding. */
export declare function hashAnalysisValueV1(value: unknown): Promise<string>;
/**
 * Standalone V2 execution-dataset validator shared by local SDK callers,
 * remote compute boundaries, and publication workers. It validates the exact
 * source discriminant and complete raw result fields before any task runs.
 */
export declare function assertAnalysisExecutionDatasetV2(value: unknown, path?: string): asserts value is AnalysisExecutionDatasetV2;
/**
 * Executes one public SDK task locally using the same TypeScript core as the
 * compute worker. Remote clients submit the identical task envelope instead.
 */
export declare function executeAnalysisTask(dataset: AnalysisExecutionDataset, task: AnalysisTaskV1): Promise<AnalysisResultEnvelopeV1<AnalysisTaskResultV1>>;
//# sourceMappingURL=task-executor.d.ts.map