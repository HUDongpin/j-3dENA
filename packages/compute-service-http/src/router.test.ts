import { createHash } from "node:crypto";

import {
  ANALYSIS_CONTRACT_VERSION_V1,
  ANALYSIS_TASK_VERSION_V1,
  DATASET_RECEIPT_VERSION_V1,
  createAnalysisClient,
  type AnalysisJobReferenceV1,
  type AnalysisTaskV1,
  type DatasetReceiptV1,
} from "@3dena/analysis";
import {
  ComputeServiceCore,
  InMemoryComputeAuditSink,
  InMemoryComputeObjectStore,
  InMemoryComputeProcessSupervisor,
  InMemoryComputeTaskRepository,
  ManualComputeClock,
  SequenceComputeIdFactory,
} from "@3dena/compute-service-core";
import { describe, expect, it } from "vitest";

import {
  HmacComputeHttpCapabilityCodec,
  InMemoryComputeHttpEventBroker,
  InMemoryComputeHttpJobRepository,
  InMemoryComputeHttpObjectUrlIssuer,
  SequenceComputeHttpIdFactory,
  StaticComputeHttpReadinessProbe,
} from "./in-memory";
import { ComputeV1HttpRouter } from "./router";
import type { ComputeHttpRateLimiter } from "./interfaces";

const NOW = Date.UTC(2026, 7, 21, 8, 0, 0);
const ORIGIN = "https://app.example";
const SECRET = "test-only-capability-secret-with-at-least-32-bytes";
const SPEC_HASH = "b".repeat(64);

interface Harness {
  readonly router: ComputeV1HttpRouter;
  readonly core: ComputeServiceCore;
  readonly objectStore: InMemoryComputeObjectStore;
  readonly supervisor: InMemoryComputeProcessSupervisor;
  readonly clock: ManualComputeClock;
  readonly httpRepository: InMemoryComputeHttpJobRepository;
  readonly events: InMemoryComputeHttpEventBroker;
  readonly urls: InMemoryComputeHttpObjectUrlIssuer;
  readonly readiness: StaticComputeHttpReadinessProbe;
}

function harness(
  rateLimiter: ComputeHttpRateLimiter = {
    consume: async () => ({ allowed: true, retryAfterSeconds: 1 }),
  },
): Harness {
  const objectStore = new InMemoryComputeObjectStore();
  const supervisor = new InMemoryComputeProcessSupervisor();
  const clock = new ManualComputeClock(NOW);
  const core = new ComputeServiceCore({
    repository: new InMemoryComputeTaskRepository(),
    objectStore,
    processSupervisor: supervisor,
    auditSink: new InMemoryComputeAuditSink(),
    clock,
    idFactory: new SequenceComputeIdFactory(),
    maxConcurrency: 2,
    maxLeaseDurationMs: 60_000,
  });
  const httpRepository = new InMemoryComputeHttpJobRepository();
  const events = new InMemoryComputeHttpEventBroker();
  const urls = new InMemoryComputeHttpObjectUrlIssuer(
    "https://objects.example/private/",
  );
  const readiness = new StaticComputeHttpReadinessProbe(true);
  const router = new ComputeV1HttpRouter({
    core,
    infrastructure: {
      repository: httpRepository,
      objectStore,
      clock,
      idFactory: new SequenceComputeHttpIdFactory(),
      capabilityCodec: new HmacComputeHttpCapabilityCodec(SECRET),
      objectUrls: urls,
      events,
      readiness,
      rateLimiter,
    },
    allowedOrigins: [ORIGIN, "http://localhost:3000"],
    buildIdentity: {
      approvalManifestSha256: "9".repeat(64),
      releaseId: "release-test",
      gitCommit: "8".repeat(40),
      flyImageDigest: `sha256:${"7".repeat(64)}`,
      flyBuildId: "compute-http-test-build",
      contractVersions: ["3dena.test-contract.v1"],
    },
    jobTtlMs: 60 * 60_000,
    maxTaskRuntimeMs: 30 * 60_000,
  });
  return {
    router,
    core,
    objectStore,
    supervisor,
    clock,
    httpRepository,
    events,
    urls,
    readiness,
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function datasetReceipt(bytes: Uint8Array): DatasetReceiptV1 {
  const digest = sha256(bytes);
  return {
    schemaVersion: DATASET_RECEIPT_VERSION_V1,
    sha256: digest,
    byteLength: bytes.byteLength,
    format: "csv",
    sheet: { index: 0, name: "CSV" },
    rows: 2,
    columns: 4,
    schema: {
      schemaVersion: "3dena.dataset-schema.v1",
      headers: ["participant", "conversation", "A", "B"],
      columns: [
        { name: "participant", inferredType: "string", roles: ["unit"] },
        {
          name: "conversation",
          inferredType: "string",
          roles: ["conversation"],
        },
        { name: "A", inferredType: "number", roles: ["code"] },
        { name: "B", inferredType: "number", roles: ["code"] },
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
    activationIdentity: `dataset:${digest}`,
  };
}

function analysisTask(
  receipt: DatasetReceiptV1,
  taskId = "task-1",
): Extract<AnalysisTaskV1, { kind: "network-comparison" }> {
  return {
    schemaVersion: ANALYSIS_TASK_VERSION_V1,
    kind: "network-comparison",
    owner: {
      contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
      datasetHash: receipt.sha256,
      specHash: SPEC_HASH,
      runId: "run-1",
      taskId,
    },
    deadlineEpochMilliseconds: NOW + 10 * 60_000,
    sourceResultHash: "c".repeat(64),
    groups: ["group-a", "group-b"],
  };
}

function fetchFor(router: ComputeV1HttpRouter): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    router.handle(new Request(input, init))) as typeof fetch;
}

function createRequest(bytes: Uint8Array) {
  return {
    schemaVersion: "3dena.create-job-request.v1" as const,
    dataset: {
      sha256: sha256(bytes),
      byteLength: bytes.byteLength,
      format: "csv" as const,
    },
    processingPolicyConfirmed: true as const,
  };
}

async function createAndUpload(target: Harness, bytes: Uint8Array) {
  const client = createAnalysisClient({
    baseUrl: "https://compute.example",
    fetch: fetchFor(target.router),
  });
  const capability = await client.createJob(
    createRequest(bytes),
    "create-job-0001",
  );
  await target.objectStore.putImmutable(
    target.urls.uploadObjectKey(capability.jobId),
    bytes,
  );
  return { client, capability };
}

describe("ComputeV1HttpRouter", () => {
  it("rate-limits max+1 before parsing or creating a job", async () => {
    let count = 0;
    let deny = true;
    const limiter: ComputeHttpRateLimiter = {
      consume: async () => {
        count += 1;
        return { allowed: !deny || count <= 1, retryAfterSeconds: 17 };
      },
    };
    const target = harness(limiter);
    const bytes = new TextEncoder().encode("a,b,c\n1,1,1\n");
    const first = await target.router.handle(new Request("https://compute.example/v1/jobs", {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        "idempotency-key": "rate-first-key",
        "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
      },
      body: JSON.stringify(createRequest(bytes)),
    }));
    expect(first.status).toBe(201);
    const denied = await target.router.handle(new Request("https://compute.example/v1/jobs", {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        "idempotency-key": "rate-denied-key",
        "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
      },
      body: "not-json-and-must-not-be-parsed",
    }));
    expect(denied.status).toBe(429);
    expect(denied.headers.get("retry-after")).toBe("17");
    await expect(denied.json()).resolves.toMatchObject({ code: "RATE_LIMITED" });
    deny = false;
    const third = await target.router.handle(new Request("https://compute.example/v1/jobs", {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        "idempotency-key": "rate-third-key",
        "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
      },
      body: JSON.stringify(createRequest(bytes)),
    }));
    expect((await third.json()) as { jobId: string }).toMatchObject({ jobId: "job-2" });
  });

  it("runs the public client contract through create, upload, queue, result, SSE, and delete", async () => {
    const target = harness();
    const dataset = new TextEncoder().encode("participant,conversation,A,B\np1,c1,1,1\n");
    const receipt = datasetReceipt(dataset);
    const { client, capability } = await createAndUpload(target, dataset);
    const reference: AnalysisJobReferenceV1 = capability;

    const uploaded = await client.getJob(reference);
    expect(uploaded).toMatchObject({
      jobId: capability.jobId,
      state: "UPLOADED",
      owner: null,
      resultAvailable: false,
    });
    const queued = await client.executeJob(
      reference,
      {
        schemaVersion: "3dena.execute-job-request.v1",
        datasetReceipt: receipt,
        task: analysisTask(receipt),
      },
      "execute-job-0001",
    );
    expect(queued).toMatchObject({
      state: "QUEUED",
      owner: analysisTask(receipt).owner,
    });
    await expect(
      client.executeJob(
        reference,
        {
          schemaVersion: "3dena.execute-job-request.v1",
          datasetReceipt: receipt,
          task: {
            ...analysisTask(receipt),
            groups: ["group-a", "group-c"],
          },
        },
        "execute-job-0001",
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });

    const lease = await target.core.claimTask(capability.jobId, {
      leaseId: "lease-1",
      holderId: "worker-1",
      durationMs: 30_000,
    });
    const running = await target.core.executeTask(capability.jobId, lease);
    const resultBytes = new TextEncoder().encode('{"scientificResult":true}');
    const resultKey = running.execution?.resultObjectKey;
    const childId = running.execution?.childId;
    if (resultKey === undefined || childId === undefined) {
      throw new Error("Expected an executing in-memory child.");
    }
    const result = (
      await target.objectStore.putImmutable(resultKey, resultBytes)
    ).descriptor;
    await target.core.publishResult(capability.jobId, lease, result);
    target.supervisor.observeTermination(childId, {
      kind: "completed",
      observedAtMs: target.clock.now(),
      exitCode: 0,
      signal: null,
    });
    await target.core.settleBackground();

    const succeeded = await client.getJob(reference);
    expect(succeeded).toMatchObject({
      state: "SUCCEEDED",
      resultAvailable: true,
      errorCode: null,
    });
    expect(target.objectStore.keys()).not.toContain(
      target.urls.uploadObjectKey(capability.jobId),
    );
    expect(
      target.objectStore.keys().some((key) => key.startsWith("compute-inputs/")),
    ).toBe(false);

    const directResult = await target.router.handle(
      new Request(
        `https://compute.example/v1/jobs/${capability.jobId}/result`,
        {
          headers: {
            authorization: `Bearer ${capability.capabilityToken}`,
            "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
          },
        },
      ),
    );
    expect(directResult.headers.get("x-3dena-result-sha256")).toBe(
      sha256(resultBytes),
    );
    const resultReference = await client.getResult(reference);
    expect(resultReference).toMatchObject({
      jobId: capability.jobId,
      sha256: sha256(resultBytes),
      byteLength: resultBytes.byteLength,
      exportUrl: null,
    });
    expect(resultReference.resultUrl).not.toContain(capability.capabilityToken);

    const eventStates: string[] = [];
    for await (const event of client.events(reference)) {
      eventStates.push(event.state);
    }
    expect(eventStates).toEqual([
      "CREATED",
      "UPLOADED",
      "QUEUED",
      "SUCCEEDED",
    ]);
    expect(JSON.stringify(target.events.events(capability.jobId))).not.toContain(
      capability.capabilityToken,
    );

    const deletion = await client.deleteJob(reference, "delete-job-0001");
    expect(deletion).toEqual({
      schemaVersion: "3dena.job-deletion-receipt.v1",
      jobId: capability.jobId,
      cancelled: false,
      inputDeleted: true,
      resultDeleted: true,
      deletedAt: new Date(NOW).toISOString(),
    });
    expect(target.objectStore.keys()).not.toContain(resultKey);

    target.clock.advance(1_000);
    await expect(
      client.deleteJob(reference, "delete-job-0001"),
    ).resolves.toEqual(deletion);
  });

  it("stores only capability/idempotency digests and returns non-reflective errors", async () => {
    const target = harness();
    const dataset = new TextEncoder().encode("a,b,c\n1,1,1\n");
    const body = createRequest(dataset);
    const request = (): Request =>
      new Request("https://compute.example/v1/jobs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "private-create-key",
          "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
        },
        body: JSON.stringify(body),
      });
    const first = await target.router.handle(request());
    expect(first.status).toBe(201);
    const capability = (await first.json()) as {
      jobId: string;
      capabilityToken: string;
    };
    const replay = await target.router.handle(request());
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject(capability);

    const stored = await target.httpRepository.get(capability.jobId);
    const storedJson = JSON.stringify(stored);
    expect(storedJson).not.toContain(capability.capabilityToken);
    expect(storedJson).not.toContain("private-create-key");

    const unauthorized = await target.router.handle(
      new Request(`https://compute.example/v1/jobs/${capability.jobId}`, {
        headers: {
          authorization: "Bearer raw-participant-p1-private-token",
          "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
        },
      }),
    );
    expect(unauthorized.status).toBe(401);
    const unauthorizedText = await unauthorized.text();
    expect(JSON.parse(unauthorizedText)).toEqual({
      code: "UNAUTHORIZED",
      requestId: expect.any(String),
    });
    expect(unauthorizedText).not.toContain("participant");

    const corsError = await target.router.handle(
      new Request(`https://compute.example/v1/jobs/${capability.jobId}`, {
        headers: {
          origin: ORIGIN,
          authorization: "Bearer raw-participant-p1-private-token",
          "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
        },
      }),
    );
    expect(corsError.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(await corsError.text()).not.toContain("raw-participant");

    const conflictBody = {
      ...body,
      dataset: { ...body.dataset, format: "xlsx" },
    };
    const conflict = await target.router.handle(
      new Request("https://compute.example/v1/jobs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "private-create-key",
          "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
        },
        body: JSON.stringify(conflictBody),
      }),
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const unknownField = await target.router.handle(
      new Request("https://compute.example/v1/jobs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "unknown-field-key",
          "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
        },
        body: JSON.stringify({ ...body, rawRows: ["private"] }),
      }),
    );
    expect(unknownField.status).toBe(400);
    expect(await unknownField.json()).toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("enforces exact CORS, origin-bound capabilities, preflight, and contract negotiation", async () => {
    const target = harness();
    const preflight = await target.router.handle(
      new Request("https://compute.example/v1/jobs", {
        method: "OPTIONS",
        headers: {
          origin: ORIGIN,
          "access-control-request-method": "POST",
          "access-control-request-headers":
            "content-type, idempotency-key, x-3dena-contract-version",
        },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();

    const denied = await target.router.handle(
      new Request("https://compute.example/healthz", {
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();

    const missingContract = await target.router.handle(
      new Request("https://compute.example/build-info"),
    );
    expect(missingContract.status).toBe(406);

    const bytes = new TextEncoder().encode("a,b,c\n1,1,1\n");
    const create = await target.router.handle(
      new Request("https://compute.example/v1/jobs", {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          "idempotency-key": "origin-create-key",
          "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
        },
        body: JSON.stringify(createRequest(bytes)),
      }),
    );
    const capability = (await create.json()) as {
      jobId: string;
      capabilityToken: string;
    };
    const withoutOrigin = await target.router.handle(
      new Request(`https://compute.example/v1/jobs/${capability.jobId}`, {
        headers: {
          authorization: `Bearer ${capability.capabilityToken}`,
          "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
        },
      }),
    );
    expect(withoutOrigin.status).toBe(401);

    const deleteWithBody = await target.router.handle(
      new Request(`https://compute.example/v1/jobs/${capability.jobId}`, {
        method: "DELETE",
        headers: {
          origin: ORIGIN,
          authorization: `Bearer ${capability.capabilityToken}`,
          "content-type": "application/json",
          "idempotency-key": "delete-with-body",
          "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
        },
        body: "{}",
      }),
    );
    expect(deleteWithBody.status).toBe(400);
    expect(await deleteWithBody.json()).toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("cancels running work, deletes data immediately, and retains capacity until observed exit", async () => {
    const target = harness();
    const dataset = new TextEncoder().encode("participant,conversation,A,B\np1,c1,1,1\n");
    const receipt = datasetReceipt(dataset);
    const { client, capability } = await createAndUpload(target, dataset);
    await client.executeJob(
      capability,
      {
        schemaVersion: "3dena.execute-job-request.v1",
        datasetReceipt: receipt,
        task: analysisTask(receipt, "task-cancel"),
      },
      "execute-cancel-1",
    );
    const lease = await target.core.claimTask(capability.jobId, {
      leaseId: "lease-cancel",
      holderId: "worker-1",
      durationMs: 30_000,
    });
    const running = await target.core.executeTask(capability.jobId, lease);
    const childId = running.execution?.childId;
    if (childId === undefined) throw new Error("Expected running child.");

    const receiptResponse = await client.deleteJob(
      capability,
      "delete-cancel-1",
    );
    expect(receiptResponse).toMatchObject({
      cancelled: true,
      inputDeleted: true,
      resultDeleted: true,
    });
    expect(target.core.capacitySnapshot().occupied).toBe(1);
    expect(target.supervisor.terminationRequests(childId)).toContain("deletion");
    expect(
      target.objectStore.keys().some((key) => key.startsWith("compute-inputs/")),
    ).toBe(false);

    target.supervisor.observeTermination(childId, {
      kind: "terminated",
      observedAtMs: target.clock.now(),
      exitCode: null,
      signal: "SIGTERM",
    });
    await target.core.settleBackground();
    expect(target.core.capacitySnapshot().occupied).toBe(0);
    expect((await target.core.getTask(capability.jobId))?.state).toBe("deleted");
    expect((await target.router.reconcileJob(capability.jobId)).state).toBe(
      "CANCELLED",
    );
  });

  it("reports readiness/build identity and rejects mismatched uploads and deadlines", async () => {
    const target = harness();
    const client = createAnalysisClient({
      baseUrl: "https://compute.example",
      fetch: fetchFor(target.router),
    });
    await expect(client.getBuildInfo()).resolves.toEqual({
      schemaVersion: "3dena.compute-build-info.v1",
      approvalManifestSha256: "9".repeat(64),
      releaseId: "release-test",
      gitCommit: "8".repeat(40),
      flyImageDigest: `sha256:${"7".repeat(64)}`,
      flyBuildId: "compute-http-test-build",
      role: "api",
      contractVersions: [
        "3dena.compute-http.v1",
        ANALYSIS_CONTRACT_VERSION_V1,
        "3dena.test-contract.v1",
      ],
    });
    target.readiness.setReady(false);
    const notReady = await target.router.handle(
      new Request("https://compute.example/readyz"),
    );
    expect(notReady.status).toBe(503);
    expect(await notReady.json()).toMatchObject({ code: "NOT_READY" });

    await expect(
      client.createJob(createRequest(new TextEncoder().encode(
        "participant,conversation,A,B\np1,c1,1,1\n",
      )), "create-not-ready-1"),
    ).rejects.toMatchObject({ code: "NOT_READY", status: 503 });
    target.readiness.setReady(true);
    const ready = await target.router.handle(
      new Request("https://compute.example/readyz"),
    );
    expect(await ready.json()).toMatchObject({
      schemaVersion: "3dena.compute-readiness.v1",
      status: "ready",
      approvalManifestSha256: "9".repeat(64),
      releaseId: "release-test",
      gitCommit: "8".repeat(40),
      flyImageDigest: `sha256:${"7".repeat(64)}`,
      flyBuildId: "compute-http-test-build",
      role: "api",
    });

    const dataset = new TextEncoder().encode("participant,conversation,A,B\np1,c1,1,1\n");
    const receipt = datasetReceipt(dataset);
    const capability = await client.createJob(
      createRequest(dataset),
      "create-mismatch-1",
    );
    await target.objectStore.putImmutable(
      target.urls.uploadObjectKey(capability.jobId),
      new TextEncoder().encode("same-length-wrong-content-xxxxxxxxxxxxxxxxxxx"),
    );
    await expect(
      client.executeJob(
        capability,
        {
          schemaVersion: "3dena.execute-job-request.v1",
          datasetReceipt: receipt,
          task: analysisTask(receipt),
        },
        "execute-mismatch-1",
      ),
    ).rejects.toMatchObject({ code: "DATASET_RECEIPT_MISMATCH", status: 409 });

    const other = harness();
    const created = await createAndUpload(other, dataset);
    const tooLate = {
      ...analysisTask(receipt),
      deadlineEpochMilliseconds: NOW + 31 * 60_000,
    };
    await expect(
      created.client.executeJob(
        created.capability,
        {
          schemaVersion: "3dena.execute-job-request.v1",
          datasetReceipt: receipt,
          task: tooLate,
        },
        "execute-deadline-1",
      ),
    ).rejects.toMatchObject({ code: "DEADLINE_EXCEEDED", status: 400 });
  });
});
