import { describe, expect, it } from "vitest";

import * as publicFacade from "./public";

describe("public npm facade", () => {
  it("exposes the reviewed runtime functions plus strict dataset and result validators", () => {
    expect(Object.keys(publicFacade).sort()).toEqual([
      "adaptFittedJenaTrajectoryResultV2",
      "assertAnalysisExecutionDatasetV2",
      "assertAnalysisResultEnvelopeV1",
      "assertLongitudinalAnalysisBundleV2",
      "assertLongitudinalExecutionRequestV2",
      "assertTrajectoryRunSpecV2",
      "compilePlotlySpec",
      "compileTrajectoryPlotlySpec",
      "createAnalysisClient",
      "createExportBundle",
      "executeAnalysisTask",
      "executeLongitudinalAnalysisV2",
      "getAnalysisBuildIdentityV2",
      "hashAnalysisValueV1",
      "hashLongitudinalExecutionRequestV2",
      "inspectDataset",
      "verifyLongitudinalAnalysisBundleV2",
    ]);
    for (const value of Object.values(publicFacade)) expect(typeof value).toBe("function");
  });
});
