import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const gateUrl = new URL("./run-local-public-package-gate.mjs", import.meta.url);

test("root check delegates public-package verification to one phase-aware gate", () => {
  assert.equal(
    manifest.scripts["verify:public-package"],
    "node scripts/run-local-public-package-gate.mjs",
  );
  assert.doesNotMatch(manifest.scripts.check, /build:public/u);
  assert.doesNotMatch(manifest.scripts.check, /test:public-package/u);
  assert.match(manifest.scripts.check, /verify:public-package/u);
});

test("phase-aware plan rebuilds source packages but never generated custody bytes", async () => {
  assert.equal(existsSync(gateUrl), true, "phase-aware gate module must exist");
  const { createLocalPublicPackagePlan } = await import(gateUrl.href);
  const inputs = {
    releaseVersion: "0.2.0-implemented-unverified.11",
    packageDirectory: "packages/analysis/dist/package",
    temporaryArtifactDirectory: "/private/tmp/3dena-source-artifact",
    trackedArtifactDirectory: "packages/analysis/dist",
  };

  const source = createLocalPublicPackagePlan({ ...inputs, headKind: "source" });
  assert.deepEqual(source.map(({ action }) => action), ["build", "artifact", "verify", "smoke"]);
  assert.deepEqual(source[2].args, [
    "--package", "packages/analysis/dist/package",
    "--tarball", "/private/tmp/3dena-source-artifact/j-3dena-0.2.0-implemented-unverified.11.tgz",
    "--receipt", "/private/tmp/3dena-source-artifact/j-3dena-0.2.0-implemented-unverified.11.tgz.artifact-receipt.json",
  ]);
  assert.deepEqual(source[3].args, [
    "--tarball", "/private/tmp/3dena-source-artifact/j-3dena-0.2.0-implemented-unverified.11.tgz",
    "--receipt", "/private/tmp/3dena-source-artifact/j-3dena-0.2.0-implemented-unverified.11.tgz.artifact-receipt.json",
  ]);

  const generated = createLocalPublicPackagePlan({ ...inputs, headKind: "generated" });
  assert.deepEqual(generated.map(({ action }) => action), ["verify", "smoke"]);
  assert.deepEqual(generated[0].args, [
    "--package", "packages/analysis/dist/package",
    "--tarball", "packages/analysis/dist/j-3dena-0.2.0-implemented-unverified.11.tgz",
    "--receipt", "packages/analysis/dist/j-3dena-0.2.0-implemented-unverified.11.tgz.artifact-receipt.json",
  ]);
});
