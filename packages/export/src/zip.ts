import { exportError } from "./errors";
import { isWellFormedUnicode } from "./unicode";

export interface DeterministicZipEntry {
  readonly path: string;
  readonly data: Uint8Array;
}

export interface DeterministicZipLimits {
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly maxPathBytes: number;
}

export const DEFAULT_DETERMINISTIC_ZIP_LIMITS: Readonly<DeterministicZipLimits> =
  Object.freeze({
    maxFiles: 64,
    maxFileBytes: 8 * 1024 * 1024,
    maxTotalBytes: 32 * 1024 * 1024,
    maxPathBytes: 512,
  });

export const HARD_DETERMINISTIC_ZIP_LIMITS: Readonly<DeterministicZipLimits> =
  Object.freeze({
    maxFiles: 1_024,
    maxFileBytes: 64 * 1024 * 1024,
    maxTotalBytes: 128 * 1024 * 1024,
    maxPathBytes: 4_096,
  });

export const DETERMINISTIC_ZIP_EPOCH = "1980-01-01T00:00:00Z";

const ZIP_LIMIT_KEYS = Object.freeze(
  Object.keys(
    DEFAULT_DETERMINISTIC_ZIP_LIMITS,
  ) as (keyof DeterministicZipLimits)[],
);
const UTF8_ENCODER = new TextEncoder();
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const VERSION_20 = 20;
const DOS_TIME_MIDNIGHT = 0;
const DOS_DATE_1980_01_01 = 0x0021;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const MAX_ZIP32_VALUE = 0xffff_ffff;
const MAX_ZIP32_ENTRIES = 0xffff;
const PATH_CONTROL = /\p{Cc}/u;
const WINDOWS_DRIVE_PATH = /^[A-Za-z]:/u;

interface PreparedEntry {
  readonly pathBytes: Uint8Array<ArrayBuffer>;
  readonly data: Uint8Array<ArrayBuffer>;
  readonly crc32: number;
  localOffset: number;
}

/**
 * Create a deterministic, uncompressed ZIP32 archive entirely in memory.
 * Entry data is snapshotted before CRC calculation and output construction.
 */
export function createDeterministicZip(
  entries: readonly DeterministicZipEntry[],
  limits?: Partial<DeterministicZipLimits>,
): Uint8Array<ArrayBuffer> {
  const resolved = resolveZipLimits(limits);
  if (!Array.isArray(entries)) {
    exportError("INVALID_ZIP_ENTRIES", "ZIP entries must be an array.");
  }
  enforceZipLimit(entries.length, resolved.maxFiles, "ZIP file count", "entries");
  if (entries.length > MAX_ZIP32_ENTRIES) {
    exportError(
      "ZIP_FORMAT_LIMIT_EXCEEDED",
      "ZIP32 cannot encode this many entries.",
      "entries",
    );
  }

  const prepared = prepareEntries(entries, resolved);
  prepared.sort((left, right) => compareBytes(left.pathBytes, right.pathBytes));

  let localBytes = 0;
  let centralBytes = 0;
  for (const entry of prepared) {
    entry.localOffset = localBytes;
    localBytes = checkedAdd(
      localBytes,
      30 + entry.pathBytes.byteLength + entry.data.byteLength,
    );
    centralBytes = checkedAdd(centralBytes, 46 + entry.pathBytes.byteLength);
  }
  const outputBytes = checkedAdd(checkedAdd(localBytes, centralBytes), 22);
  if (
    localBytes > MAX_ZIP32_VALUE ||
    centralBytes > MAX_ZIP32_VALUE ||
    outputBytes > MAX_ZIP32_VALUE
  ) {
    exportError(
      "ZIP_FORMAT_LIMIT_EXCEEDED",
      "ZIP32 offset or size capacity would be exceeded.",
    );
  }

  const output = new Uint8Array(outputBytes);
  const writer = new LittleEndianWriter(output);
  for (const entry of prepared) writeLocalEntry(writer, entry);
  const centralOffset = writer.offset;
  for (const entry of prepared) writeCentralEntry(writer, entry);
  const writtenCentralBytes = writer.offset - centralOffset;
  writeEndOfCentralDirectory(
    writer,
    prepared.length,
    writtenCentralBytes,
    centralOffset,
  );
  if (writer.offset !== output.byteLength) {
    exportError(
      "ZIP_FORMAT_LIMIT_EXCEEDED",
      "ZIP size accounting did not match the emitted archive.",
    );
  }
  return output;
}

function resolveZipLimits(
  requested?: Partial<DeterministicZipLimits>,
): Readonly<DeterministicZipLimits> {
  if (requested !== undefined) {
    if (
      requested === null ||
      typeof requested !== "object" ||
      Array.isArray(requested)
    ) {
      exportError("INVALID_ZIP_LIMIT", "ZIP limits must be an object.");
    }
    const unknown = Object.keys(requested).filter(
      (key) => !ZIP_LIMIT_KEYS.includes(key as keyof DeterministicZipLimits),
    );
    if (unknown.length > 0) {
      exportError(
        "INVALID_ZIP_LIMIT",
        "ZIP limits contain an unsupported field.",
      );
    }
  }

  const resolved = { ...DEFAULT_DETERMINISTIC_ZIP_LIMITS };
  for (const key of ZIP_LIMIT_KEYS) {
    const value = requested?.[key] ?? resolved[key];
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > HARD_DETERMINISTIC_ZIP_LIMITS[key]
    ) {
      exportError(
        "INVALID_ZIP_LIMIT",
        "ZIP limit must be a positive safe integer within its hard ceiling.",
        key,
      );
    }
    resolved[key] = value;
  }
  return Object.freeze(resolved);
}

function prepareEntries(
  entries: readonly DeterministicZipEntry[],
  limits: Readonly<DeterministicZipLimits>,
): PreparedEntry[] {
  const prepared: PreparedEntry[] = [];
  const seenPaths = new Set<string>();
  let totalBytes = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      exportError(
        "INVALID_ZIP_ENTRY",
        "Every ZIP entry must be an object with path and Uint8Array data.",
        `entries[${index}]`,
      );
    }
    const path = entry.path;
    const inputData = entry.data;
    validateZipPath(path, `entries[${index}].path`);
    if (seenPaths.has(path)) {
      exportError(
        "DUPLICATE_ZIP_PATH",
        "ZIP entry paths must be unique.",
        `entries[${index}].path`,
      );
    }
    seenPaths.add(path);

    if (!(inputData instanceof Uint8Array)) {
      exportError(
        "INVALID_ZIP_ENTRY",
        "ZIP entry data must be a Uint8Array.",
        `entries[${index}].data`,
      );
    }
    const dataByteLength = inputData.byteLength;
    enforceZipLimit(
      dataByteLength,
      limits.maxFileBytes,
      "ZIP single-file byte count",
      `entries[${index}].data`,
    );
    totalBytes = checkedAdd(totalBytes, dataByteLength);
    enforceZipLimit(
      totalBytes,
      limits.maxTotalBytes,
      "ZIP total uncompressed byte count",
      "entries",
    );

    const pathBytes = UTF8_ENCODER.encode(path);
    enforceZipLimit(
      pathBytes.byteLength,
      limits.maxPathBytes,
      "ZIP path byte count",
      `entries[${index}].path`,
    );
    if (pathBytes.byteLength > 0xffff) {
      exportError(
        "ZIP_FORMAT_LIMIT_EXCEEDED",
        "ZIP32 filename length would be exceeded.",
        `entries[${index}].path`,
      );
    }

    const data = new Uint8Array(dataByteLength);
    if (inputData.byteLength !== dataByteLength) {
      exportError(
        "INVALID_ZIP_ENTRY",
        "ZIP entry data changed size before its byte snapshot was captured.",
        `entries[${index}].data`,
      );
    }
    try {
      data.set(inputData);
    } catch {
      exportError(
        "INVALID_ZIP_ENTRY",
        "ZIP entry data could not be snapshotted.",
        `entries[${index}].data`,
      );
    }
    if (inputData.byteLength !== dataByteLength) {
      exportError(
        "INVALID_ZIP_ENTRY",
        "ZIP entry data changed size while its byte snapshot was captured.",
        `entries[${index}].data`,
      );
    }
    prepared.push({
      pathBytes,
      data,
      crc32: calculateCrc32(data),
      localOffset: 0,
    });
  }
  return prepared;
}

function validateZipPath(path: unknown, location: string): asserts path is string {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    !isWellFormedUnicode(path)
  ) {
    exportError(
      "INVALID_ZIP_PATH",
      "ZIP path must be a non-empty well-formed Unicode string.",
      location,
    );
  }
  if (
    path.startsWith("/") ||
    WINDOWS_DRIVE_PATH.test(path) ||
    path.includes("\\") ||
    PATH_CONTROL.test(path)
  ) {
    exportError(
      "INVALID_ZIP_PATH",
      "ZIP paths must be relative forward-slash paths without controls or drive prefixes.",
      location,
    );
  }
  const segments = path.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    exportError(
      "INVALID_ZIP_PATH",
      "ZIP paths may not contain empty, current-directory, or parent-directory segments.",
      location,
    );
  }
}

function writeLocalEntry(writer: LittleEndianWriter, entry: PreparedEntry): void {
  writer.uint32(LOCAL_FILE_HEADER_SIGNATURE);
  writer.uint16(VERSION_20);
  writer.uint16(UTF8_FLAG);
  writer.uint16(STORE_METHOD);
  writer.uint16(DOS_TIME_MIDNIGHT);
  writer.uint16(DOS_DATE_1980_01_01);
  writer.uint32(entry.crc32);
  writer.uint32(entry.data.byteLength);
  writer.uint32(entry.data.byteLength);
  writer.uint16(entry.pathBytes.byteLength);
  writer.uint16(0);
  writer.bytes(entry.pathBytes);
  writer.bytes(entry.data);
}

function writeCentralEntry(writer: LittleEndianWriter, entry: PreparedEntry): void {
  writer.uint32(CENTRAL_DIRECTORY_SIGNATURE);
  writer.uint16(VERSION_20);
  writer.uint16(VERSION_20);
  writer.uint16(UTF8_FLAG);
  writer.uint16(STORE_METHOD);
  writer.uint16(DOS_TIME_MIDNIGHT);
  writer.uint16(DOS_DATE_1980_01_01);
  writer.uint32(entry.crc32);
  writer.uint32(entry.data.byteLength);
  writer.uint32(entry.data.byteLength);
  writer.uint16(entry.pathBytes.byteLength);
  writer.uint16(0);
  writer.uint16(0);
  writer.uint16(0);
  writer.uint16(0);
  writer.uint32(0);
  writer.uint32(entry.localOffset);
  writer.bytes(entry.pathBytes);
}

function writeEndOfCentralDirectory(
  writer: LittleEndianWriter,
  entryCount: number,
  centralBytes: number,
  centralOffset: number,
): void {
  writer.uint32(END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  writer.uint16(0);
  writer.uint16(0);
  writer.uint16(entryCount);
  writer.uint16(entryCount);
  writer.uint32(centralBytes);
  writer.uint32(centralOffset);
  writer.uint16(0);
}

class LittleEndianWriter {
  private readonly view: DataView;
  offset = 0;

  constructor(private readonly output: Uint8Array<ArrayBuffer>) {
    this.view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  }

  uint16(value: number): void {
    this.view.setUint16(this.offset, value, true);
    this.offset += 2;
  }

  uint32(value: number): void {
    this.view.setUint32(this.offset, value, true);
    this.offset += 4;
  }

  bytes(value: Uint8Array): void {
    this.output.set(value, this.offset);
    this.offset += value.byteLength;
  }
}

function calculateCrc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc = (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.byteLength - right.byteLength;
}

function enforceZipLimit(
  actual: number,
  maximum: number,
  label: string,
  path: string,
): void {
  if (!Number.isSafeInteger(actual) || actual > maximum) {
    exportError(
      "ZIP_LIMIT_EXCEEDED",
      `${label} exceeds the configured ceiling.`,
      path,
    );
  }
}

function checkedAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    exportError(
      "ZIP_FORMAT_LIMIT_EXCEEDED",
      "ZIP size accounting exceeded JavaScript's safe integer range.",
    );
  }
  return result;
}
