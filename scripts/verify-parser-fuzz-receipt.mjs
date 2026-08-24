#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectParserFuzzReceipt } from "./parser-fuzz-receipt.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function samePath(left, right) {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return resolve(left) === resolve(right);
  }
}

function parseArguments(argv) {
  const options = { root: DEFAULT_ROOT, receipt: null, report: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root" && argv[index + 1]) {
      options.root = resolve(argv[++index]);
    } else if (argument === "--receipt" && argv[index + 1]) {
      options.receipt = resolve(argv[++index]);
    } else if (argument === "--report" && argv[index + 1]) {
      options.report = resolve(argv[++index]);
    } else if (argument === "--help" || argument === "-h") {
      process.stdout.write(
        "Usage: node scripts/verify-parser-fuzz-receipt.mjs --receipt <json> --report <vitest-json> [--root <path>]\n",
      );
      return null;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  if (options.receipt === null || options.report === null) {
    throw new Error("--receipt and --report are required.");
  }
  return options;
}

function verify(options) {
  const expectedGitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: options.root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const receipt = JSON.parse(readFileSync(options.receipt, "utf8"));
  const result = inspectParserFuzzReceipt({
    receipt,
    root: options.root,
    expectedGitCommit,
    vitestReportPath: options.report,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

if (samePath(process.argv[1] ?? "", SCRIPT_PATH)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options !== null) verify(options);
  } catch (error) {
    process.stderr.write(
      `Parser fuzz receipt verifier failed with ${error?.constructor?.name ?? "Error"}.\n`,
    );
    process.exitCode = 2;
  }
}
