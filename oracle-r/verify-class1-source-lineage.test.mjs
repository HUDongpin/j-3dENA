import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectClass1SourceLineage } from "./verify-class1-source-lineage.mjs";

const PREPARED_BYTES = Buffer.from("synthetic-prepared-only-rdata");
const PREPARED_SHA256 = "aa444cd2667e7b22d22d35c19237f7885daa13a1d68626d4d976b73b179f6c94";

function artifact(checkoutRole, checkoutDirectory) {
  return {
    checkoutRole,
    checkoutDirectory,
    relativePath: "sample_data/class1_timepoints_enaset.RData",
    byteLength: PREPARED_BYTES.byteLength,
    sha256: PREPARED_SHA256,
    gitBlobSha1: "7270e8ed77776a96099cdba5de6dcfc2e1b7663a",
  };
}

function validReceipt() {
  return {
    schemaVersion: "3dena.class1-source-lineage-investigation.v1",
    investigationId: "class1-lineage-synthetic-test",
    recordedAt: "2026-08-21T13:36:13Z",
    operatorRole: "implementation-operator",
    scope: {
      repositoryUrl: "https://github.com/HUDongpin/3dENA.git",
      repositoryHead: "b9a1a01c3dfd6a598a7e99427a4c77c0060a74c5",
      introductionCommit: "40f0d6d7e2c113de070a08b7c426daaa85ec158b",
      searchMethod: "path-name-and-git-history-only",
      searchedPathPatterns: ["class.?1", "timepoints", "tp1", "tp2", "tp3"],
      candidateExactDataExtensions: ["csv", "tsv", "xls", "xlsx", "json", "rdata", "rds", "rda"],
      pathMatchedFiles: 6,
      candidateDataFiles: 2,
      rawRowValuesReadOrRecorded: false,
      limitations: [
        "Only the named local legacy checkout tree and its Git history were searched.",
        "Private storage, email, cloud drives, unpublished research folders, and external custodians were not searched.",
      ],
    },
    preparedArtifacts: [
      artifact("main", "ENA_3d-main"),
      artifact("static-pages", "ENA_3d-static-pages"),
    ],
    identicalPreparedBytes: true,
    preparation: {
      scriptPath: "tools/prepare_class1_timepoints_sample.R",
      scriptSha256: "a0828a93d2d0aae859f906e796c8af010b2a6bd45acee7d9000d82c6151a359a",
      scriptGitBlobSha1: "db202ed4a78fc5dd5de20b12e2ec8fa7b40d7847",
      documentationPath: "sample_data/README.md",
      documentationSha256: "58e63feccd58bae1c56eed99ec0a2a654b111721a1b7861647f1b319655db366",
      invocationSourceArgument: "INPUT.RData",
      privateSourcePathStored: false,
      inputContract: "exactly-one-ena.set",
      pseudonymizesSpeakerAndCondition: true,
      roundTripsPublicExchange: true,
      discardsRawInputCaches: true,
      outputContainsPreparedEnaTablesOnly: true,
    },
    findings: {
      exactRawCodedRowsLocated: false,
      frozenRawMappingLocated: false,
      rawCustodyReceiptLocated: false,
      independentScientificApprovalLocated: false,
      preparedArtifactEligibleAsRawOracle: false,
      permittedStatus: "PRECOMPUTED_COMPATIBILITY_CANDIDATE",
      class1CustodyGate: "blocked",
      scientificQuantityApproval: { approved: 0, total: 55 },
    },
    requiredNextEvidence: [
      "authorized-exact-raw-coded-row-bytes",
      "canonical-frozen-raw-mapping",
      "four-distinct-custody-actors",
      "ed25519-custody-attestation",
      "three-raw-oracle-artifacts",
      "55-independent-quantity-approvals",
    ],
  };
}

function createLegacyRoot() {
  const root = mkdtempSync(join(tmpdir(), "3dena-class1-lineage-"));
  for (const checkout of ["ENA_3d-main", "ENA_3d-static-pages"]) {
    const directory = join(root, checkout, "sample_data");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "class1_timepoints_enaset.RData"), PREPARED_BYTES);
  }
  return root;
}

test("accepts a bounded prepared-only investigation and verifies both local copies", () => {
  const receipt = validReceipt();
  const result = inspectClass1SourceLineage(receipt, { legacyRoot: createLegacyRoot() });
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
  assert.equal(result.evidence.localFilesVerified, true);
  assert.equal(result.evidence.exactRawCodedRowsLocated, false);
  assert.equal(result.evidence.approvedScientificQuantities, 0);
  assert.equal(result.evidence.totalScientificQuantities, 55);
});

test("rejects attempts to promote the prepared artifact or scientific quantities", () => {
  const receipt = validReceipt();
  receipt.findings.exactRawCodedRowsLocated = true;
  receipt.findings.preparedArtifactEligibleAsRawOracle = true;
  receipt.findings.permittedStatus = "VERIFIED_PARITY";
  receipt.findings.class1CustodyGate = "approved";
  receipt.findings.scientificQuantityApproval.approved = 55;
  const result = inspectClass1SourceLineage(receipt);
  assert.equal(result.ok, false);
  const rules = new Set(result.findings.map(({ rule }) => rule));
  assert.ok(rules.has("false-closure"));
  assert.ok(rules.has("status-overclaim"));
  assert.ok(rules.has("custody-overclaim"));
  assert.ok(rules.has("scientific-approval-overclaim"));
});

test("rejects local byte drift and path traversal", () => {
  const receipt = validReceipt();
  const root = createLegacyRoot();
  writeFileSync(
    join(root, "ENA_3d-static-pages", "sample_data", "class1_timepoints_enaset.RData"),
    Buffer.concat([PREPARED_BYTES, Buffer.from("drift")]),
  );
  receipt.preparedArtifacts[0].relativePath = "../outside.RData";
  const result = inspectClass1SourceLineage(receipt, { legacyRoot: root });
  assert.equal(result.ok, false);
  const rules = new Set(result.findings.map(({ rule }) => rule));
  assert.ok(rules.has("artifact-path"));
  assert.ok(rules.has("local-artifact-unavailable"));
  assert.ok(rules.has("local-size-mismatch"));
  assert.ok(rules.has("local-hash-mismatch"));
});
