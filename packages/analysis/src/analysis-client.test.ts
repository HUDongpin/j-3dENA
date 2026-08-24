import { describe, expect, it, vi } from "vitest";

import {
  ANALYSIS_CONTRACT_VERSION_V1,
  ANALYSIS_TASK_VERSION_V1,
  DATASET_RECEIPT_VERSION_V1,
} from "./contracts";
import {
  AnalysisClientError,
  createAnalysisClient,
  type AnalysisClientV1,
  type AnalysisClientV2,
} from "./analysis-client";

type AssertNever<T extends never> = T;
type AssertTrue<T extends true> = T;
type _V1DurableDeletionSurfaceMustRemainAbsent = AssertNever<
  Extract<keyof AnalysisClientV1, "deleteJobV2" | "deleteJobUntilComplete">
>;
type _V2MustRemainAdditive = AssertTrue<AnalysisClientV2 extends AnalysisClientV1 ? true : false>;

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
  it("negotiates deletion V2 and polls with one stable operation key until every lifecycle fact is final", async () => {
    const responses = [
      {
        schemaVersion: "3dena.job-deletion-receipt.v2",
        jobId: "job-1",
        cancelled: false,
        inputDeleted: false,
        resultDeleted: false,
        deletedAt: null,
        intentAccepted: true,
        termination: "pending",
        capacity: "held",
        objects: "pending",
      },
      {
        schemaVersion: "3dena.job-deletion-receipt.v2",
        jobId: "job-1",
        cancelled: true,
        inputDeleted: true,
        resultDeleted: true,
        deletedAt: "2026-08-20T12:00:01.000Z",
        intentAccepted: true,
        termination: "observed",
        capacity: "released",
        objects: "deleted",
      },
    ];
    const fetchMock = vi.fn(async () => json(responses.shift()));
    const client = createAnalysisClient({
      baseUrl: "https://compute.example",
      fetch: fetchMock as unknown as typeof fetch,
      deletionPollIntervalMilliseconds: 1,
    });

    await expect(client.deleteJobUntilComplete(
      reference(),
      "stable-delete-operation-1",
    )).resolves.toMatchObject({
      schemaVersion: "3dena.job-deletion-receipt.v2",
      termination: "observed",
      capacity: "released",
      objects: "deleted",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls as unknown as Array<[
      RequestInfo | URL,
      RequestInit | undefined,
    ]>;
    for (const [, init] of calls) {
      expect((init?.headers as Headers).get("idempotency-key"))
        .toBe("stable-delete-operation-1");
      expect((init?.headers as Headers).get("accept"))
        .toBe("application/vnd.3dena.job-deletion-receipt.v2+json");
    }
  });

  it("keeps the original deletion V1 parser exact for legacy negotiation", async () => {
    const legacy = {
      schemaVersion: "3dena.job-deletion-receipt.v1",
      jobId: "job-1",
      cancelled: false,
      inputDeleted: true,
      resultDeleted: true,
      deletedAt: "2026-08-20T12:00:01.000Z",
    };
    const client = createAnalysisClient({
      baseUrl: "https://compute.example",
      fetch: vi.fn(async () => json(legacy)) as unknown as typeof fetch,
    });
    await expect(client.deleteJob(reference(), "legacy-delete-operation-1"))
      .resolves.toEqual(legacy);
  });

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

  it("resumes SSE from the last observed id and keeps the in-memory cursor monotonic", async () => {
    const encoder = new TextEncoder();
    const eventPayload = (sequence: number, state: "RUNNING" | "SUCCEEDED") => JSON.stringify({
      schemaVersion: "3dena.job-event.v1",
      sequence,
      state,
      phase: state === "SUCCEEDED" ? "complete" : "jena",
      completed: sequence,
      total: 2,
      emittedAt: `2026-08-20T12:00:0${sequence}.000Z`,
    });
    const responses = [
      `id: 1\nevent: progress\ndata: ${eventPayload(1, "RUNNING")}\n\n`,
      [
        `id: 1\nevent: progress\ndata: ${eventPayload(1, "RUNNING")}\n\n`,
        `id: 2\nevent: progress\ndata: ${eventPayload(2, "SUCCEEDED")}\n\n`,
      ].join(""),
    ];
    const fetchMock = vi.fn(async () => {
      const body = responses.shift();
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(body));
          controller.close();
        },
      }), {
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8" },
      });
    });
    const client = createAnalysisClient({
      baseUrl: "https://compute.example",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const first = [];
    for await (const item of client.events(reference())) first.push(item.sequence);
    const resumed = [];
    for await (const item of client.events(reference())) resumed.push(item.sequence);

    expect(first).toEqual([1]);
    expect(resumed).toEqual([2]);
    const calls = fetchMock.mock.calls as unknown as Array<[
      RequestInfo | URL,
      RequestInit | undefined,
    ]>;
    expect((calls[0]?.[1]?.headers as Headers).has("last-event-id")).toBe(false);
    expect((calls[1]?.[1]?.headers as Headers).get("last-event-id")).toBe("1");
  });

  it("rejects an SSE id that does not match the event sequence", async () => {
    const payload = JSON.stringify({
      schemaVersion: "3dena.job-event.v1",
      sequence: 1,
      state: "RUNNING",
      phase: "jena",
      completed: 1,
      total: 2,
      emittedAt: "2026-08-20T12:00:01.000Z",
    });
    const client = createAnalysisClient({
      baseUrl: "https://compute.example",
      fetch: vi.fn(async () => new Response(
        `id: 2\nevent: progress\ndata: ${payload}\n\n`,
        { status: 200, headers: { "content-type": "text/event-stream" } },
      )) as unknown as typeof fetch,
    });

    const consume = async () => {
      for await (const _item of client.events(reference())) {
        // Consume the strict stream.
      }
    };
    await expect(consume()).rejects.toEqual(
      expect.objectContaining<Partial<AnalysisClientError>>({ code: "INVALID_RESPONSE" }),
    );
  });

  it("retries a transient mutation with one stable idempotency context", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("connection reset"))
      .mockResolvedValueOnce(json(capability()));
    const client = createAnalysisClient({
      baseUrl: "https://compute.example",
      fetch: fetchMock as unknown as typeof fetch,
      retryBaseDelayMilliseconds: 1,
      retryMaximumDelayMilliseconds: 1,
      retryTotalTimeoutMilliseconds: 100,
    });

    await expect(client.createJob({
      schemaVersion: "3dena.create-job-request.v1",
      dataset: { sha256: DATASET_HASH, byteLength: 32, format: "csv" },
      processingPolicyConfirmed: true,
    }, "stable-create-operation-1")).resolves.toEqual(capability());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls as unknown as Array<[
      RequestInfo | URL,
      RequestInit | undefined,
    ]>;
    expect(calls.map(([, init]) => (init?.headers as Headers).get("idempotency-key")))
      .toEqual(["stable-create-operation-1", "stable-create-operation-1"]);
    expect(calls[1]?.[1]?.body).toBe(calls[0]?.[1]?.body);
  });

  it("honors Retry-After without exceeding the bounded retry window", async () => {
    const fetchMock = vi.fn(async () => json(
      { code: "RATE_LIMITED" },
      429,
      { "retry-after": "1" },
    ));
    const client = createAnalysisClient({
      baseUrl: "https://compute.example",
      fetch: fetchMock as unknown as typeof fetch,
      retryBaseDelayMilliseconds: 1,
      retryMaximumDelayMilliseconds: 1,
      retryTotalTimeoutMilliseconds: 25,
    });

    await expect(client.getJob(reference())).rejects.toEqual(
      expect.objectContaining<Partial<AnalysisClientError>>({
        code: "RATE_LIMITED",
        status: 429,
        retryAfterMilliseconds: 1_000,
      }),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("parses an HTTP-date Retry-After without retrying before that date", async () => {
    const retryAt = new Date(Date.now() + 60_000).toUTCString();
    const fetchMock = vi.fn(async () => json(
      { code: "SERVICE_BUSY" },
      503,
      { "retry-after": retryAt },
    ));
    const client = createAnalysisClient({
      baseUrl: "https://compute.example",
      fetch: fetchMock as unknown as typeof fetch,
      retryBaseDelayMilliseconds: 1,
      retryMaximumDelayMilliseconds: 1,
      retryTotalTimeoutMilliseconds: 25,
    });

    const error = await client.getJob(reference()).then(
      () => null,
      (failure: unknown) => failure,
    );
    expect(error).toEqual(expect.objectContaining<Partial<AnalysisClientError>>({
      code: "SERVICE_BUSY",
      status: 503,
    }));
    expect((error as AnalysisClientError).retryAfterMilliseconds).toBeGreaterThan(58_000);
    expect((error as AnalysisClientError).retryAfterMilliseconds).toBeLessThanOrEqual(60_000);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("aborts an exponential-backoff wait without issuing another request", async () => {
    const fetchMock = vi.fn(async () => json({ code: "NOT_READY" }, 503));
    const client = createAnalysisClient({
      baseUrl: "https://compute.example",
      fetch: fetchMock as unknown as typeof fetch,
      retryBaseDelayMilliseconds: 10_000,
      retryMaximumDelayMilliseconds: 10_000,
      retryTotalTimeoutMilliseconds: 20_000,
    });
    const controller = new AbortController();
    const outcome = client.getJob(reference(), controller.signal).then(
      (value) => value,
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort(new DOMException("User cancelled", "AbortError"));

    await expect(outcome).resolves.toEqual(
      expect.objectContaining<Partial<AnalysisClientError>>({ code: "ABORTED" }),
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("aborts an established SSE read instead of leaving the page-session observer pending", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start() {
        // Intentionally stay open until the consumer aborts the observation.
      },
    });
    const fetchMock = vi.fn(async () => new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    const client = createAnalysisClient({
      baseUrl: "https://compute.example",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const controller = new AbortController();
    const outcome = (async () => {
      for await (const _event of client.events(reference(), controller.signal)) {
        // The fixture never emits an event.
      }
    })().then(
      () => null,
      (error: unknown) => error,
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort(new DOMException("User cancelled", "AbortError"));

    await expect(outcome).resolves.toEqual(
      expect.objectContaining<Partial<AnalysisClientError>>({ code: "ABORTED" }),
    );
  });

  it("keeps a successful JSON body inside the attempt timeout and retries an interrupted read", async () => {
    const hangingBody = new ReadableStream<Uint8Array>({
      start() {
        // The request attempt deadline must cancel this otherwise-open body.
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(hangingBody, {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(json(status()));
    const client = createAnalysisClient({
      baseUrl: "https://compute.example",
      fetch: fetchMock as unknown as typeof fetch,
      requestTimeoutMilliseconds: 5,
      retryBaseDelayMilliseconds: 1,
      retryMaximumDelayMilliseconds: 1,
      retryTotalTimeoutMilliseconds: 100,
    });

    await expect(client.getJob(reference())).resolves.toMatchObject({ state: "QUEUED" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts while consuming a successful JSON body", async () => {
    const hangingBody = new ReadableStream<Uint8Array>({
      start() {
        // The caller abort must cancel this otherwise-open body.
      },
    });
    const fetchMock = vi.fn(async () => new Response(hangingBody, {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const client = createAnalysisClient({
      baseUrl: "https://compute.example",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const controller = new AbortController();
    const outcome = client.getJob(reference(), controller.signal).then(
      () => null,
      (error: unknown) => error,
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort(new DOMException("User cancelled", "AbortError"));

    await expect(outcome).resolves.toEqual(
      expect.objectContaining<Partial<AnalysisClientError>>({ code: "ABORTED" }),
    );
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
