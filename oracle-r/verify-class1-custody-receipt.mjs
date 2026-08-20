#!/usr/bin/env node

/**
 * Offline, R-free verification of a Class 1 raw-data custody receipt.
 *
 * The raw file, frozen mapping, and private signing key stay outside Git. This
 * verifier emits only hashes and rule identifiers and never prints file bytes,
 * mapping values, actor IDs, or signature material.
 */

import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SHA256 = /^[0-9a-f]{64}$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$/u;
const HEX_PREFIX = /^(?:[0-9a-f]{2}){1,32}$/u;
const COLUMN_TYPES = new Set([
  "logical",
  "integer",
  "double",
  "character",
  "factor",
  "ordered-factor",
  "date",
  "instant",
  "duration",
]);
const MISSING_POLICIES = new Set(["reject", "drop-row", "explicit-level", "preserve"]);
const FORMATS = new Set(["csv", "xls", "xlsx"]);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function finding(rule, path, detail) {
  return Object.freeze({ rule, path, detail });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
        "Missing, unknown, or duplicate-by-construction contract fields are rejected.",
      ),
    );
    return false;
  }
  return true;
}

function validId(value) {
  return typeof value === "string" && IDENTIFIER.test(value);
}

function validateColumnBinding(value, path, findings) {
  if (
    !exactKeys(
      value,
      ["sourceIndex", "headerSha256", "type", "levels", "missingPolicy"],
      path,
      findings,
    )
  ) {
    return;
  }
  if (!Number.isSafeInteger(value.sourceIndex) || value.sourceIndex < 0) {
    findings.push(finding("source-index", `${path}.sourceIndex`, "Expected a non-negative safe integer."));
  }
  if (!SHA256.test(value.headerSha256)) {
    findings.push(finding("header-hash", `${path}.headerSha256`, "Expected a lowercase SHA-256."));
  }
  if (!COLUMN_TYPES.has(value.type)) {
    findings.push(finding("column-type", `${path}.type`, "Column type is outside the frozen registry."));
  }
  if (
    value.levels !== null &&
    (!Array.isArray(value.levels) ||
      value.levels.some((level) => typeof level !== "string" || level.length === 0))
  ) {
    findings.push(finding("typed-levels", `${path}.levels`, "Levels must be null or non-empty canonical typed strings."));
  }
  if (!MISSING_POLICIES.has(value.missingPolicy)) {
    findings.push(finding("missing-policy", `${path}.missingPolicy`, "Missing policy is outside the frozen registry."));
  }
}

export function validateClass1Mapping(mapping) {
  const findings = [];
  if (
    !exactKeys(
      mapping,
      ["schemaVersion", "columns", "duplicatePolicy", "sort"],
      "mapping",
      findings,
    )
  ) {
    return findings;
  }
  if (mapping.schemaVersion !== "3dena.class1-mapping.v1") {
    findings.push(finding("mapping-schema", "mapping.schemaVersion", "Unsupported mapping schema."));
  }
  const roles = ["unit", "conversation", "participant", "group", "time", "codes"];
  if (exactKeys(mapping.columns, roles, "mapping.columns", findings)) {
    for (const role of roles) {
      const bindings = mapping.columns[role];
      if (!Array.isArray(bindings) || bindings.length === 0) {
        findings.push(finding("mapping-role", `mapping.columns.${role}`, "Every frozen role requires at least one source column."));
        continue;
      }
      bindings.forEach((binding, index) =>
        validateColumnBinding(binding, `mapping.columns.${role}[${index}]`, findings),
      );
    }
  }
  if (!new Set(["reject", "first", "last", "sum", "mean"]).has(mapping.duplicatePolicy)) {
    findings.push(finding("duplicate-policy", "mapping.duplicatePolicy", "Duplicate reduction policy is not frozen."));
  }
  if (!Array.isArray(mapping.sort) || mapping.sort.length === 0) {
    findings.push(finding("sort-contract", "mapping.sort", "At least one ordered sort key is required."));
  } else {
    mapping.sort.forEach((item, index) => {
      const path = `mapping.sort[${index}]`;
      if (!exactKeys(item, ["role", "direction", "missing"], path, findings)) return;
      if (!["unit", "conversation", "participant", "group", "time", "codes"].includes(item.role)) {
        findings.push(finding("sort-role", `${path}.role`, "Unknown sort role."));
      }
      if (!new Set(["asc", "desc"]).has(item.direction)) {
        findings.push(finding("sort-direction", `${path}.direction`, "Unknown sort direction."));
      }
      if (!new Set(["first", "last", "reject"]).has(item.missing)) {
        findings.push(finding("sort-missing", `${path}.missing`, "Unknown missing sort policy."));
      }
    });
  }
  return findings;
}

function validateReceiptShape(receipt, findings) {
  if (
    !exactKeys(
      receipt,
      [
        "schemaVersion",
        "receiptId",
        "authorization",
        "deidentification",
        "custody",
        "mapping",
        "attestation",
      ],
      "receipt",
      findings,
    )
  ) {
    return;
  }
  if (receipt.schemaVersion !== "3dena.class1-custody-receipt.v1") {
    findings.push(finding("receipt-schema", "receipt.schemaVersion", "Unsupported custody receipt schema."));
  }
  if (!validId(receipt.receiptId)) {
    findings.push(finding("receipt-id", "receipt.receiptId", "Receipt ID is missing or malformed."));
  }

  if (
    exactKeys(
      receipt.authorization,
      ["approvalId", "dataOwnerActorId", "approvedAt", "allowedUse", "retentionPolicyId"],
      "receipt.authorization",
      findings,
    )
  ) {
    if (!validId(receipt.authorization.approvalId) || !validId(receipt.authorization.dataOwnerActorId)) {
      findings.push(finding("authorization-identity", "receipt.authorization", "Authorization IDs are malformed."));
    }
    if (!UTC_TIMESTAMP.test(receipt.authorization.approvedAt)) {
      findings.push(finding("authorization-time", "receipt.authorization.approvedAt", "Expected a UTC timestamp."));
    }
    if (
      !Array.isArray(receipt.authorization.allowedUse) ||
      receipt.authorization.allowedUse.length !== 1 ||
      receipt.authorization.allowedUse[0] !== "scientific-parity-oracle"
    ) {
      findings.push(finding("allowed-use", "receipt.authorization.allowedUse", "Only the scientific parity oracle use is authorized."));
    }
    if (!validId(receipt.authorization.retentionPolicyId)) {
      findings.push(finding("retention-policy", "receipt.authorization.retentionPolicyId", "A governed retention policy ID is required."));
    }
  }

  if (
    exactKeys(
      receipt.deidentification,
      ["reviewId", "reviewerActorId", "reviewedAt", "decision", "fieldDispositions"],
      "receipt.deidentification",
      findings,
    )
  ) {
    if (!validId(receipt.deidentification.reviewId) || !validId(receipt.deidentification.reviewerActorId)) {
      findings.push(finding("deid-identity", "receipt.deidentification", "De-identification review IDs are malformed."));
    }
    if (!UTC_TIMESTAMP.test(receipt.deidentification.reviewedAt)) {
      findings.push(finding("deid-time", "receipt.deidentification.reviewedAt", "Expected a UTC timestamp."));
    }
    if (receipt.deidentification.decision !== "approved") {
      findings.push(finding("deid-decision", "receipt.deidentification.decision", "De-identification review must be approved."));
    }
    if (!Array.isArray(receipt.deidentification.fieldDispositions)) {
      findings.push(finding("field-dispositions", "receipt.deidentification.fieldDispositions", "Expected a disposition array."));
    } else {
      receipt.deidentification.fieldDispositions.forEach((item, index) => {
        const path = `receipt.deidentification.fieldDispositions[${index}]`;
        if (!exactKeys(item, ["fieldHeaderSha256", "disposition", "decisionId"], path, findings)) return;
        if (!SHA256.test(item.fieldHeaderSha256) || !validId(item.decisionId)) {
          findings.push(finding("field-disposition-identity", path, "Disposition hash or decision ID is malformed."));
        }
        if (!new Set(["removed", "transformed", "retained-approved"]).has(item.disposition)) {
          findings.push(finding("field-disposition", `${path}.disposition`, "Unknown sensitive-field disposition."));
        }
      });
    }
  }

  if (
    exactKeys(
      receipt.custody,
      [
        "custodianActorId",
        "receivedAt",
        "storeClass",
        "sourceByteLength",
        "sourceSha256",
        "sourceMagicHex",
        "detectedMime",
        "acceptedFormat",
        "encryptedAtRest",
        "webAccess",
        "productionWorkerAccess",
        "ordinaryCiAccess",
        "rawBytesCommitted",
        "rawBytesLogged",
      ],
      "receipt.custody",
      findings,
    )
  ) {
    if (!validId(receipt.custody.custodianActorId) || !UTC_TIMESTAMP.test(receipt.custody.receivedAt)) {
      findings.push(finding("custody-identity", "receipt.custody", "Custodian ID or receipt time is malformed."));
    }
    if (receipt.custody.storeClass !== "3dena-class1-custody") {
      findings.push(finding("custody-store", "receipt.custody.storeClass", "Class 1 must use the isolated custody store."));
    }
    if (!Number.isSafeInteger(receipt.custody.sourceByteLength) || receipt.custody.sourceByteLength <= 0) {
      findings.push(finding("source-byte-length", "receipt.custody.sourceByteLength", "Expected a positive exact byte length."));
    }
    if (!SHA256.test(receipt.custody.sourceSha256) || !HEX_PREFIX.test(receipt.custody.sourceMagicHex)) {
      findings.push(finding("source-byte-identity", "receipt.custody", "Exact SHA-256 and a 1-32 byte magic prefix are required."));
    }
    if (typeof receipt.custody.detectedMime !== "string" || receipt.custody.detectedMime.length === 0 || !FORMATS.has(receipt.custody.acceptedFormat)) {
      findings.push(finding("source-format", "receipt.custody", "Detected MIME and an accepted coded-row format are required."));
    }
    for (const [field, expected] of [
      ["encryptedAtRest", true],
      ["webAccess", false],
      ["productionWorkerAccess", false],
      ["ordinaryCiAccess", false],
      ["rawBytesCommitted", false],
      ["rawBytesLogged", false],
    ]) {
      if (receipt.custody[field] !== expected) {
        findings.push(finding("custody-boundary", `receipt.custody.${field}`, `Expected ${String(expected)}.`));
      }
    }
  }

  if (
    exactKeys(
      receipt.mapping,
      ["schemaVersion", "sha256"],
      "receipt.mapping",
      findings,
    )
  ) {
    if (receipt.mapping.schemaVersion !== "3dena.class1-mapping.v1" || !SHA256.test(receipt.mapping.sha256)) {
      findings.push(finding("mapping-identity", "receipt.mapping", "Frozen mapping schema and SHA-256 are required."));
    }
  }

  if (
    exactKeys(
      receipt.attestation,
      ["operatorActorId", "signedAt", "algorithm", "keyId", "publicKeySha256"],
      "receipt.attestation",
      findings,
    )
  ) {
    if (!validId(receipt.attestation.operatorActorId) || !validId(receipt.attestation.keyId)) {
      findings.push(finding("attestation-identity", "receipt.attestation", "Operator or key ID is malformed."));
    }
    if (!UTC_TIMESTAMP.test(receipt.attestation.signedAt) || receipt.attestation.algorithm !== "Ed25519") {
      findings.push(finding("attestation-method", "receipt.attestation", "A UTC Ed25519 attestation is required."));
    }
    if (!SHA256.test(receipt.attestation.publicKeySha256)) {
      findings.push(finding("attestation-key-hash", "receipt.attestation.publicKeySha256", "Expected a public-key SHA-256."));
    }
  }

  const actorIds = [
    receipt.authorization?.dataOwnerActorId,
    receipt.deidentification?.reviewerActorId,
    receipt.custody?.custodianActorId,
    receipt.attestation?.operatorActorId,
  ];
  if (actorIds.every(validId) && new Set(actorIds).size !== actorIds.length) {
    findings.push(finding("role-separation", "receipt", "Owner, de-identification reviewer, custodian, and operator must be distinct actors."));
  }
}

export function inspectClass1CustodyReceipt({ receipt, mapping, rawBytes, signature, publicKeyPem }) {
  const findings = [...validateClass1Mapping(mapping)];
  validateReceiptShape(receipt, findings);

  const mappingCanonicalBytes = Buffer.from(`${stableStringify(mapping)}\n`, "utf8");
  const mappingSha256 = sha256(mappingCanonicalBytes);
  if (receipt?.mapping?.sha256 !== mappingSha256) {
    findings.push(finding("mapping-hash-mismatch", "receipt.mapping.sha256", "Receipt does not bind the exact canonical mapping bytes."));
  }

  const sourceSha256 = sha256(rawBytes);
  const magicHex = rawBytes.subarray(0, Math.min(32, rawBytes.byteLength)).toString("hex");
  if (receipt?.custody?.sourceByteLength !== rawBytes.byteLength) {
    findings.push(finding("raw-size-mismatch", "receipt.custody.sourceByteLength", "Receipt byte length does not match the supplied exact bytes."));
  }
  if (receipt?.custody?.sourceSha256 !== sourceSha256) {
    findings.push(finding("raw-hash-mismatch", "receipt.custody.sourceSha256", "Receipt SHA-256 does not match the supplied exact bytes."));
  }
  if (typeof receipt?.custody?.sourceMagicHex === "string" && !magicHex.startsWith(receipt.custody.sourceMagicHex)) {
    findings.push(finding("raw-magic-mismatch", "receipt.custody.sourceMagicHex", "Receipt magic prefix does not match the supplied exact bytes."));
  }

  let publicKeySha256 = null;
  try {
    const key = createPublicKey(publicKeyPem);
    publicKeySha256 = sha256(key.export({ type: "spki", format: "der" }));
    if (receipt?.attestation?.publicKeySha256 !== publicKeySha256) {
      findings.push(finding("public-key-hash-mismatch", "receipt.attestation.publicKeySha256", "Receipt is not bound to the supplied trusted public key."));
    }
    const receiptBytes = Buffer.from(`${stableStringify(receipt)}\n`, "utf8");
    if (!verify(null, receiptBytes, key, signature)) {
      findings.push(finding("invalid-signature", "receipt", "Ed25519 verification failed."));
    }
  } catch {
    findings.push(finding("invalid-public-key", "publicKey", "Trusted Ed25519 public key could not be verified."));
  }

  findings.sort((left, right) => `${left.path}:${left.rule}`.localeCompare(`${right.path}:${right.rule}`));
  return {
    ok: findings.length === 0,
    findings,
    evidence: Object.freeze({
      receiptId: validId(receipt?.receiptId) ? receipt.receiptId : null,
      sourceByteLength: rawBytes.byteLength,
      sourceSha256,
      mappingSha256,
      publicKeySha256,
    }),
  };
}

function parseArguments(argv) {
  const paths = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--receipt", "--mapping", "--raw", "--signature", "--public-key"].includes(argument)) {
      if (!argv[index + 1]) throw new Error(`${argument} requires a path`);
      paths[argument.slice(2)] = resolve(argv[index + 1]);
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      process.stdout.write("Usage: node oracle-r/verify-class1-custody-receipt.mjs --receipt <json> --mapping <json> --raw <private-file> --signature <binary> --public-key <pem>\n");
      return null;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  for (const required of ["receipt", "mapping", "raw", "signature", "public-key"]) {
    if (!paths[required]) throw new Error(`--${required} is required`);
  }
  return paths;
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
    const paths = parseArguments(process.argv.slice(2));
    if (paths !== null) {
      const result = inspectClass1CustodyReceipt({
        receipt: JSON.parse(readFileSync(paths.receipt, "utf8")),
        mapping: JSON.parse(readFileSync(paths.mapping, "utf8")),
        rawBytes: readFileSync(paths.raw),
        signature: readFileSync(paths.signature),
        publicKeyPem: readFileSync(paths["public-key"]),
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = result.ok ? 0 : 1;
    }
  } catch (error) {
    process.stderr.write(`Class 1 custody verifier error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
