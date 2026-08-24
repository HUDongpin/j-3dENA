import {
  assertLongitudinalExecutionRequestV2,
  hashAnalysisValueV1,
  type AnalysisResult,
  type LongitudinalExecutionRequestV2,
  type TrajectoryInferenceTaskV2,
  type TrajectoryNetworkOverlayTaskV2,
  type TrajectoryPathTaskV2,
  type AnalysisExecutionDatasetV2,
  type TaskOwnerV1,
} from "@3dena/analysis";

import { canonicalStringify, cloneFrozen, sha256Bytes } from "./util";

export const LONGITUDINAL_COMPUTE_SUBMISSION_VERSION_V2 =
  "3dena.longitudinal-compute-submission.v2" as const;
export const LONGITUDINAL_COMPUTE_CAPABILITY_VERSION_V2 =
  "3dena.longitudinal-compute-capability.v2" as const;
export const LONGITUDINAL_COMPUTE_STATUS_URLS_VERSION_V2 =
  "3dena.longitudinal-compute-status-urls.v2" as const;
export const LONGITUDINAL_COMPUTE_STORED_INPUT_VERSION_V2 =
  "3dena.compute-scientific-stored-longitudinal-input.v2" as const;
export const LONGITUDINAL_COMPUTE_TASK_KIND_V2 =
  "longitudinal-analysis-v2" as const;
/** Exact maximum accepted by the production scientific input provider. */
export const MAX_LONGITUDINAL_STORED_INPUT_BYTES_V2 = 32 * 1024 * 1024;

const LOWER_SHA256 = /^[a-f0-9]{64}$/u;
const JENA_COMMIT = /^[a-f0-9]{40}$/u;
const OPAQUE_BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const PARTICIPANT_TOKEN = /^participant-[1-9][0-9]*-[a-f0-9]{32}$/u;
const UNIT_TOKEN = /^unit-[1-9][0-9]*-[a-f0-9]{32}$/u;
const STEP_TOKEN = /^step-[1-9][0-9]*-[a-f0-9]{32}$/u;
const FIXED_PROJECTION_SEMANTICS =
  "one immutable fitted jENA rotation; fixed projectIn full-space recovery; participant-period reduction before group-time centroids";
const FIXED_PROJECTION_DIAGNOSTIC =
  "Full-space coordinates were projected by jENA against the immutable successful-fit rotation; no ENA accumulation or rotation fit was repeated.";

export interface LongitudinalComputeSubmissionV2 {
  readonly schemaVersion: typeof LONGITUDINAL_COMPUTE_SUBMISSION_VERSION_V2;
  readonly dataset: AnalysisExecutionDatasetV2;
  readonly pathTask: TrajectoryPathTaskV2;
  readonly inferenceTask?: TrajectoryInferenceTaskV2;
  readonly networkOverlayTask?: TrajectoryNetworkOverlayTaskV2;
  readonly seed: number;
  readonly processingPolicyConfirmed: true;
}

/** Trusted runtime identity supplied by the approved service build, never by the caller. */
export interface ApprovedLongitudinalExecutionBuildV2 {
  readonly jenaVersion: string;
  readonly jenaCommit: string;
  readonly jenaTarballIntegrity: string;
  readonly sdkVersion: string;
  readonly buildId: string;
}

/** Capability-bearing response returned after durable job creation. */
export interface LongitudinalComputeCapabilityV2 {
  readonly schemaVersion: typeof LONGITUDINAL_COMPUTE_CAPABILITY_VERSION_V2;
  readonly jobId: string;
  readonly capabilityToken: string;
  readonly urls: LongitudinalComputeStatusUrlsV2;
  readonly expiresAt: string;
}

/** Route inventory is explicit so clients never synthesize control-plane URLs. */
export interface LongitudinalComputeStatusUrlsV2 {
  readonly schemaVersion: typeof LONGITUDINAL_COMPUTE_STATUS_URLS_VERSION_V2;
  readonly statusUrl: string;
  readonly eventsUrl: string;
  readonly resultUrl: string;
  readonly artifactUrl: string;
  readonly cancelUrl: string;
  readonly deleteUrl: string;
}

/**
 * Exact immutable object consumed by the dedicated scientific worker. The
 * caller never supplies this wrapper, its owner, or its hard deadline.
 */
export interface ScientificStoredLongitudinalInputV2 {
  readonly version: typeof LONGITUDINAL_COMPUTE_STORED_INPUT_VERSION_V2;
  readonly kind: typeof LONGITUDINAL_COMPUTE_TASK_KIND_V2;
  readonly owner: TaskOwnerV1;
  readonly deadlineAtMs: number;
  readonly request: LongitudinalExecutionRequestV2;
}

export interface MaterializedLongitudinalComputeSubmissionV2 {
  readonly canonicalRequest: LongitudinalExecutionRequestV2;
  readonly canonicalBytes: Readonly<Uint8Array>;
  readonly requestSha256: string;
  readonly byteLength: number;
}

export type LongitudinalComputeSubmissionErrorCodeV2 =
  | "INVALID_APPROVED_BUILD_IDENTITY"
  | "INVALID_LONGITUDINAL_TASK"
  | "INVALID_SUBMISSION"
  | "IMMUTABLE_BINDING_MISMATCH"
  | "PRIVACY_BOUNDARY_VIOLATION"
  | "PROCESSING_POLICY_NOT_CONFIRMED"
  | "SOURCE_HASH_MISMATCH"
  | "UNAPPROVED_SOURCE_BUILD";

export class LongitudinalComputeSubmissionErrorV2 extends Error {
  readonly code: LongitudinalComputeSubmissionErrorCodeV2;
  readonly path: string;

  constructor(code: LongitudinalComputeSubmissionErrorCodeV2, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "LongitudinalComputeSubmissionErrorV2";
    this.code = code;
    this.path = path;
  }
}

function reject(
  code: LongitudinalComputeSubmissionErrorCodeV2,
  path: string,
  message: string,
): never {
  throw new LongitudinalComputeSubmissionErrorV2(code, path, message);
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    reject("INVALID_SUBMISSION", path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function exactFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find((field) => !allowedSet.has(field));
  if (unknown) reject("INVALID_SUBMISSION", path, `contains unknown field ${JSON.stringify(unknown)}`);
  const missing = required.find((field) => !Object.hasOwn(value, field));
  if (missing) reject("INVALID_SUBMISSION", path, `is missing required field ${JSON.stringify(missing)}`);
}

export function assertApprovedLongitudinalExecutionBuildV2(
  value: unknown,
): asserts value is ApprovedLongitudinalExecutionBuildV2 {
  const build = objectAt(value, "approvedBuild");
  const fields = ["jenaVersion", "jenaCommit", "jenaTarballIntegrity", "sdkVersion", "buildId"] as const;
  exactFields(build, fields, fields, "approvedBuild");
  for (const field of fields) {
    if (typeof build[field] !== "string" || build[field].trim() === "") {
      reject("INVALID_APPROVED_BUILD_IDENTITY", `approvedBuild.${field}`, "must be non-empty");
    }
  }
  if (!JENA_COMMIT.test(build.jenaCommit as string)) {
    reject("INVALID_APPROVED_BUILD_IDENTITY", "approvedBuild.jenaCommit", "must be a lowercase 40-character commit");
  }
  if (!OPAQUE_BUILD_ID.test(build.buildId as string)) {
    reject("INVALID_APPROVED_BUILD_IDENTITY", "approvedBuild.buildId", "must be an opaque build identifier");
  }
}

function scalarEquals(left: unknown, right: unknown): boolean {
  return Object.is(left, right);
}

function scalarArraysEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => scalarEquals(value, right[index]));
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function privacyReject(path: string, message: string): never {
  return reject("PRIVACY_BOUNDARY_VIOLATION", path, message);
}

function tokenFromCanonical(
  value: string,
  prefix: string,
  pattern: RegExp,
  path: string,
): string {
  if (!value.startsWith(prefix)) privacyReject(path, "must use the service-approved opaque identity namespace");
  const token = value.slice(prefix.length);
  if (!pattern.test(token)) privacyReject(path, "contains a malformed opaque identity token");
  return token;
}

function assertOpaquePointIdentities(
  result: AnalysisResult,
  pathTask: TrajectoryPathTaskV2,
): void {
  const groupColumn = pathTask.runSpec.groupColumn;
  const timeColumn = pathTask.runSpec.timeColumn;
  result.points.forEach((point, index) => {
    const path = `submission.dataset.sourceResult.result.points[${index}]`;
    if (!point.group || !point.time || !point.step) {
      privacyReject(path, "must retain group/time semantics while removing raw entity identities");
    }
    if (!stringArraysEqual(point.participantLabel.columns, pathTask.runSpec.participantColumns)) {
      privacyReject(`${path}.participantLabel.columns`, "does not match the declared participant mapping");
    }
    const participantToken = tokenFromCanonical(
      point.participantLabel.canonical,
      "opaque-participant:",
      PARTICIPANT_TOKEN,
      `${path}.participantLabel.canonical`,
    );
    if (point.participantLabel.display !== "Opaque participant") {
      privacyReject(`${path}.participantLabel.display`, "must be the generic Opaque participant label");
    }
    if (point.participantLabel.values.length !== point.participantLabel.columns.length
      || point.participantLabel.values[0] !== participantToken
      || point.participantLabel.values.slice(1).some((value) => value !== "@opaque-component")) {
      privacyReject(`${path}.participantLabel.values`, "contains a raw participant identity component");
    }

    const unitToken = tokenFromCanonical(
      point.unit.canonical,
      "opaque-unit:",
      UNIT_TOKEN,
      `${path}.unit.canonical`,
    );
    if (point.unit.display !== "Opaque unit") {
      privacyReject(`${path}.unit.display`, "must be the generic Opaque unit label");
    }
    if (point.unit.values.length !== point.unit.columns.length) {
      privacyReject(`${path}.unit.values`, "must align with the unit columns");
    }
    let unitTokenObserved = false;
    point.unit.columns.forEach((column, componentIndex) => {
      const value = point.unit.values[componentIndex];
      if (groupColumn !== null && column === groupColumn) {
        if (!scalarEquals(value, point.group!.value)) {
          privacyReject(`${path}.unit.values[${componentIndex}]`, "must retain only the declared group value");
        }
        return;
      }
      if (!unitTokenObserved) {
        if (value !== unitToken) privacyReject(`${path}.unit.values[${componentIndex}]`, "contains a raw unit identity component");
        unitTokenObserved = true;
      } else if (value !== "@opaque-unit-component") {
        privacyReject(`${path}.unit.values[${componentIndex}]`, "contains a raw unit identity component");
      }
    });
    if (!unitTokenObserved) privacyReject(`${path}.unit.values`, "must contain one opaque unit token outside the group column");

    const stepToken = tokenFromCanonical(
      point.step.canonical,
      "opaque-step:",
      STEP_TOKEN,
      `${path}.step.canonical`,
    );
    if (point.step.display !== "Opaque step") {
      privacyReject(`${path}.step.display`, "must be the generic Opaque step label");
    }
    if (point.step.values.length !== point.step.columns.length) {
      privacyReject(`${path}.step.values`, "must align with the step columns");
    }
    let stepTokenObserved = false;
    let timeObserved = false;
    point.step.columns.forEach((column, componentIndex) => {
      const value = point.step!.values[componentIndex];
      if (column === timeColumn) {
        if (timeObserved || !scalarEquals(value, point.time!.value)) {
          privacyReject(`${path}.step.values[${componentIndex}]`, "must retain exactly the declared time value");
        }
        timeObserved = true;
        return;
      }
      if (!stepTokenObserved) {
        if (value !== stepToken) privacyReject(`${path}.step.values[${componentIndex}]`, "contains a raw step identity component");
        stepTokenObserved = true;
      } else if (value !== "@opaque-step-component") {
        privacyReject(`${path}.step.values[${componentIndex}]`, "contains a raw step identity component");
      }
    });
    if (!timeObserved) privacyReject(`${path}.step.columns`, "must contain the declared time column");

    if (point.id.display !== "Opaque fitted point"
      || point.id.canonical !== `opaque-point:${unitToken}:${stepToken}`
      || !stringArraysEqual(point.id.columns, [...point.unit.columns, ...point.step.columns])
      || !scalarArraysEqual(point.id.values, [...point.unit.values, ...point.step.values])) {
      privacyReject(`${path}.id`, "must be the exact opaque unit-step identity composition");
    }
  });
}

function assertPrivacyMinimizedSource(
  result: AnalysisResult,
  pathTask: TrajectoryPathTaskV2,
): void {
  const rowCounts = result.accumulation.rowCounts;
  if (rowCounts.rowKeys.length !== 0 || rowCounts.values.length !== 0 || result.summary.rowCountRows !== 0) {
    privacyReject(
      "submission.dataset.sourceResult.result.accumulation.rowCounts",
      "must be empty; raw coded row counts cannot enter durable longitudinal compute",
    );
  }
  const trajectory = result.trajectory;
  if (!trajectory) {
    privacyReject("submission.dataset.sourceResult.result.trajectory", "must retain the fitted group/time inventory");
  }
  if (trajectory.participantPeriods.length !== 0 || result.summary.participantPeriods !== 0) {
    privacyReject(
      "submission.dataset.sourceResult.result.trajectory.participantPeriods",
      "must be empty before service-side participant-period reduction",
    );
  }
  if (trajectory.centroids.length !== 0 || result.summary.trajectoryCentroids !== 0) {
    privacyReject(
      "submission.dataset.sourceResult.result.trajectory.centroids",
      "must be empty before service-side centroid calculation",
    );
  }
  if (trajectory.paths.some((path) => path.steps.some((step) => step.centroidIndex !== null))) {
    privacyReject(
      "submission.dataset.sourceResult.result.trajectory.paths",
      "must not retain precomputed centroid references",
    );
  }

  const metadataField = pathTask.runSpec.estimand.kind === "weighted-participant"
    ? pathTask.runSpec.estimand.metadataField
    : null;
  result.points.forEach((point, index) => {
    const fields = Object.keys(point.metadata);
    if (metadataField === null) {
      if (fields.length !== 0) {
        privacyReject(`submission.dataset.sourceResult.result.points[${index}].metadata`, "must be empty for an equal-participant estimand");
      }
      return;
    }
    if (fields.length !== 1 || fields[0] !== metadataField) {
      privacyReject(
        `submission.dataset.sourceResult.result.points[${index}].metadata`,
        "may contain only the weighted-estimand binding field",
      );
    }
    const weight = point.metadata[metadataField];
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) {
      privacyReject(
        `submission.dataset.sourceResult.result.points[${index}].metadata`,
        "weighted-estimand metadata must be finite and strictly positive",
      );
    }
  });

  assertOpaquePointIdentities(result, pathTask);
  if (result.accumulation.modelCounts.rowKeys.length !== result.points.length) {
    privacyReject("submission.dataset.sourceResult.result.accumulation.modelCounts.rowKeys", "must align one-to-one with opaque fitted points");
  }
  result.accumulation.modelCounts.rowKeys.forEach((rowKey, index) => {
    const pointId = result.points[index]!.id;
    if (rowKey.canonical !== pointId.canonical
      || rowKey.display !== pointId.display
      || !stringArraysEqual(rowKey.columns, pointId.columns)
      || !scalarArraysEqual(rowKey.values, pointId.values)) {
      privacyReject(
        `submission.dataset.sourceResult.result.accumulation.modelCounts.rowKeys[${index}]`,
        "must reuse the exact opaque point identity",
      );
    }
  });
}

function assertFixedProjectionSource(
  result: AnalysisResult,
  dataset: AnalysisExecutionDatasetV2,
  approvedBuild: ApprovedLongitudinalExecutionBuildV2,
): void {
  if (dataset.buildId !== approvedBuild.buildId
    || result.provenance.jenaVersion !== approvedBuild.jenaVersion
    || result.provenance.jenaCommit !== approvedBuild.jenaCommit
    || result.provenance.adapterVersion !== approvedBuild.sdkVersion) {
    reject(
      "UNAPPROVED_SOURCE_BUILD",
      "submission.dataset.sourceResult.result.provenance",
      "must match the service-approved build identity",
    );
  }
  if (result.provenance.adapter !== "@3dena/analysis"
    || result.provenance.jenaPackage !== "jena-js"
    || result.provenance.resultSemantics !== FIXED_PROJECTION_SEMANTICS
    || result.provenance.resolvedConfig.model === "EndPoint") {
    reject(
      "PRIVACY_BOUNDARY_VIOLATION",
      "submission.dataset.sourceResult.result.provenance",
      "must be the raw-jENA fixed-rotation longitudinal projection contract",
    );
  }
  if (result.diagnostics.length !== 1
    || result.diagnostics[0]?.code !== "FITTED_JENA_FIXED_ROTATION_ADAPTER_V2"
    || result.diagnostics[0]?.severity !== "info"
    || result.diagnostics[0]?.message !== FIXED_PROJECTION_DIAGNOSTIC
    || result.diagnostics[0]?.path !== "provenance.resultSemantics") {
    reject(
      "PRIVACY_BOUNDARY_VIOLATION",
      "submission.dataset.sourceResult.result.diagnostics",
      "must contain only the fixed-jENA-projection audit receipt",
    );
  }
}

function assertSubmissionShape(value: unknown): asserts value is LongitudinalComputeSubmissionV2 {
  const submission = objectAt(value, "submission");
  exactFields(
    submission,
    [
      "schemaVersion",
      "dataset",
      "pathTask",
      "inferenceTask",
      "networkOverlayTask",
      "seed",
      "processingPolicyConfirmed",
    ],
    ["schemaVersion", "dataset", "pathTask", "seed", "processingPolicyConfirmed"],
    "submission",
  );
  if (submission.schemaVersion !== LONGITUDINAL_COMPUTE_SUBMISSION_VERSION_V2) {
    reject("INVALID_SUBMISSION", "submission.schemaVersion", `must be ${LONGITUDINAL_COMPUTE_SUBMISSION_VERSION_V2}`);
  }
  if (submission.processingPolicyConfirmed !== true) {
    reject("PROCESSING_POLICY_NOT_CONFIRMED", "submission.processingPolicyConfirmed", "must be true");
  }
  if (!Number.isSafeInteger(submission.seed) || (submission.seed as number) < 0 || (submission.seed as number) > 0xffff_ffff) {
    reject("INVALID_SUBMISSION", "submission.seed", "must be a uint32 safe integer");
  }
}

/**
 * Validate a caller-controlled, privacy-minimized submission and inject the
 * one service-approved execution identity. The returned bytes are the exact
 * canonical worker input to persist and hash.
 */
export async function materializeLongitudinalComputeSubmissionV2(
  value: unknown,
  approvedBuildValue: unknown,
): Promise<MaterializedLongitudinalComputeSubmissionV2> {
  assertSubmissionShape(value);
  assertApprovedLongitudinalExecutionBuildV2(approvedBuildValue);
  const submission = value;
  const approvedBuild = approvedBuildValue;
  const request: LongitudinalExecutionRequestV2 = {
    dataset: structuredClone(submission.dataset),
    pathTask: structuredClone(submission.pathTask),
    ...(Object.hasOwn(submission, "inferenceTask")
      ? { inferenceTask: structuredClone(submission.inferenceTask!) }
      : {}),
    ...(Object.hasOwn(submission, "networkOverlayTask")
      ? { networkOverlayTask: structuredClone(submission.networkOverlayTask!) }
      : {}),
    execution: {
      target: "persistent-compute-service",
      jenaVersion: approvedBuild.jenaVersion,
      jenaCommit: approvedBuild.jenaCommit,
      jenaTarballIntegrity: approvedBuild.jenaTarballIntegrity,
      sdkVersion: approvedBuild.sdkVersion,
      buildId: approvedBuild.buildId,
      seed: submission.seed,
    },
  };
  try {
    assertLongitudinalExecutionRequestV2(request, "submission");
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed strict V2 validation";
    reject("INVALID_LONGITUDINAL_TASK", "submission", message);
  }

  const source = request.dataset.sourceResult;
  if (!source || source.sourceKind !== "raw-jena") {
    reject("PRIVACY_BOUNDARY_VIOLATION", "submission.dataset.sourceResult", "must be a raw-jena fixed projection");
  }
  if (request.pathTask.datasetHash !== request.dataset.receipt.sha256
    || request.pathTask.specHash !== request.dataset.specHash
    || request.pathTask.runSpec.sourceResultHash !== source.hash) {
    reject(
      "IMMUTABLE_BINDING_MISMATCH",
      "submission.pathTask",
      "dataset, spec, and source-result hashes must share one immutable binding",
    );
  }
  const computedSourceHash = await hashAnalysisValueV1(source.result);
  if (computedSourceHash !== source.hash) {
    reject("SOURCE_HASH_MISMATCH", "submission.dataset.sourceResult.hash", "does not match the canonical source result");
  }
  const computedSpecHash = await hashAnalysisValueV1(request.pathTask.runSpec);
  if (computedSpecHash !== request.dataset.specHash) {
    reject("IMMUTABLE_BINDING_MISMATCH", "submission.dataset.specHash", "does not match the canonical trajectory run spec");
  }
  assertFixedProjectionSource(source.result, request.dataset, approvedBuild);
  assertPrivacyMinimizedSource(source.result, request.pathTask);

  const canonicalRequest = cloneFrozen(request);
  const canonicalBytes = new TextEncoder().encode(canonicalStringify(canonicalRequest));
  return Object.freeze({
    canonicalRequest,
    canonicalBytes,
    requestSha256: sha256Bytes(canonicalBytes),
    byteLength: canonicalBytes.byteLength,
  });
}
