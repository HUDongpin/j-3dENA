import { adjustPValues } from "./adjust";
import {
  commonScale,
  continuityCorrectedZ,
  describe,
  normalCdf,
  pValueFromCdf,
  rankValues,
  representableScaled,
  studentTCdf,
  studentTQuantile,
} from "./numerics";
import {
  STATS_V1_CONTRACT,
  deepFreeze,
  reject,
  type IndependentSample,
  type IndependentStatisticsInput,
  type IndependentStatisticsResult,
  type MannWhitneyResult,
  type MeanDifferenceConfidenceIntervalV1,
  type StatsDiagnostic,
  type StatisticalAlternative,
  type WelchTestResult,
} from "./types";

const MAX_OBSERVATIONS_PER_SIDE = 1_000_000;
const CONFIDENCE_LEVEL = 0.95 as const;

interface ValidatedSample {
  label: string;
  input: number;
  values: number[];
  droppedMissing: number;
}

function validateAlternative(value: unknown): asserts value is StatisticalAlternative {
  if (value !== "two-sided" && value !== "greater" && value !== "less") {
    reject("INVALID_ALTERNATIVE", "input.alternative", "must be two-sided, greater, or less");
  }
}

function validateSample(sample: IndependentSample, path: string): ValidatedSample {
  if (!sample || typeof sample.label !== "string" || sample.label.trim() === "") {
    reject("INVALID_SAMPLE_LABEL", `${path}.label`, "must be a non-blank string");
  }
  if (!Array.isArray(sample.values)) reject("INVALID_SAMPLE", `${path}.values`, "must be an array");
  if (sample.values.length > MAX_OBSERVATIONS_PER_SIDE) {
    reject("SAMPLE_LIMIT", `${path}.values`, `must not exceed ${MAX_OBSERVATIONS_PER_SIDE} observations`);
  }
  const values: number[] = [];
  let droppedMissing = 0;
  Array.from(sample.values).forEach((value, index) => {
    if (value === null) {
      droppedMissing += 1;
      return;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      reject("NON_FINITE_VALUE", `${path}.values[${index}]`, "must be a finite number or explicit null");
    }
    values.push(value);
  });
  if (values.length < 2) {
    reject("INSUFFICIENT_SAMPLE", `${path}.values`, "requires at least two valid observations for Welch and Cohen's d");
  }
  return { label: sample.label, input: sample.values.length, values, droppedMissing };
}

function welchTest(
  left: readonly number[],
  right: readonly number[],
  alternative: StatisticalAlternative,
  diagnostics: StatsDiagnostic[],
): {
  result: WelchTestResult;
  meanA: number;
  meanB: number;
  meanDifference: number | null;
  confidenceInterval: MeanDifferenceConfidenceIntervalV1;
  cohensD: number | null;
} {
  const scale = commonScale(left, right);
  // Describe each group in its own finite scale. Using the largest value from
  // both groups can erase the smaller group's real variance before Welch's
  // standard error and degrees of freedom are formed.
  const a = describe(left);
  const b = describe(right);
  const differenceUnit = a.meanUnit * (a.scale / scale)
    - b.meanUnit * (b.scale / scale);
  const meanDifference = representableScaled(differenceUnit, scale);
  if (meanDifference === null) {
    diagnostics.push({
      code: "UNREPRESENTABLE_MEAN_DIFFERENCE",
      severity: "warning",
      message: "The finite-input A-minus-B mean difference exceeds the representable JavaScript range; scale-free inference remains available.",
    });
  }
  const uncertaintyScale = Math.max(
    a.standardDeviationUnit > 0 ? a.scale : 0,
    b.standardDeviationUnit > 0 ? b.scale : 0,
  ) || 1;
  const standardDeviationA = a.standardDeviationUnit * (a.scale / uncertaintyScale);
  const standardDeviationB = b.standardDeviationUnit * (b.scale / uncertaintyScale);
  const standardErrorA = standardDeviationA / Math.sqrt(a.n);
  const standardErrorB = standardDeviationB / Math.sqrt(b.n);
  const standardError = Math.hypot(standardErrorA, standardErrorB);
  const uncertaintyToResultScale = uncertaintyScale / scale;
  const standardErrorUnit = standardError * uncertaintyToResultScale;

  const ratioToUncertainty = (denominator: number): number | null => {
    if (differenceUnit === 0) return 0;
    const denominatorUnit = denominator * uncertaintyToResultScale;
    if (denominatorUnit > 0) {
      const direct = differenceUnit / denominatorUnit;
      if (Number.isFinite(direct)) return direct;
    }
    const logMagnitude = Math.log(Math.abs(differenceUnit))
      + Math.log(scale)
      - Math.log(denominator)
      - Math.log(uncertaintyScale);
    if (logMagnitude > Math.log(Number.MAX_VALUE)) return null;
    const value = Math.sign(differenceUnit) * Math.exp(logMagnitude);
    return Number.isFinite(value) ? value : null;
  };

  const limitingPValue = (): number => {
    if (differenceUnit === 0) return 1;
    if (alternative === "two-sided") return 0;
    if (alternative === "greater") return differenceUnit > 0 ? 0 : 1;
    return differenceUnit < 0 ? 0 : 1;
  };
  let statistic: number | null;
  let degreesOfFreedom: number | null;
  let pValue: number;
  if (standardError === 0) {
    diagnostics.push({
      code: "ZERO_WELCH_STANDARD_ERROR",
      severity: "warning",
      message: "Both groups have zero within-group variance; a finite Welch statistic and degrees of freedom are undefined.",
    });
    statistic = differenceUnit === 0 ? 0 : null;
    degreesOfFreedom = null;
    pValue = limitingPValue();
  } else {
    const maximumStandardError = Math.max(standardErrorA, standardErrorB);
    const normalizedVarianceA = (standardErrorA / maximumStandardError) ** 2;
    const normalizedVarianceB = (standardErrorB / maximumStandardError) ** 2;
    const normalizedVarianceSum = normalizedVarianceA + normalizedVarianceB;
    degreesOfFreedom = normalizedVarianceSum ** 2 / (
      normalizedVarianceA ** 2 / (a.n - 1)
      + normalizedVarianceB ** 2 / (b.n - 1)
    );
    statistic = ratioToUncertainty(standardError);
    if (statistic === null) {
      diagnostics.push({
        code: "UNREPRESENTABLE_WELCH_STATISTIC",
        severity: "warning",
        message: "The finite-input Welch statistic exceeds the representable JavaScript range; p is reported at its directional limiting value.",
      });
      pValue = limitingPValue();
    } else {
      pValue = pValueFromCdf(studentTCdf(statistic, degreesOfFreedom), alternative);
    }
  }
  const pooledVariance = (
    (a.n - 1) * standardDeviationA ** 2 + (b.n - 1) * standardDeviationB ** 2
  ) / (a.n + b.n - 2);
  const pooledStandardDeviation = Math.sqrt(Math.max(0, pooledVariance));
  const cohensD = pooledStandardDeviation === 0
    ? null
    : ratioToUncertainty(pooledStandardDeviation);
  if (pooledStandardDeviation === 0) {
    diagnostics.push({
      code: "ZERO_POOLED_VARIANCE",
      severity: "warning",
      message: "Cohen's d is undefined because the pooled sample variance is zero.",
    });
  } else if (cohensD === null) {
    diagnostics.push({
      code: "UNREPRESENTABLE_COHENS_D",
      severity: "warning",
      message: "The finite-input Cohen's d exceeds the representable JavaScript range and is reported as null.",
    });
  }
  const probability = alternative === "two-sided"
    ? 1 - (1 - CONFIDENCE_LEVEL) / 2
    : CONFIDENCE_LEVEL;
  const critical = degreesOfFreedom === null ? null : studentTQuantile(probability, degreesOfFreedom);
  const lowerUnit = alternative === "less" || critical === null
    ? null
    : differenceUnit - critical * standardErrorUnit;
  const upperUnit = alternative === "greater" || critical === null
    ? null
    : differenceUnit + critical * standardErrorUnit;
  const finiteBound = (valueUnit: number, side: "lower" | "upper") => {
    const value = representableScaled(valueUnit, scale);
    if (value !== null) return { kind: "finite" as const, value };
    diagnostics.push({
      code: "UNREPRESENTABLE_CONFIDENCE_BOUND",
      severity: "warning",
      message: `The ${side} Welch confidence bound exceeds the representable JavaScript range.`,
    });
    return { kind: "unrepresentable" as const };
  };
  const confidenceInterval: MeanDifferenceConfidenceIntervalV1 = {
    method: "welch-t-mean-difference-v1",
    confidenceLevel: CONFIDENCE_LEVEL,
    alternative,
    lower: critical === null
      ? { kind: "undefined" }
      : lowerUnit === null
        ? { kind: "negative-infinity" }
        : finiteBound(lowerUnit, "lower"),
    upper: critical === null
      ? { kind: "undefined" }
      : upperUnit === null
        ? { kind: "positive-infinity" }
        : finiteBound(upperUnit, "upper"),
  };
  return {
    result: {
      method: "welch-t-v1",
      alternative,
      statistic,
      degreesOfFreedom,
      pValue,
    },
    meanA: a.mean,
    meanB: b.mean,
    meanDifference,
    confidenceInterval,
    cohensD,
  };
}

function mannWhitney(
  left: readonly number[],
  right: readonly number[],
  alternative: StatisticalAlternative,
  diagnostics: StatsDiagnostic[],
): { result: MannWhitneyResult; rankBiserial: number } {
  const combined = [...left, ...right];
  const { ranks, tieSizes } = rankValues(combined);
  const rankSumA = ranks.slice(0, left.length).reduce((sum, rank) => sum + rank, 0);
  const product = left.length * right.length;
  const uA = rankSumA - (left.length * (left.length + 1)) / 2;
  const uB = product - uA;
  const mean = product / 2;
  const total = combined.length;
  const tieCorrection = tieSizes.reduce((sum, size) => sum + size ** 3 - size, 0);
  const variance = (product / 12) * (
    total + 1 - tieCorrection / (total * (total - 1))
  );
  let z = 0;
  let pValue = 1;
  if (variance > 0) {
    z = continuityCorrectedZ(uA - mean, Math.sqrt(variance), alternative);
    pValue = pValueFromCdf(normalCdf(z), alternative);
  } else {
    diagnostics.push({
      code: "DEGENERATE_RANK_SUM",
      severity: "warning",
      message: "Every pooled observation is tied; the asymptotic rank-sum variance is zero and p is reported as 1.",
    });
  }
  const tiedObservations = tieSizes.reduce((sum, size) => sum + size, 0);
  if (tieSizes.length > 0) {
    diagnostics.push({
      code: "RANK_SUM_TIES",
      severity: "info",
      message: "Exact-value ties received midranks and the asymptotic variance was tie-corrected.",
    });
  }
  return {
    result: {
      method: "mann-whitney-asymptotic-v1",
      alternative,
      tiePolicy: "exact-value-midrank",
      continuityCorrection: true,
      uA,
      uB,
      z,
      pValue,
      tieGroups: tieSizes.length,
      tiedObservations,
    },
    rankBiserial: product === 0 ? 0 : (2 * uA) / product - 1,
  };
}

export function analyzeIndependentSamples(
  input: IndependentStatisticsInput,
): IndependentStatisticsResult {
  if (!input || input.schemaVersion !== "3dena.stats.independent-input.v1") {
    reject("INVALID_SCHEMA_VERSION", "input.schemaVersion", "must be 3dena.stats.independent-input.v1");
  }
  validateAlternative(input.alternative);
  const left = validateSample(input.sideA, "input.sideA");
  const right = validateSample(input.sideB, "input.sideB");
  const diagnostics: StatsDiagnostic[] = [];
  if (left.droppedMissing + right.droppedMissing > 0) {
    diagnostics.push({
      code: "MISSING_VALUES_DROPPED",
      severity: "info",
      message: "Explicit null observations were dropped independently before analysis.",
    });
  }
  const welch = welchTest(left.values, right.values, input.alternative, diagnostics);
  const rank = mannWhitney(left.values, right.values, input.alternative, diagnostics);
  const raw = [welch.result.pValue, rank.result.pValue];
  const adjusted = adjustPValues(raw, input.adjustment);
  return deepFreeze({
    schemaVersion: "3dena.stats.independent-result.v1",
    design: "independent",
    direction: "A-minus-B",
    contract: STATS_V1_CONTRACT,
    alternative: input.alternative,
    samples: {
      sideA: {
        label: left.label,
        input: left.input,
        valid: left.values.length,
        droppedMissing: left.droppedMissing,
      },
      sideB: {
        label: right.label,
        input: right.input,
        valid: right.values.length,
        droppedMissing: right.droppedMissing,
      },
    },
    estimates: {
      meanA: welch.meanA,
      meanB: welch.meanB,
      meanDifference: welch.meanDifference,
      confidenceInterval: welch.confidenceInterval,
    },
    welch: welch.result,
    mannWhitney: rank.result,
    effects: {
      cohensD: welch.cohensD,
      rankBiserial: rank.rankBiserial,
    },
    adjustment: { method: input.adjustment, raw, adjusted },
    diagnostics,
  });
}
