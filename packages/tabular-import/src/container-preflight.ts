import { tabularError } from "./errors";
import type { TabularImportLimits } from "./types";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_EXTRA_ID = 0x0001;
const AES_EXTRA_ID = 0x9901;
const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;
const ZIP_EOCD_MIN_BYTES = 22;
const ZIP_MAX_COMMENT_BYTES = 65_535;

interface CentralEntry {
  readonly name: string;
  readonly nameBytes: Uint8Array;
  readonly flags: number;
  readonly method: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
}

export interface XlsxZipPreflight {
  readonly entryCount: number;
  readonly totalUncompressedBytes: number;
  readonly containsVbaPart: boolean;
}

function malformed(message: string, path: string | null = null): never {
  tabularError("XLSX_ZIP_MALFORMED", message, path);
}

function ensureRange(bytes: Uint8Array, offset: number, length: number, path: string): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > bytes.byteLength - length
  ) {
    malformed("XLSX ZIP structure points outside the exact source bytes.", path);
  }
}

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function findEocd(bytes: Uint8Array, view: DataView): number {
  const earliest = Math.max(
    0,
    bytes.byteLength - ZIP_EOCD_MIN_BYTES - ZIP_MAX_COMMENT_BYTES,
  );
  for (let offset = bytes.byteLength - ZIP_EOCD_MIN_BYTES; offset >= earliest; offset -= 1) {
    if (u32(view, offset) !== EOCD_SIGNATURE) continue;
    const commentLength = u16(view, offset + 20);
    if (offset + ZIP_EOCD_MIN_BYTES + commentLength === bytes.byteLength) return offset;
  }
  malformed("XLSX ZIP end-of-central-directory record is missing or malformed.", "zip.eocd");
}

function decodeEntryName(nameBytes: Uint8Array, path: string): string {
  let name: string;
  try {
    name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
  } catch {
    malformed("XLSX ZIP entry names must be valid UTF-8/ASCII.", path);
  }
  if (
    name.length < 1 ||
    name.includes("\0") ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[A-Za-z]:/u.test(name)
  ) {
    tabularError("XLSX_ZIP_PATH_REJECTED", "XLSX ZIP entry path is unsafe.", path);
  }
  const directory = name.endsWith("/");
  const parts = name.split("/");
  if (directory) parts.pop();
  if (
    parts.length < 1 ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    tabularError("XLSX_ZIP_PATH_REJECTED", "XLSX ZIP entry path is ambiguous.", path);
  }
  return name;
}

function inspectExtraFields(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  length: number,
  path: string,
): void {
  ensureRange(bytes, offset, length, path);
  const end = offset + length;
  let cursor = offset;
  while (cursor < end) {
    if (cursor > end - 4) malformed("XLSX ZIP extra field is truncated.", path);
    const id = u16(view, cursor);
    const fieldLength = u16(view, cursor + 2);
    cursor += 4;
    if (cursor > end - fieldLength) malformed("XLSX ZIP extra field is truncated.", path);
    if (id === ZIP64_EXTRA_ID) {
      tabularError(
        "XLSX_ZIP64_UNSUPPORTED",
        "ZIP64 XLSX containers are outside the reviewed browser import contract.",
        path,
      );
    }
    if (id === AES_EXTRA_ID) {
      tabularError("XLSX_ZIP_ENCRYPTED", "Encrypted XLSX entries are not accepted.", path);
    }
    cursor += fieldLength;
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function preflightXlsxZip(
  bytes: Uint8Array,
  limits: Readonly<TabularImportLimits>,
): Readonly<XlsxZipPreflight> {
  if (bytes.byteLength < ZIP_EOCD_MIN_BYTES) {
    malformed("XLSX ZIP is shorter than its minimum container structure.", "zip");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEocd(bytes, view);

  const diskNumber = u16(view, eocdOffset + 4);
  const centralDisk = u16(view, eocdOffset + 6);
  const diskEntries = u16(view, eocdOffset + 8);
  const totalEntries = u16(view, eocdOffset + 10);
  const centralSize = u32(view, eocdOffset + 12);
  const centralOffset = u32(view, eocdOffset + 16);

  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== totalEntries
  ) {
    malformed("Multi-disk XLSX ZIP containers are not accepted.", "zip.eocd");
  }
  if (
    totalEntries === UINT16_MAX ||
    centralSize === UINT32_MAX ||
    centralOffset === UINT32_MAX
  ) {
    tabularError(
      "XLSX_ZIP64_UNSUPPORTED",
      "ZIP64 XLSX containers are outside the reviewed browser import contract.",
      "zip.eocd",
    );
  }
  if (totalEntries < 1 || totalEntries > limits.maxZipEntries) {
    tabularError(
      "XLSX_ZIP_ENTRY_LIMIT",
      `XLSX ZIP entry count exceeds maxZipEntries=${limits.maxZipEntries}.`,
      "zip.eocd.totalEntries",
    );
  }
  ensureRange(bytes, centralOffset, centralSize, "zip.centralDirectory");
  if (centralOffset + centralSize !== eocdOffset) {
    malformed(
      "XLSX ZIP central-directory boundaries are inconsistent.",
      "zip.centralDirectory",
    );
  }

  const entries: CentralEntry[] = [];
  const names = new Set<string>();
  let cursor = centralOffset;
  let totalUncompressedBytes = 0;

  for (let index = 0; index < totalEntries; index += 1) {
    ensureRange(bytes, cursor, 46, `zip.entries[${index}]`);
    if (u32(view, cursor) !== CENTRAL_SIGNATURE) {
      malformed("XLSX ZIP central-directory entry signature is invalid.", `zip.entries[${index}]`);
    }
    const madeBy = u16(view, cursor + 4);
    const flags = u16(view, cursor + 8);
    const method = u16(view, cursor + 10);
    const crc32 = u32(view, cursor + 16);
    const compressedSize = u32(view, cursor + 20);
    const uncompressedSize = u32(view, cursor + 24);
    const nameLength = u16(view, cursor + 28);
    const extraLength = u16(view, cursor + 30);
    const commentLength = u16(view, cursor + 32);
    const diskStart = u16(view, cursor + 34);
    const externalAttributes = u32(view, cursor + 38);
    const localOffset = u32(view, cursor + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    ensureRange(bytes, cursor, recordLength, `zip.entries[${index}]`);

    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0) {
      tabularError(
        "XLSX_ZIP_ENCRYPTED",
        "Encrypted XLSX entries are not accepted.",
        `zip.entries[${index}].flags`,
      );
    }
    if (method !== 0 && method !== 8) {
      tabularError(
        "XLSX_ZIP_UNSUPPORTED_COMPRESSION",
        "Only stored and DEFLATE-compressed XLSX entries are accepted.",
        `zip.entries[${index}].method`,
      );
    }
    if (
      compressedSize === UINT32_MAX ||
      uncompressedSize === UINT32_MAX ||
      localOffset === UINT32_MAX ||
      diskStart === UINT16_MAX
    ) {
      tabularError(
        "XLSX_ZIP64_UNSUPPORTED",
        "ZIP64 XLSX entries are outside the reviewed browser import contract.",
        `zip.entries[${index}]`,
      );
    }
    if (diskStart !== 0) {
      malformed("Multi-disk XLSX entries are not accepted.", `zip.entries[${index}].diskStart`);
    }

    const nameOffset = cursor + 46;
    const nameBytes = bytes.slice(nameOffset, nameOffset + nameLength);
    const name = decodeEntryName(nameBytes, `zip.entries[${index}].name`);
    const pathDepth = name.split("/").filter((part) => part.length > 0).length;
    if (pathDepth > limits.maxZipPathDepth) {
      tabularError(
        "XLSX_ZIP_PATH_REJECTED",
        `XLSX ZIP entry depth exceeds maxZipPathDepth=${limits.maxZipPathDepth}.`,
        `zip.entries[${index}].name`,
      );
    }
    const canonicalName = name.toLowerCase();
    if (names.has(canonicalName)) {
      malformed("XLSX ZIP contains a duplicate or case-colliding entry path.", `zip.entries[${index}].name`);
    }
    names.add(canonicalName);

    const platform = madeBy >>> 8;
    const unixMode = externalAttributes >>> 16;
    if (platform === 3 && (unixMode & 0xf000) === 0xa000) {
      tabularError(
        "XLSX_ZIP_PATH_REJECTED",
        "XLSX ZIP symbolic-link entries are not accepted.",
        `zip.entries[${index}].externalAttributes`,
      );
    }

    inspectExtraFields(
      bytes,
      view,
      nameOffset + nameLength,
      extraLength,
      `zip.entries[${index}].extra`,
    );

    if (uncompressedSize > limits.maxZipEntryUncompressedBytes) {
      tabularError(
        "XLSX_ZIP_ENTRY_SIZE_LIMIT",
        `XLSX ZIP entry expands beyond maxZipEntryUncompressedBytes=${limits.maxZipEntryUncompressedBytes}.`,
        `zip.entries[${index}].uncompressedSize`,
      );
    }
    totalUncompressedBytes += uncompressedSize;
    if (
      !Number.isSafeInteger(totalUncompressedBytes) ||
      totalUncompressedBytes > limits.maxZipTotalUncompressedBytes
    ) {
      tabularError(
        "XLSX_ZIP_EXPANSION_LIMIT",
        `XLSX ZIP declared expansion exceeds maxZipTotalUncompressedBytes=${limits.maxZipTotalUncompressedBytes}.`,
        "zip.totalUncompressedBytes",
      );
    }
    if (
      uncompressedSize > 1_024 &&
      (compressedSize === 0 || uncompressedSize / compressedSize > limits.maxZipCompressionRatio)
    ) {
      tabularError(
        "XLSX_ZIP_RATIO_LIMIT",
        `XLSX ZIP entry compression ratio exceeds maxZipCompressionRatio=${limits.maxZipCompressionRatio}.`,
        `zip.entries[${index}].compressionRatio`,
      );
    }

    entries.push({
      name,
      nameBytes,
      flags,
      method,
      crc32,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    cursor += recordLength;
  }
  if (cursor !== eocdOffset) {
    malformed("XLSX ZIP central-directory entry count or length is inconsistent.", "zip.centralDirectory");
  }

  const localRanges: Array<readonly [number, number]> = [];
  entries.forEach((entry, index) => {
    ensureRange(bytes, entry.localOffset, 30, `zip.entries[${index}].localHeader`);
    if (u32(view, entry.localOffset) !== LOCAL_SIGNATURE) {
      malformed("XLSX ZIP local-file signature is invalid.", `zip.entries[${index}].localHeader`);
    }
    const localFlags = u16(view, entry.localOffset + 6);
    const localMethod = u16(view, entry.localOffset + 8);
    const localCrc32 = u32(view, entry.localOffset + 14);
    const localCompressedSize = u32(view, entry.localOffset + 18);
    const localUncompressedSize = u32(view, entry.localOffset + 22);
    const localNameLength = u16(view, entry.localOffset + 26);
    const localExtraLength = u16(view, entry.localOffset + 28);
    const localHeaderLength = 30 + localNameLength + localExtraLength;
    ensureRange(bytes, entry.localOffset, localHeaderLength, `zip.entries[${index}].localHeader`);

    if (localFlags !== entry.flags || localMethod !== entry.method) {
      malformed("XLSX ZIP central and local entry metadata disagree.", `zip.entries[${index}].localHeader`);
    }
    if ((localFlags & 0x0008) === 0) {
      if (
        localCrc32 !== entry.crc32 ||
        localCompressedSize !== entry.compressedSize ||
        localUncompressedSize !== entry.uncompressedSize
      ) {
        malformed("XLSX ZIP central and local entry sizes disagree.", `zip.entries[${index}].localHeader`);
      }
    }

    const localNameOffset = entry.localOffset + 30;
    const localNameBytes = bytes.subarray(localNameOffset, localNameOffset + localNameLength);
    if (!equalBytes(entry.nameBytes, localNameBytes)) {
      malformed("XLSX ZIP central and local entry names disagree.", `zip.entries[${index}].localHeader`);
    }
    inspectExtraFields(
      bytes,
      view,
      localNameOffset + localNameLength,
      localExtraLength,
      `zip.entries[${index}].localExtra`,
    );
    const dataOffset = entry.localOffset + localHeaderLength;
    const dataEnd = dataOffset + entry.compressedSize;
    ensureRange(bytes, dataOffset, entry.compressedSize, `zip.entries[${index}].compressedData`);
    if (dataEnd > centralOffset) {
      malformed("XLSX ZIP entry data overlaps the central directory.", `zip.entries[${index}].compressedData`);
    }
    localRanges.push([entry.localOffset, dataEnd]);
  });

  localRanges.sort((left, right) => left[0] - right[0]);
  for (let index = 1; index < localRanges.length; index += 1) {
    const previous = localRanges[index - 1];
    const current = localRanges[index];
    if (previous !== undefined && current !== undefined && previous[1] > current[0]) {
      malformed("XLSX ZIP local-file ranges overlap.", "zip.localFiles");
    }
  }

  for (const required of ["[content_types].xml", "_rels/.rels", "xl/workbook.xml"]) {
    if (!names.has(required)) {
      tabularError(
        "XLSX_REQUIRED_PART_MISSING",
        "XLSX OPC container is missing a required workbook part.",
        required,
      );
    }
  }

  return Object.freeze({
    entryCount: entries.length,
    totalUncompressedBytes,
    containsVbaPart: names.has("xl/vbaproject.bin"),
  });
}

function isRegularSector(value: number, totalSectors: number): boolean {
  return value < totalSectors;
}

export function preflightXlsOle(bytes: Uint8Array): void {
  if (bytes.byteLength < 512) {
    tabularError("XLS_OLE_MALFORMED", "XLS OLE container is shorter than its header.", "ole.header");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const majorVersion = u16(view, 26);
  const byteOrder = u16(view, 28);
  const sectorShift = u16(view, 30);
  const miniSectorShift = u16(view, 32);
  if (byteOrder !== 0xfffe || miniSectorShift !== 6) {
    tabularError("XLS_OLE_MALFORMED", "XLS OLE header byte order or mini-sector size is invalid.", "ole.header");
  }
  if (
    (majorVersion === 3 && sectorShift !== 9) ||
    (majorVersion === 4 && sectorShift !== 12) ||
    (majorVersion !== 3 && majorVersion !== 4)
  ) {
    tabularError("XLS_OLE_MALFORMED", "XLS OLE version and sector size are inconsistent.", "ole.header");
  }
  const sectorSize = 2 ** sectorShift;
  if (bytes.byteLength % sectorSize !== 0) {
    tabularError("XLS_OLE_MALFORMED", "XLS OLE byte length is not sector-aligned.", "ole");
  }
  const totalSectors = bytes.byteLength / sectorSize - 1;
  const fatSectorCount = u32(view, 44);
  const firstDirectorySector = u32(view, 48);
  const miniStreamCutoff = u32(view, 56);
  const difatSectorCount = u32(view, 72);
  if (
    totalSectors < 1 ||
    fatSectorCount > totalSectors ||
    difatSectorCount > totalSectors ||
    !isRegularSector(firstDirectorySector, totalSectors) ||
    miniStreamCutoff !== 4_096
  ) {
    tabularError("XLS_OLE_MALFORMED", "XLS OLE sector metadata exceeds the source container.", "ole.header");
  }
}
