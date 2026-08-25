#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyGitHubPublicPackageCiCustodyV1 } from "./public-package-ci-custody.mjs";

function fail(message) {
  throw new Error(`PUBLIC_PACKAGE_CI_CUSTODY_INVALID: ${message}`);
}

function parseArguments(arguments_) {
  const allowed = new Map([
    ["--manifest", "manifest"],
    ["--run-json", "run"],
    ["--tarball-artifact-json", "tarballArtifact"],
    ["--receipt-artifact-json", "receiptArtifact"],
  ]);
  const paths = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const argument = arguments_[index];
    const key = allowed.get(argument);
    const value = arguments_[index + 1];
    if (!key || !value || value.startsWith("--") || paths[key] !== undefined) {
      fail("usage requires one manifest and the three exact GitHub API JSON files");
    }
    paths[key] = resolve(value);
  }
  if (arguments_.length !== 8 || [...allowed.values()].some((key) => paths[key] === undefined)) {
    fail("usage requires one manifest and the three exact GitHub API JSON files");
  }
  return paths;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const paths = parseArguments(process.argv.slice(2));
  const [manifest, run, tarballArtifact, receiptArtifact] = await Promise.all([
    readJson(paths.manifest),
    readJson(paths.run),
    readJson(paths.tarballArtifact),
    readJson(paths.receiptArtifact),
  ]);
  const verified = verifyGitHubPublicPackageCiCustodyV1({
    manifest,
    run,
    tarballArtifact,
    receiptArtifact,
  });
  process.stdout.write(`${JSON.stringify(verified)}\n`);
}
