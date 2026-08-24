import type {
  ComputeClock,
  ComputeObjectStore,
  ImmutableObjectDescriptor,
  ImmutableObjectPutResult,
} from "@3dena/compute-service-core";

import {
  OBJECT_DELETION_PROBE_VERSION,
  type ObjectDeletionProbeV1,
} from "./contracts";
import { persistentError } from "./errors";
import type { PostgresDatabase } from "./postgres";
import {
  assertObjectKey,
  bytesEqual,
  cloneFrozen,
  isRecord,
  sha256Bytes,
  sha256Text,
} from "./util";

export interface VercelPrivateBlobPutOptionsV1 {
  readonly token: string;
  readonly access: "private";
  readonly addRandomSuffix: false;
  readonly allowOverwrite: false;
  readonly cacheControlMaxAge: 0;
  readonly contentType: "application/octet-stream";
}

export interface VercelPrivateBlobClientV1 {
  put(
    pathname: string,
    bytes: Uint8Array,
    options: VercelPrivateBlobPutOptionsV1,
  ): Promise<Readonly<{ pathname: string; url: string }>>;
  head(pathname: string, token: string): Promise<Readonly<{ pathname: string; size: number }> | null>;
  download(pathname: string, token: string): Promise<Uint8Array | null>;
  del(pathname: string, token: string): Promise<void>;
}

export interface PersistentObjectLedger {
  register(input: Readonly<{
    objectRef: string;
    objectKey: string;
    pathname: string;
    sha256: string;
    byteLength: number;
    createdAtMs: number;
    deleteAfterMs: number;
  }>): Promise<void>;
  due(beforeMs: number, limit: number): Promise<readonly string[]>;
  attest(receipt: ObjectDeletionProbeV1): Promise<void>;
}

interface DueObjectRow extends Record<string, unknown> {
  readonly object_key: unknown;
}

export class PostgresObjectLedger implements PersistentObjectLedger {
  readonly #database: PostgresDatabase;

  constructor(database: PostgresDatabase) {
    this.#database = database;
  }

  async register(input: Readonly<{
    objectRef: string; objectKey: string; pathname: string; sha256: string;
    byteLength: number; createdAtMs: number; deleteAfterMs: number;
  }>): Promise<void> {
    const result = await this.#database.query(
      `INSERT INTO compute_objects (
        object_ref, object_key, pathname, sha256, byte_length, created_at, delete_after
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (object_ref) DO NOTHING`,
      [input.objectRef, input.objectKey, input.pathname, input.sha256, input.byteLength,
        new Date(input.createdAtMs).toISOString(), new Date(input.deleteAfterMs).toISOString()],
    );
    if (result.rowCount === 0) {
      const observed = await this.#database.query<{
        object_key: unknown; pathname: unknown; sha256: unknown; byte_length: unknown;
        [key: string]: unknown;
      }>(
        `SELECT object_key, pathname, sha256, byte_length FROM compute_objects
         WHERE object_ref = $1`, [input.objectRef],
      );
      const row = observed.rows[0];
      if (row?.object_key !== input.objectKey || row.pathname !== input.pathname ||
          row.sha256 !== input.sha256 || Number(row.byte_length) !== input.byteLength) {
        persistentError("IMMUTABLE_OBJECT_CONFLICT");
      }
    }
  }

  async due(beforeMs: number, limit: number): Promise<readonly string[]> {
    const result = await this.#database.query<DueObjectRow>(
      `SELECT object_key FROM compute_objects
       WHERE deleted_at IS NULL AND delete_after <= $1
       ORDER BY delete_after, object_ref LIMIT $2`,
      [new Date(beforeMs).toISOString(), limit],
    );
    return result.rows.map((row) => {
      if (typeof row.object_key !== "string") persistentError("DATABASE_FAILURE");
      return row.object_key;
    });
  }

  async attest(receipt: ObjectDeletionProbeV1): Promise<void> {
    await this.#database.transaction(async (sql) => {
      await sql.query(
        `INSERT INTO compute_deletion_receipts
           (object_ref, requested_at, completed_at, receipt)
         VALUES ($1,$2,$3,$4::jsonb)`,
        [receipt.objectRef, new Date(receipt.requestedAtMs).toISOString(),
          new Date(receipt.completedAtMs).toISOString(), JSON.stringify(receipt)],
      );
      await sql.query(
        `UPDATE compute_objects SET deleted_at = $2, deletion_receipt = $3::jsonb
         WHERE object_ref = $1 AND deleted_at IS NULL`,
        [receipt.objectRef, new Date(receipt.completedAtMs).toISOString(), JSON.stringify(receipt)],
      );
    });
  }
}

export interface VercelPrivateBlobObjectStoreOptionsV1 {
  readonly client: VercelPrivateBlobClientV1;
  readonly token: string;
  readonly namespace: string;
  readonly clock: ComputeClock;
  readonly ledger: PersistentObjectLedger;
  readonly retentionMs?: number;
}

const MAX_RETENTION_MS = 24 * 60 * 60_000;
const DEFAULT_SWEEP_RETENTION_MS = 23 * 60 * 60_000;

export class VercelPrivateBlobObjectStore implements ComputeObjectStore {
  readonly #client: VercelPrivateBlobClientV1;
  readonly #token: string;
  readonly #namespace: string;
  readonly #clock: ComputeClock;
  readonly #ledger: PersistentObjectLedger;
  readonly #retentionMs: number;

  constructor(options: VercelPrivateBlobObjectStoreOptionsV1) {
    if (!isRecord(options.client) || typeof options.client.put !== "function" ||
        typeof options.client.head !== "function" || typeof options.client.download !== "function" ||
        typeof options.client.del !== "function" || typeof options.token !== "string" || options.token.length < 16 ||
        typeof options.namespace !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/u.test(options.namespace)) {
      persistentError("CONFIGURATION_INVALID");
    }
    const retention = options.retentionMs ?? DEFAULT_SWEEP_RETENTION_MS;
    if (!Number.isSafeInteger(retention) || retention < 1 || retention > MAX_RETENTION_MS) {
      persistentError("CONFIGURATION_INVALID");
    }
    this.#client = options.client;
    this.#token = options.token;
    this.#namespace = options.namespace;
    this.#clock = options.clock;
    this.#ledger = options.ledger;
    this.#retentionMs = retention;
  }

  async putImmutable(key: string, bytes: Uint8Array): Promise<ImmutableObjectPutResult> {
    assertObjectKey(key);
    if (!(bytes instanceof Uint8Array)) persistentError("OBJECT_STORE_FAILURE");
    const snapshot = Uint8Array.from(bytes);
    const descriptor: ImmutableObjectDescriptor = Object.freeze({
      key,
      sha256: sha256Bytes(snapshot),
      byteLength: snapshot.byteLength,
    });
    const pathname = this.#pathname(key);
    const existing = await this.#read(pathname);
    if (existing !== null) {
      if (!bytesEqual(existing, snapshot)) persistentError("IMMUTABLE_OBJECT_CONFLICT");
      await this.#register(descriptor, pathname);
      return Object.freeze({ created: false, descriptor });
    }
    try {
      const put = await this.#client.put(pathname, snapshot, {
        token: this.#token,
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: 0,
        contentType: "application/octet-stream",
      });
      if (put.pathname !== pathname) persistentError("OBJECT_INTEGRITY_FAILURE");
    } catch {
      const raced = await this.#read(pathname);
      if (raced === null || !bytesEqual(raced, snapshot)) {
        persistentError("IMMUTABLE_OBJECT_CONFLICT");
      }
      await this.#register(descriptor, pathname);
      return Object.freeze({ created: false, descriptor });
    }
    const readback = await this.#read(pathname);
    const observedHead = await this.#client.head(pathname, this.#token);
    if (readback === null || !bytesEqual(readback, snapshot) ||
        observedHead === null || observedHead.pathname !== pathname || observedHead.size !== snapshot.byteLength) {
      persistentError("OBJECT_INTEGRITY_FAILURE");
    }
    await this.#register(descriptor, pathname);
    return Object.freeze({ created: true, descriptor });
  }

  async head(key: string): Promise<ImmutableObjectDescriptor | null> {
    assertObjectKey(key);
    const pathname = this.#pathname(key);
    const metadata = await this.#client.head(pathname, this.#token);
    if (metadata === null) return null;
    const bytes = await this.#read(pathname);
    if (bytes === null || metadata.pathname !== pathname || metadata.size !== bytes.byteLength) {
      persistentError("OBJECT_INTEGRITY_FAILURE");
    }
    return Object.freeze({ key, sha256: sha256Bytes(bytes), byteLength: bytes.byteLength });
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertObjectKey(key);
    return this.#read(this.#pathname(key));
  }

  async delete(key: string): Promise<boolean> {
    assertObjectKey(key);
    const pathname = this.#pathname(key);
    const existed = (await this.#client.head(pathname, this.#token)) !== null;
    const requestedAtMs = this.#clock.now();
    try {
      await this.#client.del(pathname, this.#token);
    } catch {
      persistentError("OBJECT_STORE_FAILURE");
    }
    const headAbsent = (await this.#client.head(pathname, this.#token)) === null;
    const getAbsent = (await this.#read(pathname)) === null;
    if (!headAbsent || !getAbsent) persistentError("OBJECT_DELETION_NOT_OBSERVED");
    const receipt: ObjectDeletionProbeV1 = Object.freeze({
      version: OBJECT_DELETION_PROBE_VERSION,
      objectRef: sha256Text(key),
      requestedAtMs,
      completedAtMs: this.#clock.now(),
      headAbsent: true,
      getAbsent: true,
    });
    await this.#ledger.attest(receipt);
    return existed;
  }

  async #read(pathname: string): Promise<Uint8Array | null> {
    try {
      const value = await this.#client.download(pathname, this.#token);
      return value === null ? null : Uint8Array.from(value);
    } catch {
      persistentError("OBJECT_STORE_FAILURE");
    }
  }

  #pathname(key: string): string {
    return `${this.#namespace}/${sha256Text(key).slice(0, 2)}/${sha256Text(key)}`;
  }

  async #register(descriptor: ImmutableObjectDescriptor, pathname: string): Promise<void> {
    const now = this.#clock.now();
    await this.#ledger.register({
      objectRef: sha256Text(descriptor.key),
      objectKey: descriptor.key,
      pathname,
      sha256: descriptor.sha256,
      byteLength: descriptor.byteLength,
      createdAtMs: now,
      deleteAfterMs: now + this.#retentionMs,
    });
  }
}

export class PersistentObjectRetentionSweeper {
  readonly #store: ComputeObjectStore;
  readonly #ledger: PersistentObjectLedger;
  readonly #clock: ComputeClock;
  readonly #batchSize: number;

  constructor(input: Readonly<{
    store: ComputeObjectStore;
    ledger: PersistentObjectLedger;
    clock: ComputeClock;
    batchSize?: number;
  }>) {
    this.#store = input.store;
    this.#ledger = input.ledger;
    this.#clock = input.clock;
    this.#batchSize = input.batchSize ?? 100;
    if (!Number.isSafeInteger(this.#batchSize) || this.#batchSize < 1 || this.#batchSize > 1000) {
      persistentError("CONFIGURATION_INVALID");
    }
  }

  /** The ledger delete_after should be at most 23h so retries finish before 24h. */
  async sweep(): Promise<readonly string[]> {
    const keys = await this.#ledger.due(this.#clock.now(), this.#batchSize);
    const deleted: string[] = [];
    for (const key of keys) {
      await this.#store.delete(key);
      deleted.push(sha256Text(key));
    }
    return Object.freeze(deleted);
  }
}
