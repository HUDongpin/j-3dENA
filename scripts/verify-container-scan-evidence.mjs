#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const RECEIPT_VERSION = "3dena.container-scan-receipt.v1";
const TRIVY_VERSION = "0.70.0";
const MAX_JSON_BYTES = 64 * 1024 * 1024;
const EXPECTED_REPOSITORY = "HUDongpin/j-3dENA";
const EXPECTED_SOURCE_REPOSITORY = "https://github.com/HUDongpin/j-3dENA";
const EXPECTED_USER = "10001:10001";
const EXPECTED_ENTRYPOINT = Object.freeze(["/usr/local/bin/compute-entrypoint"]);
const EXPECTED_COMMAND = Object.freeze(["api"]);
const IMAGE_PATTERN = /^registry\.fly\.io\/[a-z0-9-]+@sha256:[a-f0-9]{64}$/u;
const SECRET_ENV_NAME = /(?:^|_)(?:AWS_ACCESS|AWS_SECRET|BLOB|DATABASE_URL|FLY_API_TOKEN|KMS|NEON|PASSWORD|PRIVATE_KEY|SECRET|TOKEN)(?:_|$)/iu;
const utf8 = new TextDecoder("utf-8", { fatal: true });

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function samePath(left, right) {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return resolve(left) === resolve(right);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactStringArray(actual, expected, label) {
  if (!Array.isArray(actual) ||
      actual.length !== expected.length ||
      actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${label} does not match the frozen container contract.`);
  }
  return Object.freeze([...actual]);
}

function parseArguments(argv) {
  const allowed = new Set([
    "--sarif",
    "--inspect",
    "--output",
    "--image-ref",
    "--repository",
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
  const repository = values.get("--repository");
  const sourceHeadCommit = values.get("--source-head-commit");
  const imageRef = values.get("--image-ref");
  const runId = values.get("--run-id");
  const runAttempt = values.get("--run-attempt");
  if (repository !== EXPECTED_REPOSITORY) {
    throw new TypeError("--repository must be the approved HUDongpin/j-3dENA source repository.");
  }
  if (!/^[a-f0-9]{40}$/u.test(sourceHeadCommit)) {
    throw new TypeError("--source-head-commit must be a full lowercase Git SHA.");
  }
  if (!IMAGE_PATTERN.test(imageRef)) {
    throw new TypeError("--image-ref must be an immutable Fly registry digest reference.");
  }
  if (!/^[1-9][0-9]*$/u.test(runId)) throw new TypeError("--run-id is invalid.");
  if (!/^[1-9][0-9]*$/u.test(runAttempt)) throw new TypeError("--run-attempt is invalid.");
  return Object.freeze({
    sarif: resolve(values.get("--sarif")),
    inspect: resolve(values.get("--inspect")),
    output: resolve(values.get("--output")),
    imageRef,
    repository,
    sourceHeadCommit,
    runId,
    runAttempt,
  });
}

function inside(root, path) {
  const pathRelative = relative(root, path);
  return pathRelative !== "" && pathRelative !== ".." && !pathRelative.startsWith(`..${sep}`);
}

function readEvidenceJson(root, path, label) {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() ||
      metadata.size < 2 || metadata.size > MAX_JSON_BYTES) {
    throw new Error(`${label} must be a regular 2..${MAX_JSON_BYTES} byte file.`);
  }
  const realPath = realpathSync(path);
  if (!inside(root, realPath)) throw new Error(`${label} resolved outside the evidence directory.`);
  const bytes = readFileSync(realPath);
  let json;
  try {
    json = JSON.parse(utf8.decode(bytes));
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8 JSON.`, { cause: error });
  }
  return Object.freeze({
    bytes,
    json,
    relativePath: relative(root, realPath).split(sep).join("/"),
  });
}

function inspectSarif(sarif) {
  if (!isRecord(sarif) || sarif.version !== "2.1.0" ||
      !Array.isArray(sarif.runs) || sarif.runs.length !== 1) {
    throw new Error("Trivy SARIF must be version 2.1.0 with exactly one run.");
  }
  const run = sarif.runs[0];
  const driver = run?.tool?.driver;
  if (!isRecord(run) || !isRecord(driver) ||
      driver.name !== "Trivy" ||
      driver.fullName !== "Trivy Vulnerability Scanner" ||
      driver.informationUri !== "https://github.com/aquasecurity/trivy" ||
      driver.version !== TRIVY_VERSION ||
      !Array.isArray(driver.rules) ||
      !Array.isArray(run.results)) {
    throw new Error("Trivy SARIF scanner identity or result contract drifted.");
  }
  if (run.results.length !== 0) {
    throw new Error(`Trivy reported ${run.results.length} disallowed image finding(s).`);
  }
  return Object.freeze({
    name: driver.name,
    fullName: driver.fullName,
    informationUri: driver.informationUri,
    version: driver.version,
    ruleCount: driver.rules.length,
    resultCount: 0,
  });
}

function inspectImage(document, options) {
  if (!Array.isArray(document) || document.length !== 1 || !isRecord(document[0])) {
    throw new Error("Docker inspect evidence must contain exactly one image object.");
  }
  const image = document[0];
  const config = image.Config;
  if (!Array.isArray(image.RepoDigests) || !image.RepoDigests.includes(options.imageRef)) {
    throw new Error("Docker inspect evidence does not bind the requested image digest.");
  }
  if (image.Os !== "linux" || !["amd64", "arm64"].includes(image.Architecture)) {
    throw new Error("The exact image must be a reviewed Linux amd64 or arm64 image.");
  }
  if (!isRecord(config) || config.User !== EXPECTED_USER) {
    throw new Error("The exact image must run as the frozen non-root UID and GID.");
  }
  const entrypoint = exactStringArray(config.Entrypoint, EXPECTED_ENTRYPOINT, "Image entrypoint");
  const command = exactStringArray(config.Cmd, EXPECTED_COMMAND, "Image command");
  if (!isRecord(config.Healthcheck) || !Array.isArray(config.Healthcheck.Test) ||
      config.Healthcheck.Test.length === 0 ||
      !config.Healthcheck.Test.some((value) => typeof value === "string" && value.includes("/readyz"))) {
    throw new Error("The exact image lacks the frozen /readyz health check.");
  }
  const labels = config.Labels;
  if (!isRecord(labels) ||
      labels["org.opencontainers.image.revision"] !== options.sourceHeadCommit ||
      labels["org.opencontainers.image.source"] !== EXPECTED_SOURCE_REPOSITORY) {
    throw new Error("OCI source labels do not bind the approved GitHub source and head commit.");
  }
  if (!Array.isArray(config.Env) || config.Env.some((entry) => typeof entry !== "string" || !entry.includes("="))) {
    throw new Error("Docker inspect environment metadata is invalid.");
  }
  const bakedSensitiveNames = config.Env
    .map((entry) => entry.slice(0, entry.indexOf("=")))
    .filter((name) => SECRET_ENV_NAME.test(name));
  if (bakedSensitiveNames.length !== 0) {
    throw new Error("The exact image contains a disallowed baked credential variable.");
  }
  return Object.freeze({
    digest: options.imageRef.slice(options.imageRef.indexOf("@") + 1),
    sourceRepository: EXPECTED_SOURCE_REPOSITORY,
    sourceHeadCommit: options.sourceHeadCommit,
    user: config.User,
    os: image.Os,
    architecture: image.Architecture,
    entrypoint,
    command,
    healthcheck: Object.freeze([...config.Healthcheck.Test]),
    bakedSensitiveEnvironmentVariables: 0,
  });
}

export function createContainerScanReceipt(options) {
  const evidenceRoot = realpathSync(options.evidenceRoot);
  const sarifEvidence = readEvidenceJson(evidenceRoot, options.sarif, "Trivy SARIF");
  const inspectEvidence = readEvidenceJson(evidenceRoot, options.inspect, "Docker inspect evidence");
  const scanner = inspectSarif(sarifEvidence.json);
  const image = inspectImage(inspectEvidence.json, options);
  return Object.freeze({
    schemaVersion: RECEIPT_VERSION,
    status: "passed",
    repository: options.repository,
    runIdentity: Object.freeze({
      runId: options.runId,
      runAttempt: options.runAttempt,
    }),
    image: Object.freeze({
      ref: options.imageRef,
      ...image,
      inspectPath: inspectEvidence.relativePath,
      inspectSha256: sha256(inspectEvidence.bytes),
      inspectByteLength: inspectEvidence.bytes.byteLength,
    }),
    scanner: Object.freeze({
      name: scanner.name,
      fullName: scanner.fullName,
      informationUri: scanner.informationUri,
      version: scanner.version,
    }),
    scan: Object.freeze({
      resultCount: scanner.resultCount,
      ruleCount: scanner.ruleCount,
      sarifPath: sarifEvidence.relativePath,
      sarifSha256: sha256(sarifEvidence.bytes),
      sarifByteLength: sarifEvidence.bytes.byteLength,
    }),
  });
}

function run(argv) {
  const options = parseArguments(argv);
  const outputParent = resolve(dirname(options.output));
  mkdirSync(outputParent, { recursive: true });
  const evidenceRoot = realpathSync(outputParent);
  const outputPath = resolve(evidenceRoot, basename(options.output));
  if (!inside(evidenceRoot, outputPath)) {
    throw new Error("--output must be a new file inside the evidence directory.");
  }
  const receipt = createContainerScanReceipt({ ...options, evidenceRoot });
  writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(`${JSON.stringify({
    schemaVersion: RECEIPT_VERSION,
    status: "passed",
    imageRef: options.imageRef,
    sourceHeadCommit: options.sourceHeadCommit,
    resultCount: 0,
  })}\n`);
}

if (samePath(process.argv[1] ?? "", SCRIPT_PATH)) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `Container scan evidence verification failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
