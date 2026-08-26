#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parseStrictJson } from "../packages/compute-service-persistent/deploy/strict-json.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const RECEIPT_VERSION = "3dena.container-scan-receipt.v3";
const TRIVY_VERSION = "0.70.0";
const MAX_JSON_BYTES = 64 * 1024 * 1024;
const MAX_PUBLIC_KEY_REGISTRY_BYTES = 128 * 1024;
const EXPECTED_REPOSITORY = "HUDongpin/j-3dENA";
const EXPECTED_SOURCE_REPOSITORY = "https://github.com/HUDongpin/j-3dENA";
const EXPECTED_USER = "10001:10001";
const EXPECTED_ENTRYPOINT = Object.freeze(["/usr/local/bin/compute-entrypoint"]);
const EXPECTED_COMMAND = Object.freeze(["api"]);
const EXPECTED_HEALTHCHECK = Object.freeze({
  Test: Object.freeze([
    "CMD",
    "node",
    "-e",
    "fetch('http://127.0.0.1:8080/readyz',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))",
  ]),
  Interval: 15_000_000_000,
  Timeout: 5_000_000_000,
  StartPeriod: 10_000_000_000,
  Retries: 3,
});
const IMAGE_PATTERN = /^registry\.fly\.io\/[a-z0-9-]+@sha256:[a-f0-9]{64}$/u;
const LOWER_SHA256 = /^[a-f0-9]{64}$/u;
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const SECRET_ENV_NAME = /(?:^|_)(?:ACCESS_KEY(?:_ID)?|API_KEY|AWS_ACCESS|AWS_SECRET|BLOB|DATABASE_URL|FLY_API_TOKEN|KMS|NEON|PASSWORD|PRIVATE_KEY|SECRET|TOKEN)(?:_|$)/iu;
const TRIVY_REPORT_KEYS = new Set([
  "SchemaVersion",
  "Trivy",
  "ReportID",
  "CreatedAt",
  "ArtifactID",
  "ArtifactName",
  "ArtifactType",
  "Metadata",
  "Results",
]);
const TRIVY_RESULT_KEYS = new Set([
  "Target",
  "Class",
  "Type",
  "Packages",
  "Vulnerabilities",
  "MisconfSummary",
  "Misconfigurations",
  "Secrets",
  "Licenses",
  "CustomResources",
  "ExperimentalModifiedFindings",
]);
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
    "--trivy-json",
    "--inspect",
    "--public-key-registry",
    "--public-key-verification",
    "--expected-public-key-registry-sha256",
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
  const expectedPublicKeyRegistrySha256 = values.get(
    "--expected-public-key-registry-sha256",
  );
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
  if (!LOWER_SHA256.test(expectedPublicKeyRegistrySha256)) {
    throw new TypeError("--expected-public-key-registry-sha256 is invalid.");
  }
  if (!/^[1-9][0-9]*$/u.test(runId)) throw new TypeError("--run-id is invalid.");
  if (!/^[1-9][0-9]*$/u.test(runAttempt)) throw new TypeError("--run-attempt is invalid.");
  return Object.freeze({
    trivyJson: resolve(values.get("--trivy-json")),
    inspect: resolve(values.get("--inspect")),
    publicKeyRegistry: resolve(values.get("--public-key-registry")),
    publicKeyVerification: resolve(values.get("--public-key-verification")),
    output: resolve(values.get("--output")),
    imageRef,
    expectedPublicKeyRegistrySha256,
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

function readEvidenceJson(root, requestedRoot, path, label) {
  const requested = resolve(path);
  if (!inside(requestedRoot, requested)) {
    throw new Error(`${label} is outside the evidence directory.`);
  }
  let requestedComponent = requestedRoot;
  for (const segment of relative(requestedRoot, requested).split(sep)) {
    requestedComponent = resolve(requestedComponent, segment);
    if (lstatSync(requestedComponent, { bigint: true }).isSymbolicLink()) {
      throw new Error(`${label} contains a symbolic-link component.`);
    }
  }
  const realPath = realpathSync(requested);
  if (!inside(root, realPath)) throw new Error(`${label} resolved outside the evidence directory.`);
  let currentPath = root;
  for (const segment of relative(root, realPath).split(sep)) {
    currentPath = resolve(currentPath, segment);
    if (lstatSync(currentPath, { bigint: true }).isSymbolicLink()) {
      throw new Error(`${label} contains a symbolic-link component.`);
    }
  }
  const metadata = lstatSync(realPath, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink() ||
      metadata.size < 2n || metadata.size > BigInt(MAX_JSON_BYTES)) {
    throw new Error(`${label} must be a regular 2..${MAX_JSON_BYTES} byte file.`);
  }
  const descriptor = openSync(realPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.dev !== metadata.dev || before.ino !== metadata.ino ||
        before.size !== metadata.size) {
      throw new Error(`${label} changed during secure open.`);
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    const current = lstatSync(realPath, { bigint: true });
    if (after.dev !== before.dev || after.ino !== before.ino ||
        after.size !== before.size || after.mtimeNs !== before.mtimeNs ||
        after.ctimeNs !== before.ctimeNs || current.isSymbolicLink() ||
        current.dev !== before.dev || current.ino !== before.ino ||
        BigInt(bytes.byteLength) !== before.size) {
      throw new Error(`${label} changed during secure read.`);
    }
    return Object.freeze({
      bytes,
      json: parseStrictJson(utf8.decode(bytes)),
      relativePath: relative(root, realPath).split(sep).join("/"),
    });
  } catch (error) {
    throw new Error(`${label} is not stable strict UTF-8 JSON.`, { cause: error });
  } finally {
    closeSync(descriptor);
  }
}

function inspectTrivyJson(report, imageRef) {
  if (!isRecord(report) || report.SchemaVersion !== 2 ||
      Object.keys(report).some((key) => !TRIVY_REPORT_KEYS.has(key)) ||
      !isRecord(report.Trivy) ||
      Object.keys(report.Trivy).length !== 1 || report.Trivy.Version !== TRIVY_VERSION ||
      report.ArtifactName !== imageRef || report.ArtifactType !== "container_image" ||
      !isRecord(report.Metadata) || !Array.isArray(report.Metadata.RepoDigests) ||
      !report.Metadata.RepoDigests.includes(imageRef) || !Array.isArray(report.Results)) {
    throw new Error("Trivy JSON does not bind the exact immutable container image.");
  }
  let findingCount = 0;
  for (const result of report.Results) {
    if (!isRecord(result) || typeof result.Target !== "string" || result.Target.length === 0 ||
        Object.keys(result).some((key) => !TRIVY_RESULT_KEYS.has(key)) ||
        (result.Packages !== undefined && !Array.isArray(result.Packages))) {
      throw new Error("Trivy JSON result metadata is invalid.");
    }
    for (const category of [
      "Vulnerabilities",
      "Misconfigurations",
      "Secrets",
      "Licenses",
      "CustomResources",
      "ExperimentalModifiedFindings",
    ]) {
      const findings = result[category];
      if (findings !== undefined && !Array.isArray(findings)) {
        throw new Error(`Trivy JSON ${category} evidence is invalid.`);
      }
      findingCount += findings?.length ?? 0;
    }
    if (result.MisconfSummary !== undefined &&
        (!isRecord(result.MisconfSummary) ||
         Object.keys(result.MisconfSummary).sort().join("\0") !== "Failures\0Successes" ||
         !Number.isSafeInteger(result.MisconfSummary.Successes) ||
         !Number.isSafeInteger(result.MisconfSummary.Failures) ||
         result.MisconfSummary.Successes < 0 || result.MisconfSummary.Failures < 0)) {
      throw new Error("Trivy JSON misconfiguration summary is invalid.");
    }
    findingCount += result.MisconfSummary?.Failures ?? 0;
  }
  if (findingCount !== 0) {
    throw new Error(`Trivy reported ${findingCount} disallowed image finding(s).`);
  }
  return Object.freeze({
    name: "Trivy",
    fullName: "Trivy Vulnerability Scanner",
    informationUri: "https://github.com/aquasecurity/trivy",
    version: TRIVY_VERSION,
    artifactName: report.ArtifactName,
    artifactType: report.ArtifactType,
    targetCount: report.Results.length,
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
  if (!isRecord(config.Healthcheck) ||
      Object.keys(config.Healthcheck).sort().join("\0") !==
        Object.keys(EXPECTED_HEALTHCHECK).sort().join("\0")) {
    throw new Error("The exact image health check does not match the frozen contract.");
  }
  const healthcheckTest = exactStringArray(
    config.Healthcheck.Test,
    EXPECTED_HEALTHCHECK.Test,
    "Image health check command",
  );
  for (const field of ["Interval", "Timeout", "StartPeriod", "Retries"]) {
    if (config.Healthcheck[field] !== EXPECTED_HEALTHCHECK[field]) {
      throw new Error("The exact image health check does not match the frozen contract.");
    }
  }
  const labels = config.Labels;
  if (!isRecord(labels) ||
      labels["org.opencontainers.image.revision"] !== options.sourceHeadCommit ||
      labels["org.opencontainers.image.source"] !== EXPECTED_SOURCE_REPOSITORY) {
    throw new Error("OCI source labels do not bind the approved GitHub source and head commit.");
  }
  const publicKeyRegistrySha256 = labels["org.3dena.build-approval-public-keys.sha256"];
  if (typeof publicKeyRegistrySha256 !== "string" ||
      !LOWER_SHA256.test(publicKeyRegistrySha256) ||
      publicKeyRegistrySha256 !== options.expectedPublicKeyRegistrySha256) {
    throw new Error("OCI labels do not bind an exact public-key registry SHA-256.");
  }
  if (!Array.isArray(config.Env) || config.Env.some((entry) =>
    typeof entry !== "string" || !entry.includes("="))) {
    throw new Error("Docker inspect environment metadata is invalid.");
  }
  const environmentNames = config.Env.map((entry) => entry.slice(0, entry.indexOf("=")));
  if (environmentNames.some((name) => !ENVIRONMENT_NAME.test(name)) ||
      new Set(environmentNames).size !== environmentNames.length) {
    throw new Error("Docker inspect environment names are ambiguous or invalid.");
  }
  const bakedSensitiveNames = environmentNames.filter((name) => SECRET_ENV_NAME.test(name));
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
    healthcheck: Object.freeze({
      test: healthcheckTest,
      intervalNanoseconds: config.Healthcheck.Interval,
      timeoutNanoseconds: config.Healthcheck.Timeout,
      startPeriodNanoseconds: config.Healthcheck.StartPeriod,
      retries: config.Healthcheck.Retries,
    }),
    bakedSensitiveEnvironmentVariables: 0,
    publicKeyRegistrySha256,
  });
}

function inspectPublicKeyVerification(document, expectedSha256) {
  if (!isRecord(document) ||
      Object.keys(document).sort().join("\0") !== [
        "publicKeyCount",
        "schemaVersion",
        "sha256",
        "verified",
      ].sort().join("\0") ||
      document.schemaVersion !== "3dena.image-public-key-registry-verification.v1" ||
      document.verified !== true ||
      !Number.isSafeInteger(document.publicKeyCount) ||
      document.publicKeyCount < 1 ||
      document.publicKeyCount > 10_000 ||
      document.sha256 !== expectedSha256) {
    throw new Error("In-image public-key registry verification does not match the OCI label.");
  }
  return Object.freeze({
    publicKeyCount: document.publicKeyCount,
    sha256: document.sha256,
  });
}

function inspectPublicKeyRegistry(document, bytes, expectedSha256, publicKeyCount) {
  if (!isRecord(document) || Object.keys(document).length !== publicKeyCount ||
      bytes.byteLength < 3 || bytes.byteLength > MAX_PUBLIC_KEY_REGISTRY_BYTES) {
    throw new Error("In-image public-key registry bytes are invalid.");
  }
  const observedSha256 = sha256(bytes);
  if (observedSha256 !== expectedSha256) {
    throw new Error("In-image public-key registry bytes do not match the independent expected hash.");
  }
  return Object.freeze({
    publicKeyCount,
    sha256: observedSha256,
    byteLength: bytes.byteLength,
  });
}

export function inspectContainerScanEvidenceDocuments(input) {
  if (!isRecord(input) ||
      Object.keys(input).sort().join("\0") !== [
        "expectedPublicKeyRegistrySha256",
        "imageRef",
        "inspect",
        "publicKeyRegistryBytes",
        "publicKeyVerification",
        "sourceHeadCommit",
        "trivyJson",
      ].sort().join("\0") ||
      !IMAGE_PATTERN.test(input.imageRef) ||
      !LOWER_SHA256.test(input.expectedPublicKeyRegistrySha256) ||
      !/^[a-f0-9]{40}$/u.test(input.sourceHeadCommit) ||
      !(input.publicKeyRegistryBytes instanceof Uint8Array)) {
    throw new TypeError("Container scan document verification input is invalid.");
  }
  const scanner = inspectTrivyJson(input.trivyJson, input.imageRef);
  const image = inspectImage(input.inspect, {
    imageRef: input.imageRef,
    expectedPublicKeyRegistrySha256: input.expectedPublicKeyRegistrySha256,
    sourceHeadCommit: input.sourceHeadCommit,
  });
  const publicKeyRegistry = inspectPublicKeyVerification(
    input.publicKeyVerification,
    image.publicKeyRegistrySha256,
  );
  const publicKeyRegistryBytes = new Uint8Array(input.publicKeyRegistryBytes);
  const publicKeyRegistryDocument = parseStrictJson(utf8.decode(publicKeyRegistryBytes));
  const verifiedPublicKeyRegistry = inspectPublicKeyRegistry(
    publicKeyRegistryDocument,
    publicKeyRegistryBytes,
    image.publicKeyRegistrySha256,
    publicKeyRegistry.publicKeyCount,
  );
  return Object.freeze({
    scanner,
    image,
    publicKeyRegistry: verifiedPublicKeyRegistry,
  });
}

export function createContainerScanReceipt(options) {
  const requestedEvidenceRoot = resolve(options.evidenceRoot);
  const evidenceRootMetadata = lstatSync(requestedEvidenceRoot, { bigint: true });
  if (!evidenceRootMetadata.isDirectory() || evidenceRootMetadata.isSymbolicLink()) {
    throw new Error("Evidence root must be a real directory, not a symbolic link.");
  }
  const evidenceRoot = realpathSync(requestedEvidenceRoot);
  const reportEvidence = readEvidenceJson(
    evidenceRoot,
    requestedEvidenceRoot,
    options.trivyJson,
    "Trivy JSON",
  );
  const inspectEvidence = readEvidenceJson(
    evidenceRoot,
    requestedEvidenceRoot,
    options.inspect,
    "Docker inspect evidence",
  );
  const publicKeyRegistryEvidence = readEvidenceJson(
    evidenceRoot,
    requestedEvidenceRoot,
    options.publicKeyRegistry,
    "In-image public-key registry",
  );
  const publicKeyEvidence = readEvidenceJson(
    evidenceRoot,
    requestedEvidenceRoot,
    options.publicKeyVerification,
    "Public-key registry verification",
  );
  const scanner = inspectTrivyJson(reportEvidence.json, options.imageRef);
  const image = inspectImage(inspectEvidence.json, options);
  const publicKeyVerification = inspectPublicKeyVerification(
    publicKeyEvidence.json,
    image.publicKeyRegistrySha256,
  );
  const publicKeyRegistry = inspectPublicKeyRegistry(
    publicKeyRegistryEvidence.json,
    publicKeyRegistryEvidence.bytes,
    image.publicKeyRegistrySha256,
    publicKeyVerification.publicKeyCount,
  );
  const { publicKeyRegistrySha256: _publicKeyRegistrySha256, ...imageIdentity } = image;
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
      ...imageIdentity,
      inspectPath: inspectEvidence.relativePath,
      inspectSha256: sha256(inspectEvidence.bytes),
      inspectByteLength: inspectEvidence.bytes.byteLength,
      publicKeyRegistry: Object.freeze({
        expectedSha256: options.expectedPublicKeyRegistrySha256,
        sha256: publicKeyRegistry.sha256,
        publicKeyCount: publicKeyRegistry.publicKeyCount,
        rawPath: publicKeyRegistryEvidence.relativePath,
        rawSha256: publicKeyRegistry.sha256,
        rawByteLength: publicKeyRegistry.byteLength,
        verificationPath: publicKeyEvidence.relativePath,
        verificationSha256: sha256(publicKeyEvidence.bytes),
        verificationByteLength: publicKeyEvidence.bytes.byteLength,
      }),
    }),
    scanner: Object.freeze({
      name: scanner.name,
      fullName: scanner.fullName,
      informationUri: scanner.informationUri,
      version: scanner.version,
    }),
    scan: Object.freeze({
      format: "trivy-json",
      artifactName: scanner.artifactName,
      artifactType: scanner.artifactType,
      resultCount: scanner.resultCount,
      targetCount: scanner.targetCount,
      reportPath: reportEvidence.relativePath,
      reportSha256: sha256(reportEvidence.bytes),
      reportByteLength: reportEvidence.bytes.byteLength,
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
