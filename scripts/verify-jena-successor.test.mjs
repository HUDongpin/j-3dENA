import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  inspectJenaSuccessor,
  JENA_SUCCESSOR_CONTRACT,
} from "./verify-jena-successor.mjs";

function fixture(metadataOverrides = {}, installedOverrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "3dena-jena-successor-"));
  const installedDirectory = join(root, "node_modules", "jena-js");
  mkdirSync(installedDirectory, { recursive: true });
  const metadata = {
    version: JENA_SUCCESSOR_CONTRACT.version,
    resolved: JENA_SUCCESSOR_CONTRACT.registryTarball,
    integrity: "sha512-reviewed",
    license: JENA_SUCCESSOR_CONTRACT.license,
    ...metadataOverrides,
  };
  writeFileSync(
    join(root, "package-lock.json"),
    `${JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/jena-js": metadata } }, null, 2)}\n`,
  );
  writeFileSync(
    join(installedDirectory, "package.json"),
    `${JSON.stringify({ name: "jena-js", version: "0.6.3", license: "GPL-3.0-only", ...installedOverrides }, null, 2)}\n`,
  );
  return root;
}

test("accepts exactly one public-registry 0.6.3 successor with no runtime dependencies", () => {
  const result = inspectJenaSuccessor({ root: fixture() });
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
  assert.equal(result.evidence.lockInstances, 1);
});

test("rejects the 0.6.2 self-dependency declaration", () => {
  const root = fixture(
    {
      version: "0.6.2",
      resolved: "https://registry.npmjs.org/jena-js/-/jena-js-0.6.2.tgz",
      dependencies: { "jena-js": "^0.6.0" },
    },
    { version: "0.6.2", dependencies: { "jena-js": "^0.6.0" } },
  );
  const result = inspectJenaSuccessor({ root });
  assert.equal(result.ok, false);
  const rules = new Set(result.findings.map(({ rule }) => rule));
  assert.ok(rules.has("unreviewed-jena-version"));
  assert.ok(rules.has("jena-self-dependency"));
  assert.ok(rules.has("unexpected-jena-runtime-dependency"));
  assert.ok(rules.has("installed-successor-mismatch"));
});

test("rejects duplicate and local-tarball successor substitutions", () => {
  const root = fixture({ resolved: "file:jena-js-0.6.3.tgz" });
  const lock = {
    lockfileVersion: 3,
    packages: {
      "": {},
      "node_modules/jena-js": {
        version: "0.6.3",
        resolved: "file:jena-js-0.6.3.tgz",
        integrity: "sha512-reviewed",
        license: "GPL-3.0-only",
      },
      "node_modules/example/node_modules/jena-js": {
        version: "0.6.3",
        resolved: JENA_SUCCESSOR_CONTRACT.registryTarball,
        integrity: "sha512-reviewed",
        license: "GPL-3.0-only",
      },
    },
  };
  writeFileSync(join(root, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
  const result = inspectJenaSuccessor({ root });
  assert.equal(result.ok, false);
  const rules = new Set(result.findings.map(({ rule }) => rule));
  assert.ok(rules.has("jena-instance-count"));
  assert.ok(rules.has("non-registry-successor"));
});
