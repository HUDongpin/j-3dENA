import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_ENA3D_EXCHANGE_LIMITS,
  Ena3dExchangeDecodeError,
  decodeEna3dExchangeV1,
  decodeEna3dExchangeV1WithSha256,
  isHashedEna3dExchangeV1,
  sha256Ena3dExchangeBytes,
  type Ena3dExchangeErrorCode,
} from "./index";

interface TestColumn {
  name: string;
  type: string;
  values: unknown[];
  levels?: unknown;
  timezone?: unknown;
  units?: unknown;
  [key: string]: unknown;
}

interface TestTable {
  columns: TestColumn[];
  [key: string]: unknown;
}

interface TestExchange {
  format: unknown;
  version: unknown;
  dimensions: unknown[];
  group_variables: unknown[];
  tables: {
    meta_data: TestTable;
    points: TestTable;
    line_weights: TestTable;
    nodes: TestTable;
    adjacency_key: TestTable;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const encoder = new TextEncoder();

function character(name: string, values: unknown[]): TestColumn {
  return { name, type: "character", values };
}

function double(name: string, values: unknown[]): TestColumn {
  return { name, type: "double", values };
}

function syntheticExchange(): TestExchange {
  const units = ["unit-1", "unit-2"];
  const groups = ["control", "treatment"];
  const metadata = (): TestColumn[] => [
    character("ENA_UNIT", [...units]),
    character("Group", [...groups]),
  ];
  return {
    format: "ena3d-exchange",
    version: 1,
    dimensions: ["SVD1", "SVD2", "SVD3"],
    group_variables: ["Group"],
    tables: {
      meta_data: { columns: metadata() },
      points: {
        columns: [
          ...metadata(),
          double("SVD1", [0.1, 0.2]),
          double("SVD2", [0.3, null]),
          double("SVD3", [-0.4, 0.5]),
        ],
      },
      line_weights: {
        columns: [
          ...metadata(),
          double("A & B", [1, 2]),
          double("A & C", [3, 4]),
          double("B & C", [5, 6]),
        ],
      },
      nodes: {
        columns: [
          character("code", ["A", "B", "C"]),
          double("SVD1", [1, 0, -1]),
          double("SVD2", [0, 1, -1]),
          double("SVD3", [1, -1, 0]),
        ],
      },
      adjacency_key: {
        columns: [
          character("A & B", ["A", "B"]),
          character("A & C", ["A", "C"]),
          character("B & C", ["B", "C"]),
        ],
      },
    },
  };
}

function bytes(value: TestExchange = syntheticExchange()): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function cloneColumn(column: TestColumn): TestColumn {
  return structuredClone(column);
}

function addMetadataColumn(exchange: TestExchange, column: TestColumn): void {
  const metadataCount = exchange.tables.meta_data.columns.length;
  exchange.tables.meta_data.columns.push(cloneColumn(column));
  exchange.tables.points.columns.splice(
    metadataCount,
    0,
    cloneColumn(column),
  );
  exchange.tables.line_weights.columns.splice(
    metadataCount,
    0,
    cloneColumn(column),
  );
}

function expectDecodeError(
  operation: () => unknown,
  code: Ena3dExchangeErrorCode,
): Ena3dExchangeDecodeError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(Ena3dExchangeDecodeError);
    expect((error as Ena3dExchangeDecodeError).code).toBe(code);
    return error as Ena3dExchangeDecodeError;
  }
  throw new Error(`Expected decoder error ${code}.`);
}

describe("decodeEna3dExchangeV1", () => {
  it("returns a branded, deeply frozen DTO without retaining mutable input", () => {
    const input = bytes();
    const decoded = decodeEna3dExchangeV1(input);
    input.fill(0);

    expect(decoded.format).toBe("ena3d-exchange");
    expect(decoded.tables.points.columns[2]?.values).toEqual([0.1, 0.2]);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.tables)).toBe(true);
    expect(Object.isFrozen(decoded.tables.points.columns)).toBe(true);
    expect(Object.isFrozen(decoded.tables.points.columns[0]?.values)).toBe(true);
    expect(() => {
      (decoded.dimensions as string[]).push("SVD4");
    }).toThrow(TypeError);
  });

  it("accepts every exchange v1 scalar column type and preserves attributes", () => {
    const input = syntheticExchange();
    const columns: TestColumn[] = [
      { name: "Included", type: "logical", values: [true, null] },
      { name: "Count", type: "integer", values: [-2_147_483_647, 2_147_483_647] },
      { name: "StudyDate", type: "date", values: ["2024-02-29", null] },
      {
        name: "ObservedAt",
        type: "datetime",
        timezone: "UTC",
        values: [0, 1_725_000_000.25],
      },
      {
        name: "Elapsed",
        type: "difftime",
        units: "hours",
        values: [0, 1.5],
      },
      {
        name: "Phase",
        type: "factor",
        levels: ["early", "late", "unused"],
        values: ["early", "late"],
      },
      {
        name: "Rank",
        type: "ordered",
        levels: ["low", "high"],
        values: ["low", "high"],
      },
    ];
    for (const column of columns) addMetadataColumn(input, column);

    const decoded = decodeEna3dExchangeV1(bytes(input));
    expect(decoded.tables.meta_data.columns.map(({ type }) => type)).toEqual([
      "character",
      "character",
      "logical",
      "integer",
      "date",
      "datetime",
      "difftime",
      "factor",
      "ordered",
    ]);
  });

  it("rejects empty/non-byte inputs, a BOM, and malformed UTF-8", () => {
    expectDecodeError(
      () => decodeEna3dExchangeV1(null as unknown as Uint8Array),
      "INVALID_BYTES",
    );
    expectDecodeError(() => decodeEna3dExchangeV1(new Uint8Array()), "EMPTY_INPUT");
    expectDecodeError(
      () => decodeEna3dExchangeV1(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])),
      "BOM_FORBIDDEN",
    );
    expectDecodeError(
      () => decodeEna3dExchangeV1(new Uint8Array([0xc3, 0x28])),
      "INVALID_UTF8",
    );

    const detached = new ArrayBuffer(8);
    structuredClone(detached, { transfer: [detached] });
    expectDecodeError(() => decodeEna3dExchangeV1(detached), "INVALID_BYTES");
  });

  it("does not call JSON.parse when a byte-level gate rejects the input", () => {
    const parse = vi.spyOn(JSON, "parse");
    try {
      expectDecodeError(
        () => decodeEna3dExchangeV1(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])),
        "BOM_FORBIDDEN",
      );
      expectDecodeError(
        () => decodeEna3dExchangeV1(new Uint8Array([0xc3, 0x28])),
        "INVALID_UTF8",
      );
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  it("rejects escape-equivalent duplicate keys before JSON.parse", () => {
    const parse = vi.spyOn(JSON, "parse");
    try {
      expectDecodeError(
        () =>
          decodeEna3dExchangeV1(
            encoder.encode('{"format":"ena3d-exchange","\\u0066ormat":"ena3d-exchange"}'),
          ),
        "DUPLICATE_JSON_KEY",
      );
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  it("rejects nesting beyond 16 containers before JSON.parse", () => {
    const parse = vi.spyOn(JSON, "parse");
    try {
      const deeplyNested = `${"[".repeat(17)}0${"]".repeat(17)}`;
      expectDecodeError(
        () => decodeEna3dExchangeV1(encoder.encode(deeplyNested)),
        "JSON_TOO_DEEP",
      );
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }

    const atLimit = `${"[".repeat(16)}0${"]".repeat(16)}`;
    expectDecodeError(
      () => decodeEna3dExchangeV1(encoder.encode(atLimit)),
      "SCHEMA_MISMATCH",
    );
  });

  it("runs a complete JSON grammar preflight before parsing", () => {
    for (const malformed of [
      '{"format":}',
      '{"format":"ena3d-exchange",}',
      "[01]",
      "[1e]",
      '"unterminated',
    ]) {
      const parse = vi.spyOn(JSON, "parse");
      try {
        expectDecodeError(
          () => decodeEna3dExchangeV1(encoder.encode(malformed)),
          "INVALID_JSON",
        );
        expect(parse).not.toHaveBeenCalled();
      } finally {
        parse.mockRestore();
      }
    }
  });

  it("enforces exact object fields and unique column names", () => {
    const unknownRoot = syntheticExchange();
    unknownRoot.unexpected = true;
    expectDecodeError(() => decodeEna3dExchangeV1(bytes(unknownRoot)), "SCHEMA_MISMATCH");

    const unknownColumn = syntheticExchange();
    unknownColumn.tables.points.columns[0]!.class = "executable-marker";
    expectDecodeError(
      () => decodeEna3dExchangeV1(bytes(unknownColumn)),
      "SCHEMA_MISMATCH",
    );

    const duplicateColumn = syntheticExchange();
    duplicateColumn.tables.meta_data.columns[1]!.name = "ENA_UNIT";
    expectDecodeError(
      () => decodeEna3dExchangeV1(bytes(duplicateColumn)),
      "SCHEMA_MISMATCH",
    );
  });

  it("rejects invalid declared types, attributes, scalar values, and nonfinite numbers", () => {
    const cases: Array<{
      mutate(exchange: TestExchange): void;
      raw?: (exchange: TestExchange) => Uint8Array;
      expectedCode?: Ena3dExchangeErrorCode;
    }> = [
      {
        mutate(exchange) {
          exchange.tables.points.columns[2]!.type = "number";
        },
      },
      {
        mutate(exchange) {
          exchange.tables.points.columns[2]!.units = "secs";
        },
        expectedCode: "SCHEMA_MISMATCH",
      },
      {
        mutate(exchange) {
          exchange.tables.points.columns[2]!.values[0] = "0.1";
        },
      },
      {
        mutate(exchange) {
          exchange.tables.points.columns[2]!.values[0] = 0.1;
        },
        raw(exchange) {
          return encoder.encode(
            JSON.stringify(exchange).replace(
              '"name":"SVD1","type":"double","values":[0.1,0.2]',
              '"name":"SVD1","type":"double","values":[1e999,0.2]',
            ),
          );
        },
      },
    ];
    for (const testCase of cases) {
      const input = syntheticExchange();
      testCase.mutate(input);
      expectDecodeError(
        () => decodeEna3dExchangeV1(testCase.raw?.(input) ?? bytes(input)),
        testCase.expectedCode ?? "COLUMN_TYPE_MISMATCH",
      );
    }

    const integer = syntheticExchange();
    addMetadataColumn(integer, {
      name: "Count",
      type: "integer",
      values: [0, 2_147_483_648],
    });
    expectDecodeError(() => decodeEna3dExchangeV1(bytes(integer)), "COLUMN_TYPE_MISMATCH");

    const date = syntheticExchange();
    addMetadataColumn(date, {
      name: "StudyDate",
      type: "date",
      values: ["2023-02-29", "2024-01-01"],
    });
    expectDecodeError(() => decodeEna3dExchangeV1(bytes(date)), "COLUMN_TYPE_MISMATCH");

    const timezone = syntheticExchange();
    addMetadataColumn(timezone, {
      name: "ObservedAt",
      type: "datetime",
      timezone: "Mars/Olympus",
      values: [0, 1],
    });
    expectDecodeError(
      () => decodeEna3dExchangeV1(bytes(timezone)),
      "COLUMN_TYPE_MISMATCH",
    );

    const factor = syntheticExchange();
    addMetadataColumn(factor, {
      name: "Phase",
      type: "factor",
      levels: ["early", "late"],
      values: ["early", "unknown"],
    });
    expectDecodeError(() => decodeEna3dExchangeV1(bytes(factor)), "COLUMN_TYPE_MISMATCH");
  });

  it("requires row alignment and identical metadata type, attributes, and values", () => {
    const rows = syntheticExchange();
    rows.tables.points.columns[0]!.values.pop();
    expectDecodeError(
      () => decodeEna3dExchangeV1(bytes(rows)),
      "TABLE_ALIGNMENT_MISMATCH",
    );

    const values = syntheticExchange();
    values.tables.points.columns[1]!.values[0] = "changed";
    expectDecodeError(
      () => decodeEna3dExchangeV1(bytes(values)),
      "METADATA_ALIGNMENT_MISMATCH",
    );

    const attributes = syntheticExchange();
    const factorColumn: TestColumn = {
      name: "Phase",
      type: "factor",
      levels: ["early", "late"],
      values: ["early", "late"],
    };
    addMetadataColumn(attributes, factorColumn);
    const pointPhase = attributes.tables.points.columns.find(
      ({ name }) => name === "Phase",
    );
    expect(pointPhase).toBeDefined();
    pointPhase!.levels = ["late", "early"];
    expectDecodeError(
      () => decodeEna3dExchangeV1(bytes(attributes)),
      "METADATA_ALIGNMENT_MISMATCH",
    );
  });

  it("requires complete finite node coordinates and line weights", () => {
    const node = syntheticExchange();
    node.tables.nodes.columns[1]!.values[0] = null;
    expectDecodeError(() => decodeEna3dExchangeV1(bytes(node)), "COLUMN_TYPE_MISMATCH");

    const weight = syntheticExchange();
    weight.tables.line_weights.columns[2]!.values[0] = null;
    expectDecodeError(
      () => decodeEna3dExchangeV1(bytes(weight)),
      "COLUMN_TYPE_MISMATCH",
    );
  });

  it("enforces complete undirected adjacency and exact line-weight edge order", () => {
    const selfPair = syntheticExchange();
    selfPair.tables.adjacency_key.columns[0]!.values = ["A", "A"];
    selfPair.tables.adjacency_key.columns[0]!.name = "A & A";
    expectDecodeError(
      () => decodeEna3dExchangeV1(bytes(selfPair)),
      "ADJACENCY_MISMATCH",
    );

    const unknown = syntheticExchange();
    unknown.tables.adjacency_key.columns[0]!.values = ["A", "D"];
    unknown.tables.adjacency_key.columns[0]!.name = "A & D";
    expectDecodeError(() => decodeEna3dExchangeV1(bytes(unknown)), "ADJACENCY_MISMATCH");

    const duplicate = syntheticExchange();
    duplicate.tables.adjacency_key.columns[2]!.values = ["B", "A"];
    duplicate.tables.adjacency_key.columns[2]!.name = "B & A";
    expectDecodeError(
      () => decodeEna3dExchangeV1(bytes(duplicate)),
      "ADJACENCY_MISMATCH",
    );

    const missing = syntheticExchange();
    missing.tables.adjacency_key.columns.pop();
    missing.tables.line_weights.columns.pop();
    expectDecodeError(() => decodeEna3dExchangeV1(bytes(missing)), "ADJACENCY_MISMATCH");

    const wrongName = syntheticExchange();
    wrongName.tables.adjacency_key.columns[0]!.name = "B & A";
    expectDecodeError(
      () => decodeEna3dExchangeV1(bytes(wrongName)),
      "ADJACENCY_MISMATCH",
    );

    const reorderedWeights = syntheticExchange();
    const weightColumns = reorderedWeights.tables.line_weights.columns;
    [weightColumns[2], weightColumns[3]] = [weightColumns[3]!, weightColumns[2]!];
    expectDecodeError(
      () => decodeEna3dExchangeV1(bytes(reorderedWeights)),
      "TABLE_ALIGNMENT_MISMATCH",
    );
  });

  it("enforces default, hard, structural, and identity resource ceilings", () => {
    expectDecodeError(
      () =>
        decodeEna3dExchangeV1(
          new Uint8Array(DEFAULT_ENA3D_EXCHANGE_LIMITS.maxFileBytes + 1),
        ),
      "FILE_TOO_LARGE",
    );
    expectDecodeError(
      () => decodeEna3dExchangeV1(bytes(), { maxFileBytes: 10 * 1024 * 1024 + 1 }),
      "INVALID_LIMIT",
    );
    expectDecodeError(
      () =>
        decodeEna3dExchangeV1(bytes(), {
          unsupported: 1,
        } as unknown as Parameters<typeof decodeEna3dExchangeV1>[1]),
      "INVALID_LIMIT",
    );

    for (const limits of [
      { maxPointRows: 1 },
      { maxNodes: 2 },
      { maxDimensions: 2 },
      { maxMetadataColumns: 1 },
      { maxTableCells: 10 },
      { maxGroupLevels: 1 },
      { maxUnits: 1 },
    ]) {
      expectDecodeError(
        () => decodeEna3dExchangeV1(bytes(), limits),
        "RESOURCE_LIMIT_EXCEEDED",
      );
    }
  });

  it("applies maxPointRows only to row tables, not the two-row adjacency key", () => {
    const input = syntheticExchange();
    for (const table of [
      input.tables.meta_data,
      input.tables.points,
      input.tables.line_weights,
    ]) {
      for (const column of table.columns) column.values.splice(1);
    }

    expect(() =>
      decodeEna3dExchangeV1(bytes(input), {
        maxPointRows: 1,
        maxGroupLevels: 1,
        maxUnits: 1,
      }),
    ).not.toThrow();
  });
});

describe("SHA-256 binding", () => {
  it("hashes the same immutable byte snapshot that was decoded", async () => {
    const input = bytes();
    const expected = createHash("sha256").update(input).digest("hex");
    const pending = decodeEna3dExchangeV1WithSha256(input);
    input.fill(0);
    const result = await pending;

    expect(result.sha256).toBe(expected);
    expect(result.byteLength).toBeGreaterThan(0);
    expect(result.exchange.format).toBe("ena3d-exchange");
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("recognizes only same-realm receipts issued by the exact-byte decoder", async () => {
    const receipt = await decodeEna3dExchangeV1WithSha256(bytes());

    expect(isHashedEna3dExchangeV1(receipt)).toBe(true);
    expect(isHashedEna3dExchangeV1({ ...receipt })).toBe(false);
    expect(isHashedEna3dExchangeV1(structuredClone(receipt))).toBe(false);
    expect(
      isHashedEna3dExchangeV1({
        exchange: receipt.exchange,
        byteLength: receipt.byteLength,
        sha256: receipt.sha256,
      }),
    ).toBe(false);
  });

  it("offers raw-byte hashing under the same file limit", async () => {
    const input = bytes();
    await expect(sha256Ena3dExchangeBytes(input)).resolves.toBe(
      createHash("sha256").update(input).digest("hex"),
    );
    await expect(
      sha256Ena3dExchangeBytes(input, { maxFileBytes: input.byteLength - 1 }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });
});
