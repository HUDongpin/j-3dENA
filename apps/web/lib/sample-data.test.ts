import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILT_IN_SAMPLE_CSV } from "@/lib/sample-data";

const EXPECTED_SMALL_RAW_SHA256 =
  "163ee849ac316d380e2664067e7389a8114e30d97877c97d6d912e3706c72f16";

describe("built-in small raw fixture", () => {
  it("is byte-for-byte identical to the tracked parity fixture", () => {
    const trackedFixture = readFileSync(
      resolve(
        process.cwd(),
        "../../packages/parity-contracts/fixtures/small-raw.csv",
      ),
    );
    const bundledFixture = Buffer.from(BUILT_IN_SAMPLE_CSV, "utf8");

    expect(bundledFixture).toEqual(trackedFixture);
    expect(bundledFixture.byteLength).toBe(743);
    expect(createHash("sha256").update(bundledFixture).digest("hex")).toBe(
      EXPECTED_SMALL_RAW_SHA256,
    );
    expect(createHash("sha256").update(trackedFixture).digest("hex")).toBe(
      EXPECTED_SMALL_RAW_SHA256,
    );
  });
});
