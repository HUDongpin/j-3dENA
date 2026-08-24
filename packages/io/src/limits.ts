import { exchangeError } from "./errors";

export interface Ena3dExchangeLimits {
  readonly maxFileBytes: number;
  readonly maxPointRows: number;
  readonly maxNodes: number;
  readonly maxDimensions: number;
  readonly maxMetadataColumns: number;
  readonly maxTableCells: number;
  readonly maxGroupLevels: number;
  readonly maxUnits: number;
}

export const ENA3D_EXCHANGE_V1_MAX_JSON_DEPTH = 16;

export const DEFAULT_ENA3D_EXCHANGE_LIMITS: Readonly<Ena3dExchangeLimits> =
  Object.freeze({
    maxFileBytes: 2 * 1024 * 1024,
    maxPointRows: 50_000,
    maxNodes: 50,
    maxDimensions: 200,
    maxMetadataColumns: 100,
    maxTableCells: 20_000_000,
    maxGroupLevels: 50,
    maxUnits: 50_000,
  });

export const HARD_ENA3D_EXCHANGE_LIMITS: Readonly<Ena3dExchangeLimits> =
  Object.freeze({
    maxFileBytes: 10 * 1024 * 1024,
    maxPointRows: 250_000,
    maxNodes: 100,
    maxDimensions: 500,
    maxMetadataColumns: 500,
    maxTableCells: 100_000_000,
    maxGroupLevels: 200,
    maxUnits: 250_000,
  });

const LIMIT_KEYS = Object.freeze(
  Object.keys(DEFAULT_ENA3D_EXCHANGE_LIMITS) as (keyof Ena3dExchangeLimits)[],
);

export function resolveEna3dExchangeLimits(
  requested?: Partial<Ena3dExchangeLimits>,
): Readonly<Ena3dExchangeLimits> {
  if (requested !== undefined) {
    if (
      requested === null ||
      typeof requested !== "object" ||
      Array.isArray(requested)
    ) {
      exchangeError("INVALID_LIMIT", "Exchange limits must be an object.");
    }
    const unknown = Object.keys(requested).filter(
      (key) => !LIMIT_KEYS.includes(key as keyof Ena3dExchangeLimits),
    );
    if (unknown.length > 0) {
      exchangeError(
        "INVALID_LIMIT",
        "Exchange limits contain an unsupported field.",
      );
    }
  }

  const resolved = { ...DEFAULT_ENA3D_EXCHANGE_LIMITS };
  for (const key of LIMIT_KEYS) {
    const value = requested?.[key] ?? resolved[key];
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > HARD_ENA3D_EXCHANGE_LIMITS[key]
    ) {
      exchangeError(
        "INVALID_LIMIT",
        `Exchange limit must be a positive safe integer no greater than its hard ceiling.`,
        key,
      );
    }
    resolved[key] = value;
  }
  return Object.freeze(resolved);
}
