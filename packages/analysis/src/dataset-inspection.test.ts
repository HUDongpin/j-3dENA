import { describe, expect, it } from "vitest";

import { DatasetInspectionError, inspectDataset } from "./dataset-inspection";

const encoder = new TextEncoder();

function exchangeBytes(): Uint8Array {
  const metadata = [
    { name: "ENA_UNIT", type: "character", values: ["u1", "u2"] },
    { name: "Group", type: "character", values: ["A", "B"] },
  ];
  return encoder.encode(JSON.stringify({
    format: "ena3d-exchange",
    version: 1,
    dimensions: ["SVD1", "SVD2", "SVD3"],
    group_variables: ["Group"],
    tables: {
      meta_data: { columns: metadata },
      points: { columns: [
        ...metadata,
        { name: "SVD1", type: "double", values: [0, 1] },
        { name: "SVD2", type: "double", values: [1, 0] },
        { name: "SVD3", type: "double", values: [0.5, -0.5] },
      ] },
      line_weights: { columns: [
        ...metadata,
        { name: "A & B", type: "double", values: [0.25, 0.75] },
      ] },
      nodes: { columns: [
        { name: "code", type: "character", values: ["A", "B"] },
        { name: "SVD1", type: "double", values: [1, -1] },
        { name: "SVD2", type: "double", values: [0, 0] },
        { name: "SVD3", type: "double", values: [0, 0] },
      ] },
      adjacency_key: { columns: [
        { name: "A & B", type: "character", values: ["A", "B"] },
      ] },
    },
  }));
}

describe("inspectDataset", () => {
  it("preflights strict UTF-8 CSV bytes and returns worksheet inventory", async () => {
    const result = await inspectDataset(
      encoder.encode("participant,group,A,B\r\np1,G1,1,0\r\np2,G2,0,1\r\n"),
      { name: "coded.csv" },
    );

    expect(result.kind).toBe("tabular");
    if (result.kind !== "tabular") throw new Error("Expected tabular inspection.");
    expect(result.inventory.receipt).toMatchObject({
      name: "coded.csv",
      format: "csv",
      byteLength: 45,
      delimiter: ",",
    });
    expect(result.inventory.worksheets).toEqual([
      expect.objectContaining({ name: "CSV", selectable: true }),
    ]);
  });

  it("returns an exact-byte prepared exchange receipt and typed inventory", async () => {
    const bytes = exchangeBytes();
    const first = await inspectDataset(bytes, { name: "candidate.ena3d.json" });
    bytes[bytes.length - 2] = 0x20;

    expect(first.kind).toBe("prepared-exchange");
    if (first.kind !== "prepared-exchange") throw new Error("Expected exchange inspection.");
    expect(first.receipt.byteLength).toBeGreaterThan(0);
    expect(first.receipt.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.inventory.dimensions).toEqual(["SVD1", "SVD2", "SVD3"]);
    expect(first.inventory.tables).toEqual([
      { name: "meta_data", rows: 2, columns: 2 },
      { name: "points", rows: 2, columns: 5 },
      { name: "line_weights", rows: 2, columns: 3 },
      { name: "nodes", rows: 2, columns: 4 },
      { name: "adjacency_key", rows: 2, columns: 1 },
    ]);
    expect(first.artifact.exchange.tables.points.columns[0]!.values).toEqual(["u1", "u2"]);
  });

  it.each(["legacy.RData", "legacy.rda", "legacy.rds"])("rejects R workspace %s", async (name) => {
    await expect(inspectDataset(encoder.encode("opaque"), { name })).rejects.toEqual(
      expect.objectContaining<Partial<DatasetInspectionError>>({ code: "R_WORKSPACE_REJECTED" }),
    );
  });

  it("rejects paths and unsupported extensions before parsing", async () => {
    await expect(inspectDataset(encoder.encode("x"), { name: "../coded.csv" })).rejects.toEqual(
      expect.objectContaining<Partial<DatasetInspectionError>>({ code: "INVALID_NAME" }),
    );
    await expect(inspectDataset(encoder.encode("x"), { name: "coded.json" })).rejects.toEqual(
      expect.objectContaining<Partial<DatasetInspectionError>>({ code: "UNSUPPORTED_FORMAT" }),
    );
  });
});
