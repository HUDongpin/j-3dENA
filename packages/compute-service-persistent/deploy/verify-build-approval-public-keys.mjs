#!/usr/bin/env node
import {
  BUILD_APPROVAL_ARTIFACT_BOUNDS_V1,
  readBuildApprovalSourceFile,
  verifyBuildApprovalPublicKeys,
} from "./build-approval-inputs-lib.mjs";
import { parseStrictJson } from "./strict-json.mjs";

const [manifestPath] = process.argv.slice(2);
if (!manifestPath) {
  throw new Error(
    "usage: verify-build-approval-public-keys.mjs <build-approval-public-keys-manifest.json>",
  );
}

const sourceRoot = process.cwd();
const manifestText = (await readBuildApprovalSourceFile(
  sourceRoot,
  manifestPath,
  "public-key materialization manifest",
  BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.materializationManifest,
  "4 MiB public-key materialization manifest limit",
)).toString("utf8");
const manifest = parseStrictJson(manifestText);
const outputs = await verifyBuildApprovalPublicKeys(
  manifest,
  manifestText,
  manifestPath,
  sourceRoot,
);
process.stdout.write(`${JSON.stringify({
  schemaVersion: manifest.schemaVersion,
  outputs,
  verified: true,
  signed: false,
  activated: false,
})}\n`);
