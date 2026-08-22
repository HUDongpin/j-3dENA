import type { ChangeNetworkResultV1, ChangeNetworkSelectorV1, NetworkComparisonResultV1 } from "./network-analysis.js";
import type { PreparedSpacePoint, PreparedSpaceResult } from "./prepared-types.js";
import type { AnalysisDiagnostic, TypedValue } from "./types.js";
export declare class PreparedDerivedAnalysisError extends Error {
    readonly code: string;
    readonly path: string;
    constructor(code: string, path: string, message: string);
}
/**
 * Validates the immutable prepared reduction boundary without claiming that
 * imported coordinates were recomputed from raw rows.
 */
export declare function assertPreparedDerivedSource(result: PreparedSpaceResult): void;
export declare function preparedReductionDiagnostic(): AnalysisDiagnostic;
export declare function preparedGroupValue(result: PreparedSpaceResult, canonical: string, path: string): TypedValue;
export declare function preparedPointsForGroup(result: PreparedSpaceResult, canonical: string, path: string): PreparedSpacePoint[];
export declare function preparedDimensionIndex(result: PreparedSpaceResult, dimension: string, path: string): number;
export declare function comparePreparedGroupNetworks(result: PreparedSpaceResult, groups: readonly [string, string]): NetworkComparisonResultV1;
export declare function analyzePreparedChangeNetwork(result: PreparedSpaceResult, selector: ChangeNetworkSelectorV1): ChangeNetworkResultV1;
//# sourceMappingURL=prepared-derived.d.ts.map