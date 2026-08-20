export const STRICT_CAPABILITY_ENTRY_VERSION_V1 = "3dena.strict-capability-entry.v1" as const;
export const STRICT_CAPABILITY_LEDGER_VERSION_V1 = "3dena.strict-capability-ledger.v1" as const;

export const REQUIRED_STRICT_CAPABILITIES_V1 = Object.freeze([
  "DATA-001",
  "DATA-002",
  "DATA-003",
  "DATA-004",
  "DATA-005",
  "ID-001",
  "ENA-001",
  "ENA-002",
  "ENA-003",
  "ENA-004",
  "ENA-005",
  "ENA-006",
  "ENA-007",
  "ENA-008",
  "VIEW-001",
  "VIEW-002",
  "VIEW-003",
  "VIEW-004",
  "STAT-001",
  "STAT-002",
  "TRAJ-001",
  "TRAJ-002",
  "TRAJ-003",
  "TRAJ-004",
  "BOOT-001",
  "BOOT-002",
  "PLOT-001",
  "PLOT-002",
  "EXP-001",
  "LIFE-001",
  "LIFE-002",
  "SERVICE-001",
  "SERVICE-002",
  "SERVICE-003",
  "ROUTE-001",
  "A11Y-001",
  "SDK-001",
  "TOOL-001",
  "ORACLE-001",
  "AI-001",
  "REL-001",
] as const);

export type StrictCapabilityIdV1 = typeof REQUIRED_STRICT_CAPABILITIES_V1[number];
export type StrictCapabilityDispositionV1 = "verified" | "frozen" | "owner-approved-retirement";

export interface StrictCapabilityEntryV1 {
  schemaVersion: typeof STRICT_CAPABILITY_ENTRY_VERSION_V1;
  capabilityId: StrictCapabilityIdV1;
  disposition: StrictCapabilityDispositionV1;
  immutableEvidence: {
    evidenceId: string;
    scope: "fixture" | "feature" | "build" | "deployment" | "compatibility-artifact" | "retirement-record";
    artifactSha256: string;
    gitCommit: string;
    schemaVersion: string;
  };
  approval: {
    approvalId: string;
    approvalRecordSha256: string;
    decision: "approved";
    implementerId: string;
    approverId: string;
    approverRole: "independent-reviewer" | "owner";
    approvedAtUtc: string;
  };
}

export interface StrictCapabilityLedgerV1 {
  schemaVersion: typeof STRICT_CAPABILITY_LEDGER_VERSION_V1;
  ledgerId: string;
  status: "blocked" | "verified-parity";
  requiredCapabilities: StrictCapabilityIdV1[];
  entries: StrictCapabilityEntryV1[];
}

export interface StrictCapabilityLedgerIssueV1 {
  code: string;
  path: string;
  message: string;
}

export interface StrictCapabilityLedgerValidationV1 {
  valid: boolean;
  verifiedParity: boolean;
  closedCapabilities: StrictCapabilityIdV1[];
  missingCapabilities: StrictCapabilityIdV1[];
  issues: StrictCapabilityLedgerIssueV1[];
}

export class StrictCapabilityLedgerError extends Error {
  readonly validation: StrictCapabilityLedgerValidationV1;

  constructor(validation: StrictCapabilityLedgerValidationV1) {
    super(`Strict capability ledger is not VERIFIED_PARITY: ${validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
    this.name = "StrictCapabilityLedgerError";
    this.validation = validation;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function add(issues: StrictCapabilityLedgerIssueV1[], code: string, path: string, message: string): void {
  issues.push({ code, path, message });
}

function exactFields(record: Record<string, unknown>, fields: readonly string[], path: string, issues: StrictCapabilityLedgerIssueV1[]): void {
  const allowed = new Set(fields);
  for (const field of Object.keys(record)) if (!allowed.has(field)) add(issues, "capability.unknown-field", `${path}.${field}`, "Unknown field.");
  for (const field of fields) if (!Object.hasOwn(record, field)) add(issues, "capability.missing-field", `${path}.${field}`, "Required field is missing.");
}

function nonEmpty(value: unknown, path: string, issues: StrictCapabilityLedgerIssueV1[]): value is string {
  if (typeof value !== "string" || value.trim() === "") {
    add(issues, "capability.string", path, "Expected a non-empty string.");
    return false;
  }
  return true;
}

function sha256(value: unknown, path: string, issues: StrictCapabilityLedgerIssueV1[]): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) add(issues, "capability.sha256", path, "Expected a lowercase SHA-256 digest.");
}

function gitCommit(value: unknown, path: string, issues: StrictCapabilityLedgerIssueV1[]): void {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/u.test(value)) add(issues, "capability.git-commit", path, "Expected an exact lowercase Git commit.");
}

function utc(value: unknown, path: string, issues: StrictCapabilityLedgerIssueV1[]): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) || Number.isNaN(Date.parse(value))) {
    add(issues, "capability.utc", path, "Expected an exact UTC timestamp.");
  }
}

function validateEntry(value: unknown, path: string, issues: StrictCapabilityLedgerIssueV1[]): StrictCapabilityIdV1 | null {
  if (!isRecord(value)) {
    add(issues, "capability.entry", path, "Expected a capability closure entry.");
    return null;
  }
  exactFields(value, ["schemaVersion", "capabilityId", "disposition", "immutableEvidence", "approval"], path, issues);
  if (value.schemaVersion !== STRICT_CAPABILITY_ENTRY_VERSION_V1) add(issues, "capability.schema-version", `${path}.schemaVersion`, `Expected ${STRICT_CAPABILITY_ENTRY_VERSION_V1}.`);
  const capabilityId = REQUIRED_STRICT_CAPABILITIES_V1.includes(value.capabilityId as StrictCapabilityIdV1)
    ? value.capabilityId as StrictCapabilityIdV1
    : null;
  if (!capabilityId) add(issues, "capability.id", `${path}.capabilityId`, "Unknown capability ID.");
  const disposition = value.disposition;
  if (disposition !== "verified" && disposition !== "frozen" && disposition !== "owner-approved-retirement") {
    add(issues, "capability.disposition", `${path}.disposition`, "Only verified, frozen, or owner-approved-retirement closes a capability.");
  }

  if (isRecord(value.immutableEvidence)) {
    const evidence = value.immutableEvidence;
    exactFields(evidence, ["evidenceId", "scope", "artifactSha256", "gitCommit", "schemaVersion"], `${path}.immutableEvidence`, issues);
    nonEmpty(evidence.evidenceId, `${path}.immutableEvidence.evidenceId`, issues);
    if (!(evidence.scope === "fixture" || evidence.scope === "feature" || evidence.scope === "build" || evidence.scope === "deployment" || evidence.scope === "compatibility-artifact" || evidence.scope === "retirement-record")) {
      add(issues, "capability.evidence-scope", `${path}.immutableEvidence.scope`, "Unsupported immutable evidence scope.");
    }
    sha256(evidence.artifactSha256, `${path}.immutableEvidence.artifactSha256`, issues);
    gitCommit(evidence.gitCommit, `${path}.immutableEvidence.gitCommit`, issues);
    nonEmpty(evidence.schemaVersion, `${path}.immutableEvidence.schemaVersion`, issues);
    if (disposition === "frozen" && evidence.scope !== "compatibility-artifact") add(issues, "capability.frozen-evidence", `${path}.immutableEvidence.scope`, "Frozen disposition requires a compatibility-artifact receipt.");
    if (disposition === "owner-approved-retirement" && evidence.scope !== "retirement-record") add(issues, "capability.retirement-evidence", `${path}.immutableEvidence.scope`, "Retirement requires an immutable retirement record.");
  } else add(issues, "capability.evidence", `${path}.immutableEvidence`, "Immutable evidence is required.");

  if (isRecord(value.approval)) {
    const approval = value.approval;
    exactFields(approval, ["approvalId", "approvalRecordSha256", "decision", "implementerId", "approverId", "approverRole", "approvedAtUtc"], `${path}.approval`, issues);
    nonEmpty(approval.approvalId, `${path}.approval.approvalId`, issues);
    sha256(approval.approvalRecordSha256, `${path}.approval.approvalRecordSha256`, issues);
    if (approval.decision !== "approved") add(issues, "capability.approval-decision", `${path}.approval.decision`, "Pending, open, generated, candidate, and unverified decisions are not approvals.");
    const implementerValid = nonEmpty(approval.implementerId, `${path}.approval.implementerId`, issues);
    const approverValid = nonEmpty(approval.approverId, `${path}.approval.approverId`, issues);
    if (implementerValid && approverValid && approval.implementerId === approval.approverId) add(issues, "capability.independence", `${path}.approval.approverId`, "Approver must differ from the implementer.");
    if (approval.approverRole !== "independent-reviewer" && approval.approverRole !== "owner") add(issues, "capability.approver-role", `${path}.approval.approverRole`, "Unsupported approver role.");
    if (disposition === "owner-approved-retirement" && approval.approverRole !== "owner") add(issues, "capability.retirement-approval", `${path}.approval.approverRole`, "Retirement requires Owner approval.");
    if ((disposition === "verified" || disposition === "frozen") && approval.approverRole !== "independent-reviewer") add(issues, "capability.independent-approval", `${path}.approval.approverRole`, "Verified and frozen dispositions require independent review.");
    utc(approval.approvedAtUtc, `${path}.approval.approvedAtUtc`, issues);
  } else add(issues, "capability.approval", `${path}.approval`, "Immutable approval is required.");
  return capabilityId;
}

export function validateStrictCapabilityLedgerV1(value: unknown): StrictCapabilityLedgerValidationV1 {
  const issues: StrictCapabilityLedgerIssueV1[] = [];
  if (!isRecord(value)) {
    add(issues, "capability.ledger", "ledger", "Expected a strict capability ledger.");
    return { valid: false, verifiedParity: false, closedCapabilities: [], missingCapabilities: [...REQUIRED_STRICT_CAPABILITIES_V1], issues };
  }
  exactFields(value, ["schemaVersion", "ledgerId", "status", "requiredCapabilities", "entries"], "ledger", issues);
  if (value.schemaVersion !== STRICT_CAPABILITY_LEDGER_VERSION_V1) add(issues, "capability.schema-version", "ledger.schemaVersion", `Expected ${STRICT_CAPABILITY_LEDGER_VERSION_V1}.`);
  nonEmpty(value.ledgerId, "ledger.ledgerId", issues);
  if (value.status !== "blocked" && value.status !== "verified-parity") add(issues, "capability.ledger-status", "ledger.status", "Expected blocked or verified-parity.");
  const required = Array.isArray(value.requiredCapabilities) ? value.requiredCapabilities : [];
  if (JSON.stringify(required) !== JSON.stringify(REQUIRED_STRICT_CAPABILITIES_V1)) add(issues, "capability.required-inventory", "ledger.requiredCapabilities", "Must equal the frozen strict capability inventory in exact order.");
  const declared: StrictCapabilityIdV1[] = [];
  const closed: StrictCapabilityIdV1[] = [];
  if (!Array.isArray(value.entries)) add(issues, "capability.entries", "ledger.entries", "Expected a capability entry array.");
  else value.entries.forEach((entry, index) => {
    const before = issues.length;
    const capabilityId = validateEntry(entry, `ledger.entries[${index}]`, issues);
    if (capabilityId) declared.push(capabilityId);
    if (capabilityId && issues.length === before) closed.push(capabilityId);
  });
  if (new Set(declared).size !== declared.length) add(issues, "capability.duplicate-entry", "ledger.entries", "Each capability requires exactly one closure entry, including invalid rows.");
  const closedSet = new Set(closed);
  const missing = REQUIRED_STRICT_CAPABILITIES_V1.filter((capabilityId) => !closedSet.has(capabilityId));
  if (missing.length > 0) add(issues, "capability.missing-entries", "ledger.entries", `Missing ${missing.length} required capability closures.`);
  const structurallyComplete = issues.length === 0 && missing.length === 0;
  if (value.status === "verified-parity" && !structurallyComplete) add(issues, "capability.false-verified-parity", "ledger.status", "Cannot claim VERIFIED_PARITY while any capability is invalid or missing.");
  if (value.status === "blocked" && structurallyComplete) add(issues, "capability.stale-blocked-status", "ledger.status", "A complete ledger must explicitly switch to verified-parity.");
  const verifiedParity = value.status === "verified-parity" && issues.length === 0 && missing.length === 0;
  return { valid: issues.length === 0, verifiedParity, closedCapabilities: closed, missingCapabilities: missing, issues };
}

export type VerifiedParityCapabilityLedgerV1 = StrictCapabilityLedgerV1 & { status: "verified-parity" };

/** Fail-closed gate: implemented, generated, candidate, pending, or open rows never satisfy VERIFIED_PARITY. */
export function requireVerifiedParityCapabilityLedgerV1(value: unknown): VerifiedParityCapabilityLedgerV1 {
  const validation = validateStrictCapabilityLedgerV1(value);
  if (!validation.verifiedParity) throw new StrictCapabilityLedgerError(validation);
  return value as VerifiedParityCapabilityLedgerV1;
}
