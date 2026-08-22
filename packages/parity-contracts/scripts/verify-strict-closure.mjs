import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function importTypeScriptSource(relativePath) {
  const absolutePath = resolve(packageDirectory, relativePath);
  const source = await readFile(absolutePath, "utf8");
  const output = ts.transpileModule(source, {
    fileName: absolutePath,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

async function readJson(path) {
  const bytes = await readFile(path);
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    value: JSON.parse(bytes.toString("utf8")),
  };
}

const scientificPath = resolve(process.argv[2] ?? resolve(packageDirectory, "scientific-authority.matrix.v1.json"));
const capabilityPath = resolve(process.argv[3] ?? resolve(packageDirectory, "strict-capability-ledger.v1.json"));
const scientific = await importTypeScriptSource("src/scientific-authority.ts");
const capability = await importTypeScriptSource("src/strict-capability-ledger.ts");

const checks = [];
for (const [name, path, validate, requireApproved] of [
  ["scientific-authority", scientificPath, scientific.validateScientificAuthorityMatrixV1, scientific.requireApprovedScientificAuthorityV1],
  ["strict-capability-ledger", capabilityPath, capability.validateStrictCapabilityLedgerV1, capability.requireVerifiedParityCapabilityLedgerV1],
]) {
  try {
    const input = await readJson(path);
    const validation = validate(input.value);
    let approved = false;
    try {
      requireApproved(input.value);
      approved = true;
    } catch {
      approved = false;
    }
    checks.push({
      name,
      path: pathToFileURL(path).href,
      inputSha256: input.sha256,
      approved,
      validation,
    });
  } catch (error) {
    checks.push({
      name,
      path: pathToFileURL(path).href,
      approved: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const passed = checks.every((check) => check.approved === true);
console.log(JSON.stringify({
  schemaVersion: "3dena.strict-closure-gate-receipt.v1",
  passed,
  checks,
}, null, 2));
if (!passed) process.exitCode = 1;
