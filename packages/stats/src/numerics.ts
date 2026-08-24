import type { StatisticalAlternative } from "./types";
import { reject } from "./types";

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

export function compensatedSum(values: readonly number[]): number {
  let sum = 0;
  let correction = 0;
  for (const value of values) {
    const next = sum + value;
    if (Math.abs(sum) >= Math.abs(value)) {
      correction += (sum - next) + value;
    } else {
      correction += (value - next) + sum;
    }
    sum = next;
  }
  return sum + correction;
}

export function commonScale(...groups: ReadonlyArray<readonly number[]>): number {
  let scale = 0;
  for (const group of groups) {
    for (const value of group) scale = Math.max(scale, Math.abs(value));
  }
  return scale === 0 ? 1 : scale;
}

export function describe(values: readonly number[], scale = commonScale(values)): ScaledDescription {
  if (values.length === 0) reject("EMPTY_SAMPLE", "values", "must contain at least one value");
  const normalized = values.map((value) => value / scale);
  const meanUnit = compensatedSum(normalized) / normalized.length;
  const centeredSquares = normalized.map((value) => {
    const centered = value - meanUnit;
    return centered * centered;
  });
  const varianceUnit = normalized.length > 1
    ? Math.max(0, compensatedSum(centeredSquares) / (normalized.length - 1))
    : 0;
  const standardDeviationUnit = Math.sqrt(varianceUnit);
  const mean = meanUnit * scale;
  if (!Number.isFinite(mean)) {
    reject("NUMERIC_OVERFLOW", "values", "the sample mean is not representable as a finite number");
  }
  return { n: values.length, scale, meanUnit, varianceUnit, standardDeviationUnit, mean };
}

export function representableScaled(valueUnit: number, scale: number): number | null {
  const value = valueUnit * scale;
  return Number.isFinite(value) ? value : null;
}

const LANCZOS_COEFFICIENTS = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
] as const;

function logGamma(value: number): number {
  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  }
  const shifted = value - 1;
  let series = LANCZOS_COEFFICIENTS[0];
  for (let index = 1; index < LANCZOS_COEFFICIENTS.length; index += 1) {
    series += LANCZOS_COEFFICIENTS[index]! / (shifted + index);
  }
  const base = shifted + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(base) - base + Math.log(series);
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const maximumIterations = 200;
  const epsilon = 3e-14;
  const floor = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < floor) d = floor;
  d = 1 / d;
  let result = d;
  for (let iteration = 1; iteration <= maximumIterations; iteration += 1) {
    const twice = 2 * iteration;
    let coefficient = (iteration * (b - iteration) * x)
      / ((qam + twice) * (a + twice));
    d = 1 + coefficient * d;
    if (Math.abs(d) < floor) d = floor;
    c = 1 + coefficient / c;
    if (Math.abs(c) < floor) c = floor;
    d = 1 / d;
    result *= d * c;
    coefficient = -((a + iteration) * (qab + iteration) * x)
      / ((a + twice) * (qap + twice));
    d = 1 + coefficient * d;
    if (Math.abs(d) < floor) d = floor;
    c = 1 + coefficient / c;
    if (Math.abs(c) < floor) c = floor;
    d = 1 / d;
    const delta = d * c;
    result *= delta;
    if (Math.abs(delta - 1) <= epsilon) return result;
  }
  reject("NUMERIC_CONVERGENCE", "studentT", "incomplete beta evaluation did not converge");
}

function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b)
      + a * Math.log(x) + b * Math.log1p(-x),
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

export function studentTCdf(statistic: number, degreesOfFreedom: number): number {
  if (statistic === 0) return 0.5;
  if (!(degreesOfFreedom > 0) || !Number.isFinite(degreesOfFreedom)) {
    reject("INVALID_DEGREES_OF_FREEDOM", "degreesOfFreedom", "must be finite and positive");
  }
  const x = degreesOfFreedom / (degreesOfFreedom + statistic * statistic);
  const tail = 0.5 * regularizedBeta(x, degreesOfFreedom / 2, 0.5);
  return statistic > 0 ? 1 - tail : tail;
}

/** Deterministic inverse of `studentTCdf` for versioned confidence intervals. */
export function studentTQuantile(probability: number, degreesOfFreedom: number): number {
  if (!(probability > 0 && probability < 1) || !Number.isFinite(probability)) {
    reject("INVALID_PROBABILITY", "probability", "must be finite and strictly between zero and one");
  }
  if (!(degreesOfFreedom > 0) || !Number.isFinite(degreesOfFreedom)) {
    reject("INVALID_DEGREES_OF_FREEDOM", "degreesOfFreedom", "must be finite and positive");
  }
  if (probability === 0.5) return 0;
  if (probability < 0.5) return -studentTQuantile(1 - probability, degreesOfFreedom);
  let lower = 0;
  let upper = 1;
  while (studentTCdf(upper, degreesOfFreedom) < probability) {
    upper *= 2;
    if (!Number.isFinite(upper) || upper > Number.MAX_VALUE / 2) {
      reject("NUMERIC_CONVERGENCE", "studentTQuantile", "failed to bracket the requested quantile");
    }
  }
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const midpoint = lower + (upper - lower) / 2;
    if (studentTCdf(midpoint, degreesOfFreedom) < probability) lower = midpoint;
    else upper = midpoint;
  }
  return lower + (upper - lower) / 2;
}

function erfc(value: number): number {
  const magnitude = Math.abs(value);
  const t = 1 / (1 + 0.5 * magnitude);
  const approximation = t * Math.exp(
    -magnitude * magnitude - 1.26551223
      + t * (1.00002368
        + t * (0.37409196
          + t * (0.09678418
            + t * (-0.18628806
              + t * (0.27886807
                + t * (-1.13520398
                  + t * (1.48851587
                    + t * (-0.82215223 + t * 0.17087277)))))))),
  );
  return value >= 0 ? approximation : 2 - approximation;
}

export function normalCdf(value: number): number {
  if (value === 0) return 0.5;
  return 0.5 * erfc(-value / Math.SQRT2);
}

export function pValueFromCdf(
  cdf: number,
  alternative: StatisticalAlternative,
): number {
  const bounded = Math.max(0, Math.min(1, cdf));
  if (alternative === "greater") return Math.max(0, 1 - bounded);
  if (alternative === "less") return bounded;
  return Math.max(0, Math.min(1, 2 * Math.min(bounded, 1 - bounded)));
}

export function continuityCorrectedZ(
  differenceFromNull: number,
  standardDeviation: number,
  alternative: StatisticalAlternative,
): number {
  if (differenceFromNull === 0) return 0;
  const correction = alternative === "two-sided"
    ? 0.5 * Math.sign(differenceFromNull)
    : alternative === "greater"
      ? 0.5
      : -0.5;
  return (differenceFromNull - correction) / standardDeviation;
}

export function rankValues(values: readonly number[]): RankedValues {
  const ordered = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value || left.index - right.index);
  const ranks = Array.from({ length: values.length }, () => 0);
  const tieSizes: number[] = [];
  let start = 0;
  while (start < ordered.length) {
    let end = start + 1;
    while (end < ordered.length && ordered[end]!.value === ordered[start]!.value) end += 1;
    const rank = ((start + 1) + end) / 2;
    for (let index = start; index < end; index += 1) {
      ranks[ordered[index]!.index] = rank;
    }
    if (end - start > 1) tieSizes.push(end - start);
    start = end;
  }
  return { ranks, tieSizes };
}
