import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  REQUIRED_SCIENTIFIC_QUANTITIES_V1,
  SCIENTIFIC_AUTHORITY_APPROVAL_VERSION_V1,
  SCIENTIFIC_AUTHORITY_MATRIX_VERSION_V1,
  ScientificAuthorityApprovalError,
  requireApprovedScientificAuthorityV1,
  validateScientificAuthorityMatrixV1,
  type ScientificAuthorityApprovalV1,
  type ScientificAuthorityMatrixV1,
  type ScientificQuantityV1,
} from "./scientific-authority";

const H = (character: string) => character.repeat(64);

function approval(quantity: ScientificQuantityV1, index: number): ScientificAuthorityApprovalV1 {
  return {
    schemaVersion: SCIENTIFIC_AUTHORITY_APPROVAL_VERSION_V1,
    approvalId: `synthetic-${index}`,
    quantity,
    fixtureId: "synthetic-governance-test-only",
    fixtureSha256: H("1"),
    inputSha256: H("2"),
    mappingSha256: H("3"),
    specSha256: H("4"),
    oracleOutputs: {
      rENA027: { rVersion: "4.4.1", rENAVersion: "0.2.7", containerDigest: `sha256:${H("5")}`, outputSha256: H("6") },
      rENA031: { rVersion: "4.4.1", rENAVersion: "0.3.1", containerDigest: `sha256:${H("7")}`, outputSha256: H("8") },
    },
    typescriptOutput: { package: "@3dena/analysis", packageVersion: "0.1.0-test", gitCommit: "9".repeat(40), outputSha256: H("a") },
    comparisonReportSha256: H("b"),
    tolerance: quantity === "ena.rotation-degenerate-subspace"
      ? { kind: "degenerate-subspace-projector", quantity, contractId: `test-${quantity}`, projectorMaxAbsolute: 1e-8, projectorFrobenius: 1e-7, rankTolerance: 1e-10 }
      : { kind: "numeric-absolute-relative", quantity, contractId: `test-${quantity}`, absolute: 1e-10, relative: 1e-9 },
    seed: quantity === "bootstrap.successor-prng" || quantity === "bootstrap.seed-receipt" ? 2026 : null,
    schemaVersions: ["test.fixture.v1", "test.output.v1"],
    regressionTest: `synthetic:${quantity}`,
    implementer: { id: "implementation-agent", attestedAtUtc: "2026-08-21T00:00:00Z" },
    reviewer: { id: "independent-scientist", reviewedAtUtc: "2026-08-21T01:00:00Z" },
    decision: { status: "approved", decidedAtUtc: "2026-08-21T02:00:00Z", record: `reviews/${quantity}.md`, rationale: "Synthetic gate test only; not tracked production approval." },
  };
}

function completeMatrix(): ScientificAuthorityMatrixV1 {
  return {
    schemaVersion: SCIENTIFIC_AUTHORITY_MATRIX_VERSION_V1,
    matrixId: "synthetic-complete-gate-test",
    status: "release-approved",
    requiredQuantities: [...REQUIRED_SCIENTIFIC_QUANTITIES_V1],
    approvals: REQUIRED_SCIENTIFIC_QUANTITIES_V1.map(approval),
  };
}

describe("scientific authority approval gate", () => {
  it("freezes every scientific decision as an independently approvable quantity", () => {
    expect(REQUIRED_SCIENTIFIC_QUANTITIES_V1).toHaveLength(55);
    expect(REQUIRED_SCIENTIFIC_QUANTITIES_V1).toEqual(expect.arrayContaining([
      "ena.row-contract",
      "ena.column-contract",
      "ena.order-contract",
      "ena.schema-contract",
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
      "bootstrap.strata",
      "bootstrap.fixed-resample-plan",
      "bootstrap.successor-prng",
      "bootstrap.seed-receipt",
      "bootstrap.quantile-type7",
      "bootstrap.interval-family",
      "bootstrap.rotation-fixed-refit-policy",
    ]));
    expect(new Set(REQUIRED_SCIENTIFIC_QUANTITIES_V1).size).toBe(REQUIRED_SCIENTIFIC_QUANTITIES_V1.length);
  });

  it("keeps the tracked matrix blocked until real per-quantity receipts exist", () => {
    const tracked = JSON.parse(readFileSync(new URL("../scientific-authority.matrix.v1.json", import.meta.url), "utf8"));
    const validation = validateScientificAuthorityMatrixV1(tracked);
    expect(validation.releaseApproved).toBe(false);
    expect(validation.missingQuantities).toEqual(REQUIRED_SCIENTIFIC_QUANTITIES_V1);
    expect(validation.issues.map((entry) => entry.code)).toContain("authority.missing-approvals");
    expect(() => requireApprovedScientificAuthorityV1(tracked)).toThrow(ScientificAuthorityApprovalError);
  });

  it("requires both oracle hashes, a TS hash, quantity tolerance, and independent review", () => {
    const matrix = completeMatrix();
    matrix.approvals[0]!.reviewer.id = matrix.approvals[0]!.implementer.id;
    delete (matrix.approvals[1]!.oracleOutputs as unknown as Record<string, unknown>).rENA031;
    (matrix.approvals[2]!.tolerance as { quantity: ScientificQuantityV1 }).quantity = "ena.nodes";
    const validation = validateScientificAuthorityMatrixV1(matrix);
    expect(validation.releaseApproved).toBe(false);
    expect(validation.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "authority.independence",
      "authority.missing-field",
      "authority.oracle",
      "authority.tolerance-quantity",
      "authority.false-release-status",
    ]));
  });

  it("returns only a complete, exact-inventory, independently reviewed approved matrix", () => {
    const matrix = completeMatrix();
    const validation = validateScientificAuthorityMatrixV1(matrix);
    expect(validation).toMatchObject({ valid: true, releaseApproved: true, missingQuantities: [] });
    expect(requireApprovedScientificAuthorityV1(matrix)).toBe(matrix);
  });

  it("rejects status flips, duplicate quantities, unknown fields, and candidate decisions", () => {
    const matrix = completeMatrix();
    matrix.approvals.pop();
    matrix.approvals.push(structuredClone(matrix.approvals[0]!));
    (matrix.approvals[0] as unknown as Record<string, unknown>).unknown = true;
    (matrix.approvals[1]!.decision as unknown as { status: string }).status = "candidate";
    const validation = validateScientificAuthorityMatrixV1(matrix);
    expect(validation.releaseApproved).toBe(false);
    expect(validation.issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "authority.unknown-field",
      "authority.decision",
      "authority.duplicate-approval",
      "authority.missing-approvals",
    ]));
  });
});
