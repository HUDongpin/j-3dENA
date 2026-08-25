import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";

export const DETERMINISTIC_SCHEMA_MODULE_QUERY = "?schemas=public-package-contract-v1";

const forbiddenIdentityVariables = Object.freeze([
  "THREEDENA_PACKAGE_BUILD_ID",
  "THREEDENA_PUBLIC_VERSION",
]);

function fail(message) {
  throw new Error(`PUBLIC_PACKAGE_BUILD_FAILED: ${message}`);
}

function readGit(repositoryRoot, args) {
  try {
    return execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`unable to read source identity from Git: ${detail}`);
  }
}

function hasOwn(environment, name) {
  return Object.prototype.hasOwnProperty.call(environment, name);
}

export function captureCleanSourceSnapshot({ repositoryRoot, environment = process.env }) {
  for (const variable of forbiddenIdentityVariables) {
    if (hasOwn(environment, variable)) fail(`${variable} is forbidden for source-governed builds`);
  }

  const repositoryHead = readGit(repositoryRoot, ["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/u.test(repositoryHead)) fail("HEAD is not a full Git commit identity");
  const sourceDateEpoch = readGit(repositoryRoot, ["show", "-s", "--format=%ct", repositoryHead]);
  if (!/^(?:0|[1-9]\d*)$/u.test(sourceDateEpoch)) fail("HEAD commit timestamp is invalid");
  if (hasOwn(environment, "SOURCE_DATE_EPOCH") && environment.SOURCE_DATE_EPOCH !== sourceDateEpoch) {
    fail("SOURCE_DATE_EPOCH must equal the HEAD commit timestamp");
  }
  const dirty = readGit(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (dirty.length > 0) fail("refusing to build a release package from a dirty worktree");

  const milliseconds = Number(sourceDateEpoch) * 1000;
  if (!Number.isFinite(milliseconds)) fail("HEAD commit timestamp is outside the Date range");
  return Object.freeze({
    repositoryHead,
    sourceDateEpoch,
    dirtyWorktree: false,
    generatedAt: new Date(milliseconds).toISOString(),
  });
}

function cleanAllowedDirtyPath(path) {
  if (typeof path !== "string" || path.length === 0 || path.startsWith("/") || path.includes("\\")) {
    fail("allowed generated path must be a repository-relative POSIX path");
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    fail("allowed generated path contains an unsafe segment");
  }
  return path;
}

export function assertSourceSnapshotUnchanged(snapshot, { repositoryRoot, allowedDirtyPaths = [] }) {
  const repositoryHead = readGit(repositoryRoot, ["rev-parse", "HEAD"]);
  const exclusions = allowedDirtyPaths.flatMap((candidate) => {
    const path = cleanAllowedDirtyPath(candidate);
    return [`:(exclude,top)${path}`, `:(exclude,top,glob)${path}/**`];
  });
  const dirty = readGit(repositoryRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ".",
    ...exclusions,
  ]);
  if (repositoryHead !== snapshot.repositoryHead || dirty.length > 0) {
    fail("source worktree changed during the build");
  }
  const sourceDateEpoch = readGit(repositoryRoot, ["show", "-s", "--format=%ct", repositoryHead]);
  if (sourceDateEpoch !== snapshot.sourceDateEpoch) fail("HEAD timestamp changed during the build");
}

export function compareCodePoints(left, right) {
  const leftIterator = left[Symbol.iterator]();
  const rightIterator = right[Symbol.iterator]();
  while (true) {
    const leftNext = leftIterator.next();
    const rightNext = rightIterator.next();
    if (leftNext.done || rightNext.done) {
      if (leftNext.done && rightNext.done) return 0;
      return leftNext.done ? -1 : 1;
    }
    const leftPoint = leftNext.value.codePointAt(0);
    const rightPoint = rightNext.value.codePointAt(0);
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
  }
}

function tarString(bytes, start, length) {
  const field = bytes.subarray(start, start + length);
  const nul = field.indexOf(0);
  return field.subarray(0, nul === -1 ? field.length : nul).toString("utf8");
}

function tarOctal(bytes, start, length, label) {
  const text = tarString(bytes, start, length).trim();
  if (!/^[0-7]+$/u.test(text)) fail(`invalid tar ${label}`);
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) fail(`invalid tar ${label}`);
  return value;
}

export function extractGzipTarEntry(archiveBytes, expectedPath) {
  const tar = gunzipSync(archiveBytes);
  let offset = 0;
  let result;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const size = tarOctal(header, 124, 12, `size for ${path}`);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) fail(`truncated tar entry ${path}`);
    if (path === expectedPath) {
      if (result !== undefined) fail(`vendored archive contains duplicate ${expectedPath}`);
      result = Buffer.from(tar.subarray(dataStart, dataEnd));
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  if (result === undefined) fail(`vendored archive does not contain ${expectedPath}`);
  return result;
}
