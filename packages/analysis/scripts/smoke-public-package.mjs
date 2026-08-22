import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPublicPackage } from "./verify-public-package.mjs";

const require = createRequire(import.meta.url);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const packageDirectory = resolve(process.argv[2] ?? resolve(scriptDirectory, "../dist/package"));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("PUBLIC_PACKAGE_SMOKE_FAILED: npm_execpath is required");

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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const verification = await verifyPublicPackage(packageDirectory);
const temporaryRoot = await mkdtemp(join(tmpdir(), "3dena-public-package-smoke-"));
npmCacheDirectory = resolve(temporaryRoot, "npm-cache");
await mkdir(npmCacheDirectory);
let completed = false;

try {
  const packDirectory = resolve(temporaryRoot, "pack");
  await mkdir(packDirectory);
  const packJson = runNpm(["pack", packageDirectory, "--json", "--pack-destination", packDirectory], repositoryRoot);
  const packReceipts = JSON.parse(packJson);
  if (!Array.isArray(packReceipts) || packReceipts.length !== 1 || typeof packReceipts[0]?.filename !== "string") {
    throw new Error("PUBLIC_PACKAGE_SMOKE_FAILED: npm pack did not return one tarball receipt");
  }
  const packReceipt = packReceipts[0];
  const tarball = resolve(packDirectory, packReceipt.filename);
  const tarballBytes = await readFile(tarball);
  if (packReceipt.integrity === undefined || packReceipt.shasum === undefined || !Array.isArray(packReceipt.files)) {
    throw new Error("PUBLIC_PACKAGE_SMOKE_FAILED: npm pack receipt is incomplete");
  }
  const packedPaths = packReceipt.files.map((entry) => entry.path);
  if (packedPaths.some((path) => path.includes("node_modules") || path.includes("vendor/") || path.endsWith(".test.ts"))) {
    throw new Error("PUBLIC_PACKAGE_SMOKE_FAILED: tarball contains a forbidden source path");
  }

  const nodeConsumer = resolve(temporaryRoot, "node-consumer");
  await mkdir(nodeConsumer);
  await writeFile(resolve(nodeConsumer, "package.json"), `${JSON.stringify({ name: "3dena-node-consumer", private: true, type: "module" }, null, 2)}\n`);
  runNpm(["install", "--ignore-scripts", "--package-lock=false", "--no-audit", "--no-fund", tarball], nodeConsumer);
  const nodeSmoke = `
    import {
      inspectDataset,
      executeAnalysisTask,
      assertAnalysisExecutionDatasetV2,
      assertAnalysisResultEnvelopeV1,
      createAnalysisClient,
      compilePlotlySpec,
      createExportBundle
    } from "j-3dena";
    const inspection = await inspectDataset(
      new TextEncoder().encode("unit,conversation,A,B\\nu1,c1,1,0\\n"),
      { name: "consumer.csv" }
    );
    if (inspection.kind !== "tabular" || inspection.inventory.receipt.byteLength < 1) throw new Error("inspection failed");
    const client = createAnalysisClient({ baseUrl: "http://127.0.0.1:8787" });
    for (const candidate of [executeAnalysisTask, assertAnalysisExecutionDatasetV2, assertAnalysisResultEnvelopeV1, compilePlotlySpec, createExportBundle, client.getBuildInfo]) {
      if (typeof candidate !== "function") throw new Error("public runtime export missing");
    }
  `;
  run(process.execPath, ["--input-type=module", "--eval", nodeSmoke], nodeConsumer);

  await writeFile(resolve(nodeConsumer, "consumer.ts"), `
    import {
      createAnalysisClient,
      inspectDataset,
      type AnalysisTaskV1,
      type DatasetInspectionV1,
      type DisplaySpecV1
    } from "j-3dena";

    const client = createAnalysisClient({ baseUrl: "http://127.0.0.1:8787" });
    const inspection: Promise<DatasetInspectionV1> = inspectDataset(new Uint8Array([117]), { name: "x.csv" });
    const task: AnalysisTaskV1 | null = null;
    const display: DisplaySpecV1 | null = null;
    void [client, inspection, task, display];
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
  runNpm(["install", "--ignore-scripts", "--package-lock=false", "--no-audit", "--no-fund", tarball], browserConsumer);
  await writeFile(resolve(browserConsumer, "index.html"), "<main id=app>3dENA browser consumer</main><script type=module src=/src/main.ts></script>\n");
  await writeFile(resolve(browserConsumer, "src/main.ts"), `
    import {
      inspectDataset,
      executeAnalysisTask,
      assertAnalysisExecutionDatasetV2,
      assertAnalysisResultEnvelopeV1,
      createAnalysisClient,
      compilePlotlySpec,
      createExportBundle
    } from "j-3dena";
    Object.assign(globalThis, {
      __THREEDENA_PUBLIC_SMOKE__: {
        inspectDataset,
        executeAnalysisTask,
        assertAnalysisExecutionDatasetV2,
        assertAnalysisResultEnvelopeV1,
        createAnalysisClient,
        compilePlotlySpec,
        createExportBundle
      }
    });
  `);
  await writeFile(resolve(browserConsumer, "vite.config.mjs"), "export default { build: { target: 'es2022', sourcemap: true } };\n");
  const viteCli = resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js");
  run(process.execPath, [viteCli, "build", "--config", "vite.config.mjs"], browserConsumer);

  const nextConsumer = resolve(temporaryRoot, "next-consumer");
  await mkdir(resolve(nextConsumer, "app"), { recursive: true });
  await writeFile(resolve(nextConsumer, "package.json"), `${JSON.stringify({ name: "3dena-next-consumer", private: true, type: "module" }, null, 2)}\n`);
  runNpm([
    "install",
    "--ignore-scripts",
    "--package-lock=false",
    "--no-audit",
    "--no-fund",
    tarball,
    "next@16.3.1",
    "react@19.2.4",
    "react-dom@19.2.4",
    "typescript@5.9.3",
    "@types/node@24.10.13",
    "@types/react@19.2.14",
    "@types/react-dom@19.2.3"
  ], nextConsumer);
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
    schemaVersion: "3dena.public-package-smoke-receipt.v1",
    packageVersion: packReceipt.version,
    tarballSha256: sha256(tarballBytes),
    packedSize: packReceipt.size,
    unpackedSize: packReceipt.unpackedSize,
    fileCount: packedPaths.length,
    indexJsSha256: verification.indexJsSha256,
    nodeRuntime: "pass",
    typeDeclarations: "pass",
    browserBundler: "pass",
    nextWebpack: "pass",
    status: "IMPLEMENTED_UNVERIFIED"
  };
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  completed = true;
} finally {
  if (completed) {
    await rm(temporaryRoot, { recursive: true, force: true });
  } else {
    process.stderr.write(`Public package smoke workspace retained for diagnosis: ${temporaryRoot}\n`);
  }
}
