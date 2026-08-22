import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  REQUIRED_STRICT_CAPABILITIES_V1,
  STRICT_CAPABILITY_ENTRY_VERSION_V1,
  STRICT_CAPABILITY_LEDGER_VERSION_V1,
  StrictCapabilityLedgerError,
  requireVerifiedParityCapabilityLedgerV1,
  validateStrictCapabilityLedgerV1,
  type StrictCapabilityEntryV1,
  type StrictCapabilityIdV1,
  type StrictCapabilityLedgerV1,
} from "./strict-capability-ledger";

const H = (character: string) => character.repeat(64);

function entry(capabilityId: StrictCapabilityIdV1, index: number): StrictCapabilityEntryV1 {
  const disposition = capabilityId === "ORACLE-001"
    ? "frozen"
    : capabilityId === "DATA-004" || capabilityId === "BOOT-002"
      ? "owner-approved-retirement"
      : "verified";
  return {
    schemaVersion: STRICT_CAPABILITY_ENTRY_VERSION_V1,
    capabilityId,
    disposition,
    immutableEvidence: {
      evidenceId: `synthetic-${index}`,
      scope: disposition === "frozen" ? "compatibility-artifact" : disposition === "owner-approved-retirement" ? "retirement-record" : "feature",
      artifactSha256: H("a"),
      gitCommit: "b".repeat(40),
      schemaVersion: "synthetic.capability-evidence.v1",
    },
    approval: {
      approvalId: `synthetic-approval-${index}`,
      approvalRecordSha256: H("c"),
      decision: "approved",
      implementerId: "implementation-agent",
      approverId: disposition === "owner-approved-retirement" ? "product-owner" : "independent-reviewer",
      approverRole: disposition === "owner-approved-retirement" ? "owner" : "independent-reviewer",
      approvedAtUtc: "2026-08-21T02:00:00Z",
    },
  };
}

function completeLedger(): StrictCapabilityLedgerV1 {
  return {
    schemaVersion: STRICT_CAPABILITY_LEDGER_VERSION_V1,
    ledgerId: "synthetic-complete-ledger-test-only",
    status: "verified-parity",
    requiredCapabilities: [...REQUIRED_STRICT_CAPABILITIES_V1],
    entries: REQUIRED_STRICT_CAPABILITIES_V1.map(entry),
  };
}

describe("strict whole-repository capability ledger gate", () => {
  it("keeps the tracked 41-capability ledger honestly blocked", () => {
    expect(REQUIRED_STRICT_CAPABILITIES_V1).toHaveLength(41);
    expect(new Set(REQUIRED_STRICT_CAPABILITIES_V1).size).toBe(41);
    const tracked = JSON.parse(readFileSync(new URL("../strict-capability-ledger.v1.json", import.meta.url), "utf8"));
    const validation = validateStrictCapabilityLedgerV1(tracked);
    expect(validation.verifiedParity).toBe(false);
    expect(validation.missingCapabilities).toEqual(REQUIRED_STRICT_CAPABILITIES_V1);
    expect(validation.issues.map((issue) => issue.code)).toContain("capability.missing-entries");
    expect(() => requireVerifiedParityCapabilityLedgerV1(tracked)).toThrow(StrictCapabilityLedgerError);
  });

  it("accepts only a complete synthetic contract-test matrix", () => {
    const ledger = completeLedger();
    expect(validateStrictCapabilityLedgerV1(ledger)).toMatchObject({ valid: true, verifiedParity: true, missingCapabilities: [] });
    expect(requireVerifiedParityCapabilityLedgerV1(ledger)).toBe(ledger);
  });

  it("rejects candidate rows, mutable evidence, self-approval, and retirement without Owner approval", () => {
    const ledger = completeLedger();
    (ledger.entries[0] as unknown as { disposition: string }).disposition = "candidate";
    ledger.entries[1]!.immutableEvidence.artifactSha256 = "generated";
    ledger.entries[2]!.approval.approverId = ledger.entries[2]!.approval.implementerId;
    const retirement = ledger.entries.find((candidate) => candidate.disposition === "owner-approved-retirement")!;
    retirement.approval.approverRole = "independent-reviewer";
    const validation = validateStrictCapabilityLedgerV1(ledger);
    expect(validation.verifiedParity).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "capability.disposition",
      "capability.sha256",
      "capability.independence",
      "capability.retirement-approval",
      "capability.false-verified-parity",
    ]));
  });

  it("detects duplicate capability rows even when the duplicated row is otherwise invalid", () => {
    const ledger = completeLedger();
    ledger.entries.pop();
    ledger.entries.push(structuredClone(ledger.entries[0]!));
    (ledger.entries[0] as unknown as Record<string, unknown>).unknown = true;
    const validation = validateStrictCapabilityLedgerV1(ledger);
    expect(validation.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "capability.unknown-field",
      "capability.duplicate-entry",
      "capability.missing-entries",
    ]));
  });
});
