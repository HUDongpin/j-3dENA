import { createHash, timingSafeEqual } from "node:crypto";

import { persistentError } from "./errors";

export const LOWER_SHA256 = /^[a-f0-9]{64}$/u;
export const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
export const SAFE_OBJECT_KEY = /^(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+$/u;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

export function cloneFrozen<T>(value: T): T {
  return Object.freeze(structuredClone(value));
}

export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalStringify(object[key])}`)
    .join(",")}}`;
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return timingSafeEqual(left, right);
}

export function assertOpaqueId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !OPAQUE_ID.test(value)) {
    persistentError("CONFIGURATION_INVALID");
  }
}

export function assertObjectKey(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    !SAFE_OBJECT_KEY.test(value) ||
    value.includes("..")
  ) {
    persistentError("CONFIGURATION_INVALID");
  }
}
