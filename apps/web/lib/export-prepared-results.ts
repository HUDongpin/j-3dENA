import type { PreparedSpaceResult } from "@3dena/analysis";
import {
  createDeterministicZip,
  encodeCsvText,
  encodeCsvUtf8,
  type CsvTable,
} from "@3dena/export";
import type { RunOwner } from "@/lib/worker-protocol";

export const PREPARED_EXPORT_BUNDLE_PATHS = {
  centroids: "data/prepared-centroids.csv",
  provenance: "provenance/prepared-provenance.json",
} as const;

function preparedCentroidTable(result: PreparedSpaceResult): CsvTable {
  return {
    columns: [
      "group_key",
      "group_label",
      "time_key",
      "time_label",
      "participant_count",
      ...result.displaySpace.dimensions,
    ],
    rows: result.displaySpace.trajectory.centroids.map((centroid) => [
      centroid.group.canonical,
      centroid.group.display,
      centroid.time.canonical,
      centroid.time.display,
      centroid.participantCount,
      ...centroid.coordinates,
    ]),
  };
}

export function preparedCentroidCsv(result: PreparedSpaceResult): string {
  return encodeCsvText(preparedCentroidTable(result));
}

export function preparedProvenanceJson(
  result: PreparedSpaceResult,
  owner: RunOwner,
): string {
  return JSON.stringify(
    {
      schemaVersion: "3dena.prepared-export-provenance.v1",
      resultSchemaVersion: result.schemaVersion,
      sourceKind: result.sourceKind,
      rawJenaRecompute: result.rawJenaRecompute,
      sourceReceipt: result.sourceReceipt,
      ownership: owner,
      mapping: result.provenance.resolvedMapping,
      artifacts: result.artifacts,
      analysisProvenance: result.provenance,
      summary: result.summary,
      claimBoundary:
        "User-provided imported shared space; jENA was not executed and no raw-row parity or independent approval is claimed.",
    },
    null,
    2,
  );
}

export function preparedResultBundle(
  result: PreparedSpaceResult,
  owner: RunOwner,
): Uint8Array<ArrayBuffer> {
  const localBytes = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
    Uint8Array.from(bytes);
  const provenanceBytes = localBytes(
    new TextEncoder().encode(preparedProvenanceJson(result, owner)),
  );
  return createDeterministicZip([
    {
      path: PREPARED_EXPORT_BUNDLE_PATHS.centroids,
      data: localBytes(encodeCsvUtf8(preparedCentroidTable(result))),
    },
    {
      path: PREPARED_EXPORT_BUNDLE_PATHS.provenance,
      data: provenanceBytes,
    },
  ]);
}

function downloadText(
  contents: string,
  mediaType: string,
  fileName: string,
): void {
  const href = URL.createObjectURL(new Blob([contents], { type: mediaType }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

function downloadBytes(
  contents: Uint8Array<ArrayBuffer>,
  mediaType: string,
  fileName: string,
): void {
  const href = URL.createObjectURL(new Blob([contents], { type: mediaType }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

export function downloadPreparedCentroids(
  result: PreparedSpaceResult,
  fileStem: string,
): void {
  downloadText(
    preparedCentroidCsv(result),
    "text/csv;charset=utf-8",
    fileStem + "-prepared-centroids.csv",
  );
}

export function downloadPreparedProvenance(
  result: PreparedSpaceResult,
  owner: RunOwner,
  fileStem: string,
): void {
  downloadText(
    preparedProvenanceJson(result, owner),
    "application/json;charset=utf-8",
    fileStem + "-prepared-provenance.json",
  );
}

export function downloadPreparedBundle(
  result: PreparedSpaceResult,
  owner: RunOwner,
  fileStem: string,
): void {
  downloadBytes(
    preparedResultBundle(result, owner),
    "application/zip",
    fileStem + "-prepared-result.zip",
  );
}
