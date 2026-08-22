#!/usr/bin/env node

/**
 * Verify the non-sensitive Class 1 source-lineage investigation receipt.
 *
 * This is deliberately not a raw-custody verifier. A successful result proves
 * only that the recorded legacy artifacts are prepared-only and that the raw
 * custody/scientific gates remain fail-closed. With --legacy-root it also
 * rehashes the two prepared RData files without printing their bytes.
 */

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SHA256 = /^[0-9a-f]{64}$/u;
const SHA1 = /^[0-9a-f]{40}$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const EXPECTED_ROLES = ["main", "static-pages"];
const EXPECTED_REQUIRED_EVIDENCE = [
  "authorized-exact-raw-coded-row-bytes",
  "canonical-frozen-raw-mapping",
  "four-distinct-custody-actors",
  "ed25519-custody-attestation",
  "three-raw-oracle-artifacts",
  "55-independent-quantity-approvals",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finding(rule, path, detail) {
  return Object.freeze({ rule, path, detail });
}

function exactKeys(value, expected, path, findings) {
  if (!isRecord(value)) {
    findings.push(finding("invalid-object", path, "Expected an object."));
    return false;
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    findings.push(
      finding(
        "contract-fields",
        path,
        "Missing or unknown fields are rejected by the investigation contract.",
      ),
    );
    return false;
  }
  return true;
}

function safeRelativePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !isAbsolute(value) &&
    !value.split(/[\\/]/u).includes("..")
  );
}

function validateReceiptShape(receipt, findings) {
  if (
    !exactKeys(
      receipt,
      [
        "schemaVersion",
        "investigationId",
        "recordedAt",
        "operatorRole",
        "scope",
        "preparedArtifacts",
        "identicalPreparedBytes",
        "preparation",
        "findings",
        "requiredNextEvidence",
      ],
      "receipt",
      findings,
    )
  ) {
    return;
  }

  if (receipt.schemaVersion !== "3dena.class1-source-lineage-investigation.v1") {
    findings.push(finding("receipt-schema", "receipt.schemaVersion", "Unsupported receipt schema."));
  }
  if (
    typeof receipt.investigationId !== "string" ||
    !/^class1-lineage-[a-z0-9-]{8,80}$/u.test(receipt.investigationId)
  ) {
    findings.push(finding("investigation-id", "receipt.investigationId", "Malformed investigation ID."));
  }
  if (!UTC_TIMESTAMP.test(receipt.recordedAt)) {
    findings.push(finding("recorded-at", "receipt.recordedAt", "Expected a UTC timestamp."));
  }
  if (receipt.operatorRole !== "implementation-operator") {
    findings.push(
      finding(
        "operator-role",
        "receipt.operatorRole",
        "This receipt is an implementation-operator investigation, not an independent approval.",
      ),
    );
  }

  if (
    exactKeys(
      receipt.scope,
      [
        "repositoryUrl",
        "repositoryHead",
        "introductionCommit",
        "searchMethod",
        "searchedPathPatterns",
        "candidateExactDataExtensions",
        "pathMatchedFiles",
        "candidateDataFiles",
        "rawRowValuesReadOrRecorded",
        "limitations",
      ],
      "receipt.scope",
      findings,
    )
  ) {
    if (receipt.scope.repositoryUrl !== "https://github.com/HUDongpin/3dENA.git") {
      findings.push(finding("repository-url", "receipt.scope.repositoryUrl", "Unexpected legacy repository."));
    }
    if (!SHA1.test(receipt.scope.repositoryHead) || !SHA1.test(receipt.scope.introductionCommit)) {
      findings.push(finding("repository-commit", "receipt.scope", "Concrete legacy commit identities are required."));
    }
    if (receipt.scope.searchMethod !== "path-name-and-git-history-only") {
      findings.push(finding("search-method", "receipt.scope.searchMethod", "Search method drifted."));
    }
    for (const [field, minimum] of [
      ["pathMatchedFiles", 2],
      ["candidateDataFiles", 2],
    ]) {
      if (!Number.isSafeInteger(receipt.scope[field]) || receipt.scope[field] < minimum) {
        findings.push(finding("search-count", `receipt.scope.${field}`, "Expected a bounded positive file count."));
      }
    }
    if (receipt.scope.rawRowValuesReadOrRecorded !== false) {
      findings.push(finding("raw-value-boundary", "receipt.scope.rawRowValuesReadOrRecorded", "Raw row values must not enter this receipt."));
    }
    if (!Array.isArray(receipt.scope.searchedPathPatterns) || receipt.scope.searchedPathPatterns.length === 0) {
      findings.push(finding("search-patterns", "receipt.scope.searchedPathPatterns", "Search patterns are required."));
    }
    if (!Array.isArray(receipt.scope.candidateExactDataExtensions) || receipt.scope.candidateExactDataExtensions.length === 0) {
      findings.push(finding("candidate-extensions", "receipt.scope.candidateExactDataExtensions", "Candidate data extensions are required."));
    }
    if (!Array.isArray(receipt.scope.limitations) || receipt.scope.limitations.length < 2) {
      findings.push(finding("search-limitations", "receipt.scope.limitations", "The bounded investigation limitations must be explicit."));
    }
  }

  if (!Array.isArray(receipt.preparedArtifacts) || receipt.preparedArtifacts.length !== 2) {
    findings.push(finding("prepared-artifact-count", "receipt.preparedArtifacts", "Exactly two legacy prepared copies are expected."));
  } else {
    const roles = [];
    for (const [index, artifact] of receipt.preparedArtifacts.entries()) {
      const path = `receipt.preparedArtifacts[${index}]`;
      if (!exactKeys(artifact, ["checkoutRole", "checkoutDirectory", "relativePath", "byteLength", "sha256", "gitBlobSha1"], path, findings)) {
        continue;
      }
      roles.push(artifact.checkoutRole);
      if (!EXPECTED_ROLES.includes(artifact.checkoutRole)) {
        findings.push(finding("checkout-role", `${path}.checkoutRole`, "Unknown legacy checkout role."));
      }
      if (!safeRelativePath(artifact.checkoutDirectory) || !safeRelativePath(artifact.relativePath)) {
        findings.push(finding("artifact-path", path, "Only safe repository-relative paths are allowed."));
      }
      if (!Number.isSafeInteger(artifact.byteLength) || artifact.byteLength <= 0) {
        findings.push(finding("artifact-size", `${path}.byteLength`, "Expected a positive exact byte length."));
      }
      if (!SHA256.test(artifact.sha256) || !SHA1.test(artifact.gitBlobSha1)) {
        findings.push(finding("artifact-identity", path, "Exact SHA-256 and Git blob SHA-1 are required."));
      }
    }
    if (JSON.stringify([...roles].sort()) !== JSON.stringify([...EXPECTED_ROLES].sort())) {
      findings.push(finding("checkout-roles", "receipt.preparedArtifacts", "Both main and static-pages copies are required."));
    }
    const identities = new Set(
      receipt.preparedArtifacts.map(({ byteLength, sha256, gitBlobSha1 }) =>
        `${byteLength}:${sha256}:${gitBlobSha1}`,
      ),
    );
    if (receipt.identicalPreparedBytes !== true || identities.size !== 1) {
      findings.push(finding("prepared-copy-drift", "receipt.preparedArtifacts", "Both prepared copies must be byte-identical."));
    }
    if (receipt.scope?.candidateDataFiles !== receipt.preparedArtifacts.length) {
      findings.push(finding("candidate-count-drift", "receipt.scope.candidateDataFiles", "Candidate file count does not match the receipt inventory."));
    }
  }

  if (
    exactKeys(
      receipt.preparation,
      [
        "scriptPath",
        "scriptSha256",
        "scriptGitBlobSha1",
        "documentationPath",
        "documentationSha256",
        "invocationSourceArgument",
        "privateSourcePathStored",
        "inputContract",
        "pseudonymizesSpeakerAndCondition",
        "roundTripsPublicExchange",
        "discardsRawInputCaches",
        "outputContainsPreparedEnaTablesOnly",
      ],
      "receipt.preparation",
      findings,
    )
  ) {
    if (!safeRelativePath(receipt.preparation.scriptPath) || !safeRelativePath(receipt.preparation.documentationPath)) {
      findings.push(finding("preparation-path", "receipt.preparation", "Preparation paths must be repository-relative."));
    }
    if (!SHA256.test(receipt.preparation.scriptSha256) || !SHA256.test(receipt.preparation.documentationSha256) || !SHA1.test(receipt.preparation.scriptGitBlobSha1)) {
      findings.push(finding("preparation-identity", "receipt.preparation", "Preparation file identities are malformed."));
    }
    const exactExpectations = {
      invocationSourceArgument: "INPUT.RData",
      privateSourcePathStored: false,
      inputContract: "exactly-one-ena.set",
      pseudonymizesSpeakerAndCondition: true,
      roundTripsPublicExchange: true,
      discardsRawInputCaches: true,
      outputContainsPreparedEnaTablesOnly: true,
    };
    for (const [field, expected] of Object.entries(exactExpectations)) {
      if (receipt.preparation[field] !== expected) {
        findings.push(finding("preparation-semantics", `receipt.preparation.${field}`, `Expected ${JSON.stringify(expected)}.`));
      }
    }
  }

  if (
    exactKeys(
      receipt.findings,
      [
        "exactRawCodedRowsLocated",
        "frozenRawMappingLocated",
        "rawCustodyReceiptLocated",
        "independentScientificApprovalLocated",
        "preparedArtifactEligibleAsRawOracle",
        "permittedStatus",
        "class1CustodyGate",
        "scientificQuantityApproval",
      ],
      "receipt.findings",
      findings,
    )
  ) {
    for (const field of [
      "exactRawCodedRowsLocated",
      "frozenRawMappingLocated",
      "rawCustodyReceiptLocated",
      "independentScientificApprovalLocated",
      "preparedArtifactEligibleAsRawOracle",
    ]) {
      if (receipt.findings[field] !== false) {
        findings.push(finding("false-closure", `receipt.findings.${field}`, "The bounded investigation does not close this gate."));
      }
    }
    if (receipt.findings.permittedStatus !== "PRECOMPUTED_COMPATIBILITY_CANDIDATE") {
      findings.push(finding("status-overclaim", "receipt.findings.permittedStatus", "Prepared evidence cannot claim raw parity."));
    }
    if (receipt.findings.class1CustodyGate !== "blocked") {
      findings.push(finding("custody-overclaim", "receipt.findings.class1CustodyGate", "Raw Class 1 custody remains blocked."));
    }
    if (
      !exactKeys(
        receipt.findings.scientificQuantityApproval,
        ["approved", "total"],
        "receipt.findings.scientificQuantityApproval",
        findings,
      ) ||
      receipt.findings.scientificQuantityApproval.approved !== 0 ||
      receipt.findings.scientificQuantityApproval.total !== 55
    ) {
      findings.push(finding("scientific-approval-overclaim", "receipt.findings.scientificQuantityApproval", "The investigation closes 0 of 55 scientific quantities."));
    }
  }

  if (
    !Array.isArray(receipt.requiredNextEvidence) ||
    JSON.stringify(receipt.requiredNextEvidence) !== JSON.stringify(EXPECTED_REQUIRED_EVIDENCE)
  ) {
    findings.push(finding("required-next-evidence", "receipt.requiredNextEvidence", "The raw closure evidence list is incomplete or reordered."));
  }
}

function resolveContainedFile(legacyRoot, artifact) {
  const checkoutRoot = realpathSync(join(legacyRoot, artifact.checkoutDirectory));
  const candidate = join(checkoutRoot, artifact.relativePath);
  const stat = lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${artifact.checkoutRole} prepared artifact must be a regular non-symlink file`);
  }
  const actual = realpathSync(candidate);
  const traversal = relative(checkoutRoot, actual);
  if (traversal === ".." || traversal.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(traversal)) {
    throw new Error(`${artifact.checkoutRole} prepared artifact escapes its checkout`);
  }
  return actual;
}

export function inspectClass1SourceLineage(receipt, { legacyRoot } = {}) {
  const findings = [];
  validateReceiptShape(receipt, findings);
  let localFilesVerified = false;

  if (legacyRoot !== undefined && Array.isArray(receipt?.preparedArtifacts)) {
    for (const [index, artifact] of receipt.preparedArtifacts.entries()) {
      try {
        const bytes = readFileSync(resolveContainedFile(resolve(legacyRoot), artifact));
        if (bytes.byteLength !== artifact.byteLength) {
          findings.push(finding("local-size-mismatch", `receipt.preparedArtifacts[${index}].byteLength`, "Local prepared artifact size drifted."));
        }
        if (sha256(bytes) !== artifact.sha256) {
          findings.push(finding("local-hash-mismatch", `receipt.preparedArtifacts[${index}].sha256`, "Local prepared artifact SHA-256 drifted."));
        }
      } catch (error) {
        findings.push(finding("local-artifact-unavailable", `receipt.preparedArtifacts[${index}]`, error instanceof Error ? error.message : String(error)));
      }
    }
    localFilesVerified = !findings.some(({ rule }) => rule.startsWith("local-"));
  }

  findings.sort((left, right) => `${left.path}:${left.rule}`.localeCompare(`${right.path}:${right.rule}`));
  return {
    ok: findings.length === 0,
    findings,
    evidence: Object.freeze({
      investigationId: typeof receipt?.investigationId === "string" ? receipt.investigationId : null,
      preparedSha256: Array.isArray(receipt?.preparedArtifacts)
        ? [...new Set(receipt.preparedArtifacts.map(({ sha256: value }) => value).filter((value) => SHA256.test(value)))]
        : [],
      localFilesVerified,
      exactRawCodedRowsLocated: receipt?.findings?.exactRawCodedRowsLocated ?? null,
      approvedScientificQuantities: receipt?.findings?.scientificQuantityApproval?.approved ?? null,
      totalScientificQuantities: receipt?.findings?.scientificQuantityApproval?.total ?? null,
    }),
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--receipt" || argument === "--legacy-root") {
      if (!argv[index + 1]) throw new Error(`${argument} requires a path`);
      options[argument.slice(2)] = resolve(argv[index + 1]);
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      process.stdout.write("Usage: node oracle-r/verify-class1-source-lineage.mjs --receipt <json> [--legacy-root <directory>]\n");
      return null;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.receipt) throw new Error("--receipt is required");
  return options;
}

function samePath(left, right) {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return resolve(left) === resolve(right);
  }
}

if (samePath(process.argv[1] ?? "", SCRIPT_PATH)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options !== null) {
      const receipt = JSON.parse(readFileSync(options.receipt, "utf8"));
      const result = inspectClass1SourceLineage(receipt, {
        legacyRoot: options["legacy-root"],
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = result.ok ? 0 : 1;
    }
  } catch (error) {
    process.stderr.write(`Class 1 source-lineage verifier error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
