import {
  ANALYSIS_CONTRACT_VERSION_V1,
  AnalysisClientError,
  assertAnalysisResultEnvelopeV1,
  type AnalysisClientV2,
  type AnalysisDeletionReceiptV2,
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
  readonly client: AnalysisClientV2;
  readonly binding: RemoteExecutionBinding;
  readonly approvedRemoteBuild: ApprovedRemoteBuildIdentity | null;
  readonly currentWebBuildId: string | null;
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: RemoteAnalysisProgress) => void;
  readonly pollIntervalMilliseconds?: number;
  /** Total observation interruptions allowed before retaining the job for explicit recovery. */
  readonly observationReconnectAttempts?: number;
  /** Upper bound for client-selected backoff; Retry-After may exceed it within the total budget. */
  readonly observationReconnectMaximumDelayMilliseconds?: number;
  /** Total scheduled reconnect-delay budget; Retry-After is never shortened to fit it. */
  readonly observationReconnectTotalDelayMilliseconds?: number;
  /** Per-attempt deadline covering result headers and the complete artifact body. */
  readonly resultRequestTimeoutMilliseconds?: number;
}

export class RemoteAnalysisRuntimeError extends Error {
  readonly code: string;
  /** True when observation failed but the persistent job must remain recoverable. */
  readonly retainJob: boolean;

  constructor(code: string, message: string, retainJob = false) {
    super(message);
    this.name = "RemoteAnalysisRuntimeError";
    this.code = code;
    this.retainJob = retainJob;
  }
}

function fail(code: string, message: string, retainJob = false): never {
  throw new RemoteAnalysisRuntimeError(code, message, retainJob);
}

export function shouldRetainRemoteJob(error: unknown): boolean {
  return error instanceof RemoteAnalysisRuntimeError && error.retainJob;
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

async function deletionOperationKey(reference: AnalysisJobReferenceV1): Promise<string> {
  // The operation identity must survive a lost response and a caller retry.
  // The capability token remains authorization only and is deliberately not
  // reflected in the idempotency key.
  const digest = await sha256(new TextEncoder().encode(
    `3dena.delete-job.v2\u0000${reference.jobId}`,
  ));
  return `delete-v2-${digest}`;
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

function transientObservationError(error: unknown): boolean {
  if (!(error instanceof AnalysisClientError)) return false;
  return [
    "NETWORK_FAILURE",
    "REQUEST_TIMEOUT",
    "SSE_CONNECTION_FAILED",
    "SSE_CONNECTION_INTERRUPTED",
  ].includes(error.code) ||
    (error.status !== null && [408, 425, 429, 500, 502, 503, 504].includes(error.status));
}

function responseRetryAfterMilliseconds(response: Response, now = Date.now()): number | null {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return null;
  if (/^(?:0|[1-9][0-9]{0,8})$/u.test(value)) {
    const milliseconds = Number(value) * 1_000;
    return Number.isSafeInteger(milliseconds) ? milliseconds : null;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, timestamp - now);
}

async function downloadResultAttempt(
  fetchImplementation: typeof fetch,
  reference: AnalysisJobResultReferenceV1,
  capabilityToken: string,
  timeoutMilliseconds: number,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const controller = new AbortController();
  let requestTimedOut = false;
  const onCallerAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onCallerAbort, { once: true });
  if (signal?.aborted) controller.abort(signal.reason);
  const timer = setTimeout(() => {
    requestTimedOut = true;
    controller.abort(new DOMException("Result request deadline exceeded", "TimeoutError"));
  }, timeoutMilliseconds);
  try {
    const response = await fetchImplementation(reference.resultUrl, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${capabilityToken}`,
        "x-3dena-contract-version": ANALYSIS_CONTRACT_VERSION_V1,
      },
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    if (controller.signal.aborted) {
      throw controller.signal.reason ?? new DOMException("Result request aborted", "AbortError");
    }
    if (!response.ok) {
      const retryAfter = responseRetryAfterMilliseconds(response);
      await response.body?.cancel().catch(() => undefined);
      throw new AnalysisClientError(
        `HTTP_${response.status}`,
        `Verified result download failed with HTTP ${response.status}.`,
        response.status,
        response.headers.get("x-request-id"),
        retryAfter,
      );
    }
    if (!response.body) {
      fail("RESULT_DOWNLOAD_FAILED", "Verified result download did not include a response body.");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    const onAttemptAbort = () => {
      void reader.cancel(controller.signal.reason).catch(() => undefined);
    };
    controller.signal.addEventListener("abort", onAttemptAbort, { once: true });
    if (controller.signal.aborted) onAttemptAbort();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (controller.signal.aborted) {
          throw controller.signal.reason ?? new DOMException("Result request aborted", "AbortError");
        }
        if (done) break;
        total += value.byteLength;
        if (total > reference.byteLength) {
          fail("RESULT_RECEIPT_MISMATCH", "Downloaded result bytes exceed the service receipt.");
        }
        chunks.push(value);
      }
    } finally {
      controller.signal.removeEventListener("abort", onAttemptAbort);
      await reader.cancel().catch(() => undefined);
    }
    const exactBytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      exactBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return exactBytes;
  } catch (error) {
    if (error instanceof AnalysisClientError || error instanceof RemoteAnalysisRuntimeError) {
      throw error;
    }
    if (signal?.aborted) {
      throw new AnalysisClientError("ABORTED", "Remote result observation was aborted.");
    }
    if (requestTimedOut) {
      throw new AnalysisClientError(
        "REQUEST_TIMEOUT",
        "Verified result download exceeded the client deadline.",
      );
    }
    throw new AnalysisClientError(
      "NETWORK_FAILURE",
      "Verified result download could not be completed.",
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
  }
}

function publishStatusProgress(
  status: AnalysisJobStatusV1,
  onProgress: RunRemoteAnalysisOptions["onProgress"],
): void {
  onProgress?.({
    state: status.state,
    phase: status.progress?.phase ?? (status.state === "QUEUED" ? "queued" : "running"),
    completed: status.progress?.completed ?? 0,
    total: status.progress?.total ?? null,
  });
}

export async function assertApprovedComputeBuild(
  client: AnalysisClientV2,
  approvedRemoteBuild: ApprovedRemoteBuildIdentity | null,
  currentWebBuildId: string | null,
  signal?: AbortSignal,
): Promise<AnalysisComputeBuildInfoV1> {
  if (approvedRemoteBuild === null) {
    fail("BUILD_NOT_APPROVED", "No exact active BuildApprovalV1 identity is configured.");
  }
  if (currentWebBuildId !== approvedRemoteBuild.webBuildId) {
    fail("MIXED_BUILD", "The running Web build does not match the active BuildApprovalV1.");
  }
  const build = await client.getBuildInfo(signal);
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
  const observationReconnectAttempts = options.observationReconnectAttempts ?? 6;
  const observationReconnectMaximumDelay =
    options.observationReconnectMaximumDelayMilliseconds ?? 4_000;
  const observationReconnectTotalDelay =
    options.observationReconnectTotalDelayMilliseconds ?? 30_000;
  const resultRequestTimeout = options.resultRequestTimeoutMilliseconds ?? 30_000;
  if (typeof fetchImplementation !== "function") {
    fail("FETCH_UNAVAILABLE", "Result verification requires Fetch.");
  }
  if (!Number.isSafeInteger(pollInterval) || pollInterval < 1 || pollInterval > 30_000 ||
      !Number.isSafeInteger(observationReconnectAttempts) || observationReconnectAttempts < 1 ||
      observationReconnectAttempts > 12 ||
      !Number.isSafeInteger(observationReconnectMaximumDelay) ||
      observationReconnectMaximumDelay < 1 ||
      observationReconnectMaximumDelay > 30_000 ||
      !Number.isSafeInteger(observationReconnectTotalDelay) ||
      observationReconnectTotalDelay < 1 || observationReconnectTotalDelay > 300_000 ||
      !Number.isSafeInteger(resultRequestTimeout) ||
      resultRequestTimeout < 1 || resultRequestTimeout > 300_000) {
    fail("INVALID_RUNTIME_CONFIG", "Remote observation retry configuration is invalid.");
  }
  await assertApprovedComputeBuild(
    client,
    approvedRemoteBuild,
    currentWebBuildId,
    signal,
  );
  await binding.start(signal);
  let observationInterruptions = 0;
  let observationDelaySpent = 0;
  const waitForObservationRetry = async (error?: unknown): Promise<void> => {
    observationInterruptions += 1;
    const exponentialDelay = Math.min(
      observationReconnectMaximumDelay,
      pollInterval * (2 ** (observationInterruptions - 1)),
    );
    const retryAfterDelay = error instanceof AnalysisClientError
      ? error.retryAfterMilliseconds ?? 0
      : 0;
    const delay = Math.max(exponentialDelay, retryAfterDelay);
    if (observationInterruptions > observationReconnectAttempts ||
        delay > observationReconnectTotalDelay - observationDelaySpent) {
      fail(
        "OBSERVATION_RETRY_EXHAUSTED",
        "Remote observation remains interrupted. The persistent job was retained for explicit same-session handling; no deletion was attempted.",
        true,
      );
    }
    try {
      await wait(delay, signal);
      observationDelaySpent += delay;
    } catch (error) {
      if (signal?.aborted) fail("ABORTED", "Remote analysis observation was aborted.");
      throw error;
    }
  };
  const recoverObservation = async <T>(operation: () => Promise<T>): Promise<T> => {
    while (true) {
      try {
        return await operation();
      } catch (error) {
        if (signal?.aborted || (error instanceof AnalysisClientError && error.code === "ABORTED")) {
          fail("ABORTED", "Remote analysis observation was aborted.");
        }
        if (!transientObservationError(error)) throw error;
        await waitForObservationRetry(error);
      }
    }
  };
  let status: AnalysisJobStatusV1 = await recoverObservation(
    async () => client.getJob(binding.reference, signal),
  );
  const expectedOwner = status.owner;
  if (expectedOwner === null
      || expectedOwner.datasetHash !== binding.datasetReceipt.sha256
      || expectedOwner.runId !== binding.runId) {
    fail("OWNERSHIP_MISMATCH", "The service-owned execution dataset did not bind the activated dataset and requested run.");
  }
  publishStatusProgress(status, onProgress);

  while (!TERMINAL_STATES.has(status.state)) {
    let terminalEventObserved = false;
    let streamError: unknown;
    try {
      for await (const event of client.events(binding.reference, signal)) {
        if (signal?.aborted) fail("ABORTED", "Remote analysis observation was aborted.");
        onProgress?.(event);
        if (TERMINAL_STATES.has(event.state)) {
          terminalEventObserved = true;
          break;
        }
      }
    } catch (error) {
      if (signal?.aborted || (error instanceof AnalysisClientError && error.code === "ABORTED")) {
        fail("ABORTED", "Remote analysis observation was aborted.");
      }
      if (!transientObservationError(error)) throw error;
      streamError = error;
    }

    // A status read is the authoritative reconciliation point after every
    // terminal event, clean EOF, or interrupted connection. It prevents an
    // observation transport failure from being mistaken for a failed job.
    status = await recoverObservation(
      async () => client.getJob(binding.reference, signal),
    );
    publishStatusProgress(status, onProgress);
    if (TERMINAL_STATES.has(status.state)) break;

    if (terminalEventObserved) {
      fail(
        "STATUS_RECONCILIATION_FAILED",
        "The event stream reported a terminal state that the authoritative job status did not confirm.",
      );
    }
    await waitForObservationRetry(streamError);
  }
  if (status.state !== "SUCCEEDED" || !status.resultAvailable) {
    fail(
      `REMOTE_${status.state}`,
      status.state === "FAILED"
        ? `Remote analysis failed with code ${status.errorCode ?? "UNCLASSIFIED"}.`
        : `Remote analysis ended in state ${status.state}.`,
    );
  }

  const reference = await recoverObservation(
    async () => client.getResult(binding.reference, signal),
  );
  const exactBytes = await recoverObservation(async () => downloadResultAttempt(
    fetchImplementation,
    reference,
    binding.reference.capabilityToken,
    resultRequestTimeout,
    signal,
  ));
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
  client: AnalysisClientV2,
  reference: AnalysisJobReferenceV1,
): Promise<AnalysisDeletionReceiptV2> {
  const receipt = await deleteRemoteJobData(client, reference);
  if (
    !receipt.cancelled ||
    !receipt.intentAccepted ||
    receipt.termination === "pending" ||
    receipt.capacity === "held" ||
    receipt.objects !== "deleted"
  ) {
    fail(
      "CANCELLATION_NOT_OBSERVED",
      "The service deleted job data but did not attest cancellation.",
    );
  }
  return receipt;
}

export async function deleteRemoteJobData(
  client: AnalysisClientV2,
  reference: AnalysisJobReferenceV1,
): Promise<AnalysisDeletionReceiptV2> {
  const operationKey = await deletionOperationKey(reference);
  let receipt: AnalysisDeletionReceiptV2;
  try {
    receipt = await client.deleteJobUntilComplete(reference, operationKey);
  } catch {
    fail(
      "DELETION_NOT_OBSERVED",
      "The service did not finish the durable deletion lifecycle.",
    );
  }
  if (
    !receipt.inputDeleted ||
    !receipt.resultDeleted ||
    receipt.objects !== "deleted"
  ) {
    fail(
      "DELETION_NOT_OBSERVED",
      "The service did not attest deletion of all input and result data.",
    );
  }
  return receipt;
}
