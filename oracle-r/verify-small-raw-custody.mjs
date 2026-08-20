#!/usr/bin/env node

/**
 * Write-free custody check for the frozen small-raw scientific-oracle input.
 *
 * This companion check intentionally uses only Node.js and Git. It does not
 * install or invoke R and is safe to run in ordinary repository validation.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const INPUT_RELATIVE_PATH =
  "packages/parity-contracts/fixtures/small-raw.csv";
export const GENERATOR_RELATIVE_PATH =
  "oracle-r/generate-small-raw-golden.R";
export const EXPECTED_INPUT_SHA256 =
  "163ee849ac316d380e2664067e7389a8114e30d97877c97d6d912e3706c72f16";
export const EXPECTED_INPUT_BYTES = 743;

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function safeRealpath(pathname) {
  try {
    return realpathSync(pathname);
  } catch {
    return resolve(pathname);
  }
}

function isInside(root, pathname) {
  const rel = relative(root, pathname);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

function git(root, arguments_) {
  try {
    return {
      ok: true,
      stdout: execFileSync("git", ["-C", root, ...arguments_], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim(),
      stderr: "",
    };
  } catch (error) {
    return {
      ok: false,
      stdout: typeof error.stdout === "string" ? error.stdout.trim() : "",
      stderr:
        typeof error.stderr === "string"
          ? error.stderr.trim()
          : String(error.message),
    };
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function inspectTrackedFile(root, relativePath, label, findings) {
  const pathname = resolve(root, relativePath);
  if (!isInside(root, pathname)) {
    findings.push({
      rule: "path-escape",
      path: relativePath,
      detail: `${label} resolves outside the generator repository`,
    });
    return;
  }
  if (!existsSync(pathname)) {
    findings.push({
      rule: "missing-file",
      path: relativePath,
      detail: `${label} is missing`,
    });
    return;
  }

  const stat = lstatSync(pathname);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    findings.push({
      rule: "not-regular-file",
      path: relativePath,
      detail: `${label} must be a regular file, not a symlink or special file`,
    });
  }

  const tracked = git(root, ["ls-files", "--error-unmatch", "--", relativePath]);
  if (!tracked.ok || tracked.stdout !== relativePath) {
    findings.push({
      rule: "not-tracked",
      path: relativePath,
      detail: `${label} is not tracked at the fixed repository path`,
    });
  }

  const status = git(root, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    relativePath,
  ]);
  if (!status.ok) {
    findings.push({
      rule: "git-status-failed",
      path: relativePath,
      detail: `${label} custody could not be inspected: ${status.stderr}`,
    });
  } else if (status.stdout !== "") {
    findings.push({
      rule: "not-clean",
      path: relativePath,
      detail: `${label} differs from the generator Git commit: ${status.stdout}`,
    });
  }
}

export function verifySmallRawCustody({ root = DEFAULT_ROOT } = {}) {
  const resolvedRoot = safeRealpath(resolve(root));
  const findings = [];
  let generatorCommit = null;

  const topLevel = git(resolvedRoot, ["rev-parse", "--show-toplevel"]);
  if (!topLevel.ok) {
    findings.push({
      rule: "not-git-repository",
      path: ".",
      detail: `Generator repository cannot be inspected: ${topLevel.stderr}`,
    });
  } else if (safeRealpath(topLevel.stdout) !== resolvedRoot) {
    findings.push({
      rule: "wrong-repository-root",
      path: ".",
      detail: `Expected repository root ${resolvedRoot}; Git reports ${topLevel.stdout}`,
    });
  }

  const head = git(resolvedRoot, ["rev-parse", "--verify", "HEAD"]);
  if (!head.ok || !/^[0-9a-f]{40}$/i.test(head.stdout)) {
    findings.push({
      rule: "missing-generator-commit",
      path: ".",
      detail: "The generator repository must have a concrete Git HEAD commit",
    });
  } else {
    generatorCommit = head.stdout.toLowerCase();
  }

  inspectTrackedFile(
    resolvedRoot,
    GENERATOR_RELATIVE_PATH,
    "Oracle generator",
    findings,
  );
  inspectTrackedFile(
    resolvedRoot,
    INPUT_RELATIVE_PATH,
    "Governed small-raw input",
    findings,
  );

  const inputPath = resolve(resolvedRoot, INPUT_RELATIVE_PATH);
  let inputBytes = null;
  let inputSha256 = null;
  if (existsSync(inputPath) && lstatSync(inputPath).isFile()) {
    const input = readFileSync(inputPath);
    inputBytes = input.byteLength;
    inputSha256 = sha256(input);
    if (inputBytes !== EXPECTED_INPUT_BYTES) {
      findings.push({
        rule: "input-size-drift",
        path: INPUT_RELATIVE_PATH,
        detail: `Expected ${EXPECTED_INPUT_BYTES} bytes; found ${inputBytes}`,
      });
    }
    if (inputSha256 !== EXPECTED_INPUT_SHA256) {
      findings.push({
        rule: "input-sha256-drift",
        path: INPUT_RELATIVE_PATH,
        detail: `Expected ${EXPECTED_INPUT_SHA256}; found ${inputSha256}`,
      });
    }
  }

  findings.sort((left, right) =>
    `${left.path}:${left.rule}`.localeCompare(`${right.path}:${right.rule}`),
  );
  return {
    ok: findings.length === 0,
    root: resolvedRoot,
    generatorCommit,
    input: {
      path: INPUT_RELATIVE_PATH,
      bytes: inputBytes,
      expectedBytes: EXPECTED_INPUT_BYTES,
      sha256: inputSha256,
      expectedSha256: EXPECTED_INPUT_SHA256,
    },
    findings,
  };
}

function parseArguments(argv) {
  let root = DEFAULT_ROOT;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--root requires a path");
      root = resolve(value);
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      process.stdout.write(
        [
          "Usage: node oracle-r/verify-small-raw-custody.mjs [--root <path>]",
          "",
          "Write-free check: fixed hash/size, regular files, Git tracked and clean.",
          "",
        ].join("\n"),
      );
      return null;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { root };
}

if (safeRealpath(process.argv[1] ?? "") === safeRealpath(SCRIPT_PATH)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options) {
      const result = verifySmallRawCustody(options);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = result.ok ? 0 : 1;
    }
  } catch (error) {
    process.stderr.write(`Small-raw custody check error: ${error.message}\n`);
    process.exitCode = 2;
  }
}
