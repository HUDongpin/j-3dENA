"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import type {
  AnalysisResult,
  Coordinates3D,
  DatasetLimitsReceiptV1,
  DatasetSchemaV1,
} from "@3dena/analysis";
import type { Data, Layout } from "plotly.js";
import { Download } from "lucide-react";
import { PlotToolsPanel } from "@/components/plot-tools-panel";
import { RawChangePanel } from "@/components/raw-change-panel";
import { RawComparisonPanel } from "@/components/raw-comparison-panel";
import { RawStatisticsPanel } from "@/components/raw-statistics-panel";
import {
  ResultExplorerTabs,
  ResultPanel,
} from "@/components/result-explorer-tabs";
import {
  assessRawEvidenceScope,
  PRODUCT_STATUS,
  type RawEvidenceAssessment,
} from "@/lib/evidence-scope";
import type { RunOwner } from "@/lib/worker-protocol";
import type { RawDerivedSource } from "@/lib/use-derived-analysis";
import {
  RAW_BROWSER_DATASET_LIMITS,
  fallbackRawDatasetSchema,
} from "@/lib/raw-dataset-receipt";
import { downloadAnalysisResult } from "@/lib/export-results";
import {
  axisColor,
  axisTraces3d,
  groupColor,
  trajectoryTraces,
} from "@/lib/plot-traces";
import {
  axisMappingIndexes,
  buildResultPlotConfig,
  cameraForPreset,
  createPlotToolState,
  permuteCoordinate,
  selectAxisDimension,
  type AxisSlot,
  type CameraPreset,
  type PlotDimension,
  type PlotToolState,
  type ResultSection,
} from "@/lib/result-plot-tools";

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
    if (!source || !target || edge.meanWeight <= 0) continue;
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

function networkPlotData(result: AnalysisResult, dimensions: 2 | 3): Data[] {
  return [
    ...networkTraces(result, dimensions),
    ...pointTraces(result, dimensions),
    ...(dimensions === 3
      ? axisTraces3d(axisExtent(result), result.axes)
      : []),
  ];
}

function trajectoryPlotData(result: AnalysisResult, dimensions: 2 | 3): Data[] {
  const extent = axisExtent(result);
  return [
    ...trajectoryTraces(result, dimensions, extent),
    ...(dimensions === 3 ? axisTraces3d(extent, result.axes) : []),
  ];
}

function plotLayout(
  result: AnalysisResult,
  dimensions: 2 | 3,
  cameraPreset: CameraPreset,
  uirevision: string,
): Partial<Layout> {
  const common: Partial<Layout> = {
    autosize: true,
    margin: { l: 56, r: 24, t: 30, b: 56 },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#f8fafc",
    font: {
      family: "Atkinson Hyperlegible, system-ui, sans-serif",
      color: "#334155",
    },
    legend: { orientation: "h", y: -0.16 },
    hoverlabel: { bgcolor: "#0f172a", font: { color: "#ffffff" } },
    uirevision,
  };
  if (dimensions === 3) {
    return {
      ...common,
      scene: {
        xaxis: {
          title: { text: result.axes[0] },
          color: axisColor(result.axes[0]),
          gridcolor: "#e2e8f0",
        },
        yaxis: {
          title: { text: result.axes[1] },
          color: axisColor(result.axes[1]),
          gridcolor: "#e2e8f0",
        },
        zaxis: {
          title: { text: result.axes[2] },
          color: axisColor(result.axes[2]),
          gridcolor: "#e2e8f0",
        },
        camera: cameraForPreset(cameraPreset),
        bgcolor: "#f8fafc",
        aspectmode: "cube",
      },
    };
  }
  return {
    ...common,
    xaxis: {
      title: { text: result.axes[0] },
      color: axisColor(result.axes[0]),
      gridcolor: "#e2e8f0",
    },
    yaxis: {
      title: { text: result.axes[1] },
      color: axisColor(result.axes[1]),
      gridcolor: "#e2e8f0",
    },
  };
}

function displayPermutation(
  result: AnalysisResult,
  tools: PlotToolState,
): AnalysisResult {
  const indexes = axisMappingIndexes(result.axes, tools.axes);
  const coordinate = (value: Coordinates3D): Coordinates3D =>
    permuteCoordinate(value, indexes);
  const displayBase: AnalysisResult = {
    ...result,
    axes: [tools.axes.x, tools.axes.y, tools.axes.z] as AnalysisResult["axes"],
    points: result.points.map((point) => ({
      ...point,
      coordinates: coordinate(point.coordinates),
    })),
    nodes: result.nodes.map((node) => ({
      ...node,
      coordinates: coordinate(node.coordinates),
    })),
  };
  if (!result.trajectory) return displayBase;
  return {
    ...displayBase,
    trajectory: {
      ...result.trajectory,
      participantPeriods: result.trajectory.participantPeriods.map((point) => ({
        ...point,
        coordinates: coordinate(point.coordinates),
      })),
      centroids: result.trajectory.centroids.map((centroid) => ({
        ...centroid,
        coordinates: coordinate(centroid.coordinates),
      })),
    },
  };
}

interface AnalysisResultsProps {
  result: AnalysisResult;
  owner: RunOwner;
  datasetName: string;
  /** Exact server-rendered build identity; omitted/unversioned builds fail closed. */
  buildId?: string | undefined;
  datasetByteLength?: number;
  datasetColumns?: number;
  datasetSchema?: DatasetSchemaV1;
  datasetLimits?: DatasetLimitsReceiptV1;
}

export function AnalysisResults({
  result,
  owner,
  datasetName,
  buildId,
  datasetByteLength = 0,
  datasetColumns = result.summary.inputColumns,
  datasetSchema = fallbackRawDatasetSchema(datasetColumns),
  datasetLimits = RAW_BROWSER_DATASET_LIMITS,
}: AnalysisResultsProps) {
  const resultRef = useRef<HTMLElement>(null);
  const evidence = assessRawEvidenceScope(result, owner, buildId);
  const [activeSection, setActiveSection] =
    useState<ResultSection>("networks");
  const [tools, setTools] = useState<PlotToolState>(() =>
    createPlotToolState(result.axes),
  );
  const [plotlyReady, setPlotlyReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const displayedResult = useMemo(
    () => displayPermutation(result, tools),
    [result, tools],
  );
  const derivedSource = useMemo<RawDerivedSource>(() => ({
    mode: "raw",
    name: datasetName,
    byteLength: datasetByteLength,
    rows: result.summary.inputRows,
    columns: datasetColumns,
    schema: datasetSchema,
    limits: datasetLimits,
    result,
  }), [datasetByteLength, datasetColumns, datasetLimits, datasetName, datasetSchema, result]);
  const dimensionCount = tools.dimension === "3d" ? 3 : 2;
  const networks = useMemo(
    () => networkPlotData(displayedResult, dimensionCount),
    [displayedResult, dimensionCount],
  );
  const trajectories = useMemo(
    () => trajectoryPlotData(displayedResult, dimensionCount),
    [displayedResult, dimensionCount],
  );
  const plotConfig = useMemo(
    () =>
      buildResultPlotConfig({
        showModeBar: tools.showModeBar,
        fileName: `${datasetName.replace(/\.csv$/iu, "")}-${owner.runId}-shared-space`,
      }),
    [datasetName, owner.runId, tools.showModeBar],
  );
  const layout = useMemo(
    () =>
      plotLayout(
        displayedResult,
        dimensionCount,
        tools.cameraPreset,
        `${owner.runId}-${tools.dimension}-${Object.values(tools.axes).join("-")}-${tools.cameraPreset}`,
      ),
    [displayedResult, dimensionCount, owner.runId, tools],
  );

  useEffect(() => {
    function syncFullscreen(): void {
      setFullscreenActive(document.fullscreenElement === resultRef.current);
    }
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  function updateAxis(slot: AxisSlot, dimension: string): void {
    setTools((current) => ({
      ...current,
      axes: selectAxisDimension(current.axes, slot, dimension, result.axes),
    }));
  }

  function updateDimension(dimension: PlotDimension): void {
    setTools((current) => ({ ...current, dimension }));
  }

  function updateCamera(cameraPreset: CameraPreset): void {
    setTools((current) => ({ ...current, cameraPreset }));
    setRevision((current) => current + 1);
  }

  function schedulePlotReflow(): void {
    requestAnimationFrame(() => {
      setRevision((current) => current + 1);
      window.dispatchEvent(new Event("resize"));
    });
  }

  function selectSection(section: ResultSection): void {
    setActiveSection(section);
    if (section === "networks" || section === "trajectory") {
      schedulePlotReflow();
    }
  }

  function reflowPlot(): void {
    schedulePlotReflow();
  }

  async function toggleFullscreen(): Promise<void> {
    const target = resultRef.current;
    if (!target) return;
    selectSection("networks");
    try {
      if (document.fullscreenElement === target && document.exitFullscreen) {
        await document.exitFullscreen();
        return;
      }
      if (target.requestFullscreen) {
        await target.requestFullscreen();
        return;
      }
      setFullscreenActive((current) => !current);
      schedulePlotReflow();
    } catch {
      setFullscreenActive(false);
    }
  }

  return (
    <section
      ref={resultRef}
      className={`analysis-results${fullscreenActive ? " analysis-results--fullscreen" : ""}`}
      data-testid="analysis-result"
      data-dataset-hash={owner.datasetHash}
      data-spec-hash={owner.specHash}
      data-run-id={owner.runId}
      data-product-status={PRODUCT_STATUS}
      data-evidence-status={evidence.evidenceStatus}
      data-evidence-scope={evidence.scopeVersion ?? "unscoped-local-result"}
      data-evidence-build-id={evidence.buildId ?? "unbound-build"}
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
          onClick={() =>
            downloadAnalysisResult(result, datasetName.replace(/\.csv$/iu, ""))
          }
        >
          <Download size={18} aria-hidden="true" /> Export result CSV
        </button>
      </header>

      <div
        className="prepared-boundary result-evidence-boundary"
        role="note"
        data-testid="raw-evidence-status"
      >
        <strong>Product status: {PRODUCT_STATUS}</strong>
        <span>
          {evidence.evidenceStatus === "PARITY_CANDIDATE"
            ? `Only this exact fixture, specification, explicit build identity (${evidence.buildId}), and frozen version set is a scoped PARITY_CANDIDATE (${evidence.scopeVersion}). Integrated parity remains open.`
            : "This local result does not match the governed small-raw fixture, specification, explicit build identity, and frozen version set. It carries no parity-candidate claim."}
        </span>
      </div>

      <ResultExplorerTabs
        active={activeSection}
        idPrefix="raw-result"
        onSelect={selectSection}
      />

      <ResultPanel active={activeSection} section="overall" idPrefix="raw-result">
        <OverallResult result={result} owner={owner} evidence={evidence} />
      </ResultPanel>

      <ResultPanel
        active={activeSection}
        section="networks"
        idPrefix="raw-result"
        className="plot-panel result-network-panel"
      >
        <div
          className="result-plot-frame"
          role="region"
          aria-label={`${tools.dimension === "3d" ? "Three" : "Two"}-dimensional ENA network plot`}
          tabIndex={0}
          data-testid="analysis-plot"
          data-plotly-ready={plotlyReady ? "true" : "false"}
          data-render-revision={revision}
        >
          <p className="sr-only">
            Interactive network chart. Overall and Trajectory include
            keyboard-accessible exact-value tables for the same owned result.
          </p>
          {fullscreenActive && (
            <button
              className="button button--quiet plot-fullscreen-exit"
              type="button"
              onClick={() => void toggleFullscreen()}
            >
              Exit fullscreen
            </button>
          )}
          <Plot
            data={networks}
            layout={layout}
            config={plotConfig}
            revision={revision}
            useResizeHandler
            className="analysis-plotly"
            onInitialized={() => setPlotlyReady(true)}
            onUpdate={() => setPlotlyReady(true)}
          />
        </div>
      </ResultPanel>

      <ResultPanel active={activeSection} section="comparison" idPrefix="raw-result">
        <RawComparisonPanel source={derivedSource} owner={owner} />
      </ResultPanel>

      <ResultPanel active={activeSection} section="change" idPrefix="raw-result">
        <RawChangePanel source={derivedSource} owner={owner} />
      </ResultPanel>

      <ResultPanel active={activeSection} section="statistics" idPrefix="raw-result">
        <RawStatisticsPanel source={derivedSource} owner={owner} />
      </ResultPanel>

      <ResultPanel active={activeSection} section="trajectory" idPrefix="raw-result">
        <section className="trajectory-result" aria-labelledby="trajectory-result-title">
          <header>
            <p className="eyebrow">Same owned rotation</p>
            <h3 id="trajectory-result-title">Group-time trajectories</h3>
            <p>
              Paths and centroids are display selections from this result; gaps
              remain gaps and no period-specific model is fit here.
            </p>
          </header>
          {result.trajectory ? (
            <div
              className="plot-panel trajectory-plot-panel"
              role="region"
              aria-label="Group-time trajectory plot"
              tabIndex={0}
              data-testid="trajectory-plot"
              data-render-revision={revision}
            >
              <Plot
                data={trajectories}
                layout={layout}
                config={plotConfig}
                revision={revision}
                useResizeHandler
                className="analysis-plotly"
              />
            </div>
          ) : (
            <p className="result-empty-state" role="status">
              This owned result does not contain trajectory artifacts.
            </p>
          )}
          <ResultTables result={result} />
        </section>
      </ResultPanel>

      <ResultPanel active={activeSection} section="plot-tools" idPrefix="raw-result">
        <PlotToolsPanel
          dimensions={result.axes}
          state={tools}
          fullscreenActive={fullscreenActive}
          onDimensionChange={updateDimension}
          onAxisChange={updateAxis}
          onCameraChange={updateCamera}
          onCameraReset={() => updateCamera("isometric")}
          onModeBarChange={(showModeBar) =>
            setTools((current) => ({ ...current, showModeBar }))
          }
          onResize={reflowPlot}
          onFullscreen={() => void toggleFullscreen()}
        />
      </ResultPanel>
    </section>
  );
}

function OverallResult({
  result,
  owner,
  evidence,
}: {
  result: AnalysisResult;
  owner: RunOwner;
  evidence: RawEvidenceAssessment;
}) {
  return (
    <div className="overall-result">
      <dl className="summary-grid" aria-label="Analysis summary">
        <div><dt>Rows</dt><dd>{result.summary.inputRows}</dd></div>
        <div><dt>Units</dt><dd>{result.summary.units}</dd></div>
        <div><dt>Codes</dt><dd>{result.summary.nodes}</dd></div>
        <div><dt>Edges</dt><dd>{result.summary.edges}</dd></div>
        <div><dt>Groups</dt><dd>{result.summary.groups}</dd></div>
        <div><dt>Centroids</dt><dd>{result.summary.trajectoryCentroids}</dd></div>
      </dl>

      <section aria-labelledby="variance-title">
        <h3 id="variance-title">Model variance</h3>
        <div className="table-scroll" role="region" aria-label="Model variance table" tabIndex={0}>
          <table>
            <caption>Exact variance values supplied by the owned analysis result.</caption>
            <thead>
              <tr>
                <th scope="col">Axis</th>
                <th scope="col">Proportion</th>
                <th scope="col">Eigenvalue</th>
                <th scope="col">Displayed</th>
              </tr>
            </thead>
            <tbody>
              {result.variance.map((dimension) => (
                <tr key={dimension.axis}>
                  <th scope="row">{dimension.axis}</th>
                  <td>{dimension.proportion.toFixed(6)}</td>
                  <td>{dimension.eigenvalue.toFixed(6)}</td>
                  <td>{dimension.displayed ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="result-provenance">
        <div>
          <strong>Computation</strong>
          <span>
            {result.provenance.adapter} {result.provenance.adapterVersion} · jENA {result.provenance.jenaVersion}
          </span>
        </div>
        <div>
          <strong>Owned run</strong>
          <span>
            Dataset {owner.datasetHash} · specification {owner.specHash} · run {owner.runId}
          </span>
        </div>
        <div>
          <strong>Resolved specification</strong>
          <span>
            {result.provenance.resolvedConfig.model} · {result.provenance.resolvedConfig.window} · {result.provenance.resolvedConfig.weightBy} · back {result.provenance.resolvedConfig.windowSizeBack} · forward {result.provenance.resolvedConfig.windowSizeForward}
          </span>
        </div>
        <div>
          <strong>Scientific status</strong>
          <span>
            {evidence.evidenceStatus === "PARITY_CANDIDATE"
              ? `Scoped small-raw vertical slice: PARITY_CANDIDATE under ${evidence.scopeVersion}. The product remains ${PRODUCT_STATUS}; integrated closure and independent approval remain open.`
              : `${PRODUCT_STATUS}. No governed parity-candidate scope applies to this result.`}
          </span>
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
    </div>
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
                {result.axes.map((axis) => <th scope="col" key={axis}>{axis}</th>)}
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
                {result.axes.map((axis) => <th scope="col" key={axis}>{axis}</th>)}
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
