#!/usr/bin/env node
import { createHash } from "node:crypto";

import {
  BUILD_APPROVAL_ARTIFACT_BOUNDS_V1,
  readBuildApprovalSourceFile,
  verifyBuildApprovalInputs,
} from "./build-approval-inputs-lib.mjs";
import { parseStrictJson } from "./strict-json.mjs";

const [manifestPath] = process.argv.slice(2);
if (!manifestPath) {
  throw new Error(
    "usage: verify-build-approval-inputs.mjs <build-approval-materialization-manifest.json>",
  );
}

const sourceRoot = process.cwd();
const manifestBytes = await readBuildApprovalSourceFile(
  sourceRoot,
  manifestPath,
  "materialization manifest",
  BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.materializationManifest,
  "4 MiB materialization manifest limit",
);
const manifestText = manifestBytes.toString("utf8");
const manifest = parseStrictJson(manifestText);
const outputs = await verifyBuildApprovalInputs(
  manifest,
  manifestText,
  manifestPath,
  sourceRoot,
);
process.stdout.write(`${JSON.stringify({
  schemaVersion: manifest.schemaVersion,
  outputs,
  materializationManifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
  verified: true,
  signed: false,
  activated: false,
})}\n`);
