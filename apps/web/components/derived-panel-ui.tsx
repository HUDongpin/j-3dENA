"use client";

import type { AnalysisDiagnostic } from "@3dena/analysis";
import { Ban, LoaderCircle, Play } from "lucide-react";

export interface DerivedGroupOption {
  canonical: string;
  label: string;
  value: string | number | boolean | null;
}

export function formatDerivedNumber(value: number | null, digits = 6): string {
  if (value === null) return "—";
  if (value === 0) return "0";
  if (Math.abs(value) < 0.0001 || Math.abs(value) >= 1_000_000) {
    return value.toExponential(4);
  }
  return value.toFixed(digits);
}

export function DerivedStatus({
  status,
  message,
  errorCode,
  testId,
}: {
  status: string;
  message: string;
  errorCode: string | null;
  testId: string;
}) {
  return (
    <div
      className={`derived-status derived-status--${status}`}
      role="status"
      aria-live="polite"
      data-state={status}
      data-error-code={errorCode ?? ""}
      data-testid={testId}
    >
      {status === "running" && (
        <LoaderCircle className="spin" size={18} aria-hidden="true" />
      )}
      <span>{errorCode ? `${errorCode}: ${message}` : message}</span>
    </div>
  );
}

export function DerivedDiagnostics({
  diagnostics,
  titleId,
}: {
  diagnostics: readonly AnalysisDiagnostic[];
  titleId: string;
}) {
  if (diagnostics.length === 0) {
    return (
      <aside className="derived-diagnostics derived-diagnostics--clear" role="note">
        <strong>Diagnostics</strong>
        <span>No core diagnostic was emitted for this task.</span>
      </aside>
    );
  }
  return (
    <aside className="derived-diagnostics" aria-labelledby={titleId}>
      <h4 id={titleId}>Diagnostics</h4>
      <ul>
        {diagnostics.map((diagnostic, index) => (
          <li key={`${diagnostic.code}-${diagnostic.path ?? "root"}-${index}`}>
            <strong>{diagnostic.code}</strong> · {diagnostic.severity}: {diagnostic.message}
          </li>
        ))}
      </ul>
    </aside>
  );
}

export function GroupPairControls({
  idPrefix,
  groups,
  groupA,
  groupB,
  onGroupA,
  onGroupB,
}: {
  idPrefix: string;
  groups: readonly DerivedGroupOption[];
  groupA: string;
  groupB: string;
  onGroupA: (group: string) => void;
  onGroupB: (group: string) => void;
}) {
  return (
    <div className="derived-control-grid derived-control-grid--pair">
      <label htmlFor={`${idPrefix}-group-a`}>
        Group A
        <select
          id={`${idPrefix}-group-a`}
          value={groupA}
          onChange={(event) => onGroupA(event.currentTarget.value)}
          data-testid={`${idPrefix}-group-a`}
        >
          {groups.map((group) => (
            <option key={group.canonical} value={group.canonical}>{group.label}</option>
          ))}
        </select>
      </label>
      <label htmlFor={`${idPrefix}-group-b`}>
        Group B
        <select
          id={`${idPrefix}-group-b`}
          value={groupB}
          onChange={(event) => onGroupB(event.currentTarget.value)}
          data-testid={`${idPrefix}-group-b`}
        >
          {groups.map((group) => (
            <option key={group.canonical} value={group.canonical}>{group.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function RunDerivedActions({
  running,
  disabled,
  runLabel,
  runTestId,
  onCancel,
}: {
  running: boolean;
  disabled: boolean;
  runLabel: string;
  runTestId: string;
  onCancel: () => void;
}) {
  return (
    <div className="derived-actions">
      <button
        className="button button--primary"
        type="submit"
        disabled={disabled || running}
        data-testid={runTestId}
      >
        {running ? (
          <LoaderCircle className="spin" size={17} aria-hidden="true" />
        ) : (
          <Play size={17} aria-hidden="true" />
        )}
        {running ? "Running…" : runLabel}
      </button>
      <button
        className="button button--quiet"
        type="button"
        onClick={onCancel}
        disabled={!running}
      >
        <Ban size={17} aria-hidden="true" /> Cancel task
      </button>
    </div>
  );
}
