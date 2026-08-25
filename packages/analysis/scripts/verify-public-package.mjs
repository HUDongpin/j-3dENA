import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PUBLIC_PACKAGE_RELEASE_VERSION } from "./public-package-release-contract.mjs";
import { assertPublicMetadataHygiene } from "./public-package-build-governance.mjs";
import {
  validatePublicPackageArtifactReceiptV2,
  verifyPublicPackageArtifactReceiptV2,
} from "./public-package-artifact-receipt.mjs";

const expectedFiles = new Set([
  "LICENSE",
  "PROVENANCE.json",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  "index.d.ts",
  "index.js",
  "index.js.map",
  "package.json"
]);

const expectedManifestFiles = [
  "index.js",
  "index.js.map",
  "index.d.ts",
  "types",
  "README.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "THIRD_PARTY",
  "schemas",
  "PROVENANCE.json"
];

const expectedManifestKeys = [
  "name",
  "version",
  "description",
  "type",
  "license",
  "sideEffects",
  "peerDependencies",
  "engines",
  "exports",
  "files",
  "publishConfig",
  "repository"
];

const publicMetadataPaths = Object.freeze([
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  "THIRD_PARTY/jena-js-PROVENANCE.md",
  "PROVENANCE.json",
]);

export const PUBLIC_PACKAGE_RUNTIME_EXPORT_NAMES = Object.freeze([
  "adaptFittedJenaTrajectoryResultV2",
  "assertAnalysisExecutionDatasetV2", "assertAnalysisResultEnvelopeV1",
  "assertLongitudinalAnalysisBundleV2", "assertLongitudinalExecutionRequestV2",
  "assertTrajectoryRunSpecV2",
  "compilePlotlySpec", "compileTrajectoryPlotlySpec", "createAnalysisClient",
  "createExportBundle", "executeAnalysisTask", "executeLongitudinalAnalysisV2",
  "getAnalysisBuildIdentityV2", "hashAnalysisValueV1",
  "hashLongitudinalExecutionRequestV2", "inspectDataset",
  "verifyLongitudinalAnalysisBundleV2"
]);

function fail(message) {
  throw new Error(`PUBLIC_PACKAGE_INVALID: ${message}`);
}

function requireExactObject(value, expectedKeys, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${path} must be an object`);
  }
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpectedKeys.length
    || actualKeys.some((key, index) => key !== sortedExpectedKeys[index])
  ) {
    fail(`${path} keys must be exactly ${sortedExpectedKeys.join(", ")}`);
  }
  return value;
}

function requireExactValue(actual, expected, path) {
  if (!Object.is(actual, expected)) fail(`${path} changed`);
}

export function verifyPublicPackageManifest(candidate) {
  if (
    candidate !== null
    && typeof candidate === "object"
    && !Array.isArray(candidate)
    && Object.hasOwn(candidate, "scripts")
  ) {
    fail("package manifest must not contain lifecycle scripts");
  }
  const manifest = requireExactObject(candidate, expectedManifestKeys, "package manifest");

  requireExactValue(manifest.name, "j-3dena", "package manifest name");
  requireExactValue(
    manifest.version,
    PUBLIC_PACKAGE_RELEASE_VERSION,
    "package manifest version",
  );
  requireExactValue(
    manifest.description,
    "Public TypeScript analysis facade for the j-3dENA successor",
    "package manifest description",
  );
  requireExactValue(manifest.type, "module", "package manifest type");
  requireExactValue(manifest.license, "GPL-3.0-only", "package manifest license");
  requireExactValue(manifest.sideEffects, false, "package manifest sideEffects");

  const peerDependencies = requireExactObject(
    manifest.peerDependencies,
    ["jena-js"],
    "package manifest peerDependencies",
  );
  requireExactValue(
    peerDependencies["jena-js"],
    "0.7.0-ona.0",
    "package manifest peerDependencies.jena-js",
  );

  const engines = requireExactObject(manifest.engines, ["node"], "package manifest engines");
  requireExactValue(engines.node, ">=20.9.0", "package manifest engines.node");

  const exports = requireExactObject(manifest.exports, ["."], "package manifest exports");
  const rootExport = requireExactObject(
    exports["."],
    ["types", "import"],
    "package manifest exports[\".\"]",
  );
  requireExactValue(rootExport.types, "./index.d.ts", "package manifest exports[\".\"].types");
  requireExactValue(rootExport.import, "./index.js", "package manifest exports[\".\"].import");

  if (
    !Array.isArray(manifest.files)
    || manifest.files.length !== expectedManifestFiles.length
    || manifest.files.some((file, index) => file !== expectedManifestFiles[index])
  ) {
    fail("package manifest files changed");
  }

  const publishConfig = requireExactObject(
    manifest.publishConfig,
    ["access", "provenance"],
    "package manifest publishConfig",
  );
  requireExactValue(publishConfig.access, "public", "package manifest publishConfig.access");
  requireExactValue(publishConfig.provenance, true, "package manifest publishConfig.provenance");

  const repository = requireExactObject(
    manifest.repository,
    ["type", "url"],
    "package manifest repository",
  );
  requireExactValue(repository.type, "git", "package manifest repository.type");
  requireExactValue(
    repository.url,
    "git+https://github.com/HUDongpin/j-3dENA.git",
    "package manifest repository.url",
  );

  return manifest;
}

export function verifyPublicPackageMetadataHygiene(metadata) {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    fail("metadata hygiene input must be an object");
  }
  for (const path of publicMetadataPaths) {
    const text = metadata[path];
    if (typeof text !== "string") fail(`metadata hygiene input is missing ${path}`);
    try {
      assertPublicMetadataHygiene(text, path);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      fail(`metadata hygiene rejected ${path}: ${detail}`);
    }
  }
  return metadata;
}

async function listFiles(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      result.push(...await listFiles(resolve(directory, entry.name), relative));
    } else if (entry.isFile()) {
      result.push(relative);
    } else {
      fail(`unsupported filesystem entry ${relative}`);
    }
  }
  return result.sort();
}

export async function verifyPublicPackageArtifactDigests(packageDirectory, provenance) {
  const directory = resolve(packageDirectory);
  const [indexBytes, sourceMapBytes, schemaIndexBytes] = await Promise.all([
    readFile(resolve(directory, "index.js")),
    readFile(resolve(directory, "index.js.map")),
    readFile(resolve(directory, "schemas/index.json")),
  ]);
  const indexJsSha256 = createHash("sha256").update(indexBytes).digest("hex");
  const indexJsMapSha256 = createHash("sha256").update(sourceMapBytes).digest("hex");
  const schemaIndexSha256 = createHash("sha256").update(schemaIndexBytes).digest("hex");
  if (provenance.artifacts?.indexJsSha256 !== indexJsSha256) fail("bundle digest does not match provenance");
  if (provenance.artifacts?.indexJsMapSha256 !== indexJsMapSha256) fail("source-map digest does not match provenance");
  if (provenance.artifacts?.schemaIndexSha256 !== schemaIndexSha256) fail("schema index digest does not match provenance");
  return Object.freeze({ indexJsSha256, indexJsMapSha256, schemaIndexSha256 });
}

export function verifyPublicPackageSourceBinding(provenance, {
  expectedSourceHead,
  artifactReceipt,
} = {}) {
  const receipt = artifactReceipt === undefined
    ? undefined
    : validatePublicPackageArtifactReceiptV2(artifactReceipt);
  if (expectedSourceHead !== undefined && !/^[0-9a-f]{40}$/u.test(expectedSourceHead)) {
    fail("expected source head is not a full Git commit identity");
  }
  if (
    receipt !== undefined
    && expectedSourceHead !== undefined
    && receipt.source.repositoryHead !== expectedSourceHead
  ) {
    fail("expected source head differs from receipt source");
  }
  const sourceHead = receipt?.source.repositoryHead
    ?? expectedSourceHead
    ?? provenance.source?.repositoryHead;
  if (!/^[0-9a-f]{40}$/u.test(sourceHead ?? "")) fail("public package has no valid source anchor");
  if (
    provenance.source?.repositoryHead !== sourceHead
    || provenance.package?.buildId !== sourceHead
    || (receipt !== undefined && receipt.package.buildId !== sourceHead)
  ) {
    fail("source repositoryHead, package buildId, and receipt source must be identical");
  }
  if (
    receipt !== undefined
    && (
      receipt.package.name !== provenance.package?.name
      || receipt.package.version !== provenance.package?.version
    )
  ) {
    fail("receipt package identity differs from provenance");
  }
  return sourceHead;
}

export async function verifyPublicPackage(packageDirectory, options = {}) {
  const directory = resolve(packageDirectory);
  if (!(await stat(directory)).isDirectory()) fail("staging path is not a directory");

  const manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
  verifyPublicPackageManifest(manifest);

  const manifestText = JSON.stringify(manifest);
  if (manifestText.includes("file:") || manifestText.includes("workspace:")) {
    fail("public manifest contains a local dependency protocol");
  }

  const files = await listFiles(directory);
  for (const required of expectedFiles) {
    if (!files.includes(required)) fail(`missing ${required}`);
  }
  if (!files.some((file) => file.startsWith("types/analysis/src/") && file.endsWith(".d.ts"))) {
    fail("analysis declarations were not emitted");
  }
  if (!files.includes("THIRD_PARTY/jena-js-LICENSE") || !files.includes("THIRD_PARTY/jena-js-PROVENANCE.md") || !files.includes("THIRD_PARTY/SheetJS-LICENSE.txt")) {
    fail("third-party license or provenance material is incomplete");
  }
  const metadata = Object.fromEntries(await Promise.all(publicMetadataPaths.map(async (path) => [
    path,
    await readFile(resolve(directory, path), "utf8"),
  ])));
  verifyPublicPackageMetadataHygiene(metadata);
  const schemaIndex = JSON.parse(await readFile(resolve(directory, "schemas/index.json"), "utf8"));
  const expectedSchemaNames = [
    "typedScalar", "typedKey", "taskOwner", "datasetReceipt", "analysisSpec", "displaySpec",
    "analysisExecutionDatasetV2", "analysisTask", "evidenceStamp", "provenanceManifest", "resultEnvelope",
    "trajectoryRunSpecV2", "trajectoryPathTaskV2", "trajectoryInferenceTaskV2",
    "trajectoryBootstrapTaskV2", "trajectoryNetworkOverlayTaskV2", "trajectoryDisplaySpecV2",
    "longitudinalAnalysisBundleV2",
  ];
  if (schemaIndex.schemaVersion !== "3dena.schema-index.v1" || JSON.stringify(Object.keys(schemaIndex.schemas).sort()) !== JSON.stringify(expectedSchemaNames.sort())) {
    fail("versioned JSON Schema index is incomplete");
  }
  for (const [name, file] of Object.entries(schemaIndex.schemas)) {
    if (typeof file !== "string" || !/^[a-z0-9.-]+\.json$/u.test(file)) fail(`schema index path for ${name} is unsafe`);
    const schema = JSON.parse(await readFile(resolve(directory, "schemas", file), "utf8"));
    if (typeof schema.$id !== "string" || !schema.$id.endsWith(`/${file}`)) fail(`schema ${name} has an inconsistent $id`);
  }
  if (files.some((file) => file.endsWith(".test.d.ts") || file.endsWith(".test.d.ts.map"))) {
    fail("test declarations leaked into the package");
  }
  const unexpectedRuntimeArtifacts = files.filter((file) =>
    /\.(?:c|m)?js(?:\.map)?$/u.test(file)
    && file !== "index.js"
    && file !== "index.js.map");
  if (unexpectedRuntimeArtifacts.length > 0) {
    fail(`single-artifact runtime contains unexpected JavaScript: ${unexpectedRuntimeArtifacts.join(", ")}`);
  }

  const javascript = await readFile(resolve(directory, "index.js"), "utf8");
  const declarationFiles = files.filter((file) => file.endsWith(".d.ts"));
  const declarations = (await Promise.all(declarationFiles.map((file) => readFile(resolve(directory, file), "utf8")))).join("\n");
  const forbiddenBareImport = /(?:from\s*|import\s*\()\s*["'](?:@3dena\/|xlsx(?:\/|["']))/u;
  if (forbiddenBareImport.test(javascript) || forbiddenBareImport.test(declarations)) {
    fail("staged output still imports an internal or bundled runtime package");
  }
  if (!/from\s*["']jena-js["']/u.test(javascript)) {
    fail("public runtime does not retain the required jENA peer edge");
  }
  if (/from\s*["']xlsx(?:\/[^"']*)?["']/u.test(javascript) || /import\s*\(\s*["']xlsx(?:\/[^"']*)?["']/u.test(javascript)) {
    fail("SheetJS was not bundled into the single public artifact");
  }
  if (/(?:from\s*|import\s*)["']\.{1,2}\//u.test(javascript)
      || /import\s*\(\s*["']\.{1,2}\//u.test(javascript)) {
    fail("single public runtime artifact contains a relative JavaScript import");
  }

  const sourceMap = JSON.parse(await readFile(resolve(directory, "index.js.map"), "utf8"));
  if (!Array.isArray(sourceMap.sources) || sourceMap.sources.length === 0 || !Array.isArray(sourceMap.sourcesContent)) {
    fail("JavaScript source map is missing embedded source material");
  }
  if (sourceMap.sources.length !== sourceMap.sourcesContent.length) {
    fail("JavaScript source-map source and content counts differ");
  }

  const provenance = JSON.parse(await readFile(resolve(directory, "PROVENANCE.json"), "utf8"));
  if (provenance.schemaVersion !== "3dena.public-package-provenance.v1") fail("unexpected provenance schema");
  if (provenance.productStatus !== "IMPLEMENTED_UNVERIFIED") fail("candidate status was inflated");
  if (
    provenance.source?.dirtyWorktree !== false ||
    typeof provenance.package?.buildId !== "string" ||
    provenance.package.buildId.endsWith("-dirty")
  ) {
    fail("release package provenance must bind a clean source worktree");
  }
  if (
    provenance.package?.name !== manifest.name ||
    provenance.package?.version !== manifest.version
  ) {
    fail("package manifest and provenance identity differ");
  }
  if (provenance.runtimeBoundary?.r !== false || provenance.runtimeBoundary?.rena !== false || provenance.runtimeBoundary?.rWebFramework !== false) {
    fail("runtime boundary is not explicit");
  }
  if (
    provenance.dependencies?.jenaJs?.version !== "0.7.0-ona.0"
    || provenance.dependencies?.jenaJs?.tarballIntegrity !== "sha512-gBhKP9d7C3akXTPlU03AJHBs+dBBDt1TUFGx96P/pB/s0GEGGX2aZFLJGWf9HLc+wuBJIjrJn7tIGicg1WQflQ=="
    || provenance.dependencies?.jenaJs?.auditedCommit !== "90790856f00bdef63dbd27fc3a5b502e8cffe65f"
  ) fail("jENA receipt identity drifted");
  if (provenance.runtimeBoundary?.runtimeNpmDependencies !== 0 || provenance.runtimeBoundary?.runtimeNpmPeers !== 1) {
    fail("jENA single-peer runtime boundary drifted");
  }
  if (provenance.dependencies?.sheetJs?.sha256 !== "8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8") {
    fail("SheetJS custody hash drifted");
  }
  const sourceHead = verifyPublicPackageSourceBinding(provenance, options);

  const { indexJsSha256: digest } = await verifyPublicPackageArtifactDigests(directory, provenance);

  const loaded = await import(`${pathToFileURL(resolve(directory, "index.js")).href}?verify=${digest}`);
  if (JSON.stringify(Object.keys(loaded).sort()) !== JSON.stringify(PUBLIC_PACKAGE_RUNTIME_EXPORT_NAMES)) {
    fail(`runtime root exports must be exactly ${PUBLIC_PACKAGE_RUNTIME_EXPORT_NAMES.join(", ")}`);
  }
  for (const publicName of PUBLIC_PACKAGE_RUNTIME_EXPORT_NAMES) {
    if (typeof loaded[publicName] !== "function") fail(`runtime root export ${publicName} is not a function`);
  }
  const scientificBuild = loaded.getAnalysisBuildIdentityV2();
  if (scientificBuild.sdkVersion !== manifest.version || scientificBuild.bound !== true) {
    fail("public runtime scientific SDK identity is not the exact package version");
  }

  return Object.freeze({ directory, files: Object.freeze(files), indexJsSha256: digest, sourceHead });
}

function parseArguments(arguments_) {
  const result = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument !== "--package" && argument !== "--tarball" && argument !== "--receipt") {
      fail(`unknown argument ${argument}`);
    }
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
    const key = argument === "--package"
      ? "packageDirectory"
      : argument === "--tarball"
        ? "tarballPath"
        : "receiptPath";
    if (result[key] !== undefined) fail(`${argument} may be supplied only once`);
    result[key] = value;
    index += 1;
  }
  for (const [key, argument] of [
    ["packageDirectory", "--package"],
    ["tarballPath", "--tarball"],
    ["receiptPath", "--receipt"],
  ]) {
    if (result[key] === undefined) fail(`${argument} is required`);
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const artifactReceipt = JSON.parse(await readFile(resolve(options.receiptPath), "utf8"));
  await verifyPublicPackageArtifactReceiptV2({
    receipt: artifactReceipt,
    packageDirectory: options.packageDirectory,
    tarballPath: options.tarballPath,
  });
  const result = await verifyPublicPackage(options.packageDirectory, { artifactReceipt });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
