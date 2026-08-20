"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { StatisticsTaskResultV1 } from "@3dena/analysis";
import { Download } from "lucide-react";
import {
  DerivedDiagnostics,
  DerivedStatus,
  GroupPairControls,
  RunDerivedActions,
  formatDerivedNumber,
} from "@/components/derived-panel-ui";
import { downloadDerivedResult } from "@/lib/derived-download";
import { rawGroupOptions } from "@/lib/raw-derived-options";
import type { RawDerivedSource } from "@/lib/use-derived-analysis";
import { useDerivedAnalysis } from "@/lib/use-derived-analysis";
import type { RunOwner } from "@/lib/worker-protocol";

type ConfidenceInterval = StatisticsTaskResultV1["dimensions"][number]["result"]["estimates"]["confidenceInterval"];

function formatConfidenceBound(bound: ConfidenceInterval["lower"] | ConfidenceInterval["upper"]): string {
  if (bound.kind === "finite") return formatDerivedNumber(bound.value);
  if (bound.kind === "negative-infinity") return "−∞";
  if (bound.kind === "positive-infinity") return "+∞";
  if (bound.kind === "undefined") return "undefined";
  return "unrepresentable";
}

function formatConfidenceInterval(interval: ConfidenceInterval): string {
  return `${formatConfidenceBound(interval.lower)}, ${formatConfidenceBound(interval.upper)}`;
}

export function StatisticsTable({
  result,
  ariaLabel = "Raw inferential statistics table",
  testId = "raw-statistics-table",
}: {
  result: StatisticsTaskResultV1;
  ariaLabel?: string;
  testId?: string;
}) {
  return (
    <div
      className="table-scroll derived-table"
      role="region"
      aria-label={ariaLabel}
      tabIndex={0}
      data-testid={testId}
    >
      <table>
        <caption>
          {result.design === "independent"
            ? "Welch t mean-difference confidence intervals and inference, plus Mann–Whitney rank-sum inference; p adjustments are applied within each dimension's two-test family."
            : "Exact participant-time matching with paired-t mean-difference confidence intervals and Wilcoxon signed-rank inference."}
        </caption>
        <thead>
          <tr>
            <th scope="col">Dimension</th>
            <th scope="col">Valid N</th>
            <th scope="col">Mean A − B</th>
            <th scope="col">95% mean-difference CI (A − B)</th>
            <th scope="col">Parametric / signed-rank p</th>
            <th scope="col">Rank-sum p</th>
            <th scope="col">Cohen&apos;s d</th>
            <th scope="col">Rank-biserial</th>
          </tr>
        </thead>
        <tbody>
          {result.dimensions.map(({ dimension, result: dimensionResult }) => {
            if (dimensionResult.schemaVersion === "3dena.stats.independent-result.v1") {
              return (
                <tr key={dimension}>
                  <th scope="row">{dimension}</th>
                  <td>{dimensionResult.samples.sideA.valid} / {dimensionResult.samples.sideB.valid}</td>
                  <td>{formatDerivedNumber(dimensionResult.estimates.meanDifference)}</td>
                  <td>
                    {formatConfidenceInterval(dimensionResult.estimates.confidenceInterval)}
                    <small>CI method: {dimensionResult.estimates.confidenceInterval.method}</small>
                  </td>
                  <td>
                    {formatDerivedNumber(dimensionResult.welch.pValue)}
                    <small>adjusted {formatDerivedNumber(dimensionResult.adjustment.adjusted[0] ?? null)}</small>
                  </td>
                  <td>
                    {formatDerivedNumber(dimensionResult.mannWhitney.pValue)}
                    <small>adjusted {formatDerivedNumber(dimensionResult.adjustment.adjusted[1] ?? null)}</small>
                  </td>
                  <td>{formatDerivedNumber(dimensionResult.effects.cohensD)}</td>
                  <td>{formatDerivedNumber(dimensionResult.effects.rankBiserial)}</td>
                </tr>
              );
            }
            return (
              <tr key={dimension}>
                <th scope="row">{dimension}</th>
                <td>{dimensionResult.matching.validPairs} matched</td>
                <td>{formatDerivedNumber(dimensionResult.estimates.meanDifference)}</td>
                <td>
                  {formatConfidenceInterval(dimensionResult.estimates.confidenceInterval)}
                  <small>CI method: {dimensionResult.estimates.confidenceInterval.method}</small>
                </td>
                <td>
                  {formatDerivedNumber(dimensionResult.wilcoxonSignedRank.pValue)}
                  <small>adjusted {formatDerivedNumber(dimensionResult.adjustment.adjusted[0] ?? null)}</small>
                </td>
                <td>—</td>
                <td>{formatDerivedNumber(dimensionResult.effects.cohensD)}</td>
                <td>{formatDerivedNumber(dimensionResult.effects.rankBiserial)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function RawStatisticsPanel({
  source,
  owner,
}: {
  source: RawDerivedSource;
  owner: RunOwner;
}) {
  const groups = useMemo(() => rawGroupOptions(source.result), [source.result]);
  const retainedDimensions = source.result.dimensions ?? [...source.result.axes];
  const [groupA, setGroupA] = useState(groups[0]?.canonical ?? "");
  const [groupB, setGroupB] = useState(groups[1]?.canonical ?? "");
  const [design, setDesign] = useState<"independent" | "paired">("independent");
  const [dimensions, setDimensions] = useState<string[]>([...source.result.axes]);
  const [alternative, setAlternative] = useState<"two-sided" | "greater" | "less">("two-sided");
  const [adjustment, setAdjustment] = useState<"none" | "holm" | "bh" | "bonferroni">("holm");
  const [pairedConfirmed, setPairedConfirmed] = useState(false);
  const controller = useDerivedAnalysis(source, owner);
  const result = controller.state.envelope?.result.schemaVersion === "3dena.statistics-task-result.v1"
    ? controller.state.envelope.result
    : null;
  const valid = groups.length >= 2
    && groupA !== groupB
    && dimensions.length > 0
    && (design === "independent" || pairedConfirmed);

  function changed(callback: () => void): void {
    callback();
    controller.markStale();
  }

  function toggleDimension(dimension: string): void {
    changed(() => setDimensions((current) => current.includes(dimension)
      ? current.filter((candidate) => candidate !== dimension)
      : retainedDimensions.filter(
          (candidate) => candidate === dimension || current.includes(candidate),
        )));
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!valid) return;
    void controller.run({
      kind: "statistics",
      design,
      groups: [groupA, groupB],
      dimensions,
      alternative,
      adjustment,
      samePhysicalEntityConfirmed: design === "paired" && pairedConfirmed,
    });
  }

  return (
    <section className="derived-panel" aria-labelledby="raw-statistics-title" data-testid="raw-statistics-panel">
      <header>
        <p className="eyebrow">AnalysisTask · statistics core</p>
        <h3 id="raw-statistics-title">Inferential statistics</h3>
        <p>
          Runs versioned Welch t or paired-t mean-difference confidence intervals
          alongside the applicable Welch, rank-sum, or exact participant-time
          signed-rank inference over retained full-space coordinates.
        </p>
      </header>
      <form onSubmit={submit}>
        <GroupPairControls
          idPrefix="raw-statistics"
          groups={groups}
          groupA={groupA}
          groupB={groupB}
          onGroupA={(value) => changed(() => setGroupA(value))}
          onGroupB={(value) => changed(() => setGroupB(value))}
        />
        <div className="derived-control-grid derived-control-grid--stats">
          <label htmlFor="raw-statistics-design">
            Study design
            <select
              id="raw-statistics-design"
              value={design}
              onChange={(event) => changed(() => {
                setDesign(event.currentTarget.value as "independent" | "paired");
                setPairedConfirmed(false);
              })}
              data-testid="raw-statistics-design"
            >
              <option value="independent">Independent groups</option>
              <option value="paired">Paired entities</option>
            </select>
          </label>
          <label htmlFor="raw-statistics-alternative">
            Alternative (A − B)
            <select
              id="raw-statistics-alternative"
              value={alternative}
              onChange={(event) => changed(() => setAlternative(
                event.currentTarget.value as typeof alternative,
              ))}
              data-testid="raw-statistics-alternative"
            >
              <option value="two-sided">Two-sided</option>
              <option value="greater">Greater than zero</option>
              <option value="less">Less than zero</option>
            </select>
          </label>
          <label htmlFor="raw-statistics-adjustment">
            P-value adjustment
            <select
              id="raw-statistics-adjustment"
              value={adjustment}
              onChange={(event) => changed(() => setAdjustment(
                event.currentTarget.value as typeof adjustment,
              ))}
              data-testid="raw-statistics-adjustment"
            >
              <option value="holm">Holm</option>
              <option value="bh">BH / FDR</option>
              <option value="bonferroni">Bonferroni</option>
              <option value="none">None</option>
            </select>
          </label>
        </div>
        <fieldset className="derived-dimension-fieldset">
          <legend>Retained dimensions</legend>
          <div className="derived-checkbox-grid">
            {retainedDimensions.map((dimension) => (
              <label key={dimension}>
                <input
                  type="checkbox"
                  checked={dimensions.includes(dimension)}
                  onChange={() => toggleDimension(dimension)}
                  data-testid={`raw-statistics-dimension-${dimension}`}
                />
                {dimension}
              </label>
            ))}
          </div>
        </fieldset>
        {design === "paired" && (
          <label className="derived-confirmation">
            <input
              type="checkbox"
              checked={pairedConfirmed}
              onChange={(event) => changed(() => setPairedConfirmed(event.currentTarget.checked))}
              data-testid="raw-statistics-paired-confirmation"
            />
            I confirm that matching participant-label and time tuples identify
            the same physical entities across Group A and Group B.
          </label>
        )}
        {!valid && (
          <p className="derived-validation">
            Select two different groups and at least one dimension
            {design === "paired" ? ", then confirm the physical-entity pairing" : ""}.
          </p>
        )}
        <RunDerivedActions
          running={controller.state.status === "running"}
          disabled={!valid}
          runLabel="Run statistics"
          runTestId="raw-statistics-run"
          onCancel={controller.cancel}
        />
      </form>
      <DerivedStatus
        status={controller.state.status}
        message={controller.state.message}
        errorCode={controller.state.errorCode}
        testId="raw-statistics-status"
      />
      {result && controller.state.owner && controller.state.envelope && (
        <div className="derived-output" data-testid="raw-statistics-result">
          <dl className="derived-summary">
            <div><dt>Design</dt><dd>{result.design}</dd></div>
            <div><dt>Dimensions</dt><dd>{result.dimensions.length}</dd></div>
            <div><dt>Direction</dt><dd>A − B</dd></div>
          </dl>
          <StatisticsTable result={result} />
          <DerivedDiagnostics
            diagnostics={result.dimensions.flatMap(({ dimension, result: dimensionResult }) =>
              dimensionResult.diagnostics.map((diagnostic) => ({
                ...diagnostic,
                path: diagnostic.path ?? `dimensions.${dimension}`,
              })),
            )}
            titleId="raw-statistics-diagnostics"
          />
          <button
            className="button button--secondary derived-download"
            type="button"
            onClick={() => downloadDerivedResult({
              mode: "raw-jena",
              feature: "statistics",
              owner: controller.state.owner!,
              envelope: controller.state.envelope,
            }, source.name)}
            data-testid="raw-statistics-download"
          >
            <Download size={17} aria-hidden="true" /> Download statistics JSON
          </button>
        </div>
      )}
    </section>
  );
}
