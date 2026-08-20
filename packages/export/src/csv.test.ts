import { describe, expect, it } from "vitest";

import {
  ExportEncodingError,
  encodeCsvText,
  encodeCsvUtf8,
  type ExportEncodingErrorCode,
} from "./index";

const decoder = new TextDecoder("utf-8", { fatal: true });

function expectExportError(
  operation: () => unknown,
  code: ExportEncodingErrorCode,
): ExportEncodingError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(ExportEncodingError);
    expect((error as ExportEncodingError).code).toBe(code);
    return error as ExportEncodingError;
  }
  throw new Error(`Expected export error ${code}.`);
}

describe("encodeCsvText", () => {
  it("emits ordered UTF-8 RFC 4180 records with Unicode, quotes, and newlines", () => {
    const table = {
      columns: ["id", "说明", "=header", "'-header"],
      rows: [
        [
          9_007_199_254_740_993n,
          '你好, "ENA"\r\n第二行',
          "=SUM(A1:A2)",
          -2,
        ],
        [null, true, " \t@cmd", -0],
      ],
    } as const;

    const expected = [
      '"id","说明","\'=header","\'\'-header"',
      '"9007199254740993","你好, ""ENA""\r\n第二行","\'=SUM(A1:A2)","-2"',
      '"","true","\' \t@cmd","-0"',
      "",
    ].join("\r\n");
    const text = encodeCsvText(table);
    const encoded = encodeCsvUtf8(table);

    expect(text).toBe(expected);
    expect(decoder.decode(encoded)).toBe(expected);
    expect(Array.from(encoded.slice(0, 3))).not.toEqual([0xef, 0xbb, 0xbf]);
  });

  it("neutralizes formulas collision-safely and leaves numeric negatives numeric", () => {
    const text = encodeCsvText({
      columns: ["=x", "'=x", "''=x", "ordinary"],
      rows: [
        ["=1+1", " +SUM(A1:A2)", "\t-cmd", -7],
        ["'=1+1", "''=1+1", "\n@user", "ordinary"],
      ],
    });

    expect(text).toBe(
      [
        '"\'=x","\'\'=x","\'\'\'=x","ordinary"',
        '"\'=1+1","\' +SUM(A1:A2)","\'\t-cmd","-7"',
        '"\'\'=1+1","\'\'\'=1+1","\'\n@user","ordinary"',
        "",
      ].join("\r\n"),
    );
  });

  it("supports explicit formula reject and allow policies", () => {
    const table = { columns: ["value"], rows: [["=1+1"]] } as const;
    const rejected = expectExportError(
      () => encodeCsvText(table, { spreadsheetFormulas: "reject" }),
      "SPREADSHEET_FORMULA",
    );
    expect(rejected.path).toBe("rows[0][0]");
    expect(
      encodeCsvText(table, {
        spreadsheetFormulas: "allow",
        includeFinalRecordTerminator: false,
      }),
    ).toBe('"value"\r\n"=1+1"');
  });

  it("makes null and non-finite-number policies explicit", () => {
    const nonFinite = {
      columns: ["nan", "positive", "negative", "missing"],
      rows: [[Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null]],
    } as const;

    expectExportError(
      () => encodeCsvText(nonFinite),
      "NON_FINITE_CSV_NUMBER",
    );
    expect(
      encodeCsvText(nonFinite, {
        nullValue: "NA",
        nonFiniteNumbers: "as-null",
        includeFinalRecordTerminator: false,
      }),
    ).toBe('"nan","positive","negative","missing"\r\n"NA","NA","NA","NA"');
    expect(
      encodeCsvText(nonFinite, {
        nonFiniteNumbers: "string",
        spreadsheetFormulas: "allow",
        includeFinalRecordTerminator: false,
      }),
    ).toBe(
      '"nan","positive","negative","missing"\r\n"NaN","Infinity","-Infinity",""',
    );

    expect(
      encodeCsvText(
        { columns: ["missing"], rows: [[null]] },
        { nullValue: "=NA()", includeFinalRecordTerminator: false },
      ),
    ).toBe('"missing"\r\n"\'=NA()"');
  });

  it("uses only the declared column array for stable order", () => {
    expect(
      encodeCsvText(
        {
          columns: ["z", "a", "m"],
          rows: [[3, 1, 2]],
        },
        { includeFinalRecordTerminator: false },
      ),
    ).toBe('"z","a","m"\r\n"3","1","2"');
  });

  it("rejects malformed tables, cells, text, and options", () => {
    expectExportError(
      () => encodeCsvText({ columns: [], rows: [] }),
      "INVALID_CSV_TABLE",
    );
    expectExportError(
      () => encodeCsvText({ columns: ["a", "a"], rows: [] }),
      "INVALID_CSV_TABLE",
    );
    expectExportError(
      () => encodeCsvText({ columns: ["a", "b"], rows: [[1]] }),
      "INVALID_CSV_TABLE",
    );
    expectExportError(
      () =>
        encodeCsvText({
          columns: ["value"],
          rows: [[undefined as never]],
        }),
      "INVALID_CSV_CELL",
    );
    const sparseRow = new Array<never>(1);
    expectExportError(
      () => encodeCsvText({ columns: ["value"], rows: [sparseRow] }),
      "INVALID_CSV_CELL",
    );
    expectExportError(
      () => encodeCsvText({ columns: ["nul\0header"], rows: [] }),
      "INVALID_CSV_TEXT",
    );
    expectExportError(
      () => encodeCsvText({ columns: ["value"], rows: [["\ud800"]] }),
      "INVALID_CSV_TEXT",
    );
    expectExportError(
      () =>
        encodeCsvText(
          { columns: ["value"], rows: [] },
          { unsupported: true } as never,
        ),
      "INVALID_CSV_OPTION",
    );
    expectExportError(
      () =>
        encodeCsvText(
          { columns: ["value"], rows: [] },
          { spreadsheetFormulas: "maybe" as never },
        ),
      "INVALID_CSV_OPTION",
    );
  });
});
