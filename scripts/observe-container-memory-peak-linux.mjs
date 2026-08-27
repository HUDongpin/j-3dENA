#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const RECEIPT_VERSION = "3dena.container-memory-peak-host-cgroup-observation.v1";
const MEMORY_LIMIT_BYTES = 2_147_483_648;
const HOST_OBSERVER_TIMEOUT_MS = 70_000;
const LOWER_SHA256 = /^[a-f0-9]{64}$/u;
const GIT_COMMIT = /^[a-f0-9]{40}$/u;
const CONTAINER_ID = /^[a-f0-9]{64}$/u;
const MAX_CONTROL_FILE_BYTES = 64 * 1024;

function fail(message) {
  throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function insideOrEqual(root, path) {
  const pathRelative = relative(root, path);
  return pathRelative === "" || (pathRelative !== ".." && !pathRelative.startsWith(`..${sep}`));
}

function readBoundedRegularFile(path, label) {
  const requested = resolve(path);
  const metadata = lstatSync(requested, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n ||
      metadata.size < 1n || metadata.size > BigInt(MAX_CONTROL_FILE_BYTES)) {
    fail(`${label} must be a bounded single-link regular file.`);
  }
  const descriptor = openSync(requested, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.dev !== metadata.dev || opened.ino !== metadata.ino ||
        opened.nlink !== 1n || opened.size !== metadata.size) {
      fail(`${label} changed during secure open.`);
    }
    return readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
}

function strictCgroupInteger(text, label, { positive = false } = {}) {
  const value = text.trim();
  if (!/^[0-9]+$/u.test(value)) fail(`${label} must be a finite cgroup integer.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || (positive && number === 0)) {
    fail(`${label} is outside the safe cgroup range.`);
  }
  return number;
}

function parsePopulated(text) {
  const entries = new Map();
  for (const line of text.trim().split("\n")) {
    const match = /^([a-z_]+) ([01])$/u.exec(line);
    if (!match || entries.has(match[1])) fail("cgroup.events is malformed or duplicated.");
    entries.set(match[1], Number(match[2]));
  }
  if (!entries.has("populated")) fail("cgroup.events lacks populated state.");
  return entries.get("populated");
}

function resolveTargetCgroup({ targetPid, procRoot, cgroupRoot }) {
  if (!Number.isSafeInteger(targetPid) || targetPid < 1) fail("targetPid must be a positive integer.");
  const canonicalProcRoot = realpathSync(resolve(procRoot));
  const canonicalCgroupRoot = realpathSync(resolve(cgroupRoot));
  const controllers = readBoundedRegularFile(
    join(canonicalCgroupRoot, "cgroup.controllers"),
    "cgroup v2 controllers",
  ).trim().split(/\s+/u);
  if (!controllers.includes("memory")) fail("host cgroup v2 memory controller is required.");
  const membership = readBoundedRegularFile(
    join(canonicalProcRoot, String(targetPid), "cgroup"),
    "target process cgroup membership",
  ).trim().split("\n");
  if (membership.length !== 1 || !membership[0].startsWith("0::/")) {
    fail("target process must have one unified cgroup v2 membership.");
  }
  const relativeCgroup = membership[0].slice(4);
  if (relativeCgroup === "" || relativeCgroup.split("/").some((part) => part === "" || part === "." || part === "..") ||
      relativeCgroup.includes("\\") || /[\u0000-\u001f]/u.test(relativeCgroup)) {
    fail("target cgroup membership must be a normalized contained path.");
  }
  const target = resolve(canonicalCgroupRoot, relativeCgroup);
  if (!insideOrEqual(canonicalCgroupRoot, target)) fail("target cgroup escaped the cgroup v2 root.");
  const metadata = lstatSync(target);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || realpathSync(target) !== target) {
    fail("target cgroup must be a real contained directory.");
  }
  return Object.freeze({
    target,
    pathSha256: sha256(Buffer.from(`/${relativeCgroup}`, "utf8")),
  });
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

export async function observeTargetContainerCgroupV2(options) {
  const {
    runIndex,
    containerId,
    targetPid,
    toolingCommit,
    observerSha256,
    procRoot = "/proc",
    cgroupRoot = "/sys/fs/cgroup",
    pollIntervalMilliseconds = 10,
    timeoutMilliseconds = HOST_OBSERVER_TIMEOUT_MS,
    now = Date.now,
  } = options ?? {};
  if (!Number.isSafeInteger(runIndex) || runIndex < 1 || runIndex > 3) fail("runIndex must be 1, 2, or 3.");
  if (!CONTAINER_ID.test(containerId)) fail("containerId must be a full opaque Docker container ID.");
  if (!GIT_COMMIT.test(toolingCommit)) fail("toolingCommit must be a full lowercase Git SHA.");
  if (!LOWER_SHA256.test(observerSha256)) fail("observerSha256 must be lowercase SHA-256.");
  if (!Number.isSafeInteger(pollIntervalMilliseconds) || pollIntervalMilliseconds < 1 ||
      !Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 ||
      timeoutMilliseconds > HOST_OBSERVER_TIMEOUT_MS) {
    fail("host observer timing policy is invalid.");
  }
  if (typeof now !== "function") fail("now must be a clock function.");

  const resolved = resolveTargetCgroup({ targetPid, procRoot, cgroupRoot });
  const startedMilliseconds = now();
  const deadlineMilliseconds = startedMilliseconds + timeoutMilliseconds;
  let maximumMemoryPeakBytes = 0;
  let memoryMaxBytes;
  let memorySwapMaxBytes;
  let sampleCount = 0;
  let targetExited = false;
  while (now() <= deadlineMilliseconds) {
    const observedMax = strictCgroupInteger(
      readBoundedRegularFile(join(resolved.target, "memory.max"), "host memory.max"),
      "host memory.max",
      { positive: true },
    );
    const observedSwap = strictCgroupInteger(
      readBoundedRegularFile(join(resolved.target, "memory.swap.max"), "host memory.swap.max"),
      "host memory.swap.max",
    );
    const observedPeak = strictCgroupInteger(
      readBoundedRegularFile(join(resolved.target, "memory.peak"), "host memory.peak"),
      "host memory.peak",
      { positive: true },
    );
    if (memoryMaxBytes !== undefined && memoryMaxBytes !== observedMax) fail("host memory.max changed during observation.");
    if (memorySwapMaxBytes !== undefined && memorySwapMaxBytes !== observedSwap) fail("host memory.swap.max changed during observation.");
    memoryMaxBytes = observedMax;
    memorySwapMaxBytes = observedSwap;
    maximumMemoryPeakBytes = Math.max(maximumMemoryPeakBytes, observedPeak);
    sampleCount += 1;
    const populated = parsePopulated(
      readBoundedRegularFile(join(resolved.target, "cgroup.events"), "host cgroup.events"),
    );
    if (populated === 0) {
      targetExited = true;
      break;
    }
    await sleep(pollIntervalMilliseconds);
  }
  const completedMilliseconds = now();
  if (!targetExited) fail("host cgroup observer exceeded its bounded deadline before target exit.");
  if (memoryMaxBytes !== MEMORY_LIMIT_BYTES || memorySwapMaxBytes !== 0 ||
      maximumMemoryPeakBytes <= 0 || maximumMemoryPeakBytes > memoryMaxBytes || sampleCount < 1) {
    fail("host cgroup observation did not reproduce the frozen memory policy.");
  }
  return Object.freeze({
    schemaVersion: RECEIPT_VERSION,
    status: "OBSERVED",
    runIndex,
    containerId,
    observer: Object.freeze({
      toolingCommit,
      observerSha256,
    }),
    measurement: Object.freeze({
      source: "host-side-cgroup-v2",
      cgroupPathSha256: resolved.pathSha256,
      memoryMaxBytes,
      memorySwapMaxBytes,
      maximumMemoryPeakBytes,
      sampleCount,
    }),
    execution: Object.freeze({
      startedAt: new Date(startedMilliseconds).toISOString(),
      completedAt: new Date(completedMilliseconds).toISOString(),
      durationMilliseconds: completedMilliseconds - startedMilliseconds,
      targetExited,
    }),
    claims: Object.freeze({
      independentFromContainerPayload: true,
      wholeContainerAccounting: true,
      equivalentToScientificChildProcessRss: false,
    }),
  });
}

function parseArguments(argv) {
  const names = new Set([
    "--run-index", "--container-id", "--target-pid", "--tooling-commit",
    "--expected-observer-sha256", "--output",
  ]);
  if (argv.length !== names.size * 2) fail("all host observer arguments are required exactly once.");
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!names.has(name) || values.has(name) || value === undefined) fail("host observer arguments are invalid or duplicated.");
    values.set(name, value);
  }
  return values;
}

async function runCli() {
  const values = parseArguments(process.argv.slice(2));
  if (process.platform !== "linux" || process.arch !== "x64") fail("host observer requires Linux amd64.");
  const expectedObserverSha256 = values.get("--expected-observer-sha256");
  const observerBytes = readFileSync(SCRIPT_PATH);
  if (!LOWER_SHA256.test(expectedObserverSha256) || sha256(observerBytes) !== expectedObserverSha256) {
    fail("host observer bytes do not match the externally reviewed SHA-256.");
  }
  const receipt = await observeTargetContainerCgroupV2({
    runIndex: Number(values.get("--run-index")),
    containerId: values.get("--container-id"),
    targetPid: Number(values.get("--target-pid")),
    toolingCommit: values.get("--tooling-commit"),
    observerSha256: expectedObserverSha256,
  });
  const output = resolve(values.get("--output"));
  const parent = realpathSync(dirname(output));
  if (!insideOrEqual(parent, output)) fail("host observer output escaped its real parent.");
  writeFileSync(output, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx", mode: 0o444 });
  process.stdout.write(`${JSON.stringify({
    schemaVersion: RECEIPT_VERSION,
    status: receipt.status,
    runIndex: receipt.runIndex,
    maximumMemoryPeakBytes: receipt.measurement.maximumMemoryPeakBytes,
  })}\n`);
}

function samePath(left, right) {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return resolve(left) === resolve(right);
  }
}

if (samePath(process.argv[1] ?? "", SCRIPT_PATH)) {
  try {
    await runCli();
  } catch (error) {
    process.stderr.write(`Container memory peak host observation failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  }
}
