import { describe, expect, it } from "vitest";
import {
  createRunOwnerFromDatasetHash,
  sameRunOwner,
  stableStringify,
} from "@/lib/run-ownership";

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

  it("keeps an exact prepared-byte hash while independently hashing its specification", async () => {
    const datasetHash = "a".repeat(64);
    const first = await createRunOwnerFromDatasetHash(
      datasetHash,
      { time: "Period", group: "Group" },
      "run-a",
    );
    const reordered = await createRunOwnerFromDatasetHash(
      datasetHash,
      { group: "Group", time: "Period" },
      "run-b",
    );

    expect(first.datasetHash).toBe(datasetHash);
    expect(first.specHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(reordered.specHash).toBe(first.specHash);
    expect(reordered.runId).toBe("run-b");
    await expect(
      createRunOwnerFromDatasetHash("not-a-hash", {}, "run-c"),
    ).rejects.toThrow("lowercase SHA-256");
  });
});
