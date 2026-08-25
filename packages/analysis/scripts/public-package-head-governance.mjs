#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  validatePublicPackageArtifactReceiptV2,
  verifyPublicPackageArtifactReceiptV2,
} from "./public-package-artifact-receipt.mjs";
import { PUBLIC_PACKAGE_RELEASE_VERSION } from "./public-package-release-contract.mjs";
import { verifyPublicPackage } from "./verify-public-package.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const packageDirectoryPath = "packages/analysis/dist/package";
const packageDirectory = resolve(repositoryRoot, packageDirectoryPath);
const artifactFilename = `j-3dena-${PUBLIC_PACKAGE_RELEASE_VERSION}.tgz`;
export const PUBLIC_PACKAGE_TARBALL_PATH = `packages/analysis/dist/${artifactFilename}`;
export const PUBLIC_PACKAGE_RECEIPT_PATH = `${PUBLIC_PACKAGE_TARBALL_PATH}.artifact-receipt.json`;
export const PUBLIC_PACKAGE_RUNTIME_INPUT_PATH =
  `packages/compute-service-persistent/deploy/runtime-build-input.${PUBLIC_PACKAGE_RELEASE_VERSION}.json`;

const previousRuntimeInputPath =
  "packages/compute-service-persistent/deploy/runtime-build-input.0.2.0-implemented-unverified.6.json";
const previousRuntimeCandidateDirectory = "output/compute-service-candidate-5d2714e";
const runtimeCandidateFiles = Object.freeze([
  "build-manifest.json",
  "compute-runtime.mjs",
  "scientific-worker-entry.mjs",
]);
const protectedGeneratedPrefixes = Object.freeze([
  "packages/analysis/dist/",
  "packages/compute-service-persistent/deploy/runtime-build-input.",
  "output/compute-service-candidate-",
]);
const requiredContracts = Object.freeze([
  "3dena.compute-dataset-http.v1",
  "3dena.compute-http.v1",
  "3dena.compute-prepared-import-http.v1",
  "3dena.compute-source-result-job-http.v1",
  "3dena.contract.v1",
  "3dena.longitudinal-compute-submission.v2",
]);
const requiredMigrations = Object.freeze([
  Object.freeze({
    path: "packages/compute-service-persistent/migrations/0001_persistent_compute.sql",
    version: "0001-persistent-compute",
  }),
  Object.freeze({
    path: "packages/compute-service-persistent/migrations/0002_persistent_control_plane.sql",
    version: "0002-persistent-control-plane",
  }),
  Object.freeze({
    path: "packages/compute-service-persistent/migrations/0003_build_approval_v3.sql",
    version: "0003-build-approval-v3",
  }),
  Object.freeze({
    path: "packages/compute-service-persistent/migrations/0004_scientific_result_generations.sql",
    version: "0004-scientific-result-generations",
  }),
]);
const requiredJena = Object.freeze({
  jenaVersion: "0.7.0-ona.0",
  jenaCommit: "90790856f00bdef63dbd27fc3a5b502e8cffe65f",
  jenaTarballIntegrity: "sha512-gBhKP9d7C3akXTPlU03AJHBs+dBBDt1TUFGx96P/pB/s0GEGGX2aZFLJGWf9HLc+wuBJIjrJn7tIGicg1WQflQ==",
});
const fullCommit = /^[0-9a-f]{40}$/u;

function fail(message) {
  throw new Error(`PUBLIC_PACKAGE_HEAD_REJECTED: ${message}`);
}

function exactObject(value, keys, path) {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")
  ) {
    fail(`${path} must contain exact fields`);
  }
  return value;
}

function packagePaths(files) {
  return files.map((path) => `${packageDirectoryPath}/${path}`);
}

function exactPathSets({ currentPackageFiles, previousPackageFiles, runtimeCandidateSourceCommit }) {
  const artifact = new Set([
    PUBLIC_PACKAGE_TARBALL_PATH,
    PUBLIC_PACKAGE_RECEIPT_PATH,
    ...packagePaths(currentPackageFiles),
    ...packagePaths(previousPackageFiles),
  ]);
  const runtimeInput = new Set([previousRuntimeInputPath, PUBLIC_PACKAGE_RUNTIME_INPUT_PATH]);
  const runtimeCandidate = new Set();
  if (fullCommit.test(runtimeCandidateSourceCommit ?? "")) {
    const currentDirectory = `output/compute-service-candidate-${runtimeCandidateSourceCommit.slice(0, 7)}`;
    for (const file of runtimeCandidateFiles) {
      runtimeCandidate.add(`${previousRuntimeCandidateDirectory}/${file}`);
      runtimeCandidate.add(`${currentDirectory}/${file}`);
    }
  }
  return { artifact, runtimeInput, runtimeCandidate };
}

function validateChangedPaths(changedPaths) {
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) {
    fail("HEAD has no changed paths");
  }
  if (
    changedPaths.some((path) => typeof path !== "string" || path.length === 0 || path.includes("\0"))
    || new Set(changedPaths).size !== changedPaths.length
  ) {
    fail("HEAD changed paths are invalid");
  }
}

export function resolveEffectivePublicPackageHead({
  checkoutHead,
  parents,
  checkoutTree,
  secondParentTree,
}) {
  if (!fullCommit.test(checkoutHead) || !Array.isArray(parents) || !parents.every((value) => fullCommit.test(value))) {
    fail("Git HEAD identities are invalid");
  }
  if (parents.length === 1) {
    return Object.freeze({ checkoutHead, effectiveHead: checkoutHead, mergeWrapper: false });
  }
  if (parents.length !== 2) {
    fail("HEAD must be a one-parent commit or a strict two-parent merge wrapper");
  }
  if (!fullCommit.test(checkoutTree ?? "") || checkoutTree !== secondParentTree) {
    fail("merge wrapper tree must exactly equal its second parent C tree");
  }
  return Object.freeze({ checkoutHead, effectiveHead: parents[1], mergeWrapper: true });
}

function isProtectedGeneratedPath(path) {
  return protectedGeneratedPrefixes.some((prefix) => path.startsWith(prefix));
}

export function classifyPublicPackageHeadPaths({
  changedPaths,
  hasCurrentReceipt,
  currentPackageFiles = [],
  previousPackageFiles = [],
  runtimeCandidateSourceCommit,
}) {
  validateChangedPaths(changedPaths);
  const sets = exactPathSets({
    currentPackageFiles,
    previousPackageFiles,
    runtimeCandidateSourceCommit,
  });
  const families = new Set();
  let hasSourcePath = false;

  for (const path of changedPaths) {
    if (!isProtectedGeneratedPath(path)) {
      hasSourcePath = true;
      continue;
    }
    const family = Object.entries(sets).find(([, paths]) => paths.has(path))?.[0];
    if (family === undefined) fail(`${path} is not an exact allowed generated path`);
    families.add(family);
  }

  if (hasSourcePath && families.size > 0) fail("HEAD mixes source and generated paths");
  if (families.size === 0) {
    if (hasCurrentReceipt) fail("source change is forbidden after the current public-package receipt already exists");
    return Object.freeze({ kind: "source", stage: "source" });
  }
  if (families.size !== 1) fail("HEAD changes multiple generated stages");

  const [stage] = families;
  const changed = new Set(changedPaths);
  if (stage === "artifact") {
    if (
      !changed.has(PUBLIC_PACKAGE_TARBALL_PATH)
      || !changed.has(PUBLIC_PACKAGE_RECEIPT_PATH)
      || !changedPaths.some((path) => path.startsWith(`${packageDirectoryPath}/`))
    ) {
      fail("artifact commit must add the exact package tree, tarball, and receipt together");
    }
  } else if (stage === "runtimeInput") {
    if (!changed.has(previousRuntimeInputPath) || !changed.has(PUBLIC_PACKAGE_RUNTIME_INPUT_PATH)) {
      fail("runtime input commit must replace the exact prior input");
    }
  } else if (stage === "runtimeCandidate") {
    if (!fullCommit.test(runtimeCandidateSourceCommit ?? "")) {
      fail("runtime candidate has no exact source commit");
    }
    const expected = sets.runtimeCandidate;
    if (changed.size !== expected.size || [...expected].some((path) => !changed.has(path))) {
      fail("runtime candidate commit must replace exactly the three prior candidate files");
    }
  }
  const publicStage = stage === "runtimeInput"
    ? "runtime-input"
    : stage === "runtimeCandidate"
      ? "runtime-candidate"
      : stage;
  return Object.freeze({ kind: "generated", stage: publicStage });
}

function assertGeneratedHistoryPaths({
  changedPaths,
  currentPackageFiles,
  sourcePackageFiles,
  runtimeCandidateSourceCommit,
}) {
  const sets = exactPathSets({
    currentPackageFiles,
    previousPackageFiles: sourcePackageFiles,
    runtimeCandidateSourceCommit,
  });
  const allowed = new Set(Object.values(sets).flatMap((paths) => [...paths]));
  for (const path of changedPaths) {
    if (!allowed.has(path)) fail(`generated history changes forbidden source or unknown path ${path}`);
  }
}

function git(arguments_, options = {}) {
  try {
    const result = execFileSync("git", arguments_, {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      ...options,
    });
    return Buffer.isBuffer(result) ? result : result.trim();
  } catch {
    fail(`Git command failed: git ${arguments_.join(" ")}`);
  }
}

function gitPaths(arguments_) {
  const output = git(arguments_, { encoding: "buffer" });
  return output.length === 0
    ? []
    : output.toString("utf8").split("\0").filter(Boolean);
}

function isTracked(path, treeish) {
  try {
    execFileSync("git", treeish === undefined
      ? ["ls-files", "--error-unmatch", "--", path]
      : ["cat-file", "-e", `${treeish}:${path}`], {
      cwd: repositoryRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function trackedPathsAt(treeish, prefix) {
  return gitPaths(["ls-tree", "-r", "--name-only", "-z", treeish, "--", prefix]);
}

function assertTrackedRegularFiles(paths) {
  for (const path of paths) {
    const record = git(["ls-files", "--stage", "--", path]);
    const records = record.split("\n").filter(Boolean);
    if (records.length !== 1 || !/^100(?:644|755) [0-9a-f]{40,64} 0\t/u.test(records[0])) {
      fail(`${path} must be one tracked regular file`);
    }
  }
}

export function validatePublicRuntimeInput(value, expectedBuildId) {
  const input = exactObject(value, [
    "schemaVersion",
    "approvedLongitudinalBuild",
    "migrations",
    "contractVersions",
  ], "runtime input");
  const build = exactObject(input.approvedLongitudinalBuild, [
    "jenaVersion",
    "jenaCommit",
    "jenaTarballIntegrity",
    "sdkVersion",
    "buildId",
  ], "runtime input approvedLongitudinalBuild");
  if (
    input.schemaVersion !== "3dena.compute-runtime-build-input.v4"
    || JSON.stringify(input.migrations) !== JSON.stringify(requiredMigrations)
    || JSON.stringify(input.contractVersions) !== JSON.stringify(requiredContracts)
    || build.sdkVersion !== PUBLIC_PACKAGE_RELEASE_VERSION
    || build.buildId !== expectedBuildId
    || build.jenaVersion !== requiredJena.jenaVersion
    || build.jenaCommit !== requiredJena.jenaCommit
    || build.jenaTarballIntegrity !== requiredJena.jenaTarballIntegrity
  ) {
    fail("runtime input is not exactly bound to receipt source S and release v7");
  }
  return input;
}

function findRuntimeCandidateSourceCommit(changedPaths) {
  const manifests = changedPaths.filter((path) =>
    path.startsWith("output/compute-service-candidate-")
    && path.endsWith("/build-manifest.json")
    && !path.startsWith(`${previousRuntimeCandidateDirectory}/`));
  if (manifests.length === 0) return undefined;
  if (manifests.length !== 1) fail("runtime candidate commit contains multiple new manifests");
  return readFile(resolve(repositoryRoot, manifests[0]), "utf8")
    .then((text) => JSON.parse(text).sourceCommit);
}

async function verifyGeneratedHead({ head, parent, stage, receipt }) {
  const sourceHead = receipt.source.repositoryHead;
  if (!fullCommit.test(sourceHead) || sourceHead === head) fail("receipt source S is not a distinct full commit");
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sourceHead, head], {
      cwd: repositoryRoot,
      stdio: "ignore",
    });
  } catch {
    fail("receipt source S is not an ancestor of generated HEAD");
  }
  if (isTracked(PUBLIC_PACKAGE_RECEIPT_PATH, sourceHead)) {
    fail("receipt source S already contains the v7 artifact receipt");
  }

  const currentPackageFiles = receipt.npmPack.files.map(({ path }) => path);
  const trackedPackagePaths = gitPaths(["ls-files", "-z", "--", `${packageDirectoryPath}/`]);
  const expectedPackagePaths = packagePaths(currentPackageFiles);
  if (
    trackedPackagePaths.length !== expectedPackagePaths.length
    || expectedPackagePaths.some((path) => !trackedPackagePaths.includes(path))
  ) {
    fail("tracked public package tree differs from the strict receipt inventory");
  }
  assertTrackedRegularFiles([
    PUBLIC_PACKAGE_TARBALL_PATH,
    PUBLIC_PACKAGE_RECEIPT_PATH,
    ...expectedPackagePaths,
  ]);

  let runtimeCandidateSourceCommit;
  const candidateManifests = gitPaths([
    "ls-files",
    "-z",
    "--",
    "output/compute-service-candidate-*/build-manifest.json",
  ]).filter((path) => !path.startsWith(`${previousRuntimeCandidateDirectory}/`));
  if (candidateManifests.length > 1) fail("more than one current runtime candidate is tracked");
  if (candidateManifests.length === 1) {
    const manifest = JSON.parse(await readFile(resolve(repositoryRoot, candidateManifests[0]), "utf8"));
    runtimeCandidateSourceCommit = manifest.sourceCommit;
  }

  const historyPaths = gitPaths(["diff", "--name-only", "-z", `${sourceHead}..${head}`]);
  const sourcePackageFiles = trackedPathsAt(sourceHead, packageDirectoryPath)
    .map((path) => path.slice(`${packageDirectoryPath}/`.length));
  assertGeneratedHistoryPaths({
    changedPaths: historyPaths,
    currentPackageFiles,
    sourcePackageFiles,
    runtimeCandidateSourceCommit,
  });

  await verifyPublicPackageArtifactReceiptV2({
    receipt,
    packageDirectory,
    tarballPath: resolve(repositoryRoot, PUBLIC_PACKAGE_TARBALL_PATH),
  });
  await verifyPublicPackage(packageDirectory, { artifactReceipt: receipt, expectedSourceHead: sourceHead });

  if (stage === "artifact") {
    if (parent !== sourceHead) fail("artifact A must be the direct child of receipt source S");
    if (isTracked(PUBLIC_PACKAGE_RUNTIME_INPUT_PATH)) fail("artifact A must not contain the v7 runtime input");
  } else {
    if (!isTracked(PUBLIC_PACKAGE_RUNTIME_INPUT_PATH)) fail("generated runtime stage is missing tracked v7 input");
    assertTrackedRegularFiles([PUBLIC_PACKAGE_RUNTIME_INPUT_PATH]);
    const input = JSON.parse(await readFile(resolve(repositoryRoot, PUBLIC_PACKAGE_RUNTIME_INPUT_PATH), "utf8"));
    validatePublicRuntimeInput(input, sourceHead);
  }

  if (stage === "runtime-candidate") {
    if (runtimeCandidateSourceCommit !== parent) {
      fail("runtime candidate C must be built from its direct runtime-input parent");
    }
    const candidateDirectoryPath = `output/compute-service-candidate-${parent.slice(0, 7)}`;
    const candidatePaths = runtimeCandidateFiles.map((file) => `${candidateDirectoryPath}/${file}`);
    const trackedCandidates = gitPaths(["ls-files", "-z", "--", `${candidateDirectoryPath}/`]);
    if (
      trackedCandidates.length !== candidatePaths.length
      || candidatePaths.some((path) => !trackedCandidates.includes(path))
      || runtimeCandidateFiles.some((file) => isTracked(`${previousRuntimeCandidateDirectory}/${file}`))
    ) {
      fail("runtime candidate C must track exactly its three source-bound files and replace v6");
    }
    assertTrackedRegularFiles(candidatePaths);
    const parentPaths = gitPaths(["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", parent]);
    const expectedInputPaths = new Set([previousRuntimeInputPath, PUBLIC_PACKAGE_RUNTIME_INPUT_PATH]);
    if (parentPaths.length !== 2 || parentPaths.some((path) => !expectedInputPaths.has(path))) {
      fail("runtime candidate parent is not the exact runtime-input stage");
    }
    execFileSync(process.execPath, [
      resolve(repositoryRoot, "packages/compute-service-persistent/deploy/verify-runtime-bundle.mjs"),
      resolve(repositoryRoot, candidateDirectoryPath),
      PUBLIC_PACKAGE_RELEASE_VERSION,
      sourceHead,
      parent,
    ], { cwd: repositoryRoot, stdio: "pipe" });
  } else if (runtimeCandidateSourceCommit !== undefined) {
    fail("artifact or runtime-input stage must not track a v7 runtime candidate");
  }

  return sourceHead;
}

async function classifyHead() {
  if (git(["status", "--porcelain=v1", "--untracked-files=all"]) !== "") {
    fail("worktree must be exactly clean");
  }
  const checkoutIdentities = git(["rev-list", "--parents", "-n", "1", "HEAD"]).split(" ");
  const checkoutHead = checkoutIdentities[0];
  const checkoutParents = checkoutIdentities.slice(1);
  const wrapper = resolveEffectivePublicPackageHead({
    checkoutHead,
    parents: checkoutParents,
    checkoutTree: checkoutParents.length === 2 ? git(["rev-parse", `${checkoutHead}^{tree}`]) : undefined,
    secondParentTree: checkoutParents.length === 2 ? git(["rev-parse", `${checkoutParents[1]}^{tree}`]) : undefined,
  });
  const effectiveIdentities = git(["rev-list", "--parents", "-n", "1", wrapper.effectiveHead]).split(" ");
  if (effectiveIdentities.length !== 2 || !effectiveIdentities.every((value) => fullCommit.test(value))) {
    fail("effective S/A/C HEAD must be a non-merge commit with exactly one parent");
  }
  const [head, parent] = effectiveIdentities;
  const changedPaths = gitPaths(["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", head]);
  const hasCurrentReceipt = isTracked(PUBLIC_PACKAGE_RECEIPT_PATH);
  let receipt;
  let currentPackageFiles = [];
  if (hasCurrentReceipt) {
    receipt = validatePublicPackageArtifactReceiptV2(
      JSON.parse(await readFile(resolve(repositoryRoot, PUBLIC_PACKAGE_RECEIPT_PATH), "utf8")),
    );
    currentPackageFiles = receipt.npmPack.files.map(({ path }) => path);
  }
  const previousPackageFiles = trackedPathsAt(parent, packageDirectoryPath)
    .map((path) => path.slice(`${packageDirectoryPath}/`.length));
  const runtimeCandidateSourceCommit = await findRuntimeCandidateSourceCommit(changedPaths);
  const classification = classifyPublicPackageHeadPaths({
    changedPaths,
    hasCurrentReceipt,
    currentPackageFiles,
    previousPackageFiles,
    runtimeCandidateSourceCommit,
  });
  const sourceHead = classification.kind === "source"
    ? head
    : await verifyGeneratedHead({ head, parent, stage: classification.stage, receipt });
  return Object.freeze({
    ...classification,
    checkoutHead: wrapper.checkoutHead,
    head,
    mergeWrapper: wrapper.mergeWrapper,
    sourceHead,
  });
}

function parseArguments(arguments_) {
  if (arguments_.length === 0) return {};
  if (arguments_.length === 2 && arguments_[0] === "--github-output" && arguments_[1]) {
    return { githubOutput: resolve(arguments_[1]) };
  }
  fail("usage: public-package-head-governance.mjs [--github-output <path>]");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { githubOutput } = parseArguments(process.argv.slice(2));
  const result = await classifyHead();
  if (githubOutput !== undefined) {
    await appendFile(githubOutput, [
      `kind=${result.kind}`,
      `stage=${result.stage}`,
      `checkout-head=${result.checkoutHead}`,
      `head=${result.head}`,
      `source-head=${result.sourceHead}`,
      "",
    ].join("\n"), "utf8");
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
