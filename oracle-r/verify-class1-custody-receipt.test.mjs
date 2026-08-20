import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import {
  inspectClass1CustodyReceipt,
  validateClass1Mapping,
} from "./verify-class1-custody-receipt.mjs";

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function binding(sourceIndex, type = "character") {
  return {
    sourceIndex,
    headerSha256: sha256(`header-${sourceIndex}`),
    type,
    levels: null,
    missingPolicy: "reject",
  };
}

function validFixture() {
  const rawBytes = Buffer.from("unit,conversation,participant,group,time,code\n1,1,p1,g1,t1,c1\n");
  const mapping = {
    schemaVersion: "3dena.class1-mapping.v1",
    columns: {
      unit: [binding(0)],
      conversation: [binding(1)],
      participant: [binding(2)],
      group: [binding(3, "factor")],
      time: [binding(4, "ordered-factor")],
      codes: [binding(5, "logical")],
    },
    duplicatePolicy: "sum",
    sort: [{ role: "unit", direction: "asc", missing: "reject" }],
  };
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  const receipt = {
    schemaVersion: "3dena.class1-custody-receipt.v1",
    receiptId: "class1-receipt-0001",
    authorization: {
      approvalId: "owner-approval-0001",
      dataOwnerActorId: "actor-owner-0001",
      approvedAt: "2026-08-21T00:00:00Z",
      allowedUse: ["scientific-parity-oracle"],
      retentionPolicyId: "retention-policy-0001",
    },
    deidentification: {
      reviewId: "deid-review-0001",
      reviewerActorId: "actor-deid-reviewer-0001",
      reviewedAt: "2026-08-21T00:01:00Z",
      decision: "approved",
      fieldDispositions: [],
    },
    custody: {
      custodianActorId: "actor-custodian-0001",
      receivedAt: "2026-08-21T00:02:00Z",
      storeClass: "3dena-class1-custody",
      sourceByteLength: rawBytes.byteLength,
      sourceSha256: sha256(rawBytes),
      sourceMagicHex: rawBytes.subarray(0, 16).toString("hex"),
      detectedMime: "text/csv",
      acceptedFormat: "csv",
      encryptedAtRest: true,
      webAccess: false,
      productionWorkerAccess: false,
      ordinaryCiAccess: false,
      rawBytesCommitted: false,
      rawBytesLogged: false,
    },
    mapping: {
      schemaVersion: "3dena.class1-mapping.v1",
      sha256: sha256(Buffer.from(`${stableStringify(mapping)}\n`)),
    },
    attestation: {
      operatorActorId: "actor-operator-0001",
      signedAt: "2026-08-21T00:03:00Z",
      algorithm: "Ed25519",
      keyId: "class1-custody-key-0001",
      publicKeySha256: sha256(publicKeyDer),
    },
  };
  const signature = sign(null, Buffer.from(`${stableStringify(receipt)}\n`), privateKey);
  return {
    receipt,
    mapping,
    rawBytes,
    signature,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
  };
}

test("accepts exact raw bytes, canonical mapping, isolated custody and an Ed25519 attestation", () => {
  const fixture = validFixture();
  const result = inspectClass1CustodyReceipt(fixture);
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
  assert.equal(result.evidence.sourceSha256, fixture.receipt.custody.sourceSha256);
  assert.equal(result.evidence.mappingSha256, fixture.receipt.mapping.sha256);
});

test("rejects byte drift, mapping drift, signature drift and production access", () => {
  const fixture = validFixture();
  fixture.receipt.custody.productionWorkerAccess = true;
  fixture.mapping.duplicatePolicy = "mean";
  fixture.rawBytes = Buffer.concat([fixture.rawBytes, Buffer.from("2,2,p2,g2,t2,c2\n")]);
  const result = inspectClass1CustodyReceipt(fixture);
  assert.equal(result.ok, false);
  const rules = new Set(result.findings.map(({ rule }) => rule));
  assert.ok(rules.has("custody-boundary"));
  assert.ok(rules.has("mapping-hash-mismatch"));
  assert.ok(rules.has("raw-size-mismatch"));
  assert.ok(rules.has("raw-hash-mismatch"));
  assert.ok(rules.has("invalid-signature"));
});

test("rejects unknown mapping fields and missing scientific roles", () => {
  const fixture = validFixture();
  fixture.mapping.columns.codes = [];
  fixture.mapping.unreviewedOption = true;
  const findings = validateClass1Mapping(fixture.mapping);
  assert.ok(findings.some(({ rule }) => rule === "contract-fields"));
});
