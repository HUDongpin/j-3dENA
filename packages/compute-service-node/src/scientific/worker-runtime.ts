import { createHash } from "node:crypto";
import type { Serializable } from "node:child_process";

import {
  executeAnalysisTask,
  executeLongitudinalAnalysisV2,
  type AnalysisResultEnvelopeV1,
  type AnalysisTaskResultV1,
  type LongitudinalAnalysisBundleV2,
} from "@3dena/analysis";

import { NODE_COMPUTE_IPC_PROTOCOL_VERSION } from "../contracts";
import {
  HARD_MAX_SCIENTIFIC_ARTIFACT_BYTES,
  SCIENTIFIC_ARTIFACT_PUT_REQUEST_VERSION,
  SCIENTIFIC_LONGITUDINAL_EXECUTION_INPUT_VERSION,
  SCIENTIFIC_LONGITUDINAL_RESULT_ARTIFACT_VERSION,
  SCIENTIFIC_LONGITUDINAL_TASK_KIND_V2,
  SCIENTIFIC_PUBLICATION_REQUEST_VERSION,
  SCIENTIFIC_RESULT_ARTIFACT_VERSION,
  SCIENTIFIC_WORKER_FAILURE_VERSION,
  SCIENTIFIC_WORKER_PROTOCOL_VERSION,
  type ScientificArtifactPutAckV1,
  type ScientificArtifactPutRequestV1,
  type ScientificLongitudinalResultArtifactV2,
  type ScientificLongitudinalExecutionInputV2,
  type ScientificPublicationAckV1,
  type ScientificPublicationRequestV1,
  type ScientificWorkerFailureCodeV1,
  type ScientificWorkerLaunchPayloadV1,
} from "./contracts";
import {
  assertArtifactPutAck,
  assertBaseLaunchMessage,
  bindAndHashPersistentLongitudinalRequestV2,
  assertPublicationAck,
  isRecord,
} from "./validation";

const MAX_ACK_WAIT_MS = 30_000;

interface PendingArtifactAck {
  readonly kind: "artifact";
  readonly descriptor: ScientificArtifactPutRequestV1["object"];
  readonly resolve: (value: ScientificArtifactPutAckV1) => void;
  readonly reject: () => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface PendingPublicationAck {
  readonly kind: "publication";
  readonly request: ScientificPublicationRequestV1;
  readonly resolve: (value: ScientificPublicationAckV1) => void;
  readonly reject: () => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

type PendingAck = PendingArtifactAck | PendingPublicationAck;

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("NON_FINITE");
    return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (!isRecord(value)) throw new TypeError("UNSUPPORTED_VALUE");
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => {
      if (value[key] === undefined) throw new TypeError("UNDEFINED_VALUE");
      return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
    })
    .join(",")}}`;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isSerializable(value: unknown): value is Serializable {
  return typeof value === "object" && value !== null;
}

function classifyExecutionFailure(
  error: unknown,
  deadlineEpochMilliseconds: number,
): ScientificWorkerFailureCodeV1 {
  if (Date.now() >= deadlineEpochMilliseconds) return "DEADLINE_EXCEEDED";
  if (
    error instanceof TypeError ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      ((error as { name?: unknown }).name === "AnalysisValidationError" ||
        (error as { name?: unknown }).name === "AnalysisTaskExecutionError" ||
        (error as { name?: unknown }).name === "LongitudinalExecutionErrorV2"))
  ) {
    return "INVALID_INPUT";
  }
  return "EXECUTION_FAILED";
}

/**
 * Pure durable-V2 worker operation used by the child-process protocol and by
 * the cross-package HTTP-bytes integration test. It deliberately repeats the
 * server build/request binding immediately before scientific execution.
 */
export async function executeScientificLongitudinalInputV2(
  input: ScientificLongitudinalExecutionInputV2,
): Promise<ScientificLongitudinalResultArtifactV2> {
  const bound = await bindAndHashPersistentLongitudinalRequestV2(input.request);
  if (bound.requestHash !== input.requestHash) {
    throw new TypeError("LONGITUDINAL_REQUEST_HASH_MISMATCH");
  }
  const bundle: LongitudinalAnalysisBundleV2 =
    await executeLongitudinalAnalysisV2(bound.request);
  if (bundle.identity.requestHash !== bound.requestHash) {
    throw new TypeError("LONGITUDINAL_RESULT_REQUEST_BINDING_MISMATCH");
  }
  return {
    version: SCIENTIFIC_LONGITUDINAL_RESULT_ARTIFACT_VERSION,
    owner: { ...input.owner },
    taskKind: SCIENTIFIC_LONGITUDINAL_TASK_KIND_V2,
    requestHash: bound.requestHash,
    bundle,
  };
}

export function startScientificWorkerProcess(): void {
  if (typeof process.send !== "function") process.exit(1);
  let launch: ScientificWorkerLaunchPayloadV1 | undefined;
  let ready = false;
  let exiting = false;
  let pendingAck: PendingAck | undefined;

  const exitImmediately = (code: number): void => {
    if (exiting) return;
    exiting = true;
    if (pendingAck !== undefined) {
      clearTimeout(pendingAck.timer);
      pendingAck.reject();
      pendingAck = undefined;
    }
    process.exit(code);
  };

  const send = async (message: unknown): Promise<void> => {
    if (exiting || typeof process.send !== "function" || !isSerializable(message)) {
      throw new TypeError("IPC_UNAVAILABLE");
    }
    await new Promise<void>((resolve, reject) => {
      try {
        process.send?.(message, undefined, undefined, (error: Error | null) => {
          if (error === null) resolve();
          else reject(new TypeError("IPC_SEND_FAILED"));
        });
      } catch {
        reject(new TypeError("IPC_SEND_FAILED"));
      }
    });
  };

  const fail = async (code: ScientificWorkerFailureCodeV1): Promise<void> => {
    if (exiting) return;
    const executionId = launch?.publication.executionId;
    if (ready && executionId !== undefined) {
      try {
        await send({
          version: SCIENTIFIC_WORKER_FAILURE_VERSION,
          protocolVersion: SCIENTIFIC_WORKER_PROTOCOL_VERSION,
          type: "failed",
          executionId,
          code,
        });
      } catch {
        // Failure reporting is best-effort and never includes the source error.
      }
    }
    exitImmediately(1);
  };

  const ackTimeout = (deadlineEpochMilliseconds: number): number =>
    Math.max(
      1,
      Math.min(MAX_ACK_WAIT_MS, deadlineEpochMilliseconds - Date.now()),
    );

  const awaitArtifactAck = async (
    request: ScientificArtifactPutRequestV1,
    deadlineEpochMilliseconds: number,
  ): Promise<ScientificArtifactPutAckV1> => {
    if (pendingAck !== undefined) throw new TypeError("ACK_ALREADY_PENDING");
    let waiter!: PendingArtifactAck;
    let cancelWaiter = (): void => undefined;
    const promise = new Promise<ScientificArtifactPutAckV1>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pendingAck?.kind === "artifact") pendingAck = undefined;
        reject(new TypeError("ARTIFACT_ACK_TIMEOUT"));
      }, ackTimeout(deadlineEpochMilliseconds));
      waiter = {
        kind: "artifact",
        descriptor: request.object,
        resolve,
        reject: () => reject(new TypeError("ARTIFACT_ACK_CANCELLED")),
        timer,
      };
      pendingAck = waiter;
      cancelWaiter = () => {
        clearTimeout(waiter.timer);
        if (pendingAck === waiter) pendingAck = undefined;
        waiter.reject();
      };
    });
    void promise.catch(() => {
      // A send failure clears/rejects the pending waiter below; keep it observed.
    });
    try {
      await send(request);
    } catch {
      cancelWaiter();
      throw new TypeError("IPC_SEND_FAILED");
    }
    return promise;
  };

  const awaitPublicationAck = async (
    request: ScientificPublicationRequestV1,
    deadlineEpochMilliseconds: number,
  ): Promise<ScientificPublicationAckV1> => {
    if (pendingAck !== undefined) throw new TypeError("ACK_ALREADY_PENDING");
    let waiter!: PendingPublicationAck;
    let cancelWaiter = (): void => undefined;
    const promise = new Promise<ScientificPublicationAckV1>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pendingAck?.kind === "publication") pendingAck = undefined;
        reject(new TypeError("PUBLICATION_ACK_TIMEOUT"));
      }, ackTimeout(deadlineEpochMilliseconds));
      waiter = {
        kind: "publication",
        request,
        resolve,
        reject: () => reject(new TypeError("PUBLICATION_ACK_CANCELLED")),
        timer,
      };
      pendingAck = waiter;
      cancelWaiter = () => {
        clearTimeout(waiter.timer);
        if (pendingAck === waiter) pendingAck = undefined;
        waiter.reject();
      };
    });
    void promise.catch(() => {
      // A send failure clears/rejects the pending waiter below; keep it observed.
    });
    try {
      await send(request);
    } catch {
      cancelWaiter();
      throw new TypeError("IPC_SEND_FAILED");
    }
    return promise;
  };

  const execute = async (): Promise<void> => {
    if (launch === undefined) return;
    const { input, publication } = launch;
    const deadlineAtMs = input.version === SCIENTIFIC_LONGITUDINAL_EXECUTION_INPUT_VERSION
      ? input.deadlineAtMs
      : input.task.deadlineEpochMilliseconds;
    if (Date.now() >= deadlineAtMs) {
      await fail("DEADLINE_EXCEEDED");
      return;
    }
    let artifact:
      | ScientificLongitudinalResultArtifactV2
      | {
          readonly version: typeof SCIENTIFIC_RESULT_ARTIFACT_VERSION;
          readonly owner: AnalysisResultEnvelopeV1<AnalysisTaskResultV1>["owner"];
          readonly taskKind: AnalysisResultEnvelopeV1<AnalysisTaskResultV1>["taskKind"];
          readonly envelope: AnalysisResultEnvelopeV1<AnalysisTaskResultV1>;
        };
    try {
      if (input.version === SCIENTIFIC_LONGITUDINAL_EXECUTION_INPUT_VERSION) {
        artifact = await executeScientificLongitudinalInputV2(input);
      } else {
        const envelope = await executeAnalysisTask(input.dataset, input.task);
        artifact = {
          version: SCIENTIFIC_RESULT_ARTIFACT_VERSION,
          owner: { ...envelope.owner },
          taskKind: envelope.taskKind,
          envelope,
        };
      }
    } catch (error) {
      await fail(classifyExecutionFailure(error, deadlineAtMs));
      return;
    }
    if (Date.now() >= deadlineAtMs) {
      await fail("DEADLINE_EXCEEDED");
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = new TextEncoder().encode(`${canonicalJson(artifact)}\n`);
    } catch {
      await fail("EXECUTION_FAILED");
      return;
    }
    if (bytes.byteLength > HARD_MAX_SCIENTIFIC_ARTIFACT_BYTES) {
      await fail("ARTIFACT_STORE_FAILED");
      return;
    }
    const descriptor = {
      key: publication.resultObjectKey,
      sha256: sha256(bytes),
      byteLength: bytes.byteLength,
    };
    const artifactRequest: ScientificArtifactPutRequestV1 = {
      version: SCIENTIFIC_ARTIFACT_PUT_REQUEST_VERSION,
      protocolVersion: SCIENTIFIC_WORKER_PROTOCOL_VERSION,
      type: "artifact-put-request",
      executionId: publication.executionId,
      owner: { ...publication.owner },
      lease: { ...publication.lease },
      object: descriptor,
      bytes,
    };
    try {
      await awaitArtifactAck(
        artifactRequest,
        deadlineAtMs,
      );
    } catch {
      await fail(
        Date.now() >= deadlineAtMs
          ? "DEADLINE_EXCEEDED"
          : "ARTIFACT_STORE_FAILED",
      );
      return;
    }
    const publicationRequest: ScientificPublicationRequestV1 = {
      version: SCIENTIFIC_PUBLICATION_REQUEST_VERSION,
      protocolVersion: SCIENTIFIC_WORKER_PROTOCOL_VERSION,
      type: "publication-request",
      executionId: publication.executionId,
      owner: { ...publication.owner },
      lease: { ...publication.lease },
      object: descriptor,
    };
    try {
      await awaitPublicationAck(
        publicationRequest,
        deadlineAtMs,
      );
    } catch {
      await fail(
        Date.now() >= deadlineAtMs
          ? "DEADLINE_EXCEEDED"
          : "PUBLICATION_FAILED",
      );
      return;
    }
    exitImmediately(0);
  };

  process.on("message", (message: unknown) => {
    if (!ready) {
      try {
        assertBaseLaunchMessage(message);
        launch = message.payload;
      } catch {
        exitImmediately(1);
        return;
      }
      ready = true;
      void send({
        version: NODE_COMPUTE_IPC_PROTOCOL_VERSION,
        type: "ready",
        executionId: launch.publication.executionId,
      })
        .then(() => execute())
        .catch(() => exitImmediately(1));
      return;
    }
    const pending = pendingAck;
    if (pending === undefined) {
      void fail("PROTOCOL_FAILED");
      return;
    }
    try {
      if (pending.kind === "artifact") {
        assertArtifactPutAck(message, launch!.publication.executionId, pending.descriptor);
        clearTimeout(pending.timer);
        pendingAck = undefined;
        pending.resolve(message);
      } else {
        assertPublicationAck(message, pending.request);
        clearTimeout(pending.timer);
        pendingAck = undefined;
        pending.resolve(message);
      }
    } catch {
      clearTimeout(pending.timer);
      pendingAck = undefined;
      pending.reject();
      void fail("PROTOCOL_FAILED");
    }
  });

  process.once("SIGTERM", () => exitImmediately(143));
  process.once("uncaughtException", () => exitImmediately(1));
  process.once("unhandledRejection", () => exitImmediately(1));
}
