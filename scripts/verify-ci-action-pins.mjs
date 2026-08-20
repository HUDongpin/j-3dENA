#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workflowDirectory = resolve(repositoryRoot, ".github/workflows");
const findings = [];

for (const entry of await readdir(workflowDirectory, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.ya?ml$/u.test(entry.name)) continue;
  const path = resolve(workflowDirectory, entry.name);
  const lines = (await readFile(path, "utf8")).split(/\r?\n/u);
  lines.forEach((line, index) => {
    const match = line.match(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/u);
    if (!match) return;
    const reference = match[1];
    if (reference.startsWith("./")) return;
    const separator = reference.lastIndexOf("@");
    const action = separator < 1 ? reference : reference.slice(0, separator);
    const revision = separator < 1 ? "" : reference.slice(separator + 1);
    if (!/^[0-9a-f]{40}$/u.test(revision)) {
      findings.push({ file: `.github/workflows/${entry.name}`, line: index + 1, action, revision });
    }
  });
}

if (findings.length > 0) {
  process.stderr.write(`${JSON.stringify({ schemaVersion: "3dena.ci-action-pin-gate.v1", status: "fail", findings }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({ schemaVersion: "3dena.ci-action-pin-gate.v1", status: "pass", findings: [] }, null, 2)}\n`);
}
