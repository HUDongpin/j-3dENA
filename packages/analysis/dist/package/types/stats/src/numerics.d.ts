import type { StatisticalAlternative } from "./types.js";
export interface ScaledDescription {
    n: number;
    scale: number;
    meanUnit: number;
    varianceUnit: number;
    standardDeviationUnit: number;
    mean: number;
}
export interface RankedValues {
    ranks: number[];
    tieSizes: number[];
}
export declare function compensatedSum(values: readonly number[]): number;
export declare function commonScale(...groups: ReadonlyArray<readonly number[]>): number;
export declare function describe(values: readonly number[], scale?: number): ScaledDescription;
export declare function representableScaled(valueUnit: number, scale: number): number | null;
export declare function studentTCdf(statistic: number, degreesOfFreedom: number): number;
/** Deterministic inverse of `studentTCdf` for versioned confidence intervals. */
export declare function studentTQuantile(probability: number, degreesOfFreedom: number): number;
export declare function normalCdf(value: number): number;
export declare function pValueFromCdf(cdf: number, alternative: StatisticalAlternative): number;
export declare function continuityCorrectedZ(differenceFromNull: number, standardDeviation: number, alternative: StatisticalAlternative): number;
export declare function rankValues(values: readonly number[]): RankedValues;
//# sourceMappingURL=numerics.d.ts.map