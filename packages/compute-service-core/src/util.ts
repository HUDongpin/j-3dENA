import { createHash } from "node:crypto";

import { coreError } from "./errors";

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
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

export function cloneFrozen<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

export function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

export function assertLowerSha256(value: string, name: string): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    coreError("INVALID_ARGUMENT", `${name} must be a lowercase SHA-256 value.`);
  }
}

export function assertOpaqueId(value: string, name: string): void {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)
  ) {
    coreError(
      "INVALID_ARGUMENT",
      `${name} must be an opaque 1-128 character identifier.`,
    );
  }
}

export function assertObjectKey(value: string, name: string): void {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 512 ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..") ||
    !/^[A-Za-z0-9._/-]+$/u.test(value)
  ) {
    coreError("INVALID_ARGUMENT", `${name} is not a safe object-store key.`);
  }
}

export function assertExactObjectKeys(
  value: unknown,
  allowed: readonly string[],
  name: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    coreError("INVALID_ARGUMENT", `${name} must be an object.`);
  }
  const allowedSet = new Set(allowed);
  const actual = Object.keys(value);
  if (
    actual.length !== allowed.length ||
    actual.some((key) => !allowedSet.has(key))
  ) {
    coreError(
      "INVALID_ARGUMENT",
      `${name} fields do not match the versioned contract.`,
    );
  }
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
