import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { open, readFile, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import type {
  ComputeObjectStore,
  ImmutableObjectDescriptor,
  ImmutableObjectPutResult,
} from "@3dena/compute-service-core";

import {
  FILE_SYSTEM_RESULT_STORE_OPTIONS_VERSION,
  type FileSystemResultStoreOptionsV1,
} from "./contracts";
import { scientificWorkerError } from "./errors";
import { isRecord } from "./validation";

const SAFE_OBJECT_KEY = /^[\x21-\x7e]{1,1024}$/u;

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

function isErrorCode(value: unknown, code: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    (value as { code?: unknown }).code === code
  );
}

export class FileSystemImmutableResultStore implements ComputeObjectStore {
  readonly #rootDirectory: string;

  constructor(options: FileSystemResultStoreOptionsV1) {
    if (
      !isRecord(options) ||
      !Object.keys(options).every((key) =>
        ["version", "rootDirectory"].includes(key),
      ) ||
      options.version !== FILE_SYSTEM_RESULT_STORE_OPTIONS_VERSION ||
      typeof options.rootDirectory !== "string" ||
      !isAbsolute(options.rootDirectory)
    ) {
      scientificWorkerError("INVALID_CONFIGURATION");
    }
    try {
      const canonical = realpathSync(options.rootDirectory);
      if (!isAbsolute(canonical) || !statSync(canonical).isDirectory()) {
        scientificWorkerError("INVALID_CONFIGURATION");
      }
      this.#rootDirectory = canonical;
    } catch {
      scientificWorkerError("INVALID_CONFIGURATION");
    }
  }

  async putImmutable(
    key: string,
    bytes: Uint8Array,
  ): Promise<ImmutableObjectPutResult> {
    this.#assertKey(key);
    if (!(bytes instanceof Uint8Array)) {
      scientificWorkerError("STORE_OPERATION_FAILED");
    }
    const snapshot = Uint8Array.from(bytes);
    const descriptor: ImmutableObjectDescriptor = Object.freeze({
      key,
      sha256: sha256(snapshot),
      byteLength: snapshot.byteLength,
    });
    const path = this.#pathForKey(key);
    let handle;
    let createdPath = false;
    try {
      handle = await open(path, "wx", 0o600);
      createdPath = true;
      await handle.writeFile(snapshot);
      await handle.sync();
      await handle.close();
      handle = undefined;
      return Object.freeze({ created: true, descriptor });
    } catch (error) {
      if (handle !== undefined) {
        try {
          await handle.close();
        } catch {
          // The original failure is mapped to a fixed non-sensitive code below.
        }
      }
      if (createdPath) {
        try {
          await unlink(path);
        } catch (cleanupError) {
          if (!isErrorCode(cleanupError, "ENOENT")) {
            scientificWorkerError("STORE_OPERATION_FAILED");
          }
        }
      }
      if (!isErrorCode(error, "EEXIST")) {
        scientificWorkerError("STORE_OPERATION_FAILED");
      }
    }
    let existing: Uint8Array;
    try {
      existing = await readFile(path);
    } catch {
      scientificWorkerError("STORE_OPERATION_FAILED");
    }
    if (!bytesEqual(existing, snapshot)) {
      scientificWorkerError("IMMUTABLE_ARTIFACT_CONFLICT");
    }
    return Object.freeze({ created: false, descriptor });
  }

  async head(key: string): Promise<ImmutableObjectDescriptor | null> {
    this.#assertKey(key);
    let bytes: Uint8Array;
    try {
      bytes = await readFile(this.#pathForKey(key));
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) return null;
      scientificWorkerError("STORE_OPERATION_FAILED");
    }
    return Object.freeze({
      key,
      sha256: sha256(bytes),
      byteLength: bytes.byteLength,
    });
  }

  async get(key: string): Promise<Uint8Array | null> {
    this.#assertKey(key);
    try {
      return Uint8Array.from(await readFile(this.#pathForKey(key)));
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) return null;
      scientificWorkerError("STORE_OPERATION_FAILED");
    }
  }

  async delete(key: string): Promise<boolean> {
    this.#assertKey(key);
    try {
      await unlink(this.#pathForKey(key));
      return true;
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) return false;
      scientificWorkerError("STORE_OPERATION_FAILED");
    }
  }

  #assertKey(key: string): void {
    if (typeof key !== "string" || !SAFE_OBJECT_KEY.test(key)) {
      scientificWorkerError("STORE_OPERATION_FAILED");
    }
  }

  #pathForKey(key: string): string {
    return join(this.#rootDirectory, `${sha256(key)}.bin`);
  }
}
