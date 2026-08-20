import { describe, expect, it, vi } from "vitest";

import {
  ANALYSIS_CONTRACT_VERSION_V1,
  ANALYSIS_TASK_VERSION_V1,
  DATASET_RECEIPT_VERSION_V1,
} from "./contracts";
import { AnalysisClientError, createAnalysisClient } from "./analysis-client";

const DATASET_HASH = "a".repeat(64);
const SPEC_HASH = "b".repeat(64);

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function capability(extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: "3dena.job-capability.v1",
    jobId: "job-1",
    capabilityToken: "secret-job-capability",
    uploadUrl: "https://objects.example/upload/job-1",
    expiresAt: "2026-08-21T00:00:00.000Z",
    ...extra,
  };
}

function status(extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: "3dena.job-status.v1",
    jobId: "job-1",
    state: "QUEUED",
    owner: {
      contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
      datasetHash: DATASET_HASH,
      specHash: SPEC_HASH,
      runId: "run-1",
      taskId: "task-1",
    },
    progress: { phase: "queued", completed: 0, total: null },
    createdAt: "2026-08-20T12:00:00.000Z",
    updatedAt: "2026-08-20T12:00:01.000Z",
    expiresAt: "2026-08-21T12:00:00.000Z",
    resultAvailable: false,
    errorCode: null,
    ...extra,
  };
}

function reference() {
  return { jobId: "job-1", capabilityToken: "secret-job-capability" };
}

function receipt() {
  return {
    schemaVersion: DATASET_RECEIPT_VERSION_V1,
    sha256: DATASET_HASH,
    byteLength: 32,
    format: "csv" as const,
    sheet: { index: 0, name: "CSV" },
    rows: 2,
    columns: 4,
    schema: {
      schemaVersion: "3dena.dataset-schema.v1" as const,
      headers: ["participant", "conversation", "A", "B"],
      columns: [
        { name: "participant", inferredType: "string" as const, roles: ["unit" as const] },
        { name: "conversation", inferredType: "string" as const, roles: ["conversation" as const] },
        { name: "A", inferredType: "number" as const, roles: ["code" as const] },
        { name: "B", inferredType: "number" as const, roles: ["code" as const] },
      ],
    },
    limits: {
      schemaVersion: "3dena.dataset-limits.v1" as const,
      maxFileBytes: 5 * 1024 * 1024,
      maxWorksheets: 32,
      maxRows: 100_000,
      maxColumns: 256,
      maxCells: 5_000_000,
    },
    warnings: [],
    activationIdentity: `dataset:${DATASET_HASH}`,
  };
}

function enaTask() {
  return {
    schemaVersion: ANALYSIS_TASK_VERSION_V1,
    kind: "ena-model" as const,
    owner: {
      contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
      datasetHash: DATASET_HASH,
      specHash: SPEC_HASH,
      runId: "run-1",
      taskId: "task-1",
    },
    deadlineEpochMilliseconds: 4_000_000_000_000,
    input: {
      rows: [
        { participant: "p1", conversation: "c1", A: 1, B: 1 },
        { participant: "p2", conversation: "c2", A: 1, B: 0 },
      ],
      mapping: { units: ["participant"], conversation: ["conversation"], codes: ["A", "B"] },
    },
  };
}

describe("createAnalysisClient", () => {
  it("accepts only an exact approved compute build identity", async () => {
    const validBuildInfo = {
      schemaVersion: "3dena.compute-build-info.v1",
      approvalManifestSha256: "a".repeat(64),
      releaseId: "release-20260821",
      gitCommit: "b".repeat(40),
      flyImageDigest: `sha256:${"c".repeat(64)}`,
      flyBuildId: "fly-build-20260821",
      role: "api",
      contractVersions: [ANALYSIS_CONTRACT_VERSION_V1, "3dena.compute-http.v1"].sort(),
    } as const;
    const client = createAnalysisClient({
      baseUrl: "https://compute.example",
      fetch: vi.fn(async () => json(validBuildInfo)) as unknown as typeof fetch,
    });
    await expect(client.getBuildInfo()).resolves.toEqual(validBuildInfo);

    for (const invalid of [
      { ...validBuildInfo, buildId: "legacy-string-only" },
      { ...validBuildInfo, approvalManifestSha256: "not-a-digest" },
      { ...validBuildInfo, gitCommit: "D".repeat(40) },
      { ...validBuildInfo, flyImageDigest: "sha256:not-a-digest" },
      { ...validBuildInfo, contractVersions: [...validBuildInfo.contractVersions].reverse() },
      { ...validBuildInfo, contractVersions: [ANALYSIS_CONTRACT_VERSION_V1, ANALYSIS_CONTRACT_VERSION_V1] },
    ]) {
      const invalidClient = createAnalysisClient({
        baseUrl: "https://compute.example",
        fetch: vi.fn(async () => json(invalid)) as unknown as typeof fetch,
      });
      await expect(invalidClient.getBuildInfo()).rejects.toEqual(expect.objectContaining<Partial<AnalysisClientError>>({ code: "INVALID_RESPONSE" }));
    }
  });

  it("creates a job on the configured base path with contract and idempotency headers", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json(capability()));
    const client = createAnalysisClient({
      baseUrl: "https://compute.example/api/",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await client.createJob({
      schemaVersion: "3dena.create-job-request.v1",
      dataset: { sha256: DATASET_HASH, byteLength: 32, format: "csv" },
      processingPolicyConfirmed: true,
    }, "create-job-0001");

    expect(result).toEqual(capability());
    const [requestUrl, initOptional] = fetchMock.mock.calls[0]!;
    const init = initOptional!;
    expect(requestUrl).toBe("https://compute.example/api/v1/jobs");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
    expect((init.headers as Headers).get("idempotency-key")).toBe("create-job-0001");
    expect((init.headers as Headers).get("x-3dena-contract-version")).toBe(ANALYSIS_CONTRACT_VERSION_V1);
    expect((init.headers as Headers).has("authorization")).toBe(false);
  });

  it("binds execute requests to the capability and exact dataset/task owner", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json(status()));
    const client = createAnalysisClient({ baseUrl: "https://compute.example", fetch: fetchMock as unknown as typeof fetch });
    const result = await client.executeJob(reference(), {
      schemaVersion: "3dena.execute-job-request.v1",
      datasetReceipt: receipt(),
      task: enaTask(),
    }, "execute-job-0001");

    expect(result.state).toBe("QUEUED");
    const [requestUrl, initOptional] = fetchMock.mock.calls[0]!;
    const init = initOptional!;
    expect(requestUrl).toBe("https://compute.example/v1/jobs/job-1/execute");
    expect((init.headers as Headers).get("authorization")).toBe("Bearer secret-job-capability");
    expect(JSON.parse(String(init.body))).toMatchObject({
      datasetReceipt: { sha256: DATASET_HASH },
      task: { owner: { datasetHash: DATASET_HASH, specHash: SPEC_HASH } },
    });
  });

  it("parses CRLF SSE in split chunks without putting capabilities in the URL", async () => {
    const encoder = new TextEncoder();
    const payload = JSON.stringify({
      schemaVersion: "3dena.job-event.v1",
      sequence: 1,
      state: "RUNNING",
      phase: "jena",
      completed: 2,
      total: 4,
      emittedAt: "2026-08-20T12:00:02.000Z",
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`event: progress\r\ndata: ${payload.slice(0, 40)}`));
        controller.enqueue(encoder.encode(`${payload.slice(40)}\r\n\r\n`));
        controller.close();
      },
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(stream, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } }));
    const client = createAnalysisClient({ baseUrl: "https://compute.example", fetch: fetchMock as unknown as typeof fetch });
    const events = [];
    for await (const item of client.events(reference())) events.push(item);

    expect(events).toEqual([expect.objectContaining({ sequence: 1, state: "RUNNING", phase: "jena" })]);
    const [requestUrl, initOptional] = fetchMock.mock.calls[0]!;
    const init = initOptional!;
    expect(requestUrl).toBe("https://compute.example/v1/jobs/job-1/events");
    expect(requestUrl).not.toContain("secret-job-capability");
    expect((init.headers as Headers).get("authorization")).toBe("Bearer secret-job-capability");
  });

  it("rejects unknown response fields and mismatched job identities", async () => {
    const unknownClient = createAnalysisClient({
      baseUrl: "https://compute.example",
      fetch: vi.fn(async () => json(capability({ unexpected: true }))) as unknown as typeof fetch,
    });
    await expect(unknownClient.createJob({
      schemaVersion: "3dena.create-job-request.v1",
      dataset: { sha256: DATASET_HASH, byteLength: 32, format: "csv" },
      processingPolicyConfirmed: true,
    }, "create-job-0001")).rejects.toEqual(expect.objectContaining<Partial<AnalysisClientError>>({ code: "INVALID_RESPONSE" }));

    const mismatchedClient = createAnalysisClient({
      baseUrl: "https://compute.example",
      fetch: vi.fn(async () => json(status({ jobId: "job-other" }))) as unknown as typeof fetch,
    });
    await expect(mismatchedClient.getJob(reference())).rejects.toThrow(/identity does not match/);
  });

  it("does not reflect capability tokens or server messages in errors", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ code: "UNAUTHORIZED", message: "secret-job-capability raw participant p1" }, 401, { "x-request-id": "request-7" }));
    const client = createAnalysisClient({ baseUrl: "https://compute.example", fetch: fetchMock as unknown as typeof fetch });
    let caught: unknown;
    try {
      await client.getJob(reference());
    } catch (error) {
      caught = error;
    }
    expect(caught).toEqual(expect.objectContaining<Partial<AnalysisClientError>>({ code: "UNAUTHORIZED", status: 401, requestId: "request-7" }));
    expect(String(caught)).not.toContain("secret-job-capability");
    expect(String(caught)).not.toContain("participant");
  });

  it("requires explicit processing confirmation and secure endpoint URLs", async () => {
    expect(() => createAnalysisClient({ baseUrl: "http://compute.example" })).toThrow(/HTTPS or loopback/);
    const client = createAnalysisClient({ baseUrl: "https://compute.example", fetch: vi.fn() as unknown as typeof fetch });
    await expect(client.createJob({
      schemaVersion: "3dena.create-job-request.v1",
      dataset: { sha256: DATASET_HASH, byteLength: 32, format: "csv" },
      processingPolicyConfirmed: false,
    } as never, "create-job-0001")).rejects.toEqual(expect.objectContaining<Partial<AnalysisClientError>>({ code: "PROCESSING_POLICY_NOT_CONFIRMED" }));
  });
});
