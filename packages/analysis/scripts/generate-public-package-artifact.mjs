#!/usr/bin/env node

import { execFile, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicPackageArtifactReceiptV2,
  hashRegularFileTree,
  verifyPublicPackageArtifactReceiptV2,
} from "./public-package-artifact-receipt.mjs";
import { verifyPublicPackage } from "./verify-public-package.mjs";

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const analysisDirectory = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(analysisDirectory, "../..");

function fail(message) {
  throw new Error(`PUBLIC_PACKAGE_ARTIFACT_GENERATION_FAILED: ${message}`);
}

function defaultReadRepositoryHead(root) {
  let head;
  try {
    head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`unable to read the source HEAD: ${detail}`);
  }
  if (!/^[0-9a-f]{40}$/u.test(head)) fail("source HEAD is not a full Git commit identity");
  return head;
}

async function defaultRunNpmPack(args) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) fail("npm_execpath is required; invoke this generator through npm");
  const { stdout } = await execFileAsync(process.execPath, [npmCli, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_update_notifier: "false",
    },
  });
  return stdout;
}

function parseSinglePackReceipt(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    fail("npm pack did not emit valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) fail("npm pack must emit exactly one receipt");
  return parsed[0];
}

function assertSeparateOutputDirectory(packageDirectory, outputDirectory) {
  const path = relative(packageDirectory, outputDirectory);
  if (path === "" || (!path.startsWith("..") && !isAbsolute(path))) {
    fail("artifact output directory must be outside the staged package tree");
  }
}

export async function generatePublicPackageArtifact({
  repositoryRoot: sourceRoot = repositoryRoot,
  packageDirectory: packagePath = resolve(analysisDirectory, "dist/package"),
  outputDirectory: outputPath,
  readRepositoryHead = defaultReadRepositoryHead,
  verifyPackage = verifyPublicPackage,
  runNpmPack = defaultRunNpmPack,
}) {
  if (outputPath === undefined) fail("an explicit output directory is required");
  const packageDirectory = resolve(packagePath);
  const outputDirectory = resolve(outputPath);
  assertSeparateOutputDirectory(packageDirectory, outputDirectory);
  await mkdir(outputDirectory, { recursive: true });

  const sourceHead = readRepositoryHead(resolve(sourceRoot));
  if (!/^[0-9a-f]{40}$/u.test(sourceHead)) fail("source HEAD is not a full Git commit identity");
  await verifyPackage(packageDirectory, { expectedSourceHead: sourceHead });
  const treeBeforePack = await hashRegularFileTree(packageDirectory);
  const stdout = await runNpmPack([
    "pack",
    packageDirectory,
    "--json",
    "--pack-destination",
    outputDirectory,
  ]);
  const npmPackReceipt = parseSinglePackReceipt(stdout);
  if (typeof npmPackReceipt?.filename !== "string" || npmPackReceipt.filename.length === 0) {
    fail("npm pack receipt is missing its filename");
  }
  const tarballPath = resolve(outputDirectory, npmPackReceipt.filename);
  if (dirname(tarballPath) !== outputDirectory) fail("npm pack returned an unsafe tarball filename");
  const treeAfterPack = await hashRegularFileTree(packageDirectory);
  if (JSON.stringify(treeAfterPack) !== JSON.stringify(treeBeforePack)) {
    fail("npm pack mutated the staged public package tree");
  }

  const receipt = await createPublicPackageArtifactReceiptV2({
    packageDirectory,
    tarballPath,
    npmPackReceipt,
    sourceHead,
  });
  const receiptPath = `${tarballPath}.artifact-receipt.json`;
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await verifyPublicPackageArtifactReceiptV2({ receipt, packageDirectory, tarballPath });
  return Object.freeze({
    sourceHead,
    packageDirectory,
    tarballPath,
    receiptPath,
    treeSha256: receipt.tree.sha256,
    tarballSha256: receipt.tarball.sha256,
  });
}

function parseArguments(arguments_) {
  const result = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument !== "--package" && argument !== "--output-directory") fail(`unknown argument ${argument}`);
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
    const key = argument === "--package" ? "packageDirectory" : "outputDirectory";
    if (result[key] !== undefined) fail(`${argument} may be supplied only once`);
    result[key] = value;
    index += 1;
  }
  if (result.packageDirectory === undefined) fail("--package is required");
  if (result.outputDirectory === undefined) fail("--output-directory is required");
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const result = await generatePublicPackageArtifact(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
