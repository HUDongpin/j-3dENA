import { resolve } from "node:path";

import {
  loadComputeRuntimeConfiguration,
  verifyComputeRuntimeArtifactHashes,
} from "./runtime-config";
import { runApiRuntime, runWorkerRuntime } from "./runtime-support";

const role = process.argv[2];
if (role !== "api" && role !== "worker") {
  throw new TypeError("Compute runtime requires exactly one api or worker role.");
}

const controller = new AbortController();
let signalCount = 0;
const terminate = (): void => {
  signalCount += 1;
  controller.abort();
  if (signalCount > 1) process.exitCode = 1;
};
process.once("SIGTERM", terminate);
process.once("SIGINT", terminate);

try {
  const config = await loadComputeRuntimeConfiguration(role);
  const runtimePath = resolve(process.argv[1] ?? "/app/compute-runtime.mjs");
  if (!(await verifyComputeRuntimeArtifactHashes(
    config.manifest,
    runtimePath,
    config.workerEntryPath,
  ))) {
    throw new TypeError("Runtime artifact hash verification failed.");
  }
  if (role === "api") await runApiRuntime(config, controller.signal);
  else await runWorkerRuntime(config, controller.signal);
} finally {
  process.removeListener("SIGTERM", terminate);
  process.removeListener("SIGINT", terminate);
}
