import { decodeEna3dExchangeV1WithSha256 } from "@3dena/io";

import { analyzePreparedSpace } from "../src/prepared-space";
import type { PreparedDisplayDimensions, PreparedSpaceMapping } from "../src/prepared-types";

export const SYNTHETIC_PREPARED_DIMENSIONS = Object.freeze([
  "SVD1",
  "SVD2",
  "SVD3",
  "SVD4",
  "SVD5",
] as const);

export const SYNTHETIC_PREPARED_GROUPS = Object.freeze([
  "cohort-alpha",
  "cohort-beta",
] as const);

export const SYNTHETIC_PREPARED_PERIODS = Object.freeze([
  "phase-one",
  "phase-two",
  "phase-three",
] as const);

const SYNTHETIC_PREPARED_ACTORS = Object.freeze([
  "actor-one",
  "actor-two",
  "actor-three",
] as const);

function column(name: string, type: "character" | "double", values: Array<string | number>) {
  return { name, type, values };
}

/**
 * Builds a deliberately artificial exchange document. The identities and
 * coordinates are invented for contract tests and are unrelated to any
 * governed study, quarantined artifact, or oracle output.
 */
export function createSyntheticPreparedExchangeBytes(): Uint8Array {
  const rows = SYNTHETIC_PREPARED_GROUPS.flatMap((group, groupIndex) =>
    SYNTHETIC_PREPARED_ACTORS.flatMap((actor, actorIndex) =>
      SYNTHETIC_PREPARED_PERIODS.map((period, periodIndex) => ({
        unit: `synthetic-row-${groupIndex + 1}-${actorIndex + 1}-${periodIndex + 1}`,
        group,
        actor,
        period,
        coordinates: [
          groupIndex * 4 + actorIndex + periodIndex * 0.25,
          groupIndex * -2 + actorIndex * 0.5 - periodIndex * 0.4,
          groupIndex + actorIndex * -0.75 + periodIndex * 0.6,
          (groupIndex + 1) * (actorIndex + 1) + periodIndex * 0.125,
          (groupIndex - actorIndex) * 0.8 + periodIndex * 0.33,
        ],
      })),
    ),
  );

  const metadata = [
    column("ENA_UNIT", "character", rows.map((row) => row.unit)),
    column("Cohort", "character", rows.map((row) => row.group)),
    column("Actor", "character", rows.map((row) => row.actor)),
    column("Phase", "character", rows.map((row) => row.period)),
  ];
  const dimensions = SYNTHETIC_PREPARED_DIMENSIONS.map((name, dimensionIndex) =>
    column(name, "double", rows.map((row) => row.coordinates[dimensionIndex]!)),
  );
  const adjacency = [
    column("A & B", "character", ["A", "B"]),
    column("A & C", "character", ["A", "C"]),
    column("B & C", "character", ["B", "C"]),
  ];
  const lineWeights = adjacency.map((edge, edgeIndex) =>
    column(edge.name, "double", rows.map((_, rowIndex) => (edgeIndex + 1) * 0.1 + rowIndex * 0.01)),
  );
  const nodeCoordinates = [
    [1, 0, 0, 0.5, -0.25],
    [0, 1, 0, -0.5, 0.75],
    [0, 0, 1, 0.25, 0.5],
  ];
  const exchange = {
    format: "ena3d-exchange",
    version: 1,
    dimensions: [...SYNTHETIC_PREPARED_DIMENSIONS],
    group_variables: ["Cohort", "Actor", "Phase"],
    tables: {
      meta_data: { columns: metadata },
      points: { columns: [...metadata, ...dimensions] },
      line_weights: { columns: [...metadata, ...lineWeights] },
      nodes: {
        columns: [
          column("code", "character", ["A", "B", "C"]),
          ...SYNTHETIC_PREPARED_DIMENSIONS.map((name, dimensionIndex) =>
            column(name, "double", nodeCoordinates.map((coordinates) => coordinates[dimensionIndex]!)),
          ),
        ],
      },
      adjacency_key: { columns: adjacency },
    },
  };

  return new TextEncoder().encode(JSON.stringify(exchange));
}

export function createSyntheticPreparedMapping(
  displayDimensions: PreparedDisplayDimensions = ["SVD1", "SVD2", "SVD3"],
): PreparedSpaceMapping {
  return {
    participant: ["Cohort", "Actor"],
    participantLabel: "Actor",
    group: "Cohort",
    time: "Phase",
    timeOrder: [...SYNTHETIC_PREPARED_PERIODS],
    cohortPolicy: "available",
    displayDimensions: [...displayDimensions],
    missingDisplayCoordinates: "reject",
  };
}

export async function createSyntheticPreparedFixture() {
  const artifact = await decodeEna3dExchangeV1WithSha256(createSyntheticPreparedExchangeBytes());
  const result = analyzePreparedSpace({
    source: { artifact, name: "synthetic-prepared.ena3d.json" },
    mapping: createSyntheticPreparedMapping(),
  });
  return { artifact, result };
}
