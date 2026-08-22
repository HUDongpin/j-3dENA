#!/usr/bin/env node

/**
 * Enforce the 3DENA Next production-runtime boundary.
 *
 * The browser application may consume reviewed JSON/CSV golden fixtures, but
 * production dependencies, production source, and emitted Next.js bundles may
 * not contain an R runtime, an R-backed service client, or native R artifacts.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const PROHIBITED_NATIVE_R_NAMES = [
  /(?:^|\/)\.Rprofile$/i,
  /(?:^|\/)\.Rhistory$/i,
  /(?:^|\/)renv\.lock$/i,
  /(?:^|\/)packrat\.lock$/i,
  /\.(?:R|RData|Rda|Rds|Rproj)$/i,
];

// The previously bundled Class 1 prepared exchange contains row-level
// participant identities and has no authorization/de-identification approval
// binding for Git, CI, or a public application artifact. Keep this exact
// identity out of every repository/package/Next boundary. Generic user-uploaded
// .ena3d.json bytes are handled at runtime and are not repository assets.
const PROHIBITED_SENSITIVE_ARTIFACT_NAMES = [
  /(?:^|\/)class1-timepoints\.ena3d\.json(?:\.(?:provenance\.json|sha256))?$/i,
  /(?:^|\/)public\/.*\.ena3d\.json$/i,
];

const PROHIBITED_DEPENDENCY_NAME =
  /(?:^|[/_-])(?:rscript|rena|shiny|rserve|opencpu)(?:$|[/_-])/i;

const PROHIBITED_TEXT = [
  {
    id: "direct-r-executable",
    pattern:
      /\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)\s*\(\s*(["'`])R(?:\1|[ \t][^"'`\r\n]*\1)/g,
    message: "Direct R executable invocation through Node child_process",
  },
  {
    id: "direct-r-executable",
    pattern: /\b(?:new\s+)?Deno\.Command\s*\(\s*(["'`])R\1/g,
    message: "Direct R executable invocation through Deno.Command",
  },
  {
    id: "direct-r-executable",
    pattern: /\bBun\.spawn(?:Sync)?\s*\(\s*(?:\[\s*)?(["'`])R\1/g,
    message: "Direct R executable invocation through Bun.spawn",
  },
  {
    id: "rscript",
    pattern: /\bRscript\b/gi,
    message: "Rscript executable reference",
  },
  {
    id: "rena",
    pattern: /\brENA\b/g,
    message: "rENA runtime/package reference",
  },
  {
    id: "shiny",
    pattern: /\bShiny(?:\s+Server)?\b/gi,
    message: "Shiny runtime reference",
  },
  {
    id: "rserve",
    pattern: /\bRserve\b/gi,
    message: "Rserve runtime reference",
  },
  {
    id: "opencpu",
    pattern: /\bOpenCPU\b/gi,
    message: "OpenCPU runtime reference",
  },
  {
    id: "r-service-url",
    pattern:
      /(?:https?|wss?):\/\/[^\s"'`\\)]*(?:shinyapps\.io|rserve|opencpu|\/(?:api\/r(?:ena)?|r[-_]?service)(?:\/|\b))[^\s"'`\\)]*/gi,
    message: "R-backed HTTP/WebSocket service URL",
  },
  {
    id: "r-service-env",
    pattern:
      /\b(?:R|RENA|SHINY|RSERVE|OPENCPU)[_-]?(?:SERVICE[_-]?)?URL\b/gi,
    message: "R-backed service URL configuration",
  },
  {
    id: "r-api-path",
    pattern: /["'`](?:\/api\/r(?:ena)?|\/r[-_]?service)(?:\/|["'`?])/gi,
    message: "R-backed application API path",
  },
];

const TEXT_EXTENSIONS = new Set([
  "",
  ".bash",
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".map",
  ".mjs",
  ".scss",
  ".sh",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".wasm.txt",
  ".zsh",
]);

const SHELL_EXTENSIONS = new Set([".bash", ".sh", ".zsh"]);

const SHELL_COMMAND_PREFIXES = new Set(["command", "env", "exec", "nohup"]);
const NESTED_SHELL_EXECUTABLES = new Set(["bash", "sh", "zsh"]);

function isShellSeparatorStart(character) {
  return (
    character === "\n" ||
    character === "\r" ||
    character === ";" ||
    character === "|" ||
    character === "&"
  );
}

// This deliberately small tokenizer recognizes only the shell structure this
// boundary needs: words, quoting/escaping, and command separators. Keeping the
// scan deterministic and single-pass avoids using ambiguous repeated regular
// expression alternatives on repository-controlled package scripts.
function tokenizeShellCommands(text) {
  const tokens = [];
  let index = 0;

  while (index < text.length) {
    const character = text[index];
    if (/[^\S\r\n]/u.test(character)) {
      index += 1;
      continue;
    }
    if (isShellSeparatorStart(character)) {
      const start = index;
      index += 1;
      if (
        (character === "&" || character === "|") &&
        text[index] === character
      ) {
        index += 1;
      } else if (character === "\r" && text[index] === "\n") {
        index += 1;
      }
      tokens.push({ type: "separator", start, end: index });
      continue;
    }

    const start = index;
    const offsets = [];
    let quote = null;
    let value = "";
    while (index < text.length) {
      const current = text[index];
      if (quote === null) {
        if (/\s/u.test(current) || isShellSeparatorStart(current)) break;
        if (current === "'" || current === '"') {
          quote = current;
          index += 1;
          continue;
        }
        if (current === "\\" && index + 1 < text.length) {
          index += 1;
          value += text[index];
          offsets.push(index);
          index += 1;
          continue;
        }
      } else if (current === quote) {
        quote = null;
        index += 1;
        continue;
      } else if (quote === '"' && current === "\\" && index + 1 < text.length) {
        index += 1;
        value += text[index];
        offsets.push(index);
        index += 1;
        continue;
      }

      value += current;
      offsets.push(index);
      index += 1;
    }
    tokens.push({ type: "word", start, end: index, value, offsets });
  }

  return tokens;
}

function isShellAssignment(value) {
  const equals = value.indexOf("=");
  if (equals <= 0) return false;
  const name = value.slice(0, equals);
  return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name);
}

function inspectShellSegment(words, mapIndex, depth, findings) {
  let index = 0;
  let sawPrefix = false;
  while (index < words.length) {
    const value = words[index].value;
    if (isShellAssignment(value)) {
      index += 1;
      continue;
    }
    if (SHELL_COMMAND_PREFIXES.has(value)) {
      sawPrefix = true;
      index += 1;
      continue;
    }
    if (sawPrefix && value === "--") {
      index += 1;
      continue;
    }
    break;
  }

  const executable = words[index];
  if (executable === undefined) return;
  if (executable.value === "R") {
    findings.push(mapIndex(executable.start));
    return;
  }
  if (depth >= 4 || !NESTED_SHELL_EXECUTABLES.has(executable.value)) return;

  const commandFlag = words[index + 1];
  const commandText = words[index + 2];
  if (commandFlag?.value !== "-c" || commandText === undefined) return;
  const childMap = (childIndex) =>
    mapIndex(commandText.offsets[childIndex] ?? commandText.start);
  scanShellCommands(commandText.value, childMap, depth + 1, findings);
}

function scanShellCommands(text, mapIndex, depth, findings) {
  let words = [];
  for (const token of tokenizeShellCommands(text)) {
    if (token.type === "word") {
      words.push(token);
      continue;
    }
    inspectShellSegment(words, mapIndex, depth, findings);
    words = [];
  }
  inspectShellSegment(words, mapIndex, depth, findings);
}

export function findDirectRShellCommands(text) {
  const findings = [];
  scanShellCommands(text, (index) => index, 0, findings);
  return [...new Set(findings)].sort((left, right) => left - right);
}

const SOURCE_EXCLUDED_SEGMENTS = new Set([
  ".git",
  ".next",
  "__snapshots__",
  "__tests__",
  "coverage",
  "dist",
  "docs",
  "e2e",
  "fixtures",
  "node_modules",
  "oracle-r",
  "playwright-report",
  "stories",
  "test",
  "test-results",
  "tests",
]);

const SOURCE_EXCLUDED_FILE = /(?:^|\.)[a-z0-9_-]+\.(?:spec|test|stories)\.[cm]?[jt]sx?$/i;

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
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

function walkFiles(root, start, { excludeDirectory } = {}) {
  if (!existsSync(start)) return [];

  const rootReal = safeRealpath(root);
  const files = [];
  const pending = [start];

  while (pending.length > 0) {
    const current = pending.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (error) {
      files.push({ path: current, error });
      continue;
    }

    for (const entry of entries) {
      const pathname = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        const target = safeRealpath(pathname);
        if (!isInside(rootReal, target)) continue;
        let stat;
        try {
          stat = lstatSync(target);
        } catch (error) {
          files.push({ path: pathname, error });
          continue;
        }
        if (stat.isFile()) files.push({ path: pathname });
        continue;
      }
      if (entry.isDirectory()) {
        if (!excludeDirectory?.(pathname, entry.name)) pending.push(pathname);
      } else if (entry.isFile()) {
        files.push({ path: pathname });
      }
    }
  }

  return files;
}

function readJson(pathname) {
  return JSON.parse(readFileSync(pathname, "utf8"));
}

function lineAndExcerpt(text, index) {
  const line = text.slice(0, index).split("\n").length;
  const start = Math.max(0, text.lastIndexOf("\n", index - 1) + 1);
  const endIndex = text.indexOf("\n", index);
  const end = endIndex === -1 ? text.length : endIndex;
  const excerpt = text.slice(start, end).trim().slice(0, 180);
  return { line, excerpt };
}

function findTextViolations(root, pathname, scope, findings) {
  const extension = extname(pathname).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension)) return;

  let content;
  try {
    content = readFileSync(pathname);
  } catch (error) {
    findings.push({
      scope,
      path: toPosix(relative(root, pathname)),
      rule: "unreadable-production-artifact",
      detail: error.message,
    });
    return;
  }

  // Treat files containing NUL bytes as binary. Native R artifacts are caught
  // separately by filename, while normal Next.js binary caches are out of scope.
  if (content.includes(0)) return;
  const text = content.toString("utf8");

  for (const rule of PROHIBITED_TEXT) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(text)) !== null) {
      const { line, excerpt } = lineAndExcerpt(text, match.index);
      findings.push({
        scope,
        path: toPosix(relative(root, pathname)),
        line,
        rule: rule.id,
        detail: `${rule.message}: ${excerpt}`,
      });
      if (match[0].length === 0) rule.pattern.lastIndex += 1;
    }
  }

  if (SHELL_EXTENSIONS.has(extension)) {
    for (const commandIndex of findDirectRShellCommands(text)) {
      const { line, excerpt } = lineAndExcerpt(text, commandIndex);
      findings.push({
        scope,
        path: toPosix(relative(root, pathname)),
        line,
        rule: "direct-r-executable",
        detail: `Direct R executable invocation in a shell command: ${excerpt}`,
      });
    }
  }
}

function dependencyEntries(manifest) {
  return [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...(Array.isArray(manifest.bundleDependencies)
      ? manifest.bundleDependencies
      : []),
    ...(Array.isArray(manifest.bundledDependencies)
      ? manifest.bundledDependencies
      : []),
  ];
}

function checkDependencyName(findings, name, path, source) {
  if (!PROHIBITED_DEPENDENCY_NAME.test(name)) return;
  findings.push({
    scope: "production-dependency",
    path,
    rule: "r-runtime-dependency",
    detail: `${source} contains prohibited production dependency ${JSON.stringify(name)}`,
  });
}

function scanDeclaredDependencies(root, findings, evidence) {
  const manifests = walkFiles(root, root, {
    excludeDirectory(pathname, name) {
      const rel = toPosix(relative(root, pathname));
      return (
        name === ".git" ||
        name === ".next" ||
        name === "node_modules" ||
        name === "oracle-r" ||
        rel.startsWith("docs/") ||
        rel.startsWith("e2e/")
      );
    },
  }).filter(({ path, error }) => !error && basename(path) === "package.json");

  for (const { path } of manifests) {
    const rel = toPosix(relative(root, path));
    let manifest;
    try {
      manifest = readJson(path);
    } catch (error) {
      findings.push({
        scope: "production-dependency",
        path: rel,
        rule: "invalid-package-manifest",
        detail: error.message,
      });
      continue;
    }
    evidence.manifests += 1;
    for (const name of dependencyEntries(manifest)) {
      checkDependencyName(findings, name, rel, "package manifest");
    }
    for (const [scriptName, command] of Object.entries(manifest.scripts ?? {})) {
      if (typeof command !== "string") continue;
      if (findDirectRShellCommands(command).length === 0) continue;
      findings.push({
        scope: "production-dependency",
        path: `${rel}#scripts.${scriptName}`,
        rule: "direct-r-executable",
        detail: `Production package script directly invokes the R executable: ${command}`,
      });
    }
  }
}

function packageNameFromLockPath(lockPath, metadata) {
  if (metadata?.name) return metadata.name;
  const marker = "node_modules/";
  const index = lockPath.lastIndexOf(marker);
  return index === -1 ? null : lockPath.slice(index + marker.length);
}

function scanPackageLock(root, findings, evidence) {
  const pathname = join(root, "package-lock.json");
  if (!existsSync(pathname)) return;
  let lock;
  try {
    lock = readJson(pathname);
  } catch (error) {
    findings.push({
      scope: "production-dependency",
      path: "package-lock.json",
      rule: "invalid-lockfile",
      detail: error.message,
    });
    return;
  }

  evidence.lockfile = true;
  for (const [lockPath, metadata] of Object.entries(lock.packages ?? {})) {
    if (!lockPath || metadata?.dev === true) continue;
    const name = packageNameFromLockPath(lockPath, metadata);
    if (name) {
      evidence.lockPackages += 1;
      checkDependencyName(
        findings,
        name,
        `package-lock.json#packages/${lockPath}`,
        "production lockfile",
      );
    }
  }
}

function scanNpmTree(root, findings, evidence, { requireInstalledTree }) {
  const nodeModules = join(root, "node_modules");
  if (!existsSync(nodeModules)) {
    if (requireInstalledTree) {
      findings.push({
        scope: "production-dependency",
        path: "node_modules",
        rule: "missing-installed-production-tree",
        detail: "CI boundary verification requires npm ci before this gate",
      });
    }
    return;
  }

  let treeText;
  try {
    treeText = execFileSync(
      "npm",
      ["ls", "--omit=dev", "--all", "--json", "--long=false"],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (error) {
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    if (!stdout.trim()) {
      findings.push({
        scope: "production-dependency",
        path: "node_modules",
        rule: "uninspectable-installed-production-tree",
        detail: `npm ls --omit=dev failed: ${error.message}`,
      });
      return;
    }
    treeText = stdout;
    findings.push({
      scope: "production-dependency",
      path: "node_modules",
      rule: "invalid-installed-production-tree",
      detail: "npm ls --omit=dev reported an invalid dependency tree",
    });
  }

  let tree;
  try {
    tree = JSON.parse(treeText);
  } catch (error) {
    findings.push({
      scope: "production-dependency",
      path: "node_modules",
      rule: "invalid-npm-ls-json",
      detail: error.message,
    });
    return;
  }

  evidence.installedTree = true;
  const pending = [{ name: tree.name ?? "<root>", node: tree }];
  const visited = new Set();
  while (pending.length > 0) {
    const { name, node } = pending.pop();
    const identity = `${name}@${node.version ?? "?"}:${node.path ?? "?"}`;
    if (visited.has(identity)) continue;
    visited.add(identity);
    evidence.installedPackages += 1;
    checkDependencyName(
      findings,
      name,
      node.path ? toPosix(relative(root, node.path)) : "node_modules",
      "installed production tree",
    );
    for (const [childName, child] of Object.entries(node.dependencies ?? {})) {
      if (child && typeof child === "object") {
        pending.push({ name: childName, node: child });
      }
    }
  }
}

function scanNativeRArtifacts(root, findings, evidence) {
  for (const { path, error } of walkFiles(root, root, {
    excludeDirectory(pathname, name) {
      const rel = toPosix(relative(root, pathname));
      return (
        name === ".git" ||
        name === "node_modules" ||
        rel === "oracle-r" ||
        rel.startsWith("oracle-r/") ||
        rel === "docs" ||
        rel.startsWith("docs/")
      );
    },
  })) {
    if (error) continue;
    const rel = toPosix(relative(root, path));
    if (PROHIBITED_NATIVE_R_NAMES.some((pattern) => pattern.test(rel))) {
      evidence.nativeArtifactCandidates += 1;
      findings.push({
        scope: "native-r-artifact",
        path: rel,
        rule: "native-r-file",
        detail:
          "Native R scripts/workspaces/serialized objects are allowed only under oracle-r and never as production/parity fixtures",
      });
    }
    if (PROHIBITED_SENSITIVE_ARTIFACT_NAMES.some((pattern) => pattern.test(rel))) {
      evidence.sensitiveArtifactCandidates += 1;
      findings.push({
        scope: "sensitive-artifact",
        path: rel,
        rule: "class1-participant-artifact",
        detail:
          "Class 1 participant-level prepared artifacts require private custody and may not enter Git, CI, public assets, packages, or production output",
      });
    }
  }
}

function isExcludedProductionSource(root, pathname) {
  const rel = toPosix(relative(root, pathname));
  const segments = rel.split("/");
  if (segments.includes("parity-contracts")) return true;
  if (segments.some((segment) => SOURCE_EXCLUDED_SEGMENTS.has(segment))) {
    return true;
  }
  return SOURCE_EXCLUDED_FILE.test(basename(pathname));
}

function scanProductionSource(root, findings, evidence) {
  for (const base of [join(root, "apps"), join(root, "packages")]) {
    for (const { path, error } of walkFiles(root, base, {
      excludeDirectory(pathname) {
        return isExcludedProductionSource(root, pathname);
      },
    })) {
      if (error || isExcludedProductionSource(root, path)) continue;
      if (basename(path) === "package.json") continue;
      evidence.sourceFiles += 1;
      findTextViolations(root, path, "production-source", findings);
    }
  }
}

function nextOutputRoots(root) {
  const roots = [];
  const rootNext = join(root, ".next");
  if (existsSync(rootNext)) roots.push(rootNext);

  const apps = join(root, "apps");
  if (existsSync(apps)) {
    for (const entry of readdirSync(apps, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const candidate = join(apps, entry.name, ".next");
        if (existsSync(candidate)) roots.push(candidate);
      }
    }
  }
  return roots;
}

function scanNextOutput(root, findings, evidence) {
  for (const nextRoot of nextOutputRoots(root)) {
    evidence.nextRoots += 1;
    for (const { path, error } of walkFiles(root, nextRoot, {
      excludeDirectory(_pathname, name) {
        return name === "cache";
      },
    })) {
      if (error) continue;
      evidence.nextFiles += 1;
      const rel = toPosix(relative(root, path));
      if (PROHIBITED_NATIVE_R_NAMES.some((pattern) => pattern.test(rel))) {
        findings.push({
          scope: "next-output",
          path: rel,
          rule: "native-r-file",
          detail: "Native R artifact emitted into the Next.js output",
        });
      }
      if (PROHIBITED_SENSITIVE_ARTIFACT_NAMES.some((pattern) => pattern.test(rel))) {
        findings.push({
          scope: "next-output",
          path: rel,
          rule: "class1-participant-artifact",
          detail: "A custody-excluded Class 1 prepared artifact was emitted into the Next.js output",
        });
      }
      findTextViolations(root, path, "next-output", findings);
    }
  }
}

export function inspectProductionBoundary({
  root = DEFAULT_ROOT,
  requireInstalledTree = process.env.CI === "true",
} = {}) {
  const resolvedRoot = resolve(root);
  const findings = [];
  const evidence = {
    root: resolvedRoot,
    manifests: 0,
    lockfile: false,
    lockPackages: 0,
    installedTree: false,
    installedPackages: 0,
    sourceFiles: 0,
    nextRoots: 0,
    nextFiles: 0,
    nativeArtifactCandidates: 0,
    sensitiveArtifactCandidates: 0,
  };

  scanDeclaredDependencies(resolvedRoot, findings, evidence);
  scanPackageLock(resolvedRoot, findings, evidence);
  scanNpmTree(resolvedRoot, findings, evidence, { requireInstalledTree });
  scanNativeRArtifacts(resolvedRoot, findings, evidence);
  scanProductionSource(resolvedRoot, findings, evidence);
  scanNextOutput(resolvedRoot, findings, evidence);

  findings.sort((a, b) =>
    `${a.scope}:${a.path}:${a.line ?? 0}:${a.rule}`.localeCompare(
      `${b.scope}:${b.path}:${b.line ?? 0}:${b.rule}`,
    ),
  );
  return { ok: findings.length === 0, findings, evidence };
}

function parseArguments(argv) {
  const options = {
    root: DEFAULT_ROOT,
    json: false,
    requireInstalledTree: process.env.CI === "true",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--root requires a path");
      options.root = resolve(value);
      index += 1;
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "--require-installed-tree") {
      options.requireInstalledTree = true;
    } else if (argument === "--allow-missing-installed-tree") {
      options.requireInstalledTree = false;
    } else if (argument === "--help" || argument === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/verify-production-boundary.mjs [options]",
          "",
          "Options:",
          "  --root <path>                    repository root (default: script parent)",
          "  --json                           machine-readable result",
          "  --require-installed-tree         fail unless node_modules can be inspected",
          "  --allow-missing-installed-tree   scan declarations/lock only when absent",
          "",
        ].join("\n"),
      );
      return null;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function printHuman(result) {
  const { evidence, findings } = result;
  const dependencyEvidence = evidence.installedTree
    ? `${evidence.installedPackages} installed production package nodes`
    : evidence.lockfile
      ? `${evidence.lockPackages} production lockfile package nodes (installed tree absent)`
      : "declared dependencies only (no lockfile or installed tree)";
  process.stdout.write(
    [
      `Production boundary evidence: ${evidence.manifests} manifests; ${dependencyEvidence}; ${evidence.sourceFiles} source files; ${evidence.nextRoots} .next roots / ${evidence.nextFiles} emitted files.`,
      result.ok
        ? "PASS: production runtime is TypeScript-only at the audited boundary; no R/rENA/Shiny service boundary was detected."
        : `FAIL: ${findings.length} prohibited production-runtime finding(s).`,
    ].join("\n") + "\n",
  );
  for (const finding of findings) {
    const location = `${finding.path}${finding.line ? `:${finding.line}` : ""}`;
    process.stderr.write(
      `- [${finding.scope}/${finding.rule}] ${location}: ${finding.detail}\n`,
    );
  }
}

if (safeRealpath(process.argv[1] ?? "") === safeRealpath(SCRIPT_PATH)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options) {
      const result = inspectProductionBoundary(options);
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        printHuman(result);
      }
      process.exitCode = result.ok ? 0 : 1;
    }
  } catch (error) {
    process.stderr.write(`Production boundary gate error: ${error.message}\n`);
    process.exitCode = 2;
  }
}
