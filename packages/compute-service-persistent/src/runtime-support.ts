import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  ANALYSIS_CONTRACT_VERSION_V1,
  assertAnalysisResultEnvelopeV1,
  type AnalysisResultEnvelopeV1,
  type AnalysisTaskResultV1,
} from "@3dena/analysis";
import {
  ComputeServiceCore,
  type ComputeAuditSink,
  type ComputeIdFactory,
  type ComputeProcessSupervisor,
  type ProcessLaunchContextV1,
  type ProcessLaunchControlV1,
  type ProcessTerminationReason,
  type SupervisedChildProcess,
} from "@3dena/compute-service-core";
import {
  COMPUTE_HTTP_CONTRACT_VERSION,
  ComputeV1HttpRouter,
  HmacComputeHttpCapabilityCodec,
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
  PostgresDistributedLeaseCoordinator,
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
  VercelPrivateBlobObjectStore,
} from "./vercel-blob";
import { PersistentComputeWorker } from "./worker";

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

class ApiFailClosedProcessSupervisor implements ComputeProcessSupervisor {
  async spawn(
    _context: ProcessLaunchContextV1,
    _control: ProcessLaunchControlV1,
  ): Promise<SupervisedChildProcess> {
    throw new TypeError("The API process cannot launch scientific children.");
  }

  async requestTermination(
    _childId: string,
    _reason: ProcessTerminationReason,
  ): Promise<void> {
    throw new TypeError("The API process owns no scientific child.");
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

class CoreScientificResultPublisher implements ScientificResultPublisherV1 {
  readonly version = SCIENTIFIC_RESULT_PUBLISHER_VERSION;

  constructor(
    private readonly core: ComputeServiceCore,
    private readonly clock: PostgresAuthoritativeClock,
    private readonly objectStore: VercelPrivateBlobObjectStore,
    private readonly sourceResults: PostgresPublishedSourceResultRegistry,
    private readonly buildId: string,
  ) {}

  async publish(
    request: ScientificPublicationRequestV1,
    signal: AbortSignal,
  ): Promise<ScientificPublicationReceiptV1> {
    if (signal.aborted) throw new TypeError("Scientific publication was cancelled.");
    await this.clock.synchronize();
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
    const bytes = await this.objectStore.get(request.object.key);
    if (bytes === null || bytes.byteLength !== request.object.byteLength) {
      throw new TypeError("Published result bytes are unavailable.");
    }
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    if (!isRecord(parsed) || parsed.version !== "3dena.compute-scientific-result-artifact.v1" ||
        !isRecord(parsed.envelope)) {
      throw new TypeError("Published result artifact is invalid.");
    }
    assertAnalysisResultEnvelopeV1(parsed.envelope);
    const envelope = parsed.envelope as AnalysisResultEnvelopeV1<AnalysisTaskResultV1>;
    if (envelope.taskKind === "ena-model" || envelope.taskKind === "prepared-import") {
      const index: PublishedScientificResultRecordV1 = {
        sourceResultHash: envelope.provenance.resultHash,
        owner: envelope.owner,
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
  const migration = {
    version: config.manifest.migrationVersion,
    sha256: config.manifest.migrationSha256,
  };
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
    return new Request(url, { method, headers });
  }
  const init: RequestInit & { duplex: "half" } = {
    method,
    headers,
    body: requestBody(request),
    duplex: "half",
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
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!target.write(next.value)) {
        await new Promise<void>((resolve) => target.once("drain", resolve));
      }
    }
    target.end();
  } catch {
    target.destroy();
  } finally {
    reader.releaseLock();
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

async function retentionLoop(common: CommonRuntime, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      await common.clock.synchronize();
      await common.sweeper.sweep();
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
    processSupervisor: new ApiFailClosedProcessSupervisor(),
    auditSink: common.auditSink,
    clock: common.clock,
    idFactory: new RandomComputeIdFactory(),
    maxConcurrency: 1,
    maxLeaseDurationMs: 120_000,
  });
  const capabilityCodec = new HmacComputeHttpCapabilityCodec(config.capabilityHmacSecret);
  const router = new ComputeV1HttpRouter({
    core,
    infrastructure: {
      repository: new PostgresComputeHttpJobRepository(common.database),
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
    },
    allowedOrigins: config.allowedOrigins,
    buildIdentity: config.publicBuildIdentity,
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
      const webRequest = await toWebRequest(request, config.publicBaseUrl);
      await sendWebResponse(await router.handle(webRequest), response);
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
  try {
    await closed;
  } finally {
    signal.removeEventListener("abort", stop);
    await retention;
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
  });
  publisher = new CoreScientificResultPublisher(
    core,
    common.clock,
    common.objectStore,
    common.sourceResults,
    config.expectedBuild.flyBuildId,
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

export const RUNTIME_CONTRACT_VERSIONS = Object.freeze([
  ANALYSIS_CONTRACT_VERSION_V1,
  COMPUTE_HTTP_CONTRACT_VERSION,
].sort());
