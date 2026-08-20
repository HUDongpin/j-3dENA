import { describe, expect, it } from "vitest";

import { analyzeTrajectoryDynamicsV1, TrajectoryDynamicsError } from "./index";
import type {
  TrajectoryDynamicsInputV1,
  TrajectoryDynamicsPointV1,
  TrajectoryIdentityV1,
  TrajectoryPeriodDefinitionV1,
  TrajectoryTimeValueV1
} from "./index";

function identity(name: string, value: string, declaredType?: string): TrajectoryIdentityV1 {
  return {
    components: [{ name, type: "string", value, ...(declaredType === undefined ? {} : { declaredType }) }]
  };
}

function numericPeriod(label: string, value: number, unit = "study-day"): TrajectoryPeriodDefinitionV1 {
  return { time: identity("Period", label), value: { type: "numeric-v1", value, unit } };
}

function point(
  participant: string,
  period: string,
  coordinates: number[],
  weight?: number
): TrajectoryDynamicsPointV1 {
  return {
    participant: identity("Participant", participant, "int64-string"),
    time: identity("Period", period),
    coordinates,
    ...(weight === undefined ? {} : { weight })
  };
}

function input(
  points: TrajectoryDynamicsPointV1[],
  overrides: Partial<TrajectoryDynamicsInputV1> = {}
): TrajectoryDynamicsInputV1 {
  return {
    schemaVersion: "3dena.trajectory-dynamics-input.v1",
    namespace: "sample",
    points,
    dimensions: ["SVD1", "SVD2", "SVD3", "SVD4"],
    selectedDimensions: ["SVD1", "SVD2", "SVD3"],
    periods: [numericPeriod("A", 0), numericPeriod("B", 2), numericPeriod("C", 5)],
    cohortPolicy: "available",
    estimand: { kind: "equal-participant-v1" },
    ...overrides
  };
}

describe("analyzeTrajectoryDynamicsV1 centroid and numeric-time contract", () => {
  it("reduces participant-period duplicates before equal centroids and computes selected/full speed", () => {
    const result = analyzeTrajectoryDynamicsV1(input([
      point("9007199254740992", "A", [0, 0, 0, 0]),
      point("9007199254740992", "A", [2, 0, 0, 4]),
      point("9007199254740993", "A", [3, 0, 0, 0]),
      point("9007199254740992", "B", [5, 0, 0, 6]),
      point("9007199254740993", "B", [7, 0, 0, 2]),
      point("9007199254740992", "C", [9, 0, 0, 8]),
      point("9007199254740993", "C", [11, 0, 0, 12])
    ]));

    expect(result.summary).toEqual({
      inputRows: 7,
      participants: 2,
      participantPeriods: 6,
      periods: 3,
      observedPeriods: 3,
      missingPeriods: 0,
      duplicateRows: 1,
      cohortExcludedParticipants: 0
    });
    expect(result.participantPeriods[0]).toMatchObject({
      selectedCoordinates: [1, 0, 0],
      fullCoordinates: [1, 0, 0, 2],
      sourceRowIndexes: [0, 1]
    });
    expect(result.periods.map(({ selectedCentroid }) => selectedCentroid)).toEqual([
      [2, 0, 0],
      [6, 0, 0],
      [10, 0, 0]
    ]);
    expect(result.periods.map(({ elapsedFromPrevious }) => elapsedFromPrevious)).toEqual([null, 2, 3]);
    expect(result.periods.map(({ elapsedFromStart }) => elapsedFromStart)).toEqual([0, 2, 5]);
    expect(result.periods[1]!.selected3d).toMatchObject({ delta: [4, 0, 0], stepDistance: 4, cumulativeDistance: 4, speed: 2 });
    expect(result.periods[1]!.fullSpace.stepDistance).toBe(5);
    expect(result.periods[1]!.fullSpace.speed).toBe(2.5);
    expect(result.periods[2]!.selected3d.speed).toBeCloseTo(4 / 3, 14);
    expect(result.periods[2]!.fullSpace.speed).toBeCloseTo(Math.sqrt(52) / 3, 14);
    expect(result.diagnosticSummary.codes).toContain("DUPLICATE_PARTICIPANT_PERIOD_ROWS");
    expect(result.evidence).toEqual({
      status: "IMPLEMENTED_UNVERIFIED",
      oracleParityClaim: false,
      scientificAuthority: "successor-definition-pending-review"
    });
    expect(structuredClone(result)).toEqual(result);
    expect(Object.isFrozen(result.periods[0])).toBe(true);
  });

  it("keeps equal and weighted participant estimands distinct after duplicate reduction", () => {
    const weightedPoints = [
      point("P1", "A", [0, 0, 0, 0], 1),
      point("P2", "A", [10, 0, 0, 0], 3),
      point("P1", "B", [2, 0, 0, 0], 1),
      point("P2", "B", [12, 0, 0, 0], 3)
    ];
    const periods = [numericPeriod("A", 0), numericPeriod("B", 1)];
    const weighted = analyzeTrajectoryDynamicsV1(input(weightedPoints, {
      periods,
      estimand: { kind: "weighted-participant-v1" }
    }));
    const equal = analyzeTrajectoryDynamicsV1(input(weightedPoints, { periods }));

    expect(weighted.periods.map(({ selectedCentroid }) => selectedCentroid?.[0])).toEqual([7.5, 9.5]);
    expect(weighted.periods[0]!.weightSum).toBe(4);
    expect(weighted.periods[0]!.effectiveParticipantN).toBeCloseTo(1.6, 15);
    expect(weighted.periods[1]!.selected3d).toMatchObject({ stepDistance: 2, speed: 2 });
    expect(equal.periods.map(({ selectedCentroid }) => selectedCentroid?.[0])).toEqual([5, 7]);
    expect(equal.periods[0]).toMatchObject({ weightSum: 2, effectiveParticipantN: 2 });
    expect(equal.diagnosticSummary.codes).toContain("PARTICIPANT_WEIGHTS_IGNORED");
    expect(weighted.diagnosticSummary.codes).toContain("LOW_EFFECTIVE_PARTICIPANT_N");
  });

  it("requires one constant positive weight inside every weighted participant-period", () => {
    expect(() => analyzeTrajectoryDynamicsV1(input([
      point("P1", "A", [0, 0, 0, 0], 1),
      point("P1", "A", [2, 0, 0, 0], 2)
    ], {
      periods: [numericPeriod("A", 0)],
      estimand: { kind: "weighted-participant-v1" }
    }))).toThrowError(expect.objectContaining({ code: "INCONSISTENT_PARTICIPANT_PERIOD_WEIGHT" }));

    const missing = point("P1", "A", [0, 0, 0, 0]);
    expect(() => analyzeTrajectoryDynamicsV1(input([missing], {
      periods: [numericPeriod("A", 0)],
      estimand: { kind: "weighted-participant-v1" }
    }))).toThrowError(expect.objectContaining({ code: "MISSING_PARTICIPANT_WEIGHT" }));
  });

  it("scales extreme finite weights without corrupting a representable weighted centroid", () => {
    const result = analyzeTrajectoryDynamicsV1(input([
      point("P1", "A", [1e308, 0, 0, 0], 1e308),
      point("P2", "A", [-1e308, 0, 0, 0], 1e308)
    ], {
      periods: [numericPeriod("A", 0)],
      estimand: { kind: "weighted-participant-v1" }
    }));
    expect(result.periods[0]).toMatchObject({ fullCentroid: [0, 0, 0, 0], weightSum: null, effectiveParticipantN: 2 });
    expect(result.diagnosticSummary.codes).toContain("UNREPRESENTABLE_WEIGHT_SUM");
  });
});

describe("cohort, missing period, and gap semantics", () => {
  it("applies complete cohort membership before every centroid", () => {
    const result = analyzeTrajectoryDynamicsV1(input([
      point("P1", "A", [0, 0, 0, 0]),
      point("P1", "B", [2, 0, 0, 0]),
      point("P2", "A", [100, 0, 0, 0])
    ], {
      periods: [numericPeriod("A", 0), numericPeriod("B", 1)],
      cohortPolicy: "complete"
    }));
    expect(result.periods.map(({ selectedCentroid }) => selectedCentroid?.[0])).toEqual([0, 2]);
    expect(result.periods.map(({ nCohortExcluded }) => nCohortExcluded)).toEqual([1, 0]);
    expect(result.summary.cohortExcludedParticipants).toBe(1);
    expect(result.diagnosticSummary.codes).toContain("INCOMPLETE_PARTICIPANTS_EXCLUDED");
  });

  it("distinguishes observed rows excluded by cohort policy from an unobserved period", () => {
    const result = analyzeTrajectoryDynamicsV1(input([
      point("P1", "A", [0, 0, 0, 0])
    ], {
      periods: [numericPeriod("A", 0), numericPeriod("B", 1)],
      cohortPolicy: "complete"
    }));
    expect(result.summary).toMatchObject({ observedPeriods: 1, missingPeriods: 1 });
    expect(result.periods[0]).toMatchObject({ nRows: 1, nParticipantPeriods: 1, nUsed: 0 });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "EMPTY_TRAJECTORY_PERIOD_AFTER_COHORT",
      path: "periods[0]"
    }));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "MISSING_TRAJECTORY_PERIOD",
      path: "periods[1]"
    }));
  });

  it("does not bridge expected missing periods and only resumes local steps after the gap", () => {
    const result = analyzeTrajectoryDynamicsV1(input([
      point("P1", "A", [0, 0, 0, 0]),
      point("P1", "C", [4, 0, 0, 0]),
      point("P1", "D", [5, 0, 0, 0])
    ], {
      periods: [numericPeriod("A", 0), numericPeriod("B", 1), numericPeriod("C", 2), numericPeriod("D", 3)]
    }));
    expect(result.periods[1]).toMatchObject({ selectedCentroid: null, nUsed: 0 });
    expect(result.periods[2]!.selected3d).toEqual({
      dimensions: ["SVD1", "SVD2", "SVD3"], delta: null, stepDistance: null, cumulativeDistance: null, speed: null
    });
    expect(result.periods[3]!.selected3d).toMatchObject({ delta: [1, 0, 0], stepDistance: 1, cumulativeDistance: null, speed: 1 });
    expect(result.summary).toMatchObject({ observedPeriods: 3, missingPeriods: 1 });
    expect(result.diagnosticSummary.codes).toEqual(expect.arrayContaining([
      "MISSING_TRAJECTORY_PERIOD",
      "TRAJECTORY_GAP_BREAKS_PATH",
      "CHANGING_AVAILABLE_COHORT"
    ]));
  });

  it("reports period-specific weighted estimands when participant weights vary over time", () => {
    const result = analyzeTrajectoryDynamicsV1(input([
      point("P1", "A", [0, 0, 0, 0], 1),
      point("P1", "B", [1, 0, 0, 0], 2)
    ], {
      periods: [numericPeriod("A", 0), numericPeriod("B", 1)],
      estimand: { kind: "weighted-participant-v1" }
    }));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "TIME_VARYING_PARTICIPANT_WEIGHT", count: 1 }));
  });
});

describe("versioned typed elapsed-time semantics", () => {
  function temporalInput(periods: TrajectoryPeriodDefinitionV1[], x: number[]): TrajectoryDynamicsInputV1 {
    return input(periods.map((period, index) => ({
      participant: identity("Participant", "P1"),
      time: period.time,
      coordinates: [x[index]!, 0, 0, 0]
    })), { periods });
  }

  it("computes civil Date elapsed days without local-time or DST conversion", () => {
    const periods: TrajectoryPeriodDefinitionV1[] = [
      { time: identity("Period", "D1"), value: { type: "date-v1", value: "2024-02-28" } },
      { time: identity("Period", "D2"), value: { type: "date-v1", value: "2024-02-29" } },
      { time: identity("Period", "D3"), value: { type: "date-v1", value: "2024-03-02" } }
    ];
    const result = analyzeTrajectoryDynamicsV1(temporalInput(periods, [0, 2, 8]));
    expect(result.timeContract).toEqual({
      kind: "date-v1", elapsedUnit: "days", calendar: "proleptic-gregorian-v1", chronology: "strictly-increasing-civil-day-v1"
    });
    expect(result.periods.map(({ elapsedFromPrevious }) => elapsedFromPrevious)).toEqual([null, 1, 2]);
    expect(result.periods.map(({ selected3d }) => selected3d.speed)).toEqual([null, 2, 3]);
  });

  it("uses exact int64 epoch milliseconds and preserves DST fold provenance", () => {
    const periods: TrajectoryPeriodDefinitionV1[] = [
      {
        time: identity("LocalTime", "01:30 fold 0"),
        value: {
          type: "instant-v1", epochMilliseconds: "9007199254740992", timeZone: "America/New_York",
          offsetMinutes: -240, fold: 0, elapsedUnit: "hours"
        }
      },
      {
        time: identity("LocalTime", "01:30 fold 1"),
        value: {
          type: "instant-v1", epochMilliseconds: "9007199258340992", timeZone: "America/New_York",
          offsetMinutes: -300, fold: 1, elapsedUnit: "hours"
        }
      }
    ];
    const result = analyzeTrajectoryDynamicsV1(temporalInput(periods, [0, 5]));
    expect(result.periods[1]).toMatchObject({ elapsedFromPrevious: 1, elapsedFromStart: 1 });
    expect(result.periods[1]!.selected3d.speed).toBe(5);
    expect(result.periods[1]!.timeValue).toMatchObject({ fold: 1, offsetMinutes: -300 });
    expect(result.timeContract).toMatchObject({
      kind: "instant-v1", elapsedUnit: "hours", zoneRole: "presentation-provenance-only"
    });
  });

  it("normalizes difftime source units into one explicit output unit", () => {
    const values: TrajectoryTimeValueV1[] = [
      { type: "difftime-v1", value: 0, unit: "days", elapsedUnit: "hours" },
      { type: "difftime-v1", value: 12, unit: "hours", elapsedUnit: "hours" },
      { type: "difftime-v1", value: 1, unit: "days", elapsedUnit: "hours" }
    ];
    const periods = values.map((value, index) => ({ time: identity("Period", `T${index}`), value }));
    const result = analyzeTrajectoryDynamicsV1(temporalInput(periods, [0, 6, 18]));
    expect(result.periods.map(({ elapsedFromPrevious }) => elapsedFromPrevious)).toEqual([null, 12, 12]);
    expect(result.periods.map(({ selected3d }) => selected3d.speed)).toEqual([null, 0.5, 1]);
    expect(result.timeContract).toMatchObject({ kind: "difftime-v1", elapsedUnit: "hours" });
  });

  it("rejects invalid calendars, mixed contracts, non-increasing values, and forged instant integers", () => {
    const invalidDate = [{ time: identity("Period", "A"), value: { type: "date-v1", value: "2026-02-29" } as const }];
    expect(() => analyzeTrajectoryDynamicsV1(temporalInput(invalidDate, [0]))).toThrowError(expect.objectContaining({ code: "INVALID_TRAJECTORY_DATE" }));

    const mixed = [
      numericPeriod("A", 0),
      { time: identity("Period", "B"), value: { type: "date-v1", value: "2026-08-20" } as const }
    ];
    expect(() => analyzeTrajectoryDynamicsV1(temporalInput(mixed, [0, 1]))).toThrowError(expect.objectContaining({ code: "MIXED_TRAJECTORY_TIME_TYPES" }));

    const reverse = [numericPeriod("A", 2), numericPeriod("B", 2)];
    expect(() => analyzeTrajectoryDynamicsV1(temporalInput(reverse, [0, 1]))).toThrowError(expect.objectContaining({ code: "NON_INCREASING_TRAJECTORY_TIME" }));

    const forged = [{
      time: identity("Period", "A"),
      value: {
        type: "instant-v1", epochMilliseconds: "01", timeZone: "UTC", offsetMinutes: 0, fold: 0, elapsedUnit: "seconds"
      } as const
    }];
    expect(() => analyzeTrajectoryDynamicsV1(temporalInput(forged, [0]))).toThrowError(expect.objectContaining({ code: "INVALID_INSTANT_EPOCH" }));

    const oversized = [{
      time: identity("Period", "A"),
      value: {
        type: "instant-v1", epochMilliseconds: "100000000000000000000", timeZone: "UTC", offsetMinutes: 0, fold: 0, elapsedUnit: "seconds"
      } as const
    }];
    expect(() => analyzeTrajectoryDynamicsV1(temporalInput(oversized, [0]))).toThrowError(expect.objectContaining({ code: "INVALID_INSTANT_EPOCH" }));
  });
});

describe("typed identity and limits", () => {
  it("keeps int64 strings, tuple boundaries, adjacent doubles, and signed zero distinct", () => {
    const participants: TrajectoryIdentityV1[] = [
      identity("id", "9007199254740992", "int64"),
      identity("id", "9007199254740993", "int64"),
      { components: [{ name: "a", type: "string", value: "x.y" }, { name: "b", type: "string", value: "z" }] },
      { components: [{ name: "a", type: "string", value: "x" }, { name: "b", type: "string", value: "y.z" }] },
      { components: [{ name: "n", type: "number", value: -0 }] },
      { components: [{ name: "n", type: "number", value: 0 }] },
      { components: [{ name: "n", type: "number", value: 1 }] },
      { components: [{ name: "n", type: "number", value: 1.0000000000000002 }] }
    ];
    const result = analyzeTrajectoryDynamicsV1(input(participants.map((participant, index) => ({
      participant,
      time: identity("Period", "A"),
      coordinates: [index, 0, 0, 0]
    })), { periods: [numericPeriod("A", 0)] }));
    expect(result.summary.participants).toBe(participants.length);
    expect(new Set(result.participantPeriods.map(({ participant }) => participant.canonical)).size).toBe(participants.length);
  });

  it("rejects unsafe numeric identity, non-finite coordinates, and excessive cells", () => {
    const unsafe = point("P", "A", [0, 0, 0, 0]);
    unsafe.participant = { components: [{ name: "id", type: "number", value: 9_007_199_254_740_992 }] };
    expect(() => analyzeTrajectoryDynamicsV1(input([unsafe], { periods: [numericPeriod("A", 0)] }))).toThrowError(expect.objectContaining({ code: "UNSAFE_INTEGER_IDENTITY" }));

    const nonFinite = point("P", "A", [0, 0, 0, Number.NaN]);
    expect(() => analyzeTrajectoryDynamicsV1(input([nonFinite], { periods: [numericPeriod("A", 0)] }))).toThrowError(expect.objectContaining({ code: "NON_FINITE_TRAJECTORY_COORDINATE" }));

    expect(() => analyzeTrajectoryDynamicsV1(input([point("P", "A", [0, 0, 0, 0])], {
      periods: [numericPeriod("A", 0)],
      limits: { maxCells: 3 }
    }))).toThrowError(expect.objectContaining({ code: "TRAJECTORY_CELL_LIMIT" }));
    expect(() => analyzeTrajectoryDynamicsV1({} as TrajectoryDynamicsInputV1)).toThrowError(TrajectoryDynamicsError);
    expect(() => analyzeTrajectoryDynamicsV1(input([point("P", "A", [0, 0, 0, 0])], {
      periods: [null as unknown as TrajectoryPeriodDefinitionV1]
    }))).toThrowError(expect.objectContaining({ code: "INVALID_TRAJECTORY_PERIOD" }));
  });
});
