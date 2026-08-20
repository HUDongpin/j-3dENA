"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import type { PreparedSpaceResult } from "@3dena/analysis";
import type { Data, Layout } from "plotly.js";
import { Archive, Download, FileJson2 } from "lucide-react";
import { PlotToolsPanel } from "@/components/plot-tools-panel";
import { PreparedChangePanel } from "@/components/prepared-change-panel";
import { PreparedComparisonPanel } from "@/components/prepared-comparison-panel";
import { PreparedStatisticsPanel } from "@/components/prepared-statistics-panel";
import {
  ResultExplorerTabs,
  ResultPanel,
} from "@/components/result-explorer-tabs";
import {
  downloadPreparedBundle,
  downloadPreparedCentroids,
  downloadPreparedProvenance,
} from "@/lib/export-prepared-results";
import { PRODUCT_STATUS } from "@/lib/evidence-scope";
import {
  buildPreparedExchangePlotCandidate,
  PREPARED_EXCHANGE_PLOT_CONTRACT,
} from "@/lib/prepared-class1-plot-candidate";
import {
  preparedExchangePlotInput,
} from "@/lib/prepared-class1";
import {
  axisMappingIndexes,
  buildResultPlotConfig,
  cameraForPreset,
  createPlotToolState,
  permutePlotly3dTrace,
  projectPlotly3dTrace2d,
  selectAxisDimension,
  type AxisSlot,
  type CameraPreset,
  type CoordinateIndexes,
  type PlotDimension,
  type PlotToolState,
  type ResultSection,
} from "@/lib/result-plot-tools";
import type { RunOwner } from "@/lib/worker-protocol";
import type { PreparedDerivedSource } from "@/lib/use-derived-analysis";

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
        Loading the imported shared-space plot…
      </div>
    ),
  },
);

const NETWORK_TRACE_ROLES = new Set([
  "unit_points",
  "code_nodes",
  "coordinate_axis_shaft",
  "coordinate_axis_arrowhead",
  "coordinate_axis_label",
]);

const TRAJECTORY_TRACE_ROLES = new Set([
  "path",
  "direction_arrows",
  "node_markers",
  "code_nodes",
  "coordinate_axis_shaft",
  "coordinate_axis_arrowhead",
  "coordinate_axis_label",
]);

function fileStem(name: string): string {
  return name.replace(/\.ena3d\.json$/iu, "") || "prepared-space";
}

function traceMeta(trace: Data): Record<string, unknown> {
  const value = (trace as unknown as Record<string, unknown>).meta;
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function filterPreparedTraces(
  traces: readonly Data[],
  roles: ReadonlySet<string>,
  dimension: PlotDimension,
  indexes: CoordinateIndexes,
  hiddenDimension: string,
): Data[] {
  return traces
    .filter((trace) => {
      const meta = traceMeta(trace);
      if (!roles.has(String(meta.trajectory_role ?? ""))) return false;
      return !(
        dimension === "2d" &&
        typeof meta.axis === "string" &&
        meta.axis === hiddenDimension
      );
    })
    .map((trace) =>
      dimension === "3d"
        ? permutePlotly3dTrace(trace, indexes)
        : projectPlotly3dTrace2d(trace, indexes),
    );
}

function preparedPlotLayout(
  base: Partial<Layout>,
  tools: PlotToolState,
  indexes: CoordinateIndexes,
  uirevision: string,
): Partial<Layout> {
  const scene = (base.scene ?? {}) as NonNullable<Layout["scene"]>;
  const axisLayouts = [scene.xaxis, scene.yaxis, scene.zaxis];
  if (tools.dimension === "3d") {
    return {
      ...base,
      uirevision,
      scene: {
        ...scene,
        xaxis: {
          ...axisLayouts[indexes[0]],
          title: { text: tools.axes.x },
        },
        yaxis: {
          ...axisLayouts[indexes[1]],
          title: { text: tools.axes.y },
        },
        zaxis: {
          ...axisLayouts[indexes[2]],
          title: { text: tools.axes.z },
        },
        camera: cameraForPreset(tools.cameraPreset),
      },
    };
  }
  const fixedRangeForAxis = (index: 0 | 1 | 2): [number, number] => {
    const range = axisLayouts[index]?.range;
    if (
      !Array.isArray(range) ||
      range.length !== 2 ||
      !Number.isFinite(Number(range[0])) ||
      !Number.isFinite(Number(range[1]))
    ) {
      throw new TypeError("Prepared candidate plot is missing its audited axis range.");
    }
    return [Number(range[0]), Number(range[1])];
  };
  const xRange = fixedRangeForAxis(indexes[0]);
  const yRange = fixedRangeForAxis(indexes[1]);
  return {
    autosize: true,
    margin: { l: 64, r: 24, t: 30, b: 60 },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    font: { color: "#25282d" },
    legend: { orientation: "h", y: -0.16 },
    hoverlabel: { bgcolor: "#0f172a", font: { color: "#ffffff" } },
    uirevision,
    xaxis: {
      title: { text: tools.axes.x },
      gridcolor: "#d7d7d7",
      zerolinecolor: "#969696",
      range: xRange,
    },
    yaxis: {
      title: { text: tools.axes.y },
      gridcolor: "#d7d7d7",
      zerolinecolor: "#969696",
      range: yRange,
      scaleanchor: "x",
      scaleratio: 1,
    },
  };
}

interface PreparedAnalysisResultsProps {
  result: PreparedSpaceResult;
  owner: RunOwner;
}

export function PreparedAnalysisResults({
  result,
  owner,
}: PreparedAnalysisResultsProps) {
  const resultRef = useRef<HTMLElement>(null);
  const [activeSection, setActiveSection] =
    useState<ResultSection>("networks");
  const [tools, setTools] = useState<PlotToolState>(() =>
    createPlotToolState(result.displaySpace.dimensions),
  );
  const [plotlyReady, setPlotlyReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const derivedSource = useMemo<PreparedDerivedSource>(() => ({
    mode: "prepared",
    result,
  }), [result]);
  const candidate = useMemo(
    () => buildPreparedExchangePlotCandidate(preparedExchangePlotInput(result)),
    [result],
  );
  const indexes = useMemo(
    () => axisMappingIndexes(result.displaySpace.dimensions, tools.axes),
    [result.displaySpace.dimensions, tools.axes],
  );
  const networkData = useMemo(
    () =>
      filterPreparedTraces(
        candidate.data,
        NETWORK_TRACE_ROLES,
        tools.dimension,
        indexes,
        tools.axes.z,
      ),
    [candidate.data, indexes, tools.axes.z, tools.dimension],
  );
  const trajectoryData = useMemo(
    () =>
      filterPreparedTraces(
        candidate.data,
        TRAJECTORY_TRACE_ROLES,
        tools.dimension,
        indexes,
        tools.axes.z,
      ),
    [candidate.data, indexes, tools.axes.z, tools.dimension],
  );
  const layout = useMemo(
    () =>
      preparedPlotLayout(
        candidate.layout,
        tools,
        indexes,
        `${owner.runId}-${tools.dimension}-${Object.values(tools.axes).join("-")}-${tools.cameraPreset}`,
      ),
    [candidate.layout, indexes, owner.runId, tools],
  );
  const allCentroids = result.displaySpace.trajectory.centroids;
  const stem = fileStem(result.sourceReceipt.name);
  const plotConfig = useMemo(
    () =>
      buildResultPlotConfig({
        showModeBar: tools.showModeBar,
        fileName: `${stem}-${owner.runId}-prepared-space`,
      }),
    [owner.runId, stem, tools.showModeBar],
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
      axes: selectAxisDimension(
        current.axes,
        slot,
        dimension,
        result.displaySpace.dimensions,
      ),
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
      className={`analysis-results prepared-results${fullscreenActive ? " analysis-results--fullscreen" : ""}`}
      data-testid="analysis-result"
      data-dataset-hash={owner.datasetHash}
      data-spec-hash={owner.specHash}
      data-run-id={owner.runId}
      data-source-kind={result.sourceKind}
      data-raw-recomputed={String(result.rawJenaRecompute)}
      data-product-status={PRODUCT_STATUS}
      data-evidence-status={PRODUCT_STATUS}
      data-prepared-evidence="unverified-prepared-exchange"
      aria-labelledby="prepared-results-title"
    >
      <header className="results-heading">
        <div>
          <p className="eyebrow">Imported prepared shared space</p>
          <h2 id="prepared-results-title">Prepared-exchange result</h2>
          <p>
            These SVD coordinates were imported from the exchange and summarized
            in the browser. No raw-row jENA recomputation was performed.
          </p>
        </div>
        <div className="prepared-export-actions" aria-label="Prepared result exports">
          <button
            className="button button--secondary"
            type="button"
            onClick={() => downloadPreparedCentroids(result, stem)}
            data-testid="prepared-export-centroids"
          >
            <Download size={18} aria-hidden="true" /> Centroid CSV
          </button>
          <button
            className="button button--quiet"
            type="button"
            onClick={() => downloadPreparedProvenance(result, owner, stem)}
            data-testid="prepared-export-provenance"
          >
            <FileJson2 size={18} aria-hidden="true" /> Provenance JSON
          </button>
          <button
            className="button button--quiet"
            type="button"
            onClick={() => downloadPreparedBundle(result, owner, stem)}
            data-testid="prepared-export-bundle"
          >
            <Archive size={18} aria-hidden="true" /> Download bundle
          </button>
        </div>
      </header>

      <div
        className="prepared-boundary"
        role="note"
        data-testid="prepared-evidence-status"
      >
        <strong>Scientific boundary</strong>
        <span>Product status: {PRODUCT_STATUS}.</span>
        <span>
          This view consumes an imported shared space. Rotation, eigenvalues,
          and variance are not present in this exchange, so this result does not
          claim a new model fit.
        </span>
        <span>
          This user-provided exchange has no built-in research-dataset identity,
          no raw-row parity claim, and no independent scientific approval.
        </span>
      </div>

      <ResultExplorerTabs
        active={activeSection}
        idPrefix="prepared-result"
        onSelect={selectSection}
      />

      <ResultPanel
        active={activeSection}
        section="overall"
        idPrefix="prepared-result"
      >
        <PreparedOverall result={result} owner={owner} />
      </ResultPanel>

      <ResultPanel
        active={activeSection}
        section="networks"
        idPrefix="prepared-result"
        className="plot-panel result-network-panel"
      >
        <div
          className="result-plot-frame"
          role="region"
          aria-label={`Imported prepared-space ${tools.dimension === "3d" ? "three" : "two"}-dimensional network plot`}
          tabIndex={0}
          data-testid="analysis-plot"
          data-plotly-ready={plotlyReady ? "true" : "false"}
          data-plot-contract={PREPARED_EXCHANGE_PLOT_CONTRACT}
          data-plot-dimension={tools.dimension}
          data-axis-x={tools.axes.x}
          data-axis-y={tools.axes.y}
          data-axis-z={tools.axes.z}
          data-render-revision={revision}
        >
          <p className="sr-only">
            Interactive imported-coordinate network chart. Overall and
            Trajectory provide keyboard-accessible exact-value alternatives.
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
            data={networkData}
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

      <ResultPanel
        active={activeSection}
        section="comparison"
        idPrefix="prepared-result"
      >
        <PreparedComparisonPanel source={derivedSource} owner={owner} />
      </ResultPanel>

      <ResultPanel active={activeSection} section="change" idPrefix="prepared-result">
        <PreparedChangePanel source={derivedSource} owner={owner} />
      </ResultPanel>

      <ResultPanel active={activeSection} section="statistics" idPrefix="prepared-result">
        <PreparedStatisticsPanel source={derivedSource} owner={owner} />
      </ResultPanel>

      <ResultPanel
        active={activeSection}
        section="trajectory"
        idPrefix="prepared-result"
      >
        <section className="trajectory-result" aria-labelledby="prepared-trajectory-title">
          <header>
            <p className="eyebrow">Imported prepared trajectory</p>
            <h3 id="prepared-trajectory-title">Group-time centroid paths</h3>
            <p>
              Square centroids, gap boundaries, and direction markers select
              the imported display coordinates without recomputing a rotation.
            </p>
          </header>
          <div
            className="plot-panel trajectory-plot-panel"
            role="region"
            aria-label="Imported prepared-exchange group-time trajectory plot"
            tabIndex={0}
            data-testid="prepared-trajectory-plot"
            data-render-revision={revision}
          >
            <Plot
              data={trajectoryData}
              layout={layout}
              config={plotConfig}
              revision={revision}
              useResizeHandler
              className="analysis-plotly"
            />
          </div>
          <PreparedCentroidTable
            result={result}
            centroids={allCentroids}
            heading="All group-time centroids"
            description={`${result.summary.groups} actual groups in the imported prepared result.`}
            testId="prepared-centroid-table"
          />
        </section>
      </ResultPanel>

      <ResultPanel
        active={activeSection}
        section="plot-tools"
        idPrefix="prepared-result"
      >
        <PlotToolsPanel
          dimensions={result.displaySpace.dimensions}
          state={tools}
          fullscreenActive={fullscreenActive}
          dimensionScopeNote="This prepared result currently exposes only its three imported display dimensions. The retained full-dimensional space is not selectable until a scientific dimension selector is available."
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

function PreparedOverall({
  result,
  owner,
}: {
  result: PreparedSpaceResult;
  owner: RunOwner;
}) {
  return (
    <div className="overall-result">
      <dl
        className="summary-grid prepared-summary-grid"
        aria-label="Prepared analysis summary"
        data-testid="prepared-summary"
        data-points={result.summary.points}
        data-nodes={result.summary.nodes}
        data-edges={result.summary.edges}
        data-dimensions={result.summary.dimensions}
        data-groups={result.summary.groups}
        data-centroids={result.summary.trajectoryCentroids}
      >
        <div><dt>Points</dt><dd>{result.summary.points}</dd></div>
        <div><dt>Nodes</dt><dd>{result.summary.nodes}</dd></div>
        <div><dt>Edges</dt><dd>{result.summary.edges}</dd></div>
        <div><dt>Dimensions</dt><dd>{result.summary.dimensions}</dd></div>
        <div><dt>Groups</dt><dd>{result.summary.groups}</dd></div>
        <div><dt>Centroids</dt><dd>{result.summary.trajectoryCentroids}</dd></div>
      </dl>

      <div className="prepared-artifact-state" role="note">
        <h3>Model-fit artifacts</h3>
        <dl>
          <div><dt>Rotation</dt><dd>{result.artifacts.rotation}</dd></div>
          <div><dt>Eigenvalues</dt><dd>{result.artifacts.eigenvalues}</dd></div>
          <div><dt>Variance</dt><dd>{result.artifacts.variance}</dd></div>
        </dl>
      </div>

      <footer className="result-provenance prepared-provenance">
        <div>
          <strong>Source receipt</strong>
          <span>
            {result.sourceReceipt.name} · {result.sourceReceipt.byteLength} bytes · SHA-256 {result.sourceReceipt.sha256}
          </span>
        </div>
        <div>
          <strong>Owned run</strong>
          <span>
            Dataset {owner.datasetHash} · specification {owner.specHash} · run {owner.runId}
          </span>
        </div>
        <div>
          <strong>Computation</strong>
          <span>
            {result.provenance.coordinateSpace} · {result.provenance.computation} ·
            jENA executed: {result.provenance.jenaExecuted ? "yes" : "no"}
          </span>
        </div>
        <div>
          <strong>Resolved mapping</strong>
          <span>
            Participant {result.provenance.resolvedMapping.participant.join(" + ")} · group {result.provenance.resolvedMapping.group} · time {result.provenance.resolvedMapping.time} · display {result.provenance.resolvedMapping.displayDimensions.join(" / ")}
          </span>
        </div>
        <div>
          <strong>Scientific status</strong>
          <span>
            {PRODUCT_STATUS}. Imported prepared-exchange receipt only;
            jENA was not executed, and no raw-row parity or independent approval
            is claimed.
          </span>
        </div>
      </footer>

      {result.diagnostics.length > 0 && (
        <aside className="diagnostics" aria-labelledby="prepared-diagnostics-title">
          <h3 id="prepared-diagnostics-title">Diagnostics</h3>
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

function PreparedCentroidTable({
  result,
  centroids,
  heading,
  description,
  testId,
}: {
  result: PreparedSpaceResult;
  centroids: PreparedSpaceResult["displaySpace"]["trajectory"]["centroids"];
  heading: string;
  description: string;
  testId: string;
}) {
  const headingId = `${testId}-title`;
  return (
    <section className="prepared-centroid-section" aria-labelledby={headingId}>
      <div>
        <p className="eyebrow">Exact-value fallback</p>
        <h3 id={headingId}>{heading}</h3>
        <p>
          {description} Square markers in the plot and rows here use the same
          imported SVD1, SVD2, and SVD3 coordinates.
        </p>
      </div>
      <div
        className="table-scroll"
        role="region"
        aria-label={`${heading} coordinate table`}
        tabIndex={0}
        data-testid={testId}
      >
        <table>
          <caption>
            {heading} in the imported prepared shared coordinate space.
          </caption>
          <thead>
            <tr>
              <th scope="col">Group</th>
              <th scope="col">Period</th>
              <th scope="col">Participants</th>
              {result.displaySpace.dimensions.map((dimension) => (
                <th scope="col" key={dimension}>{dimension}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {centroids.map((centroid) => (
              <tr key={`${centroid.group.canonical}:${centroid.time.canonical}`}>
                <th scope="row">{centroid.group.display}</th>
                <td>{centroid.time.display}</td>
                <td>{centroid.participantCount}</td>
                {centroid.coordinates.map((coordinate, index) => (
                  <td key={`${centroid.index}-${result.displaySpace.dimensions[index]}`}>
                    {coordinate.toFixed(6)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
