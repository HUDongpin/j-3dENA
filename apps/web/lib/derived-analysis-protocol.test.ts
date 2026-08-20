import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PreparedSpaceResult } from "@3dena/analysis";
import { describe, expect, it } from "vitest";
import {
  createPreparedDatasetReceipt,
  isDerivedAnalysisWorkerRequest,
  isDerivedAnalysisWorkerResponse,
} from "@/lib/derived-analysis-protocol";

const owner = {
  datasetHash: "a".repeat(64),
  specHash: "b".repeat(64),
  runId: "run-1",
  taskId: "task-1",
};

describe("derived analysis worker protocol", () => {
  it("accepts an owned raw statistics request and rejects stale/ambiguous shapes", () => {
    const request = {
      v: 1,
      kind: "execute-raw-derived",
      owner,
      buildId: "build-1",
      source: {
        name: "source.csv",
        byteLength: 128,
        rows: 4,
        columns: 1,
        schema: {
          schemaVersion: "3dena.dataset-schema.v1",
          headers: ["a"],
          columns: [{ name: "a", inferredType: "string", roles: ["unmapped"] }],
        },
        limits: {
          schemaVersion: "3dena.dataset-limits.v1",
          maxFileBytes: 1024,
          maxWorksheets: 1,
          maxRows: 100,
          maxColumns: 10,
          maxCells: 1000,
        },
        result: { schemaVersion: "3dena.analysis-result.v1" },
      },
      intent: {
        kind: "statistics",
        design: "independent",
        groups: ["group-a", "group-b"],
        dimensions: ["SVD1", "SVD2"],
        alternative: "two-sided",
        adjustment: "holm",
        samePhysicalEntityConfirmed: false,
      },
    };
    expect(isDerivedAnalysisWorkerRequest(request)).toBe(true);
    expect(isDerivedAnalysisWorkerRequest({
      ...request,
      owner: { ...owner, datasetHash: "not-a-hash" },
    })).toBe(false);
    expect(isDerivedAnalysisWorkerRequest({
      ...request,
      intent: { ...request.intent, groups: ["same", "same"] },
    })).toBe(false);
    expect(isDerivedAnalysisWorkerRequest({
      ...request,
      intent: { ...request.intent, dimensions: [] },
    })).toBe(false);
    expect(isDerivedAnalysisWorkerRequest({
      ...request,
      source: { ...request.source, columns: 2 },
    })).toBe(false);
    expect(isDerivedAnalysisWorkerRequest({
      ...request,
      source: {
        ...request.source,
        byteLength: request.source.limits.maxFileBytes + 1,
      },
    })).toBe(false);
  });

  it("accepts only an exact prepared V2 task source with the complete statistics contract", () => {
    const result = {
      schemaVersion: "3dena.prepared-space-result.v1",
      sourceKind: "prepared-exchange",
      rawJenaRecompute: false,
      sourceReceipt: {
        name: "fixture.ena3d.json",
        sha256: owner.datasetHash,
        byteLength: 512,
      },
      fullSpace: {
        dimensions: ["SVD1", "SVD2", "SVD3"],
        points: [{ index: 0 }],
      },
    } as const;
    const receipt = createPreparedDatasetReceipt(result as unknown as PreparedSpaceResult);
    expect(receipt).toMatchObject({
      schemaVersion: "3dena.dataset-receipt.v1",
      sha256: owner.datasetHash,
      byteLength: 512,
      format: "ena3d-json",
      rows: 1,
      columns: 3,
      schema: {
        headers: ["SVD1", "SVD2", "SVD3"],
        columns: [
          { name: "SVD1", inferredType: "number", roles: ["unmapped"] },
          { name: "SVD2", inferredType: "number", roles: ["unmapped"] },
          { name: "SVD3", inferredType: "number", roles: ["unmapped"] },
        ],
      },
      limits: {
        maxFileBytes: 5 * 1024 * 1024,
        maxWorksheets: 32,
        maxRows: 100_000,
        maxColumns: 256,
        maxCells: 5_000_000,
      },
      activationIdentity: `prepared:${owner.datasetHash}`,
    });
    const request = {
      v: 1,
      kind: "execute-prepared-derived",
      owner,
      buildId: "build-1",
      source: { receipt, result },
      intent: {
        kind: "statistics",
        design: "paired",
        groups: ["group-a", "group-b"],
        dimensions: ["SVD1"],
        alternative: "greater",
        adjustment: "bonferroni",
        samePhysicalEntityConfirmed: true,
      },
    };
    expect(isDerivedAnalysisWorkerRequest(request)).toBe(true);
    expect(isDerivedAnalysisWorkerRequest({
      ...request,
      owner: { ...owner, datasetHash: "c".repeat(64) },
    })).toBe(false);
    expect(isDerivedAnalysisWorkerRequest({
      ...request,
      source: {
        ...request.source,
        receipt: { ...receipt, byteLength: receipt.byteLength + 1 },
      },
    })).toBe(false);
    expect(isDerivedAnalysisWorkerRequest({
      ...request,
      intent: { ...request.intent, samePhysicalEntityConfirmed: false },
    })).toBe(false);
    expect(isDerivedAnalysisWorkerRequest({
      ...request,
      intent: { ...request.intent, adjustment: "unsupported" },
    })).toBe(false);
  });

  it("validates public result envelopes at the Worker response boundary", () => {
    const envelope = {
      schemaVersion: "3dena.analysis-result-envelope.v1",
      owner: { contractVersion: "3dena.contract.v1", ...owner },
      taskKind: "network-comparison",
      result: {
        schemaVersion: "3dena.network-comparison.v1",
        direction: "group-a-minus-group-b",
        groupA: {
          canonical: "group-a-key",
          display: "Group A",
          value: "group-a",
        },
        groupB: {
          canonical: "group-b-key",
          display: "Group B",
          value: "group-b",
        },
        meanA: {
          pointCount: 1,
          pointIndexes: [0],
          meanCoordinates: [0.25, 0.5, 0.75],
          edges: [{
            index: 0,
            id: "edge-c1-c2",
            column: "C1::C2",
            source: "C1",
            target: "C2",
            meanWeight: 0.6,
          }],
        },
        meanB: {
          pointCount: 1,
          pointIndexes: [1],
          meanCoordinates: [-0.25, -0.5, -0.75],
          edges: [{
            index: 0,
            id: "edge-c1-c2",
            column: "C1::C2",
            source: "C1",
            target: "C2",
            meanWeight: 0.2,
          }],
        },
        differenceEdges: [{
          index: 0,
          id: "edge-c1-c2",
          column: "C1::C2",
          source: "C1",
          target: "C2",
          meanWeight: 0.4,
          groupAMeanWeight: 0.6,
          groupBMeanWeight: 0.2,
          semanticOwner: "group-a",
        }],
        diagnostics: [],
      },
      diagnostics: [],
      evidence: {
        schemaVersion: "3dena.evidence-stamp.v1",
        scope: "feature",
        status: "IMPLEMENTED_UNVERIFIED",
        datasetHash: owner.datasetHash,
        specHash: owner.specHash,
        buildId: "build-1",
        approvedForParity: false,
      },
      provenance: {
        schemaVersion: "3dena.provenance-manifest.v1",
        datasetHash: owner.datasetHash,
        specHash: owner.specHash,
        resultHash: "c".repeat(64),
        adapterVersion: "0.1.0",
        jenaPackage: "jena-js",
        jenaVersion: "0.6.2",
        jenaCommit: "2f63db4c6ccf5684afc8437ae81ed1a3ccd0c1a3",
        sourceKind: "prepared-exchange",
        jenaExecuted: false,
        sdkPackage: "@3dena/analysis",
        sdkVersion: "0.1.0",
        appVersion: "sdk-local",
        contractVersion: "3dena.contract.v1",
        buildId: "build-1",
        seed: null,
        toleranceContract: null,
        schemaVersions: [
          "3dena.analysis-task.v1",
          "3dena.prepared-space-result.v1",
          "3dena.network-comparison.v1",
          "3dena.analysis-result-envelope.v1",
        ],
        generatedAt: "2026-08-21T00:00:00.000Z",
      },
    };
    expect(isDerivedAnalysisWorkerResponse({
      type: "prepared-derived-result",
      owner,
      envelope,
    })).toBe(true);
    expect(isDerivedAnalysisWorkerResponse({
      type: "prepared-derived-result",
      owner,
      envelope: {
        ...envelope,
        provenance: { ...envelope.provenance, jenaExecuted: true },
      },
    })).toBe(false);
  });

  it("routes both raw and prepared derived work through the public task executor", () => {
    const source = readFileSync(
      resolve(process.cwd(), "workers/derived-analysis.worker.ts"),
      "utf8",
    );
    expect(source).toContain("executeAnalysisTask(");
    expect(source).toContain('schemaVersion: "3dena.analysis-execution-dataset.v2"');
    expect(source).toContain('sourceKind: "prepared-exchange"');
    expect(source).not.toContain('from "@/lib/prepared-derived-analysis"');
    expect(source).not.toContain("describePreparedGroups(");
    expect(source).not.toContain("comparePreparedGroupNetworks(");
    expect(source).not.toContain("analyzePreparedChangeNetwork(");
  });
});
