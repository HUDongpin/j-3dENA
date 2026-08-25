import { createHash, createPublicKey } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { parseStrictJson } from "./strict-json.mjs";

export const MATERIALIZATION_INPUT_VERSION =
  "3dena.build-approval-materialization-input.v1";
export const MATERIALIZATION_MANIFEST_VERSION =
  "3dena.build-approval-materialization-manifest.v1";
export const PUBLIC_KEY_MATERIALIZATION_INPUT_VERSION =
  "3dena.build-approval-public-key-materialization-input.v1";
export const PUBLIC_KEY_MATERIALIZATION_MANIFEST_VERSION =
  "3dena.build-approval-public-key-materialization-manifest.v1";
export const SCHEMA_BUNDLE_VERSION =
  "3dena.build-approval-schema-bundle.v1";
export const MAX_PUBLIC_KEY_REGISTRY_BYTES = 128 * 1024;
export const BUILD_APPROVAL_ARTIFACT_BOUNDS_V1 = Object.freeze({
  schemaVersion: "3dena.build-approval-artifact-bounds.v1",
  analysisTarball: 32 * 1024 * 1024,
  jenaTarball: 8 * 1024 * 1024,
  lockfile: 4 * 1024 * 1024,
  sbom: 16 * 1024 * 1024,
  migration: 1024 * 1024,
  schemaIndex: 1024 * 1024,
  schemaDocument: 4 * 1024 * 1024,
  schemaBundle: 32 * 1024 * 1024,
  candidateInput: 4 * 1024 * 1024,
  materializationInput: 4 * 1024 * 1024,
  materializationManifest: 4 * 1024 * 1024,
  publicKeyRegistry: MAX_PUBLIC_KEY_REGISTRY_BYTES,
});

const BUILD_APPROVAL_ARTIFACT_BOUND_LABELS_V1 = Object.freeze({
  analysisTarball: "32 MiB analysis tarball limit",
  jenaTarball: "8 MiB Jena tarball limit",
  lockfile: "4 MiB lockfile limit",
  sbom: "16 MiB SBOM limit",
  migration: "1 MiB migration limit",
  schemaIndex: "1 MiB schema index limit",
  schemaDocument: "4 MiB schema document limit",
  schemaBundle: "32 MiB schema bundle limit",
  candidateInput: "4 MiB candidate input limit",
  materializationInput: "4 MiB materialization input limit",
  materializationManifest: "4 MiB materialization manifest limit",
  publicKeyRegistry: "128 KiB public-key registry limit",
});

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const LOW_ENTROPY_HEX = /^([a-f0-9])\1+$/u;
const SCHEMA_NAME = /^[A-Za-z][A-Za-z0-9]{0,127}$/u;
const SCHEMA_FILE = /^[a-z0-9][a-z0-9.-]*\.json$/u;
const OBVIOUS_PLACEHOLDER = /(?:^|[._~-])(?:dummy|fake|placeholder|replace|tbd|todo)(?:$|[._~-])/iu;

const CANDIDATE_INPUT_KEYS = [
  "releaseId",
  "environment",
  "gitCommit",
  "vercelDeploymentId",
  "vercelBuildId",
  "flyImageDigest",
  "flyBuildId",
  "jenaVersion",
  "jenaCommit",
  "sdkVersion",
  "buildId",
  "migrations",
  "contractVersions",
  "implementationActorIds",
  "artifacts",
];
const ARTIFACT_KEYS = ["analysisTarball", "jenaTarball", "lockfile", "sbom"];
const OUTPUT_NAMES = Object.freeze({
  candidateInput: "build-approval-candidate-input.json",
  manifest: "build-approval-materialization-manifest.json",
  schemaBundle: "schema-bundle.json",
});
const PUBLIC_KEY_OUTPUT_NAMES = Object.freeze({
  manifest: "build-approval-public-keys-manifest.json",
  publicKeyRegistry: "build-approval-public-keys.json",
});
const MATERIALIZATION_OUTPUT_BOUNDS_V1 = Object.freeze({
  [OUTPUT_NAMES.candidateInput]: Object.freeze({
    maximumBytes: BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.candidateInput,
    description: BUILD_APPROVAL_ARTIFACT_BOUND_LABELS_V1.candidateInput,
  }),
  [OUTPUT_NAMES.manifest]: Object.freeze({
    maximumBytes: BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.materializationManifest,
    description: BUILD_APPROVAL_ARTIFACT_BOUND_LABELS_V1.materializationManifest,
  }),
  [OUTPUT_NAMES.schemaBundle]: Object.freeze({
    maximumBytes: BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.schemaBundle,
    description: BUILD_APPROVAL_ARTIFACT_BOUND_LABELS_V1.schemaBundle,
  }),
});

function fail(message) {
  throw new Error(`BUILD_APPROVAL_INPUTS_INVALID: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function canonical(value, path = "value") {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${path} contains a non-finite number`);
    return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry, index) => canonical(entry, `${path}[${index}]`)).join(",")}]`;
  }
  if (!isRecord(value)) fail(`${path} is not canonical JSON`);
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => {
    if (value[key] === undefined) fail(`${path}.${key} is undefined`);
    return `${JSON.stringify(key)}:${canonical(value[key], `${path}.${key}`)}`;
  }).join(",")}}`;
}

function exact(value, keys, path) {
  if (!isRecord(value) ||
      Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    fail(`${path} fields are not exact`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function portablePath(value, path) {
  if (typeof value !== "string" || value.length < 1 || value.length > 1024 ||
      isAbsolute(value) || value.includes("\\") || value.includes("\0") ||
      value.endsWith("/") || value.split("/").some((segment) =>
        segment === "" || segment === "." || segment === "..")) {
    fail(`${path} must be a portable relative path`);
  }
  return value;
}

function insideRoot(root, path, allowRoot = false) {
  const pathRelative = relative(root, path);
  return (allowRoot && pathRelative === "") ||
    (pathRelative !== "" && pathRelative !== ".." &&
      !pathRelative.startsWith(`..${sep}`) && !isAbsolute(pathRelative));
}

async function resolveInsideRealRoot(sourceRoot, rootRealPath, requestedPath, path) {
  let requested;
  if (isAbsolute(requestedPath)) {
    const parentRealPath = await realpath(dirname(requestedPath))
      .catch(() => fail(`${path} parent is unreadable`));
    requested = join(parentRealPath, basename(requestedPath));
  } else {
    requested = resolve(rootRealPath, requestedPath);
  }
  if (!insideRoot(rootRealPath, requested)) fail(`${path} escapes the source root`);
  return requested;
}

async function assertNoSymbolicLinkComponents(root, requested, path, includeLeaf = true) {
  const pathRelative = relative(root, requested);
  if (!insideRoot(root, requested)) fail(`${path} escapes the source root`);
  const segments = pathRelative.split(sep);
  const inspected = includeLeaf ? segments : segments.slice(0, -1);
  let current = root;
  for (const segment of inspected) {
    current = join(current, segment);
    const information = await lstat(current).catch(() => fail(`${path} is unreadable`));
    if (information.isSymbolicLink()) fail(`${path} contains a symbolic-link component`);
  }
}

async function readSecurePath(
  root,
  requestedPath,
  path,
  maximumBytes = BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.analysisTarball,
  maximumDescription = `${maximumBytes} byte limit`,
) {
  const rootRealPath = await realpath(root);
  const requested = await resolveInsideRealRoot(root, rootRealPath, requestedPath, path);
  await assertNoSymbolicLinkComponents(rootRealPath, requested, path);
  const beforeRealPath = await realpath(requested).catch(() => fail(`${path} is unreadable`));
  if (!insideRoot(rootRealPath, beforeRealPath)) fail(`${path} escapes the source root`);
  const handle = await open(requested, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    .catch(() => fail(`${path} could not be opened without following symbolic links`));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) fail(`${path} is not a regular file`);
    if (before.size > BigInt(maximumBytes)) {
      fail(`${path} exceeds the ${maximumDescription}`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const afterRealPath = await realpath(requested)
      .catch(() => fail(`${path} changed during secure read`));
    const current = await lstat(requested, { bigint: true })
      .catch(() => fail(`${path} changed during secure read`));
    await assertNoSymbolicLinkComponents(rootRealPath, requested, path);
    if (beforeRealPath !== afterRealPath || current.isSymbolicLink() ||
        current.dev !== before.dev || current.ino !== before.ino ||
        after.dev !== before.dev || after.ino !== before.ino ||
        after.size !== before.size || after.mtimeNs !== before.mtimeNs ||
        after.ctimeNs !== before.ctimeNs || BigInt(bytes.byteLength) !== before.size) {
      fail(`${path} changed during secure read`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function readBuildApprovalSourceFile(
  sourceRoot,
  requestedPath,
  path,
  maximumBytes = BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.analysisTarball,
  maximumDescription = `${maximumBytes} byte limit`,
) {
  if (typeof requestedPath !== "string" || requestedPath.length < 1 ||
      requestedPath.includes("\0")) {
    fail(`${path} path is invalid`);
  }
  return readSecurePath(
    sourceRoot,
    requestedPath,
    path,
    maximumBytes,
    maximumDescription,
  );
}

async function safeOutputParent(sourceRoot, requestedPath, path) {
  const rootRealPath = await realpath(sourceRoot);
  const requested = await resolveInsideRealRoot(
    sourceRoot,
    rootRealPath,
    requestedPath,
    path,
  );
  if (!insideRoot(rootRealPath, requested)) fail(`${path} escapes the source root`);
  const requestedParent = dirname(requested);
  if (requestedParent !== rootRealPath) {
    await assertNoSymbolicLinkComponents(rootRealPath, requestedParent, `${path} parent`);
  }
  const parentRealPath = await realpath(requestedParent)
    .catch(() => fail(`${path} parent is unreadable`));
  if (parentRealPath !== requestedParent ||
      !insideRoot(rootRealPath, parentRealPath, true)) {
    fail(`${path} parent is symbolic or outside the source root`);
  }
  return { requested, rootRealPath };
}

export async function writeNewBuildApprovalFile(sourceRoot, requestedPath, text) {
  const { requested, rootRealPath } = await safeOutputParent(
    sourceRoot,
    requestedPath,
    "output file",
  );
  const handle = await open(
    requested,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
    0o600,
  );
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile()) fail("output file is not regular");
    await handle.writeFile(text, { encoding: "utf8" });
    await handle.sync();
    const current = await lstat(requested, { bigint: true });
    const currentRealPath = await realpath(requested);
    if (current.isSymbolicLink() || current.dev !== opened.dev || current.ino !== opened.ino ||
        !insideRoot(rootRealPath, currentRealPath)) {
      fail("output file changed during exclusive write");
    }
  } finally {
    await handle.close();
  }
}

export async function writePreparedBuildApprovalOutput(prepared, sourceRoot) {
  const outputDirectory = portablePath(prepared.outputDirectory, "outputDirectory");
  const { requested, rootRealPath } = await safeOutputParent(
    sourceRoot,
    outputDirectory,
    "output directory",
  );
  await mkdir(requested, { recursive: false, mode: 0o700 });
  const information = await lstat(requested);
  const outputRealPath = await realpath(requested);
  if (!information.isDirectory() || information.isSymbolicLink() ||
      outputRealPath !== requested || !insideRoot(rootRealPath, outputRealPath)) {
    fail("output directory is not a new canonical directory");
  }
  for (const [name, text] of Object.entries(prepared.files).sort(([left], [right]) =>
    left.localeCompare(right))) {
    if (basename(name) !== name) fail("prepared output filename is invalid");
    await writeNewBuildApprovalFile(sourceRoot, join(outputDirectory, name), text);
  }
}

function validatedId(value, path) {
  if (typeof value !== "string" || !OPAQUE_ID.test(value) || OBVIOUS_PLACEHOLDER.test(value)) {
    fail(`${path} is invalid or placeholder-like`);
  }
  return value;
}

function validatedVersion(value, path) {
  if (typeof value !== "string" || !VERSION.test(value) || OBVIOUS_PLACEHOLDER.test(value)) {
    fail(`${path} is invalid or placeholder-like`);
  }
  return value;
}

function validatedSha256(value, path) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${path} is invalid`);
  return value;
}

function explicitFile(value, path) {
  exact(value, ["path", "sha256"], path);
  return {
    path: portablePath(value.path, `${path}.path`),
    sha256: validatedSha256(value.sha256, `${path}.sha256`),
  };
}

function sortedUniqueStrings(value, pattern, path) {
  if (!Array.isArray(value) || value.length < 1 ||
      value.some((entry) => typeof entry !== "string" || !pattern.test(entry)) ||
      new Set(value).size !== value.length ||
      [...value].sort().some((entry, index) => entry !== value[index])) {
    fail(`${path} must be a non-empty, unique, sorted list`);
  }
  return [...value];
}

function validateInput(value) {
  exact(value, ["schemaVersion", "candidate", "schemaBundle", "publicKeyRegistry"], "input");
  if (value.schemaVersion !== MATERIALIZATION_INPUT_VERSION) {
    fail(`input.schemaVersion must be ${MATERIALIZATION_INPUT_VERSION}`);
  }
  exact(value.candidate, CANDIDATE_INPUT_KEYS, "input.candidate");
  const candidate = value.candidate;
  validatedId(candidate.releaseId, "input.candidate.releaseId");
  if (candidate.environment !== "preview" && candidate.environment !== "production") {
    fail("input.candidate.environment is invalid");
  }
  if (typeof candidate.gitCommit !== "string" || !COMMIT.test(candidate.gitCommit) ||
      LOW_ENTROPY_HEX.test(candidate.gitCommit)) {
    fail("input.candidate.gitCommit is invalid or placeholder-like");
  }
  validatedId(candidate.vercelDeploymentId, "input.candidate.vercelDeploymentId");
  validatedId(candidate.vercelBuildId, "input.candidate.vercelBuildId");
  if (typeof candidate.flyImageDigest !== "string" || !IMAGE_DIGEST.test(candidate.flyImageDigest) ||
      LOW_ENTROPY_HEX.test(candidate.flyImageDigest.slice("sha256:".length))) {
    fail("input.candidate.flyImageDigest is invalid or placeholder-like");
  }
  validatedId(candidate.flyBuildId, "input.candidate.flyBuildId");
  validatedVersion(candidate.jenaVersion, "input.candidate.jenaVersion");
  if (typeof candidate.jenaCommit !== "string" || !COMMIT.test(candidate.jenaCommit) ||
      LOW_ENTROPY_HEX.test(candidate.jenaCommit)) {
    fail("input.candidate.jenaCommit is invalid or placeholder-like");
  }
  validatedVersion(candidate.sdkVersion, "input.candidate.sdkVersion");
  validatedId(candidate.buildId, "input.candidate.buildId");
  if (!Array.isArray(candidate.migrations) || candidate.migrations.length < 1) {
    fail("input.candidate.migrations is invalid");
  }
  const migrations = candidate.migrations.map((entry, index) => {
    exact(entry, ["version", "path", "sha256"], `input.candidate.migrations[${index}]`);
    return {
      version: validatedVersion(entry.version, `input.candidate.migrations[${index}].version`),
      ...explicitFile(
        { path: entry.path, sha256: entry.sha256 },
        `input.candidate.migrations[${index}]`,
      ),
    };
  });
  if (new Set(migrations.map((entry) => entry.version)).size !== migrations.length ||
      [...migrations].sort((left, right) => left.version.localeCompare(right.version))
        .some((entry, index) => entry.version !== migrations[index].version)) {
    fail("input.candidate.migrations must be unique and sorted by version");
  }
  const contractVersions = sortedUniqueStrings(
    candidate.contractVersions,
    VERSION,
    "input.candidate.contractVersions",
  );
  const implementationActorIds = sortedUniqueStrings(
    candidate.implementationActorIds,
    OPAQUE_ID,
    "input.candidate.implementationActorIds",
  );
  if (implementationActorIds.some((id) => OBVIOUS_PLACEHOLDER.test(id))) {
    fail("input.candidate.implementationActorIds contains a placeholder-like value");
  }
  exact(candidate.artifacts, ARTIFACT_KEYS, "input.candidate.artifacts");
  const artifacts = Object.fromEntries(ARTIFACT_KEYS.map((key) => [
    key,
    explicitFile(candidate.artifacts[key], `input.candidate.artifacts.${key}`),
  ]));

  exact(value.schemaBundle, ["index", "schemas"], "input.schemaBundle");
  const index = explicitFile(value.schemaBundle.index, "input.schemaBundle.index");
  if (!Array.isArray(value.schemaBundle.schemas) || value.schemaBundle.schemas.length < 1) {
    fail("input.schemaBundle.schemas is invalid");
  }
  const schemas = value.schemaBundle.schemas.map((entry, schemaIndex) => {
    exact(entry, ["name", "path", "sha256"], `input.schemaBundle.schemas[${schemaIndex}]`);
    if (typeof entry.name !== "string" || !SCHEMA_NAME.test(entry.name)) {
      fail(`input.schemaBundle.schemas[${schemaIndex}].name is invalid`);
    }
    return {
      name: entry.name,
      ...explicitFile(
        { path: entry.path, sha256: entry.sha256 },
        `input.schemaBundle.schemas[${schemaIndex}]`,
      ),
    };
  });
  if (new Set(schemas.map((entry) => entry.name)).size !== schemas.length ||
      [...schemas].sort((left, right) => left.name.localeCompare(right.name))
        .some((entry, schemaIndex) => entry.name !== schemas[schemaIndex].name)) {
    fail("input.schemaBundle.schemas must be unique and sorted by name");
  }

  const publicKeyRegistry = explicitFile(
    value.publicKeyRegistry,
    "input.publicKeyRegistry",
  );

  return {
    schemaVersion: MATERIALIZATION_INPUT_VERSION,
    candidate: {
      releaseId: candidate.releaseId,
      environment: candidate.environment,
      gitCommit: candidate.gitCommit,
      vercelDeploymentId: candidate.vercelDeploymentId,
      vercelBuildId: candidate.vercelBuildId,
      flyImageDigest: candidate.flyImageDigest,
      flyBuildId: candidate.flyBuildId,
      jenaVersion: candidate.jenaVersion,
      jenaCommit: candidate.jenaCommit,
      sdkVersion: candidate.sdkVersion,
      buildId: candidate.buildId,
      migrations,
      contractVersions,
      implementationActorIds,
      artifacts,
    },
    schemaBundle: { index, schemas },
    publicKeyRegistry,
  };
}

function validatePublicKeyInput(value) {
  exact(value, ["schemaVersion", "publicKeys"], "publicKeyInput");
  if (value.schemaVersion !== PUBLIC_KEY_MATERIALIZATION_INPUT_VERSION) {
    fail(`publicKeyInput.schemaVersion must be ${PUBLIC_KEY_MATERIALIZATION_INPUT_VERSION}`);
  }
  if (!Array.isArray(value.publicKeys) || value.publicKeys.length < 1) {
    fail("publicKeyInput.publicKeys is invalid");
  }
  const publicKeys = value.publicKeys.map((entry, keyIndex) => {
    exact(
      entry,
      [
        "publicKeyId", "allowedEnvironments", "path", "reviewerId", "role", "sha256",
      ],
      `publicKeyInput.publicKeys[${keyIndex}]`,
    );
    const allowedEnvironments = sortedUniqueStrings(
      entry.allowedEnvironments,
      /^(?:preview|production)$/u,
      `publicKeyInput.publicKeys[${keyIndex}].allowedEnvironments`,
    );
    if (entry.role !== "independent-reviewer") {
      fail(`publicKeyInput.publicKeys[${keyIndex}].role is invalid`);
    }
    return {
      publicKeyId: validatedId(
        entry.publicKeyId,
        `publicKeyInput.publicKeys[${keyIndex}].publicKeyId`,
      ),
      allowedEnvironments,
      reviewerId: validatedId(
        entry.reviewerId,
        `publicKeyInput.publicKeys[${keyIndex}].reviewerId`,
      ),
      role: "independent-reviewer",
      ...explicitFile(
        { path: entry.path, sha256: entry.sha256 },
        `publicKeyInput.publicKeys[${keyIndex}]`,
      ),
    };
  });
  if (new Set(publicKeys.map((entry) => entry.publicKeyId)).size !== publicKeys.length ||
      [...publicKeys].sort((left, right) => left.publicKeyId.localeCompare(right.publicKeyId))
        .some((entry, keyIndex) => entry.publicKeyId !== publicKeys[keyIndex].publicKeyId)) {
    fail("publicKeyInput.publicKeys must be unique and sorted by publicKeyId");
  }
  return {
    schemaVersion: PUBLIC_KEY_MATERIALIZATION_INPUT_VERSION,
    publicKeys,
  };
}

async function readBoundFile(
  root,
  descriptor,
  path,
  maximumBytes = BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.analysisTarball,
  maximumDescription = `${maximumBytes} byte limit`,
) {
  const bytes = await readSecurePath(
    root,
    descriptor.path,
    `${path}.path`,
    maximumBytes,
    maximumDescription,
  );
  const observed = sha256(bytes);
  if (observed !== descriptor.sha256) {
    fail(`${path}.sha256 expected ${descriptor.sha256} but observed ${observed}`);
  }
  return bytes;
}

function parseJson(bytes, path) {
  try {
    return parseStrictJson(bytes);
  } catch {
    fail(`${path} is not valid JSON`);
  }
}

async function materializeSchemaBundle(root, input) {
  const indexBytes = await readBoundFile(
    root,
    input.index,
    "input.schemaBundle.index",
    BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.schemaIndex,
    BUILD_APPROVAL_ARTIFACT_BOUND_LABELS_V1.schemaIndex,
  );
  const indexDocument = parseJson(indexBytes, "input.schemaBundle.index");
  exact(indexDocument, ["schemaVersion", "schemas"], "schema index");
  if (indexDocument.schemaVersion !== "3dena.schema-index.v1" ||
      !isRecord(indexDocument.schemas) || Object.keys(indexDocument.schemas).length < 1) {
    fail("schema index is invalid");
  }
  const indexedEntries = Object.entries(indexDocument.schemas).sort(([left], [right]) =>
    left.localeCompare(right));
  if (indexedEntries.some(([name, file]) => !SCHEMA_NAME.test(name) ||
      typeof file !== "string" || !SCHEMA_FILE.test(file))) {
    fail("schema index contains an invalid name or file");
  }
  if (indexedEntries.length !== input.schemas.length ||
      indexedEntries.some(([name], index) => name !== input.schemas[index].name)) {
    fail("explicit schema list does not exactly match the schema index");
  }
  const indexDirectory = dirname(input.index.path);
  const expectedDirectoryFiles = [
    basename(input.index.path),
    ...indexedEntries.map(([, file]) => file),
  ].sort();
  const observedDirectoryFiles = (await readdir(resolve(root, indexDirectory), {
    withFileTypes: true,
  })).filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name).sort();
  if (canonical(observedDirectoryFiles) !== canonical(expectedDirectoryFiles)) {
    fail("schema directory JSON files do not exactly match the schema index");
  }

  const schemas = [];
  for (const [schemaIndex, descriptor] of input.schemas.entries()) {
    const indexedFile = indexedEntries[schemaIndex][1];
    if (dirname(descriptor.path) !== indexDirectory || basename(descriptor.path) !== indexedFile) {
      fail(`input.schemaBundle.schemas[${schemaIndex}].path disagrees with the schema index`);
    }
    const bytes = await readBoundFile(
      root,
      descriptor,
      `input.schemaBundle.schemas[${schemaIndex}]`,
      BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.schemaDocument,
      BUILD_APPROVAL_ARTIFACT_BOUND_LABELS_V1.schemaDocument,
    );
    const document = parseJson(bytes, `input.schemaBundle.schemas[${schemaIndex}]`);
    if (!isRecord(document) || typeof document.$id !== "string") {
      fail(`input.schemaBundle.schemas[${schemaIndex}] is not a JSON Schema object with $id`);
    }
    let id;
    try {
      id = new URL(document.$id);
    } catch {
      fail(`input.schemaBundle.schemas[${schemaIndex}].$id is invalid`);
    }
    if (id.protocol !== "https:" || basename(id.pathname) !== indexedFile) {
      fail(`input.schemaBundle.schemas[${schemaIndex}].$id disagrees with the schema index`);
    }
    schemas.push({
      name: descriptor.name,
      path: descriptor.path,
      sha256: descriptor.sha256,
      document,
    });
  }
  const bundle = {
    schemaVersion: SCHEMA_BUNDLE_VERSION,
    index: {
      path: input.index.path,
      sha256: input.index.sha256,
      document: indexDocument,
    },
    schemas,
  };
  const text = `${canonical(bundle, "schemaBundle")}\n`;
  if (Buffer.byteLength(text, "utf8") >
      BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.schemaBundle) {
    fail(`schema bundle exceeds the ${BUILD_APPROVAL_ARTIFACT_BOUND_LABELS_V1.schemaBundle}`);
  }
  return text;
}

async function materializePublicKeys(root, descriptors) {
  const registry = {};
  for (const [index, descriptor] of descriptors.entries()) {
    const path = `publicKeyInput.publicKeys[${index}]`;
    const bytes = await readBoundFile(
      root,
      descriptor,
      path,
      BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.publicKeyRegistry,
      BUILD_APPROVAL_ARTIFACT_BOUND_LABELS_V1.publicKeyRegistry,
    );
    const text = bytes.toString("utf8");
    if (/PRIVATE KEY/iu.test(text)) fail(`${path} contains private-key material`);
    let key;
    try {
      key = createPublicKey(text);
    } catch {
      fail(`${path} is not a parseable public key`);
    }
    if (key.asymmetricKeyType !== "ed25519") {
      fail(`${path} is not an Ed25519 public key`);
    }
    registry[descriptor.publicKeyId] = {
      algorithm: "Ed25519",
      allowedEnvironments: descriptor.allowedEnvironments,
      publicKeyPem: String(key.export({ format: "pem", type: "spki" })),
      reviewerId: descriptor.reviewerId,
      role: descriptor.role,
    };
  }
  const text = `${canonical(registry, "publicKeyRegistry")}\n`;
  if (Buffer.byteLength(text, "utf8") > MAX_PUBLIC_KEY_REGISTRY_BYTES) {
    fail("materialized public-key registry exceeds the 128 KiB limit");
  }
  return text;
}

export function validateBuildApprovalPublicKeyRegistryBytes(bytes, path) {
  if (bytes.byteLength > MAX_PUBLIC_KEY_REGISTRY_BYTES) {
    fail(`${path} exceeds the 128 KiB public-key registry limit`);
  }
  const text = bytes.toString("utf8");
  const registry = parseJson(bytes, path);
  if (!isRecord(registry) || Object.keys(registry).length < 1 ||
      text !== `${canonical(registry, path)}\n`) {
    fail(`${path} is not a non-empty canonical registry`);
  }
  for (const [publicKeyId, entry] of Object.entries(registry)) {
    validatedId(publicKeyId, `${path}.${publicKeyId}`);
    exact(entry, [
      "algorithm", "allowedEnvironments", "publicKeyPem", "reviewerId", "role",
    ], `${path}.${publicKeyId}`);
    const allowedEnvironments = sortedUniqueStrings(
      entry.allowedEnvironments,
      /^(?:preview|production)$/u,
      `${path}.${publicKeyId}.allowedEnvironments`,
    );
    if (entry.algorithm !== "Ed25519" || entry.role !== "independent-reviewer" ||
        allowedEnvironments.length < 1 ||
        typeof entry.publicKeyPem !== "string" || /PRIVATE KEY/iu.test(entry.publicKeyPem)) {
      fail(`${path}.${publicKeyId} is not public-key material`);
    }
    validatedId(entry.reviewerId, `${path}.${publicKeyId}.reviewerId`);
    let key;
    try {
      key = createPublicKey(entry.publicKeyPem);
    } catch {
      fail(`${path}.${publicKeyId} is not a parseable public key`);
    }
    const canonicalPem = String(key.export({ format: "pem", type: "spki" }));
    if (key.asymmetricKeyType !== "ed25519" || canonicalPem !== entry.publicKeyPem) {
      fail(`${path}.${publicKeyId} is not canonical Ed25519 SPKI public-key material`);
    }
  }
}

function candidateInput(input, schemaBundle, publicKeyRegistry) {
  return {
    releaseId: input.releaseId,
    environment: input.environment,
    gitCommit: input.gitCommit,
    vercelDeploymentId: input.vercelDeploymentId,
    vercelBuildId: input.vercelBuildId,
    flyImageDigest: input.flyImageDigest,
    flyBuildId: input.flyBuildId,
    jenaVersion: input.jenaVersion,
    jenaCommit: input.jenaCommit,
    sdkVersion: input.sdkVersion,
    buildId: input.buildId,
    migrations: input.migrations.map(({ version, path, sha256: digest }) => ({
      version,
      path,
      sha256: digest,
    })),
    contractVersions: input.contractVersions,
    implementationActorIds: input.implementationActorIds,
    artifacts: {
      analysisTarball: input.artifacts.analysisTarball,
      jenaTarball: input.artifacts.jenaTarball,
      lockfile: input.artifacts.lockfile,
      sbom: input.artifacts.sbom,
      schemaBundle,
    },
    publicKeyRegistry,
  };
}

function outputDescriptor(outputDirectory, name, text) {
  return {
    path: `${outputDirectory}/${name}`,
    sha256: sha256(Buffer.from(text, "utf8")),
  };
}

export async function prepareBuildApprovalInputs(value, requestedOutputDirectory, sourceRoot) {
  const outputDirectory = portablePath(requestedOutputDirectory, "outputDirectory");
  const input = validateInput(value);
  if (Buffer.byteLength(`${canonical(input, "input")}\n`, "utf8") >
      BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.materializationInput) {
    fail(`materialization input exceeds the ${BUILD_APPROVAL_ARTIFACT_BOUND_LABELS_V1.materializationInput}`);
  }
  await Promise.all(Object.entries(input.candidate.artifacts).map(
    ([name, descriptor]) => readBoundFile(
      sourceRoot,
      descriptor,
      `input.candidate.artifacts.${name}`,
      BUILD_APPROVAL_ARTIFACT_BOUNDS_V1[name],
      BUILD_APPROVAL_ARTIFACT_BOUND_LABELS_V1[name],
    ),
  ));
  await Promise.all(input.candidate.migrations.map((descriptor, index) =>
    readBoundFile(
      sourceRoot,
      descriptor,
      `input.candidate.migrations[${index}]`,
      BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.migration,
      BUILD_APPROVAL_ARTIFACT_BOUND_LABELS_V1.migration,
    )));
  const schemaBundleText = await materializeSchemaBundle(sourceRoot, input.schemaBundle);
  const publicKeyRegistryBytes = await readBoundFile(
    sourceRoot,
    input.publicKeyRegistry,
    "input.publicKeyRegistry",
    MAX_PUBLIC_KEY_REGISTRY_BYTES,
    BUILD_APPROVAL_ARTIFACT_BOUND_LABELS_V1.publicKeyRegistry,
  );
  validateBuildApprovalPublicKeyRegistryBytes(
    publicKeyRegistryBytes,
    "input.publicKeyRegistry",
  );
  const schemaBundle = outputDescriptor(
    outputDirectory,
    OUTPUT_NAMES.schemaBundle,
    schemaBundleText,
  );
  const candidateInputText = `${canonical(candidateInput(
    input.candidate,
    schemaBundle,
    input.publicKeyRegistry,
  ), "candidateInput")}\n`;
  if (Buffer.byteLength(candidateInputText, "utf8") >
      BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.candidateInput) {
    fail(`candidate input exceeds the ${BUILD_APPROVAL_ARTIFACT_BOUND_LABELS_V1.candidateInput}`);
  }
  const outputs = {
    candidateInput: outputDescriptor(
      outputDirectory,
      OUTPUT_NAMES.candidateInput,
      candidateInputText,
    ),
    schemaBundle,
  };
  const manifest = {
    schemaVersion: MATERIALIZATION_MANIFEST_VERSION,
    input,
    outputs,
  };
  const manifestText = `${canonical(manifest, "manifest")}\n`;
  if (Buffer.byteLength(manifestText, "utf8") >
      BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.materializationManifest) {
    fail(`materialization manifest exceeds the ${BUILD_APPROVAL_ARTIFACT_BOUND_LABELS_V1.materializationManifest}`);
  }
  return Object.freeze({
    outputDirectory,
    files: Object.freeze({
      [OUTPUT_NAMES.candidateInput]: candidateInputText,
      [OUTPUT_NAMES.manifest]: manifestText,
      [OUTPUT_NAMES.schemaBundle]: schemaBundleText,
    }),
    manifest,
  });
}

export async function prepareBuildApprovalPublicKeys(
  value,
  requestedOutputDirectory,
  sourceRoot,
) {
  const outputDirectory = portablePath(requestedOutputDirectory, "publicKeyOutputDirectory");
  const input = validatePublicKeyInput(value);
  if (Buffer.byteLength(`${canonical(input, "publicKeyInput")}\n`, "utf8") >
      BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.materializationInput) {
    fail(`public-key materialization input exceeds the ${BUILD_APPROVAL_ARTIFACT_BOUND_LABELS_V1.materializationInput}`);
  }
  const publicKeyRegistryText = await materializePublicKeys(sourceRoot, input.publicKeys);
  const outputs = {
    publicKeyRegistry: outputDescriptor(
      outputDirectory,
      PUBLIC_KEY_OUTPUT_NAMES.publicKeyRegistry,
      publicKeyRegistryText,
    ),
  };
  const manifest = {
    schemaVersion: PUBLIC_KEY_MATERIALIZATION_MANIFEST_VERSION,
    input,
    outputs,
  };
  const manifestText = `${canonical(manifest, "publicKeyManifest")}\n`;
  if (Buffer.byteLength(manifestText, "utf8") >
      BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.materializationManifest) {
    fail(`public-key materialization manifest exceeds the ${BUILD_APPROVAL_ARTIFACT_BOUND_LABELS_V1.materializationManifest}`);
  }
  return Object.freeze({
    outputDirectory,
    files: Object.freeze({
      [PUBLIC_KEY_OUTPUT_NAMES.manifest]: manifestText,
      [PUBLIC_KEY_OUTPUT_NAMES.publicKeyRegistry]: publicKeyRegistryText,
    }),
    manifest,
  });
}

function assertPublicKeyOutputDescriptor(value) {
  exact(value, ["publicKeyRegistry"], "publicKeyManifest.outputs");
  const descriptor = explicitFile(
    value.publicKeyRegistry,
    "publicKeyManifest.outputs.publicKeyRegistry",
  );
  const outputDirectory = dirname(descriptor.path);
  if (descriptor.path !==
      `${outputDirectory}/${PUBLIC_KEY_OUTPUT_NAMES.publicKeyRegistry}`) {
    fail("public-key manifest output path is not exact");
  }
  return outputDirectory;
}

export async function verifyBuildApprovalPublicKeys(
  manifestValue,
  manifestText,
  manifestRelativePath,
  sourceRoot,
) {
  if (Buffer.byteLength(manifestText, "utf8") >
      BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.materializationManifest) {
    fail(`public-key materialization manifest exceeds the ${BUILD_APPROVAL_ARTIFACT_BOUND_LABELS_V1.materializationManifest}`);
  }
  exact(manifestValue, ["schemaVersion", "input", "outputs"], "publicKeyManifest");
  if (manifestValue.schemaVersion !== PUBLIC_KEY_MATERIALIZATION_MANIFEST_VERSION) {
    fail(
      `publicKeyManifest.schemaVersion must be ${PUBLIC_KEY_MATERIALIZATION_MANIFEST_VERSION}`,
    );
  }
  const outputDirectory = assertPublicKeyOutputDescriptor(manifestValue.outputs);
  if (portablePath(manifestRelativePath, "publicKeyManifestPath") !==
      `${outputDirectory}/${PUBLIC_KEY_OUTPUT_NAMES.manifest}`) {
    fail("public-key manifest path is not exact");
  }
  const expected = await prepareBuildApprovalPublicKeys(
    manifestValue.input,
    outputDirectory,
    sourceRoot,
  );
  if (manifestText !== expected.files[PUBLIC_KEY_OUTPUT_NAMES.manifest]) {
    fail("public-key materialization manifest is not canonical or does not match its input");
  }
  const observedNames = (await readdir(resolve(sourceRoot, outputDirectory))).sort();
  const expectedNames = Object.keys(expected.files).sort();
  if (canonical(observedNames) !== canonical(expectedNames)) {
    fail("public-key materialization output directory fields are not exact");
  }
  for (const [name, expectedText] of Object.entries(expected.files)) {
    const isRegistry = name === PUBLIC_KEY_OUTPUT_NAMES.publicKeyRegistry;
    const observed = (await readBuildApprovalSourceFile(
      sourceRoot,
      join(outputDirectory, name),
      `materialized public-key output ${name}`,
      isRegistry
        ? BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.publicKeyRegistry
        : BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.materializationManifest,
      isRegistry
        ? BUILD_APPROVAL_ARTIFACT_BOUND_LABELS_V1.publicKeyRegistry
        : BUILD_APPROVAL_ARTIFACT_BOUND_LABELS_V1.materializationManifest,
    )).toString("utf8");
    if (observed !== expectedText) fail(`${name} bytes do not match the explicit key sources`);
  }
  return expected.manifest.outputs;
}

function assertOutputDescriptors(value) {
  exact(value, ["candidateInput", "schemaBundle"], "manifest.outputs");
  for (const [name, descriptor] of Object.entries(value)) {
    exact(descriptor, ["path", "sha256"], `manifest.outputs.${name}`);
    portablePath(descriptor.path, `manifest.outputs.${name}.path`);
    validatedSha256(descriptor.sha256, `manifest.outputs.${name}.sha256`);
  }
  const outputDirectory = dirname(value.schemaBundle.path);
  if (value.candidateInput.path !== `${outputDirectory}/${OUTPUT_NAMES.candidateInput}` ||
      value.schemaBundle.path !== `${outputDirectory}/${OUTPUT_NAMES.schemaBundle}`) {
    fail("manifest output paths are not the exact materialization filenames");
  }
  return outputDirectory;
}

export async function verifyBuildApprovalInputs(
  manifestValue,
  manifestText,
  manifestRelativePath,
  sourceRoot,
) {
  if (Buffer.byteLength(manifestText, "utf8") >
      BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.materializationManifest) {
    fail(`materialization manifest exceeds the ${BUILD_APPROVAL_ARTIFACT_BOUND_LABELS_V1.materializationManifest}`);
  }
  exact(manifestValue, ["schemaVersion", "input", "outputs"], "manifest");
  if (manifestValue.schemaVersion !== MATERIALIZATION_MANIFEST_VERSION) {
    fail(`manifest.schemaVersion must be ${MATERIALIZATION_MANIFEST_VERSION}`);
  }
  const outputDirectory = assertOutputDescriptors(manifestValue.outputs);
  if (portablePath(manifestRelativePath, "manifestPath") !==
      `${outputDirectory}/${OUTPUT_NAMES.manifest}`) {
    fail("manifest path is not the exact materialization manifest path");
  }
  const expected = await prepareBuildApprovalInputs(
    manifestValue.input,
    outputDirectory,
    sourceRoot,
  );
  if (manifestText !== expected.files[OUTPUT_NAMES.manifest]) {
    fail("materialization manifest is not canonical or does not match its input");
  }
  const observedNames = (await readdir(resolve(sourceRoot, outputDirectory))).sort();
  const expectedNames = Object.keys(expected.files).sort();
  if (canonical(observedNames) !== canonical(expectedNames)) {
    fail("materialization output directory fields are not exact");
  }
  for (const [name, expectedText] of Object.entries(expected.files)) {
    const bound = MATERIALIZATION_OUTPUT_BOUNDS_V1[name];
    const observed = (await readBuildApprovalSourceFile(
      sourceRoot,
      join(outputDirectory, name),
      `materialized candidate output ${name}`,
      bound.maximumBytes,
      bound.description,
    )).toString("utf8");
    if (observed !== expectedText) fail(`${name} bytes do not match the explicit sources`);
  }
  return expected.manifest.outputs;
}

export const BUILD_APPROVAL_INPUT_OUTPUT_NAMES = OUTPUT_NAMES;
export const BUILD_APPROVAL_PUBLIC_KEY_OUTPUT_NAMES = PUBLIC_KEY_OUTPUT_NAMES;
