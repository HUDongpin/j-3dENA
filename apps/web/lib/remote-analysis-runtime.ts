import {
  ANALYSIS_CONTRACT_VERSION_V1,
  assertAnalysisResultEnvelopeV1,
  type AnalysisClientV1,
  type AnalysisDeletionReceiptV1,
  type AnalysisComputeBuildInfoV1,
  type AnalysisJobReferenceV1,
  type AnalysisJobResultReferenceV1,
  type AnalysisJobStatusV1,
  type AnalysisResultEnvelopeV1,
  type AnalysisTaskResultV1,
  type AnalysisTaskV1,
  type DatasetReceiptV1,
} from "@3dena/analysis";
import type { ApprovedRemoteBuildIdentity } from "./execution-policy";

const SCIENTIFIC_RESULT_ARTIFACT_VERSION =
  "3dena.compute-scientific-result-artifact.v1";
const TERMINAL_STATES = new Set(["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"]);

export interface RemoteExecutionBinding {
  readonly reference: AnalysisJobReferenceV1;
  readonly datasetReceipt: DatasetReceiptV1;
  readonly taskKind: AnalysisTaskV1["kind"];
  readonly runId: string;
  /** Present only for a derived job authorized against an exact source hash. */
  readonly sourceResultHash?: string;
  readonly start: (signal?: AbortSignal) => Promise<void>;
}

export interface RemoteAnalysisProgress {
  readonly state: string;
  readonly phase: string;
  readonly completed: number;
  readonly total: number | null;
}

export interface VerifiedRemoteAnalysisResult {
  readonly envelope: AnalysisResultEnvelopeV1<AnalysisTaskResultV1>;
  readonly reference: AnalysisJobResultReferenceV1;
  readonly exactBytes: Uint8Array<ArrayBuffer>;
  /** Client-observed immutable binding used to create a derived service job. */
  readonly sourceResultHash?: string;
}

export interface RunRemoteAnalysisOptions {
  readonly client: AnalysisClientV1;
  readonly binding: RemoteExecutionBinding;
  readonly approvedRemoteBuild: ApprovedRemoteBuildIdentity | null;
  readonly currentWebBuildId: string | null;
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: RemoteAnalysisProgress) => void;
  readonly pollIntervalMilliseconds?: number;
}

export class RemoteAnalysisRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RemoteAnalysisRuntimeError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new RemoteAnalysisRuntimeError(code, message);
}

function randomKey(prefix: string): string {
  const random = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

function sameOwner(
  actual: AnalysisResultEnvelopeV1["owner"],
  expected: AnalysisTaskV1["owner"],
): boolean {
  return actual.contractVersion === expected.contractVersion
    && actual.datasetHash === expected.datasetHash
    && actual.specHash === expected.specHash
    && actual.runId === expected.runId
    && actual.taskId === expected.taskId;
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function extractEnvelope(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (record.version === SCIENTIFIC_RESULT_ARTIFACT_VERSION) {
    return record.envelope;
  }
  return value;
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function assertApprovedComputeBuild(
  client: AnalysisClientV1,
  approvedRemoteBuild: ApprovedRemoteBuildIdentity | null,
  currentWebBuildId: string | null,
): Promise<AnalysisComputeBuildInfoV1> {
  if (approvedRemoteBuild === null) {
    fail("BUILD_NOT_APPROVED", "No exact active BuildApprovalV1 identity is configured.");
  }
  if (currentWebBuildId !== approvedRemoteBuild.webBuildId) {
    fail("MIXED_BUILD", "The running Web build does not match the active BuildApprovalV1.");
  }
  const build = await client.getBuildInfo();
  if (build.approvalManifestSha256 !== approvedRemoteBuild.approvalManifestSha256
      || build.releaseId !== approvedRemoteBuild.releaseId
      || build.gitCommit !== approvedRemoteBuild.gitCommit
      || build.flyImageDigest !== approvedRemoteBuild.flyImageDigest
      || build.flyBuildId !== approvedRemoteBuild.flyBuildId) {
    fail("MIXED_BUILD", "The compute service identity does not match the active BuildApprovalV1.");
  }
  if (!build.contractVersions.includes(ANALYSIS_CONTRACT_VERSION_V1)) {
    fail("CONTRACT_MISMATCH", "The compute service does not advertise the required analysis contract.");
  }
  return build;
}

export async function runRemoteAnalysis(
  options: RunRemoteAnalysisOptions,
): Promise<VerifiedRemoteAnalysisResult> {
  const {
    client,
    binding,
    approvedRemoteBuild,
    currentWebBuildId,
    signal,
    onProgress,
  } = options;
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const pollInterval = options.pollIntervalMilliseconds ?? 500;
  if (typeof fetchImplementation !== "function") {
    fail("FETCH_UNAVAILABLE", "Result verification requires Fetch.");
  }
  await assertApprovedComputeBuild(client, approvedRemoteBuild, currentWebBuildId);
  await binding.start(signal);
  let status: AnalysisJobStatusV1 = await client.getJob(binding.reference);
  const expectedOwner = status.owner;
  if (expectedOwner === null
      || expectedOwner.datasetHash !== binding.datasetReceipt.sha256
      || expectedOwner.runId !== binding.runId) {
    fail("OWNERSHIP_MISMATCH", "The service-owned execution dataset did not bind the activated dataset and requested run.");
  }
  onProgress?.({
    state: status.state,
    phase: status.progress?.phase ?? "queued",
    completed: status.progress?.completed ?? 0,
    total: status.progress?.total ?? null,
  });

  if (!TERMINAL_STATES.has(status.state)) {
    for await (const event of client.events(binding.reference, signal)) {
      if (signal?.aborted) fail("ABORTED", "Remote analysis observation was aborted.");
      onProgress?.(event);
      if (TERMINAL_STATES.has(event.state)) break;
    }
    status = await client.getJob(binding.reference);
  }

  while (!TERMINAL_STATES.has(status.state)) {
    await wait(pollInterval, signal);
    status = await client.getJob(binding.reference);
    onProgress?.({
      state: status.state,
      phase: status.progress?.phase ?? "running",
      completed: status.progress?.completed ?? 0,
      total: status.progress?.total ?? null,
    });
  }
  if (status.state !== "SUCCEEDED" || !status.resultAvailable) {
    fail(
      `REMOTE_${status.state}`,
      status.state === "FAILED"
        ? `Remote analysis failed with code ${status.errorCode ?? "UNCLASSIFIED"}.`
        : `Remote analysis ended in state ${status.state}.`,
    );
  }

  const reference = await client.getResult(binding.reference);
  const response = await fetchImplementation(reference.resultUrl, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${binding.reference.capabilityToken}`,
      "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
    },
    credentials: "omit",
    redirect: "error",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    fail("RESULT_DOWNLOAD_FAILED", `Verified result download failed with HTTP ${response.status}.`);
  }
  const exactBytes = new Uint8Array(await response.arrayBuffer());
  if (exactBytes.byteLength !== reference.byteLength
    || await sha256(exactBytes) !== reference.sha256) {
    fail("RESULT_RECEIPT_MISMATCH", "Downloaded result bytes do not match the service receipt.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(exactBytes));
  } catch {
    fail("INVALID_RESULT_BYTES", "Verified result bytes are not strict UTF-8 JSON.");
  }
  const envelopeValue = extractEnvelope(parsed);
  assertAnalysisResultEnvelopeV1(envelopeValue);
  const resultValue = envelopeValue.result;
  if (envelopeValue.taskKind !== binding.taskKind
    || !resultValue
    || typeof resultValue !== "object"
    || Array.isArray(resultValue)) {
    fail("RESULT_VARIANT_MISMATCH", "The remote result variant does not match the requested task kind.");
  }
  if (!sameOwner(envelopeValue.owner, expectedOwner)) {
    fail("OWNERSHIP_MISMATCH", "The verified result belongs to another dataset, specification, or run.");
  }

  return {
    envelope: envelopeValue as AnalysisResultEnvelopeV1<AnalysisTaskResultV1>,
    reference,
    exactBytes,
    ...(binding.sourceResultHash === undefined
      ? {}
      : { sourceResultHash: binding.sourceResultHash }),
  };
}

export async function cancelRemoteAnalysis(
  client: AnalysisClientV1,
  reference: AnalysisJobReferenceV1,
): Promise<AnalysisDeletionReceiptV1> {
  const receipt = await deleteRemoteJobData(client, reference);
  if (!receipt.cancelled) {
    fail(
      "CANCELLATION_NOT_OBSERVED",
      "The service deleted job data but did not attest cancellation.",
    );
  }
  return receipt;
}

export async function deleteRemoteJobData(
  client: AnalysisClientV1,
  reference: AnalysisJobReferenceV1,
): Promise<AnalysisDeletionReceiptV1> {
  const receipt = await client.deleteJob(reference, randomKey("delete"));
  if (!receipt.inputDeleted || !receipt.resultDeleted) {
    fail(
      "DELETION_NOT_OBSERVED",
      "The service did not attest deletion of all input and result data.",
    );
  }
  return receipt;
}
