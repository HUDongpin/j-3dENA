import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { analyzeRows } from "./analyze";
import { ANALYSIS_CONTRACT_VERSION_V1, PROVENANCE_MANIFEST_VERSION_V1, type ProvenanceManifestV1 } from "./contracts";
import { createExportBundle, ExportBundleError, type AnalysisExportPortfolioV1 } from "./export-bundle";
import { analyzeChangeNetwork, compareGroupNetworks } from "./network-analysis";
import { executeAnalysisTask, hashAnalysisValueV1, type AnalysisExecutionDatasetV1 } from "./task-executor";
import { adaptAnalysisResultTrajectorySeries } from "./trajectory-series-adapters";
import {
  analyzeTrajectoryPath,
  bootstrapTrajectoryPath,
  compareTrajectoryPaths,
  createSeededTrajectoryBootstrapPlan,
  getTrajectoryBootstrapUnits,
} from "./trajectory-statistics";
import type { AnalysisResult, AnalyzeRowsInput, RawRow } from "./types";
import { createSyntheticPreparedFixture } from "../test-support/synthetic-prepared-exchange";

const DATASET_HASH = "a".repeat(64);
const SPEC_HASH = "b".repeat(64);
const DECODER = new TextDecoder("utf-8", { fatal: true });

function csvCells(record: string): string[] {
  const cells: string[] = [];
  let cursor = 0;
  while (cursor < record.length) {
    if (record[cursor] !== '"') throw new Error(`Invalid quoted CSV record at offset ${cursor}.`);
    cursor += 1;
    let cell = "";
    while (cursor < record.length) {
      if (record[cursor] !== '"') {
        cell += record[cursor];
        cursor += 1;
        continue;
      }
      if (record[cursor + 1] === '"') {
        cell += '"';
        cursor += 2;
        continue;
      }
      cursor += 1;
      break;
    }
    cells.push(cell);
    if (cursor === record.length) break;
    if (record[cursor] !== ",") throw new Error(`Invalid CSV delimiter at offset ${cursor}.`);
    cursor += 1;
  }
  return cells;
}

function uint16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function uint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function zipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const eocd = bytes.byteLength - 22;
  expect(uint32(bytes, eocd)).toBe(0x0605_4b50);
  const count = uint16(bytes, eocd + 10);
  let cursor = uint32(bytes, eocd + 16);
  const output = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index += 1) {
    expect(uint32(bytes, cursor)).toBe(0x0201_4b50);
    const compressedBytes = uint32(bytes, cursor + 20);
    const nameBytes = uint16(bytes, cursor + 28);
    const extraBytes = uint16(bytes, cursor + 30);
    const commentBytes = uint16(bytes, cursor + 32);
    const localOffset = uint32(bytes, cursor + 42);
    const path = DECODER.decode(bytes.slice(cursor + 46, cursor + 46 + nameBytes));
    const localNameBytes = uint16(bytes, localOffset + 26);
    const localExtraBytes = uint16(bytes, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameBytes + localExtraBytes;
    output.set(path, bytes.slice(dataOffset, dataOffset + compressedBytes));
    cursor += 46 + nameBytes + extraBytes + commentBytes;
  }
  return output;
}

function rawInput(): AnalyzeRowsInput {
  const text = readFileSync(new URL("../../parity-contracts/fixtures/small-raw.csv", import.meta.url), "utf8").trim();
  const [header = "", ...lines] = text.split(/\r?\n/u);
  const columns = header.split(",").map((cell) => cell.replace(/^"|"$/gu, ""));
  const rows = lines.map((line) => {
    const cells = line.split(",").map((cell) => cell.replace(/^"|"$/gu, ""));
    return Object.fromEntries(columns.map((column, index) => [
      column,
      ["EC", "ICT", "MCO", "ATT"].includes(column) ? Number(cells[index]) : cells[index] ?? "",
    ])) as RawRow;
  });
  return {
    rows,
    mapping: {
      units: ["Group", "Name"], conversation: ["Lesson"], codes: ["EC", "ICT", "MCO", "ATT"],
      trajectory: { participant: ["Name"], group: "Group", time: "Lesson", timeOrder: ["Lesson 1", "Lesson 2"] },
    },
    config: { model: "AccumulatedTrajectory", windowSizeBack: 4 },
  };
}

async function provenance(result: unknown, sourceKind: "raw-jena" | "prepared-exchange", seed: number | null = null): Promise<ProvenanceManifestV1> {
  return {
    schemaVersion: PROVENANCE_MANIFEST_VERSION_V1,
    datasetHash: DATASET_HASH,
    specHash: SPEC_HASH,
    resultHash: await hashAnalysisValueV1(result),
    adapterVersion: "0.1.0",
    jenaPackage: "jena-js",
    jenaVersion: "0.6.2",
    jenaCommit: "2f63db4c6ccf5684afc8437ae81ed1a3ccd0c1a3",
    sourceKind,
    jenaExecuted: sourceKind === "raw-jena",
    sdkPackage: "@3dena/analysis",
    sdkVersion: "0.1.0",
    appVersion: "test",
    contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
    buildId: "export-test-build",
    seed,
    toleranceContract: null,
    schemaVersions: ["3dena.export-test.v1"],
    generatedAt: "2026-08-20T12:00:00.000Z",
  };
}

function executionDataset(result: AnalysisResult, hash: string): AnalysisExecutionDatasetV1 {
  return {
    schemaVersion: "3dena.analysis-execution-dataset.v1",
    receipt: {
      schemaVersion: "3dena.dataset-receipt.v1",
      sha256: DATASET_HASH,
      byteLength: 512,
      format: "csv",
      sheet: { index: 0, name: "CSV" },
      rows: 16,
      columns: 7,
      schema: {
        schemaVersion: "3dena.dataset-schema.v1",
        headers: ["Group", "Name", "Lesson", "EC", "ICT", "MCO", "ATT"],
        columns: [
          { name: "Group", inferredType: "string", roles: ["unit", "group"] },
          { name: "Name", inferredType: "string", roles: ["unit"] },
          { name: "Lesson", inferredType: "string", roles: ["conversation", "time"] },
          { name: "EC", inferredType: "number", roles: ["code"] },
          { name: "ICT", inferredType: "number", roles: ["code"] },
          { name: "MCO", inferredType: "number", roles: ["code"] },
          { name: "ATT", inferredType: "number", roles: ["code"] },
        ],
      },
      limits: {
        schemaVersion: "3dena.dataset-limits.v1",
        maxFileBytes: 5 * 1024 * 1024,
        maxWorksheets: 32,
        maxRows: 100_000,
        maxColumns: 256,
        maxCells: 5_000_000,
      },
      warnings: [],
      activationIdentity: `dataset:${DATASET_HASH}`,
    },
    specHash: SPEC_HASH,
    buildId: "export-test-build",
    generatedAt: "2026-08-20T12:00:00.000Z",
    sourceResult: { result, hash },
  };
}

describe("createExportBundle", () => {
  it("emits a deterministic formal raw ZIP with RFC 4180 tables and a checksum manifest", async () => {
    const result = analyzeRows(rawInput());
    const options = { provenance: await provenance(result, "raw-jena"), fileName: "small-raw-analysis.zip" };
    const first = await createExportBundle(result, options);
    const second = await createExportBundle(result, options);
    const entries = zipEntries(first.bytes);

    expect(first.sha256).toBe(second.sha256);
    expect(first.bytes).toEqual(second.bytes);
    expect(first.fileName).toBe("small-raw-analysis.zip");
    expect([...entries.keys()].sort()).toEqual([
      "centroids.csv", "coordinates.csv", "diagnostics.csv", "edges.csv", "lineweights.csv", "manifest.json",
      "model-counts.csv", "nodes.csv", "rotation.csv", "source-row-counts.csv", "summary.json", "variance.csv",
    ]);
    const coordinates = DECODER.decode(entries.get("coordinates.csv")!);
    expect(coordinates).toMatch(/^"point_index","point_key_v1"/u);
    expect(coordinates.endsWith("\r\n")).toBe(true);
    expect(coordinates.split("\r\n")).toHaveLength(result.points.length + 2);
    const manifest = JSON.parse(DECODER.decode(entries.get("manifest.json")!));
    expect(manifest).toMatchObject({
      schemaVersion: "3dena.export-manifest.v1",
      formalScientificExport: true,
      displayFilteringApplied: false,
      sourceResultSchema: "3dena.analysis-result.v1",
      provenance: { resultHash: options.provenance.resultHash, sourceKind: "raw-jena", jenaExecuted: true },
    });
    expect(manifest.scientificEntries.some((entry: { path: string }) => entry.path === "manifest.json")).toBe(false);
    expect(first.entries.at(-1)?.path).toBe("manifest.json");
  });

  it("exports prepared coordinates without inventing rotation/eigen/variance artifacts", async () => {
    const { result } = await createSyntheticPreparedFixture();
    const bundle = await createExportBundle(result, { provenance: await provenance(result, "prepared-exchange") });
    const paths = [...zipEntries(bundle.bytes).keys()];

    expect(paths).toContain("prepared-artifacts.json");
    expect(paths).not.toContain("rotation.csv");
    expect(paths).not.toContain("variance.csv");
    expect(bundle.manifest.provenance).toMatchObject({ sourceKind: "prepared-exchange", jenaExecuted: false });
  });

  it("adds applicable Comparison, Change, Stats, trajectory, comparison, and bootstrap products", async () => {
    const analysis = analyzeRows(rawInput());
    const sourceHash = await hashAnalysisValueV1(analysis);
    const groups = analysis.trajectory!.groupOrder.map((group) => group.canonical) as [string, string];
    const owner = (taskId: string) => ({
      contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
      datasetHash: DATASET_HASH,
      specHash: SPEC_HASH,
      runId: "run-export",
      taskId,
    });
    const statsEnvelope = await executeAnalysisTask(executionDataset(analysis, sourceHash), {
      schemaVersion: "3dena.analysis-task.v1",
      kind: "statistics",
      owner: owner("stats"),
      deadlineEpochMilliseconds: 4_000_000_000_000,
      sourceResultHash: sourceHash,
      design: "independent",
      groups,
      dimensions: ["SVD1", "SVD4"],
      alternative: "two-sided",
      adjustment: "holm",
      samePhysicalEntityConfirmed: false,
    });
    if (statsEnvelope.result.schemaVersion !== "3dena.statistics-task-result.v1") throw new Error("Expected stats result.");
    const statistics = structuredClone(statsEnvelope.result);
    for (const dimension of statistics.dimensions) {
      if (dimension.result.design !== "independent") continue;
      dimension.result.samples.sideA.droppedMissing = 2;
      dimension.result.samples.sideB.droppedMissing = 3;
    }
    const sideA = adaptAnalysisResultTrajectorySeries(analysis, { group: groups[0], namespace: "A" });
    const sideB = adaptAnalysisResultTrajectorySeries(analysis, { group: groups[1], namespace: "B" });
    const trajectory = analyzeTrajectoryPath(sideA);
    const trajectoryComparison = compareTrajectoryPaths({
      design: "independent",
      sideA: { label: "A", series: sideA },
      sideB: { label: "B", series: sideB },
    });
    const units = getTrajectoryBootstrapUnits({ series: sideA, stratifyBy: "none" });
    const plan = createSeededTrajectoryBootstrapPlan({ units, repetitions: 200, seed: 2026 });
    const bootstrap = bootstrapTrajectoryPath({ series: sideA, stratifyBy: "none", confidenceLevel: 0.95, plan });
    const portfolio: AnalysisExportPortfolioV1 = {
      schemaVersion: "3dena.analysis-export-portfolio.v1",
      analysis,
      comparison: compareGroupNetworks(analysis, groups),
      change: analyzeChangeNetwork(analysis, { field: "@group", level: analysis.trajectory!.groupOrder[0]!.value }),
      statistics,
      trajectory,
      trajectoryComparison,
      bootstrap,
    };
    const bundle = await createExportBundle(portfolio, { provenance: await provenance(portfolio, "raw-jena", 2026) });
    const paths = [...zipEntries(bundle.bytes).keys()];

    expect(paths).toEqual(expect.arrayContaining([
      "comparison.csv", "change.csv", "statistics.csv", "trajectory.csv", "trajectory-comparison.csv", "uncertainty.csv",
    ]));
    const statisticsCsv = DECODER.decode(zipEntries(bundle.bytes).get("statistics.csv")!);
    expect(statisticsCsv).toContain("welch-t-v1");
    expect(statisticsCsv).toContain("welch-t-mean-difference-v1");
    expect(statisticsCsv).toMatch(/^"dimension","design","method","mean_difference","mean_difference_ci_method","confidence_level","ci_alternative","ci_lower_kind","ci_lower_value","ci_upper_kind","ci_upper_value"/u);
    const [statisticsHeader = "", ...statisticsRecords] = statisticsCsv.trimEnd().split("\r\n");
    const statisticsColumns = csvCells(statisticsHeader);
    const statisticsRows = statisticsRecords.map(csvCells);
    expect(statisticsColumns).toHaveLength(20);
    for (const row of statisticsRows) expect(row).toHaveLength(statisticsColumns.length);
    const rankSumRow = statisticsRows.find((row) => row[2] === "mann-whitney-asymptotic-v1");
    expect(rankSumRow).toBeDefined();
    expect(rankSumRow![4]).toBe("");
    for (const row of statisticsRows.filter((candidate) => candidate[1] === "independent")) {
      expect(row[18]).toBe("5");
      expect(row[19]).toBe("");
    }
    expect(DECODER.decode(zipEntries(bundle.bytes).get("uncertainty.csv")!)).toContain("selected-centroid");
  });

  it("exports explicit elapsed, speed, estimand, and effective-N trajectory dynamics", async () => {
    const analysis = analyzeRows(rawInput());
    const sourceHash = await hashAnalysisValueV1(analysis);
    const group = analysis.trajectory!.groupOrder[0]!.canonical;
    const envelope = await executeAnalysisTask(executionDataset(analysis, sourceHash), {
      schemaVersion: "3dena.analysis-task.v1",
      kind: "trajectory",
      owner: {
        contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
        datasetHash: DATASET_HASH,
        specHash: SPEC_HASH,
        runId: "run-export",
        taskId: "trajectory-dynamics",
      },
      deadlineEpochMilliseconds: 4_000_000_000_000,
      sourceResultHash: sourceHash,
      group,
      selectedDimensions: ["SVD1", "SVD2", "SVD3"],
      cohortPolicy: "available",
      periods: analysis.trajectory!.timeOrder.map((time, index) => ({
        sourceTimeCanonical: time.canonical,
        value: { type: "numeric-v1", value: index * 2, unit: "study-week" },
      })),
      estimand: { kind: "equal-participant-v1" },
    });
    if (envelope.result.schemaVersion !== "3dena.trajectory-dynamics.v1") throw new Error("Expected trajectory dynamics result.");
    const portfolio: AnalysisExportPortfolioV1 = {
      schemaVersion: "3dena.analysis-export-portfolio.v1",
      analysis,
      trajectory: envelope.result,
    };
    const bundle = await createExportBundle(portfolio, { provenance: await provenance(portfolio, "raw-jena") });
    const trajectoryCsv = DECODER.decode(zipEntries(bundle.bytes).get("trajectory.csv")!);
    expect(trajectoryCsv).toContain("\"elapsed_from_previous\"");
    expect(trajectoryCsv).toContain("\"selected_speed\"");
    expect(trajectoryCsv).toContain("\"effective_participant_n\"");
    expect(trajectoryCsv).toContain("\"equal-participant-v1\"");
  });

  it("rejects stale result hashes, source-kind inflation, and unsafe filenames", async () => {
    const result = analyzeRows(rawInput());
    const valid = await provenance(result, "raw-jena");
    await expect(createExportBundle(result, { provenance: { ...valid, resultHash: "c".repeat(64) } })).rejects.toEqual(
      expect.objectContaining<Partial<ExportBundleError>>({ code: "RESULT_HASH_MISMATCH" }),
    );
    await expect(createExportBundle(result, {
      provenance: { ...valid, sourceKind: "prepared-exchange", jenaExecuted: false },
    })).rejects.toEqual(expect.objectContaining<Partial<ExportBundleError>>({ code: "PROVENANCE_SOURCE_MISMATCH" }));
    await expect(createExportBundle(result, { provenance: valid, fileName: "../result.zip" })).rejects.toEqual(
      expect.objectContaining<Partial<ExportBundleError>>({ code: "INVALID_EXPORT_FILE_NAME" }),
    );
  });
});
