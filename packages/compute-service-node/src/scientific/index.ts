import { realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { scientificWorkerError } from "./errors";

export * from "./contracts";
export { ScientificComputeWorkerError } from "./errors";
export type { ScientificComputeWorkerErrorCode } from "./errors";
export { FileSystemImmutableResultStore } from "./file-result-store";
export { JsonObjectStoreScientificInputProvider } from "./input-provider";
export { ScientificWorkerSessionAdapter } from "./session-adapter";

/** Resolves the audited bundle produced by `npm run build:worker`. */
export function resolveScientificWorkerEntry(): string {
  const candidate = fileURLToPath(
    new URL("../../dist/scientific-worker-entry.mjs", import.meta.url),
  );
  try {
    const canonical = realpathSync(candidate);
    if (!statSync(canonical).isFile()) {
      scientificWorkerError("INVALID_CONFIGURATION");
    }
    return canonical;
  } catch {
    scientificWorkerError("INVALID_CONFIGURATION");
  }
}
