import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { inspectContainerScanEvidenceDocuments } from "./verify-container-scan-evidence.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const verifier = resolve(repositoryRoot, "scripts/verify-container-scan-evidence.mjs");
const sourceHeadCommit = "a".repeat(40);
const imageDigest = `sha256:${"b".repeat(64)}`;
const imageRef = `registry.fly.io/j-3dena-compute@${imageDigest}`;
const sourceRepository = "https://github.com/HUDongpin/j-3dENA";
const publicKeyRegistryBytes = Buffer.from(
  '{"reviewer-key-1":{"algorithm":"Ed25519","allowedEnvironments":["production"],"publicKeyPem":"-----BEGIN PUBLIC KEY-----\\nMCowBQYDK2VwAyEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\\n-----END PUBLIC KEY-----\\n","reviewerId":"independent-reviewer","role":"independent-reviewer"}}\n',
  "utf8",
);
const publicKeyRegistrySha256 = createHash("sha256")
  .update(publicKeyRegistryBytes)
  .digest("hex");

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function validTrivyJson(results = []) {
  return {
    SchemaVersion: 2,
    Trivy: {
      Version: "0.70.0",
    },
    ArtifactName: imageRef,
    ArtifactType: "container_image",
    Metadata: {
      RepoDigests: [imageRef],
    },
    Results: results,
  };
}

function validInspect(overrides = {}) {
  return [{
    Id: `sha256:${"c".repeat(64)}`,
    RepoDigests: [imageRef],
    Architecture: "amd64",
    Os: "linux",
    Config: {
      User: "10001:10001",
      Env: ["NODE_ENV=production", "HOME=/nonexistent"],
      Entrypoint: ["/usr/local/bin/compute-entrypoint"],
      Cmd: ["api"],
      Healthcheck: {
        Test: [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:8080/readyz',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))",
        ],
        Interval: 15_000_000_000,
        Timeout: 5_000_000_000,
        StartPeriod: 10_000_000_000,
        Retries: 3,
      },
      Labels: {
        "org.opencontainers.image.revision": sourceHeadCommit,
        "org.opencontainers.image.source": sourceRepository,
        "org.3dena.build-approval-public-keys.sha256": publicKeyRegistrySha256,
      },
      ...overrides,
    },
  }];
}

function invoke(directory, {
  image = imageRef,
  sourceHead = sourceHeadCommit,
  expectedRegistrySha256 = publicKeyRegistrySha256,
} = {}) {
  const output = join(directory, "container-scan-receipt.json");
  execFileSync(process.execPath, [
    verifier,
    "--trivy-json",
    join(directory, "trivy-exact-image.json"),
    "--inspect",
    join(directory, "docker-inspect.json"),
    "--public-key-registry",
    join(directory, "build-approval-public-keys.json"),
    "--public-key-verification",
    join(directory, "public-key-registry-verification.json"),
    "--expected-public-key-registry-sha256",
    expectedRegistrySha256,
    "--output",
    output,
    "--image-ref",
    image,
    "--repository",
    "HUDongpin/j-3dENA",
    "--source-head-commit",
    sourceHead,
    "--run-id",
    "123456",
    "--run-attempt",
    "1",
  ], { cwd: repositoryRoot, stdio: "pipe" });
  return JSON.parse(readFileSync(output, "utf8"));
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "3dena-container-scan-"));
  mkdirSync(directory, { recursive: true });
  writeJson(join(directory, "trivy-exact-image.json"), validTrivyJson());
  writeJson(join(directory, "docker-inspect.json"), validInspect());
  writeFileSync(
    join(directory, "build-approval-public-keys.json"),
    publicKeyRegistryBytes,
  );
  writeJson(join(directory, "public-key-registry-verification.json"), {
    schemaVersion: "3dena.image-public-key-registry-verification.v1",
    publicKeyCount: 1,
    sha256: publicKeyRegistrySha256,
    verified: true,
  });
  return realpathSync(directory);
}

test("creates a source- and digest-bound receipt for a clean exact Fly image", () => {
  const directory = fixture();
  try {
    const receipt = invoke(directory);
    assert.equal(receipt.schemaVersion, "3dena.container-scan-receipt.v3");
    assert.equal(receipt.status, "passed");
    assert.equal(receipt.image.ref, imageRef);
    assert.equal(receipt.image.digest, imageDigest);
    assert.equal(receipt.image.sourceHeadCommit, sourceHeadCommit);
    assert.equal(receipt.image.sourceRepository, sourceRepository);
    assert.equal(receipt.image.user, "10001:10001");
    assert.equal(receipt.image.publicKeyRegistry.sha256, publicKeyRegistrySha256);
    assert.equal(receipt.image.publicKeyRegistry.expectedSha256, publicKeyRegistrySha256);
    assert.equal(receipt.image.publicKeyRegistry.publicKeyCount, 1);
    assert.equal(receipt.image.publicKeyRegistry.rawSha256, publicKeyRegistrySha256);
    assert.equal(
      receipt.image.publicKeyRegistry.rawPath,
      "build-approval-public-keys.json",
    );
    assert.match(receipt.image.publicKeyRegistry.verificationSha256, /^[a-f0-9]{64}$/u);
    assert.equal(receipt.scanner.name, "Trivy");
    assert.equal(receipt.scanner.version, "0.70.0");
    assert.equal(receipt.scan.resultCount, 0);
    assert.equal(receipt.scan.artifactName, imageRef);
    assert.equal(receipt.scan.artifactType, "container_image");
    assert.equal(receipt.scan.format, "trivy-json");
    assert.match(receipt.scan.reportSha256, /^[a-f0-9]{64}$/u);
    assert.match(receipt.image.inspectSha256, /^[a-f0-9]{64}$/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pure document API returns frozen registry metadata without raw registry bytes", () => {
  const verified = inspectContainerScanEvidenceDocuments({
    expectedPublicKeyRegistrySha256: publicKeyRegistrySha256,
    imageRef,
    inspect: validInspect(),
    publicKeyRegistryBytes,
    publicKeyVerification: {
      schemaVersion: "3dena.image-public-key-registry-verification.v1",
      publicKeyCount: 1,
      sha256: publicKeyRegistrySha256,
      verified: true,
    },
    sourceHeadCommit,
    trivyJson: validTrivyJson(),
  });

  assert.equal(verified.scanner.artifactName, imageRef);
  assert.equal(verified.publicKeyRegistry.sha256, publicKeyRegistrySha256);
  assert.equal(verified.publicKeyRegistry.byteLength, publicKeyRegistryBytes.byteLength);
  assert.equal("publicKeyRegistryBytes" in verified.publicKeyRegistry, false);
  assert.equal(Object.isFrozen(verified), true);
  assert.equal(Object.isFrozen(verified.scanner), true);
  assert.equal(Object.isFrozen(verified.image), true);
  assert.equal(Object.isFrozen(verified.image.healthcheck), true);
  assert.equal(Object.isFrozen(verified.publicKeyRegistry), true);
});

test("rejects any Trivy finding", () => {
  const directory = fixture();
  try {
    writeJson(join(directory, "trivy-exact-image.json"), validTrivyJson([{
      Target: "synthetic",
      Class: "os-pkgs",
      Type: "alpine",
      Vulnerabilities: [{ VulnerabilityID: "CVE-TEST", Severity: "HIGH" }],
    }]));
    assert.throws(() => invoke(directory), /Command failed/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects mutable references, digest drift, source drift, and root images", () => {
  const directory = fixture();
  try {
    assert.throws(
      () => invoke(directory, { image: "registry.fly.io/j-3dena-compute:latest" }),
      /Command failed/u,
    );

    writeJson(join(directory, "docker-inspect.json"), [{
      ...validInspect()[0],
      RepoDigests: [`registry.fly.io/j-3dena-compute@sha256:${"e".repeat(64)}`],
    }]);
    assert.throws(() => invoke(directory), /Command failed/u);

    writeJson(join(directory, "docker-inspect.json"), validInspect({
      User: "0:0",
      Labels: {
        "org.opencontainers.image.revision": "d".repeat(40),
        "org.opencontainers.image.source": sourceRepository,
        "org.3dena.build-approval-public-keys.sha256": publicKeyRegistrySha256,
      },
    }));
    assert.throws(() => invoke(directory), /Command failed/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects missing, tampered, drifted, or non-positive public-key registry evidence", () => {
  const directory = fixture();
  try {
    writeJson(join(directory, "docker-inspect.json"), validInspect({
      Labels: {
        "org.opencontainers.image.revision": sourceHeadCommit,
        "org.opencontainers.image.source": sourceRepository,
      },
    }));
    assert.throws(() => invoke(directory), /Command failed/u);

    writeJson(join(directory, "docker-inspect.json"), validInspect());
    writeFileSync(
      join(directory, "build-approval-public-keys.json"),
      Buffer.concat([publicKeyRegistryBytes, Buffer.from(" ")]),
    );
    assert.throws(() => invoke(directory), /Command failed/u);

    writeFileSync(
      join(directory, "build-approval-public-keys.json"),
      publicKeyRegistryBytes,
    );
    writeJson(join(directory, "public-key-registry-verification.json"), {
      schemaVersion: "3dena.image-public-key-registry-verification.v1",
      publicKeyCount: 1,
      sha256: "e".repeat(64),
      verified: true,
    });
    assert.throws(() => invoke(directory), /Command failed/u);

    writeJson(join(directory, "public-key-registry-verification.json"), {
      schemaVersion: "3dena.image-public-key-registry-verification.v1",
      publicKeyCount: 0,
      sha256: publicKeyRegistrySha256,
      verified: true,
    });
    assert.throws(() => invoke(directory), /Command failed/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects an image whose self-label differs from the independent expected registry hash", () => {
  const directory = fixture();
  try {
    assert.throws(
      () => invoke(directory, { expectedRegistrySha256: "e".repeat(64) }),
      /Command failed/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects scanner version/digest/type drift and sensitive baked credential names", () => {
  const directory = fixture();
  try {
    writeJson(join(directory, "trivy-exact-image.json"), {
      ...validTrivyJson(),
      Trivy: { Version: "0.69.0" },
    });
    assert.throws(() => invoke(directory), /Command failed/u);

    writeJson(join(directory, "trivy-exact-image.json"), {
      ...validTrivyJson(),
      ArtifactName: `registry.fly.io/j-3dena-compute@sha256:${"e".repeat(64)}`,
    });
    assert.throws(() => invoke(directory), /Command failed/u);

    writeJson(join(directory, "trivy-exact-image.json"), {
      ...validTrivyJson(),
      ArtifactType: "filesystem",
    });
    assert.throws(() => invoke(directory), /Command failed/u);

    writeJson(join(directory, "trivy-exact-image.json"), {
      ...validTrivyJson(),
      Metadata: {
        RepoDigests: [
          `registry.fly.io/j-3dena-compute@sha256:${"e".repeat(64)}`,
        ],
      },
    });
    assert.throws(() => invoke(directory), /Command failed/u);

    writeJson(join(directory, "trivy-exact-image.json"), validTrivyJson([{
      Target: "synthetic",
      Class: "os-pkgs",
      Type: "alpine",
      Findings: [{ VulnerabilityID: "CVE-HIDDEN" }],
    }]));
    assert.throws(() => invoke(directory), /Command failed/u);

    writeJson(join(directory, "trivy-exact-image.json"), validTrivyJson());
    for (const sensitiveName of [
      "API_KEY",
      "ACCESS_KEY",
      "OPENAI_API_KEY",
      "DATABASE_URL",
    ]) {
      writeJson(join(directory, "docker-inspect.json"), validInspect({
        Env: ["NODE_ENV=production", `${sensitiveName}=synthetic-not-a-real-secret`],
      }));
      assert.throws(() => invoke(directory), /Command failed/u, sensitiveName);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects healthcheck wrong-port, unconditional-success, and side-effect drift", () => {
  const directory = fixture();
  try {
    const invalidHealthcheckScripts = [
      "fetch('http://127.0.0.1:8081/readyz').catch(()=>process.exit(1))",
      "process.exit(0)",
      "fetch('http://127.0.0.1:8080/readyz').then(()=>require('node:fs').writeFileSync('/tmp/pwned','1'))",
    ];
    for (const script of invalidHealthcheckScripts) {
      writeJson(join(directory, "docker-inspect.json"), validInspect({
        Healthcheck: {
          Test: ["CMD", "node", "-e", script],
          Interval: 15_000_000_000,
          Timeout: 5_000_000_000,
          StartPeriod: 10_000_000_000,
          Retries: 3,
        },
      }));
      assert.throws(() => invoke(directory), /Command failed/u, script);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects duplicate-key JSON and symbolic-link evidence", () => {
  const directory = fixture();
  try {
    writeFileSync(
      join(directory, "trivy-exact-image.json"),
      `{"SchemaVersion":2,"ArtifactName":"${imageRef}","ArtifactName":"${imageRef}","ArtifactType":"container_image","Results":[]}\n`,
    );
    assert.throws(() => invoke(directory), /Command failed/u);

    const actual = join(directory, "actual-trivy.json");
    writeJson(actual, validTrivyJson());
    rmSync(join(directory, "trivy-exact-image.json"));
    symlinkSync(actual, join(directory, "trivy-exact-image.json"));
    assert.throws(() => invoke(directory), /Command failed/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("exact-image workflow retains locally verified evidence instead of relying on Code Scanning", () => {
  const workflow = readFileSync(
    resolve(repositoryRoot, ".github/workflows/container-scan.yml"),
    "utf8",
  );
  assert.match(workflow, /source_head_commit:/u);
  assert.match(workflow, /expected_public_key_registry_sha256:/u);
  assert.match(workflow, /version:\s*v0\.70\.0/u);
  assert.match(workflow, /docker image inspect/u);
  assert.match(workflow, /format:\s*json/u);
  assert.match(workflow, /trivy-exact-image\.json/u);
  assert.match(workflow, /--trivy-json/u);
  assert.match(workflow, /--public-key-registry\s+output\/container-scan\/build-approval-public-keys\.json/u);
  assert.match(workflow, /public-key-registry-verification\.json/u);
  assert.match(workflow, /verify-image-public-key-registry/u);
  assert.match(workflow, /verify-container-scan-evidence\.mjs/u);
  assert.match(workflow, /name:\s*trivy-exact-image-evidence/u);
  assert.match(workflow, /if-no-files-found:\s*error/u);
  assert.doesNotMatch(workflow, /github\/codeql-action\/upload-sarif/u);
});
