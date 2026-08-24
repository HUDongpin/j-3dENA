import { describe, expect, it } from "vitest";
import { derivedDownloadJson } from "@/lib/derived-download";

describe("derivedDownloadJson", () => {
  it("binds every derived download to unverified ownership and mode", () => {
    const json = derivedDownloadJson({
      mode: "prepared-exchange",
      feature: "statistics",
      owner: {
        datasetHash: "a".repeat(64),
        specHash: "b".repeat(64),
        runId: "run-1",
        taskId: "statistics-1",
      },
      envelope: {
        provenance: {
          sourceKind: "prepared-exchange",
          rawJenaRecompute: false,
          jenaExecuted: false,
        },
      },
    });
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json)).toMatchObject({
      schemaVersion: "3dena.web-derived-download.v1",
      productStatus: "IMPLEMENTED_UNVERIFIED",
      approvedForParity: false,
      mode: "prepared-exchange",
      feature: "statistics",
      owner: { taskId: "statistics-1" },
      envelope: {
        provenance: {
          sourceKind: "prepared-exchange",
          rawJenaRecompute: false,
          jenaExecuted: false,
        },
      },
    });
  });
});
