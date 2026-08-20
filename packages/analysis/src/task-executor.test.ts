import { readFileSync } from "node:fs";

import Ajv from "ajv";
import { describe, expect, it } from "vitest";

import {
  ANALYSIS_CONTRACT_VERSION_V1,
  ANALYSIS_TASK_VERSION_V1,
  DATASET_RECEIPT_VERSION_V1,
  CONTRACT_SCHEMAS_V1,
  assertAnalysisResultEnvelopeV1,
  type AnalysisTaskV1,
} from "./contracts";
import {
  ANALYSIS_EXECUTION_DATASET_VERSION_V2,
  AnalysisTaskExecutionError,
  assertAnalysisExecutionDatasetV2,
  executeAnalysisTask,
  type AnalysisExecutionDatasetV1,
  type AnalysisExecutionDatasetV2,
} from "./task-executor";
import type { AnalysisResult, AnalyzeRowsInput, RawRow } from "./types";

const DATASET_HASH = "a".repeat(64);
const SPEC_HASH = "b".repeat(64);
const DEADLINE = 4_000_000_000_000;
const EXECUTION_DATASET_SCHEMA_ID = "https://3dena.com/schemas/analysis-execution-dataset.v2.json";
const ajv = new Ajv({ strict: false, strictNumbers: true, allErrors: true, validateFormats: false });
for (const schema of Object.values(CONTRACT_SCHEMAS_V1)) ajv.addSchema(schema);

function expectValidEnvelopeSchema(value: unknown): void {
  expect(
    ajv.validate(CONTRACT_SCHEMAS_V1.resultEnvelope.$id, value),
    JSON.stringify(ajv.errors),
  ).toBe(true);
}

function readSmallRaw(): RawRow[] {
  const text = readFileSync(new URL("../../parity-contracts/fixtures/small-raw.csv", import.meta.url), "utf8").trim();
  const [header = "", ...lines] = text.split(/\r?\n/u);
  const columns = header.split(",").map((cell) => cell.replace(/^"|"$/gu, ""));
  return lines.map((line) => {
    const cells = line.split(",").map((cell) => cell.replace(/^"|"$/gu, ""));
    return Object.fromEntries(columns.map((column, index) => [
      column,
      ["EC", "ICT", "MCO", "ATT"].includes(column) ? Number(cells[index]) : cells[index] ?? "",
    ])) as RawRow;
  });
}

function analysisInput(): AnalyzeRowsInput {
  return {
    rows: readSmallRaw().map((row) => ({ ...row, Weight: row.Group === "G1" ? 1 : 2 })),
    mapping: {
      units: ["Group", "Name"],
      conversation: ["Lesson"],
      codes: ["EC", "ICT", "MCO", "ATT"],
      metadata: ["Weight"],
      trajectory: {
        participant: ["Name"],
        group: "Group",
        time: "Lesson",
        timeOrder: ["Lesson 1", "Lesson 2"],
        cohortPolicy: "available",
      },
    },
    config: {
      model: "AccumulatedTrajectory",
      window: "MovingStanzaWindow",
      weightBy: "binary",
      windowSizeBack: 4,
      windowSizeForward: 0,
      centerAlignToOrigin: true,
    },
  };
}

function dataset(sourceResult?: AnalysisExecutionDatasetV1["sourceResult"]): AnalysisExecutionDatasetV1 {
  return {
    schemaVersion: "3dena.analysis-execution-dataset.v1",
    receipt: {
      schemaVersion: DATASET_RECEIPT_VERSION_V1,
      sha256: DATASET_HASH,
      byteLength: 512,
      format: "csv",
      sheet: { index: 0, name: "CSV" },
      rows: 16,
      columns: 8,
      schema: {
        schemaVersion: "3dena.dataset-schema.v1",
        headers: ["Group", "Name", "Lesson", "EC", "ICT", "MCO", "ATT", "Weight"],
        columns: [
          { name: "Group", inferredType: "string", roles: ["unit", "group"] },
          { name: "Name", inferredType: "string", roles: ["unit"] },
          { name: "Lesson", inferredType: "string", roles: ["conversation", "time"] },
          { name: "EC", inferredType: "number", roles: ["code"] },
          { name: "ICT", inferredType: "number", roles: ["code"] },
          { name: "MCO", inferredType: "number", roles: ["code"] },
          { name: "ATT", inferredType: "number", roles: ["code"] },
          { name: "Weight", inferredType: "number", roles: ["metadata"] },
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
    buildId: "task-executor-test-build",
    generatedAt: "2026-08-20T12:00:00.000Z",
    ...(sourceResult ? { sourceResult } : {}),
  };
}

function taskBase(kind: AnalysisTaskV1["kind"], taskId: string) {
  return {
    schemaVersion: ANALYSIS_TASK_VERSION_V1,
    kind,
    owner: {
      contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
      datasetHash: DATASET_HASH,
      specHash: SPEC_HASH,
      runId: "run-1",
      taskId,
    },
    deadlineEpochMilliseconds: DEADLINE,
  } as const;
}

async function sourceFixture() {
  const task: AnalysisTaskV1 = {
    ...taskBase("ena-model", "ena"),
    kind: "ena-model",
    input: analysisInput(),
  };
  const envelope = await executeAnalysisTask(dataset(), task);
  if (envelope.result.schemaVersion !== "3dena.analysis-result.v1") throw new Error("Expected raw analysis result.");
  return {
    result: envelope.result,
    hash: envelope.provenance.resultHash,
    dataset: dataset({ result: envelope.result, hash: envelope.provenance.resultHash }),
  };
}

function groups(result: AnalysisResult): [string, string] {
  const values = result.trajectory?.groupOrder.map((group) => group.canonical) ?? [];
  if (values.length !== 2) throw new Error("Expected two groups.");
  return [values[0]!, values[1]!];
}

describe("executeAnalysisTask", () => {
  it("runs raw jENA and returns an unapproved exact-owner result envelope", async () => {
    const source = await sourceFixture();

    expect(source.result.dimensions).toHaveLength(6);
    expect(source.hash).toMatch(/^[a-f0-9]{64}$/u);
    const envelope = await executeAnalysisTask(dataset(), {
      ...taskBase("ena-model", "ena-repeat"),
      kind: "ena-model",
      input: analysisInput(),
    });
    expect(envelope).toMatchObject({
      schemaVersion: "3dena.analysis-result-envelope.v1",
      taskKind: "ena-model",
      evidence: {
        status: "IMPLEMENTED_UNVERIFIED",
        approvedForParity: false,
        datasetHash: DATASET_HASH,
        specHash: SPEC_HASH,
      },
      provenance: {
        resultHash: source.hash,
        buildId: "task-executor-test-build",
        generatedAt: "2026-08-20T12:00:00.000Z",
      },
    });
    expectValidEnvelopeSchema(envelope);
    const unknownResultField = structuredClone(envelope) as unknown as { result: Record<string, unknown> };
    unknownResultField.result.unreviewed = true;
    expect(() => assertAnalysisResultEnvelopeV1(unknownResultField)).toThrow(/unknown field/);
    const nonFinitePoint = structuredClone(envelope) as unknown as { result: { points: Array<{ fullCoordinates: number[] }> } };
    nonFinitePoint.result.points[0]!.fullCoordinates[0] = Number.NaN;
    expect(() => assertAnalysisResultEnvelopeV1(nonFinitePoint)).toThrow(/finite number/);
  });

  it("executes Comparison and Change without refitting the source model", async () => {
    const source = await sourceFixture();
    const pair = groups(source.result);
    const comparison = await executeAnalysisTask(source.dataset, {
      ...taskBase("network-comparison", "comparison"),
      kind: "network-comparison",
      sourceResultHash: source.hash,
      groups: pair,
    });
    const change = await executeAnalysisTask(source.dataset, {
      ...taskBase("change-network", "change"),
      kind: "change-network",
      sourceResultHash: source.hash,
      field: "@group",
      level: source.result.trajectory!.groupOrder[0]!.value as string,
    });

    expect(comparison.result.schemaVersion).toBe("3dena.network-comparison.v1");
    expect(change.result.schemaVersion).toBe("3dena.change-network.v1");
    expectValidEnvelopeSchema(comparison);
    expectValidEnvelopeSchema(change);
    expect(source.result.provenance.resolvedConfig).toEqual(analysisInput().config);
    const badComparison = structuredClone(comparison) as unknown as { result: { differenceEdges: Array<Record<string, unknown>> } };
    badComparison.result.differenceEdges[0]!.unexpected = true;
    expect(() => assertAnalysisResultEnvelopeV1(badComparison)).toThrow(/unknown field/);
    const badChange = structuredClone(change) as unknown as { result: { selector: { field?: string } } };
    delete badChange.result.selector.field;
    expect(() => assertAnalysisResultEnvelopeV1(badChange)).toThrow(/missing required field/);
  });

  it("keeps the explicit V2 raw source arm compatible with V1 raw execution", async () => {
    const source = await sourceFixture();
    const pair = groups(source.result);
    const explicit: AnalysisExecutionDatasetV2 = {
      schemaVersion: ANALYSIS_EXECUTION_DATASET_VERSION_V2,
      receipt: source.dataset.receipt,
      specHash: source.dataset.specHash,
      buildId: source.dataset.buildId,
      generatedAt: "2026-08-20T12:00:00.000Z",
      sourceResult: {
        sourceKind: "raw-jena",
        hash: source.hash,
        result: source.result,
      },
    };
    const envelope = await executeAnalysisTask(explicit, {
      ...taskBase("network-comparison", "explicit-raw-v2"),
      kind: "network-comparison",
      sourceResultHash: source.hash,
      groups: pair,
    });

    expect(envelope.result.schemaVersion).toBe("3dena.network-comparison.v1");
    expect(envelope.provenance).toMatchObject({ sourceKind: "raw-jena", jenaExecuted: true });
    expect(() => assertAnalysisExecutionDatasetV2(explicit)).not.toThrow();
    expect(
      ajv.validate(EXECUTION_DATASET_SCHEMA_ID, explicit),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    expect(() => assertAnalysisExecutionDatasetV2({ ...explicit, unknown: true })).toThrow(/unknown field/);
    expect(ajv.validate(EXECUTION_DATASET_SCHEMA_ID, { ...explicit, unknown: true })).toBe(false);
    const missingReceipt = structuredClone(explicit) as Partial<AnalysisExecutionDatasetV2>;
    delete missingReceipt.receipt;
    expect(ajv.validate(EXECUTION_DATASET_SCHEMA_ID, missingReceipt)).toBe(false);
    const malformedSource = structuredClone(explicit) as unknown as { sourceResult: { result: { points: Array<Record<string, unknown>> } } };
    malformedSource.sourceResult.result.points[0]!.unexpected = true;
    expect(() => assertAnalysisExecutionDatasetV2(malformedSource)).toThrow(/unknown field/);
    expect(ajv.validate(EXECUTION_DATASET_SCHEMA_ID, malformedSource)).toBe(false);
  });

  it("executes independent and exact participant-time paired statistics per full-space dimension", async () => {
    const source = await sourceFixture();
    const pair = groups(source.result);
    const independent = await executeAnalysisTask(source.dataset, {
      ...taskBase("statistics", "stats-independent"),
      kind: "statistics",
      sourceResultHash: source.hash,
      design: "independent",
      groups: pair,
      dimensions: ["SVD1", "SVD4"],
      alternative: "two-sided",
      adjustment: "holm",
      samePhysicalEntityConfirmed: false,
    });
    const paired = await executeAnalysisTask(source.dataset, {
      ...taskBase("statistics", "stats-paired"),
      kind: "statistics",
      sourceResultHash: source.hash,
      design: "paired",
      groups: pair,
      dimensions: ["SVD1"],
      alternative: "two-sided",
      adjustment: "none",
      samePhysicalEntityConfirmed: true,
    });

    expect(independent.result.schemaVersion).toBe("3dena.statistics-task-result.v1");
    expect(paired.result.schemaVersion).toBe("3dena.statistics-task-result.v1");
    if (paired.result.schemaVersion !== "3dena.statistics-task-result.v1") throw new Error("Expected statistics result.");
    expect(paired.result.dimensions[0]!.result).toMatchObject({
      schemaVersion: "3dena.stats.paired-result.v1",
      matching: { matched: 8, validPairs: 8 },
    });
    expectValidEnvelopeSchema(independent);
    expectValidEnvelopeSchema(paired);
    const badStatistics = structuredClone(paired) as unknown as { result: { dimensions: Array<{ result: { adjustment: { adjusted: number[] } } }> } };
    badStatistics.result.dimensions[0]!.result.adjustment.adjusted[0] = Number.NaN;
    expect(() => assertAnalysisResultEnvelopeV1(badStatistics)).toThrow(/finite number/);
  });

  it("executes path, paired trajectory comparison, and participant-history bootstrap", async () => {
    const source = await sourceFixture();
    const pair = groups(source.result);
    const path = await executeAnalysisTask(source.dataset, {
      ...taskBase("trajectory", "trajectory"),
      kind: "trajectory",
      sourceResultHash: source.hash,
      group: pair[0],
      selectedDimensions: ["SVD2", "SVD4", "SVD6"],
      cohortPolicy: "available",
      periods: source.result.trajectory!.timeOrder.map((time, index) => ({
        sourceTimeCanonical: time.canonical,
        value: { type: "numeric-v1", value: index + 1, unit: "lesson-index" },
      })),
      estimand: { kind: "equal-participant-v1" },
    });
    const weightedPath = await executeAnalysisTask(source.dataset, {
      ...taskBase("trajectory", "trajectory-weighted"),
      kind: "trajectory",
      sourceResultHash: source.hash,
      group: pair[0],
      selectedDimensions: ["SVD2", "SVD4", "SVD6"],
      cohortPolicy: "available",
      periods: source.result.trajectory!.timeOrder.map((time, index) => ({
        sourceTimeCanonical: time.canonical,
        value: { type: "numeric-v1", value: index + 1, unit: "lesson-index" },
      })),
      estimand: { kind: "weighted-participant-v1", metadataField: "Weight" },
    });
    const comparison = await executeAnalysisTask(source.dataset, {
      ...taskBase("trajectory-comparison", "trajectory-comparison"),
      kind: "trajectory-comparison",
      sourceResultHash: source.hash,
      design: "paired",
      groups: pair,
      samePhysicalEntityConfirmed: true,
    });
    const bootstrap = await executeAnalysisTask(source.dataset, {
      ...taskBase("bootstrap", "bootstrap"),
      kind: "bootstrap",
      sourceResultHash: source.hash,
      group: pair[0],
      replicates: 200,
      confidenceLevel: 0.95,
      seed: 2026,
      interval: "pointwise-percentile-type7",
      rotationPolicy: "fixed-preprojected",
    });

    expect(path.result).toMatchObject({
      schemaVersion: "3dena.trajectory-dynamics.v1",
      selectedDimensions: ["SVD2", "SVD4", "SVD6"],
      timeContract: { kind: "numeric-v1", elapsedUnit: "lesson-index" },
      evidence: { status: "IMPLEMENTED_UNVERIFIED", oracleParityClaim: false },
      periods: [
        { elapsedFromPrevious: null, selected3d: { speed: null } },
        { elapsedFromPrevious: 1 },
      ],
    });
    expect(weightedPath.result).toMatchObject({
      schemaVersion: "3dena.trajectory-dynamics.v1",
      estimand: { kind: "weighted-participant-v1" },
    });
    expect(comparison.result).toMatchObject({
      schemaVersion: "3dena.trajectory-comparison.v1",
      design: "paired",
      pairedId: ["Name"],
      permutation: { status: "not-requested", replicateCount: 0 },
    });
    expect(bootstrap.result).toMatchObject({
      schemaVersion: "3dena.trajectory-bootstrap.v1",
      confidenceLevel: 0.95,
      resampling: { replicateCount: 200, unit: "participant-complete-history" },
    });
    expectValidEnvelopeSchema(path);
    expectValidEnvelopeSchema(weightedPath);
    expectValidEnvelopeSchema(comparison);
    expectValidEnvelopeSchema(bootstrap);
    const badPath = structuredClone(path) as unknown as { result: { periods: Array<Record<string, unknown>> } };
    badPath.result.periods[0]!.unexpected = true;
    expect(() => assertAnalysisResultEnvelopeV1(badPath)).toThrow(/unknown field/);
    const badTrajectoryComparison = structuredClone(comparison) as unknown as { result: { periods: Array<{ fullCentroidA: number[] | null }> } };
    badTrajectoryComparison.result.periods[0]!.fullCentroidA = [Number.NaN];
    expect(() => assertAnalysisResultEnvelopeV1(badTrajectoryComparison)).toThrow(/exactly 6 values|finite number/);
    const badBootstrap = structuredClone(bootstrap) as unknown as { result: { resampling: { rngParityClaim: boolean } } };
    badBootstrap.result.resampling.rngParityClaim = true;
    expect(() => assertAnalysisResultEnvelopeV1(badBootstrap)).toThrow(/unsupported or unapproved/);
  });

  it("recursively validates every result variant and rejects unknown, missing, and malformed nested fields", async () => {
    const source = await sourceFixture();
    const pair = groups(source.result);
    const ena = await executeAnalysisTask(dataset(), {
      ...taskBase("ena-model", "schema-ena"),
      kind: "ena-model",
      input: analysisInput(),
    });
    const networkComparison = await executeAnalysisTask(source.dataset, {
      ...taskBase("network-comparison", "schema-network-comparison"),
      kind: "network-comparison",
      sourceResultHash: source.hash,
      groups: pair,
    });
    const changeNetwork = await executeAnalysisTask(source.dataset, {
      ...taskBase("change-network", "schema-change-network"),
      kind: "change-network",
      sourceResultHash: source.hash,
      field: "@group",
      level: source.result.trajectory!.groupOrder[0]!.value as string,
    });
    const statistics = await executeAnalysisTask(source.dataset, {
      ...taskBase("statistics", "schema-statistics"),
      kind: "statistics",
      sourceResultHash: source.hash,
      design: "independent",
      groups: pair,
      dimensions: ["SVD1"],
      alternative: "two-sided",
      adjustment: "holm",
      samePhysicalEntityConfirmed: false,
    });
    const trajectory = await executeAnalysisTask(source.dataset, {
      ...taskBase("trajectory", "schema-trajectory"),
      kind: "trajectory",
      sourceResultHash: source.hash,
      group: pair[0],
      selectedDimensions: ["SVD1", "SVD2", "SVD3"],
      cohortPolicy: "available",
      periods: source.result.trajectory!.timeOrder.map((time, index) => ({
        sourceTimeCanonical: time.canonical,
        value: { type: "numeric-v1", value: index + 1, unit: "period-index" },
      })),
      estimand: { kind: "equal-participant-v1" },
    });
    const trajectoryComparison = await executeAnalysisTask(source.dataset, {
      ...taskBase("trajectory-comparison", "schema-trajectory-comparison"),
      kind: "trajectory-comparison",
      sourceResultHash: source.hash,
      design: "paired",
      groups: pair,
      samePhysicalEntityConfirmed: true,
    });
    const bootstrap = await executeAnalysisTask(source.dataset, {
      ...taskBase("bootstrap", "schema-bootstrap"),
      kind: "bootstrap",
      sourceResultHash: source.hash,
      group: pair[0],
      replicates: 200,
      confidenceLevel: 0.95,
      seed: 2026,
      interval: "pointwise-percentile-type7",
      rotationPolicy: "fixed-preprojected",
    });

    const cases = [
      {
        name: "ena-model",
        envelope: ena,
        malformed(value: Record<string, unknown>) {
          const result = value.result as { points: Array<{ id: { values: unknown[] } }> };
          result.points[0]!.id.values = [];
        },
      },
      {
        name: "network-comparison",
        envelope: networkComparison,
        malformed(value: Record<string, unknown>) {
          const result = value.result as { differenceEdges: Array<{ meanWeight: unknown }> };
          result.differenceEdges[0]!.meanWeight = "not-a-number";
        },
      },
      {
        name: "change-network",
        envelope: changeNetwork,
        malformed(value: Record<string, unknown>) {
          const result = value.result as { mean: { edges: Array<{ meanWeight: unknown }> } };
          result.mean.edges[0]!.meanWeight = null;
        },
      },
      {
        name: "statistics",
        envelope: statistics,
        malformed(value: Record<string, unknown>) {
          const result = value.result as { dimensions: Array<{ result: { contract: { direction: unknown } } }> };
          result.dimensions[0]!.result.contract.direction = "B-minus-A";
        },
      },
      {
        name: "trajectory",
        envelope: trajectory,
        malformed(value: Record<string, unknown>) {
          const result = value.result as { periods: Array<{ selected3d: { stepDistance: unknown } }> };
          result.periods[0]!.selected3d.stepDistance = "not-a-distance";
        },
      },
      {
        name: "trajectory-comparison",
        envelope: trajectoryComparison,
        malformed(value: Record<string, unknown>) {
          const result = value.result as { periods: Array<{ nAUsed: unknown }> };
          result.periods[0]!.nAUsed = -1;
        },
      },
      {
        name: "bootstrap",
        envelope: bootstrap,
        malformed(value: Record<string, unknown>) {
          const result = value.result as { resampling: { generation: { kind: unknown } } };
          result.resampling.generation.kind = "unversioned-rng";
        },
      },
    ] as const;

    for (const testCase of cases) {
      expect(
        ajv.validate(CONTRACT_SCHEMAS_V1.resultEnvelope.$id, testCase.envelope),
        `${testCase.name}: ${JSON.stringify(ajv.errors)}`,
      ).toBe(true);

      const unknown = structuredClone(testCase.envelope) as unknown as Record<string, unknown>;
      (unknown.result as Record<string, unknown>).unknownContractField = true;
      expect(ajv.validate(CONTRACT_SCHEMAS_V1.resultEnvelope.$id, unknown), testCase.name).toBe(false);

      const missing = structuredClone(testCase.envelope) as unknown as Record<string, unknown>;
      delete (missing.result as Record<string, unknown>).schemaVersion;
      expect(ajv.validate(CONTRACT_SCHEMAS_V1.resultEnvelope.$id, missing), testCase.name).toBe(false);

      const malformed = structuredClone(testCase.envelope) as unknown as Record<string, unknown>;
      testCase.malformed(malformed);
      expect(ajv.validate(CONTRACT_SCHEMAS_V1.resultEnvelope.$id, malformed), testCase.name).toBe(false);
    }

    const nonFinite = structuredClone(ena) as unknown as {
      result: { points: Array<{ fullCoordinates: number[] }> };
    };
    nonFinite.result.points[0]!.fullCoordinates[0] = Number.POSITIVE_INFINITY;
    expect(ajv.validate(CONTRACT_SCHEMAS_V1.resultEnvelope.$id, nonFinite)).toBe(false);
  });

  it("fails closed on stale ownership, tampered source results, expired tasks, and unconfirmed pairing", async () => {
    const source = await sourceFixture();
    const pair = groups(source.result);
    await expect(executeAnalysisTask({ ...source.dataset, specHash: "c".repeat(64) }, {
      ...taskBase("network-comparison", "owner-mismatch"),
      kind: "network-comparison",
      sourceResultHash: source.hash,
      groups: pair,
    })).rejects.toEqual(expect.objectContaining<Partial<AnalysisTaskExecutionError>>({ code: "SPEC_OWNER_MISMATCH" }));

    const tampered = structuredClone(source.result);
    tampered.points[0]!.fullCoordinates[0]! += 1;
    await expect(executeAnalysisTask(dataset({ hash: source.hash, result: tampered }), {
      ...taskBase("network-comparison", "tampered"),
      kind: "network-comparison",
      sourceResultHash: source.hash,
      groups: pair,
    })).rejects.toEqual(expect.objectContaining<Partial<AnalysisTaskExecutionError>>({ code: "SOURCE_RESULT_HASH_MISMATCH" }));

    await expect(executeAnalysisTask(dataset(), {
      ...taskBase("ena-model", "expired"),
      kind: "ena-model",
      deadlineEpochMilliseconds: 1,
      input: analysisInput(),
    })).rejects.toEqual(expect.objectContaining<Partial<AnalysisTaskExecutionError>>({ code: "TASK_DEADLINE_EXCEEDED" }));

    await expect(executeAnalysisTask(source.dataset, {
      ...taskBase("statistics", "unconfirmed"),
      kind: "statistics",
      sourceResultHash: source.hash,
      design: "paired",
      groups: pair,
      dimensions: ["SVD1"],
      alternative: "two-sided",
      adjustment: "none",
      samePhysicalEntityConfirmed: false,
    } as AnalysisTaskV1)).rejects.toThrow(/must be true for paired statistics/);
  });
});
