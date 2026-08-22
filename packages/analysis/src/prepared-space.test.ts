import { readFileSync } from "node:fs";

import { decodeEna3dExchangeV1WithSha256 } from "@3dena/io";
import { describe, expect, it } from "vitest";

import {
  analyzePreparedSpace,
  selectPreparedSpaceDisplay,
} from "./prepared-space";
import { AnalysisValidationError } from "./types";
import type {
  PreparedSpaceDisplayFilter,
  PreparedSpaceMapping,
} from "./prepared-types";
import {
  SYNTHETIC_PREPARED_DIMENSIONS,
  SYNTHETIC_PREPARED_GROUPS,
  createSyntheticPreparedFixture,
  createSyntheticPreparedMapping,
} from "../test-support/synthetic-prepared-exchange";

interface SyntheticRow {
  unit: string;
  group: string | number;
  speaker: string;
  period: string;
  coordinates: [number | null, number | null, number | null];
}

function syntheticExchange(
  rows: SyntheticRow[],
  groupType: "character" | "double" = "character",
) {
  const metadata = [
    { name: "ENA_UNIT", type: "character", values: rows.map((row) => row.unit) },
    { name: "Group", type: groupType, values: rows.map((row) => row.group) },
    { name: "Speaker", type: "character", values: rows.map((row) => row.speaker) },
    { name: "Period", type: "character", values: rows.map((row) => row.period) },
  ];
  const dimensions = ["SVD1", "SVD2", "SVD3"];
  const dimensionColumns = dimensions.map((name, axis) => ({
    name,
    type: "double",
    values: rows.map((row) => row.coordinates[axis]),
  }));
  const edges = [
    { name: "A & B", type: "character", values: ["A", "B"] },
    { name: "A & C", type: "character", values: ["A", "C"] },
    { name: "B & C", type: "character", values: ["B", "C"] },
  ];
  const weights = edges.map(({ name }) => ({
    name,
    type: "double",
    values: rows.map(() => 0.25),
  }));
  return {
    format: "ena3d-exchange",
    version: 1,
    dimensions,
    group_variables: ["Group", "Speaker", "Period"],
    tables: {
      meta_data: { columns: metadata },
      points: { columns: [...metadata, ...dimensionColumns] },
      line_weights: { columns: [...metadata, ...weights] },
      nodes: {
        columns: [
          { name: "code", type: "character", values: ["A", "B", "C"] },
          { name: "SVD1", type: "double", values: [1, 0, 0] },
          { name: "SVD2", type: "double", values: [0, 1, 0] },
          { name: "SVD3", type: "double", values: [0, 0, 1] },
        ],
      },
      adjacency_key: { columns: edges },
    },
  };
}

async function analyzeSynthetic(
  rows: SyntheticRow[],
  timeOrder: string[],
  cohortPolicy: "available" | "complete" = "available",
  groupType: "character" | "double" = "character",
) {
  const bytes = new TextEncoder().encode(
    JSON.stringify(syntheticExchange(rows, groupType)),
  );
  const artifact = await decodeEna3dExchangeV1WithSha256(bytes);
  return analyzePreparedSpace({
    source: { artifact, name: "synthetic.ena3d.json" },
    mapping: {
      participant: ["Group", "Speaker"],
      participantLabel: "Speaker",
      group: "Group",
      time: "Period",
      timeOrder,
      cohortPolicy,
      displayDimensions: ["SVD1", "SVD2", "SVD3"],
      missingDisplayCoordinates: "reject",
    },
  });
}

describe("analyzePreparedSpace", () => {
  it("reduces a synthetic exchange while preserving its full imported space", async () => {
    const { artifact, result } = await createSyntheticPreparedFixture();

    expect(result).toMatchObject({
      schemaVersion: "3dena.prepared-space-result.v1",
      sourceKind: "prepared-exchange",
      rawJenaRecompute: false,
      sourceReceipt: {
        name: "synthetic-prepared.ena3d.json",
        byteLength: artifact.byteLength,
        sha256: artifact.sha256,
      },
      artifacts: {
        rotation: "not-present",
        eigenvalues: "not-present",
        variance: "not-present",
      },
      provenance: {
        coordinateSpace: "precomputed-import",
        computation: "reduction-only",
        jenaExecuted: false,
      },
      summary: {
        dimensions: 5,
        points: 18,
        nodes: 3,
        edges: 3,
        lineWeightRows: 18,
        groups: 2,
        timePoints: 3,
        participantPeriods: 18,
        trajectoryCentroids: 6,
      },
    });
    expect(result).not.toHaveProperty("fixtureEvidence");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "PRECOMPUTED_COMPATIBILITY_NOT_PARITY",
    }));
    expect(result.fullSpace.dimensions).toEqual(SYNTHETIC_PREPARED_DIMENSIONS);
    expect(result.fullSpace.points.every((point) => point.coordinates.length === 5)).toBe(true);
    expect(result.fullSpace.nodes.map((node) => node.code)).toEqual(["A", "B", "C"]);
    expect(result.fullSpace.edges.map((edge) => edge.column)).toEqual(
      artifact.exchange.tables.adjacency_key.columns.map((column) => column.name),
    );
    expect(result.fullSpace.lineWeights.rowKeys.map((key) => key.canonical)).toEqual(
      result.fullSpace.points.map((point) => point.id.canonical),
    );
    expect(new Set(result.fullSpace.points.map((point) => point.participant.canonical)).size).toBe(6);
    expect(result.displaySpace.trajectory.groupOrder.map((group) => group.display)).toEqual([
      ...SYNTHETIC_PREPARED_GROUPS,
    ]);
    for (const group of SYNTHETIC_PREPARED_GROUPS) {
      expect(
        result.displaySpace.trajectory.centroids
          .filter((centroid) => centroid.group.display === group)
          .map((centroid) => centroid.participantCount),
      ).toEqual([3, 3, 3]);
    }

    const before = JSON.stringify(result.displaySpace.trajectory);
    const selected = selectPreparedSpaceDisplay(result, {
      groups: [result.displaySpace.trajectory.groupOrder[0]!.canonical],
    });
    expect(selected.groupOrder.map((group) => group.display)).toEqual([SYNTHETIC_PREPARED_GROUPS[0]]);
    expect(selected.centroids).toHaveLength(3);
    expect(selected.nodes).toHaveLength(3);
    expect(selected.dimensions).toEqual(result.displaySpace.dimensions);
    expect(selected.points).toEqual(
      result.displaySpace.points.filter((point) => point.group.canonical === selected.groupOrder[0]!.canonical),
    );
    expect(selected.participantPeriods).toEqual(
      result.displaySpace.trajectory.participantPeriods.filter(
        (point) => point.group.canonical === selected.groupOrder[0]!.canonical,
      ),
    );
    expect(JSON.stringify(result.displaySpace.trajectory)).toBe(before);
  });

  it("reselects synthetic SVD2/SVD4/SVD5 and reduces the same typed group in the preserved space", async () => {
    const { result } = await createSyntheticPreparedFixture();
    const before = structuredClone(result);
    const selectedGroup = result.displaySpace.trajectory.groupOrder[0]!;
    const selected = selectPreparedSpaceDisplay(result, {
      dimensions: ["SVD2", "SVD4", "SVD5"],
      groups: [selectedGroup.canonical],
    });

    expect(selected.dimensions).toEqual(["SVD2", "SVD4", "SVD5"]);
    expect(selected.cohortPolicy).toBe("available");
    expect(selected.groupOrder.map((group) => group.display)).toEqual([SYNTHETIC_PREPARED_GROUPS[0]]);
    const sourcePoints = result.fullSpace.points.filter(
      (point) => point.group.canonical === selectedGroup.canonical,
    );
    expect(selected.points.map((point) => point.coordinates)).toEqual(
      sourcePoints.map((point) => [
        point.coordinates[1],
        point.coordinates[3],
        point.coordinates[4],
      ]),
    );
    expect(selected.nodes.map((node) => node.coordinates)).toEqual(
      result.fullSpace.nodes.map((node) => [
        node.coordinates[1],
        node.coordinates[3],
        node.coordinates[4],
      ]),
    );
    expect(selected.participantPeriods).toHaveLength(9);
    expect(selected.participantPeriods.map((point) => ({
      participant: point.participant.canonical,
      time: point.time.canonical,
      sourcePointIndexes: point.sourcePointIndexes,
      includedInCohort: point.includedInCohort,
    }))).toEqual(
      result.displaySpace.trajectory.participantPeriods
        .filter((point) => point.group.canonical === selectedGroup.canonical)
        .map((point) => ({
          participant: point.participant.canonical,
          time: point.time.canonical,
          sourcePointIndexes: point.sourcePointIndexes,
          includedInCohort: point.includedInCohort,
        })),
    );
    expect(selected.centroids.map((centroid) => centroid.participantCount)).toEqual([3, 3, 3]);
    const firstCentroid = selected.centroids[0]!;
    const firstTime = selected.timeOrder[0]!.canonical;
    const firstPeriodPoints = sourcePoints.filter((point) => point.time.canonical === firstTime);
    const sourceAxes = [1, 3, 4] as const;
    sourceAxes.forEach((sourceAxis, selectedAxis) => {
      const expected = firstPeriodPoints.reduce((sum, point) => sum + point.coordinates[sourceAxis]!, 0) / firstPeriodPoints.length;
      expect(firstCentroid.coordinates[selectedAxis]).toBeCloseTo(expected, 14);
    });
    expect(selected.paths[0]!.steps.map((step) => step.centroidIndex)).toEqual([0, 1, 2]);
    expect(structuredClone(selected)).toEqual(selected);
    expect(Object.isFrozen(selected)).toBe(true);
    expect(Object.isFrozen(selected.points)).toBe(true);
    expect(Object.isFrozen(selected.points[0]!.coordinates)).toBe(true);
    expect(result).toEqual(before);
  });

  it("uses delimiter-safe typed identities and disambiguates duplicate source rows", async () => {
    const result = await analyzeSynthetic(
      [
        { unit: "same", group: "a::b", speaker: "c", period: "A", coordinates: [1, 2, 3] },
        { unit: "same", group: "a", speaker: "b::c", period: "A", coordinates: [4, 5, 6] },
        {
          unit: "large-string-1",
          group: "9007199254740992",
          speaker: "shared",
          period: "A",
          coordinates: [7, 8, 9],
        },
        {
          unit: "large-string-2",
          group: "9007199254740993",
          speaker: "shared",
          period: "A",
          coordinates: [10, 11, 12],
        },
      ],
      ["A"],
    );
    const participants = result.fullSpace.points.map(
      (point) => point.participant.canonical,
    );
    expect(new Set(participants).size).toBe(4);
    expect(result.fullSpace.points[0]!.participant.canonical).not.toBe(
      result.fullSpace.points[1]!.participant.canonical,
    );
    expect(result.fullSpace.points[2]!.participant.canonical).not.toBe(
      result.fullSpace.points[3]!.participant.canonical,
    );
    expect(result.fullSpace.lineWeights.rowKeys[0]!.columns.at(-1)).toBe(
      "@3dena/source-row-occurrence",
    );
    expect(result.fullSpace.lineWeights.rowKeys[0]!.canonical).not.toBe(
      result.fullSpace.lineWeights.rowKeys[1]!.canonical,
    );
  });

  it("keeps expected-but-unobserved periods as null path gaps", async () => {
    const result = await analyzeSynthetic(
      [
        { unit: "p-a", group: "G", speaker: "P", period: "A", coordinates: [1, 2, 3] },
        { unit: "p-c", group: "G", speaker: "P", period: "C", coordinates: [4, 5, 6] },
      ],
      ["A", "B", "C"],
    );
    expect(result.displaySpace.trajectory.paths[0]!.steps.map((step) => step.centroidIndex)).toEqual([
      0,
      null,
      1,
    ]);
    expect(result.displaySpace.trajectory.centroids.map((centroid) => centroid.coordinates)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    const reselected = selectPreparedSpaceDisplay(result, {
      dimensions: ["SVD3", "SVD2", "SVD1"],
    });
    expect(reselected.timeOrder.map((timePoint) => timePoint.canonical)).toEqual(
      result.displaySpace.trajectory.timeOrder.map((timePoint) => timePoint.canonical),
    );
    expect(reselected.paths[0]!.steps.map((step) => step.centroidIndex)).toEqual([
      0,
      null,
      1,
    ]);
    expect(reselected.centroids.map((centroid) => centroid.coordinates)).toEqual([
      [3, 2, 1],
      [6, 5, 4],
    ]);
  });

  it("selects arbitrary display-dimension order without mutating the full space", async () => {
    const rows: SyntheticRow[] = [
      { unit: "u", group: "G", speaker: "P", period: "A", coordinates: [1, 2, 3] },
    ];
    const artifact = await decodeEna3dExchangeV1WithSha256(
      new TextEncoder().encode(JSON.stringify(syntheticExchange(rows))),
    );
    const mapping: PreparedSpaceMapping = {
      participant: ["Group", "Speaker"],
      participantLabel: "Speaker",
      group: "Group",
      time: "Period",
      timeOrder: ["A"],
      cohortPolicy: "available",
      displayDimensions: ["SVD3", "SVD1", "SVD2"],
    };
    const result = analyzePreparedSpace({
      source: { artifact, name: "reordered.ena3d.json" },
      mapping,
    });

    expect(result.fullSpace.points[0]!.coordinates).toEqual([1, 2, 3]);
    expect(result.displaySpace.dimensions).toEqual(["SVD3", "SVD1", "SVD2"]);
    expect(result.displaySpace.points[0]!.coordinates).toEqual([3, 1, 2]);
    expect(result.displaySpace.trajectory.centroids[0]!.coordinates).toEqual([3, 1, 2]);
    mapping.timeOrder[0] = "changed-after-run";
    expect(result.provenance.resolvedMapping.timeOrder).toEqual(["A"]);
  });

  it("excludes incomplete participants before complete-cohort centroids", async () => {
    const result = await analyzeSynthetic(
      [
        { unit: "p1-a", group: "G", speaker: "P1", period: "A", coordinates: [1, 1, 1] },
        { unit: "p1-b", group: "G", speaker: "P1", period: "B", coordinates: [2, 2, 2] },
        { unit: "p1-c", group: "G", speaker: "P1", period: "C", coordinates: [3, 3, 3] },
        { unit: "p2-a", group: "G", speaker: "P2", period: "A", coordinates: [100, 100, 100] },
        { unit: "p2-c", group: "G", speaker: "P2", period: "C", coordinates: [100, 100, 100] },
      ],
      ["A", "B", "C"],
      "complete",
    );
    expect(result.displaySpace.trajectory.centroids.map((centroid) => ({
      count: centroid.participantCount,
      coordinates: centroid.coordinates,
    }))).toEqual([
      { count: 1, coordinates: [1, 1, 1] },
      { count: 1, coordinates: [2, 2, 2] },
      { count: 1, coordinates: [3, 3, 3] },
    ]);
    expect(
      result.displaySpace.trajectory.participantPeriods
        .filter((point) => point.participantLabel.display === "P2")
        .every((point) => !point.includedInCohort),
    ).toBe(true);
    const reselected = selectPreparedSpaceDisplay(result, {
      dimensions: ["SVD3", "SVD1", "SVD2"],
    });
    expect(reselected.centroids.map((centroid) => ({
      count: centroid.participantCount,
      coordinates: centroid.coordinates,
    }))).toEqual([
      { count: 1, coordinates: [1, 1, 1] },
      { count: 1, coordinates: [2, 2, 2] },
      { count: 1, coordinates: [3, 3, 3] },
    ]);
    expect(
      reselected.participantPeriods
        .filter((point) => point.participantLabel.display === "P2")
        .every((point) => !point.includedInCohort),
    ).toBe(true);
  });

  it("keeps reductions finite for extreme finite coordinates and weights", async () => {
    const rows: SyntheticRow[] = [
      {
        unit: "p1-a-1",
        group: "G",
        speaker: "P1",
        period: "A",
        coordinates: [Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE],
      },
      {
        unit: "p1-a-2",
        group: "G",
        speaker: "P1",
        period: "A",
        coordinates: [Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE],
      },
      {
        unit: "p2-a",
        group: "G",
        speaker: "P2",
        period: "A",
        coordinates: [-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE],
      },
    ];
    const exchange = syntheticExchange(rows);
    exchange.tables.line_weights.columns[4]!.values = [
      Number.MAX_VALUE,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
    ];
    const artifact = await decodeEna3dExchangeV1WithSha256(
      new TextEncoder().encode(JSON.stringify(exchange)),
    );
    const result = analyzePreparedSpace({
      source: { artifact, name: "extreme.ena3d.json" },
      mapping: {
        participant: ["Group", "Speaker"],
        participantLabel: "Speaker",
        group: "Group",
        time: "Period",
        timeOrder: ["A"],
        cohortPolicy: "available",
        displayDimensions: ["SVD1", "SVD2", "SVD3"],
      },
    });

    expect(
      result.displaySpace.trajectory.participantPeriods.every((point) =>
        point.coordinates.every(Number.isFinite),
      ),
    ).toBe(true);
    expect(
      result.displaySpace.trajectory.centroids.every((centroid) =>
        centroid.coordinates.every(Number.isFinite),
      ),
    ).toBe(true);
    expect(result.fullSpace.edges.every((edge) => Number.isFinite(edge.meanWeight))).toBe(true);
  });

  it("rejects null coordinates, undeclared times, unsafe numeric IDs, and unsafe names", async () => {
    await expect(
      analyzeSynthetic(
        [{ unit: "u", group: "G", speaker: "P", period: "A", coordinates: [1, null, 3] }],
        ["A"],
      ),
    ).rejects.toBeInstanceOf(AnalysisValidationError);
    await expect(
      analyzeSynthetic(
        [{ unit: "u", group: "G", speaker: "P", period: "Z", coordinates: [1, 2, 3] }],
        ["A"],
      ),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "UNDECLARED_PREPARED_TIME" })],
    });
    await expect(
      analyzeSynthetic(
        [
          {
            unit: "u",
            group: Number.MAX_SAFE_INTEGER + 1,
            speaker: "P",
            period: "A",
            coordinates: [1, 2, 3],
          },
        ],
        ["A"],
        "available",
        "double",
      ),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "UNSAFE_PREPARED_INTEGER_IDENTITY" })],
    });

    const { artifact } = await createSyntheticPreparedFixture();
    const mapping = createSyntheticPreparedMapping();
    expect(() =>
      analyzePreparedSpace({
        source: { artifact, name: "bad\nname.ena3d.json" },
        mapping,
      }),
    ).toThrow(AnalysisValidationError);

    expect(() =>
      analyzePreparedSpace({
        source: { artifact: { ...artifact }, name: "forged.ena3d.json" },
        mapping,
      }),
    ).toThrow(AnalysisValidationError);

    expect(() =>
      analyzePreparedSpace({
        source: { artifact, name: "bad-participant.ena3d.json" },
        mapping: { ...mapping, participant: ["Actor"] },
      }),
    ).toThrow(AnalysisValidationError);

    expect(() =>
      analyzePreparedSpace({
        source: { artifact, name: "too-many-times.ena3d.json" },
        mapping: {
          ...mapping,
          timeOrder: Array.from({ length: 10_001 }, (_, index) => `T${index}`),
        },
      }),
    ).toThrow(AnalysisValidationError);
  });

  it("rejects duplicate and unknown prepared display group filters", async () => {
    const result = await analyzeSynthetic(
      [{ unit: "u", group: "G", speaker: "P", period: "A", coordinates: [1, 2, 3] }],
      ["A"],
    );
    const group = result.displaySpace.trajectory.groupOrder[0]!.canonical;
    expect(() => selectPreparedSpaceDisplay(result, { groups: [group, group] })).toThrow(
      AnalysisValidationError,
    );
    expect(() => selectPreparedSpaceDisplay(result, { groups: ["unknown"] })).toThrow(
      AnalysisValidationError,
    );
  });

  it("rejects null, short, long, duplicate, and unknown display dimension selections", async () => {
    const result = await analyzeSynthetic(
      [{ unit: "u", group: "G", speaker: "P", period: "A", coordinates: [1, 2, 3] }],
      ["A"],
    );
    const selectDimensions = (dimensions: unknown) =>
      selectPreparedSpaceDisplay(result, { dimensions } as PreparedSpaceDisplayFilter);

    for (const dimensions of [null, [], ["SVD1", "SVD2"], ["SVD1", "SVD2", "SVD3", "SVD4"]]) {
      expect(() => selectDimensions(dimensions)).toThrowError(
        expect.objectContaining({
          issues: [expect.objectContaining({ code: "INVALID_PREPARED_DISPLAY_DIMENSIONS" })],
        }),
      );
    }
    expect(() => selectDimensions(["SVD1", "SVD1", "SVD2"])).toThrowError(
      expect.objectContaining({
        issues: [expect.objectContaining({ code: "DUPLICATE_PREPARED_DISPLAY_DIMENSION" })],
      }),
    );
    expect(() => selectDimensions(["SVD1", "SVD2", "unknown"])).toThrowError(
      expect.objectContaining({
        issues: [expect.objectContaining({ code: "UNKNOWN_PREPARED_DISPLAY_DIMENSION" })],
      }),
    );
  });

  it("does not import the modeling package in the prepared reducer", () => {
    const source = readFileSync(new URL("./prepared-space.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/(?:from|import\s*\()\s*["']jena-js["']/u);
  });
});
