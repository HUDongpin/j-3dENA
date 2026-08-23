import { describe, expect, it } from "vitest";

import {
  RANK_INFERENCE_CONTRACT_V2,
  friedmanRankTestV2,
  holmAdjustFamilyV2,
  mannWhitneyRankTestV2,
  wilcoxonSignedRankTestV2,
} from "./index";

describe("longitudinal rank inference v2", () => {
  it("uses exact conditional Mann-Whitney inference with typed tie audit", () => {
    const result = mannWhitneyRankTestV2([1, 2, 2], [2, 3]);

    expect(result).toMatchObject({
      schemaVersion: "3dena.stats.mann-whitney.v2",
      status: "available",
      reason: null,
      nPrimary: 3,
      nSecondary: 2,
      resolvedPMethod: "exact-conditional-rank-permutation",
      continuityCorrectionApplied: false,
      tieGroupCount: 1,
      tiedObservationCount: 3,
      exactTail: {
        totalAssignmentCount: "10",
        inclusive: true,
        midP: false,
      },
    });
    expect(result.pValueTwoSided).toBeGreaterThanOrEqual(0);
    expect(result.pValueTwoSided).toBeLessThanOrEqual(1);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("uses whole-pair sign flips, reports zeros, and returns a minimum attainable p audit", () => {
    const result = wilcoxonSignedRankTestV2([1, 2, -3, 0], { missingPairs: 2 });

    expect(result).toMatchObject({
      schemaVersion: "3dena.stats.wilcoxon-signed-rank.v2",
      status: "available",
      nMatched: 4,
      nMissing: 2,
      nZero: 1,
      nNonzero: 3,
      nRanked: 3,
      resolvedPMethod: "exact-conditional-sign-flip",
      continuityCorrectionApplied: false,
      exactTail: { totalAssignmentCount: "8", inclusive: true, midP: false },
      minimumAttainableTwoSidedP: {
        formula: "2^(1-nNonzero)",
        log2: -2,
        numeric: 0.25,
      },
    });
    expect(result.warnings).toEqual(expect.arrayContaining([
      "zero-differences-present",
      "missing-pairs",
      "signed-rank-symmetry-assumption",
    ]));
  });

  it("runs an exact tie-audited Friedman omnibus and fails closed without complete blocks", () => {
    const exact = friedmanRankTestV2([
      [1, 2, 3],
      [1, 3, 2],
      [3, 1, 2],
    ], { missingCompleteBlocks: 1 });

    expect(exact).toMatchObject({
      schemaVersion: "3dena.stats.friedman.v2",
      status: "available",
      nComplete: 3,
      nMissingCompleteBlocks: 1,
      nPeriods: 3,
      degreesFreedom: 2,
      resolvedPMethod: "exact-conditional-period-permutation",
      exactTail: { totalAssignmentCount: "216", inclusive: true, midP: false },
    });
    expect(exact.kendallsW).toBeGreaterThanOrEqual(0);
    expect(exact.kendallsW).toBeLessThanOrEqual(1);

    const unavailable = friedmanRankTestV2([], {
      missingCompleteBlocks: 4,
      periodCountWhenEmpty: 3,
    });
    expect(unavailable).toMatchObject({
      status: "not-estimable",
      reason: "no-complete-blocks",
      nComplete: 0,
      nPeriods: 3,
      pValueUpperTail: null,
    });
  });

  it("freezes one planned Holm family including not-estimable members", () => {
    const adjusted = holmAdjustFamilyV2([
      { memberId: "axis-x", pRaw: 0.01 },
      { memberId: "axis-y", pRaw: null },
      { memberId: "axis-z", pRaw: 0.04 },
    ]);

    expect(adjusted).toEqual([
      {
        memberId: "axis-x",
        pRaw: 0.01,
        pHolm: 0.03,
        familySizePlanned: 3,
        holmRank: 1,
        holmMultiplier: 3,
      },
      {
        memberId: "axis-y",
        pRaw: null,
        pHolm: null,
        familySizePlanned: 3,
        holmRank: null,
        holmMultiplier: null,
      },
      {
        memberId: "axis-z",
        pRaw: 0.04,
        pHolm: 0.08,
        familySizePlanned: 3,
        holmRank: 2,
        holmMultiplier: 2,
      },
    ]);
    expect(RANK_INFERENCE_CONTRACT_V2.adjustment).toBe("holm-complete-planned-family-v2");
  });
});
