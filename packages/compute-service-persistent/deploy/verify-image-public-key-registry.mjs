import { createHash, createPublicKey } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open } from "node:fs/promises";

import { parseStrictJson } from "./strict-json.mjs";

const SHA256 = /^[a-f0-9]{64}$/u;
const PUBLIC_KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const MAX_PUBLIC_KEY_REGISTRY_BYTES = 128 * 1024;
const PUBLIC_KEY_ENTRY_KEYS = [
  "algorithm",
  "allowedEnvironments",
  "publicKeyPem",
  "reviewerId",
  "role",
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("invalid number");
    return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!isRecord(value)) throw new TypeError("invalid JSON value");
  return `{${Object.keys(value).sort().map((key) => {
    if (value[key] === undefined) throw new TypeError("undefined value");
    return `${JSON.stringify(key)}:${canonical(value[key])}`;
  }).join(",")}}`;
}

function exact(value, keys) {
  return isRecord(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function validAllowedEnvironments(value) {
  return Array.isArray(value) && value.length > 0 &&
    value.every((environment) =>
      environment === "preview" || environment === "production") &&
    new Set(value).size === value.length &&
    [...value].sort().every((environment, index) => environment === value[index]);
}

async function securelyReadRegistry(registryPath) {
  const pathInformation = await lstat(registryPath, { bigint: true });
  if (!pathInformation.isFile() || pathInformation.isSymbolicLink() ||
      pathInformation.size < 3n ||
      pathInformation.size > BigInt(MAX_PUBLIC_KEY_REGISTRY_BYTES)) {
    throw new TypeError("registry file is not a bounded regular file");
  }
  const handle = await open(registryPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.dev !== pathInformation.dev ||
        before.ino !== pathInformation.ino || before.size !== pathInformation.size) {
      throw new TypeError("registry file changed during secure open");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const current = await lstat(registryPath, { bigint: true });
    if (!current.isFile() || current.isSymbolicLink() ||
        current.dev !== before.dev || current.ino !== before.ino ||
        after.dev !== before.dev || after.ino !== before.ino ||
        after.size !== before.size || after.mtimeNs !== before.mtimeNs ||
        after.ctimeNs !== before.ctimeNs || BigInt(bytes.byteLength) !== before.size) {
      throw new TypeError("registry file changed during secure read");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function verify() {
  const [, , registryPath, expectedSha256] = process.argv;
  if (typeof registryPath !== "string" || !SHA256.test(expectedSha256 ?? "")) {
    throw new TypeError("invalid arguments");
  }
  const bytes = await securelyReadRegistry(registryPath);
  const observedSha256 = createHash("sha256").update(bytes).digest("hex");
  if (observedSha256 !== expectedSha256) throw new TypeError("digest mismatch");

  const text = bytes.toString("utf8");
  const registry = parseStrictJson(text);
  if (!isRecord(registry) || Object.keys(registry).length < 1 ||
      text !== `${canonical(registry)}\n`) {
    throw new TypeError("non-canonical registry");
  }

  for (const [publicKeyId, entry] of Object.entries(registry)) {
    if (!PUBLIC_KEY_ID.test(publicKeyId) || !exact(entry, PUBLIC_KEY_ENTRY_KEYS) ||
        entry.algorithm !== "Ed25519" ||
        !validAllowedEnvironments(entry.allowedEnvironments) ||
        typeof entry.publicKeyPem !== "string" || /PRIVATE KEY/iu.test(entry.publicKeyPem) ||
        typeof entry.reviewerId !== "string" || !PUBLIC_KEY_ID.test(entry.reviewerId) ||
        entry.role !== "independent-reviewer") {
      throw new TypeError("invalid public key entry");
    }
    const key = createPublicKey(entry.publicKeyPem);
    const canonicalPem = String(key.export({ format: "pem", type: "spki" }));
    if (key.asymmetricKeyType !== "ed25519" || canonicalPem !== entry.publicKeyPem) {
      throw new TypeError("invalid Ed25519 key");
    }
  }

  process.stdout.write(`${JSON.stringify({
    schemaVersion: "3dena.image-public-key-registry-verification.v1",
    publicKeyCount: Object.keys(registry).length,
    sha256: observedSha256,
    verified: true,
  })}\n`);
}

try {
  await verify();
} catch {
  process.stderr.write("PUBLIC_KEY_REGISTRY_REJECTED\n");
  process.exitCode = 1;
}
