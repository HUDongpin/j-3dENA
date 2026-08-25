#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { comparePublicPackageTrees } from "./public-package-artifact-receipt.mjs";

function fail(message) {
  throw new Error(`PUBLIC_PACKAGE_REPRODUCIBILITY_FAILED: ${message}`);
}

function parseArguments(arguments_) {
  const result = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument !== "--expected" && argument !== "--actual") fail(`unknown argument ${argument}`);
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
    const key = argument === "--expected" ? "expectedDirectory" : "actualDirectory";
    if (result[key] !== undefined) fail(`${argument} may be supplied only once`);
    result[key] = value;
    index += 1;
  }
  if (result.expectedDirectory === undefined || result.actualDirectory === undefined) {
    fail("--expected and --actual are required");
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const result = await comparePublicPackageTrees(options.expectedDirectory, options.actualDirectory);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
