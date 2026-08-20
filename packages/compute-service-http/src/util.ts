import { createHash } from "node:crypto";

import { httpError } from "./errors";

export const LOWER_SHA256 = /^[a-f0-9]{64}$/u;
export const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalValue(nested)]),
    );
  }
  return value;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function cloneFrozen<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

export function assertExactFields(
  value: unknown,
  fields: readonly string[],
  path: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    httpError("INVALID_REQUEST", 400, `${path} must be an object.`);
  }
  const allowed = new Set(fields);
  const actual = Object.keys(value);
  if (
    actual.length !== fields.length ||
    actual.some((field) => !allowed.has(field))
  ) {
    httpError("INVALID_REQUEST", 400, `${path} fields are not exact.`);
  }
}

export function assertSafeAbsoluteUrl(value: string, path: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    httpError("INTERNAL_ERROR", 500, `${path} is not an absolute URL.`);
  }
  const loopback =
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (
    (parsed.protocol !== "https:" && !loopback) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== ""
  ) {
    httpError("INTERNAL_ERROR", 500, `${path} is not a safe transfer URL.`);
  }
  return parsed.toString();
}

export function isoTimestamp(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toISOString();
}

export function descriptorsEqual(
  left: Readonly<{ key: string; sha256: string; byteLength: number }>,
  right: Readonly<{ key: string; sha256: string; byteLength: number }>,
): boolean {
  return (
    left.key === right.key &&
    left.sha256 === right.sha256 &&
    left.byteLength === right.byteLength
  );
}
