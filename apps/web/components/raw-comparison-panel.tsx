"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { NetworkComparisonResultV1 } from "@3dena/analysis";
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

function ComparisonTable({ result }: { result: NetworkComparisonResultV1 }) {
  return (
    <div
      className="table-scroll derived-table"
      role="region"
      aria-label="Raw group network comparison table"
      tabIndex={0}
      data-testid="raw-comparison-table"
    >
      <table>
        <caption>
          Mean line-weight difference in source edge order; positive belongs to Group A.
        </caption>
        <thead>
          <tr>
            <th scope="col">Edge</th>
            <th scope="col">Group A mean</th>
            <th scope="col">Group B mean</th>
            <th scope="col">A − B</th>
            <th scope="col">Semantic owner</th>
          </tr>
        </thead>
        <tbody>
          {result.differenceEdges.map((edge) => (
            <tr key={edge.id}>
              <th scope="row">{edge.source} ↔ {edge.target}</th>
              <td>{formatDerivedNumber(edge.groupAMeanWeight)}</td>
              <td>{formatDerivedNumber(edge.groupBMeanWeight)}</td>
              <td>{formatDerivedNumber(edge.meanWeight)}</td>
              <td>{edge.semanticOwner}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RawComparisonPanel({
  source,
  owner,
}: {
  source: RawDerivedSource;
  owner: RunOwner;
}) {
  const groups = useMemo(() => rawGroupOptions(source.result), [source.result]);
  const [groupA, setGroupA] = useState(groups[0]?.canonical ?? "");
  const [groupB, setGroupB] = useState(groups[1]?.canonical ?? "");
  const controller = useDerivedAnalysis(source, owner);
  const result = controller.state.envelope?.result.schemaVersion === "3dena.network-comparison.v1"
    ? controller.state.envelope.result
    : null;
  const valid = groups.length >= 2 && groupA !== "" && groupB !== "" && groupA !== groupB;

  function select(setter: (value: string) => void, value: string): void {
    setter(value);
    controller.markStale();
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!valid) return;
    void controller.run({ kind: "network-comparison", groups: [groupA, groupB] });
  }

  return (
    <section className="derived-panel" aria-labelledby="raw-comparison-title" data-testid="raw-comparison-panel">
      <header>
        <p className="eyebrow">AnalysisTask · network core</p>
        <h3 id="raw-comparison-title">Group network comparison</h3>
        <p>
          Computes mean(Group A) − mean(Group B) over this owned jENA result&apos;s
          line weights. The source model is hashed and is never refit.
        </p>
      </header>
      <form onSubmit={submit}>
        <GroupPairControls
          idPrefix="raw-comparison"
          groups={groups}
          groupA={groupA}
          groupB={groupB}
          onGroupA={(value) => select(setGroupA, value)}
          onGroupB={(value) => select(setGroupB, value)}
        />
        {!valid && <p className="derived-validation">Select two different non-empty groups.</p>}
        <RunDerivedActions
          running={controller.state.status === "running"}
          disabled={!valid}
          runLabel="Run comparison"
          runTestId="raw-comparison-run"
          onCancel={controller.cancel}
        />
      </form>
      <DerivedStatus
        status={controller.state.status}
        message={controller.state.message}
        errorCode={controller.state.errorCode}
        testId="raw-comparison-status"
      />
      {result && controller.state.owner && controller.state.envelope && (
        <div className="derived-output" data-testid="raw-comparison-result">
          <dl className="derived-summary">
            <div><dt>Group A points</dt><dd>{result.meanA.pointCount}</dd></div>
            <div><dt>Group B points</dt><dd>{result.meanB.pointCount}</dd></div>
            <div><dt>Direction</dt><dd>A − B</dd></div>
          </dl>
          <ComparisonTable result={result} />
          <DerivedDiagnostics diagnostics={result.diagnostics} titleId="raw-comparison-diagnostics" />
          <button
            className="button button--secondary derived-download"
            type="button"
            onClick={() => downloadDerivedResult({
              mode: "raw-jena",
              feature: "comparison",
              owner: controller.state.owner!,
              envelope: controller.state.envelope,
            }, source.name)}
            data-testid="raw-comparison-download"
          >
            <Download size={17} aria-hidden="true" /> Download comparison JSON
          </button>
        </div>
      )}
    </section>
  );
}
