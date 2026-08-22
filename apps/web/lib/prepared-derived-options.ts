import type { PreparedSpaceResult, RawScalar } from "@3dena/analysis";
import type { DerivedGroupOption } from "@/components/derived-panel-ui";

export interface PreparedChangeLevelOption {
  token: string;
  level: RawScalar;
  label: string;
}

export interface PreparedChangeFieldOption {
  field: string;
  label: string;
  levels: PreparedChangeLevelOption[];
}

export function preparedGroupOptions(
  result: PreparedSpaceResult,
): DerivedGroupOption[] {
  return result.displaySpace.trajectory.groupOrder.map((group) => ({
    canonical: group.canonical,
    label: group.display,
    value: group.value,
  }));
}

function scalarToken(value: RawScalar): string {
  if (value === null) return JSON.stringify(["null"]);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Prepared change levels must be finite.");
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new Error("Unsafe integer levels must remain source strings.");
    }
    return JSON.stringify(["number", Object.is(value, -0) ? "-0" : value]);
  }
  return JSON.stringify([typeof value, value]);
}

function scalarLabel(value: RawScalar): string {
  if (value === null) return "Missing (null)";
  if (typeof value === "string") return value === "" ? "Empty string" : value;
  if (typeof value === "boolean") return value ? "true" : "false";
  return Object.is(value, -0) ? "-0" : String(value);
}

function uniqueLevels(values: readonly RawScalar[]): PreparedChangeLevelOption[] {
  const output = new Map<string, PreparedChangeLevelOption>();
  for (const level of values) {
    const token = scalarToken(level);
    if (!output.has(token)) output.set(token, { token, level, label: scalarLabel(level) });
  }
  return [...output.values()].sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { numeric: true }),
  );
}

/**
 * Builds typed Change selectors only. Scientific reduction remains owned by
 * the public @3dena/analysis AnalysisTask executor.
 */
export function preparedChangeFieldOptions(
  result: PreparedSpaceResult,
): PreparedChangeFieldOption[] {
  const structural: PreparedChangeFieldOption[] = [
    {
      field: "@group",
      label: `Group (${result.provenance.resolvedMapping.group})`,
      levels: uniqueLevels(result.fullSpace.points.map((point) => point.group.value)),
    },
    {
      field: "@time",
      label: `Time (${result.provenance.resolvedMapping.time})`,
      levels: uniqueLevels(result.fullSpace.points.map((point) => point.time.value)),
    },
  ];
  const metadataFields = [...new Set(
    result.fullSpace.points.flatMap((point) => Object.keys(point.metadata)),
  )].sort((left, right) => left.localeCompare(right));
  return [
    ...structural,
    ...metadataFields.map((field) => ({
      field,
      label: field,
      levels: uniqueLevels(
        result.fullSpace.points.flatMap((point) =>
          Object.hasOwn(point.metadata, field) ? [point.metadata[field] ?? null] : [],
        ),
      ),
    })),
  ].filter((option) => option.levels.length > 0);
}
