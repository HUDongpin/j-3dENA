import { DEFAULT_ANALYSIS_LIMITS } from "@3dena/analysis";
import { describe, expect, it } from "vitest";
import {
  parseAnalysisCsv,
  parseCsvLexemeTable,
} from "@/lib/parse-analysis-csv";
import { LEGACY_DEFAULT_MAPPING } from "@/lib/sample-data";

describe("parseAnalysisCsv", () => {
  it("preserves identity lexemes and converts only mapped code cells", () => {
    const rows = parseAnalysisCsv(
      [
        "Group,Lesson,Name,EC,ICT,MCO,ATT",
        "001,Lesson 1,9007199254740993,1,0,true,0.25",
      ].join("\n"),
      LEGACY_DEFAULT_MAPPING,
    );

    expect(rows).toEqual([
      {
        Group: "001",
        Lesson: "Lesson 1",
        Name: "9007199254740993",
        EC: 1,
        ICT: 0,
        MCO: true,
        ATT: 0.25,
      },
    ]);
  });

  it("rejects duplicate headers before analysis", () => {
    expect(() =>
      parseAnalysisCsv(
        "Group,Lesson,Name,EC,EC,MCO\nA,L1,001,1,0,1",
        LEGACY_DEFAULT_MAPPING,
      ),
    ).toThrow(/headers must be unique/iu);
  });

  it("rejects an invalid mapped code after the preview boundary", () => {
    const validRows = Array.from(
      { length: 7 },
      (_, index) => `Group ${index},Lesson 1,Student ${index},1,0,1,0`,
    );
    const csvText = [
      "Group,Lesson,Name,EC,ICT,MCO,ATT",
      ...validRows,
      "Group 8,Lesson 1,Student 8,not-a-code,0,1,0",
    ].join("\n");

    expect(() => parseAnalysisCsv(csvText, LEGACY_DEFAULT_MAPPING)).toThrow(
      /CSV row 9, code column “EC” must be a finite non-negative number or boolean/iu,
    );
  });

  it("rejects a CSV wider than the shared analysis column ceiling", () => {
    const headers = Array.from(
      { length: DEFAULT_ANALYSIS_LIMITS.maxColumns + 1 },
      (_, index) => `column-${index}`,
    );
    const csvText = [headers.join(","), headers.map(() => "0").join(",")].join(
      "\n",
    );

    expect(() => parseCsvLexemeTable(csvText)).toThrow(
      `maximum is ${DEFAULT_ANALYSIS_LIMITS.maxColumns}`,
    );
  });

  it("rejects an overlong lexeme using the shared analysis string ceiling", () => {
    const overlongIdentity = "x".repeat(
      DEFAULT_ANALYSIS_LIMITS.maxStringLength + 1,
    );
    const csvText = [
      "Group,Lesson,Name,EC,ICT,MCO,ATT",
      `Experimental,Lesson 1,${overlongIdentity},1,0,1,0`,
    ].join("\n");

    expect(() => parseCsvLexemeTable(csvText)).toThrow(
      `maxStringLength=${DEFAULT_ANALYSIS_LIMITS.maxStringLength}`,
    );
  });
});
