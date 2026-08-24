import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_SHA = /^[0-9a-f]{40}$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export const PARSER_FUZZ_SOURCE_PATHS = Object.freeze([
  ".github/workflows/parser-fuzz.yml",
  "package.json",
  "package-lock.json",
  "packages/io/src/decode.ts",
  "packages/io/src/errors.ts",
  "packages/io/src/json-preflight.ts",
  "packages/io/src/limits.ts",
  "packages/io/src/parser-fuzz.test.ts",
  "packages/tabular-import/src/bytes.ts",
  "packages/tabular-import/src/container-preflight.ts",
  "packages/tabular-import/src/csv.ts",
  "packages/tabular-import/src/errors.ts",
  "packages/tabular-import/src/importer.ts",
  "packages/tabular-import/src/limits.ts",
  "packages/tabular-import/src/parser-fuzz.test.ts",
  "packages/tabular-import/test-fixtures/simple-with-colours.xls",
  "packages/tabular-import/test-fixtures/with-various-data.xlsx",
  "scripts/parser-fuzz-receipt.mjs",
  "scripts/parser-fuzz-receipt.test.mjs",
  "scripts/run-parser-fuzz.mjs",
  "scripts/verify-parser-fuzz-receipt.mjs",
]);

const TARGET_CONTRACTS = Object.freeze({
  "ena3d-json": Object.freeze([
    Object.freeze({ name: "arbitrary-exact-bytes", divisor: 1 }),
    Object.freeze({ name: "valid-exchange-byte-mutations", divisor: 1 }),
    Object.freeze({ name: "structured-json-grammar", divisor: 1 }),
  ]),
  "tabular-csv-xls-xlsx": Object.freeze([
    Object.freeze({ name: "arbitrary-csv-bytes", divisor: 1 }),
    Object.freeze({ name: "governed-xlsx-mutations", divisor: 4 }),
    Object.freeze({ name: "governed-xls-mutations", divisor: 4 }),
  ]),
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  );
}

function toPosix(pathname) {
  return pathname.split(sep).join("/");
}

export function normalizeParserFuzzSeeds(raw) {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error("Parser fuzz seed list is required.");
  }
  const seeds = raw.split(",").map((part) => {
    const normalized = part.trim().toLowerCase().replace(/^0x/u, "");
    if (!/^[0-9a-f]{1,8}$/u.test(normalized)) {
      throw new Error("Parser fuzz seeds must be comma-separated uint32 hexadecimal values.");
    }
    return normalized.padStart(8, "0");
  });
  const unique = [...new Set(seeds)];
  if (unique.length !== seeds.length || unique.length < 1 || unique.length > 16) {
    throw new Error("Parser fuzz seeds must contain between 1 and 16 unique values.");
  }
  return Object.freeze(unique);
}

export function normalizeParserFuzzCases(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2_048) {
    throw new Error("Parser fuzz cases per seed must be an integer from 1 through 2048.");
  }
  return parsed;
}

function readJson(pathname) {
  return JSON.parse(readFileSync(pathname, "utf8"));
}

function expectedStrategyCases(target, strategy, seedCount, casesPerSeed) {
  const contract = TARGET_CONTRACTS[target]?.find(({ name }) => name === strategy);
  if (contract === undefined) return null;
  return seedCount * Math.max(1, Math.ceil(casesPerSeed / contract.divisor));
}

function validateFragment(fragment, expectedTarget, seeds, casesPerSeed) {
  if (
    !exactKeys(fragment, [
      "schemaVersion",
      "target",
      "seeds",
      "casesPerSeed",
      "strategies",
      "totalCases",
    ]) ||
    fragment.schemaVersion !== "3dena.parser-fuzz-fragment.v1" ||
    fragment.target !== expectedTarget ||
    JSON.stringify(fragment.seeds) !== JSON.stringify(seeds) ||
    fragment.casesPerSeed !== casesPerSeed ||
    !Array.isArray(fragment.strategies)
  ) {
    throw new Error(`Parser fuzz fragment ${expectedTarget} does not match its exact contract.`);
  }

  const expectedStrategies = TARGET_CONTRACTS[expectedTarget];
  if (
    expectedStrategies === undefined ||
    JSON.stringify(fragment.strategies.map(({ name }) => name)) !==
      JSON.stringify(expectedStrategies.map(({ name }) => name))
  ) {
    throw new Error(`Parser fuzz fragment ${expectedTarget} has an unexpected strategy set.`);
  }

  let totalCases = 0;
  for (const strategy of fragment.strategies) {
    if (
      !exactKeys(strategy, ["name", "cases", "accepted", "rejected", "errorCodes"]) ||
      !Number.isSafeInteger(strategy.cases) ||
      !Number.isSafeInteger(strategy.accepted) ||
      !Number.isSafeInteger(strategy.rejected) ||
      strategy.cases < 1 ||
      strategy.accepted < 0 ||
      strategy.rejected < 0 ||
      strategy.accepted + strategy.rejected !== strategy.cases ||
      strategy.cases !==
        expectedStrategyCases(expectedTarget, strategy.name, seeds.length, casesPerSeed) ||
      strategy.errorCodes === null ||
      typeof strategy.errorCodes !== "object" ||
      Array.isArray(strategy.errorCodes)
    ) {
      throw new Error(`Parser fuzz fragment ${expectedTarget}/${strategy.name} has invalid counts.`);
    }
    const errorCount = Object.entries(strategy.errorCodes).reduce((total, [code, count]) => {
      if (
        !/^[A-Z][A-Z0-9_]{2,63}$/u.test(code) ||
        !Number.isSafeInteger(count) ||
        count < 1
      ) {
        throw new Error(`Parser fuzz fragment ${expectedTarget}/${strategy.name} has invalid error counts.`);
      }
      return total + count;
    }, 0);
    if (errorCount !== strategy.rejected) {
      throw new Error(`Parser fuzz fragment ${expectedTarget}/${strategy.name} rejection counts drifted.`);
    }
    totalCases += strategy.cases;
  }
  if (fragment.totalCases !== totalCases) {
    throw new Error(`Parser fuzz fragment ${expectedTarget} total case count drifted.`);
  }
  return Object.freeze(structuredClone(fragment));
}

function currentSourceFiles(root) {
  return PARSER_FUZZ_SOURCE_PATHS.map((path) => {
    const absolute = resolve(root, path);
    const bytes = readFileSync(absolute);
    if (toPosix(relative(root, absolute)) !== path) {
      throw new Error("Parser fuzz source path escaped the repository root.");
    }
    return Object.freeze({ path, byteLength: bytes.byteLength, sha256: sha256(bytes) });
  });
}

function validateVitestReport(report) {
  const expectedSuffixes = [
    "/packages/io/src/parser-fuzz.test.ts",
    "/packages/tabular-import/src/parser-fuzz.test.ts",
  ];
  if (
    report?.success !== true ||
    report.numFailedTests !== 0 ||
    report.numPendingTests !== 0 ||
    report.numTodoTests !== 0 ||
    report.numPassedTests !== 6 ||
    report.numTotalTests !== 6 ||
    !Array.isArray(report.testResults)
  ) {
    throw new Error("Vitest parser fuzz report is not a complete six-test pass.");
  }
  const observed = report.testResults.map(({ name }) =>
    typeof name === "string" ? name.replaceAll("\\", "/") : "",
  );
  if (
    expectedSuffixes.some(
      (suffix) => observed.filter((name) => name.endsWith(suffix)).length !== 1,
    ) ||
    observed.length !== expectedSuffixes.length
  ) {
    throw new Error("Vitest parser fuzz report does not contain the exact target files.");
  }
  return Object.freeze({
    totalTests: report.numTotalTests,
    passedTests: report.numPassedTests,
    failedTests: report.numFailedTests,
    pendingTests: report.numPendingTests,
    targetFiles: Object.freeze(expectedSuffixes.map((suffix) => suffix.slice(1))),
  });
}

export function createParserFuzzReceipt({
  root,
  gitCommit,
  seeds,
  casesPerSeed,
  evidenceDirectory,
  vitestReportPath,
  startedAt,
  completedAt,
  maxOldSpaceMb,
  runIdentity,
}) {
  const normalizedRoot = resolve(root);
  const normalizedSeeds = normalizeParserFuzzSeeds(seeds.join(","));
  const normalizedCases = normalizeParserFuzzCases(casesPerSeed);
  if (!GIT_SHA.test(gitCommit)) throw new Error("Exact Git commit is required.");
  if (!UTC_TIMESTAMP.test(startedAt) || !UTC_TIMESTAMP.test(completedAt)) {
    throw new Error("Parser fuzz receipt requires millisecond UTC timestamps.");
  }
  const durationMs = Date.parse(completedAt) - Date.parse(startedAt);
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
    throw new Error("Parser fuzz duration is invalid.");
  }
  if (!Number.isSafeInteger(maxOldSpaceMb) || maxOldSpaceMb < 256 || maxOldSpaceMb > 4_096) {
    throw new Error("Parser fuzz heap ceiling is invalid.");
  }

  const targets = Object.keys(TARGET_CONTRACTS).map((target) =>
    validateFragment(
      readJson(resolve(evidenceDirectory, `${target}.fragment.json`)),
      target,
      normalizedSeeds,
      normalizedCases,
    ),
  );
  const reportBytes = readFileSync(vitestReportPath);
  const testSummary = validateVitestReport(JSON.parse(reportBytes.toString("utf8")));
  const sourceFiles = currentSourceFiles(normalizedRoot);
  const vitestManifest = readJson(resolve(normalizedRoot, "node_modules/vitest/package.json"));
  if (typeof vitestManifest.version !== "string") {
    throw new Error("Installed Vitest version is unavailable.");
  }

  return Object.freeze({
    schemaVersion: "3dena.parser-fuzz-execution.v1",
    status: "passed",
    gitCommit,
    runIdentity: Object.freeze({
      repository: runIdentity.repository ?? null,
      runId: runIdentity.runId ?? null,
      runAttempt: runIdentity.runAttempt ?? null,
      workflowRef: runIdentity.workflowRef ?? null,
    }),
    runtime: Object.freeze({
      node: process.version,
      vitest: vitestManifest.version,
      maxOldSpaceMb,
    }),
    seeds: normalizedSeeds,
    casesPerSeed: normalizedCases,
    totalCases: targets.reduce((total, target) => total + target.totalCases, 0),
    targets: Object.freeze(targets),
    testSummary,
    sourceFiles: Object.freeze(sourceFiles),
    sourceBundleSha256: sha256(Buffer.from(stableStringify(sourceFiles))),
    vitestReportSha256: sha256(reportBytes),
    startedAt,
    completedAt,
    durationMs,
  });
}

function addFinding(findings, rule, path, detail) {
  findings.push(Object.freeze({ scope: "parser-fuzz-receipt", rule, path, detail }));
}

export function inspectParserFuzzReceipt({
  receipt,
  root,
  expectedGitCommit,
  vitestReportPath,
}) {
  const findings = [];
  if (
    !exactKeys(receipt, [
      "schemaVersion",
      "status",
      "gitCommit",
      "runIdentity",
      "runtime",
      "seeds",
      "casesPerSeed",
      "totalCases",
      "targets",
      "testSummary",
      "sourceFiles",
      "sourceBundleSha256",
      "vitestReportSha256",
      "startedAt",
      "completedAt",
      "durationMs",
    ])
  ) {
    addFinding(findings, "contract-fields", "receipt", "Unknown or missing receipt fields are rejected.");
    return { ok: false, findings, evidence: { totalCases: 0, sourceBundleSha256: null } };
  }
  if (receipt.schemaVersion !== "3dena.parser-fuzz-execution.v1" || receipt.status !== "passed") {
    addFinding(findings, "contract-version", "receipt", "A passed parser fuzz v1 execution receipt is required.");
  }
  if (!GIT_SHA.test(receipt.gitCommit) || receipt.gitCommit !== expectedGitCommit) {
    addFinding(findings, "git-identity", "receipt.gitCommit", "Receipt Git identity does not match the exact checkout.");
  }

  let seeds = [];
  let casesPerSeed = 0;
  try {
    seeds = normalizeParserFuzzSeeds(Array.isArray(receipt.seeds) ? receipt.seeds.join(",") : "");
    casesPerSeed = normalizeParserFuzzCases(receipt.casesPerSeed);
  } catch {
    addFinding(findings, "fuzz-input-contract", "receipt.seeds", "Seed or case-count contract is invalid.");
  }

  if (!Array.isArray(receipt.targets) || receipt.targets.length !== 2) {
    addFinding(findings, "target-count", "receipt.targets", "Exactly two parser target receipts are required.");
  } else if (seeds.length > 0 && casesPerSeed > 0) {
    let totalCases = 0;
    for (const target of Object.keys(TARGET_CONTRACTS)) {
      const observed = receipt.targets.find((candidate) => candidate?.target === target);
      try {
        const validated = validateFragment(observed, target, seeds, casesPerSeed);
        totalCases += validated.totalCases;
      } catch {
        addFinding(findings, "target-contract", `receipt.targets#${target}`, "Parser target receipt is invalid.");
      }
    }
    if (receipt.totalCases !== totalCases) {
      addFinding(findings, "total-cases", "receipt.totalCases", "Aggregate fuzz case count is inconsistent.");
    }
  }

  if (
    !exactKeys(receipt.runtime, ["node", "vitest", "maxOldSpaceMb"]) ||
    typeof receipt.runtime.node !== "string" ||
    typeof receipt.runtime.vitest !== "string" ||
    !Number.isSafeInteger(receipt.runtime.maxOldSpaceMb) ||
    receipt.runtime.maxOldSpaceMb < 256 ||
    receipt.runtime.maxOldSpaceMb > 4_096
  ) {
    addFinding(findings, "runtime-contract", "receipt.runtime", "Pinned runtime identity and heap ceiling are required.");
  }
  if (
    !exactKeys(receipt.runIdentity, ["repository", "runId", "runAttempt", "workflowRef"]) ||
    Object.values(receipt.runIdentity).some(
      (value) => value !== null && (typeof value !== "string" || value.length > 512),
    )
  ) {
    addFinding(findings, "run-identity", "receipt.runIdentity", "Allowlisted run identity fields are invalid.");
  }

  const elapsed = Date.parse(receipt.completedAt) - Date.parse(receipt.startedAt);
  if (
    !UTC_TIMESTAMP.test(receipt.startedAt) ||
    !UTC_TIMESTAMP.test(receipt.completedAt) ||
    !Number.isSafeInteger(receipt.durationMs) ||
    receipt.durationMs < 0 ||
    elapsed !== receipt.durationMs
  ) {
    addFinding(findings, "duration", "receipt.durationMs", "Receipt duration must match exact UTC timestamps.");
  }

  let expectedSourceFiles = [];
  try {
    expectedSourceFiles = currentSourceFiles(resolve(root));
  } catch {
    addFinding(findings, "source-read", "receipt.sourceFiles", "Current parser fuzz source bytes are unavailable.");
  }
  if (
    JSON.stringify(receipt.sourceFiles) !== JSON.stringify(expectedSourceFiles) ||
    !SHA256.test(receipt.sourceBundleSha256) ||
    receipt.sourceBundleSha256 !== sha256(Buffer.from(stableStringify(expectedSourceFiles)))
  ) {
    addFinding(findings, "source-binding", "receipt.sourceBundleSha256", "Receipt is not bound to the exact parser, corpus, lockfile, and runner bytes.");
  }

  try {
    const reportBytes = readFileSync(vitestReportPath);
    const expectedSummary = validateVitestReport(JSON.parse(reportBytes.toString("utf8")));
    if (
      !SHA256.test(receipt.vitestReportSha256) ||
      receipt.vitestReportSha256 !== sha256(reportBytes) ||
      JSON.stringify(receipt.testSummary) !== JSON.stringify(expectedSummary)
    ) {
      addFinding(findings, "test-report-binding", "receipt.vitestReportSha256", "Receipt is not bound to the exact successful Vitest report.");
    }
  } catch {
    addFinding(findings, "test-report", "receipt.testSummary", "Complete parser fuzz Vitest evidence is unavailable.");
  }

  const serialized = JSON.stringify(receipt);
  if (/secret-value|private-research|participant-/iu.test(serialized)) {
    addFinding(findings, "raw-marker-leak", "receipt", "Fuzz input markers must never enter the receipt artifact.");
  }

  findings.sort((left, right) => `${left.path}:${left.rule}`.localeCompare(`${right.path}:${right.rule}`));
  return {
    ok: findings.length === 0,
    findings,
    evidence: Object.freeze({
      totalCases: Number.isSafeInteger(receipt.totalCases) ? receipt.totalCases : 0,
      sourceBundleSha256: SHA256.test(receipt.sourceBundleSha256)
        ? receipt.sourceBundleSha256
        : null,
      vitestReportSha256: SHA256.test(receipt.vitestReportSha256)
        ? receipt.vitestReportSha256
        : null,
    }),
  };
}
