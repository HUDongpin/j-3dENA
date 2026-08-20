import Ajv from "ajv";
import { describe, expect, it } from "vitest";

import {
  ANALYSIS_CONTRACT_VERSION_V1,
  ANALYSIS_TASK_VERSION_V1,
  CONTRACT_SCHEMAS_V1,
  DATASET_RECEIPT_VERSION_V1,
  type AnalysisTaskV1,
} from "./contracts";
import {
  ANALYSIS_EXECUTION_DATASET_VERSION_V2,
  AnalysisTaskExecutionError,
  executeAnalysisTask,
  hashAnalysisValueV1,
  type AnalysisExecutionDatasetV2,
} from "./task-executor";
import type { PreparedSpaceResult } from "./prepared-types";
import { createSyntheticPreparedFixture } from "../test-support/synthetic-prepared-exchange";

const SPEC_HASH = "b".repeat(64);
const DEADLINE = 4_000_000_000_000;
const GENERATED_AT = "2026-08-20T12:00:00.000Z";
const EXECUTION_DATASET_SCHEMA_ID = "https://3dena.com/schemas/analysis-execution-dataset.v2.json";
const ajv = new Ajv({ strict: false, strictNumbers: true, allErrors: true, validateFormats: false });
for (const schema of Object.values(CONTRACT_SCHEMAS_V1)) ajv.addSchema(schema);

interface PreparedFixture {
  result: PreparedSpaceResult;
  resultHash: string;
  dataset: AnalysisExecutionDatasetV2;
  groups: [string, string];
}

async function preparedFixture(): Promise<PreparedFixture> {
  const { artifact, result } = await createSyntheticPreparedFixture();
  const resultHash = await hashAnalysisValueV1(result);
  const groups = result.displaySpace.trajectory.groupOrder.map((group) => group.canonical);
  if (groups.length < 2) throw new Error("Expected at least two prepared fixture groups.");
  const headers = [...result.fullSpace.dimensions];
  const dataset: AnalysisExecutionDatasetV2 = {
    schemaVersion: ANALYSIS_EXECUTION_DATASET_VERSION_V2,
    receipt: {
      schemaVersion: DATASET_RECEIPT_VERSION_V1,
      sha256: artifact.sha256,
      byteLength: artifact.byteLength,
      format: "ena3d-json",
      sheet: null,
      rows: result.fullSpace.points.length,
      columns: headers.length,
      schema: {
        schemaVersion: "3dena.dataset-schema.v1",
        headers,
        columns: headers.map((name) => ({ name, inferredType: "number", roles: ["unmapped"] })),
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
      activationIdentity: `prepared:${artifact.sha256}`,
    },
    specHash: SPEC_HASH,
    buildId: "prepared-task-test-build",
    generatedAt: GENERATED_AT,
    sourceResult: {
      sourceKind: "prepared-exchange",
      hash: resultHash,
      result,
    },
  };
  return { result, resultHash, dataset, groups: [groups[0]!, groups[1]!] };
}

function taskBase(
  fixture: PreparedFixture,
  kind: AnalysisTaskV1["kind"],
  taskId: string,
) {
  return {
    schemaVersion: ANALYSIS_TASK_VERSION_V1,
    kind,
    owner: {
      contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
      datasetHash: fixture.result.sourceReceipt.sha256,
      specHash: SPEC_HASH,
      runId: "prepared-run",
      taskId,
    },
    deadlineEpochMilliseconds: DEADLINE,
  } as const;
}

describe("executeAnalysisTask with immutable PreparedSpaceResult", () => {
  it("validates the standalone prepared execution dataset schema recursively", async () => {
    const fixture = await preparedFixture();
    expect(
      ajv.validate(EXECUTION_DATASET_SCHEMA_ID, fixture.dataset),
      JSON.stringify(ajv.errors),
    ).toBe(true);

    const unknownDataset = { ...fixture.dataset, unknownContractField: true };
    expect(ajv.validate(EXECUTION_DATASET_SCHEMA_ID, unknownDataset)).toBe(false);

    const missingMapping = structuredClone(fixture.dataset) as unknown as {
      sourceResult: { result: { provenance: { resolvedMapping: Record<string, unknown> } } };
    };
    delete missingMapping.sourceResult.result.provenance.resolvedMapping.participant;
    expect(ajv.validate(EXECUTION_DATASET_SCHEMA_ID, missingMapping)).toBe(false);

    const unknownReceipt = structuredClone(fixture.dataset) as unknown as { receipt: Record<string, unknown> };
    unknownReceipt.receipt.unreviewed = true;
    expect(ajv.validate(EXECUTION_DATASET_SCHEMA_ID, unknownReceipt)).toBe(false);

    const malformedRowKey = structuredClone(fixture.dataset) as unknown as {
      sourceResult: { result: { fullSpace: { lineWeights: { rowKeys: Array<{ values: unknown[] }> } } } };
    };
    malformedRowKey.sourceResult.result.fullSpace.lineWeights.rowKeys[0]!.values = [];
    expect(ajv.validate(EXECUTION_DATASET_SCHEMA_ID, malformedRowKey)).toBe(false);

    const wrongDiscriminator = structuredClone(fixture.dataset) as unknown as {
      sourceResult: { sourceKind: string };
    };
    wrongDiscriminator.sourceResult.sourceKind = "raw-jena";
    expect(ajv.validate(EXECUTION_DATASET_SCHEMA_ID, wrongDiscriminator)).toBe(false);
  });

  it("executes prepared Comparison, Change, and independent Stats with truthful provenance", async () => {
    const fixture = await preparedFixture();
    const sourceBefore = await hashAnalysisValueV1(fixture.result);
    const comparison = await executeAnalysisTask(fixture.dataset, {
      ...taskBase(fixture, "network-comparison", "prepared-comparison"),
      kind: "network-comparison",
      sourceResultHash: fixture.resultHash,
      groups: fixture.groups,
    });
    const change = await executeAnalysisTask(fixture.dataset, {
      ...taskBase(fixture, "change-network", "prepared-change"),
      kind: "change-network",
      sourceResultHash: fixture.resultHash,
      field: "@group",
      level: fixture.result.displaySpace.trajectory.groupOrder[0]!.value,
    });
    const statistics = await executeAnalysisTask(fixture.dataset, {
      ...taskBase(fixture, "statistics", "prepared-statistics"),
      kind: "statistics",
      sourceResultHash: fixture.resultHash,
      design: "independent",
      groups: fixture.groups,
      dimensions: ["SVD1", "SVD4"],
      alternative: "two-sided",
      adjustment: "holm",
      samePhysicalEntityConfirmed: false,
    });

    for (const envelope of [comparison, change, statistics]) {
      expect(envelope.evidence).toMatchObject({
        status: "IMPLEMENTED_UNVERIFIED",
        approvedForParity: false,
        datasetHash: fixture.result.sourceReceipt.sha256,
        specHash: SPEC_HASH,
      });
      expect(envelope.provenance).toMatchObject({
        sourceKind: "prepared-exchange",
        jenaExecuted: false,
        datasetHash: fixture.result.sourceReceipt.sha256,
        specHash: SPEC_HASH,
        generatedAt: GENERATED_AT,
      });
      expect(envelope.provenance.schemaVersions).toContain("3dena.prepared-space-result.v1");
      expect(envelope.diagnostics).toContainEqual(
        expect.objectContaining({ code: "PREPARED_PRECOMPUTED_REDUCTION" }),
      );
    }
    expect(comparison.result.schemaVersion).toBe("3dena.network-comparison.v1");
    expect(change.result.schemaVersion).toBe("3dena.change-network.v1");
    expect(statistics.result.schemaVersion).toBe("3dena.statistics-task-result.v1");
    if (statistics.result.schemaVersion !== "3dena.statistics-task-result.v1") throw new Error("Expected statistics result.");
    expect(statistics.result.dimensions).toHaveLength(2);
    expect(statistics.result.dimensions[0]!.result.schemaVersion).toBe("3dena.stats.independent-result.v1");
    expect(await hashAnalysisValueV1(fixture.result)).toBe(sourceBefore);
  });

  it("executes fixed-imported-space trajectory, comparison, and bootstrap without claiming a jENA refit", async () => {
    const fixture = await preparedFixture();
    const periods = fixture.result.displaySpace.trajectory.timeOrder.map((time, index) => ({
      sourceTimeCanonical: time.canonical,
      value: { type: "numeric-v1" as const, value: index + 1, unit: "period-index" },
    }));
    const tasks: AnalysisTaskV1[] = [
      {
        ...taskBase(fixture, "trajectory", "prepared-trajectory"),
        kind: "trajectory",
        sourceResultHash: fixture.resultHash,
        group: fixture.groups[0],
        selectedDimensions: ["SVD1", "SVD2", "SVD3"],
        cohortPolicy: "available",
        periods,
        estimand: { kind: "equal-participant-v1" },
      },
      {
        ...taskBase(fixture, "trajectory-comparison", "prepared-trajectory-comparison"),
        kind: "trajectory-comparison",
        sourceResultHash: fixture.resultHash,
        design: "independent",
        groups: fixture.groups,
        samePhysicalEntityConfirmed: false,
      },
      {
        ...taskBase(fixture, "bootstrap", "prepared-bootstrap"),
        kind: "bootstrap",
        sourceResultHash: fixture.resultHash,
        group: fixture.groups[0],
        replicates: 200,
        confidenceLevel: 0.95,
        seed: 2026,
        interval: "pointwise-percentile-type7",
        rotationPolicy: "fixed-preprojected",
      },
    ];

    const sourceBefore = await hashAnalysisValueV1(fixture.result);
    const [trajectory, comparison, bootstrap] = await Promise.all(
      tasks.map((task) => executeAnalysisTask(fixture.dataset, task)),
    );
    expect(trajectory!.result).toMatchObject({
      schemaVersion: "3dena.trajectory-dynamics.v1",
      selectedDimensions: ["SVD1", "SVD2", "SVD3"],
      evidence: { status: "IMPLEMENTED_UNVERIFIED", oracleParityClaim: false },
    });
    expect(comparison!.result).toMatchObject({
      schemaVersion: "3dena.trajectory-comparison.v1",
      design: "independent",
      permutation: { status: "not-requested", rngParityClaim: false },
    });
    expect(bootstrap!.result).toMatchObject({
      schemaVersion: "3dena.trajectory-bootstrap.v1",
      quantileRule: { id: "linear-type7-v1" },
      resampling: {
        unit: "participant-complete-history",
        replicateCount: 200,
        generation: { kind: "seeded", algorithm: "mulberry32-uint32-v1", seed: 2026 },
        rngParityClaim: false,
      },
    });
    for (const envelope of [trajectory!, comparison!, bootstrap!]) {
      expect(envelope.provenance).toMatchObject({ sourceKind: "prepared-exchange", jenaExecuted: false });
      expect(envelope.evidence).toMatchObject({ status: "IMPLEMENTED_UNVERIFIED", approvedForParity: false });
      expect(envelope.diagnostics).toContainEqual(expect.objectContaining({ code: "PREPARED_PRECOMPUTED_REDUCTION" }));
    }
    expect(await hashAnalysisValueV1(fixture.result)).toBe(sourceBefore);
  });

  it("does not manufacture prepared pairs from participant-label collisions across distinct complete identities", async () => {
    const fixture = await preparedFixture();
    const labelCollision = structuredClone(fixture.result);
    const sideA = labelCollision.fullSpace.points.filter((point) => point.group.canonical === fixture.groups[0]);
    const sideB = labelCollision.fullSpace.points.filter((point) => point.group.canonical === fixture.groups[1]);
    const used = new Set<string>();
    let collisionCount = 0;
    for (const pointB of sideB) {
      const pointA = sideA.find((candidate) =>
        candidate.time.canonical === pointB.time.canonical && !used.has(candidate.id.canonical));
      if (!pointA) continue;
      used.add(pointA.id.canonical);
      pointB.participantLabel = structuredClone(pointA.participantLabel);
      collisionCount += 1;
      if (collisionCount === 2) break;
    }
    expect(collisionCount).toBe(2);
    const collisionHash = await hashAnalysisValueV1(labelCollision);
    const collisionDataset: AnalysisExecutionDatasetV2 = {
      ...fixture.dataset,
      sourceResult: {
        sourceKind: "prepared-exchange",
        hash: collisionHash,
        result: labelCollision,
      },
    };
    await expect(executeAnalysisTask(collisionDataset, {
      ...taskBase(fixture, "statistics", "prepared-paired-unmatched"),
      kind: "statistics",
      sourceResultHash: collisionHash,
      design: "paired",
      groups: fixture.groups,
      dimensions: ["SVD1"],
      alternative: "two-sided",
      adjustment: "none",
      samePhysicalEntityConfirmed: true,
    })).rejects.toEqual(expect.objectContaining({ code: "INSUFFICIENT_PAIRS" }));
  });

  it("rejects stale, tampered, discriminator-mismatched, and receipt-mismatched prepared sources", async () => {
    const fixture = await preparedFixture();
    await expect(executeAnalysisTask(fixture.dataset, {
      ...taskBase(fixture, "network-comparison", "prepared-stale"),
      kind: "network-comparison",
      sourceResultHash: "c".repeat(64),
      groups: fixture.groups,
    })).rejects.toEqual(expect.objectContaining<Partial<AnalysisTaskExecutionError>>({ code: "SOURCE_RESULT_OWNER_MISMATCH" }));

    const tampered = structuredClone(fixture.result);
    tampered.fullSpace.points[0]!.coordinates[0]! += 1;
    await expect(executeAnalysisTask({
      ...fixture.dataset,
      sourceResult: { sourceKind: "prepared-exchange", hash: fixture.resultHash, result: tampered },
    }, {
      ...taskBase(fixture, "network-comparison", "prepared-tampered"),
      kind: "network-comparison",
      sourceResultHash: fixture.resultHash,
      groups: fixture.groups,
    })).rejects.toEqual(expect.objectContaining<Partial<AnalysisTaskExecutionError>>({ code: "SOURCE_RESULT_HASH_MISMATCH" }));

    await expect(executeAnalysisTask({
      ...fixture.dataset,
      sourceResult: {
        sourceKind: "raw-jena",
        hash: fixture.resultHash,
        result: fixture.result,
      } as unknown as NonNullable<AnalysisExecutionDatasetV2["sourceResult"]>,
    }, {
      ...taskBase(fixture, "network-comparison", "prepared-discriminator"),
      kind: "network-comparison",
      sourceResultHash: fixture.resultHash,
      groups: fixture.groups,
    })).rejects.toEqual(expect.objectContaining<Partial<AnalysisTaskExecutionError>>({ code: "SOURCE_KIND_RESULT_MISMATCH" }));

    const receiptMismatch = structuredClone(fixture.result);
    receiptMismatch.sourceReceipt.byteLength += 1;
    const receiptMismatchHash = await hashAnalysisValueV1(receiptMismatch);
    await expect(executeAnalysisTask({
      ...fixture.dataset,
      sourceResult: {
        sourceKind: "prepared-exchange",
        hash: receiptMismatchHash,
        result: receiptMismatch,
      },
    }, {
      ...taskBase(fixture, "network-comparison", "prepared-receipt"),
      kind: "network-comparison",
      sourceResultHash: receiptMismatchHash,
      groups: fixture.groups,
    })).rejects.toEqual(expect.objectContaining<Partial<AnalysisTaskExecutionError>>({ code: "PREPARED_SOURCE_RECEIPT_MISMATCH" }));

    const inflatedProvenance = structuredClone(fixture.result);
    (inflatedProvenance.provenance as unknown as { jenaExecuted: boolean }).jenaExecuted = true;
    const inflatedProvenanceHash = await hashAnalysisValueV1(inflatedProvenance);
    await expect(executeAnalysisTask({
      ...fixture.dataset,
      sourceResult: {
        sourceKind: "prepared-exchange",
        hash: inflatedProvenanceHash,
        result: inflatedProvenance,
      },
    }, {
      ...taskBase(fixture, "network-comparison", "prepared-inflated-provenance"),
      kind: "network-comparison",
      sourceResultHash: inflatedProvenanceHash,
      groups: fixture.groups,
    })).rejects.toEqual(expect.objectContaining({ code: "INVALID_PREPARED_BOUNDARY" }));

    const missingProvenance = structuredClone(fixture.result) as unknown as
      Omit<PreparedSpaceResult, "provenance"> & { provenance?: PreparedSpaceResult["provenance"] };
    delete missingProvenance.provenance;
    const missingProvenanceHash = await hashAnalysisValueV1(missingProvenance);
    await expect(executeAnalysisTask({
      ...fixture.dataset,
      sourceResult: {
        sourceKind: "prepared-exchange",
        hash: missingProvenanceHash,
        result: missingProvenance as PreparedSpaceResult,
      },
    }, {
      ...taskBase(fixture, "network-comparison", "prepared-missing-provenance"),
      kind: "network-comparison",
      sourceResultHash: missingProvenanceHash,
      groups: fixture.groups,
    })).rejects.toEqual(expect.objectContaining({ code: "INVALID_PREPARED_BOUNDARY" }));
  });
});
