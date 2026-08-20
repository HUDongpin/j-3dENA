"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Download } from "lucide-react";
import type { NetworkComparisonResultV1 } from "@3dena/analysis";
import {
  DerivedDiagnostics,
  DerivedStatus,
  GroupPairControls,
  RunDerivedActions,
  formatDerivedNumber,
} from "@/components/derived-panel-ui";
import { downloadDerivedResult } from "@/lib/derived-download";
import { preparedGroupOptions } from "@/lib/prepared-derived-options";
import type { PreparedDerivedSource } from "@/lib/use-derived-analysis";
import { useDerivedAnalysis } from "@/lib/use-derived-analysis";
import type { RunOwner } from "@/lib/worker-protocol";

function PreparedComparisonTable({ result }: { result: NetworkComparisonResultV1 }) {
  return (
    <div
      className="table-scroll derived-table"
      role="region"
      aria-label="Prepared group network comparison table"
      tabIndex={0}
      data-testid="prepared-comparison-table"
    >
      <table>
        <caption>
          Descriptive mean line-weight difference over imported prepared rows; positive belongs to Group A.
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

export function PreparedComparisonPanel({
  source,
  owner,
}: {
  source: PreparedDerivedSource;
  owner: RunOwner;
}) {
  const groups = useMemo(() => preparedGroupOptions(source.result), [source.result]);
  const [groupA, setGroupA] = useState(groups[0]?.canonical ?? "");
  const [groupB, setGroupB] = useState(groups[1]?.canonical ?? "");
  const controller = useDerivedAnalysis(source, owner);
  const envelope = controller.state.envelope;
  const result = envelope?.result.schemaVersion === "3dena.network-comparison.v1"
    ? envelope.result
    : null;
  const valid = groups.length >= 2 && groupA !== groupB;

  function changed(setter: (value: string) => void, value: string): void {
    setter(value);
    controller.markStale();
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!valid) return;
    void controller.run({ kind: "network-comparison", groups: [groupA, groupB] });
  }

  return (
    <section className="derived-panel derived-panel--prepared" aria-labelledby="prepared-comparison-title" data-testid="prepared-comparison-panel">
      <header>
        <p className="eyebrow">Prepared precomputed reduction</p>
        <h3 id="prepared-comparison-title">Imported group network comparison</h3>
        <p>
          Runs the public AnalysisTask contract over aligned imported line weights
          in a dedicated Worker. This remains prepared-space output, not a raw-row
          jENA refit or parity claim.
        </p>
      </header>
      <form onSubmit={submit}>
        <GroupPairControls
          idPrefix="prepared-comparison"
          groups={groups}
          groupA={groupA}
          groupB={groupB}
          onGroupA={(value) => changed(setGroupA, value)}
          onGroupB={(value) => changed(setGroupB, value)}
        />
        {!valid && <p className="derived-validation">Select two different groups.</p>}
        <RunDerivedActions
          running={controller.state.status === "running"}
          disabled={!valid}
          runLabel="Run prepared comparison"
          runTestId="prepared-comparison-run"
          onCancel={controller.cancel}
        />
      </form>
      <DerivedStatus
        status={controller.state.status}
        message={controller.state.message}
        errorCode={controller.state.errorCode}
        testId="prepared-comparison-status"
      />
      {result && envelope && controller.state.owner && (
        <div className="derived-output" data-testid="prepared-comparison-result">
          <div className="prepared-derived-boundary" role="note">
            <strong>IMPLEMENTED_UNVERIFIED · public AnalysisTask over precomputed input</strong>
            <span>source: {envelope.provenance.sourceKind} · jENA executed: no · parity approval: no</span>
          </div>
          <dl className="derived-summary">
            <div><dt>Group A points</dt><dd>{result.meanA.pointCount}</dd></div>
            <div><dt>Group B points</dt><dd>{result.meanB.pointCount}</dd></div>
            <div><dt>Direction</dt><dd>A − B</dd></div>
          </dl>
          <PreparedComparisonTable result={result} />
          <DerivedDiagnostics diagnostics={result.diagnostics} titleId="prepared-comparison-diagnostics" />
          <button
            className="button button--secondary derived-download"
            type="button"
            onClick={() => downloadDerivedResult({
              mode: "prepared-exchange",
              feature: "comparison",
              owner: controller.state.owner!,
              envelope,
            }, source.result.sourceReceipt.name)}
            data-testid="prepared-comparison-download"
          >
            <Download size={17} aria-hidden="true" /> Download prepared comparison JSON
          </button>
        </div>
      )}
    </section>
  );
}
