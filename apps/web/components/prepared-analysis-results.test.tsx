import { useEffect } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type {
  PreparedEntityKey,
  PreparedSpaceResult,
  PreparedTypedValue,
} from "@3dena/analysis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockPlot({
      onInitialized,
    }: {
      onInitialized?: () => void;
    }) {
      useEffect(() => onInitialized?.(), [onInitialized]);
      return <div className="js-plotly-plot">Prepared plot</div>;
    },
}));

import { PreparedAnalysisResults } from "@/components/prepared-analysis-results";

const dimensions = Array.from({ length: 15 }, (_, index) => "SVD" + (index + 1));
const displayDimensions = ["SVD1", "SVD2", "SVD3"] as const;
const SYNTHETIC_PREPARED_SHA = "a".repeat(64);
const groupNames = ["G1", "G2", "G3", "G6", "G7"];
const periodNames = ["TP1", "TP2", "TP3"];

function typed(value: string, column: string): PreparedTypedValue {
  return {
    canonical: column + ":string:" + value,
    display: value,
    column,
    columnType: "character",
    value,
  };
}

function entity(group: string, speaker: string): PreparedEntityKey {
  return {
    canonical: "Group:" + group + "|Speaker:" + speaker,
    display: group + " · " + speaker,
    columns: ["Group", "Speaker"],
    columnTypes: ["character", "character"],
    values: [group, speaker],
  };
}

function makePreparedResult(): PreparedSpaceResult {
  const points = Array.from({ length: 72 }, (_, index) => {
    const groupName = groupNames[index % groupNames.length] ?? "G1";
    const periodName = periodNames[index % periodNames.length] ?? "TP1";
    const speaker = "Speaker " + (index + 1);
    const id = entity(groupName, speaker);
    return {
      index,
      id,
      participant: id,
      participantLabel: typed(speaker, "Speaker"),
      group: typed(groupName, "Group"),
      time: typed(periodName, "Period"),
      metadata: {},
      coordinates: dimensions.map((_, dimensionIndex) =>
        Number(((index + 1) * 0.001 + dimensionIndex * 0.01).toFixed(6)),
      ),
    };
  });
  const nodes = Array.from({ length: 6 }, (_, index) => ({
    index,
    code: "Code " + (index + 1),
    coordinates: dimensions.map((_, dimensionIndex) =>
      Number((index * 0.1 + dimensionIndex * 0.01).toFixed(6)),
    ),
  }));
  const edgePairs = Array.from({ length: 6 }, (_, sourceIndex) =>
    Array.from({ length: 6 }, (_, targetIndex) => [sourceIndex, targetIndex] as const),
  )
    .flat()
    .filter(([sourceIndex, targetIndex]) => sourceIndex < targetIndex);
  const edges = edgePairs.map(([sourceIndex, targetIndex], index) => ({
    index,
    id: "edge-" + sourceIndex + "-" + targetIndex,
    column: "Code " + (sourceIndex + 1) + " & Code " + (targetIndex + 1),
    source: "Code " + (sourceIndex + 1),
    target: "Code " + (targetIndex + 1),
    sourceIndex,
    targetIndex,
    meanWeight: 0.1 + index * 0.01,
  }));
  const centroids = groupNames.flatMap((groupName, groupIndex) =>
    periodNames.map((periodName, periodIndex) => {
      const index = groupIndex * periodNames.length + periodIndex;
      return {
        index,
        group: typed(groupName, "Group"),
        time: typed(periodName, "Period"),
        coordinates: [
          groupIndex * 0.2 + periodIndex * 0.03,
          groupIndex * -0.1 + periodIndex * 0.04,
          groupIndex * 0.05 + periodIndex * -0.02,
        ] as [number, number, number],
        participantCount: 5,
        participantPeriodIndexes: [index],
      };
    }),
  );

  return {
    schemaVersion: "3dena.prepared-space-result.v1",
    sourceKind: "prepared-exchange",
    rawJenaRecompute: false,
    sourceReceipt: {
      name: "synthetic-prepared.ena3d.json",
      sha256: SYNTHETIC_PREPARED_SHA,
      byteLength: 5_207,
    },
    artifacts: {
      rotation: "not-present",
      eigenvalues: "not-present",
      variance: "not-present",
    },
    fullSpace: {
      dimensions,
      points,
      nodes,
      edges,
      lineWeights: {
        rowKeys: points.map((point) => point.id),
        columns: edges.map((edge) => edge.column),
        values: points.map(() => edges.map(() => 0)),
      },
    },
    displaySpace: {
      dimensions: [...displayDimensions],
      points: points.map((point) => ({
        pointIndex: point.index,
        id: point.id,
        group: point.group,
        time: point.time,
        coordinates: point.coordinates.slice(0, 3) as [number, number, number],
      })),
      nodes: nodes.map((node) => ({
        nodeIndex: node.index,
        code: node.code,
        coordinates: node.coordinates.slice(0, 3) as [number, number, number],
      })),
      trajectory: {
        space: "prepared-exchange-display-space",
        dimensions: [...displayDimensions],
        cohortPolicy: "available",
        groupOrder: groupNames.map((group) => typed(group, "Group")),
        timeOrder: periodNames.map((period) => typed(period, "Period")),
        participantPeriods: points.map((point) => ({
          index: point.index,
          participant: point.participant,
          participantLabel: point.participantLabel,
          group: point.group,
          time: point.time,
          coordinates: point.coordinates.slice(0, 3) as [number, number, number],
          sourcePointIndexes: [point.index],
          includedInCohort: true,
        })),
        centroids,
        paths: groupNames.map((groupName, groupIndex) => ({
          group: typed(groupName, "Group"),
          steps: periodNames.map((periodName, periodIndex) => ({
            time: typed(periodName, "Period"),
            centroidIndex: groupIndex * periodNames.length + periodIndex,
          })),
        })),
      },
    },
    summary: {
      dimensions: 15,
      points: 72,
      nodes: 6,
      edges: 15,
      lineWeightRows: 72,
      groups: 5,
      timePoints: 3,
      participantPeriods: 72,
      trajectoryCentroids: 15,
    },
    diagnostics: [],
    provenance: {
      adapter: "@3dena/analysis",
      adapterVersion: "0.1.0",
      coordinateSpace: "precomputed-import",
      computation: "reduction-only",
      jenaExecuted: false,
      resolvedMapping: {
        participant: ["Group", "Speaker"],
        participantLabel: "Speaker",
        group: "Group",
        time: "Period",
        timeOrder: ["TP1", "TP2", "TP3"],
        cohortPolicy: "available",
        displayDimensions: ["SVD1", "SVD2", "SVD3"],
        missingDisplayCoordinates: "reject",
      },
    },
  };
}

describe("PreparedAnalysisResults", () => {
  beforeEach(() => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the honest generic prepared-space receipt, plot, summary, table, and exports", async () => {
    render(
      <PreparedAnalysisResults
        result={makePreparedResult()}
        owner={{
          datasetHash: "a".repeat(64),
          specHash: "b".repeat(64),
          runId: "prepared-run",
        }}
      />,
    );

    const result = screen.getByTestId("analysis-result");
    expect(result).toHaveAttribute("data-source-kind", "prepared-exchange");
    expect(result).toHaveAttribute("data-raw-recomputed", "false");
    expect(result).toHaveAttribute("data-run-id", "prepared-run");
    expect(result).toHaveAttribute(
      "data-product-status",
      "IMPLEMENTED_UNVERIFIED",
    );
    expect(result).toHaveAttribute(
      "data-prepared-evidence",
      "unverified-prepared-exchange",
    );
    expect(screen.getByText(/No raw-row jENA recomputation was performed/u)).toBeInTheDocument();
    expect(screen.getByText(/does not claim a new model fit/u)).toBeInTheDocument();
    expect(screen.getByText(/Product status: IMPLEMENTED_UNVERIFIED/u)).toBeInTheDocument();

    expect(screen.getByTestId("prepared-summary")).toHaveAttribute("data-points", "72");
    expect(screen.getByTestId("prepared-summary")).toHaveAttribute("data-nodes", "6");
    expect(screen.getByTestId("prepared-summary")).toHaveAttribute("data-edges", "15");
    expect(screen.getByTestId("prepared-summary")).toHaveAttribute("data-dimensions", "15");
    expect(screen.getByTestId("prepared-summary")).toHaveAttribute("data-groups", "5");
    expect(screen.getByTestId("prepared-summary")).toHaveAttribute("data-centroids", "15");

    expect(await screen.findByTestId("analysis-plot")).toHaveAttribute(
      "data-plotly-ready",
      "true",
    );
    expect(screen.getByTestId("analysis-plot")).toHaveAttribute(
      "data-plot-contract",
      "prepared-exchange-plot-v1",
    );
    expect(
      within(screen.getByTestId("analysis-plot")).getByText("Prepared plot"),
    ).toHaveClass("js-plotly-plot");

    expect(screen.getByRole("tab", { name: "Networks" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Trajectory" }));
    expect(screen.getByTestId("prepared-trajectory-plot")).toHaveAttribute(
      "data-render-revision",
      "1",
    );
    for (const period of periodNames) {
      expect(within(screen.getByTestId("prepared-centroid-table")).getAllByText(period).length).toBeGreaterThan(0);
    }
    expect(
      within(screen.getByTestId("prepared-centroid-table")).getAllByRole("row"),
    ).toHaveLength(16);

    expect(screen.getByTestId("prepared-export-centroids")).toBeEnabled();
    expect(screen.getByTestId("prepared-export-provenance")).toBeEnabled();
    expect(screen.getByTestId("prepared-export-bundle")).toBeEnabled();
    fireEvent.click(screen.getByRole("tab", { name: "Overall" }));
    expect(screen.getByText(/no raw-row parity or independent approval/u)).toBeInTheDocument();
    expect(screen.getByText(/jENA executed: no/u)).toBeInTheDocument();
  });

  it("keeps prepared plot choices display-only and persistent across result tabs", () => {
    const worker = vi.fn();
    vi.stubGlobal("Worker", worker);
    const result = makePreparedResult();
    const serialized = JSON.stringify(result);
    render(
      <PreparedAnalysisResults
        result={result}
        owner={{
          datasetHash: "a".repeat(64),
          specHash: "b".repeat(64),
          runId: "prepared-run",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Plot Tools" }));
    fireEvent.change(screen.getByTestId("plot-camera-preset"), {
      target: { value: "top" },
    });
    fireEvent.click(screen.getByTestId("plot-dimension-2d"));
    fireEvent.change(screen.getByTestId("plot-axis-x"), {
      target: { value: "SVD2" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Change" }));
    expect(
      screen.getByRole("heading", { name: "Imported exact level network" }),
    ).toBeVisible();
    expect(screen.getByTestId("prepared-change-status")).toHaveAttribute(
      "data-state",
      "idle",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Plot Tools" }));

    expect(screen.getByTestId("plot-dimension-2d")).toBeChecked();
    expect(screen.getByTestId("plot-axis-x")).toHaveValue("SVD2");
    expect(screen.getByTestId("plot-axis-y")).toHaveValue("SVD1");
    expect(JSON.stringify(result)).toBe(serialized);
    expect(worker).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("labels every upload as a generic prepared exchange and exposes every actual group", () => {
    const result = makePreparedResult();
    result.sourceReceipt = {
      ...result.sourceReceipt,
      name: "local-compatible.ena3d.json",
      sha256: "f".repeat(64),
    };
    render(
      <PreparedAnalysisResults
        result={result}
        owner={{
          datasetHash: "f".repeat(64),
          specHash: "b".repeat(64),
          runId: "generic-run",
        }}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "Prepared-exchange result",
      }),
    ).toBeVisible();
    expect(screen.getByTestId("analysis-result")).not.toHaveAttribute("data-governed-class1");
    expect(screen.getByTestId("analysis-result")).toHaveAttribute(
      "data-prepared-evidence",
      "unverified-prepared-exchange",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Trajectory" }));
    const allGroups = screen.getByTestId("prepared-centroid-table");
    expect(within(allGroups).getAllByRole("row")).toHaveLength(16);
    for (const group of groupNames) {
      expect(within(allGroups).getAllByText(group).length).toBeGreaterThan(0);
    }
    expect(screen.queryByTestId("prepared-g1-centroid-table")).not.toBeInTheDocument();
  });

  it("exposes the complete prepared public-statistics task controls", () => {
    const result = makePreparedResult();
    render(
      <PreparedAnalysisResults
        result={result}
        owner={{
          datasetHash: result.sourceReceipt.sha256,
          specHash: "b".repeat(64),
          runId: "prepared-statistics-controls",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Stats" }));
    expect(screen.getByTestId("prepared-statistics-design")).toHaveValue("independent");
    expect(screen.getByTestId("prepared-statistics-alternative")).toHaveValue("two-sided");
    expect(screen.getByTestId("prepared-statistics-adjustment")).toHaveValue("holm");
    expect(screen.getByTestId("prepared-statistics-run")).toBeEnabled();

    fireEvent.change(screen.getByTestId("prepared-statistics-design"), {
      target: { value: "paired" },
    });
    expect(screen.getByTestId("prepared-statistics-run")).toBeDisabled();
    expect(screen.getByText(/complete typed participant identity and time tuple/u)).toBeVisible();
    fireEvent.click(screen.getByTestId("prepared-statistics-paired-confirmation"));
    expect(screen.getByTestId("prepared-statistics-run")).toBeEnabled();

    fireEvent.change(screen.getByTestId("prepared-statistics-alternative"), {
      target: { value: "greater" },
    });
    fireEvent.change(screen.getByTestId("prepared-statistics-adjustment"), {
      target: { value: "bonferroni" },
    });
    expect(screen.getByTestId("prepared-statistics-alternative")).toHaveValue("greater");
    expect(screen.getByTestId("prepared-statistics-adjustment")).toHaveValue("bonferroni");
  });
});
