import type { AnalysisResult } from "@3dena/analysis";

function safeCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/u.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replaceAll('"', '""')}"`;
}

export function analysisResultCsv(result: AnalysisResult): string {
  const rows: string[][] = [
    [
      "record_type",
      "canonical_id",
      "display_label",
      "group_key",
      "group_label",
      "time_key",
      "time_label",
      "SVD1",
      "SVD2",
      "SVD3",
      "participant_count",
    ],
  ];

  for (const point of result.points) {
    rows.push([
      "point",
      point.id.canonical,
      point.participantLabel.display,
      point.group?.canonical ?? "",
      point.group?.display ?? "",
      point.time?.canonical ?? "",
      point.time?.display ?? "",
      String(point.coordinates[0]),
      String(point.coordinates[1]),
      String(point.coordinates[2]),
      "",
    ]);
  }

  for (const centroid of result.trajectory?.centroids ?? []) {
    rows.push([
      "trajectory_centroid",
      `${centroid.group.canonical}::${centroid.time.canonical}`,
      `${centroid.group.display} · ${centroid.time.display}`,
      centroid.group.canonical,
      centroid.group.display,
      centroid.time.canonical,
      centroid.time.display,
      String(centroid.coordinates[0]),
      String(centroid.coordinates[1]),
      String(centroid.coordinates[2]),
      String(centroid.participantCount),
    ]);
  }

  return rows.map((row) => row.map(safeCell).join(",")).join("\r\n");
}

export function downloadAnalysisResult(
  result: AnalysisResult,
  fileStem: string,
): void {
  const blob = new Blob([analysisResultCsv(result)], {
    type: "text/csv;charset=utf-8",
  });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `${fileStem}-3dena-results.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}
