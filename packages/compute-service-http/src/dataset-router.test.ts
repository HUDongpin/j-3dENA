import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ANALYSIS_CONTRACT_VERSION_V1,
  analyzeRows,
  hashAnalysisValueV1,
  type AnalysisExecutionSourceResultV2,
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
import { createBrowserPreflightReceipt } from "@3dena/dataset-workflow";

import {
  HmacComputeHttpCapabilityCodec,
  InMemoryComputeHttpEventBroker,
  InMemoryComputeHttpJobRepository,
  InMemoryComputeHttpObjectUrlIssuer,
  SequenceComputeHttpIdFactory,
  StaticComputeHttpReadinessProbe,
} from "./in-memory";
import { InMemoryComputeHttpDatasetWorkflowService } from "./dataset-in-memory";
import { ComputeV1HttpRouter } from "./router";

const ORIGIN = "https://app.example";
const BASE = "https://compute.example";
const NOW = Date.parse("2026-08-21T00:00:00.000Z");

function requestHeaders(
  capability?: string,
  idempotencyKey?: string,
  contentType = "application/json",
): Headers {
  const headers = new Headers({
    origin: ORIGIN,
    "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
    "content-type": contentType,
  });
  if (capability !== undefined) headers.set("authorization", `Bearer ${capability}`);
  if (idempotencyKey !== undefined) headers.set("idempotency-key", idempotencyKey);
  return headers;
}

function harness() {
  const objectStore = new InMemoryComputeObjectStore();
  const clock = new ManualComputeClock(NOW);
  const codec = new HmacComputeHttpCapabilityCodec("dataset-router-test-secret-that-is-long-enough");
  const core = new ComputeServiceCore({
    repository: new InMemoryComputeTaskRepository(),
    objectStore,
    processSupervisor: new InMemoryComputeProcessSupervisor(),
    auditSink: new InMemoryComputeAuditSink(),
    clock,
    idFactory: new SequenceComputeIdFactory(),
    maxConcurrency: 1,
  });
  const datasetWorkflow = new InMemoryComputeHttpDatasetWorkflowService({
    objectStore,
    capabilityCodec: codec,
    clock,
  });
  const sourceResults = new Map<string, AnalysisExecutionSourceResultV2>();
  const sourceBindingOverrides: Record<string, unknown> = {};
  const repository = new InMemoryComputeHttpJobRepository();
  const router = new ComputeV1HttpRouter({
    core,
    infrastructure: {
      repository,
      objectStore,
      clock,
      idFactory: new SequenceComputeHttpIdFactory(),
      capabilityCodec: codec,
      objectUrls: new InMemoryComputeHttpObjectUrlIssuer(),
      events: new InMemoryComputeHttpEventBroker(),
      readiness: new StaticComputeHttpReadinessProbe(true),
      rateLimiter: { consume: async () => ({ allowed: true, retryAfterSeconds: 1 }) },
      datasetWorkflow,
      sourceResults: {
        resolve: async (input) => {
          const source = sourceResults.get(input.sourceResultHash);
          return source === undefined ? null : {
            source,
            buildId: input.requiredBuildId,
            publishedAtMs: NOW - 1_000,
            expiresAtMs: NOW + 60 * 60_000,
            ...sourceBindingOverrides,
            owner: {
              contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
              datasetHash: input.activatedDatasetSha256,
              specHash: "6".repeat(64),
              runId: "source-run",
              taskId: "source-task",
              ...((sourceBindingOverrides.owner ?? {}) as object),
            },
          };
        },
      },
    },
    allowedOrigins: [ORIGIN],
    buildIdentity: {
      approvalManifestSha256: "9".repeat(64),
      releaseId: "release-dataset-test",
      gitCommit: "8".repeat(40),
      flyImageDigest: `sha256:${"7".repeat(64)}`,
      flyBuildId: "dataset-router-build",
      contractVersions: ["3dena.compute-dataset-http.v1"],
    },
  });
  return { router, repository, objectStore, core, sourceResults, sourceBindingOverrides };
}

async function json(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  return body as Record<string, any>;
}

describe("Compute dataset HTTP workflow", () => {
  it("closes upload -> inventory -> selection -> mapping -> preview -> activation -> job binding", async () => {
    const {
      router, repository, objectStore, core, sourceResults, sourceBindingOverrides,
    } = harness();
    const bytes = new TextEncoder().encode(
      "participant,group,conversation,A,B,C\n" +
      "p1,g1,c1,1,0,1\n" +
      "p2,g2,c2,0,1,1\n",
    );
    const preflight = await createBrowserPreflightReceipt({
      schemaVersion: "3dena.browser-preflight-input.v1",
      declaredExtension: ".csv",
      bytes,
    });
    const created = await json(await router.handle(new Request(`${BASE}/v1/datasets`, {
      method: "POST",
      headers: requestHeaders(undefined, "dataset-create-0001"),
      body: JSON.stringify({
        schemaVersion: "3dena.create-compute-dataset-request.v1",
        preflight,
        processingPolicyConfirmed: true,
      }),
    })));
    expect(created).toMatchObject({
      schemaVersion: "3dena.compute-dataset-capability.v1",
      generation: 1,
    });

    const inventory = await json(await router.handle(new Request(created.contentUrl, {
      method: "PUT",
      headers: requestHeaders(created.capabilityToken, "dataset-content-0001", "application/octet-stream"),
      body: bytes,
    })));
    expect(inventory).toMatchObject({
      schemaVersion: "3dena.inspected-dataset-candidate.v1",
      inventory: { visibleSelectableWorksheetCount: 1 },
    });

    const datasetBase = `${BASE}/v1/datasets/${created.datasetId}`;
    const selected = await json(await router.handle(new Request(`${datasetBase}/selection`, {
      method: "POST",
      headers: requestHeaders(created.capabilityToken, "dataset-select-0001"),
      body: JSON.stringify({
        schemaVersion: "3dena.select-compute-dataset-worksheet-request.v1",
        selection: null,
      }),
    })));
    expect(selected.headers).toEqual(["participant", "group", "conversation", "A", "B", "C"]);

    const columns = selected.headers.map((header: string, index: number) => ({
      index,
      header,
      roles:
        header === "participant" ? ["unit"] :
        header === "group" ? ["unit", "group"] :
        header === "conversation" ? ["conversation"] : ["code"],
    }));
    const mapping = await json(await router.handle(new Request(`${datasetBase}/mapping`, {
      method: "PUT",
      headers: requestHeaders(created.capabilityToken, "dataset-mapping-0001"),
      body: JSON.stringify({
        schemaVersion: "3dena.put-compute-dataset-mapping-request.v1",
        parsedIdentity: selected.parsedIdentity,
        mapping: { schemaVersion: "3dena.dataset-role-mapping.v1", columns },
      }),
    })));
    expect(mapping.mappingSha256).toMatch(/^[a-f0-9]{64}$/u);

    const preview = await json(await router.handle(new Request(`${datasetBase}/preview`, {
      method: "POST",
      headers: requestHeaders(created.capabilityToken, "dataset-preview-0001"),
      body: JSON.stringify({
        schemaVersion: "3dena.preview-compute-dataset-request.v1",
        mappingSha256: mapping.mappingSha256,
      }),
    })));
    expect(preview).toMatchObject({
      schemaVersion: "3dena.compute-dataset-preview-result.v1",
      candidate: { activatable: true },
      preview: { previewRowCount: 2 },
    });

    const activation = await json(await router.handle(new Request(`${datasetBase}/activate`, {
      method: "POST",
      headers: requestHeaders(created.capabilityToken, "dataset-activate-0001"),
      body: JSON.stringify({
        schemaVersion: "3dena.activate-compute-dataset-request.v1",
        activationIdentity: preview.activationIdentity,
        expectedActiveActivationIdentity: null,
      }),
    })));
    expect(activation).toMatchObject({
      schemaVersion: "3dena.compute-dataset-activation-receipt.v1",
      datasetId: created.datasetId,
    });
    expect(activation.activationReceiptSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(activation.datasetReceipt.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));

    const job = await json(await router.handle(new Request(`${BASE}/v1/jobs`, {
      method: "POST",
      headers: requestHeaders(created.capabilityToken, "activated-job-0001"),
      body: JSON.stringify({
        schemaVersion: "3dena.create-activated-job-request.v1",
        activationReceipt: activation,
        processingPolicyConfirmed: true,
      }),
    })));
    expect(job).toMatchObject({
      schemaVersion: "3dena.job-capability.v1",
      uploadUrl: created.contentUrl,
    });

    const execute = await json(await router.handle(new Request(
      `${BASE}/v1/jobs/${job.jobId}/execute`,
      {
        method: "POST",
        headers: requestHeaders(job.capabilityToken, "activated-execute-0001"),
        body: JSON.stringify({
          schemaVersion: "3dena.execute-activated-job-request.v1",
          task: {
            schemaVersion: "3dena.activated-ena-model-task-spec.v1",
            kind: "ena-model",
            runId: "web-run-1",
            deadlineEpochMilliseconds: NOW + 30 * 60_000,
            spec: {
              schemaVersion: "3dena.analysis-spec.v1",
              model: "EndPoint",
              window: "MovingStanzaWindow",
              weightBy: "binary",
              windowSizeBack: 4,
              windowSizeForward: 0,
              centerAlignToOrigin: true,
              cohortPolicy: "available",
            },
          },
        }),
      },
    )));
    expect(execute).toMatchObject({ state: "QUEUED", owner: { taskId: job.jobId } });
    const jobRecord = await repository.get(job.jobId);
    expect(jobRecord?.executionObjectKey).toBeTruthy();
    const storedBytes = await objectStore.get(jobRecord!.executionObjectKey!);
    const stored = JSON.parse(new TextDecoder().decode(storedBytes!));
    expect(stored).toMatchObject({
      version: "3dena.compute-scientific-stored-input.v1",
      dataset: {
        schemaVersion: "3dena.analysis-execution-dataset.v2",
        receipt: { sha256: preflight.sha256 },
      },
      task: {
        kind: "ena-model",
        owner: { datasetHash: preflight.sha256, taskId: job.jobId },
        input: {
          rows: [
            { participant: "p1", group: "g1", conversation: "c1", A: 1, B: 0, C: 1 },
            { participant: "p2", group: "g2", conversation: "c2", A: 0, B: 1, C: 1 },
          ],
          mapping: {
            units: ["participant", "group"],
            conversation: ["conversation"],
            codes: ["A", "B", "C"],
          },
        },
      },
    });
    expect(JSON.stringify(stored)).not.toContain("datasetObject");
    expect(JSON.stringify(stored)).not.toContain("datasetReceipt\":");
    const coreTask = await core.getTask(job.jobId);
    expect(coreTask?.request.input).toMatchObject({
      key: jobRecord?.executionObjectKey,
      sha256: createHash("sha256").update(storedBytes!).digest("hex"),
    });

    const rawResult = analyzeRows({
      rows: [
        { participant: "p1", group: "g1", conversation: "c1", A: 1, B: 0, C: 1 },
        { participant: "p2", group: "g2", conversation: "c2", A: 0, B: 1, C: 1 },
      ],
      mapping: {
        units: ["participant", "group"],
        conversation: ["conversation"],
        codes: ["A", "B", "C"],
      },
      config: { model: "EndPoint" },
    });
    const sourceResultHash = await hashAnalysisValueV1(rawResult);
    sourceResults.set(sourceResultHash, {
      sourceKind: "raw-jena",
      hash: sourceResultHash,
      result: rawResult,
    });
    const derivedSpecs = [
      {
        schemaVersion: "3dena.activated-network-comparison-task-spec.v1",
        kind: "network-comparison",
        sourceResultHash,
        groups: ["group-a", "group-b"],
      },
      {
        schemaVersion: "3dena.activated-change-network-task-spec.v1",
        kind: "change-network",
        sourceResultHash,
        field: "group",
        level: "g1",
      },
      {
        schemaVersion: "3dena.activated-statistics-task-spec.v1",
        kind: "statistics",
        sourceResultHash,
        design: "independent",
        groups: ["group-a", "group-b"],
        dimensions: ["SVD1"],
        alternative: "two-sided",
        adjustment: "holm",
        samePhysicalEntityConfirmed: false,
      },
      {
        schemaVersion: "3dena.activated-trajectory-task-spec.v1",
        kind: "trajectory",
        sourceResultHash,
        group: "group-a",
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
        sourceResultHash,
        design: "independent",
        groups: ["group-a", "group-b"],
        samePhysicalEntityConfirmed: false,
      },
      {
        schemaVersion: "3dena.activated-bootstrap-task-spec.v1",
        kind: "bootstrap",
        sourceResultHash,
        group: "group-a",
        replicates: 200,
        confidenceLevel: 0.95,
        seed: 42,
        interval: "pointwise-percentile-type7",
        rotationPolicy: "fixed-preprojected",
      },
    ] as const;
    for (const [index, scientific] of derivedSpecs.entries()) {
      const derivedJob = await json(await router.handle(new Request(`${BASE}/v1/jobs`, {
        method: "POST",
        headers: requestHeaders(created.capabilityToken, `derived-create-000${index}`),
        body: JSON.stringify({
          schemaVersion: "3dena.create-activated-job-request.v1",
          activationReceipt: activation,
          processingPolicyConfirmed: true,
        }),
      })));
      const derivedStatus = await json(await router.handle(new Request(
        `${BASE}/v1/jobs/${derivedJob.jobId}/execute`,
        {
          method: "POST",
          headers: requestHeaders(derivedJob.capabilityToken, `derived-execute-000${index}`),
          body: JSON.stringify({
            schemaVersion: "3dena.execute-activated-job-request.v1",
            task: {
              ...scientific,
              runId: `derived-run-${index}`,
              deadlineEpochMilliseconds: NOW + 30 * 60_000,
            },
          }),
        },
      )));
      expect(derivedStatus).toMatchObject({ state: "QUEUED" });
      const derivedRecord = await repository.get(derivedJob.jobId);
      const derivedBytes = await objectStore.get(derivedRecord!.executionObjectKey!);
      const derivedStored = JSON.parse(new TextDecoder().decode(derivedBytes!));
      expect(derivedStored).toMatchObject({
        version: "3dena.compute-scientific-stored-input.v1",
        dataset: {
          schemaVersion: "3dena.analysis-execution-dataset.v2",
          sourceResult: { sourceKind: "raw-jena", hash: sourceResultHash },
        },
        task: { kind: scientific.kind, sourceResultHash, owner: { taskId: derivedJob.jobId } },
      });
    }

    const missingSourceJob = await json(await router.handle(new Request(`${BASE}/v1/jobs`, {
      method: "POST",
      headers: requestHeaders(created.capabilityToken, "missing-source-create"),
      body: JSON.stringify({
        schemaVersion: "3dena.create-activated-job-request.v1",
        activationReceipt: activation,
        processingPolicyConfirmed: true,
      }),
    })));
    const missingSource = await router.handle(new Request(
      `${BASE}/v1/jobs/${missingSourceJob.jobId}/execute`,
      {
        method: "POST",
        headers: requestHeaders(missingSourceJob.capabilityToken, "missing-source-execute"),
        body: JSON.stringify({
          schemaVersion: "3dena.execute-activated-job-request.v1",
          task: {
            schemaVersion: "3dena.activated-network-comparison-task-spec.v1",
            kind: "network-comparison",
            runId: "missing-source-run",
            deadlineEpochMilliseconds: NOW + 30 * 60_000,
            sourceResultHash: "f".repeat(64),
            groups: ["group-a", "group-b"],
          },
        }),
      },
    ));
    expect(missingSource.status).toBe(409);
    await expect(missingSource.json()).resolves.toMatchObject({ code: "DATASET_RECEIPT_MISMATCH" });

    const expectRejectedSourceBinding = async (
      label: string,
      overrides: Record<string, unknown>,
    ): Promise<void> => {
      for (const key of Object.keys(sourceBindingOverrides)) delete sourceBindingOverrides[key];
      Object.assign(sourceBindingOverrides, overrides);
      const rejectedJob = await json(await router.handle(new Request(`${BASE}/v1/jobs`, {
        method: "POST",
        headers: requestHeaders(created.capabilityToken, `${label}-create-key`),
        body: JSON.stringify({
          schemaVersion: "3dena.create-activated-job-request.v1",
          activationReceipt: activation,
          processingPolicyConfirmed: true,
        }),
      })));
      const response = await router.handle(new Request(
        `${BASE}/v1/jobs/${rejectedJob.jobId}/execute`,
        {
          method: "POST",
          headers: requestHeaders(rejectedJob.capabilityToken, `${label}-execute-key`),
          body: JSON.stringify({
            schemaVersion: "3dena.execute-activated-job-request.v1",
            task: {
              ...derivedSpecs[0],
              runId: `${label}-run`,
              deadlineEpochMilliseconds: NOW + 30 * 60_000,
            },
          }),
        },
      ));
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ code: "DATASET_RECEIPT_MISMATCH" });
    };
    await expectRejectedSourceBinding("wrong-owner", {
      owner: { datasetHash: "e".repeat(64) },
    });
    await expectRejectedSourceBinding("wrong-build", { buildId: "another-fly-build" });
    await expectRejectedSourceBinding("stale-source", { expiresAtMs: NOW });
    for (const key of Object.keys(sourceBindingOverrides)) delete sourceBindingOverrides[key];

    const oldCreate = await router.handle(new Request(`${BASE}/v1/jobs`, {
      method: "POST",
      headers: requestHeaders(created.capabilityToken, "legacy-job-create-1"),
      body: JSON.stringify({
        schemaVersion: "3dena.create-job-request.v1",
        dataset: {
          sha256: preflight.sha256,
          byteLength: preflight.byteLength,
          format: "csv",
        },
        processingPolicyConfirmed: true,
      }),
    }));
    expect(oldCreate.status).toBe(400);
    await expect(oldCreate.json()).resolves.toMatchObject({ code: "INVALID_REQUEST" });
  });
});
