"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import dynamic from "next/dynamic";
import type { AnalysisResult, Coordinates3D } from "@3dena/analysis";
import type { Config, Data, Layout } from "plotly.js";
import { Box, Download, List, Table2 } from "lucide-react";
import type { RunOwner } from "@/lib/worker-protocol";
import { downloadAnalysisResult } from "@/lib/export-results";
import {
  axisTraces3d,
  groupColor,
  trajectoryTraces,
} from "@/lib/plot-traces";

const Plot = dynamic(
  async () => {
    const [{ default: createPlotlyComponent }, { default: Plotly }] =
      await Promise.all([
        import("react-plotly.js/factory"),
        import("plotly.js-dist-min"),
      ]);
    return createPlotlyComponent(Plotly);
  },
  {
    ssr: false,
    loading: () => (
      <div className="plot-loading" role="status">
        Loading the interactive plot…
      </div>
    ),
  },
);

type ResultView = "3d" | "2d" | "table";

function axisExtent(result: AnalysisResult): number {
  const magnitudes = [
    ...result.points.flatMap((point) => point.coordinates.map(Math.abs)),
    ...result.nodes.flatMap((node) => node.coordinates.map(Math.abs)),
    ...(result.trajectory?.centroids.flatMap((centroid) =>
      centroid.coordinates.map(Math.abs),
    ) ?? []),
  ];
  return Math.max(0.5, ...magnitudes) * 1.15;
}

function pointTraces(result: AnalysisResult, dimensions: 2 | 3): Data[] {
  const groups = new Map<
    string,
    { label: string; coordinates: Coordinates3D[]; hover: string[] }
  >();
  for (const point of result.points) {
    const canonical = point.group?.canonical ?? "ungrouped";
    const current = groups.get(canonical) ?? {
      label: point.group?.display ?? "Ungrouped",
      coordinates: [],
      hover: [],
    };
    current.coordinates.push(point.coordinates);
    current.hover.push(
      [
        `<b>${point.participantLabel.display}</b>`,
        point.group ? `Group: ${point.group.display}` : "",
        point.time ? `Time: ${point.time.display}` : "",
        `Unit key: ${point.unit.canonical}`,
      ]
        .filter(Boolean)
        .join("<br>"),
    );
    groups.set(canonical, current);
  }

  return Array.from(groups, ([canonical, group]) => ({
    type: dimensions === 3 ? "scatter3d" : "scatter",
    mode: "markers",
    name: `${group.label} units`,
    x: group.coordinates.map((coordinates) => coordinates[0]),
    y: group.coordinates.map((coordinates) => coordinates[1]),
    ...(dimensions === 3
      ? { z: group.coordinates.map((coordinates) => coordinates[2]) }
      : {}),
    text: group.hover,
    hovertemplate: "%{text}<extra></extra>",
    marker: {
      color: groupColor(canonical),
      size: dimensions === 3 ? 5 : 8,
      opacity: 0.45,
      symbol: "circle-open",
    },
  } as Data));
}

function networkTraces(result: AnalysisResult, dimensions: 2 | 3): Data[] {
  const nodesByIndex = new Map(result.nodes.map((node) => [node.index, node]));
  const edges: Data[] = [];
  for (const edge of result.edges) {
    const source = nodesByIndex.get(edge.sourceIndex);
    const target = nodesByIndex.get(edge.targetIndex);
    if (!source || !target || edge.meanWeight <= 0) {
      continue;
    }
    edges.push({
      type: dimensions === 3 ? "scatter3d" : "scatter",
      mode: "lines",
      x: [source.coordinates[0], target.coordinates[0]],
      y: [source.coordinates[1], target.coordinates[1]],
      ...(dimensions === 3
        ? { z: [source.coordinates[2], target.coordinates[2]] }
        : {}),
      line: {
        color: "rgba(30, 58, 95, 0.38)",
        width: Math.max(1, Math.min(8, edge.meanWeight * 8)),
      },
      hoverinfo: "skip",
      showlegend: false,
    } as Data);
  }

  const nodes: Data = {
    type: dimensions === 3 ? "scatter3d" : "scatter",
    mode: "text+markers",
    name: "Codes",
    x: result.nodes.map((node) => node.coordinates[0]),
    y: result.nodes.map((node) => node.coordinates[1]),
    ...(dimensions === 3
      ? { z: result.nodes.map((node) => node.coordinates[2]) }
      : {}),
    text: result.nodes.map((node) => node.code),
    textposition: "top center",
    hovertemplate: "Code: %{text}<extra></extra>",
    marker: {
      color: "#ffffff",
      line: { color: "#1e3a5f", width: 2 },
      size: dimensions === 3 ? 7 : 12,
    },
  } as Data;
  return [...edges, nodes];
}

function plotData(result: AnalysisResult, dimensions: 2 | 3): Data[] {
  const extent = axisExtent(result);
  return [
    ...networkTraces(result, dimensions),
    ...pointTraces(result, dimensions),
    ...trajectoryTraces(result, dimensions, extent),
    ...(dimensions === 3 ? axisTraces3d(extent) : []),
  ];
}

function plotLayout(result: AnalysisResult, dimensions: 2 | 3): Partial<Layout> {
  const common: Partial<Layout> = {
    autosize: true,
    margin: { l: 56, r: 24, t: 30, b: 56 },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#f8fafc",
    font: { family: "Atkinson Hyperlegible, system-ui, sans-serif", color: "#334155" },
    legend: { orientation: "h", y: -0.16 },
    hoverlabel: { bgcolor: "#0f172a", font: { color: "#ffffff" } },
  };
  if (dimensions === 3) {
    return {
      ...common,
      scene: {
        xaxis: { title: { text: result.axes[0] }, color: "#b91c1c", gridcolor: "#e2e8f0" },
        yaxis: { title: { text: result.axes[1] }, color: "#1d4ed8", gridcolor: "#e2e8f0" },
        zaxis: { title: { text: result.axes[2] }, color: "#15803d", gridcolor: "#e2e8f0" },
        bgcolor: "#f8fafc",
        aspectmode: "cube",
      },
    };
  }
  return {
    ...common,
    xaxis: { title: { text: result.axes[0] }, color: "#b91c1c", gridcolor: "#e2e8f0" },
    yaxis: { title: { text: result.axes[1] }, color: "#1d4ed8", gridcolor: "#e2e8f0" },
  };
}

const plotConfig: Partial<Config> = {
  responsive: true,
  displaylogo: false,
  scrollZoom: true,
  modeBarButtonsToRemove: ["sendDataToCloud", "lasso2d", "select2d"],
  toImageButtonOptions: { format: "png", filename: "3dena-shared-space" },
};

interface AnalysisResultsProps {
  result: AnalysisResult;
  owner: RunOwner;
  datasetName: string;
}

export function AnalysisResults({ result, owner, datasetName }: AnalysisResultsProps) {
  const [view, setView] = useState<ResultView>("3d");
  const [plotlyReady, setPlotlyReady] = useState(false);
  const data3d = useMemo(() => plotData(result, 3), [result]);
  const data2d = useMemo(() => plotData(result, 2), [result]);

  function selectView(nextView: ResultView): void {
    setPlotlyReady(false);
    setView(nextView);
  }

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentView: ResultView,
  ): void {
    const order: ResultView[] = ["3d", "2d", "table"];
    const currentIndex = order.indexOf(currentView);
    let nextView: ResultView | undefined;
    if (event.key === "ArrowRight") {
      nextView = order[(currentIndex + 1) % order.length];
    } else if (event.key === "ArrowLeft") {
      nextView = order[(currentIndex - 1 + order.length) % order.length];
    } else if (event.key === "Home") {
      nextView = order[0];
    } else if (event.key === "End") {
      nextView = order.at(-1);
    }
    if (!nextView) return;
    event.preventDefault();
    selectView(nextView);
    requestAnimationFrame(() => {
      document.getElementById(`result-tab-${nextView}`)?.focus();
    });
  }

  return (
    <section
      className="analysis-results"
      data-testid="analysis-result"
      data-dataset-hash={owner.datasetHash}
      data-spec-hash={owner.specHash}
      data-run-id={owner.runId}
      aria-labelledby="results-title"
    >
      <header className="results-heading">
        <div>
          <p className="eyebrow">Computed result</p>
          <h2 id="results-title">Shared-space ENA result</h2>
          <p>
            Every unit, code node, and trajectory centroid below uses the same
            three-axis jENA rotation.
          </p>
        </div>
        <button
          className="button button--secondary"
          type="button"
          onClick={() => downloadAnalysisResult(result, datasetName.replace(/\.csv$/iu, ""))}
        >
          <Download size={18} aria-hidden="true" /> Export result CSV
        </button>
      </header>

      <dl className="summary-grid" aria-label="Analysis summary">
        <div><dt>Rows</dt><dd>{result.summary.inputRows}</dd></div>
        <div><dt>Units</dt><dd>{result.summary.units}</dd></div>
        <div><dt>Codes</dt><dd>{result.summary.nodes}</dd></div>
        <div><dt>Edges</dt><dd>{result.summary.edges}</dd></div>
        <div><dt>Groups</dt><dd>{result.summary.groups}</dd></div>
        <div><dt>Centroids</dt><dd>{result.summary.trajectoryCentroids}</dd></div>
      </dl>

      <div className="result-view-tabs" role="tablist" aria-label="Result representation">
        <button
          id="result-tab-3d"
          type="button"
          role="tab"
          aria-selected={view === "3d"}
          aria-controls="result-panel-3d"
          tabIndex={view === "3d" ? 0 : -1}
          onClick={() => selectView("3d")}
          onKeyDown={(event) => handleTabKeyDown(event, "3d")}
        >
          <Box size={17} aria-hidden="true" /> 3D
        </button>
        <button
          id="result-tab-2d"
          type="button"
          role="tab"
          aria-selected={view === "2d"}
          aria-controls="result-panel-2d"
          tabIndex={view === "2d" ? 0 : -1}
          onClick={() => selectView("2d")}
          onKeyDown={(event) => handleTabKeyDown(event, "2d")}
        >
          <List size={17} aria-hidden="true" /> 2D
        </button>
        <button
          id="result-tab-table"
          type="button"
          role="tab"
          aria-selected={view === "table"}
          aria-controls="result-panel-table"
          tabIndex={view === "table" ? 0 : -1}
          onClick={() => selectView("table")}
          onKeyDown={(event) => handleTabKeyDown(event, "table")}
        >
          <Table2 size={17} aria-hidden="true" /> Table
        </button>
      </div>

      {view === "3d" && (
        <div
          id="result-panel-3d"
          className="plot-panel"
          role="tabpanel"
          aria-labelledby="result-tab-3d"
          tabIndex={0}
          data-testid="analysis-plot"
          data-plotly-ready={plotlyReady ? "true" : "false"}
        >
          <p className="sr-only">
            Interactive 3D chart. Use the adjacent 2D view or result table for a
            non-spatial representation of the same computed coordinates.
          </p>
          <Plot
            data={data3d}
            layout={plotLayout(result, 3)}
            config={plotConfig}
            useResizeHandler
            className="analysis-plotly"
            onInitialized={() => setPlotlyReady(true)}
            onUpdate={() => setPlotlyReady(true)}
          />
        </div>
      )}

      {view === "2d" && (
        <div
          id="result-panel-2d"
          className="plot-panel"
          role="tabpanel"
          aria-labelledby="result-tab-2d"
          tabIndex={0}
          data-testid="analysis-plot"
          data-plotly-ready={plotlyReady ? "true" : "false"}
        >
          <Plot
            data={data2d}
            layout={plotLayout(result, 2)}
            config={plotConfig}
            useResizeHandler
            className="analysis-plotly"
            onInitialized={() => setPlotlyReady(true)}
            onUpdate={() => setPlotlyReady(true)}
          />
        </div>
      )}

      {view === "table" && (
        <div
          id="result-panel-table"
          className="result-table-panel"
          role="tabpanel"
          aria-labelledby="result-tab-table"
          tabIndex={0}
        >
          <ResultTables result={result} />
        </div>
      )}

      <footer className="result-provenance">
        <div>
          <strong>Computation</strong>
          <span>
            {result.provenance.adapter} {result.provenance.adapterVersion} · jENA {result.provenance.jenaVersion}
          </span>
        </div>
        <div>
          <strong>Scientific status</strong>
          <span>Legacy application fixture comparison pending</span>
        </div>
      </footer>

      {result.diagnostics.length > 0 && (
        <aside className="diagnostics" aria-labelledby="diagnostics-title">
          <h3 id="diagnostics-title">Diagnostics</h3>
          <ul>
            {result.diagnostics.map((diagnostic) => (
              <li key={`${diagnostic.code}-${diagnostic.path ?? "root"}`}>
                <strong>{diagnostic.severity}:</strong> {diagnostic.message}
              </li>
            ))}
          </ul>
        </aside>
      )}
    </section>
  );
}

function ResultTables({ result }: { result: AnalysisResult }) {
  return (
    <div className="result-tables">
      <section aria-labelledby="unit-coordinate-title">
        <h3 id="unit-coordinate-title">Unit coordinates</h3>
        <div
          className="table-scroll"
          role="region"
          aria-label="Unit coordinate table"
          tabIndex={0}
        >
          <table>
            <caption>
              Unit identities retain the canonical complete tuple even when display names repeat.
            </caption>
            <thead>
              <tr>
                <th scope="col">Unit</th>
                <th scope="col">Group</th>
                <th scope="col">Time</th>
                <th scope="col">SVD1</th>
                <th scope="col">SVD2</th>
                <th scope="col">SVD3</th>
              </tr>
            </thead>
            <tbody>
              {result.points.map((point) => (
                <tr key={point.id.canonical}>
                  <th scope="row">
                    {point.participantLabel.display}
                    <small>{point.unit.display}</small>
                  </th>
                  <td>{point.group?.display ?? "—"}</td>
                  <td>{point.time?.display ?? "—"}</td>
                  {point.coordinates.map((coordinate, index) => (
                    <td key={`${point.id.canonical}-${result.axes[index]}`}>
                      {coordinate.toFixed(4)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="centroid-coordinate-title">
        <h3 id="centroid-coordinate-title">Group-time centroids</h3>
        <div
          className="table-scroll"
          role="region"
          aria-label="Group-time centroid table"
          tabIndex={0}
        >
          <table>
            <caption>Centroids in the same rotation as the unit points above.</caption>
            <thead>
              <tr>
                <th scope="col">Group</th>
                <th scope="col">Time</th>
                <th scope="col">Participants</th>
                <th scope="col">SVD1</th>
                <th scope="col">SVD2</th>
                <th scope="col">SVD3</th>
              </tr>
            </thead>
            <tbody>
              {(result.trajectory?.centroids ?? []).map((centroid) => (
                <tr key={`${centroid.group.canonical}:${centroid.time.canonical}`}>
                  <th scope="row">{centroid.group.display}</th>
                  <td>{centroid.time.display}</td>
                  <td>{centroid.participantCount}</td>
                  {centroid.coordinates.map((coordinate, index) => (
                    <td key={`${centroid.index}-${result.axes[index]}`}>
                      {coordinate.toFixed(4)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
