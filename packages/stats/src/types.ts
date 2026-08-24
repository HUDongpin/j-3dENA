export type StatisticalAlternative = "two-sided" | "greater" | "less";
export type PValueAdjustmentMethod = "none" | "holm" | "bh" | "bonferroni";
export type StatisticalScalarType = "string" | "number" | "boolean";

export type StatisticalIdentityComponent =
  | { name: string; type: "string"; value: string }
  | { name: string; type: "number"; value: number }
  | { name: string; type: "boolean"; value: boolean };

export interface StatisticalIdentity {
  components: StatisticalIdentityComponent[];
}

export interface StatisticalKey extends StatisticalIdentity {
  canonical: string;
  display: string;
}

export interface IndependentSample {
  label: string;
  values: Array<number | null>;
}

export interface IndependentStatisticsInput {
  schemaVersion: "3dena.stats.independent-input.v1";
  sideA: IndependentSample;
  sideB: IndependentSample;
  /** `greater` and `less` always refer to the A-minus-B direction. */
  alternative: StatisticalAlternative;
  /** Applied to the Welch and rank-sum p-values as one two-test family. */
  adjustment: PValueAdjustmentMethod;
}

export interface PairedObservation {
  id: StatisticalIdentity;
  value: number | null;
}

export interface PairedSample {
  label: string;
  observations: PairedObservation[];
}

export interface PairedStatisticsInput {
  schemaVersion: "3dena.stats.paired-input.v1";
  sideA: PairedSample;
  sideB: PairedSample;
  /** `greater` and `less` always refer to paired A-minus-B differences. */
  alternative: StatisticalAlternative;
  /** Applied to the one signed-rank p-value; use `adjustPValues` for larger families. */
  adjustment: PValueAdjustmentMethod;
}

export interface StatsDiagnostic {
  code: string;
  severity: "info" | "warning";
  message: string;
  path?: string;
}

export interface PValueAdjustmentResult {
  method: PValueAdjustmentMethod;
  /** The complete family supplied to this result, in caller order. */
  raw: number[];
  adjusted: number[];
}

export type ConfidenceBoundV1 =
  | { kind: "finite"; value: number }
  | { kind: "negative-infinity" }
  | { kind: "positive-infinity" }
  | { kind: "undefined" }
  | { kind: "unrepresentable" };

export interface MeanDifferenceConfidenceIntervalV1 {
  method: "welch-t-mean-difference-v1" | "paired-t-mean-difference-v1";
  confidenceLevel: 0.95;
  alternative: StatisticalAlternative;
  lower: ConfidenceBoundV1;
  upper: ConfidenceBoundV1;
}

export interface WelchTestResult {
  method: "welch-t-v1";
  alternative: StatisticalAlternative;
  statistic: number | null;
  degreesOfFreedom: number | null;
  pValue: number;
}

export interface MannWhitneyResult {
  method: "mann-whitney-asymptotic-v1";
  alternative: StatisticalAlternative;
  tiePolicy: "exact-value-midrank";
  continuityCorrection: true;
  uA: number;
  uB: number;
  z: number;
  pValue: number;
  tieGroups: number;
  tiedObservations: number;
}

export interface IndependentStatisticsResult {
  schemaVersion: "3dena.stats.independent-result.v1";
  design: "independent";
  direction: "A-minus-B";
  contract: typeof STATS_V1_CONTRACT;
  alternative: StatisticalAlternative;
  samples: {
    sideA: { label: string; input: number; valid: number; droppedMissing: number };
    sideB: { label: string; input: number; valid: number; droppedMissing: number };
  };
  estimates: {
    meanA: number;
    meanB: number;
    /** `null` only when the exact finite-input difference exceeds Number.MAX_VALUE. */
    meanDifference: number | null;
    confidenceInterval: MeanDifferenceConfidenceIntervalV1;
  };
  welch: WelchTestResult;
  mannWhitney: MannWhitneyResult;
  effects: {
    /** Pooled-sample-standard-deviation Cohen's d; null for zero pooled variance or an unrepresentable ratio. */
    cohensD: number | null;
    /** `2 * U_A / (n_A * n_B) - 1`, positive when A tends larger. */
    rankBiserial: number;
  };
  adjustment: PValueAdjustmentResult;
  diagnostics: StatsDiagnostic[];
}

export interface WilcoxonSignedRankResult {
  method: "wilcoxon-signed-rank-asymptotic-v1";
  alternative: StatisticalAlternative;
  tiePolicy: "exact-absolute-difference-midrank";
  zeroPolicy: "drop-exact-zero";
  continuityCorrection: true;
  /** Always W+, matching the stated A-minus-B direction. */
  statistic: number;
  wPositive: number;
  wNegative: number;
  z: number;
  pValue: number;
  tieGroups: number;
  tiedObservations: number;
}

export interface PairedStatisticsResult {
  schemaVersion: "3dena.stats.paired-result.v1";
  design: "paired";
  direction: "A-minus-B";
  contract: typeof STATS_V1_CONTRACT;
  alternative: StatisticalAlternative;
  matching: {
    sideAInput: number;
    sideBInput: number;
    matched: number;
    validPairs: number;
    droppedMissingPairs: number;
    unmatchedA: number;
    unmatchedB: number;
    zeroDifferences: number;
    rankedPairs: number;
  };
  estimates: {
    meanDifference: number | null;
    confidenceInterval: MeanDifferenceConfidenceIntervalV1;
  };
  wilcoxonSignedRank: WilcoxonSignedRankResult;
  effects: {
    /** Mean paired difference divided by its sample SD; null for zero SD. */
    cohensD: number | null;
    /** `(W+ - W-) / (W+ + W-)`; zero when every valid difference is zero. */
    rankBiserial: number;
  };
  adjustment: PValueAdjustmentResult;
  diagnostics: StatsDiagnostic[];
}

export const STATS_V1_CONTRACT = Object.freeze({
  schemaVersion: "3dena.stats.contract.v1",
  direction: "A-minus-B",
  missing: "drop-explicit-null",
  ties: "exact-value-midrank",
  signedRankZeros: "drop-exact-zero",
  rankInference: "asymptotic-normal",
  continuityCorrection: true,
  independentCohenD: "pooled-sample-standard-deviation",
  pairedCohenD: "mean-paired-difference-over-sample-sd",
  meanDifferenceConfidenceInterval: "alternative-aligned-t-interval-95-percent",
  pValueAdjustmentFamily: "caller-supplied-complete-family",
} as const);

export class StatsInputError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "StatsInputError";
    this.code = code;
    this.path = path;
  }
}

export function reject(code: string, path: string, message: string): never {
  throw new StatsInputError(code, path, message);
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}
