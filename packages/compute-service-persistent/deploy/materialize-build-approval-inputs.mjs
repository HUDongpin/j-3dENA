#!/usr/bin/env node
import {
  BUILD_APPROVAL_ARTIFACT_BOUNDS_V1,
  prepareBuildApprovalInputs,
  readBuildApprovalSourceFile,
  writePreparedBuildApprovalOutput,
} from "./build-approval-inputs-lib.mjs";
import { parseStrictJson } from "./strict-json.mjs";

const [inputPath, outputDirectory] = process.argv.slice(2);
if (!inputPath || !outputDirectory) {
  throw new Error(
    "usage: materialize-build-approval-inputs.mjs <explicit-source-input.json> <new-output-directory>",
  );
}

const sourceRoot = process.cwd();
const input = parseStrictJson(await readBuildApprovalSourceFile(
  sourceRoot,
  inputPath,
  "materialization input",
  BUILD_APPROVAL_ARTIFACT_BOUNDS_V1.materializationInput,
  "4 MiB materialization input limit",
));
const prepared = await prepareBuildApprovalInputs(input, outputDirectory, sourceRoot);
await writePreparedBuildApprovalOutput(prepared, sourceRoot);
process.stdout.write(`${JSON.stringify({
  schemaVersion: prepared.manifest.schemaVersion,
  outputs: prepared.manifest.outputs,
  signed: false,
  activated: false,
})}\n`);
