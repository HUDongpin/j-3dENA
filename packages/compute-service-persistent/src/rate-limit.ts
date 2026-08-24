import type {
  ComputeHttpRateLimitClassV1,
  ComputeHttpRateLimiter,
} from "@3dena/compute-service-http";

import { persistentError } from "./errors";
import type { PostgresDatabase } from "./postgres";
import { LOWER_SHA256 } from "./util";

const ROUTE_CLASSES: readonly ComputeHttpRateLimitClassV1[] = [
  "dataset-upload",
  "dataset-mutation",
  "job-create",
  "job-execute",
  "job-control",
  "job-read",
];

interface RateRow extends Record<string, unknown> {
  readonly request_count?: unknown;
  readonly retry_after_seconds?: unknown;
}

export class PostgresFixedWindowRateLimiter implements ComputeHttpRateLimiter {
  readonly #database: PostgresDatabase;
  readonly #windowSeconds: number;
  readonly #limits: Readonly<Record<ComputeHttpRateLimitClassV1, number>>;

  constructor(input: Readonly<{
    database: PostgresDatabase;
    windowSeconds: number;
    limits: Readonly<Record<ComputeHttpRateLimitClassV1, number>>;
  }>) {
    if (!Number.isSafeInteger(input.windowSeconds) || input.windowSeconds < 1 ||
        input.windowSeconds > 86_400 || ROUTE_CLASSES.some((routeClass) =>
          !Number.isSafeInteger(input.limits[routeClass]) || input.limits[routeClass] < 1 ||
          input.limits[routeClass] > 1_000_000)) {
      persistentError("CONFIGURATION_INVALID");
    }
    this.#database = input.database;
    this.#windowSeconds = input.windowSeconds;
    this.#limits = Object.freeze({ ...input.limits });
  }

  async consume(input: Readonly<{
    keyHash: string;
    routeClass: ComputeHttpRateLimitClassV1;
  }>): Promise<Readonly<{ allowed: boolean; retryAfterSeconds: number }>> {
    if (!LOWER_SHA256.test(input.keyHash) || !ROUTE_CLASSES.includes(input.routeClass)) {
      persistentError("CONFIGURATION_INVALID");
    }
    const result = await this.#database.query<RateRow>(
      `WITH server_clock AS (
         SELECT clock_timestamp() AS now_at
       ), bucket AS (
         SELECT now_at,
           to_timestamp(floor(extract(epoch FROM now_at) / $3) * $3) AS window_start
         FROM server_clock
       ), consumed AS (
         INSERT INTO compute_rate_limit_windows (
           key_hash, route_class, window_start, request_count, expires_at
         ) SELECT $1, $2, window_start, 1,
           window_start + ($3 * interval '1 second') FROM bucket
         ON CONFLICT (key_hash, route_class, window_start)
         DO UPDATE SET request_count = compute_rate_limit_windows.request_count + 1
         RETURNING request_count, window_start
       )
       SELECT consumed.request_count,
         greatest(1, ceil(extract(epoch FROM
           (consumed.window_start + ($3 * interval '1 second') - bucket.now_at)
         )))::integer AS retry_after_seconds
       FROM consumed CROSS JOIN bucket`,
      [input.keyHash, input.routeClass, this.#windowSeconds],
    );
    const count = Number(result.rows[0]?.request_count);
    const retryAfterSeconds = Number(result.rows[0]?.retry_after_seconds);
    if (!Number.isSafeInteger(count) || count < 1 ||
        !Number.isSafeInteger(retryAfterSeconds) || retryAfterSeconds < 1 ||
        retryAfterSeconds > this.#windowSeconds) {
      persistentError("DATABASE_FAILURE");
    }
    return Object.freeze({
      allowed: count <= this.#limits[input.routeClass],
      retryAfterSeconds,
    });
  }
}
