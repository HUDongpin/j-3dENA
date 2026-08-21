import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

function fail(message) {
  throw new Error(`PUBLIC_PACKAGE_INVALID: ${message}`);
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

export async function verifyPublicPackage(packageDirectory) {
  const directory = resolve(packageDirectory);
  if (!(await stat(directory)).isDirectory()) fail("staging path is not a directory");

  const manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
  if (manifest.name !== "@3dena/analysis") fail("unexpected package name");
  if (manifest.private !== undefined) fail("staged public manifest must not contain private");
  if (manifest.type !== "module") fail("package must be ESM-only");
  if (manifest.license !== "GPL-3.0-only") fail("license must be GPL-3.0-only");
  if (manifest.engines?.node !== ">=20.9.0") fail("Node engine contract changed");
  if (Object.keys(manifest.exports ?? {}).join(",") !== ".") fail("only the root export is public");
  if (manifest.dependencies !== undefined || manifest.optionalDependencies !== undefined || manifest.peerDependencies !== undefined) {
    fail("public facade must not publish runtime dependency edges");
  }
  if (JSON.stringify(manifest.files) !== JSON.stringify(expectedManifestFiles)) {
    fail("public facade package inventory changed");
  }

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
  const schemaIndex = JSON.parse(await readFile(resolve(directory, "schemas/index.json"), "utf8"));
  const expectedSchemaNames = [
    "typedScalar", "typedKey", "taskOwner", "datasetReceipt", "analysisSpec", "displaySpec",
    "analysisExecutionDatasetV2", "analysisTask", "evidenceStamp", "provenanceManifest", "resultEnvelope",
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
  const forbiddenBareImport = /(?:from\s*|import\s*\()\s*["'](?:@3dena\/|jena-js(?:\/|["'])|xlsx(?:\/|["']))/u;
  if (forbiddenBareImport.test(javascript) || forbiddenBareImport.test(declarations)) {
    fail("staged output still imports an internal or bundled runtime package");
  }
  if (/from\s*["']jena-js(?:\/[^"']*)?["']/u.test(javascript) || /import\s*\(\s*["']jena-js(?:\/[^"']*)?["']/u.test(javascript)) {
    fail("jena-js was not bundled into the single public artifact");
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
  if (provenance.runtimeBoundary?.r !== false || provenance.runtimeBoundary?.rena !== false || provenance.runtimeBoundary?.rWebFramework !== false) {
    fail("runtime boundary is not explicit");
  }
  if (provenance.dependencies?.jenaJs?.version !== "0.6.2") fail("jENA version drifted");
  if (provenance.dependencies?.sheetJs?.sha256 !== "8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8") {
    fail("SheetJS custody hash drifted");
  }

  const digest = createHash("sha256").update(await readFile(resolve(directory, "index.js"))).digest("hex");
  if (provenance.artifacts?.indexJsSha256 !== digest) fail("bundle digest does not match provenance");
  const schemaIndexDigest = createHash("sha256").update(await readFile(resolve(directory, "schemas/index.json"))).digest("hex");
  if (provenance.artifacts?.schemaIndexSha256 !== schemaIndexDigest) fail("schema index digest does not match provenance");

  const loaded = await import(`${pathToFileURL(resolve(directory, "index.js")).href}?verify=${digest}`);
  const publicNames = ["assertAnalysisExecutionDatasetV2", "assertAnalysisResultEnvelopeV1", "compilePlotlySpec", "createAnalysisClient", "createExportBundle", "executeAnalysisTask", "inspectDataset"];
  if (JSON.stringify(Object.keys(loaded).sort()) !== JSON.stringify(publicNames)) {
    fail(`runtime root exports must be exactly ${publicNames.join(", ")}`);
  }
  for (const publicName of publicNames) {
    if (typeof loaded[publicName] !== "function") fail(`runtime root export ${publicName} is not a function`);
  }

  return Object.freeze({ directory, files: Object.freeze(files), indexJsSha256: digest });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const result = await verifyPublicPackage(process.argv[2] ?? "./dist/package");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
