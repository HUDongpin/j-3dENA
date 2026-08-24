import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    execFileSync(
      process.execPath,
      [
        resolve(root, "scripts/run-parser-fuzz.mjs"),
        "--root",
        root,
        "--output",
        output,
        "--seeds",
        "00000001,00000002",
        "--cases-per-seed",
        "2",
      ],
      { cwd: root, stdio: "pipe", timeout: 15_000 },
    );
    const receiptPath = join(output, "parser-fuzz-receipt.json");
    const reportPath = join(output, "vitest-report.json");
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
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
