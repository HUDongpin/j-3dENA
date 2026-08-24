import type { AnalysisResult, TypedValue } from "@3dena/analysis";
import type { DerivedGroupOption } from "@/components/derived-panel-ui";

export interface RawChangeLevelOption {
  value: string;
  label: string;
}

export interface RawChangeFieldOption {
  field: string;
  label: string;
  levels: RawChangeLevelOption[];
}

export function rawGroupOptions(result: AnalysisResult): DerivedGroupOption[] {
  const groups = new Map<string, TypedValue>();
  for (const group of result.trajectory?.groupOrder ?? []) {
    groups.set(group.canonical, group);
  }
  for (const point of result.points) {
    if (point.group && !groups.has(point.group.canonical)) {
      groups.set(point.group.canonical, point.group);
    }
  }
  return [...groups.values()].map((group) => ({
    canonical: group.canonical,
    label: group.display,
    value: group.value,
  }));
}

export function rawChangeFieldOptions(result: AnalysisResult): RawChangeFieldOption[] {
  const output: RawChangeFieldOption[] = [];
  const groupLevels = new Map<string, string>();
  for (const point of result.points) {
    if (typeof point.group?.value === "string") {
      groupLevels.set(point.group.value, point.group.display);
    }
  }
  if (groupLevels.size > 0) {
    output.push({
      field: "@group",
      label: "Analysis group",
      levels: [...groupLevels].map(([value, label]) => ({ value, label })),
    });
  }
  const fields = [...new Set(result.points.flatMap((point) => Object.keys(point.metadata)))];
  for (const field of fields.sort((left, right) => left.localeCompare(right))) {
    const levels = new Set<string>();
    for (const point of result.points) {
      const value = point.metadata[field];
      if (typeof value === "string") levels.add(value);
    }
    if (levels.size > 0) {
      output.push({
        field,
        label: field,
        levels: [...levels]
          .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
          .map((value) => ({ value, label: value === "" ? "Empty string" : value })),
      });
    }
  }
  return output;
}
