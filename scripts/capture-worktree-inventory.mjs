import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readFile, readlink } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function git(args, encoding = "utf8") {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitBuffer(args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: null,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function subsystem(path) {
  const rules = [
    [/^apps\/web\//u, "web"],
    [/^e2e\//u, "browser-evidence"],
    [/^playwright\.config\.ts$/u, "browser-evidence"],
    [/^packages\/analysis\//u, "analysis-facade"],
    [/^packages\/compute-service-(?:core|http|node)\//u, "compute-service"],
    [/^packages\/dataset-workflow\//u, "dataset-workflow"],
    [/^packages\/stats\//u, "stats"],
    [/^packages\/trajectory\//u, "trajectory"],
    [/^packages\/(?:io|tabular-import)\//u, "dataset-io"],
    [/^packages\/(?:export|exports)\//u, "export"],
    [/^packages\/parity-contracts\//u, "scientific-evidence"],
    [/^packages\/ai-contract\//u, "ai-contract"],
    [/^oracle-r\//u, "offline-oracle"],
    [/^vendor\//u, "vendored-custody"],
    [/^design-system\//u, "design-system"],
    [/^docs\//u, "documentation"],
    [/^README\.md$/u, "documentation"],
    [/^\.github\//u, "ci"],
    [/^(?:package(?:-lock)?\.json|\.npmrc|tsconfig[^/]*\.json)$/u, "workspace-root"],
    [/^scripts\//u, "repository-tooling"],
  ];
  return rules.find(([pattern]) => pattern.test(path))?.[1] ?? "repository-other";
}

function parseStatus() {
  const raw = gitBuffer(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const records = raw.toString("utf8").split("\0").filter(Boolean);
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const status = record.slice(0, 2);
    const path = record.slice(3);
    if (!path || path.includes("\0")) throw new Error("WORKTREE_INVENTORY_INVALID_PATH");
    if (status.includes("R") || status.includes("C")) {
      const sourcePath = records[index + 1];
      if (!sourcePath) throw new Error(`WORKTREE_INVENTORY_MISSING_RENAME_SOURCE: ${path}`);
      entries.push({ status, path, sourcePath });
      index += 1;
    } else {
      entries.push({ status, path });
    }
  }
  return entries;
}

function allFiles() {
  return git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "en"));
}

function isTest(path) {
  return /(?:^|\/)(?:e2e\/.*\.spec\.[cm]?[jt]sx?|[^/]+\.(?:test|spec)\.[cm]?[jt]sx?)$/u.test(path)
    || /(?:^|\/)verify-[^/]+\.test\.mjs$/u.test(path);
}

function assertSafePath(path) {
  if (path.startsWith("/") || path.split("/").some((segment) => segment === ".." || segment === "")) {
    throw new Error(`WORKTREE_INVENTORY_UNSAFE_PATH: ${path}`);
  }
  const absolute = resolve(repositoryRoot, ...path.split("/"));
  if (!absolute.startsWith(`${repositoryRoot}${sep}`)) throw new Error(`WORKTREE_INVENTORY_UNSAFE_PATH: ${path}`);
  return absolute;
}

async function digestPath(path) {
  const absolute = assertSafePath(path);
  let metadata;
  try {
    metadata = await lstat(absolute);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { kind: "missing", bytes: 0, sha256: null };
    }
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    const target = await readlink(absolute);
    return { kind: "symbolic-link", bytes: Buffer.byteLength(target), sha256: sha256(target) };
  }
  if (!metadata.isFile()) throw new Error(`WORKTREE_INVENTORY_UNSUPPORTED_ENTRY: ${path}`);
  const bytes = await readFile(absolute);
  return { kind: "file", bytes: bytes.byteLength, sha256: sha256(bytes) };
}

const statusEntries = parseStatus();
const paths = allFiles();
const testPathsBySubsystem = {};
for (const path of paths.filter(isTest)) {
  const owner = subsystem(path);
  (testPathsBySubsystem[owner] ??= []).push(path);
}
const entries = [];
for (const entry of statusEntries.sort((left, right) => left.path.localeCompare(right.path, "en"))) {
  const digest = await digestPath(entry.path);
  const owner = subsystem(entry.path);
  entries.push({
    ...entry,
    tracked: entry.status !== "??",
    subsystem: owner,
    ...digest,
    testCount: testPathsBySubsystem[owner]?.length ?? 0,
  });
}

const canonicalEntries = JSON.stringify(entries);
const receipt = {
  schemaVersion: "3dena.worktree-inventory.v1",
  repositoryHead: git(["rev-parse", "HEAD"]).trim(),
  branch: git(["branch", "--show-current"]).trim() || null,
  generatedAt: new Date().toISOString(),
  mutationPolicy: "read-only-no-reset-clean-stash",
  counts: {
    changedPaths: entries.length,
    trackedPaths: entries.filter((entry) => entry.tracked).length,
    untrackedPaths: entries.filter((entry) => !entry.tracked).length,
  },
  worktreeInventorySha256: sha256(canonicalEntries),
  testsBySubsystem: testPathsBySubsystem,
  entries,
};

process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
