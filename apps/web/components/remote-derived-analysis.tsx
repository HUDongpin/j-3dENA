"use client";

import dynamic from "next/dynamic";
import { useMemo, useState, type FormEvent } from "react";
import type {
  AnalysisResult,
  AnalysisTaskResultV1,
  ChangeNetworkResultV1,
  NetworkComparisonResultV1,
  StatisticsTaskResultV1,
  TrajectoryBootstrapResult,
  TrajectoryComparisonResult,
  TrajectoryDynamicsResultV1,
  TrajectoryDurationUnitV1,
  PreparedSpaceResult,
  RawScalar,
} from "@3dena/analysis";
import type { ActivatedAnalysisTaskSpecV1 } from "@3dena/compute-service-http";
import type { Data, Layout } from "plotly.js";
import { Play } from "lucide-react";
import {
  DerivedDiagnostics,
  GroupPairControls,
  formatDerivedNumber,
} from "@/components/derived-panel-ui";
import { rawChangeFieldOptions, rawGroupOptions } from "@/lib/raw-derived-options";
import { preparedChangeFieldOptions } from "@/lib/prepared-derived-analysis";
import type { VerifiedRemoteAnalysisResult } from "@/lib/remote-analysis-runtime";

const Plot = dynamic(
  async () => {
    const [{ default: createPlotlyComponent }, { default: Plotly }] = await Promise.all([
      import("react-plotly.js/factory"),
      import("plotly.js-dist-min"),
    ]);
    return createPlotlyComponent(Plotly);
  },
  {
    ssr: false,
    loading: () => <div className="remote-derived-plot-loading" role="status">Loading the result visualization…</div>,
  },
);

type DerivedTaskKind = Exclude<ActivatedAnalysisTaskSpecV1["kind"], "ena-model">;
type TimeContractKind = "numeric-v1" | "date-v1" | "difftime-v1";

interface RemoteDerivedControlsProps {
  readonly kind: DerivedTaskKind;
  readonly source: VerifiedRemoteAnalysisResult;
  readonly running: boolean;
  /** Prevents replacing a retained persistent job before explicit cleanup. */
  readonly disabled?: boolean;
  readonly onRun: (task: ActivatedAnalysisTaskSpecV1) => void;
}

const DURATION_UNITS: readonly TrajectoryDurationUnitV1[] = [
  "milliseconds",
  "seconds",
  "minutes",
  "hours",
  "days",
  "weeks",
];

const TASK_COPY: Record<DerivedTaskKind, { title: string; description: string }> = {
  "network-comparison": {
    title: "Group network comparison",
    description: "Computes mean(Group A) − mean(Group B) in source edge order without refitting the ENA model.",
  },
  "change-network": {
    title: "Exact-level network",
    description: "Selects one typed group or metadata level and estimates its mean network in the frozen shared rotation.",
  },
  statistics: {
    title: "Inferential statistics",
    description: "Runs the reviewed independent or exact participant-time paired comparison over retained full-space coordinates.",
  },
  trajectory: {
    title: "Trajectory dynamics",
    description: "Reduces duplicates before centroids, keeps available and complete cohorts distinct, and reports selected-3D and full-space distances.",
  },
  "trajectory-comparison": {
    title: "Trajectory comparison",
    description: "Compares two group paths with explicit direction B − A and a separate paired-identity confirmation gate.",
  },
  bootstrap: {
    title: "Trajectory uncertainty",
    description: "Resamples complete participant histories with a frozen seeded plan and pointwise Type-7 percentile intervals.",
  },
};

function uniqueRunId(kind: string): string {
  const suffix = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `remote-${kind}-${suffix}`;
}

function remoteTaskDeadline(): number {
  return Date.now() + 15 * 60_000;
}

function sourceAnalysis(source: VerifiedRemoteAnalysisResult): AnalysisResult | null {
  return source.envelope.taskKind === "ena-model"
    && source.envelope.result.schemaVersion === "3dena.analysis-result.v1"
    ? source.envelope.result
    : null;
}

function sourcePrepared(source: VerifiedRemoteAnalysisResult): PreparedSpaceResult | null {
  return source.envelope.taskKind === "prepared-import"
    && source.envelope.result.schemaVersion === "3dena.prepared-space-result.v1"
    ? source.envelope.result
    : null;
}

function finiteNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function civilDateEpoch(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const epoch = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(epoch);
  return roundTrip.getUTCFullYear() === year
      && roundTrip.getUTCMonth() === month - 1
      && roundTrip.getUTCDate() === day
    ? epoch
    : null;
}

export function RemoteDerivedControls({
  kind,
  source,
  running,
  disabled = false,
  onRun,
}: RemoteDerivedControlsProps) {
  const analysis = sourceAnalysis(source);
  const prepared = sourcePrepared(source);
  const groups = useMemo(() => analysis
    ? rawGroupOptions(analysis)
    : prepared?.displaySpace.trajectory.groupOrder.map((groupValue) => ({
        canonical: groupValue.canonical,
        label: groupValue.display,
        value: groupValue.value,
      })) ?? [], [analysis, prepared]);
  const changeFields = useMemo(() => analysis
    ? rawChangeFieldOptions(analysis).map((option) => ({
        field: option.field,
        label: option.label,
        levels: option.levels.map((levelOption) => ({
          value: levelOption.value,
          label: levelOption.label,
          rawValue: levelOption.value as RawScalar,
        })),
      }))
    : prepared ? preparedChangeFieldOptions(prepared).map((option) => ({
        field: option.field,
        label: option.label,
        levels: option.levels.map((levelOption) => ({
          value: levelOption.token,
          label: levelOption.label,
          rawValue: levelOption.level,
        })),
      })) : [], [analysis, prepared]);
  const retainedDimensions = analysis?.dimensions ?? prepared?.fullSpace.dimensions ?? [];
  const timeOrder = analysis?.trajectory?.timeOrder ?? prepared?.displaySpace.trajectory.timeOrder ?? [];
  const sourcePoints = useMemo(
    () => analysis?.points ?? prepared?.fullSpace.points ?? [],
    [analysis, prepared],
  );
  const metadataFields = useMemo(() =>
    [...new Set(sourcePoints.flatMap((point) => Object.keys(point.metadata)))].sort(),
  [sourcePoints]);
  const weightFields = useMemo(() => (analysis || prepared) ? metadataFields.filter((candidate) => {
    const observed = new Map<string, number>();
    for (const point of sourcePoints) {
      const value = point.metadata[candidate];
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || !("time" in point) || !point.time) return false;
      const participant = "participant" in point && point.participant
        ? point.participant.canonical
        : "participantLabel" in point && point.participantLabel
          ? point.participantLabel.canonical
          : "";
      const key = JSON.stringify([participant, point.time.canonical]);
      const previous = observed.get(key);
      if (previous !== undefined && previous !== value) return false;
      observed.set(key, value);
    }
    return observed.size > 0;
  }) : [], [analysis, prepared, metadataFields, sourcePoints]);
  const [groupA, setGroupA] = useState(groups[0]?.canonical ?? "");
  const [groupB, setGroupB] = useState(groups[1]?.canonical ?? "");
  const [group, setGroup] = useState(groups[0]?.canonical ?? "");
  const [field, setField] = useState(changeFields[0]?.field ?? "");
  const [level, setLevel] = useState(changeFields[0]?.levels[0]?.value ?? "");
  const [design, setDesign] = useState<"independent" | "paired">("independent");
  const [pairedConfirmed, setPairedConfirmed] = useState(false);
  const [dimensions, setDimensions] = useState<string[]>(retainedDimensions.slice(0, 3));
  const [alternative, setAlternative] = useState<"two-sided" | "greater" | "less">("two-sided");
  const [adjustment, setAdjustment] = useState<"none" | "holm" | "bh" | "bonferroni">("holm");
  const [cohortPolicy, setCohortPolicy] = useState<"available" | "complete">("available");
  const [estimand, setEstimand] = useState<"equal-participant-v1" | "weighted-participant-v1">("equal-participant-v1");
  const [weightField, setWeightField] = useState(weightFields[0] ?? "");
  const [timeKind, setTimeKind] = useState<TimeContractKind>(() =>
    timeOrder.length > 0 && timeOrder.every((time) => typeof time.value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(time.value))
      ? "date-v1"
      : "numeric-v1");
  const [timeUnit, setTimeUnit] = useState("source-period");
  const [durationUnit, setDurationUnit] = useState<TrajectoryDurationUnitV1>("days");
  const [timeValues, setTimeValues] = useState<string[]>(() => timeOrder.map((time, index) =>
    typeof time.value === "number" || typeof time.value === "string" ? String(time.value) : String(index)));
  const [replicates, setReplicates] = useState(500);
  const [confidenceLevel, setConfidenceLevel] = useState(0.95);
  const [seed, setSeed] = useState(42);
  const activeChangeField = changeFields.find((candidate) => candidate.field === field);
  const activeChangeLevel = activeChangeField?.levels.find((candidate) => candidate.value === level);
  const pairValid = groups.length >= 2 && groupA !== "" && groupB !== "" && groupA !== groupB;
  const selectedDimensions = dimensions.slice(0, 3);
  const trajectoryDimensionsValid = selectedDimensions.length === 3 && new Set(selectedDimensions).size === 3;
  const parsedTimeValues = timeValues.map((value) => timeKind === "date-v1"
    ? civilDateEpoch(value)
    : finiteNumber(value));
  const timeValuesValid = timeOrder.length > 0 && timeValues.length === timeOrder.length && timeValues.every((value) => {
    if (timeKind === "date-v1") return civilDateEpoch(value) !== null;
    return finiteNumber(value) !== null;
  }) && parsedTimeValues.every((value) => value !== null && Number.isFinite(value))
    && parsedTimeValues.every((value, index) => index === 0 || (value as number) > (parsedTimeValues[index - 1] as number))
    && (timeKind !== "numeric-v1" || timeUnit.trim() !== "");
  const valid = Boolean(analysis || prepared) && (
    kind === "network-comparison" ? pairValid
      : kind === "change-network" ? Boolean(activeChangeLevel)
        : kind === "statistics" ? pairValid && dimensions.length > 0 && (design === "independent" || pairedConfirmed)
          : kind === "trajectory" ? group !== "" && trajectoryDimensionsValid && timeValuesValid
            && (estimand === "equal-participant-v1" || weightField !== "")
            : kind === "trajectory-comparison" ? pairValid && (design === "independent" || pairedConfirmed)
              : group !== "" && Number.isSafeInteger(replicates) && replicates >= 200 && replicates <= 500
                && confidenceLevel > 0 && confidenceLevel < 1 && Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffff_ffff
  );

  function toggleDimension(dimension: string): void {
    setDimensions((current) => current.includes(dimension)
      ? current.filter((candidate) => candidate !== dimension)
      : retainedDimensions.filter((candidate) => candidate === dimension || current.includes(candidate)));
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!valid || (!analysis && !prepared)) return;
    const shared = {
      runId: uniqueRunId(kind),
      deadlineEpochMilliseconds: remoteTaskDeadline(),
      sourceResultHash: source.envelope.provenance.resultHash,
    } as const;
    let task: ActivatedAnalysisTaskSpecV1;
    if (kind === "network-comparison") {
      task = { schemaVersion: "3dena.activated-network-comparison-task-spec.v1", kind, ...shared, groups: [groupA, groupB] };
    } else if (kind === "change-network") {
      task = { schemaVersion: "3dena.activated-change-network-task-spec.v1", kind, ...shared, field, level: activeChangeLevel!.rawValue };
    } else if (kind === "statistics") {
      task = {
        schemaVersion: "3dena.activated-statistics-task-spec.v1",
        kind,
        ...shared,
        design,
        groups: [groupA, groupB],
        dimensions,
        alternative,
        adjustment,
        samePhysicalEntityConfirmed: design === "paired" && pairedConfirmed,
      };
    } else if (kind === "trajectory") {
      task = {
        schemaVersion: "3dena.activated-trajectory-task-spec.v1",
        kind,
        ...shared,
        group,
        selectedDimensions: selectedDimensions as [string, string, string],
        cohortPolicy,
        periods: timeOrder.map((time, index) => ({
          sourceTimeCanonical: time.canonical,
          value: timeKind === "date-v1"
            ? { type: "date-v1", value: timeValues[index]! }
            : timeKind === "difftime-v1"
              ? { type: "difftime-v1", value: Number(timeValues[index]), unit: durationUnit, elapsedUnit: durationUnit }
              : { type: "numeric-v1", value: Number(timeValues[index]), unit: timeUnit.trim() },
        })),
        estimand: estimand === "weighted-participant-v1"
          ? { kind: estimand, metadataField: weightField }
          : { kind: estimand },
      };
    } else if (kind === "trajectory-comparison") {
      task = {
        schemaVersion: "3dena.activated-trajectory-comparison-task-spec.v1",
        kind,
        ...shared,
        design,
        groups: [groupA, groupB],
        samePhysicalEntityConfirmed: design === "paired" && pairedConfirmed,
      };
    } else {
      task = {
        schemaVersion: "3dena.activated-bootstrap-task-spec.v1",
        kind,
        ...shared,
        group,
        replicates,
        confidenceLevel,
        seed,
        interval: "pointwise-percentile-type7",
        rotationPolicy: "fixed-preprojected",
      };
    }
    onRun(task);
  }

  if (!analysis && !prepared) {
    return <p className="derived-validation" role="alert">The verified source is not a supported scientific source result.</p>;
  }
  const copy = TASK_COPY[kind];

  return (
    <section className="remote-derived-controls" aria-labelledby="remote-derived-controls-title" data-testid="remote-derived-controls">
      <header>
        <p className="eyebrow">Service-owned source · no raw re-upload</p>
        <h3 id="remote-derived-controls-title">{copy.title}</h3>
        <p>{copy.description}</p>
      </header>
      <form onSubmit={submit}>
        {(kind === "network-comparison" || kind === "statistics" || kind === "trajectory-comparison") && (
          <GroupPairControls idPrefix="remote-derived" groups={groups} groupA={groupA} groupB={groupB} onGroupA={setGroupA} onGroupB={setGroupB} />
        )}
        {(kind === "trajectory" || kind === "bootstrap") && (
          <div className="derived-control-grid">
            <label htmlFor="remote-derived-group">Group<select id="remote-derived-group" value={group} onChange={(event) => setGroup(event.currentTarget.value)}>{groups.map((candidate) => <option value={candidate.canonical} key={candidate.canonical}>{candidate.label}</option>)}</select></label>
          </div>
        )}
        {kind === "change-network" && (
          <div className="derived-control-grid">
            <label htmlFor="remote-derived-field">Field<select id="remote-derived-field" value={field} onChange={(event) => {
              const next = changeFields.find((candidate) => candidate.field === event.currentTarget.value);
              setField(event.currentTarget.value);
              setLevel(next?.levels[0]?.value ?? "");
            }}>{changeFields.map((candidate) => <option value={candidate.field} key={candidate.field}>{candidate.label}</option>)}</select></label>
            <label htmlFor="remote-derived-level">Exact level<select id="remote-derived-level" value={level} onChange={(event) => setLevel(event.currentTarget.value)}>{(activeChangeField?.levels ?? []).map((candidate) => <option value={candidate.value} key={candidate.value}>{candidate.label}</option>)}</select></label>
          </div>
        )}
        {(kind === "statistics" || kind === "trajectory-comparison") && (
          <div className="derived-control-grid derived-control-grid--stats">
            <label htmlFor="remote-derived-design">Study design<select id="remote-derived-design" value={design} onChange={(event) => {
              setDesign(event.currentTarget.value as typeof design);
              setPairedConfirmed(false);
            }}><option value="independent">Independent groups</option><option value="paired">Paired physical entities</option></select></label>
            {kind === "statistics" && <>
              <label htmlFor="remote-derived-alternative">Alternative (A − B)<select id="remote-derived-alternative" value={alternative} onChange={(event) => setAlternative(event.currentTarget.value as typeof alternative)}><option value="two-sided">Two-sided</option><option value="greater">Greater than zero</option><option value="less">Less than zero</option></select></label>
              <label htmlFor="remote-derived-adjustment">P-value adjustment<select id="remote-derived-adjustment" value={adjustment} onChange={(event) => setAdjustment(event.currentTarget.value as typeof adjustment)}><option value="holm">Holm</option><option value="bh">BH / FDR</option><option value="bonferroni">Bonferroni</option><option value="none">None</option></select></label>
            </>}
          </div>
        )}
        {kind === "statistics" && (
          <fieldset className="derived-dimension-fieldset"><legend>Retained full-space dimensions</legend><div className="derived-checkbox-grid">{retainedDimensions.map((dimension) => <label key={dimension}><input type="checkbox" checked={dimensions.includes(dimension)} onChange={() => toggleDimension(dimension)} />{dimension}</label>)}</div></fieldset>
        )}
        {(kind === "statistics" || kind === "trajectory-comparison") && design === "paired" && (
          <label className="derived-confirmation"><input type="checkbox" checked={pairedConfirmed} onChange={(event) => setPairedConfirmed(event.currentTarget.checked)} />I confirm the typed participant-label and time tuples identify the same physical entities across both groups.</label>
        )}
        {kind === "trajectory" && <>
          <div className="derived-control-grid derived-control-grid--stats">
            <label htmlFor="remote-trajectory-cohort">Cohort policy<select id="remote-trajectory-cohort" value={cohortPolicy} onChange={(event) => setCohortPolicy(event.currentTarget.value as typeof cohortPolicy)}><option value="available">Available participants by period</option><option value="complete">Complete histories only</option></select></label>
            <label htmlFor="remote-trajectory-estimand">Centroid estimand<select id="remote-trajectory-estimand" value={estimand} onChange={(event) => setEstimand(event.currentTarget.value as typeof estimand)}><option value="equal-participant-v1">Equal participant</option><option value="weighted-participant-v1">Metadata-weighted participant</option></select></label>
              {estimand === "weighted-participant-v1" && <label htmlFor="remote-trajectory-weight">Positive weight field<select id="remote-trajectory-weight" value={weightField} onChange={(event) => setWeightField(event.currentTarget.value)}>{weightFields.map((candidate) => <option value={candidate} key={candidate}>{candidate}</option>)}</select></label>}
          </div>
          <fieldset className="derived-dimension-fieldset"><legend>Exactly three selected-space dimensions</legend><div className="derived-checkbox-grid">{retainedDimensions.map((dimension) => <label key={dimension}><input type="checkbox" checked={dimensions.includes(dimension)} disabled={!dimensions.includes(dimension) && dimensions.length >= 3} onChange={() => toggleDimension(dimension)} />{dimension}</label>)}</div></fieldset>
          <fieldset className="derived-time-contract"><legend>Explicit ordered time contract</legend>
            <div className="derived-control-grid">
              <label htmlFor="remote-time-kind">Value contract<select id="remote-time-kind" value={timeKind} onChange={(event) => setTimeKind(event.currentTarget.value as TimeContractKind)}><option value="numeric-v1">Numeric</option><option value="date-v1">Civil date</option><option value="difftime-v1">Fixed duration</option></select></label>
              {timeKind === "numeric-v1" && <label htmlFor="remote-time-unit">Exact unit label<input id="remote-time-unit" value={timeUnit} onChange={(event) => setTimeUnit(event.currentTarget.value)} /></label>}
              {timeKind === "difftime-v1" && <label htmlFor="remote-duration-unit">Duration unit<select id="remote-duration-unit" value={durationUnit} onChange={(event) => setDurationUnit(event.currentTarget.value as TrajectoryDurationUnitV1)}>{DURATION_UNITS.map((unit) => <option value={unit} key={unit}>{unit}</option>)}</select></label>}
            </div>
            <div className="table-scroll derived-time-table" role="region" aria-label="Ordered trajectory time values" tabIndex={0}><table><caption>Every source period keeps its canonical identity; only the explicit elapsed-value contract below is assigned.</caption><thead><tr><th scope="col">Source period</th><th scope="col">Canonical key</th><th scope="col">Contract value</th></tr></thead><tbody>{timeOrder.map((time, index) => <tr key={time.canonical}><th scope="row">{time.display}</th><td><code>{time.canonical}</code></td><td><label className="sr-only" htmlFor={`remote-time-${index}`}>Time value for {time.display}</label><input id={`remote-time-${index}`} type={timeKind === "date-v1" ? "date" : "number"} step="any" value={timeValues[index] ?? ""} onChange={(event) => {
              const nextValue = event.currentTarget.value;
              setTimeValues((current) => current.map((value, position) => position === index ? nextValue : value));
            }} /></td></tr>)}</tbody></table></div>
            <p className="validation-hint">Instant/DST-fold contracts are not inferred from display strings. They remain fail-closed until the activated source preserves exact epoch, zone, offset, and fold provenance.</p>
          </fieldset>
        </>}
        {kind === "bootstrap" && (
          <div className="derived-control-grid derived-control-grid--stats">
            <label htmlFor="remote-bootstrap-replicates">Replicates<input id="remote-bootstrap-replicates" type="number" min="200" max="500" step="1" value={replicates} onChange={(event) => setReplicates(Number(event.currentTarget.value))} /></label>
            <label htmlFor="remote-bootstrap-confidence">Confidence level<input id="remote-bootstrap-confidence" type="number" min="0.5" max="0.999" step="0.001" value={confidenceLevel} onChange={(event) => setConfidenceLevel(Number(event.currentTarget.value))} /></label>
            <label htmlFor="remote-bootstrap-seed">Unsigned 32-bit seed<input id="remote-bootstrap-seed" type="number" min="0" max="4294967295" step="1" value={seed} onChange={(event) => setSeed(Number(event.currentTarget.value))} /></label>
          </div>
        )}
        {!valid && <p className="derived-validation" role="alert">Complete the required controls. Group pairs must differ; trajectory space requires exactly three dimensions and a valid value for every ordered period; paired designs require the physical-entity confirmation.</p>}
        <button className="button button--primary" type="submit" disabled={!valid || running || disabled} data-testid="remote-derived-run"><Play size={17} aria-hidden="true" />{running ? "Running on service…" : disabled ? "Delete retained job before running" : `Run ${copy.title.toLowerCase()}`}</button>
      </form>
    </section>
  );
}

function plotLayout(title: string, xTitle: string, left = 82): Partial<Layout> {
  return {
    title: { text: title, font: { size: 17 } },
    autosize: true,
    height: 430,
    margin: { l: left, r: 28, t: 58, b: 72 },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#f8fafc",
    font: { family: "Atkinson Hyperlegible, system-ui, sans-serif", color: "#334155" },
    xaxis: { title: { text: xTitle }, gridcolor: "#e2e8f0", zerolinecolor: "#64748b" },
    yaxis: { gridcolor: "#e2e8f0", automargin: true },
    legend: { orientation: "h", y: -0.18 },
    hoverlabel: { bgcolor: "#0f172a", font: { color: "#ffffff" } },
  };
}

function ResultPlot({ data, layout, summary }: { data: Data[]; layout: Partial<Layout>; summary: string }) {
  return (
    <div className="remote-derived-plot" role="region" aria-label={summary} tabIndex={0} data-testid="remote-derived-visualization">
      <p className="sr-only">{summary} Exact values are available in the following keyboard-scrollable table.</p>
      <Plot data={data} layout={layout} config={{ responsive: true, displaylogo: false, toImageButtonOptions: { format: "svg", filename: "3dena-derived-result" } }} useResizeHandler className="remote-derived-plotly" />
    </div>
  );
}

function ResultTable({ label, caption, headers, rows }: { label: string; caption: string; headers: string[]; rows: Array<Array<string | number>> }) {
  return (
    <div className="table-scroll derived-table" role="region" aria-label={label} tabIndex={0} data-testid="remote-derived-table">
      <table><caption>{caption}</caption><thead><tr>{headers.map((header) => <th scope="col" key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={`${rowIndex}-${String(row[0])}`}>{row.map((cell, index) => index === 0 ? <th scope="row" key={`${index}-${String(cell)}`}>{cell}</th> : <td key={`${index}-${String(cell)}`}>{cell}</td>)}</tr>)}</tbody></table>
    </div>
  );
}

function comparisonOutput(result: NetworkComparisonResultV1) {
  const displayEdges = [...result.differenceEdges]
    .sort((left, right) => Math.abs(right.meanWeight) - Math.abs(left.meanWeight))
    .slice(0, 30);
  const rows = result.differenceEdges.map((edge) => [edge.source + " ↔ " + edge.target, formatDerivedNumber(edge.groupAMeanWeight), formatDerivedNumber(edge.groupBMeanWeight), formatDerivedNumber(edge.meanWeight), edge.semanticOwner]);
  return <><ResultPlot data={[{ type: "bar", orientation: "h", x: displayEdges.map((edge) => edge.meanWeight), y: displayEdges.map((edge) => `${edge.source} ↔ ${edge.target}`), marker: { color: displayEdges.map((edge) => edge.semanticOwner === "group-a" ? "#b91c1c" : edge.semanticOwner === "group-b" ? "#1d4ed8" : "#64748b") }, text: displayEdges.map((edge) => `${formatDerivedNumber(edge.meanWeight)} · ${edge.semanticOwner}`), hovertemplate: "%{y}<br>A − B: %{x:.6g}<extra></extra>" } as Data]} layout={plotLayout("Largest edge differences", "Mean line weight: A − B", 150)} summary="Horizontal chart of up to 30 largest absolute edge differences. Positive values belong to Group A and negative values belong to Group B; the table retains every edge in source order." /><ResultTable label="Network comparison exact values" caption="Mean line-weight difference in source edge order; positive belongs to Group A." headers={["Edge", "A mean", "B mean", "A − B", "Semantic owner"]} rows={rows} /></>;
}

function changeOutput(result: ChangeNetworkResultV1) {
  const displayEdges = [...result.mean.edges]
    .sort((left, right) => Math.abs(right.meanWeight) - Math.abs(left.meanWeight))
    .slice(0, 30);
  const rows = result.mean.edges.map((edge) => [`${edge.source} ↔ ${edge.target}`, formatDerivedNumber(edge.meanWeight)]);
  return <><ResultPlot data={[{ type: "bar", orientation: "h", x: displayEdges.map((edge) => edge.meanWeight), y: displayEdges.map((edge) => `${edge.source} ↔ ${edge.target}`), marker: { color: "#0f766e" }, hovertemplate: "%{y}<br>Mean weight: %{x:.6g}<extra></extra>" } as Data]} layout={plotLayout("Largest selected-level edge weights", "Mean line weight", 150)} summary={`Horizontal chart of up to 30 largest mean edge weights for ${result.selector.field} equals ${String(result.selector.level)}; the table retains every source edge.`} /><ResultTable label="Selected-level network exact values" caption={`Exact mean network for ${result.selector.field} = ${String(result.selector.level)}.`} headers={["Edge", "Mean line weight"]} rows={rows} /></>;
}

function statisticsOutput(result: StatisticsTaskResultV1) {
  const points = result.dimensions.map(({ dimension, result: item }) => {
    const interval = item.estimates.confidenceInterval;
    const mean = item.estimates.meanDifference;
    const lower = interval.lower.kind === "finite" ? interval.lower.value : mean;
    const upper = interval.upper.kind === "finite" ? interval.upper.value : mean;
    return { dimension, mean, lower, upper };
  });
  const rows = result.dimensions.map(({ dimension, result: item }) => [dimension, item.design, formatDerivedNumber(item.estimates.meanDifference), item.estimates.confidenceInterval.lower.kind === "finite" ? formatDerivedNumber(item.estimates.confidenceInterval.lower.value) : item.estimates.confidenceInterval.lower.kind, item.estimates.confidenceInterval.upper.kind === "finite" ? formatDerivedNumber(item.estimates.confidenceInterval.upper.value) : item.estimates.confidenceInterval.upper.kind, formatDerivedNumber(item.design === "independent" ? item.welch.pValue : item.wilcoxonSignedRank.pValue), formatDerivedNumber(item.effects.cohensD), formatDerivedNumber(item.effects.rankBiserial)]);
  return <><ResultPlot data={[{ type: "scatter", mode: "markers", x: points.map((point) => point.mean), y: points.map((point) => point.dimension), marker: { color: "#7c3aed", size: 10 }, error_x: { type: "data", symmetric: false, array: points.map((point) => point.mean !== null && point.upper !== null ? point.upper - point.mean : 0), arrayminus: points.map((point) => point.mean !== null && point.lower !== null ? point.mean - point.lower : 0), color: "#7c3aed", thickness: 1.6 }, hovertemplate: "%{y}<br>A − B: %{x:.6g}<extra></extra>" } as Data]} layout={plotLayout("Mean-difference confidence intervals", "Mean A − B", 90)} summary="Forest plot of dimension-wise mean differences and finite confidence bounds. Exact interval kinds and values are in the table." /><ResultTable label="Inferential statistics exact values" caption="Direction is Group A minus Group B; exact interval kinds remain explicit." headers={["Dimension", "Design", "Mean A − B", "CI lower", "CI upper", "Primary p", "Cohen's d", "Rank-biserial"]} rows={rows} /></>;
}

function trajectoryOutput(result: TrajectoryDynamicsResultV1) {
  const labels = result.periods.map((period) => period.time.display);
  const data = result.selectedDimensions.map((dimension, dimensionIndex) => ({ type: "scatter", mode: "lines+markers", name: dimension, x: labels, y: result.periods.map((period) => period.selectedCentroid?.[dimensionIndex] ?? null), connectgaps: false, line: { color: ["#b91c1c", "#1d4ed8", "#15803d"][dimensionIndex], width: 3 }, marker: { symbol: "square", size: 8 }, hovertemplate: `${dimension}: %{y:.6g}<br>%{x}<extra></extra>` } as Data));
  const rows = result.periods.map((period) => [period.time.display, period.nUsed, ...result.selectedDimensions.map((_, index) => formatDerivedNumber(period.selectedCentroid?.[index] ?? null)), formatDerivedNumber(period.selected3d.stepDistance), formatDerivedNumber(period.selected3d.cumulativeDistance), formatDerivedNumber(period.fullSpace.stepDistance), formatDerivedNumber(period.fullSpace.cumulativeDistance)]);
  return <><ResultPlot data={data} layout={plotLayout("Shared-space trajectory centroids", "Ordered period", 72)} summary="Directional centroid paths for SVD1, SVD2, and SVD3. Missing periods remain gaps and are not bridged." /><ResultTable label="Trajectory dynamics exact values" caption="Selected-space and full-space distances are separate scientific quantities." headers={["Period", "N used", ...result.selectedDimensions, "3D step", "3D cumulative", "Full step", "Full cumulative"]} rows={rows} /></>;
}

function trajectoryComparisonOutput(result: TrajectoryComparisonResult) {
  const labels = result.periods.map((period) => period.time.display);
  const data: Data[] = [{ type: "scatter", mode: "lines+markers", name: "Selected-3D separation", x: labels, y: result.periods.map((period) => period.selectedCentroidSeparation), line: { color: "#1d4ed8", width: 3 }, hovertemplate: "%{x}<br>Selected separation: %{y:.6g}<extra></extra>" } as Data, { type: "scatter", mode: "lines+markers", name: "Full-space separation", x: labels, y: result.periods.map((period) => period.fullCentroidSeparation), line: { color: "#7c3aed", width: 3, dash: "dash" }, hovertemplate: "%{x}<br>Full separation: %{y:.6g}<extra></extra>" } as Data];
  const rows = result.periods.map((period) => [period.time.display, formatDerivedNumber(period.selectedCentroidSeparation), formatDerivedNumber(period.fullCentroidSeparation), formatDerivedNumber(period.selectedStepDistanceDifference), formatDerivedNumber(period.fullStepDistanceDifference), period.nAUsed, period.nBUsed, period.nMatched ?? "—"]);
  return <><ResultPlot data={data} layout={plotLayout("Trajectory separation", "Ordered period", 72)} summary="Selected-three-dimensional and full-space centroid separation by period; differences use B minus A." /><ResultTable label="Trajectory comparison exact values" caption="Distance spaces remain distinct; step differences use B − A." headers={["Period", "3D separation", "Full separation", "3D step B − A", "Full step B − A", "N A", "N B", "Matched"]} rows={rows} /></>;
}

function bootstrapOutput(result: TrajectoryBootstrapResult) {
  const labels = result.periods.map((period) => period.time.display);
  const intervals = result.periods.map((period) => period.selectedCumulativeDistance);
  const data: Data[] = [{ type: "scatter", mode: "lines+markers", name: "Selected-3D cumulative distance", x: labels, y: intervals.map((interval) => interval?.estimate ?? null), line: { color: "#0f766e", width: 3 }, error_y: { type: "data", symmetric: false, array: intervals.map((interval) => interval ? interval.upper - interval.estimate : 0), arrayminus: intervals.map((interval) => interval ? interval.estimate - interval.lower : 0), color: "#0f766e", thickness: 1.5 }, hovertemplate: "%{x}<br>Estimate: %{y:.6g}<extra></extra>" } as Data];
  const rows = result.periods.map((period) => [period.time.display, formatDerivedNumber(period.selectedCumulativeDistance?.estimate ?? null), formatDerivedNumber(period.selectedCumulativeDistance?.lower ?? null), formatDerivedNumber(period.selectedCumulativeDistance?.upper ?? null), formatDerivedNumber(period.fullCumulativeDistance?.estimate ?? null), formatDerivedNumber(period.fullCumulativeDistance?.lower ?? null), formatDerivedNumber(period.fullCumulativeDistance?.upper ?? null), period.selectedCumulativeDistance?.finiteReplicates ?? 0]);
  return <><ResultPlot data={data} layout={plotLayout(`${Math.round(result.confidenceLevel * 100)}% pointwise trajectory intervals`, "Ordered period", 72)} summary="Pointwise percentile interval chart for selected-three-dimensional cumulative trajectory distance." /><ResultTable label="Bootstrap uncertainty exact values" caption="Participant complete-history resampling; pointwise linear Type-7 percentile intervals." headers={["Period", "3D estimate", "3D lower", "3D upper", "Full estimate", "Full lower", "Full upper", "Finite replicates"]} rows={rows} /></>;
}

export function RemoteDerivedResult({ verified }: { verified: VerifiedRemoteAnalysisResult }) {
  const result: AnalysisTaskResultV1 = verified.envelope.result;
  let output: React.ReactNode = null;
  if (result.schemaVersion === "3dena.network-comparison.v1") output = comparisonOutput(result);
  else if (result.schemaVersion === "3dena.change-network.v1") output = changeOutput(result);
  else if (result.schemaVersion === "3dena.statistics-task-result.v1") output = statisticsOutput(result);
  else if (result.schemaVersion === "3dena.trajectory-dynamics.v1") output = trajectoryOutput(result);
  else if (result.schemaVersion === "3dena.trajectory-comparison.v1") output = trajectoryComparisonOutput(result);
  else if (result.schemaVersion === "3dena.trajectory-bootstrap.v1") output = bootstrapOutput(result);
  if (!output) return null;
  return (
    <section className="analysis-results remote-derived-result" aria-labelledby="remote-derived-result-title" data-task-kind={verified.envelope.taskKind} data-testid="remote-derived-result">
      <header className="results-heading"><div><p className="eyebrow">Verified service result</p><h2 id="remote-derived-result-title">{TASK_COPY[verified.envelope.taskKind as DerivedTaskKind].title}</h2><p>Exact downloaded bytes passed receipt hash, schema variant, build, dataset, specification, run, and task ownership checks.</p></div></header>
      <div className="derived-output">{output}<DerivedDiagnostics diagnostics={verified.envelope.diagnostics} titleId="remote-derived-diagnostics" /></div>
    </section>
  );
}
