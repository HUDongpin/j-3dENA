import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { inspectJenaSuccessor } from "../../../scripts/verify-jena-successor.mjs";
import {
  DETERMINISTIC_SCHEMA_MODULE_QUERY,
  assertSourceSnapshotUnchanged,
  captureCleanSourceSnapshot,
  compareCodePoints,
  extractGzipTarEntry,
} from "./public-package-build-governance.mjs";
import {
  PUBLIC_PACKAGE_RELEASE_VERSION,
  PUBLIC_PACKAGE_SOURCE_VERSION,
} from "./public-package-release-contract.mjs";
import { verifyPublicPackage } from "./verify-public-package.mjs";

const require = createRequire(import.meta.url);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const analysisDirectory = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(analysisDirectory, "../..");
const distributionDirectory = resolve(analysisDirectory, "dist");
const packageDirectory = resolve(distributionDirectory, "package");
const typesDirectory = resolve(packageDirectory, "types");
const schemaRuntimeDirectory = resolve(distributionDirectory, "schema-runtime");

function fail(message) {
  throw new Error(`PUBLIC_PACKAGE_BUILD_FAILED: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sri512(bytes) {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

function assertSafeDistributionPath() {
  if (dirname(distributionDirectory) !== analysisDirectory || distributionDirectory.split(sep).at(-1) !== "dist") {
    fail("refusing to clean an unexpected distribution path");
  }
}

async function walkFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walkFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort(compareCodePoints);
}

function relativeModuleSpecifier(fromFile, toFile) {
  let path = relative(dirname(fromFile), toFile).split(sep).join("/");
  if (!path.startsWith(".")) path = `./${path}`;
  return path;
}

async function rewriteWorkspaceDeclarationImports() {
  const targets = new Map([
    ["@3dena/export", resolve(typesDirectory, "export/src/index.js")],
    ["@3dena/io", resolve(typesDirectory, "io/src/index.js")],
    ["@3dena/stats", resolve(typesDirectory, "stats/src/index.js")],
    ["@3dena/tabular-import", resolve(typesDirectory, "tabular-import/src/index.js")],
    ["@3dena/trajectory", resolve(typesDirectory, "trajectory/src/index.js")]
  ]);
  for (const file of await walkFiles(typesDirectory)) {
    if (!file.endsWith(".d.ts")) continue;
    let text = await readFile(file, "utf8");
    for (const [specifier, target] of targets) {
      text = text.replaceAll(`"${specifier}"`, `"${relativeModuleSpecifier(file, target)}"`);
      text = text.replaceAll(`'${specifier}'`, `'${relativeModuleSpecifier(file, target)}'`);
    }
    text = text.replace(
      /(["'])(\.{1,2}\/[^"']+)\1/gu,
      (match, quote, specifier) => {
        if (/\.(?:c|m)?js$|\.json$/u.test(specifier)) return match;
        return `${quote}${specifier}.js${quote}`;
      }
    );
    await writeFile(file, text, "utf8");
  }
}

const sourceSnapshot = captureCleanSourceSnapshot({ repositoryRoot });
const sourceIdentity = Object.freeze({
  repositoryHead: sourceSnapshot.repositoryHead,
  dirtyWorktree: sourceSnapshot.dirtyWorktree,
  generatedAt: sourceSnapshot.generatedAt,
});

assertSafeDistributionPath();
await rm(distributionDirectory, { recursive: true, force: true });
await mkdir(packageDirectory, { recursive: true });

const sourceManifest = JSON.parse(await readFile(resolve(analysisDirectory, "package.json"), "utf8"));
if (sourceManifest.version !== PUBLIC_PACKAGE_SOURCE_VERSION) {
  fail("workspace version does not match the source-controlled public release contract");
}
const jenaSuccessor = inspectJenaSuccessor({ root: repositoryRoot, requireInstalledTree: true });
if (!jenaSuccessor.ok) {
  fail(`reviewed public jENA successor contract failed: ${jenaSuccessor.findings.map(({ rule }) => rule).join(", ")}`);
}
const jenaReceipt = JSON.parse(await readFile(resolve(repositoryRoot, "vendor/jena-js/RECEIPT.json"), "utf8"));
const jenaArchive = await readFile(resolve(repositoryRoot, "vendor/jena-js", jenaReceipt.tarball));
if (
  jenaReceipt.schemaVersion !== "3dena.jena-artifact-receipt.v1"
  || jenaReceipt.package !== "jena-js"
  || jenaReceipt.version !== sourceManifest.peerDependencies?.["jena-js"]
  || !/^[0-9a-f]{40}$/u.test(jenaReceipt.officialCommit)
  || jenaReceipt.rEnaNumericalOracle !== false
) {
  fail("vendored jENA receipt does not match the package peer contract");
}
if (sha256(jenaArchive) !== jenaReceipt.tarballSha256 || sri512(jenaArchive) !== jenaReceipt.tarballIntegrity) {
  fail("vendored jENA tarball digest does not match its receipt");
}
const packageBuildId = sourceIdentity.repositoryHead;

const sheetArchivePath = resolve(repositoryRoot, "vendor/sheetjs/xlsx-0.20.3.tgz");
const sheetArchive = await readFile(sheetArchivePath);
const sheetArchiveSha256 = sha256(sheetArchive);
if (sheetArchiveSha256 !== "8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8") {
  fail("vendored SheetJS SHA-256 custody check failed");
}

await build({
  configFile: false,
  root: repositoryRoot,
  logLevel: "warn",
  resolve: {
    alias: {
      "@3dena/export": resolve(repositoryRoot, "packages/export/src/index.ts"),
      "@3dena/io": resolve(repositoryRoot, "packages/io/src/index.ts"),
      "@3dena/stats": resolve(repositoryRoot, "packages/stats/src/index.ts"),
      "@3dena/tabular-import": resolve(repositoryRoot, "packages/tabular-import/src/index.ts"),
      "@3dena/trajectory": resolve(repositoryRoot, "packages/trajectory/src/index.ts")
    }
  },
  define: {
    __THREEDENA_JENA_VERSION__: JSON.stringify(jenaReceipt.version),
    __THREEDENA_JENA_COMMIT__: JSON.stringify(jenaReceipt.officialCommit),
    __THREEDENA_JENA_TARBALL_INTEGRITY__: JSON.stringify(jenaReceipt.tarballIntegrity),
    __THREEDENA_SDK_VERSION__: JSON.stringify(PUBLIC_PACKAGE_RELEASE_VERSION),
    __THREEDENA_BUILD_ID__: JSON.stringify(packageBuildId)
  },
  build: {
    target: "es2022",
    outDir: packageDirectory,
    emptyOutDir: false,
    sourcemap: true,
    minify: false,
    lib: {
      entry: resolve(analysisDirectory, "src/public.ts"),
      formats: ["es"],
      fileName: () => "index.js"
    },
    rollupOptions: {
      external: ["jena-js"],
      // Workspace packages remain bundled into one public runtime artifact;
      // the exact jENA engine is deliberately supplied once by the consumer.
      output: {
        codeSplitting: false
      }
    }
  }
});

await build({
  configFile: false,
  root: repositoryRoot,
  logLevel: "warn",
  build: {
    target: "es2022",
    outDir: schemaRuntimeDirectory,
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: resolve(analysisDirectory, "src/contracts.ts"),
      formats: ["es"],
      fileName: () => "contracts.js"
    }
  }
});
const schemaRuntime = await import(`${pathToFileURL(resolve(schemaRuntimeDirectory, "contracts.js")).href}${DETERMINISTIC_SCHEMA_MODULE_QUERY}`);
const contractSchemas = schemaRuntime.CONTRACT_SCHEMAS_V1;
if (!contractSchemas || typeof contractSchemas !== "object" || Array.isArray(contractSchemas)) {
  fail("schema runtime did not export CONTRACT_SCHEMAS_V1");
}
const schemasDirectory = resolve(packageDirectory, "schemas");
await mkdir(schemasDirectory, { recursive: true });
const schemaIndex = {};
for (const [name, schema] of Object.entries(contractSchemas).sort(([left], [right]) => compareCodePoints(left, right))) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema) || typeof schema.$id !== "string") {
    fail(`contract schema ${name} is missing an absolute $id`);
  }
  const fileName = new URL(schema.$id).pathname.split("/").at(-1);
  if (!fileName || !fileName.endsWith(".json") || Object.values(schemaIndex).includes(fileName)) {
    fail(`contract schema ${name} has an invalid or duplicate $id filename`);
  }
  schemaIndex[name] = fileName;
  await writeFile(resolve(schemasDirectory, fileName), `${JSON.stringify(schema, null, 2)}\n`, "utf8");
}
await writeFile(resolve(schemasDirectory, "index.json"), `${JSON.stringify({ schemaVersion: "3dena.schema-index.v1", schemas: schemaIndex }, null, 2)}\n`, "utf8");
await rm(schemaRuntimeDirectory, { recursive: true, force: true });

const tscPath = require.resolve("typescript/bin/tsc");
execFileSync(process.execPath, [tscPath, "-p", resolve(analysisDirectory, "tsconfig.public.json")], {
  cwd: repositoryRoot,
  stdio: "inherit"
});
await rewriteWorkspaceDeclarationImports();
await writeFile(resolve(packageDirectory, "index.d.ts"), "export * from \"./types/analysis/src/public.js\";\n", "utf8");

await cp(resolve(repositoryRoot, "LICENSE"), resolve(packageDirectory, "LICENSE"));
await cp(resolve(analysisDirectory, "PUBLIC_PACKAGE_README.md"), resolve(packageDirectory, "README.md"));
await cp(resolve(analysisDirectory, "THIRD_PARTY_NOTICES.md"), resolve(packageDirectory, "THIRD_PARTY_NOTICES.md"));
await mkdir(resolve(packageDirectory, "THIRD_PARTY"), { recursive: true });
await writeFile(
  resolve(packageDirectory, "THIRD_PARTY/jena-js-LICENSE"),
  extractGzipTarEntry(jenaArchive, "package/LICENSE"),
);
await writeFile(
  resolve(packageDirectory, "THIRD_PARTY/jena-js-PROVENANCE.md"),
  extractGzipTarEntry(jenaArchive, "package/PROVENANCE.md"),
);
await writeFile(
  resolve(packageDirectory, "THIRD_PARTY/SheetJS-LICENSE.txt"),
  extractGzipTarEntry(sheetArchive, "package/LICENSE")
);

const publicVersion = PUBLIC_PACKAGE_RELEASE_VERSION;
const publicManifest = {
  name: "j-3dena",
  version: publicVersion,
  description: "Public TypeScript analysis facade for the j-3dENA successor",
  type: "module",
  license: "GPL-3.0-only",
  sideEffects: false,
  peerDependencies: {
    "jena-js": jenaReceipt.version
  },
  engines: { node: ">=20.9.0" },
  exports: {
    ".": {
      types: "./index.d.ts",
      import: "./index.js"
    }
  },
  files: [
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
  ],
  publishConfig: { access: "public", provenance: true },
  repository: {
    type: "git",
    url: "git+https://github.com/HUDongpin/j-3dENA.git"
  }
};
await writeFile(resolve(packageDirectory, "package.json"), `${JSON.stringify(publicManifest, null, 2)}\n`, "utf8");

const indexBytes = await readFile(resolve(packageDirectory, "index.js"));
const sourceMapBytes = await readFile(resolve(packageDirectory, "index.js.map"));
const schemaIndexBytes = await readFile(resolve(packageDirectory, "schemas/index.json"));
const provenance = {
  schemaVersion: "3dena.public-package-provenance.v1",
  productStatus: "IMPLEMENTED_UNVERIFIED",
  package: {
    name: publicManifest.name,
    version: publicManifest.version,
    buildId: packageBuildId
  },
  source: sourceIdentity,
  contracts: {
    analysis: "3dena.analysis-task.v1",
    result: "3dena.analysis-result-envelope.v1",
    evidence: "3dena.evidence-stamp.v1",
    provenance: "3dena.provenance-manifest.v1"
  },
  dependencies: {
    jenaJs: {
      version: jenaReceipt.version,
      auditedCommit: jenaReceipt.officialCommit,
      tarballSha256: jenaReceipt.tarballSha256,
      tarballIntegrity: jenaReceipt.tarballIntegrity,
      numericsSha256: jenaReceipt.numericsSha256,
      provenanceSha256: jenaReceipt.provenanceSha256,
      license: "GPL-3.0-only",
      packagingDisposition: "exact-single-instance-peer-from-reviewed-tarball"
    },
    sheetJs: {
      package: "xlsx",
      version: "0.20.3",
      sha256: sheetArchiveSha256,
      source: "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
      license: "Apache-2.0",
      packagingDisposition: "bundled-from-vendored-custody-archive"
    }
  },
  runtimeBoundary: {
    r: false,
    rena: false,
    rWebFramework: false,
    runtimeNpmDependencies: 0,
    runtimeNpmPeers: 1
  },
  artifacts: {
    indexJsSha256: sha256(indexBytes),
    indexJsMapSha256: sha256(sourceMapBytes),
    schemaIndexSha256: sha256(schemaIndexBytes)
  }
};
await writeFile(resolve(packageDirectory, "PROVENANCE.json"), `${JSON.stringify(provenance, null, 2)}\n`, "utf8");

const verification = await verifyPublicPackage(packageDirectory, {
  expectedSourceHead: sourceSnapshot.repositoryHead,
});
assertSourceSnapshotUnchanged(sourceSnapshot, {
  repositoryRoot,
  allowedDirtyPaths: ["packages/analysis/dist"],
});
process.stdout.write(`${JSON.stringify({ packageDirectory, version: publicManifest.version, ...verification }, null, 2)}\n`);
