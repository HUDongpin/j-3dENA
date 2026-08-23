#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

export const JENA_SUCCESSOR_CONTRACT = Object.freeze({
  packageName: "jena-js",
  version: "0.7.0-ona.0",
  localTarball: "file:vendor/jena-js/jena-js-0.7.0-ona.0.tgz",
  tarballSha256: "1e071eaa4085688bbbd5f9d7122513a4bf82a0eaf955d399ab21706204fc8afe",
  integrity:
    "sha512-gBhKP9d7C3akXTPlU03AJHBs+dBBDt1TUFGx96P/pB/s0GEGGX2aZFLJGWf9HLc+wuBJIjrJn7tIGicg1WQflQ==",
  officialCommit: "90790856f00bdef63dbd27fc3a5b502e8cffe65f",
  license: "GPL-3.0-only",
});

function readJson(pathname) {
  return JSON.parse(readFileSync(pathname, "utf8"));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lockPathIsJena(lockPath, metadata) {
  return (
    metadata?.name === JENA_SUCCESSOR_CONTRACT.packageName ||
    lockPath === `node_modules/${JENA_SUCCESSOR_CONTRACT.packageName}` ||
    lockPath.endsWith(`/node_modules/${JENA_SUCCESSOR_CONTRACT.packageName}`)
  );
}

function finding(path, rule, detail) {
  return Object.freeze({ scope: "jena-successor", path, rule, detail });
}

export function inspectJenaSuccessor({
  root = DEFAULT_ROOT,
  requireInstalledTree = true,
} = {}) {
  const findings = [];
  let lock;
  try {
    lock = readJson(join(resolve(root), "package-lock.json"));
  } catch {
    findings.push(
      finding(
        "package-lock.json",
        "invalid-lockfile",
        "A readable npm lockfile is required for the jENA successor gate.",
      ),
    );
    return { ok: false, findings, evidence: { lockInstances: 0 } };
  }

  if (!isRecord(lock) || lock.lockfileVersion !== 3) {
    findings.push(
      finding(
        "package-lock.json",
        "unsupported-lockfile-shape",
        "The successor gate requires a non-array npm lockfile v3 object.",
      ),
    );
    return { ok: false, findings, evidence: { lockInstances: 0 } };
  }
  if (!isRecord(lock.packages)) {
    findings.push(
      finding(
        "package-lock.json#packages",
        "invalid-lock-packages",
        "The successor gate requires a non-array packages object.",
      ),
    );
    return { ok: false, findings, evidence: { lockInstances: 0 } };
  }
  if (!Object.hasOwn(lock.packages, "") || !isRecord(lock.packages[""])) {
    findings.push(
      finding(
        "package-lock.json#packages/",
        "invalid-lock-root",
        "The lockfile must contain a non-array root package object.",
      ),
    );
  } else if (
    !isRecord(lock.packages[""].devDependencies)
    || lock.packages[""].devDependencies[JENA_SUCCESSOR_CONTRACT.packageName] !== JENA_SUCCESSOR_CONTRACT.localTarball
  ) {
    findings.push(finding(
      "package-lock.json#packages//devDependencies/jena-js",
      "root-custody-pin",
      `The root lock entry must bind ${JENA_SUCCESSOR_CONTRACT.localTarball}.`,
    ));
  }

  try {
    const receipt = readJson(join(resolve(root), "vendor", "jena-js", "RECEIPT.json"));
    const archive = readFileSync(join(resolve(root), "vendor", "jena-js", "jena-js-0.7.0-ona.0.tgz"));
    const digest = createHash("sha256").update(archive).digest("hex");
    if (
      !isRecord(receipt)
      || receipt.schemaVersion !== "3dena.jena-artifact-receipt.v1"
      || receipt.package !== JENA_SUCCESSOR_CONTRACT.packageName
      || receipt.version !== JENA_SUCCESSOR_CONTRACT.version
      || receipt.officialCommit !== JENA_SUCCESSOR_CONTRACT.officialCommit
      || receipt.tarballSha256 !== JENA_SUCCESSOR_CONTRACT.tarballSha256
      || receipt.tarballIntegrity !== JENA_SUCCESSOR_CONTRACT.integrity
      || receipt.rEnaNumericalOracle !== false
      || digest !== JENA_SUCCESSOR_CONTRACT.tarballSha256
    ) {
      findings.push(finding("vendor/jena-js/RECEIPT.json", "invalid-jena-receipt", "The reviewed jENA source, archive, and numerical-authority receipt must agree."));
    }
  } catch {
    findings.push(finding("vendor/jena-js/RECEIPT.json", "missing-jena-receipt", "The reviewed jENA archive and receipt are required."));
  }

  let sourceManifest;
  try {
    sourceManifest = readJson(join(resolve(root), "packages", "analysis", "package.json"));
  } catch {
    findings.push(
      finding(
        "packages/analysis/package.json",
        "invalid-analysis-manifest",
        "A readable @3dena/analysis package manifest is required.",
      ),
    );
  }
  if (sourceManifest !== undefined) {
    if (!isRecord(sourceManifest)) {
      findings.push(
        finding(
          "packages/analysis/package.json",
          "invalid-analysis-manifest",
          "The @3dena/analysis manifest must be a non-array object.",
        ),
      );
    } else if (!isRecord(sourceManifest.peerDependencies)) {
      findings.push(
        finding(
          "packages/analysis/package.json#peerDependencies",
          "invalid-analysis-peer-dependencies",
          "The @3dena/analysis peer dependency map must be a non-array object.",
        ),
      );
    } else if (sourceManifest.peerDependencies[JENA_SUCCESSOR_CONTRACT.packageName] !== JENA_SUCCESSOR_CONTRACT.version) {
      findings.push(
        finding(
          "packages/analysis/package.json#peerDependencies/jena-js",
          "analysis-successor-pin",
          `@3dena/analysis must declare exactly one ${JENA_SUCCESSOR_CONTRACT.packageName}@${JENA_SUCCESSOR_CONTRACT.version} peer.`,
        ),
      );
    } else if (isRecord(sourceManifest.dependencies) && Object.hasOwn(sourceManifest.dependencies, JENA_SUCCESSOR_CONTRACT.packageName)) {
      findings.push(finding("packages/analysis/package.json#dependencies/jena-js", "duplicate-jena-runtime-edge", "jENA must not also be a bundled runtime dependency."));
    }
  }

  const analysisLock = lock.packages["packages/analysis"];
  if (!isRecord(analysisLock)) {
    findings.push(
      finding(
        "package-lock.json#packages/packages/analysis",
        "invalid-analysis-lock-entry",
        "The lockfile must contain a non-array @3dena/analysis workspace entry.",
      ),
    );
  } else if (!isRecord(analysisLock.peerDependencies)) {
    findings.push(
      finding(
        "package-lock.json#packages/packages/analysis/peerDependencies",
        "invalid-analysis-lock-peer-dependencies",
        "The analysis workspace lock peer dependency map must be a non-array object.",
      ),
    );
  } else if (analysisLock.peerDependencies[JENA_SUCCESSOR_CONTRACT.packageName] !== JENA_SUCCESSOR_CONTRACT.version) {
    findings.push(
      finding(
        "package-lock.json#packages/packages/analysis/peerDependencies/jena-js",
        "analysis-lock-successor-pin",
        `The workspace lock entry must pin exactly ${JENA_SUCCESSOR_CONTRACT.version}.`,
      ),
    );
  }

  const entries = Object.entries(lock.packages).filter(([lockPath, metadata]) =>
    lockPathIsJena(lockPath, metadata),
  );

  if (entries.length !== 1) {
    findings.push(
      finding(
        "package-lock.json#packages",
        "jena-instance-count",
        `Expected exactly one jena-js lock instance; observed ${entries.length}.`,
      ),
    );
  }

  for (const [lockPath, metadata] of entries) {
    const path = `package-lock.json#packages/${lockPath}`;
    if (!isRecord(metadata)) {
      findings.push(
        finding(
          path,
          "invalid-jena-lock-entry",
          "The jena-js lock entry must be a non-array object.",
        ),
      );
      continue;
    }
    if (metadata?.version !== JENA_SUCCESSOR_CONTRACT.version) {
      findings.push(
        finding(
          path,
          "unreviewed-jena-version",
          `Expected reviewed successor ${JENA_SUCCESSOR_CONTRACT.version}; observed ${String(metadata?.version)}.`,
        ),
      );
    }
    if (metadata?.resolved !== JENA_SUCCESSOR_CONTRACT.localTarball) {
      findings.push(
        finding(
          path,
          "unreviewed-tarball-source",
          "The successor must resolve to the repository's exact reviewed custody tarball.",
        ),
      );
    }
    if (metadata?.integrity !== JENA_SUCCESSOR_CONTRACT.integrity) {
      findings.push(
        finding(
          path,
          "tarball-integrity-mismatch",
          "The lock entry must bind the exact reviewed jENA tarball SRI.",
        ),
      );
    }
    const dependencies = Object.hasOwn(metadata, "dependencies") ? metadata.dependencies : {};
    if (!isRecord(dependencies)) {
      findings.push(
        finding(
          `${path}/dependencies`,
          "invalid-jena-runtime-dependencies",
          "The runtime dependency field must be absent or a non-array object.",
        ),
      );
      continue;
    }
    if (Object.hasOwn(dependencies, JENA_SUCCESSOR_CONTRACT.packageName)) {
      findings.push(
        finding(
          path,
          "jena-self-dependency",
          "jena-js may not declare a runtime dependency on itself.",
        ),
      );
    }
    if (Object.keys(dependencies).length > 0) {
      findings.push(
        finding(
          path,
          "unexpected-jena-runtime-dependency",
          "The reviewed jENA artifact has zero runtime dependencies.",
        ),
      );
    }
    if (metadata?.license !== JENA_SUCCESSOR_CONTRACT.license) {
      findings.push(
        finding(
          path,
          "jena-license-mismatch",
          `Expected ${JENA_SUCCESSOR_CONTRACT.license} lock metadata.`,
        ),
      );
    }
  }

  if (requireInstalledTree) {
    let installed;
    try {
      installed = readJson(
        join(resolve(root), "node_modules", JENA_SUCCESSOR_CONTRACT.packageName, "package.json"),
      );
    } catch {
      findings.push(
        finding(
          "node_modules/jena-js/package.json",
          "missing-installed-successor",
          "A clean npm install of the reviewed successor is required.",
        ),
      );
    }
    if (installed !== undefined) {
      if (!isRecord(installed)) {
        findings.push(
          finding(
            "node_modules/jena-js/package.json",
            "invalid-installed-successor",
            "The installed successor manifest must be a non-array object.",
          ),
        );
      } else if (
        installed.name !== JENA_SUCCESSOR_CONTRACT.packageName ||
        installed.version !== JENA_SUCCESSOR_CONTRACT.version
      ) {
        findings.push(
          finding(
            "node_modules/jena-js/package.json",
            "installed-successor-mismatch",
            "The installed package identity must match the reviewed lock identity.",
          ),
        );
      }
      const installedDependencies = isRecord(installed)
        ? Object.hasOwn(installed, "dependencies")
          ? installed.dependencies
          : {}
        : undefined;
      if (installedDependencies !== undefined && !isRecord(installedDependencies)) {
        findings.push(
          finding(
            "node_modules/jena-js/package.json#dependencies",
            "invalid-installed-runtime-dependencies",
            "The installed runtime dependency field must be absent or a non-array object.",
          ),
        );
      } else if (isRecord(installedDependencies) && Object.keys(installedDependencies).length > 0) {
        findings.push(
          finding(
            "node_modules/jena-js/package.json",
            "installed-runtime-dependencies",
            "The installed successor manifest must have zero runtime dependencies.",
          ),
        );
      }
      if (isRecord(installed) && installed.license !== JENA_SUCCESSOR_CONTRACT.license) {
        findings.push(
          finding(
            "node_modules/jena-js/package.json",
            "installed-license-mismatch",
            `The installed successor must declare ${JENA_SUCCESSOR_CONTRACT.license}.`,
          ),
        );
      }
    }
  }

  findings.sort((left, right) =>
    `${left.path}:${left.rule}`.localeCompare(`${right.path}:${right.rule}`),
  );
  return {
    ok: findings.length === 0,
    findings,
    evidence: Object.freeze({
      expectedVersion: JENA_SUCCESSOR_CONTRACT.version,
      lockInstances: entries.length,
      installedTreeRequired: requireInstalledTree,
    }),
  };
}

function parseArguments(argv) {
  const options = { root: DEFAULT_ROOT, requireInstalledTree: true, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") {
      if (!argv[index + 1]) throw new Error("--root requires a path");
      options.root = resolve(argv[index + 1]);
      index += 1;
    } else if (argument === "--allow-missing-installed-tree") {
      options.requireInstalledTree = false;
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "--help" || argument === "-h") {
      process.stdout.write(
        "Usage: node scripts/verify-jena-successor.mjs [--root <path>] [--allow-missing-installed-tree] [--json]\n",
      );
      return null;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function samePath(left, right) {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return resolve(left) === resolve(right);
  }
}

if (samePath(process.argv[1] ?? "", SCRIPT_PATH)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options !== null) {
      const result = inspectJenaSuccessor(options);
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(
          `${result.ok ? "PASS" : "FAIL"}: jENA ${JENA_SUCCESSOR_CONTRACT.version} successor gate; ${result.evidence.lockInstances} lock instance(s).\n`,
        );
        for (const item of result.findings) {
          process.stderr.write(`- [${item.rule}] ${item.path}: ${item.detail}\n`);
        }
      }
      process.exitCode = result.ok ? 0 : 1;
    }
  } catch (error) {
    process.stderr.write(`jENA successor verifier error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
