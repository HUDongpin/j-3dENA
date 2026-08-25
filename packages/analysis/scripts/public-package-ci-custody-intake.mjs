#!/usr/bin/env node
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validatePublicPackageCiCustodyV1 } from "./public-package-ci-custody.mjs";

function fail(message) {
  throw new Error(`PUBLIC_PACKAGE_CI_CUSTODY_INVALID: ${message}`);
}

function parseArguments(arguments_) {
  if (
    arguments_.length !== 4
    || arguments_[0] !== "--manifest"
    || !arguments_[1]
    || arguments_[2] !== "--github-output"
    || !arguments_[3]
  ) {
    fail("usage: public-package-ci-custody-intake.mjs --manifest <json> --github-output <path>");
  }
  return { manifestPath: resolve(arguments_[1]), githubOutput: resolve(arguments_[3]) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { manifestPath, githubOutput } = parseArguments(process.argv.slice(2));
  const manifest = validatePublicPackageCiCustodyV1(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  await appendFile(githubOutput, [
    `repository=${manifest.repository}`,
    `workflow-path=${manifest.workflowPath}`,
    `source-head=${manifest.sourceHead}`,
    `producer-run-id=${manifest.producerRunId}`,
    `producer-run-attempt=${manifest.producerRunAttempt}`,
    `tarball-artifact-id=${manifest.tarball.artifactId}`,
    `tarball-digest=${manifest.tarball.sha256}`,
    `receipt-artifact-id=${manifest.receipt.artifactId}`,
    `receipt-digest=${manifest.receipt.sha256}`,
    "",
  ].join("\n"), "utf8");
}
