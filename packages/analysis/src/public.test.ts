import { describe, expect, it } from "vitest";

import * as publicFacade from "./public";

describe("public npm facade", () => {
  it("exposes the reviewed runtime functions plus strict dataset and result validators", () => {
    expect(Object.keys(publicFacade).sort()).toEqual([
      "assertAnalysisExecutionDatasetV2",
      "assertAnalysisResultEnvelopeV1",
      "compilePlotlySpec",
      "createAnalysisClient",
      "createExportBundle",
      "executeAnalysisTask",
      "inspectDataset",
    ]);
    for (const value of Object.values(publicFacade)) expect(typeof value).toBe("function");
  });
});
