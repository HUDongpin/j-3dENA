import type { DerivedTaskOwner } from "@/lib/derived-analysis-protocol";
import { PRODUCT_STATUS } from "@/lib/evidence-scope";
import { safePlotFileName } from "@/lib/result-plot-tools";

export interface DerivedDownloadInput {
  mode: "raw-jena" | "prepared-exchange";
  feature: "comparison" | "change" | "statistics";
  owner: DerivedTaskOwner;
  envelope: unknown;
}

export function derivedDownloadJson(input: DerivedDownloadInput): string {
  return `${JSON.stringify({
    schemaVersion: "3dena.web-derived-download.v1",
    productStatus: PRODUCT_STATUS,
    approvedForParity: false,
    mode: input.mode,
    feature: input.feature,
    owner: input.owner,
    envelope: input.envelope,
  }, null, 2)}\n`;
}

export function downloadDerivedResult(
  input: DerivedDownloadInput,
  sourceStem: string,
): void {
  const blob = new Blob([derivedDownloadJson(input)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safePlotFileName(sourceStem)}-${input.feature}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
