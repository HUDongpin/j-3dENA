import { describe, expect, it } from "vitest";

import {
  PostgresDatabase,
  type PgCompatibleClient,
  type PgCompatiblePool,
  type SqlQueryResult,
} from "./postgres";
import { PostgresFixedWindowRateLimiter } from "./rate-limit";

class SharedRatePool implements PgCompatiblePool, PgCompatibleClient {
  count = 0;
  readonly statements: string[] = [];
  async connect(): Promise<PgCompatibleClient> { return this; }
  release(): void {}
  async query<Row extends Record<string, unknown>>(
    sql: string,
  ): Promise<SqlQueryResult<Row>> {
    this.statements.push(sql);
    this.count += 1;
    return {
      rows: [{ request_count: this.count, retry_after_seconds: 30 }] as unknown as Row[],
      rowCount: 1,
    };
  }
}

describe("PostgresFixedWindowRateLimiter", () => {
  it("shares max+1 enforcement across independent router instances", async () => {
    const pool = new SharedRatePool();
    const database = new PostgresDatabase(pool);
    const limits = {
      "dataset-upload": 2,
      "dataset-mutation": 2,
      "job-create": 2,
      "job-execute": 2,
      "job-control": 2,
      "job-read": 2,
    } as const;
    const firstMachine = new PostgresFixedWindowRateLimiter({
      database,
      windowSeconds: 60,
      limits,
    });
    const secondMachine = new PostgresFixedWindowRateLimiter({
      database,
      windowSeconds: 60,
      limits,
    });
    const input = { keyHash: "a".repeat(64), routeClass: "job-create" as const };
    await expect(firstMachine.consume(input)).resolves.toMatchObject({ allowed: true });
    await expect(secondMachine.consume(input)).resolves.toMatchObject({ allowed: true });
    await expect(firstMachine.consume(input)).resolves.toMatchObject({
      allowed: false,
      retryAfterSeconds: 30,
    });
    expect(pool.statements.join("\n")).toContain("clock_timestamp()");
    expect(pool.statements.join("\n")).toContain("ON CONFLICT");
  });
});
