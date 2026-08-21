import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  const analysisDirectory = join(root, "packages", "analysis");
  mkdirSync(installedDirectory, { recursive: true });
  mkdirSync(analysisDirectory, { recursive: true });
  const metadata = {
    version: JENA_SUCCESSOR_CONTRACT.version,
    resolved: JENA_SUCCESSOR_CONTRACT.registryTarball,
    integrity: JENA_SUCCESSOR_CONTRACT.integrity,
    license: JENA_SUCCESSOR_CONTRACT.license,
    ...metadataOverrides,
  };
  writeFileSync(
    join(root, "package-lock.json"),
    `${JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "packages/analysis": { dependencies: { "jena-js": "0.6.3" } }, "node_modules/jena-js": metadata } }, null, 2)}\n`,
  );
  writeFileSync(
    join(analysisDirectory, "package.json"),
    `${JSON.stringify({ name: "@3dena/analysis", dependencies: { "jena-js": "0.6.3" } }, null, 2)}\n`,
  );
  writeFileSync(
    join(installedDirectory, "package.json"),
    `${JSON.stringify({ name: "jena-js", version: "0.6.3", license: "GPL-3.0-only", ...installedOverrides }, null, 2)}\n`,
  );
  return root;
}

function mutateLock(root, mutator) {
  const pathname = join(root, "package-lock.json");
  const lock = JSON.parse(readFileSync(pathname, "utf8"));
  mutator(lock);
  writeFileSync(pathname, `${JSON.stringify(lock, null, 2)}\n`);
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

test("rejects a registry integrity value that does not match the reviewed tarball", () => {
  const result = inspectJenaSuccessor({ root: fixture({ integrity: "sha512-unreviewed" }) });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some(({ rule }) => rule === "registry-integrity-mismatch"));
});

test("rejects duplicate and local-tarball successor substitutions", () => {
  const root = fixture({ resolved: "file:jena-js-0.6.3.tgz" });
  const lock = {
    lockfileVersion: 3,
    packages: {
      "": {},
      "packages/analysis": { dependencies: { "jena-js": "0.6.3" } },
      "node_modules/jena-js": {
        version: "0.6.3",
        resolved: "file:jena-js-0.6.3.tgz",
        integrity: JENA_SUCCESSOR_CONTRACT.integrity,
        license: "GPL-3.0-only",
      },
      "node_modules/example/node_modules/jena-js": {
        version: "0.6.3",
        resolved: JENA_SUCCESSOR_CONTRACT.registryTarball,
        integrity: JENA_SUCCESSOR_CONTRACT.integrity,
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

test("rejects malformed lock and dependency shapes fail-closed", async (t) => {
  const cases = [
    ["lockfile v2", (root) => mutateLock(root, (lock) => { lock.lockfileVersion = 2; })],
    ["packages null", (root) => mutateLock(root, (lock) => { lock.packages = null; })],
    ["root missing", (root) => mutateLock(root, (lock) => { delete lock.packages[""]; })],
    ["analysis lock missing", (root) => mutateLock(root, (lock) => { delete lock.packages["packages/analysis"]; })],
    ["analysis lock dependencies null", (root) => mutateLock(root, (lock) => { lock.packages["packages/analysis"].dependencies = null; })],
    ["analysis lock successor drift", (root) => mutateLock(root, (lock) => { lock.packages["packages/analysis"].dependencies["jena-js"] = "0.6.2"; })],
    ["jena lock entry null", (root) => mutateLock(root, (lock) => { lock.packages["node_modules/jena-js"] = null; })],
    ["jena dependencies null", (root) => mutateLock(root, (lock) => { lock.packages["node_modules/jena-js"].dependencies = null; })],
    ["installed dependencies array", (root) => {
      const pathname = join(root, "node_modules", "jena-js", "package.json");
      const manifest = JSON.parse(readFileSync(pathname, "utf8"));
      manifest.dependencies = [];
      writeFileSync(pathname, `${JSON.stringify(manifest, null, 2)}\n`);
    }],
    ["source dependencies null", (root) => {
      const pathname = join(root, "packages", "analysis", "package.json");
      const manifest = JSON.parse(readFileSync(pathname, "utf8"));
      manifest.dependencies = null;
      writeFileSync(pathname, `${JSON.stringify(manifest, null, 2)}\n`);
    }],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const root = fixture();
      mutate(root);
      const result = inspectJenaSuccessor({ root });
      assert.equal(result.ok, false, `${name} unexpectedly passed`);
    });
  }
});
