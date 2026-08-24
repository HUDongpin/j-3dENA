import { createHash } from "node:crypto";

import { ANALYSIS_CONTRACT_VERSION_V1 } from "@3dena/analysis";
import type { ProcessLaunchContextV1 } from "@3dena/compute-service-core";

import {
  DEFAULT_MAX_SCIENTIFIC_INPUT_BYTES,
  HARD_MAX_SCIENTIFIC_ARTIFACT_BYTES,
  SCIENTIFIC_EXECUTION_INPUT_VERSION,
  SCIENTIFIC_INPUT_PROVIDER_VERSION,
  SCIENTIFIC_JSON_INPUT_PROVIDER_OPTIONS_VERSION,
  SCIENTIFIC_LONGITUDINAL_EXECUTION_INPUT_VERSION,
  SCIENTIFIC_LONGITUDINAL_TASK_KIND_V2,
  SCIENTIFIC_STORED_LONGITUDINAL_INPUT_VERSION,
  SCIENTIFIC_STORED_INPUT_VERSION,
  type ScientificExecutionInputV1,
  type ScientificInputProviderV1,
  type ScientificJsonInputProviderOptionsV1,
  type ScientificLongitudinalExecutionInputV2,
  type ScientificStoredLongitudinalInputV2,
  type ScientificWorkerExecutionInput,
} from "./contracts";
import { scientificWorkerError } from "./errors";
import {
  assertScientificExecutionInput,
  bindAndHashPersistentLongitudinalRequestV2,
  hasExactKeys,
  isRecord,
} from "./validation";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function storedAnalysisOwnerMatches(
  value: unknown,
  context: ProcessLaunchContextV1,
): boolean {
  return isRecord(value)
    && hasExactKeys(value, ["contractVersion", "datasetHash", "specHash", "runId", "taskId"])
    && value.contractVersion === ANALYSIS_CONTRACT_VERSION_V1
    && value.datasetHash === context.owner.datasetHash
    && value.specHash === context.owner.specHash
    && value.runId === context.owner.runId
    && value.taskId === context.owner.taskId;
}

export class JsonObjectStoreScientificInputProvider
  implements ScientificInputProviderV1
{
  readonly version = SCIENTIFIC_INPUT_PROVIDER_VERSION;
  readonly #objectStore: ScientificJsonInputProviderOptionsV1["objectStore"];
  readonly #maxInputBytes: number;

  constructor(options: ScientificJsonInputProviderOptionsV1) {
    if (
      !isRecord(options) ||
      !Object.keys(options).every((key) =>
        ["version", "objectStore", "maxInputBytes"].includes(key),
      ) ||
      options.version !== SCIENTIFIC_JSON_INPUT_PROVIDER_OPTIONS_VERSION ||
      !isRecord(options.objectStore) ||
      typeof options.objectStore.head !== "function" ||
      typeof options.objectStore.get !== "function"
    ) {
      scientificWorkerError("INVALID_CONFIGURATION");
    }
    const maxInputBytes =
      options.maxInputBytes ?? DEFAULT_MAX_SCIENTIFIC_INPUT_BYTES;
    if (
      !Number.isSafeInteger(maxInputBytes) ||
      maxInputBytes < 1 ||
      maxInputBytes > HARD_MAX_SCIENTIFIC_ARTIFACT_BYTES
    ) {
      scientificWorkerError("INVALID_CONFIGURATION");
    }
    this.#objectStore = options.objectStore;
    this.#maxInputBytes = maxInputBytes;
  }

  async load(
    context: ProcessLaunchContextV1,
    signal: AbortSignal,
  ): Promise<ScientificWorkerExecutionInput> {
    if (signal.aborted) scientificWorkerError("SESSION_ABORTED");
    const expected = context.request.input;
    if (expected.byteLength > this.#maxInputBytes) {
      scientificWorkerError("ARTIFACT_TOO_LARGE");
    }
    let head;
    let bytes;
    try {
      [head, bytes] = await Promise.all([
        this.#objectStore.head(expected.key),
        this.#objectStore.get(expected.key),
      ]);
    } catch {
      scientificWorkerError("STORE_OPERATION_FAILED");
    }
    if (signal.aborted) scientificWorkerError("SESSION_ABORTED");
    if (
      head === null ||
      bytes === null ||
      head.key !== expected.key ||
      head.sha256 !== expected.sha256 ||
      head.byteLength !== expected.byteLength ||
      bytes.byteLength !== expected.byteLength ||
      sha256(bytes) !== expected.sha256
    ) {
      scientificWorkerError("INVALID_EXECUTION_INPUT");
    }
    let parsed: unknown;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      parsed = JSON.parse(text);
    } catch {
      scientificWorkerError("INVALID_EXECUTION_INPUT");
    }
    if (!isRecord(parsed)) {
      scientificWorkerError("INVALID_EXECUTION_INPUT");
    }
    if (parsed.version === SCIENTIFIC_STORED_LONGITUDINAL_INPUT_VERSION) {
      if (
        !hasExactKeys(parsed, [
          "version",
          "kind",
          "owner",
          "deadlineAtMs",
          "request",
        ]) ||
        parsed.kind !== SCIENTIFIC_LONGITUDINAL_TASK_KIND_V2 ||
        !storedAnalysisOwnerMatches(parsed.owner, context)
      ) scientificWorkerError("INVALID_EXECUTION_INPUT");
      const stored = parsed as unknown as ScientificStoredLongitudinalInputV2;
      const bound = await bindAndHashPersistentLongitudinalRequestV2(stored.request);
      const execution: ScientificLongitudinalExecutionInputV2 = {
        version: SCIENTIFIC_LONGITUDINAL_EXECUTION_INPUT_VERSION,
        kind: SCIENTIFIC_LONGITUDINAL_TASK_KIND_V2,
        source: {
          key: expected.key,
          sha256: expected.sha256,
          byteLength: expected.byteLength,
        },
        owner: { ...context.owner },
        deadlineAtMs: stored.deadlineAtMs,
        requestHash: bound.requestHash,
        request: bound.request,
      };
      assertScientificExecutionInput(execution, context);
      return structuredClone(execution);
    }
    if (
      !hasExactKeys(parsed, ["version", "dataset", "task"]) ||
      parsed.version !== SCIENTIFIC_STORED_INPUT_VERSION
    ) scientificWorkerError("INVALID_EXECUTION_INPUT");
    const execution: ScientificExecutionInputV1 = {
      version: SCIENTIFIC_EXECUTION_INPUT_VERSION,
      source: {
        key: expected.key,
        sha256: expected.sha256,
        byteLength: expected.byteLength,
      },
      dataset: parsed.dataset as ScientificExecutionInputV1["dataset"],
      task: parsed.task as ScientificExecutionInputV1["task"],
    };
    assertScientificExecutionInput(execution, context);
    return structuredClone(execution);
  }
}
