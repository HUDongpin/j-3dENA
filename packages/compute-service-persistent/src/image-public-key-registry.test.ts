import { createHash, generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const verifier = new URL("../deploy/verify-image-public-key-registry.mjs", import.meta.url);

function sha256(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function run(path: string, digest: string) {
  return spawnSync(process.execPath, [verifier.pathname, path, digest], {
    encoding: "utf8",
  });
}

function registryEntry(publicKeyPem: string) {
  return {
    algorithm: "Ed25519",
    allowedEnvironments: ["preview", "production"],
    publicKeyPem,
    reviewerId: "independent-reviewer",
    role: "independent-reviewer",
  };
}

describe("compute image public-key registry verifier", () => {
  it("accepts only a hash-bound canonical Ed25519 public registry", async () => {
    const directory = await mkdtemp(join(tmpdir(), "3dena-image-public-keys-"));
    try {
      const { publicKey } = generateKeyPairSync("ed25519");
      const pem = String(publicKey.export({ format: "pem", type: "spki" }));
      const bytes = `${JSON.stringify({
        "independent-reviewer": registryEntry(pem),
      })}\n`;
      const path = join(directory, "build-approval-public-keys.json");
      await writeFile(path, bytes, { mode: 0o444 });

      const accepted = run(path, sha256(bytes));
      expect(accepted.status).toBe(0);
      expect(JSON.parse(accepted.stdout)).toEqual({
        schemaVersion: "3dena.image-public-key-registry-verification.v1",
        publicKeyCount: 1,
        sha256: sha256(bytes),
        verified: true,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects byte drift, non-canonical JSON, and non-Ed25519 material with a bounded error", async () => {
    const directory = await mkdtemp(join(tmpdir(), "3dena-image-public-keys-"));
    try {
      const { publicKey } = generateKeyPairSync("ed25519");
      const pem = String(publicKey.export({ format: "pem", type: "spki" }));
      const path = join(directory, "build-approval-public-keys.json");
      const canonical = `${JSON.stringify({
        "independent-reviewer": registryEntry(pem),
      })}\n`;
      await writeFile(path, canonical);

      const wrongDigest = run(path, "f".repeat(64));
      expect(wrongDigest.status).not.toBe(0);
      expect(`${wrongDigest.stdout}${wrongDigest.stderr}`.trim()).toBe(
        "PUBLIC_KEY_REGISTRY_REJECTED",
      );

      const nonCanonical = `${JSON.stringify({
        "independent-reviewer": registryEntry(pem),
      }, null, 2)}\n`;
      await writeFile(path, nonCanonical);
      const rejectedFormat = run(path, sha256(nonCanonical));
      expect(rejectedFormat.status).not.toBe(0);
      expect(`${rejectedFormat.stdout}${rejectedFormat.stderr}`).not.toContain(pem);

      const invalid = `${JSON.stringify({
        "independent-reviewer": registryEntry("not-an-ed25519-key"),
      })}\n`;
      await writeFile(path, invalid);
      const rejectedKey = run(path, sha256(invalid));
      expect(rejectedKey.status).not.toBe(0);
      expect(`${rejectedKey.stdout}${rejectedKey.stderr}`.trim()).toBe(
        "PUBLIC_KEY_REGISTRY_REJECTED",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects duplicate fields and policy metadata that cannot authorize an independent reviewer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "3dena-image-public-keys-"));
    try {
      const { publicKey } = generateKeyPairSync("ed25519");
      const pem = String(publicKey.export({ format: "pem", type: "spki" }));
      const path = join(directory, "build-approval-public-keys.json");
      const duplicateReviewer = `{"independent-reviewer":{"algorithm":"Ed25519","allowedEnvironments":["preview","production"],"publicKeyPem":${JSON.stringify(pem)},"reviewerId":"independent-reviewer","reviewerId":"substituted-reviewer","role":"independent-reviewer"}}\n`;
      await writeFile(path, duplicateReviewer);
      expect(run(path, sha256(duplicateReviewer)).status).not.toBe(0);

      const wrongRole = `${JSON.stringify({
        "independent-reviewer": {
          ...registryEntry(pem),
          role: "implementation-reviewer",
        },
      })}\n`;
      await writeFile(path, wrongRole);
      expect(run(path, sha256(wrongRole)).status).not.toBe(0);

      const duplicatedEnvironment = `${JSON.stringify({
        "independent-reviewer": {
          ...registryEntry(pem),
          allowedEnvironments: ["production", "production"],
        },
      })}\n`;
      await writeFile(path, duplicatedEnvironment);
      expect(run(path, sha256(duplicatedEnvironment)).status).not.toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a registry larger than the shared 128 KiB contract", async () => {
    const directory = await mkdtemp(join(tmpdir(), "3dena-image-public-keys-"));
    try {
      const bytes = " ".repeat(128 * 1024 + 1);
      const path = join(directory, "build-approval-public-keys.json");
      await writeFile(path, bytes);
      const rejected = run(path, sha256(bytes));
      expect(rejected.status).not.toBe(0);
      expect(`${rejected.stdout}${rejected.stderr}`.trim()).toBe(
        "PUBLIC_KEY_REGISTRY_REJECTED",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
