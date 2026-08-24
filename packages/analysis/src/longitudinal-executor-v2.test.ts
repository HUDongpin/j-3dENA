import Ajv from "ajv";
import { describe, expect, it } from "vitest";

import { analyzeRows } from "./analyze";
import { CONTRACT_SCHEMAS_V1, type DatasetReceiptV1 } from "./contracts";
import {
  ANALYSIS_EXECUTION_DATASET_VERSION_V2,
  hashAnalysisValueV1,
  type AnalysisExecutionDatasetV2,
} from "./task-executor";
import {
  assertLongitudinalAnalysisBundleV2,
  executeLongitudinalAnalysisV2,
  type LongitudinalExecutionRequestV2,
  type OrderedTrajectoryPeriodV2,
  type TrajectoryBootstrapTaskV2,
  type TrajectoryInferenceTaskV2,
  type TrajectoryNetworkOverlayTaskV2,
  type TrajectoryPathTaskV2,
  type TrajectoryRunSpecV2,
  verifyLongitudinalAnalysisBundleV2,
} from "./longitudinal-v2";

const DATASET_HASH = "1".repeat(64);
const SPEC_HASH = "2".repeat(64);
const ajv = new Ajv({ strict: false, strictNumbers: true, allErrors: true, validateFormats: false });
for (const schema of Object.values(CONTRACT_SCHEMAS_V1)) ajv.addSchema(schema);

function receipt(): DatasetReceiptV1 {
  const headers = ["Class", "Student", "Condition", "Time", "Weight", "Site", "A", "B", "C", "D"];
  return {
    schemaVersion: "3dena.dataset-receipt.v1",
    sha256: DATASET_HASH,
    byteLength: 1,
    format: "csv",
    sheet: null,
    rows: 8,
    columns: headers.length,
    schema: {
      schemaVersion: "3dena.dataset-schema.v1",
      headers,
      columns: headers.map((name) => ({ name, inferredType: "string", roles: ["metadata"] })),
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
    activationIdentity: "fixture",
  };
}

function fittedResult(
  observedTimes: string[] = ["T1", "T3"],
  model: "SeparateTrajectory" | "AccumulatedTrajectory" = "SeparateTrajectory",
) {
  const rows = [];
  for (const [conditionIndex, condition] of ["A", "B"].entries()) {
    for (const [studentIndex, student] of ["P1", "P2"].entries()) {
      for (const [timeIndex, time] of observedTimes.entries()) {
        const seed = conditionIndex * 20 + studentIndex * 5 + timeIndex * 2;
        rows.push({
          Class: "Class 1",
          Student: student,
          Condition: condition,
          Time: time,
          Weight: studentIndex === 0 ? 1 : 3,
          Site: studentIndex === 0 ? "North" : "South",
          A: seed % 2,
          B: (seed + 1) % 3 === 0 ? 1 : 0,
          C: (seed + 2) % 4 === 0 ? 1 : 0,
          D: (seed + 3) % 5 === 0 ? 1 : 0,
        });
      }
    }
  }
  return analyzeRows({
    rows,
    mapping: {
      units: ["Class", "Student", "Condition"],
      conversation: ["Time"],
      codes: ["A", "B", "C", "D"],
      metadata: ["Weight", "Site"],
      trajectory: {
        participant: ["Class", "Student"],
        group: "Condition",
        time: "Time",
        timeOrder: ["T1", "T2", "T3"],
        cohortPolicy: "available",
      },
    },
    config: { model, windowSizeBack: 4 },
  });
}

function orderedPeriods(result: ReturnType<typeof fittedResult>): OrderedTrajectoryPeriodV2[] {
  return result.trajectory!.timeOrder.map((time, index) => ({
    identity: { components: [{ name: "time", type: "string", value: String(time.value) }] },
    sourceTimeCanonical: time.canonical,
    displayLabel: time.display,
    expected: true,
    value: { type: "ordered-index-v2", index },
  }));
}

async function execution(
  target: LongitudinalExecutionRequestV2["execution"]["target"] = "browser-worker",
  observedTimes: string[] = ["T1", "T3"],
  model: "SeparateTrajectory" | "AccumulatedTrajectory" = "SeparateTrajectory",
) {
  const result = fittedResult(observedTimes, model);
  const sourceHash = await hashAnalysisValueV1(result);
  const dataset: AnalysisExecutionDatasetV2 = {
    schemaVersion: ANALYSIS_EXECUTION_DATASET_VERSION_V2,
    receipt: receipt(),
    specHash: SPEC_HASH,
    buildId: "fixture-source-build",
    sourceResult: { sourceKind: "raw-jena", hash: sourceHash, result },
  };
  const runSpec: TrajectoryRunSpecV2 = {
    schemaVersion: "3dena.trajectory-run-spec.v2",
    sourceResultHash: sourceHash,
    participantColumns: ["Class", "Student"],
    timeColumn: "Time",
    groupColumn: "Condition",
    orderedPeriods: orderedPeriods(result),
    selectedDimensions: [...result.axes],
    cohortPolicy: "available",
    missingValuePolicy: "complete-analytical-rows",
    estimand: { kind: "equal-participant" },
  };
  const pathTask: TrajectoryPathTaskV2 = {
    schemaVersion: "3dena.trajectory-path-task.v2",
    kind: "trajectory-path-v2",
    datasetHash: DATASET_HASH,
    specHash: SPEC_HASH,
    runId: "fixture-run",
    runSpec,
  };
  return {
    input: {
      dataset,
      pathTask,
      execution: {
        target,
        jenaVersion: "0.7.0-ona.0",
        jenaCommit: "94ea8519b6b2742b791924bc449e1b795135c5a0",
        jenaTarballIntegrity: "sha512-fixture",
        sdkVersion: "0.2.0",
        buildId: "fixture-analysis-build",
        seed: 2026,
      },
    } satisfies LongitudinalExecutionRequestV2,
    result,
  };
}

describe("longitudinal analysis V2 executor", () => {
  it("binds one fitted jENA result to all groups, full-space metrics, gaps and a deterministic scientific result hash", async () => {
    const browser = await execution("browser-worker");
    const node = await execution("node-service");
    const browserBundle = await executeLongitudinalAnalysisV2(browser.input);
    const nodeBundle = await executeLongitudinalAnalysisV2({
      ...node.input,
      pathTask: { ...node.input.pathTask, runId: "operational-run-created-later" },
    });

    expect(browserBundle.schemaVersion).toBe("3dena.longitudinal-analysis-bundle.v2");
    expect(browserBundle.paths).toHaveLength(2);
    expect(browserBundle.model.fullRotationDimensions.length).toBeGreaterThan(3);
    expect(browserBundle.paths.every(({ dynamics }) => dynamics.periods[1]!.selectedCentroid === null)).toBe(true);
    expect(browserBundle.paths.every(({ dynamics }) => dynamics.periods[2]!.selected3d.stepDistance === null)).toBe(true);
    expect(browserBundle.identity.resultHash).toMatch(/^[a-f0-9]{64}$/);
    expect(browserBundle.identity.resultHash).toBe(nodeBundle.identity.resultHash);
    expect(browserBundle.identity.runId).not.toBe(nodeBundle.identity.runId);
    expect(browserBundle.paths).toEqual(nodeBundle.paths);
    expect(browserBundle.execution.target).toBe("browser-worker");
    expect(nodeBundle.execution.target).toBe("node-service");
    expect(Object.isFrozen(browserBundle)).toBe(true);
  });

  it("fails closed on source, dataset, spec and model binding mismatches", async () => {
    const { input } = await execution();
    await expect(executeLongitudinalAnalysisV2({
      ...input,
      pathTask: { ...input.pathTask, datasetHash: "3".repeat(64) },
    })).rejects.toThrowError(expect.objectContaining({ code: "TRAJECTORY_DATASET_BINDING_MISMATCH" }));

    const endpoint = fittedResult();
    endpoint.provenance.resolvedConfig.model = "EndPoint";
    const endpointHash = await hashAnalysisValueV1(endpoint);
    await expect(executeLongitudinalAnalysisV2({
      ...input,
      dataset: {
        ...input.dataset,
        sourceResult: { sourceKind: "raw-jena", hash: endpointHash, result: endpoint },
      },
      pathTask: {
        ...input.pathTask,
        runSpec: { ...input.pathTask.runSpec, sourceResultHash: endpointHash },
      },
    })).rejects.toThrowError(expect.objectContaining({ code: "UNSUPPORTED_LONGITUDINAL_MODEL" }));
  });

  it("coordinates independent, paired, repeated, whole-path permutation and cluster bootstrap tasks in one immutable family", async () => {
    const { input, result } = await execution("browser-worker", ["T1", "T2", "T3"]);
    const groups = result.trajectory!.groupOrder.map((group) => group.canonical) as [string, string];
    const periods = result.trajectory!.timeOrder.map((period) => period.canonical);
    const inferenceTask: TrajectoryInferenceTaskV2 = {
      schemaVersion: "3dena.trajectory-inference-task.v2",
      kind: "trajectory-inference-v2",
      datasetHash: DATASET_HASH,
      specHash: SPEC_HASH,
      sourceResultHash: input.pathTask.runSpec.sourceResultHash,
      runId: input.pathTask.runId,
      adjustment: "holm",
      requests: [
        { kind: "independent-period", groups, periodCanonical: periods[1]! },
        {
          kind: "paired-periods",
          group: groups[0],
          earlierPeriodCanonical: periods[0]!,
          laterPeriodCanonical: periods[2]!,
          samePhysicalEntityConfirmed: true,
        },
        {
          kind: "repeated-periods",
          group: groups[0],
          periodCanonicals: periods,
          samePhysicalEntityConfirmed: true,
        },
        {
          kind: "path-comparison",
          design: "independent",
          groups,
          repetitions: 50,
          seed: 2026,
          samePhysicalEntityConfirmed: false,
        },
      ],
    };
    const bootstrapTask: TrajectoryBootstrapTaskV2 = {
      schemaVersion: "3dena.trajectory-bootstrap-task.v2",
      kind: "trajectory-bootstrap-v2",
      datasetHash: DATASET_HASH,
      specHash: SPEC_HASH,
      sourceResultHash: input.pathTask.runSpec.sourceResultHash,
      runId: input.pathTask.runId,
      repetitions: 50,
      confidenceLevel: 0.8,
      seed: 2026,
      resamplingDesign: "within-group",
      explicitStrataField: null,
      interval: "pointwise-percentile-linear-type7",
      rotationPolicy: "fixed-same-fit-projection",
    };
    const taskInput: LongitudinalExecutionRequestV2 = { ...input, inferenceTask, bootstrapTask };
    const first = await executeLongitudinalAnalysisV2(taskInput);
    const second = await executeLongitudinalAnalysisV2(structuredClone(taskInput));

    expect(first.inference).toHaveLength(3);
    const independent = first.inference.find(({ request }) => request.kind === "independent-period")!;
    expect(independent.status).toBe("available");
    expect(independent.rows).toHaveLength(3);
    expect(independent.rows.every((row) => row.familySize === 3 && typeof row.pHolm === "number")).toBe(true);
    const paired = first.inference.find(({ request }) => request.kind === "paired-periods")!;
    expect(paired.rows).toHaveLength(3);
    expect(paired.rows.every((row) => row.design === "paired" && row.identityOverlapAudit !== undefined)).toBe(true);
    const repeated = first.inference.find(({ request }) => request.kind === "repeated-periods")!;
    expect(repeated.rows.filter((row) => row.test === "friedman")).toHaveLength(3);
    expect(repeated.rows.filter((row) => row.test === "wilcoxon-signed-rank")).toHaveLength(9);
    expect(repeated.rows.every((row) => typeof row.familyId === "string" && typeof row.familySize === "number")).toBe(true);

    expect(first.pathComparisons).toHaveLength(1);
    expect(first.pathComparisons[0]!.result.permutation.replicateCount).toBe(50);
    expect(first.pathComparisons[0]!.result.tests.every((test) => test.holmAdjustedPValue >= test.pValue)).toBe(true);
    expect(first.pathComparisons[0]!.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.bootstrap).toHaveLength(2);
    expect(first.bootstrap.every((entry) => entry.totalReplicates === 50 && entry.planHash.match(/^[a-f0-9]{64}$/))).toBe(true);
    expect(first.bootstrap.map((entry) => [entry.status, entry.finiteReplicates, entry.requiredFiniteReplicates])).toEqual([
      ["available", 50, 50],
      ["available", 50, 50],
    ]);
    expect(first.bootstrap.every((entry) => entry.speedIntervals[1]!.selected !== null)).toBe(true);
    expect(first.execution.permutationPlanHashes).toEqual([first.pathComparisons[0]!.planHash]);
    expect(first.execution.resamplingPlanHashes).toEqual(first.bootstrap.map(({ planHash }) => planHash));
    expect(first.identity.resultHash).toBe(second.identity.resultHash);
    expect(first.pathComparisons).toEqual(second.pathComparisons);
    expect(first.bootstrap).toEqual(second.bootstrap);
  });

  it("disables unconfirmed paired designs instead of silently degrading them", async () => {
    const { input, result } = await execution("browser-worker", ["T1", "T2", "T3"]);
    const group = result.trajectory!.groupOrder[0]!.canonical;
    const periods = result.trajectory!.timeOrder.map((period) => period.canonical);
    const inferenceTask: TrajectoryInferenceTaskV2 = {
      schemaVersion: "3dena.trajectory-inference-task.v2",
      kind: "trajectory-inference-v2",
      datasetHash: DATASET_HASH,
      specHash: SPEC_HASH,
      sourceResultHash: input.pathTask.runSpec.sourceResultHash,
      runId: input.pathTask.runId,
      adjustment: "holm",
      requests: [{
        kind: "paired-periods",
        group,
        earlierPeriodCanonical: periods[0]!,
        laterPeriodCanonical: periods[2]!,
        samePhysicalEntityConfirmed: false,
      }],
    };
    const bundle = await executeLongitudinalAnalysisV2({ ...input, inferenceTask });

    expect(bundle.inference).toEqual([expect.objectContaining({
      status: "disabled",
      reason: "same-physical-entity-not-confirmed",
      rows: [],
    })]);
    expect(bundle.pathComparisons).toEqual([]);
  });

  it("records the physical-identity overlap audit for confirmed paired whole-path comparison", async () => {
    const { input, result } = await execution("browser-worker", ["T1", "T2", "T3"]);
    const groups = result.trajectory!.groupOrder.map((group) => group.canonical) as [string, string];
    const inferenceTask: TrajectoryInferenceTaskV2 = {
      schemaVersion: "3dena.trajectory-inference-task.v2",
      kind: "trajectory-inference-v2",
      datasetHash: DATASET_HASH,
      specHash: SPEC_HASH,
      sourceResultHash: input.pathTask.runSpec.sourceResultHash,
      runId: input.pathTask.runId,
      adjustment: "holm",
      requests: [{
        kind: "path-comparison",
        design: "paired",
        groups,
        repetitions: 50,
        seed: 2026,
        samePhysicalEntityConfirmed: true,
      }],
    };

    const bundle = await executeLongitudinalAnalysisV2({ ...input, inferenceTask });

    expect(bundle.pathComparisons).toHaveLength(1);
    expect(bundle.pathComparisons[0]!.identityOverlapAudit).toEqual({
      sideAEntities: 2,
      sideBEntities: 2,
      overlappingEntities: 2,
      pairedCompleteEntities: 2,
      sideAOnly: 0,
      sideBOnly: 0,
      excludedIncompleteOverlap: 0,
      samePhysicalEntityConfirmed: true,
    });
    expect(bundle.pathComparisons[0]!.result.periods.every((period) => period.nMatched === 2)).toBe(true);
  });

  it("binds weighted centroids and explicit stable-metadata strata to the same fitted points", async () => {
    const { input } = await execution("browser-worker", ["T1", "T2", "T3"]);
    input.pathTask.runSpec.estimand = { kind: "weighted-participant", metadataField: "Weight" };
    const bootstrapTask: TrajectoryBootstrapTaskV2 = {
      schemaVersion: "3dena.trajectory-bootstrap-task.v2",
      kind: "trajectory-bootstrap-v2",
      datasetHash: DATASET_HASH,
      specHash: SPEC_HASH,
      sourceResultHash: input.pathTask.runSpec.sourceResultHash,
      runId: input.pathTask.runId,
      repetitions: 50,
      confidenceLevel: 0.8,
      seed: 2026,
      resamplingDesign: "explicit-strata",
      explicitStrataField: "Site",
      interval: "pointwise-percentile-linear-type7",
      rotationPolicy: "fixed-same-fit-projection",
    };
    const bundle = await executeLongitudinalAnalysisV2({ ...input, bootstrapTask });

    expect(bundle.paths.every((path) => path.dynamics.estimand.kind === "weighted-participant-v1")).toBe(true);
    expect(bundle.paths.every((path) => path.dynamics.periods.every((period) => period.weightSum === 4))).toBe(true);
    expect(bundle.bootstrap).toHaveLength(2);
    expect(bundle.bootstrap.every((entry) => entry.result.resampling.stratified)).toBe(true);
    expect(bundle.bootstrap.every((entry) => entry.requestedResamplingDesign === "explicit-strata" && entry.resolvedResamplingDesign === "explicit-strata")).toBe(true);
    expect(bundle.bootstrap.every((entry) => entry.result.resampling.strata.map((stratum) => stratum.key.display).join(",") === "North,South")).toBe(true);
  });

  it("uses one coordinated physical-participant plan for global-participant bootstrap", async () => {
    const { input } = await execution("browser-worker", ["T1", "T2", "T3"]);
    const bootstrapTask: TrajectoryBootstrapTaskV2 = {
      schemaVersion: "3dena.trajectory-bootstrap-task.v2",
      kind: "trajectory-bootstrap-v2",
      datasetHash: DATASET_HASH,
      specHash: SPEC_HASH,
      sourceResultHash: input.pathTask.runSpec.sourceResultHash,
      runId: input.pathTask.runId,
      repetitions: 50,
      confidenceLevel: 0.8,
      seed: 2026,
      resamplingDesign: "global-participant",
      explicitStrataField: null,
      interval: "pointwise-percentile-linear-type7",
      rotationPolicy: "fixed-same-fit-projection",
    };

    const bundle = await executeLongitudinalAnalysisV2({ ...input, bootstrapTask });

    expect(new Set(bundle.bootstrap.map(({ planHash }) => planHash)).size).toBe(1);
    expect(bundle.execution.resamplingPlanHashes).toEqual([bundle.bootstrap[0]!.planHash]);
    expect(bundle.bootstrap.every((entry) => entry.resolvedResamplingDesign === "global-participant")).toBe(true);
    expect(bundle.bootstrap.flatMap((entry) => entry.result.resampling.strata)).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: expect.objectContaining({ display: "Global participants" }), unitCount: 2 }),
    ]));
  });

  it("computes time-scoped mean-network overlays from the same fitted line weights and jENA node geometry", async () => {
    const { input, result } = await execution("browser-worker", ["T1", "T2", "T3"]);
    const periodCanonical = result.trajectory!.timeOrder[1]!.canonical;
    const groupCanonical = result.trajectory!.groupOrder[0]!.canonical;
    const networkOverlayTask: TrajectoryNetworkOverlayTaskV2 = {
      schemaVersion: "3dena.trajectory-network-overlay-task.v2",
      kind: "trajectory-network-overlay-v2",
      datasetHash: DATASET_HASH,
      specHash: SPEC_HASH,
      sourceResultHash: input.pathTask.runSpec.sourceResultHash,
      runId: input.pathTask.runId,
      requests: [
        { periodCanonical, groupCanonical: null },
        { periodCanonical, groupCanonical },
      ],
    };

    const bundle = await executeLongitudinalAnalysisV2({ ...input, networkOverlayTask });

    expect(bundle.networkOverlays).toHaveLength(2);
    expect(bundle.networkOverlays[0]).toMatchObject({
      status: "available",
      periodCanonical,
      groupCanonical: null,
      sourceRows: 4,
      participantPeriods: 2,
      dimensions: bundle.model.selectedDimensions,
    });
    expect(bundle.networkOverlays[1]).toMatchObject({
      status: "available",
      periodCanonical,
      groupCanonical,
      sourceRows: 2,
      participantPeriods: 2,
    });
    expect(bundle.networkOverlays.every((overlay) => overlay.nodes.length === result.nodes.length)).toBe(true);
    expect(bundle.networkOverlays.every((overlay) => overlay.edges.length === result.edges.length)).toBe(true);
    expect(bundle.networkOverlays[0]!.nodes[0]!.coordinates).toEqual(
      input.pathTask.runSpec.selectedDimensions.map((dimension) => (
        result.nodes[0]!.fullCoordinates[result.dimensions.indexOf(dimension)]
      )),
    );
  });

  it("rejects unknown envelope fields and scientific-value tampering instead of trusting a displayed hash", async () => {
    const { input } = await execution("browser-worker", ["T1", "T2", "T3"]);
    const bundle = await executeLongitudinalAnalysisV2(input);

    expect(() => assertLongitudinalAnalysisBundleV2(bundle)).not.toThrow();
    expect(
      ajv.validate(CONTRACT_SCHEMAS_V1.longitudinalAnalysisBundleV2.$id, bundle),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    await expect(verifyLongitudinalAnalysisBundleV2(bundle)).resolves.toBeUndefined();
    expect(() => assertLongitudinalAnalysisBundleV2({ ...bundle, unknown: true })).toThrow(/unknown field/i);
    expect(ajv.validate(CONTRACT_SCHEMAS_V1.longitudinalAnalysisBundleV2.$id, { ...bundle, unknown: true })).toBe(false);
    expect(ajv.validate(CONTRACT_SCHEMAS_V1.trajectoryRunSpecV2.$id, { ...bundle.runSpec, unknown: true })).toBe(false);

    const tampered = structuredClone(bundle);
    tampered.paths[0]!.dynamics.periods[0]!.selectedCentroid![0] += 0.125;
    await expect(verifyLongitudinalAnalysisBundleV2(tampered)).rejects.toThrowError(expect.objectContaining({
      code: "LONGITUDINAL_RESULT_HASH_MISMATCH",
    }));
  });

  it("locks accumulated-trajectory chronology to the fitted order while keeping separate-trajectory ordering researcher-controlled", async () => {
    const accumulated = await execution("browser-worker", ["T1", "T2", "T3"], "AccumulatedTrajectory");
    const reordered = structuredClone(accumulated.input);
    const sourcePeriods = reordered.pathTask.runSpec.orderedPeriods.map((period) => ({
      identity: period.identity,
      sourceTimeCanonical: period.sourceTimeCanonical,
      displayLabel: period.displayLabel,
      expected: period.expected,
    })).reverse();
    reordered.pathTask.runSpec.orderedPeriods = sourcePeriods.map((period, index) => ({
      ...period,
      value: { type: "ordered-index-v2", index },
    }));
    await expect(executeLongitudinalAnalysisV2(reordered)).rejects.toThrowError(expect.objectContaining({
      code: "ACCUMULATED_TRAJECTORY_ORDER_MISMATCH",
    }));

    const separate = await execution("browser-worker", ["T1", "T2", "T3"], "SeparateTrajectory");
    const separateReordered = structuredClone(separate.input);
    separateReordered.pathTask.runSpec.orderedPeriods = reordered.pathTask.runSpec.orderedPeriods;
    await expect(executeLongitudinalAnalysisV2(separateReordered)).resolves.toMatchObject({
      model: { type: "SeparateTrajectory" },
    });
  });
});
