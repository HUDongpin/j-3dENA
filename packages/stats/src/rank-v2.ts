import { deepFreeze, reject } from "./types";

export const RANK_INFERENCE_CONTRACT_V2 = Object.freeze({
  schemaVersion: "3dena.stats.rank-contract.v2",
  alternative: "two-sided",
  pValueMethod: "auto-exact-first",
  zeroMethod: "wilcox-drop-exact-zero",
  adjustment: "holm-complete-planned-family-v2",
  rankPrecisionSignificantDigits: 12,
  exactMaxRankedN: 50,
  friedmanExactAssignmentLimit: 1_000_000,
  continuityCorrection: 0.5,
  exactTail: "inclusive-non-mid-p",
} as const);

export type RankPMethodV2 =
  | "exact-classic"
  | "exact-conditional-rank-permutation"
  | "normal-approximation-tie-corrected"
  | "exact-conditional-sign-flip"
  | "normal-approximation-actual-ranks"
  | "exact-conditional-period-permutation"
  | "chi-square-approximation-tie-corrected";

export type RankWarningCodeV2 =
  | "small-sample"
  | "discrete-attainable-p"
  | "ties-present"
  | "zero-differences-present"
  | "missing-pairs"
  | "missing-complete-blocks"
  | "signed-rank-symmetry-assumption";

export interface ExactTailAuditV2 {
  extremeAssignmentCount: string;
  totalAssignmentCount: string;
  inclusive: true;
  midP: false;
}

interface AverageRanksV2 {
  ranks: number[];
  doubledRanks: number[];
  tieGroupCount: number;
  tiedObservationCount: number;
  tieCorrectionSum: number;
}

interface Type7SummaryV2 {
  median: number | null;
  q1: number | null;
  q3: number | null;
  iqr: number | null;
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

function normalizeRankValue(value: number, path: string): number {
  if (!Number.isFinite(value)) reject("NON_FINITE_RANK_VALUE", path, "must be finite");
  const rounded = Number(value.toPrecision(RANK_INFERENCE_CONTRACT_V2.rankPrecisionSignificantDigits));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function summarizeType7(values: readonly number[], path: string): Type7SummaryV2 {
  const sorted = values.map((value, index) => normalizeRankValue(value, `${path}[${index}]`))
    .sort((left, right) => left - right);
  const quantile = (probability: number): number | null => {
    if (sorted.length === 0) return null;
    const position = (sorted.length - 1) * probability;
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);
    const lower = sorted[lowerIndex]!;
    const upper = sorted[upperIndex]!;
    return lower + (position - lowerIndex) * (upper - lower);
  };
  const q1 = quantile(0.25);
  const q3 = quantile(0.75);
  return {
    median: quantile(0.5),
    q1,
    q3,
    iqr: q1 === null || q3 === null ? null : q3 - q1,
  };
}

function averageRanks(values: readonly number[], path: string): AverageRanksV2 {
  const ordered = values
    .map((value, index) => ({ value: normalizeRankValue(value, `${path}[${index}]`), index }))
    .sort((left, right) => left.value - right.value || left.index - right.index);
  const ranks = Array<number>(ordered.length);
  let tieGroupCount = 0;
  let tiedObservationCount = 0;
  let tieCorrectionSum = 0;
  for (let start = 0; start < ordered.length;) {
    let end = start + 1;
    while (end < ordered.length && ordered[end]!.value === ordered[start]!.value) end += 1;
    const averageRank = ((start + 1) + end) / 2;
    for (let index = start; index < end; index += 1) ranks[ordered[index]!.index] = averageRank;
    const tieSize = end - start;
    if (tieSize > 1) {
      tieGroupCount += 1;
      tiedObservationCount += tieSize;
      tieCorrectionSum += tieSize ** 3 - tieSize;
    }
    start = end;
  }
  return {
    ranks,
    doubledRanks: ranks.map((rank) => Math.round(rank * 2)),
    tieGroupCount,
    tiedObservationCount,
    tieCorrectionSum,
  };
}

const LANCZOS_COEFFICIENTS = [
  676.5203681218851,
  -1259.1392167224028,
  771.3234287776531,
  -176.6150291621406,
  12.507343278686905,
  -0.13857109526572012,
  9.984369578019572e-6,
  1.5056327351493116e-7,
] as const;

function logGamma(value: number): number {
  if (value < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  const shifted = value - 1;
  let sum = 0.9999999999998099;
  for (const [index, coefficient] of LANCZOS_COEFFICIENTS.entries()) {
    sum += coefficient / (shifted + index + 1);
  }
  const t = shifted + LANCZOS_COEFFICIENTS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(sum);
}

function regularizedGammaQ(shape: number, x: number): number {
  if (!Number.isFinite(shape) || shape <= 0 || Number.isNaN(x) || x < 0) {
    reject("INVALID_GAMMA_INPUT", "rank", "requires shape > 0 and x >= 0");
  }
  if (x === 0) return 1;
  if (x === Number.POSITIVE_INFINITY) return 0;
  const epsilon = 1e-15;
  const minimum = 1e-300;
  const logScale = -x + shape * Math.log(x) - logGamma(shape);
  if (x < shape + 1) {
    let term = 1 / shape;
    let sum = term;
    let denominator = shape;
    for (let iteration = 1; iteration <= 10_000; iteration += 1) {
      denominator += 1;
      term *= x / denominator;
      sum += term;
      if (Math.abs(term) <= Math.abs(sum) * epsilon) break;
    }
    return Math.max(0, Math.min(1, 1 - sum * Math.exp(logScale)));
  }
  let b = x + 1 - shape;
  let c = 1 / minimum;
  let d = 1 / Math.max(Math.abs(b), minimum);
  if (b < 0) d = -d;
  let fraction = d;
  for (let iteration = 1; iteration <= 10_000; iteration += 1) {
    const coefficient = -iteration * (iteration - shape);
    b += 2;
    d = coefficient * d + b;
    if (Math.abs(d) < minimum) d = minimum;
    c = b + coefficient / c;
    if (Math.abs(c) < minimum) c = minimum;
    d = 1 / d;
    const delta = d * c;
    fraction *= delta;
    if (Math.abs(delta - 1) <= epsilon) break;
  }
  return Math.max(0, Math.min(1, Math.exp(logScale) * fraction));
}

function probabilityFromCounts(extreme: bigint, total: bigint): number {
  if (total <= 0n || total > BigInt(Number.MAX_SAFE_INTEGER) || extreme < 0n || extreme > total) {
    reject("EXACT_COUNT_LIMIT", "rank.exactTail", "assignment counts exceed the supported safe ratio range");
  }
  return Number(extreme) / Number(total);
}

function exactFixedSizeRankTail(
  doubledRanks: readonly number[],
  selectedSize: number,
  observedDoubledRankSum: number,
): ExactTailAuditV2 & { pValue: number } {
  const distributions = Array.from({ length: selectedSize + 1 }, () => new Map<number, bigint>());
  distributions[0]!.set(0, 1n);
  let processed = 0;
  for (const rank of doubledRanks) {
    processed += 1;
    for (let picked = Math.min(selectedSize, processed); picked >= 1; picked -= 1) {
      for (const [score, count] of distributions[picked - 1]!) {
        const nextScore = score + rank;
        distributions[picked]!.set(nextScore, (distributions[picked]!.get(nextScore) ?? 0n) + count);
      }
    }
  }
  const nullCenter = selectedSize * (doubledRanks.length + 1);
  const observedDistance = Math.abs(observedDoubledRankSum - nullCenter);
  let total = 0n;
  let extreme = 0n;
  for (const [score, count] of distributions[selectedSize]!) {
    total += count;
    if (Math.abs(score - nullCenter) >= observedDistance) extreme += count;
  }
  return {
    extremeAssignmentCount: extreme.toString(),
    totalAssignmentCount: total.toString(),
    inclusive: true,
    midP: false,
    pValue: probabilityFromCounts(extreme, total),
  };
}

function mannWhitneyWarnings(nA: number, nB: number, exact: boolean, ties: boolean): RankWarningCodeV2[] {
  const warnings: RankWarningCodeV2[] = [];
  if (nA < 10 || nB < 10) warnings.push("small-sample");
  if (exact) warnings.push("discrete-attainable-p");
  if (ties) warnings.push("ties-present");
  return warnings;
}

export function mannWhitneyRankTestV2(
  primaryValues: readonly number[],
  secondaryValues: readonly number[],
): MannWhitneyRankResultV2 {
  const primary = primaryValues.map((value, index) => normalizeRankValue(value, `primary[${index}]`));
  const secondary = secondaryValues.map((value, index) => normalizeRankValue(value, `secondary[${index}]`));
  const nPrimary = primary.length;
  const nSecondary = secondary.length;
  const medianPrimary = summarizeType7(primary, "primary").median;
  const medianSecondary = summarizeType7(secondary, "secondary").median;
  if (nPrimary === 0 || nSecondary === 0) {
    return deepFreeze({
      schemaVersion: "3dena.stats.mann-whitney.v2",
      status: "not-estimable",
      reason: "empty-group",
      nPrimary,
      nSecondary,
      medianPrimary,
      medianSecondary,
      uPrimary: null,
      uSecondary: null,
      z: null,
      pValueTwoSided: null,
      rankBiserialPrimaryVsSecondary: null,
      resolvedPMethod: null,
      continuityCorrectionApplied: false,
      tieGroupCount: 0,
      tiedObservationCount: 0,
      tieCorrectionSum: 0,
      exactTail: null,
      warnings: mannWhitneyWarnings(nPrimary, nSecondary, false, false),
    });
  }
  const ranked = averageRanks([...primary, ...secondary], "pooled");
  const rankSumPrimary = ranked.ranks.slice(0, nPrimary).reduce((sum, rank) => sum + rank, 0);
  const uPrimary = rankSumPrimary - nPrimary * (nPrimary + 1) / 2;
  const uSecondary = nPrimary * nSecondary - uPrimary;
  const rankBiserialPrimaryVsSecondary = 2 * uPrimary / (nPrimary * nSecondary) - 1;
  const total = nPrimary + nSecondary;
  const variance = nPrimary * nSecondary / 12
    * (total + 1 - ranked.tieCorrectionSum / (total * (total - 1)));
  if (!(variance > 0) || !Number.isFinite(variance)) {
    return deepFreeze({
      schemaVersion: "3dena.stats.mann-whitney.v2",
      status: "not-estimable",
      reason: "all-values-tied",
      nPrimary,
      nSecondary,
      medianPrimary,
      medianSecondary,
      uPrimary,
      uSecondary,
      z: null,
      pValueTwoSided: null,
      rankBiserialPrimaryVsSecondary,
      resolvedPMethod: null,
      continuityCorrectionApplied: false,
      tieGroupCount: ranked.tieGroupCount,
      tiedObservationCount: ranked.tiedObservationCount,
      tieCorrectionSum: ranked.tieCorrectionSum,
      exactTail: null,
      warnings: mannWhitneyWarnings(nPrimary, nSecondary, false, ranked.tieGroupCount > 0),
    });
  }
  const expectedU = nPrimary * nSecondary / 2;
  const correction = Math.sign(uPrimary - expectedU) * RANK_INFERENCE_CONTRACT_V2.continuityCorrection;
  const z = (uPrimary - expectedU - correction) / Math.sqrt(variance);
  const useExact = total <= RANK_INFERENCE_CONTRACT_V2.exactMaxRankedN;
  let pValueTwoSided: number;
  let resolvedPMethod: RankPMethodV2;
  let exactTail: ExactTailAuditV2 | null = null;
  if (useExact) {
    const choosePrimary = nPrimary <= nSecondary;
    const observedRankSum = choosePrimary
      ? ranked.doubledRanks.slice(0, nPrimary).reduce((sum, rank) => sum + rank, 0)
      : ranked.doubledRanks.slice(nPrimary).reduce((sum, rank) => sum + rank, 0);
    const exact = exactFixedSizeRankTail(ranked.doubledRanks, Math.min(nPrimary, nSecondary), observedRankSum);
    pValueTwoSided = exact.pValue;
    exactTail = {
      extremeAssignmentCount: exact.extremeAssignmentCount,
      totalAssignmentCount: exact.totalAssignmentCount,
      inclusive: true,
      midP: false,
    };
    resolvedPMethod = ranked.tieGroupCount === 0 ? "exact-classic" : "exact-conditional-rank-permutation";
  } else {
    pValueTwoSided = regularizedGammaQ(0.5, z * z / 2);
    resolvedPMethod = "normal-approximation-tie-corrected";
  }
  return deepFreeze({
    schemaVersion: "3dena.stats.mann-whitney.v2",
    status: "available",
    reason: null,
    nPrimary,
    nSecondary,
    medianPrimary,
    medianSecondary,
    uPrimary,
    uSecondary,
    z,
    pValueTwoSided,
    rankBiserialPrimaryVsSecondary,
    resolvedPMethod,
    continuityCorrectionApplied: !useExact,
    tieGroupCount: ranked.tieGroupCount,
    tiedObservationCount: ranked.tiedObservationCount,
    tieCorrectionSum: ranked.tieCorrectionSum,
    exactTail,
    warnings: mannWhitneyWarnings(nPrimary, nSecondary, useExact, ranked.tieGroupCount > 0),
  });
}

function exactSignFlipTail(
  doubledRanks: readonly number[],
  observedPositiveDoubledRankSum: number,
): ExactTailAuditV2 & { pValue: number } {
  const distribution = new Map<number, bigint>([[0, 1n]]);
  for (const rank of doubledRanks) {
    for (const [score, count] of [...distribution.entries()]) {
      const next = score + rank;
      distribution.set(next, (distribution.get(next) ?? 0n) + count);
    }
  }
  const totalRank = doubledRanks.reduce((sum, rank) => sum + rank, 0);
  const observedDistance = Math.abs(2 * observedPositiveDoubledRankSum - totalRank);
  let total = 0n;
  let extreme = 0n;
  for (const [score, count] of distribution) {
    total += count;
    if (Math.abs(2 * score - totalRank) >= observedDistance) extreme += count;
  }
  return {
    extremeAssignmentCount: extreme.toString(),
    totalAssignmentCount: total.toString(),
    inclusive: true,
    midP: false,
    pValue: probabilityFromCounts(extreme, total),
  };
}

function minimumAttainableTwoSidedP(nNonzero: number): MinimumAttainableTwoSidedPV2 | null {
  if (nNonzero === 0) return null;
  return {
    formula: "2^(1-nNonzero)",
    log2: 1 - nNonzero,
    numeric: nNonzero <= 1075 ? 2 ** (1 - nNonzero) : null,
  };
}

function wilcoxonWarnings(
  nNonzero: number,
  exact: boolean,
  ties: boolean,
  zeros: boolean,
  missing: boolean,
  available: boolean,
): RankWarningCodeV2[] {
  const warnings: RankWarningCodeV2[] = [];
  if (nNonzero < 10) warnings.push("small-sample");
  if (available && exact) warnings.push("discrete-attainable-p");
  if (ties) warnings.push("ties-present");
  if (zeros) warnings.push("zero-differences-present");
  if (missing) warnings.push("missing-pairs");
  if (available) warnings.push("signed-rank-symmetry-assumption");
  return warnings;
}

export function wilcoxonSignedRankTestV2(
  rawDifferencesLaterMinusEarlier: readonly number[],
  options: { missingPairs?: number } = {},
): WilcoxonSignedRankResultV2 {
  const nMissing = options.missingPairs ?? 0;
  if (!Number.isSafeInteger(nMissing) || nMissing < 0) {
    reject("INVALID_MISSING_PAIR_COUNT", "options.missingPairs", "must be a non-negative safe integer");
  }
  const differences = rawDifferencesLaterMinusEarlier
    .map((value, index) => normalizeRankValue(value, `differences[${index}]`));
  const nMatched = differences.length;
  const nPositive = differences.filter((difference) => difference > 0).length;
  const nNegative = differences.filter((difference) => difference < 0).length;
  const nZero = nMatched - nPositive - nNegative;
  const nonzero = differences.filter((difference) => difference !== 0);
  const nNonzero = nonzero.length;
  const summary = summarizeType7(differences, "differences");
  if (nNonzero === 0) {
    return deepFreeze({
      schemaVersion: "3dena.stats.wilcoxon-signed-rank.v2",
      status: "not-estimable",
      reason: nMatched === 0 ? "insufficient-ranked-observations" : "all-zero-differences",
      nMatched,
      nMissing,
      nPositive,
      nNegative,
      nZero,
      nNonzero,
      nRanked: 0,
      medianDifference: summary.median,
      q1Difference: summary.q1,
      q3Difference: summary.q3,
      iqrDifference: summary.iqr,
      wPositive: null,
      wNegative: null,
      t: null,
      z: null,
      pValueTwoSided: null,
      rankBiserialLaterVsEarlier: null,
      resolvedPMethod: null,
      continuityCorrectionApplied: false,
      tieGroupCount: 0,
      tiedObservationCount: 0,
      tieCorrectionSum: 0,
      exactTail: null,
      minimumAttainableTwoSidedP: null,
      warnings: wilcoxonWarnings(0, false, false, nZero > 0, nMissing > 0, false),
    });
  }
  const ranked = averageRanks(nonzero.map(Math.abs), "absoluteDifferences");
  let wPositive = 0;
  let wNegative = 0;
  for (let index = 0; index < nonzero.length; index += 1) {
    if (nonzero[index]! > 0) wPositive += ranked.ranks[index]!;
    else wNegative += ranked.ranks[index]!;
  }
  const totalRank = wPositive + wNegative;
  const expected = totalRank / 2;
  const variance = ranked.ranks.reduce((sum, rank) => sum + rank * rank, 0) / 4;
  const correction = Math.sign(wPositive - expected) * RANK_INFERENCE_CONTRACT_V2.continuityCorrection;
  const z = (wPositive - expected - correction) / Math.sqrt(variance);
  const useExact = nNonzero <= RANK_INFERENCE_CONTRACT_V2.exactMaxRankedN;
  let pValueTwoSided: number;
  let resolvedPMethod: RankPMethodV2;
  let exactTail: ExactTailAuditV2 | null = null;
  if (useExact) {
    const exact = exactSignFlipTail(ranked.doubledRanks, Math.round(wPositive * 2));
    pValueTwoSided = exact.pValue;
    exactTail = {
      extremeAssignmentCount: exact.extremeAssignmentCount,
      totalAssignmentCount: exact.totalAssignmentCount,
      inclusive: true,
      midP: false,
    };
    resolvedPMethod = ranked.tieGroupCount === 0 && nZero === 0
      ? "exact-classic"
      : "exact-conditional-sign-flip";
  } else {
    pValueTwoSided = regularizedGammaQ(0.5, z * z / 2);
    resolvedPMethod = "normal-approximation-actual-ranks";
  }
  return deepFreeze({
    schemaVersion: "3dena.stats.wilcoxon-signed-rank.v2",
    status: "available",
    reason: null,
    nMatched,
    nMissing,
    nPositive,
    nNegative,
    nZero,
    nNonzero,
    nRanked: nNonzero,
    medianDifference: summary.median,
    q1Difference: summary.q1,
    q3Difference: summary.q3,
    iqrDifference: summary.iqr,
    wPositive,
    wNegative,
    t: Math.min(wPositive, wNegative),
    z,
    pValueTwoSided,
    rankBiserialLaterVsEarlier: (wPositive - wNegative) / totalRank,
    resolvedPMethod,
    continuityCorrectionApplied: !useExact,
    tieGroupCount: ranked.tieGroupCount,
    tiedObservationCount: ranked.tiedObservationCount,
    tieCorrectionSum: ranked.tieCorrectionSum,
    exactTail,
    minimumAttainableTwoSidedP: minimumAttainableTwoSidedP(nNonzero),
    warnings: wilcoxonWarnings(nNonzero, useExact, ranked.tieGroupCount > 0, nZero > 0, nMissing > 0, true),
  });
}

function factorial(value: number): bigint {
  let output = 1n;
  for (let factor = 2; factor <= value; factor += 1) output *= BigInt(factor);
  return output;
}

function cappedAssignmentCount(base: bigint, exponent: number, limit: bigint): bigint {
  let output = 1n;
  for (let index = 0; index < exponent; index += 1) {
    output *= base;
    if (output > limit) return limit + 1n;
  }
  return output;
}

function weightedRankPermutations(doubledRanks: readonly number[]) {
  const counts = new Map<number, number>();
  for (const rank of doubledRanks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const distinct = [...counts.keys()].sort((left, right) => left - right);
  const multiplicity = [...counts.values()].reduce((product, count) => product * factorial(count), 1n);
  const output: Array<{ scores: number[]; multiplicity: bigint }> = [];
  const current = Array<number>(doubledRanks.length);
  const visit = (position: number): void => {
    if (position === current.length) {
      output.push({ scores: [...current], multiplicity });
      return;
    }
    for (const rank of distinct) {
      const remaining = counts.get(rank) ?? 0;
      if (remaining === 0) continue;
      counts.set(rank, remaining - 1);
      current[position] = rank;
      visit(position + 1);
      counts.set(rank, remaining);
    }
  };
  visit(0);
  return output;
}

function friedmanScore(rankSums: readonly number[], nComplete: number, nPeriods: number): number {
  const center = nComplete * (nPeriods + 1);
  return rankSums.reduce((sum, rankSum) => sum + (rankSum - center) ** 2, 0);
}

function exactFriedmanTail(
  ranksByBlock: readonly (readonly number[])[],
  observedRankSums: readonly number[],
): ExactTailAuditV2 & { pValue: number } {
  const nPeriods = observedRankSums.length;
  let states = new Map<string, { sums: number[]; count: bigint }>([[
    Array(nPeriods).fill(0).join(","),
    { sums: Array<number>(nPeriods).fill(0), count: 1n },
  ]]);
  for (const blockRanks of ranksByBlock) {
    const permutations = weightedRankPermutations(blockRanks);
    const next = new Map<string, { sums: number[]; count: bigint }>();
    for (const state of states.values()) {
      for (const permutation of permutations) {
        const sums = state.sums.map((sum, index) => sum + permutation.scores[index]!);
        const key = sums.join(",");
        const count = state.count * permutation.multiplicity;
        const existing = next.get(key);
        if (existing) existing.count += count;
        else next.set(key, { sums, count });
      }
    }
    states = next;
  }
  const observedScore = friedmanScore(observedRankSums, ranksByBlock.length, nPeriods);
  let total = 0n;
  let extreme = 0n;
  for (const state of states.values()) {
    total += state.count;
    if (friedmanScore(state.sums, ranksByBlock.length, nPeriods) >= observedScore) extreme += state.count;
  }
  return {
    extremeAssignmentCount: extreme.toString(),
    totalAssignmentCount: total.toString(),
    inclusive: true,
    midP: false,
    pValue: probabilityFromCounts(extreme, total),
  };
}

function friedmanWarnings(
  nComplete: number,
  exact: boolean,
  ties: boolean,
  missing: boolean,
  available: boolean,
): RankWarningCodeV2[] {
  const warnings: RankWarningCodeV2[] = [];
  if (nComplete < 10) warnings.push("small-sample");
  if (available && exact) warnings.push("discrete-attainable-p");
  if (ties) warnings.push("ties-present");
  if (missing) warnings.push("missing-complete-blocks");
  return warnings;
}

export function friedmanRankTestV2(
  completeBlocksByPeriod: readonly (readonly number[])[],
  options: { missingCompleteBlocks?: number; periodCountWhenEmpty?: number } = {},
): FriedmanRankResultV2 {
  const nComplete = completeBlocksByPeriod.length;
  const nMissingCompleteBlocks = options.missingCompleteBlocks ?? 0;
  if (!Number.isSafeInteger(nMissingCompleteBlocks) || nMissingCompleteBlocks < 0) {
    reject("INVALID_MISSING_BLOCK_COUNT", "options.missingCompleteBlocks", "must be a non-negative safe integer");
  }
  const periodCountWhenEmpty = options.periodCountWhenEmpty ?? 0;
  if (!Number.isSafeInteger(periodCountWhenEmpty) || periodCountWhenEmpty < 0) {
    reject("INVALID_PERIOD_COUNT", "options.periodCountWhenEmpty", "must be a non-negative safe integer");
  }
  const nPeriods = nComplete > 0 ? completeBlocksByPeriod[0]!.length : periodCountWhenEmpty;
  const unavailable = (
    reason: FriedmanRankResultV2["reason"],
    degreesFreedom: number | null,
    tieAudit = { tieGroupCount: 0, tiedObservationCount: 0, tieCorrectionSum: 0 },
  ): FriedmanRankResultV2 => deepFreeze({
    schemaVersion: "3dena.stats.friedman.v2",
    status: "not-estimable",
    reason,
    nComplete,
    nMissingCompleteBlocks,
    nPeriods,
    q: null,
    degreesFreedom,
    kendallsW: null,
    pValueUpperTail: null,
    resolvedPMethod: null,
    ...tieAudit,
    exactTail: null,
    warnings: friedmanWarnings(nComplete, false, tieAudit.tieGroupCount > 0, nMissingCompleteBlocks > 0, false),
  });
  if (nComplete === 0) return unavailable("no-complete-blocks", nPeriods >= 1 ? nPeriods - 1 : null);
  if (nPeriods < 3) return unavailable("insufficient-ranked-observations", nPeriods >= 1 ? nPeriods - 1 : null);
  if (completeBlocksByPeriod.some((block) => block.length !== nPeriods)) {
    reject("ENTITY_PERIOD_INSTABILITY", "completeBlocksByPeriod", "every complete block must have the same period count");
  }
  const ranksByBlock: number[][] = [];
  const observedRankSums = Array<number>(nPeriods).fill(0);
  let tieGroupCount = 0;
  let tiedObservationCount = 0;
  let tieCorrectionSum = 0;
  for (const [blockIndex, block] of completeBlocksByPeriod.entries()) {
    const ranked = averageRanks(block, `completeBlocksByPeriod[${blockIndex}]`);
    ranksByBlock.push(ranked.doubledRanks);
    for (let period = 0; period < nPeriods; period += 1) {
      observedRankSums[period] = observedRankSums[period]! + ranked.doubledRanks[period]!;
    }
    tieGroupCount += ranked.tieGroupCount;
    tiedObservationCount += ranked.tiedObservationCount;
    tieCorrectionSum += ranked.tieCorrectionSum;
  }
  const tieAudit = { tieGroupCount, tiedObservationCount, tieCorrectionSum };
  const denominator = nComplete * nPeriods * (nPeriods + 1) - tieCorrectionSum / (nPeriods - 1);
  if (!(denominator > 0) || !Number.isFinite(denominator)) {
    return unavailable("all-values-tied", nPeriods - 1, tieAudit);
  }
  const score = friedmanScore(observedRankSums, nComplete, nPeriods);
  const q = 3 * score / denominator;
  const degreesFreedom = nPeriods - 1;
  const kendallsW = Math.max(0, Math.min(1, q / (nComplete * degreesFreedom)));
  const limit = BigInt(RANK_INFERENCE_CONTRACT_V2.friedmanExactAssignmentLimit);
  const useExact = cappedAssignmentCount(factorial(nPeriods), nComplete, limit) <= limit;
  let pValueUpperTail: number;
  let resolvedPMethod: RankPMethodV2;
  let exactTail: ExactTailAuditV2 | null = null;
  if (useExact) {
    const exact = exactFriedmanTail(ranksByBlock, observedRankSums);
    pValueUpperTail = exact.pValue;
    exactTail = {
      extremeAssignmentCount: exact.extremeAssignmentCount,
      totalAssignmentCount: exact.totalAssignmentCount,
      inclusive: true,
      midP: false,
    };
    resolvedPMethod = "exact-conditional-period-permutation";
  } else {
    pValueUpperTail = regularizedGammaQ(degreesFreedom / 2, q / 2);
    resolvedPMethod = "chi-square-approximation-tie-corrected";
  }
  return deepFreeze({
    schemaVersion: "3dena.stats.friedman.v2",
    status: "available",
    reason: null,
    nComplete,
    nMissingCompleteBlocks,
    nPeriods,
    q,
    degreesFreedom,
    kendallsW,
    pValueUpperTail,
    resolvedPMethod,
    ...tieAudit,
    exactTail,
    warnings: friedmanWarnings(nComplete, useExact, tieGroupCount > 0, nMissingCompleteBlocks > 0, true),
  });
}

export function holmAdjustFamilyV2(members: readonly PlannedHolmMemberV2[]): PlannedHolmResultV2[] {
  const identifiers = new Set<string>();
  for (const [index, member] of members.entries()) {
    if (!member.memberId || identifiers.has(member.memberId)) {
      reject("INVALID_HOLM_MEMBER_ID", `members[${index}].memberId`, "must be non-empty and unique");
    }
    identifiers.add(member.memberId);
    if (member.pRaw !== null && (!Number.isFinite(member.pRaw) || member.pRaw < 0 || member.pRaw > 1)) {
      reject("INVALID_HOLM_P_VALUE", `members[${index}].pRaw`, "must be null or finite in [0, 1]");
    }
  }
  const familySizePlanned = members.length;
  const ordered = members.map((member, originalIndex) => ({
    ...member,
    originalIndex,
    effectiveP: member.pRaw ?? 1,
  })).sort((left, right) => left.effectiveP - right.effectiveP || left.memberId.localeCompare(right.memberId));
  const byOriginal = Array<PlannedHolmResultV2>(familySizePlanned);
  let runningMaximum = 0;
  for (const [index, member] of ordered.entries()) {
    const multiplier = familySizePlanned - index;
    runningMaximum = Math.min(1, Math.max(runningMaximum, multiplier * member.effectiveP));
    byOriginal[member.originalIndex] = {
      memberId: member.memberId,
      pRaw: member.pRaw,
      pHolm: member.pRaw === null ? null : runningMaximum,
      familySizePlanned,
      holmRank: member.pRaw === null ? null : index + 1,
      holmMultiplier: member.pRaw === null ? null : multiplier,
    };
  }
  return deepFreeze(byOriginal);
}
