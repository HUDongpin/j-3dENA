import type { TabularImportFormat } from "@3dena/tabular-import";
import { workflowError } from "./errors";
import type {
  ActivationIdentityV1,
  DatasetWorkflowLimitsV1,
  DeclaredTabularExtensionV1,
  ParsedIdentityV1,
  PreflightIdentityV1,
  UploadIdentityV1,
} from "./types";

const R_WORKSPACE_PREFIXES = ["RDX2\n", "RDX3\n", "RDA2\n", "RDA3\n"] as const;

export function ownedBytes(
  input: ArrayBuffer | ArrayBufferView,
  maxFileBytes: number,
): Uint8Array<ArrayBuffer> {
  let source: Uint8Array;
  if (input instanceof ArrayBuffer) {
    source = new Uint8Array(input);
  } else if (ArrayBuffer.isView(input)) {
    source = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  } else {
    workflowError("INVALID_REQUEST", "bytes", "must be an ArrayBuffer or view");
  }
  if (source.byteLength < 1) {
    workflowError("INVALID_REQUEST", "bytes", "must not be empty");
  }
  if (source.byteLength > maxFileBytes) {
    workflowError(
      "FILE_LIMIT_EXCEEDED",
      "bytes",
      "exceeds the activated maxFileBytes limit",
    );
  }
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}

export function rejectRWorkspaceBytes(bytes: Uint8Array): void {
  const prefix = new TextDecoder("ascii").decode(bytes.subarray(0, 5));
  if (R_WORKSPACE_PREFIXES.some((candidate) => prefix.startsWith(candidate))) {
    workflowError(
      "R_WORKSPACE_REJECTED",
      "bytes",
      "R workspace and serialized R inputs are not accepted",
    );
  }
}

export function formatForExtension(
  extension: unknown,
): { extension: DeclaredTabularExtensionV1; format: TabularImportFormat } {
  if (typeof extension !== "string") {
    workflowError("INVALID_REQUEST", "declaredExtension", "must be a string");
  }
  const normalized = extension.toLowerCase();
  if ([".rdata", ".rda", ".rds"].includes(normalized)) {
    workflowError(
      "R_WORKSPACE_REJECTED",
      "declaredExtension",
      "R workspace and serialized R extensions are not accepted",
    );
  }
  if (normalized === ".csv" || normalized === ".xlsx" || normalized === ".xls") {
    return { extension: normalized, format: normalized.slice(1) as TabularImportFormat };
  }
  workflowError(
    "INVALID_REQUEST",
    "declaredExtension",
    "must be .csv, .xlsx, or .xls",
  );
}

export async function sha256Bytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    workflowError("CRYPTO_UNAVAILABLE", "crypto.subtle", "SHA-256 is required");
  }
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      workflowError("INVALID_REQUEST", "identity", "cannot include non-finite values");
    }
    return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!value || typeof value !== "object") {
    workflowError("INVALID_REQUEST", "identity", "contains an unsupported value");
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => {
    if (record[key] === undefined) {
      workflowError("INVALID_REQUEST", "identity", "cannot include undefined values");
    }
    return `${JSON.stringify(key)}:${canonical(record[key])}`;
  }).join(",")}}`;
}

async function derivedIdentity<Identity extends string>(
  kind: "preflight" | "parsed" | "activation",
  payload: unknown,
): Promise<Identity> {
  const bytes = new TextEncoder().encode(canonical(payload));
  return `${kind}:sha256:${await sha256Bytes(bytes)}` as Identity;
}

export async function preflightIdentity(input: {
  format: TabularImportFormat;
  byteLength: number;
  sha256: string;
  limits: DatasetWorkflowLimitsV1;
}): Promise<PreflightIdentityV1> {
  return derivedIdentity<PreflightIdentityV1>("preflight", input);
}

export function uploadIdentity(sha256: string): UploadIdentityV1 {
  return `upload:sha256:${sha256}` as UploadIdentityV1;
}

export async function parsedIdentity(input: {
  uploadIdentity: UploadIdentityV1;
  parserVersion: string;
  format: TabularImportFormat;
  delimiter: "," | ";" | "\t" | null;
  worksheet: { index: number; name: string };
  headers: readonly string[];
  parsedContentSha256: string;
  rowCount: number;
  columnCount: number;
  skippedBlankRowCount: number;
  vbaDetectedAndDiscarded: boolean;
}): Promise<ParsedIdentityV1> {
  return derivedIdentity<ParsedIdentityV1>("parsed", input);
}

export async function activationIdentity(input: {
  parsedIdentity: ParsedIdentityV1;
  schema: unknown;
  limits: unknown;
  warnings: readonly string[];
}): Promise<ActivationIdentityV1> {
  return derivedIdentity<ActivationIdentityV1>("activation", input);
}

/**
 * Binds the exact ordered, typed parser payload independently of its source
 * bytes. This detects corruption or nondeterministic parser output even when
 * upload, worksheet metadata, dimensions, and parser version are unchanged.
 */
export async function parsedContentSha256(input: {
  headers: readonly string[];
  rows: readonly (readonly (string | number | boolean | null)[])[];
}): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(canonical({
    schemaVersion: "3dena.parsed-content.v1",
    headers: input.headers,
    rows: input.rows,
  })));
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

export function isWorkflowIdentity(
  value: unknown,
  kind: "preflight" | "upload" | "parsed" | "activation",
): value is PreflightIdentityV1 | UploadIdentityV1 | ParsedIdentityV1 | ActivationIdentityV1 {
  return typeof value === "string"
    && new RegExp(`^${kind}:sha256:[a-f0-9]{64}$`, "u").test(value);
}
