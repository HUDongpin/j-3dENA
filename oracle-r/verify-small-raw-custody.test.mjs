import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_INPUT_BYTES,
  EXPECTED_INPUT_SHA256,
  GENERATOR_RELATIVE_PATH,
  INPUT_RELATIVE_PATH,
  verifySmallRawCustody,
} from "./verify-small-raw-custody.mjs";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function git(root, ...arguments_) {
  return execFileSync("git", ["-C", root, ...arguments_], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function committedFixture() {
  const root = mkdtempSync(join(tmpdir(), "3dena-oracle-custody-"));
  for (const relativePath of [GENERATOR_RELATIVE_PATH, INPUT_RELATIVE_PATH]) {
    const destination = join(root, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(PROJECT_ROOT, relativePath), destination);
  }
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "oracle-test@example.invalid");
  git(root, "config", "user.name", "Oracle custody test");
  git(root, "add", "--", GENERATOR_RELATIVE_PATH, INPUT_RELATIVE_PATH);
  git(root, "commit", "--quiet", "-m", "frozen oracle inputs");
  return root;
}

test("R generator hard-codes the governed input and enforces Git custody", () => {
  const source = readFileSync(join(PROJECT_ROOT, GENERATOR_RELATIVE_PATH), "utf8");
  assert.match(
    source,
    new RegExp(`EXPECTED_INPUT_SHA256 <- "${EXPECTED_INPUT_SHA256}"`),
  );
  assert.match(source, new RegExp(`EXPECTED_INPUT_BYTES <- ${EXPECTED_INPUT_BYTES}L`));
  assert.match(
    source,
    /assert_tracked_clean\(\s*generator_root, INPUT_RELATIVE_PATH,/,
  );
  assert.match(source, /input_sha256.*EXPECTED_INPUT_SHA256/s);
  assert.match(source, /input_bytes.*EXPECTED_INPUT_BYTES/s);
});

test("Class 1 wrapper records its commit and enforces its own Git custody", () => {
  const source = readFileSync(
    join(PROJECT_ROOT, "oracle-r/generate-class1-exchange.R"),
    "utf8",
  );
  assert.match(
    source,
    /WRAPPER_RELATIVE_PATH <- "oracle-r\/generate-class1-exchange\.R"/,
  );
  assert.match(
    source,
    /assert_tracked_clean\(\s*wrapper_root, WRAPPER_RELATIVE_PATH,/,
  );
  assert.match(source, /paste0\("wrapper_commit=", wrapper_commit\)/);
  assert.match(source, /wrapperCommit = wrapper_commit/);
  assert.match(source, /gitCommit = wrapper_commit/);
});

test("passes only for the exact committed generator and frozen input", () => {
  const result = verifySmallRawCustody({ root: committedFixture() });
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
  assert.equal(result.input.bytes, EXPECTED_INPUT_BYTES);
  assert.equal(result.input.sha256, EXPECTED_INPUT_SHA256);
  assert.match(result.generatorCommit, /^[0-9a-f]{40}$/);
});

test("fails closed when the governed input is modified", () => {
  const root = committedFixture();
  appendFileSync(join(root, INPUT_RELATIVE_PATH), "\n");
  const result = verifySmallRawCustody({ root });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some(({ rule }) => rule === "not-clean"));
  assert.ok(result.findings.some(({ rule }) => rule === "input-size-drift"));
  assert.ok(result.findings.some(({ rule }) => rule === "input-sha256-drift"));
});

test("fails closed when the exact input is present but not tracked", () => {
  const root = committedFixture();
  git(root, "rm", "--cached", "--quiet", "--", INPUT_RELATIVE_PATH);
  const result = verifySmallRawCustody({ root });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some(({ rule }) => rule === "not-tracked"));
  assert.ok(result.findings.some(({ rule }) => rule === "not-clean"));
});
