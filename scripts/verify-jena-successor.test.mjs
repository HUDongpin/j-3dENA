import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  inspectJenaSuccessor,
  JENA_SUCCESSOR_CONTRACT,
} from "./verify-jena-successor.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fixture(metadataOverrides = {}, installedOverrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "3dena-jena-successor-"));
  const installedDirectory = join(root, "node_modules", "jena-js");
  const analysisDirectory = join(root, "packages", "analysis");
  const vendorDirectory = join(root, "vendor", "jena-js");
  mkdirSync(installedDirectory, { recursive: true });
  mkdirSync(analysisDirectory, { recursive: true });
  mkdirSync(vendorDirectory, { recursive: true });
  copyFileSync(join(repositoryRoot, "vendor/jena-js/RECEIPT.json"), join(vendorDirectory, "RECEIPT.json"));
  copyFileSync(join(repositoryRoot, "vendor/jena-js/jena-js-0.7.0-ona.0.tgz"), join(vendorDirectory, "jena-js-0.7.0-ona.0.tgz"));
  const metadata = {
    version: JENA_SUCCESSOR_CONTRACT.version,
    resolved: JENA_SUCCESSOR_CONTRACT.localTarball,
    integrity: JENA_SUCCESSOR_CONTRACT.integrity,
    license: JENA_SUCCESSOR_CONTRACT.license,
    ...metadataOverrides,
  };
  writeFileSync(
    join(root, "package-lock.json"),
    `${JSON.stringify({ lockfileVersion: 3, packages: { "": { devDependencies: { "jena-js": JENA_SUCCESSOR_CONTRACT.localTarball } }, "packages/analysis": { peerDependencies: { "jena-js": JENA_SUCCESSOR_CONTRACT.version } }, "node_modules/jena-js": metadata } }, null, 2)}\n`,
  );
  writeFileSync(
    join(analysisDirectory, "package.json"),
    `${JSON.stringify({ name: "@3dena/analysis", dependencies: {}, peerDependencies: { "jena-js": JENA_SUCCESSOR_CONTRACT.version } }, null, 2)}\n`,
  );
  writeFileSync(
    join(installedDirectory, "package.json"),
    `${JSON.stringify({ name: "jena-js", version: JENA_SUCCESSOR_CONTRACT.version, license: "GPL-3.0-only", ...installedOverrides }, null, 2)}\n`,
  );
  return root;
}

function mutateLock(root, mutator) {
  const pathname = join(root, "package-lock.json");
  const lock = JSON.parse(readFileSync(pathname, "utf8"));
  mutator(lock);
  writeFileSync(pathname, `${JSON.stringify(lock, null, 2)}\n`);
}

test("accepts exactly one reviewed 0.7.0-ona.0 peer with a verified custody receipt", () => {
  const result = inspectJenaSuccessor({ root: fixture() });
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
  assert.equal(result.evidence.lockInstances, 1);
});

test("rejects an older self-dependent jENA substitution", () => {
  const root = fixture(
    {
      version: "0.6.2",
      resolved: "file:vendor/jena-js/jena-js-0.6.2.tgz",
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

test("rejects an integrity value that does not match the reviewed tarball", () => {
  const result = inspectJenaSuccessor({ root: fixture({ integrity: "sha512-unreviewed" }) });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some(({ rule }) => rule === "tarball-integrity-mismatch"));
});

test("rejects duplicate and unreviewed-tarball successor substitutions", () => {
  const root = fixture({ resolved: "file:jena-js-unreviewed.tgz" });
  const lock = {
    lockfileVersion: 3,
    packages: {
      "": { devDependencies: { "jena-js": JENA_SUCCESSOR_CONTRACT.localTarball } },
      "packages/analysis": { peerDependencies: { "jena-js": JENA_SUCCESSOR_CONTRACT.version } },
      "node_modules/jena-js": {
        version: JENA_SUCCESSOR_CONTRACT.version,
        resolved: "file:jena-js-unreviewed.tgz",
        integrity: JENA_SUCCESSOR_CONTRACT.integrity,
        license: "GPL-3.0-only",
      },
      "node_modules/example/node_modules/jena-js": {
        version: JENA_SUCCESSOR_CONTRACT.version,
        resolved: JENA_SUCCESSOR_CONTRACT.localTarball,
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
  assert.ok(rules.has("unreviewed-tarball-source"));
});

test("rejects malformed lock and dependency shapes fail-closed", async (t) => {
  const cases = [
    ["lockfile v2", (root) => mutateLock(root, (lock) => { lock.lockfileVersion = 2; })],
    ["packages null", (root) => mutateLock(root, (lock) => { lock.packages = null; })],
    ["root missing", (root) => mutateLock(root, (lock) => { delete lock.packages[""]; })],
    ["analysis lock missing", (root) => mutateLock(root, (lock) => { delete lock.packages["packages/analysis"]; })],
    ["analysis lock peer dependencies null", (root) => mutateLock(root, (lock) => { lock.packages["packages/analysis"].peerDependencies = null; })],
    ["analysis lock successor drift", (root) => mutateLock(root, (lock) => { lock.packages["packages/analysis"].peerDependencies["jena-js"] = "0.6.2"; })],
    ["jena lock entry null", (root) => mutateLock(root, (lock) => { lock.packages["node_modules/jena-js"] = null; })],
    ["jena dependencies null", (root) => mutateLock(root, (lock) => { lock.packages["node_modules/jena-js"].dependencies = null; })],
    ["installed dependencies array", (root) => {
      const pathname = join(root, "node_modules", "jena-js", "package.json");
      const manifest = JSON.parse(readFileSync(pathname, "utf8"));
      manifest.dependencies = [];
      writeFileSync(pathname, `${JSON.stringify(manifest, null, 2)}\n`);
    }],
    ["source peer dependencies null", (root) => {
      const pathname = join(root, "packages", "analysis", "package.json");
      const manifest = JSON.parse(readFileSync(pathname, "utf8"));
      manifest.peerDependencies = null;
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
