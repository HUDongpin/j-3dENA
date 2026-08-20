import { describe, expect, it } from "vitest";
import { sameRunOwner, stableStringify } from "@/lib/run-ownership";

describe("immutable run ownership", () => {
  it("serializes equivalent specifications identically", () => {
    expect(stableStringify({ b: 2, a: { y: 1, x: 0 } })).toBe(
      stableStringify({ a: { x: 0, y: 1 }, b: 2 }),
    );
  });

  it("requires dataset, specification, and run identity to all match", () => {
    const owner = { datasetHash: "data-a", specHash: "spec-a", runId: "run-a" };
    expect(sameRunOwner(owner, owner)).toBe(true);
    expect(sameRunOwner(owner, { ...owner, datasetHash: "data-b" })).toBe(false);
    expect(sameRunOwner(owner, { ...owner, specHash: "spec-b" })).toBe(false);
    expect(sameRunOwner(owner, { ...owner, runId: "run-b" })).toBe(false);
    expect(sameRunOwner(null, owner)).toBe(false);
  });
});
