#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createParserFuzzReceipt,
  inspectParserFuzzReceipt,
  normalizeParserFuzzCases,
  normalizeParserFuzzSeeds,
} from "./parser-fuzz-receipt.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MAX_OLD_SPACE_MB = 1_024;

function samePath(left, right) {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return resolve(left) === resolve(right);
  }
}

function parseArguments(argv) {
  const options = {
    root: DEFAULT_ROOT,
    output: null,
    seeds: "3de02026,656e6133",
    casesPerSeed: 128,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root" && argv[index + 1]) {
      options.root = resolve(argv[++index]);
    } else if (argument === "--output" && argv[index + 1]) {
      options.output = resolve(argv[++index]);
    } else if (argument === "--seeds" && argv[index + 1]) {
      options.seeds = argv[++index];
    } else if (argument === "--cases-per-seed" && argv[index + 1]) {
      options.casesPerSeed = normalizeParserFuzzCases(argv[++index]);
    } else if (argument === "--help" || argument === "-h") {
      process.stdout.write(
        "Usage: node scripts/run-parser-fuzz.mjs --output <new-directory> [--seeds <hex,hex>] [--cases-per-seed <1..2048>] [--root <path>]\n",
      );
      return null;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  if (options.output === null) throw new Error("--output requires a new evidence directory.");
  options.seeds = normalizeParserFuzzSeeds(options.seeds);
  options.casesPerSeed = normalizeParserFuzzCases(options.casesPerSeed);
  return options;
}

function exactCommit(root) {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error("Exact Git commit is unavailable.");
  if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== commit) {
    throw new Error("GitHub SHA does not match the checked-out parser fuzz source.");
  }
  return commit;
}

function run(options) {
  if (existsSync(options.output)) {
    throw new Error("Parser fuzz evidence directory already exists; refusing to overwrite it.");
  }
  mkdirSync(options.output, { recursive: true });
  const fragmentsDirectory = resolve(options.output, "fragments");
  mkdirSync(fragmentsDirectory);
  const reportPath = resolve(options.output, "vitest-report.json");
  const receiptPath = resolve(options.output, "parser-fuzz-receipt.json");
  const vitestPath = resolve(options.root, "node_modules/vitest/vitest.mjs");
  const startedAt = new Date().toISOString();
  const result = spawnSync(
    process.execPath,
    [
      vitestPath,
      "run",
      "packages/io/src/parser-fuzz.test.ts",
      "packages/tabular-import/src/parser-fuzz.test.ts",
      "--reporter=json",
      `--outputFile=${reportPath}`,
    ],
    {
      cwd: options.root,
      env: {
        ...process.env,
        NODE_OPTIONS: `--max-old-space-size=${MAX_OLD_SPACE_MB}`,
        PARSER_FUZZ_CASES_PER_SEED: String(options.casesPerSeed),
        PARSER_FUZZ_EVIDENCE_DIR: fragmentsDirectory,
        PARSER_FUZZ_SEEDS: options.seeds.join(","),
      },
      stdio: "inherit",
      timeout: 15 * 60 * 1_000,
    },
  );
  const completedAt = new Date().toISOString();
  if (result.error) throw result.error;
  if (result.signal !== null || result.status !== 0) {
    throw new Error(`Parser fuzz Vitest execution failed with status ${result.status ?? "signal"}.`);
  }

  const gitCommit = exactCommit(options.root);
  const receipt = createParserFuzzReceipt({
    root: options.root,
    gitCommit,
    seeds: options.seeds,
    casesPerSeed: options.casesPerSeed,
    evidenceDirectory: fragmentsDirectory,
    vitestReportPath: reportPath,
    startedAt,
    completedAt,
    maxOldSpaceMb: MAX_OLD_SPACE_MB,
    runIdentity: {
      repository: process.env.GITHUB_REPOSITORY,
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      workflowRef: process.env.GITHUB_WORKFLOW_REF,
    },
  });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  const verification = inspectParserFuzzReceipt({
    receipt,
    root: options.root,
    expectedGitCommit: gitCommit,
    vitestReportPath: reportPath,
  });
  if (!verification.ok) throw new Error("Generated parser fuzz receipt failed verification.");
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: receipt.schemaVersion,
      status: receipt.status,
      gitCommit: receipt.gitCommit,
      totalCases: receipt.totalCases,
      sourceBundleSha256: receipt.sourceBundleSha256,
      vitestReportSha256: receipt.vitestReportSha256,
      receiptPath,
    }, null, 2)}\n`,
  );
}

if (samePath(process.argv[1] ?? "", SCRIPT_PATH)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options !== null) run(options);
  } catch (error) {
    process.stderr.write(
      `Parser fuzz execution failed with ${error?.constructor?.name ?? "Error"}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
