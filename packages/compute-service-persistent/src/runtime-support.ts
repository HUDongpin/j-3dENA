import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  ANALYSIS_CONTRACT_VERSION_V1,
  assertAnalysisResultEnvelopeV1,
  verifyLongitudinalAnalysisBundleV2,
  type AnalysisResultEnvelopeV1,
  type AnalysisTaskResultV1,
  type LongitudinalAnalysisBundleV2,
} from "@3dena/analysis";
import {
  ComputeServiceCore,
  type ComputeAuditSink,
  type ComputeIdFactory,
  type ComputeObjectStore,
  type TaskOwnerV1,
} from "@3dena/compute-service-core";
import {
  ComputeV1HttpRouter,
  HmacComputeHttpCapabilityCodec,
  type ApprovedLongitudinalExecutionBuildV2,
  type ComputeHttpIdFactory,
  type ComputeHttpObjectUrlIssuer,
} from "@3dena/compute-service-http";
import {
  NODE_COMPUTE_SUPERVISOR_OPTIONS_VERSION,
  NodeComputeProcessSupervisor,
  SCIENTIFIC_JSON_INPUT_PROVIDER_OPTIONS_VERSION,
  SCIENTIFIC_RESULT_PUBLISHER_VERSION,
  SCIENTIFIC_SESSION_ADAPTER_OPTIONS_VERSION,
  JsonObjectStoreScientificInputProvider,
  ScientificWorkerSessionAdapter,
  type ScientificPublicationReceiptV1,
  type ScientificPublicationRequestV1,
  type ScientificResultPublisherV1,
} from "@3dena/compute-service-node";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

import { BuildApprovalReadinessProbe, PostgresBuildApprovalRegistry } from "./build-approval";
import { PostgresComputeHttpDatasetWorkflowService } from "./dataset-service";
import { verifyPersistentComputeMigration } from "./migration";
import { OfficialVercelPrivateBlobClient } from "./official-vercel-blob";
import {
  PostgresAuthoritativeClock,
  PostgresComputeAuditSink,
  PostgresComputeHttpEventBroker,
  PostgresComputeHttpJobRepository,
  PostgresComputeTaskRepository,
  PostgresDatabase,
  PostgresDeletionLifecycleProbe,
  PostgresDistributedLeaseCoordinator,
  PostgresTemporalDueSource,
  type PgCompatibleClient,
  type PgCompatiblePool,
  type SqlQueryResult,
} from "./postgres";
import { PostgresFixedWindowRateLimiter } from "./rate-limit";
import type { ComputeRuntimeConfigurationV1 } from "./runtime-config";
import {
  PostgresPublishedSourceResultRegistry,
  type PublishedScientificResultRecordV1,
} from "./source-result";
import {
  PersistentObjectRetentionSweeper,
  PostgresObjectLedger,
  VercelBlobOrphanReconciliationSweeper,
  VercelPrivateBlobObjectStore,
} from "./vercel-blob";
import {
  PersistentTemporalTaskSweeper,
  runPersistentTemporalSweepLoop,
} from "./temporal-sweeper";
import {
  DurableControlPlaneProcessSupervisor,
  PersistentComputeWorker,
} from "./worker";
import { canonicalStringify, hasExactKeys, LOWER_SHA256 } from "./util";

const MAX_REQUEST_HEADERS = 64;
const MAX_REQUEST_HEADER_BYTES = 16 * 1024;

class PgClientAdapter implements PgCompatibleClient {
  constructor(private readonly client: PoolClient) {}

  async query<Row extends Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    const result = await this.client.query<QueryResultRow>(text, [...values]);
    return {
      rows: result.rows as Row[],
      rowCount: result.rowCount ?? 0,
    };
  }

  release(): void {
    this.client.release();
  }
}

class PgPoolAdapter implements PgCompatiblePool {
  constructor(private readonly pool: Pool) {}

  async connect(): Promise<PgCompatibleClient> {
    return new PgClientAdapter(await this.pool.connect());
  }

  async query<Row extends Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    const result = await this.pool.query<QueryResultRow>(text, [...values]);
    return {
      rows: result.rows as Row[],
      rowCount: result.rowCount ?? 0,
    };
  }
}

class RandomComputeIdFactory implements ComputeIdFactory {
  nextId(namespace: "execution" | "slot"): string {
    return `${namespace}-${randomUUID()}`;
  }
}

class RandomComputeHttpIdFactory implements ComputeHttpIdFactory {
  nextId(namespace: "dataset" | "job" | "request"): string {
    return `${namespace}-${randomUUID()}`;
  }
}

class FlyArtifactUrlIssuer implements ComputeHttpObjectUrlIssuer {
  readonly #baseUrl: URL;

  constructor(baseUrl: string) {
    this.#baseUrl = new URL(baseUrl);
    if (this.#baseUrl.protocol !== "https:" || this.#baseUrl.username !== "" ||
        this.#baseUrl.password !== "" || this.#baseUrl.search !== "" ||
        this.#baseUrl.hash !== "") {
      throw new TypeError("PUBLIC_COMPUTE_BASE_URL must be an HTTPS URL without credentials.");
    }
  }

  async createUploadTarget(input: Readonly<{
    jobId: string;
  }>): Promise<{ objectKey: string; uploadUrl: string }> {
    return Object.freeze({
      objectKey: `compute-inputs/${input.jobId}/dataset.bin`,
      uploadUrl: new URL(
        `/v1/jobs/${encodeURIComponent(input.jobId)}/content`,
        this.#baseUrl,
      ).toString(),
    });
  }

  async createResultReference(input: Readonly<{
    jobId: string;
  }>): Promise<{ resultUrl: string; exportUrl: null }> {
    return Object.freeze({
      resultUrl: new URL(
        `/v1/jobs/${encodeURIComponent(input.jobId)}/artifact`,
        this.#baseUrl,
      ).toString(),
      exportUrl: null,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function loadPublicKeys(path: string): Promise<ReadonlyMap<string, string>> {
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isRecord(value) || Object.keys(value).length < 1 ||
      Object.entries(value).some(([id, key]) =>
        !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(id) ||
        typeof key !== "string" || !key.includes("BEGIN PUBLIC KEY"))) {
    throw new TypeError("Build approval public-key registry is invalid.");
  }
  return new Map(Object.entries(value) as Array<[string, string]>);
}

async function verifyCapacity(database: PostgresDatabase, expected: number): Promise<boolean> {
  try {
    const result = await database.query<{ enabled_count?: unknown; [key: string]: unknown }>(
      `SELECT count(*)::integer AS enabled_count
       FROM compute_capacity_slots WHERE enabled = true`,
    );
    return Number(result.rows[0]?.enabled_count) === expected;
  } catch {
    return false;
  }
}

interface ScientificPublicationClock {
  synchronize(): Promise<number>;
}

interface ScientificSourceResultRecorder {
  record(record: PublishedScientificResultRecordV1): Promise<void>;
}

function ownerMatches(left: unknown, right: TaskOwnerV1): boolean {
  return isRecord(left) &&
    hasExactKeys(left, ["contractVersion", "datasetHash", "specHash", "runId", "taskId"]) &&
    canonicalStringify(left) === canonicalStringify(right);
}

function analysisOwnerMatches(left: unknown, right: TaskOwnerV1): boolean {
  return isRecord(left) &&
    hasExactKeys(left, ["contractVersion", "datasetHash", "specHash", "runId", "taskId"]) &&
    left.contractVersion === ANALYSIS_CONTRACT_VERSION_V1 &&
    left.datasetHash === right.datasetHash &&
    left.specHash === right.specHash &&
    left.runId === right.runId &&
    left.taskId === right.taskId;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Final publication fence used by the production worker runtime. Artifact
 * bytes and their immutable scientific binding are validated before the core
 * is allowed to record success; a malformed artifact can therefore never
 * create a contradictory successful core record.
 */
export class CoreScientificResultPublisher implements ScientificResultPublisherV1 {
  readonly version = SCIENTIFIC_RESULT_PUBLISHER_VERSION;

  constructor(
    private readonly core: ComputeServiceCore,
    private readonly clock: ScientificPublicationClock,
    private readonly objectStore: ComputeObjectStore,
    private readonly sourceResults: ScientificSourceResultRecorder,
    private readonly buildId: string,
    private readonly approvedLongitudinalBuild: ApprovedLongitudinalExecutionBuildV2,
  ) {}

  async publish(
    request: ScientificPublicationRequestV1,
    signal: AbortSignal,
  ): Promise<ScientificPublicationReceiptV1> {
    if (signal.aborted) throw new TypeError("Scientific publication was cancelled.");
    await this.clock.synchronize();
    const task = await this.core.getTask(request.owner.taskId);
    if (task === null || !ownerMatches(request.owner, task.request.owner)) {
      throw new TypeError("Scientific publication owner is invalid.");
    }
    const bytes = await this.objectStore.get(request.object.key);
    if (
      bytes === null ||
      bytes.byteLength !== request.object.byteLength ||
      sha256(bytes) !== request.object.sha256
    ) {
      throw new TypeError("Published result bytes are unavailable.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new TypeError("Published result artifact is invalid.");
    }
    if (!isRecord(parsed)) {
      throw new TypeError("Published result artifact is invalid.");
    }
    let sourceEnvelope: AnalysisResultEnvelopeV1<AnalysisTaskResultV1> | undefined;
    if (parsed.version === "3dena.compute-scientific-longitudinal-result-artifact.v2") {
      const bundle = parsed.bundle;
      if (
        !hasExactKeys(parsed, ["version", "owner", "taskKind", "requestHash", "bundle"]) ||
        parsed.taskKind !== "longitudinal-analysis-v2" ||
        task.request.taskKind !== "longitudinal-analysis-v2" ||
        !ownerMatches(parsed.owner, task.request.owner) ||
        typeof parsed.requestHash !== "string" ||
        !LOWER_SHA256.test(parsed.requestHash) ||
        !isRecord(bundle)
      ) {
        throw new TypeError("Published longitudinal result artifact is invalid.");
      }
      try {
        await verifyLongitudinalAnalysisBundleV2(bundle);
      } catch {
        throw new TypeError("Published longitudinal result artifact is invalid.");
      }
      const typed = bundle as unknown as LongitudinalAnalysisBundleV2;
      const expectedBuild = this.approvedLongitudinalBuild;
      if (
        typed.identity.datasetHash !== task.request.owner.datasetHash ||
        typed.identity.specHash !== task.request.owner.specHash ||
        typed.identity.runId !== task.request.owner.runId ||
        typed.identity.requestHash !== parsed.requestHash ||
        typed.execution.target !== "persistent-compute-service" ||
        typed.execution.jenaVersion !== expectedBuild.jenaVersion ||
        typed.execution.jenaCommit !== expectedBuild.jenaCommit ||
        typed.execution.jenaTarballIntegrity !== expectedBuild.jenaTarballIntegrity ||
        typed.execution.sdkVersion !== expectedBuild.sdkVersion ||
        typed.execution.buildId !== expectedBuild.buildId
      ) {
        throw new TypeError("Published longitudinal result binding is invalid.");
      }
    } else {
      if (
        !hasExactKeys(parsed, ["version", "owner", "taskKind", "envelope"]) ||
        parsed.version !== "3dena.compute-scientific-result-artifact.v1" ||
        parsed.taskKind !== task.request.taskKind ||
        !analysisOwnerMatches(parsed.owner, task.request.owner) ||
        !isRecord(parsed.envelope)
      ) {
        throw new TypeError("Published result artifact is invalid.");
      }
      assertAnalysisResultEnvelopeV1(parsed.envelope);
      sourceEnvelope = parsed.envelope as AnalysisResultEnvelopeV1<AnalysisTaskResultV1>;
      if (
        sourceEnvelope.taskKind !== task.request.taskKind ||
        !analysisOwnerMatches(sourceEnvelope.owner, task.request.owner)
      ) {
        throw new TypeError("Published result binding is invalid.");
      }
    }
    if (signal.aborted) throw new TypeError("Scientific publication was cancelled.");
    const record = await this.core.publishResult(
      request.owner.taskId,
      request.lease,
      request.object,
    );
    const publication = record.result;
    if (publication === undefined || signal.aborted) {
      throw new TypeError("Scientific publication was not durably recorded.");
    }
    const receipt: ScientificPublicationReceiptV1 = Object.freeze({
      version: "3dena.compute-scientific-publication-receipt.v1",
      accepted: true,
      executionId: request.executionId,
      owner: structuredClone(request.owner),
      leaseId: request.lease.leaseId,
      leaseEpoch: request.lease.epoch,
      object: structuredClone(request.object),
      publishedAtMs: publication.publishedAtMs,
    });
    if (sourceEnvelope?.taskKind === "ena-model" || sourceEnvelope?.taskKind === "prepared-import") {
      const index: PublishedScientificResultRecordV1 = {
        sourceResultHash: sourceEnvelope.provenance.resultHash,
        owner: sourceEnvelope.owner,
        buildId: this.buildId,
        object: request.object,
        publishedAtMs: publication.publishedAtMs,
        expiresAtMs: record.request.expiresAtMs,
        publicationReceipt: receipt,
      };
      await this.sourceResults.record(index);
    }
    return receipt;
  }
}

interface CommonRuntime {
  readonly pool: Pool;
  readonly database: PostgresDatabase;
  readonly clock: PostgresAuthoritativeClock;
  readonly objectStore: VercelPrivateBlobObjectStore;
  readonly sourceResults: PostgresPublishedSourceResultRegistry;
  readonly readiness: BuildApprovalReadinessProbe;
  readonly auditSink: ComputeAuditSink;
  readonly sweeper: PersistentObjectRetentionSweeper;
  readonly orphanSweeper: VercelBlobOrphanReconciliationSweeper;
}

async function createCommonRuntime(
  config: ComputeRuntimeConfigurationV1,
): Promise<CommonRuntime> {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: { rejectUnauthorized: true },
    max: config.role === "api" ? 10 : 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: false,
  });
  const database = new PostgresDatabase(new PgPoolAdapter(pool));
  const clock = new PostgresAuthoritativeClock(database);
  await clock.synchronize();
  const blobClient = new OfficialVercelPrivateBlobClient();
  const ledger = new PostgresObjectLedger(database);
  const objectStore = new VercelPrivateBlobObjectStore({
    client: blobClient,
    token: config.blobToken,
    namespace: config.blobNamespace,
    clock,
    ledger,
  });
  const publicKeys = await loadPublicKeys(config.publicKeysPath);
  const registry = new PostgresBuildApprovalRegistry(database, publicKeys);
  const migration = config.manifest.migrationManifest.map((entry) => ({
    version: entry.version,
    sha256: entry.sha256,
  }));
  const readiness = new BuildApprovalReadinessProbe({
    registry,
    expected: config.expectedBuild,
    dependencies: [
      async () => verifyPersistentComputeMigration(database, migration),
      async () => verifyCapacity(database, config.globalCapacity),
      async () => {
        try {
          await blobClient.head(
            `${config.blobNamespace}/runtime-readiness-probe`,
            config.blobToken,
          );
          return true;
        } catch {
          return false;
        }
      },
    ],
  });
  return {
    pool,
    database,
    clock,
    objectStore,
    sourceResults: new PostgresPublishedSourceResultRegistry(database, objectStore),
    readiness,
    auditSink: new PostgresComputeAuditSink(database),
    sweeper: new PersistentObjectRetentionSweeper({ store: objectStore, ledger, clock }),
    orphanSweeper: new VercelBlobOrphanReconciliationSweeper({
      client: blobClient,
      token: config.blobToken,
      namespace: config.blobNamespace,
      ledger,
      clock,
    }),
  };
}

function requestBody(request: IncomingMessage): ReadableStream<Uint8Array<ArrayBuffer>> {
  const iterator = request[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) {
        controller.close();
        return;
      }
      const source = next.value instanceof Uint8Array
        ? next.value
        : Buffer.from(next.value as string);
      const copy = new Uint8Array(new ArrayBuffer(source.byteLength));
      copy.set(source);
      controller.enqueue(copy);
    },
    async cancel() {
      await iterator.return?.();
      request.destroy();
    },
  });
}

async function toWebRequest(
  request: IncomingMessage,
  publicBaseUrl: string,
  signal: AbortSignal,
): Promise<Request> {
  const url = new URL(request.url ?? "/", publicBaseUrl);
  const headers = new Headers();
  for (const [name, raw] of Object.entries(request.headers)) {
    if (raw === undefined) continue;
    if (Array.isArray(raw)) raw.forEach((value) => headers.append(name, value));
    else headers.set(name, raw);
  }
  const method = request.method ?? "GET";
  if (method === "GET" || method === "HEAD") {
    return new Request(url, { method, headers, signal });
  }
  const init: RequestInit & { duplex: "half" } = {
    method,
    headers,
    body: requestBody(request),
    duplex: "half",
    signal,
  };
  return new Request(url, init);
}

async function sendWebResponse(response: Response, target: ServerResponse): Promise<void> {
  target.statusCode = response.status;
  response.headers.forEach((value, name) => target.setHeader(name, value));
  if (response.body === null) {
    target.end();
    return;
  }
  const reader = response.body.getReader();
  let closedEarly = false;
  let settleClosed!: () => void;
  const targetClosed = new Promise<void>((resolve) => {
    settleClosed = resolve;
  });
  let cancellation: Promise<void> | null = null;
  const cancelForClosedTarget = (): void => {
    if (target.writableEnded || closedEarly) return;
    closedEarly = true;
    settleClosed();
    cancellation = reader.cancel(
      new DOMException("The Node HTTP response was closed by the client.", "AbortError"),
    ).catch(() => undefined);
  };
  target.once("close", cancelForClosedTarget);
  if (target.destroyed && !target.writableEnded) cancelForClosedTarget();
  try {
    while (!closedEarly) {
      const next = await Promise.race([
        reader.read(),
        targetClosed.then(() => ({ done: true as const, value: undefined })),
      ]);
      if (closedEarly || next.done) break;
      if (!target.write(next.value)) {
        await new Promise<void>((resolve) => {
          const settle = (): void => {
            target.off("drain", settle);
            target.off("close", settle);
            resolve();
          };
          target.once("drain", settle);
          target.once("close", settle);
          if (target.destroyed) settle();
        });
      }
    }
    if (!closedEarly) target.end();
  } catch (error) {
    if (!closedEarly) {
      await reader.cancel(error).catch(() => undefined);
      target.destroy(error instanceof Error ? error : undefined);
    }
  } finally {
    target.off("close", cancelForClosedTarget);
    if (cancellation !== null) await cancellation;
    reader.releaseLock();
  }
}

/**
 * Bridges one real Node HTTP exchange into the Web Request/Response contract
 * consumed by the compute router. The Web signal remains live for the full
 * response lifetime so a client disappearing during an SSE stream is visible
 * to both the router and the response body's cancellation hook.
 */
export async function bridgeNodeHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  publicBaseUrl: string,
  handle: (request: Request) => Response | Promise<Response>,
): Promise<void> {
  const controller = new AbortController();
  let completed = false;
  const abortTransport = (): void => {
    if (completed || controller.signal.aborted) return;
    controller.abort(
      new DOMException("The Node HTTP client disconnected.", "AbortError"),
    );
  };
  const abortClosedResponse = (): void => {
    if (!response.writableEnded) abortTransport();
  };
  request.once("aborted", abortTransport);
  response.once("close", abortClosedResponse);
  if (request.aborted || (response.destroyed && !response.writableEnded)) {
    abortTransport();
  }
  try {
    const webRequest = await toWebRequest(request, publicBaseUrl, controller.signal);
    await sendWebResponse(await handle(webRequest), response);
  } finally {
    completed = true;
    request.off("aborted", abortTransport);
    response.off("close", abortClosedResponse);
  }
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(settle, milliseconds);
    function settle(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", settle);
      resolve();
    }
    signal.addEventListener("abort", settle, { once: true });
  });
}

export async function runPersistentRetentionCycle(input: Readonly<{
  synchronize: () => Promise<unknown>;
  sweepObjects: () => Promise<unknown>;
  reconcileOrphans: () => Promise<unknown>;
  purgeExpiredSourceResultMappings: () => Promise<unknown>;
}>): Promise<void> {
  await input.synchronize();
  const results = await Promise.allSettled([
    input.sweepObjects(),
    input.reconcileOrphans(),
    input.purgeExpiredSourceResultMappings(),
  ]);
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, "Persistent retention sweep failed.");
  }
}

async function retentionLoop(common: CommonRuntime, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      await runPersistentRetentionCycle({
        synchronize: () => common.clock.synchronize(),
        sweepObjects: () => common.sweeper.sweep(),
        reconcileOrphans: () => common.orphanSweeper.sweep(),
        purgeExpiredSourceResultMappings: () =>
          common.sourceResults.purgeExpiredActiveMappings(),
      });
    } catch {
      process.stderr.write("COMPUTE_RETENTION_SWEEP_FAILED\n");
    }
    await delay(60_000, signal);
  }
}

export async function runApiRuntime(
  config: ComputeRuntimeConfigurationV1,
  signal: AbortSignal,
): Promise<void> {
  const common = await createCommonRuntime(config);
  const repository = new PostgresComputeTaskRepository(common.database);
  const core = new ComputeServiceCore({
    repository,
    objectStore: common.objectStore,
    processSupervisor: new DurableControlPlaneProcessSupervisor(),
    auditSink: common.auditSink,
    clock: common.clock,
    idFactory: new RandomComputeIdFactory(),
    maxConcurrency: 1,
    maxLeaseDurationMs: 120_000,
    deferProcessOwnedDeletionCompletion: true,
  });
  const capabilityCodec = new HmacComputeHttpCapabilityCodec(config.capabilityHmacSecret);
  const httpRepository = new PostgresComputeHttpJobRepository(common.database);
  const router = new ComputeV1HttpRouter({
    core,
    infrastructure: {
      repository: httpRepository,
      objectStore: common.objectStore,
      clock: common.clock,
      idFactory: new RandomComputeHttpIdFactory(),
      capabilityCodec,
      objectUrls: new FlyArtifactUrlIssuer(config.publicBaseUrl),
      events: new PostgresComputeHttpEventBroker(common.database),
      readiness: common.readiness,
      rateLimiter: new PostgresFixedWindowRateLimiter({
        database: common.database,
        windowSeconds: 60,
        limits: {
          "dataset-upload": 20,
          "dataset-mutation": 120,
          "job-create": 60,
          "job-execute": 60,
          "job-control": 120,
          "job-read": 600,
        },
      }),
      datasetWorkflow: new PostgresComputeHttpDatasetWorkflowService({
        database: common.database,
        objectStore: common.objectStore,
        capabilityCodec,
        clock: common.clock,
      }),
      sourceResults: common.sourceResults,
      deletionLifecycle: new PostgresDeletionLifecycleProbe(common.database),
    },
    allowedOrigins: config.allowedOrigins,
    buildIdentity: config.publicBuildIdentity,
    approvedLongitudinalBuild: config.approvedLongitudinalBuild,
    longitudinalServiceTokenSha256: config.longitudinalServiceTokenSha256,
  });
  const server = createServer({
    maxHeaderSize: MAX_REQUEST_HEADER_BYTES,
    requestTimeout: 65_000,
    headersTimeout: 15_000,
    keepAliveTimeout: 5_000,
  }, (request, response) => {
    if (request.rawHeaders.length / 2 > MAX_REQUEST_HEADERS) {
      response.writeHead(431).end();
      return;
    }
    void (async () => {
      await common.clock.synchronize();
      await bridgeNodeHttpRequest(
        request,
        response,
        config.publicBaseUrl,
        (webRequest) => router.handle(webRequest),
      );
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  const closed = new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.once("close", resolve);
  });
  server.listen(config.port, "0.0.0.0");
  const stop = (): void => {
    server.close();
    server.closeIdleConnections();
  };
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
  const retention = retentionLoop(common, signal);
  const temporal = runPersistentTemporalSweepLoop({
    sweeper: new PersistentTemporalTaskSweeper({
      source: new PostgresTemporalDueSource(common.database, {
        holderId: config.holderId,
        leaseDurationMs: 5_000,
        batchSize: 100,
      }),
      core,
      reconcileHttpDeletion: (jobId) => router.reconcileDurableDeletion(jobId),
      reconcileHttpJob: async (jobId) => {
        await router.reconcileJob(jobId);
        return true;
      },
      purgeHttpJob: (jobId) => httpRepository.purgeExpired(jobId),
      onTaskFailure: () => process.stderr.write("COMPUTE_TEMPORAL_TASK_SWEEP_FAILED\n"),
    }),
    signal,
    intervalMs: 1_000,
    beforeCycle: async () => {
      await common.clock.synchronize();
    },
    onCycleFailure: () => process.stderr.write("COMPUTE_TEMPORAL_SWEEP_FAILED\n"),
  });
  try {
    await closed;
  } finally {
    signal.removeEventListener("abort", stop);
    await Promise.all([retention, temporal]);
    await core.settleBackground();
    await common.pool.end();
  }
}

export async function runWorkerRuntime(
  config: ComputeRuntimeConfigurationV1,
  signal: AbortSignal,
): Promise<void> {
  const common = await createCommonRuntime(config);
  const repository = new PostgresComputeTaskRepository(common.database);
  let publisher: CoreScientificResultPublisher | null = null;
  const publisherProxy: ScientificResultPublisherV1 = {
    version: SCIENTIFIC_RESULT_PUBLISHER_VERSION,
    publish(request, publicationSignal) {
      if (publisher === null) {
        throw new TypeError("Scientific publisher is not initialized.");
      }
      return publisher.publish(request, publicationSignal);
    },
  };
  const sessionAdapter = new ScientificWorkerSessionAdapter({
    version: SCIENTIFIC_SESSION_ADAPTER_OPTIONS_VERSION,
    inputProvider: new JsonObjectStoreScientificInputProvider({
      version: SCIENTIFIC_JSON_INPUT_PROVIDER_OPTIONS_VERSION,
      objectStore: common.objectStore,
    }),
    resultStore: common.objectStore,
    publisher: publisherProxy,
  });
  const supervisor = new NodeComputeProcessSupervisor({
    version: NODE_COMPUTE_SUPERVISOR_OPTIONS_VERSION,
    workerEntry: config.workerEntryPath,
    environment: {
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      TZ: "UTC",
      NODE_ENV: "production",
    },
    terminationGraceMs: 5_000,
  }, sessionAdapter);
  const core = new ComputeServiceCore({
    repository,
    objectStore: common.objectStore,
    processSupervisor: supervisor,
    auditSink: common.auditSink,
    clock: common.clock,
    idFactory: new RandomComputeIdFactory(),
    maxConcurrency: 1,
    maxLeaseDurationMs: 120_000,
    deferProcessOwnedDeletionCompletion: true,
  });
  publisher = new CoreScientificResultPublisher(
    core,
    common.clock,
    common.objectStore,
    common.sourceResults,
    config.expectedBuild.flyBuildId,
    config.approvedLongitudinalBuild,
  );
  const worker = new PersistentComputeWorker({
    holderId: config.holderId,
    core,
    coordinator: new PostgresDistributedLeaseCoordinator(common.database, {
      maxLeaseDurationMs: 120_000,
    }),
    leaseDurationMs: 90_000,
    heartbeatIntervalMs: 20_000,
    beforeCycle: async () => {
      await common.clock.synchronize();
      return common.readiness.check();
    },
  });
  try {
    await Promise.all([
      worker.run(signal),
      retentionLoop(common, signal),
    ]);
    await core.settleBackground();
  } finally {
    await common.pool.end();
  }
}
