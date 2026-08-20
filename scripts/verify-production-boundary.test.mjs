import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectProductionBoundary } from "./verify-production-boundary.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "3dena-boundary-"));
  mkdirSync(join(root, "apps", "web", "src"), { recursive: true });
  mkdirSync(join(root, "packages", "analysis", "src"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ private: true, dependencies: { next: "16.3.1" } }),
  );
  writeFileSync(
    join(root, "apps", "web", "package.json"),
    JSON.stringify({ private: true, dependencies: { react: "19.2.4" } }),
  );
  writeFileSync(
    join(root, "apps", "web", "src", "page.tsx"),
    "export default function Page() { return <main>3DENA Next</main>; }\n",
  );
  return root;
}

function inspect(root) {
  return inspectProductionBoundary({ root, requireInstalledTree: false });
}

test("passes a browser-only production tree", () => {
  const result = inspect(fixture());
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
});

test("rejects forbidden runtime references in production source", () => {
  const root = fixture();
  writeFileSync(
    join(root, "packages", "analysis", "src", "remote.ts"),
    'export const endpoint = "https://analysis.example/api/r";\n',
  );
  const result = inspect(root);
  assert.equal(result.ok, false);
  assert.ok(result.findings.some(({ rule }) => rule === "r-service-url"));
});

test("rejects direct R executable invocation through child_process", () => {
  const root = fixture();
  writeFileSync(
    join(root, "packages", "analysis", "src", "runner.ts"),
    'import { spawn } from "node:child_process";\nspawn("R", ["--vanilla"]);\n',
  );
  const result = inspect(root);
  assert.equal(result.ok, false);
  assert.ok(
    result.findings.some(
      ({ scope, rule }) =>
        scope === "production-source" && rule === "direct-r-executable",
    ),
  );
});

test("allows ordinary identifiers and prose containing the letter R", () => {
  const root = fixture();
  writeFileSync(
    join(root, "packages", "analysis", "src", "ordinary-r.ts"),
    [
      "export type R = { radius: number };",
      "export const R = 3;",
      'export const report = "grade R and radius R";',
      'export const renderer = { spawn: (name: string) => name }.spawn("Report");',
      "",
    ].join("\n"),
  );
  const result = inspect(root);
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
});

test("rejects direct R executable invocation in a production package script", () => {
  const root = fixture();
  writeFileSync(
    join(root, "apps", "web", "package.json"),
    JSON.stringify({
      private: true,
      dependencies: { react: "19.2.4" },
      scripts: { start: "env R_LIBS_USER=/opt/legacy R --vanilla service.R" },
    }),
  );
  const result = inspect(root);
  assert.equal(result.ok, false);
  assert.ok(
    result.findings.some(
      ({ path, rule }) =>
        path === "apps/web/package.json#scripts.start" &&
        rule === "direct-r-executable",
    ),
  );
});

test("allows historical prose in docs, oracle-r, and parity text", () => {
  const root = fixture();
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "oracle-r"), { recursive: true });
  mkdirSync(join(root, "packages", "parity-contracts", "fixtures"), {
    recursive: true,
  });
  writeFileSync(join(root, "docs", "history.md"), "Shiny and rENA history\n");
  writeFileSync(join(root, "oracle-r", "generate.R"), "# Rscript rENA\n");
  writeFileSync(
    join(root, "packages", "parity-contracts", "fixtures", "manifest.json"),
    JSON.stringify({ oracle: "rENA 0.2.7", runtime: false }),
  );
  const result = inspect(root);
  assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
});

test("rejects native R fixtures even inside parity contracts", () => {
  const root = fixture();
  mkdirSync(join(root, "packages", "parity-contracts", "fixtures"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "packages", "parity-contracts", "fixtures", "oracle.rds"),
    "not-a-real-workspace",
  );
  const result = inspect(root);
  assert.equal(result.ok, false);
  assert.ok(result.findings.some(({ rule }) => rule === "native-r-file"));
});

test("rejects forbidden references emitted into .next", () => {
  const root = fixture();
  mkdirSync(join(root, "apps", "web", ".next", "static", "chunks"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "apps", "web", ".next", "static", "chunks", "app.js"),
    'fetch("https://legacy.example/r-service/analyze");\n',
  );
  const result = inspect(root);
  assert.equal(result.ok, false);
  assert.ok(
    result.findings.some(
      ({ scope, rule }) => scope === "next-output" && rule === "r-service-url",
    ),
  );
});

test("rejects direct R executable invocation emitted into .next", () => {
  const root = fixture();
  mkdirSync(join(root, "apps", "web", ".next", "server", "chunks"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "apps", "web", ".next", "server", "chunks", "worker.js"),
    'require("node:child_process").execFileSync("R", ["--vanilla"]);\n',
  );
  const result = inspect(root);
  assert.equal(result.ok, false);
  assert.ok(
    result.findings.some(
      ({ scope, rule }) =>
        scope === "next-output" && rule === "direct-r-executable",
    ),
  );
});

test("rejects prohibited declared production dependencies", () => {
  const root = fixture();
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ dependencies: { "rserve-client": "1.0.0" } }),
  );
  const result = inspect(root);
  assert.equal(result.ok, false);
  assert.ok(
    result.findings.some(
      ({ scope, rule }) =>
        scope === "production-dependency" && rule === "r-runtime-dependency",
    ),
  );
});

test("can require installed production-tree evidence", () => {
  const root = fixture();
  const result = inspectProductionBoundary({
    root,
    requireInstalledTree: true,
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.findings.some(
      ({ rule }) => rule === "missing-installed-production-tree",
    ),
  );
});
