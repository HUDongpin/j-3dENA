import { createHash } from "node:crypto";

export interface NumericTable {
  rowKeys: string[];
  columns: string[];
  values: number[][];
}

export interface NumericVector {
  columns: string[];
  values: number[];
}

export interface GoldenAnalysis {
  connectionCounts?: NumericTable;
  rowConnectionCounts?: NumericTable;
  lineWeights?: NumericTable;
  centerVector?: NumericVector;
  rotationMatrix?: NumericTable;
  points?: NumericTable;
  nodes?: NumericTable;
  variance?: NumericVector;
  eigenvalues?: NumericVector;
}

export type GoldenAnalysisField = keyof GoldenAnalysis;
export type ParityFixtureStatus = "pending" | "generated" | "approved";

export interface ParityApproval {
  schemaVersion: "3dena.parity-approval.v1";
  reviewedBy: string;
  reviewedAtUtc: string;
  decisionRecord: string;
  inputSha256: string;
  analysisPayloadSha256: string;
  generatorGitCommit: string;
}

export interface ParityFixtureManifest {
  schemaVersion: "3dena.parity-fixture.v1";
  fixtureId: string;
  status: ParityFixtureStatus;
  availableFields: GoldenAnalysisField[];
  pendingReason?: string;
  approval?: ParityApproval;
  [key: string]: unknown;
}

export interface GoldenFixture {
  manifest: ParityFixtureManifest;
  analysis: GoldenAnalysis | null;
}

export interface ParityTolerance {
  absolute: number;
  relative: number;
}

export type ParityTolerances = Record<GoldenAnalysisField, ParityTolerance>;

export const DEFAULT_PARITY_TOLERANCES: ParityTolerances = Object.freeze({
  connectionCounts: { absolute: 1e-10, relative: 1e-10 },
  rowConnectionCounts: { absolute: 1e-10, relative: 1e-10 },
  lineWeights: { absolute: 1e-10, relative: 1e-9 },
  centerVector: { absolute: 1e-10, relative: 1e-9 },
  rotationMatrix: { absolute: 1e-8, relative: 1e-7 },
  points: { absolute: 1e-8, relative: 1e-7 },
  nodes: { absolute: 1e-7, relative: 1e-6 },
  variance: { absolute: 1e-9, relative: 1e-8 },
  eigenvalues: { absolute: 1e-9, relative: 1e-8 }
});

export const PARITY_BASELINE_V1 = Object.freeze({
  schemaVersion: "3dena.parity-fixture.v1",
  approvalSchemaVersion: "3dena.parity-approval.v1",
  legacyCommit: "d02019ad872c5ece3840be2b4028ef27af38b2ff",
  rVersion: "4.4.1",
  rENAVersion: "0.2.7",
  jenaCommit: "2f63db4c6ccf5684afc8437ae81ed1a3ccd0c1a3",
  jenaVersion: "0.6.2",
  jsonliteVersion: "2.0.0",
  digestVersion: "0.6.37",
  oracleRole: "offline-fixture-generator-only",
  generatorPath: "oracle-r/generate-small-raw-golden.R",
  analysisHashScope: "compact-json-utf8-of-top-level-analysis"
} as const);

const ANALYSIS_FIELDS = Object.freeze([
  "connectionCounts",
  "rowConnectionCounts",
  "lineWeights",
  "centerVector",
  "rotationMatrix",
  "points",
  "nodes",
  "variance",
  "eigenvalues"
] as const satisfies readonly GoldenAnalysisField[]);

const TABLE_FIELDS = new Set<GoldenAnalysisField>([
  "connectionCounts",
  "rowConnectionCounts",
  "lineWeights",
  "rotationMatrix",
  "points",
  "nodes"
]);

export interface ParityValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface ParityValidationEvidence {
  /** Exact source bytes named by manifest.input. */
  inputBytes?: string | Uint8Array;
  /** Exact fixture JSON text, needed to verify the generator's lexical payload hash. */
  fixtureJson?: string;
  /** Exact generator source bytes named by manifest.generator. */
  generatorBytes?: string | Uint8Array;
}

export interface ParityComparisonContext extends ParityValidationEvidence {
  /** Diagnostic-only field subset. An approved gate always compares every declared field. */
  fields?: GoldenAnalysisField[];
}

export interface ApprovedParityEvidence {
  inputBytes: string | Uint8Array;
  fixtureJson: string;
  generatorBytes: string | Uint8Array;
}

export interface ParityFixtureValidation {
  valid: boolean;
  fixtureStatus: ParityFixtureStatus | "invalid";
  fixtureId: string;
  issues: ParityValidationIssue[];
  computedHashes: {
    inputSha256?: string;
    generatorSha256?: string;
    analysisPayloadSha256?: string;
  };
}

export interface ParityFieldComparison {
  field: GoldenAnalysisField;
  status: "pass" | "fail" | "missing";
  maxAbsoluteError: number;
  maxRelativeError: number;
  mismatchCount: number;
  message?: string;
}

export type ParityComparisonStatus =
  | "pending"
  | "pending-invalid"
  | "candidate-pass"
  | "candidate-fail"
  | "candidate-invalid"
  | "approved-pass"
  | "approved-fail"
  | "approved-invalid"
  | "invalid";

export interface ParityComparison {
  status: ParityComparisonStatus;
  fixtureStatus: ParityFixtureStatus | "invalid";
  numericStatus: "not-run" | "pass" | "fail";
  comparisonScope: "none" | "partial" | "complete";
  /** True only for a complete, valid, numerically passing approved fixture. */
  approvedForParity: boolean;
  fixtureId: string;
  /** Multipliers applied to actual SVD columns before comparison. */
  axisSigns: Record<string, 1 | -1>;
  comparedFields: GoldenAnalysisField[];
  uncomparedFields: GoldenAnalysisField[];
  fields: ParityFieldComparison[];
  fixtureValidation: ParityFixtureValidation;
  actualValidationIssues: ParityValidationIssue[];
  messages: string[];
}

export type ApprovedParityComparison = ParityComparison & {
  status: "approved-pass";
  fixtureStatus: "approved";
  numericStatus: "pass";
  comparisonScope: "complete";
  approvedForParity: true;
  fixtureValidation: ParityFixtureValidation & { valid: true; fixtureStatus: "approved" };
};

interface AnalysisResultLike {
  axes: string[];
  points: Array<{ id: { canonical: string }; coordinates: number[]; lineWeights: number[] }>;
  nodes: Array<{ code: string; coordinates: number[] }>;
  edges: Array<{ column: string }>;
  variance: Array<{ axis: string; proportion: number; eigenvalue: number; displayed?: boolean }>;
  rotation: { columns: string[]; matrix: number[][]; centerVector: number[] };
}

/** Converts the public analysis DTO to the portable numeric-table fixture shape. */
export function normalizeAnalysisResult(result: AnalysisResultLike): GoldenAnalysis {
  return {
    lineWeights: {
      rowKeys: result.points.map((point) => point.id.canonical),
      columns: result.edges.map((edge) => edge.column),
      values: result.points.map((point) => [...point.lineWeights])
    },
    centerVector: {
      columns: result.edges.map((edge) => edge.column),
      values: [...result.rotation.centerVector]
    },
    rotationMatrix: {
      rowKeys: result.edges.map((edge) => edge.column),
      columns: [...result.rotation.columns],
      values: result.rotation.matrix.map((row) => [...row])
    },
    points: {
      rowKeys: result.points.map((point) => point.id.canonical),
      columns: [...result.axes],
      values: result.points.map((point) => [...point.coordinates])
    },
    nodes: {
      rowKeys: result.nodes.map((node) => node.code),
      columns: [...result.axes],
      values: result.nodes.map((node) => [...node.coordinates])
    },
    variance: {
      columns: result.variance.map((dimension) => dimension.axis),
      values: result.variance.map((dimension) => dimension.proportion)
    },
    eigenvalues: {
      columns: result.variance.map((dimension) => dimension.axis),
      values: result.variance.map((dimension) => dimension.eigenvalue)
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function issue(issues: ParityValidationIssue[], code: string, path: string, message: string): void {
  issues.push({ code, path, message });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isGitCommit(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

function isUtcTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) && Number.isFinite(Date.parse(value));
}

function expectExact(record: Record<string, unknown>, key: string, expected: unknown, path: string, issues: ParityValidationIssue[]): void {
  if (record[key] !== expected) issue(issues, "manifest.value", `${path}.${key}`, `Expected ${JSON.stringify(expected)}.`);
}

function expectNonEmptyString(record: Record<string, unknown>, key: string, path: string, issues: ParityValidationIssue[]): void {
  if (!isNonEmptyString(record[key])) issue(issues, "manifest.string", `${path}.${key}`, "Expected a non-empty string.");
}

function validateStringArray(
  value: unknown,
  path: string,
  issues: ParityValidationIssue[],
  options: { nonEmpty?: boolean; unique?: boolean } = {}
): string[] {
  if (!Array.isArray(value) || value.some((entry) => !isNonEmptyString(entry))) {
    issue(issues, "schema.string-array", path, "Expected an array of non-empty strings.");
    return [];
  }
  const strings = value as string[];
  if (options.nonEmpty && strings.length === 0) issue(issues, "schema.empty-array", path, "Expected at least one entry.");
  if (options.unique && new Set(strings).size !== strings.length) issue(issues, "schema.duplicate", path, "Entries must be unique.");
  return strings;
}

function validateSpec(value: unknown, issues: ParityValidationIssue[]): void {
  if (!isRecord(value)) {
    issue(issues, "manifest.spec", "manifest.spec", "Expected a specification object.");
    return;
  }
  expectNonEmptyString(value, "model", "manifest.spec", issues);
  validateStringArray(value.units, "manifest.spec.units", issues, { nonEmpty: true, unique: true });
  if (!(isNonEmptyString(value.conversation) || (Array.isArray(value.conversation) && value.conversation.every(isNonEmptyString) && value.conversation.length > 0))) {
    issue(issues, "manifest.spec", "manifest.spec.conversation", "Expected a non-empty string or string array.");
  }
  validateStringArray(value.codes, "manifest.spec.codes", issues, { nonEmpty: true, unique: true });
  expectNonEmptyString(value, "group", "manifest.spec", issues);
  if (!(isNonEmptyString(value.participant) || (Array.isArray(value.participant) && value.participant.every(isNonEmptyString) && value.participant.length > 0))) {
    issue(issues, "manifest.spec", "manifest.spec.participant", "Expected a non-empty string or string array.");
  }
  expectNonEmptyString(value, "time", "manifest.spec", issues);
  expectNonEmptyString(value, "window", "manifest.spec", issues);
  expectNonEmptyString(value, "weightBy", "manifest.spec", issues);
  expectNonEmptyString(value, "rotation", "manifest.spec", issues);
  for (const key of ["windowSizeBack", "windowSizeForward", "dimensions"] as const) {
    if (!Number.isInteger(value[key]) || (key === "dimensions" ? Number(value[key]) <= 0 : Number(value[key]) < 0)) {
      issue(issues, "manifest.spec", `manifest.spec.${key}`, "Expected a valid non-negative integer (dimensions must be positive)." );
    }
  }
  if (typeof value.centerAlignToOrigin !== "boolean") issue(issues, "manifest.spec", "manifest.spec.centerAlignToOrigin", "Expected a boolean.");
}

function validateNumericPayload(value: unknown, field: GoldenAnalysisField, path: string, issues: ParityValidationIssue[]): void {
  if (!isRecord(value)) {
    issue(issues, "analysis.shape", path, "Expected a numeric table or vector object.");
    return;
  }
  const fieldIsTable = TABLE_FIELDS.has(field);
  const columns = validateStringArray(value.columns, `${path}.columns`, issues, { nonEmpty: true, unique: true });
  if (!Array.isArray(value.values)) {
    issue(issues, "analysis.values", `${path}.values`, "Expected a numeric array.");
    return;
  }
  if (fieldIsTable) {
    const rowKeys = validateStringArray(value.rowKeys, `${path}.rowKeys`, issues, { nonEmpty: true, unique: true });
    if (rowKeys.length !== value.values.length) issue(issues, "analysis.row-count", `${path}.values`, `Expected ${rowKeys.length} rows, received ${value.values.length}.`);
    value.values.forEach((row, rowIndex) => {
      if (!Array.isArray(row)) {
        issue(issues, "analysis.row", `${path}.values[${rowIndex}]`, "Expected a numeric row array.");
        return;
      }
      if (row.length !== columns.length) issue(issues, "analysis.column-count", `${path}.values[${rowIndex}]`, `Expected ${columns.length} cells, received ${row.length}.`);
      row.forEach((cell, columnIndex) => {
        if (typeof cell !== "number" || !Number.isFinite(cell)) issue(issues, "analysis.non-finite", `${path}.values[${rowIndex}][${columnIndex}]`, "Expected a finite number.");
      });
    });
  } else {
    if ("rowKeys" in value) issue(issues, "analysis.kind", `${path}.rowKeys`, "Vectors must not declare rowKeys.");
    if (value.values.length !== columns.length) issue(issues, "analysis.vector-length", `${path}.values`, `Expected ${columns.length} values, received ${value.values.length}.`);
    value.values.forEach((cell, index) => {
      if (typeof cell !== "number" || !Number.isFinite(cell)) issue(issues, "analysis.non-finite", `${path}.values[${index}]`, "Expected a finite number.");
    });
  }
}

function validateAnalysis(value: unknown, fields: GoldenAnalysisField[], path: string, issues: ParityValidationIssue[], requireExactInventory: boolean): void {
  if (!isRecord(value)) {
    issue(issues, "analysis.object", path, "Expected an analysis object.");
    return;
  }
  const keys = Object.keys(value);
  for (const key of keys.filter((entry) => !ANALYSIS_FIELDS.includes(entry as GoldenAnalysisField))) {
    issue(issues, "analysis.unknown-field", `${path}.${key}`, "Unknown analysis field.");
  }
  if (requireExactInventory && JSON.stringify(keys) !== JSON.stringify(fields)) issue(issues, "analysis.inventory", path, "Analysis fields and order must exactly match manifest.availableFields.");
  for (const field of fields) {
    if (!(field in value)) issue(issues, "analysis.missing-field", `${path}.${field}`, "Manifest-declared field is missing.");
    else validateNumericPayload(value[field], field, `${path}.${field}`, issues);
  }
}

function compactJsonLexically(value: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  for (const character of value) {
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
    } else if (character === "\"") {
      inString = true;
      output += character;
    } else if (!/\s/.test(character)) output += character;
  }
  return output;
}

function scanJsonString(text: string, start: number): number {
  if (text[start] !== "\"") throw new Error("Expected a JSON string.");
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index]!;
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (character === "\"") return index + 1;
  }
  throw new Error("Unterminated JSON string.");
}

function skipJsonWhitespace(text: string, start: number): number {
  let index = start;
  while (index < text.length && /\s/.test(text[index]!)) index += 1;
  return index;
}

function scanJsonValue(text: string, start: number): number {
  const first = text[start];
  if (first === "\"") return scanJsonString(text, start);
  if (first === "{" || first === "[") {
    const stack = [first === "{" ? "}" : "]"];
    let inString = false;
    let escaped = false;
    for (let index = start + 1; index < text.length; index += 1) {
      const character = text[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === "\"") inString = false;
        continue;
      }
      if (character === "\"") inString = true;
      else if (character === "{") stack.push("}");
      else if (character === "[") stack.push("]");
      else if (character === stack.at(-1)) {
        stack.pop();
        if (stack.length === 0) return index + 1;
      }
    }
    throw new Error("Unterminated JSON container.");
  }
  let index = start;
  while (index < text.length && !/[\s,}\]]/.test(text[index]!)) index += 1;
  return index;
}

function extractTopLevelProperty(text: string, requestedKey: string): string {
  let index = skipJsonWhitespace(text, 0);
  if (text[index] !== "{") throw new Error("Fixture JSON must have an object root.");
  index += 1;
  while (index < text.length) {
    index = skipJsonWhitespace(text, index);
    if (text[index] === "}") break;
    const keyEnd = scanJsonString(text, index);
    const key = JSON.parse(text.slice(index, keyEnd)) as string;
    index = skipJsonWhitespace(text, keyEnd);
    if (text[index] !== ":") throw new Error("Expected ':' after a root property name.");
    const valueStart = skipJsonWhitespace(text, index + 1);
    const valueEnd = scanJsonValue(text, valueStart);
    if (key === requestedKey) return text.slice(valueStart, valueEnd);
    index = skipJsonWhitespace(text, valueEnd);
    if (text[index] === ",") index += 1;
    else if (text[index] !== "}") throw new Error("Expected ',' or '}' after a root property.");
  }
  throw new Error(`Fixture JSON has no top-level ${requestedKey} property.`);
}

function canonicalSemanticJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : `"<non-finite:${String(value)}>"`;
  if (Array.isArray(value)) return `[${value.map(canonicalSemanticJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalSemanticJson(value[key])}`).join(",")}}`;
  return `"<unsupported:${typeof value}>"`;
}

function validateGeneratedManifest(
  manifest: Record<string, unknown>,
  fixture: unknown,
  analysis: unknown,
  fields: GoldenAnalysisField[],
  status: "generated" | "approved",
  evidence: ParityValidationEvidence,
  issues: ParityValidationIssue[],
  computedHashes: ParityFixtureValidation["computedHashes"]
): void {
  expectExact(manifest, "legacyCommit", PARITY_BASELINE_V1.legacyCommit, "manifest", issues);
  expectExact(manifest, "rVersion", PARITY_BASELINE_V1.rVersion, "manifest", issues);
  expectExact(manifest, "rENAVersion", PARITY_BASELINE_V1.rENAVersion, "manifest", issues);
  expectExact(manifest, "jenaCommit", PARITY_BASELINE_V1.jenaCommit, "manifest", issues);
  expectExact(manifest, "jenaVersion", PARITY_BASELINE_V1.jenaVersion, "manifest", issues);
  expectNonEmptyString(manifest, "command", "manifest", issues);
  if (!isUtcTimestamp(manifest.generatedAtUtc)) issue(issues, "manifest.timestamp", "manifest.generatedAtUtc", "Expected an RFC 3339 UTC timestamp without fractional seconds.");

  const oracle = manifest.scientificOracle;
  if (!isRecord(oracle)) issue(issues, "manifest.oracle", "manifest.scientificOracle", "Expected scientific-oracle provenance.");
  else {
    expectExact(oracle, "role", PARITY_BASELINE_V1.oracleRole, "manifest.scientificOracle", issues);
    expectExact(oracle, "legacyProductCommit", PARITY_BASELINE_V1.legacyCommit, "manifest.scientificOracle", issues);
    expectExact(oracle, "R", PARITY_BASELINE_V1.rVersion, "manifest.scientificOracle", issues);
    expectExact(oracle, "rENA", PARITY_BASELINE_V1.rENAVersion, "manifest.scientificOracle", issues);
    expectExact(oracle, "jsonlite", PARITY_BASELINE_V1.jsonliteVersion, "manifest.scientificOracle", issues);
    expectExact(oracle, "digest", PARITY_BASELINE_V1.digestVersion, "manifest.scientificOracle", issues);
    expectNonEmptyString(oracle, "platform", "manifest.scientificOracle", issues);
  }

  const generator = manifest.generator;
  if (!isRecord(generator)) issue(issues, "manifest.generator", "manifest.generator", "Expected generator provenance.");
  else {
    expectExact(generator, "path", PARITY_BASELINE_V1.generatorPath, "manifest.generator", issues);
    if (!isGitCommit(generator.gitCommit)) issue(issues, "manifest.generator-commit", "manifest.generator.gitCommit", "Expected a full 40-character Git commit.");
    if (!isSha256(generator.sha256)) issue(issues, "manifest.generator-hash", "manifest.generator.sha256", "Expected a lowercase SHA-256.");
    if (evidence.generatorBytes === undefined) issue(issues, "evidence.generator-missing", "evidence.generatorBytes", "Generator bytes are required to verify manifest.generator.sha256.");
    else {
      const digest = sha256(evidence.generatorBytes);
      computedHashes.generatorSha256 = digest;
      if (generator.sha256 !== digest) issue(issues, "evidence.generator-hash", "manifest.generator.sha256", "Generator SHA-256 does not match the supplied generator bytes.");
    }
  }

  const runtime = manifest.numericalRuntime;
  if (!isRecord(runtime)) issue(issues, "manifest.runtime", "manifest.numericalRuntime", "Expected numerical runtime provenance.");
  else {
    expectNonEmptyString(runtime, "platform", "manifest.numericalRuntime", issues);
    expectNonEmptyString(runtime, "BLAS", "manifest.numericalRuntime", issues);
    expectNonEmptyString(runtime, "LAPACK", "manifest.numericalRuntime", issues);
  }

  const input = manifest.input;
  if (isRecord(input)) {
    if (!Number.isInteger(input.bytes) || Number(input.bytes) < 0) issue(issues, "manifest.input-bytes", "manifest.input.bytes", "Expected a non-negative integer byte count.");
    if (evidence.inputBytes === undefined) issue(issues, "evidence.input-missing", "evidence.inputBytes", "Input bytes are required to verify manifest.input.");
    else {
      const bytes = typeof evidence.inputBytes === "string" ? Buffer.byteLength(evidence.inputBytes) : evidence.inputBytes.byteLength;
      const digest = sha256(evidence.inputBytes);
      computedHashes.inputSha256 = digest;
      if (input.bytes !== bytes) issue(issues, "evidence.input-bytes", "manifest.input.bytes", "Input byte count does not match the supplied source bytes.");
      if (input.sha256 !== digest) issue(issues, "evidence.input-hash", "manifest.input.sha256", "Input SHA-256 does not match the supplied source bytes.");
    }
  }

  const payloadHash = manifest.analysisPayloadSha256;
  const payload = manifest.analysisPayload;
  if (!isSha256(payloadHash)) issue(issues, "manifest.analysis-hash", "manifest.analysisPayloadSha256", "Expected a lowercase SHA-256.");
  if (!isRecord(payload)) issue(issues, "manifest.analysis-hash", "manifest.analysisPayload", "Expected canonical analysis-payload hash metadata.");
  else {
    expectExact(payload, "hashAlgorithm", "sha256", "manifest.analysisPayload", issues);
    expectExact(payload, "hashScope", PARITY_BASELINE_V1.analysisHashScope, "manifest.analysisPayload", issues);
    if (!isSha256(payload.sha256)) issue(issues, "manifest.analysis-hash", "manifest.analysisPayload.sha256", "Expected a lowercase SHA-256.");
    if (payload.sha256 !== payloadHash) issue(issues, "manifest.analysis-hash", "manifest.analysisPayload.sha256", "Nested and flat analysis payload hashes differ.");
  }

  if (evidence.fixtureJson === undefined) issue(issues, "evidence.fixture-json-missing", "evidence.fixtureJson", "Exact fixture JSON text is required to verify the lexical analysis payload hash.");
  else {
    try {
      const parsed = JSON.parse(evidence.fixtureJson) as unknown;
      if (canonicalSemanticJson(parsed) !== canonicalSemanticJson(fixture)) issue(issues, "evidence.fixture-mismatch", "evidence.fixtureJson", "Supplied fixture JSON does not represent the fixture object being compared.");
      const rawAnalysis = extractTopLevelProperty(evidence.fixtureJson, "analysis");
      const digest = sha256(compactJsonLexically(rawAnalysis));
      computedHashes.analysisPayloadSha256 = digest;
      if (payloadHash !== digest) issue(issues, "evidence.analysis-hash", "manifest.analysisPayloadSha256", "Analysis payload SHA-256 does not match the exact lexical payload in fixtureJson.");
    } catch (error) {
      issue(issues, "evidence.fixture-json", "evidence.fixtureJson", error instanceof Error ? error.message : "Invalid fixture JSON.");
    }
  }

  validateAnalysis(analysis, fields, "analysis", issues, true);
  const approval = manifest.approval;
  if (status === "generated") {
    if (approval !== undefined) issue(issues, "manifest.premature-approval", "manifest.approval", "A generated candidate must not carry an approval record.");
    return;
  }
  if (!isRecord(approval)) {
    issue(issues, "manifest.approval", "manifest.approval", "Approved fixtures require an explicit review record.");
    return;
  }
  expectExact(approval, "schemaVersion", PARITY_BASELINE_V1.approvalSchemaVersion, "manifest.approval", issues);
  expectNonEmptyString(approval, "reviewedBy", "manifest.approval", issues);
  if (!isUtcTimestamp(approval.reviewedAtUtc)) issue(issues, "manifest.approval-time", "manifest.approval.reviewedAtUtc", "Expected an RFC 3339 UTC timestamp without fractional seconds.");
  expectNonEmptyString(approval, "decisionRecord", "manifest.approval", issues);
  if (!isRecord(input) || approval.inputSha256 !== input.sha256) issue(issues, "manifest.approval-binding", "manifest.approval.inputSha256", "Approval must bind the manifest input hash.");
  if (approval.analysisPayloadSha256 !== payloadHash) issue(issues, "manifest.approval-binding", "manifest.approval.analysisPayloadSha256", "Approval must bind the analysis payload hash.");
  if (!isRecord(generator) || approval.generatorGitCommit !== generator.gitCommit) issue(issues, "manifest.approval-binding", "manifest.approval.generatorGitCommit", "Approval must bind the generator Git commit.");
}

/** Validates fixture custody without performing a numerical comparison. */
export function validateParityFixture(fixture: unknown, evidence: ParityValidationEvidence = {}): ParityFixtureValidation {
  const issues: ParityValidationIssue[] = [];
  const computedHashes: ParityFixtureValidation["computedHashes"] = {};
  if (!isRecord(fixture)) return { valid: false, fixtureStatus: "invalid", fixtureId: "<invalid-fixture>", issues: [{ code: "fixture.object", path: "fixture", message: "Expected a fixture object." }], computedHashes };
  const manifest = fixture.manifest;
  if (!isRecord(manifest)) return { valid: false, fixtureStatus: "invalid", fixtureId: "<invalid-fixture>", issues: [{ code: "manifest.object", path: "manifest", message: "Expected a manifest object." }], computedHashes };

  const fixtureId = isNonEmptyString(manifest.fixtureId) ? manifest.fixtureId : "<invalid-fixture>";
  if (!isNonEmptyString(manifest.fixtureId)) issue(issues, "manifest.fixture-id", "manifest.fixtureId", "Expected a non-empty fixture ID.");
  expectExact(manifest, "schemaVersion", PARITY_BASELINE_V1.schemaVersion, "manifest", issues);
  const status = ["pending", "generated", "approved"].includes(String(manifest.status)) ? manifest.status as ParityFixtureStatus : "invalid";
  if (status === "invalid") issue(issues, "manifest.status", "manifest.status", "Expected pending, generated, or approved.");

  const fields = validateStringArray(manifest.availableFields, "manifest.availableFields", issues, { unique: true }).filter((field): field is GoldenAnalysisField => {
    if (ANALYSIS_FIELDS.includes(field as GoldenAnalysisField)) return true;
    issue(issues, "manifest.available-field", "manifest.availableFields", `Unknown analysis field ${JSON.stringify(field)}.`);
    return false;
  });
  const input = manifest.input;
  if (!isRecord(input)) issue(issues, "manifest.input", "manifest.input", "Expected input provenance.");
  else {
    expectNonEmptyString(input, "path", "manifest.input", issues);
    if (!isSha256(input.sha256)) issue(issues, "manifest.input-hash", "manifest.input.sha256", "Expected a lowercase SHA-256.");
  }
  validateSpec(manifest.spec, issues);

  if (status === "pending") {
    if (fixture.analysis !== null) issue(issues, "fixture.pending-analysis", "analysis", "Pending fixtures must have a null analysis payload.");
    if (!isNonEmptyString(manifest.pendingReason)) issue(issues, "manifest.pending-reason", "manifest.pendingReason", "Pending fixtures require an explicit reason.");
    if (fields.length !== 0) issue(issues, "manifest.pending-fields", "manifest.availableFields", "Pending fixtures must not claim available oracle fields.");
    if (manifest.approval !== undefined) issue(issues, "manifest.pending-approval", "manifest.approval", "Pending fixtures must not carry an approval record.");
  } else if (status === "generated" || status === "approved") {
    if (fields.length === 0) issue(issues, "manifest.available-fields", "manifest.availableFields", "Generated and approved fixtures require at least one available field.");
    validateGeneratedManifest(manifest, fixture, fixture.analysis, fields, status, evidence, issues, computedHashes);
  }
  return { valid: issues.length === 0, fixtureStatus: status, fixtureId, issues, computedHashes };
}

function isTable(value: NumericTable | NumericVector | undefined): value is NumericTable {
  return Boolean(value && "rowKeys" in value);
}

function flatten(value: NumericTable | NumericVector): number[] {
  return isTable(value) ? value.values.flat() : value.values;
}

function shapeMessage(actual: NumericTable | NumericVector, expected: NumericTable | NumericVector): string | undefined {
  if (isTable(actual) !== isTable(expected)) return "table/vector kind differs";
  if (JSON.stringify(actual.columns) !== JSON.stringify(expected.columns)) return "column names or order differ";
  if (isTable(actual) && isTable(expected) && JSON.stringify(actual.rowKeys) !== JSON.stringify(expected.rowKeys)) return "row keys or order differ";
  const actualValues = flatten(actual);
  const expectedValues = flatten(expected);
  if (actualValues.length !== expectedValues.length) return `numeric cell count differs (${actualValues.length} versus ${expectedValues.length})`;
  return undefined;
}

function axisSigns(actual: GoldenAnalysis, expected: GoldenAnalysis): Record<string, 1 | -1> {
  const actualBasis = actual.rotationMatrix ?? actual.points;
  const expectedBasis = expected.rotationMatrix ?? expected.points;
  if (!actualBasis || !expectedBasis || shapeMessage(actualBasis, expectedBasis)) return {};
  const signs: Record<string, 1 | -1> = {};
  for (let columnIndex = 0; columnIndex < expectedBasis.columns.length; columnIndex += 1) {
    const axis = expectedBasis.columns[columnIndex]!;
    if (!/^SVD\d+$/.test(axis)) continue;
    let dot = 0;
    for (let rowIndex = 0; rowIndex < expectedBasis.values.length; rowIndex += 1) dot += (actualBasis.values[rowIndex]?.[columnIndex] ?? 0) * (expectedBasis.values[rowIndex]?.[columnIndex] ?? 0);
    signs[axis] = dot < 0 ? -1 : 1;
  }
  return signs;
}

function alignedValues(field: GoldenAnalysisField, value: NumericTable | NumericVector, signs: Record<string, 1 | -1>): number[] {
  if (!isTable(value)) return [...value.values];
  if (field !== "rotationMatrix" && field !== "points" && field !== "nodes") return value.values.flat();
  return value.values.flatMap((row) => row.map((cell, columnIndex) => cell * (signs[value.columns[columnIndex] ?? ""] ?? 1)));
}

function compareField(field: GoldenAnalysisField, actual: NumericTable | NumericVector | undefined, expected: NumericTable | NumericVector | undefined, tolerance: ParityTolerance, signs: Record<string, 1 | -1>): ParityFieldComparison {
  if (!actual || !expected) return { field, status: "missing", maxAbsoluteError: 0, maxRelativeError: 0, mismatchCount: 0, message: `${actual ? "golden" : "actual"} field is missing` };
  const shape = shapeMessage(actual, expected);
  if (shape) return { field, status: "fail", maxAbsoluteError: 0, maxRelativeError: 0, mismatchCount: 1, message: shape };
  const actualValues = alignedValues(field, actual, signs);
  const expectedValues = flatten(expected);
  let maxAbsoluteError = 0;
  let maxRelativeError = 0;
  let mismatchCount = 0;
  for (let index = 0; index < expectedValues.length; index += 1) {
    const actualValue = actualValues[index]!;
    const expectedValue = expectedValues[index]!;
    if (!Number.isFinite(actualValue) || !Number.isFinite(expectedValue)) {
      mismatchCount += 1;
      continue;
    }
    const absoluteError = Math.abs(actualValue - expectedValue);
    const relativeError = absoluteError / Math.max(Math.abs(expectedValue), Number.MIN_VALUE);
    maxAbsoluteError = Math.max(maxAbsoluteError, absoluteError);
    maxRelativeError = Math.max(maxRelativeError, relativeError);
    if (absoluteError > tolerance.absolute + tolerance.relative * Math.abs(expectedValue)) mismatchCount += 1;
  }
  return { field, status: mismatchCount === 0 ? "pass" : "fail", maxAbsoluteError, maxRelativeError, mismatchCount };
}

function statusFor(fixtureStatus: ParityFixtureStatus | "invalid", valid: boolean, numericStatus: "not-run" | "pass" | "fail"): ParityComparisonStatus {
  if (fixtureStatus === "invalid") return "invalid";
  if (fixtureStatus === "pending") return valid ? "pending" : "pending-invalid";
  if (!valid) return fixtureStatus === "generated" ? "candidate-invalid" : "approved-invalid";
  if (fixtureStatus === "generated") return numericStatus === "pass" ? "candidate-pass" : "candidate-fail";
  return numericStatus === "pass" ? "approved-pass" : "approved-fail";
}

/** Compares numerics while keeping fixture custody explicit. */
export function compareGoldenAnalysis(
  actual: GoldenAnalysis,
  fixture: GoldenFixture,
  tolerances: ParityTolerances = DEFAULT_PARITY_TOLERANCES,
  context: ParityComparisonContext = {}
): ParityComparison {
  const fixtureValidation = validateParityFixture(fixture, context);
  const fixtureStatus = fixtureValidation.fixtureStatus;
  if (fixtureStatus === "pending" || fixtureStatus === "invalid") {
    const manifest = isRecord((fixture as unknown as Record<string, unknown>).manifest)
      ? (fixture as unknown as Record<string, unknown>).manifest as Record<string, unknown>
      : undefined;
    const pendingReason = manifest && isNonEmptyString(manifest.pendingReason) ? manifest.pendingReason : undefined;
    return {
      status: statusFor(fixtureStatus, fixtureValidation.valid, "not-run"),
      fixtureStatus,
      numericStatus: "not-run",
      comparisonScope: "none",
      approvedForParity: false,
      fixtureId: fixtureValidation.fixtureId,
      axisSigns: {},
      comparedFields: [],
      uncomparedFields: [],
      fields: [],
      fixtureValidation,
      actualValidationIssues: [],
      messages: fixtureValidation.issues.length > 0 ? fixtureValidation.issues.map((entry) => `${entry.path}: ${entry.message}`) : [pendingReason ?? "Golden analysis has not been generated by the frozen oracle."]
    };
  }

  const rawDeclaredFields: unknown = fixture.manifest.availableFields;
  const declaredFields = Array.isArray(rawDeclaredFields)
    ? rawDeclaredFields.filter((field): field is GoldenAnalysisField => typeof field === "string" && ANALYSIS_FIELDS.includes(field as GoldenAnalysisField))
    : [];
  const requestedFields: readonly string[] = Array.isArray(context.fields) ? context.fields : declaredFields;
  const comparisonIssues: ParityValidationIssue[] = [];
  if (new Set(requestedFields).size !== requestedFields.length) issue(comparisonIssues, "comparison.duplicate-field", "context.fields", "Comparison fields must be unique.");
  const selectedFields = requestedFields.filter((field): field is GoldenAnalysisField => {
    if (!ANALYSIS_FIELDS.includes(field as GoldenAnalysisField)) {
      issue(comparisonIssues, "comparison.unknown-field", "context.fields", `Unknown analysis field ${JSON.stringify(field)}.`);
      return false;
    }
    if (!declaredFields.includes(field as GoldenAnalysisField)) {
      issue(comparisonIssues, "comparison.undeclared-field", "context.fields", `Field ${field} is not declared by the fixture.`);
      return false;
    }
    return true;
  });
  const uncomparedFields = declaredFields.filter((field) => !selectedFields.includes(field));
  const comparisonScope = uncomparedFields.length === 0 && selectedFields.length === declaredFields.length ? "complete" : "partial";
  if (fixtureStatus === "approved" && comparisonScope !== "complete") issue(comparisonIssues, "comparison.partial-approved", "context.fields", "Approved parity must compare every manifest-declared field.");

  const actualValidationIssues = [...comparisonIssues];
  validateAnalysis(actual, selectedFields, "actual", actualValidationIssues, false);
  const comparableActual = isRecord(actual) ? actual as GoldenAnalysis : {};
  const expected = isRecord(fixture.analysis) ? fixture.analysis as GoldenAnalysis : {};
  const signs = axisSigns(comparableActual, expected);
  const fields = selectedFields.map((field) => compareField(field, comparableActual[field], expected[field], tolerances[field], signs));
  const numericStatus = fields.length > 0 && fields.every((field) => field.status === "pass") ? "pass" : "fail";
  const status = statusFor(fixtureStatus, fixtureValidation.valid && actualValidationIssues.length === 0, numericStatus);
  const messages = [...fixtureValidation.issues.map((entry) => `${entry.path}: ${entry.message}`), ...actualValidationIssues.map((entry) => `${entry.path}: ${entry.message}`)];
  if (fields.some((field) => field.status === "missing")) messages.push("At least one oracle-declared field is absent from the actual or golden payload.");
  if (fields.some((field) => field.status === "fail")) messages.push("At least one compared field exceeds its field-specific tolerance or structural contract.");
  if (fixtureStatus === "generated" && numericStatus === "pass") messages.push("Numeric diagnostics passed, but a generated candidate is not approved parity evidence.");
  const approvedForParity = status === "approved-pass" && comparisonScope === "complete";
  return {
    status,
    fixtureStatus,
    numericStatus,
    comparisonScope,
    approvedForParity,
    fixtureId: fixtureValidation.fixtureId,
    axisSigns: signs,
    comparedFields: [...selectedFields],
    uncomparedFields,
    fields,
    fixtureValidation,
    actualValidationIssues,
    messages
  };
}

export class ParityApprovalError extends Error {
  readonly comparison: ParityComparison;

  constructor(comparison: ParityComparison) {
    super(`Approved parity gate rejected ${comparison.fixtureId}: ${comparison.status}.`);
    this.name = "ParityApprovalError";
    this.comparison = comparison;
  }
}

/** Strict gate: returns only a complete, valid, numerically passing approved comparison. */
export function requireApprovedParity(comparison: ParityComparison): ApprovedParityComparison {
  if (
    comparison.status !== "approved-pass" ||
    comparison.fixtureStatus !== "approved" ||
    comparison.numericStatus !== "pass" ||
    comparison.comparisonScope !== "complete" ||
    !comparison.approvedForParity ||
    !comparison.fixtureValidation.valid
  ) throw new ParityApprovalError(comparison);
  return comparison as ApprovedParityComparison;
}

/** Performs a complete comparison and immediately enforces the approved-only gate. */
export function compareApprovedGoldenAnalysis(
  actual: GoldenAnalysis,
  fixture: GoldenFixture,
  evidence: ApprovedParityEvidence,
  tolerances: ParityTolerances = DEFAULT_PARITY_TOLERANCES
): ApprovedParityComparison {
  return requireApprovedParity(compareGoldenAnalysis(actual, fixture, tolerances, evidence));
}
