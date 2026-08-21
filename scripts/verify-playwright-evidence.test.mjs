import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const verifier = resolve(root, "scripts/verify-playwright-evidence.mjs");

function report(projects, options = {}) {
  const skipped = options.skipped ?? [];
  const expectedCount = options.expectedCount ?? projects.length;
  const expected = Array.from({ length: expectedCount }, (_, index) => {
    const projectName = projects[index % projects.length];
    return ({
      title: `expected ${projectName}`,
      ok: true,
      file: `e2e/${projectName}.spec.ts`,
      line: index + 1,
      column: 1,
      tests: [{
        timeout: 45_000,
        annotations: [],
        expectedStatus: "passed",
        projectId: projectName,
        projectName,
        status: "expected",
        results: [{ status: "passed", retry: 0, duration: 10 }],
      }],
    });
  });
  const skippedSpecs = skipped.map(({ projectName, title }, index) => ({
    title,
    ok: true,
    file: "production-remote.spec.ts",
    line: index + 1,
    column: 1,
    tests: [{
      timeout: 45_000,
      annotations: [{ type: "skip", description: "Requires optimized production." }],
      expectedStatus: "skipped",
      projectId: projectName,
      projectName,
      status: "skipped",
      results: [{ status: "skipped", retry: 0, duration: 0 }],
    }],
  }));
  return {
    config: { rootDir: root, projects: projects.map((name) => ({ id: name, name })) },
    suites: [{
      title: "e2e",
      file: "e2e/synthetic.spec.ts",
      line: 0,
      column: 0,
      specs: [...expected, ...skippedSpecs],
    }],
    errors: options.errors ?? [],
    stats: {
      startTime: "2026-08-21T00:00:00.000Z",
      duration: 123,
      expected: expectedCount,
      skipped: skipped.length,
      unexpected: options.unexpected ?? 0,
      flaky: options.flaky ?? 0,
    },
  };
}

function writeReport(rootDirectory, segment, value) {
  const segmentDirectory = join(rootDirectory, segment);
  mkdirSync(segmentDirectory, { recursive: true });
  writeFileSync(join(segmentDirectory, "report.json"), `${JSON.stringify(value)}\n`);
  const htmlDirectory = join(segmentDirectory, "report");
  mkdirSync(htmlDirectory);
  writeFileSync(
    join(htmlDirectory, "index.html"),
    `<!doctype html><title>${segment} evidence</title>`,
  );
}

function invoke(rootDirectory, output) {
  execFileSync(process.execPath, [
    verifier,
    "--root",
    rootDirectory,
    "--output",
    output,
    "--repository",
    "HUDongpin/j-3dENA",
    "--execution-commit",
    "a".repeat(40),
    "--source-head-commit",
    "b".repeat(40),
    "--run-id",
    "123456",
    "--run-attempt",
    "1",
  ], { cwd: root, stdio: "pipe" });
}

test("creates one source-bound receipt for independent browser and accessibility reports", () => {
  const temporary = mkdtempSync(join(tmpdir(), "3dena-playwright-evidence-"));
  try {
    const evidenceRoot = join(temporary, "playwright");
    const output = join(evidenceRoot, "receipt.json");
    writeReport(evidenceRoot, "multi-browser", report(
      ["app-identity", "chromium", "firefox", "webkit"],
      {
        expectedCount: 70,
        skipped: [
          { projectName: "chromium", title: "optimized production fails closed instead of exposing local Workers" },
          { projectName: "firefox", title: "optimized production fails closed instead of exposing local Workers" },
          { projectName: "webkit", title: "optimized production fails closed instead of exposing local Workers" },
        ],
      },
    ));
    writeReport(
      evidenceRoot,
      "accessibility",
      report(["app-identity", "a11y"], { expectedCount: 22 }),
    );

    invoke(evidenceRoot, output);
    const receipt = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(receipt.schemaVersion, "3dena.playwright-evidence-receipt.v1");
    assert.equal(receipt.status, "passed");
    assert.equal(receipt.executionCommit, "a".repeat(40));
    assert.equal(receipt.sourceHeadCommit, "b".repeat(40));
    assert.deepEqual(receipt.segments.map(({ name }) => name), ["accessibility", "multi-browser"]);
    assert.deepEqual(
      receipt.segments.find(({ name }) => name === "multi-browser").projectNames,
      ["app-identity", "chromium", "firefox", "webkit"],
    );
    const browserSegment = receipt.segments.find(({ name }) => name === "multi-browser");
    assert.equal(browserSegment.skippedTests.length, 3);
    assert.equal(browserSegment.htmlReportPath, "multi-browser/report/index.html");
    assert.match(browserSegment.htmlReportSha256, /^[a-f0-9]{64}$/u);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("fails closed when one report was overwritten or a required project never executed", () => {
  const temporary = mkdtempSync(join(tmpdir(), "3dena-playwright-evidence-"));
  try {
    const evidenceRoot = join(temporary, "playwright");
    const output = join(evidenceRoot, "receipt.json");
    writeReport(
      evidenceRoot,
      "accessibility",
      report(["app-identity", "a11y"], { expectedCount: 22 }),
    );
    assert.throws(() => invoke(evidenceRoot, output), /Command failed/u);

    writeReport(
      evidenceRoot,
      "multi-browser",
      report(["app-identity", "chromium", "webkit"], { expectedCount: 70 }),
    );
    assert.throws(() => invoke(evidenceRoot, output), /Command failed/u);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("rejects unexpected, flaky, or report-level errors", () => {
  const temporary = mkdtempSync(join(tmpdir(), "3dena-playwright-evidence-"));
  try {
    const evidenceRoot = join(temporary, "playwright");
    const output = join(evidenceRoot, "receipt.json");
    writeReport(evidenceRoot, "multi-browser", report(
      ["app-identity", "chromium", "firefox", "webkit"],
      {
        expectedCount: 70,
        unexpected: 1,
        flaky: 1,
        errors: [{ message: "synthetic failure" }],
      },
    ));
    writeReport(
      evidenceRoot,
      "accessibility",
      report(["app-identity", "a11y"], { expectedCount: 22 }),
    );
    assert.throws(() => invoke(evidenceRoot, output), /Command failed/u);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("rejects report and receipt paths that resolve outside the evidence root", () => {
  const temporary = mkdtempSync(join(tmpdir(), "3dena-playwright-evidence-"));
  try {
    const evidenceRoot = join(temporary, "playwright");
    const outsideReport = join(temporary, "outside-report");
    mkdirSync(evidenceRoot, { recursive: true });
    writeReport(
      outsideReport,
      "multi-browser",
      report(
        ["app-identity", "chromium", "firefox", "webkit"],
        {
          expectedCount: 70,
          skipped: [
            { projectName: "chromium", title: "optimized production fails closed instead of exposing local Workers" },
            { projectName: "firefox", title: "optimized production fails closed instead of exposing local Workers" },
            { projectName: "webkit", title: "optimized production fails closed instead of exposing local Workers" },
          ],
        },
      ),
    );
    symlinkSync(
      join(outsideReport, "multi-browser"),
      join(evidenceRoot, "multi-browser"),
      "dir",
    );
    writeReport(
      evidenceRoot,
      "accessibility",
      report(["app-identity", "a11y"], { expectedCount: 22 }),
    );
    assert.throws(
      () => invoke(evidenceRoot, join(evidenceRoot, "receipt.json")),
      /Command failed/u,
    );

    rmSync(join(evidenceRoot, "multi-browser"));
    writeReport(
      evidenceRoot,
      "multi-browser",
      report(
        ["app-identity", "chromium", "firefox", "webkit"],
        {
          expectedCount: 70,
          skipped: [
            { projectName: "chromium", title: "optimized production fails closed instead of exposing local Workers" },
            { projectName: "firefox", title: "optimized production fails closed instead of exposing local Workers" },
            { projectName: "webkit", title: "optimized production fails closed instead of exposing local Workers" },
          ],
        },
      ),
    );
    const outsideReceipt = join(temporary, "outside-receipt");
    mkdirSync(outsideReceipt);
    symlinkSync(outsideReceipt, join(evidenceRoot, "receipts"), "dir");
    assert.throws(
      () => invoke(evidenceRoot, join(evidenceRoot, "receipts", "receipt.json")),
      /Command failed/u,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
