import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@3dena/analysis";
import { analysisResultCsv } from "@/lib/export-results";

describe("analysisResultCsv", () => {
  it("exports canonical unit identity and guards spreadsheet formulas", () => {
    const result = {
      points: [
        {
          id: { canonical: "tuple:Group=A|Name=001" },
          unit: { canonical: "tuple:Group=A|Name=001" },
          participantLabel: { display: "=SUM(1,1)" },
          group: { canonical: "string:A", display: "A" },
          time: { canonical: "string:L1", display: "L1" },
          coordinates: [1, 2, 3],
        },
      ],
      trajectory: { centroids: [] },
    } as unknown as AnalysisResult;

    const csv = analysisResultCsv(result);
    expect(csv).toContain("tuple:Group=A|Name=001");
    expect(csv).toContain("'=SUM(1,1)");
    expect(csv).toContain('"1","2","3"');
  });
});
