#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PUBLIC_PACKAGE_RELEASE_VERSION } from "../packages/analysis/scripts/public-package-release-contract.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const packageDirectory = "packages/analysis/dist/package";
const trackedArtifactDirectory = "packages/analysis/dist";

function fail(message) {
  throw new Error(`LOCAL_PUBLIC_PACKAGE_GATE_FAILED: ${message}`);
}

function artifactPaths(directory, releaseVersion) {
  const tarball = join(directory, `j-3dena-${releaseVersion}.tgz`);
  return Object.freeze({ tarball, receipt: `${tarball}.artifact-receipt.json` });
}

export function createLocalPublicPackagePlan({
  headKind,
  releaseVersion,
  packageDirectory: stagedPackageDirectory,
  temporaryArtifactDirectory,
  trackedArtifactDirectory: trackedDirectory,
}) {
  if (headKind !== "source" && headKind !== "generated") fail("head kind must be source or generated");
  for (const [name, value] of Object.entries({
    releaseVersion,
    stagedPackageDirectory,
    temporaryArtifactDirectory,
    trackedDirectory,
  })) {
    if (typeof value !== "string" || value.length === 0) fail(`${name} must be a non-empty string`);
  }

  const artifactDirectory = headKind === "source" ? temporaryArtifactDirectory : trackedDirectory;
  const { tarball, receipt } = artifactPaths(artifactDirectory, releaseVersion);
  const verify = Object.freeze({
    action: "verify",
    args: Object.freeze([
      "--package", stagedPackageDirectory,
      "--tarball", tarball,
      "--receipt", receipt,
    ]),
  });
  const smoke = Object.freeze({
    action: "smoke",
    args: Object.freeze(["--tarball", tarball, "--receipt", receipt]),
  });
  if (headKind === "generated") return Object.freeze([verify, smoke]);
  return Object.freeze([
    Object.freeze({ action: "build", args: Object.freeze([]) }),
    Object.freeze({
      action: "artifact",
      args: Object.freeze([
        "--package", "dist/package",
        "--output-directory", temporaryArtifactDirectory,
      ]),
    }),
    verify,
    smoke,
  ]);
}

function runNode(script, args, stdio = "inherit") {
  return execFileSync(process.execPath, [resolve(repositoryRoot, script), ...args], {
    cwd: repositoryRoot,
    encoding: stdio === "pipe" ? "utf8" : undefined,
    stdio,
  });
}

function runNpm(args) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) fail("npm_execpath is required; invoke this gate through npm");
  execFileSync(process.execPath, [npmCli, ...args], {
    cwd: repositoryRoot,
    env: { ...process.env, npm_config_update_notifier: "false" },
    stdio: "inherit",
  });
}

async function runLocalPublicPackageGate() {
  if (process.argv.length !== 2) fail("this command accepts no arguments");
  const classificationOutput = runNode(
    "packages/analysis/scripts/public-package-head-governance.mjs",
    [],
    "pipe",
  );
  let classification;
  try {
    classification = JSON.parse(classificationOutput);
  } catch {
    fail("head governance did not return valid JSON");
  }

  const temporaryArtifactDirectory = classification.kind === "source"
    ? await mkdtemp(join(tmpdir(), "3dena-local-public-package-"))
    : resolve(repositoryRoot, trackedArtifactDirectory);
  const plan = createLocalPublicPackagePlan({
    headKind: classification.kind,
    releaseVersion: PUBLIC_PACKAGE_RELEASE_VERSION,
    packageDirectory: resolve(repositoryRoot, packageDirectory),
    temporaryArtifactDirectory,
    trackedArtifactDirectory: resolve(repositoryRoot, trackedArtifactDirectory),
  });

  try {
    for (const step of plan) {
      if (step.action === "build") {
        runNpm(["run", "build:public", "--workspace", "@3dena/analysis"]);
      } else if (step.action === "artifact") {
        runNpm(["run", "artifact:public", "--workspace", "@3dena/analysis", "--", ...step.args]);
      } else if (step.action === "verify") {
        runNode("packages/analysis/scripts/verify-public-package.mjs", step.args);
      } else if (step.action === "smoke") {
        runNpm(["run", "test:public-package", "--workspace", "@3dena/analysis", "--", ...step.args]);
      } else {
        fail(`unknown plan action ${step.action}`);
      }
    }
  } finally {
    if (classification.kind === "source") {
      await rm(temporaryArtifactDirectory, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runLocalPublicPackageGate();
}
