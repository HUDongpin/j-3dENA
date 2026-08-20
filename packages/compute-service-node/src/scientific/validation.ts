import {
  ANALYSIS_CONTRACT_VERSION_V1,
  ANALYSIS_EXECUTION_DATASET_VERSION_V2,
  assertAnalysisTaskV1,
  assertDatasetReceiptV1,
  type AnalysisExecutionDataset,
} from "@3dena/analysis";
import {
  COMPUTE_LEASE_VERSION,
  COMPUTE_TASK_OWNER_CONTRACT_VERSION,
  COMPUTE_TASK_REQUEST_VERSION,
  type ImmutableObjectDescriptor,
  type LeaseTokenV1,
  type ProcessLaunchContextV1,
  type TaskOwnerV1 as ComputeTaskOwnerV1,
} from "@3dena/compute-service-core";

import { NODE_COMPUTE_IPC_PROTOCOL_VERSION } from "../contracts";
import {
  SCIENTIFIC_ARTIFACT_PUT_ACK_VERSION,
  SCIENTIFIC_ARTIFACT_PUT_REQUEST_VERSION,
  SCIENTIFIC_EXECUTION_INPUT_VERSION,
  SCIENTIFIC_PUBLICATION_ACK_VERSION,
  SCIENTIFIC_PUBLICATION_RECEIPT_VERSION,
  SCIENTIFIC_PUBLICATION_REQUEST_VERSION,
  SCIENTIFIC_WORKER_FAILURE_VERSION,
  SCIENTIFIC_WORKER_LAUNCH_VERSION,
  SCIENTIFIC_WORKER_PROTOCOL_VERSION,
  type ScientificArtifactPutAckV1,
  type ScientificArtifactPutRequestV1,
  type ScientificExecutionInputV1,
  type ScientificPublicationAckV1,
  type ScientificPublicationReceiptV1,
  type ScientificPublicationRequestV1,
  type ScientificWorkerFailureCodeV1,
  type ScientificWorkerFailureV1,
  type ScientificWorkerLaunchPayloadV1,
} from "./contracts";
import { scientificWorkerError } from "./errors";

const SHA256 = /^[a-f0-9]{64}$/u;
const WORKER_FAILURE_CODES = new Set<ScientificWorkerFailureCodeV1>([
  "INVALID_INPUT",
  "DEADLINE_EXCEEDED",
  "EXECUTION_FAILED",
  "ARTIFACT_STORE_FAILED",
  "PUBLICATION_FAILED",
  "PROTOCOL_FAILED",
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function safeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function assertObjectDescriptor(
  value: unknown,
): asserts value is ImmutableObjectDescriptor {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["key", "sha256", "byteLength"]) ||
    !nonEmptyString(value.key) ||
    typeof value.sha256 !== "string" ||
    !SHA256.test(value.sha256) ||
    !safeNonNegativeInteger(value.byteLength)
  ) {
    scientificWorkerError("INVALID_WORKER_MESSAGE");
  }
}

export function assertComputeOwner(
  value: unknown,
): asserts value is ComputeTaskOwnerV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "contractVersion",
      "datasetHash",
      "specHash",
      "runId",
      "taskId",
    ]) ||
    value.contractVersion !== COMPUTE_TASK_OWNER_CONTRACT_VERSION ||
    typeof value.datasetHash !== "string" ||
    !SHA256.test(value.datasetHash) ||
    typeof value.specHash !== "string" ||
    !SHA256.test(value.specHash) ||
    !nonEmptyString(value.runId) ||
    !nonEmptyString(value.taskId)
  ) {
    scientificWorkerError("INVALID_WORKER_MESSAGE");
  }
}

export function assertLease(value: unknown): asserts value is LeaseTokenV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "leaseId",
      "holderId",
      "epoch",
      "issuedAtMs",
      "expiresAtMs",
    ]) ||
    value.version !== COMPUTE_LEASE_VERSION ||
    !nonEmptyString(value.leaseId) ||
    !nonEmptyString(value.holderId) ||
    !safeNonNegativeInteger(value.epoch) ||
    !safeNonNegativeInteger(value.issuedAtMs) ||
    !safeNonNegativeInteger(value.expiresAtMs)
  ) {
    scientificWorkerError("INVALID_WORKER_MESSAGE");
  }
}

export function descriptorsEqual(
  left: ImmutableObjectDescriptor,
  right: ImmutableObjectDescriptor,
): boolean {
  return (
    left.key === right.key &&
    left.sha256 === right.sha256 &&
    left.byteLength === right.byteLength
  );
}

export function ownersEqual(
  left: ComputeTaskOwnerV1,
  right: ComputeTaskOwnerV1,
): boolean {
  return (
    left.contractVersion === right.contractVersion &&
    left.datasetHash === right.datasetHash &&
    left.specHash === right.specHash &&
    left.runId === right.runId &&
    left.taskId === right.taskId
  );
}

export function leasesEqual(left: LeaseTokenV1, right: LeaseTokenV1): boolean {
  return (
    left.version === right.version &&
    left.leaseId === right.leaseId &&
    left.holderId === right.holderId &&
    left.epoch === right.epoch &&
    left.issuedAtMs === right.issuedAtMs &&
    left.expiresAtMs === right.expiresAtMs
  );
}

function assertDataset(value: unknown): asserts value is AnalysisExecutionDataset {
  if (
    !isRecord(value) ||
    (value.schemaVersion !== "3dena.analysis-execution-dataset.v1" &&
      value.schemaVersion !== ANALYSIS_EXECUTION_DATASET_VERSION_V2) ||
    !Object.hasOwn(value, "receipt") ||
    !Object.hasOwn(value, "specHash") ||
    !Object.hasOwn(value, "buildId") ||
    typeof value.specHash !== "string" ||
    !SHA256.test(value.specHash) ||
    !nonEmptyString(value.buildId) ||
    (value.generatedAt !== undefined &&
      (!nonEmptyString(value.generatedAt) ||
        Number.isNaN(Date.parse(value.generatedAt))))
  ) {
    scientificWorkerError("INVALID_EXECUTION_INPUT");
  }
  try {
    assertDatasetReceiptV1(value.receipt);
  } catch {
    scientificWorkerError("INVALID_EXECUTION_INPUT");
  }
}

export function assertScientificExecutionInput(
  value: unknown,
  context?: ProcessLaunchContextV1,
): asserts value is ScientificExecutionInputV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["version", "source", "dataset", "task"]) ||
    value.version !== SCIENTIFIC_EXECUTION_INPUT_VERSION
  ) {
    scientificWorkerError("INVALID_EXECUTION_INPUT");
  }
  try {
    assertObjectDescriptor(value.source);
    assertDataset(value.dataset);
    assertAnalysisTaskV1(value.task);
  } catch {
    scientificWorkerError("INVALID_EXECUTION_INPUT");
  }
  if (
    value.task.owner.contractVersion !== ANALYSIS_CONTRACT_VERSION_V1 ||
    value.dataset.receipt.sha256 !== value.task.owner.datasetHash ||
    value.dataset.specHash !== value.task.owner.specHash
  ) {
    scientificWorkerError("INVALID_EXECUTION_INPUT");
  }
  if (context !== undefined) {
    if (
      !descriptorsEqual(value.source, context.request.input) ||
      context.owner.datasetHash !== value.task.owner.datasetHash ||
      context.owner.specHash !== value.task.owner.specHash ||
      context.owner.runId !== value.task.owner.runId ||
      context.owner.taskId !== value.task.owner.taskId ||
      context.request.taskKind !== value.task.kind ||
      context.request.deadlineAtMs !== value.task.deadlineEpochMilliseconds
    ) {
      scientificWorkerError("INVALID_EXECUTION_INPUT");
    }
  }
}

export function assertScientificLaunchPayload(
  value: unknown,
  context: ProcessLaunchContextV1,
): asserts value is ScientificWorkerLaunchPayloadV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["version", "input", "publication"]) ||
    value.version !== SCIENTIFIC_WORKER_LAUNCH_VERSION ||
    !isRecord(value.publication) ||
    !hasExactKeys(value.publication, [
      "executionId",
      "resultObjectKey",
      "owner",
      "lease",
    ]) ||
    value.publication.executionId !== context.executionId ||
    value.publication.resultObjectKey !== context.resultObjectKey
  ) {
    scientificWorkerError("INVALID_EXECUTION_INPUT");
  }
  assertScientificExecutionInput(value.input, context);
  try {
    assertComputeOwner(value.publication.owner);
    assertLease(value.publication.lease);
  } catch {
    scientificWorkerError("INVALID_EXECUTION_INPUT");
  }
  if (
    !ownersEqual(value.publication.owner, context.owner) ||
    !leasesEqual(value.publication.lease, context.lease)
  ) {
    scientificWorkerError("INVALID_EXECUTION_INPUT");
  }
}

export function assertBaseLaunchMessage(
  value: unknown,
): asserts value is Readonly<{
  version: typeof NODE_COMPUTE_IPC_PROTOCOL_VERSION;
  type: "launch";
  context: ProcessLaunchContextV1;
  payload: ScientificWorkerLaunchPayloadV1;
}> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["version", "type", "context", "payload"]) ||
    value.version !== NODE_COMPUTE_IPC_PROTOCOL_VERSION ||
    value.type !== "launch" ||
    !isRecord(value.context)
  ) {
    scientificWorkerError("INVALID_EXECUTION_INPUT");
  }
  const context = value.context;
  if (
    !hasExactKeys(context, [
      "owner",
      "taskRef",
      "request",
      "lease",
      "executionId",
      "resultObjectKey",
    ]) ||
    !nonEmptyString(context.taskRef) ||
    !nonEmptyString(context.executionId) ||
    !nonEmptyString(context.resultObjectKey) ||
    !isRecord(context.request)
  ) {
    scientificWorkerError("INVALID_EXECUTION_INPUT");
  }
  try {
    assertComputeOwner(context.owner);
    assertLease(context.lease);
    if (
      !hasExactKeys(context.request, [
        "version",
        "owner",
        "taskKind",
        "input",
        "deadlineAtMs",
        "expiresAtMs",
      ]) ||
      context.request.version !== COMPUTE_TASK_REQUEST_VERSION ||
      !nonEmptyString(context.request.taskKind) ||
      !safeNonNegativeInteger(context.request.deadlineAtMs) ||
      !safeNonNegativeInteger(context.request.expiresAtMs) ||
      context.request.expiresAtMs < context.request.deadlineAtMs
    ) {
      scientificWorkerError("INVALID_EXECUTION_INPUT");
    }
    assertComputeOwner(context.request.owner);
    assertObjectDescriptor(context.request.input);
    if (!ownersEqual(context.request.owner, context.owner)) {
      scientificWorkerError("INVALID_EXECUTION_INPUT");
    }
  } catch {
    scientificWorkerError("INVALID_EXECUTION_INPUT");
  }
  assertScientificLaunchPayload(value.payload, context as unknown as ProcessLaunchContextV1);
}

function assertMessageBinding(
  message: Record<string, unknown>,
  context: ProcessLaunchContextV1,
): void {
  if (message.executionId !== context.executionId) {
    scientificWorkerError("INVALID_WORKER_MESSAGE");
  }
  assertComputeOwner(message.owner);
  assertLease(message.lease);
  assertObjectDescriptor(message.object);
  if (
    !ownersEqual(message.owner, context.owner) ||
    !leasesEqual(message.lease, context.lease) ||
    message.object.key !== context.resultObjectKey
  ) {
    scientificWorkerError("INVALID_WORKER_MESSAGE");
  }
}

export function assertArtifactPutRequest(
  value: unknown,
  context: ProcessLaunchContextV1,
): asserts value is ScientificArtifactPutRequestV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "protocolVersion",
      "type",
      "executionId",
      "owner",
      "lease",
      "object",
      "bytes",
    ]) ||
    value.version !== SCIENTIFIC_ARTIFACT_PUT_REQUEST_VERSION ||
    value.protocolVersion !== SCIENTIFIC_WORKER_PROTOCOL_VERSION ||
    value.type !== "artifact-put-request" ||
    !(value.bytes instanceof Uint8Array)
  ) {
    scientificWorkerError("INVALID_WORKER_MESSAGE");
  }
  assertMessageBinding(value, context);
}

export function assertPublicationRequest(
  value: unknown,
  context: ProcessLaunchContextV1,
): asserts value is ScientificPublicationRequestV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "protocolVersion",
      "type",
      "executionId",
      "owner",
      "lease",
      "object",
    ]) ||
    value.version !== SCIENTIFIC_PUBLICATION_REQUEST_VERSION ||
    value.protocolVersion !== SCIENTIFIC_WORKER_PROTOCOL_VERSION ||
    value.type !== "publication-request"
  ) {
    scientificWorkerError("INVALID_WORKER_MESSAGE");
  }
  assertMessageBinding(value, context);
}

export function assertWorkerFailure(
  value: unknown,
  executionId: string,
): asserts value is ScientificWorkerFailureV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "protocolVersion",
      "type",
      "executionId",
      "code",
    ]) ||
    value.version !== SCIENTIFIC_WORKER_FAILURE_VERSION ||
    value.protocolVersion !== SCIENTIFIC_WORKER_PROTOCOL_VERSION ||
    value.type !== "failed" ||
    value.executionId !== executionId ||
    !WORKER_FAILURE_CODES.has(value.code as ScientificWorkerFailureCodeV1)
  ) {
    scientificWorkerError("INVALID_WORKER_MESSAGE");
  }
}

export function assertArtifactPutAck(
  value: unknown,
  executionId: string,
  descriptor: ImmutableObjectDescriptor,
): asserts value is ScientificArtifactPutAckV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "protocolVersion",
      "type",
      "executionId",
      "object",
    ]) ||
    value.version !== SCIENTIFIC_ARTIFACT_PUT_ACK_VERSION ||
    value.protocolVersion !== SCIENTIFIC_WORKER_PROTOCOL_VERSION ||
    value.type !== "artifact-put-ack" ||
    value.executionId !== executionId
  ) {
    scientificWorkerError("INVALID_WORKER_MESSAGE");
  }
  assertObjectDescriptor(value.object);
  if (!descriptorsEqual(value.object, descriptor)) {
    scientificWorkerError("INVALID_WORKER_MESSAGE");
  }
}

export function assertPublicationReceipt(
  value: unknown,
  request: ScientificPublicationRequestV1,
): asserts value is ScientificPublicationReceiptV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "accepted",
      "executionId",
      "owner",
      "leaseId",
      "leaseEpoch",
      "object",
      "publishedAtMs",
    ]) ||
    value.version !== SCIENTIFIC_PUBLICATION_RECEIPT_VERSION ||
    value.accepted !== true ||
    value.executionId !== request.executionId ||
    value.leaseId !== request.lease.leaseId ||
    value.leaseEpoch !== request.lease.epoch ||
    !safeNonNegativeInteger(value.publishedAtMs)
  ) {
    scientificWorkerError("PUBLICATION_RECEIPT_MISMATCH");
  }
  assertComputeOwner(value.owner);
  assertObjectDescriptor(value.object);
  if (
    !ownersEqual(value.owner, request.owner) ||
    !descriptorsEqual(value.object, request.object)
  ) {
    scientificWorkerError("PUBLICATION_RECEIPT_MISMATCH");
  }
}

export function assertPublicationAck(
  value: unknown,
  request: ScientificPublicationRequestV1,
): asserts value is ScientificPublicationAckV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "version",
      "protocolVersion",
      "type",
      "receipt",
    ]) ||
    value.version !== SCIENTIFIC_PUBLICATION_ACK_VERSION ||
    value.protocolVersion !== SCIENTIFIC_WORKER_PROTOCOL_VERSION ||
    value.type !== "publication-ack"
  ) {
    scientificWorkerError("INVALID_WORKER_MESSAGE");
  }
  assertPublicationReceipt(value.receipt, request);
}
