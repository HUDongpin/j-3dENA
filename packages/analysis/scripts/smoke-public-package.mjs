import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPublicPackageArtifactReceiptV2 } from "./public-package-artifact-receipt.mjs";
import { parsePublicPackageSmokeArguments } from "./public-package-smoke-contract.mjs";
import { verifyPublicPackage } from "./verify-public-package.mjs";

const require = createRequire(import.meta.url);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const jenaTarball = resolve(repositoryRoot, "vendor/jena-js/jena-js-0.7.0-ona.0.tgz");
const evidenceDirectory = process.env.THREEDENA_PUBLIC_PACKAGE_EVIDENCE_DIR === undefined
  ? null
  : resolve(repositoryRoot, process.env.THREEDENA_PUBLIC_PACKAGE_EVIDENCE_DIR);
let npmCli;

function run(command, args, cwd, environment = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...environment }
  });
}

let npmCacheDirectory;

function runNpm(args, cwd) {
  if (npmCacheDirectory === undefined) {
    throw new Error("PUBLIC_PACKAGE_SMOKE_FAILED: isolated npm cache is not initialized");
  }
  return run(process.execPath, [npmCli, ...args], cwd, {
    npm_config_cache: npmCacheDirectory,
    npm_config_update_notifier: "false",
  });
}

async function linkInstalledPackage(packageName, consumerDirectory) {
  const sourceDirectory = dirname(require.resolve(`${packageName}/package.json`));
  const targetDirectory = resolve(consumerDirectory, "node_modules", ...packageName.split("/"));
  await mkdir(dirname(targetDirectory), { recursive: true });
  await symlink(sourceDirectory, targetDirectory, "dir");
}

export async function smokePublicPackage({ tarballPath, receiptPath }) {
  npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("PUBLIC_PACKAGE_SMOKE_FAILED: npm_execpath is required");
  const tarball = resolve(tarballPath);
  const artifactReceipt = JSON.parse(await readFile(resolve(receiptPath), "utf8"));
  await verifyPublicPackageArtifactReceiptV2({ receipt: artifactReceipt, tarballPath: tarball });
  const packReceipt = artifactReceipt.npmPack;
  const packedPaths = packReceipt.files.map((entry) => entry.path);
  if (packedPaths.some((path) => path.includes("node_modules") || path.includes("vendor/") || path.endsWith(".test.ts"))) {
    throw new Error("PUBLIC_PACKAGE_SMOKE_FAILED: tarball contains a forbidden source path");
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "3dena-public-package-smoke-"));
  npmCacheDirectory = resolve(temporaryRoot, "npm-cache");
  await mkdir(npmCacheDirectory);
  let completed = false;

  try {
  const nodeConsumer = resolve(temporaryRoot, "node-consumer");
  await mkdir(nodeConsumer);
  await writeFile(resolve(nodeConsumer, "package.json"), `${JSON.stringify({ name: "3dena-node-consumer", private: true, type: "module" }, null, 2)}\n`);
  runNpm(["install", "--ignore-scripts", "--package-lock=false", "--no-audit", "--no-fund", tarball, jenaTarball], nodeConsumer);
  const installedPackage = resolve(nodeConsumer, "node_modules/j-3dena");
  await verifyPublicPackageArtifactReceiptV2({
    receipt: artifactReceipt,
    packageDirectory: installedPackage,
    tarballPath: tarball,
  });
  const verification = await verifyPublicPackage(installedPackage, { artifactReceipt });
  const nodeSmoke = `
    import {
      adaptFittedJenaTrajectoryResultV2,
      inspectDataset,
      executeAnalysisTask,
      assertAnalysisExecutionDatasetV2,
      assertAnalysisResultEnvelopeV1,
      createAnalysisClient,
      compilePlotlySpec,
      createExportBundle,
      assertTrajectoryRunSpecV2,
      assertLongitudinalAnalysisBundleV2,
      verifyLongitudinalAnalysisBundleV2,
      executeLongitudinalAnalysisV2,
      compileTrajectoryPlotlySpec,
      getAnalysisBuildIdentityV2,
      hashAnalysisValueV1
    } from "j-3dena";
    const inspection = await inspectDataset(
      new TextEncoder().encode("unit,conversation,A,B\\nu1,c1,1,0\\n"),
      { name: "consumer.csv" }
    );
    if (inspection.kind !== "tabular" || inspection.inventory.receipt.byteLength < 1) throw new Error("inspection failed");
    const client = createAnalysisClient({ baseUrl: "http://127.0.0.1:8787" });
    for (const candidate of [adaptFittedJenaTrajectoryResultV2, executeAnalysisTask, assertAnalysisExecutionDatasetV2, assertAnalysisResultEnvelopeV1, compilePlotlySpec, createExportBundle, assertTrajectoryRunSpecV2, assertLongitudinalAnalysisBundleV2, verifyLongitudinalAnalysisBundleV2, executeLongitudinalAnalysisV2, compileTrajectoryPlotlySpec, hashAnalysisValueV1, getAnalysisBuildIdentityV2, client.getBuildInfo]) {
      if (typeof candidate !== "function") throw new Error("public runtime export missing");
    }
  `;
  run(process.execPath, ["--input-type=module", "--eval", nodeSmoke], nodeConsumer);

  await writeFile(resolve(nodeConsumer, "consumer.ts"), `
    import {
      adaptFittedJenaTrajectoryResultV2,
      createAnalysisClient,
      inspectDataset,
      type AnalysisTaskV1,
      type DatasetInspectionV1,
      type DisplaySpecV1,
      type TrajectoryRunSpecV2,
      type LongitudinalAnalysisBundleV2
    } from "j-3dena";

    const client = createAnalysisClient({ baseUrl: "http://127.0.0.1:8787" });
    const inspection: Promise<DatasetInspectionV1> = inspectDataset(new Uint8Array([117]), { name: "x.csv" });
    const task: AnalysisTaskV1 | null = null;
    const display: DisplaySpecV1 | null = null;
    const trajectorySpec: TrajectoryRunSpecV2 | null = null;
    const trajectoryBundle: LongitudinalAnalysisBundleV2 | null = null;
    void [client, inspection, task, display, trajectorySpec, trajectoryBundle];
  `);
  await writeFile(resolve(nodeConsumer, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "ES2022",
      lib: ["DOM", "ES2022"],
      module: "NodeNext",
      moduleResolution: "NodeNext",
      skipLibCheck: false
    },
    include: ["consumer.ts"]
  }, null, 2)}\n`);
  run(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", resolve(nodeConsumer, "tsconfig.json")], nodeConsumer);

  const browserConsumer = resolve(temporaryRoot, "browser-consumer");
  await mkdir(resolve(browserConsumer, "src"), { recursive: true });
  await writeFile(resolve(browserConsumer, "package.json"), `${JSON.stringify({ name: "3dena-browser-consumer", private: true, type: "module" }, null, 2)}\n`);
  runNpm(["install", "--ignore-scripts", "--package-lock=false", "--no-audit", "--no-fund", tarball, jenaTarball], browserConsumer);
  await writeFile(resolve(browserConsumer, "index.html"), "<main id=app>3dENA browser consumer</main><script type=module src=/src/main.ts></script>\n");
  await writeFile(resolve(browserConsumer, "src/main.ts"), `
    import {
      adaptFittedJenaTrajectoryResultV2,
      inspectDataset,
      executeAnalysisTask,
      assertAnalysisExecutionDatasetV2,
      assertAnalysisResultEnvelopeV1,
      createAnalysisClient,
      compilePlotlySpec,
      createExportBundle,
      compileTrajectoryPlotlySpec,
      executeLongitudinalAnalysisV2,
      getAnalysisBuildIdentityV2
    } from "j-3dena";
    Object.assign(globalThis, {
      __THREEDENA_PUBLIC_SMOKE__: {
        inspectDataset,
        adaptFittedJenaTrajectoryResultV2,
        executeAnalysisTask,
        assertAnalysisExecutionDatasetV2,
        assertAnalysisResultEnvelopeV1,
        createAnalysisClient,
        compilePlotlySpec,
        createExportBundle,
        compileTrajectoryPlotlySpec,
        executeLongitudinalAnalysisV2,
        getAnalysisBuildIdentityV2
      }
    });
  `);
  await writeFile(resolve(browserConsumer, "vite.config.mjs"), "export default { build: { target: 'es2022', sourcemap: true } };\n");
  const viteCli = resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js");
  run(process.execPath, [viteCli, "build", "--config", "vite.config.mjs"], browserConsumer);

  const nextConsumer = resolve(temporaryRoot, "next-consumer");
  await mkdir(resolve(nextConsumer, "app"), { recursive: true });
  await writeFile(resolve(nextConsumer, "package.json"), `${JSON.stringify({ name: "3dena-next-consumer", private: true, type: "module" }, null, 2)}\n`);
  await mkdir(resolve(nextConsumer, "node_modules"));
  await cp(
    resolve(nodeConsumer, "node_modules/j-3dena"),
    resolve(nextConsumer, "node_modules/j-3dena"),
    { recursive: true },
  );
  await cp(
    resolve(nodeConsumer, "node_modules/jena-js"),
    resolve(nextConsumer, "node_modules/jena-js"),
    { recursive: true },
  );
  for (const packageName of [
    "next",
    "react",
    "react-dom",
    "typescript",
    "@types/node",
    "@types/react",
    "@types/react-dom",
  ]) {
    await linkInstalledPackage(packageName, nextConsumer);
  }
  await writeFile(resolve(nextConsumer, "app/layout.tsx"), `
    import type { ReactNode } from "react";
    export default function Layout({ children }: { children: ReactNode }) {
      return <html lang="en"><body>{children}</body></html>;
    }
  `);
  await writeFile(resolve(nextConsumer, "app/page.tsx"), `
    import { createAnalysisClient } from "j-3dena";
    const client = createAnalysisClient({ baseUrl: "http://127.0.0.1:8787" });
    export default function Page() {
      return <main data-analysis-client={typeof client.getBuildInfo}>j-3dENA package consumer</main>;
    }
  `);
  await writeFile(resolve(nextConsumer, "next.config.mjs"), "export default {};\n");
  run(process.execPath, [resolve(nextConsumer, "node_modules/next/dist/bin/next"), "build", "--webpack"], nextConsumer, {
    NEXT_TELEMETRY_DISABLED: "1"
  });

  const receipt = {
    schemaVersion: "3dena.public-package-smoke-receipt.v2",
    sourceHead: artifactReceipt.source.repositoryHead,
    packageVersion: packReceipt.version,
    tarballSha256: artifactReceipt.tarball.sha256,
    packageTreeSha256: artifactReceipt.tree.sha256,
    packedSize: packReceipt.size,
    unpackedSize: packReceipt.unpackedSize,
    fileCount: packedPaths.length,
    indexJsSha256: verification.indexJsSha256,
    nodeRuntime: "pass",
    typeDeclarations: "pass",
    browserBundler: "pass",
    nextWebpack: "pass",
    frameworkDependencySource: "repository-lockfile-installed-packages",
    status: "IMPLEMENTED_UNVERIFIED"
  };
  if (evidenceDirectory !== null) {
    await mkdir(evidenceDirectory, { recursive: true });
    await cp(tarball, resolve(evidenceDirectory, packReceipt.filename));
    await writeFile(
      resolve(evidenceDirectory, "npm-pack.json"),
      `${JSON.stringify([packReceipt], null, 2)}\n`,
      "utf8",
    );
    await cp(resolve(receiptPath), resolve(evidenceDirectory, "public-package-artifact-receipt.json"));
    await writeFile(
      resolve(evidenceDirectory, "public-package-smoke-receipt.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
      "utf8",
    );
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  completed = true;
} finally {
  if (completed) {
    await rm(temporaryRoot, { recursive: true, force: true });
  } else {
    process.stderr.write(`Public package smoke workspace retained for diagnosis: ${temporaryRoot}\n`);
  }
}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await smokePublicPackage(parsePublicPackageSmokeArguments(process.argv.slice(2)));
}
