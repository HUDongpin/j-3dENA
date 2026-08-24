import type { AnalysisDiagnostic, AnalysisResult, RawScalar, TypedValue } from "./types.js";
export interface NetworkMeanEdgeV1 {
    index: number;
    id: string;
    column: string;
    source: string;
    target: string;
    meanWeight: number;
}
export interface NetworkMeanV1 {
    pointCount: number;
    pointIndexes: number[];
    meanCoordinates: number[];
    edges: NetworkMeanEdgeV1[];
}
export interface NetworkDifferenceEdgeV1 extends NetworkMeanEdgeV1 {
    groupAMeanWeight: number;
    groupBMeanWeight: number;
    /** Positive values belong to A; negative values belong to B. */
    semanticOwner: "group-a" | "group-b" | "equal";
}
export interface NetworkComparisonResultV1 {
    schemaVersion: "3dena.network-comparison.v1";
    direction: "group-a-minus-group-b";
    groupA: TypedValue;
    groupB: TypedValue;
    meanA: NetworkMeanV1;
    meanB: NetworkMeanV1;
    differenceEdges: NetworkDifferenceEdgeV1[];
    diagnostics: AnalysisDiagnostic[];
}
export interface ChangeNetworkSelectorV1 {
    /** Metadata column name, or `@group` for the analysis group identity. */
    field: string;
    /** Exact raw scalar identity; string rendering is never used for matching. */
    level: RawScalar;
}
export interface ChangeNetworkResultV1 {
    schemaVersion: "3dena.change-network.v1";
    selector: ChangeNetworkSelectorV1;
    levelCanonical: string;
    mean: NetworkMeanV1;
    diagnostics: AnalysisDiagnostic[];
}
export declare class NetworkAnalysisError extends Error {
    readonly code: string;
    readonly path: string;
    constructor(code: string, path: string, message: string);
}
/**
 * Computes the formal `mean(groupA) - mean(groupB)` network over already fitted
 * point line weights. It never refits jENA and preserves source edge order.
 */
export declare function compareGroupNetworks(result: AnalysisResult, groups: readonly [string, string]): NetworkComparisonResultV1;
/** Selects one exact metadata/group level and computes its mean network. */
export declare function analyzeChangeNetwork(result: AnalysisResult, selector: ChangeNetworkSelectorV1): ChangeNetworkResultV1;
//# sourceMappingURL=network-analysis.d.ts.map