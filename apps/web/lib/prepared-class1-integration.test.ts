import { analyzePreparedSpace } from "@3dena/analysis";
import { decodeEna3dExchangeV1WithSha256 } from "@3dena/io";
import { describe, expect, it } from "vitest";
import {
  PREPARED_EXCHANGE_MAPPING,
  inspectPreparedExchange,
  preparedExchangePlotInput,
} from "@/lib/prepared-class1";
import { buildPreparedExchangePlotCandidate } from "@/lib/prepared-class1-plot-candidate";

function syntheticExchange() {
  const rows = [
    ["synthetic-1", "A", "alpha", "TP1", 0.1, 0.2, 0.3],
    ["synthetic-2", "A", "beta", "TP2", 0.2, 0.3, 0.4],
    ["synthetic-3", "A", "gamma", "TP3", 0.3, 0.4, 0.5],
    ["synthetic-4", "B", "delta", "TP1", -0.1, -0.2, -0.3],
    ["synthetic-5", "B", "epsilon", "TP2", -0.2, -0.3, -0.4],
    ["synthetic-6", "B", "zeta", "TP3", -0.3, -0.4, -0.5],
  ] as const;
  const metadata = [
    { name: "ENA_UNIT", type: "character", values: rows.map((row) => row[0]) },
    { name: "Group", type: "character", values: rows.map((row) => row[1]) },
    { name: "Speaker", type: "character", values: rows.map((row) => row[2]) },
    { name: "Period", type: "character", values: rows.map((row) => row[3]) },
  ];
  const edges = [
    { name: "A & B", type: "character", values: ["A", "B"] },
    { name: "A & C", type: "character", values: ["A", "C"] },
    { name: "B & C", type: "character", values: ["B", "C"] },
  ];
  return {
    format: "ena3d-exchange",
    version: 1,
    dimensions: ["SVD1", "SVD2", "SVD3"],
    group_variables: ["Group", "Speaker", "Period"],
    tables: {
      meta_data: { columns: metadata },
      points: { columns: [
        ...metadata,
        { name: "SVD1", type: "double", values: rows.map((row) => row[4]) },
        { name: "SVD2", type: "double", values: rows.map((row) => row[5]) },
        { name: "SVD3", type: "double", values: rows.map((row) => row[6]) },
      ] },
      line_weights: { columns: [
        ...metadata,
        ...edges.map(({ name }) => ({ name, type: "double", values: rows.map(() => 0.25) })),
      ] },
      nodes: { columns: [
        { name: "code", type: "character", values: ["A", "B", "C"] },
        { name: "SVD1", type: "double", values: [1, 0, 0] },
        { name: "SVD2", type: "double", values: [0, 1, 0] },
        { name: "SVD3", type: "double", values: [0, 0, 1] },
      ] },
      adjacency_key: { columns: edges },
    },
  };
}

describe("generic prepared-space vertical contract", () => {
  it("decodes synthetic bytes, reduces imported coordinates, and builds a generic plot", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(syntheticExchange()));
    const artifact = await decodeEna3dExchangeV1WithSha256(bytes);
    expect(inspectPreparedExchange(artifact.exchange)).toMatchObject({
      points: 6,
      nodes: 3,
      edges: 3,
      dimensions: 3,
      groups: 2,
      periods: ["TP1", "TP2", "TP3"],
    });
    const result = analyzePreparedSpace({
      source: { artifact, name: "synthetic-prepared.ena3d.json" },
      mapping: PREPARED_EXCHANGE_MAPPING,
    });

    expect(result).toMatchObject({
      sourceKind: "prepared-exchange",
      rawJenaRecompute: false,
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
        points: 6,
        nodes: 3,
        edges: 3,
        dimensions: 3,
        groups: 2,
        trajectoryCentroids: 6,
      },
    });
    expect(result.displaySpace.dimensions).toEqual(["SVD1", "SVD2", "SVD3"]);
    const plot = buildPreparedExchangePlotCandidate(
      preparedExchangePlotInput(result),
    );
    expect(plot.audit.contract).toBe("prepared-exchange-plot-v1");
    expect(plot.audit.trajectoryDirection).toMatchObject({
      anchor: "center",
      sizeref: 0.13,
    });
    expect(
      plot.data.filter(
        (trace) =>
          (trace as unknown as { meta?: { trajectory_role?: string } }).meta
            ?.trajectory_role === "path",
      ),
    ).toHaveLength(2);
  });
});
