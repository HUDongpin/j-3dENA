import { describe, expect, it } from "vitest";

import {
  analyzeTrajectoryPathSetV2,
  type TrajectoryIdentityV1,
  type TrajectoryPathSetInputV2,
} from "./index";

const identity = (name: string, value: string): TrajectoryIdentityV1 => ({
  components: [{ name, type: "string", value }],
});

function input(): TrajectoryPathSetInputV2 {
  return {
    schemaVersion: "3dena.trajectory-path-set-input.v2",
    dimensions: ["SVD1", "SVD2", "SVD3", "SVD4"],
    selectedDimensions: ["SVD1", "SVD2", "SVD3"],
    periods: [
      { time: identity("Time", "T1"), value: { type: "numeric-v1", value: 0, unit: "ordered-period" } },
      { time: identity("Time", "T2"), value: { type: "numeric-v1", value: 1, unit: "ordered-period" } },
      { time: identity("Time", "T3"), value: { type: "numeric-v1", value: 2, unit: "ordered-period" } },
    ],
    cohortPolicy: "available",
    estimand: { kind: "equal-participant-v1" },
    groups: [
      {
        group: identity("Condition", "A"),
        namespace: "group-a",
        points: [
          { participant: identity("Student", "P1"), time: identity("Time", "T1"), coordinates: [0, 0, 0, 0] },
          { participant: identity("Student", "P1"), time: identity("Time", "T1"), coordinates: [2, 0, 0, 2] },
          { participant: identity("Student", "P2"), time: identity("Time", "T1"), coordinates: [4, 0, 0, 4] },
          { participant: identity("Student", "P1"), time: identity("Time", "T3"), coordinates: [6, 0, 0, 10] },
        ],
      },
      {
        group: identity("Condition", "B"),
        namespace: "group-b",
        points: [
          { participant: identity("Student", "P3"), time: identity("Time", "T1"), coordinates: [10, 1, 0, 10] },
          { participant: identity("Student", "P3"), time: identity("Time", "T2"), coordinates: [11, 1, 0, 12] },
          { participant: identity("Student", "P3"), time: identity("Time", "T3"), coordinates: [12, 1, 0, 14] },
        ],
      },
    ],
  };
}

describe("multi-group trajectory path set v2", () => {
  it("reduces participant-period duplicates before equal-participant centroids and preserves gaps", () => {
    const result = analyzeTrajectoryPathSetV2(input());

    expect(result.schemaVersion).toBe("3dena.trajectory-path-set.v2");
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]!.group.display).toBe("A");
    expect(result.groups[0]!.dynamics.periods[0]).toMatchObject({
      selectedCentroid: [2.5, 0, 0],
      fullCentroid: [2.5, 0, 0, 2.5],
      nRows: 3,
      nParticipantPeriods: 2,
      nDuplicateRows: 1,
    });
    expect(result.groups[0]!.dynamics.periods[1]).toMatchObject({
      selectedCentroid: null,
      fullCentroid: null,
      selected3d: { stepDistance: null, cumulativeDistance: null, speed: null },
    });
    expect(result.groups[0]!.dynamics.periods[2]!.selected3d.stepDistance).toBeNull();
    expect(result.groups[1]!.dynamics.periods[1]!.fullSpace.stepDistance)
      .toBeGreaterThan(result.groups[1]!.dynamics.periods[1]!.selected3d.stepDistance!);
    expect(result.summary).toMatchObject({ groups: 2, participantPeriods: 6, duplicateRows: 1, missingGroupPeriods: 1 });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects duplicate typed group identities and mixed scientific geometry", () => {
    const duplicate = input();
    duplicate.groups[1]!.group = identity("Condition", "A");
    expect(() => analyzeTrajectoryPathSetV2(duplicate)).toThrowError(expect.objectContaining({ code: "DUPLICATE_TRAJECTORY_GROUP" }));

    const wrongShape = input();
    wrongShape.groups[1]!.points[0]!.coordinates = [1, 2, 3];
    expect(() => analyzeTrajectoryPathSetV2(wrongShape)).toThrowError(expect.objectContaining({ code: "TRAJECTORY_COORDINATE_SHAPE" }));
  });
});
