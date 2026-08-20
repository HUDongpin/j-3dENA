import { createHash } from "node:crypto";

import {
  ANALYSIS_CONTRACT_VERSION_V1,
  RESULT_ENVELOPE_VERSION_V1,
} from "@3dena/analysis";
import type { ImmutableObjectDescriptor } from "@3dena/compute-service-core";

import {
  NODE_WORKER_SESSION_ADAPTER_VERSION,
  type NodeWorkerSessionAdapterV1,
  type NodeWorkerSessionV1,
} from "../contracts";
import {
  DEFAULT_MAX_SCIENTIFIC_RESULT_BYTES,
  HARD_MAX_SCIENTIFIC_ARTIFACT_BYTES,
  SCIENTIFIC_ARTIFACT_PUT_ACK_VERSION,
  SCIENTIFIC_INPUT_PROVIDER_VERSION,
  SCIENTIFIC_PUBLICATION_ACK_VERSION,
  SCIENTIFIC_RESULT_ARTIFACT_VERSION,
  SCIENTIFIC_RESULT_PUBLISHER_VERSION,
  SCIENTIFIC_SESSION_ADAPTER_OPTIONS_VERSION,
  SCIENTIFIC_WORKER_LAUNCH_VERSION,
  SCIENTIFIC_WORKER_PROTOCOL_VERSION,
  type ScientificPublicationReceiptV1,
  type ScientificSessionAdapterOptionsV1,
  type ScientificSessionAdapterSnapshotV1,
  type ScientificWorkerFailureCodeV1,
  type ScientificWorkerLaunchPayloadV1,
} from "./contracts";
import { scientificWorkerError } from "./errors";
import {
  assertArtifactPutRequest,
  assertPublicationReceipt,
  assertPublicationRequest,
  assertScientificExecutionInput,
  assertWorkerFailure,
  descriptorsEqual,
  hasExactKeys,
  isRecord,
} from "./validation";

interface SessionBinding {
  readonly descriptor: ImmutableObjectDescriptor;
  publicationReceipt?: ScientificPublicationReceiptV1;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function analysisOwnerMatches(
  value: unknown,
  session: NodeWorkerSessionV1,
): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "contractVersion",
      "datasetHash",
      "specHash",
      "runId",
      "taskId",
    ]) &&
    value.contractVersion === ANALYSIS_CONTRACT_VERSION_V1 &&
    value.datasetHash === session.context.owner.datasetHash &&
    value.specHash === session.context.owner.specHash &&
    value.runId === session.context.owner.runId &&
    value.taskId === session.context.owner.taskId
  );
}

function assertArtifactBinding(
  bytes: Uint8Array,
  session: NodeWorkerSessionV1,
): void {
  let artifact: unknown;
  try {
    artifact = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    scientificWorkerError("ARTIFACT_BINDING_MISMATCH");
  }
  if (
    !isRecord(artifact) ||
    !hasExactKeys(artifact, ["version", "owner", "taskKind", "envelope"]) ||
    artifact.version !== SCIENTIFIC_RESULT_ARTIFACT_VERSION ||
    artifact.taskKind !== session.context.request.taskKind ||
    !analysisOwnerMatches(artifact.owner, session) ||
    !isRecord(artifact.envelope) ||
    !hasExactKeys(artifact.envelope, [
      "schemaVersion",
      "owner",
      "taskKind",
      "result",
      "diagnostics",
      "evidence",
      "provenance",
    ]) ||
    artifact.envelope.schemaVersion !== RESULT_ENVELOPE_VERSION_V1 ||
    artifact.envelope.taskKind !== session.context.request.taskKind ||
    !analysisOwnerMatches(artifact.envelope.owner, session)
  ) {
    scientificWorkerError("ARTIFACT_BINDING_MISMATCH");
  }
}

export class ScientificWorkerSessionAdapter
  implements NodeWorkerSessionAdapterV1
{
  readonly version = NODE_WORKER_SESSION_ADAPTER_VERSION;
  readonly #inputProvider: ScientificSessionAdapterOptionsV1["inputProvider"];
  readonly #resultStore: ScientificSessionAdapterOptionsV1["resultStore"];
  readonly #publisher: ScientificSessionAdapterOptionsV1["publisher"];
  readonly #maxResultBytes: number;
  readonly #bindings = new Map<string, SessionBinding>();
  readonly #failureCounts = new Map<ScientificWorkerFailureCodeV1, number>();
  #totalFailures = 0;

  constructor(options: ScientificSessionAdapterOptionsV1) {
    if (
      !isRecord(options) ||
      !Object.keys(options).every((key) =>
        [
          "version",
          "inputProvider",
          "resultStore",
          "publisher",
          "maxResultBytes",
        ].includes(key),
      ) ||
      options.version !== SCIENTIFIC_SESSION_ADAPTER_OPTIONS_VERSION ||
      !isRecord(options.inputProvider) ||
      options.inputProvider.version !== SCIENTIFIC_INPUT_PROVIDER_VERSION ||
      typeof options.inputProvider.load !== "function" ||
      !isRecord(options.resultStore) ||
      typeof options.resultStore.putImmutable !== "function" ||
      typeof options.resultStore.head !== "function" ||
      !isRecord(options.publisher) ||
      options.publisher.version !== SCIENTIFIC_RESULT_PUBLISHER_VERSION ||
      typeof options.publisher.publish !== "function"
    ) {
      scientificWorkerError("INVALID_CONFIGURATION");
    }
    const maxResultBytes =
      options.maxResultBytes ?? DEFAULT_MAX_SCIENTIFIC_RESULT_BYTES;
    if (
      !Number.isSafeInteger(maxResultBytes) ||
      maxResultBytes < 1 ||
      maxResultBytes > HARD_MAX_SCIENTIFIC_ARTIFACT_BYTES
    ) {
      scientificWorkerError("INVALID_CONFIGURATION");
    }
    this.#inputProvider = options.inputProvider;
    this.#resultStore = options.resultStore;
    this.#publisher = options.publisher;
    this.#maxResultBytes = maxResultBytes;
  }

  async prepareLaunchPayload(
    context: Parameters<NodeWorkerSessionAdapterV1["prepareLaunchPayload"]>[0],
    control: Parameters<NodeWorkerSessionAdapterV1["prepareLaunchPayload"]>[1],
  ): Promise<ScientificWorkerLaunchPayloadV1> {
    let input;
    try {
      input = await this.#inputProvider.load(context, control.signal);
      assertScientificExecutionInput(input, context);
    } catch {
      scientificWorkerError("INVALID_EXECUTION_INPUT");
    }
    if (control.signal.aborted) scientificWorkerError("SESSION_ABORTED");
    return {
      version: SCIENTIFIC_WORKER_LAUNCH_VERSION,
      input,
      publication: {
        executionId: context.executionId,
        resultObjectKey: context.resultObjectKey,
        owner: { ...context.owner },
        lease: { ...context.lease },
      },
    };
  }

  async handleMessage(
    session: NodeWorkerSessionV1,
    message: unknown,
  ): Promise<void> {
    if (session.signal.aborted) scientificWorkerError("SESSION_ABORTED");
    if (isRecord(message) && message.type === "failed") {
      assertWorkerFailure(message, session.executionId);
      this.#recordFailure(message.code);
      this.#bindings.delete(session.childId);
      return;
    }
    if (isRecord(message) && message.type === "artifact-put-request") {
      await this.#handleArtifactPut(session, message);
      return;
    }
    if (isRecord(message) && message.type === "publication-request") {
      await this.#handlePublication(session, message);
      return;
    }
    scientificWorkerError("INVALID_WORKER_MESSAGE");
  }

  snapshot(): ScientificSessionAdapterSnapshotV1 {
    return Object.freeze({
      version: "3dena.compute-scientific-session-snapshot.v1" as const,
      activeBindings: this.#bindings.size,
      totalFailures: this.#totalFailures,
      failures: [...this.#failureCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([code, count]) => Object.freeze({ code, count })),
    });
  }

  async #handleArtifactPut(
    session: NodeWorkerSessionV1,
    message: Record<string, unknown>,
  ): Promise<void> {
    assertArtifactPutRequest(message, session.context);
    if (
      message.bytes.byteLength > this.#maxResultBytes ||
      message.object.byteLength > this.#maxResultBytes
    ) {
      scientificWorkerError("ARTIFACT_TOO_LARGE");
    }
    if (
      message.bytes.byteLength !== message.object.byteLength ||
      sha256(message.bytes) !== message.object.sha256
    ) {
      scientificWorkerError("ARTIFACT_CHECKSUM_MISMATCH");
    }
    assertArtifactBinding(message.bytes, session);
    const existingBinding = this.#bindings.get(session.childId);
    if (
      existingBinding !== undefined &&
      !descriptorsEqual(existingBinding.descriptor, message.object)
    ) {
      scientificWorkerError("IMMUTABLE_ARTIFACT_CONFLICT");
    }
    let stored;
    let observed;
    try {
      stored = await this.#resultStore.putImmutable(
        message.object.key,
        message.bytes,
      );
      observed = await this.#resultStore.head(message.object.key);
    } catch {
      scientificWorkerError("STORE_OPERATION_FAILED");
    }
    if (
      session.signal.aborted ||
      !descriptorsEqual(stored.descriptor, message.object) ||
      observed === null ||
      !descriptorsEqual(observed, message.object)
    ) {
      scientificWorkerError(
        session.signal.aborted
          ? "SESSION_ABORTED"
          : "IMMUTABLE_ARTIFACT_CONFLICT",
      );
    }
    if (existingBinding === undefined) {
      this.#bindings.set(session.childId, { descriptor: message.object });
      session.signal.addEventListener(
        "abort",
        () => {
          this.#bindings.delete(session.childId);
        },
        { once: true },
      );
    }
    await session.send({
      version: SCIENTIFIC_ARTIFACT_PUT_ACK_VERSION,
      protocolVersion: SCIENTIFIC_WORKER_PROTOCOL_VERSION,
      type: "artifact-put-ack",
      executionId: session.executionId,
      object: { ...message.object },
    });
  }

  async #handlePublication(
    session: NodeWorkerSessionV1,
    message: Record<string, unknown>,
  ): Promise<void> {
    assertPublicationRequest(message, session.context);
    const binding = this.#bindings.get(session.childId);
    if (
      binding === undefined ||
      !descriptorsEqual(binding.descriptor, message.object)
    ) {
      scientificWorkerError("INVALID_WORKER_MESSAGE");
    }
    if (binding.publicationReceipt === undefined) {
      let receipt;
      try {
        receipt = await this.#publisher.publish(message, session.signal);
        assertPublicationReceipt(receipt, message);
      } catch {
        scientificWorkerError("PUBLICATION_RECEIPT_MISMATCH");
      }
      if (session.signal.aborted) scientificWorkerError("SESSION_ABORTED");
      binding.publicationReceipt = structuredClone(receipt);
    }
    await session.send({
      version: SCIENTIFIC_PUBLICATION_ACK_VERSION,
      protocolVersion: SCIENTIFIC_WORKER_PROTOCOL_VERSION,
      type: "publication-ack",
      receipt: structuredClone(binding.publicationReceipt),
    });
  }

  #recordFailure(code: ScientificWorkerFailureCodeV1): void {
    if (this.#totalFailures < Number.MAX_SAFE_INTEGER) this.#totalFailures += 1;
    const current = this.#failureCounts.get(code) ?? 0;
    if (current < Number.MAX_SAFE_INTEGER) {
      this.#failureCounts.set(code, current + 1);
    }
  }
}
