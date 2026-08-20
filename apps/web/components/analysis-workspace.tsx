"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import type { AnalysisResult } from "@3dena/analysis";
import {
  Ban,
  CheckCircle2,
  FileSpreadsheet,
  FlaskConical,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  Upload,
} from "lucide-react";
import { AnalysisResults } from "@/components/analysis-results";
import type { AnalysisMapping } from "@/lib/analysis-contract";
import {
  materializeAnalysisRows,
  parseCsvLexemeTable,
} from "@/lib/parse-analysis-csv";
import { createRunOwner, sameRunOwner } from "@/lib/run-ownership";
import {
  BUILT_IN_SAMPLE_CSV,
  BUILT_IN_SAMPLE_NAME,
  LEGACY_DEFAULT_MAPPING,
  mappingForHeaders,
} from "@/lib/sample-data";
import type {
  AnalysisWorkerResponse,
  AnalyzeWorkerRequest,
  RunOwner,
  WorkerPhase,
} from "@/lib/worker-protocol";

type AnalysisStatus =
  | "idle"
  | "running"
  | "completed"
  | "cancelled"
  | "invalidated"
  | "error";

type WorkerState =
  | "idle"
  | "preparing"
  | "running"
  | "completed"
  | "terminated"
  | "invalidated"
  | "error";

interface CsvInspection {
  headers: string[];
  previewRows: string[][];
}

interface DatasetState extends CsvInspection {
  name: string;
  csvText: string;
  size: number;
  source: "built-in" | "file";
}

interface StagedCsv extends CsvInspection {
  mapping: AnalysisMapping;
}

function stageCsv(csvText: string): StagedCsv {
  const table = parseCsvLexemeTable(csvText);
  const { headers } = table;
  if (headers.length < 4) {
    throw new Error("ENA input needs identity columns and at least three code columns.");
  }
  const mapping = mappingForHeaders(headers);
  const invalidMapping = mappingError(mapping, headers);
  if (invalidMapping) {
    throw new Error(invalidMapping);
  }

  // Validate all candidate rows and mapped code lexemes before the caller can
  // atomically commit this dataset. Formal analysis still reparses the sealed
  // CSV snapshot inside its dedicated Worker.
  materializeAnalysisRows(table, mapping);

  return {
    headers,
    previewRows: table.dataRows.slice(0, 6),
    mapping,
  };
}

const initialStaging = stageCsv(BUILT_IN_SAMPLE_CSV);
const initialDataset: DatasetState = {
  headers: initialStaging.headers,
  previewRows: initialStaging.previewRows,
  name: BUILT_IN_SAMPLE_NAME,
  csvText: BUILT_IN_SAMPLE_CSV,
  size: new Blob([BUILT_IN_SAMPLE_CSV]).size,
  source: "built-in",
};

const STATUS_COPY: Record<AnalysisStatus, string> = {
  idle: "Ready to analyze the current CSV and specification.",
  running: "Analysis is running in a dedicated browser Worker.",
  completed: "Analysis completed. Results belong to the displayed dataset and specification hashes.",
  cancelled: "Analysis cancelled. The Worker was terminated and cannot publish a late result.",
  invalidated: "The dataset or specification changed. The previous result is no longer displayed.",
  error: "Analysis did not complete. Review the error and mapping before retrying.",
};

const PHASE_LABEL: Record<WorkerPhase, string> = {
  validating: "Validating",
  parsing: "Parsing CSV",
  modeling: "Building ENA model",
  trajectory: "Building shared trajectories",
  complete: "Complete",
};

function uniqueRunId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function e2eWorkerDelay(): number {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") {
    return 0;
  }
  const requested = Number(
    new URLSearchParams(window.location.search).get("e2eWorkerDelayMs"),
  );
  return Number.isFinite(requested)
    ? Math.max(0, Math.min(10_000, Math.round(requested)))
    : 0;
}

function mappingError(mapping: AnalysisMapping, headers: string[]): string | null {
  const selected = [
    ...mapping.unitColumns,
    ...mapping.conversationColumns,
    ...mapping.codeColumns,
    mapping.groupColumn,
    mapping.timeColumn,
    mapping.entityColumn,
  ];
  const missing = selected.filter((column) => column && !headers.includes(column));
  if (missing.length > 0) {
    return `Mapped columns are missing from the CSV: ${Array.from(new Set(missing)).join(", ")}.`;
  }
  if (mapping.unitColumns.length === 0) {
    return "Select at least one unit column.";
  }
  if (!mapping.unitColumns.includes(mapping.groupColumn)) {
    return "The group column must also be part of the complete unit tuple.";
  }
  if (!mapping.unitColumns.includes(mapping.entityColumn)) {
    return "The entity label column must also be part of the complete unit tuple.";
  }
  if (mapping.conversationColumns.length === 0) {
    return "Select at least one conversation column.";
  }
  if (!mapping.conversationColumns.includes(mapping.timeColumn)) {
    return "The time column must also be part of the conversation tuple.";
  }
  if (mapping.codeColumns.length < 3) {
    return "Select at least three code columns for a three-dimensional solution.";
  }
  const structural = new Set([
    ...mapping.unitColumns,
    ...mapping.conversationColumns,
  ]);
  const overlap = mapping.codeColumns.filter((column) => structural.has(column));
  if (overlap.length > 0) {
    return `Code columns cannot also be unit or conversation columns: ${overlap.join(", ")}.`;
  }
  if (!Number.isInteger(mapping.windowSizeBack) || mapping.windowSizeBack < 1) {
    return "Moving-window back size must be a positive integer.";
  }
  return null;
}

function readableBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AnalysisWorkspace() {
  const [dataset, setDataset] = useState<DatasetState>(initialDataset);
  const [mapping, setMapping] = useState<AnalysisMapping>(LEGACY_DEFAULT_MAPPING);
  const [status, setStatus] = useState<AnalysisStatus>("idle");
  const [workerState, setWorkerState] = useState<WorkerState>("idle");
  const [workerId, setWorkerId] = useState("");
  const [phase, setPhase] = useState<WorkerPhase>("validating");
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState(STATUS_COPY.idle);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [resultOwner, setResultOwner] = useState<RunOwner | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const activeOwnerRef = useRef<RunOwner | null>(null);
  const generationRef = useRef(0);

  const validationMessage = useMemo(
    () => mappingError(mapping, dataset.headers),
    [dataset.headers, mapping],
  );

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      activeOwnerRef.current = null;
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  function invalidateComputed(): void {
    const hadOwnedWork =
      status === "running" || status === "completed" || resultOwner !== null;
    generationRef.current += 1;
    activeOwnerRef.current = null;
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setResult(null);
    setResultOwner(null);
    setError(null);
    setProgress(0);
    setProgressMessage(
      hadOwnedWork ? STATUS_COPY.invalidated : STATUS_COPY.idle,
    );
    setStatus(hadOwnedWork ? "invalidated" : "idle");
    setWorkerState(hadOwnedWork ? "invalidated" : "idle");
  }

  function updateMapping(next: AnalysisMapping): void {
    invalidateComputed();
    setMapping(next);
  }

  function installDataset(
    next: DatasetState,
    nextMapping: AnalysisMapping,
  ): void {
    invalidateComputed();
    setDataset(next);
    setMapping(nextMapping);
  }

  function useBuiltInSample(): void {
    installDataset(initialDataset, initialStaging.mapping);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setError(null);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Choose a .csv file. The current dataset and result were preserved.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("The CSV exceeds the 5 MiB browser workspace limit. The current dataset was preserved.");
      return;
    }
    try {
      const csvText = await file.text();
      const staged = stageCsv(csvText);

      installDataset({
        headers: staged.headers,
        previewRows: staged.previewRows,
        name: file.name,
        csvText,
        size: file.size,
        source: "file",
      }, staged.mapping);
    } catch (fileError) {
      setError(
        fileError instanceof Error
          ? `${fileError.message} The current dataset and result were preserved.`
          : "The CSV could not be inspected. The current dataset was preserved.",
      );
    }
  }

  async function runAnalysis(): Promise<void> {
    const invalid = mappingError(mapping, dataset.headers);
    if (invalid) {
      setError(invalid);
      setStatus("error");
      setWorkerState("error");
      setProgressMessage(invalid);
      return;
    }

    generationRef.current += 1;
    const generation = generationRef.current;
    const runId = uniqueRunId();
    const nextWorkerId = `analysis-worker-${runId}`;
    const csvSnapshot = dataset.csvText;
    const mappingSnapshot: AnalysisMapping = {
      ...mapping,
      unitColumns: [...mapping.unitColumns],
      conversationColumns: [...mapping.conversationColumns],
      codeColumns: [...mapping.codeColumns],
    };

    workerRef.current?.terminate();
    workerRef.current = null;
    activeOwnerRef.current = null;
    setResult(null);
    setResultOwner(null);
    setError(null);
    setStatus("running");
    setWorkerState("preparing");
    setWorkerId(nextWorkerId);
    setPhase("validating");
    setProgress(3);
    setProgressMessage("Sealing dataset and specification ownership hashes…");

    try {
      const owner = await createRunOwner(csvSnapshot, mappingSnapshot, runId);
      if (generation !== generationRef.current) return;

      const worker = new Worker(
        new URL("../workers/analysis.worker.ts", import.meta.url),
        { type: "module", name: nextWorkerId },
      );
      workerRef.current = worker;
      activeOwnerRef.current = owner;
      setWorkerState("running");

      worker.onmessage = (event: MessageEvent<AnalysisWorkerResponse>) => {
        const response = event.data;
        if (!sameRunOwner(activeOwnerRef.current, response.owner)) {
          return;
        }
        if (response.type === "progress") {
          setPhase(response.phase);
          setProgress(response.percent);
          setProgressMessage(response.message);
          return;
        }
        if (response.type === "error") {
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
          activeOwnerRef.current = null;
          setError(response.message);
          setStatus("error");
          setWorkerState("error");
          setProgressMessage(response.message);
          return;
        }

        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        activeOwnerRef.current = null;
        setResult(response.result);
        setResultOwner(response.owner);
        setStatus("completed");
        setWorkerState("completed");
        setPhase("complete");
        setProgress(100);
        setProgressMessage(STATUS_COPY.completed);
      };

      worker.onerror = (workerError) => {
        if (
          workerRef.current !== worker ||
          !sameRunOwner(activeOwnerRef.current, owner)
        ) {
          return;
        }
        workerError.preventDefault();
        worker.terminate();
        workerRef.current = null;
        activeOwnerRef.current = null;
        const message = workerError.message || "The analysis Worker stopped unexpectedly.";
        setError(message);
        setStatus("error");
        setWorkerState("error");
        setProgressMessage(message);
      };

      const request: AnalyzeWorkerRequest = {
        v: 1,
        kind: "analyze",
        runId,
        input: {
          csvText: csvSnapshot,
          mapping: mappingSnapshot,
          datasetHash: owner.datasetHash,
          specHash: owner.specHash,
          debugDelayMs: e2eWorkerDelay(),
        },
      };
      worker.postMessage(request);
    } catch (runError) {
      if (generation !== generationRef.current) return;
      const message =
        runError instanceof Error
          ? runError.message
          : "The analysis Worker could not be started.";
      setError(message);
      setStatus("error");
      setWorkerState("error");
      setProgressMessage(message);
    }
  }

  function cancelAnalysis(): void {
    if (status !== "running") return;
    generationRef.current += 1;
    activeOwnerRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    setResult(null);
    setResultOwner(null);
    setError(null);
    setStatus("cancelled");
    setWorkerState("terminated");
    setProgress(0);
    setProgressMessage(STATUS_COPY.cancelled);
  }

  return (
    <div className="workspace-shell section-shell">
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">Browser analysis workspace</p>
          <h1>Configure and run 3D ENA.</h1>
          <p>
            Raw CSV is parsed and analyzed in a dedicated Worker. Nothing is
            uploaded, and changing the data or analytical specification
            invalidates computed results.
          </p>
        </div>
        <div className="privacy-chip">
          <ShieldCheck size={20} aria-hidden="true" />
          <span><strong>Local computation</strong> Files stay in this browser tab.</span>
        </div>
      </header>

      <div
        className="workflow-steps"
        role="region"
        aria-label="Analysis workflow steps"
        tabIndex={0}
      >
        <span><strong>1</strong> Import</span>
        <span><strong>2</strong> Map</span>
        <span><strong>3</strong> Analyze</span>
        <span><strong>4</strong> Interpret</span>
      </div>

      <div className="workspace-grid">
        <div className="workspace-controls">
          <section className="workspace-card" aria-labelledby="dataset-title">
            <div className="workspace-card__heading">
              <span className="icon-tile"><FileSpreadsheet size={20} aria-hidden="true" /></span>
              <div>
                <p className="eyebrow">Step 1</p>
                <h2 id="dataset-title">Dataset</h2>
              </div>
            </div>

            <div className="dataset-actions">
              <label className="file-control">
                <span><Upload size={18} aria-hidden="true" /> Choose raw CSV</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFile}
                  data-testid="raw-file-input"
                />
              </label>
              <button className="button button--quiet" type="button" onClick={useBuiltInSample}>
                <RefreshCw size={17} aria-hidden="true" /> Reset to small raw
              </button>
            </div>

            <div className="dataset-receipt">
              <div>
                <strong>{dataset.name}</strong>
                <span>{dataset.source === "built-in" ? "Bundled legacy fixture" : "Local file"}</span>
              </div>
              <span>{readableBytes(dataset.size)} · {dataset.headers.length} columns</span>
            </div>

            <div
              className="table-scroll dataset-preview"
              role="region"
              aria-label="Dataset preview table"
              tabIndex={0}
            >
              <table>
                <caption>First {dataset.previewRows.length} data rows</caption>
                <thead><tr>{dataset.headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead>
                <tbody>
                  {dataset.previewRows.map((row, rowIndex) => (
                    <tr key={`preview-${rowIndex}`}>
                      {row.map((cell, cellIndex) => (
                        <td key={`${rowIndex}-${dataset.headers[cellIndex] ?? cellIndex}`}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <MappingEditor
            headers={dataset.headers}
            mapping={mapping}
            onChange={updateMapping}
          />
        </div>

        <aside className="run-column" aria-labelledby="run-title">
          <section className="workspace-card run-card">
            <div className="workspace-card__heading">
              <span className="icon-tile"><FlaskConical size={20} aria-hidden="true" /></span>
              <div>
                <p className="eyebrow">Step 3</p>
                <h2 id="run-title">Run analysis</h2>
              </div>
            </div>

            <div
              className={`analysis-status analysis-status--${status}`}
              role="status"
              aria-live="polite"
              data-testid="analysis-status"
              data-state={status}
            >
              {status === "running" ? (
                <LoaderCircle className="spin" size={21} aria-hidden="true" />
              ) : status === "completed" ? (
                <CheckCircle2 size={21} aria-hidden="true" />
              ) : status === "cancelled" || status === "invalidated" ? (
                <Ban size={21} aria-hidden="true" />
              ) : (
                <FlaskConical size={21} aria-hidden="true" />
              )}
              <span><strong>{status[0]?.toUpperCase()}{status.slice(1)}</strong>{STATUS_COPY[status]}</span>
            </div>

            <div
              className="worker-receipt"
              data-testid="worker-status"
              data-state={workerState}
              data-worker-id={workerId}
            >
              <span>Worker</span>
              <strong>{workerState}</strong>
              <code title={workerId}>{workerId ? workerId.slice(-12) : "not started"}</code>
            </div>

            <div className="progress-block" aria-label={`Analysis progress: ${progress}%`}>
              <div>
                <span>{status === "running" ? PHASE_LABEL[phase] : "Progress"}</span>
                <strong>{progress}%</strong>
              </div>
              <progress max="100" value={progress}>{progress}%</progress>
              <p>{progressMessage}</p>
            </div>

            {validationMessage && status !== "running" && (
              <p className="validation-hint">{validationMessage}</p>
            )}

            {error && (
              <div className="analysis-error" role="alert" data-testid="analysis-error">
                <strong>Needs attention</strong>
                <span>{error}</span>
              </div>
            )}

            <div className="run-actions">
              <button
                className="button button--primary"
                type="button"
                onClick={runAnalysis}
                disabled={status === "running" || Boolean(validationMessage)}
                data-testid="analysis-run"
              >
                <Play size={18} aria-hidden="true" /> Run 3D ENA
              </button>
              <button
                className="button button--danger"
                type="button"
                onClick={cancelAnalysis}
                disabled={status !== "running"}
                data-testid="analysis-cancel"
              >
                <Square size={17} aria-hidden="true" /> Cancel
              </button>
            </div>

            <p className="run-boundary">
              Cancel hard-terminates the active Worker. Results are accepted only
              when dataset hash, specification hash, and run ID all match.
            </p>
          </section>
        </aside>
      </div>

      {result && resultOwner && (
        <AnalysisResults
          result={result}
          owner={resultOwner}
          datasetName={dataset.name}
        />
      )}
    </div>
  );
}

interface MappingEditorProps {
  headers: string[];
  mapping: AnalysisMapping;
  onChange: (mapping: AnalysisMapping) => void;
}

type MultiColumnKey = "unitColumns" | "conversationColumns" | "codeColumns";

function MappingEditor({ headers, mapping, onChange }: MappingEditorProps) {
  function toggle(key: MultiColumnKey, column: string): void {
    const current = mapping[key];
    const next = current.includes(column)
      ? current.filter((value) => value !== column)
      : [...current, column];
    onChange({ ...mapping, [key]: next });
  }

  return (
    <section className="workspace-card" aria-labelledby="mapping-title">
      <div className="workspace-card__heading">
        <span className="icon-tile"><ShieldCheck size={20} aria-hidden="true" /></span>
        <div>
          <p className="eyebrow">Step 2</p>
          <h2 id="mapping-title">Map analytical roles</h2>
        </div>
      </div>
      <p className="card-intro">
        The complete unit tuple is the scientific identity. Display labels never
        replace its collision-safe canonical key.
      </p>

      <div className="mapping-multis">
        <ColumnChecklist
          legend="Unit columns"
          description="Legacy default: Group + Name"
          headers={headers}
          selected={mapping.unitColumns}
          onToggle={(column) => toggle("unitColumns", column)}
        />
        <ColumnChecklist
          legend="Conversation columns"
          description="Legacy default: Lesson"
          headers={headers}
          selected={mapping.conversationColumns}
          onToggle={(column) => toggle("conversationColumns", column)}
        />
        <ColumnChecklist
          legend="Code columns"
          description="Choose at least three"
          headers={headers}
          selected={mapping.codeColumns}
          onToggle={(column) => toggle("codeColumns", column)}
        />
      </div>

      <div className="mapping-selects">
        <LabeledSelect
          label="Group column"
          value={mapping.groupColumn}
          headers={headers}
          onChange={(groupColumn) => onChange({ ...mapping, groupColumn })}
        />
        <LabeledSelect
          label="Time column"
          value={mapping.timeColumn}
          headers={headers}
          onChange={(timeColumn) => onChange({ ...mapping, timeColumn })}
        />
        <LabeledSelect
          label="Entity label"
          value={mapping.entityColumn}
          headers={headers}
          onChange={(entityColumn) => onChange({ ...mapping, entityColumn })}
        />
        <label>
          <span>Model</span>
          <select
            value={mapping.model}
            onChange={(event) => onChange({
              ...mapping,
              model: event.currentTarget.value as AnalysisMapping["model"],
            })}
          >
            <option value="AccumulatedTrajectory">Accumulated trajectory</option>
            <option value="SeparateTrajectory">Separate trajectory</option>
            <option value="EndPoint">End point</option>
          </select>
        </label>
        <label>
          <span>Window</span>
          <select
            value={mapping.window}
            onChange={(event) => onChange({
              ...mapping,
              window: event.currentTarget.value as AnalysisMapping["window"],
            })}
          >
            <option value="MovingStanzaWindow">Moving stanza window</option>
            <option value="Conversation">Whole conversation</option>
          </select>
        </label>
        <label>
          <span>Window size back</span>
          <input
            type="number"
            min="1"
            max="100"
            step="1"
            value={mapping.windowSizeBack}
            disabled={mapping.window === "Conversation"}
            onChange={(event) => onChange({
              ...mapping,
              windowSizeBack: Number(event.currentTarget.value),
            })}
            data-testid="analysis-spec-window-size"
          />
        </label>
      </div>

      <div className="legacy-default-note">
        <strong>Bundled fixture defaults</strong>
        <span>
          AccumulatedTrajectory · MovingStanzaWindow · back = 4 · EC / ICT / MCO / ATT
        </span>
      </div>
    </section>
  );
}

interface ColumnChecklistProps {
  legend: string;
  description: string;
  headers: string[];
  selected: string[];
  onToggle: (column: string) => void;
}

function ColumnChecklist({
  legend,
  description,
  headers,
  selected,
  onToggle,
}: ColumnChecklistProps) {
  const idPrefix = legend.toLowerCase().replaceAll(" ", "-");
  return (
    <fieldset>
      <legend>{legend}</legend>
      <p>{description}</p>
      <div className="checklist">
        {headers.map((header, index) => {
          const id = `${idPrefix}-${index}`;
          return (
            <label key={header} htmlFor={id}>
              <input
                id={id}
                type="checkbox"
                checked={selected.includes(header)}
                onChange={() => onToggle(header)}
              />
              <span>{header}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

interface LabeledSelectProps {
  label: string;
  value: string;
  headers: string[];
  onChange: (value: string) => void;
}

function LabeledSelect({ label, value, headers, onChange }: LabeledSelectProps) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        {headers.map((header) => <option key={header} value={header}>{header}</option>)}
      </select>
    </label>
  );
}
