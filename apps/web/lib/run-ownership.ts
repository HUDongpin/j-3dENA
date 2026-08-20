import type { AnalysisMapping } from "@/lib/analysis-contract";
import type { RunOwner } from "@/lib/worker-protocol";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function createRunOwner(
  csvText: string,
  mapping: AnalysisMapping,
  runId: string,
): Promise<RunOwner> {
  const [datasetHash, specHash] = await Promise.all([
    sha256(csvText),
    sha256(stableStringify(mapping)),
  ]);
  return { datasetHash, specHash, runId };
}

export function sameRunOwner(
  active: RunOwner | null,
  candidate: RunOwner,
): boolean {
  return Boolean(
    active &&
      active.datasetHash === candidate.datasetHash &&
      active.specHash === candidate.specHash &&
      active.runId === candidate.runId,
  );
}
