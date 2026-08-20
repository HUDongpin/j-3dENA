import { createHash } from "node:crypto";
import { expect, test, type Route } from "@playwright/test";
import { SMALL_RAW_CSV } from "./helpers/runtime-contract";

const ANALYSIS_CONTRACT_VERSION_V1 = "3dena.contract.v1";

const DATASET_ID = "dataset-remote-e2e";
const DATASET_CAPABILITY = "dataset-capability-remote-e2e";
const JOB_ID = "job-remote-e2e";
const JOB_CAPABILITY = "job-capability-remote-e2e";
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

async function resultArtifact(
  datasetHash: string,
  specHash: string,
  runId: string,
): Promise<Buffer> {
  const entity = (group: string, participant: string) => ({
    canonical: JSON.stringify([["string", group], ["string", participant]]),
    display: `${group} · ${participant}`,
    columns: ["group", "participant"],
    values: [group, participant],
  });
  const rowEntity = (group: string, participant: string) => ({
    canonical: JSON.stringify([["string", group], ["string", participant], ["string", "T1"]]),
    display: `${group} · ${participant} · T1`,
    columns: ["group", "participant", "time"],
    values: [group, participant, "T1"],
  });
  const identities = [
    ["A", "synthetic-1"],
    ["A", "synthetic-2"],
    ["B", "synthetic-3"],
    ["B", "synthetic-4"],
  ] as const;
  const edgeColumns = ["A & B", "A & C", "B & C"];
  const result = {
    schemaVersion: "3dena.analysis-result.v1",
    dimensions: ["SVD1", "SVD2", "SVD3"],
    axes: ["SVD1", "SVD2", "SVD3"],
    points: identities.map(([group, participant], index) => {
      const key = entity(group, participant);
      return {
        index,
        id: key,
        unit: key,
        participantLabel: key,
        coordinates: [index === 0 ? -0.75 : 0.25, 0, 0],
        fullCoordinates: [index === 0 ? -0.75 : 0.25, 0, 0],
        lineWeights: index === 0 ? [1, 0, 0] : [0.577, 0.577, 0.577],
        metadata: {},
      };
    }),
    nodes: [
      { index: 0, code: "A", coordinates: [-0.5, 0, 0], fullCoordinates: [-0.5, 0, 0] },
      { index: 1, code: "B", coordinates: [0, 0.5, 0], fullCoordinates: [0, 0.5, 0] },
      { index: 2, code: "C", coordinates: [0.5, 0, 0], fullCoordinates: [0.5, 0, 0] },
    ],
    edges: [
      { index: 0, id: "edge:0:1", column: edgeColumns[0], source: "A", target: "B", sourceIndex: 0, targetIndex: 1, meanWeight: 0.683 },
      { index: 1, id: "edge:0:2", column: edgeColumns[1], source: "A", target: "C", sourceIndex: 0, targetIndex: 2, meanWeight: 0.433 },
      { index: 2, id: "edge:1:2", column: edgeColumns[2], source: "B", target: "C", sourceIndex: 1, targetIndex: 2, meanWeight: 0.433 },
    ],
    accumulation: {
      modelCounts: {
        rowKeys: identities.map(([group, participant]) => entity(group, participant)),
        columns: edgeColumns,
        values: [[1, 0, 0], [1, 1, 1], [1, 1, 1], [1, 1, 1]],
      },
      rowCounts: {
        rowKeys: identities.map(([group, participant]) => rowEntity(group, participant)),
        columns: ["A", "B", "C", ...edgeColumns],
        values: [
          [1, 1, 0, 1, 0, 0],
          [1, 0, 1, 1, 1, 1],
          [0, 1, 1, 1, 1, 1],
          [1, 1, 1, 1, 1, 1],
        ],
      },
    },
    variance: [
      { axis: "SVD1", proportion: 1, eigenvalue: 0.21, displayed: true },
      { axis: "SVD2", proportion: 0, eigenvalue: 0, displayed: true },
      { axis: "SVD3", proportion: 0, eigenvalue: 0, displayed: true },
    ],
    rotation: {
      method: "svd",
      columns: ["SVD1", "SVD2", "SVD3"],
      matrix: [[-0.46, 0.81, -0.37], [0.63, 0.59, 0.51], [0.63, 0, -0.78]],
      eigenvalues: [0.21, 0, 0],
      centerVector: [0.683, 0.433, 0.433],
    },
    summary: {
      inputRows: 4,
      inputColumns: 6,
      units: 4,
      points: 4,
      nodes: 3,
      edges: 3,
      modelCountRows: 4,
      rowCountRows: 4,
      groups: 0,
      timePoints: 0,
      participantPeriods: 0,
      trajectoryCentroids: 0,
      dimensions: 3,
    },
    diagnostics: [],
    provenance: {
      adapter: "@3dena/analysis",
      adapterVersion: "0.1.0",
      jenaPackage: "jena-js",
      jenaVersion: "0.6.3",
      jenaCommit: "d".repeat(40),
      coreGoldenContract: "synthetic-e2e-core-v1",
      legacyGoldenContract: "synthetic-e2e-legacy-v1",
      legacyGoldenStatus: "not-assessed",
      parityContract: "3dena.parity-contract.v1",
      resultSemantics: "synthetic contract fixture; no parity claim",
      resolvedConfig: {
        model: "EndPoint",
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
  return Buffer.from(JSON.stringify({
    version: "3dena.compute-scientific-result-artifact.v1",
    owner,
    taskKind: "ena-model",
    envelope,
  }));
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

test("mocked remote service closes upload through formal verified download without a Worker", async ({
  page,
}) => {
  let preflight: Record<string, unknown> | null = null;
  let executeBody: Record<string, unknown> | null = null;
  let artifact: Buffer | null = null;
  let owner: Record<string, unknown> | null = null;
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
        contractVersions: ["3dena.compute-dataset-http.v1", "3dena.contract.v1"],
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
            declaredRowCount: 8,
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
      declaredRowCount: 8,
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
        rowCount: 7,
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
      totalRowCount: 7,
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
          rowCount: 7,
          columnCount: 7,
          schema: datasetReceipt().schema,
          preview: typedPreview,
          diagnostics: [],
          activatable: true,
        },
      });
      return;
    }
    function datasetReceipt() {
      return {
        schemaVersion: "3dena.dataset-receipt.v1",
        sha256: String(preflight?.sha256),
        byteLength: Number(preflight?.byteLength),
        format: "csv",
        sheet: null,
        rows: 7,
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
      executeBody = request.postDataJSON() as Record<string, unknown>;
      const task = executeBody.task as { runId: string; spec: unknown };
      const specHash = "8".repeat(64);
      owner = {
        contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
        datasetHash: String(preflight?.sha256),
        specHash,
        runId: task.runId,
        taskId: JOB_ID,
      };
      artifact = await resultArtifact(String(preflight?.sha256), specHash, task.runId);
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
    if (path === `/v1/jobs/${JOB_ID}` && method === "GET") {
      await fulfillJson(route, {
        schemaVersion: "3dena.job-status.v1",
        jobId: JOB_ID,
        state: "SUCCEEDED",
        owner,
        progress: { phase: "complete", completed: 1, total: 1 },
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:01:00.000Z",
        expiresAt: "2026-08-22T00:00:00.000Z",
        resultAvailable: true,
        errorCode: null,
      });
      return;
    }
    if (path === `/v1/jobs/${JOB_ID}/result` && method === "GET") {
      const resultBytes = artifact!;
      await fulfillJson(route, {
        schemaVersion: "3dena.job-result-reference.v1",
        jobId: JOB_ID,
        sha256: createHash("sha256").update(resultBytes).digest("hex"),
        byteLength: resultBytes.byteLength,
        resultUrl: new URL("/__remote_calibration__/objects/result.json", request.url()).toString(),
        exportUrl: null,
        expiresAt: "2026-08-22T00:00:00.000Z",
      });
      return;
    }
    if (path === "/objects/result.json" && method === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: artifact! });
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
  const downloadEvent = page.waitForEvent("download");
  await page.getByTestId("remote-verified-download").click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^3dena-remote-.+\.zip$/u);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect([...Buffer.concat(chunks).subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(executeBody).toMatchObject({
    schemaVersion: "3dena.execute-activated-job-request.v1",
    task: { kind: "ena-model", schemaVersion: "3dena.activated-ena-model-task-spec.v1" },
  });
  expect(JSON.stringify(executeBody)).not.toMatch(/rows|sourceEnvelope/u);
  expect(mutations).toEqual(expect.arrayContaining([
    "POST /v1/datasets",
    `PUT /v1/datasets/${DATASET_ID}/content`,
    `POST /v1/datasets/${DATASET_ID}/selection`,
    `PUT /v1/datasets/${DATASET_ID}/mapping`,
    `POST /v1/datasets/${DATASET_ID}/preview`,
    `POST /v1/datasets/${DATASET_ID}/activate`,
    "POST /v1/jobs",
    `POST /v1/jobs/${JOB_ID}/execute`,
    `DELETE /v1/jobs/${JOB_ID}`,
  ]));
  expect(await page.evaluate(() =>
    (window as unknown as { __remoteWorkers: string[] }).__remoteWorkers)).toEqual([]);
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
