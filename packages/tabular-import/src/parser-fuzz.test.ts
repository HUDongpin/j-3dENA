import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { inspectTabularSource, TabularImportError } from "./index";

const FIXTURE_ROOT = new URL("../test-fixtures/", import.meta.url);
const utf8Encoder = new TextEncoder();
const seeds = parseSeeds();
const casesPerSeed = parseCasesPerSeed();

interface StrategyStats {
  readonly name: string;
  cases: number;
  accepted: number;
  rejected: number;
  readonly errorCodes: Record<string, number>;
}

const strategies: StrategyStats[] = [
  stats("arbitrary-csv-bytes"),
  stats("governed-xlsx-mutations"),
  stats("governed-xls-mutations"),
];

function parseSeeds(): readonly number[] {
  const raw = process.env.PARSER_FUZZ_SEEDS?.trim() || "3de02026,7461626c";
  const parsed = raw.split(",").map((part) => {
    const normalized = part.trim().toLowerCase().replace(/^0x/u, "");
    if (!/^[0-9a-f]{1,8}$/u.test(normalized)) {
      throw new Error("PARSER_FUZZ_SEEDS must contain comma-separated uint32 hexadecimal values.");
    }
    return Number.parseInt(normalized, 16) >>> 0;
  });
  const unique = [...new Set(parsed)];
  if (unique.length < 1 || unique.length > 16) {
    throw new Error("PARSER_FUZZ_SEEDS must contain between 1 and 16 unique seeds.");
  }
  return Object.freeze(unique);
}

function parseCasesPerSeed(): number {
  const raw = process.env.PARSER_FUZZ_CASES_PER_SEED ?? "128";
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2_048) {
    throw new Error("PARSER_FUZZ_CASES_PER_SEED must be an integer from 1 through 2048.");
  }
  return parsed;
}

function seedHex(seed: number): string {
  return seed.toString(16).padStart(8, "0");
}

function stats(name: string): StrategyStats {
  return { name, cases: 0, accepted: 0, rejected: 0, errorCodes: {} };
}

function csvFuzzBytes(next: () => number, marker: string): Uint8Array {
  const delimiter = [",", "\t", ";", "|"][next() % 4] as string;
  switch (next() % 7) {
    case 0:
      return utf8Encoder.encode(
        `id${delimiter}value${delimiter}group\n${marker}${delimiter}"alpha-${next()}"${delimiter}control\npeer${delimiter}${next()}${delimiter}treatment\n`,
      );
    case 1:
      return utf8Encoder.encode(
        `id${delimiter}value\r\n${marker}${delimiter}"unterminated-${next()}\r\n`,
      );
    case 2:
      return utf8Encoder.encode(
        `id${delimiter}value\n${marker}${delimiter}"escaped "" quote"\npeer${delimiter}\n`,
      );
    case 3:
      return utf8Encoder.encode(
        `id,value;group\n${marker},${next()};control\npeer,${next()};treatment\n`,
      );
    case 4:
      return utf8Encoder.encode(
        `id${delimiter}value\n${marker}${delimiter}${"x".repeat(1 + (next() % 8_192))}\n`,
      );
    case 5:
      return utf8Encoder.encode(
        `id${delimiter}value\n${marker}${delimiter}"line-one\rline-two\nline-three"\n`,
      );
    default: {
      const length = 1 + (next() % 16_384);
      const bytes = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) bytes[index] = next() & 0xff;
      return bytes;
    }
  }
}

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

function assertSafeFailure(error: unknown, marker = ""): string {
  expect(error).toBeInstanceOf(TabularImportError);
  const message = error instanceof Error ? error.message : String(error);
  expect(message.length).toBeLessThan(512);
  expect(message).not.toMatch(/participant|private-research|secret-value/iu);
  if (marker) expect(message).not.toContain(marker);
  return (error as TabularImportError).code;
}

async function inspectOrSafeFailure(
  name: string,
  bytes: Uint8Array,
  strategy: StrategyStats,
  marker = "",
): Promise<void> {
  strategy.cases += 1;
  try {
    const inventory = await inspectTabularSource({ name, bytes });
    strategy.accepted += 1;
    expect(inventory.receipt.byteLength).toBe(bytes.byteLength);
    expect(inventory.receipt.sha256).toBe(sha256(bytes));
    expect(Object.isFrozen(inventory)).toBe(true);
    expect(inventory.worksheets.length).toBeGreaterThan(0);
    expect(inventory.worksheets.length).toBeLessThanOrEqual(32);
  } catch (error) {
    strategy.rejected += 1;
    const code = assertSafeFailure(error, marker);
    strategy.errorCodes[code] = (strategy.errorCodes[code] ?? 0) + 1;
  }
}

function writeEvidenceFragment(): void {
  const evidenceDirectory = process.env.PARSER_FUZZ_EVIDENCE_DIR;
  if (!evidenceDirectory) return;
  const outputDirectory = resolve(evidenceDirectory);
  mkdirSync(outputDirectory, { recursive: true });
  const normalizedStrategies = strategies.map((strategy) => ({
    ...strategy,
    errorCodes: Object.fromEntries(Object.entries(strategy.errorCodes).sort()),
  }));
  const fragment = {
    schemaVersion: "3dena.parser-fuzz-fragment.v1",
    target: "tabular-csv-xls-xlsx",
    seeds: seeds.map(seedHex),
    casesPerSeed,
    strategies: normalizedStrategies,
    totalCases: normalizedStrategies.reduce((total, strategy) => total + strategy.cases, 0),
  };
  writeFileSync(
    resolve(outputDirectory, "tabular-csv-xls-xlsx.fragment.json"),
    `${JSON.stringify(fragment, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
}

afterAll(writeEvidenceFragment);

describe("deterministic parser property and corpus fuzz", () => {
  it("contains arbitrary CSV bytes without non-finite receipts, raw leakage, or non-contract exceptions", async () => {
    const strategy = strategies[0] as StrategyStats;
    for (const seed of seeds) {
      const next = prng(seed ^ 0x6373_7600);
      for (let caseIndex = 0; caseIndex < casesPerSeed; caseIndex += 1) {
        const marker = `secret-value-${seedHex(seed)}-${caseIndex}`;
        const bytes = csvFuzzBytes(next, marker);
        await inspectOrSafeFailure(
          `case-${seedHex(seed)}-${caseIndex}.csv`,
          bytes,
          strategy,
          marker,
        );
      }
    }
  });

  it.each([
    ["xlsx", "with-various-data.xlsx", 0x786c_7378],
    ["xls", "simple-with-colours.xls", 0x786c_7300],
  ] as const)("mutates and truncates the governed %s corpus without escaping the parser contract", async (extension, fixtureName, strategySeed) => {
    const strategy = extension === "xlsx"
      ? strategies[1] as StrategyStats
      : strategies[2] as StrategyStats;
    const source = new Uint8Array(readFileSync(new URL(fixtureName, FIXTURE_ROOT)));
    const corpusCasesPerSeed = Math.max(1, Math.ceil(casesPerSeed / 4));
    for (const seed of seeds) {
      const next = prng(seed ^ strategySeed);
      for (let caseIndex = 0; caseIndex < corpusCasesPerSeed; caseIndex += 1) {
        const truncateBy = next() % Math.min(source.byteLength, 4_096);
        const length = Math.max(1, source.byteLength - truncateBy);
        const bytes = source.slice(0, length);
        const mutations = 1 + (next() % 16);
        for (let mutation = 0; mutation < mutations; mutation += 1) {
          const index = next() % bytes.byteLength;
          bytes[index] = (bytes[index] ?? 0) ^ (1 << (next() % 8));
        }
        await inspectOrSafeFailure(
          `case-${seedHex(seed)}-${caseIndex}.${extension}`,
          bytes,
          strategy,
        );
      }
    }
  });
});
