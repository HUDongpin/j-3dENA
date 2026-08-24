import type {
  ComputeClock,
  ComputeObjectStore,
  ImmutableObjectDescriptor,
  ImmutableObjectPutResult,
} from "@3dena/compute-service-core";

import {
  OBJECT_DELETION_PROBE_VERSION,
  type ObjectDeletionProbeV1,
  ORPHAN_RECONCILIATION_RECEIPT_VERSION,
  type OrphanReconciliationReceiptV1,
} from "./contracts";
import { persistentError } from "./errors";
import type { PostgresDatabase, SqlQueryExecutor } from "./postgres";
import {
  assertObjectKey,
  bytesEqual,
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
  put(pathname: string, bytes: Uint8Array, options: VercelPrivateBlobPutOptionsV1):
    Promise<Readonly<{ pathname: string; url: string }>>;
  head(pathname: string, token: string):
    Promise<Readonly<{ pathname: string; size: number; uploadedAtMs: number }> | null>;
  download(pathname: string, token: string): Promise<Uint8Array | null>;
  del(pathname: string, token: string): Promise<void>;
  list(prefix: string, token: string, cursor: string | null, limit: number):
    Promise<Readonly<{
      blobs: readonly Readonly<{ pathname: string; uploadedAtMs: number }>[];
      cursor: string | null;
      hasMore: boolean;
    }>>;
}

export type PersistentObjectStateV1 = "intent" | "available" | "deleting" | "deleted";

export interface PersistentObjectLeaseV1 {
  readonly objectRef: string;
  readonly objectKey: string;
  readonly pathname: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly generation: number;
  readonly fencingEpoch: number;
  readonly state: PersistentObjectStateV1;
}

export interface PersistentOrphanDeletionLeaseV1 {
  readonly objectRef: string;
  readonly namespace: string;
  readonly pathname: string;
  readonly generation: number;
  readonly fencingEpoch: number;
  readonly providerUploadedAtMs: number;
  readonly discoveredAtMs: number;
}

/** Durable fencing is mandatory; provider mutation never precedes these intents. */
export interface PersistentObjectLedger {
  beginPut(input: Readonly<{
    namespace: string;
    objectRef: string;
    objectKey: string;
    pathname: string;
    sha256: string;
    byteLength: number;
    createdAtMs: number;
    deleteAfterMs: number;
  }>): Promise<PersistentObjectLeaseV1>;
  markAvailable(lease: PersistentObjectLeaseV1, availableAtMs: number): Promise<void>;
  resolve(objectKey: string): Promise<PersistentObjectLeaseV1 | null>;
  beginDelete(objectKey: string, requestedAtMs: number): Promise<PersistentObjectLeaseV1 | null>;
  completeDelete(lease: PersistentObjectLeaseV1, receipt: ObjectDeletionProbeV1): Promise<void>;
  due(beforeMs: number, limit: number): Promise<readonly string[]>;
  beginOrphanDelete(input: Readonly<{
    namespace: string;
    pathname: string;
    providerUploadedAtMs: number;
    discoveredAtMs: number;
  }>): Promise<PersistentOrphanDeletionLeaseV1 | null>;
  dueOrphanDeletes(
    namespace: string,
    limit: number,
  ): Promise<readonly PersistentOrphanDeletionLeaseV1[]>;
  completeOrphanDelete(
    lease: PersistentOrphanDeletionLeaseV1,
    receipt: OrphanReconciliationReceiptV1,
  ): Promise<void>;
}

interface ObjectRow extends Record<string, unknown> {
  readonly object_ref: unknown;
  readonly object_key: unknown;
  readonly pathname: unknown;
  readonly sha256: unknown;
  readonly byte_length: unknown;
  readonly generation: unknown;
  readonly fencing_epoch: unknown;
  readonly state: unknown;
}

function positiveInteger(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 1) persistentError("DATABASE_FAILURE");
  return Number(parsed);
}

function objectLease(row: ObjectRow): PersistentObjectLeaseV1 {
  if (typeof row.object_ref !== "string" || !/^[a-f0-9]{64}$/u.test(row.object_ref) ||
      typeof row.object_key !== "string" || typeof row.pathname !== "string" ||
      typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(row.sha256) ||
      !["intent", "available", "deleting", "deleted"].includes(String(row.state))) {
    persistentError("DATABASE_FAILURE");
  }
  const byteLength = typeof row.byte_length === "string"
    ? Number(row.byte_length)
    : row.byte_length;
  if (!Number.isSafeInteger(byteLength) || Number(byteLength) < 0) {
    persistentError("DATABASE_FAILURE");
  }
  return Object.freeze({
    objectRef: row.object_ref,
    objectKey: row.object_key,
    pathname: row.pathname,
    sha256: row.sha256,
    byteLength: Number(byteLength),
    generation: positiveInteger(row.generation),
    fencingEpoch: positiveInteger(row.fencing_epoch),
    state: row.state as PersistentObjectStateV1,
  });
}

function generationPathname(basePathname: string, generation: number): string {
  return generation === 1 ? basePathname : `${basePathname}.g${generation}`;
}

async function lockNamespace(sql: SqlQueryExecutor, namespace: string): Promise<void> {
  await sql.query(
    `INSERT INTO compute_blob_namespace_locks (namespace, fencing_epoch, updated_at)
     VALUES ($1, 1, clock_timestamp()) ON CONFLICT (namespace) DO NOTHING`,
    [namespace],
  );
  const locked = await sql.query(
    `SELECT fencing_epoch FROM compute_blob_namespace_locks
     WHERE namespace = $1 FOR UPDATE`,
    [namespace],
  );
  if (locked.rowCount !== 1) persistentError("DATABASE_FAILURE");
}

export class PostgresObjectLedger implements PersistentObjectLedger {
  constructor(private readonly database: PostgresDatabase) {}

  async beginPut(input: Readonly<{
    namespace: string; objectRef: string; objectKey: string; pathname: string;
    sha256: string; byteLength: number; createdAtMs: number; deleteAfterMs: number;
  }>): Promise<PersistentObjectLeaseV1> {
    return this.database.transaction(async (sql) => {
      await lockNamespace(sql, input.namespace);
      const found = await sql.query<ObjectRow>(
        `SELECT object_ref, object_key, pathname, sha256, byte_length,
           generation, fencing_epoch, state
         FROM compute_objects WHERE object_ref = $1 FOR UPDATE`,
        [input.objectRef],
      );
      if (found.rows[0] === undefined) {
        const pathname = generationPathname(input.pathname, 1);
        const orphan = await sql.query(
          `SELECT 1 FROM compute_blob_orphan_intents
           WHERE pathname = $1 AND state = 'deleting' FOR UPDATE`,
          [pathname],
        );
        if (orphan.rowCount !== 0) persistentError("IMMUTABLE_OBJECT_CONFLICT");
        const inserted = await sql.query<ObjectRow>(
          `INSERT INTO compute_objects (
             object_ref, object_key, pathname, sha256, byte_length,
             created_at, delete_after, generation, fencing_epoch, state,
             intent_at, available_at, deleting_at, deleted_at, deletion_receipt
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,1,1,'intent',$6,NULL,NULL,NULL,NULL)
           RETURNING object_ref, object_key, pathname, sha256, byte_length,
             generation, fencing_epoch, state`,
          [input.objectRef, input.objectKey, pathname, input.sha256,
            input.byteLength, new Date(input.createdAtMs).toISOString(),
            new Date(input.deleteAfterMs).toISOString()],
        );
        if (inserted.rowCount !== 1 || inserted.rows[0] === undefined) {
          persistentError("DATABASE_FAILURE");
        }
        return objectLease(inserted.rows[0]);
      }
      const row = found.rows[0];
      const current = objectLease(row);
      const expectedCurrentPathname = generationPathname(input.pathname, current.generation);
      if (current.objectKey !== input.objectKey || current.pathname !== expectedCurrentPathname ||
          current.sha256 !== input.sha256 || current.byteLength !== input.byteLength) {
        persistentError("IMMUTABLE_OBJECT_CONFLICT");
      }
      if (current.state === "deleting") persistentError("IMMUTABLE_OBJECT_CONFLICT");
      if (current.state !== "deleted") return current;
      const nextGeneration = current.generation + 1;
      if (!Number.isSafeInteger(nextGeneration)) persistentError("DATABASE_FAILURE");
      const nextPathname = generationPathname(input.pathname, nextGeneration);
      const orphan = await sql.query(
        `SELECT 1 FROM compute_blob_orphan_intents
         WHERE pathname = $1 AND state = 'deleting' FOR UPDATE`,
        [nextPathname],
      );
      if (orphan.rowCount !== 0) persistentError("IMMUTABLE_OBJECT_CONFLICT");
      const reactivated = await sql.query<ObjectRow>(
        `UPDATE compute_objects SET generation = generation + 1,
           fencing_epoch = fencing_epoch + 1, state = 'intent',
           created_at = $2, delete_after = $3, intent_at = $2,
           available_at = NULL, deleting_at = NULL, deleted_at = NULL,
           deletion_receipt = NULL, pathname = $6
         WHERE object_ref = $1 AND generation = $4 AND fencing_epoch = $5
           AND state = 'deleted'
         RETURNING object_ref, object_key, pathname, sha256, byte_length,
           generation, fencing_epoch, state`,
        [input.objectRef, new Date(input.createdAtMs).toISOString(),
          new Date(input.deleteAfterMs).toISOString(), current.generation,
          current.fencingEpoch, nextPathname],
      );
      if (reactivated.rowCount !== 1 || reactivated.rows[0] === undefined) {
        persistentError("DATABASE_CONFLICT");
      }
      return objectLease(reactivated.rows[0]);
    });
  }

  async markAvailable(lease: PersistentObjectLeaseV1, atMs: number): Promise<void> {
    const updated = await this.database.query(
      `UPDATE compute_objects SET state = 'available', available_at = $4
       WHERE object_ref = $1 AND generation = $2 AND fencing_epoch = $3
         AND state = 'intent'`,
      [lease.objectRef, lease.generation, lease.fencingEpoch, new Date(atMs).toISOString()],
    );
    if (updated.rowCount === 1) return;
    const found = await this.database.query<ObjectRow>(
      `SELECT object_ref, object_key, pathname, sha256, byte_length,
         generation, fencing_epoch, state FROM compute_objects WHERE object_ref = $1`,
      [lease.objectRef],
    );
    const current = found.rows[0] === undefined ? null : objectLease(found.rows[0]);
    if (current?.generation !== lease.generation || current.fencingEpoch !== lease.fencingEpoch ||
        current.state !== "available") persistentError("DATABASE_CONFLICT");
  }

  async resolve(objectKey: string): Promise<PersistentObjectLeaseV1 | null> {
    const found = await this.database.query<ObjectRow>(
      `SELECT object_ref, object_key, pathname, sha256, byte_length,
         generation, fencing_epoch, state
       FROM compute_objects WHERE object_key = $1`,
      [objectKey],
    );
    if (found.rowCount === 0) return null;
    if (found.rowCount !== 1 || found.rows[0] === undefined) {
      persistentError("DATABASE_FAILURE");
    }
    return objectLease(found.rows[0]);
  }

  async beginDelete(objectKey: string, requestedAtMs: number): Promise<PersistentObjectLeaseV1 | null> {
    return this.database.transaction(async (sql) => {
      const found = await sql.query<ObjectRow>(
        `SELECT object_ref, object_key, pathname, sha256, byte_length,
           generation, fencing_epoch, state
         FROM compute_objects WHERE object_key = $1 FOR UPDATE`,
        [objectKey],
      );
      if (found.rows[0] === undefined) return null;
      const current = objectLease(found.rows[0]);
      if (current.state === "deleted") return null;
      if (current.state === "deleting") return current;
      const updated = await sql.query<ObjectRow>(
        `UPDATE compute_objects SET state = 'deleting',
           fencing_epoch = fencing_epoch + 1, deleting_at = $4
         WHERE object_ref = $1 AND generation = $2 AND fencing_epoch = $3
           AND state IN ('intent','available')
         RETURNING object_ref, object_key, pathname, sha256, byte_length,
           generation, fencing_epoch, state`,
        [current.objectRef, current.generation, current.fencingEpoch,
          new Date(requestedAtMs).toISOString()],
      );
      if (updated.rowCount !== 1 || updated.rows[0] === undefined) {
        persistentError("DATABASE_CONFLICT");
      }
      return objectLease(updated.rows[0]);
    });
  }

  async completeDelete(lease: PersistentObjectLeaseV1, receipt: ObjectDeletionProbeV1): Promise<void> {
    await this.database.transaction(async (sql) => {
      await sql.query(
        `INSERT INTO compute_deletion_receipts
           (object_ref, requested_at, completed_at, receipt)
         VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`,
        [receipt.objectRef, new Date(receipt.requestedAtMs).toISOString(),
          new Date(receipt.completedAtMs).toISOString(), JSON.stringify(receipt)],
      );
      const updated = await sql.query(
        `UPDATE compute_objects SET state = 'deleted', deleted_at = $4,
           deletion_receipt = $5::jsonb
         WHERE object_ref = $1 AND generation = $2 AND fencing_epoch = $3
           AND state = 'deleting'`,
        [lease.objectRef, lease.generation, lease.fencingEpoch,
          new Date(receipt.completedAtMs).toISOString(), JSON.stringify(receipt)],
      );
      if (updated.rowCount === 1) return;
      const found = await sql.query<ObjectRow>(
        `SELECT object_ref, object_key, pathname, sha256, byte_length,
           generation, fencing_epoch, state FROM compute_objects
         WHERE object_ref = $1 FOR UPDATE`, [lease.objectRef],
      );
      const current = found.rows[0] === undefined ? null : objectLease(found.rows[0]);
      if (current?.generation !== lease.generation || current.fencingEpoch !== lease.fencingEpoch ||
          current.state !== "deleted") persistentError("DATABASE_CONFLICT");
    });
  }

  async due(beforeMs: number, limit: number): Promise<readonly string[]> {
    const result = await this.database.query<{ object_key: unknown; [key: string]: unknown }>(
      `SELECT object_key FROM compute_objects
       WHERE state = 'deleting'
          OR (state IN ('intent','available') AND delete_after <= $1)
       ORDER BY delete_after, object_ref LIMIT $2`,
      [new Date(beforeMs).toISOString(), limit],
    );
    return Object.freeze(result.rows.map((row) => {
      if (typeof row.object_key !== "string") persistentError("DATABASE_FAILURE");
      return row.object_key;
    }));
  }

  async beginOrphanDelete(input: Readonly<{
    namespace: string; pathname: string; providerUploadedAtMs: number; discoveredAtMs: number;
  }>): Promise<PersistentOrphanDeletionLeaseV1 | null> {
    return this.database.transaction(async (sql) => {
      await lockNamespace(sql, input.namespace);
      const known = await sql.query<{ state: unknown; [key: string]: unknown }>(
        `SELECT state FROM compute_objects WHERE pathname = $1 FOR UPDATE`, [input.pathname],
      );
      if (known.rows[0] !== undefined && known.rows[0].state !== "deleted") return null;
      const existing = await sql.query<{
        generation: unknown; fencing_epoch: unknown; state: unknown;
        provider_uploaded_at_ms: unknown; discovered_at_ms: unknown;
        [key: string]: unknown;
      }>(
        `SELECT generation, fencing_epoch, state,
           extract(epoch FROM provider_uploaded_at) * 1000 AS provider_uploaded_at_ms,
           extract(epoch FROM discovered_at) * 1000 AS discovered_at_ms
         FROM compute_blob_orphan_intents WHERE pathname = $1 FOR UPDATE`,
        [input.pathname],
      );
      let generation = 1;
      let fencingEpoch = 1;
      let discoveredAtMs = input.discoveredAtMs;
      const row = existing.rows[0];
      if (row === undefined) {
        const inserted = await sql.query(
          `INSERT INTO compute_blob_orphan_intents (
             pathname, namespace, object_ref, generation, fencing_epoch,
             state, provider_uploaded_at, discovered_at
           ) VALUES ($1,$2,$3,1,1,'deleting',$4,$5)`,
          [input.pathname, input.namespace, sha256Text(input.pathname),
            new Date(input.providerUploadedAtMs).toISOString(),
            new Date(input.discoveredAtMs).toISOString()],
        );
        if (inserted.rowCount !== 1) persistentError("DATABASE_FAILURE");
      } else if (row.state === "deleting") {
        generation = positiveInteger(row.generation);
        fencingEpoch = positiveInteger(row.fencing_epoch);
        if (Number(row.provider_uploaded_at_ms) !== input.providerUploadedAtMs) {
          persistentError("DATABASE_CONFLICT");
        }
        discoveredAtMs = Number(row.discovered_at_ms);
      } else if (row.state === "deleted") {
        generation = positiveInteger(row.generation) + 1;
        fencingEpoch = positiveInteger(row.fencing_epoch) + 1;
        const updated = await sql.query(
          `UPDATE compute_blob_orphan_intents SET generation = $2,
             fencing_epoch = $3, state = 'deleting', provider_uploaded_at = $4,
             discovered_at = $5, completed_at = NULL, receipt = NULL
           WHERE pathname = $1 AND state = 'deleted'`,
          [input.pathname, generation, fencingEpoch,
            new Date(input.providerUploadedAtMs).toISOString(),
            new Date(input.discoveredAtMs).toISOString()],
        );
        if (updated.rowCount !== 1) persistentError("DATABASE_CONFLICT");
      } else {
        persistentError("DATABASE_FAILURE");
      }
      return Object.freeze({
        objectRef: sha256Text(input.pathname), namespace: input.namespace,
        pathname: input.pathname, generation, fencingEpoch,
        providerUploadedAtMs: input.providerUploadedAtMs, discoveredAtMs,
      });
    });
  }

  async completeOrphanDelete(
    lease: PersistentOrphanDeletionLeaseV1,
    receipt: OrphanReconciliationReceiptV1,
  ): Promise<void> {
    const updated = await this.database.query(
      `UPDATE compute_blob_orphan_intents SET state = 'deleted',
         completed_at = $4, receipt = $5::jsonb
       WHERE pathname = $1 AND generation = $2 AND fencing_epoch = $3
         AND state = 'deleting'`,
      [lease.pathname, lease.generation, lease.fencingEpoch,
        new Date(receipt.completedAtMs).toISOString(), JSON.stringify(receipt)],
    );
    if (updated.rowCount === 1) return;
    const found = await this.database.query<{
      generation: unknown; fencing_epoch: unknown; state: unknown;
      [key: string]: unknown;
    }>(
      `SELECT generation, fencing_epoch, state FROM compute_blob_orphan_intents
       WHERE pathname = $1`, [lease.pathname],
    );
    const row = found.rows[0];
    if (positiveInteger(row?.generation) !== lease.generation ||
        positiveInteger(row?.fencing_epoch) !== lease.fencingEpoch || row?.state !== "deleted") {
      persistentError("DATABASE_CONFLICT");
    }
  }

  async dueOrphanDeletes(
    namespace: string,
    limit: number,
  ): Promise<readonly PersistentOrphanDeletionLeaseV1[]> {
    const result = await this.database.query<{
      object_ref: unknown; pathname: unknown; generation: unknown;
      fencing_epoch: unknown; provider_uploaded_at_ms: unknown;
      discovered_at_ms: unknown; [key: string]: unknown;
    }>(
      `SELECT object_ref, pathname, generation, fencing_epoch,
         extract(epoch FROM provider_uploaded_at) * 1000 AS provider_uploaded_at_ms,
         extract(epoch FROM discovered_at) * 1000 AS discovered_at_ms
       FROM compute_blob_orphan_intents
       WHERE namespace = $1 AND state = 'deleting'
       ORDER BY discovered_at, pathname LIMIT $2`,
      [namespace, limit],
    );
    return Object.freeze(result.rows.map((row) => {
      if (typeof row.object_ref !== "string" || typeof row.pathname !== "string" ||
          !Number.isSafeInteger(Number(row.provider_uploaded_at_ms)) ||
          !Number.isSafeInteger(Number(row.discovered_at_ms))) {
        persistentError("DATABASE_FAILURE");
      }
      return Object.freeze({
        objectRef: row.object_ref,
        namespace,
        pathname: row.pathname,
        generation: positiveInteger(row.generation),
        fencingEpoch: positiveInteger(row.fencing_epoch),
        providerUploadedAtMs: Number(row.provider_uploaded_at_ms),
        discoveredAtMs: Number(row.discovered_at_ms),
      });
    }));
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
  readonly #retentionMs: number;

  constructor(private readonly options: VercelPrivateBlobObjectStoreOptionsV1) {
    if (!isRecord(options.client) || typeof options.client.put !== "function" ||
        typeof options.client.head !== "function" || typeof options.client.download !== "function" ||
        typeof options.client.del !== "function" || typeof options.token !== "string" ||
        options.token.length < 16 || !/^[a-z0-9][a-z0-9-]{0,62}$/u.test(options.namespace)) {
      persistentError("CONFIGURATION_INVALID");
    }
    this.#retentionMs = options.retentionMs ?? DEFAULT_SWEEP_RETENTION_MS;
    if (!Number.isSafeInteger(this.#retentionMs) || this.#retentionMs < 1 ||
        this.#retentionMs > MAX_RETENTION_MS) persistentError("CONFIGURATION_INVALID");
  }

  async putImmutable(key: string, bytes: Uint8Array): Promise<ImmutableObjectPutResult> {
    assertObjectKey(key);
    if (!(bytes instanceof Uint8Array)) persistentError("OBJECT_STORE_FAILURE");
    const snapshot = Uint8Array.from(bytes);
    const descriptor: ImmutableObjectDescriptor = Object.freeze({
      key, sha256: sha256Bytes(snapshot), byteLength: snapshot.byteLength,
    });
    const basePathname = this.#pathname(key);
    const now = this.options.clock.now();
    const lease = await this.options.ledger.beginPut({
      namespace: this.options.namespace, objectRef: sha256Text(key), objectKey: key,
      pathname: basePathname, sha256: descriptor.sha256, byteLength: descriptor.byteLength,
      createdAtMs: now, deleteAfterMs: now + this.#retentionMs,
    });
    this.#assertLease(lease, descriptor, basePathname);
    const pathname = lease.pathname;
    const existing = await this.#read(pathname);
    if (existing !== null) {
      if (!bytesEqual(existing, snapshot)) persistentError("IMMUTABLE_OBJECT_CONFLICT");
      await this.#assertProviderObject(pathname, snapshot);
      await this.#markAvailableOrRollback(lease);
      return Object.freeze({ created: false, descriptor });
    }
    if (lease.state === "available") persistentError("OBJECT_INTEGRITY_FAILURE");
    try {
      const put = await this.options.client.put(pathname, snapshot, {
        token: this.options.token, access: "private", addRandomSuffix: false,
        allowOverwrite: false, cacheControlMaxAge: 0,
        contentType: "application/octet-stream",
      });
      if (put.pathname !== pathname) persistentError("OBJECT_INTEGRITY_FAILURE");
    } catch {
      const raced = await this.#read(pathname);
      if (raced === null || !bytesEqual(raced, snapshot)) {
        persistentError("IMMUTABLE_OBJECT_CONFLICT");
      }
      await this.#assertProviderObject(pathname, snapshot);
      await this.#markAvailableOrRollback(lease);
      return Object.freeze({ created: false, descriptor });
    }
    await this.#assertProviderObject(pathname, snapshot);
    await this.#markAvailableOrRollback(lease);
    return Object.freeze({ created: true, descriptor });
  }

  async head(key: string): Promise<ImmutableObjectDescriptor | null> {
    assertObjectKey(key);
    const available = await this.#readAvailable(key);
    if (available === null) return null;
    return Object.freeze({
      key,
      sha256: available.lease.sha256,
      byteLength: available.lease.byteLength,
    });
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertObjectKey(key);
    const available = await this.#readAvailable(key);
    return available === null ? null : Uint8Array.from(available.bytes);
  }

  async delete(key: string): Promise<boolean> {
    assertObjectKey(key);
    const requestedAtMs = this.options.clock.now();
    const lease = await this.options.ledger.beginDelete(key, requestedAtMs);
    if (lease === null) {
      const current = await this.options.ledger.resolve(key);
      if (current !== null && current.state === "deleted") {
        await this.#deleteDeletedGeneration(current);
      }
      return false;
    }
    this.#assertLease(lease, {
      key,
      sha256: lease.sha256,
      byteLength: lease.byteLength,
    }, this.#pathname(key));
    const pathname = lease.pathname;
    const existed = (await this.options.client.head(pathname, this.options.token)) !== null;
    try {
      await this.options.client.del(pathname, this.options.token);
    } catch {
      persistentError("OBJECT_STORE_FAILURE");
    }
    const headAbsent = (await this.options.client.head(pathname, this.options.token)) === null;
    const getAbsent = (await this.#read(pathname)) === null;
    if (!headAbsent || !getAbsent) persistentError("OBJECT_DELETION_NOT_OBSERVED");
    await this.options.ledger.completeDelete(lease, Object.freeze({
      version: OBJECT_DELETION_PROBE_VERSION, objectRef: sha256Text(key),
      requestedAtMs, completedAtMs: this.options.clock.now(),
      headAbsent: true, getAbsent: true,
    }));
    return existed;
  }

  async #markAvailableOrRollback(lease: PersistentObjectLeaseV1): Promise<void> {
    try {
      await this.options.ledger.markAvailable(lease, this.options.clock.now());
      return;
    } catch (error) {
      let current: PersistentObjectLeaseV1 | null;
      try {
        current = await this.options.ledger.resolve(lease.objectKey);
      } catch {
        throw error;
      }
      if (current !== null && current.generation === lease.generation &&
          current.fencingEpoch === lease.fencingEpoch &&
          current.pathname === lease.pathname) {
        if (current.state === "available") return;
        if (current.state === "intent") throw error;
      }
      await this.#rollbackStalePut(lease);
      throw error;
    }
  }

  async #rollbackStalePut(lease: PersistentObjectLeaseV1): Promise<void> {
    const discoveredAtMs = this.options.clock.now();
    const providerObject = await this.options.client.head(lease.pathname, this.options.token);
    if (providerObject === null) return;
    if (!Number.isSafeInteger(providerObject.uploadedAtMs) || providerObject.uploadedAtMs < 0) {
      persistentError("OBJECT_INTEGRITY_FAILURE");
    }
    const orphan = await this.options.ledger.beginOrphanDelete({
      namespace: this.options.namespace,
      pathname: lease.pathname,
      providerUploadedAtMs: providerObject.uploadedAtMs,
      discoveredAtMs,
    });
    await this.options.client.del(lease.pathname, this.options.token);
    const [head, bytes] = await Promise.all([
      this.options.client.head(lease.pathname, this.options.token),
      this.#read(lease.pathname),
    ]);
    if (head !== null || bytes !== null) persistentError("OBJECT_DELETION_NOT_OBSERVED");
    if (orphan !== null) {
      await this.options.ledger.completeOrphanDelete(orphan, Object.freeze({
        version: ORPHAN_RECONCILIATION_RECEIPT_VERSION,
        objectRef: orphan.objectRef,
        providerUploadedAtMs: orphan.providerUploadedAtMs,
        discoveredAtMs: orphan.discoveredAtMs,
        completedAtMs: this.options.clock.now(),
        ledgerAbsent: true,
        headAbsent: true,
        getAbsent: true,
      }));
    }
  }

  async #deleteDeletedGeneration(lease: PersistentObjectLeaseV1): Promise<void> {
    const [head, bytes] = await Promise.all([
      this.options.client.head(lease.pathname, this.options.token),
      this.#read(lease.pathname),
    ]);
    if (head === null && bytes === null) return;
    if (head === null || bytes === null) persistentError("OBJECT_INTEGRITY_FAILURE");
    await this.#rollbackStalePut(lease);
  }

  async #readAvailable(
    key: string,
  ): Promise<Readonly<{ lease: PersistentObjectLeaseV1; bytes: Uint8Array }> | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const lease = await this.options.ledger.resolve(key);
      if (lease === null || lease.state !== "available") return null;
      this.#assertLease(lease, {
        key,
        sha256: lease.sha256,
        byteLength: lease.byteLength,
      }, this.#pathname(key));
      const [metadata, bytes] = await Promise.all([
        this.options.client.head(lease.pathname, this.options.token),
        this.#read(lease.pathname),
      ]);
      if (metadata !== null && bytes !== null && metadata.pathname === lease.pathname &&
          metadata.size === lease.byteLength && bytes.byteLength === lease.byteLength &&
          sha256Bytes(bytes) === lease.sha256) {
        return Object.freeze({ lease, bytes });
      }
      const current = await this.options.ledger.resolve(key);
      if (current === null || current.state !== "available") return null;
      if (current.generation !== lease.generation ||
          current.fencingEpoch !== lease.fencingEpoch ||
          current.pathname !== lease.pathname) continue;
      persistentError("OBJECT_INTEGRITY_FAILURE");
    }
    persistentError("OBJECT_INTEGRITY_FAILURE");
  }

  #assertLease(
    lease: PersistentObjectLeaseV1,
    descriptor: ImmutableObjectDescriptor,
    basePathname: string,
  ): void {
    if (lease.objectRef !== sha256Text(descriptor.key) || lease.objectKey !== descriptor.key ||
        lease.sha256 !== descriptor.sha256 || lease.byteLength !== descriptor.byteLength ||
        lease.pathname !== generationPathname(basePathname, lease.generation)) {
      persistentError("OBJECT_INTEGRITY_FAILURE");
    }
  }

  async #assertProviderObject(pathname: string, expected: Uint8Array): Promise<void> {
    const [bytes, head] = await Promise.all([
      this.#read(pathname), this.options.client.head(pathname, this.options.token),
    ]);
    if (bytes === null || !bytesEqual(bytes, expected) || head === null ||
        head.pathname !== pathname || head.size !== expected.byteLength) {
      persistentError("OBJECT_INTEGRITY_FAILURE");
    }
  }

  async #read(pathname: string): Promise<Uint8Array | null> {
    try {
      const value = await this.options.client.download(pathname, this.options.token);
      return value === null ? null : Uint8Array.from(value);
    } catch {
      persistentError("OBJECT_STORE_FAILURE");
    }
  }

  #pathname(key: string): string {
    const ref = sha256Text(key);
    return `${this.options.namespace}/${ref.slice(0, 2)}/${ref}`;
  }
}

export class PersistentObjectRetentionSweeper {
  readonly #batchSize: number;
  readonly #onObjectFailure: (key: string) => void;
  constructor(private readonly input: Readonly<{
    store: ComputeObjectStore; ledger: PersistentObjectLedger; clock: ComputeClock;
    batchSize?: number; onObjectFailure?: (key: string) => void;
  }>) {
    this.#batchSize = input.batchSize ?? 100;
    this.#onObjectFailure = input.onObjectFailure ?? (() => undefined);
    if (!Number.isSafeInteger(this.#batchSize) || this.#batchSize < 1 || this.#batchSize > 1000) {
      persistentError("CONFIGURATION_INVALID");
    }
  }
  async sweep(): Promise<readonly string[]> {
    const keys = await this.input.ledger.due(this.input.clock.now(), this.#batchSize);
    const deleted: string[] = [];
    for (const key of keys) {
      try {
        await this.input.store.delete(key);
        deleted.push(sha256Text(key));
      } catch {
        this.#onObjectFailure(key);
      }
    }
    return Object.freeze(deleted);
  }
}

export class VercelBlobOrphanReconciliationSweeper {
  readonly #prefix: string;
  readonly #minimumAgeMs: number;
  readonly #batchSize: number;
  readonly #onObjectFailure: (pathname: string) => void;
  constructor(private readonly input: Readonly<{
    client: VercelPrivateBlobClientV1; token: string; namespace: string;
    ledger: PersistentObjectLedger; clock: ComputeClock;
    minimumAgeMs?: number; batchSize?: number;
    onObjectFailure?: (pathname: string) => void;
  }>) {
    if (typeof input.token !== "string" || input.token.length < 16 ||
        !/^[a-z0-9][a-z0-9-]{0,62}$/u.test(input.namespace)) {
      persistentError("CONFIGURATION_INVALID");
    }
    this.#minimumAgeMs = input.minimumAgeMs ?? 60 * 60_000;
    this.#batchSize = input.batchSize ?? 100;
    if (!Number.isSafeInteger(this.#minimumAgeMs) || this.#minimumAgeMs < 1 ||
        !Number.isSafeInteger(this.#batchSize) || this.#batchSize < 1 || this.#batchSize > 1000) {
      persistentError("CONFIGURATION_INVALID");
    }
    this.#prefix = `${input.namespace}/`;
    this.#onObjectFailure = input.onObjectFailure ?? (() => undefined);
  }

  async sweep(): Promise<readonly OrphanReconciliationReceiptV1[]> {
    const receipts: OrphanReconciliationReceiptV1[] = [];
    const attempted = new Set<string>();
    for (const lease of await this.input.ledger.dueOrphanDeletes(
      this.input.namespace,
      this.#batchSize,
    )) {
      attempted.add(lease.pathname);
      try {
        receipts.push(await this.#reconcile(lease));
      } catch {
        this.#onObjectFailure(lease.pathname);
      }
    }
    let cursor: string | null = null;
    do {
      const page = await this.input.client.list(
        this.#prefix, this.input.token, cursor, this.#batchSize,
      );
      if (page.blobs.some((blob) => !blob.pathname.startsWith(this.#prefix))) {
        persistentError("OBJECT_INTEGRITY_FAILURE");
      }
      for (const blob of page.blobs) {
        if (attempted.has(blob.pathname)) continue;
        try {
          const discoveredAtMs = this.input.clock.now();
          if (!Number.isSafeInteger(blob.uploadedAtMs) || blob.uploadedAtMs < 0 ||
              discoveredAtMs - blob.uploadedAtMs < this.#minimumAgeMs) continue;
          const lease = await this.input.ledger.beginOrphanDelete({
            namespace: this.input.namespace, pathname: blob.pathname,
            providerUploadedAtMs: blob.uploadedAtMs, discoveredAtMs,
          });
          if (lease === null) continue;
          receipts.push(await this.#reconcile(lease));
        } catch {
          this.#onObjectFailure(blob.pathname);
        }
      }
      if (page.hasMore && (page.cursor === null || page.cursor === cursor)) {
        persistentError("OBJECT_STORE_FAILURE");
      }
      cursor = page.hasMore ? page.cursor : null;
    } while (cursor !== null);
    return Object.freeze(receipts);
  }

  async #reconcile(
    lease: PersistentOrphanDeletionLeaseV1,
  ): Promise<OrphanReconciliationReceiptV1> {
    await this.input.client.del(lease.pathname, this.input.token);
    const headAbsent = (await this.input.client.head(lease.pathname, this.input.token)) === null;
    const getAbsent = (await this.input.client.download(lease.pathname, this.input.token)) === null;
    if (!headAbsent || !getAbsent) persistentError("OBJECT_DELETION_NOT_OBSERVED");
    const receipt: OrphanReconciliationReceiptV1 = Object.freeze({
      version: ORPHAN_RECONCILIATION_RECEIPT_VERSION,
      objectRef: lease.objectRef, providerUploadedAtMs: lease.providerUploadedAtMs,
      discoveredAtMs: lease.discoveredAtMs, completedAtMs: this.input.clock.now(),
      ledgerAbsent: true, headAbsent: true, getAbsent: true,
    });
    await this.input.ledger.completeOrphanDelete(lease, receipt);
    return receipt;
  }
}
