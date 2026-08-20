import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CellObject } from "xlsx";
import {
  DEFAULT_TABULAR_IMPORT_LIMITS,
  HARD_TABULAR_IMPORT_LIMITS,
  TabularImportError,
  inspectTabularSource,
  parseTabularWorksheet,
  resolveTabularImportLimits,
} from "./index";
import { materializeCellScalar } from "./importer";
import {
  buildAdversarialXlsx,
  markFirstCentralEntryEncrypted,
  patchFirstCentralUncompressedSize,
} from "./test-xlsx-builder.test-util";

const FIXTURE_ROOT = new URL("../test-fixtures/", import.meta.url);

function fixture(name: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(new URL(name, FIXTURE_ROOT)));
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function selection(index: number, name: string) {
  return { index, name } as const;
}

describe("vendored source and fixture custody", () => {
  it("locks every real workbook fixture to its recorded size and SHA-256", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("manifest.json", FIXTURE_ROOT), "utf8"),
    ) as {
      fixtures: Array<{ path: string; bytes: number; sha256: string; sourceUrl: string }>;
    };

    expect(manifest.fixtures).toHaveLength(4);
    for (const entry of manifest.fixtures) {
      const bytes = fixture(entry.path);
      expect(bytes.byteLength).toBe(entry.bytes);
      expect(sha256(bytes)).toBe(entry.sha256);
      expect(entry.sourceUrl).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/SheetJS\/SheetJS\.github\.io\/master\/test_files\//u,
      );
    }
  });

  it("pins the official SheetJS CE tarball bytes recorded by the vendor receipt", () => {
    const tarball = new Uint8Array(
      readFileSync(new URL("../../../vendor/sheetjs/xlsx-0.20.3.tgz", import.meta.url)),
    );
    expect(tarball.byteLength).toBe(2_409_319);
    expect(sha256(tarball)).toBe(
      "8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8",
    );
  });
});

describe("real XLSX and BIFF8 XLS parsing", () => {
  it("inspects and explicitly selects a real multi-sheet XLSX table", async () => {
    const bytes = fixture("with-various-data.xlsx");
    const inventory = await inspectTabularSource({
      name: "research.xlsx",
      bytes,
    });

    expect(inventory.receipt).toEqual({
      name: "research.xlsx",
      format: "xlsx",
      byteLength: 10_603,
      sha256: "1440a832bb810c09687d3498b841782964b0b697e9242428fed1072ab22d078a",
      delimiter: null,
    });
    expect(inventory.worksheets.map(({ name, visibility, selectable }) => ({
      name,
      visibility,
      selectable,
    }))).toEqual([
      { name: "Sheet1", visibility: "visible", selectable: true },
      { name: "Sheet2", visibility: "visible", selectable: true },
      { name: "Sheet3", visibility: "visible", selectable: true },
    ]);

    await expect(
      parseTabularWorksheet({
        name: "research.xlsx",
        bytes,
        expectedSha256: inventory.receipt.sha256,
        selection: null,
      }),
    ).rejects.toMatchObject({ code: "WORKSHEET_SELECTION_REQUIRED" });

    const result = await parseTabularWorksheet({
      name: "research.xlsx",
      bytes,
      expectedSha256: inventory.receipt.sha256,
      selection: selection(0, "Sheet1"),
    });
    expect(result.headers).toEqual(["A1", "B1", "C1"]);
    expect(result.rowCount).toBe(8);
    expect(result.columnCount).toBe(3);
    expect(result.skippedBlankRowCount).toBe(1);
    expect(result.rows[0]).toEqual([
      22.3,
      "Foo",
      "This is a really long cell, with lots of text in it",
    ]);
    expect(result.rows.at(-1)).toEqual([null, null, "We have a footer"]);
    expect(result.previewRows).toHaveLength(6);
    expect(result.previewRows[0]).not.toBe(result.rows[0]);
    expect(result.featurePolicy.formulas).toBe(
      "cached-scalar-only-never-evaluated",
    );
  });

  it("parses a real BIFF8 OLE XLS workbook without filesystem APIs", async () => {
    const bytes = fixture("simple-with-colours.xls");
    const inventory = await inspectTabularSource({ name: "legacy.xls", bytes });
    expect(inventory.receipt.sha256).toBe(
      "350ea9306c60c4d4bf7949858e75f3277cf702f7b684a8b0597d7b2ec718070e",
    );
    expect(inventory.receipt.format).toBe("xls");
    expect(inventory.receipt.delimiter).toBeNull();

    const result = await parseTabularWorksheet({
      name: "legacy.xls",
      bytes,
      expectedSha256: inventory.receipt.sha256,
      selection: selection(0, "Sheet1"),
    });
    expect(result.headers).toEqual(["I'm plain"]);
    expect(result.rows).toEqual([
      ["I'm red"],
      ["I'm red with a green bg"],
      ["I'm pink with a yellow pattern (none)"],
      ["I'm pink with a yellow pattern (full)"],
    ]);
    expect(result.vbaDetectedAndDiscarded).toBe(false);
  });

  it("normalizes date-formatted cells without the host timezone and keeps durations numeric", async () => {
    const bytes = fixture("date-cell.xlsx");
    const inventory = await inspectTabularSource({ name: "dates.xlsx", bytes });
    const result = await parseTabularWorksheet({
      name: "dates.xlsx",
      bytes,
      expectedSha256: inventory.receipt.sha256,
      selection: null,
    });

    expect(result.headers).toEqual(["String", "てすと", `&'";<>`, "&amp;"]);
    expect(result.rows[3]?.[1]).toBe("2014-02-14T08:27:48.765");
    expect(result.rows[5]?.[1]).toBe("1900-01-01T12:00:00.000");
    expect(result.rows[8]?.[1]).toBe(1.5);
    expect(result.rows[9]?.[1]).toBe("ok");
  });

  it("returns deeply frozen results that survive structured clone", async () => {
    const bytes = fixture("with-various-data.xlsx");
    const inventory = await inspectTabularSource({ name: "stable.xlsx", bytes });
    const request = {
      name: "stable.xlsx",
      bytes,
      expectedSha256: inventory.receipt.sha256,
      selection: selection(0, "Sheet1"),
    } as const;
    const first = await parseTabularWorksheet(request);
    const second = await parseTabularWorksheet(request);

    expect(second).toEqual(first);
    expect(structuredClone(first)).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.headers)).toBe(true);
    expect(Object.isFrozen(first.rows)).toBe(true);
    expect(Object.isFrozen(first.rows[0])).toBe(true);
    expect(Object.isFrozen(first.previewRows[0])).toBe(true);
  });
});

describe("worksheet and exact-byte ownership policy", () => {
  it("lists hidden sheets but refuses to select them", async () => {
    const bytes = fixture("two-sheets-one-hidden.xlsx");
    const inventory = await inspectTabularSource({ name: "hidden.xlsx", bytes });
    expect(inventory.visibleSelectableWorksheetCount).toBe(1);
    expect(inventory.worksheets).toEqual([
      expect.objectContaining({
        index: 0,
        name: "Sheet1",
        visibility: "hidden",
        selectable: false,
        unselectableReason: "hidden",
      }),
      expect.objectContaining({
        index: 1,
        name: "Sheet2",
        visibility: "visible",
        selectable: true,
      }),
    ]);

    await expect(
      parseTabularWorksheet({
        name: "hidden.xlsx",
        bytes,
        expectedSha256: inventory.receipt.sha256,
        selection: selection(0, "Sheet1"),
      }),
    ).rejects.toMatchObject({ code: "WORKSHEET_NOT_SELECTABLE" });
  });

  it("rejects a selection whose name does not match its inspected index", async () => {
    const bytes = fixture("with-various-data.xlsx");
    const inventory = await inspectTabularSource({ name: "selection.xlsx", bytes });
    await expect(
      parseTabularWorksheet({
        name: "selection.xlsx",
        bytes,
        expectedSha256: inventory.receipt.sha256,
        selection: selection(0, "Sheet2"),
      }),
    ).rejects.toMatchObject({ code: "WORKSHEET_SELECTION_INVALID" });
  });

  it("rejects changed bytes after inspection", async () => {
    const bytes = fixture("with-various-data.xlsx");
    const inventory = await inspectTabularSource({ name: "owned.xlsx", bytes });
    const changed = new Uint8Array(bytes);
    changed[100] = (changed[100] ?? 0) ^ 1;

    await expect(
      parseTabularWorksheet({
        name: "owned.xlsx",
        bytes: changed,
        expectedSha256: inventory.receipt.sha256,
        selection: selection(0, "Sheet1"),
      }),
    ).rejects.toMatchObject({ code: "SOURCE_HASH_MISMATCH" });
  });

  it("snapshots exact bytes before the first asynchronous hash yield", async () => {
    const original = fixture("with-various-data.xlsx");
    const expectedHash = sha256(original);
    const mutable = new Uint8Array(original);
    const pending = inspectTabularSource({ name: "snapshot.xlsx", bytes: mutable });
    mutable.fill(0);
    const inventory = await pending;
    expect(inventory.receipt.sha256).toBe(expectedHash);
  });
});

describe("formula, error, date, and scalar policy", () => {
  it("accepts only an existing cached formula scalar and never evaluates formula source", async () => {
    const bytes = buildAdversarialXlsx('<c r="A2"><f>1+1</f><v>2</v></c>');
    const inventory = await inspectTabularSource({ name: "cached.xlsx", bytes });
    const result = await parseTabularWorksheet({
      name: "cached.xlsx",
      bytes,
      expectedSha256: inventory.receipt.sha256,
      selection: null,
    });
    expect(result.rows).toEqual([[2]]);
    expect(JSON.stringify(result)).not.toContain("1+1");
  });

  it("rejects a formula cell without a cached value end-to-end", async () => {
    const bytes = buildAdversarialXlsx('<c r="A2"><f>1+1</f></c>');
    const inventory = await inspectTabularSource({ name: "uncached.xlsx", bytes });
    await expect(
      parseTabularWorksheet({
        name: "uncached.xlsx",
        bytes,
        expectedSha256: inventory.receipt.sha256,
        selection: null,
      }),
    ).rejects.toMatchObject({ code: "FORMULA_CACHE_MISSING" });
  });

  it("rejects spreadsheet error cells end-to-end", async () => {
    const bytes = buildAdversarialXlsx('<c r="A2" t="e"><v>#DIV/0!</v></c>');
    const inventory = await inspectTabularSource({ name: "error.xlsx", bytes });
    await expect(
      parseTabularWorksheet({
        name: "error.xlsx",
        bytes,
        expectedSha256: inventory.receipt.sha256,
        selection: null,
      }),
    ).rejects.toMatchObject({ code: "CELL_ERROR" });
  });

  it("keeps unsafe numeric cells numeric for downstream identity rejection", () => {
    const value = materializeCellScalar(
      { t: "n", v: 9_007_199_254_740_992 },
      false,
      DEFAULT_TABULAR_IMPORT_LIMITS,
      "worksheet.A2",
    );
    expect(value).toBe(9_007_199_254_740_992);
    expect(typeof value).toBe("number");
  });

  it("rejects non-finite caches and missing formula caches directly", () => {
    expect(() =>
      materializeCellScalar(
        { t: "n", v: Number.POSITIVE_INFINITY },
        false,
        DEFAULT_TABULAR_IMPORT_LIMITS,
        "worksheet.A2",
      ),
    ).toThrowError(TabularImportError);
    expect(() =>
      materializeCellScalar(
        { t: "n", f: "1+1" } as CellObject,
        false,
        DEFAULT_TABULAR_IMPORT_LIMITS,
        "worksheet.A2",
      ),
    ).toThrowError(expect.objectContaining({ code: "FORMULA_CACHE_MISSING" }));
  });
});

describe("CSV lexical import", () => {
  it("preserves identity-like lexemes and returns a six-row preview", async () => {
    const text = [
      "\uFEFF Group ,Name,Code",
      "Experimental,9007199254740993,1",
      'Control,"line one\nline two",0',
      "A,p3,1",
      "B,p4,0",
      "C,p5,1",
      "D,p6,0",
      "E,p7,1",
    ].join("\r\n");
    const bytes = new TextEncoder().encode(text);
    const inventory = await inspectTabularSource({ name: "data.CSV", bytes });
    const result = await parseTabularWorksheet({
      name: "data.CSV",
      bytes,
      expectedSha256: inventory.receipt.sha256,
      selection: null,
    });

    expect(inventory.worksheets).toEqual([
      expect.objectContaining({ index: 0, name: "CSV", selectable: true }),
    ]);
    expect(inventory.receipt.delimiter).toBe(",");
    expect(result.receipt.delimiter).toBe(",");
    expect(result.headers).toEqual(["Group", "Name", "Code"]);
    expect(result.rows[0]).toEqual(["Experimental", "9007199254740993", "1"]);
    expect(result.rows[1]?.[1]).toBe("line one\nline two");
    expect(result.previewRows).toHaveLength(6);
  });

  it("rejects malformed quoting and binary workbooks renamed to CSV", async () => {
    await expect(
      inspectTabularSource({
        name: "bad.csv",
        bytes: new TextEncoder().encode('A,B\n"unterminated,1'),
      }),
    ).rejects.toMatchObject({ code: "CSV_MALFORMED" });
    await expect(
      inspectTabularSource({
        name: "renamed.csv",
        bytes: fixture("with-various-data.xlsx"),
      }),
    ).rejects.toMatchObject({ code: "MAGIC_MISMATCH" });
  });

  it("detects semicolon and tab delimiters while respecting quoted delimiters and CRLF", async () => {
    for (const candidate of [
      {
        name: "semicolon.csv",
        text: 'A;B\r\n"x;y";2\r\n3;4\r\n',
        delimiter: ";" as const,
        first: ["x;y", "2"],
      },
      {
        name: "tab.csv",
        text: 'A\tB\r\n"x\ty"\t2\r\n3\t4\r\n',
        delimiter: "\t" as const,
        first: ["x\ty", "2"],
      },
    ]) {
      const bytes = new TextEncoder().encode(candidate.text);
      const inventory = await inspectTabularSource({ name: candidate.name, bytes });
      const result = await parseTabularWorksheet({
        name: candidate.name,
        bytes,
        expectedSha256: inventory.receipt.sha256,
        selection: null,
      });
      expect(inventory.receipt.delimiter).toBe(candidate.delimiter);
      expect(result.rows[0]).toEqual(candidate.first);
    }
  });

  it("uses comma-first stable tie breaking and rejects mixed-width or single-column ambiguity", async () => {
    const tied = new TextEncoder().encode("A,B;C\n1,2;3");
    const tiedInventory = await inspectTabularSource({ name: "tie.csv", bytes: tied });
    expect(tiedInventory.receipt.delimiter).toBe(",");

    await expect(
      inspectTabularSource({
        name: "mixed.csv",
        bytes: new TextEncoder().encode("A,B\n1,2,3"),
      }),
    ).rejects.toMatchObject({ code: "CSV_MALFORMED" });
    await expect(
      inspectTabularSource({
        name: "single.csv",
        bytes: new TextEncoder().encode("A\n1"),
      }),
    ).rejects.toMatchObject({ code: "CSV_DELIMITER_AMBIGUOUS" });
  });

  it("enforces maxCells during lexical row accumulation", async () => {
    await expect(
      inspectTabularSource(
        {
          name: "cells.csv",
          bytes: new TextEncoder().encode("A,B\n1,2\n3,4"),
        },
        { limits: { maxCells: 3 } },
      ),
    ).rejects.toMatchObject({ code: "CELL_LIMIT_EXCEEDED" });
  });

  it("rejects empty and duplicate normalized headers transactionally", async () => {
    for (const candidate of [
      { text: ",B\n1,2", code: "EMPTY_HEADER" },
      { text: "A, A \n1,2", code: "DUPLICATE_HEADER" },
    ] as const) {
      const bytes = new TextEncoder().encode(candidate.text);
      const inventory = await inspectTabularSource({ name: "headers.csv", bytes });
      await expect(
        parseTabularWorksheet({
          name: "headers.csv",
          bytes,
          expectedSha256: inventory.receipt.sha256,
          selection: null,
        }),
      ).rejects.toMatchObject({ code: candidate.code });
    }
  });
});

describe("container and resource hardening", () => {
  it("requires extension and ZIP/OLE magic to agree", async () => {
    await expect(
      inspectTabularSource({
        name: "wrong.xlsx",
        bytes: fixture("simple-with-colours.xls"),
      }),
    ).rejects.toMatchObject({ code: "MAGIC_MISMATCH" });
    await expect(
      inspectTabularSource({
        name: "wrong.xls",
        bytes: fixture("with-various-data.xlsx"),
      }),
    ).rejects.toMatchObject({ code: "MAGIC_MISMATCH" });
    await expect(
      inspectTabularSource({
        name: "workspace.rds",
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_EXTENSION" });
  });

  it("rejects ZIP-bomb expansion metadata before SheetJS parsing", async () => {
    const bomb = patchFirstCentralUncompressedSize(
      fixture("with-various-data.xlsx"),
      DEFAULT_TABULAR_IMPORT_LIMITS.maxZipEntryUncompressedBytes + 1,
    );
    await expect(
      inspectTabularSource({ name: "bomb.xlsx", bytes: bomb }),
    ).rejects.toMatchObject({ code: "XLSX_ZIP_ENTRY_SIZE_LIMIT" });
  });

  it("rejects encrypted ZIP metadata before SheetJS parsing", async () => {
    const encrypted = markFirstCentralEntryEncrypted(
      fixture("with-various-data.xlsx"),
    );
    await expect(
      inspectTabularSource({ name: "encrypted.xlsx", bytes: encrypted }),
    ).rejects.toMatchObject({ code: "XLSX_ZIP_ENCRYPTED" });
  });

  it("rejects malformed OLE metadata after matching magic", async () => {
    const malformed = fixture("simple-with-colours.xls");
    malformed[28] = 0;
    malformed[29] = 0;
    await expect(
      inspectTabularSource({ name: "bad.xls", bytes: malformed }),
    ).rejects.toMatchObject({ code: "XLS_OLE_MALFORMED" });
  });

  it("enforces worksheet, row, column, cell, string, and file limits", async () => {
    const bytes = fixture("with-various-data.xlsx");
    const inventory = await inspectTabularSource({ name: "limits.xlsx", bytes });

    await expect(
      inspectTabularSource(
        { name: "limits.xlsx", bytes },
        { limits: { maxWorksheets: 2 } },
      ),
    ).rejects.toMatchObject({ code: "WORKSHEET_LIMIT_EXCEEDED" });

    for (const [limits, code] of [
      [{ maxRows: 1 }, "ROW_LIMIT_EXCEEDED"],
      [{ maxColumns: 2 }, "COLUMN_LIMIT_EXCEEDED"],
      [{ maxCells: 2 }, "CELL_LIMIT_EXCEEDED"],
      [{ maxStringLength: 10 }, "STRING_LIMIT_EXCEEDED"],
    ] as const) {
      await expect(
        parseTabularWorksheet({
          name: "limits.xlsx",
          bytes,
          expectedSha256: inventory.receipt.sha256,
          selection: selection(0, "Sheet1"),
          limits,
        }),
      ).rejects.toMatchObject({ code });
    }

    await expect(
      inspectTabularSource(
        { name: "limits.xlsx", bytes },
        { limits: { maxFileBytes: bytes.byteLength - 1 } },
      ),
    ).rejects.toMatchObject({ code: "FILE_LIMIT_EXCEEDED" });
  });

  it("never permits caller limits above the immutable hard ceiling", () => {
    expect(() =>
      resolveTabularImportLimits({
        maxFileBytes: HARD_TABULAR_IMPORT_LIMITS.maxFileBytes + 1,
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_LIMIT" }));
    expect(() =>
      resolveTabularImportLimits({ unknown: 1 } as never),
    ).toThrowError(expect.objectContaining({ code: "INVALID_LIMIT" }));
  });
});

describe("browser runtime boundary", () => {
  it("keeps production source free of Node imports and server/R subprocess hooks", () => {
    const sourceRoot = new URL("./", import.meta.url);
    const productionFiles = readdirSync(sourceRoot)
      .filter((name) => name.endsWith(".ts"))
      .filter((name) => !name.endsWith(".test.ts"))
      .filter((name) => !name.includes("test-util"));
    const source = productionFiles
      .map((name) => readFileSync(new URL(name, sourceRoot), "utf8"))
      .join("\n");

    expect(source).not.toMatch(/from\s+["']node:/u);
    expect(source).not.toMatch(/from\s+["'](?:fs|crypto|child_process|worker_threads)["']/u);
    expect(source).not.toMatch(/\b(?:Rscript|Shiny|rENA)\b/u);
    expect(source).not.toMatch(/\breadFile\s*\(/u);
  });
});
