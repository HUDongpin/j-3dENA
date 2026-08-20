import { describe, expect, it } from "vitest";

import { ManualComputeClock } from "@3dena/compute-service-core";

import type { ObjectDeletionProbeV1 } from "./contracts";
import type {
  PersistentObjectLedger,
  VercelPrivateBlobClientV1,
  VercelPrivateBlobPutOptionsV1,
} from "./vercel-blob";
import { VercelPrivateBlobObjectStore } from "./vercel-blob";

class MemoryBlobClient implements VercelPrivateBlobClientV1 {
  readonly objects = new Map<string, Uint8Array>();
  readonly putOptions: VercelPrivateBlobPutOptionsV1[] = [];
  ignoreDelete = false;

  async put(pathname: string, bytes: Uint8Array, options: VercelPrivateBlobPutOptionsV1) {
    this.putOptions.push(options);
    if (this.objects.has(pathname)) throw new Error("exists");
    this.objects.set(pathname, Uint8Array.from(bytes));
    return { pathname, url: `https://blob.invalid/${pathname}` };
  }

  async head(pathname: string) {
    const bytes = this.objects.get(pathname);
    return bytes === undefined ? null : { pathname, size: bytes.byteLength };
  }

  async download(pathname: string) {
    const bytes = this.objects.get(pathname);
    return bytes === undefined ? null : Uint8Array.from(bytes);
  }

  async del(pathname: string) {
    if (!this.ignoreDelete) this.objects.delete(pathname);
  }
}

class MemoryLedger implements PersistentObjectLedger {
  readonly registrations: unknown[] = [];
  readonly receipts: ObjectDeletionProbeV1[] = [];
  dueKeys: readonly string[] = [];

  async register(input: Parameters<PersistentObjectLedger["register"]>[0]) {
    this.registrations.push(structuredClone(input));
  }

  async due() {
    return this.dueKeys;
  }

  async attest(receipt: ObjectDeletionProbeV1) {
    this.receipts.push(structuredClone(receipt));
  }
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
});
