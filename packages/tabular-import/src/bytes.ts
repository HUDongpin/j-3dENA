import { tabularError } from "./errors";
import type {
  TabularImportFormat,
  TabularImportLimits,
  TabularInputBytes,
} from "./types";

const XLSX_LOCAL_FILE_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;
const OLE_COMPOUND_FILE_MAGIC = [
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
] as const;

function byteLengthOf(input: TabularInputBytes): number {
  if (input instanceof ArrayBuffer) return input.byteLength;
  if (ArrayBuffer.isView(input)) return input.byteLength;
  tabularError("INVALID_INPUT", "Input bytes must be an ArrayBuffer or ArrayBuffer view.", "bytes");
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.byteLength < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

export function validateSourceName(name: string): TabularImportFormat {
  if (
    typeof name !== "string" ||
    name.length < 1 ||
    name.length > 255 ||
    name === "." ||
    name === ".." ||
    /[\0-\x1f\x7f/\\]/u.test(name)
  ) {
    tabularError(
      "INVALID_FILE_NAME",
      "Source name must be a path-free browser filename no longer than 255 characters.",
      "name",
    );
  }

  const match = /\.([^.]+)$/u.exec(name);
  const extension = match?.[1]?.toLowerCase();
  if (extension === "csv" || extension === "xlsx" || extension === "xls") {
    return extension;
  }
  tabularError(
    "UNSUPPORTED_EXTENSION",
    "Only .csv, .xlsx, and .xls source files are accepted.",
    "name",
  );
}

export function takeOwnedByteSnapshot(
  input: TabularInputBytes,
  limits: Readonly<TabularImportLimits>,
): Uint8Array<ArrayBuffer> {
  const byteLength = byteLengthOf(input);
  if (byteLength < 1) {
    tabularError("INVALID_INPUT", "Input bytes must not be empty.", "bytes");
  }
  if (byteLength > limits.maxFileBytes) {
    tabularError(
      "FILE_LIMIT_EXCEEDED",
      `Input byte length exceeds maxFileBytes=${limits.maxFileBytes}.`,
      "bytes",
    );
  }

  try {
    const source = input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    const owned = new Uint8Array(source.byteLength);
    owned.set(source);
    return owned;
  } catch {
    tabularError("INVALID_INPUT", "Input bytes could not be snapshotted.", "bytes");
  }
}

export function validateExtensionMagic(
  bytes: Uint8Array,
  format: TabularImportFormat,
): void {
  const isZip = startsWith(bytes, XLSX_LOCAL_FILE_MAGIC);
  const isOle = startsWith(bytes, OLE_COMPOUND_FILE_MAGIC);
  if (format === "xlsx" && !isZip) {
    tabularError(
      "MAGIC_MISMATCH",
      "The .xlsx extension requires an OPC ZIP local-file signature.",
      "bytes[0..3]",
    );
  }
  if (format === "xls" && !isOle) {
    tabularError(
      "MAGIC_MISMATCH",
      "The .xls extension requires an OLE Compound File signature.",
      "bytes[0..7]",
    );
  }
  if (format === "csv" && (isZip || isOle)) {
    tabularError(
      "MAGIC_MISMATCH",
      "The .csv extension does not accept ZIP or OLE workbook bytes.",
      "bytes[0..7]",
    );
  }
}

export async function sha256OwnedBytes(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    tabularError(
      "CRYPTO_UNAVAILABLE",
      "Web Crypto SHA-256 is required for exact source receipts.",
    );
  }
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export function isLowercaseSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}
