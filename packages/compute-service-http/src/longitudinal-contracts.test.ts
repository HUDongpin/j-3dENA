import { createHash } from "node:crypto";

import {
  analyzeRows,
  hashAnalysisValueV1,
  type AnalysisResult,
  type LongitudinalExecutionRequestV2,
  type TrajectoryRunSpecV2,
} from "@3dena/analysis";
import { describe, expect, it } from "vitest";

import {
  LONGITUDINAL_COMPUTE_SUBMISSION_VERSION_V2,
  LongitudinalComputeSubmissionErrorV2,
  materializeLongitudinalComputeSubmissionV2,
  type ApprovedLongitudinalExecutionBuildV2,
  type LongitudinalComputeSubmissionV2,
} from "./longitudinal-contracts";

const DATASET_HASH = "1".repeat(64);
const APPROVED_BUILD: ApprovedLongitudinalExecutionBuildV2 = {
  jenaVersion: "0.7.0-ona.0",
  jenaCommit: "2".repeat(40),
  jenaTarballIntegrity: "sha512-approved-fixture",
  sdkVersion: "0.2.0-implemented-unverified.5",
  buildId: "approved-longitudinal-build-1",
};
const FIXED_PROJECTION_SEMANTICS =
  "one immutable fitted jENA rotation; fixed projectIn full-space recovery; participant-period reduction before group-time centroids";

function fittedResult(): AnalysisResult {
  const result = analyzeRows({
    rows: [
      { Student: "private-a", Group: "A", Time: "T1", Weight: 2, A: 1, B: 1, C: 0, D: 0 },
      { Student: "private-a", Group: "A", Time: "T2", Weight: 2, A: 0, B: 1, C: 1, D: 0 },
      { Student: "private-b", Group: "B", Time: "T1", Weight: 3, A: 1, B: 0, C: 0, D: 1 },
      { Student: "private-b", Group: "B", Time: "T2", Weight: 3, A: 0, B: 0, C: 1, D: 1 },
    ],
    mapping: {
      units: ["Student", "Group"],
      conversation: ["Time"],
      codes: ["A", "B", "C", "D"],
      metadata: ["Weight"],
      trajectory: {
        participant: ["Student"],
        group: "Group",
        time: "Time",
        timeOrder: ["T1", "T2"],
        cohortPolicy: "available",
      },
    },
    config: { model: "SeparateTrajectory", windowSizeBack: 4 },
  });
  const participantTokens = new Map<string, string>();
  const unitTokens = new Map<string, string>();
  const stepTokens = new Map<string, string>();
  const token = (map: Map<string, string>, canonical: string, namespace: string): string => {
    const existing = map.get(canonical);
    if (existing) return existing;
    const created = `${namespace}-${map.size + 1}-${createHash("sha256").update(canonical).digest("hex").slice(0, 32)}`;
    map.set(canonical, created);
    return created;
  };
  result.points = result.points.map((point) => {
    const participantToken = token(participantTokens, point.participantLabel.canonical, "participant");
    const unitToken = token(unitTokens, point.unit.canonical, "unit");
    const stepToken = token(stepTokens, point.step?.canonical ?? point.id.canonical, "step");
    const unit = {
      columns: [...point.unit.columns],
      values: [unitToken, point.group!.value],
      canonical: `opaque-unit:${unitToken}`,
      display: "Opaque unit",
    };
    const step = {
      columns: [...point.step!.columns],
      values: [point.time!.value],
      canonical: `opaque-step:${stepToken}`,
      display: "Opaque step",
    };
    return {
      ...point,
      participantLabel: {
        columns: [...point.participantLabel.columns],
        values: [participantToken],
        canonical: `opaque-participant:${participantToken}`,
        display: "Opaque participant",
      },
      unit,
      step,
      id: {
        columns: [...unit.columns, ...step.columns],
        values: [...unit.values, ...step.values],
        canonical: `opaque-point:${unitToken}:${stepToken}`,
        display: "Opaque fitted point",
      },
      metadata: { Weight: point.metadata.Weight! },
    };
  });
  result.accumulation.modelCounts.rowKeys = result.points.map((point) => structuredClone(point.id));
  result.accumulation.rowCounts = {
    rowKeys: [],
    columns: [...result.accumulation.rowCounts.columns],
    values: [],
  };
  result.trajectory!.participantPeriods = [];
  result.trajectory!.centroids = [];
  result.trajectory!.paths = result.trajectory!.paths.map((path) => ({
    group: structuredClone(path.group),
    steps: path.steps.map((step) => ({ time: structuredClone(step.time), centroidIndex: null })),
  }));
  result.summary.rowCountRows = 0;
  result.summary.participantPeriods = 0;
  result.summary.trajectoryCentroids = 0;
  result.summary.units = new Set(result.points.map((point) => point.unit.canonical)).size;
  result.diagnostics = [{
    code: "FITTED_JENA_FIXED_ROTATION_ADAPTER_V2",
    severity: "info",
    message: "Full-space coordinates were projected by jENA against the immutable successful-fit rotation; no ENA accumulation or rotation fit was repeated.",
    path: "provenance.resultSemantics",
  }];
  result.provenance.adapter = "@3dena/analysis";
  result.provenance.adapterVersion = APPROVED_BUILD.sdkVersion;
  result.provenance.jenaPackage = "jena-js";
  result.provenance.jenaVersion = APPROVED_BUILD.jenaVersion;
  result.provenance.jenaCommit = APPROVED_BUILD.jenaCommit;
  result.provenance.resultSemantics = FIXED_PROJECTION_SEMANTICS;
  return result;
}

async function submission(): Promise<LongitudinalComputeSubmissionV2> {
  const result = fittedResult();
  const sourceResultHash = await hashAnalysisValueV1(result);
  const runSpec: TrajectoryRunSpecV2 = {
    schemaVersion: "3dena.trajectory-run-spec.v2",
    sourceResultHash,
    participantColumns: ["Student"],
    timeColumn: "Time",
    groupColumn: "Group",
    orderedPeriods: result.trajectory!.timeOrder.map((time, index) => ({
      identity: { components: [{ name: "Time", type: "string", value: String(time.value) }] },
      sourceTimeCanonical: time.canonical,
      displayLabel: time.display,
      expected: true,
      value: { type: "ordered-index-v2", index },
    })),
    selectedDimensions: [...result.axes],
    cohortPolicy: "available",
    missingValuePolicy: "complete-analytical-rows",
    estimand: { kind: "weighted-participant", metadataField: "Weight" },
  };
  const specHash = await hashAnalysisValueV1(runSpec);
  return {
    schemaVersion: LONGITUDINAL_COMPUTE_SUBMISSION_VERSION_V2,
    dataset: {
      schemaVersion: "3dena.analysis-execution-dataset.v2",
      receipt: {
        schemaVersion: "3dena.dataset-receipt.v1",
        sha256: DATASET_HASH,
        byteLength: 1,
        format: "csv",
        sheet: null,
        rows: 4,
        columns: 8,
        schema: {
          schemaVersion: "3dena.dataset-schema.v1",
          headers: ["Student", "Group", "Time", "Weight", "A", "B", "C", "D"],
          columns: ["Student", "Group", "Time", "Weight", "A", "B", "C", "D"].map((name) => ({
            name,
            inferredType: "string" as const,
            roles: ["metadata" as const],
          })),
        },
        limits: {
          schemaVersion: "3dena.dataset-limits.v1",
          maxFileBytes: 1_000,
          maxWorksheets: 1,
          maxRows: 1_000,
          maxColumns: 100,
          maxCells: 100_000,
        },
        warnings: [],
        activationIdentity: `open-ena:${DATASET_HASH}:${specHash}`,
      },
      specHash,
      buildId: APPROVED_BUILD.buildId,
      sourceResult: { sourceKind: "raw-jena", hash: sourceResultHash, result },
    },
    pathTask: {
      schemaVersion: "3dena.trajectory-path-task.v2",
      kind: "trajectory-path-v2",
      datasetHash: DATASET_HASH,
      specHash,
      runId: "opaque-run-1",
      runSpec,
    },
    seed: 2026,
    processingPolicyConfirmed: true,
  };
}

async function rebindSource(
  value: LongitudinalComputeSubmissionV2,
  mutate: (result: AnalysisResult) => void,
): Promise<LongitudinalComputeSubmissionV2> {
  const copy = structuredClone(value);
  const source = copy.dataset.sourceResult!;
  mutate(source.result as AnalysisResult);
  source.hash = await hashAnalysisValueV1(source.result);
  copy.pathTask.runSpec.sourceResultHash = source.hash;
  const specHash = await hashAnalysisValueV1(copy.pathTask.runSpec);
  copy.dataset.specHash = specHash;
  copy.pathTask.specHash = specHash;
  copy.dataset.receipt.activationIdentity = `open-ena:${DATASET_HASH}:${specHash}`;
  return copy;
}

describe("durable longitudinal V2 submission materializer", () => {
  it("injects only the approved build identity and returns deterministic canonical bytes and hash", async () => {
    const firstInput = await submission();
    const first = await materializeLongitudinalComputeSubmissionV2(firstInput, APPROVED_BUILD);
    const reordered = {
      processingPolicyConfirmed: true,
      seed: firstInput.seed,
      pathTask: firstInput.pathTask,
      dataset: firstInput.dataset,
      schemaVersion: firstInput.schemaVersion,
    } as LongitudinalComputeSubmissionV2;
    const second = await materializeLongitudinalComputeSubmissionV2(reordered, { ...APPROVED_BUILD });

    expect(first.canonicalRequest.execution).toEqual({
      target: "persistent-compute-service",
      ...APPROVED_BUILD,
      seed: 2026,
    });
    expect(first.canonicalRequest).not.toHaveProperty("bootstrapTask");
    expect(first.canonicalBytes).toEqual(second.canonicalBytes);
    expect(first.requestSha256).toBe(second.requestSha256);
    expect(first.requestSha256).toBe(createHash("sha256").update(first.canonicalBytes).digest("hex"));
    expect(JSON.parse(new TextDecoder().decode(first.canonicalBytes))).toEqual(first.canonicalRequest);
    expect(Object.isFrozen(first.canonicalRequest)).toBe(true);
  });

  it("rejects unknown fields, build injection, and an unconfirmed processing policy", async () => {
    const valid = await submission();
    await expect(materializeLongitudinalComputeSubmissionV2(
      { ...valid, execution: { target: "browser-worker" } } as unknown,
      APPROVED_BUILD,
    )).rejects.toThrow(/unknown field.*execution/u);
    await expect(materializeLongitudinalComputeSubmissionV2(
      { ...valid, rawRows: [{ Student: "private-a" }] } as unknown,
      APPROVED_BUILD,
    )).rejects.toThrow(/unknown field.*rawRows/u);
    await expect(materializeLongitudinalComputeSubmissionV2(
      { ...valid, processingPolicyConfirmed: false } as unknown,
      APPROVED_BUILD,
    )).rejects.toThrow(/processingPolicyConfirmed/u);
    await expect(materializeLongitudinalComputeSubmissionV2(
      { ...valid, dataset: { ...valid.dataset, buildId: "attacker-build" } },
      APPROVED_BUILD,
    )).rejects.toThrow(/approved build/u);
  });

  it("rejects raw participant components and non-generic identity labels", async () => {
    const valid = await submission();
    const rawValue = await rebindSource(valid, (result) => {
      result.points[0]!.participantLabel.values[0] = "private-a";
    });
    await expect(materializeLongitudinalComputeSubmissionV2(rawValue, APPROVED_BUILD)).rejects.toThrowError(
      expect.objectContaining({ code: "PRIVACY_BOUNDARY_VIOLATION" }),
    );

    const rawDisplay = await rebindSource(valid, (result) => {
      result.points[0]!.unit.display = "Student private-a";
    });
    await expect(materializeLongitudinalComputeSubmissionV2(rawDisplay, APPROVED_BUILD)).rejects.toThrow(/Opaque unit/u);
  });

  it("rejects raw row-count tables, retained trajectory reductions, and undeclared metadata", async () => {
    const valid = await submission();
    const rowCounts = await rebindSource(valid, (result) => {
      result.accumulation.rowCounts.rowKeys.push(structuredClone(result.points[0]!.id));
      result.accumulation.rowCounts.values.push(result.accumulation.rowCounts.columns.map(() => 1));
      result.summary.rowCountRows = 1;
    });
    await expect(materializeLongitudinalComputeSubmissionV2(rowCounts, APPROVED_BUILD)).rejects.toThrow(/rowCounts/u);

    const reductions = await rebindSource(valid, (result) => {
      result.trajectory!.participantPeriods.push({} as never);
    });
    await expect(materializeLongitudinalComputeSubmissionV2(reductions, APPROVED_BUILD)).rejects.toThrow(/participantPeriods/u);

    const metadata = await rebindSource(valid, (result) => {
      result.points[0]!.metadata.PrivateStudentId = "private-a";
    });
    await expect(materializeLongitudinalComputeSubmissionV2(metadata, APPROVED_BUILD)).rejects.toThrow(/metadata/u);
  });

  it("rejects a tampered source hash and every immutable task binding mismatch", async () => {
    const valid = await submission();
    await expect(materializeLongitudinalComputeSubmissionV2({
      ...valid,
      dataset: {
        ...valid.dataset,
        sourceResult: { ...valid.dataset.sourceResult!, hash: "9".repeat(64) },
      },
      pathTask: {
        ...valid.pathTask,
        runSpec: { ...valid.pathTask.runSpec, sourceResultHash: "9".repeat(64) },
      },
    }, APPROVED_BUILD)).rejects.toThrowError(expect.objectContaining({ code: "SOURCE_HASH_MISMATCH" }));

    for (const mutated of [
      { ...valid, pathTask: { ...valid.pathTask, datasetHash: "3".repeat(64) } },
      { ...valid, pathTask: { ...valid.pathTask, specHash: "4".repeat(64) } },
      {
        ...valid,
        pathTask: {
          ...valid.pathTask,
          runSpec: { ...valid.pathTask.runSpec, sourceResultHash: "5".repeat(64) },
        },
      },
    ]) {
      await expect(materializeLongitudinalComputeSubmissionV2(mutated, APPROVED_BUILD)).rejects.toThrowError(
        expect.objectContaining({ code: "IMMUTABLE_BINDING_MISMATCH" }),
      );
    }
  });

  it("rejects a caller-rehashed source that claims an unapproved jENA or SDK build", async () => {
    const valid = await submission();
    const tampered = await rebindSource(valid, (result) => {
      result.provenance.jenaCommit = "6".repeat(40);
      result.provenance.adapterVersion = "attacker-sdk";
    });
    await expect(materializeLongitudinalComputeSubmissionV2(tampered, APPROVED_BUILD)).rejects.toThrowError(
      expect.objectContaining({ code: "UNAPPROVED_SOURCE_BUILD" }),
    );
  });

  it("exposes typed privacy errors without echoing submitted identity values", async () => {
    const valid = await submission();
    (valid.dataset.sourceResult!.result as AnalysisResult).points[0]!.participantLabel.values[0] = "do-not-echo-private-value";
    try {
      await materializeLongitudinalComputeSubmissionV2(valid, APPROVED_BUILD);
      throw new Error("expected privacy rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(LongitudinalComputeSubmissionErrorV2);
      expect((error as Error).message).not.toContain("do-not-echo-private-value");
    }
  });
});

type _CompileTimeRequestCheck = LongitudinalExecutionRequestV2;
void (0 as unknown as _CompileTimeRequestCheck);
