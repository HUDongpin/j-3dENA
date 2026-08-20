"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { ChangeNetworkResultV1 } from "@3dena/analysis";
import { Download } from "lucide-react";
import {
  DerivedDiagnostics,
  DerivedStatus,
  RunDerivedActions,
  formatDerivedNumber,
} from "@/components/derived-panel-ui";
import { downloadDerivedResult } from "@/lib/derived-download";
import { rawChangeFieldOptions } from "@/lib/raw-derived-options";
import type { RawDerivedSource } from "@/lib/use-derived-analysis";
import { useDerivedAnalysis } from "@/lib/use-derived-analysis";
import type { RunOwner } from "@/lib/worker-protocol";

function ChangeTable({ result }: { result: ChangeNetworkResultV1 }) {
  return (
    <div
      className="table-scroll derived-table"
      role="region"
      aria-label="Raw selected-level network table"
      tabIndex={0}
      data-testid="raw-change-table"
    >
      <table>
        <caption>
          Exact mean network for {result.selector.field} = {String(result.selector.level)}.
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

export function RawChangePanel({
  source,
  owner,
}: {
  source: RawDerivedSource;
  owner: RunOwner;
}) {
  const fields = useMemo(() => rawChangeFieldOptions(source.result), [source.result]);
  const [field, setField] = useState(fields[0]?.field ?? "");
  const initialLevels = fields.find((candidate) => candidate.field === field)?.levels ?? [];
  const [level, setLevel] = useState(initialLevels[0]?.value ?? "");
  const controller = useDerivedAnalysis(source, owner);
  const activeField = fields.find((candidate) => candidate.field === field);
  const valid = Boolean(activeField?.levels.some((candidate) => candidate.value === level));
  const result = controller.state.envelope?.result.schemaVersion === "3dena.change-network.v1"
    ? controller.state.envelope.result
    : null;

  function changeField(nextField: string): void {
    const next = fields.find((candidate) => candidate.field === nextField);
    setField(nextField);
    setLevel(next?.levels[0]?.value ?? "");
    controller.markStale();
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!valid) return;
    void controller.run({ kind: "change-network", field, level });
  }

  return (
    <section className="derived-panel" aria-labelledby="raw-change-title" data-testid="raw-change-panel">
      <header>
        <p className="eyebrow">AnalysisTask · network core</p>
        <h3 id="raw-change-title">Exact level network</h3>
        <p>
          Selects one exact string-valued group or metadata level and computes
          its mean line-weight network in the existing shared rotation.
        </p>
      </header>
      <form onSubmit={submit}>
        <div className="derived-control-grid">
          <label htmlFor="raw-change-field">
            Field
            <select
              id="raw-change-field"
              value={field}
              onChange={(event) => changeField(event.currentTarget.value)}
              data-testid="raw-change-field"
            >
              {fields.map((candidate) => (
                <option key={candidate.field} value={candidate.field}>{candidate.label}</option>
              ))}
            </select>
          </label>
          <label htmlFor="raw-change-level">
            Exact level
            <select
              id="raw-change-level"
              value={level}
              onChange={(event) => {
                setLevel(event.currentTarget.value);
                controller.markStale();
              }}
              data-testid="raw-change-level"
            >
              {(activeField?.levels ?? []).map((candidate) => (
                <option key={candidate.value} value={candidate.value}>{candidate.label}</option>
              ))}
            </select>
          </label>
        </div>
        {!valid && (
          <p className="derived-validation">
            AnalysisTask v1 currently accepts only string-valued change levels;
            this result exposes no supported level selection.
          </p>
        )}
        <RunDerivedActions
          running={controller.state.status === "running"}
          disabled={!valid}
          runLabel="Run level network"
          runTestId="raw-change-run"
          onCancel={controller.cancel}
        />
      </form>
      <DerivedStatus
        status={controller.state.status}
        message={controller.state.message}
        errorCode={controller.state.errorCode}
        testId="raw-change-status"
      />
      {result && controller.state.owner && controller.state.envelope && (
        <div className="derived-output" data-testid="raw-change-result">
          <dl className="derived-summary">
            <div><dt>Selected points</dt><dd>{result.mean.pointCount}</dd></div>
            <div><dt>Field</dt><dd>{result.selector.field}</dd></div>
            <div><dt>Level</dt><dd>{String(result.selector.level)}</dd></div>
          </dl>
          <ChangeTable result={result} />
          <DerivedDiagnostics diagnostics={result.diagnostics} titleId="raw-change-diagnostics" />
          <button
            className="button button--secondary derived-download"
            type="button"
            onClick={() => downloadDerivedResult({
              mode: "raw-jena",
              feature: "change",
              owner: controller.state.owner!,
              envelope: controller.state.envelope,
            }, source.name)}
            data-testid="raw-change-download"
          >
            <Download size={17} aria-hidden="true" /> Download level-network JSON
          </button>
        </div>
      )}
    </section>
  );
}
