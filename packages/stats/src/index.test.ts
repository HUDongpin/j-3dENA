import { describe, expect, it } from "vitest";

import {
  STATS_V1_CONTRACT,
  StatsInputError,
  adjustPValues,
  analyzeIndependentSamples,
  analyzePairedSamples,
  type IndependentStatisticsInput,
  type PairedObservation,
  type PairedStatisticsInput,
  type StatisticalIdentity,
} from "./index";

function identity(value: string | number | boolean): StatisticalIdentity {
  const type = typeof value;
  if (type !== "string" && type !== "number" && type !== "boolean") {
    throw new TypeError("Unsupported test identity.");
  }
  return {
    components: [{ name: "ParticipantId", type, value }],
  } as StatisticalIdentity;
}

function observation(
  id: string | number | boolean,
  value: number | null,
): PairedObservation {
  return { id: identity(id), value };
}

function independent(
  overrides: Partial<IndependentStatisticsInput> = {},
): IndependentStatisticsInput {
  return {
    schemaVersion: "3dena.stats.independent-input.v1",
    sideA: { label: "A", values: [1, 2, 3, 4, null] },
    sideB: { label: "B", values: [5, 6, 7, 8, null] },
    alternative: "two-sided",
    adjustment: "holm",
    ...overrides,
  };
}

function paired(
  overrides: Partial<PairedStatisticsInput> = {},
): PairedStatisticsInput {
  return {
    schemaVersion: "3dena.stats.paired-input.v1",
    sideA: {
      label: "A",
      observations: [
        observation("9007199254740992", 3),
        observation("9007199254740993", 5),
        observation("missing", null),
        observation("only-a", 9),
      ],
    },
    sideB: {
      label: "B",
      observations: [
        observation("9007199254740992", 1),
        observation("9007199254740993", 2),
        observation("missing", 4),
        observation("only-b", 8),
      ],
    },
    alternative: "two-sided",
    adjustment: "none",
    ...overrides,
  };
}

describe("versioned statistics contract", () => {
  it("freezes the v1 direction, missing, tie, zero, rank, and continuity rules", () => {
    expect(STATS_V1_CONTRACT).toEqual({
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
    });
    expect(Object.isFrozen(STATS_V1_CONTRACT)).toBe(true);
  });
});

describe("independent samples", () => {
  it("computes Welch, rank-sum, Cohen's d, rank-biserial, and missing diagnostics", () => {
    const result = analyzeIndependentSamples(independent());

    expect(result.schemaVersion).toBe("3dena.stats.independent-result.v1");
    expect(result.direction).toBe("A-minus-B");
    expect(result.samples).toEqual({
      sideA: { label: "A", input: 5, valid: 4, droppedMissing: 1 },
      sideB: { label: "B", input: 5, valid: 4, droppedMissing: 1 },
    });
    expect(result.welch.statistic).toBeCloseTo(-4.381780460, 9);
    expect(result.welch.degreesOfFreedom).toBeCloseTo(6, 12);
    expect(result.welch.pValue).toBeCloseTo(0.004659215, 6);
    expect(result.mannWhitney.uA).toBe(0);
    expect(result.mannWhitney.uB).toBe(16);
    expect(result.mannWhitney.pValue).toBeCloseTo(0.030382822, 6);
    expect(result.effects.cohensD).toBeCloseTo(-3.098386677, 9);
    expect(result.effects.rankBiserial).toBe(-1);
    expect(result.estimates.confidenceInterval).toMatchObject({
      method: "welch-t-mean-difference-v1",
      confidenceLevel: 0.95,
      alternative: "two-sided",
      lower: { kind: "finite" },
      upper: { kind: "finite" },
    });
    if (result.estimates.confidenceInterval.lower.kind !== "finite" || result.estimates.confidenceInterval.upper.kind !== "finite") {
      throw new Error("Expected finite Welch bounds in the fixture.");
    }
    expect(result.estimates.confidenceInterval.lower.value).toBeCloseTo(-6.233714696, 8);
    expect(result.estimates.confidenceInterval.upper.value).toBeCloseTo(-1.766285304, 8);
    expect(result.adjustment.method).toBe("holm");
    expect(result.adjustment.raw).toEqual([
      result.welch.pValue,
      result.mannWhitney.pValue,
    ]);
    expect(result.adjustment.adjusted[0]).toBeCloseTo(
      result.welch.pValue * 2,
      12,
    );
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      "MISSING_VALUES_DROPPED",
    );
    expect(structuredClone(result)).toEqual(result);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("uses exact-value midranks and orients alternatives to A-minus-B", () => {
    const base = independent({
      sideA: { label: "A", values: [1, 2, 2] },
      sideB: { label: "B", values: [2, 3, 3] },
      adjustment: "none",
    });
    const twoSided = analyzeIndependentSamples(base);
    const greater = analyzeIndependentSamples({ ...base, alternative: "greater" });
    const less = analyzeIndependentSamples({ ...base, alternative: "less" });

    expect(twoSided.mannWhitney.uA).toBe(1);
    expect(twoSided.mannWhitney.tieGroups).toBe(2);
    expect(twoSided.mannWhitney.tiedObservations).toBe(5);
    expect(twoSided.effects.rankBiserial).toBeCloseTo(-7 / 9, 12);
    expect(greater.mannWhitney.pValue).toBeGreaterThan(0.5);
    expect(less.mannWhitney.pValue).toBeLessThan(0.5);
    expect(greater.welch.pValue).toBeGreaterThan(0.5);
    expect(less.welch.pValue).toBeLessThan(0.5);
  });

  it("uses the alternative-aligned 95% Welch bound in the A-minus-B direction", () => {
    const greater = analyzeIndependentSamples(independent({
      alternative: "greater",
      adjustment: "none",
    }));
    const less = analyzeIndependentSamples(independent({
      alternative: "less",
      adjustment: "none",
    }));

    expect(greater.estimates.confidenceInterval.upper).toEqual({ kind: "positive-infinity" });
    expect(less.estimates.confidenceInterval.lower).toEqual({ kind: "negative-infinity" });
    if (greater.estimates.confidenceInterval.lower.kind !== "finite"
      || less.estimates.confidenceInterval.upper.kind !== "finite") {
      throw new Error("Expected finite one-sided Welch bounds in the fixture.");
    }
    expect(greater.estimates.confidenceInterval.lower.value).toBeCloseTo(-5.773872788229078, 12);
    expect(less.estimates.confidenceInterval.upper.value).toBeCloseTo(-2.226127211770922, 12);
  });

  it("keeps inferential statistics finite when a finite mean difference cannot be represented", () => {
    const result = analyzeIndependentSamples(
      independent({
        sideA: { label: "A", values: [1e308, 1e308, 9e307] },
        sideB: { label: "B", values: [-1e308, -9e307, -1e308] },
        adjustment: "none",
      }),
    );

    expect(result.estimates.meanDifference).toBeNull();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "UNREPRESENTABLE_MEAN_DIFFERENCE" }),
    );
    expect(result.welch.statistic).not.toBeNull();
    expect(Number.isFinite(result.welch.statistic!)).toBe(true);
    expect(Number.isFinite(result.welch.pValue)).toBe(true);
    expect(Number.isFinite(result.effects.cohensD!)).toBe(true);
  });

  it("preserves the variable group's Welch contribution across a wide finite dynamic range", () => {
    const result = analyzeIndependentSamples(independent({
      sideA: { label: "A", values: [1, 2, 3, 4] },
      sideB: { label: "B", values: [1e308, 1e308, 1e308, 1e308] },
      adjustment: "none",
    }));

    expect(result.welch.degreesOfFreedom).toBeCloseTo(3, 12);
    expect(result.welch.statistic).not.toBeNull();
    expect(Number.isFinite(result.welch.statistic!)).toBe(true);
    expect(result.welch.statistic).toBeLessThan(-1e308);
    expect(result.welch.pValue).toBe(0);
    expect(result.estimates.confidenceInterval).toMatchObject({
      lower: { kind: "finite" },
      upper: { kind: "finite" },
    });
    expect(result.diagnostics.map(({ code }) => code)).not.toEqual(
      expect.arrayContaining(["ZERO_WELCH_STANDARD_ERROR", "ZERO_POOLED_VARIANCE"]),
    );
  });

  it("marks the Welch interval undefined when the estimated standard error has no degrees of freedom", () => {
    const result = analyzeIndependentSamples(independent({
      sideA: { label: "A", values: [4, 4] },
      sideB: { label: "B", values: [1, 1] },
      adjustment: "none",
    }));

    expect(result.welch.degreesOfFreedom).toBeNull();
    expect(result.estimates.confidenceInterval).toMatchObject({
      lower: { kind: "undefined" },
      upper: { kind: "undefined" },
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ZERO_WELCH_STANDARD_ERROR" }),
    );
  });

  it("rejects non-finite observations and insufficient valid samples", () => {
    expect(() =>
      analyzeIndependentSamples(
        independent({ sideA: { label: "A", values: [1, Number.NaN] } }),
      ),
    ).toThrowError(expect.objectContaining({ code: "NON_FINITE_VALUE" }));
    expect(() =>
      analyzeIndependentSamples(
        independent({ sideA: { label: "A", values: [1, null] } }),
      ),
    ).toThrowError(expect.objectContaining({ code: "INSUFFICIENT_SAMPLE" }));
  });
});

describe("paired samples", () => {
  it("matches lossless large string IDs and reports unmatched and missing pairs", () => {
    const result = analyzePairedSamples(paired());

    expect(result.schemaVersion).toBe("3dena.stats.paired-result.v1");
    expect(result.matching).toEqual({
      sideAInput: 4,
      sideBInput: 4,
      matched: 3,
      validPairs: 2,
      droppedMissingPairs: 1,
      unmatchedA: 1,
      unmatchedB: 1,
      zeroDifferences: 0,
      rankedPairs: 2,
    });
    expect(result.wilcoxonSignedRank.wPositive).toBe(3);
    expect(result.wilcoxonSignedRank.wNegative).toBe(0);
    expect(result.effects.rankBiserial).toBe(1);
    expect(result.effects.cohensD).toBeCloseTo(3.535533906, 9);
    expect(result.estimates.confidenceInterval).toMatchObject({
      method: "paired-t-mean-difference-v1",
      confidenceLevel: 0.95,
      alternative: "two-sided",
      lower: { kind: "finite" },
      upper: { kind: "finite" },
    });
    if (result.estimates.confidenceInterval.lower.kind !== "finite" || result.estimates.confidenceInterval.upper.kind !== "finite") {
      throw new Error("Expected finite paired bounds in the fixture.");
    }
    expect(result.estimates.confidenceInterval.lower.value).toBeCloseTo(-3.853102368, 8);
    expect(result.estimates.confidenceInterval.upper.value).toBeCloseTo(8.853102368, 8);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "UNMATCHED_OBSERVATIONS_DROPPED",
        "MISSING_PAIRS_DROPPED",
      ]),
    );
  });

  it("drops exact zero differences, midranks absolute ties, and reports a balanced result", () => {
    const sideA = [0, 2, 0, 4, 0].map((value, index) =>
      observation(`P${index}`, value),
    );
    const sideB = [0, 1, 1, 2, 2].map((value, index) =>
      observation(`P${index}`, value),
    );
    const result = analyzePairedSamples(
      paired({
        sideA: { label: "A", observations: sideA },
        sideB: { label: "B", observations: sideB },
      }),
    );

    expect(result.matching.zeroDifferences).toBe(1);
    expect(result.matching.rankedPairs).toBe(4);
    expect(result.wilcoxonSignedRank.wPositive).toBe(5);
    expect(result.wilcoxonSignedRank.wNegative).toBe(5);
    expect(result.wilcoxonSignedRank.pValue).toBe(1);
    expect(result.effects.rankBiserial).toBe(0);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "ZERO_DIFFERENCES_DROPPED",
        "ABSOLUTE_DIFFERENCE_TIES",
      ]),
    );
  });

  it("orients paired one-sided alternatives to A-minus-B", () => {
    const observationsA = [2, 4, 6, 8].map((value, index) =>
      observation(`P${index}`, value),
    );
    const observationsB = [1, 2, 3, 4].map((value, index) =>
      observation(`P${index}`, value),
    );
    const base = paired({
      sideA: { label: "A", observations: observationsA },
      sideB: { label: "B", observations: observationsB },
    });
    const greater = analyzePairedSamples({ ...base, alternative: "greater" });
    const less = analyzePairedSamples({ ...base, alternative: "less" });

    expect(greater.wilcoxonSignedRank.pValue).toBeLessThan(0.5);
    expect(less.wilcoxonSignedRank.pValue).toBeGreaterThan(0.5);
    expect(greater.effects.rankBiserial).toBe(1);
    expect(greater.estimates.confidenceInterval.upper).toEqual({ kind: "positive-infinity" });
    expect(less.estimates.confidenceInterval.lower).toEqual({ kind: "negative-infinity" });
    if (greater.estimates.confidenceInterval.lower.kind !== "finite"
      || less.estimates.confidenceInterval.upper.kind !== "finite") {
      throw new Error("Expected finite one-sided paired-t bounds in the fixture.");
    }
    expect(greater.estimates.confidenceInterval.lower.value).toBeCloseTo(0.9809104349065082, 12);
    expect(less.estimates.confidenceInterval.upper.value).toBeCloseTo(4.019089565093492, 12);
  });

  it("preserves typed tuple boundaries when identity display strings could collide", () => {
    const tuple = (participant: string, time: string): StatisticalIdentity => ({
      components: [
        { name: "participant", type: "string", value: participant },
        { name: "time", type: "string", value: time },
      ],
    });
    const result = analyzePairedSamples(
      paired({
        sideA: {
          label: "A",
          observations: [
            { id: tuple("a | b", "c"), value: 3 },
            { id: tuple("a", "b | c"), value: 7 },
          ],
        },
        sideB: {
          label: "B",
          observations: [
            { id: tuple("a | b", "c"), value: 1 },
            { id: tuple("a", "b | c"), value: 4 },
          ],
        },
      }),
    );

    expect(result.matching).toMatchObject({
      matched: 2,
      validPairs: 2,
      unmatchedA: 0,
      unmatchedB: 0,
    });
  });

  it("rejects unsafe numeric IDs, duplicate IDs, and non-finite values", () => {
    const unsafe = paired();
    unsafe.sideA.observations[0] = observation(Number.MAX_SAFE_INTEGER + 1, 3);
    expect(() => analyzePairedSamples(unsafe)).toThrowError(
      expect.objectContaining({ code: "UNSAFE_IDENTITY_NUMBER" }),
    );

    const duplicate = paired();
    duplicate.sideA.observations[1] = observation("9007199254740992", 5);
    expect(() => analyzePairedSamples(duplicate)).toThrowError(
      expect.objectContaining({ code: "DUPLICATE_PAIRED_ID" }),
    );

    const nonFinite = paired();
    nonFinite.sideB.observations[0] = observation("9007199254740992", Infinity);
    expect(() => analyzePairedSamples(nonFinite)).toThrowError(
      expect.objectContaining({ code: "NON_FINITE_VALUE" }),
    );
  });

  it("returns an explicit all-zero signed-rank result instead of manufacturing evidence", () => {
    const result = analyzePairedSamples(
      paired({
        sideA: {
          label: "A",
          observations: [observation("P1", 2), observation("P2", 4)],
        },
        sideB: {
          label: "B",
          observations: [observation("P1", 2), observation("P2", 4)],
        },
      }),
    );

    expect(result.wilcoxonSignedRank).toMatchObject({
      wPositive: 0,
      wNegative: 0,
      statistic: 0,
      pValue: 1,
    });
    expect(result.effects).toEqual({ cohensD: null, rankBiserial: 0 });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ALL_ZERO_DIFFERENCES" }),
    );
  });

  it("keeps paired moments finite for extreme but representable differences", () => {
    const result = analyzePairedSamples(
      paired({
        sideA: {
          label: "A",
          observations: [
            observation("P1", 1e308),
            observation("P2", 9e307),
            observation("P3", 8e307),
          ],
        },
        sideB: {
          label: "B",
          observations: [
            observation("P1", 0),
            observation("P2", 0),
            observation("P3", 0),
          ],
        },
      }),
    );

    expect(result.estimates.meanDifference).toBeCloseTo(9e307, 12);
    expect(result.effects.cohensD).toBeCloseTo(9, 12);
    expect(Number.isFinite(result.wilcoxonSignedRank.pValue)).toBe(true);
  });

  it("keeps scale-free paired results when finite inputs imply an unrepresentable mean difference", () => {
    const result = analyzePairedSamples(
      paired({
        sideA: {
          label: "A",
          observations: [
            observation("P1", 1e308),
            observation("P2", 9e307),
            observation("P3", 8e307),
          ],
        },
        sideB: {
          label: "B",
          observations: [
            observation("P1", -1e308),
            observation("P2", -9e307),
            observation("P3", -8e307),
          ],
        },
      }),
    );

    expect(result.estimates.meanDifference).toBeNull();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "UNREPRESENTABLE_MEAN_DIFFERENCE" }),
    );
    expect(result.effects.cohensD).toBeCloseTo(9, 12);
    expect(Number.isFinite(result.wilcoxonSignedRank.pValue)).toBe(true);
  });
});

describe("p-value adjustments", () => {
  it("implements none, Holm, BH/FDR, and Bonferroni without changing input order", () => {
    const pValues = [0.01, 0.04, 0.03];
    expect(adjustPValues(pValues, "none")).toEqual([0.01, 0.04, 0.03]);
    expect(adjustPValues(pValues, "holm")).toEqual([0.03, 0.06, 0.06]);
    expect(adjustPValues(pValues, "bh")).toEqual([0.03, 0.04, 0.04]);
    expect(adjustPValues(pValues, "bonferroni")).toEqual([0.03, 0.12, 0.09]);
    expect(pValues).toEqual([0.01, 0.04, 0.03]);
  });

  it("rejects an invalid p-value family", () => {
    expect(() => adjustPValues([0, 1.01], "holm")).toThrowError(
      StatsInputError,
    );
  });
});
