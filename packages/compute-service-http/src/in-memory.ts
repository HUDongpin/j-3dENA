import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import type { AnalysisJobEventV1 } from "@3dena/analysis";

import {
  COMPUTE_HTTP_JOB_VERSION,
  type ComputeHttpJobRecordV1,
  type ComputeHttpProgressEventInput,
} from "./contracts";
import { httpError } from "./errors";
import type {
  ComputeHttpCapabilityCodec,
  ComputeHttpEventBroker,
  ComputeHttpIdFactory,
  ComputeHttpJobRepository,
  ComputeHttpObjectUrlIssuer,
  ComputeHttpReadinessProbe,
  HttpRepositoryCompareAndSetResult,
  HttpRepositoryCreateResult,
} from "./interfaces";
import { cloneFrozen } from "./util";

export class InMemoryComputeHttpJobRepository
  implements ComputeHttpJobRepository
{
  readonly #records = new Map<string, ComputeHttpJobRecordV1>();

  async get(jobId: string): Promise<ComputeHttpJobRecordV1 | null> {
    const record = this.#records.get(jobId);
    return record === undefined ? null : cloneFrozen(record);
  }

  async findByCreateIdempotencyHash(
    idempotencyHash: string,
  ): Promise<ComputeHttpJobRecordV1 | null> {
    const record = [...this.#records.values()].find(
      (candidate) => candidate.createIdempotencyHash === idempotencyHash,
    );
    return record === undefined ? null : cloneFrozen(record);
  }

  async createIfAbsent(
    record: ComputeHttpJobRecordV1,
  ): Promise<HttpRepositoryCreateResult> {
    if (record.version !== COMPUTE_HTTP_JOB_VERSION || record.revision !== 0) {
      httpError("INTERNAL_ERROR", 500, "Invalid initial HTTP job record.");
    }
    const byJob = this.#records.get(record.jobId);
    if (byJob !== undefined) {
      return Object.freeze({ created: false, record: cloneFrozen(byJob) });
    }
    const byIdempotency = [...this.#records.values()].find(
      (candidate) =>
        candidate.createIdempotencyHash === record.createIdempotencyHash,
    );
    if (byIdempotency !== undefined) {
      return Object.freeze({
        created: false,
        record: cloneFrozen(byIdempotency),
      });
    }
    const stored = cloneFrozen(record);
    this.#records.set(record.jobId, stored);
    return Object.freeze({ created: true, record: cloneFrozen(stored) });
  }

  async compareAndSet(
    jobId: string,
    expectedRevision: number,
    next: ComputeHttpJobRecordV1,
  ): Promise<HttpRepositoryCompareAndSetResult> {
    const current = this.#records.get(jobId);
    if (current === undefined) {
      httpError("INTERNAL_ERROR", 500, "HTTP job disappeared during CAS.");
    }
    if (current.revision !== expectedRevision) {
      return Object.freeze({ applied: false, record: cloneFrozen(current) });
    }
    if (
      next.jobId !== jobId ||
      next.version !== current.version ||
      next.capabilityHash !== current.capabilityHash ||
      next.createRequestFingerprint !== current.createRequestFingerprint ||
      next.revision !== expectedRevision + 1
    ) {
      httpError("INTERNAL_ERROR", 500, "HTTP job CAS violated immutable identity.");
    }
    const stored = cloneFrozen(next);
    this.#records.set(jobId, stored);
    return Object.freeze({ applied: true, record: cloneFrozen(stored) });
  }
}

export class SequenceComputeHttpIdFactory implements ComputeHttpIdFactory {
  #nextDataset = 1;
  #nextJob = 1;
  #nextRequest = 1;

  nextId(namespace: "dataset" | "job" | "request"): string {
    if (namespace === "dataset") {
      const value = `dataset-${this.#nextDataset}`;
      this.#nextDataset += 1;
      return value;
    }
    if (namespace === "job") {
      const value = `job-${this.#nextJob}`;
      this.#nextJob += 1;
      return value;
    }
    const value = `request-${this.#nextRequest}`;
    this.#nextRequest += 1;
    return value;
  }
}

export class HmacComputeHttpCapabilityCodec
  implements ComputeHttpCapabilityCodec
{
  readonly #secret: Uint8Array;

  constructor(secret: string) {
    const encoded = new TextEncoder().encode(secret);
    if (encoded.byteLength < 32) {
      throw new TypeError("Capability HMAC secret must contain at least 32 UTF-8 bytes.");
    }
    this.#secret = Uint8Array.from(encoded);
  }

  issue(jobId: string): string {
    const mac = createHmac("sha256", this.#secret)
      .update(`3dena-job-capability-v1\0${jobId}`, "utf8")
      .digest("base64url");
    return `cap_v1_${mac}`;
  }

  hashSecret(secret: string): string {
    return createHmac("sha256", this.#secret)
      .update(`3dena-stored-secret-v1\0${secret}`, "utf8")
      .digest("hex");
  }

  verify(secret: string, expectedHash: string): boolean {
    if (!/^[a-f0-9]{64}$/u.test(expectedHash)) return false;
    const actual = Buffer.from(this.hashSecret(secret), "hex");
    const expected = Buffer.from(expectedHash, "hex");
    return timingSafeEqual(actual, expected);
  }
}

export class InMemoryComputeHttpObjectUrlIssuer
  implements ComputeHttpObjectUrlIssuer
{
  readonly #baseUrl: URL;
  readonly #uploads = new Map<string, string>();

  constructor(baseUrl = "https://objects.invalid/") {
    this.#baseUrl = new URL(baseUrl);
  }

  async createUploadTarget(input: Readonly<{
    jobId: string;
    expiresAtMs: number;
  }>): Promise<{ objectKey: string; uploadUrl: string }> {
    const objectKey = `compute-inputs/${input.jobId}/dataset.bin`;
    this.#uploads.set(input.jobId, objectKey);
    return Object.freeze({
      objectKey,
      uploadUrl: new URL(`upload/${encodeURIComponent(input.jobId)}`, this.#baseUrl)
        .toString(),
    });
  }

  async createResultReference(input: Readonly<{
    jobId: string;
    object: Readonly<{ key: string; sha256: string; byteLength: number }>;
    expiresAtMs: number;
  }>): Promise<{ resultUrl: string; exportUrl: null }> {
    return Object.freeze({
      resultUrl: new URL(
        `result/${encodeURIComponent(input.jobId)}/${input.object.sha256}`,
        this.#baseUrl,
      ).toString(),
      exportUrl: null,
    });
  }

  uploadObjectKey(jobId: string): string {
    const key = this.#uploads.get(jobId);
    if (key === undefined) throw new Error("No upload target exists for job.");
    return key;
  }
}

interface EventWaiter {
  readonly wake: () => void;
}

export class InMemoryComputeHttpEventBroker implements ComputeHttpEventBroker {
  readonly #events = new Map<string, AnalysisJobEventV1[]>();
  readonly #waiters = new Map<string, Set<EventWaiter>>();

  async publish(
    jobId: string,
    input: ComputeHttpProgressEventInput,
  ): Promise<AnalysisJobEventV1> {
    const existing = this.#events.get(jobId) ?? [];
    const previous = existing.at(-1);
    if (
      previous !== undefined &&
      previous.state === input.state &&
      previous.phase === input.phase &&
      previous.completed === input.completed &&
      previous.total === input.total
    ) {
      return cloneFrozen(previous);
    }
    const event: AnalysisJobEventV1 = cloneFrozen({
      schemaVersion: "3dena.job-event.v1",
      sequence: (previous?.sequence ?? 0) + 1,
      ...input,
    });
    existing.push(event);
    this.#events.set(jobId, existing);
    for (const waiter of this.#waiters.get(jobId) ?? []) waiter.wake();
    this.#waiters.delete(jobId);
    return cloneFrozen(event);
  }

  async *subscribe(
    jobId: string,
    afterSequence: number,
    signal?: AbortSignal,
  ): AsyncIterable<AnalysisJobEventV1> {
    let cursor = afterSequence;
    while (signal?.aborted !== true) {
      const next = (this.#events.get(jobId) ?? []).find(
        (event) => event.sequence > cursor,
      );
      if (next !== undefined) {
        cursor = next.sequence;
        yield cloneFrozen(next);
        continue;
      }
      await new Promise<void>((resolve) => {
        if (signal?.aborted === true) {
          resolve();
          return;
        }
        const waiters = this.#waiters.get(jobId) ?? new Set<EventWaiter>();
        let settled = false;
        let waiter: EventWaiter;
        const settle = (): void => {
          if (settled) return;
          settled = true;
          waiters.delete(waiter);
          signal?.removeEventListener("abort", settle);
          resolve();
        };
        waiter = { wake: settle };
        waiters.add(waiter);
        this.#waiters.set(jobId, waiters);
        signal?.addEventListener("abort", settle, { once: true });
      });
    }
  }

  events(jobId: string): readonly AnalysisJobEventV1[] {
    return Object.freeze(
      (this.#events.get(jobId) ?? []).map((event) => cloneFrozen(event)),
    );
  }
}

export class StaticComputeHttpReadinessProbe
  implements ComputeHttpReadinessProbe
{
  #ready: boolean;

  constructor(ready = true) {
    this.#ready = ready;
  }

  setReady(ready: boolean): void {
    this.#ready = ready;
  }

  async check(): Promise<boolean> {
    return this.#ready;
  }
}
