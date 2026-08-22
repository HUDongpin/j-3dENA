import { adjustPValues } from "./adjust";
import {
  commonScale,
  continuityCorrectedZ,
  describe,
  normalCdf,
  pValueFromCdf,
  rankValues,
  representableScaled,
  studentTQuantile,
} from "./numerics";
import {
  STATS_V1_CONTRACT,
  deepFreeze,
  reject,
  type PairedObservation,
  type PairedSample,
  type PairedStatisticsInput,
  type PairedStatisticsResult,
  type MeanDifferenceConfidenceIntervalV1,
  type StatisticalAlternative,
  type StatisticalIdentity,
  type StatisticalKey,
  type StatsDiagnostic,
  type WilcoxonSignedRankResult,
} from "./types";

const MAX_OBSERVATIONS_PER_SIDE = 1_000_000;
const CONFIDENCE_LEVEL = 0.95 as const;

interface ValidatedObservation {
  key: StatisticalKey;
  value: number | null;
}

function validateAlternative(value: unknown): asserts value is StatisticalAlternative {
  if (value !== "two-sided" && value !== "greater" && value !== "less") {
    reject("INVALID_ALTERNATIVE", "input.alternative", "must be two-sided, greater, or less");
  }
}

function identityKey(identity: StatisticalIdentity, path: string): StatisticalKey {
  if (!identity || !Array.isArray(identity.components) || identity.components.length === 0) {
    reject("INVALID_IDENTITY", path, "must contain at least one typed component");
  }
  const names = new Set<string>();
  const normalized = identity.components.map((component, index) => {
    const componentPath = `${path}.components[${index}]`;
    if (!component || typeof component.name !== "string" || component.name.trim() === "") {
      reject("INVALID_IDENTITY_COMPONENT", `${componentPath}.name`, "must be a non-blank string");
    }
    if (names.has(component.name)) {
      reject("DUPLICATE_IDENTITY_COMPONENT", componentPath, "component names must be unique within an identity");
    }
    names.add(component.name);
    if (component.type === "string" && typeof component.value === "string") {
      return [component.name, "string", component.value] as const;
    }
    if (component.type === "boolean" && typeof component.value === "boolean") {
      return [component.name, "boolean", component.value] as const;
    }
    if (component.type === "number" && typeof component.value === "number") {
      if (!Number.isFinite(component.value)) {
        reject("NON_FINITE_IDENTITY_NUMBER", `${componentPath}.value`, "must be finite");
      }
      if (Number.isInteger(component.value) && !Number.isSafeInteger(component.value)) {
        reject("UNSAFE_IDENTITY_NUMBER", `${componentPath}.value`, "unsafe integer IDs must be supplied as strings");
      }
      return [component.name, "number", Object.is(component.value, -0) ? 0 : component.value] as const;
    }
    reject("IDENTITY_TYPE_MISMATCH", componentPath, "declared identity type must match its value");
  });
  return {
    components: identity.components.map((component) => ({ ...component })),
    canonical: JSON.stringify(normalized),
    display: identity.components.map((component) => String(component.value)).join(" · "),
  };
}

function validateSample(sample: PairedSample, path: string): Map<string, ValidatedObservation> {
  if (!sample || typeof sample.label !== "string" || sample.label.trim() === "") {
    reject("INVALID_SAMPLE_LABEL", `${path}.label`, "must be a non-blank string");
  }
  if (!Array.isArray(sample.observations)) {
    reject("INVALID_SAMPLE", `${path}.observations`, "must be an array");
  }
  if (sample.observations.length > MAX_OBSERVATIONS_PER_SIDE) {
    reject("SAMPLE_LIMIT", `${path}.observations`, `must not exceed ${MAX_OBSERVATIONS_PER_SIDE} observations`);
  }
  const output = new Map<string, ValidatedObservation>();
  Array.from(sample.observations).forEach((observation: PairedObservation | undefined, index) => {
    const observationPath = `${path}.observations[${index}]`;
    if (!observation || typeof observation !== "object") {
      reject("INVALID_OBSERVATION", observationPath, "must be an observation object");
    }
    const key = identityKey(observation.id, `${observationPath}.id`);
    if (output.has(key.canonical)) {
      reject("DUPLICATE_PAIRED_ID", `${observationPath}.id`, "each typed identity may occur only once per side");
    }
    if (observation.value !== null && (
      typeof observation.value !== "number" || !Number.isFinite(observation.value)
    )) {
      reject("NON_FINITE_VALUE", `${observationPath}.value`, "must be a finite number or explicit null");
    }
    output.set(key.canonical, { key, value: observation.value });
  });
  return output;
}

function signedRank(
  differences: readonly number[],
  alternative: StatisticalAlternative,
  diagnostics: StatsDiagnostic[],
): { result: WilcoxonSignedRankResult; rankBiserial: number; zeroCount: number } {
  const nonZero = differences.filter((difference) => difference !== 0);
  const zeroCount = differences.length - nonZero.length;
  if (zeroCount > 0) {
    diagnostics.push({
      code: "ZERO_DIFFERENCES_DROPPED",
      severity: "info",
      message: "Exact zero paired differences were excluded before signed-rank ranking.",
    });
  }
  if (nonZero.length === 0) {
    diagnostics.push({
      code: "ALL_ZERO_DIFFERENCES",
      severity: "warning",
      message: "Every valid paired difference is zero; W+, W-, and rank-biserial are zero and p is reported as 1.",
    });
    return {
      result: {
        method: "wilcoxon-signed-rank-asymptotic-v1",
        alternative,
        tiePolicy: "exact-absolute-difference-midrank",
        zeroPolicy: "drop-exact-zero",
        continuityCorrection: true,
        statistic: 0,
        wPositive: 0,
        wNegative: 0,
        z: 0,
        pValue: 1,
        tieGroups: 0,
        tiedObservations: 0,
      },
      rankBiserial: 0,
      zeroCount,
    };
  }
  const { ranks, tieSizes } = rankValues(nonZero.map(Math.abs));
  let wPositive = 0;
  let wNegative = 0;
  nonZero.forEach((difference, index) => {
    if (difference > 0) wPositive += ranks[index]!;
    else wNegative += ranks[index]!;
  });
  const count = nonZero.length;
  const mean = (count * (count + 1)) / 4;
  const tieCorrection = tieSizes.reduce((sum, size) => sum + size ** 3 - size, 0);
  const variance = (
    count * (count + 1) * (2 * count + 1) - tieCorrection / 2
  ) / 24;
  let z = 0;
  let pValue = 1;
  if (variance > 0) {
    z = continuityCorrectedZ(wPositive - mean, Math.sqrt(variance), alternative);
    pValue = pValueFromCdf(normalCdf(z), alternative);
  }
  if (tieSizes.length > 0) {
    diagnostics.push({
      code: "ABSOLUTE_DIFFERENCE_TIES",
      severity: "info",
      message: "Equal absolute paired differences received midranks and the asymptotic variance was tie-corrected.",
    });
  }
  return {
    result: {
      method: "wilcoxon-signed-rank-asymptotic-v1",
      alternative,
      tiePolicy: "exact-absolute-difference-midrank",
      zeroPolicy: "drop-exact-zero",
      continuityCorrection: true,
      statistic: wPositive,
      wPositive,
      wNegative,
      z,
      pValue,
      tieGroups: tieSizes.length,
      tiedObservations: tieSizes.reduce((sum, size) => sum + size, 0),
    },
    rankBiserial: (wPositive - wNegative) / (wPositive + wNegative),
    zeroCount,
  };
}

export function analyzePairedSamples(input: PairedStatisticsInput): PairedStatisticsResult {
  if (!input || input.schemaVersion !== "3dena.stats.paired-input.v1") {
    reject("INVALID_SCHEMA_VERSION", "input.schemaVersion", "must be 3dena.stats.paired-input.v1");
  }
  validateAlternative(input.alternative);
  const sideA = validateSample(input.sideA, "input.sideA");
  const sideB = validateSample(input.sideB, "input.sideB");
  const matched = [...sideA.keys()].filter((key) => sideB.has(key));
  const unmatchedA = sideA.size - matched.length;
  const unmatchedB = sideB.size - matched.length;
  const validPairs = matched
    .map((key) => [sideA.get(key)!, sideB.get(key)!] as const)
    .filter(([left, right]) => left.value !== null && right.value !== null) as Array<
      readonly [ValidatedObservation & { value: number }, ValidatedObservation & { value: number }]
    >;
  const droppedMissingPairs = matched.length - validPairs.length;
  if (validPairs.length < 2) {
    reject("INSUFFICIENT_PAIRS", "input", "requires at least two exact matched pairs with finite values");
  }
  const diagnostics: StatsDiagnostic[] = [];
  if (unmatchedA + unmatchedB > 0) {
    diagnostics.push({
      code: "UNMATCHED_OBSERVATIONS_DROPPED",
      severity: "info",
      message: "Typed identities present on only one side were excluded from the paired estimand.",
    });
  }
  if (droppedMissingPairs > 0) {
    diagnostics.push({
      code: "MISSING_PAIRS_DROPPED",
      severity: "info",
      message: "Matched pairs containing an explicit null on either side were excluded.",
    });
  }
  const valuesA = validPairs.map(([left]) => left.value);
  const valuesB = validPairs.map(([, right]) => right.value);
  const scale = commonScale(valuesA, valuesB);
  const scaledDifferences = validPairs.map(([left, right]) =>
    left.value / scale - right.value / scale
  );
  const rawDifferences = validPairs.map(([left, right]) => left.value - right.value);
  const rawDifferencesAreFinite = rawDifferences.every(Number.isFinite);
  const differences = rawDifferencesAreFinite ? rawDifferences : scaledDifferences;
  const outerDifferenceScale = rawDifferencesAreFinite ? 1 : scale;
  const described = describe(differences);
  const meanDifference = representableScaled(described.mean, outerDifferenceScale);
  if (meanDifference === null) {
    diagnostics.push({
      code: "UNREPRESENTABLE_MEAN_DIFFERENCE",
      severity: "warning",
      message: "The finite-input paired mean difference exceeds the representable JavaScript range; scale-free inference remains available.",
    });
  }
  const cohensD = described.standardDeviationUnit === 0
    ? null
    : described.meanUnit / described.standardDeviationUnit;
  if (cohensD === null) {
    diagnostics.push({
      code: "ZERO_PAIRED_DIFFERENCE_VARIANCE",
      severity: "warning",
      message: "Paired Cohen's d is undefined because paired differences have zero sample variance.",
    });
  }
  const probability = input.alternative === "two-sided"
    ? 1 - (1 - CONFIDENCE_LEVEL) / 2
    : CONFIDENCE_LEVEL;
  const critical = studentTQuantile(probability, validPairs.length - 1);
  const standardErrorUnit = described.standardDeviationUnit / Math.sqrt(validPairs.length);
  const finiteBound = (valueUnit: number, side: "lower" | "upper") => {
    const inDifferenceUnits = representableScaled(valueUnit, described.scale);
    const value = inDifferenceUnits === null
      ? null
      : representableScaled(inDifferenceUnits, outerDifferenceScale);
    if (value !== null) return { kind: "finite" as const, value };
    diagnostics.push({
      code: "UNREPRESENTABLE_CONFIDENCE_BOUND",
      severity: "warning",
      message: `The ${side} paired confidence bound exceeds the representable JavaScript range.`,
    });
    return { kind: "unrepresentable" as const };
  };
  const lowerUnit = input.alternative === "less"
    ? null
    : described.meanUnit - critical * standardErrorUnit;
  const upperUnit = input.alternative === "greater"
    ? null
    : described.meanUnit + critical * standardErrorUnit;
  const confidenceInterval: MeanDifferenceConfidenceIntervalV1 = {
    method: "paired-t-mean-difference-v1",
    confidenceLevel: CONFIDENCE_LEVEL,
    alternative: input.alternative,
    lower: lowerUnit === null ? { kind: "negative-infinity" } : finiteBound(lowerUnit, "lower"),
    upper: upperUnit === null ? { kind: "positive-infinity" } : finiteBound(upperUnit, "upper"),
  };
  const signed = signedRank(differences, input.alternative, diagnostics);
  const raw = [signed.result.pValue];
  const adjusted = adjustPValues(raw, input.adjustment);
  return deepFreeze({
    schemaVersion: "3dena.stats.paired-result.v1",
    design: "paired",
    direction: "A-minus-B",
    contract: STATS_V1_CONTRACT,
    alternative: input.alternative,
    matching: {
      sideAInput: input.sideA.observations.length,
      sideBInput: input.sideB.observations.length,
      matched: matched.length,
      validPairs: validPairs.length,
      droppedMissingPairs,
      unmatchedA,
      unmatchedB,
      zeroDifferences: signed.zeroCount,
      rankedPairs: validPairs.length - signed.zeroCount,
    },
    estimates: { meanDifference, confidenceInterval },
    wilcoxonSignedRank: signed.result,
    effects: {
      cohensD,
      rankBiserial: signed.rankBiserial,
    },
    adjustment: { method: input.adjustment, raw, adjusted },
    diagnostics,
  });
}
