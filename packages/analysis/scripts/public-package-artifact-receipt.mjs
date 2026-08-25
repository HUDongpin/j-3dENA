import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { compareCodePoints } from "./public-package-build-governance.mjs";

export const PUBLIC_PACKAGE_ARTIFACT_RECEIPT_SCHEMA_V2 =
  "3dena.public-package-artifact-receipt.v2";
export const PUBLIC_PACKAGE_TREE_SERIALIZATION_V1 =
  "3dena.regular-file-tree.path-mode-length-bytes.v1";

const receiptKeys = Object.freeze([
  "schemaVersion",
  "source",
  "package",
  "tree",
  "tarball",
  "npmPack",
]);
const sourceKeys = Object.freeze(["repositoryHead"]);
const packageKeys = Object.freeze(["name", "version", "buildId"]);
const treeKeys = Object.freeze(["serialization", "sha256", "fileCount", "byteLength"]);
const tarballKeys = Object.freeze(["filename", "byteLength", "sha256", "integrity"]);
const npmPackKeys = Object.freeze([
  "id",
  "name",
  "version",
  "size",
  "unpackedSize",
  "shasum",
  "integrity",
  "filename",
  "files",
  "entryCount",
  "bundled",
]);
const npmPackFileKeys = Object.freeze(["path", "size", "mode"]);

function fail(message) {
  throw new Error(`PUBLIC_PACKAGE_ARTIFACT_INVALID: ${message}`);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function object(value, path) {
  if (!isPlainObject(value)) fail(`${path} must be an object`);
  return value;
}

function exactKeys(value, allowed, path) {
  const candidate = object(value, path);
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(candidate)) {
    if (!allowedSet.has(key)) fail(`${path} contains unknown field ${key}`);
  }
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(candidate, key)) fail(`${path} is missing field ${key}`);
  }
  return candidate;
}

function string(value, path, pattern) {
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value))) {
    fail(`${path} is invalid`);
  }
  return value;
}

function integer(value, path, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail(`${path} is invalid`);
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha1(bytes) {
  return createHash("sha1").update(bytes).digest("hex");
}

function sri512(bytes) {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

function safeRelativePath(value, path) {
  string(value, path);
  if (value.startsWith("/") || value.includes("\\") || value.includes("\0")) fail(`${path} is unsafe`);
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    fail(`${path} is unsafe`);
  }
  return value;
}

async function collectDirectoryEntries(directory, prefix = "") {
  const entries = [];
  const children = await readdir(directory, { withFileTypes: true });
  children.sort((left, right) => compareCodePoints(left.name, right.name));
  for (const child of children) {
    const path = prefix ? `${prefix}/${child.name}` : child.name;
    safeRelativePath(path, "package tree path");
    const absolutePath = resolve(directory, child.name);
    if (child.isDirectory()) {
      entries.push(...await collectDirectoryEntries(absolutePath, path));
      continue;
    }
    if (!child.isFile()) fail(`unsupported filesystem entry ${path}`);
    const before = await lstat(absolutePath);
    if (!before.isFile()) fail(`unsupported filesystem entry ${path}`);
    const bytes = await readFile(absolutePath);
    const after = await lstat(absolutePath);
    if (
      !after.isFile()
      || before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs
      || bytes.length !== after.size
    ) {
      fail(`file changed while hashing ${path}`);
    }
    entries.push(Object.freeze({ path, mode: after.mode & 0o777, bytes }));
  }
  return entries.sort((left, right) => compareCodePoints(left.path, right.path));
}

function uint32(value) {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function uint64(value) {
  const buffer = Buffer.allocUnsafe(8);
  buffer.writeBigUInt64BE(BigInt(value));
  return buffer;
}

function hashEntries(entries) {
  const hash = createHash("sha256");
  hash.update(`${PUBLIC_PACKAGE_TREE_SERIALIZATION_V1}\0`, "utf8");
  let byteLength = 0;
  for (const entry of entries) {
    const pathBytes = Buffer.from(entry.path, "utf8");
    if (pathBytes.length > 0xffff_ffff) fail(`tree path is too long: ${entry.path}`);
    hash.update(uint32(pathBytes.length));
    hash.update(pathBytes);
    hash.update(uint32(entry.mode));
    hash.update(uint64(entry.bytes.length));
    hash.update(entry.bytes);
    byteLength += entry.bytes.length;
    if (!Number.isSafeInteger(byteLength)) fail("package tree byte length exceeds the safe integer range");
  }
  return Object.freeze({
    serialization: PUBLIC_PACKAGE_TREE_SERIALIZATION_V1,
    sha256: hash.digest("hex"),
    fileCount: entries.length,
    byteLength,
  });
}

export async function hashRegularFileTree(directory) {
  return hashEntries(await collectDirectoryEntries(resolve(directory)));
}

function tarString(bytes, start, length) {
  const field = bytes.subarray(start, start + length);
  const nul = field.indexOf(0);
  return field.subarray(0, nul === -1 ? field.length : nul).toString("utf8");
}

function tarOctal(bytes, start, length, path, allowEmpty = false) {
  const text = tarString(bytes, start, length).trim();
  if (allowEmpty && text.length === 0) return 0;
  if (!/^[0-7]+$/u.test(text)) fail(`${path} is not a valid tar octal field`);
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) fail(`${path} is outside the safe integer range`);
  return value;
}

function verifyTarChecksum(header, path) {
  const expected = tarOctal(header, 148, 8, `tar checksum for ${path}`);
  const copy = Buffer.from(header);
  copy.fill(0x20, 148, 156);
  const actual = copy.reduce((sum, byte) => sum + byte, 0);
  if (actual !== expected) fail(`tar checksum mismatch for ${path}`);
}

function collectTarEntries(archiveBytes) {
  let tar;
  try {
    tar = gunzipSync(archiveBytes);
  } catch {
    fail("tarball is not valid gzip data");
  }
  const entries = [];
  const seen = new Set();
  let offset = 0;
  let ended = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      ended = true;
      if (!tar.subarray(offset).every((byte) => byte === 0)) fail("tarball has non-zero data after its end marker");
      break;
    }
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const tarPath = prefix ? `${prefix}/${name}` : name;
    verifyTarChecksum(header, tarPath);
    const size = tarOctal(header, 124, 12, `tar size for ${tarPath}`, true);
    const mode = tarOctal(header, 100, 8, `tar mode for ${tarPath}`, true) & 0o777;
    const type = header[156];
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) fail(`truncated tar entry ${tarPath}`);
    if (type === 0x30 || type === 0) {
      if (!tarPath.startsWith("package/")) fail(`tar regular file is outside package/: ${tarPath}`);
      const path = tarPath.slice("package/".length);
      safeRelativePath(path, "tar package path");
      if (seen.has(path)) fail(`tarball contains duplicate regular file ${path}`);
      seen.add(path);
      entries.push(Object.freeze({ path, mode, bytes: Buffer.from(tar.subarray(dataStart, dataEnd)) }));
    } else if (type !== 0x35) {
      fail(`tarball contains unsupported non-regular entry ${tarPath}`);
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  if (!ended) fail("tarball is missing its zero-block end marker");
  return entries.sort((left, right) => compareCodePoints(left.path, right.path));
}

function compareEntries(expected, actual, label) {
  if (expected.length !== actual.length) fail(`${label} file count differs`);
  for (let index = 0; index < expected.length; index += 1) {
    const left = expected[index];
    const right = actual[index];
    if (left.path !== right.path) fail(`${label} path differs at index ${index}`);
    if (left.mode !== right.mode) fail(`${label} file mode differs for ${left.path}`);
    if (!left.bytes.equals(right.bytes)) fail(`${label} file bytes differ for ${left.path}`);
  }
}

export async function comparePublicPackageTrees(expectedDirectory, actualDirectory) {
  const [expected, actual] = await Promise.all([
    collectDirectoryEntries(resolve(expectedDirectory)),
    collectDirectoryEntries(resolve(actualDirectory)),
  ]);
  compareEntries(expected, actual, "public package tree");
  return Object.freeze({ identical: true, tree: hashEntries(expected) });
}

function validateNpmPackReceipt(value) {
  const npmPack = exactKeys(value, npmPackKeys, "receipt.npmPack");
  string(npmPack.id, "receipt.npmPack.id");
  string(npmPack.name, "receipt.npmPack.name", /^[a-z0-9][a-z0-9._-]*$/u);
  string(npmPack.version, "receipt.npmPack.version");
  integer(npmPack.size, "receipt.npmPack.size");
  integer(npmPack.unpackedSize, "receipt.npmPack.unpackedSize");
  string(npmPack.shasum, "receipt.npmPack.shasum", /^[0-9a-f]{40}$/u);
  string(npmPack.integrity, "receipt.npmPack.integrity", /^sha512-[A-Za-z0-9+/]+={0,2}$/u);
  safeRelativePath(npmPack.filename, "receipt.npmPack.filename");
  if (!Array.isArray(npmPack.files) || npmPack.files.length === 0) fail("receipt.npmPack.files is invalid");
  let previousPath;
  for (let index = 0; index < npmPack.files.length; index += 1) {
    const entry = exactKeys(npmPack.files[index], npmPackFileKeys, `receipt.npmPack.files[${index}]`);
    safeRelativePath(entry.path, `receipt.npmPack.files[${index}].path`);
    integer(entry.size, `receipt.npmPack.files[${index}].size`);
    integer(entry.mode, `receipt.npmPack.files[${index}].mode`, 0o777);
    if (previousPath !== undefined && compareCodePoints(previousPath, entry.path) >= 0) {
      fail("receipt.npmPack.files must use unique code-point path order");
    }
    previousPath = entry.path;
  }
  integer(npmPack.entryCount, "receipt.npmPack.entryCount");
  if (!Array.isArray(npmPack.bundled) || npmPack.bundled.some((entry) => typeof entry !== "string")) {
    fail("receipt.npmPack.bundled is invalid");
  }
  if (npmPack.bundled.length !== 0) fail("receipt.npmPack.bundled must be empty");
  return npmPack;
}

export function validatePublicPackageArtifactReceiptV2(value) {
  const receipt = exactKeys(value, receiptKeys, "receipt");
  if (receipt.schemaVersion !== PUBLIC_PACKAGE_ARTIFACT_RECEIPT_SCHEMA_V2) fail("receipt.schemaVersion is invalid");
  const source = exactKeys(receipt.source, sourceKeys, "receipt.source");
  string(source.repositoryHead, "receipt.source.repositoryHead", /^[0-9a-f]{40}$/u);
  const packageIdentity = exactKeys(receipt.package, packageKeys, "receipt.package");
  string(packageIdentity.name, "receipt.package.name", /^[a-z0-9][a-z0-9._-]*$/u);
  string(packageIdentity.version, "receipt.package.version");
  string(packageIdentity.buildId, "receipt.package.buildId", /^[0-9a-f]{40}$/u);
  const tree = exactKeys(receipt.tree, treeKeys, "receipt.tree");
  if (tree.serialization !== PUBLIC_PACKAGE_TREE_SERIALIZATION_V1) fail("receipt.tree.serialization is invalid");
  string(tree.sha256, "receipt.tree.sha256", /^[0-9a-f]{64}$/u);
  integer(tree.fileCount, "receipt.tree.fileCount");
  integer(tree.byteLength, "receipt.tree.byteLength");
  const tarball = exactKeys(receipt.tarball, tarballKeys, "receipt.tarball");
  safeRelativePath(tarball.filename, "receipt.tarball.filename");
  integer(tarball.byteLength, "receipt.tarball.byteLength");
  string(tarball.sha256, "receipt.tarball.sha256", /^[0-9a-f]{64}$/u);
  string(tarball.integrity, "receipt.tarball.integrity", /^sha512-[A-Za-z0-9+/]+={0,2}$/u);
  const npmPack = validateNpmPackReceipt(receipt.npmPack);

  if (source.repositoryHead !== packageIdentity.buildId) fail("source repositoryHead must equal package buildId");
  if (npmPack.name !== packageIdentity.name || npmPack.version !== packageIdentity.version) {
    fail("npm pack identity does not match the package identity");
  }
  if (npmPack.id !== `${packageIdentity.name}@${packageIdentity.version}`) fail("npm pack id is inconsistent");
  if (npmPack.filename !== tarball.filename) fail("npm pack filename does not match the tarball receipt");
  if (npmPack.size !== tarball.byteLength) fail("npm pack size does not match the tarball receipt");
  if (npmPack.integrity !== tarball.integrity) fail("npm pack integrity does not match the tarball receipt");
  if (npmPack.entryCount !== npmPack.files.length || npmPack.entryCount !== tree.fileCount) {
    fail("npm pack entry count does not match the package tree");
  }
  if (npmPack.unpackedSize !== tree.byteLength) fail("npm pack unpacked size does not match the package tree");
  return receipt;
}

function validateNpmFilesAgainstEntries(npmPack, entries) {
  if (npmPack.files.length !== entries.length) fail("npm pack file list differs from the tarball tree");
  for (let index = 0; index < entries.length; index += 1) {
    const expected = npmPack.files[index];
    const actual = entries[index];
    if (expected.path !== actual.path || expected.size !== actual.bytes.length || expected.mode !== actual.mode) {
      fail(`npm pack file receipt differs for ${actual.path}`);
    }
  }
}

async function readPackageIdentity(packageDirectory) {
  const [manifest, provenance] = await Promise.all([
    readFile(resolve(packageDirectory, "package.json"), "utf8").then(JSON.parse),
    readFile(resolve(packageDirectory, "PROVENANCE.json"), "utf8").then(JSON.parse),
  ]);
  return {
    name: manifest.name,
    version: manifest.version,
    buildId: provenance.package?.buildId,
    repositoryHead: provenance.source?.repositoryHead,
  };
}

function verifyPackageIdentity(identity, receipt) {
  if (
    identity.name !== receipt.package.name
    || identity.version !== receipt.package.version
    || identity.buildId !== receipt.package.buildId
    || identity.repositoryHead !== receipt.source.repositoryHead
  ) {
    fail("package manifest or provenance identity does not match the receipt");
  }
}

function verifyTarballBytes(bytes, receipt, tarballPath) {
  if (basename(tarballPath) !== receipt.tarball.filename) fail("tarball filename does not match the receipt");
  if (sha256(bytes) !== receipt.tarball.sha256) fail("tarball SHA-256 does not match the receipt");
  if (bytes.length !== receipt.tarball.byteLength) fail("tarball byte length does not match the receipt");
  if (sha1(bytes) !== receipt.npmPack.shasum) fail("tarball SHA-1 does not match the npm pack receipt");
  if (sri512(bytes) !== receipt.tarball.integrity) fail("tarball SRI does not match the receipt");
}

export async function createPublicPackageArtifactReceiptV2({
  packageDirectory,
  tarballPath,
  npmPackReceipt,
  sourceHead,
}) {
  string(sourceHead, "sourceHead", /^[0-9a-f]{40}$/u);
  const npmPack = validateNpmPackReceipt(npmPackReceipt);
  const [directoryEntries, tarballBytes, identity] = await Promise.all([
    collectDirectoryEntries(resolve(packageDirectory)),
    readFile(resolve(tarballPath)),
    readPackageIdentity(resolve(packageDirectory)),
  ]);
  if (identity.repositoryHead !== sourceHead || identity.buildId !== sourceHead) {
    fail("source repositoryHead and package buildId must equal the requested source head");
  }
  const tarEntries = collectTarEntries(tarballBytes);
  compareEntries(directoryEntries, tarEntries, "package directory and npm tarball");
  validateNpmFilesAgainstEntries(npmPack, tarEntries);
  const tree = hashEntries(directoryEntries);
  const receipt = {
    schemaVersion: PUBLIC_PACKAGE_ARTIFACT_RECEIPT_SCHEMA_V2,
    source: { repositoryHead: sourceHead },
    package: { name: identity.name, version: identity.version, buildId: identity.buildId },
    tree,
    tarball: {
      filename: basename(tarballPath),
      byteLength: tarballBytes.length,
      sha256: sha256(tarballBytes),
      integrity: sri512(tarballBytes),
    },
    npmPack,
  };
  validatePublicPackageArtifactReceiptV2(receipt);
  verifyTarballBytes(tarballBytes, receipt, tarballPath);
  return receipt;
}

export async function verifyPublicPackageArtifactReceiptV2({ receipt: value, packageDirectory, tarballPath }) {
  const receipt = validatePublicPackageArtifactReceiptV2(value);
  if (tarballPath !== undefined) {
    const bytes = await readFile(resolve(tarballPath));
    verifyTarballBytes(bytes, receipt, tarballPath);
    const tarEntries = collectTarEntries(bytes);
    validateNpmFilesAgainstEntries(receipt.npmPack, tarEntries);
    const tarTree = hashEntries(tarEntries);
    if (JSON.stringify(tarTree) !== JSON.stringify(receipt.tree)) fail("tarball tree does not match the receipt");
  }
  if (packageDirectory !== undefined) {
    const directory = resolve(packageDirectory);
    const [entries, identity] = await Promise.all([
      collectDirectoryEntries(directory),
      readPackageIdentity(directory),
    ]);
    verifyPackageIdentity(identity, receipt);
    const tree = hashEntries(entries);
    if (JSON.stringify(tree) !== JSON.stringify(receipt.tree)) fail("package tree does not match the receipt");
  }
  return Object.freeze({
    sourceHead: receipt.source.repositoryHead,
    packageName: receipt.package.name,
    packageVersion: receipt.package.version,
    treeSha256: receipt.tree.sha256,
    tarballSha256: receipt.tarball.sha256,
  });
}
