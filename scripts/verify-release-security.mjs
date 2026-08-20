#!/usr/bin/env node

/**
 * Repository-level release-security gate for j-3dENA.
 *
 * This verifier is intentionally read-only. It reads only package manifests,
 * the npm lockfile, package license files, the staged public package, and an
 * in-memory or supplied CycloneDX document. It never searches arbitrary file
 * contents for secrets and never prints license or package payload contents.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import {
  basename,
  dirname,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

import { verifyPublicPackage } from "../packages/analysis/scripts/verify-public-package.mjs";
import {
  createReleaseSbom,
  RELEASE_SBOM_CONTRACT,
  SBOM_PROPERTY,
  stableStringify,
} from "./generate-release-sbom.mjs";
import { inspectProductionBoundary } from "./verify-production-boundary.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_PUBLIC_PACKAGE = "packages/analysis/dist/package";
const MAX_JSON_BYTES = 64 * 1024 * 1024;
const MAX_LICENSE_BYTES = 2 * 1024 * 1024;

/**
 * Candidate-review dispositions, not a substitute for release counsel. Every
 * accepted identifier has an explicit repository rationale; anything else is
 * fail-closed.
 */
export const LICENSE_DISPOSITIONS = Object.freeze({
  "0BSD": "permissive zero-clause BSD; preserve package attribution evidence",
  "Apache-2.0": "permissive Apache-2.0; preserve license and notice obligations",
  "BSD-2-Clause": "permissive BSD-2-Clause; preserve copyright and disclaimer",
  "BSD-3-Clause": "permissive BSD-3-Clause; preserve copyright, conditions, and disclaimer",
  "BlueOak-1.0.0": "permissive Blue Oak Model License; preserve license evidence",
  "CC-BY-4.0": "attribution license used by dependency data; preserve attribution evidence",
  "GPL-3.0-only": "project-selected GPL-3.0-only distribution boundary",
  "ISC": "permissive ISC; preserve copyright and permission notice",
  "LGPL-3.0-or-later": "reviewed LGPL-3.0-or-later dependency; preserve source and notice obligations",
  "MIT": "permissive MIT; preserve copyright and permission notice",
  "Unlicense": "public-domain dedication/fallback terms; preserve license evidence",
  "Zlib": "permissive zlib license; preserve notice and alteration marking obligations",
});

const APPROVED_LICENSE_FILE_HASHES = Object.freeze({
  // mapbox-gl 1.13.x carries a reviewed compound BSD/MIT notice bundle.
  dcd8c5e27012f2c0754081a51b5e742ca71f4928d557bd204ab14447b9b76f44: Object.freeze({
    expression: "BSD-3-Clause AND MIT",
    rationale:
      "reviewed Mapbox GL JS 1.13.x compound license bundle; exact file hash required",
  }),
});

const LICENSE_FILE_NAME = /^(?:licen[cs]e|copying)(?:[._-].*)?$/iu;
const SPDX_TOKEN = /[A-Za-z0-9][A-Za-z0-9.+-]*/gu;
const SPDX_OPERATORS = new Set(["AND", "OR", "WITH"]);
const FORBIDDEN_PUBLIC_SEGMENTS = new Set([
  ".git",
  "__fixtures__",
  "__tests__",
  "coverage",
  "e2e",
  "fixture",
  "fixtures",
  "node_modules",
  "oracle-r",
  "test",
  "tests",
  "vendor",
]);
const DEPENDENCY_FIELDS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "devDependencies",
  "bundleDependencies",
  "bundledDependencies",
];

function toPosix(pathname) {
  return pathname.split(sep).join("/");
}

function safeRealpath(pathname) {
  try {
    return realpathSync(pathname);
  } catch {
    return resolve(pathname);
  }
}

function isInside(root, pathname) {
  const rel = relative(root, pathname);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function addFinding(findings, scope, path, rule, detail) {
  findings.push(Object.freeze({ scope, path: toPosix(path), rule, detail }));
}

function sortFindings(findings) {
  findings.sort((left, right) =>
    `${left.scope}:${left.path}:${left.rule}`.localeCompare(
      `${right.scope}:${right.path}:${right.rule}`,
    ),
  );
  return findings;
}

function readJson(pathname) {
  const bytes = readFileSync(pathname);
  if (bytes.byteLength > MAX_JSON_BYTES) {
    throw new Error("JSON artifact exceeds the verifier size limit");
  }
  return JSON.parse(bytes.toString("utf8"));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function workspacePatterns(manifest) {
  if (Array.isArray(manifest.workspaces)) return manifest.workspaces;
  if (isRecord(manifest.workspaces) && Array.isArray(manifest.workspaces.packages)) {
    return manifest.workspaces.packages;
  }
  return null;
}

function expandWorkspacePattern(root, pattern, findings) {
  if (typeof pattern !== "string" || pattern.length === 0) {
    addFinding(
      findings,
      "workspace-manifest",
      "package.json#workspaces",
      "invalid-workspace-pattern",
      "Workspace patterns must be non-empty strings.",
    );
    return [];
  }
  if (pattern.endsWith("/*") && !pattern.slice(0, -2).includes("*")) {
    const baseRelative = pattern.slice(0, -2);
    const base = resolve(root, baseRelative);
    if (
      !isInside(root, base) ||
      !existsSync(base) ||
      lstatSync(base).isSymbolicLink() ||
      !isInside(safeRealpath(root), safeRealpath(base))
    ) {
      addFinding(
        findings,
        "workspace-manifest",
        "package.json#workspaces",
        "missing-workspace-root",
        `Workspace root ${JSON.stringify(baseRelative)} is missing or outside the repository.`,
      );
      return [];
    }
    const workspaceDirectories = [];
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const workspacePath = posix.join(baseRelative, entry.name);
      if (entry.isSymbolicLink()) {
        addFinding(
          findings,
          "workspace-manifest",
          workspacePath,
          "workspace-symlink",
          "Workspace symlinks are outside the reviewed publication boundary.",
        );
      } else if (entry.isDirectory()) {
        workspaceDirectories.push(workspacePath);
      }
    }
    return workspaceDirectories.sort();
  }
  if (/[*?[\]{}!]/u.test(pattern)) {
    addFinding(
      findings,
      "workspace-manifest",
      "package.json#workspaces",
      "unsupported-workspace-pattern",
      `Workspace pattern ${JSON.stringify(pattern)} is outside the reviewed direct-child contract.`,
    );
    return [];
  }
  const candidate = resolve(root, pattern);
  if (
    !isInside(root, candidate) ||
    !existsSync(candidate) ||
    lstatSync(candidate).isSymbolicLink() ||
    !isInside(safeRealpath(root), safeRealpath(candidate))
  ) {
    addFinding(
      findings,
      "workspace-manifest",
      "package.json#workspaces",
      "missing-workspace",
      `Workspace ${JSON.stringify(pattern)} is missing or outside the repository.`,
    );
    return [];
  }
  return [toPosix(pattern)];
}

export function inspectWorkspaceManifests({ root = DEFAULT_ROOT } = {}) {
  const resolvedRoot = resolve(root);
  const findings = [];
  const rootManifestPath = join(resolvedRoot, "package.json");
  let rootManifest;
  try {
    rootManifest = readJson(rootManifestPath);
  } catch {
    addFinding(
      findings,
      "workspace-manifest",
      "package.json",
      "invalid-root-manifest",
      "The root package manifest is missing, unreadable, oversized, or invalid JSON.",
    );
    return {
      ok: false,
      findings: sortFindings(findings),
      evidence: { manifests: 0, workspacePaths: Object.freeze([]) },
      rootManifest: null,
      workspaces: Object.freeze([]),
    };
  }

  if (rootManifest.private !== true) {
    addFinding(
      findings,
      "workspace-manifest",
      "package.json#private",
      "root-must-be-private",
      "The monorepo root must be private; publication is allowed only from the verified staged package.",
    );
  }
  if (rootManifest.license !== "GPL-3.0-only") {
    addFinding(
      findings,
      "workspace-manifest",
      "package.json#license",
      "root-license-drift",
      "The root license must remain GPL-3.0-only.",
    );
  }
  if (rootManifest.publishConfig?.access === "public") {
    addFinding(
      findings,
      "workspace-manifest",
      "package.json#publishConfig.access",
      "root-publication-bypass",
      "The private monorepo root may not bypass the staged public-package gate.",
    );
  }

  const patterns = workspacePatterns(rootManifest);
  if (patterns === null || patterns.length === 0) {
    addFinding(
      findings,
      "workspace-manifest",
      "package.json#workspaces",
      "missing-workspace-contract",
      "The root manifest must declare at least one workspace pattern.",
    );
  }
  const workspacePaths = [
    ...new Set(
      (patterns ?? []).flatMap((pattern) =>
        expandWorkspacePattern(resolvedRoot, pattern, findings),
      ),
    ),
  ].sort();
  const names = new Set();
  const workspaces = [];

  for (const workspacePath of workspacePaths) {
    const manifestPath = join(resolvedRoot, workspacePath, "package.json");
    let manifest;
    try {
      manifest = readJson(manifestPath);
    } catch {
      addFinding(
        findings,
        "workspace-manifest",
        `${workspacePath}/package.json`,
        "invalid-workspace-manifest",
        "Workspace manifest is missing, unreadable, oversized, or invalid JSON.",
      );
      continue;
    }
    const displayPath = `${workspacePath}/package.json`;
    if (typeof manifest.name !== "string" || !manifest.name.startsWith("@3dena/")) {
      addFinding(
        findings,
        "workspace-manifest",
        `${displayPath}#name`,
        "invalid-workspace-name",
        "Workspace package names must use the @3dena scope.",
      );
    } else if (names.has(manifest.name)) {
      addFinding(
        findings,
        "workspace-manifest",
        `${displayPath}#name`,
        "duplicate-workspace-name",
        `Workspace name ${JSON.stringify(manifest.name)} is duplicated.`,
      );
    } else {
      names.add(manifest.name);
    }
    if (manifest.private !== true) {
      addFinding(
        findings,
        "workspace-manifest",
        `${displayPath}#private`,
        "workspace-must-be-private",
        "Source workspaces must be private; only a separately staged and verified facade may be public.",
      );
    }
    if (manifest.publishConfig?.access === "public") {
      addFinding(
        findings,
        "workspace-manifest",
        `${displayPath}#publishConfig.access`,
        "workspace-publication-bypass",
        "A source workspace may not bypass the staged public-package gate.",
      );
    }
    if (manifest.license !== "GPL-3.0-only") {
      addFinding(
        findings,
        "workspace-manifest",
        `${displayPath}#license`,
        "workspace-license-drift",
        "Every source workspace must declare GPL-3.0-only.",
      );
    }
    workspaces.push(Object.freeze({ path: workspacePath, manifest }));
  }

  return {
    ok: findings.length === 0,
    findings: sortFindings(findings),
    evidence: Object.freeze({
      manifests: workspaces.length + 1,
      workspacePaths: Object.freeze([...workspacePaths]),
    }),
    rootManifest,
    workspaces: Object.freeze(workspaces),
  };
}

function lockPackageName(lockPath, metadata) {
  if (typeof metadata.name === "string" && metadata.name.length > 0) {
    return metadata.name;
  }
  const marker = "node_modules/";
  const index = lockPath.lastIndexOf(marker);
  return index === -1 ? null : lockPath.slice(index + marker.length);
}

function resolveLockDependency(packages, fromPath, dependencyName) {
  let current = fromPath;
  for (;;) {
    const candidate = current
      ? posix.join(current, "node_modules", dependencyName)
      : posix.join("node_modules", dependencyName);
    const metadata = packages[candidate];
    if (metadata !== undefined) {
      if (metadata.link === true && typeof metadata.resolved === "string") {
        return toPosix(metadata.resolved);
      }
      return candidate;
    }
    if (current === "") break;
    const parent = posix.dirname(current);
    current = parent === "." || parent === current ? "" : parent;
  }
  return null;
}

export function buildProductionDependencyGraph({
  root = DEFAULT_ROOT,
  workspacePaths,
} = {}) {
  const resolvedRoot = resolve(root);
  const findings = [];
  let lock;
  try {
    lock = readJson(join(resolvedRoot, "package-lock.json"));
  } catch {
    addFinding(
      findings,
      "production-license",
      "package-lock.json",
      "invalid-lockfile",
      "A valid npm lockfile is required for production dependency disposition.",
    );
    return { ok: false, findings, lock: null, rootRef: null, nodes: new Map(), edges: new Map() };
  }
  if (!isRecord(lock.packages) || !isRecord(lock.packages[""])) {
    addFinding(
      findings,
      "production-license",
      "package-lock.json#packages",
      "missing-lock-packages",
      "The npm lockfile must contain lockfile-v2/v3 package metadata.",
    );
    return { ok: false, findings, lock, rootRef: null, nodes: new Map(), edges: new Map() };
  }

  const packages = lock.packages;
  const rootMetadata = packages[""];
  const rootName = rootMetadata.name ?? lock.name;
  const rootVersion = rootMetadata.version ?? lock.version;
  const rootRef =
    typeof rootName === "string" && typeof rootVersion === "string"
      ? `${rootName}@${rootVersion}`
      : null;
  if (rootRef === null) {
    addFinding(
      findings,
      "production-license",
      "package-lock.json#packages/",
      "missing-root-identity",
      "The lockfile root needs a name and version for SBOM ownership.",
    );
  }

  const inferredWorkspacePaths = Object.keys(packages).filter((lockPath) =>
    /^(?:apps|packages)\/[^/]+$/u.test(lockPath),
  );
  const starts = ["", ...(workspacePaths ?? inferredWorkspacePaths)];
  const pending = [...new Set(starts)];
  const visitedPaths = new Set();
  const nodes = new Map();
  const edges = new Map();
  const pathToRef = new Map();

  while (pending.length > 0) {
    const lockPath = pending.shift();
    if (visitedPaths.has(lockPath)) continue;
    visitedPaths.add(lockPath);
    const metadata = packages[lockPath];
    if (!isRecord(metadata)) {
      addFinding(
        findings,
        "production-license",
        `package-lock.json#packages/${lockPath}`,
        "missing-workspace-lock-entry",
        "A declared workspace is missing from the lockfile.",
      );
      continue;
    }
    let reference = rootRef;
    if (lockPath !== "") {
      const name = lockPackageName(lockPath, metadata);
      if (name === null || typeof metadata.version !== "string") {
        addFinding(
          findings,
          "production-license",
          `package-lock.json#packages/${lockPath}`,
          "missing-package-identity",
          "A reachable production package needs a name and version.",
        );
        continue;
      }
      reference = `${name}@${metadata.version}`;
      const existing = nodes.get(reference);
      const paths = existing === undefined ? [] : [...existing.paths];
      if (!paths.includes(lockPath)) paths.push(lockPath);
      nodes.set(
        reference,
        Object.freeze({
          ref: reference,
          name,
          version: metadata.version,
          paths: Object.freeze(paths.sort()),
          optional: paths.every((path) => packages[path]?.optional === true),
        }),
      );
      pathToRef.set(lockPath, reference);
    }
    if (reference === null) continue;
    const dependencyNames = new Set([
      ...Object.keys(metadata.dependencies ?? {}),
      ...Object.keys(metadata.optionalDependencies ?? {}),
      ...Object.keys(metadata.peerDependencies ?? {}).filter(
        (name) => metadata.peerDependenciesMeta?.[name]?.optional !== true,
      ),
    ]);
    const resolvedDependencies = [];
    for (const dependencyName of dependencyNames) {
      const dependencyPath = resolveLockDependency(packages, lockPath, dependencyName);
      if (dependencyPath === null) {
        if (Object.hasOwn(metadata.optionalDependencies ?? {}, dependencyName)) continue;
        addFinding(
          findings,
          "production-license",
          `package-lock.json#packages/${lockPath}`,
          "unresolved-production-dependency",
          `Production dependency ${JSON.stringify(dependencyName)} cannot be resolved in the lockfile.`,
        );
        continue;
      }
      const dependencyMetadata = packages[dependencyPath];
      const dependencyPackageName = lockPackageName(dependencyPath, dependencyMetadata ?? {});
      if (
        dependencyPackageName === null ||
        typeof dependencyMetadata?.version !== "string"
      ) {
        addFinding(
          findings,
          "production-license",
          `package-lock.json#packages/${dependencyPath}`,
          "missing-package-identity",
          "A resolved production dependency needs a name and version.",
        );
        continue;
      }
      resolvedDependencies.push(`${dependencyPackageName}@${dependencyMetadata.version}`);
      pending.push(dependencyPath);
    }
    const currentEdges = edges.get(reference) ?? new Set();
    for (const dependencyRef of resolvedDependencies) currentEdges.add(dependencyRef);
    edges.set(reference, currentEdges);
  }

  if (rootRef !== null) {
    const rootEdges = edges.get(rootRef) ?? new Set();
    for (const workspacePath of workspacePaths ?? inferredWorkspacePaths) {
      const metadata = packages[workspacePath];
      if (isRecord(metadata) && typeof metadata.name === "string" && typeof metadata.version === "string") {
        rootEdges.add(`${metadata.name}@${metadata.version}`);
      }
    }
    edges.set(rootRef, rootEdges);
  }

  return {
    ok: findings.length === 0,
    findings: sortFindings(findings),
    lock,
    rootRef,
    nodes,
    edges,
    pathToRef,
  };
}

function licenseValues(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (typeof entry === "string") return [entry];
      if (isRecord(entry) && typeof entry.type === "string") return [entry.type];
      return [];
    });
  }
  if (isRecord(value) && typeof value.type === "string") return [value.type];
  return [];
}

function validateSpdxDisposition(expression) {
  const tokens = expression.match(SPDX_TOKEN) ?? [];
  const identifiers = tokens.filter((token) => !SPDX_OPERATORS.has(token));
  if (identifiers.length === 0 || /LicenseRef-|DocumentRef-|SEE\s+LICENSE/iu.test(expression)) {
    return null;
  }
  for (const identifier of identifiers) {
    if (!Object.hasOwn(LICENSE_DISPOSITIONS, identifier)) return null;
  }
  return Object.freeze({
    expression,
    identifiers: Object.freeze([...new Set(identifiers)]),
    rationale: identifiers
      .map((identifier) => LICENSE_DISPOSITIONS[identifier])
      .join("; "),
  });
}

function detectLicenseText(text) {
  const detected = [];
  const normalized = text.replace(/\r\n/gu, "\n");
  if (
    /Permission is hereby granted, free of charge, to any person obtaining a copy/iu.test(
      normalized,
    ) && /THE SOFTWARE IS PROVIDED/iu.test(normalized)
  ) {
    detected.push("MIT");
  }
  if (/Redistribution and use in source and binary forms/iu.test(normalized)) {
    detected.push(
      /Neither the name/iu.test(normalized) ? "BSD-3-Clause" : "BSD-2-Clause",
    );
  }
  if (/Apache License\s+Version 2\.0/iu.test(normalized)) detected.push("Apache-2.0");
  if (/GNU LESSER GENERAL PUBLIC LICENSE/iu.test(normalized)) {
    detected.push("LGPL-3.0-or-later");
  } else if (/GNU GENERAL PUBLIC LICENSE[\s\S]{0,160}Version 3/iu.test(normalized)) {
    detected.push("GPL-3.0-only");
  }
  if (/Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee/iu.test(normalized)) {
    detected.push("ISC");
  }
  if (/Attribution 4\.0 International/iu.test(normalized)) detected.push("CC-BY-4.0");
  if (/free and unencumbered software released into the public domain/iu.test(normalized)) {
    detected.push("Unlicense");
  }
  if (/Blue Oak Model License/iu.test(normalized)) detected.push("BlueOak-1.0.0");
  if (/This software is provided ['"]as-is['"]/iu.test(normalized) && /altered source versions must be plainly marked/iu.test(normalized)) {
    detected.push("Zlib");
  }
  return [...new Set(detected)];
}

function inspectLicenseFile(pathname) {
  let bytes;
  try {
    bytes = readFileSync(pathname);
  } catch {
    return null;
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_LICENSE_BYTES) return null;
  const digest = sha256(bytes);
  const approvedHash = APPROVED_LICENSE_FILE_HASHES[digest];
  if (approvedHash !== undefined) {
    return Object.freeze({
      expression: approvedHash.expression,
      rationale: approvedHash.rationale,
      source: `license-file:${basename(pathname)}#sha256:${digest}`,
    });
  }
  const detected = detectLicenseText(bytes.toString("utf8"));
  if (detected.length === 0) return null;
  return Object.freeze({
    expression: detected.join(" AND "),
    rationale: detected.map((id) => LICENSE_DISPOSITIONS[id]).join("; "),
    source: `license-file:${basename(pathname)}#sha256:${digest}`,
  });
}

function packageDirectory(root, lockPath) {
  return resolve(root, ...lockPath.split("/"));
}

function resolvePackageLicense(root, lockPath, metadata) {
  const directory = packageDirectory(root, lockPath);
  if (
    !isInside(root, directory) ||
    (existsSync(directory) && !isInside(safeRealpath(root), safeRealpath(directory)))
  ) {
    return null;
  }
  let declared = metadata.license ?? metadata.licenses;
  const installedManifestPath = join(directory, "package.json");
  if (declared === undefined && existsSync(installedManifestPath)) {
    try {
      const installedManifest = readJson(installedManifestPath);
      declared = installedManifest.license ?? installedManifest.licenses;
    } catch {
      return null;
    }
  }
  const values = licenseValues(declared);
  if (values.length > 0) {
    const dispositions = [];
    for (const value of values) {
      const seeLicense = /^SEE LICENSE IN ([A-Za-z0-9._-]+)$/u.exec(value);
      if (seeLicense !== null) {
        const inspected = inspectLicenseFile(join(directory, seeLicense[1]));
        if (inspected === null) return null;
        dispositions.push(inspected);
        continue;
      }
      const disposition = validateSpdxDisposition(value);
      if (disposition === null) return null;
      dispositions.push(
        Object.freeze({
          expression: disposition.expression,
          rationale: disposition.rationale,
          source: metadata.license !== undefined ? "package-lock:license" : "package-manifest:license",
        }),
      );
    }
    return Object.freeze({
      expression: dispositions.map(({ expression }) => expression).join(" OR "),
      rationale: dispositions.map(({ rationale }) => rationale).join("; "),
      sources: Object.freeze(dispositions.map(({ source }) => source)),
    });
  }

  if (!existsSync(directory)) return null;
  const candidates = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && LICENSE_FILE_NAME.test(entry.name))
    .map((entry) => join(directory, entry.name))
    .sort();
  const inspected = candidates.map(inspectLicenseFile).filter(Boolean);
  if (inspected.length === 0) return null;
  return Object.freeze({
    expression: [...new Set(inspected.map(({ expression }) => expression))].join(" AND "),
    rationale: inspected.map(({ rationale }) => rationale).join("; "),
    sources: Object.freeze(inspected.map(({ source }) => source)),
  });
}

export function inspectProductionDependencyLicenses({
  root = DEFAULT_ROOT,
  graph,
} = {}) {
  const resolvedRoot = resolve(root);
  const findings = [];
  const dependencyGraph = graph ?? buildProductionDependencyGraph({ root: resolvedRoot });
  findings.push(...dependencyGraph.findings);
  const dispositions = new Map();
  const licenseCounts = new Map();
  if (dependencyGraph.lock === null) {
    return {
      ok: false,
      findings: sortFindings(findings),
      evidence: { productionPackages: 0, disposedPackages: 0, licenseCounts: {} },
      dispositions,
    };
  }
  const packages = dependencyGraph.lock.packages;
  for (const [reference, node] of dependencyGraph.nodes) {
    const pathDispositions = [];
    for (const lockPath of node.paths) {
      const disposition = resolvePackageLicense(
        resolvedRoot,
        lockPath,
        packages[lockPath],
      );
      if (disposition === null) {
        addFinding(
          findings,
          "production-license",
          `package-lock.json#packages/${lockPath}`,
          "unknown-production-license",
          `No approved declared, legacy, or installed license-file disposition exists for ${reference}.`,
        );
      } else {
        pathDispositions.push(disposition);
      }
    }
    if (pathDispositions.length !== node.paths.length) continue;
    const expressions = [...new Set(pathDispositions.map(({ expression }) => expression))];
    if (expressions.length !== 1) {
      addFinding(
        findings,
        "production-license",
        node.paths[0],
        "conflicting-license-disposition",
        `Reachable copies of ${reference} have inconsistent license dispositions.`,
      );
      continue;
    }
    const disposition = Object.freeze({
      reference,
      expression: expressions[0],
      rationale: pathDispositions.map(({ rationale }) => rationale).join("; "),
      sources: Object.freeze(pathDispositions.flatMap(({ sources }) => sources)),
    });
    dispositions.set(reference, disposition);
    licenseCounts.set(
      disposition.expression,
      (licenseCounts.get(disposition.expression) ?? 0) + 1,
    );
  }

  return {
    ok: findings.length === 0,
    findings: sortFindings(findings),
    evidence: Object.freeze({
      productionPackages: dependencyGraph.nodes.size,
      disposedPackages: dispositions.size,
      licenseCounts: Object.freeze(Object.fromEntries([...licenseCounts].sort())),
    }),
    dispositions,
  };
}

function walkPublicFiles(root, directory, findings, prefix = "") {
  const files = [];
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    addFinding(
      findings,
      "public-package",
      toPosix(relative(root, directory)),
      "unreadable-public-package",
      "The staged public package directory cannot be read.",
    );
    return files;
  }
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const pathname = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      addFinding(
        findings,
        "public-package",
        relativePath,
        "public-package-symlink",
        "Symlinks are forbidden in the staged public package.",
      );
    } else if (entry.isDirectory()) {
      files.push(...walkPublicFiles(root, pathname, findings, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      addFinding(
        findings,
        "public-package",
        relativePath,
        "unsupported-public-entry",
        "Only regular files and directories are allowed in the staged public package.",
      );
    }
  }
  return files;
}

function localProtocolInManifest(manifest) {
  return /(?:^|["':\s])(?:file:|workspace:)/u.test(JSON.stringify(manifest));
}

export function inspectPublicPackageLayout({
  root = DEFAULT_ROOT,
  packageDirectory = resolve(root, DEFAULT_PUBLIC_PACKAGE),
} = {}) {
  const resolvedRoot = resolve(root);
  const directory = resolve(packageDirectory);
  const findings = [];
  if (
    !isInside(resolvedRoot, directory) ||
    !existsSync(directory) ||
    !isInside(safeRealpath(resolvedRoot), safeRealpath(directory))
  ) {
    addFinding(
      findings,
      "public-package",
      toPosix(relative(resolvedRoot, directory)),
      "missing-public-package",
      "The staged public package is missing or outside the repository.",
    );
    return { ok: false, findings, evidence: { files: 0 } };
  }
  const manifestPath = join(directory, "package.json");
  let manifest;
  try {
    manifest = readJson(manifestPath);
  } catch {
    addFinding(
      findings,
      "public-package",
      toPosix(relative(resolvedRoot, manifestPath)),
      "invalid-public-manifest",
      "The staged public package manifest is invalid.",
    );
    return { ok: false, findings, evidence: { files: 0 } };
  }
  const manifestDisplayPath = toPosix(relative(resolvedRoot, manifestPath));
  if (manifest.private !== undefined) {
    addFinding(
      findings,
      "public-package",
      `${manifestDisplayPath}#private`,
      "public-manifest-private-field",
      "The staged public manifest must omit the private field.",
    );
  }
  if (manifest.license !== "GPL-3.0-only") {
    addFinding(
      findings,
      "public-package",
      `${manifestDisplayPath}#license`,
      "public-license-drift",
      "The public facade must declare GPL-3.0-only.",
    );
  }
  if (manifest.publishConfig?.access !== "public" || manifest.publishConfig?.provenance !== true) {
    addFinding(
      findings,
      "public-package",
      `${manifestDisplayPath}#publishConfig`,
      "incomplete-publication-policy",
      "Public access and registry provenance must both be explicit.",
    );
  }
  if (!isRecord(manifest.exports) || Object.keys(manifest.exports).join(",") !== ".") {
    addFinding(
      findings,
      "public-package",
      `${manifestDisplayPath}#exports`,
      "non-root-public-export",
      "Only the root export may be public.",
    );
  }
  for (const field of DEPENDENCY_FIELDS) {
    const value = manifest[field];
    const nonEmpty = Array.isArray(value)
      ? value.length > 0
      : isRecord(value)
        ? Object.keys(value).length > 0
        : value !== undefined;
    if (nonEmpty) {
      addFinding(
        findings,
        "public-package",
        `${manifestDisplayPath}#${field}`,
        "public-runtime-edge",
        "The bundled public facade may not publish dependency edges.",
      );
    }
  }
  if (localProtocolInManifest(manifest)) {
    addFinding(
      findings,
      "public-package",
      manifestDisplayPath,
      "public-local-protocol",
      "file: and workspace: protocols are forbidden in public package metadata.",
    );
  }
  if (manifest.bin !== undefined || manifest.browser !== undefined || manifest.imports !== undefined) {
    addFinding(
      findings,
      "public-package",
      manifestDisplayPath,
      "alternate-public-entrypoint",
      "bin, browser, and package imports may not bypass the single root export.",
    );
  }

  const files = walkPublicFiles(resolvedRoot, directory, findings).sort();
  for (const file of files) {
    const segments = file.toLowerCase().split("/");
    if (
      segments.some((segment) => FORBIDDEN_PUBLIC_SEGMENTS.has(segment)) ||
      /(?:^|[._-])fixtures?(?:[._-]|$)/iu.test(basename(file)) ||
      /(?:^|\.)test\.[^.]+$/iu.test(basename(file)) ||
      /(?:^|\.)spec\.[^.]+$/iu.test(basename(file))
    ) {
      addFinding(
        findings,
        "public-package",
        file,
        "private-public-artifact",
        "Fixtures, tests, vendor trees, node_modules, and other private artifacts are forbidden.",
      );
    }
  }
  for (const required of [
    "LICENSE",
    "PROVENANCE.json",
    "README.md",
    "THIRD_PARTY_NOTICES.md",
    "index.d.ts",
    "index.js",
    "index.js.map",
    "package.json",
  ]) {
    if (!files.includes(required)) {
      addFinding(
        findings,
        "public-package",
        required,
        "missing-public-artifact",
        `Required public artifact ${required} is missing.`,
      );
    }
  }

  const publicLicensePath = join(directory, "LICENSE");
  const rootLicensePath = join(resolvedRoot, "LICENSE");
  if (existsSync(publicLicensePath) && existsSync(rootLicensePath)) {
    if (!readFileSync(publicLicensePath).equals(readFileSync(rootLicensePath))) {
      addFinding(
        findings,
        "public-package",
        "LICENSE",
        "public-license-bytes-drift",
        "The staged GPL license bytes differ from the repository license.",
      );
    }
  }
  const noticesPath = join(directory, "THIRD_PARTY_NOTICES.md");
  if (existsSync(noticesPath)) {
    const notices = readFileSync(noticesPath, "utf8");
    for (const marker of ["jena-js", "SheetJS", "GPL-3.0-only", "Apache-2.0"]) {
      if (!notices.includes(marker)) {
        addFinding(
          findings,
          "public-package",
          "THIRD_PARTY_NOTICES.md",
          "incomplete-third-party-notices",
          `Third-party notices are missing the required ${marker} disposition marker.`,
        );
      }
    }
  }
  const provenancePath = join(directory, "PROVENANCE.json");
  if (existsSync(provenancePath)) {
    try {
      const provenance = readJson(provenancePath);
      if (
        provenance.package?.name !== manifest.name ||
        provenance.package?.version !== manifest.version
      ) {
        addFinding(
          findings,
          "public-package",
          "PROVENANCE.json#package",
          "public-provenance-identity-mismatch",
          "Public provenance must bind the staged manifest name and version.",
        );
      }
      const mapPath = join(directory, "index.js.map");
      if (
        existsSync(mapPath) &&
        provenance.artifacts?.indexJsMapSha256 !== sha256(readFileSync(mapPath))
      ) {
        addFinding(
          findings,
          "public-package",
          "PROVENANCE.json#artifacts.indexJsMapSha256",
          "public-provenance-map-digest-mismatch",
          "The JavaScript source-map digest does not match public provenance.",
        );
      }
    } catch {
      addFinding(
        findings,
        "public-package",
        "PROVENANCE.json",
        "invalid-public-provenance",
        "Public provenance is unreadable, oversized, or invalid JSON.",
      );
    }
  }

  return {
    ok: findings.length === 0,
    findings: sortFindings(findings),
    evidence: Object.freeze({ directory, files: files.length }),
  };
}

export function generateCycloneDxSbom({ root = DEFAULT_ROOT, npmCli = "npm" } = {}) {
  const output = execFileSync(
    npmCli,
    [
      "sbom",
      "--omit=dev",
      "--package-lock-only",
      "--sbom-format=cyclonedx",
    ],
    {
      cwd: resolve(root),
      encoding: "utf8",
      maxBuffer: MAX_JSON_BYTES,
      stdio: ["ignore", "pipe", "ignore"],
      env: {
        ...process.env,
        npm_config_audit: "false",
        npm_config_fund: "false",
        npm_config_offline: "true",
        npm_config_update_notifier: "false",
      },
    },
  );
  return JSON.parse(output);
}

function cycloneDxLicenseIds(component) {
  if (!Array.isArray(component?.licenses)) return [];
  return component.licenses.flatMap((entry) => {
    if (typeof entry?.expression === "string") return [entry.expression];
    if (typeof entry?.license?.id === "string") return [entry.license.id];
    return [];
  });
}

function cycloneDxProperties(value, findings, path) {
  const result = new Map();
  if (!Array.isArray(value)) return result;
  for (let index = 0; index < value.length; index += 1) {
    const property = value[index];
    if (typeof property?.name !== "string" || typeof property?.value !== "string") {
      addFinding(
        findings,
        "sbom",
        `${path}/${index}`,
        "invalid-sbom-property",
        "CycloneDX properties must contain string name and value fields.",
      );
      continue;
    }
    if (result.has(property.name)) {
      addFinding(
        findings,
        "sbom",
        `${path}/${index}`,
        "duplicate-sbom-property",
        `CycloneDX property ${JSON.stringify(property.name)} is duplicated.`,
      );
      continue;
    }
    result.set(property.name, property.value);
  }
  return result;
}

function sameStringSet(left, right) {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

export function validateCycloneDxSbom({ sbom, graph, dispositions }) {
  const findings = [];
  if (!isRecord(sbom)) {
    addFinding(
      findings,
      "sbom",
      "sbom.cdx.json",
      "invalid-sbom-document",
      "The CycloneDX document must be a JSON object.",
    );
    return { ok: false, findings, evidence: { components: 0, dependencies: 0 } };
  }
  if (sbom.bomFormat !== "CycloneDX" || !["1.5", "1.6"].includes(sbom.specVersion)) {
    addFinding(
      findings,
      "sbom",
      "sbom.cdx.json",
      "unsupported-cyclonedx-contract",
      "The SBOM must use CycloneDX 1.5 or 1.6.",
    );
  }
  let expectedDocument = null;
  try {
    expectedDocument = createReleaseSbom({ graph, dispositions });
  } catch {
    addFinding(
      findings,
      "sbom",
      "package-lock.json",
      "invalid-release-sbom-input",
      "The reviewed production graph or license evidence is incomplete.",
    );
  }
  if (!Number.isSafeInteger(sbom.version) || sbom.version < 1) {
    addFinding(
      findings,
      "sbom",
      "sbom.cdx.json#version",
      "invalid-sbom-version",
      "CycloneDX document version must be a positive integer.",
    );
  }
  if (
    typeof sbom.serialNumber !== "string" ||
    !/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      sbom.serialNumber,
    )
  ) {
    addFinding(
      findings,
      "sbom",
      "sbom.cdx.json#serialNumber",
      "invalid-sbom-serial",
      "CycloneDX serialNumber must be a UUID URN.",
    );
  }
  const rootRef = graph?.rootRef;
  if (rootRef === null || sbom.metadata?.component?.["bom-ref"] !== rootRef) {
    addFinding(
      findings,
      "sbom",
      "sbom.cdx.json#metadata.component",
      "sbom-root-identity-mismatch",
      "SBOM metadata must bind the lockfile root name and version.",
    );
  }
  if (
    expectedDocument !== null &&
    sbom.serialNumber !== expectedDocument.serialNumber
  ) {
    addFinding(
      findings,
      "sbom",
      "sbom.cdx.json#serialNumber",
      "nondeterministic-sbom-serial",
      "The release SBOM serial must be the deterministic UUID bound to the reviewed graph.",
    );
  }
  const rootLicenses = cycloneDxLicenseIds(sbom.metadata?.component);
  if (!rootLicenses.includes("GPL-3.0-only")) {
    addFinding(
      findings,
      "sbom",
      "sbom.cdx.json#metadata.component.licenses",
      "sbom-root-license-mismatch",
      "The SBOM root component must declare GPL-3.0-only.",
    );
  }
  if (expectedDocument !== null) {
    const expectedRoot = expectedDocument.metadata.component;
    const actualRoot = sbom.metadata?.component;
    if (
      actualRoot?.type !== expectedRoot.type ||
      actualRoot?.name !== expectedRoot.name ||
      actualRoot?.version !== expectedRoot.version ||
      actualRoot?.scope !== expectedRoot.scope ||
      actualRoot?.purl !== expectedRoot.purl
    ) {
      addFinding(
        findings,
        "sbom",
        "sbom.cdx.json#metadata.component",
        "sbom-root-metadata-mismatch",
        "SBOM root type, name, version, scope, and npm PURL must match the lock root.",
      );
    }
    const metadataProperties = cycloneDxProperties(
      sbom.metadata?.properties,
      findings,
      "sbom.cdx.json#metadata.properties",
    );
    const expectedMetadataProperties = new Map(
      expectedDocument.metadata.properties.map(({ name, value }) => [name, value]),
    );
    for (const [name, value] of expectedMetadataProperties) {
      if (metadataProperties.get(name) !== value) {
        addFinding(
          findings,
          "sbom",
          "sbom.cdx.json#metadata.properties",
          "release-sbom-contract-mismatch",
          `Required release SBOM property ${JSON.stringify(name)} is missing or inconsistent.`,
        );
      }
    }
    const rootProperties = cycloneDxProperties(
      actualRoot?.properties,
      findings,
      "sbom.cdx.json#metadata.component.properties",
    );
    if (rootProperties.get(SBOM_PROPERTY.contract) !== RELEASE_SBOM_CONTRACT) {
      addFinding(
        findings,
        "sbom",
        "sbom.cdx.json#metadata.component.properties",
        "release-sbom-contract-mismatch",
        "The root component is not bound to the reviewed release SBOM contract.",
      );
    }
  }

  const components = Array.isArray(sbom.components) ? sbom.components : [];
  const componentByRef = new Map();
  const expectedComponents = new Map(
    (expectedDocument?.components ?? []).map((component) => [
      component["bom-ref"],
      component,
    ]),
  );
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    const reference = component?.["bom-ref"];
    if (typeof reference !== "string" || reference.length === 0) {
      addFinding(
        findings,
        "sbom",
        `sbom.cdx.json#components/${index}`,
        "missing-component-reference",
        "Every SBOM component needs a non-empty bom-ref.",
      );
      continue;
    }
    if (componentByRef.has(reference)) {
      addFinding(
        findings,
        "sbom",
        `sbom.cdx.json#components/${index}`,
        "duplicate-component-reference",
        `SBOM component reference ${JSON.stringify(reference)} is duplicated.`,
      );
      continue;
    }
    componentByRef.set(reference, component);
    if (!graph.nodes.has(reference)) {
      addFinding(
        findings,
        "sbom",
        `sbom.cdx.json#components/${index}`,
        "non-production-sbom-component",
        `SBOM component ${JSON.stringify(reference)} is not in the reachable production lock graph.`,
      );
    }
    if (!dispositions.has(reference)) {
      addFinding(
        findings,
        "sbom",
        `sbom.cdx.json#components/${index}`,
        "undisposed-sbom-license",
        `SBOM component ${JSON.stringify(reference)} lacks an approved production license disposition.`,
      );
    }
    const expectedComponent = expectedComponents.get(reference);
    if (expectedComponent !== undefined && component.type !== expectedComponent.type) {
      addFinding(
        findings,
        "sbom",
        `sbom.cdx.json#components/${index}.type`,
        "component-type-mismatch",
        `Production component ${JSON.stringify(reference)} must use its reviewed CycloneDX type.`,
      );
    }
    if (
      expectedComponent !== undefined &&
      (component.name !== expectedComponent.name ||
        component.version !== expectedComponent.version)
    ) {
      addFinding(
        findings,
        "sbom",
        `sbom.cdx.json#components/${index}`,
        "component-identity-mismatch",
        `Production component ${JSON.stringify(reference)} does not match its lock identity.`,
      );
    }
    if (
      !["required", "optional"].includes(component.scope) ||
      (expectedComponent !== undefined && component.scope !== expectedComponent.scope)
    ) {
      addFinding(
        findings,
        "sbom",
        `sbom.cdx.json#components/${index}.scope`,
        "invalid-production-scope",
        "Production SBOM scope must exactly match the reviewed required/optional graph disposition.",
      );
    }
    if (
      typeof component.purl !== "string" ||
      !component.purl.startsWith("pkg:npm/") ||
      (expectedComponent !== undefined && component.purl !== expectedComponent.purl)
    ) {
      addFinding(
        findings,
        "sbom",
        `sbom.cdx.json#components/${index}.purl`,
        "missing-npm-purl",
        "Every production component must carry the exact npm package URL for its lock identity.",
      );
    }
    const declaredLicenses = cycloneDxLicenseIds(component);
    for (const declaredLicense of declaredLicenses) {
      if (validateSpdxDisposition(declaredLicense) === null) {
        addFinding(
          findings,
          "sbom",
          `sbom.cdx.json#components/${index}.licenses`,
          "unknown-sbom-license",
          `SBOM component ${JSON.stringify(reference)} declares an unapproved license expression.`,
        );
      }
    }
    if (
      expectedComponent !== undefined &&
      !sameStringSet(declaredLicenses, cycloneDxLicenseIds(expectedComponent))
    ) {
      addFinding(
        findings,
        "sbom",
        `sbom.cdx.json#components/${index}.licenses`,
        "sbom-license-disposition-mismatch",
        `SBOM license evidence for ${JSON.stringify(reference)} does not match the reviewed disposition.`,
      );
    }
    if (expectedComponent !== undefined) {
      const properties = cycloneDxProperties(
        component.properties,
        findings,
        `sbom.cdx.json#components/${index}.properties`,
      );
      for (const expectedProperty of expectedComponent.properties.filter(({ name }) =>
        [SBOM_PROPERTY.licenseRationale, SBOM_PROPERTY.licenseEvidence].includes(name),
      )) {
        if (properties.get(expectedProperty.name) !== expectedProperty.value) {
          addFinding(
            findings,
            "sbom",
            `sbom.cdx.json#components/${index}.properties`,
            "missing-sbom-license-evidence",
            `Component ${JSON.stringify(reference)} is missing its reviewed license evidence property.`,
          );
        }
      }
    }
  }
  for (const reference of graph.nodes.keys()) {
    if (!componentByRef.has(reference)) {
      addFinding(
        findings,
        "sbom",
        "sbom.cdx.json#components",
        "missing-production-component",
        `Reachable production package ${JSON.stringify(reference)} is absent from the SBOM.`,
      );
    }
  }

  const dependencies = Array.isArray(sbom.dependencies) ? sbom.dependencies : [];
  const dependenciesByRef = new Map();
  const knownReferences = new Set([rootRef, ...componentByRef.keys()].filter(Boolean));
  for (let index = 0; index < dependencies.length; index += 1) {
    const entry = dependencies[index];
    if (typeof entry?.ref !== "string" || !Array.isArray(entry.dependsOn)) {
      addFinding(
        findings,
        "sbom",
        `sbom.cdx.json#dependencies/${index}`,
        "invalid-dependency-entry",
        "Each CycloneDX dependency entry needs ref and dependsOn fields.",
      );
      continue;
    }
    if (dependenciesByRef.has(entry.ref)) {
      addFinding(
        findings,
        "sbom",
        `sbom.cdx.json#dependencies/${index}`,
        "duplicate-dependency-entry",
        `Dependency graph entry ${JSON.stringify(entry.ref)} is duplicated.`,
      );
      continue;
    }
    dependenciesByRef.set(entry.ref, new Set(entry.dependsOn));
    if (!knownReferences.has(entry.ref)) {
      addFinding(
        findings,
        "sbom",
        `sbom.cdx.json#dependencies/${index}`,
        "unknown-dependency-reference",
        `Dependency graph owner ${JSON.stringify(entry.ref)} is not a known component.`,
      );
    }
    for (const dependencyRef of entry.dependsOn) {
      if (!knownReferences.has(dependencyRef)) {
        addFinding(
          findings,
          "sbom",
          `sbom.cdx.json#dependencies/${index}`,
          "unknown-dependency-target",
          `Dependency target ${JSON.stringify(dependencyRef)} is not a known component.`,
        );
      }
    }
  }
  for (const [reference, expectedDependencies] of graph.edges) {
    const actualDependencies = dependenciesByRef.get(reference);
    if (actualDependencies === undefined) {
      addFinding(
        findings,
        "sbom",
        "sbom.cdx.json#dependencies",
        "missing-dependency-entry",
        `Dependency graph entry ${JSON.stringify(reference)} is missing.`,
      );
      continue;
    }
    for (const dependencyRef of expectedDependencies) {
      if (!actualDependencies.has(dependencyRef)) {
        addFinding(
          findings,
          "sbom",
          "sbom.cdx.json#dependencies",
          "missing-production-edge",
          `Production edge ${JSON.stringify(reference)} -> ${JSON.stringify(dependencyRef)} is missing.`,
        );
      }
    }
    for (const dependencyRef of actualDependencies) {
      if (!expectedDependencies.has(dependencyRef)) {
        addFinding(
          findings,
          "sbom",
          "sbom.cdx.json#dependencies",
          "unexpected-production-edge",
          `SBOM edge ${JSON.stringify(reference)} -> ${JSON.stringify(dependencyRef)} is not in the reviewed production graph.`,
        );
      }
    }
  }

  return {
    ok: findings.length === 0,
    findings: sortFindings(findings),
    evidence: Object.freeze({
      components: components.length,
      dependencies: dependencies.length,
      sha256: sha256(Buffer.from(stableStringify(sbom))),
    }),
  };
}

function safeVerifierFailure(error) {
  if (error && typeof error === "object" && typeof error.code === "string") {
    return `Verifier failed with ${error.code}.`;
  }
  return `Verifier failed with ${error?.constructor?.name ?? "Error"}.`;
}

function sanitizeBoundaryFinding(finding) {
  return Object.freeze({
    scope: finding.scope,
    path: finding.path,
    ...(Number.isSafeInteger(finding.line) ? { line: finding.line } : {}),
    rule: finding.rule,
    detail: `The existing production-boundary rule ${JSON.stringify(finding.rule)} failed; run its focused verifier for the reviewed diagnostic.`,
  });
}

export async function inspectReleaseSecurity({
  root = DEFAULT_ROOT,
  publicPackageDirectory = resolve(root, DEFAULT_PUBLIC_PACKAGE),
  requireInstalledTree = true,
  sbomDocument,
  generateSbom = sbomDocument === undefined,
  runExistingPublicVerifier = true,
} = {}) {
  const resolvedRoot = resolve(root);
  const findings = [];

  const runtimeBoundary = inspectProductionBoundary({
    root: resolvedRoot,
    requireInstalledTree,
  });
  findings.push(...runtimeBoundary.findings.map(sanitizeBoundaryFinding));

  const workspace = inspectWorkspaceManifests({ root: resolvedRoot });
  findings.push(...workspace.findings);
  const graph = buildProductionDependencyGraph({
    root: resolvedRoot,
    workspacePaths: workspace.evidence.workspacePaths,
  });
  const licenses = inspectProductionDependencyLicenses({
    root: resolvedRoot,
    graph,
  });
  findings.push(...licenses.findings);

  const publicLayout = inspectPublicPackageLayout({
    root: resolvedRoot,
    packageDirectory: publicPackageDirectory,
  });
  findings.push(...publicLayout.findings);
  if (runExistingPublicVerifier && existsSync(publicPackageDirectory)) {
    try {
      await verifyPublicPackage(publicPackageDirectory);
    } catch (error) {
      addFinding(
        findings,
        "public-package",
        toPosix(relative(resolvedRoot, publicPackageDirectory)),
        "existing-public-verifier-failed",
        safeVerifierFailure(error),
      );
    }
  }

  let sbom = sbomDocument;
  if (generateSbom) {
    try {
      sbom = createReleaseSbom({ graph, dispositions: licenses.dispositions });
    } catch (error) {
      addFinding(
        findings,
        "sbom",
        "package-lock.json",
        "sbom-generation-failed",
        safeVerifierFailure(error),
      );
    }
  }
  let sbomEvidence = { components: 0, dependencies: 0 };
  if (sbom === undefined) {
    addFinding(
      findings,
      "sbom",
      "sbom.cdx.json",
      "missing-sbom",
      "A generated or supplied CycloneDX SBOM is required.",
    );
  } else {
    const sbomResult = validateCycloneDxSbom({
      sbom,
      graph,
      dispositions: licenses.dispositions,
    });
    findings.push(...sbomResult.findings);
    sbomEvidence = sbomResult.evidence;
  }

  return {
    ok: findings.length === 0,
    findings: sortFindings(findings),
    evidence: Object.freeze({
      runtimeBoundary: runtimeBoundary.evidence,
      workspaces: workspace.evidence,
      productionLicenses: licenses.evidence,
      publicPackage: publicLayout.evidence,
      sbom: sbomEvidence,
    }),
  };
}

function parseArguments(argv) {
  const options = {
    root: DEFAULT_ROOT,
    publicPackageDirectory: null,
    requireInstalledTree: true,
    sbomDocument: undefined,
    generateSbom: true,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--root requires a path");
      options.root = resolve(value);
      index += 1;
    } else if (argument === "--public-package") {
      const value = argv[index + 1];
      if (!value) throw new Error("--public-package requires a path");
      options.publicPackageDirectory = resolve(value);
      index += 1;
    } else if (argument === "--sbom") {
      const value = argv[index + 1];
      if (!value) throw new Error("--sbom requires a path");
      options.sbomDocument = readJson(resolve(value));
      options.generateSbom = false;
      index += 1;
    } else if (argument === "--generate-sbom") {
      options.generateSbom = true;
      options.sbomDocument = undefined;
    } else if (argument === "--allow-missing-installed-tree") {
      options.requireInstalledTree = false;
    } else if (argument === "--require-installed-tree") {
      options.requireInstalledTree = true;
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "--help" || argument === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/verify-release-security.mjs [options]",
          "",
          "Options:",
          "  --root <path>                    repository root",
          "  --public-package <path>          staged public package directory",
          "  --sbom <path>                    validate an existing CycloneDX JSON document",
          "  --generate-sbom                  generate deterministic CycloneDX from the reviewed lock graph (default)",
          "  --require-installed-tree         require npm installed-tree evidence (default)",
          "  --allow-missing-installed-tree   allow the runtime boundary to use lock evidence",
          "  --json                           machine-readable result",
          "",
        ].join("\n"),
      );
      return null;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (options.publicPackageDirectory === null) {
    options.publicPackageDirectory = resolve(options.root, DEFAULT_PUBLIC_PACKAGE);
  }
  return options;
}

function printHuman(result) {
  const evidence = result.evidence;
  process.stdout.write(
    [
      `Release-security evidence: ${evidence.workspaces.manifests} manifests; ${evidence.productionLicenses.disposedPackages}/${evidence.productionLicenses.productionPackages} production license dispositions; ${evidence.publicPackage.files} public files; ${evidence.sbom.components} SBOM components.`,
      result.ok
        ? "PASS: repository release-security contracts are satisfied."
        : `FAIL: ${result.findings.length} release-security finding(s).`,
    ].join("\n") + "\n",
  );
  for (const finding of result.findings) {
    process.stderr.write(
      `- [${finding.scope}/${finding.rule}] ${finding.path}: ${finding.detail}\n`,
    );
  }
}

if (safeRealpath(process.argv[1] ?? "") === safeRealpath(SCRIPT_PATH)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options !== null) {
      const result = await inspectReleaseSecurity(options);
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        printHuman(result);
      }
      process.exitCode = result.ok ? 0 : 1;
    }
  } catch (error) {
    process.stderr.write(`Release-security verifier error: ${safeVerifierFailure(error)}\n`);
    process.exitCode = 2;
  }
}
