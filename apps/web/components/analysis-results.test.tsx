import { useEffect } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { AnalysisResult } from "@3dena/analysis";
import { afterEach, describe, expect, it, vi } from "vitest";

const plotSpy = vi.hoisted(() => vi.fn());

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockPlot(props: {
      onInitialized?: () => void;
      data?: unknown;
      layout?: unknown;
      config?: unknown;
    }) {
      plotSpy(props);
      const { onInitialized } = props;
      useEffect(() => onInitialized?.(), [onInitialized]);
      return <div className="js-plotly-plot">Plot</div>;
    },
}));

import { AnalysisResults } from "@/components/analysis-results";
import { SMALL_RAW_PARITY_BINDING } from "@/lib/evidence-scope";

const result = {
  schemaVersion: "3dena.analysis-result.v1",
  axes: ["SVD1", "SVD2", "SVD3"],
  points: [],
  nodes: [],
  edges: [],
  accumulation: {
    modelCounts: { rowKeys: [], columns: [], values: [] },
    rowCounts: { rowKeys: [], columns: [], values: [] },
  },
  variance: [
    { axis: "SVD1", proportion: 0.5, eigenvalue: 2, displayed: true },
    { axis: "SVD2", proportion: 0.3, eigenvalue: 1.2, displayed: true },
    { axis: "SVD3", proportion: 0.2, eigenvalue: 0.8, displayed: true },
  ],
  rotation: { rowNames: [], columnNames: [], values: [] },
  trajectory: {
    space: "analysis-result-rotation",
    cohortPolicy: "available",
    groupOrder: [],
    timeOrder: [],
    participantPeriods: [],
    centroids: [],
    paths: [],
  },
  summary: {
    inputRows: 0,
    inputColumns: 7,
    units: 0,
    points: 0,
    nodes: 0,
    edges: 0,
    modelCountRows: 0,
    rowCountRows: 0,
    groups: 0,
    timePoints: 0,
    participantPeriods: 0,
    trajectoryCentroids: 0,
  },
  diagnostics: [],
  provenance: {
    adapter: "@3dena/analysis",
    adapterVersion: "0.1.0",
    jenaVersion: "0.6.2",
    resolvedConfig: {
      model: "AccumulatedTrajectory",
      window: "MovingStanzaWindow",
      weightBy: "binary",
      windowSizeBack: 4,
      windowSizeForward: 0,
      centerAlignToOrigin: true,
    },
  },
} as unknown as AnalysisResult;

const owner = { datasetHash: "data", specHash: "spec", runId: "run" };

const governedResult = {
  ...result,
  provenance: {
    ...result.provenance,
    jenaPackage: "jena-js",
    jenaCommit: "2f63db4c6ccf5684afc8437ae81ed1a3ccd0c1a3",
    parityContract: "3dena.parity-contract.v1",
    legacyGoldenContract: "legacy-application-golden-v1",
    legacyGoldenStatus: "not-assessed",
  },
} as AnalysisResult;

describe("AnalysisResults explorer", () => {
  afterEach(() => {
    plotSpy.mockClear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fails closed for arbitrary raw results and scopes the exact governed run", () => {
    const { rerender } = render(
      <AnalysisResults
        result={result}
        datasetName="small-raw.csv"
        owner={owner}
      />,
    );

    const unverified = screen.getByTestId("analysis-result");
    expect(unverified).toHaveAttribute(
      "data-product-status",
      "IMPLEMENTED_UNVERIFIED",
    );
    expect(unverified).toHaveAttribute(
      "data-evidence-status",
      "IMPLEMENTED_UNVERIFIED",
    );
    expect(screen.getByTestId("raw-evidence-status")).toHaveTextContent(
      "It carries no parity-candidate claim",
    );

    rerender(
      <AnalysisResults
        result={governedResult}
        datasetName="renamed-governed-fixture.csv"
        buildId="test-governed-build"
        owner={{
          datasetHash: SMALL_RAW_PARITY_BINDING.datasetSha256,
          specHash: SMALL_RAW_PARITY_BINDING.specificationSha256,
          runId: "governed-run",
        }}
      />,
    );

    const candidate = screen.getByTestId("analysis-result");
    expect(candidate).toHaveAttribute(
      "data-product-status",
      "IMPLEMENTED_UNVERIFIED",
    );
    expect(candidate).toHaveAttribute(
      "data-evidence-status",
      "PARITY_CANDIDATE",
    );
    expect(candidate).toHaveAttribute(
      "data-evidence-scope",
      "3dena.small-raw-evidence-scope.v2",
    );
    expect(candidate).toHaveAttribute(
      "data-evidence-build-id",
      "test-governed-build",
    );
    expect(screen.getByTestId("raw-evidence-status")).toHaveTextContent(
      "Only this exact fixture, specification, explicit build identity",
    );
  });

  it("defaults to Networks and exposes a complete keyboard tab contract", async () => {
    render(
      <AnalysisResults
        result={result}
        datasetName="small-raw.csv"
        owner={owner}
      />,
    );

    const tabs = screen.getByRole("tablist", { name: "Analysis result sections" });
    const networks = within(tabs).getByRole("tab", { name: "Networks" });
    const comparison = within(tabs).getByRole("tab", { name: "Comparison" });
    const plotTools = within(tabs).getByRole("tab", { name: "Plot Tools" });
    expect(networks).toHaveAttribute("aria-controls", "raw-result-panel-networks");
    expect(networks).toHaveAttribute("aria-selected", "true");
    expect(networks).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "id",
      "raw-result-panel-networks",
    );
    expect(await screen.findByTestId("analysis-plot")).toHaveAttribute(
      "data-plotly-ready",
      "true",
    );

    fireEvent.keyDown(networks, { key: "ArrowRight" });
    expect(comparison).toHaveAttribute("aria-selected", "true");
    expect(comparison).toHaveAttribute("tabindex", "0");
    await waitFor(() => expect(comparison).toHaveFocus());
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "id",
      "raw-result-panel-comparison",
    );
    expect(screen.getByRole("heading", { name: "Group network comparison" })).toBeVisible();
    expect(screen.getByTestId("raw-comparison-status")).toHaveAttribute(
      "data-state",
      "idle",
    );

    fireEvent.keyDown(comparison, { key: "End" });
    expect(plotTools).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(plotTools).toHaveFocus());
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "id",
      "raw-result-panel-plot-tools",
    );
    fireEvent.keyDown(plotTools, { key: "Home" });
    expect(within(tabs).getByRole("tab", { name: "Overall" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("persists display-only plot choices across tabs without creating a Worker or mutating ownership", () => {
    const worker = vi.fn();
    vi.stubGlobal("Worker", worker);
    render(
      <AnalysisResults
        result={result}
        datasetName="small-raw.csv"
        owner={owner}
      />,
    );
    const resultElement = screen.getByTestId("analysis-result");
    const original = JSON.stringify(result);

    fireEvent.click(screen.getByRole("tab", { name: "Plot Tools" }));
    fireEvent.click(screen.getByTestId("plot-dimension-2d"));
    fireEvent.change(screen.getByTestId("plot-axis-x"), {
      target: { value: "SVD2" },
    });
    fireEvent.click(screen.getByTestId("plot-modebar-visible"));
    fireEvent.click(screen.getByRole("tab", { name: "Overall" }));
    fireEvent.click(screen.getByRole("tab", { name: "Plot Tools" }));

    expect(screen.getByTestId("plot-dimension-2d")).toBeChecked();
    expect(screen.getByTestId("plot-axis-x")).toHaveValue("SVD2");
    expect(screen.getByTestId("plot-axis-y")).toHaveValue("SVD1");
    expect(screen.getByTestId("plot-modebar-visible")).toBeChecked();
    expect(resultElement).toHaveAttribute("data-dataset-hash", "data");
    expect(resultElement).toHaveAttribute("data-spec-hash", "spec");
    expect(resultElement).toHaveAttribute("data-run-id", "run");
    expect(JSON.stringify(result)).toBe(original);
    expect(worker).not.toHaveBeenCalled();
  });

  it("keeps exact variance and trajectory tables in their owned sections", () => {
    render(
      <AnalysisResults
        result={result}
        datasetName="small-raw.csv"
        owner={owner}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Overall" }));
    const variance = screen.getByRole("region", { name: "Model variance table" });
    expect(within(variance).getAllByRole("row")).toHaveLength(4);
    expect(within(variance).getByText("0.500000")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Trajectory" }));
    expect(screen.getByRole("heading", { name: "Unit coordinates" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Group-time centroids" })).toBeVisible();
    expect(screen.getByTestId("trajectory-plot")).toBeInTheDocument();
  });

  it("reflows and requests fullscreen for the owned result without recomputation", async () => {
    const resize = vi.fn();
    window.addEventListener("resize", resize);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    render(
      <AnalysisResults
        result={result}
        datasetName="small-raw.csv"
        owner={owner}
      />,
    );
    const resultElement = screen.getByTestId("analysis-result");
    const requestFullscreen = vi.fn(async () => undefined);
    Object.defineProperty(resultElement, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });

    fireEvent.click(screen.getByRole("tab", { name: "Plot Tools" }));
    fireEvent.click(screen.getByTestId("plot-resize"));
    expect(resize).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("plot-fullscreen"));

    await waitFor(() => expect(requestFullscreen).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("tab", { name: "Networks" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    window.removeEventListener("resize", resize);
  });

  it("reflows a Plotly panel after a hidden result tab becomes visible", () => {
    const worker = vi.fn();
    const resize = vi.fn();
    vi.stubGlobal("Worker", worker);
    window.addEventListener("resize", resize);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    render(
      <AnalysisResults
        result={result}
        datasetName="small-raw.csv"
        owner={owner}
      />,
    );
    const trajectory = screen.getByTestId("trajectory-plot");
    expect(trajectory).toHaveAttribute("data-render-revision", "0");

    fireEvent.click(screen.getByRole("tab", { name: "Trajectory" }));

    expect(trajectory).toHaveAttribute("data-render-revision", "1");
    expect(resize).toHaveBeenCalledTimes(1);
    expect(worker).not.toHaveBeenCalled();
    window.removeEventListener("resize", resize);
  });

  it("rebuilds plot-tool state when a new owned run is keyed into the view", () => {
    const { rerender } = render(
      <AnalysisResults
        key="run-one"
        result={result}
        datasetName="small-raw.csv"
        owner={owner}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Plot Tools" }));
    fireEvent.click(screen.getByTestId("plot-dimension-2d"));
    expect(screen.getByTestId("plot-dimension-2d")).toBeChecked();

    rerender(
      <AnalysisResults
        key="run-two"
        result={result}
        datasetName="small-raw.csv"
        owner={{ ...owner, runId: "run-two" }}
      />,
    );
    expect(screen.getByRole("tab", { name: "Networks" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Plot Tools" }));
    expect(screen.getByTestId("plot-dimension-3d")).toBeChecked();
    expect(screen.getByTestId("plot-axis-x")).toHaveValue("SVD1");
  });
});
