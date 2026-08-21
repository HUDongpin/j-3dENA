#!/usr/bin/env node

import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

export const JENA_SUCCESSOR_CONTRACT = Object.freeze({
  packageName: "jena-js",
  version: "0.6.3",
  registryTarball:
    "https://registry.npmjs.org/jena-js/-/jena-js-0.6.3.tgz",
  integrity:
    "sha512-AT/LTYt0YyQiGbO4Xq0XLES9FZ9rBuzj+J+Oq9s8B3HESy5bClzHFnjfpxThNmRWOM7HuuwM9E6NdOT0vyGNng==",
  license: "GPL-3.0-only",
});

function readJson(pathname) {
  return JSON.parse(readFileSync(pathname, "utf8"));
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

  const entries = Object.entries(lock.packages ?? {}).filter(([lockPath, metadata]) =>
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
    if (metadata?.version !== JENA_SUCCESSOR_CONTRACT.version) {
      findings.push(
        finding(
          path,
          "unreviewed-jena-version",
          `Expected reviewed successor ${JENA_SUCCESSOR_CONTRACT.version}; observed ${String(metadata?.version)}.`,
        ),
      );
    }
    if (metadata?.resolved !== JENA_SUCCESSOR_CONTRACT.registryTarball) {
      findings.push(
        finding(
          path,
          "non-registry-successor",
          "The successor must resolve to the exact public npm registry tarball; file, workspace, and private tarball substitutions are rejected.",
        ),
      );
    }
    if (metadata?.integrity !== JENA_SUCCESSOR_CONTRACT.integrity) {
      findings.push(
        finding(
          path,
          "registry-integrity-mismatch",
          "The registry lock entry must bind the exact independently reviewed npm tarball SRI.",
        ),
      );
    }
    const dependencies = metadata?.dependencies ?? {};
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
          "The reviewed 0.6.3 successor contract has zero runtime dependencies.",
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
      if (
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
      if (Object.keys(installed.dependencies ?? {}).length > 0) {
        findings.push(
          finding(
            "node_modules/jena-js/package.json",
            "installed-runtime-dependencies",
            "The installed successor manifest must have zero runtime dependencies.",
          ),
        );
      }
      if (installed.license !== JENA_SUCCESSOR_CONTRACT.license) {
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
