import { fireEvent, render, screen } from "@testing-library/react";
import type { AnalysisResult } from "@3dena/analysis";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockPlot() {
      return <div className="js-plotly-plot">Plot</div>;
    },
}));

import { AnalysisResults } from "@/components/analysis-results";

const result = {
  axes: ["SVD1", "SVD2", "SVD3"],
  points: [],
  nodes: [],
  edges: [],
  trajectory: { centroids: [], paths: [] },
  summary: {
    inputRows: 0,
    units: 0,
    nodes: 0,
    edges: 0,
    groups: 0,
    trajectoryCentroids: 0,
  },
  diagnostics: [],
  provenance: {
    adapter: "@3dena/analysis",
    adapterVersion: "0.1.0",
    jenaVersion: "0.6.2",
  },
} as unknown as AnalysisResult;

describe("AnalysisResults tabs", () => {
  it("connects tabs to panels and supports arrow-key navigation", () => {
    render(
      <AnalysisResults
        result={result}
        datasetName="small-raw.csv"
        owner={{ datasetHash: "data", specHash: "spec", runId: "run" }}
      />,
    );

    const tab3d = screen.getByRole("tab", { name: "3D" });
    const tab2d = screen.getByRole("tab", { name: "2D" });
    const tableTab = screen.getByRole("tab", { name: "Table" });
    expect(tab3d).toHaveAttribute("aria-controls", "result-panel-3d");
    expect(tab3d).toHaveAttribute("tabindex", "0");
    expect(tab2d).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", "result-panel-3d");

    fireEvent.keyDown(tab3d, { key: "ArrowRight" });
    expect(tab2d).toHaveAttribute("aria-selected", "true");
    expect(tab2d).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", "result-panel-2d");

    fireEvent.keyDown(tab2d, { key: "End" });
    expect(tableTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", "result-panel-table");
    expect(screen.getByRole("heading", { name: "Unit coordinates" })).toBeInTheDocument();
  });
});
