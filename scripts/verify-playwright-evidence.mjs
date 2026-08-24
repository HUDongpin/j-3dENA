import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RECEIPT_VERSION = "3dena.playwright-evidence-receipt.v1";
const MAX_REPORT_BYTES = 50 * 1024 * 1024;
const MAX_HTML_BYTES = 100 * 1024 * 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true });
const REQUIRED_SEGMENTS = Object.freeze({
  accessibility: Object.freeze({
    expectedTests: 22,
    projects: Object.freeze(["a11y", "app-identity"]),
    allowedSkips: Object.freeze([]),
  }),
  "multi-browser": Object.freeze({
    expectedTests: 70,
    projects: Object.freeze(["app-identity", "chromium", "firefox", "webkit"]),
    allowedSkips: Object.freeze([
      Object.freeze({
        file: "production-remote.spec.ts",
        projectName: "chromium",
        title: "optimized production fails closed instead of exposing local Workers",
      }),
      Object.freeze({
        file: "production-remote.spec.ts",
        projectName: "firefox",
        title: "optimized production fails closed instead of exposing local Workers",
      }),
      Object.freeze({
        file: "production-remote.spec.ts",
        projectName: "webkit",
        title: "optimized production fails closed instead of exposing local Workers",
      }),
    ]),
  }),
});

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function integer(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${name} must be a safe integer >= ${minimum}.`);
  }
  return value;
}

function nonEmpty(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value;
}

function parseArguments(argv) {
  const allowed = new Set([
    "--root",
    "--output",
    "--repository",
    "--execution-commit",
    "--source-head-commit",
    "--run-id",
    "--run-attempt",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name) || value === undefined || values.has(name)) {
      throw new TypeError(`Invalid or duplicate argument at ${name ?? "<missing>"}.`);
    }
    values.set(name, value);
  }
  if (values.size !== allowed.size) {
    throw new TypeError(`Required arguments: ${[...allowed].join(", ")}.`);
  }
  const executionCommit = values.get("--execution-commit");
  const sourceHeadCommit = values.get("--source-head-commit");
  const repository = values.get("--repository");
  const runId = values.get("--run-id");
  const runAttempt = values.get("--run-attempt");
  if (!/^[a-f0-9]{40}$/u.test(executionCommit)) {
    throw new TypeError("--execution-commit must be a full lowercase Git SHA.");
  }
  if (!/^[a-f0-9]{40}$/u.test(sourceHeadCommit)) {
    throw new TypeError("--source-head-commit must be a full lowercase Git SHA.");
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) throw new TypeError("--repository is invalid.");
  if (!/^[1-9][0-9]*$/u.test(runId)) throw new TypeError("--run-id is invalid.");
  if (!/^[1-9][0-9]*$/u.test(runAttempt)) throw new TypeError("--run-attempt is invalid.");
  return Object.freeze({
    root: resolve(values.get("--root")),
    output: resolve(values.get("--output")),
    repository,
    executionCommit,
    sourceHeadCommit,
    runId,
    runAttempt,
  });
}

function exactSortedStrings(actual, expected, name) {
  const sorted = [...new Set(actual)].sort();
  if (JSON.stringify(sorted) !== JSON.stringify(expected)) {
    throw new Error(`${name} must be exactly ${expected.join(", ")}; observed ${sorted.join(", ") || "none"}.`);
  }
  return sorted;
}

function collectSpecs(suite, inheritedFile, output) {
  if (!isRecord(suite)) throw new TypeError("Playwright suite must be an object.");
  const suiteFile = typeof suite.file === "string" && suite.file.length > 0
    ? suite.file
    : inheritedFile;
  if (suite.specs !== undefined) {
    if (!Array.isArray(suite.specs)) throw new TypeError("Playwright suite specs must be an array.");
    for (const spec of suite.specs) {
      if (!isRecord(spec) || !Array.isArray(spec.tests)) {
        throw new TypeError("Playwright spec is invalid.");
      }
      const file = nonEmpty(spec.file ?? suiteFile, "Playwright spec file").replaceAll("\\", "/");
      const title = nonEmpty(spec.title, "Playwright spec title");
      for (const test of spec.tests) {
        if (!isRecord(test) || !Array.isArray(test.results)) {
          throw new TypeError("Playwright test entry is invalid.");
        }
        const projectName = nonEmpty(test.projectName, "Playwright project name");
        const status = nonEmpty(test.status, "Playwright test status");
        const expectedStatus = nonEmpty(test.expectedStatus, "Playwright expected status");
        if (status === "expected") {
          if (expectedStatus !== "passed") {
            throw new Error(`${projectName}:${file}:${title} uses expectedStatus=${expectedStatus}; only a real pass is accepted.`);
          }
          const finalResult = test.results.at(-1);
          if (!isRecord(finalResult) || finalResult.status !== "passed") {
            throw new Error(`${projectName}:${file}:${title} has no final passed result.`);
          }
        } else if (status === "skipped") {
          if (expectedStatus !== "skipped" ||
              test.results.some((result) => !isRecord(result) || result.status !== "skipped")) {
            throw new Error(`${projectName}:${file}:${title} is not an explicitly expected skip.`);
          }
        } else {
          throw new Error(`${projectName}:${file}:${title} has disallowed outcome ${status}.`);
        }
        output.push(Object.freeze({ file, projectName, title, status }));
      }
    }
  }
  if (suite.suites !== undefined) {
    if (!Array.isArray(suite.suites)) throw new TypeError("Nested Playwright suites must be an array.");
    for (const nested of suite.suites) collectSpecs(nested, suiteFile, output);
  }
}

function readEvidenceFile(root, path, label, minimumBytes, maximumBytes) {
  const relativePath = relative(root, path);
  if (relativePath.startsWith("..") || relativePath === "") {
    throw new Error(`${label} escaped the evidence root.`);
  }
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() ||
      metadata.size < minimumBytes || metadata.size > maximumBytes) {
    throw new Error(
      `${label} must be a regular ${minimumBytes}..${maximumBytes} byte file.`,
    );
  }
  const realPath = realpathSync(path);
  const realRelativePath = relative(root, realPath);
  if (realRelativePath.startsWith("..") || realRelativePath === "") {
    throw new Error(`${label} resolved outside the evidence root.`);
  }
  return readFileSync(path);
}

function inspectSegment(root, name, contract) {
  const path = resolve(root, name, "report.json");
  const bytes = readEvidenceFile(
    root,
    path,
    `Segment ${name} JSON report`,
    2,
    MAX_REPORT_BYTES,
  );
  const htmlPath = resolve(root, name, "report", "index.html");
  const htmlBytes = readEvidenceFile(
    root,
    htmlPath,
    `Segment ${name} HTML report`,
    16,
    MAX_HTML_BYTES,
  );
  let report;
  try {
    report = JSON.parse(utf8.decode(bytes));
  } catch (error) {
    throw new Error(`Segment ${name} report is not valid UTF-8 JSON.`, { cause: error });
  }
  if (!isRecord(report) || !Array.isArray(report.suites) || !Array.isArray(report.errors) || !isRecord(report.stats)) {
    throw new TypeError(`Segment ${name} report has an invalid top-level contract.`);
  }
  if (report.errors.length !== 0) throw new Error(`Segment ${name} has ${report.errors.length} report-level errors.`);
  const expected = integer(report.stats.expected, `${name}.stats.expected`, 1);
  const skipped = integer(report.stats.skipped, `${name}.stats.skipped`);
  const unexpected = integer(report.stats.unexpected, `${name}.stats.unexpected`);
  const flaky = integer(report.stats.flaky, `${name}.stats.flaky`);
  if (unexpected !== 0 || flaky !== 0) {
    throw new Error(`Segment ${name} must have unexpected=0 and flaky=0.`);
  }
  if (expected !== contract.expectedTests) {
    throw new Error(
      `Segment ${name} must have exactly ${contract.expectedTests} passed tests; observed ${expected}.`,
    );
  }
  const durationMs = report.stats.duration;
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
    throw new TypeError(`${name}.stats.duration must be finite and non-negative.`);
  }
  const startedAt = report.stats.startTime;
  if (typeof startedAt !== "string" || Number.isNaN(Date.parse(startedAt))) {
    throw new TypeError(`${name}.stats.startTime must be a timestamp.`);
  }
  const tests = [];
  for (const suite of report.suites) collectSpecs(suite, undefined, tests);
  const observedExpected = tests.filter(({ status }) => status === "expected").length;
  const observedSkipped = tests.filter(({ status }) => status === "skipped").length;
  if (expected !== observedExpected || skipped !== observedSkipped) {
    throw new Error(
      `Segment ${name} stats do not match test outcomes: expected ${expected}/${observedExpected}, skipped ${skipped}/${observedSkipped}.`,
    );
  }
  const projectNames = exactSortedStrings(
    tests.map(({ projectName }) => projectName),
    contract.projects,
    `${name} projects`,
  );
  for (const projectName of contract.projects) {
    if (!tests.some((entry) => entry.projectName === projectName && entry.status === "expected")) {
      throw new Error(`Segment ${name} has no passed test for required project ${projectName}.`);
    }
  }
  const skippedTests = tests
    .filter(({ status }) => status === "skipped")
    .map(({ status: _status, ...entry }) => entry)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const allowedSkips = [...contract.allowedSkips]
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  if (JSON.stringify(skippedTests) !== JSON.stringify(allowedSkips)) {
    throw new Error(`Segment ${name} skip inventory drifted from the frozen contract.`);
  }
  return Object.freeze({
    name,
    reportPath: `${name}/report.json`,
    reportSha256: sha256(bytes),
    byteLength: bytes.byteLength,
    htmlReportPath: `${name}/report/index.html`,
    htmlReportSha256: sha256(htmlBytes),
    htmlByteLength: htmlBytes.byteLength,
    startedAt: new Date(startedAt).toISOString(),
    durationMs,
    expectedTests: expected,
    skippedTests,
    projectNames,
  });
}

export function createPlaywrightEvidenceReceipt(options) {
  const root = realpathSync(options.root);
  const segments = Object.entries(REQUIRED_SEGMENTS)
    .map(([name, contract]) => inspectSegment(root, name, contract))
    .sort((left, right) => left.name.localeCompare(right.name));
  return Object.freeze({
    schemaVersion: RECEIPT_VERSION,
    status: "passed",
    repository: options.repository,
    executionCommit: options.executionCommit,
    sourceHeadCommit: options.sourceHeadCommit,
    runIdentity: Object.freeze({
      runId: options.runId,
      runAttempt: options.runAttempt,
    }),
    totals: Object.freeze({
      expectedTests: segments.reduce((sum, segment) => sum + segment.expectedTests, 0),
      skippedTests: segments.reduce((sum, segment) => sum + segment.skippedTests.length, 0),
      unexpectedTests: 0,
      flakyTests: 0,
    }),
    segments,
  });
}

function run(argv) {
  const options = parseArguments(argv);
  const root = realpathSync(options.root);
  const outputParent = resolve(dirname(options.output));
  mkdirSync(outputParent, { recursive: true });
  const realOutputParent = realpathSync(outputParent);
  const outputRelative = relative(root, resolve(realOutputParent, basename(options.output)));
  if (outputRelative.startsWith("..") || outputRelative === "") {
    throw new Error("--output must be a new file inside --root.");
  }
  const receipt = createPlaywrightEvidenceReceipt({ ...options, root });
  writeFileSync(options.output, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(
    `Playwright evidence passed: ${receipt.totals.expectedTests} passed, ${receipt.totals.skippedTests} frozen skips.\n`,
  );
}

const invokedPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`Playwright evidence verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
