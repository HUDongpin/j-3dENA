import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ManualComputeClock } from "@3dena/compute-service-core";

import type {
  ObjectDeletionProbeV1,
  OrphanReconciliationReceiptV1,
} from "./contracts";
import type {
  PersistentObjectLeaseV1,
  PersistentObjectLedger,
  PersistentOrphanDeletionLeaseV1,
  VercelPrivateBlobClientV1,
  VercelPrivateBlobPutOptionsV1,
} from "./vercel-blob";
import {
  VercelBlobOrphanReconciliationSweeper,
  VercelPrivateBlobObjectStore,
} from "./vercel-blob";

class MemoryBlobClient implements VercelPrivateBlobClientV1 {
  readonly objects = new Map<string, Uint8Array>();
  readonly uploadedAt = new Map<string, number>();
  readonly putOptions: VercelPrivateBlobPutOptionsV1[] = [];
  ignoreDelete = false;
  beforePut: ((pathname: string) => Promise<void>) | undefined;
  afterPut: ((pathname: string) => Promise<void>) | undefined;

  async put(pathname: string, bytes: Uint8Array, options: VercelPrivateBlobPutOptionsV1) {
    this.putOptions.push(options);
    await this.beforePut?.(pathname);
    if (this.objects.has(pathname)) throw new Error("exists");
    this.objects.set(pathname, Uint8Array.from(bytes));
    this.uploadedAt.set(pathname, 0);
    await this.afterPut?.(pathname);
    return { pathname, url: `https://blob.invalid/${pathname}` };
  }

  async head(pathname: string) {
    const bytes = this.objects.get(pathname);
    return bytes === undefined ? null : {
      pathname,
      size: bytes.byteLength,
      uploadedAtMs: this.uploadedAt.get(pathname) ?? 0,
    };
  }

  async download(pathname: string) {
    const bytes = this.objects.get(pathname);
    return bytes === undefined ? null : Uint8Array.from(bytes);
  }

  async del(pathname: string) {
    if (!this.ignoreDelete) {
      this.objects.delete(pathname);
      this.uploadedAt.delete(pathname);
    }
  }

  async list(prefix: string) {
    return {
      blobs: [...this.objects.keys()]
        .filter((pathname) => pathname.startsWith(prefix))
        .sort()
        .map((pathname) => ({
          pathname,
          uploadedAtMs: this.uploadedAt.get(pathname) ?? 0,
        })),
      cursor: null,
      hasMore: false,
    };
  }
}

class MemoryLedger implements PersistentObjectLedger {
  readonly objects = new Map<string, {
    input: Parameters<PersistentObjectLedger["beginPut"]>[0];
    generation: number;
    fencingEpoch: number;
    state: "intent" | "available" | "deleting" | "deleted";
  }>();
  readonly orphans = new Map<string, PersistentOrphanDeletionLeaseV1 & {
    state: "deleting" | "deleted";
  }>();
  readonly receipts: ObjectDeletionProbeV1[] = [];
  readonly orphanReceipts: OrphanReconciliationReceiptV1[] = [];
  dueKeys: readonly string[] = [];
  failBeginPut = false;
  failMarkAvailable = false;
  failCompleteDelete = false;
  failCompleteOrphanFor = new Set<string>();

  async beginPut(input: Parameters<PersistentObjectLedger["beginPut"]>[0]) {
    if (this.failBeginPut) throw new Error("ledger unavailable");
    if (this.orphans.get(input.pathname)?.state === "deleting") {
      throw new Error("orphan deletion fenced");
    }
    const existing = this.objects.get(input.objectRef);
    if (existing !== undefined) {
      if (existing.input.objectKey !== input.objectKey || existing.input.sha256 !== input.sha256 ||
          existing.input.byteLength !== input.byteLength || existing.state === "deleting") {
        throw Object.assign(new Error("IMMUTABLE_OBJECT_CONFLICT"), {
          code: "IMMUTABLE_OBJECT_CONFLICT",
        });
      }
      if (existing.state === "deleted") {
        existing.generation += 1;
        existing.fencingEpoch += 1;
        existing.state = "intent";
        existing.input = structuredClone(input);
      }
      return this.lease(existing);
    }
    const created = {
      input: structuredClone(input), generation: 1, fencingEpoch: 1,
      state: "intent" as const,
    };
    this.objects.set(input.objectRef, created);
    return this.lease(created);
  }

  async markAvailable(lease: PersistentObjectLeaseV1) {
    if (this.failMarkAvailable) {
      this.failMarkAvailable = false;
      throw new Error("available receipt unavailable");
    }
    const object = this.objects.get(lease.objectRef);
    if (object === undefined || object.generation !== lease.generation ||
        object.fencingEpoch !== lease.fencingEpoch ||
        (object.state !== "intent" && object.state !== "available")) {
      throw new Error("stale available lease");
    }
    object.state = "available";
  }

  async beginDelete(objectKey: string) {
    const object = [...this.objects.values()].find((item) => item.input.objectKey === objectKey);
    if (object === undefined || object.state === "deleted") return null;
    if (object.state !== "deleting") {
      object.fencingEpoch += 1;
      object.state = "deleting";
    }
    return this.lease(object);
  }

  async resolve(objectKey: string) {
    const object = [...this.objects.values()].find((item) => item.input.objectKey === objectKey);
    return object === undefined ? null : this.lease(object);
  }

  async completeDelete(lease: PersistentObjectLeaseV1, receipt: ObjectDeletionProbeV1) {
    if (this.failCompleteDelete) {
      this.failCompleteDelete = false;
      throw new Error("delete receipt unavailable");
    }
    const object = this.objects.get(lease.objectRef);
    if (object === undefined || object.state !== "deleting" ||
        object.generation !== lease.generation || object.fencingEpoch !== lease.fencingEpoch) {
      throw new Error("stale delete lease");
    }
    object.state = "deleted";
    this.receipts.push(structuredClone(receipt));
  }

  async due() {
    return this.dueKeys;
  }

  async beginOrphanDelete(input: Parameters<PersistentObjectLedger["beginOrphanDelete"]>[0]) {
    const known = [...this.objects.values()].find(
      (object) => this.lease(object).pathname === input.pathname,
    );
    if (known !== undefined && known.state !== "deleted") return null;
    const existing = this.orphans.get(input.pathname);
    if (existing?.state === "deleting") return existing;
    const lease = {
      objectRef: createHash("sha256").update(input.pathname).digest("hex"),
      namespace: input.namespace,
      pathname: input.pathname,
      generation: (existing?.generation ?? 0) + 1,
      fencingEpoch: (existing?.fencingEpoch ?? 0) + 1,
      providerUploadedAtMs: input.providerUploadedAtMs,
      discoveredAtMs: input.discoveredAtMs,
      state: "deleting" as const,
    };
    this.orphans.set(input.pathname, lease);
    return lease;
  }

  async completeOrphanDelete(
    lease: PersistentOrphanDeletionLeaseV1,
    receipt: OrphanReconciliationReceiptV1,
  ) {
    if (this.failCompleteOrphanFor.delete(lease.pathname)) {
      throw new Error("orphan receipt unavailable");
    }
    const current = this.orphans.get(lease.pathname);
    if (current === undefined || current.generation !== lease.generation ||
        current.fencingEpoch !== lease.fencingEpoch) throw new Error("stale orphan lease");
    current.state = "deleted";
    this.orphanReceipts.push(structuredClone(receipt));
  }

  async dueOrphanDeletes(namespace: string) {
    return [...this.orphans.values()].filter(
      (orphan) => orphan.namespace === namespace && orphan.state === "deleting",
    );
  }

  private lease(object: {
    input: Parameters<PersistentObjectLedger["beginPut"]>[0];
    generation: number; fencingEpoch: number;
    state: "intent" | "available" | "deleting" | "deleted";
  }): PersistentObjectLeaseV1 {
    return {
      objectRef: object.input.objectRef,
      objectKey: object.input.objectKey,
      pathname: object.generation === 1
        ? object.input.pathname
        : `${object.input.pathname}.g${object.generation}`,
      sha256: object.input.sha256,
      byteLength: object.input.byteLength,
      generation: object.generation,
      fencingEpoch: object.fencingEpoch,
      state: object.state,
    };
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function harness() {
  const client = new MemoryBlobClient();
  const ledger = new MemoryLedger();
  const clock = new ManualComputeClock(1_000);
  const store = new VercelPrivateBlobObjectStore({
    client,
    ledger,
    clock,
    namespace: "prod-compute",
    token: "token-with-at-least-sixteen-bytes",
  });
  return { client, ledger, clock, store };
}

describe("VercelPrivateBlobObjectStore", () => {
  it("isolates a late generation-1 PUT from a deleted and reactivated generation-2 object", async () => {
    const target = harness();
    const key = "compute-inputs/late-writer.bin";
    const bytes = new Uint8Array([4, 2]);
    const firstPutEntered = deferred<void>();
    const releaseFirstPut = deferred<void>();
    let blockedFirstPut = false;
    target.client.beforePut = async () => {
      if (blockedFirstPut) return;
      blockedFirstPut = true;
      firstPutEntered.resolve();
      await releaseFirstPut.promise;
    };

    const stalePut = target.store.putImmutable(key, bytes);
    const staleOutcome = stalePut.then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    await firstPutEntered.promise;
    await expect(target.store.delete(key)).resolves.toBe(false);
    await expect(target.store.putImmutable(key, bytes)).resolves.toMatchObject({
      created: true,
    });

    releaseFirstPut.resolve();
    await expect(staleOutcome).resolves.toMatchObject({ status: "rejected" });
    const current = [...target.ledger.objects.values()][0]!;
    expect(current).toMatchObject({ generation: 2, state: "available" });
    expect([...target.client.objects.keys()]).toEqual([
      expect.stringMatching(/\.g2$/u),
    ]);
    expect([...target.ledger.orphans.values()]).toEqual([
      expect.objectContaining({ state: "deleted", generation: 1, fencingEpoch: 1 }),
    ]);
    expect(target.ledger.orphanReceipts).toHaveLength(1);
    await expect(target.store.head(key)).resolves.toMatchObject({ key });
    await expect(target.store.get(key)).resolves.toEqual(bytes);
  });

  it("lists the provider namespace and deletes only aged objects absent from the durable ledger", async () => {
    const target = harness();
    await target.store.putImmutable("known/object.bin", new Uint8Array([1]));
    const knownPathname = [...target.client.objects.keys()][0]!;
    const orphanPathname = `prod-compute/ff/${"f".repeat(64)}`;
    target.client.objects.set(orphanPathname, new Uint8Array([9]));
    target.client.uploadedAt.set(orphanPathname, 0);
    target.clock.set(10_000);
    const sweeper = new VercelBlobOrphanReconciliationSweeper({
      client: target.client,
      token: "token-with-at-least-sixteen-bytes",
      namespace: "prod-compute",
      ledger: target.ledger,
      clock: target.clock,
      minimumAgeMs: 1_000,
    });

    await expect(sweeper.sweep()).resolves.toEqual([
      expect.objectContaining({
        ledgerAbsent: true,
        headAbsent: true,
        getAbsent: true,
      }),
    ]);
    expect(target.client.objects.has(knownPathname)).toBe(true);
    expect(target.client.objects.has(orphanPathname)).toBe(false);
    expect(target.ledger.orphanReceipts).toHaveLength(1);
  });

  it("fails before provider put when the durable ledger cannot register the immutable intent", async () => {
    const target = harness();
    target.ledger.failBeginPut = true;
    await expect(target.store.putImmutable(
      "compute-inputs/no-orphan.bin",
      new Uint8Array([1, 2, 3]),
    )).rejects.toThrow("ledger unavailable");
    expect(target.client.objects.size).toBe(0);
  });

  it("uses private immutable writes, full readback hash, and opaque pathnames", async () => {
    const target = harness();
    const bytes = new TextEncoder().encode("exact scientific bytes");
    const first = await target.store.putImmutable("compute-inputs/job-1/dataset.bin", bytes);
    expect(first.created).toBe(true);
    expect(await target.store.get(first.descriptor.key)).toEqual(bytes);
    expect(await target.store.head(first.descriptor.key)).toEqual(first.descriptor);
    expect(target.client.putOptions).toEqual([{
      token: "token-with-at-least-sixteen-bytes",
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 0,
      contentType: "application/octet-stream",
    }]);
    const pathname = [...target.client.objects.keys()][0];
    expect(pathname).toMatch(/^prod-compute\/[a-f0-9]{2}\/[a-f0-9]{64}$/u);
    expect(pathname).not.toContain("job-1");
    await expect(target.store.putImmutable(first.descriptor.key, bytes)).resolves.toMatchObject({
      created: false,
    });
    await expect(target.store.putImmutable(
      first.descriptor.key,
      new TextEncoder().encode("different bytes"),
    )).rejects.toMatchObject({ code: "IMMUTABLE_OBJECT_CONFLICT" });
  });

  it("attests both HEAD and GET absence and fails closed on eventual-delete ghosts", async () => {
    const target = harness();
    const key = "compute-results/task/result.bin";
    await target.store.putImmutable(key, new Uint8Array([1, 2, 3]));
    target.clock.advance(25);
    await expect(target.store.delete(key)).resolves.toBe(true);
    expect(target.ledger.receipts).toEqual([expect.objectContaining({
      headAbsent: true,
      getAbsent: true,
      requestedAtMs: 1_025,
      completedAtMs: 1_025,
    })]);

    const ghost = harness();
    await ghost.store.putImmutable(key, new Uint8Array([4]));
    ghost.client.ignoreDelete = true;
    await expect(ghost.store.delete(key)).rejects.toMatchObject({
      code: "OBJECT_DELETION_NOT_OBSERVED",
    });
    expect(ghost.ledger.receipts).toHaveLength(0);
  });

  it("heals a provider put whose available receipt initially failed without changing generation", async () => {
    const target = harness();
    const key = "compute-inputs/receipt-retry.bin";
    target.ledger.failMarkAvailable = true;
    await expect(target.store.putImmutable(key, new Uint8Array([7, 8])))
      .rejects.toThrow("available receipt unavailable");
    expect(target.client.objects.size).toBe(1);
    const first = [...target.ledger.objects.values()][0]!;
    expect(first).toMatchObject({ generation: 1, fencingEpoch: 1, state: "intent" });
    await expect(target.store.head(key)).resolves.toBeNull();
    await expect(target.store.get(key)).resolves.toBeNull();

    await expect(target.store.putImmutable(key, new Uint8Array([7, 8])))
      .resolves.toMatchObject({ created: false });
    expect(first).toMatchObject({ generation: 1, fencingEpoch: 1, state: "available" });
  });

  it("does not let the orphan sweeper delete provider bytes while their put intent is unsettled", async () => {
    const target = harness();
    const providerWritten = deferred<void>();
    const releaseProviderPut = deferred<void>();
    target.client.afterPut = async () => {
      providerWritten.resolve();
      await releaseProviderPut.promise;
    };
    const key = "compute-inputs/writer-orphan-race.bin";
    const bytes = new Uint8Array([5, 5]);
    const pendingPut = target.store.putImmutable(key, bytes);
    await providerWritten.promise;

    const sweeper = new VercelBlobOrphanReconciliationSweeper({
      client: target.client,
      token: "token-with-at-least-sixteen-bytes",
      namespace: "prod-compute",
      ledger: target.ledger,
      clock: target.clock,
      minimumAgeMs: 1,
    });
    await expect(sweeper.sweep()).resolves.toEqual([]);
    expect(target.client.objects.size).toBe(1);
    expect(target.ledger.orphans.size).toBe(0);

    releaseProviderPut.resolve();
    await expect(pendingPut).resolves.toMatchObject({ created: true });
    await expect(target.store.get(key)).resolves.toEqual(bytes);
  });

  it("keeps a deleted provider object fenced until its durable receipt commits, then reactivates safely", async () => {
    const target = harness();
    const key = "compute-results/deletion-retry.bin";
    await target.store.putImmutable(key, new Uint8Array([3]));
    target.ledger.failCompleteDelete = true;
    await expect(target.store.delete(key)).rejects.toThrow("delete receipt unavailable");
    const object = [...target.ledger.objects.values()][0]!;
    expect(object.state).toBe("deleting");
    await expect(target.store.putImmutable(key, new Uint8Array([3])))
      .rejects.toMatchObject({ code: "IMMUTABLE_OBJECT_CONFLICT" });

    await expect(target.store.delete(key)).resolves.toBe(false);
    expect(object.state).toBe("deleted");
    await expect(target.store.putImmutable(key, new Uint8Array([3])))
      .resolves.toMatchObject({ created: true });
    expect(object).toMatchObject({ generation: 2, fencingEpoch: 3, state: "available" });
  });

  it("persists orphan delete intent before provider mutation and retries a failed completion receipt", async () => {
    const target = harness();
    const poison = `prod-compute/aa/${"a".repeat(64)}`;
    const healthy = `prod-compute/bb/${"b".repeat(64)}`;
    for (const pathname of [poison, healthy]) {
      target.client.objects.set(pathname, new Uint8Array([1]));
      target.client.uploadedAt.set(pathname, 0);
    }
    target.clock.set(10_000);
    target.ledger.failCompleteOrphanFor.add(poison);
    const failures: string[] = [];
    const sweeper = new VercelBlobOrphanReconciliationSweeper({
      client: target.client,
      token: "token-with-at-least-sixteen-bytes",
      namespace: "prod-compute",
      ledger: target.ledger,
      clock: target.clock,
      minimumAgeMs: 1_000,
      onObjectFailure: (pathname) => failures.push(pathname),
    });
    await expect(sweeper.sweep()).resolves.toHaveLength(1);
    expect(failures).toEqual([poison]);
    expect(target.ledger.orphans.get(poison)?.state).toBe("deleting");
    expect(target.ledger.orphans.get(healthy)?.state).toBe("deleted");
    await expect(target.ledger.beginPut({
      namespace: "prod-compute",
      objectRef: "c".repeat(64),
      objectKey: "new-writer.bin",
      pathname: poison,
      sha256: "d".repeat(64),
      byteLength: 1,
      createdAtMs: target.clock.now(),
      deleteAfterMs: target.clock.now() + 1_000,
    })).rejects.toThrow("orphan deletion fenced");

    await expect(sweeper.sweep()).resolves.toHaveLength(1);
    expect(target.ledger.orphans.get(poison)?.state).toBe("deleted");
    expect(target.ledger.orphanReceipts).toHaveLength(2);
  });
});
