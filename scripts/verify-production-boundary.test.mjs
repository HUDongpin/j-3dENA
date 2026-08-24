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

test("passes a TypeScript-only production source tree", () => {
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

test("rejects quoted assignments and nested shell R commands without backtracking", () => {
  const root = fixture();
  writeFileSync(
    join(root, "apps", "web", "package.json"),
    JSON.stringify({
      private: true,
      dependencies: { react: "19.2.4" },
      scripts: {
        direct: 'env R_LIBS_USER="/opt/legacy libraries" R --vanilla service.R',
        nested: "bash -c 'env R_PROFILE=legacy R --quiet service.R'",
      },
    }),
  );
  const result = inspect(root);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.findings
      .filter(({ rule }) => rule === "direct-r-executable")
      .map(({ path }) => path)
      .sort(),
    [
      "apps/web/package.json#scripts.direct",
      "apps/web/package.json#scripts.nested",
    ],
  );
});

test("rejects direct and nested R commands in production shell files", () => {
  const root = fixture();
  writeFileSync(
    join(root, "apps", "web", "src", "start.sh"),
    [
      "#!/bin/sh",
      'env R_PROFILE="legacy profile" R --vanilla service.R',
      "bash -c 'R --quiet service.R'",
      "",
    ].join("\n"),
  );
  const result = inspect(root);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.findings
      .filter(
        ({ path, rule }) =>
          path === "apps/web/src/start.sh" && rule === "direct-r-executable",
      )
      .map(({ line }) => line),
    [2, 3],
  );
});

test(
  "scans adversarial quoted shell assignments in linear time",
  { timeout: 2_000 },
  () => {
    const root = fixture();
    const assignments = Array.from(
      { length: 2_000 },
      (_, index) => `VALUE_${index}="quoted-${index}"`,
    ).join(" ");
    writeFileSync(
      join(root, "apps", "web", "package.json"),
      JSON.stringify({
        private: true,
        dependencies: { react: "19.2.4" },
        scripts: { inspect: `env ${assignments} Report --version` },
      }),
    );
    const result = inspect(root);
    assert.equal(result.ok, true, JSON.stringify(result.findings, null, 2));
  },
);

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

test("rejects custody-excluded Class 1 prepared artifacts in public and parity trees", () => {
  const root = fixture();
  mkdirSync(join(root, "apps", "web", "public", "data"), { recursive: true });
  mkdirSync(join(root, "packages", "parity-contracts", "fixtures"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "apps", "web", "public", "data", "class1-timepoints.ena3d.json"),
    "{}",
  );
  writeFileSync(
    join(root, "packages", "parity-contracts", "fixtures", "class1-timepoints.ena3d.json"),
    "{}",
  );
  const result = inspect(root);
  assert.equal(result.ok, false);
  assert.equal(
    result.findings.filter(({ rule }) => rule === "class1-participant-artifact").length,
    2,
  );
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

test("rejects a custody-excluded prepared artifact emitted into .next", () => {
  const root = fixture();
  mkdirSync(join(root, "apps", "web", ".next", "static", "data"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "apps", "web", ".next", "static", "data", "class1-timepoints.ena3d.json"),
    "{}",
  );
  const result = inspect(root);
  assert.equal(result.ok, false);
  assert.ok(
    result.findings.some(
      ({ scope, rule }) =>
        scope === "next-output" && rule === "class1-participant-artifact",
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
