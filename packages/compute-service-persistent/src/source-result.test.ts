import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ANALYSIS_CONTRACT_VERSION_V1,
  ANALYSIS_TASK_VERSION_V1,
  DATASET_RECEIPT_VERSION_V1,
  executeAnalysisTask,
  type AnalysisExecutionDatasetV1,
  type AnalysisTaskV1,
  type RawRow,
} from "@3dena/analysis";
import { InMemoryComputeObjectStore } from "@3dena/compute-service-core";

import {
  PostgresDatabase,
  type PgCompatibleClient,
  type PgCompatiblePool,
  type SqlQueryResult,
} from "./postgres";
import { PostgresPublishedSourceResultRegistry } from "./source-result";

const DATASET_HASH = "a".repeat(64);
const SPEC_HASH = "b".repeat(64);
const NOW = Date.parse("2026-08-21T12:00:00.000Z");

class SourcePool implements PgCompatiblePool, PgCompatibleClient {
  readonly statements: string[] = [];
  row: Record<string, unknown> | undefined;
  async connect(): Promise<PgCompatibleClient> { return this; }
  release(): void {}
  async query<Row extends Record<string, unknown>>(
    sql: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.statements.push(sql);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
    if (sql.includes("INSERT INTO compute_scientific_results")) {
      if (this.row !== undefined) return { rows: [], rowCount: 0 };
      this.row = {
        result_hash: values[0], dataset_hash: values[1], spec_hash: values[2],
        build_id: values[3], task_id: values[4], object_key: values[5],
        object_sha256: values[6], object_byte_length: values[7],
        published_at_ms: values[8], expires_at_ms: values[9],
        publication_receipt: JSON.parse(String(values[10])),
      };
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("FROM compute_scientific_results")) {
      return {
        rows: (this.row === undefined ? [] : [this.row]) as Row[],
        rowCount: this.row === undefined ? 0 : 1,
      };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

function rows(): RawRow[] {
  const text = readFileSync(
    new URL("../../parity-contracts/fixtures/small-raw.csv", import.meta.url),
    "utf8",
  ).trim();
  const [header = "", ...lines] = text.split(/\r?\n/u);
  const columns = header.split(",").map((cell) => cell.replace(/^"|"$/gu, ""));
  return lines.map((line) => {
    const cells = line.split(",").map((cell) => cell.replace(/^"|"$/gu, ""));
    return Object.fromEntries(columns.map((column, index) => [
      column,
      ["EC", "ICT", "MCO", "ATT"].includes(column)
        ? Number(cells[index])
        : cells[index] ?? "",
    ])) as RawRow;
  });
}

function executionDataset(): AnalysisExecutionDatasetV1 {
  return {
    schemaVersion: "3dena.analysis-execution-dataset.v1",
    receipt: {
      schemaVersion: DATASET_RECEIPT_VERSION_V1,
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
        maxFileBytes: 5_242_880,
        maxWorksheets: 32,
        maxRows: 100_000,
        maxColumns: 256,
        maxCells: 5_000_000,
      },
      warnings: [],
      activationIdentity: `dataset:${DATASET_HASH}`,
    },
    specHash: SPEC_HASH,
    buildId: "fly-build-1",
    generatedAt: new Date(NOW).toISOString(),
  };
}

describe("PostgresPublishedSourceResultRegistry", () => {
  it("resolves exact published raw results and rejects mixed/stale ownership", async () => {
    const task: AnalysisTaskV1 = {
      schemaVersion: ANALYSIS_TASK_VERSION_V1,
      kind: "ena-model",
      owner: {
        contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
        datasetHash: DATASET_HASH,
        specHash: SPEC_HASH,
        runId: "source-run",
        taskId: "source-task",
      },
      deadlineEpochMilliseconds: 4_000_000_000_000,
      input: {
        rows: rows(),
        mapping: {
          units: ["Group", "Name"],
          conversation: ["Lesson"],
          codes: ["EC", "ICT", "MCO", "ATT"],
        },
      },
    };
    const envelope = await executeAnalysisTask(executionDataset(), task);
    const artifact = {
      version: "3dena.compute-scientific-result-artifact.v1",
      owner: envelope.owner,
      taskKind: "ena-model",
      envelope,
    };
    const store = new InMemoryComputeObjectStore();
    const put = await store.putImmutable(
      "compute-results/source-task/result.json",
      new TextEncoder().encode(JSON.stringify(artifact)),
    );
    const pool = new SourcePool();
    const registry = new PostgresPublishedSourceResultRegistry(
      new PostgresDatabase(pool),
      store,
    );
    await registry.record({
      sourceResultHash: envelope.provenance.resultHash,
      owner: envelope.owner,
      buildId: "fly-build-1",
      object: put.descriptor,
      publishedAtMs: NOW - 1_000,
      expiresAtMs: NOW + 60_000,
      publicationReceipt: { version: "test-publication-receipt.v1" },
    });
    await expect(registry.record({
      sourceResultHash: envelope.provenance.resultHash,
      owner: envelope.owner,
      buildId: "fly-build-1",
      object: put.descriptor,
      publishedAtMs: NOW - 1_000,
      expiresAtMs: NOW + 60_000,
      publicationReceipt: { version: "test-publication-receipt.v1" },
    })).resolves.toBeUndefined();
    await expect(registry.record({
      sourceResultHash: envelope.provenance.resultHash,
      owner: envelope.owner,
      buildId: "fly-build-conflict",
      object: put.descriptor,
      publishedAtMs: NOW - 1_000,
      expiresAtMs: NOW + 60_000,
      publicationReceipt: { version: "test-publication-receipt.v1" },
    })).rejects.toMatchObject({ code: "DATABASE_CONFLICT" });
    await expect(registry.resolve({
      sourceResultHash: envelope.provenance.resultHash,
      activatedDatasetSha256: DATASET_HASH,
      requiredBuildId: "fly-build-1",
      nowMs: NOW,
    })).resolves.toMatchObject({
      source: { sourceKind: "raw-jena", hash: envelope.provenance.resultHash },
      owner: envelope.owner,
      buildId: "fly-build-1",
    });
    await expect(registry.resolve({
      sourceResultHash: envelope.provenance.resultHash,
      activatedDatasetSha256: DATASET_HASH,
      requiredBuildId: "fly-build-mixed",
      nowMs: NOW,
    })).resolves.toBeNull();
    await expect(registry.resolve({
      sourceResultHash: envelope.provenance.resultHash,
      activatedDatasetSha256: "c".repeat(64),
      requiredBuildId: "fly-build-1",
      nowMs: NOW,
    })).resolves.toBeNull();
    await expect(registry.resolve({
      sourceResultHash: envelope.provenance.resultHash,
      activatedDatasetSha256: DATASET_HASH,
      requiredBuildId: "fly-build-1",
      nowMs: NOW + 60_000,
    })).resolves.toBeNull();
    expect(pool.statements.join("\n")).not.toMatch(/UPDATE\s+compute_scientific_results/iu);
  });
});
