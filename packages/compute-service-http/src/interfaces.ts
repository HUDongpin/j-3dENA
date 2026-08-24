import type {
  AnalysisExecutionSourceResultV2,
  TaskOwnerV1,
  AnalysisJobEventV1,
  AnalysisJobResultReferenceV1,
} from "@3dena/analysis";
import type {
  ComputeClock,
  ComputeObjectStore,
} from "@3dena/compute-service-core";

import type {
  ComputeHttpJobRecordV1,
  ComputeHttpProgressEventInput,
  ReservedDatasetV1,
} from "./contracts";
import type { ComputeHttpDatasetWorkflowService } from "./dataset-interface";

export interface HttpRepositoryCreateResult {
  readonly created: boolean;
  readonly record: ComputeHttpJobRecordV1;
}

export interface HttpRepositoryCompareAndSetResult {
  readonly applied: boolean;
  readonly record: ComputeHttpJobRecordV1;
}

/** PostgreSQL may implement this interface; this package supplies only memory. */
export interface ComputeHttpJobRepository {
  get(jobId: string): Promise<ComputeHttpJobRecordV1 | null>;
  findByCreateIdempotencyHash(
    idempotencyHash: string,
  ): Promise<ComputeHttpJobRecordV1 | null>;
  createIfAbsent(
    record: ComputeHttpJobRecordV1,
  ): Promise<HttpRepositoryCreateResult>;
  compareAndSet(
    jobId: string,
    expectedRevision: number,
    next: ComputeHttpJobRecordV1,
  ): Promise<HttpRepositoryCompareAndSetResult>;
}

export interface ComputeHttpIdFactory {
  nextId(namespace: "dataset" | "job" | "request"): string;
}

/** Capability plaintext is derived for delivery and never persisted. */
export interface ComputeHttpCapabilityCodec {
  issue(jobId: string): string;
  hashSecret(secret: string): string;
  verify(secret: string, expectedHash: string): boolean;
}

export interface UploadTargetV1 {
  readonly objectKey: string;
  readonly uploadUrl: string;
}

export interface ComputeHttpObjectUrlIssuer {
  createUploadTarget(input: Readonly<{
    jobId: string;
    dataset: ReservedDatasetV1;
    expiresAtMs: number;
  }>): Promise<UploadTargetV1>;
  createResultReference(input: Readonly<{
    jobId: string;
    object: Readonly<{ key: string; sha256: string; byteLength: number }>;
    expiresAtMs: number;
  }>): Promise<Pick<AnalysisJobResultReferenceV1, "resultUrl" | "exportUrl">>;
}

export interface ComputeHttpEventBroker {
  publish(
    jobId: string,
    event: ComputeHttpProgressEventInput,
  ): Promise<AnalysisJobEventV1>;
  subscribe(
    jobId: string,
    afterSequence: number,
    signal?: AbortSignal,
  ): AsyncIterable<AnalysisJobEventV1>;
}

export interface ComputeHttpReadinessProbe {
  check(): Promise<boolean>;
}

export interface ComputeHttpDeletionLifecycleProbe {
  capacityReleased(taskId: string): Promise<boolean>;
  terminationObserved(taskId: string): Promise<boolean>;
}

export type ComputeHttpRateLimitClassV1 =
  | "dataset-upload"
  | "dataset-mutation"
  | "job-create"
  | "job-execute"
  | "job-control"
  | "job-read";

export interface ComputeHttpRateLimiter {
  consume(input: Readonly<{
    keyHash: string;
    routeClass: ComputeHttpRateLimitClassV1;
  }>): Promise<Readonly<{
    allowed: boolean;
    retryAfterSeconds: number;
  }>>;
}

/** Resolves only already-published, service-owned scientific results. */
export interface ComputeHttpSourceResultResolver {
  resolve(input: Readonly<{
    sourceResultHash: string;
    activatedDatasetSha256: string;
    requiredBuildId: string;
    nowMs: number;
  }>): Promise<ResolvedComputeHttpSourceResultV1 | null>;
}

export interface ResolvedComputeHttpSourceResultV1 {
  readonly source: AnalysisExecutionSourceResultV2;
  readonly owner: TaskOwnerV1;
  readonly buildId: string;
  readonly publishedAtMs: number;
  readonly expiresAtMs: number;
}

export interface ComputeHttpRouterInfrastructure {
  readonly repository: ComputeHttpJobRepository;
  readonly objectStore: ComputeObjectStore;
  readonly clock: ComputeClock;
  readonly idFactory: ComputeHttpIdFactory;
  readonly capabilityCodec: ComputeHttpCapabilityCodec;
  readonly objectUrls: ComputeHttpObjectUrlIssuer;
  readonly events: ComputeHttpEventBroker;
  readonly readiness: ComputeHttpReadinessProbe;
  readonly rateLimiter: ComputeHttpRateLimiter;
  readonly datasetWorkflow?: ComputeHttpDatasetWorkflowService;
  readonly sourceResults?: ComputeHttpSourceResultResolver;
  readonly deletionLifecycle?: ComputeHttpDeletionLifecycleProbe;
}
