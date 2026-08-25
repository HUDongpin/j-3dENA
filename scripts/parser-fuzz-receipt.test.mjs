import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  inspectParserFuzzReceipt,
  normalizeParserFuzzCases,
  normalizeParserFuzzSeeds,
} from "./parser-fuzz-receipt.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("normalizes replayable parser fuzz inputs and rejects ambiguity", () => {
  assert.deepEqual(normalizeParserFuzzSeeds("0x1,deadBEEF"), ["00000001", "deadbeef"]);
  assert.equal(normalizeParserFuzzCases("2048"), 2_048);
  assert.throws(() => normalizeParserFuzzSeeds("1,00000001"));
  assert.throws(() => normalizeParserFuzzSeeds("not-a-seed"));
  assert.throws(() => normalizeParserFuzzCases(2_049));
});

test("generates a source-bound receipt and rejects artifact tampering", { timeout: 20_000 }, () => {
  const temporary = mkdtempSync(join(tmpdir(), "3dena-parser-fuzz-receipt-"));
  try {
    const output = join(temporary, "evidence");
    const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    execFileSync(
      process.execPath,
      [
        resolve(root, "scripts/run-parser-fuzz.mjs"),
        "--root",
        root,
        "--source-head",
        gitCommit,
        "--output",
        output,
        "--seeds",
        "00000001,00000002",
        "--cases-per-seed",
        "2",
      ],
      {
        cwd: root,
        env: { ...process.env, GITHUB_SHA: "f".repeat(40) },
        stdio: "pipe",
        timeout: 15_000,
      },
    );
    const receiptPath = join(output, "parser-fuzz-receipt.json");
    const reportPath = join(output, "vitest-report.json");
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    const valid = inspectParserFuzzReceipt({
      receipt,
      root,
      expectedGitCommit: gitCommit,
      vitestReportPath: reportPath,
    });
    assert.equal(valid.ok, true, JSON.stringify(valid.findings, null, 2));
    assert.equal(receipt.totalCases, 20);

    receipt.targets[0].strategies[0].accepted += 1;
    writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
    const tampered = inspectParserFuzzReceipt({
      receipt: JSON.parse(readFileSync(receiptPath, "utf8")),
      root,
      expectedGitCommit: gitCommit,
      vitestReportPath: reportPath,
    });
    assert.equal(tampered.ok, false);
    assert.ok(tampered.findings.some(({ rule }) => rule === "target-contract"));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("rejects an explicit source-head mismatch before creating evidence", () => {
  const temporary = mkdtempSync(join(tmpdir(), "3dena-parser-fuzz-source-head-"));
  try {
    const output = join(temporary, "evidence");
    const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const result = spawnSync(
      process.execPath,
      [
        resolve(root, "scripts/run-parser-fuzz.mjs"),
        "--root",
        root,
        "--source-head",
        "0".repeat(40),
        "--output",
        output,
        "--seeds",
        "00000001",
        "--cases-per-seed",
        "1",
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, GITHUB_SHA: gitCommit },
        timeout: 5_000,
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /source head does not match the checked-out parser fuzz source/u);
    assert.equal(existsSync(output), false);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("rejects an ambient SHA mismatch and malformed explicit source heads", () => {
  const temporary = mkdtempSync(join(tmpdir(), "3dena-parser-fuzz-invalid-head-"));
  const cases = [
    {
      label: "ambient mismatch",
      extraArguments: [],
      githubSha: "f".repeat(40),
      error: /source head does not match the checked-out parser fuzz source/u,
    },
    {
      label: "uppercase explicit head",
      extraArguments: ["--source-head", "A".repeat(40)],
      githubSha: undefined,
      error: /--source-head must be a full lowercase Git commit/u,
    },
    {
      label: "short explicit head",
      extraArguments: ["--source-head", "abc123"],
      githubSha: undefined,
      error: /--source-head must be a full lowercase Git commit/u,
    },
  ];
  try {
    for (const [index, scenario] of cases.entries()) {
      const output = join(temporary, `evidence-${index}`);
      const env = { ...process.env };
      if (scenario.githubSha === undefined) delete env.GITHUB_SHA;
      else env.GITHUB_SHA = scenario.githubSha;
      const result = spawnSync(
        process.execPath,
        [
          resolve(root, "scripts/run-parser-fuzz.mjs"),
          "--root",
          root,
          ...scenario.extraArguments,
          "--output",
          output,
        ],
        { cwd: root, encoding: "utf8", env, timeout: 5_000 },
      );
      assert.equal(result.status, 1, scenario.label);
      assert.match(result.stderr, scenario.error, scenario.label);
      assert.equal(existsSync(output), false, scenario.label);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("the parser-fuzz workflow checks out and binds the exact event source head", () => {
  const workflow = readFileSync(resolve(root, ".github/workflows/parser-fuzz.yml"), "utf8");
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u);
  assert.match(workflow, /PARSER_FUZZ_SOURCE_HEAD: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u);
  assert.match(workflow, /--source-head "\$PARSER_FUZZ_SOURCE_HEAD"/u);
  assert.match(workflow, /\$\{PARSER_FUZZ_SOURCE_HEAD:0:8\}/u);
  assert.doesNotMatch(workflow, /\$\{GITHUB_SHA:0:8\}/u);
});
