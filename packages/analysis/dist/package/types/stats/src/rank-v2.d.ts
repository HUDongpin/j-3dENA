export declare const RANK_INFERENCE_CONTRACT_V2: Readonly<{
    readonly schemaVersion: "3dena.stats.rank-contract.v2";
    readonly alternative: "two-sided";
    readonly pValueMethod: "auto-exact-first";
    readonly zeroMethod: "wilcox-drop-exact-zero";
    readonly adjustment: "holm-complete-planned-family-v2";
    readonly rankPrecisionSignificantDigits: 12;
    readonly exactMaxRankedN: 50;
    readonly friedmanExactAssignmentLimit: 1000000;
    readonly continuityCorrection: 0.5;
    readonly exactTail: "inclusive-non-mid-p";
}>;
export type RankPMethodV2 = "exact-classic" | "exact-conditional-rank-permutation" | "normal-approximation-tie-corrected" | "exact-conditional-sign-flip" | "normal-approximation-actual-ranks" | "exact-conditional-period-permutation" | "chi-square-approximation-tie-corrected";
export type RankWarningCodeV2 = "small-sample" | "discrete-attainable-p" | "ties-present" | "zero-differences-present" | "missing-pairs" | "missing-complete-blocks" | "signed-rank-symmetry-assumption";
export interface ExactTailAuditV2 {
    extremeAssignmentCount: string;
    totalAssignmentCount: string;
    inclusive: true;
    midP: false;
}
export interface MannWhitneyRankResultV2 {
    schemaVersion: "3dena.stats.mann-whitney.v2";
    status: "available" | "not-estimable";
    reason: "empty-group" | "all-values-tied" | null;
    nPrimary: number;
    nSecondary: number;
    medianPrimary: number | null;
    medianSecondary: number | null;
    uPrimary: number | null;
    uSecondary: number | null;
    z: number | null;
    pValueTwoSided: number | null;
    rankBiserialPrimaryVsSecondary: number | null;
    resolvedPMethod: RankPMethodV2 | null;
    continuityCorrectionApplied: boolean;
    tieGroupCount: number;
    tiedObservationCount: number;
    tieCorrectionSum: number;
    exactTail: ExactTailAuditV2 | null;
    warnings: RankWarningCodeV2[];
}
export interface MinimumAttainableTwoSidedPV2 {
    formula: "2^(1-nNonzero)";
    log2: number;
    numeric: number | null;
}
export interface WilcoxonSignedRankResultV2 {
    schemaVersion: "3dena.stats.wilcoxon-signed-rank.v2";
    status: "available" | "not-estimable";
    reason: "insufficient-ranked-observations" | "all-zero-differences" | null;
    nMatched: number;
    nMissing: number;
    nPositive: number;
    nNegative: number;
    nZero: number;
    nNonzero: number;
    nRanked: number;
    medianDifference: number | null;
    q1Difference: number | null;
    q3Difference: number | null;
    iqrDifference: number | null;
    wPositive: number | null;
    wNegative: number | null;
    t: number | null;
    z: number | null;
    pValueTwoSided: number | null;
    rankBiserialLaterVsEarlier: number | null;
    resolvedPMethod: RankPMethodV2 | null;
    continuityCorrectionApplied: boolean;
    tieGroupCount: number;
    tiedObservationCount: number;
    tieCorrectionSum: number;
    exactTail: ExactTailAuditV2 | null;
    minimumAttainableTwoSidedP: MinimumAttainableTwoSidedPV2 | null;
    warnings: RankWarningCodeV2[];
}
export interface FriedmanRankResultV2 {
    schemaVersion: "3dena.stats.friedman.v2";
    status: "available" | "not-estimable";
    reason: "no-complete-blocks" | "insufficient-ranked-observations" | "all-values-tied" | null;
    nComplete: number;
    nMissingCompleteBlocks: number;
    nPeriods: number;
    q: number | null;
    degreesFreedom: number | null;
    kendallsW: number | null;
    pValueUpperTail: number | null;
    resolvedPMethod: RankPMethodV2 | null;
    tieGroupCount: number;
    tiedObservationCount: number;
    tieCorrectionSum: number;
    exactTail: ExactTailAuditV2 | null;
    warnings: RankWarningCodeV2[];
}
export interface PlannedHolmMemberV2 {
    memberId: string;
    pRaw: number | null;
}
export interface PlannedHolmResultV2 extends PlannedHolmMemberV2 {
    pHolm: number | null;
    familySizePlanned: number;
    holmRank: number | null;
    holmMultiplier: number | null;
}
export declare function mannWhitneyRankTestV2(primaryValues: readonly number[], secondaryValues: readonly number[]): MannWhitneyRankResultV2;
export declare function wilcoxonSignedRankTestV2(rawDifferencesLaterMinusEarlier: readonly number[], options?: {
    missingPairs?: number;
}): WilcoxonSignedRankResultV2;
export declare function friedmanRankTestV2(completeBlocksByPeriod: readonly (readonly number[])[], options?: {
    missingCompleteBlocks?: number;
    periodCountWhenEmpty?: number;
}): FriedmanRankResultV2;
export declare function holmAdjustFamilyV2(members: readonly PlannedHolmMemberV2[]): PlannedHolmResultV2[];
//# sourceMappingURL=rank-v2.d.ts.map