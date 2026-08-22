import type {
  PreparedSpaceMapping,
  PreparedSpaceResult,
  PreparedTypedValue,
} from "@3dena/analysis";
import type {
  Ena3dExchangeColumn,
  Ena3dExchangeTable,
  ValidatedEna3dExchangeV1,
} from "@3dena/io";
import type { PreparedClass1PlotCandidateInput } from "@/lib/prepared-class1-plot-candidate";

export const PREPARED_EXCHANGE_MAPPING: PreparedSpaceMapping = {
  participant: ["Group", "Speaker"],
  participantLabel: "Speaker",
  group: "Group",
  time: "Period",
  timeOrder: ["TP1", "TP2", "TP3"],
  cohortPolicy: "available",
  displayDimensions: ["SVD1", "SVD2", "SVD3"],
  missingDisplayCoordinates: "reject",
};

export interface PreparedDatasetSummary {
  points: number;
  nodes: number;
  edges: number;
  dimensions: number;
  groups: number;
  periods: string[];
}

export interface PreparedDatasetReceipt extends PreparedDatasetSummary {
  sha256: string;
  byteLength: number;
}

function column(
  table: Ena3dExchangeTable,
  name: string,
): Ena3dExchangeColumn {
  const match = table.columns.find((candidate) => candidate.name === name);
  if (!match) {
    throw new Error(`The prepared exchange is missing required column “${name}”.`);
  }
  return match;
}

function scalarKey(value: unknown): string {
  return `${typeof value}:${JSON.stringify(value)}`;
}

/** Product-level prepared-exchange checks performed after strict decoding. */
export function inspectPreparedExchange(
  exchange: ValidatedEna3dExchangeV1,
): PreparedDatasetSummary {
  const metadata = exchange.tables.meta_data;
  for (const name of [
    ...PREPARED_EXCHANGE_MAPPING.participant,
    PREPARED_EXCHANGE_MAPPING.participantLabel,
    PREPARED_EXCHANGE_MAPPING.group,
    PREPARED_EXCHANGE_MAPPING.time,
  ]) {
    column(metadata, name);
  }
  for (const dimension of PREPARED_EXCHANGE_MAPPING.displayDimensions) {
    if (!exchange.dimensions.includes(dimension)) {
      throw new Error(
        `The prepared exchange is missing display dimension “${dimension}”.`,
      );
    }
  }

  const periodValues = column(
    metadata,
    PREPARED_EXCHANGE_MAPPING.time,
  ).values;
  const observedPeriods = new Set(
    periodValues.map((value) => (value === null ? "" : String(value))),
  );
  const expectedPeriods = PREPARED_EXCHANGE_MAPPING.timeOrder.map(String);
  const unexpected = [...observedPeriods].filter(
    (value) => !expectedPeriods.includes(value),
  );
  const missing = expectedPeriods.filter((value) => !observedPeriods.has(value));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      "The prepared exchange contract requires exactly the configured ordered periods TP1, TP2, and TP3.",
    );
  }

  const groupValues = column(
    metadata,
    PREPARED_EXCHANGE_MAPPING.group,
  ).values;
  return {
    points: exchange.tables.points.columns[0]?.values.length ?? 0,
    nodes: exchange.tables.nodes.columns[0]?.values.length ?? 0,
    edges: exchange.tables.adjacency_key.columns.length,
    dimensions: exchange.dimensions.length,
    groups: new Set(groupValues.map(scalarKey)).size,
    periods: expectedPeriods,
  };
}

const PERIOD_COLORS = new Map([
  ["TP1", "#b91c1c"],
  ["TP2", "#1d4ed8"],
  ["TP3", "#15803d"],
]);

const GROUP_COLORS = new Map([
  ["G1", "#2f2f2f"],
  ["G2", "#7c3aed"],
  ["G3", "#0369a1"],
  ["G6", "#a16207"],
  ["G7", "#9f1239"],
]);

function typedColor(
  value: PreparedTypedValue,
  colors: ReadonlyMap<string, string>,
  fallback: string,
): string {
  return colors.get(String(value.value)) ?? fallback;
}

export function preparedExchangePlotInput(
  result: PreparedSpaceResult,
): PreparedClass1PlotCandidateInput {
  const fullPointByIndex = new Map(
    result.fullSpace.points.map((point) => [point.index, point]),
  );
  const centroidByIndex = new Map(
    result.displaySpace.trajectory.centroids.map((centroid) => [
      centroid.index,
      centroid,
    ]),
  );
  const timeOrderByCanonical = new Map(
    result.displaySpace.trajectory.timeOrder.map((time, index) => [
      time.canonical,
      index + 1,
    ]),
  );

  return {
    unitPoints: result.displaySpace.points.map((point) => {
      const fullPoint = fullPointByIndex.get(point.pointIndex);
      if (!fullPoint) {
        throw new Error(
          `Prepared display point ${point.pointIndex} has no full-space source.`,
        );
      }
      return {
        key: point.id.canonical,
        label: fullPoint.participantLabel.display,
        periodLabel: point.time.display,
        coordinates: point.coordinates,
        color: typedColor(point.time, PERIOD_COLORS, "#475569"),
      };
    }),
    codeNodes: result.displaySpace.nodes.map((node) => ({
      key: node.code,
      label: node.code,
      coordinates: node.coordinates,
    })),
    paths: result.displaySpace.trajectory.paths.map((path) => ({
      key: path.group.canonical,
      label: path.group.display,
      color: typedColor(path.group, GROUP_COLORS, "#475569"),
      steps: path.steps.map((step) => {
        const centroid =
          step.centroidIndex === null
            ? undefined
            : centroidByIndex.get(step.centroidIndex);
        return {
          periodKey: step.time.canonical,
          periodLabel: step.time.display,
          timeOrder:
            timeOrderByCanonical.get(step.time.canonical) ??
            Number.POSITIVE_INFINITY,
          coordinates: centroid?.coordinates ?? null,
          ...(centroid
            ? { participantCount: centroid.participantCount }
            : {}),
          markerColor: typedColor(step.time, PERIOD_COLORS, "#475569"),
        };
      }),
    })),
  };
}

export function isNativeSerializedFileName(name: string): boolean {
  return /\.(?:rdata|rda|rds)$/iu.test(name);
}

export function isPreparedExchangeFileName(name: string): boolean {
  return name.toLowerCase().endsWith(".ena3d.json");
}
