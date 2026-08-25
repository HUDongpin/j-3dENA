import { describe, expect, it, vi } from "vitest";
import type { DatasetReceiptV1 } from "@3dena/analysis";
import type { ActivatedAnalysisTaskSpecV1 } from "@3dena/compute-service-http";
import { createHttpRemoteDatasetWorkflowAdapter } from "./remote-dataset-http-adapter";
import { createSyntheticPreparedExchangeBytes } from "../../../packages/analysis/test-support/synthetic-prepared-exchange";

const BASE = "https://compute.example.test";
const DATASET_ID = "dataset-12345678";
const CAPABILITY = "dataset-capability-token-12345678";

function class1ShapedSyntheticPreparedBytes(): Uint8Array {
  const decoded = JSON.parse(new TextDecoder().decode(
    createSyntheticPreparedExchangeBytes(),
  )) as {
    group_variables: string[];
    tables: Record<string, { columns: Array<{ name: string; values: unknown[] }> }>;
  };
  const names = new Map([
    ["Cohort", "Group"],
    ["Actor", "Speaker"],
    ["Phase", "Period"],
  ]);
  decoded.group_variables = decoded.group_variables.map((name) => names.get(name) ?? name);
  for (const table of Object.values(decoded.tables)) {
    for (const column of table.columns) {
      column.name = names.get(column.name) ?? column.name;
      if (column.name === "Period") {
        column.values = column.values.map((value) => ({
          "phase-one": "TP1",
          "phase-two": "TP2",
          "phase-three": "TP3",
        })[String(value)] ?? value);
      }
    }
  }
  return new TextEncoder().encode(JSON.stringify(decoded));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-request-id": "request-test",
    },
  });
}

function receipt(sha256: string, byteLength: number): DatasetReceiptV1 {
  return {
    schemaVersion: "3dena.dataset-receipt.v1",
    sha256,
    byteLength,
    format: "csv",
    sheet: null,
    rows: 2,
    columns: 6,
    schema: {
      schemaVersion: "3dena.dataset-schema.v1",
      headers: ["participant", "group", "conversation", "A", "B", "C"],
      columns: [
        { name: "participant", inferredType: "string", roles: ["unit"] },
        { name: "group", inferredType: "string", roles: ["unit", "group"] },
        { name: "conversation", inferredType: "string", roles: ["conversation", "time"] },
        { name: "A", inferredType: "number", roles: ["code"] },
        { name: "B", inferredType: "number", roles: ["code"] },
        { name: "C", inferredType: "number", roles: ["code"] },
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
    activationIdentity: `activation:sha256:${"c".repeat(64)}`,
  };
}

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: BodyInit | null | undefined;
}

interface RemoteHarnessOptions {
  readonly adapter?: Readonly<{
    requestTimeoutMilliseconds?: number;
    retryMaxAttempts?: number;
    retryBaseDelayMilliseconds?: number;
    retryMaximumDelayMilliseconds?: number;
    retryTotalTimeoutMilliseconds?: number;
  }>;
  readonly beforeRoute?: (
    request: RecordedRequest,
  ) => Response | undefined | Promise<Response | undefined>;
}

function remoteHarness(contractVersions: string[] = [
  "3dena.compute-dataset-http.v1",
  "3dena.compute-prepared-import-http.v1",
  "3dena.compute-source-result-job-http.v1",
  "3dena.contract.v1",
], options: RemoteHarnessOptions = {}) {
  let preflight: Record<string, unknown> | null = null;
  let mappingBody: Record<string, unknown> | null = null;
  let jobRequests = 0;
  let activatedExecuteBody: Record<string, unknown> | null = null;
  let sourceCreateBody: Record<string, unknown> | null = null;
  let preparedCreateBody: Record<string, unknown> | null = null;
  let preparedExecuteBody: Record<string, unknown> | null = null;
  const requests: RecordedRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const request = { url, method, headers, body: init?.body };
    requests.push(request);
    const intercepted = await options.beforeRoute?.(request);
    if (intercepted !== undefined) return intercepted;

    if (url === `${BASE}/build-info`) {
      return json({
        schemaVersion: "3dena.compute-build-info.v1",
        approvalManifestSha256: "1".repeat(64),
        releaseId: "release-20260821",
        gitCommit: "2".repeat(40),
        flyImageDigest: `sha256:${"3".repeat(64)}`,
        flyBuildId: "fly-build-20260821",
        role: "api",
        contractVersions,
      });
    }
    if (url === `${BASE}/v1/datasets` && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { preflight: Record<string, unknown> };
      preflight = body.preflight;
      return json({
        schemaVersion: "3dena.compute-dataset-capability.v1",
        datasetId: DATASET_ID,
        generation: 1,
        capabilityToken: CAPABILITY,
        contentUrl: `${BASE}/v1/datasets/${DATASET_ID}/content`,
        expiresAt: "2026-08-22T00:00:00.000Z",
      }, 201);
    }
    if (url === `${BASE}/v1/datasets/${DATASET_ID}/content` && method === "PUT") {
      if (!preflight) throw new Error("preflight missing");
      return json({
        schemaVersion: "3dena.inspected-dataset-candidate.v1",
        productStatus: "IMPLEMENTED_UNVERIFIED",
        generation: 1,
        preflightIdentity: preflight.preflightIdentity,
        uploadIdentity: `upload:sha256:${preflight.sha256}`,
        inventory: {
          schemaVersion: "3dena.workflow-workbook-inventory.v1",
          format: "csv",
          byteLength: preflight.byteLength,
          sha256: preflight.sha256,
          delimiter: ",",
          worksheets: [{
            index: 0,
            name: "CSV",
            visibility: "visible",
            kind: "worksheet",
            selectable: true,
            unselectableReason: null,
            declaredRowCount: 3,
            declaredColumnCount: 6,
          }],
          visibleSelectableWorksheetCount: 1,
          selectionPolicy: "single-visible-auto-otherwise-explicit",
          hiddenWorksheetPolicy: "listed-not-selectable",
          vbaDetectedAndDiscarded: false,
          parserVersion: "sheetjs-frozen-test",
        },
      }, 201);
    }
    if (url.endsWith("/selection") && method === "POST") {
      return json({
        schemaVersion: "3dena.parsed-worksheet-candidate.v1",
        productStatus: "IMPLEMENTED_UNVERIFIED",
        generation: 1,
        uploadIdentity: `upload:sha256:${preflight?.sha256}`,
        parsedIdentity: `parsed:sha256:${"a".repeat(64)}`,
        parsedContentSha256: "b".repeat(64),
        worksheet: {
          index: 0,
          name: "CSV",
          visibility: "visible",
          kind: "worksheet",
          selectable: true,
          unselectableReason: null,
          declaredRowCount: 3,
          declaredColumnCount: 6,
        },
        headers: ["participant", "group", "conversation", "A", "B", "C"],
        rowCount: 2,
        columnCount: 6,
      });
    }
    if (url.endsWith("/mapping") && method === "PUT") {
      mappingBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return json({
        schemaVersion: "3dena.compute-dataset-mapping-receipt.v1",
        datasetId: DATASET_ID,
        generation: 1,
        parsedIdentity: `parsed:sha256:${"a".repeat(64)}`,
        mappingSha256: "d".repeat(64),
      });
    }
    if (url.endsWith("/preview") && method === "POST") {
      const typedPreview = {
        schemaVersion: "3dena.typed-dataset-preview.v1",
        headers: ["participant", "group", "conversation", "A", "B", "C"],
        rows: [{
          rowIndex: 0,
          values: [
            { type: "string", value: "p1" },
            { type: "string", value: "g1" },
            { type: "string", value: "c1" },
            { type: "double", ieee754Hex: "3ff0000000000000" },
            { type: "double", ieee754Hex: "0000000000000000" },
            { type: "double", ieee754Hex: "3ff0000000000000" },
          ],
        }],
        totalRowCount: 2,
        previewRowCount: 1,
      };
      return json({
        schemaVersion: "3dena.compute-dataset-preview-result.v1",
        datasetId: DATASET_ID,
        generation: 1,
        activationIdentity: `activation:sha256:${"c".repeat(64)}`,
        preview: typedPreview,
        candidate: {
          schemaVersion: "3dena.prepared-dataset-candidate.v1",
          productStatus: "IMPLEMENTED_UNVERIFIED",
          generation: 1,
          uploadIdentity: `upload:sha256:${preflight?.sha256}`,
          parsedIdentity: `parsed:sha256:${"a".repeat(64)}`,
          parsedContentSha256: "b".repeat(64),
          activationIdentity: `activation:sha256:${"c".repeat(64)}`,
          worksheet: {
            index: 0,
            name: "CSV",
            visibility: "visible",
            kind: "worksheet",
            selectable: true,
            unselectableReason: null,
            declaredRowCount: 3,
            declaredColumnCount: 6,
          },
          rowCount: 2,
          columnCount: 6,
          schema: receipt(String(preflight?.sha256), Number(preflight?.byteLength)).schema,
          preview: typedPreview,
          diagnostics: [],
          activatable: true,
        },
      });
    }
    if (url.endsWith("/activate") && method === "POST") {
      const datasetReceipt = receipt(String(preflight?.sha256), Number(preflight?.byteLength));
      return json({
        schemaVersion: "3dena.compute-dataset-activation-receipt.v1",
        datasetId: DATASET_ID,
        generation: 1,
        activationIdentity: datasetReceipt.activationIdentity,
        uploadIdentity: `upload:sha256:${preflight?.sha256}`,
        datasetReceipt,
        activatedAt: "2026-08-21T00:00:00.000Z",
        expiresAt: "2026-08-22T00:00:00.000Z",
        activationReceiptSha256: "e".repeat(64),
      });
    }
    if (url === `${BASE}/v1/jobs`) {
      jobRequests += 1;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.schemaVersion === "3dena.create-source-result-job-request.v1") {
        sourceCreateBody = body;
        return json({
          schemaVersion: "3dena.source-result-job-capability.v1",
          jobId: "derived-job-12345678",
          capabilityToken: "derived-capability-token-12345678",
          sourceJobId: body.sourceJobId,
          sourceResultHash: body.sourceResultHash,
          expiresAt: "2026-08-22T00:00:00.000Z",
        }, 201);
      }
      if (body.schemaVersion === "3dena.create-job-request.v1") {
        preparedCreateBody = body;
        return json({
          schemaVersion: "3dena.job-capability.v1",
          jobId: "job-12345678",
          capabilityToken: "job-capability-token-12345678",
          uploadUrl: `${BASE}/v1/jobs/job-12345678/content`,
          expiresAt: "2026-08-22T00:00:00.000Z",
        }, 201);
      }
      return json({
        schemaVersion: "3dena.job-capability.v1",
        jobId: "job-12345678",
        capabilityToken: "job-capability-token-12345678",
        uploadUrl: `${BASE}/v1/datasets/${DATASET_ID}/content`,
        expiresAt: "2026-08-22T00:00:00.000Z",
      }, 201);
    }
    if (url === `${BASE}/v1/jobs/job-12345678/content` && method === "PUT") {
      const dataset = preparedCreateBody?.dataset as Record<string, unknown> | undefined;
      return json({
        schemaVersion: "3dena.prepared-import-upload-receipt.v1",
        jobId: "job-12345678",
        sha256: dataset?.sha256,
        byteLength: dataset?.byteLength,
        accepted: true,
      });
    }
    if (url === `${BASE}/v1/jobs/job-12345678/execute`
        || url === `${BASE}/v1/jobs/derived-job-12345678/execute`) {
      jobRequests += 1;
      activatedExecuteBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (activatedExecuteBody.schemaVersion === "3dena.execute-prepared-import-job-request.v1") {
        preparedExecuteBody = activatedExecuteBody;
      }
      return json({
        schemaVersion: "3dena.job-status.v1",
        jobId: "job-12345678",
        state: "QUEUED",
        owner: null,
        progress: null,
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:00:00.000Z",
        expiresAt: "2026-08-22T00:00:00.000Z",
        resultAvailable: false,
        errorCode: null,
      }, 202);
    }
    if (url === `${BASE}/v1/datasets/${DATASET_ID}` && method === "DELETE") {
      return json({
        schemaVersion: "3dena.compute-dataset-deletion-receipt.v1",
        datasetId: DATASET_ID,
        deletedAt: "2026-08-21T00:05:00.000Z",
        sourceDeleted: true,
      });
    }
    return json({ code: "NOT_FOUND" }, 404);
  });
  return {
    adapter: createHttpRemoteDatasetWorkflowAdapter({
      baseUrl: BASE,
      fetch: fetchMock as typeof fetch,
      ...options.adapter,
    }),
    fetchMock,
    requests,
    mappingBody: () => mappingBody,
    jobRequests: () => jobRequests,
    activatedExecuteBody: () => activatedExecuteBody,
    sourceCreateBody: () => sourceCreateBody,
    preparedCreateBody: () => preparedCreateBody,
    preparedExecuteBody: () => preparedExecuteBody,
  };
}

async function activateSyntheticDataset(target: ReturnType<typeof remoteHarness>) {
  const file = new File([
    "participant,group,conversation,A,B,C\np1,g1,c1,1,0,1\np2,g2,c2,0,1,1\n",
  ], "study.csv", { type: "text/csv" });
  const signal = new AbortController().signal;
  const inventory = await target.adapter.inspect(file, signal, vi.fn());
  const parsed = await target.adapter.parseWorksheet(
    inventory,
    inventory.worksheets[0]!,
    signal,
  );
  const preview = await target.adapter.prepare(parsed, {
    unitColumns: ["participant", "group"],
    conversationColumns: ["conversation"],
    codeColumns: ["A", "B", "C"],
    groupColumn: "group",
    timeColumn: "conversation",
    entityColumn: "participant",
    model: "AccumulatedTrajectory",
    window: "MovingStanzaWindow",
    windowSizeBack: 4,
  }, signal);
  const active = await target.adapter.activate(preview, null, signal);
  return { active, inventory };
}

describe("HTTP remote dataset workflow adapter", () => {
  it("keeps inspection available but fails execution closed without the source-result contract", async () => {
    const target = remoteHarness([
      "3dena.compute-dataset-http.v1",
      "3dena.contract.v1",
    ]);
    await expect(target.adapter.capabilities()).resolves.toEqual({
      available: true,
      contractVersion: "3dena.compute-dataset-http.v1",
      blocker: null,
      executionAvailable: false,
      executionBlocker: "The allowlisted compute build does not advertise the reviewed service-owned source-result job contract. Analysis execution remains fail-closed.",
    });
    expect(target.fetchMock).toHaveBeenCalledOnce();
  });

  it("binds exact service inventory, mapping, preview, activation, and deletion contracts", async () => {
    const target = remoteHarness();
    await expect(target.adapter.capabilities()).resolves.toMatchObject({
      available: true,
      contractVersion: "3dena.compute-dataset-http.v1",
      executionAvailable: true,
    });
    const file = new File([
      "participant,group,conversation,A,B,C\np1,g1,c1,1,0,1\np2,g2,c2,0,1,1\n",
    ], "study.csv", { type: "text/csv" });
    const inventory = await target.adapter.inspect(file, new AbortController().signal, vi.fn());
    expect(inventory).toMatchObject({
      workflowId: DATASET_ID,
      format: "csv",
      parserVersion: "sheetjs-frozen-test",
    });
    const parsed = await target.adapter.parseWorksheet(
      inventory,
      inventory.worksheets[0]!,
      new AbortController().signal,
    );
    const preview = await target.adapter.prepare(parsed, {
      unitColumns: ["participant", "group"],
      conversationColumns: ["conversation"],
      codeColumns: ["A", "B", "C"],
      groupColumn: "group",
      timeColumn: "conversation",
      entityColumn: "participant",
      model: "AccumulatedTrajectory",
      window: "MovingStanzaWindow",
      windowSizeBack: 4,
    }, new AbortController().signal);
    expect(preview.rows).toHaveLength(1);
    const mapping = target.mappingBody()?.mapping as {
      columns: Array<{ header: string; roles: string[] }>;
    };
    expect(mapping.columns).toEqual([
      { index: 0, header: "participant", roles: ["unit"] },
      { index: 1, header: "group", roles: ["unit", "group"] },
      { index: 2, header: "conversation", roles: ["conversation", "time"] },
      { index: 3, header: "A", roles: ["code"] },
      { index: 4, header: "B", roles: ["code"] },
      { index: 5, header: "C", roles: ["code"] },
    ]);
    const active = await target.adapter.activate(
      preview,
      null,
      new AbortController().signal,
    );
    expect(active.receipt.sha256).toBe(inventory.sha256);

    const binding = await target.adapter.bindExecution(
      active,
      {
        schemaVersion: "3dena.activated-ena-model-task-spec.v1",
        kind: "ena-model",
        runId: "remote-run-test",
        deadlineEpochMilliseconds: Date.now() + 60_000,
        spec: {
          schemaVersion: "3dena.analysis-spec.v1",
          model: "AccumulatedTrajectory",
          window: "MovingStanzaWindow",
          weightBy: "binary",
          windowSizeBack: 4,
          windowSizeForward: 0,
          centerAlignToOrigin: true,
          cohortPolicy: "available",
        },
      },
      new AbortController().signal,
    );
    expect(target.jobRequests()).toBe(1);
    await binding.start();
    expect(target.jobRequests()).toBe(2);
    expect(target.activatedExecuteBody()).toEqual({
      schemaVersion: "3dena.execute-activated-job-request.v1",
      task: {
        schemaVersion: "3dena.activated-ena-model-task-spec.v1",
        kind: "ena-model",
        runId: "remote-run-test",
        deadlineEpochMilliseconds: expect.any(Number),
        spec: {
          schemaVersion: "3dena.analysis-spec.v1",
          model: "AccumulatedTrajectory",
          window: "MovingStanzaWindow",
          weightBy: "binary",
          windowSizeBack: 4,
          windowSizeForward: 0,
          centerAlignToOrigin: true,
          cohortPolicy: "available",
        },
      },
    });
    expect(JSON.stringify(target.activatedExecuteBody())).not.toContain("rows");

    const sourceResultHash = "f".repeat(64);
    const source = {
      reference: binding.reference,
      datasetReceipt: receipt(inventory.sha256, inventory.byteLength),
      sourceResultHash,
    };
    const derivedTasks: ActivatedAnalysisTaskSpecV1[] = [
      {
        schemaVersion: "3dena.activated-network-comparison-task-spec.v1",
        kind: "network-comparison",
        runId: "remote-comparison",
        deadlineEpochMilliseconds: Date.now() + 60_000,
        sourceResultHash,
        groups: ["g1", "g2"],
      },
      {
        schemaVersion: "3dena.activated-change-network-task-spec.v1",
        kind: "change-network",
        runId: "remote-change",
        deadlineEpochMilliseconds: Date.now() + 60_000,
        sourceResultHash,
        field: "group",
        level: "g1",
      },
      {
        schemaVersion: "3dena.activated-statistics-task-spec.v1",
        kind: "statistics",
        runId: "remote-statistics",
        deadlineEpochMilliseconds: Date.now() + 60_000,
        sourceResultHash,
        design: "independent",
        groups: ["g1", "g2"],
        dimensions: ["SVD1"],
        alternative: "two-sided",
        adjustment: "holm",
        samePhysicalEntityConfirmed: false,
      },
      {
        schemaVersion: "3dena.activated-trajectory-task-spec.v1",
        kind: "trajectory",
        runId: "remote-trajectory",
        deadlineEpochMilliseconds: Date.now() + 60_000,
        sourceResultHash,
        group: "g1",
        selectedDimensions: ["SVD1", "SVD2", "SVD3"],
        cohortPolicy: "available",
        periods: [{
          sourceTimeCanonical: "period-1",
          value: { type: "numeric-v1", value: 1, unit: "period" },
        }],
        estimand: { kind: "equal-participant-v1" },
      },
      {
        schemaVersion: "3dena.activated-trajectory-comparison-task-spec.v1",
        kind: "trajectory-comparison",
        runId: "remote-trajectory-comparison",
        deadlineEpochMilliseconds: Date.now() + 60_000,
        sourceResultHash,
        design: "independent",
        groups: ["g1", "g2"],
        samePhysicalEntityConfirmed: false,
      },
      {
        schemaVersion: "3dena.activated-bootstrap-task-spec.v1",
        kind: "bootstrap",
        runId: "remote-bootstrap",
        deadlineEpochMilliseconds: Date.now() + 60_000,
        sourceResultHash,
        group: "g1",
        replicates: 200,
        confidenceLevel: 0.95,
        seed: 42,
        interval: "pointwise-percentile-type7",
        rotationPolicy: "fixed-preprojected",
      },
    ];
    for (const task of derivedTasks) {
      const derived = await target.adapter.bindDerivedExecution(
        source,
        task,
        new AbortController().signal,
      );
      expect(target.sourceCreateBody()).toEqual({
        schemaVersion: "3dena.create-source-result-job-request.v1",
        sourceJobId: binding.reference.jobId,
        sourceResultHash,
        processingPolicyConfirmed: true,
      });
      await derived.start();
      expect(target.activatedExecuteBody()).toMatchObject({
        schemaVersion: "3dena.execute-activated-job-request.v1",
        task: {
          schemaVersion: task.schemaVersion,
          kind: task.kind,
          runId: task.runId,
          sourceResultHash,
        },
      });
      expect(JSON.stringify(target.activatedExecuteBody())).not.toMatch(/rows|envelope/u);
    }

    await target.adapter.discard(inventory.workflowId);
    const mutations = target.requests.filter((request) => request.method !== "GET");
    expect(mutations.every((request) => request.headers.get("idempotency-key"))).toBe(true);
    const datasetOwnedMutations = mutations.filter((request) =>
      request.url.includes(`/v1/datasets/${DATASET_ID}`));
    expect(datasetOwnedMutations.every((request) =>
      request.headers.get("authorization") === `Bearer ${CAPABILITY}`)).toBe(true);
    const jobCreates = mutations.filter((request) => request.url.endsWith("/v1/jobs"));
    expect(jobCreates[0]?.headers.get("authorization")).toBe(`Bearer ${CAPABILITY}`);
    expect(jobCreates.slice(1).every((request) =>
      request.headers.get("authorization") === "Bearer job-capability-token-12345678")).toBe(true);
    const sourceExecuteMutations = mutations.filter((request) =>
      request.url.endsWith("/v1/jobs/derived-job-12345678/execute"));
    expect(sourceExecuteMutations.every((request) =>
      request.headers.get("authorization") === "Bearer derived-capability-token-12345678")).toBe(true);
    const enaExecuteMutations = mutations.filter((request) =>
      request.url.endsWith("/v1/jobs/job-12345678/execute"));
    expect(enaExecuteMutations.every((request) =>
      request.headers.get("authorization") === "Bearer job-capability-token-12345678")).toBe(true);
  });

  it("preflights a strict prepared exchange locally, then uploads exact bytes only during explicit service binding", async () => {
    const target = remoteHarness();
    const bytes = class1ShapedSyntheticPreparedBytes();
    const file = new File([Uint8Array.from(bytes)], "prepared.ena3d.json", {
      type: "application/json",
    });
    const prepared = await target.adapter.inspectPrepared(
      file,
      new AbortController().signal,
      vi.fn(),
    );
    expect(prepared).toMatchObject({
      byteLength: bytes.byteLength,
      dimensions: ["SVD1", "SVD2", "SVD3", "SVD4", "SVD5"],
      points: 18,
      nodes: 3,
      edges: 3,
      groups: 2,
      periods: ["TP1", "TP2", "TP3"],
    });
    expect(target.preparedCreateBody()).toBeNull();

    const binding = await target.adapter.bindPreparedExecution(
      prepared,
      "prepared-run-test",
      Date.now() + 60_000,
      new AbortController().signal,
    );
    expect(binding).toMatchObject({
      taskKind: "prepared-import",
      runId: "prepared-run-test",
      datasetReceipt: {
        format: "ena3d-json",
        sha256: prepared.sha256,
        rows: prepared.points,
        columns: prepared.dimensions.length,
      },
    });
    expect(target.preparedCreateBody()).toMatchObject({
      schemaVersion: "3dena.create-job-request.v1",
      dataset: {
        sha256: prepared.sha256,
        byteLength: prepared.byteLength,
        format: "ena3d-json",
      },
      processingPolicyConfirmed: true,
    });
    const contentRequest = target.requests.find((request) =>
      request.url === `${BASE}/v1/jobs/job-12345678/content` && request.method === "PUT");
    expect(contentRequest?.headers.get("authorization")).toBe("Bearer job-capability-token-12345678");
    expect(contentRequest?.headers.get("content-type")).toBe("application/octet-stream");

    await binding.start();
    expect(target.preparedExecuteBody()).toMatchObject({
      schemaVersion: "3dena.execute-prepared-import-job-request.v1",
      datasetReceipt: {
        format: "ena3d-json",
        activationIdentity: expect.stringMatching(/^prepared:[a-f0-9]{64}:[a-f0-9]{64}$/u),
      },
      task: {
        schemaVersion: "3dena.activated-prepared-import-task-spec.v1",
        kind: "prepared-import",
        runId: "prepared-run-test",
        mapping: prepared.mapping,
      },
    });
    expect(JSON.stringify(target.preparedExecuteBody())).not.toContain("exactBytesBase64");
  });

  it("replays create and execute mutations with one stable body and idempotency key after a persisted response is lost", async () => {
    type Operation =
      | "activated-create"
      | "source-result-create"
      | "prepared-execute"
      | "activated-execute"
      | "derived-execute";
    const attempts = new Map<Operation, Array<{
      readonly body: string;
      readonly idempotencyKey: string | null;
    }>>();
    const persisted = new Set<Operation>();
    const operation = (request: RecordedRequest): Operation | null => {
      if (request.method !== "POST" || typeof request.body !== "string") return null;
      const body = JSON.parse(request.body) as {
        schemaVersion?: string;
        task?: { kind?: string };
      };
      if (request.url === `${BASE}/v1/jobs`
          && body.schemaVersion === "3dena.create-activated-job-request.v1") {
        return "activated-create";
      }
      if (request.url === `${BASE}/v1/jobs`
          && body.schemaVersion === "3dena.create-source-result-job-request.v1") {
        return "source-result-create";
      }
      if (!request.url.endsWith("/execute")) return null;
      if (body.schemaVersion === "3dena.execute-prepared-import-job-request.v1") {
        return "prepared-execute";
      }
      if (body.schemaVersion !== "3dena.execute-activated-job-request.v1") return null;
      return body.task?.kind === "ena-model" ? "activated-execute" : "derived-execute";
    };
    const replayResponse = (name: Operation, request: RecordedRequest): Response => {
      if (name === "activated-create") {
        return json({
          schemaVersion: "3dena.job-capability.v1",
          jobId: "job-12345678",
          capabilityToken: "job-capability-token-12345678",
          uploadUrl: `${BASE}/v1/datasets/${DATASET_ID}/content`,
          expiresAt: "2026-08-22T00:00:00.000Z",
        }, 201);
      }
      if (name === "source-result-create") {
        const body = JSON.parse(String(request.body)) as {
          sourceJobId: string;
          sourceResultHash: string;
        };
        return json({
          schemaVersion: "3dena.source-result-job-capability.v1",
          jobId: "derived-job-12345678",
          capabilityToken: "derived-capability-token-12345678",
          sourceJobId: body.sourceJobId,
          sourceResultHash: body.sourceResultHash,
          expiresAt: "2026-08-22T00:00:00.000Z",
        }, 201);
      }
      return json({
        schemaVersion: "3dena.job-status.v1",
        jobId: name === "derived-execute"
          ? "derived-job-12345678"
          : "job-12345678",
        state: "QUEUED",
        owner: null,
        progress: null,
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:00:00.000Z",
        expiresAt: "2026-08-22T00:00:00.000Z",
        resultAvailable: false,
        errorCode: null,
      }, 202);
    };
    const target = remoteHarness(undefined, {
      adapter: {
        requestTimeoutMilliseconds: 100,
        retryMaxAttempts: 2,
        retryBaseDelayMilliseconds: 1,
        retryMaximumDelayMilliseconds: 1,
        retryTotalTimeoutMilliseconds: 500,
      },
      beforeRoute(request) {
        const name = operation(request);
        if (name === null) return undefined;
        const observed = attempts.get(name) ?? [];
        observed.push({
          body: String(request.body),
          idempotencyKey: request.headers.get("idempotency-key"),
        });
        attempts.set(name, observed);
        if (!persisted.has(name)) {
          persisted.add(name);
          throw new TypeError("The service persisted the operation but its response was lost.");
        }
        return replayResponse(name, request);
      },
    });
    const signal = new AbortController().signal;
    const { active } = await activateSyntheticDataset(target);
    const enaTask: ActivatedAnalysisTaskSpecV1 = {
      schemaVersion: "3dena.activated-ena-model-task-spec.v1",
      kind: "ena-model",
      runId: "remote-run-replay",
      deadlineEpochMilliseconds: Date.now() + 60_000,
      spec: {
        schemaVersion: "3dena.analysis-spec.v1",
        model: "AccumulatedTrajectory",
        window: "MovingStanzaWindow",
        weightBy: "binary",
        windowSizeBack: 4,
        windowSizeForward: 0,
        centerAlignToOrigin: true,
        cohortPolicy: "available",
      },
    };
    const activated = await target.adapter.bindExecution(active, enaTask, signal);
    expect(activated.reference).toEqual({
      jobId: "job-12345678",
      capabilityToken: "job-capability-token-12345678",
    });
    await activated.start(signal);
    await activated.start(signal);

    const sourceResultHash = "f".repeat(64);
    const derived = await target.adapter.bindDerivedExecution({
      reference: activated.reference,
      datasetReceipt: active.receipt,
      sourceResultHash,
    }, {
      schemaVersion: "3dena.activated-trajectory-task-spec.v1",
      kind: "trajectory",
      runId: "derived-run-replay",
      deadlineEpochMilliseconds: Date.now() + 60_000,
      sourceResultHash,
      group: "g1",
      selectedDimensions: ["SVD1", "SVD2", "SVD3"],
      cohortPolicy: "available",
      periods: [{
        sourceTimeCanonical: "period-1",
        value: { type: "numeric-v1", value: 1, unit: "period" },
      }],
      estimand: { kind: "equal-participant-v1" },
    }, signal);
    expect(derived.reference).toEqual({
      jobId: "derived-job-12345678",
      capabilityToken: "derived-capability-token-12345678",
    });
    await derived.start(signal);
    await derived.start(signal);

    const bytes = class1ShapedSyntheticPreparedBytes();
    const prepared = await target.adapter.inspectPrepared(new File([
      Uint8Array.from(bytes),
    ], "prepared.ena3d.json", { type: "application/json" }), signal, vi.fn());
    const preparedBinding = await target.adapter.bindPreparedExecution(
      prepared,
      "prepared-run-replay",
      Date.now() + 60_000,
      signal,
    );
    await preparedBinding.start(signal);
    await preparedBinding.start(signal);

    const expectedOperations: Operation[] = [
      "activated-create",
      "source-result-create",
      "prepared-execute",
      "activated-execute",
      "derived-execute",
    ];
    expect([...persisted].sort()).toEqual([...expectedOperations].sort());
    for (const name of expectedOperations) {
      const observed = attempts.get(name);
      expect(observed, name).toHaveLength(name.endsWith("execute") ? 3 : 2);
      expect(observed?.[0]?.idempotencyKey, name).toMatch(/^[^\s]{8,200}$/u);
      expect(observed?.every((item) => (
        item.body === observed[0]?.body
        && item.idempotencyKey === observed[0]?.idempotencyKey
      )), name).toBe(true);
    }
  });

  it("uses a bounded client deadline that aborts the in-flight request body", async () => {
    const observedSignals: AbortSignal[] = [];
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal;
        observedSignals.push(signal);
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }));
    const configuration = {
      baseUrl: BASE,
      fetch: fetchMock as typeof fetch,
      requestTimeoutMilliseconds: 10,
      retryMaxAttempts: 1,
      retryBaseDelayMilliseconds: 1,
      retryMaximumDelayMilliseconds: 1,
      retryTotalTimeoutMilliseconds: 100,
    };
    const adapter = createHttpRemoteDatasetWorkflowAdapter(configuration);
    const safety = new AbortController();
    const safetyTimer = setTimeout(() => safety.abort(new Error("test safety deadline")), 250);
    try {
      await expect(adapter.capabilities(safety.signal)).rejects.toMatchObject({
        code: "REQUEST_TIMEOUT",
      });
    } finally {
      clearTimeout(safetyTimer);
    }
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(observedSignals).toHaveLength(1);
    expect(observedSignals[0]?.aborted).toBe(true);
  });

  it("keeps successful JSON response-body consumption inside the client deadline", async () => {
    const cancelled = vi.fn();
    const hangingBody = new ReadableStream<Uint8Array>({
      start() {
        // Headers arrived, but an intermediary silently stopped forwarding bytes.
      },
      cancel(reason) {
        cancelled(reason);
      },
    });
    const fetchMock = vi.fn(async () => new Response(hangingBody, {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    }));
    const configuration = {
      baseUrl: BASE,
      fetch: fetchMock as typeof fetch,
      requestTimeoutMilliseconds: 10,
      retryMaxAttempts: 1,
      retryBaseDelayMilliseconds: 1,
      retryMaximumDelayMilliseconds: 1,
      retryTotalTimeoutMilliseconds: 100,
    };
    await expect(
      createHttpRemoteDatasetWorkflowAdapter(configuration).capabilities(),
    ).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("honors caller abort before an attempt and never retries it", async () => {
    const fetchMock = vi.fn(async () => json({}));
    const configuration = {
      baseUrl: BASE,
      fetch: fetchMock as typeof fetch,
      requestTimeoutMilliseconds: 100,
      retryMaxAttempts: 4,
      retryBaseDelayMilliseconds: 1,
      retryMaximumDelayMilliseconds: 1,
      retryTotalTimeoutMilliseconds: 500,
    };
    const adapter = createHttpRemoteDatasetWorkflowAdapter(configuration);
    const controller = new AbortController();
    controller.abort();
    await expect(adapter.capabilities(controller.signal)).rejects.toMatchObject({
      code: "ABORTED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards an in-flight caller abort and never retries it", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }));
    const configuration = {
      baseUrl: BASE,
      fetch: fetchMock as typeof fetch,
      requestTimeoutMilliseconds: 1_000,
      retryMaxAttempts: 4,
      retryBaseDelayMilliseconds: 1,
      retryMaximumDelayMilliseconds: 1,
      retryTotalTimeoutMilliseconds: 2_000,
    };
    const adapter = createHttpRemoteDatasetWorkflowAdapter(configuration);
    const controller = new AbortController();
    const pending = adapter.capabilities(controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    controller.abort();
    await assertion;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("bounds transient retries by attempt count", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("connection reset");
    });
    const configuration = {
      baseUrl: BASE,
      fetch: fetchMock as typeof fetch,
      requestTimeoutMilliseconds: 100,
      retryMaxAttempts: 3,
      retryBaseDelayMilliseconds: 1,
      retryMaximumDelayMilliseconds: 1,
      retryTotalTimeoutMilliseconds: 500,
    };
    const adapter = createHttpRemoteDatasetWorkflowAdapter(configuration);
    await expect(adapter.capabilities()).rejects.toMatchObject({
      code: "NETWORK_FAILURE",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry before the server Retry-After delay", async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const fetchMock = vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response(JSON.stringify({ code: "CAPACITY_EXHAUSTED" }), {
            status: 503,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "retry-after": "1",
              "x-request-id": "retry-after-test",
            },
          });
        }
        return json({
          schemaVersion: "3dena.compute-build-info.v1",
          approvalManifestSha256: "1".repeat(64),
          releaseId: "release-20260821",
          gitCommit: "2".repeat(40),
          flyImageDigest: `sha256:${"3".repeat(64)}`,
          flyBuildId: "fly-build-20260821",
          role: "api",
          contractVersions: [
            "3dena.compute-dataset-http.v1",
            "3dena.compute-prepared-import-http.v1",
            "3dena.compute-source-result-job-http.v1",
            "3dena.contract.v1",
          ],
        });
      });
      const configuration = {
        baseUrl: BASE,
        fetch: fetchMock as typeof fetch,
        requestTimeoutMilliseconds: 100,
        retryMaxAttempts: 2,
        retryBaseDelayMilliseconds: 1,
        retryMaximumDelayMilliseconds: 1,
        retryTotalTimeoutMilliseconds: 2_000,
      };
      const pending = createHttpRemoteDatasetWorkflowAdapter(configuration).capabilities();
      await vi.advanceTimersByTimeAsync(999);
      expect(fetchMock).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toMatchObject({ available: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not shorten Retry-After to fit the remaining total retry budget", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ code: "CAPACITY_EXHAUSTED" }),
      {
        status: 503,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "retry-after": "2",
          "x-request-id": "retry-budget-test",
        },
      },
    ));
    const configuration = {
      baseUrl: BASE,
      fetch: fetchMock as typeof fetch,
      requestTimeoutMilliseconds: 100,
      retryMaxAttempts: 4,
      retryBaseDelayMilliseconds: 1,
      retryMaximumDelayMilliseconds: 1,
      retryTotalTimeoutMilliseconds: 1_000,
    };
    await expect(
      createHttpRemoteDatasetWorkflowAdapter(configuration).capabilities(),
    ).rejects.toMatchObject({
      code: "CAPACITY_EXHAUSTED",
      status: 503,
      retryAfterMilliseconds: 2_000,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects prepared exchanges before allocating a remote capability", async () => {
    const target = remoteHarness();
    const file = new File(["{}"], "candidate.ena3d.json", { type: "application/json" });
    await expect(target.adapter.inspect(
      file,
      new AbortController().signal,
      vi.fn(),
    )).rejects.toMatchObject({ code: "PREPARED_EXCHANGE_NOT_SUPPORTED" });
    expect(target.requests.some((request) => request.url.endsWith("/v1/datasets"))).toBe(false);
  });
});
