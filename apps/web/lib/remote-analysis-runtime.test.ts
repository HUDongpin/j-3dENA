import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANALYSIS_CONTRACT_VERSION_V1,
  analyzeRows,
  type AnalysisClientV2,
  type AnalysisResultEnvelopeV1,
  type EnaModelTaskV1,
} from "@3dena/analysis";
import {
  RemoteAnalysisRuntimeError,
  cancelRemoteAnalysis,
  deleteRemoteJobData,
  runRemoteAnalysis,
  type RemoteExecutionBinding,
} from "./remote-analysis-runtime";

const DATASET_HASH = "a".repeat(64);
const SPEC_HASH = "b".repeat(64);
const RESULT_HASH = "c".repeat(64);
const approvedRemoteBuild = {
  approvalManifestSha256: "d".repeat(64),
  releaseId: "release-20260821",
  gitCommit: "e".repeat(40),
  webBuildId: "web-build-20260821",
  flyImageDigest: `sha256:${"f".repeat(64)}`,
  flyBuildId: "compute-approved",
} as const;

const input: EnaModelTaskV1["input"] = {
  rows: [
    { Group: "A", Name: "p1", Lesson: "T1", C1: 1, C2: 1, C3: 0 },
    { Group: "A", Name: "p2", Lesson: "T1", C1: 1, C2: 0, C3: 1 },
    { Group: "B", Name: "p3", Lesson: "T1", C1: 0, C2: 1, C3: 1 },
    { Group: "B", Name: "p4", Lesson: "T1", C1: 1, C2: 1, C3: 1 },
  ],
  mapping: {
    units: ["Group", "Name"],
    conversation: ["Lesson"],
    codes: ["C1", "C2", "C3"],
  },
  config: {
    model: "EndPoint",
    window: "MovingStanzaWindow",
    weightBy: "binary",
    windowSizeBack: 4,
    windowSizeForward: 0,
    centerAlignToOrigin: true,
  },
};

const owner = {
  contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
  datasetHash: DATASET_HASH,
  specHash: SPEC_HASH,
  runId: "run-remote-1",
  taskId: "task-remote-1",
} as const;

const binding: RemoteExecutionBinding = {
  reference: { jobId: "job-remote-1", capabilityToken: "capability-remote-1" },
  datasetReceipt: {
    schemaVersion: "3dena.dataset-receipt.v1",
    sha256: DATASET_HASH,
    byteLength: 123,
    format: "csv",
    sheet: null,
    rows: 4,
    columns: 6,
    schema: {
      schemaVersion: "3dena.dataset-schema.v1",
      headers: ["Group", "Name", "Lesson", "C1", "C2", "C3"],
      columns: [
        { name: "Group", inferredType: "string", roles: ["unit", "group"] },
        { name: "Name", inferredType: "string", roles: ["unit"] },
        { name: "Lesson", inferredType: "string", roles: ["conversation"] },
        { name: "C1", inferredType: "number", roles: ["code"] },
        { name: "C2", inferredType: "number", roles: ["code"] },
        { name: "C3", inferredType: "number", roles: ["code"] },
      ],
    },
    limits: {
      schemaVersion: "3dena.dataset-limits.v1",
      maxFileBytes: 1024,
      maxWorksheets: 1,
      maxRows: 100,
      maxColumns: 20,
      maxCells: 2_000,
    },
    warnings: [],
    activationIdentity: "activation:remote-1",
  },
  taskKind: "ena-model",
  runId: owner.runId,
  start: vi.fn(async () => undefined),
};

function artifactBytes(): Uint8Array<ArrayBuffer> {
  const result = analyzeRows(input);
  const envelope: AnalysisResultEnvelopeV1<typeof result> = {
    schemaVersion: "3dena.analysis-result-envelope.v1",
    owner,
    taskKind: "ena-model",
    result,
    diagnostics: [],
    evidence: {
      schemaVersion: "3dena.evidence-stamp.v1",
      scope: "feature",
      status: "IMPLEMENTED_UNVERIFIED",
      datasetHash: DATASET_HASH,
      specHash: SPEC_HASH,
      buildId: "compute-approved",
      approvedForParity: false,
    },
    provenance: {
      schemaVersion: "3dena.provenance-manifest.v1",
      datasetHash: DATASET_HASH,
      specHash: SPEC_HASH,
      resultHash: RESULT_HASH,
      adapterVersion: "test-adapter",
      jenaPackage: "jena-js",
      jenaVersion: "0.6.3",
      jenaCommit: "57b7794ec3873c251c33086454523e5a3949836f",
      sourceKind: "raw-jena",
      jenaExecuted: true,
      sdkPackage: "@3dena/analysis",
      sdkVersion: "0.1.0",
      appVersion: "0.1.0",
      contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
      buildId: "compute-approved",
      seed: null,
      toleranceContract: null,
      schemaVersions: [
        "3dena.analysis-task.v1",
        "3dena.analysis-result.v1",
        "3dena.analysis-result-envelope.v1",
      ],
      generatedAt: new Date().toISOString(),
    },
  };
  return new TextEncoder().encode(JSON.stringify({
    version: "3dena.compute-scientific-result-artifact.v1",
    owner,
    taskKind: "ena-model",
    envelope,
  }));
}

function clientFor(bytes: Uint8Array<ArrayBuffer>): AnalysisClientV2 {
  const digest = createHash("sha256").update(bytes).digest("hex");
  let statusReadCount = 0;
  return {
    createJob: vi.fn(),
    executeJob: vi.fn(),
    getJob: vi.fn(async () => {
      statusReadCount += 1;
      return {
        schemaVersion: "3dena.job-status.v1" as const,
        jobId: binding.reference.jobId,
        state: statusReadCount === 1 ? "QUEUED" as const : "SUCCEEDED" as const,
        owner,
        progress: statusReadCount === 1
          ? { phase: "queued", completed: 0, total: 2 }
          : { phase: "complete", completed: 2, total: 2 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        resultAvailable: statusReadCount !== 1,
        errorCode: null,
      };
    }),
    events: async function* () {
      yield {
        schemaVersion: "3dena.job-event.v1",
        sequence: 1,
        state: "RUNNING" as const,
        phase: "modeling",
        completed: 1,
        total: 2,
        emittedAt: new Date().toISOString(),
      };
      yield {
        schemaVersion: "3dena.job-event.v1",
        sequence: 2,
        state: "SUCCEEDED" as const,
        phase: "complete",
        completed: 2,
        total: 2,
        emittedAt: new Date().toISOString(),
      };
    },
    getResult: vi.fn(async () => ({
      schemaVersion: "3dena.job-result-reference.v1",
      jobId: binding.reference.jobId,
      sha256: digest,
      byteLength: bytes.byteLength,
      resultUrl: "https://objects.example.test/result.json",
      exportUrl: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } as const)),
    deleteJob: vi.fn(async () => ({
      schemaVersion: "3dena.job-deletion-receipt.v1",
      jobId: binding.reference.jobId,
      cancelled: true,
      inputDeleted: true,
      resultDeleted: true,
      deletedAt: new Date().toISOString(),
    } as const)),
    deleteJobV2: vi.fn(async () => ({
      schemaVersion: "3dena.job-deletion-receipt.v2",
      jobId: binding.reference.jobId,
      cancelled: true,
      inputDeleted: true,
      resultDeleted: true,
      deletedAt: new Date().toISOString(),
      intentAccepted: true,
      termination: "observed",
      capacity: "released",
      objects: "deleted",
    } as const)),
    deleteJobUntilComplete: vi.fn(async () => ({
      schemaVersion: "3dena.job-deletion-receipt.v2",
      jobId: binding.reference.jobId,
      cancelled: true,
      inputDeleted: true,
      resultDeleted: true,
      deletedAt: new Date().toISOString(),
      intentAccepted: true,
      termination: "observed",
      capacity: "released",
      objects: "deleted",
    } as const)),
    getBuildInfo: vi.fn(async () => ({
      schemaVersion: "3dena.compute-build-info.v1" as const,
      approvalManifestSha256: approvedRemoteBuild.approvalManifestSha256,
      releaseId: approvedRemoteBuild.releaseId,
      gitCommit: approvedRemoteBuild.gitCommit,
      flyImageDigest: approvedRemoteBuild.flyImageDigest,
      flyBuildId: approvedRemoteBuild.flyBuildId,
      role: "api" as const,
      contractVersions: [ANALYSIS_CONTRACT_VERSION_V1] as string[],
    })),
  };
}

describe("remote analysis runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allowlists the build, observes progress, and verifies exact result bytes", async () => {
    const bytes = artifactBytes();
    const client = clientFor(bytes);
    const progress = vi.fn();
    const fetchResult = vi.fn(async () => new Response(bytes, { status: 200 }));
    const result = await runRemoteAnalysis({
      client,
      binding,
      approvedRemoteBuild,
      currentWebBuildId: approvedRemoteBuild.webBuildId,
      fetch: fetchResult,
      onProgress: progress,
      pollIntervalMilliseconds: 1,
    });

    expect(result.envelope.owner).toEqual(owner);
    expect(result.envelope.taskKind).toBe("ena-model");
    expect([...result.exactBytes]).toEqual([...bytes]);
    expect(binding.start).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: "modeling" }));
    expect(fetchResult).toHaveBeenCalledWith(
      "https://objects.example.test/result.json",
      expect.objectContaining({
        credentials: "omit",
        redirect: "error",
        headers: expect.objectContaining({
          authorization: `Bearer ${binding.reference.capabilityToken}`,
          "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
        }),
      }),
    );
  });

  it("fails closed before execution for an unapproved compute build", async () => {
    const bytes = artifactBytes();
    const client = clientFor(bytes);
    await expect(runRemoteAnalysis({
      client,
      binding,
      approvedRemoteBuild: {
        ...approvedRemoteBuild,
        approvalManifestSha256: "0".repeat(64),
      },
      currentWebBuildId: approvedRemoteBuild.webBuildId,
      fetch: vi.fn(),
    })).rejects.toMatchObject({ code: "MIXED_BUILD" });
    expect(binding.start).not.toHaveBeenCalled();
  });

  it("rejects bytes that do not match the immutable result receipt", async () => {
    const bytes = artifactBytes();
    const client = clientFor(bytes);
    const tampered = new Uint8Array(bytes);
    tampered[0] = 0;
    await expect(runRemoteAnalysis({
      client,
      binding,
      approvedRemoteBuild,
      currentWebBuildId: approvedRemoteBuild.webBuildId,
      fetch: vi.fn(async () => new Response(tampered, { status: 200 })),
    })).rejects.toMatchObject({ code: "RESULT_RECEIPT_MISMATCH" });
  });

  it("does not claim cancellation when durable deletion polling cannot reach final facts", async () => {
    const client = clientFor(artifactBytes());
    vi.mocked(client.deleteJobUntilComplete).mockRejectedValueOnce(
      new Error("durable deletion remains pending"),
    );
    await expect(cancelRemoteAnalysis(client, binding.reference)).rejects.toBeInstanceOf(
      RemoteAnalysisRuntimeError,
    );
  });

  it("reuses one deterministic deletion operation key after a lost response retry", async () => {
    const client = clientFor(artifactBytes());
    await deleteRemoteJobData(client, binding.reference);
    await deleteRemoteJobData(client, binding.reference);

    const calls = vi.mocked(client.deleteJobUntilComplete).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[1]).toMatch(/^delete-v2-[a-f0-9]{64}$/u);
    expect(calls[1]?.[1]).toBe(calls[0]?.[1]);
  });
});
