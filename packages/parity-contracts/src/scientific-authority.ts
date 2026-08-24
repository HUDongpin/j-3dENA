export const SCIENTIFIC_AUTHORITY_APPROVAL_VERSION_V1 = "3dena.scientific-authority-approval.v1" as const;
export const SCIENTIFIC_AUTHORITY_MATRIX_VERSION_V1 = "3dena.scientific-authority-matrix.v1" as const;

export const REQUIRED_SCIENTIFIC_QUANTITIES_V1 = Object.freeze([
  "ena.model-counts",
  "ena.source-row-counts",
  "ena.lineweights",
  "ena.center-vector",
  "ena.rotation-ordinary",
  "ena.rotation-degenerate-subspace",
  "ena.points",
  "ena.nodes",
  "ena.variance",
  "ena.eigenvalues",
  "ena.row-contract",
  "ena.column-contract",
  "ena.order-contract",
  "ena.schema-contract",
  "stats.welch",
  "stats.rank-sum",
  "stats.signed-rank",
  "stats.paired-matching",
  "stats.ties",
  "stats.zeros",
  "stats.exact-asymptotic-policy",
  "stats.alternative",
  "stats.continuity",
  "stats.effect-definition",
  "stats.ci-method",
  "stats.ci-bounds",
  "stats.valid-n",
  "stats.dropped-n",
  "stats.adjustment-holm",
  "stats.adjustment-bh",
  "stats.adjustment-bonferroni",
  "stats.adjustment-none",
  "trajectory.participant-period-reduction",
  "trajectory.group-time-centroids",
  "trajectory.cohort-available",
  "trajectory.cohort-complete",
  "trajectory.missing-policy",
  "trajectory.gap-policy",
  "trajectory.estimand-equal",
  "trajectory.estimand-weighted",
  "trajectory.distance-selected-space",
  "trajectory.distance-full-space",
  "trajectory.elapsed-units",
  "trajectory.speed",
  "trajectory.paired-exact-id-time",
  "trajectory.independent-exchangeability",
  "trajectory.independent-permutation",
  "bootstrap.participant-history-cluster",
  "bootstrap.strata",
  "bootstrap.fixed-resample-plan",
  "bootstrap.successor-prng",
  "bootstrap.seed-receipt",
  "bootstrap.quantile-type7",
  "bootstrap.interval-family",
  "bootstrap.rotation-fixed-refit-policy",
] as const);

export type ScientificQuantityV1 = typeof REQUIRED_SCIENTIFIC_QUANTITIES_V1[number];

export type ScientificToleranceV1 =
  | {
      kind: "exact";
      quantity: ScientificQuantityV1;
      contractId: string;
      absolute: 0;
      relative: 0;
    }
  | {
      kind: "numeric-absolute-relative";
      quantity: ScientificQuantityV1;
      contractId: string;
      absolute: number;
      relative: number;
    }
  | {
      kind: "degenerate-subspace-projector";
      quantity: "ena.rotation-degenerate-subspace";
      contractId: string;
      projectorMaxAbsolute: number;
      projectorFrobenius: number;
      rankTolerance: number;
    };

export interface ScientificOracleOutputV1 {
  rVersion: string;
  rENAVersion: "0.2.7" | "0.3.1";
  containerDigest: string;
  outputSha256: string;
}

export interface ScientificAuthorityApprovalV1 {
  schemaVersion: typeof SCIENTIFIC_AUTHORITY_APPROVAL_VERSION_V1;
  approvalId: string;
  quantity: ScientificQuantityV1;
  fixtureId: string;
  fixtureSha256: string;
  inputSha256: string;
  mappingSha256: string;
  specSha256: string;
  oracleOutputs: {
    rENA027: ScientificOracleOutputV1;
    rENA031: ScientificOracleOutputV1;
  };
  typescriptOutput: {
    package: "@3dena/analysis";
    packageVersion: string;
    gitCommit: string;
    outputSha256: string;
  };
  comparisonReportSha256: string;
  tolerance: ScientificToleranceV1;
  seed: number | null;
  schemaVersions: string[];
  regressionTest: string;
  implementer: { id: string; attestedAtUtc: string };
  reviewer: { id: string; reviewedAtUtc: string };
  decision: {
    status: "approved";
    decidedAtUtc: string;
    record: string;
    rationale: string;
  };
}

export interface ScientificAuthorityMatrixV1 {
  schemaVersion: typeof SCIENTIFIC_AUTHORITY_MATRIX_VERSION_V1;
  matrixId: string;
  status: "blocked" | "release-approved";
  requiredQuantities: ScientificQuantityV1[];
  approvals: ScientificAuthorityApprovalV1[];
}

export interface ScientificAuthorityIssueV1 {
  code: string;
  path: string;
  message: string;
}

export interface ScientificAuthorityValidationV1 {
  valid: boolean;
  releaseApproved: boolean;
  approvedQuantities: ScientificQuantityV1[];
  missingQuantities: ScientificQuantityV1[];
  issues: ScientificAuthorityIssueV1[];
}

export class ScientificAuthorityApprovalError extends Error {
  readonly validation: ScientificAuthorityValidationV1;

  constructor(validation: ScientificAuthorityValidationV1) {
    super(`Scientific authority is not release-approved: ${validation.issues.map((entry) => `${entry.path}: ${entry.message}`).join("; ")}`);
    this.name = "ScientificAuthorityApprovalError";
    this.validation = validation;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function add(issues: ScientificAuthorityIssueV1[], code: string, path: string, message: string): void {
  issues.push({ code, path, message });
}

function exactFields(record: Record<string, unknown>, fields: readonly string[], path: string, issues: ScientificAuthorityIssueV1[]): void {
  const allowed = new Set(fields);
  for (const field of Object.keys(record)) if (!allowed.has(field)) add(issues, "authority.unknown-field", `${path}.${field}`, "Unknown field.");
  for (const field of fields) if (!Object.hasOwn(record, field)) add(issues, "authority.missing-field", `${path}.${field}`, "Required field is missing.");
}

function nonEmpty(value: unknown, path: string, issues: ScientificAuthorityIssueV1[]): value is string {
  if (typeof value !== "string" || value.trim() === "") {
    add(issues, "authority.string", path, "Expected a non-empty string.");
    return false;
  }
  return true;
}

function sha256(value: unknown, path: string, issues: ScientificAuthorityIssueV1[]): value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    add(issues, "authority.sha256", path, "Expected a lowercase SHA-256 digest.");
    return false;
  }
  return true;
}

function gitCommit(value: unknown, path: string, issues: ScientificAuthorityIssueV1[]): void {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/u.test(value)) add(issues, "authority.git-commit", path, "Expected a 40-character lowercase Git commit.");
}

function utc(value: unknown, path: string, issues: ScientificAuthorityIssueV1[]): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) || Number.isNaN(Date.parse(value))) {
    add(issues, "authority.utc", path, "Expected an exact UTC timestamp.");
  }
}

function finiteNonNegative(value: unknown, path: string, issues: ScientificAuthorityIssueV1[]): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) add(issues, "authority.tolerance", path, "Expected a finite non-negative number.");
}

function validateOracle(
  value: unknown,
  version: "0.2.7" | "0.3.1",
  path: string,
  issues: ScientificAuthorityIssueV1[],
): void {
  if (!isRecord(value)) {
    add(issues, "authority.oracle", path, "Expected an oracle output receipt.");
    return;
  }
  exactFields(value, ["rVersion", "rENAVersion", "containerDigest", "outputSha256"], path, issues);
  nonEmpty(value.rVersion, `${path}.rVersion`, issues);
  if (value.rENAVersion !== version) add(issues, "authority.oracle-version", `${path}.rENAVersion`, `Expected rENA ${version}.`);
  if (typeof value.containerDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value.containerDigest)) add(issues, "authority.container-digest", `${path}.containerDigest`, "Expected a sha256:<digest> container identity.");
  sha256(value.outputSha256, `${path}.outputSha256`, issues);
}

function validateTolerance(
  value: unknown,
  quantity: ScientificQuantityV1,
  path: string,
  issues: ScientificAuthorityIssueV1[],
): void {
  if (!isRecord(value)) {
    add(issues, "authority.tolerance", path, "Expected a quantity-specific tolerance.");
    return;
  }
  if (value.quantity !== quantity) add(issues, "authority.tolerance-quantity", `${path}.quantity`, "Must match the approved quantity.");
  nonEmpty(value.contractId, `${path}.contractId`, issues);
  if (value.kind === "exact") {
    exactFields(value, ["kind", "quantity", "contractId", "absolute", "relative"], path, issues);
    if (value.absolute !== 0 || value.relative !== 0) add(issues, "authority.exact-tolerance", path, "Exact tolerance must set absolute=0 and relative=0.");
  } else if (value.kind === "numeric-absolute-relative") {
    exactFields(value, ["kind", "quantity", "contractId", "absolute", "relative"], path, issues);
    finiteNonNegative(value.absolute, `${path}.absolute`, issues);
    finiteNonNegative(value.relative, `${path}.relative`, issues);
  } else if (value.kind === "degenerate-subspace-projector") {
    exactFields(value, ["kind", "quantity", "contractId", "projectorMaxAbsolute", "projectorFrobenius", "rankTolerance"], path, issues);
    if (quantity !== "ena.rotation-degenerate-subspace") add(issues, "authority.subspace-quantity", `${path}.kind`, "Subspace tolerance is only valid for the degenerate-rotation quantity.");
    finiteNonNegative(value.projectorMaxAbsolute, `${path}.projectorMaxAbsolute`, issues);
    finiteNonNegative(value.projectorFrobenius, `${path}.projectorFrobenius`, issues);
    finiteNonNegative(value.rankTolerance, `${path}.rankTolerance`, issues);
  } else add(issues, "authority.tolerance-kind", `${path}.kind`, "Unsupported tolerance kind.");
}

function validateApproval(value: unknown, path: string, issues: ScientificAuthorityIssueV1[]): ScientificQuantityV1 | null {
  if (!isRecord(value)) {
    add(issues, "authority.approval", path, "Expected an approval receipt.");
    return null;
  }
  const fields = ["schemaVersion", "approvalId", "quantity", "fixtureId", "fixtureSha256", "inputSha256", "mappingSha256", "specSha256", "oracleOutputs", "typescriptOutput", "comparisonReportSha256", "tolerance", "seed", "schemaVersions", "regressionTest", "implementer", "reviewer", "decision"];
  exactFields(value, fields, path, issues);
  if (value.schemaVersion !== SCIENTIFIC_AUTHORITY_APPROVAL_VERSION_V1) add(issues, "authority.schema-version", `${path}.schemaVersion`, `Expected ${SCIENTIFIC_AUTHORITY_APPROVAL_VERSION_V1}.`);
  nonEmpty(value.approvalId, `${path}.approvalId`, issues);
  const quantity = REQUIRED_SCIENTIFIC_QUANTITIES_V1.includes(value.quantity as ScientificQuantityV1) ? value.quantity as ScientificQuantityV1 : null;
  if (!quantity) add(issues, "authority.quantity", `${path}.quantity`, "Unknown scientific quantity.");
  nonEmpty(value.fixtureId, `${path}.fixtureId`, issues);
  for (const field of ["fixtureSha256", "inputSha256", "mappingSha256", "specSha256", "comparisonReportSha256"] as const) sha256(value[field], `${path}.${field}`, issues);
  if (isRecord(value.oracleOutputs)) {
    exactFields(value.oracleOutputs, ["rENA027", "rENA031"], `${path}.oracleOutputs`, issues);
    validateOracle(value.oracleOutputs.rENA027, "0.2.7", `${path}.oracleOutputs.rENA027`, issues);
    validateOracle(value.oracleOutputs.rENA031, "0.3.1", `${path}.oracleOutputs.rENA031`, issues);
  } else add(issues, "authority.oracles", `${path}.oracleOutputs`, "Both rENA oracle output receipts are required.");
  if (isRecord(value.typescriptOutput)) {
    exactFields(value.typescriptOutput, ["package", "packageVersion", "gitCommit", "outputSha256"], `${path}.typescriptOutput`, issues);
    if (value.typescriptOutput.package !== "@3dena/analysis") add(issues, "authority.ts-package", `${path}.typescriptOutput.package`, "Expected @3dena/analysis.");
    nonEmpty(value.typescriptOutput.packageVersion, `${path}.typescriptOutput.packageVersion`, issues);
    gitCommit(value.typescriptOutput.gitCommit, `${path}.typescriptOutput.gitCommit`, issues);
    sha256(value.typescriptOutput.outputSha256, `${path}.typescriptOutput.outputSha256`, issues);
  } else add(issues, "authority.typescript-output", `${path}.typescriptOutput`, "TypeScript output receipt is required.");
  if (quantity) validateTolerance(value.tolerance, quantity, `${path}.tolerance`, issues);
  if (value.seed !== null && (!Number.isSafeInteger(value.seed) || Number(value.seed) < 0 || Number(value.seed) > 0xffff_ffff)) add(issues, "authority.seed", `${path}.seed`, "Expected null or an unsigned 32-bit seed.");
  if (!Array.isArray(value.schemaVersions) || value.schemaVersions.length === 0 || value.schemaVersions.some((entry) => !nonEmpty(entry, `${path}.schemaVersions`, issues)) || new Set(value.schemaVersions).size !== value.schemaVersions.length) add(issues, "authority.schema-versions", `${path}.schemaVersions`, "Expected a non-empty unique schema-version list.");
  nonEmpty(value.regressionTest, `${path}.regressionTest`, issues);
  let implementerId: string | null = null;
  if (isRecord(value.implementer)) {
    exactFields(value.implementer, ["id", "attestedAtUtc"], `${path}.implementer`, issues);
    if (nonEmpty(value.implementer.id, `${path}.implementer.id`, issues)) implementerId = value.implementer.id;
    utc(value.implementer.attestedAtUtc, `${path}.implementer.attestedAtUtc`, issues);
  } else add(issues, "authority.implementer", `${path}.implementer`, "Implementer attestation is required.");
  let reviewerId: string | null = null;
  if (isRecord(value.reviewer)) {
    exactFields(value.reviewer, ["id", "reviewedAtUtc"], `${path}.reviewer`, issues);
    if (nonEmpty(value.reviewer.id, `${path}.reviewer.id`, issues)) reviewerId = value.reviewer.id;
    utc(value.reviewer.reviewedAtUtc, `${path}.reviewer.reviewedAtUtc`, issues);
  } else add(issues, "authority.reviewer", `${path}.reviewer`, "Independent reviewer receipt is required.");
  if (implementerId && reviewerId && implementerId === reviewerId) add(issues, "authority.independence", `${path}.reviewer.id`, "Reviewer must differ from the implementer.");
  if (isRecord(value.decision)) {
    exactFields(value.decision, ["status", "decidedAtUtc", "record", "rationale"], `${path}.decision`, issues);
    if (value.decision.status !== "approved") add(issues, "authority.decision", `${path}.decision.status`, "Release accepts only approved decisions.");
    utc(value.decision.decidedAtUtc, `${path}.decision.decidedAtUtc`, issues);
    nonEmpty(value.decision.record, `${path}.decision.record`, issues);
    nonEmpty(value.decision.rationale, `${path}.decision.rationale`, issues);
  } else add(issues, "authority.decision", `${path}.decision`, "An approved decision record is required.");
  return quantity;
}

export function validateScientificAuthorityMatrixV1(value: unknown): ScientificAuthorityValidationV1 {
  const issues: ScientificAuthorityIssueV1[] = [];
  if (!isRecord(value)) {
    add(issues, "authority.matrix", "matrix", "Expected a scientific authority matrix.");
    return { valid: false, releaseApproved: false, approvedQuantities: [], missingQuantities: [...REQUIRED_SCIENTIFIC_QUANTITIES_V1], issues };
  }
  exactFields(value, ["schemaVersion", "matrixId", "status", "requiredQuantities", "approvals"], "matrix", issues);
  if (value.schemaVersion !== SCIENTIFIC_AUTHORITY_MATRIX_VERSION_V1) add(issues, "authority.schema-version", "matrix.schemaVersion", `Expected ${SCIENTIFIC_AUTHORITY_MATRIX_VERSION_V1}.`);
  nonEmpty(value.matrixId, "matrix.matrixId", issues);
  if (value.status !== "blocked" && value.status !== "release-approved") add(issues, "authority.matrix-status", "matrix.status", "Expected blocked or release-approved.");
  const required = Array.isArray(value.requiredQuantities) ? value.requiredQuantities : [];
  if (JSON.stringify(required) !== JSON.stringify(REQUIRED_SCIENTIFIC_QUANTITIES_V1)) add(issues, "authority.required-quantities", "matrix.requiredQuantities", "Must equal the frozen v1 quantity inventory in exact order.");
  const approved: ScientificQuantityV1[] = [];
  const declared: ScientificQuantityV1[] = [];
  if (!Array.isArray(value.approvals)) add(issues, "authority.approvals", "matrix.approvals", "Expected an approval array.");
  else value.approvals.forEach((approval, index) => {
    const before = issues.length;
    const quantity = validateApproval(approval, `matrix.approvals[${index}]`, issues);
    if (quantity) declared.push(quantity);
    if (quantity && issues.length === before) approved.push(quantity);
  });
  if (new Set(declared).size !== declared.length) add(issues, "authority.duplicate-approval", "matrix.approvals", "Each quantity requires exactly one approval, including invalid or candidate rows.");
  const approvedSet = new Set(approved);
  const missing = REQUIRED_SCIENTIFIC_QUANTITIES_V1.filter((quantity) => !approvedSet.has(quantity));
  if (missing.length > 0) add(issues, "authority.missing-approvals", "matrix.approvals", `Missing ${missing.length} required quantity approvals.`);
  const structurallyComplete = issues.length === 0 && missing.length === 0;
  if (value.status === "release-approved" && !structurallyComplete) add(issues, "authority.false-release-status", "matrix.status", "Cannot be release-approved while any quantity gate is invalid or missing.");
  if (value.status === "blocked" && structurallyComplete) add(issues, "authority.stale-blocked-status", "matrix.status", "A complete approval matrix must explicitly switch to release-approved.");
  const releaseApproved = value.status === "release-approved" && issues.length === 0 && missing.length === 0;
  return { valid: issues.length === 0, releaseApproved, approvedQuantities: approved, missingQuantities: missing, issues };
}

export type ReleaseApprovedScientificAuthorityMatrixV1 = ScientificAuthorityMatrixV1 & {
  status: "release-approved";
};

/** Fail-closed release gate: generated/candidate/open rows are never accepted. */
export function requireApprovedScientificAuthorityV1(value: unknown): ReleaseApprovedScientificAuthorityMatrixV1 {
  const validation = validateScientificAuthorityMatrixV1(value);
  if (!validation.releaseApproved) throw new ScientificAuthorityApprovalError(validation);
  return value as ReleaseApprovedScientificAuthorityMatrixV1;
}
