import { describe, expect, it } from "vitest";
import Ajv from "ajv";

import {
  ANALYSIS_CONTRACT_VERSION_V1,
  CONTRACT_SCHEMAS_V1,
  DATASET_RECEIPT_VERSION_V1,
  ANALYSIS_TASK_VERSION_V1,
  RESULT_ENVELOPE_VERSION_V1,
  assertAnalysisResultEnvelopeV1,
  assertAnalysisTaskV1,
  assertDisplaySpecV1,
  assertProvenanceManifestV1,
  assertDatasetReceiptV1,
  assertTaskOwnerV1,
  assertTypedScalarV1,
  createTypedKeyV1,
  typedDoubleV1,
  type TypedScalarV1
} from "./contracts";

describe("versioned public contracts", () => {
  it("preserves adjacent IEEE-754 doubles and signed zero in typed keys", () => {
    const one = typedDoubleV1(1);
    const adjacent = typedDoubleV1(1 + Number.EPSILON);
    const positiveZero = typedDoubleV1(0);
    const negativeZero = typedDoubleV1(-0);

    expect(one).not.toEqual(adjacent);
    expect(positiveZero).not.toEqual(negativeZero);
    expect(createTypedKeyV1([{ name: "value", value: one }]).canonical)
      .not.toBe(createTypedKeyV1([{ name: "value", value: adjacent }]).canonical);
  });

  it("keeps int64, factor order, dates, instants, and duration units explicit", () => {
    const values: TypedScalarV1[] = [
      { type: "int64", value: "9007199254740992" },
      { type: "int64", value: "9007199254740993" },
      { type: "factor", value: "second", levels: ["first", "second"], ordered: true },
      { type: "date", value: "2026-08-20" },
      { type: "instant", epochMilliseconds: "1787222400000", timeZone: "Asia/Shanghai", offsetMinutes: 480, fold: 0 },
      { type: "duration", value: "1.5", unit: "days" }
    ];
    values.forEach((value) => expect(() => assertTypedScalarV1(value)).not.toThrow());

    const left = createTypedKeyV1([{ name: "participant", value: values[0]! }]);
    const right = createTypedKeyV1([{ name: "participant", value: values[1]! }]);
    expect(left.canonical).not.toBe(right.canonical);
  });

  it("rejects unsafe or ambiguous tagged identities", () => {
    expect(() => assertTypedScalarV1({ type: "int64", value: "01" })).toThrow(/canonical signed decimal/);
    expect(() => assertTypedScalarV1({ type: "int64", value: "9223372036854775808" })).toThrow(/signed int64/);
    expect(() => assertTypedScalarV1({ type: "date", value: "2026-02-30" })).toThrow(/real calendar date/);
    expect(() => assertTypedScalarV1({ type: "factor", value: "x", levels: ["y"], ordered: false })).toThrow(/occur in levels/);
    expect(() => assertTypedScalarV1({ type: "string", value: "x", extra: true })).toThrow(/unknown field/);
    expect(() => assertTypedScalarV1({ type: "date", value: "0001-01-01" })).not.toThrow();
    expect(() => createTypedKeyV1([
      { name: "group", value: { type: "string", value: "A" } },
      { name: "group", value: { type: "string", value: "B" } }
    ])).toThrow(/duplicates an earlier/);
  });

  it("validates immutable task ownership and exact dataset receipts", () => {
    const owner = {
      contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
      datasetHash: "a".repeat(64),
      specHash: "b".repeat(64),
      runId: "run-1",
      taskId: "task-1"
    };
    expect(() => assertTaskOwnerV1(owner)).not.toThrow();
    expect(() => assertTaskOwnerV1({ ...owner, datasetHash: "not-a-hash" })).toThrow(/SHA-256/);
    expect(() => assertTaskOwnerV1({ ...owner, extra: true })).toThrow(/unknown field/);

    const receipt = {
      schemaVersion: DATASET_RECEIPT_VERSION_V1,
      sha256: "c".repeat(64),
      byteLength: 128,
      format: "xlsx",
      sheet: { index: 0, name: "Data" },
      rows: 4,
      columns: 8,
      schema: {
        schemaVersion: "3dena.dataset-schema.v1",
        headers: ["unit", "conversation", "time", "group", "A", "B", "metadata", "unused"],
        columns: [
          { name: "unit", inferredType: "string", roles: ["unit"] },
          { name: "conversation", inferredType: "string", roles: ["conversation"] },
          { name: "time", inferredType: "string", roles: ["time"] },
          { name: "group", inferredType: "string", roles: ["unit", "group"] },
          { name: "A", inferredType: "number", roles: ["code"] },
          { name: "B", inferredType: "number", roles: ["code"] },
          { name: "metadata", inferredType: "mixed", roles: ["metadata"] },
          { name: "unused", inferredType: "null", roles: ["unmapped"] },
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
      activationIdentity: "dataset:c"
    };
    expect(() => assertDatasetReceiptV1(receipt)).not.toThrow();
    expect(() => assertDatasetReceiptV1({ ...receipt, byteLength: -1 })).toThrow(/positive/);
    expect(() => assertDatasetReceiptV1({ ...receipt, extra: true })).toThrow(/unknown field/);
  });

  it("strictly validates the discriminated task union", () => {
    const owner = {
      contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
      datasetHash: "a".repeat(64),
      specHash: "b".repeat(64),
      runId: "run-1",
      taskId: "task-1"
    };
    const task = {
      schemaVersion: ANALYSIS_TASK_VERSION_V1,
      kind: "network-comparison",
      owner,
      deadlineEpochMilliseconds: 1_800_000_000_000,
      sourceResultHash: "c".repeat(64),
      groups: ["group-a", "group-b"]
    };
    expect(() => assertAnalysisTaskV1(task)).not.toThrow();
    expect(() => assertAnalysisTaskV1({ ...task, groups: ["same", "same"] })).toThrow(/different/);
    expect(() => assertAnalysisTaskV1({ ...task, unknown: true })).toThrow(/unknown field/);
    expect(() => assertAnalysisTaskV1({ ...task, kind: "bootstrap" })).toThrow(/unknown field|missing required field/);

    const change = {
      schemaVersion: ANALYSIS_TASK_VERSION_V1,
      kind: "change-network",
      owner,
      deadlineEpochMilliseconds: 1_800_000_000_000,
      sourceResultHash: "c".repeat(64),
      field: "numeric-level",
      level: 1,
    };
    expect(() => assertAnalysisTaskV1(change)).not.toThrow();
    expect(() => assertAnalysisTaskV1({ ...change, level: null })).not.toThrow();
    expect(() => assertAnalysisTaskV1({ ...change, level: true })).not.toThrow();
    expect(() => assertAnalysisTaskV1({ ...change, level: Number.NaN })).toThrow(/finite JSON scalar/);
    expect(() => assertAnalysisTaskV1({ ...change, level: Number.MAX_SAFE_INTEGER + 1 })).toThrow(/unsafe integer/);
  });

  it("requires explicit trajectory time semantics and estimand ownership", () => {
    const task = {
      schemaVersion: ANALYSIS_TASK_VERSION_V1,
      kind: "trajectory",
      owner: {
        contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
        datasetHash: "a".repeat(64),
        specHash: "b".repeat(64),
        runId: "run-trajectory",
        taskId: "trajectory-1",
      },
      deadlineEpochMilliseconds: 1_800_000_000_000,
      sourceResultHash: "c".repeat(64),
      group: "group-a",
      selectedDimensions: ["SVD1", "SVD2", "SVD3"],
      cohortPolicy: "available",
      periods: [
        { sourceTimeCanonical: "time-1", value: { type: "date-v1", value: "2026-08-20" } },
        { sourceTimeCanonical: "time-2", value: { type: "date-v1", value: "2026-08-21" } },
      ],
      estimand: { kind: "weighted-participant-v1", metadataField: "analysis_weight" },
    };
    expect(() => assertAnalysisTaskV1(task)).not.toThrow();
    expect(() => assertAnalysisTaskV1({ ...task, periods: [{ sourceTimeCanonical: "time-1", value: { type: "date-v1", value: "2026-02-30" } }] })).toThrow(/real calendar date/);
    expect(() => assertAnalysisTaskV1({ ...task, periods: [task.periods[0], task.periods[0]] })).toThrow(/duplicates an earlier/);
    expect(() => assertAnalysisTaskV1({ ...task, estimand: { kind: "weighted-participant-v1", metadataField: "" } })).toThrow(/non-empty/);
  });

  it("ships stable JSON-schema identifiers with the TypeScript contracts", () => {
    expect(CONTRACT_SCHEMAS_V1.taskOwner.$id).toMatch(/task-owner\.v1/);
    expect(CONTRACT_SCHEMAS_V1.analysisExecutionDatasetV2.$id).toMatch(/analysis-execution-dataset\.v2/);
    expect(CONTRACT_SCHEMAS_V1.analysisTask.discriminator).toEqual({ propertyName: "kind" });
  });

  it("compiles every public JSON Schema and rejects unknown task fields", () => {
    const ajv = new Ajv({ strict: false, strictNumbers: true, allErrors: true, validateFormats: false });
    for (const schema of Object.values(CONTRACT_SCHEMAS_V1)) ajv.addSchema(schema);
    const task = {
      schemaVersion: ANALYSIS_TASK_VERSION_V1,
      kind: "network-comparison",
      owner: {
        contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
        datasetHash: "a".repeat(64),
        specHash: "b".repeat(64),
        runId: "run-schema",
        taskId: "task-schema",
      },
      deadlineEpochMilliseconds: 1_800_000_000_000,
      sourceResultHash: "c".repeat(64),
      groups: ["group-a", "group-b"],
    };
    expect(ajv.validate(CONTRACT_SCHEMAS_V1.analysisTask.$id, task), JSON.stringify(ajv.errors)).toBe(true);
    expect(ajv.validate(CONTRACT_SCHEMAS_V1.analysisTask.$id, { ...task, secret: "must-not-pass" })).toBe(false);
    expect(ajv.validate(CONTRACT_SCHEMAS_V1.analysisTask.$id, {
      schemaVersion: ANALYSIS_TASK_VERSION_V1,
      kind: "change-network",
      owner: task.owner,
      deadlineEpochMilliseconds: task.deadlineEpochMilliseconds,
      sourceResultHash: task.sourceResultHash,
      field: "numeric-level",
      level: 1,
    }), JSON.stringify(ajv.errors)).toBe(true);
  });

  it("binds each result envelope task kind to one result schema and provenance entry", () => {
    const envelope = {
      schemaVersion: RESULT_ENVELOPE_VERSION_V1,
      owner: {
        contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
        datasetHash: "a".repeat(64),
        specHash: "b".repeat(64),
        runId: "run-envelope",
        taskId: "task-envelope",
      },
      taskKind: "statistics",
      result: { schemaVersion: "3dena.statistics-task-result.v1" },
      diagnostics: [],
      evidence: {
        schemaVersion: "3dena.evidence-stamp.v1",
        scope: "feature",
        status: "IMPLEMENTED_UNVERIFIED",
        approvedForParity: false,
      },
      provenance: {
        schemaVersion: "3dena.provenance-manifest.v1",
        datasetHash: "a".repeat(64),
        specHash: "b".repeat(64),
        resultHash: "c".repeat(64),
        adapterVersion: "0.1.0",
        jenaPackage: "jena-js",
        jenaVersion: "0.6.3",
        jenaCommit: "57b7794ec3873c251c33086454523e5a3949836f",
        sourceKind: "raw-jena",
        jenaExecuted: true,
        sdkPackage: "@3dena/analysis",
        sdkVersion: "0.1.0",
        appVersion: "test",
        contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
        buildId: "build-envelope",
        seed: null,
        toleranceContract: null,
        schemaVersions: [
          ANALYSIS_TASK_VERSION_V1,
          "3dena.statistics-task-result.v1",
          RESULT_ENVELOPE_VERSION_V1,
        ],
        generatedAt: "2026-08-21T00:00:00.000Z",
      },
    };

    expect(() => assertAnalysisResultEnvelopeV1(envelope)).toThrow(/missing required field "design"/);
    const wrongResult = { ...envelope, result: { schemaVersion: "3dena.change-network.v1" } };
    expect(() => assertAnalysisResultEnvelopeV1(wrongResult)).toThrow(/must be 3dena\.statistics-task-result\.v1/);
    const missingProvenanceEntry = {
      ...envelope,
      provenance: {
        ...envelope.provenance,
        schemaVersions: [ANALYSIS_TASK_VERSION_V1, RESULT_ENVELOPE_VERSION_V1],
      },
    };
    expect(() => assertAnalysisResultEnvelopeV1(missingProvenanceEntry)).toThrow(/missing required field "design"/);

    const ajv = new Ajv({ strict: false, strictNumbers: true, allErrors: true, validateFormats: false });
    for (const schema of Object.values(CONTRACT_SCHEMAS_V1)) ajv.addSchema(schema);
    expect(ajv.validate(CONTRACT_SCHEMAS_V1.resultEnvelope.$id, envelope), JSON.stringify(ajv.errors)).toBe(false);
    expect(ajv.validate(CONTRACT_SCHEMAS_V1.resultEnvelope.$id, wrongResult)).toBe(false);
    expect(ajv.validate(CONTRACT_SCHEMAS_V1.resultEnvelope.$id, missingProvenanceEntry)).toBe(false);
  });

  it("validates display-only trace, style, and camera state as one strict contract", () => {
    const spec = {
      schemaVersion: "3dena.display-spec.v1",
      dimensions: ["SVD1", "SVD2", "SVD3"],
      plotDimension: 3,
      groups: ["group-a"],
      showGrid: true,
      showZeroLines: true,
      showAxes: true,
      traces: { points: true, nodes: true, network: true, centroids: true, trajectory: true, uncertainty: false },
      style: { pointSize: 7, pointOpacity: 0.8, nodeSize: 10, nodeOpacity: 1, edgeThreshold: 0, edgeWidthScale: 8, trajectoryWidth: 4 },
      camera: { eye: { x: 1, y: 1, z: 1 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } }
    };
    expect(() => assertDisplaySpecV1(spec)).not.toThrow();
    expect(() => assertDisplaySpecV1({ ...spec, style: { ...spec.style, pointOpacity: 2 } })).toThrow(/\[0, 1\]/);
    expect(() => assertDisplaySpecV1({ ...spec, camera: { ...spec.camera, secret: true } })).toThrow(/unknown field/);
  });

  it("distinguishes raw execution from prepared compatibility in provenance", () => {
    const raw = {
      schemaVersion: "3dena.provenance-manifest.v1",
      datasetHash: "a".repeat(64), specHash: "b".repeat(64), resultHash: "c".repeat(64),
      adapterVersion: "0.1.0", jenaPackage: "jena-js", jenaVersion: "0.6.3", jenaCommit: "commit",
      sourceKind: "raw-jena", jenaExecuted: true, sdkPackage: "@3dena/analysis", sdkVersion: "0.1.0",
      appVersion: "test", contractVersion: ANALYSIS_CONTRACT_VERSION_V1, buildId: "build", seed: null,
      toleranceContract: null, schemaVersions: ["3dena.analysis-result.v1"], generatedAt: "2026-08-20T12:00:00.000Z"
    };
    expect(() => assertProvenanceManifestV1(raw)).not.toThrow();
    expect(() => assertProvenanceManifestV1({ ...raw, sourceKind: "prepared-exchange", jenaExecuted: true })).toThrow(/must be false/);
  });
});
