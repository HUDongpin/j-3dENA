import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Route } from "@playwright/test";
import {
  SMALL_RAW_CSV,
  SYNTHETIC_PREPARED_BYTES,
} from "./helpers/runtime-contract";
import {
  executeAnalysisTask,
  type AnalysisExecutionDatasetV2,
} from "../packages/analysis/src/task-executor";
import type {
  AnalysisTaskV1,
  DatasetReceiptV1,
} from "../packages/analysis/src/contracts";
import { analyzePreparedSpace } from "../packages/analysis/src/prepared-space";
import type {
  PreparedSpaceMapping,
  PreparedSpaceResult,
} from "../packages/analysis/src/prepared-types";
import type { AnalysisResult } from "../packages/analysis/src/types";
import { decodeEna3dExchangeV1WithSha256 } from "../packages/io/src/decode";

const ANALYSIS_CONTRACT_VERSION_V1 = "3dena.contract.v1";

const DATASET_ID = "dataset-remote-e2e";
const DATASET_CAPABILITY = "dataset-capability-remote-e2e";
const JOB_ID = "job-remote-e2e";
const JOB_CAPABILITY = "job-capability-remote-e2e";
const DERIVED_JOB_ID = "job-derived-remote-e2e";
const DERIVED_JOB_CAPABILITY = "job-derived-capability-remote-e2e";
const PREPARED_JOB_ID = "job-prepared-remote-e2e";
const PREPARED_JOB_CAPABILITY = "job-prepared-capability-remote-e2e";
const APPROVAL_MANIFEST = "a".repeat(64);
const GIT_COMMIT = "b".repeat(40);
const FLY_IMAGE = `sha256:${"c".repeat(64)}`;
const FLY_BUILD = "remote-calibration-fly-build";

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*", "x-request-id": "remote-e2e" },
    body: JSON.stringify(body),
  });
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Synthetic result contains a non-finite number.");
    return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object" || value === undefined) {
    throw new Error("Synthetic result contains a value outside canonical JSON.");
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => {
    if (record[key] === undefined) throw new Error(`Synthetic result field ${key} is undefined.`);
    return `${JSON.stringify(key)}:${canonicalJson(record[key])}`;
  }).join(",")}}`;
}

function syntheticTrajectorySourceResult(
  rows: ReadonlyArray<Readonly<Record<string, string | number>>>,
): AnalysisResult {
  const codes = ["EC", "ICT", "MCO", "ATT"] as const;
  const edgePairs = [
    [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3],
  ] as const;
  const dimensions = ["SVD1", "SVD2", "SVD3"];
  const entity = (columns: string[], values: Array<string | number>) => ({
    canonical: JSON.stringify(values.map((value) => [typeof value, value])),
    display: values.join(" · "),
    columns,
    values,
  });
  const typed = (value: string) => ({
    canonical: JSON.stringify(["string", value]),
    display: value,
    value,
  });
  const groupOrder = [typed("Experimental"), typed("Control")];
  const timeOrder = [typed("Lesson 1"), typed("Lesson 2")];
  const edgeColumns = edgePairs.map(([source, target]) => `${codes[source]} & ${codes[target]}`);
  const points = rows.map((row, index) => {
    const group = String(row.Group);
    const participant = String(row.Name);
    const time = String(row.Lesson);
    const participantNumber = Number(participant.replace(/^Student /u, ""));
    const groupDirection = group === "Experimental" ? -1 : 1;
    const timeDirection = time === "Lesson 1" ? -0.5 : 0.5;
    const coordinates: [number, number, number] = [
      groupDirection + participantNumber * 0.04,
      timeDirection + participantNumber * 0.03,
      groupDirection * timeDirection + participantNumber * 0.02,
    ];
    const lineWeights = edgePairs.map(([source, target]) =>
      Number(row[codes[source]]) * Number(row[codes[target]]));
    return {
      index,
      id: entity(["Group", "Name", "Lesson"], [group, participant, time]),
      unit: entity(["Group", "Name"], [group, participant]),
      participantLabel: entity(["Name"], [participant]),
      group: typed(group),
      time: typed(time),
      coordinates,
      fullCoordinates: [...coordinates],
      lineWeights,
      metadata: {},
    };
  });
  const edges = edgePairs.map(([sourceIndex, targetIndex], index) => ({
    index,
    id: `edge:${sourceIndex}:${targetIndex}`,
    column: edgeColumns[index]!,
    source: codes[sourceIndex],
    target: codes[targetIndex],
    sourceIndex,
    targetIndex,
    meanWeight: points.reduce((sum, point) => sum + point.lineWeights[index]!, 0) / points.length,
  }));
  const participantPeriods = points.map((point) => ({
    index: point.index,
    participant: point.unit,
    participantLabel: point.participantLabel,
    group: point.group,
    time: point.time,
    coordinates: [...point.coordinates] as [number, number, number],
    fullCoordinates: [...point.fullCoordinates],
    sourcePointIndexes: [point.index],
    includedInCohort: true,
  }));
  const centroids = groupOrder.flatMap((group) => timeOrder.map((time) => {
    const selected = participantPeriods.filter((point) =>
      point.group.canonical === group.canonical && point.time.canonical === time.canonical);
    const coordinates: [number, number, number] = [0, 1, 2].map((dimension) =>
      selected.reduce((sum, point) => sum + point.fullCoordinates[dimension]!, 0) / selected.length,
    ) as [number, number, number];
    return {
      index: groupOrder.indexOf(group) * timeOrder.length + timeOrder.indexOf(time),
      group,
      time,
      coordinates,
      fullCoordinates: [...coordinates],
      participantCount: selected.length,
      participantPeriodIndexes: selected.map((point) => point.index),
    };
  }));
  return {
    schemaVersion: "3dena.analysis-result.v1",
    dimensions,
    axes: ["SVD1", "SVD2", "SVD3"],
    points,
    nodes: codes.map((code, index) => {
      const coordinates: [number, number, number] = [
        index === 0 ? -0.75 : index === 3 ? 0.75 : 0,
        index === 1 ? 0.75 : index === 2 ? -0.75 : 0,
        index % 2 === 0 ? -0.25 : 0.25,
      ];
      return { index, code, coordinates, fullCoordinates: [...coordinates] };
    }),
    edges,
    accumulation: {
      modelCounts: {
        rowKeys: points.map((point) => point.id),
        columns: edgeColumns,
        values: points.map((point) => [...point.lineWeights]),
      },
      rowCounts: {
        rowKeys: points.map((point) => point.id),
        columns: [...codes, ...edgeColumns],
        values: points.map((point, index) => [
          ...codes.map((code) => Number(rows[index]![code])),
          ...point.lineWeights,
        ]),
      },
    },
    variance: dimensions.map((axis, index) => ({
      axis,
      proportion: [0.6, 0.3, 0.1][index]!,
      eigenvalue: [0.18, 0.09, 0.03][index]!,
      displayed: true,
    })),
    rotation: {
      method: "svd",
      columns: dimensions,
      matrix: [
        [-0.46, 0.81, -0.37], [0.63, 0.59, 0.51], [0.63, 0, -0.78],
        [0.2, -0.4, 0.1], [-0.3, 0.2, 0.4], [0.1, 0.3, -0.2],
      ],
      eigenvalues: [0.18, 0.09, 0.03],
      centerVector: edges.map((edge) => edge.meanWeight),
    },
    trajectory: {
      space: "analysis-result-rotation",
      dimensions,
      cohortPolicy: "available",
      groupOrder,
      timeOrder,
      participantPeriods,
      centroids,
      paths: groupOrder.map((group, groupIndex) => ({
        group,
        steps: timeOrder.map((time, timeIndex) => ({
          time,
          centroidIndex: groupIndex * timeOrder.length + timeIndex,
        })),
      })),
    },
    summary: {
      inputRows: rows.length,
      inputColumns: 7,
      units: new Set(points.map((point) => point.unit.canonical)).size,
      points: points.length,
      nodes: codes.length,
      edges: edges.length,
      modelCountRows: points.length,
      rowCountRows: points.length,
      groups: groupOrder.length,
      timePoints: timeOrder.length,
      participantPeriods: participantPeriods.length,
      trajectoryCentroids: centroids.length,
      dimensions: dimensions.length,
    },
    diagnostics: [],
    provenance: {
      adapter: "@3dena/analysis",
      adapterVersion: "0.1.0",
      jenaPackage: "jena-js",
      jenaVersion: "0.6.3",
      jenaCommit: "57b7794ec3873c251c33086454523e5a3949836f",
      coreGoldenContract: "jena-package-golden-v1",
      legacyGoldenContract: "legacy-application-golden-v1",
      legacyGoldenStatus: "not-assessed",
      parityContract: "3dena.parity-contract.v1",
      resultSemantics: "one shared SVD rotation; participant-period reduction before group-time centroids",
      resolvedConfig: {
        model: "AccumulatedTrajectory",
        window: "MovingStanzaWindow",
        weightBy: "binary",
        windowSizeBack: 4,
        windowSizeForward: 0,
        centerAlignToOrigin: true,
      },
      resolvedLimits: {
        maxRows: 100_000,
        maxColumns: 256,
        maxCells: 5_000_000,
        maxAccumulationCells: 5_000_000,
        maxCodes: 64,
        maxEdges: 2_016,
        maxStringLength: 32_768,
        maxUnits: 50_000,
        maxGroups: 200,
        maxTimePoints: 512,
        maxOutputPoints: 100_000,
        maxDimensions: 200,
        maxCoordinateCells: 5_000_000,
      },
    },
  };
}

async function sourceResultArtifact(
  datasetHash: string,
  specHash: string,
  runId: string,
): Promise<Readonly<{ bytes: Buffer; result: AnalysisResult; resultHash: string }>> {
  const [header = "", ...lines] = readFileSync(SMALL_RAW_CSV, "utf8")
    .trim()
    .split(/\r?\n/u);
  const columns = header.split(",").map((cell) => cell.replace(/^"|"$/gu, ""));
  const rows = lines.map((line) => {
    const cells = line.split(",").map((cell) => cell.replace(/^"|"$/gu, ""));
    return Object.fromEntries(columns.map((column, index) => [
      column,
      ["EC", "ICT", "MCO", "ATT"].includes(column)
        ? Number(cells[index])
        : cells[index] ?? "",
    ])) as Record<string, string | number>;
  });
  const result = syntheticTrajectorySourceResult(rows);
  const resultHash = createHash("sha256").update(canonicalJson(result)).digest("hex");
  const owner = {
    contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
    datasetHash,
    specHash,
    runId,
    taskId: JOB_ID,
  } as const;
  const envelope = {
    schemaVersion: "3dena.analysis-result-envelope.v1",
    owner,
    taskKind: "ena-model",
    result,
    diagnostics: [],
    evidence: {
      schemaVersion: "3dena.evidence-stamp.v1",
      scope: "feature",
      status: "IMPLEMENTED_UNVERIFIED",
      datasetHash,
      specHash,
      buildId: FLY_BUILD,
      approvedForParity: false,
    },
    provenance: {
      schemaVersion: "3dena.provenance-manifest.v1",
      datasetHash,
      specHash,
      resultHash,
      adapterVersion: "remote-e2e-adapter",
      jenaPackage: "jena-js",
      jenaVersion: "0.6.3",
      jenaCommit: "d".repeat(40),
      sourceKind: "raw-jena",
      jenaExecuted: true,
      sdkPackage: "@3dena/analysis",
      sdkVersion: "0.1.0",
      appVersion: "0.1.0",
      contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
      buildId: FLY_BUILD,
      seed: null,
      toleranceContract: null,
      schemaVersions: [
        "3dena.analysis-result-envelope.v1",
        "3dena.analysis-result.v1",
        "3dena.analysis-task.v1",
      ],
      generatedAt: "2026-08-21T00:00:00.000Z",
    },
  } as const;
  return {
    bytes: Buffer.from(JSON.stringify({
      version: "3dena.compute-scientific-result-artifact.v1",
      owner,
      taskKind: "ena-model",
      envelope,
    })),
    result,
    resultHash,
  };
}

async function derivedResultArtifact(input: Readonly<{
  activatedTask: Record<string, unknown>;
  datasetReceipt: DatasetReceiptV1;
  sourceResult: AnalysisResult | PreparedSpaceResult;
  sourceResultHash: string;
  sourceKind?: "raw-jena" | "prepared-exchange";
}>): Promise<Readonly<{ bytes: Buffer; owner: Record<string, unknown> }>> {
  const { runId } = input.activatedTask;
  if (typeof runId !== "string") throw new Error("Derived E2E task did not include a runId.");
  if (input.activatedTask.sourceResultHash !== input.sourceResultHash) {
    throw new Error("Derived E2E task was not bound to the retained source hash.");
  }
  const scientificSpec = Object.fromEntries(Object.entries(input.activatedTask).filter(
    ([field]) => !["schemaVersion", "runId", "deadlineEpochMilliseconds"].includes(field),
  ));
  const specHash = createHash("sha256").update(canonicalJson(scientificSpec)).digest("hex");
  const owner = {
    contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
    datasetHash: input.datasetReceipt.sha256,
    specHash,
    runId,
    taskId: DERIVED_JOB_ID,
  } as const;
  const scientificTask = Object.fromEntries(Object.entries(input.activatedTask).filter(
    ([field]) => !["schemaVersion", "runId"].includes(field),
  ));
  const task = {
    ...scientificTask,
    schemaVersion: "3dena.analysis-task.v1",
    owner,
  } as AnalysisTaskV1;
  const sourceKind = input.sourceKind ?? "raw-jena";
  const sourceResult: NonNullable<AnalysisExecutionDatasetV2["sourceResult"]> =
    sourceKind === "prepared-exchange"
      ? {
          sourceKind,
          hash: input.sourceResultHash,
          result: input.sourceResult as PreparedSpaceResult,
        }
      : {
          sourceKind,
          hash: input.sourceResultHash,
          result: input.sourceResult as AnalysisResult,
        };
  const dataset: AnalysisExecutionDatasetV2 = {
    schemaVersion: "3dena.analysis-execution-dataset.v2",
    receipt: input.datasetReceipt,
    specHash,
    buildId: FLY_BUILD,
    generatedAt: "2026-08-21T00:01:00.000Z",
    sourceResult,
  };
  const envelope = await executeAnalysisTask(dataset, task);
  return {
    bytes: Buffer.from(JSON.stringify({
      version: "3dena.compute-scientific-result-artifact.v1",
      owner,
      taskKind: task.kind,
      envelope,
    })),
    owner,
  };
}

async function preparedResultArtifact(input: Readonly<{
  datasetHash: string;
  mapping: Record<string, unknown>;
  runId: string;
}>): Promise<Readonly<{
  bytes: Buffer;
  owner: Record<string, unknown>;
  result: PreparedSpaceResult;
  resultHash: string;
}>> {
  const artifact = await decodeEna3dExchangeV1WithSha256(SYNTHETIC_PREPARED_BYTES);
  const result = analyzePreparedSpace({
    source: { artifact, name: "uploaded.ena3d.json" },
    mapping: input.mapping as unknown as PreparedSpaceMapping,
  });
  if (result.sourceReceipt.sha256 !== input.datasetHash) {
    throw new Error("Prepared E2E fixture hash does not match the uploaded exact bytes.");
  }
  if (canonicalJson(result.provenance.resolvedMapping) !== canonicalJson(input.mapping)) {
    throw new Error("Prepared E2E task did not preserve the frozen mapping.");
  }
  const specHash = createHash("sha256").update(canonicalJson({
    kind: "prepared-import",
    mapping: input.mapping,
  })).digest("hex");
  const resultHash = createHash("sha256").update(canonicalJson(result)).digest("hex");
  const owner = {
    contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
    datasetHash: input.datasetHash,
    specHash,
    runId: input.runId,
    taskId: PREPARED_JOB_ID,
  } as const;
  const envelope = {
    schemaVersion: "3dena.analysis-result-envelope.v1",
    owner,
    taskKind: "prepared-import",
    result,
    diagnostics: result.diagnostics,
    evidence: {
      schemaVersion: "3dena.evidence-stamp.v1",
      scope: "feature",
      status: "IMPLEMENTED_UNVERIFIED",
      datasetHash: input.datasetHash,
      specHash,
      buildId: FLY_BUILD,
      approvedForParity: false,
    },
    provenance: {
      schemaVersion: "3dena.provenance-manifest.v1",
      datasetHash: input.datasetHash,
      specHash,
      resultHash,
      adapterVersion: "remote-prepared-e2e-adapter",
      jenaPackage: "jena-js",
      jenaVersion: "0.6.3",
      jenaCommit: "d".repeat(40),
      sourceKind: "prepared-exchange",
      jenaExecuted: false,
      sdkPackage: "@3dena/analysis",
      sdkVersion: "0.1.0",
      appVersion: "0.1.0",
      contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
      buildId: FLY_BUILD,
      seed: null,
      toleranceContract: null,
      schemaVersions: [
        "3dena.analysis-result-envelope.v1",
        "3dena.prepared-space-result.v1",
        "3dena.analysis-task.v1",
      ],
      generatedAt: "2026-08-21T00:00:00.000Z",
    },
  } as const;
  return {
    bytes: Buffer.from(JSON.stringify({
      version: "3dena.compute-scientific-result-artifact.v1",
      owner,
      taskKind: "prepared-import",
      envelope,
    })),
    owner,
    result,
    resultHash,
  };
}

test("remote calibration verifies the mocked service build and fails closed without dataset workflow", async ({
  page,
}) => {
  const buildRequests: string[] = [];
  await page.route("**/__remote_calibration__/build-info", async (route) => {
    buildRequests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        schemaVersion: "3dena.compute-build-info.v1",
        approvalManifestSha256: "a".repeat(64),
        releaseId: "remote-calibration-release",
        gitCommit: "b".repeat(40),
        flyImageDigest: `sha256:${"c".repeat(64)}`,
        flyBuildId: "remote-calibration-fly-build",
        role: "api",
        contractVersions: ["3dena.compute-http.v1", "3dena.contract.v1"],
      }),
    });
  });

  await page.goto("/app?remoteCalibration=1");
  const workspace = page.getByTestId("analysis-workspace");
  await expect(workspace).toHaveAttribute("data-execution-mode", "remote");
  await expect(page.getByTestId("remote-runtime-status")).toHaveAttribute(
    "data-state",
    "blocked",
  );
  await expect(page.getByTestId("remote-runtime-status")).toContainText(
    "does not advertise the reviewed dataset workflow contract",
  );
  await expect(page.getByTestId("remote-compute-build")).toHaveText(
    "remote-calibration-fly-build",
  );
  await expect(page.getByTestId("remote-file-input")).toBeDisabled();
  await expect(page.getByTestId("remote-processing-consent")).toBeDisabled();
  await expect(page.getByTestId("raw-file-input")).toHaveCount(0);
  expect(buildRequests.length).toBeGreaterThanOrEqual(1);
  const expectedBuildInfoUrl = new URL(
    "/__remote_calibration__/build-info",
    page.url(),
  ).toString();
  expect(new Set(buildRequests)).toEqual(new Set([
    expectedBuildInfoUrl,
  ]));
});

test("mocked remote service closes ENA, all six source-bound derived analyses, formal downloads, and deletion without a Worker", async ({
  page,
}) => {
  let preflight: Record<string, unknown> | null = null;
  let sourceExecuteBody: Record<string, unknown> | null = null;
  const derivedExecuteBodies: Record<string, unknown>[] = [];
  let sourceArtifact: Awaited<ReturnType<typeof sourceResultArtifact>> | null = null;
  let derivedArtifact: Awaited<ReturnType<typeof derivedResultArtifact>> | null = null;
  let sourceOwner: Record<string, unknown> | null = null;
  let derivedOwner: Record<string, unknown> | null = null;
  const mutations: string[] = [];
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    (window as unknown as { __remoteWorkers: string[] }).__remoteWorkers = [];
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args: ConstructorParameters<typeof Worker>) {
        (window as unknown as { __remoteWorkers: string[] }).__remoteWorkers.push(String(args[0]));
        return Reflect.construct(target, args) as Worker;
      },
    });
  });

  await page.route("**/__remote_calibration__/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/__remote_calibration__", "");
    const method = request.method();
    if (method !== "GET") mutations.push(`${method} ${path}`);
    if (path === "/build-info") {
      await fulfillJson(route, {
        schemaVersion: "3dena.compute-build-info.v1",
        approvalManifestSha256: APPROVAL_MANIFEST,
        releaseId: "remote-calibration-release",
        gitCommit: GIT_COMMIT,
        flyImageDigest: FLY_IMAGE,
        flyBuildId: FLY_BUILD,
        role: "api",
        contractVersions: [
          "3dena.compute-dataset-http.v1",
          "3dena.compute-prepared-import-http.v1",
          "3dena.compute-source-result-job-http.v1",
          "3dena.contract.v1",
        ],
      });
      return;
    }
    if (path === "/v1/datasets" && method === "POST") {
      preflight = (request.postDataJSON() as { preflight: Record<string, unknown> }).preflight;
      await fulfillJson(route, {
        schemaVersion: "3dena.compute-dataset-capability.v1",
        datasetId: DATASET_ID,
        generation: 1,
        capabilityToken: DATASET_CAPABILITY,
        contentUrl: new URL(`/__remote_calibration__/v1/datasets/${DATASET_ID}/content`, request.url()).toString(),
        expiresAt: "2026-08-22T00:00:00.000Z",
      }, 201);
      return;
    }
    if (path.endsWith("/content") && method === "PUT") {
      await fulfillJson(route, {
        schemaVersion: "3dena.inspected-dataset-candidate.v1",
        productStatus: "IMPLEMENTED_UNVERIFIED",
        generation: 1,
        preflightIdentity: preflight?.preflightIdentity,
        uploadIdentity: `upload:sha256:${preflight?.sha256}`,
        inventory: {
          schemaVersion: "3dena.workflow-workbook-inventory.v1",
          format: "csv",
          byteLength: preflight?.byteLength,
          sha256: preflight?.sha256,
          delimiter: ",",
          worksheets: [{
            index: 0,
            name: "CSV",
            visibility: "visible",
            kind: "worksheet",
            selectable: true,
            unselectableReason: null,
            declaredRowCount: 17,
            declaredColumnCount: 7,
          }],
          visibleSelectableWorksheetCount: 1,
          selectionPolicy: "single-visible-auto-otherwise-explicit",
          hiddenWorksheetPolicy: "listed-not-selectable",
          vbaDetectedAndDiscarded: false,
          parserVersion: "remote-e2e-parser",
        },
      }, 201);
      return;
    }
    const worksheet = {
      index: 0,
      name: "CSV",
      visibility: "visible",
      kind: "worksheet",
      selectable: true,
      unselectableReason: null,
      declaredRowCount: 17,
      declaredColumnCount: 7,
    };
    const headers = ["Group", "Lesson", "Name", "EC", "ICT", "MCO", "ATT"];
    if (path.endsWith("/selection") && method === "POST") {
      await fulfillJson(route, {
        schemaVersion: "3dena.parsed-worksheet-candidate.v1",
        productStatus: "IMPLEMENTED_UNVERIFIED",
        generation: 1,
        uploadIdentity: `upload:sha256:${preflight?.sha256}`,
        parsedIdentity: `parsed:sha256:${"e".repeat(64)}`,
        parsedContentSha256: "f".repeat(64),
        worksheet,
        headers,
        rowCount: 16,
        columnCount: 7,
      });
      return;
    }
    if (path.endsWith("/mapping") && method === "PUT") {
      await fulfillJson(route, {
        schemaVersion: "3dena.compute-dataset-mapping-receipt.v1",
        datasetId: DATASET_ID,
        generation: 1,
        parsedIdentity: `parsed:sha256:${"e".repeat(64)}`,
        mappingSha256: "1".repeat(64),
      });
      return;
    }
    const typedPreview = {
      schemaVersion: "3dena.typed-dataset-preview.v1",
      headers,
      rows: [{
        rowIndex: 0,
        values: [
          { type: "string", value: "Experimental" },
          { type: "string", value: "Lesson 1" },
          { type: "string", value: "synthetic-1" },
          { type: "double", ieee754Hex: "3ff0000000000000" },
          { type: "double", ieee754Hex: "0000000000000000" },
          { type: "double", ieee754Hex: "3ff0000000000000" },
          { type: "double", ieee754Hex: "0000000000000000" },
        ],
      }],
      totalRowCount: 16,
      previewRowCount: 1,
    };
    if (path.endsWith("/preview") && method === "POST") {
      await fulfillJson(route, {
        schemaVersion: "3dena.compute-dataset-preview-result.v1",
        datasetId: DATASET_ID,
        generation: 1,
        activationIdentity: `activation:sha256:${"2".repeat(64)}`,
        preview: typedPreview,
        candidate: {
          schemaVersion: "3dena.prepared-dataset-candidate.v1",
          productStatus: "IMPLEMENTED_UNVERIFIED",
          generation: 1,
          uploadIdentity: `upload:sha256:${preflight?.sha256}`,
          parsedIdentity: `parsed:sha256:${"e".repeat(64)}`,
          parsedContentSha256: "f".repeat(64),
          activationIdentity: `activation:sha256:${"2".repeat(64)}`,
          worksheet,
          rowCount: 16,
          columnCount: 7,
          schema: datasetReceipt().schema,
          preview: typedPreview,
          diagnostics: [],
          activatable: true,
        },
      });
      return;
    }
    function datasetReceipt(): DatasetReceiptV1 {
      return {
        schemaVersion: "3dena.dataset-receipt.v1",
        sha256: String(preflight?.sha256),
        byteLength: Number(preflight?.byteLength),
        format: "csv",
        sheet: null,
        rows: 16,
        columns: 7,
        schema: {
          schemaVersion: "3dena.dataset-schema.v1",
          headers,
          columns: [
            { name: "Group", inferredType: "string", roles: ["unit", "group"] },
            { name: "Lesson", inferredType: "string", roles: ["conversation", "time"] },
            { name: "Name", inferredType: "string", roles: ["unit"] },
            { name: "EC", inferredType: "number", roles: ["code"] },
            { name: "ICT", inferredType: "number", roles: ["code"] },
            { name: "MCO", inferredType: "number", roles: ["code"] },
            { name: "ATT", inferredType: "number", roles: ["code"] },
          ],
        },
        limits: {
          schemaVersion: "3dena.dataset-limits.v1",
          maxFileBytes: 5_000_000,
          maxWorksheets: 20,
          maxRows: 100_000,
          maxColumns: 256,
          maxCells: 5_000_000,
        },
        warnings: [],
        activationIdentity: `activation:sha256:${"2".repeat(64)}`,
      };
    }
    if (path.endsWith("/activate") && method === "POST") {
      await fulfillJson(route, {
        schemaVersion: "3dena.compute-dataset-activation-receipt.v1",
        datasetId: DATASET_ID,
        generation: 1,
        activationIdentity: `activation:sha256:${"2".repeat(64)}`,
        uploadIdentity: `upload:sha256:${preflight?.sha256}`,
        datasetReceipt: datasetReceipt(),
        activatedAt: "2026-08-21T00:00:00.000Z",
        expiresAt: "2026-08-22T00:00:00.000Z",
        activationReceiptSha256: "3".repeat(64),
      });
      return;
    }
    if (path === "/v1/jobs" && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      if (body.schemaVersion === "3dena.create-source-result-job-request.v1") {
        if (sourceArtifact === null
            || body.sourceJobId !== JOB_ID
            || body.sourceResultHash !== sourceArtifact.resultHash) {
          await fulfillJson(route, { code: "SOURCE_RESULT_MISMATCH" }, 409);
          return;
        }
        await fulfillJson(route, {
          schemaVersion: "3dena.source-result-job-capability.v1",
          jobId: DERIVED_JOB_ID,
          capabilityToken: DERIVED_JOB_CAPABILITY,
          sourceJobId: JOB_ID,
          sourceResultHash: sourceArtifact.resultHash,
          expiresAt: "2026-08-22T00:00:00.000Z",
        }, 201);
        return;
      }
      await fulfillJson(route, {
        schemaVersion: "3dena.job-capability.v1",
        jobId: JOB_ID,
        capabilityToken: JOB_CAPABILITY,
        uploadUrl: new URL(`/__remote_calibration__/v1/datasets/${DATASET_ID}/content`, request.url()).toString(),
        expiresAt: "2026-08-22T00:00:00.000Z",
      }, 201);
      return;
    }
    if (path === `/v1/jobs/${JOB_ID}/execute` && method === "POST") {
      sourceExecuteBody = request.postDataJSON() as Record<string, unknown>;
      const task = sourceExecuteBody.task as { runId: string; spec: unknown };
      const specHash = "8".repeat(64);
      sourceOwner = {
        contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
        datasetHash: String(preflight?.sha256),
        specHash,
        runId: task.runId,
        taskId: JOB_ID,
      };
      sourceArtifact = await sourceResultArtifact(String(preflight?.sha256), specHash, task.runId);
      await fulfillJson(route, {
        schemaVersion: "3dena.job-status.v1",
        jobId: JOB_ID,
        state: "QUEUED",
        owner: null,
        progress: null,
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:00:00.000Z",
        expiresAt: "2026-08-22T00:00:00.000Z",
        resultAvailable: false,
        errorCode: null,
      }, 202);
      return;
    }
    if (path === `/v1/jobs/${DERIVED_JOB_ID}/execute` && method === "POST") {
      const derivedExecuteBody = request.postDataJSON() as Record<string, unknown>;
      derivedExecuteBodies.push(derivedExecuteBody);
      if (sourceArtifact === null) throw new Error("Derived job ran before its source artifact existed.");
      derivedArtifact = await derivedResultArtifact({
        activatedTask: derivedExecuteBody.task as Record<string, unknown>,
        datasetReceipt: datasetReceipt(),
        sourceResult: sourceArtifact.result,
        sourceResultHash: sourceArtifact.resultHash,
      });
      derivedOwner = derivedArtifact.owner;
      await fulfillJson(route, {
        schemaVersion: "3dena.job-status.v1",
        jobId: DERIVED_JOB_ID,
        state: "QUEUED",
        owner: null,
        progress: null,
        createdAt: "2026-08-21T00:01:00.000Z",
        updatedAt: "2026-08-21T00:01:00.000Z",
        expiresAt: "2026-08-22T00:00:00.000Z",
        resultAvailable: false,
        errorCode: null,
      }, 202);
      return;
    }
    if (path === `/v1/jobs/${JOB_ID}` && method === "GET") {
      await fulfillJson(route, {
        schemaVersion: "3dena.job-status.v1",
        jobId: JOB_ID,
        state: "SUCCEEDED",
        owner: sourceOwner,
        progress: { phase: "complete", completed: 1, total: 1 },
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:01:00.000Z",
        expiresAt: "2026-08-22T00:00:00.000Z",
        resultAvailable: true,
        errorCode: null,
      });
      return;
    }
    if (path === `/v1/jobs/${DERIVED_JOB_ID}` && method === "GET") {
      await fulfillJson(route, {
        schemaVersion: "3dena.job-status.v1",
        jobId: DERIVED_JOB_ID,
        state: "SUCCEEDED",
        owner: derivedOwner,
        progress: { phase: "complete", completed: 1, total: 1 },
        createdAt: "2026-08-21T00:01:00.000Z",
        updatedAt: "2026-08-21T00:02:00.000Z",
        expiresAt: "2026-08-22T00:00:00.000Z",
        resultAvailable: true,
        errorCode: null,
      });
      return;
    }
    if (path === `/v1/jobs/${JOB_ID}/result` && method === "GET") {
      const resultBytes = sourceArtifact!.bytes;
      await fulfillJson(route, {
        schemaVersion: "3dena.job-result-reference.v1",
        jobId: JOB_ID,
        sha256: createHash("sha256").update(resultBytes).digest("hex"),
        byteLength: resultBytes.byteLength,
        resultUrl: new URL("/__remote_calibration__/objects/source-result.json", request.url()).toString(),
        exportUrl: null,
        expiresAt: "2026-08-22T00:00:00.000Z",
      });
      return;
    }
    if (path === `/v1/jobs/${DERIVED_JOB_ID}/result` && method === "GET") {
      const resultBytes = derivedArtifact!.bytes;
      const resultUrl = new URL("/__remote_calibration__/objects/derived-result.json", request.url());
      resultUrl.searchParams.set(
        "kind",
        String((derivedExecuteBodies.at(-1)?.task as Record<string, unknown> | undefined)?.kind),
      );
      await fulfillJson(route, {
        schemaVersion: "3dena.job-result-reference.v1",
        jobId: DERIVED_JOB_ID,
        sha256: createHash("sha256").update(resultBytes).digest("hex"),
        byteLength: resultBytes.byteLength,
        resultUrl: resultUrl.toString(),
        exportUrl: null,
        expiresAt: "2026-08-22T00:00:00.000Z",
      });
      return;
    }
    if (path === "/objects/source-result.json" && method === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: sourceArtifact!.bytes });
      return;
    }
    if (path === "/objects/derived-result.json" && method === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: derivedArtifact!.bytes });
      return;
    }
    if (path === `/v1/jobs/${JOB_ID}` && method === "DELETE") {
      await fulfillJson(route, {
        schemaVersion: "3dena.job-deletion-receipt.v1",
        jobId: JOB_ID,
        cancelled: false,
        inputDeleted: true,
        resultDeleted: true,
        deletedAt: "2026-08-21T00:02:00.000Z",
      });
      return;
    }
    if (path === `/v1/jobs/${DERIVED_JOB_ID}` && method === "DELETE") {
      await fulfillJson(route, {
        schemaVersion: "3dena.job-deletion-receipt.v1",
        jobId: DERIVED_JOB_ID,
        cancelled: false,
        inputDeleted: true,
        resultDeleted: true,
        deletedAt: "2026-08-21T00:02:00.000Z",
      });
      return;
    }
    if (path === `/v1/datasets/${DATASET_ID}` && method === "DELETE") {
      await fulfillJson(route, {
        schemaVersion: "3dena.compute-dataset-deletion-receipt.v1",
        datasetId: DATASET_ID,
        deletedAt: "2026-08-21T00:03:00.000Z",
        sourceDeleted: true,
      });
      return;
    }
    await fulfillJson(route, { code: "NOT_FOUND" }, 404);
  });

  await page.goto("/app?remoteCalibration=1");
  await expect(page.getByTestId("remote-runtime-status")).toHaveAttribute("data-state", "idle");
  await page.getByTestId("remote-processing-consent").check();
  await page.getByTestId("remote-file-input").setInputFiles(SMALL_RAW_CSV);
  await page.getByTestId("remote-upload-inspect").click();
  await expect(page.getByRole("heading", { name: "Service inventory" })).toBeVisible();
  await page.getByTestId("remote-worksheet-select").selectOption("0");
  await page.getByTestId("remote-parse-sheet").click();
  await page.getByTestId("remote-request-preview").click();
  await expect(page.getByTestId("remote-typed-preview")).toBeVisible();
  await page.getByTestId("remote-activate").click();
  await expect(page.getByTestId("remote-activation-receipt")).toBeVisible();
  await expect(page.getByTestId("remote-task-kind").locator("option")).toHaveCount(7);
  await page.getByTestId("remote-analysis-run").click();
  await expect.poll(
    () => page.getByTestId("remote-runtime-status").getAttribute("data-state"),
    { timeout: 30_000 },
  ).toMatch(/^(completed|error)$/u);
  const terminalRemoteState = await page.getByTestId("remote-runtime-status").getAttribute("data-state");
  if (terminalRemoteState === "error") {
    throw new Error(
      `Mocked remote service failed: ${await page.getByTestId("remote-analysis-error").innerText()}`,
    );
  }
  await expect(page.getByTestId("analysis-result")).toBeVisible();
  await expect(page.getByTestId("remote-source-delete")).toBeEnabled();

  const derivedKinds = [
    "network-comparison",
    "change-network",
    "statistics",
    "trajectory",
    "trajectory-comparison",
    "bootstrap",
  ] as const;
  const downloadedKinds: string[] = [];
  for (const kind of derivedKinds) {
    await page.getByTestId("remote-task-kind").selectOption(kind);
    await expect(page.getByTestId("remote-derived-controls")).toBeVisible();
    if (kind === "trajectory") {
      await page.locator("#remote-time-0").fill("1");
      await page.locator("#remote-time-1").fill("2");
    }
    if (kind === "bootstrap") {
      await page.locator("#remote-bootstrap-replicates").fill("200");
    }
    await page.getByTestId("remote-derived-run").click();
    await expect.poll(async () => {
      const state = await page.getByTestId("remote-runtime-status").getAttribute("data-state");
      const renderedKind = await page.getByTestId("remote-derived-result").getAttribute("data-task-kind").catch(() => null);
      if (state === "error") return "error";
      return state === "completed" && renderedKind === kind ? "completed" : "pending";
    }, { timeout: 30_000 }).toMatch(/^(completed|error)$/u);
    if (await page.getByTestId("remote-runtime-status").getAttribute("data-state") === "error") {
      throw new Error(
        `Mocked ${kind} service failed: ${await page.getByTestId("remote-analysis-error").innerText()}`,
      );
    }
    await expect(page.getByTestId("remote-derived-result")).toHaveAttribute("data-task-kind", kind);
    await expect(page.getByTestId("remote-derived-visualization")).toBeVisible();
    await expect(page.getByTestId("remote-derived-table")).toBeVisible();
    expect(await page.getByTestId("remote-derived-table").locator("tbody tr").count()).toBeGreaterThan(0);

    const downloadEvent = page.waitForEvent("download");
    await page.getByTestId("remote-verified-download").click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toMatch(/^3dena-remote-.+\.zip$/u);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect([...Buffer.concat(chunks).subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    downloadedKinds.push(kind);
  }
  expect(downloadedKinds).toEqual(derivedKinds);
  expect(sourceExecuteBody).toMatchObject({
    schemaVersion: "3dena.execute-activated-job-request.v1",
    task: { kind: "ena-model", schemaVersion: "3dena.activated-ena-model-task-spec.v1" },
  });
  expect(derivedExecuteBodies).toHaveLength(derivedKinds.length);
  expect(derivedExecuteBodies.map((body) => (body.task as Record<string, unknown>).kind)).toEqual(derivedKinds);
  for (const body of derivedExecuteBodies) {
    expect(body).toMatchObject({
      schemaVersion: "3dena.execute-activated-job-request.v1",
      task: {
        sourceResultHash: (sourceArtifact as Awaited<ReturnType<typeof sourceResultArtifact>> | null)?.resultHash,
      },
    });
  }
  expect(JSON.stringify({ sourceExecuteBody, derivedExecuteBodies })).not.toMatch(
    /rows|sourceEnvelope|capabilityToken|resultUrl/u,
  );

  await page.getByTestId("remote-source-delete").click();
  await expect(page.getByTestId("remote-runtime-status")).toHaveAttribute("data-state", "idle");
  await expect(page.getByTestId("remote-source-delete")).toHaveCount(0);
  await expect(page.getByText("No service dataset is active.")).toBeVisible();

  expect(mutations).toEqual(expect.arrayContaining([
    "POST /v1/datasets",
    `PUT /v1/datasets/${DATASET_ID}/content`,
    `POST /v1/datasets/${DATASET_ID}/selection`,
    `PUT /v1/datasets/${DATASET_ID}/mapping`,
    `POST /v1/datasets/${DATASET_ID}/preview`,
    `POST /v1/datasets/${DATASET_ID}/activate`,
    "POST /v1/jobs",
    `POST /v1/jobs/${JOB_ID}/execute`,
    `POST /v1/jobs/${DERIVED_JOB_ID}/execute`,
    `DELETE /v1/jobs/${DERIVED_JOB_ID}`,
    `DELETE /v1/datasets/${DATASET_ID}`,
    `DELETE /v1/jobs/${JOB_ID}`,
  ]));
  expect(await page.evaluate(() =>
    (window as unknown as { __remoteWorkers: string[] }).__remoteWorkers)).toEqual([]);
});

test("mocked remote service preserves exact prepared bytes through parser activation, derived analysis, formal download, and deletion", async ({
  page,
}) => {
  const datasetHash = createHash("sha256").update(SYNTHETIC_PREPARED_BYTES).digest("hex");
  let createBody: Record<string, unknown> | null = null;
  let uploadedBytes: Buffer | null = null;
  let sourceExecuteBody: Record<string, unknown> | null = null;
  let derivedExecuteBody: Record<string, unknown> | null = null;
  let sourceArtifact: Awaited<ReturnType<typeof preparedResultArtifact>> | null = null;
  let derivedArtifact: Awaited<ReturnType<typeof derivedResultArtifact>> | null = null;
  const mutations: string[] = [];
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    (window as unknown as { __remotePreparedWorkers: string[] }).__remotePreparedWorkers = [];
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args: ConstructorParameters<typeof Worker>) {
        (window as unknown as { __remotePreparedWorkers: string[] }).__remotePreparedWorkers.push(String(args[0]));
        return Reflect.construct(target, args) as Worker;
      },
    });
  });

  await page.route("**/__remote_calibration__/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/__remote_calibration__", "");
    const method = request.method();
    if (method !== "GET") mutations.push(`${method} ${path}`);
    if (path === "/build-info") {
      await fulfillJson(route, {
        schemaVersion: "3dena.compute-build-info.v1",
        approvalManifestSha256: APPROVAL_MANIFEST,
        releaseId: "remote-calibration-release",
        gitCommit: GIT_COMMIT,
        flyImageDigest: FLY_IMAGE,
        flyBuildId: FLY_BUILD,
        role: "api",
        contractVersions: [
          "3dena.compute-dataset-http.v1",
          "3dena.compute-prepared-import-http.v1",
          "3dena.compute-source-result-job-http.v1",
          "3dena.contract.v1",
        ],
      });
      return;
    }
    if (path === "/v1/jobs" && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      if (body.schemaVersion === "3dena.create-source-result-job-request.v1") {
        if (sourceArtifact === null
            || body.sourceJobId !== PREPARED_JOB_ID
            || body.sourceResultHash !== sourceArtifact.resultHash) {
          throw new Error("Prepared derived job was not bound to its primary source result.");
        }
        await fulfillJson(route, {
          schemaVersion: "3dena.source-result-job-capability.v1",
          jobId: DERIVED_JOB_ID,
          capabilityToken: DERIVED_JOB_CAPABILITY,
          sourceJobId: PREPARED_JOB_ID,
          sourceResultHash: sourceArtifact.resultHash,
          expiresAt: "2026-08-22T00:00:00.000Z",
        }, 201);
        return;
      }
      createBody = body;
      await fulfillJson(route, {
        schemaVersion: "3dena.job-capability.v1",
        jobId: PREPARED_JOB_ID,
        capabilityToken: PREPARED_JOB_CAPABILITY,
        uploadUrl: new URL(`/__remote_calibration__/v1/jobs/${PREPARED_JOB_ID}/content`, request.url()).toString(),
        expiresAt: "2026-08-22T00:00:00.000Z",
      }, 201);
      return;
    }
    if (path === `/v1/jobs/${PREPARED_JOB_ID}/content` && method === "PUT") {
      uploadedBytes = request.postDataBuffer();
      await fulfillJson(route, {
        schemaVersion: "3dena.prepared-import-upload-receipt.v1",
        jobId: PREPARED_JOB_ID,
        sha256: datasetHash,
        byteLength: SYNTHETIC_PREPARED_BYTES.byteLength,
        accepted: true,
      });
      return;
    }
    if (path === `/v1/jobs/${PREPARED_JOB_ID}/execute` && method === "POST") {
      sourceExecuteBody = request.postDataJSON() as Record<string, unknown>;
      const task = sourceExecuteBody.task as {
        runId: string;
        mapping: Record<string, unknown>;
      };
      sourceArtifact = await preparedResultArtifact({
        datasetHash,
        mapping: task.mapping,
        runId: task.runId,
      });
      await fulfillJson(route, {
        schemaVersion: "3dena.job-status.v1",
        jobId: PREPARED_JOB_ID,
        state: "QUEUED",
        owner: null,
        progress: null,
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:00:00.000Z",
        expiresAt: "2026-08-22T00:00:00.000Z",
        resultAvailable: false,
        errorCode: null,
      }, 202);
      return;
    }
    if (path === `/v1/jobs/${DERIVED_JOB_ID}/execute` && method === "POST") {
      derivedExecuteBody = request.postDataJSON() as Record<string, unknown>;
      if (sourceArtifact === null) throw new Error("Prepared derived job ran before its source existed.");
      derivedArtifact = await derivedResultArtifact({
        activatedTask: derivedExecuteBody.task as Record<string, unknown>,
        datasetReceipt: (sourceExecuteBody as { datasetReceipt: DatasetReceiptV1 }).datasetReceipt,
        sourceResult: sourceArtifact.result,
        sourceResultHash: sourceArtifact.resultHash,
        sourceKind: "prepared-exchange",
      });
      await fulfillJson(route, {
        schemaVersion: "3dena.job-status.v1",
        jobId: DERIVED_JOB_ID,
        state: "QUEUED",
        owner: null,
        progress: null,
        createdAt: "2026-08-21T00:01:00.000Z",
        updatedAt: "2026-08-21T00:01:00.000Z",
        expiresAt: "2026-08-22T00:00:00.000Z",
        resultAvailable: false,
        errorCode: null,
      }, 202);
      return;
    }
    if (path === `/v1/jobs/${PREPARED_JOB_ID}` && method === "GET") {
      await fulfillJson(route, {
        schemaVersion: "3dena.job-status.v1",
        jobId: PREPARED_JOB_ID,
        state: "SUCCEEDED",
        owner: sourceArtifact?.owner ?? null,
        progress: { phase: "complete", completed: 1, total: 1 },
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:01:00.000Z",
        expiresAt: "2026-08-22T00:00:00.000Z",
        resultAvailable: true,
        errorCode: null,
      });
      return;
    }
    if (path === `/v1/jobs/${DERIVED_JOB_ID}` && method === "GET") {
      await fulfillJson(route, {
        schemaVersion: "3dena.job-status.v1",
        jobId: DERIVED_JOB_ID,
        state: "SUCCEEDED",
        owner: derivedArtifact?.owner ?? null,
        progress: { phase: "complete", completed: 1, total: 1 },
        createdAt: "2026-08-21T00:01:00.000Z",
        updatedAt: "2026-08-21T00:02:00.000Z",
        expiresAt: "2026-08-22T00:00:00.000Z",
        resultAvailable: true,
        errorCode: null,
      });
      return;
    }
    if (path === `/v1/jobs/${PREPARED_JOB_ID}/result` && method === "GET") {
      const bytes = sourceArtifact!.bytes;
      await fulfillJson(route, {
        schemaVersion: "3dena.job-result-reference.v1",
        jobId: PREPARED_JOB_ID,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteLength: bytes.byteLength,
        resultUrl: new URL("/__remote_calibration__/objects/prepared-result.json", request.url()).toString(),
        exportUrl: null,
        expiresAt: "2026-08-22T00:00:00.000Z",
      });
      return;
    }
    if (path === `/v1/jobs/${DERIVED_JOB_ID}/result` && method === "GET") {
      const bytes = derivedArtifact!.bytes;
      await fulfillJson(route, {
        schemaVersion: "3dena.job-result-reference.v1",
        jobId: DERIVED_JOB_ID,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteLength: bytes.byteLength,
        resultUrl: new URL("/__remote_calibration__/objects/prepared-derived-result.json", request.url()).toString(),
        exportUrl: null,
        expiresAt: "2026-08-22T00:00:00.000Z",
      });
      return;
    }
    if (path === "/objects/prepared-result.json" && method === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: sourceArtifact!.bytes });
      return;
    }
    if (path === "/objects/prepared-derived-result.json" && method === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: derivedArtifact!.bytes });
      return;
    }
    if (path === `/v1/jobs/${PREPARED_JOB_ID}` && method === "DELETE") {
      await fulfillJson(route, {
        schemaVersion: "3dena.job-deletion-receipt.v1",
        jobId: PREPARED_JOB_ID,
        cancelled: false,
        inputDeleted: true,
        resultDeleted: true,
        deletedAt: "2026-08-21T00:03:00.000Z",
      });
      return;
    }
    if (path === `/v1/jobs/${DERIVED_JOB_ID}` && method === "DELETE") {
      await fulfillJson(route, {
        schemaVersion: "3dena.job-deletion-receipt.v1",
        jobId: DERIVED_JOB_ID,
        cancelled: false,
        inputDeleted: true,
        resultDeleted: true,
        deletedAt: "2026-08-21T00:02:00.000Z",
      });
      return;
    }
    await fulfillJson(route, { code: "NOT_FOUND" }, 404);
  });

  await page.goto("/app?remoteCalibration=1");
  await expect(page.getByTestId("remote-runtime-status")).toHaveAttribute("data-state", "idle");
  await page.getByTestId("remote-processing-consent").check();
  await page.getByTestId("remote-file-input").setInputFiles({
    name: "synthetic-remote.ena3d.json",
    mimeType: "application/json",
    buffer: SYNTHETIC_PREPARED_BYTES,
  });
  await page.getByTestId("remote-upload-inspect").click();
  const inventory = page.getByTestId("remote-prepared-inventory");
  await expect(inventory).toContainText(datasetHash);
  await expect(inventory).toContainText("Group + Speaker");
  await expect(page.getByRole("table", { name: "Exact strict-parser table inventory" })).toBeVisible();
  expect(mutations).toEqual([]);

  await page.getByTestId("remote-prepared-activate").click();
  await expect.poll(
    () => page.getByTestId("remote-runtime-status").getAttribute("data-state"),
    { timeout: 30_000 },
  ).toMatch(/^(completed|error)$/u);
  const sourceState = await page.getByTestId("remote-runtime-status").getAttribute("data-state");
  if (sourceState === "error") {
    throw new Error(`Mocked prepared service failed: ${await page.getByTestId("remote-analysis-error").innerText()}`);
  }
  await expect(page.getByTestId("analysis-result")).toHaveAttribute("data-source-kind", "prepared-exchange");
  await page.getByRole("tab", { name: "Trajectory" }).click();
  await expect(page.getByTestId("prepared-centroid-table")).toBeVisible();
  await expect(page.getByTestId("prepared-export-centroids")).toHaveCount(0);
  await expect(page.getByTestId("prepared-export-provenance")).toHaveCount(0);
  await expect(page.getByTestId("prepared-export-bundle")).toHaveCount(0);

  await page.getByTestId("remote-task-kind").selectOption("network-comparison");
  await expect(page.getByTestId("remote-derived-controls")).toBeVisible();
  await page.getByTestId("remote-derived-run").click();
  await expect.poll(
    () => page.getByTestId("remote-runtime-status").getAttribute("data-state"),
    { timeout: 30_000 },
  ).toMatch(/^(completed|error)$/u);
  const derivedState = await page.getByTestId("remote-runtime-status").getAttribute("data-state");
  if (derivedState === "error") {
    throw new Error(`Mocked prepared derived service failed: ${await page.getByTestId("remote-analysis-error").innerText()}`);
  }
  await expect(page.getByTestId("remote-derived-result")).toHaveAttribute("data-task-kind", "network-comparison");
  await expect(page.getByTestId("remote-derived-table")).toBeVisible();

  const downloadEvent = page.waitForEvent("download");
  await page.getByTestId("remote-verified-download").click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^3dena-remote-.+\.zip$/u);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect([...Buffer.concat(chunks).subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);

  expect(createBody).toEqual({
    schemaVersion: "3dena.create-job-request.v1",
    dataset: {
      sha256: datasetHash,
      byteLength: SYNTHETIC_PREPARED_BYTES.byteLength,
      format: "ena3d-json",
    },
    processingPolicyConfirmed: true,
  });
  expect(uploadedBytes).not.toBeNull();
  expect(Buffer.compare(uploadedBytes!, Buffer.from(SYNTHETIC_PREPARED_BYTES))).toBe(0);
  expect(sourceExecuteBody).toMatchObject({
    schemaVersion: "3dena.execute-prepared-import-job-request.v1",
    datasetReceipt: { sha256: datasetHash, format: "ena3d-json" },
    task: {
      schemaVersion: "3dena.activated-prepared-import-task-spec.v1",
      kind: "prepared-import",
      mapping: {
        participant: ["Group", "Speaker"],
        timeOrder: ["TP1", "TP2", "TP3"],
        displayDimensions: ["SVD1", "SVD2", "SVD3"],
      },
    },
  });
  expect(derivedExecuteBody).toMatchObject({
    schemaVersion: "3dena.execute-activated-job-request.v1",
    task: {
      kind: "network-comparison",
      sourceResultHash: (sourceArtifact as Awaited<ReturnType<typeof preparedResultArtifact>> | null)?.resultHash,
    },
  });
  expect(JSON.stringify({ createBody, sourceExecuteBody, derivedExecuteBody })).not.toMatch(
    /exactBytesBase64|uploaded\.ena3d\.json|capabilityToken|resultUrl/u,
  );

  await page.getByTestId("remote-source-delete").click();
  await expect(page.getByTestId("remote-runtime-status")).toHaveAttribute("data-state", "idle");
  expect(mutations).toEqual(expect.arrayContaining([
    "POST /v1/jobs",
    `PUT /v1/jobs/${PREPARED_JOB_ID}/content`,
    `POST /v1/jobs/${PREPARED_JOB_ID}/execute`,
    `POST /v1/jobs/${DERIVED_JOB_ID}/execute`,
    `DELETE /v1/jobs/${DERIVED_JOB_ID}`,
    `DELETE /v1/jobs/${PREPARED_JOB_ID}`,
  ]));
  expect(await page.evaluate(() =>
    (window as unknown as { __remotePreparedWorkers: string[] }).__remotePreparedWorkers)).toEqual([]);
});

test("remote consent and retention boundary remains accessible at 375px", async ({
  page,
}) => {
  await page.route("**/__remote_calibration__/build-info", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: "3dena.compute-build-info.v1",
        approvalManifestSha256: "a".repeat(64),
        releaseId: "remote-calibration-release",
        gitCommit: "b".repeat(40),
        flyImageDigest: `sha256:${"c".repeat(64)}`,
        flyBuildId: "remote-calibration-fly-build",
        role: "api",
        contractVersions: ["3dena.contract.v1"],
      }),
    });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/app?remoteCalibration=1");
  await expect(page.getByTestId("analysis-workspace")).toHaveAttribute(
    "data-execution-mode",
    "remote",
  );
  await expect(page.getByRole("heading", { name: "Consent and upload" })).toBeVisible();
  await expect(page.getByLabel(/consent to this server processing/u)).toBeDisabled();
  await expect(page.getByText(/Mocked development calibration region/u).first()).toBeVisible();
  await expect(page.getByText(/hard maximum retention of 24 hours/u)).toBeVisible();
  const viewport = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);
});
