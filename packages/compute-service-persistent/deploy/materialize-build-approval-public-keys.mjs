#!/usr/bin/env node
import {
  BUILD_APPROVAL_ARTIFACT_BOUNDS_V1,
  prepareBuildApprovalPublicKeys,
  readBuildApprovalSourceFile,
  writePreparedBuildApprovalOutput,
} from "./build-approval-inputs-lib.mjs";
import { parseStrictJson } from "./strict-json.mjs";

const [inputPath, outputDirectory] = process.argv.slice(2);
if (!inputPath || !outputDirectory) {
  throw new Error(
    "usage: materialize-build-approval-public-keys.mjs <explicit-public-keys-input.json> <new-output-directory>",
  );
}

const sourceRoot = process.cwd();
const input = parseStrictJson(await readBuildApprovalSourceFile(
  sourceRoot,
  inputPath,
  "public-key materialization input",
  BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.materializationInput,
  "4 MiB public-key materialization input limit",
));
const prepared = await prepareBuildApprovalPublicKeys(input, outputDirectory, sourceRoot);
await writePreparedBuildApprovalOutput(prepared, sourceRoot);
process.stdout.write(`${JSON.stringify({
  schemaVersion: prepared.manifest.schemaVersion,
  outputs: prepared.manifest.outputs,
  signed: false,
  activated: false,
})}\n`);
