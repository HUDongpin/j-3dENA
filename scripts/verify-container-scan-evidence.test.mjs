import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const verifier = resolve(repositoryRoot, "scripts/verify-container-scan-evidence.mjs");
const sourceHeadCommit = "a".repeat(40);
const imageDigest = `sha256:${"b".repeat(64)}`;
const imageRef = `registry.fly.io/j-3dena-compute@${imageDigest}`;
const sourceRepository = "https://github.com/HUDongpin/j-3dENA";

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function validSarif(results = []) {
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [{
      tool: {
        driver: {
          name: "Trivy",
          fullName: "Trivy Vulnerability Scanner",
          informationUri: "https://github.com/aquasecurity/trivy",
          version: "0.70.0",
          rules: [],
        },
      },
      results,
    }],
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
        Test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8080/readyz')"],
      },
      Labels: {
        "org.opencontainers.image.revision": sourceHeadCommit,
        "org.opencontainers.image.source": sourceRepository,
      },
      ...overrides,
    },
  }];
}

function invoke(directory, { image = imageRef, sourceHead = sourceHeadCommit } = {}) {
  const output = join(directory, "container-scan-receipt.json");
  execFileSync(process.execPath, [
    verifier,
    "--sarif",
    join(directory, "trivy-exact-image.sarif"),
    "--inspect",
    join(directory, "docker-inspect.json"),
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
  writeJson(join(directory, "trivy-exact-image.sarif"), validSarif());
  writeJson(join(directory, "docker-inspect.json"), validInspect());
  return directory;
}

test("creates a source- and digest-bound receipt for a clean exact Fly image", () => {
  const directory = fixture();
  try {
    const receipt = invoke(directory);
    assert.equal(receipt.schemaVersion, "3dena.container-scan-receipt.v1");
    assert.equal(receipt.status, "passed");
    assert.equal(receipt.image.ref, imageRef);
    assert.equal(receipt.image.digest, imageDigest);
    assert.equal(receipt.image.sourceHeadCommit, sourceHeadCommit);
    assert.equal(receipt.image.sourceRepository, sourceRepository);
    assert.equal(receipt.image.user, "10001:10001");
    assert.equal(receipt.scanner.name, "Trivy");
    assert.equal(receipt.scanner.version, "0.70.0");
    assert.equal(receipt.scan.resultCount, 0);
    assert.match(receipt.scan.sarifSha256, /^[a-f0-9]{64}$/u);
    assert.match(receipt.image.inspectSha256, /^[a-f0-9]{64}$/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects any Trivy finding", () => {
  const directory = fixture();
  try {
    writeJson(join(directory, "trivy-exact-image.sarif"), validSarif([
      { ruleId: "CVE-TEST", level: "error", message: { text: "synthetic" } },
    ]));
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
      },
    }));
    assert.throws(() => invoke(directory), /Command failed/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects a scanner version drift and any baked credential variable", () => {
  const directory = fixture();
  try {
    const sarif = validSarif();
    sarif.runs[0].tool.driver.version = "0.69.0";
    writeJson(join(directory, "trivy-exact-image.sarif"), sarif);
    assert.throws(() => invoke(directory), /Command failed/u);

    writeJson(join(directory, "trivy-exact-image.sarif"), validSarif());
    writeJson(join(directory, "docker-inspect.json"), validInspect({
      Env: ["NODE_ENV=production", "DATABASE_URL=synthetic-not-a-real-secret"],
    }));
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
  assert.match(workflow, /version:\s*v0\.70\.0/u);
  assert.match(workflow, /docker image inspect/u);
  assert.match(workflow, /verify-container-scan-evidence\.mjs/u);
  assert.match(workflow, /name:\s*trivy-exact-image-evidence/u);
  assert.match(workflow, /if-no-files-found:\s*error/u);
  assert.doesNotMatch(workflow, /github\/codeql-action\/upload-sarif/u);
});
