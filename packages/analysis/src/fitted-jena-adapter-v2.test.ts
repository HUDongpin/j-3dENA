import { describe, expect, it } from "vitest";
import { ena, projectIn, type Row } from "jena-js";

import {
  adaptFittedJenaTrajectoryResultV2,
  getAnalysisBuildIdentityV2,
} from "./fitted-jena-adapter-v2";
import { hashAnalysisValueV1 } from "./task-executor";

const rows: Row[] = [
  { Group: "A", Speaker: "a1", Period: 1, weight: 2, A: 1, B: 1, C: 0, D: 0 },
  { Group: "A", Speaker: "a1", Period: 2, weight: 2, A: 0, B: 1, C: 1, D: 0 },
  { Group: "A", Speaker: "a2", Period: 1, weight: 3, A: 1, B: 0, C: 0, D: 1 },
  { Group: "A", Speaker: "a2", Period: 2, weight: 3, A: 0, B: 0, C: 1, D: 1 },
  { Group: "B", Speaker: "b1", Period: 1, weight: 4, A: 1, B: 1, C: 1, D: 0 },
  { Group: "B", Speaker: "b1", Period: 2, weight: 4, A: 0, B: 1, C: 1, D: 1 },
  { Group: "B", Speaker: "b2", Period: 1, weight: 5, A: 1, B: 0, C: 1, D: 1 },
  { Group: "B", Speaker: "b2", Period: 2, weight: 5, A: 1, B: 1, C: 0, D: 1 },
];

function fitted() {
  return ena({
    rows,
    units: ["Group", "Speaker"],
    conversation: ["Group", "Speaker", "Period"],
    codes: ["A", "B", "C", "D"],
    model: "SeparateTrajectory",
    window: "Conversation",
    windowSizeBack: Number.POSITIVE_INFINITY,
    windowSizeForward: 0,
    weightBy: "binary",
    dimensions: 3,
    centerAlignToOrigin: true,
  });
}

function adapt(sourceRows = rows) {
  return adaptFittedJenaTrajectoryResultV2({
    set: fitted(),
    sourceRows,
    mapping: {
      unitColumns: ["Group", "Speaker"],
      conversationColumns: ["Group", "Speaker", "Period"],
      participantColumns: ["Speaker"],
      timeColumn: "Period",
      groupColumn: "Group",
      metadataColumns: ["weight"],
    },
    configuration: {
      model: "SeparateTrajectory",
      window: "Conversation",
      weightBy: "binary",
      windowSizeBack: Number.POSITIVE_INFINITY,
      windowSizeForward: 0,
      centerAlignToOrigin: true,
      rotationMethod: "svd",
    },
    inputColumns: ["Group", "Speaker", "Period", "weight", "A", "B", "C", "D"],
  });
}

describe("fitted jENA trajectory adapter V2", () => {
  it("uses the immutable fitted rotation to recover every full-space coordinate without mutating the set", () => {
    const set = fitted();
    const before = structuredClone(set);
    const result = adaptFittedJenaTrajectoryResultV2({
      set,
      sourceRows: rows,
      mapping: {
        unitColumns: ["Group", "Speaker"],
        conversationColumns: ["Group", "Speaker", "Period"],
        participantColumns: ["Speaker"],
        timeColumn: "Period",
        groupColumn: "Group",
        metadataColumns: ["weight"],
      },
      configuration: {
        model: "SeparateTrajectory",
        window: "Conversation",
        weightBy: "binary",
        windowSizeBack: Number.POSITIVE_INFINITY,
        windowSizeForward: 0,
        centerAlignToOrigin: true,
        rotationMethod: "svd",
      },
      inputColumns: ["Group", "Speaker", "Period", "weight", "A", "B", "C", "D"],
    });
    const { nodes: _nodes, ...fixedRotation } = set.rotation;
    const fixedProjection = projectIn(
      set,
      fixedRotation,
      { dimensions: set.rotation.rotationColumns.length, centerAlignToOrigin: true },
    );

    expect(result.dimensions).toEqual(set.rotation.rotationColumns);
    expect(result.dimensions.length).toBeGreaterThan(3);
    expect(result.points[0]?.fullCoordinates).toEqual(
      result.dimensions.map((dimension) => fixedProjection.points[0]?.[dimension]),
    );
    expect(result.nodes[0]?.fullCoordinates).toEqual(
      result.dimensions.map((dimension) => fixedProjection.rotation.nodes?.[0]?.[dimension]),
    );
    expect(set).toEqual(before);
  });

  it("retains typed composite participant, group, and time identities and stable numeric metadata", () => {
    const result = adapt();
    const point = result.points[0]!;
    expect(point.participantLabel.columns).toEqual(["Speaker"]);
    expect(point.participantLabel.values).toEqual(["a1"]);
    expect(point.group?.value).toBe("A");
    expect(point.time?.value).toBe(1);
    expect(point.metadata.weight).toBe(2);
    expect(result.trajectory?.groupOrder.map((value) => value.value)).toEqual(["A", "B"]);
    expect(result.trajectory?.timeOrder.map((value) => value.value)).toEqual([1, 2]);
  });

  it("rejects source typed tuples that collide in the standard jENA display identity", () => {
    const collision = rows.map((row) => ({ ...row }));
    collision.push({ ...collision[0]!, Speaker: 1 });
    collision[0]!.Speaker = "1";
    expect(() => adapt(collision)).toThrow(/typed.*collision|collision.*typed/iu);
  });

  it("exposes the injected build identity through a frozen public copy", () => {
    const first = getAnalysisBuildIdentityV2();
    const second = getAnalysisBuildIdentityV2();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(Object.keys(first).sort()).toEqual([
      "bound",
      "buildId",
      "jenaCommit",
      "jenaTarballIntegrity",
      "jenaVersion",
      "sdkVersion",
    ]);
  });

  it("serializes an unbounded Conversation window as JSON-safe provenance", async () => {
    const result = adapt();
    expect(result.provenance.resolvedConfig.windowSizeBack).toBe("Infinity");
    await expect(hashAnalysisValueV1(result)).resolves.toMatch(/^[a-f0-9]{64}$/u);
  });
});
