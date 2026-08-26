import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function portableOperatorPath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 &&
    !isAbsolute(value) && !/^[A-Za-z]:/u.test(value) &&
    !value.includes("\\") && !value.includes("\0") && !value.endsWith("/") &&
    value.split("/").every((segment) =>
      segment !== "" && segment !== "." && segment !== "..");
}

function insideRoot(root, path) {
  const pathRelative = relative(root, path);
  return pathRelative !== "" && pathRelative !== ".." &&
    !pathRelative.startsWith(`..${sep}`) && !isAbsolute(pathRelative);
}

function sameSnapshot(left, right) {
  return left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

export function operatorReadSnapshotIsStable(before, after, current, byteLength) {
  return isRecord(before) && isRecord(after) && isRecord(current) &&
    Number.isSafeInteger(byteLength) && byteLength >= 0 &&
    sameSnapshot(before, after) && sameSnapshot(before, current) &&
    before.size === BigInt(byteLength);
}

export async function canonicalOperatorCustodyRoot(sourceRoot, errorMessage) {
  if (typeof sourceRoot !== "string" || sourceRoot.trim() === "") fail(errorMessage);
  const requestedRoot = resolve(sourceRoot);
  const information = await lstat(requestedRoot, { bigint: true })
    .catch(() => fail(errorMessage));
  const rootRealPath = await realpath(requestedRoot)
    .catch(() => fail(errorMessage));
  if (!information.isDirectory() || information.isSymbolicLink()) fail(errorMessage);
  return rootRealPath;
}

async function parentSnapshots(rootRealPath, requested, errorMessage) {
  const segments = relative(rootRealPath, requested).split(sep).slice(0, -1);
  const snapshots = [];
  let current = rootRealPath;
  for (const segment of segments) {
    current = join(current, segment);
    const information = await lstat(current, { bigint: true })
      .catch(() => fail(errorMessage));
    if (!information.isDirectory() || information.isSymbolicLink()) fail(errorMessage);
    snapshots.push({ path: current, dev: information.dev, ino: information.ino });
  }
  return snapshots;
}

async function parentsUnchanged(snapshots, errorMessage) {
  for (const snapshot of snapshots) {
    const current = await lstat(snapshot.path, { bigint: true })
      .catch(() => fail(errorMessage));
    if (!current.isDirectory() || current.isSymbolicLink() ||
        current.dev !== snapshot.dev || current.ino !== snapshot.ino) {
      fail(errorMessage);
    }
  }
}

export async function readOperatorCustodiedFile(
  rootRealPath,
  requestedPath,
  maximumBytes,
  errorMessage,
) {
  if (!portableOperatorPath(requestedPath) ||
      !Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    fail(errorMessage);
  }
  const requested = resolve(rootRealPath, requestedPath);
  if (!insideRoot(rootRealPath, requested)) fail(errorMessage);
  const parents = await parentSnapshots(rootRealPath, requested, errorMessage);
  const pathBefore = await lstat(requested, { bigint: true })
    .catch(() => fail(errorMessage));
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink() ||
      pathBefore.size < 0n || pathBefore.size > BigInt(maximumBytes)) {
    fail(errorMessage);
  }
  const handle = await open(requested, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    .catch(() => fail(errorMessage));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameSnapshot(pathBefore, before) ||
        before.size > BigInt(maximumBytes)) {
      fail(errorMessage);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const current = await lstat(requested, { bigint: true })
      .catch(() => fail(errorMessage));
    const observedRealPath = await realpath(requested)
      .catch(() => fail(errorMessage));
    await parentsUnchanged(parents, errorMessage);
    if (!current.isFile() || current.isSymbolicLink() ||
        observedRealPath !== requested ||
        !operatorReadSnapshotIsStable(before, after, current, bytes.byteLength)) {
      fail(errorMessage);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}
