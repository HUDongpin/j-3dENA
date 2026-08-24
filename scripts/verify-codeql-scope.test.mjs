import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const codeqlConfigPath = resolve(
  repositoryRoot,
  ".github/codeql/codeql-config.yml",
);
const codeqlWorkflowPath = resolve(
  repositoryRoot,
  ".github/workflows/codeql.yml",
);

function pathsIgnoredBy(config) {
  const lines = config.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^paths-ignore:\s*$/u.test(line));
  assert.notEqual(start, -1, "CodeQL config must declare paths-ignore.");

  const ignored = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/u.test(line)) break;
    const item = line.match(/^\s+-\s+["']?([^"']+?)["']?\s*$/u);
    if (item) ignored.push(item[1]);
  }
  return ignored;
}

test("CodeQL excludes only reviewed generated artifacts", () => {
  const config = readFileSync(codeqlConfigPath, "utf8");
  assert.deepEqual(pathsIgnoredBy(config), [
    "packages/analysis/dist/**",
    "output/**",
  ]);

  const topLevelKeys = config
    .split(/\r?\n/u)
    .map((line) => line.match(/^([a-z][a-z-]*):(?:\s|$)/u)?.[1])
    .filter(Boolean);
  assert.deepEqual(
    topLevelKeys,
    ["paths-ignore"],
    "The reviewed config must not disable queries or introduce broader scan controls.",
  );
});

test("CodeQL workflow consumes the reviewed config and retains the zero-result gate", () => {
  const workflow = readFileSync(codeqlWorkflowPath, "utf8");
  assert.match(
    workflow,
    /name:\s*Initialize CodeQL[\s\S]*?config-file:\s*\.\/\.github\/codeql\/codeql-config\.yml/u,
  );
  assert.match(
    workflow,
    /node scripts\/verify-sarif-results\.mjs --path codeql-results --maximum-results 0/u,
  );
  assert.match(workflow, /upload:\s*never/u);
});
