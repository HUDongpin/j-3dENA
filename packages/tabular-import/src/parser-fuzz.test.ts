import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { inspectTabularSource, TabularImportError } from "./index";

const FIXTURE_ROOT = new URL("../test-fixtures/", import.meta.url);

function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertSafeFailure(error: unknown): void {
  expect(error).toBeInstanceOf(TabularImportError);
  const message = error instanceof Error ? error.message : String(error);
  expect(message.length).toBeLessThan(512);
  expect(message).not.toMatch(/participant|private-research|secret-value/iu);
}

async function inspectOrSafeFailure(name: string, bytes: Uint8Array): Promise<void> {
  try {
    const inventory = await inspectTabularSource({ name, bytes });
    expect(inventory.receipt.byteLength).toBe(bytes.byteLength);
    expect(inventory.receipt.sha256).toBe(sha256(bytes));
    expect(Object.isFrozen(inventory)).toBe(true);
    expect(inventory.worksheets.length).toBeGreaterThan(0);
    expect(inventory.worksheets.length).toBeLessThanOrEqual(32);
  } catch (error) {
    assertSafeFailure(error);
  }
}

describe("deterministic parser property and corpus fuzz", () => {
  it("contains arbitrary CSV bytes without non-finite receipts, raw leakage, or non-contract exceptions", async () => {
    const next = prng(0x3de0_2026);
    for (let caseIndex = 0; caseIndex < 128; caseIndex += 1) {
      const length = next() % 2048;
      const bytes = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) bytes[index] = next() & 0xff;
      await inspectOrSafeFailure(`case-${caseIndex}.csv`, bytes);
    }
  });

  it.each([
    ["xlsx", "with-various-data.xlsx", 0x786c_7378],
    ["xls", "simple-with-colours.xls", 0x786c_7300],
  ] as const)("mutates and truncates the governed %s corpus without escaping the parser contract", async (extension, fixtureName, seed) => {
    const source = new Uint8Array(readFileSync(new URL(fixtureName, FIXTURE_ROOT)));
    const next = prng(seed);
    for (let caseIndex = 0; caseIndex < 32; caseIndex += 1) {
      const truncateBy = next() % Math.min(source.byteLength, 1024);
      const length = Math.max(1, source.byteLength - truncateBy);
      const bytes = source.slice(0, length);
      const mutations = 1 + (next() % 8);
      for (let mutation = 0; mutation < mutations; mutation += 1) {
        const index = next() % bytes.byteLength;
        bytes[index] = (bytes[index] ?? 0) ^ (1 << (next() % 8));
      }
      await inspectOrSafeFailure(`case-${caseIndex}.${extension}`, bytes);
    }
  });
});
