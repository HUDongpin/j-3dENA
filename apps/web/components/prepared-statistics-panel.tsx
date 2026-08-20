"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Download } from "lucide-react";
import type { StatisticsTaskResultV1 } from "@3dena/analysis";
import {
  DerivedDiagnostics,
  DerivedStatus,
  GroupPairControls,
  RunDerivedActions,
} from "@/components/derived-panel-ui";
import { StatisticsTable } from "@/components/raw-statistics-panel";
import { downloadDerivedResult } from "@/lib/derived-download";
import { preparedGroupOptions } from "@/lib/prepared-derived-options";
import type { PreparedDerivedSource } from "@/lib/use-derived-analysis";
import { useDerivedAnalysis } from "@/lib/use-derived-analysis";
import type { RunOwner } from "@/lib/worker-protocol";

export function PreparedStatisticsPanel({
  source,
  owner,
}: {
  source: PreparedDerivedSource;
  owner: RunOwner;
}) {
  const groups = useMemo(() => preparedGroupOptions(source.result), [source.result]);
  const [groupA, setGroupA] = useState(groups[0]?.canonical ?? "");
  const [groupB, setGroupB] = useState(groups[1]?.canonical ?? "");
  const [dimensions, setDimensions] = useState<string[]>([
    ...source.result.displaySpace.dimensions,
  ]);
  const [design, setDesign] = useState<"independent" | "paired">("independent");
  const [alternative, setAlternative] = useState<"two-sided" | "greater" | "less">("two-sided");
  const [adjustment, setAdjustment] = useState<"none" | "holm" | "bh" | "bonferroni">("holm");
  const [pairedConfirmed, setPairedConfirmed] = useState(false);
  const controller = useDerivedAnalysis(source, owner);
  const envelope = controller.state.envelope;
  const result: StatisticsTaskResultV1 | null =
    envelope?.result.schemaVersion === "3dena.statistics-task-result.v1"
    ? envelope.result
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
      : source.result.fullSpace.dimensions.filter(
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
    <section className="derived-panel derived-panel--prepared" aria-labelledby="prepared-statistics-title" data-testid="prepared-statistics-panel">
      <header>
        <p className="eyebrow">AnalysisTask · prepared coordinates</p>
        <h3 id="prepared-statistics-title">Prepared inferential statistics</h3>
        <p>
          Runs the public statistics task over imported full-space coordinates,
          including Welch/rank-sum or exact typed participant-time paired
          inference. The source remains a precomputed exchange, not a jENA refit.
        </p>
      </header>
      <form onSubmit={submit}>
        <GroupPairControls
          idPrefix="prepared-statistics"
          groups={groups}
          groupA={groupA}
          groupB={groupB}
          onGroupA={(value) => changed(() => setGroupA(value))}
          onGroupB={(value) => changed(() => setGroupB(value))}
        />
        <div className="derived-control-grid derived-control-grid--stats">
          <label htmlFor="prepared-statistics-design">
            Study design
            <select
              id="prepared-statistics-design"
              value={design}
              onChange={(event) => changed(() => {
                setDesign(event.currentTarget.value as typeof design);
                setPairedConfirmed(false);
              })}
              data-testid="prepared-statistics-design"
            >
              <option value="independent">Independent groups</option>
              <option value="paired">Paired entities</option>
            </select>
          </label>
          <label htmlFor="prepared-statistics-alternative">
            Alternative (A − B)
            <select
              id="prepared-statistics-alternative"
              value={alternative}
              onChange={(event) => changed(() => setAlternative(
                event.currentTarget.value as typeof alternative,
              ))}
              data-testid="prepared-statistics-alternative"
            >
              <option value="two-sided">Two-sided</option>
              <option value="greater">Greater than zero</option>
              <option value="less">Less than zero</option>
            </select>
          </label>
          <label htmlFor="prepared-statistics-adjustment">
            P-value adjustment
            <select
              id="prepared-statistics-adjustment"
              value={adjustment}
              onChange={(event) => changed(() => setAdjustment(
                event.currentTarget.value as typeof adjustment,
              ))}
              data-testid="prepared-statistics-adjustment"
            >
              <option value="holm">Holm</option>
              <option value="bh">BH / FDR</option>
              <option value="bonferroni">Bonferroni</option>
              <option value="none">None</option>
            </select>
          </label>
        </div>
        <fieldset className="derived-dimension-fieldset">
          <legend>Imported full-space dimensions</legend>
          <div className="derived-checkbox-grid">
            {source.result.fullSpace.dimensions.map((dimension) => (
              <label key={dimension}>
                <input
                  type="checkbox"
                  checked={dimensions.includes(dimension)}
                  onChange={() => toggleDimension(dimension)}
                  data-testid={`prepared-statistics-dimension-${dimension}`}
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
              data-testid="prepared-statistics-paired-confirmation"
            />
            I confirm that the complete typed participant identity and time tuple
            identify the same physical entity across Group A and Group B.
          </label>
        )}
        {!valid && (
          <p className="derived-validation">
            Select two different groups and at least one imported dimension
            {design === "paired" ? ", then confirm the physical-entity pairing" : ""}.
          </p>
        )}
        <RunDerivedActions
          running={controller.state.status === "running"}
          disabled={!valid}
          runLabel="Run prepared statistics"
          runTestId="prepared-statistics-run"
          onCancel={controller.cancel}
        />
      </form>
      <DerivedStatus
        status={controller.state.status}
        message={controller.state.message}
        errorCode={controller.state.errorCode}
        testId="prepared-statistics-status"
      />
      {result && envelope && controller.state.owner && (
        <div className="derived-output" data-testid="prepared-statistics-result">
          <div className="prepared-derived-boundary" role="note">
            <strong>IMPLEMENTED_UNVERIFIED · public AnalysisTask over precomputed input</strong>
            <span>source: {envelope.provenance.sourceKind} · jENA executed: no · raw recompute: no</span>
          </div>
          <dl className="derived-summary">
            <div><dt>Design</dt><dd>{result.design}</dd></div>
            <div><dt>Dimensions</dt><dd>{result.dimensions.length}</dd></div>
            <div><dt>Direction</dt><dd>A − B</dd></div>
          </dl>
          <StatisticsTable
            result={result}
            ariaLabel="Prepared inferential statistics table"
            testId="prepared-statistics-table"
          />
          <DerivedDiagnostics
            diagnostics={result.dimensions.flatMap(({ dimension, result: dimensionResult }) =>
              dimensionResult.diagnostics.map((diagnostic) => ({
                ...diagnostic,
                path: diagnostic.path ?? `dimensions.${dimension}`,
              })),
            )}
            titleId="prepared-statistics-diagnostics"
          />
          <button
            className="button button--secondary derived-download"
            type="button"
            onClick={() => downloadDerivedResult({
              mode: "prepared-exchange",
              feature: "statistics",
              owner: controller.state.owner!,
              envelope,
            }, source.result.sourceReceipt.name)}
            data-testid="prepared-statistics-download"
          >
            <Download size={17} aria-hidden="true" /> Download prepared statistics JSON
          </button>
        </div>
      )}
    </section>
  );
}
