#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_SARIF_BYTES = 128 * 1024 * 1024;

function fail(message) {
  throw new Error(`SARIF_RESULT_GATE_FAILED: ${message}`);
}

function parseMaximumResults(value) {
  if (!/^(?:0|[1-9]\d*)$/u.test(value ?? "")) {
    fail("--maximum-results must be a non-negative integer");
  }
  return Number(value);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function sarifPaths(pathname) {
  const metadata = await stat(pathname);
  if (metadata.isFile()) return [pathname];
  if (!metadata.isDirectory()) fail("the supplied path is neither a file nor a directory");
  const entries = await readdir(pathname, { withFileTypes: true });
  const paths = entries
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".sarif")
    .map((entry) => resolve(pathname, entry.name))
    .sort();
  if (paths.length === 0) fail("the supplied directory contains no SARIF files");
  return paths;
}

export async function inspectSarifResults({ path, maximumResults = 0 }) {
  const resolvedPath = resolve(path);
  const files = await sarifPaths(resolvedPath);
  const summaries = [];
  let resultCount = 0;

  for (const file of files) {
    const bytes = await readFile(file);
    if (bytes.byteLength > MAX_SARIF_BYTES) fail(`${basename(file)} exceeds the size limit`);
    let document;
    try {
      document = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail(`${basename(file)} is not valid JSON`);
    }
    if (!isRecord(document) || document.version !== "2.1.0" || !Array.isArray(document.runs)) {
      fail(`${basename(file)} is not a supported SARIF 2.1.0 document`);
    }
    let fileResults = 0;
    for (const run of document.runs) {
      if (!isRecord(run) || !isRecord(run.tool) || !isRecord(run.tool.driver)) {
        fail(`${basename(file)} contains a malformed run`);
      }
      if (run.results !== undefined && !Array.isArray(run.results)) {
        fail(`${basename(file)} contains a non-array results field`);
      }
      fileResults += run.results?.length ?? 0;
    }
    resultCount += fileResults;
    summaries.push(Object.freeze({ file: basename(file), runs: document.runs.length, results: fileResults }));
  }

  return Object.freeze({
    ok: resultCount <= maximumResults,
    maximumResults,
    resultCount,
    files: Object.freeze(summaries),
  });
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) fail("arguments must be --name value pairs");
    values.set(key, value);
  }
  if (!values.has("--path")) fail("--path is required");
  return {
    path: values.get("--path"),
    maximumResults: parseMaximumResults(values.get("--maximum-results") ?? "0"),
  };
}

async function main(argv) {
  const result = await inspectSarifResults(parseArguments(argv));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) fail(`observed ${result.resultCount} results; maximum is ${result.maximumResults}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
