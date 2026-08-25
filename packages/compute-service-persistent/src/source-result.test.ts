import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ANALYSIS_CONTRACT_VERSION_V1,
  ANALYSIS_TASK_VERSION_V1,
  DATASET_RECEIPT_VERSION_V1,
  executeAnalysisTask,
  hashAnalysisValueV1,
  type AnalysisExecutionDatasetV1,
  type AnalysisExecutionDatasetV2,
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
import {
  createSyntheticPreparedExchangeBytes,
  createSyntheticPreparedFixture,
  createSyntheticPreparedMapping,
} from "../../analysis/test-support/synthetic-prepared-exchange";

const DATASET_HASH = "a".repeat(64);
const SPEC_HASH = "b".repeat(64);
const NOW = Date.parse("2026-08-21T12:00:00.000Z");

class SourcePool implements PgCompatiblePool, PgCompatibleClient {
  readonly statements: string[] = [];
  readonly publications: Record<string, unknown>[] = [];
  nowMs = NOW;
  activePublicationId: number | undefined;
  #nextPublicationId = 1;
  async connect(): Promise<PgCompatibleClient> { return this; }
  release(): void {}
  async query<Row extends Record<string, unknown>>(
    sql: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.statements.push(sql);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
    if (sql.includes("pg_advisory_xact_lock")) {
      return { rows: [{}] as Row[], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO compute_scientific_result_publications")) {
      const publicationId = this.#nextPublicationId;
      this.#nextPublicationId += 1;
      const generation = this.publications
        .filter((row) => row.result_hash === values[0])
        .reduce((maximum, row) => Math.max(maximum, Number(row.generation)), 0) + 1;
      this.publications.push({
        publication_id: publicationId, generation,
        result_hash: values[0], dataset_hash: values[1], spec_hash: values[2],
        build_id: values[3], task_id: values[4], object_key: values[5],
        object_sha256: values[6], object_byte_length: values[7],
        published_at_ms: values[8], expires_at_ms: values[9],
        publication_receipt: JSON.parse(String(values[10])),
      });
      return {
        rows: [{ publication_id: publicationId, generation }] as unknown as Row[],
        rowCount: 1,
      };
    }
    if (sql.includes("INSERT INTO compute_scientific_result_active")) {
      this.activePublicationId = Number(values[1]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("DELETE FROM compute_scientific_result_active") &&
        sql.includes("result_hash = $1")) {
      const active = this.publications.find(
        (row) => row.publication_id === this.activePublicationId,
      );
      if (active === undefined || active.result_hash !== values[0] ||
          Number(active.expires_at_ms) > this.nowMs) {
        return { rows: [], rowCount: 0 };
      }
      this.activePublicationId = undefined;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("DELETE FROM compute_scientific_result_active")) {
      const active = this.publications.find(
        (row) => row.publication_id === this.activePublicationId,
      );
      if (active === undefined || Number(active.expires_at_ms) > this.nowMs) {
        return { rows: [], rowCount: 0 };
      }
      this.activePublicationId = undefined;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("FROM compute_scientific_result_active") &&
        sql.includes("compute_scientific_result_publications")) {
      const active = this.publications.find(
        (row) => row.publication_id === this.activePublicationId,
      );
      const requestedNow = sql.includes("to_timestamp($4")
        ? Math.max(Number(values[3]), this.nowMs)
        : this.nowMs;
      const matches = active !== undefined &&
        Number(active.expires_at_ms) > requestedNow &&
        active.result_hash === values[0] &&
        (!sql.includes("dataset_hash = $2") || active.dataset_hash === values[1]) &&
        (!sql.includes("build_id = $3") || active.build_id === values[2]);
      return {
        rows: (matches ? [structuredClone(active)] : []) as Row[],
        rowCount: matches ? 1 : 0,
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
    const resolverStatement = pool.statements.find((sql) =>
      sql.includes("to_timestamp($4") &&
      sql.includes("FROM compute_scientific_result_active"));
    expect(resolverStatement).toContain("clock_timestamp()");
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
    expect(pool.statements.join("\n"))
      .not.toMatch(/UPDATE\s+compute_scientific_result_publications/iu);
  });

  it("rebinds an expired result hash to a new immutable publication generation", async () => {
    const taskFor = (taskId: string, runId: string): AnalysisTaskV1 => ({
      schemaVersion: ANALYSIS_TASK_VERSION_V1,
      kind: "ena-model",
      owner: {
        contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
        datasetHash: DATASET_HASH,
        specHash: SPEC_HASH,
        runId,
        taskId,
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
    });
    const firstEnvelope = await executeAnalysisTask(
      executionDataset(),
      taskFor("source-task-generation-1", "source-run-generation-1"),
    );
    const secondEnvelope = await executeAnalysisTask(
      executionDataset(),
      taskFor("source-task-generation-2", "source-run-generation-2"),
    );
    expect(secondEnvelope.provenance.resultHash)
      .toBe(firstEnvelope.provenance.resultHash);

    const store = new InMemoryComputeObjectStore();
    const firstObject = await store.putImmutable(
      "compute-results/source-task-generation-1/result.json",
      new TextEncoder().encode(JSON.stringify({
        version: "3dena.compute-scientific-result-artifact.v1",
        owner: firstEnvelope.owner,
        taskKind: "ena-model",
        envelope: firstEnvelope,
      })),
    );
    const secondObject = await store.putImmutable(
      "compute-results/source-task-generation-2/result.json",
      new TextEncoder().encode(JSON.stringify({
        version: "3dena.compute-scientific-result-artifact.v1",
        owner: secondEnvelope.owner,
        taskKind: "ena-model",
        envelope: secondEnvelope,
      })),
    );
    const pool = new SourcePool();
    const registry = new PostgresPublishedSourceResultRegistry(
      new PostgresDatabase(pool),
      store,
    );
    const firstRecord = {
      sourceResultHash: firstEnvelope.provenance.resultHash,
      owner: firstEnvelope.owner,
      buildId: "fly-build-1",
      object: firstObject.descriptor,
      publishedAtMs: NOW - 1_000,
      expiresAtMs: NOW + 60_000,
      publicationReceipt: { version: "test-publication-receipt.v1", generation: 1 },
    } as const;
    const secondRecord = {
      sourceResultHash: secondEnvelope.provenance.resultHash,
      owner: secondEnvelope.owner,
      buildId: "fly-build-1",
      object: secondObject.descriptor,
      publishedAtMs: NOW + 60_000,
      expiresAtMs: NOW + 120_000,
      publicationReceipt: { version: "test-publication-receipt.v1", generation: 2 },
    } as const;

    await expect(registry.record(firstRecord)).resolves.toBeUndefined();
    await expect(registry.record(secondRecord)).rejects.toMatchObject({
      code: "DATABASE_CONFLICT",
    });
    expect(pool.publications).toHaveLength(1);

    pool.nowMs = NOW + 60_000;
    await expect(registry.record(secondRecord)).resolves.toBeUndefined();
    expect(pool.publications).toHaveLength(2);
    expect(pool.publications.map((row) => row.generation)).toEqual([1, 2]);
    expect(pool.publications.map((row) => row.task_id)).toEqual([
      "source-task-generation-1",
      "source-task-generation-2",
    ]);
    await expect(registry.resolve({
      sourceResultHash: secondEnvelope.provenance.resultHash,
      activatedDatasetSha256: DATASET_HASH,
      requiredBuildId: "fly-build-1",
      nowMs: NOW + 60_001,
    })).resolves.toMatchObject({ owner: secondEnvelope.owner });

    pool.nowMs = NOW + 120_000;
    await expect(registry.purgeExpiredActiveMappings()).resolves.toBe(1);
    expect(pool.publications).toHaveLength(2);
    expect(pool.activePublicationId).toBeUndefined();
    await expect(registry.resolve({
      sourceResultHash: secondEnvelope.provenance.resultHash,
      activatedDatasetSha256: DATASET_HASH,
      requiredBuildId: "fly-build-1",
      nowMs: NOW + 120_000,
    })).resolves.toBeNull();
    const statements = pool.statements.join("\n");
    expect(statements).toContain("pg_advisory_xact_lock");
    expect(statements).not.toMatch(/DELETE\s+FROM\s+compute_scientific_result_publications/iu);
    expect(statements).not.toMatch(/(?:UPDATE|DELETE)\s+compute_scientific_results/iu);
  });

  it("resolves a primary prepared import without recasting it as raw jENA", async () => {
    const fixture = await createSyntheticPreparedFixture();
    const bytes = createSyntheticPreparedExchangeBytes();
    const mapping = createSyntheticPreparedMapping();
    const specHash = await hashAnalysisValueV1({ kind: "prepared-import", mapping });
    const dataset: AnalysisExecutionDatasetV2 = {
      schemaVersion: "3dena.analysis-execution-dataset.v2",
      receipt: {
        schemaVersion: DATASET_RECEIPT_VERSION_V1,
        sha256: fixture.artifact.sha256,
        byteLength: fixture.artifact.byteLength,
        format: "ena3d-json",
        sheet: null,
        rows: fixture.result.fullSpace.points.length,
        columns: fixture.result.fullSpace.dimensions.length,
        schema: {
          schemaVersion: "3dena.dataset-schema.v1",
          headers: [...fixture.result.fullSpace.dimensions],
          columns: fixture.result.fullSpace.dimensions.map((name) => ({
            name,
            inferredType: "number",
            roles: ["unmapped"],
          })),
        },
        limits: {
          schemaVersion: "3dena.dataset-limits.v1",
          maxFileBytes: 2 * 1024 * 1024,
          maxWorksheets: 1,
          maxRows: 50_000,
          maxColumns: 200,
          maxCells: 20_000_000,
        },
        warnings: [],
        activationIdentity: `prepared:${fixture.artifact.sha256}:${specHash}`,
      },
      specHash,
      buildId: "fly-build-prepared",
      generatedAt: new Date(NOW).toISOString(),
    };
    const task: Extract<AnalysisTaskV1, { kind: "prepared-import" }> = {
      schemaVersion: ANALYSIS_TASK_VERSION_V1,
      kind: "prepared-import",
      owner: {
        contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
        datasetHash: fixture.artifact.sha256,
        specHash,
        runId: "prepared-source-run",
        taskId: "prepared-source-task",
      },
      deadlineEpochMilliseconds: 4_000_000_000_000,
      input: {
        sourceName: "uploaded.ena3d.json",
        exactBytesBase64: Buffer.from(bytes).toString("base64"),
        mapping,
      },
    };
    const envelope = await executeAnalysisTask(dataset, task);
    const artifact = {
      version: "3dena.compute-scientific-result-artifact.v1",
      owner: envelope.owner,
      taskKind: "prepared-import",
      envelope,
    };
    const store = new InMemoryComputeObjectStore();
    const put = await store.putImmutable(
      "compute-results/prepared-source-task/result.json",
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
      buildId: "fly-build-prepared",
      object: put.descriptor,
      publishedAtMs: NOW - 1_000,
      expiresAtMs: NOW + 60_000,
      publicationReceipt: { version: "test-prepared-publication-receipt.v1" },
    });
    await expect(registry.resolve({
      sourceResultHash: envelope.provenance.resultHash,
      activatedDatasetSha256: fixture.artifact.sha256,
      requiredBuildId: "fly-build-prepared",
      nowMs: NOW,
    })).resolves.toMatchObject({
      source: {
        sourceKind: "prepared-exchange",
        hash: envelope.provenance.resultHash,
        result: { schemaVersion: "3dena.prepared-space-result.v1" },
      },
      owner: envelope.owner,
      buildId: "fly-build-prepared",
    });
  });
});
