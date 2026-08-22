"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Download } from "lucide-react";
import type { ChangeNetworkResultV1 } from "@3dena/analysis";
import {
  DerivedDiagnostics,
  DerivedStatus,
  RunDerivedActions,
  formatDerivedNumber,
} from "@/components/derived-panel-ui";
import { downloadDerivedResult } from "@/lib/derived-download";
import {
  preparedChangeFieldOptions,
} from "@/lib/prepared-derived-options";
import type { PreparedDerivedSource } from "@/lib/use-derived-analysis";
import { useDerivedAnalysis } from "@/lib/use-derived-analysis";
import type { RunOwner } from "@/lib/worker-protocol";

function PreparedChangeTable({ result }: { result: ChangeNetworkResultV1 }) {
  return (
    <div
      className="table-scroll derived-table"
      role="region"
      aria-label="Prepared selected-level network table"
      tabIndex={0}
      data-testid="prepared-change-table"
    >
      <table>
        <caption>
          Imported mean network for {result.selector.field} = {String(result.selector.level)}.
        </caption>
        <thead><tr><th scope="col">Edge</th><th scope="col">Mean line weight</th></tr></thead>
        <tbody>
          {result.mean.edges.map((edge) => (
            <tr key={edge.id}>
              <th scope="row">{edge.source} ↔ {edge.target}</th>
              <td>{formatDerivedNumber(edge.meanWeight)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PreparedChangePanel({
  source,
  owner,
}: {
  source: PreparedDerivedSource;
  owner: RunOwner;
}) {
  const fields = useMemo(
    () => preparedChangeFieldOptions(source.result),
    [source.result],
  );
  const [field, setField] = useState(fields[0]?.field ?? "");
  const [levelToken, setLevelToken] = useState(fields[0]?.levels[0]?.token ?? "");
  const controller = useDerivedAnalysis(source, owner);
  const activeField = fields.find((candidate) => candidate.field === field);
  const activeLevel = activeField?.levels.find((candidate) => candidate.token === levelToken);
  const envelope = controller.state.envelope;
  const result = envelope?.result.schemaVersion === "3dena.change-network.v1"
    ? envelope.result
    : null;

  function changeField(nextField: string): void {
    const next = fields.find((candidate) => candidate.field === nextField);
    setField(nextField);
    setLevelToken(next?.levels[0]?.token ?? "");
    controller.markStale();
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!activeLevel) return;
    void controller.run({
      kind: "change-network",
      field,
      level: activeLevel.level,
    });
  }

  return (
    <section className="derived-panel derived-panel--prepared" aria-labelledby="prepared-change-title" data-testid="prepared-change-panel">
      <header>
        <p className="eyebrow">Prepared precomputed reduction</p>
        <h3 id="prepared-change-title">Imported exact level network</h3>
        <p>
          Preserves typed string, number, boolean, and null identities while the
          public AnalysisTask executor reduces selected prepared rows. No
          rotation or longitudinal contrast is created.
        </p>
      </header>
      <form onSubmit={submit}>
        <div className="derived-control-grid">
          <label htmlFor="prepared-change-field">
            Field
            <select
              id="prepared-change-field"
              value={field}
              onChange={(event) => changeField(event.currentTarget.value)}
              data-testid="prepared-change-field"
            >
              {fields.map((candidate) => (
                <option key={candidate.field} value={candidate.field}>{candidate.label}</option>
              ))}
            </select>
          </label>
          <label htmlFor="prepared-change-level">
            Exact typed level
            <select
              id="prepared-change-level"
              value={levelToken}
              onChange={(event) => {
                setLevelToken(event.currentTarget.value);
                controller.markStale();
              }}
              data-testid="prepared-change-level"
            >
              {(activeField?.levels ?? []).map((candidate) => (
                <option key={candidate.token} value={candidate.token}>{candidate.label}</option>
              ))}
            </select>
          </label>
        </div>
        {!activeLevel && <p className="derived-validation">Select one available typed level.</p>}
        <RunDerivedActions
          running={controller.state.status === "running"}
          disabled={!activeLevel}
          runLabel="Run prepared level network"
          runTestId="prepared-change-run"
          onCancel={controller.cancel}
        />
      </form>
      <DerivedStatus
        status={controller.state.status}
        message={controller.state.message}
        errorCode={controller.state.errorCode}
        testId="prepared-change-status"
      />
      {result && envelope && controller.state.owner && (
        <div className="derived-output" data-testid="prepared-change-result">
          <div className="prepared-derived-boundary" role="note">
            <strong>IMPLEMENTED_UNVERIFIED · public AnalysisTask over precomputed input</strong>
            <span>source: {envelope.provenance.sourceKind} · jENA executed: no · longitudinal contrast: no</span>
          </div>
          <dl className="derived-summary">
            <div><dt>Selected points</dt><dd>{result.mean.pointCount}</dd></div>
            <div><dt>Field</dt><dd>{result.selector.field}</dd></div>
            <div><dt>Level</dt><dd>{String(result.selector.level)}</dd></div>
          </dl>
          <PreparedChangeTable result={result} />
          <DerivedDiagnostics diagnostics={result.diagnostics} titleId="prepared-change-diagnostics" />
          <button
            className="button button--secondary derived-download"
            type="button"
            onClick={() => downloadDerivedResult({
              mode: "prepared-exchange",
              feature: "change",
              owner: controller.state.owner!,
              envelope,
            }, source.result.sourceReceipt.name)}
            data-testid="prepared-change-download"
          >
            <Download size={17} aria-hidden="true" /> Download prepared level-network JSON
          </button>
        </div>
      )}
    </section>
  );
}
