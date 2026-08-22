import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  DEFAULT_ENA3D_EXCHANGE_LIMITS,
  Ena3dExchangeDecodeError,
  decodeEna3dExchangeV1,
} from "./index";

interface MutableColumn {
  name: string;
  type: string;
  values: unknown[];
}

interface StrategyStats {
  readonly name: string;
  cases: number;
  accepted: number;
  rejected: number;
  readonly errorCodes: Record<string, number>;
}

const encoder = new TextEncoder();
const seeds = parseSeeds();
const casesPerSeed = parseCasesPerSeed();
const strategies: StrategyStats[] = [
  stats("arbitrary-exact-bytes"),
  stats("valid-exchange-byte-mutations"),
  stats("structured-json-grammar"),
];

function parseSeeds(): readonly number[] {
  const raw = process.env.PARSER_FUZZ_SEEDS?.trim() || "3de02026,656e6133";
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

function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function stats(name: string): StrategyStats {
  return { name, cases: 0, accepted: 0, rejected: 0, errorCodes: {} };
}

function recordError(strategy: StrategyStats, code: string): void {
  strategy.rejected += 1;
  strategy.errorCodes[code] = (strategy.errorCodes[code] ?? 0) + 1;
}

function character(name: string, values: unknown[]): MutableColumn {
  return { name, type: "character", values };
}

function double(name: string, values: unknown[]): MutableColumn {
  return { name, type: "double", values };
}

function validExchange(marker: string): object {
  const units = [marker, `${marker}-peer`];
  const groups = ["control", "treatment"];
  const metadata = (): MutableColumn[] => [
    character("ENA_UNIT", [...units]),
    character("Group", [...groups]),
  ];
  return {
    format: "ena3d-exchange",
    version: 1,
    dimensions: ["SVD1", "SVD2", "SVD3"],
    group_variables: ["Group"],
    tables: {
      meta_data: { columns: metadata() },
      points: {
        columns: [
          ...metadata(),
          double("SVD1", [0.1, 0.2]),
          double("SVD2", [0.3, null]),
          double("SVD3", [-0.4, 0.5]),
        ],
      },
      line_weights: {
        columns: [
          ...metadata(),
          double("A & B", [1, 2]),
          double("A & C", [3, 4]),
          double("B & C", [5, 6]),
        ],
      },
      nodes: {
        columns: [
          character("code", ["A", "B", "C"]),
          double("SVD1", [1, 0, -1]),
          double("SVD2", [0, 1, -1]),
          double("SVD3", [1, -1, 0]),
        ],
      },
      adjacency_key: {
        columns: [
          character("A & B", ["A", "B"]),
          character("A & C", ["A", "C"]),
          character("B & C", ["B", "C"]),
        ],
      },
    },
  };
}

function inspectOrSafeFailure(
  bytes: Uint8Array,
  marker: string,
  strategy: StrategyStats,
): void {
  strategy.cases += 1;
  try {
    const decoded = decodeEna3dExchangeV1(bytes);
    strategy.accepted += 1;
    expect(decoded.format).toBe("ena3d-exchange");
    expect(decoded.version).toBe(1);
    expect(decoded.dimensions.length).toBeGreaterThanOrEqual(3);
    expect(decoded.dimensions.length).toBeLessThanOrEqual(
      DEFAULT_ENA3D_EXCHANGE_LIMITS.maxDimensions,
    );
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.tables)).toBe(true);
  } catch (error) {
    expect(error).toBeInstanceOf(Ena3dExchangeDecodeError);
    const safeError = error as Ena3dExchangeDecodeError;
    expect(safeError.message.length).toBeLessThan(512);
    expect(safeError.message).not.toContain(marker);
    expect(safeError.message).not.toMatch(/participant|private-research|secret-value/iu);
    expect(safeError.path ?? "").not.toContain(marker);
    recordError(strategy, safeError.code);
  }
}

function mutateBytes(source: Uint8Array, next: () => number): Uint8Array {
  const mode = next() % 4;
  if (mode === 0) {
    const truncatedLength = next() % (source.byteLength + 1);
    return source.slice(0, truncatedLength);
  }
  if (mode === 1) {
    const insertionLength = 1 + (next() % 16);
    const insertionOffset = next() % (source.byteLength + 1);
    const result = new Uint8Array(source.byteLength + insertionLength);
    result.set(source.slice(0, insertionOffset), 0);
    for (let index = 0; index < insertionLength; index += 1) {
      result[insertionOffset + index] = next() & 0xff;
    }
    result.set(source.slice(insertionOffset), insertionOffset + insertionLength);
    return result;
  }

  const result = source.slice();
  const mutations = 1 + (next() % 16);
  for (let mutation = 0; mutation < mutations; mutation += 1) {
    const index = next() % result.byteLength;
    result[index] = mode === 2
      ? (result[index] ?? 0) ^ (1 << (next() % 8))
      : next() & 0xff;
  }
  return result;
}

function grammarCase(next: () => number, marker: string): Uint8Array {
  const depth = 1 + (next() % 24);
  switch (next() % 6) {
    case 0:
      return encoder.encode(`${"[".repeat(depth)}0${"]".repeat(depth)}`);
    case 1:
      return encoder.encode(`{"${marker}":1,"${marker}":2}`);
    case 2:
      return encoder.encode(`{"${marker}":"\\u${(next() & 0xffff).toString(16).padStart(4, "0")}`);
    case 3:
      return encoder.encode(`{"${marker}":${"9".repeat(1 + (next() % 8_192))}e+999}`);
    case 4:
      return encoder.encode(`{"${marker}":[true,false,null,${next()}],}`);
    default:
      return encoder.encode(`${JSON.stringify(validExchange(marker))}${String.fromCharCode(next() & 0xff)}`);
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
    target: "ena3d-json",
    seeds: seeds.map(seedHex),
    casesPerSeed,
    strategies: normalizedStrategies,
    totalCases: normalizedStrategies.reduce((total, strategy) => total + strategy.cases, 0),
  };
  writeFileSync(
    resolve(outputDirectory, "ena3d-json.fragment.json"),
    `${JSON.stringify(fragment, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
}

afterAll(writeEvidenceFragment);

describe("deterministic .ena3d.json exact-byte parser fuzz", () => {
  it("contains arbitrary bytes without raw leakage or non-contract exceptions", () => {
    const strategy = strategies[0] as StrategyStats;
    for (const seed of seeds) {
      const next = prng(seed ^ 0x656e_6133);
      for (let caseIndex = 0; caseIndex < casesPerSeed; caseIndex += 1) {
        const marker = `secret-value-${seedHex(seed)}-${caseIndex}`;
        const length = next() % 16_384;
        const bytes = new Uint8Array(length);
        for (let index = 0; index < length; index += 1) bytes[index] = next() & 0xff;
        inspectOrSafeFailure(bytes, marker, strategy);
      }
    }
  });

  it("mutates valid exchanges while preserving the safe decoder boundary", () => {
    const strategy = strategies[1] as StrategyStats;
    for (const seed of seeds) {
      const next = prng(seed ^ 0x7661_6c69);
      for (let caseIndex = 0; caseIndex < casesPerSeed; caseIndex += 1) {
        const marker = `private-research-${seedHex(seed)}-${caseIndex}`;
        const source = encoder.encode(JSON.stringify(validExchange(marker)));
        inspectOrSafeFailure(mutateBytes(source, next), marker, strategy);
      }
    }
  });

  it("exercises adversarial JSON grammar and nesting under the same error contract", () => {
    const strategy = strategies[2] as StrategyStats;
    for (const seed of seeds) {
      const next = prng(seed ^ 0x6a73_6f6e);
      for (let caseIndex = 0; caseIndex < casesPerSeed; caseIndex += 1) {
        const marker = `participant-${seedHex(seed)}-${caseIndex}`;
        inspectOrSafeFailure(grammarCase(next, marker), marker, strategy);
      }
    }
  });
});
