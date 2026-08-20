import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  DETERMINISTIC_ZIP_EPOCH,
  ExportEncodingError,
  HARD_DETERMINISTIC_ZIP_LIMITS,
  createDeterministicZip,
  type ExportEncodingErrorCode,
} from "./index";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

interface ParsedZipEntry {
  readonly path: string;
  readonly data: Uint8Array;
  readonly crc32: number;
  readonly compressedBytes: number;
  readonly uncompressedBytes: number;
  readonly flags: number;
  readonly method: number;
  readonly dosTime: number;
  readonly dosDate: number;
  readonly localOffset: number;
  readonly localCrc32: number;
  readonly localFlags: number;
  readonly localMethod: number;
}

interface ParsedZip {
  readonly entries: readonly ParsedZipEntry[];
  readonly centralOffset: number;
  readonly centralBytes: number;
  readonly eocdOffset: number;
}

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

function uint16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(
    offset,
    true,
  );
}

function uint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
    true,
  );
}

function parseZip(bytes: Uint8Array): ParsedZip {
  if (bytes.byteLength < 22) throw new Error("ZIP is shorter than EOCD.");
  const eocdOffset = bytes.byteLength - 22;
  if (uint32(bytes, eocdOffset) !== 0x0605_4b50) {
    throw new Error("EOCD signature is absent.");
  }
  const count = uint16(bytes, eocdOffset + 10);
  const centralBytes = uint32(bytes, eocdOffset + 12);
  const centralOffset = uint32(bytes, eocdOffset + 16);
  if (uint16(bytes, eocdOffset + 8) !== count) {
    throw new Error("Split central directory is not supported by the test parser.");
  }
  if (uint16(bytes, eocdOffset + 20) !== 0) {
    throw new Error("Unexpected ZIP comment.");
  }

  const entries: ParsedZipEntry[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (uint32(bytes, cursor) !== 0x0201_4b50) {
      throw new Error(`Central signature ${index} is absent.`);
    }
    const flags = uint16(bytes, cursor + 8);
    const method = uint16(bytes, cursor + 10);
    const dosTime = uint16(bytes, cursor + 12);
    const dosDate = uint16(bytes, cursor + 14);
    const crc32 = uint32(bytes, cursor + 16);
    const compressedBytes = uint32(bytes, cursor + 20);
    const uncompressedBytes = uint32(bytes, cursor + 24);
    const nameBytes = uint16(bytes, cursor + 28);
    const extraBytes = uint16(bytes, cursor + 30);
    const commentBytes = uint16(bytes, cursor + 32);
    const localOffset = uint32(bytes, cursor + 42);
    const path = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameBytes));

    if (uint32(bytes, localOffset) !== 0x0403_4b50) {
      throw new Error(`Local signature ${index} is absent.`);
    }
    const localFlags = uint16(bytes, localOffset + 6);
    const localMethod = uint16(bytes, localOffset + 8);
    const localCrc32 = uint32(bytes, localOffset + 14);
    const localNameBytes = uint16(bytes, localOffset + 26);
    const localExtraBytes = uint16(bytes, localOffset + 28);
    const localPath = decoder.decode(
      bytes.slice(localOffset + 30, localOffset + 30 + localNameBytes),
    );
    if (localPath !== path) throw new Error("Local and central paths differ.");
    const dataOffset = localOffset + 30 + localNameBytes + localExtraBytes;
    const data = bytes.slice(dataOffset, dataOffset + compressedBytes);

    entries.push({
      path,
      data,
      crc32,
      compressedBytes,
      uncompressedBytes,
      flags,
      method,
      dosTime,
      dosDate,
      localOffset,
      localCrc32,
      localFlags,
      localMethod,
    });
    cursor += 46 + nameBytes + extraBytes + commentBytes;
  }
  if (cursor !== centralOffset + centralBytes || cursor !== eocdOffset) {
    throw new Error("Central directory size or EOCD offset is inconsistent.");
  }
  return { entries, centralOffset, centralBytes, eocdOffset };
}

describe("createDeterministicZip", () => {
  it("writes a valid empty ZIP32 archive", () => {
    const archive = createDeterministicZip([]);
    const parsed = parseZip(archive);

    expect(archive.byteLength).toBe(22);
    expect(parsed.entries).toEqual([]);
    expect(parsed.centralOffset).toBe(0);
    expect(parsed.centralBytes).toBe(0);
  });

  it("is deterministic across input order and snapshots entry bytes", () => {
    const alpha = encoder.encode("alpha");
    const entries = [
      { path: "资料/轨迹.csv", data: encoder.encode("三维") },
      { path: "z.txt", data: encoder.encode("zeta") },
      { path: "a.txt", data: alpha },
    ];
    const first = createDeterministicZip(entries);
    const second = createDeterministicZip([...entries].reverse());
    const firstHash = createHash("sha256").update(first).digest("hex");
    const secondHash = createHash("sha256").update(second).digest("hex");
    alpha.fill(0);

    expect(first).toEqual(second);
    expect(firstHash).toBe(secondHash);
    expect(parseZip(first).entries.map(({ path }) => path)).toEqual([
      "a.txt",
      "z.txt",
      "资料/轨迹.csv",
    ]);
    expect(decoder.decode(parseZip(first).entries[0]?.data)).toBe("alpha");
  });

  it("emits store records, UTF-8 flags, fixed epoch, CRC-32, and aligned central records", () => {
    const archive = createDeterministicZip([
      { path: "资料/check.txt", data: encoder.encode("123456789") },
    ]);
    const parsed = parseZip(archive);
    const entry = parsed.entries[0];

    expect(DETERMINISTIC_ZIP_EPOCH).toBe("1980-01-01T00:00:00Z");
    expect(entry).toBeDefined();
    expect(entry!.path).toBe("资料/check.txt");
    expect(entry!.method).toBe(0);
    expect(entry!.localMethod).toBe(0);
    expect(entry!.flags & 0x0800).toBe(0x0800);
    expect(entry!.localFlags & 0x0800).toBe(0x0800);
    expect(entry!.dosTime).toBe(0);
    expect(entry!.dosDate).toBe(0x0021);
    expect(entry!.compressedBytes).toBe(9);
    expect(entry!.uncompressedBytes).toBe(9);
    expect(entry!.crc32).toBe(0xcbf4_3926);
    expect(entry!.localCrc32).toBe(0xcbf4_3926);
    expect(decoder.decode(entry!.data)).toBe("123456789");
    expect(parsed.centralOffset).toBeGreaterThan(entry!.localOffset);
    expect(parsed.eocdOffset).toBe(parsed.centralOffset + parsed.centralBytes);
  });

  it.each([
    "",
    "/absolute.txt",
    "C:/absolute.txt",
    "../escape.txt",
    "safe/../../escape.txt",
    "back\\slash.txt",
    "control\nname.txt",
    "control\u0085name.txt",
    "double//slash.txt",
    "current/./file.txt",
    "directory/",
    "\ud800",
  ])("rejects unsafe ZIP path %j", (path) => {
    expectExportError(
      () => createDeterministicZip([{ path, data: new Uint8Array() }]),
      "INVALID_ZIP_PATH",
    );
  });

  it("rejects duplicate paths before archive construction", () => {
    expectExportError(
      () =>
        createDeterministicZip([
          { path: "same.csv", data: encoder.encode("first") },
          { path: "same.csv", data: encoder.encode("second") },
        ]),
      "DUPLICATE_ZIP_PATH",
    );
  });

  it("rejects non-Uint8Array data and malformed entries", () => {
    expectExportError(
      () =>
        createDeterministicZip([
          { path: "data.bin", data: new DataView(new ArrayBuffer(1)) },
        ] as never),
      "INVALID_ZIP_ENTRY",
    );
    expectExportError(
      () => createDeterministicZip([null] as never),
      "INVALID_ZIP_ENTRY",
    );
    expectExportError(
      () => createDeterministicZip({} as never),
      "INVALID_ZIP_ENTRIES",
    );
  });

  it("enforces file-count, single-file, total-byte, path, and hard ceilings", () => {
    expectExportError(
      () =>
        createDeterministicZip(
          [
            { path: "a", data: new Uint8Array() },
            { path: "b", data: new Uint8Array() },
          ],
          { maxFiles: 1 },
        ),
      "ZIP_LIMIT_EXCEEDED",
    );
    expectExportError(
      () =>
        createDeterministicZip(
          [{ path: "a", data: new Uint8Array(2) }],
          { maxFileBytes: 1 },
        ),
      "ZIP_LIMIT_EXCEEDED",
    );
    expectExportError(
      () =>
        createDeterministicZip(
          [
            { path: "a", data: new Uint8Array(2) },
            { path: "b", data: new Uint8Array(2) },
          ],
          { maxTotalBytes: 3 },
        ),
      "ZIP_LIMIT_EXCEEDED",
    );
    expectExportError(
      () =>
        createDeterministicZip(
          [{ path: "long", data: new Uint8Array() }],
          { maxPathBytes: 3 },
        ),
      "ZIP_LIMIT_EXCEEDED",
    );
    expectExportError(
      () =>
        createDeterministicZip([], {
          maxFiles: HARD_DETERMINISTIC_ZIP_LIMITS.maxFiles + 1,
        }),
      "INVALID_ZIP_LIMIT",
    );
    expectExportError(
      () => createDeterministicZip([], { maxFiles: 0 }),
      "INVALID_ZIP_LIMIT",
    );
    expectExportError(
      () =>
        createDeterministicZip(
          [],
          { unsupported: 1 } as never,
        ),
      "INVALID_ZIP_LIMIT",
    );
  });
});
