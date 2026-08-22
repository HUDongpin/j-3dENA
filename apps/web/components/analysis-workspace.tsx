"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from "react";
import type {
  AnalysisResult,
  PreparedSpaceResult,
} from "@3dena/analysis";
import { DEFAULT_ENA3D_EXCHANGE_LIMITS } from "@3dena/io";
import {
  Ban,
  CheckCircle2,
  Database,
  FileJson2,
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
import { PreparedAnalysisResults } from "@/components/prepared-analysis-results";
import { RemoteAnalysisWorkspace } from "@/components/remote-analysis-workspace";
import type { AnalysisMapping } from "@/lib/analysis-contract";
import { resolveWebExecutionPolicy } from "@/lib/execution-policy";
import {
  materializeAnalysisRows,
  parseCsvLexemeTable,
} from "@/lib/parse-analysis-csv";
import {
  createRunOwner,
  createRunOwnerFromDatasetHash,
  sameRunOwner,
} from "@/lib/run-ownership";
import {
  RAW_BROWSER_DATASET_LIMITS,
  rawDatasetSchema,
} from "@/lib/raw-dataset-receipt";
import {
  PREPARED_EXCHANGE_MAPPING,
  isNativeSerializedFileName,
  isPreparedExchangeFileName,
  type PreparedDatasetReceipt,
} from "@/lib/prepared-class1";
import {
  BUILT_IN_SAMPLE_CSV,
  BUILT_IN_SAMPLE_NAME,
  LEGACY_DEFAULT_MAPPING,
  mappingForHeaders,
} from "@/lib/sample-data";
import type {
  AnalysisWorkerResponse,
  AnalysisWorkerRequest,
  PreparedValidationWorkerResponse,
  RunOwner,
  ValidatePreparedWorkerRequest,
  WorkerPhase,
} from "@/lib/worker-protocol";

type AnalysisMode = "raw" | "prepared";

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

type PreparedImportStatus = "idle" | "validating" | "completed" | "error";

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

interface PreparedDatasetState {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
  source: "file";
  receipt: PreparedDatasetReceipt;
}

type OwnedAnalysisResult =
  | { mode: "raw"; result: AnalysisResult; owner: RunOwner }
  | { mode: "prepared"; result: PreparedSpaceResult; owner: RunOwner };

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
  idle: "Ready to analyze the current dataset and specification.",
  running: "Analysis is running in a dedicated browser Worker.",
  completed: "Analysis completed. Results belong to the displayed dataset and specification hashes.",
  cancelled: "Analysis cancelled. The Worker was terminated and cannot publish a late result.",
  invalidated: "The dataset or specification changed. The previous result is no longer displayed.",
  error: "Analysis did not complete. Review the error and mapping before retrying.",
};

const PHASE_LABEL: Record<WorkerPhase, string> = {
  validating: "Validating",
  parsing: "Parsing CSV",
  decoding: "Decoding prepared exchange",
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

function subscribeStaticLocation(): () => void {
  return () => undefined;
}

function remoteCalibrationSnapshot(): boolean {
  return typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("remoteCalibration") === "1";
}

function serverRemoteCalibrationSnapshot(): boolean {
  return false;
}

const REMOTE_CALIBRATION_GIT_COMMIT = "b".repeat(40);

function remoteCalibrationApproval(webBuildId: string): string {
  return JSON.stringify({
    approvalManifestSha256: "a".repeat(64),
    releaseId: "remote-calibration-release",
    gitCommit: REMOTE_CALIBRATION_GIT_COMMIT,
    webBuildId,
    flyImageDigest: `sha256:${"c".repeat(64)}`,
    flyBuildId: "remote-calibration-fly-build",
  });
}

export function AnalysisWorkspace({ webBuildId }: { webBuildId?: string }) {
  const defaultPolicy = useMemo(() => resolveWebExecutionPolicy(), []);
  const remoteCalibration = useSyncExternalStore(
    subscribeStaticLocation,
    remoteCalibrationSnapshot,
    serverRemoteCalibrationSnapshot,
  );
  const policy = useMemo(() => {
    if (defaultPolicy.production || !remoteCalibration) return defaultPolicy;
    return resolveWebExecutionPolicy({
      nodeEnv: "development",
      requestedMode: "remote",
      computeBaseUrl: `${window.location.origin}/__remote_calibration__`,
      activeBuildApproval: remoteCalibrationApproval(webBuildId ?? "local-development"),
      webGitCommit: REMOTE_CALIBRATION_GIT_COMMIT,
      processingRegion: "Mocked development calibration region",
    });
  }, [defaultPolicy, remoteCalibration, webBuildId]);

  if (policy.mode === "remote") {
    return (
      <RemoteAnalysisWorkspace
        {...(webBuildId === undefined ? {} : { webBuildId })}
        policy={policy}
      />
    );
  }
  return (
    <CalibrationAnalysisWorkspace
      {...(webBuildId === undefined ? {} : { buildId: webBuildId })}
    />
  );
}

function CalibrationAnalysisWorkspace({ buildId }: { buildId?: string }) {
  const clientReady = useSyncExternalStore(
    subscribeStaticLocation,
    () => true,
    () => false,
  );
  const [mode, setMode] = useState<AnalysisMode>("raw");
  const [dataset, setDataset] = useState<DatasetState>(initialDataset);
  const [mapping, setMapping] = useState<AnalysisMapping>(LEGACY_DEFAULT_MAPPING);
  const [preparedDataset, setPreparedDataset] =
    useState<PreparedDatasetState | null>(null);
  const [preparedImportStatus, setPreparedImportStatus] =
    useState<PreparedImportStatus>("idle");
  const [preparedImportMessage, setPreparedImportMessage] = useState(
    "Choose a strict user-provided .ena3d.json exchange. No prepared research dataset is bundled with the application.",
  );
  const [status, setStatus] = useState<AnalysisStatus>("idle");
  const [workerState, setWorkerState] = useState<WorkerState>("idle");
  const [workerId, setWorkerId] = useState("");
  const [phase, setPhase] = useState<WorkerPhase>("validating");
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState(STATUS_COPY.idle);
  const [error, setError] = useState<string | null>(null);
  const [ownedResult, setOwnedResult] = useState<OwnedAnalysisResult | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const preparedImportWorkerRef = useRef<Worker | null>(null);
  const activeOwnerRef = useRef<RunOwner | null>(null);
  const generationRef = useRef(0);
  const rawImportGenerationRef = useRef(0);
  const preparedImportGenerationRef = useRef(0);

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
      rawImportGenerationRef.current += 1;
      preparedImportGenerationRef.current += 1;
      preparedImportWorkerRef.current?.terminate();
      preparedImportWorkerRef.current = null;
    };
  }, []);

  function invalidateComputed(): void {
    const hadOwnedWork =
      status === "running" || status === "completed" || ownedResult !== null;
    generationRef.current += 1;
    activeOwnerRef.current = null;
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setOwnedResult(null);
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
    rawImportGenerationRef.current += 1;
    installDataset(initialDataset, initialStaging.mapping);
  }

  function activateMode(nextMode: AnalysisMode): void {
    if (nextMode === mode) return;
    rawImportGenerationRef.current += 1;
    preparedImportGenerationRef.current += 1;
    preparedImportWorkerRef.current?.terminate();
    preparedImportWorkerRef.current = null;
    if (preparedImportStatus === "validating") {
      setPreparedImportStatus(preparedDataset ? "completed" : "idle");
      setPreparedImportMessage(
        preparedDataset
          ? "The previous validated prepared exchange remains active."
          : "Prepared import was cancelled when the analysis mode changed.",
      );
    }
    invalidateComputed();
    setMode(nextMode);
  }

  function beginPreparedImportIntent(): number {
    preparedImportGenerationRef.current += 1;
    preparedImportWorkerRef.current?.terminate();
    preparedImportWorkerRef.current = null;
    return preparedImportGenerationRef.current;
  }

  function validateAndInstallPreparedDataset(
    snapshot: Uint8Array<ArrayBuffer>,
    name: string,
    source: PreparedDatasetState["source"],
    generation: number,
  ): void {
    if (generation !== preparedImportGenerationRef.current) return;
    const requestId = `prepared-import-${uniqueRunId()}`;
    preparedImportWorkerRef.current?.terminate();
    preparedImportWorkerRef.current = null;
    setError(null);
    setPreparedImportStatus("validating");
    setPreparedImportMessage(
      "Strictly decoding structure and hashing the exact byte snapshot in a dedicated Worker…",
    );

    const worker = new Worker(
      new URL("../workers/prepared-validation.worker.ts", import.meta.url),
      { type: "module", name: requestId },
    );
    preparedImportWorkerRef.current = worker;

    function fail(message: string): void {
      if (
        generation !== preparedImportGenerationRef.current ||
        preparedImportWorkerRef.current !== worker
      ) {
        return;
      }
      worker.terminate();
      preparedImportWorkerRef.current = null;
      const preserved = `${message} The active prepared dataset and result were preserved.`;
      setPreparedImportStatus("error");
      setPreparedImportMessage(preserved);
      setError(preserved);
    }

    worker.onmessage = (
      event: MessageEvent<PreparedValidationWorkerResponse>,
    ) => {
      const response = event.data;
      if (
        generation !== preparedImportGenerationRef.current ||
        preparedImportWorkerRef.current !== worker ||
        response.requestId !== requestId
      ) {
        return;
      }
      if (response.type === "prepared-validation-error") {
        fail(response.message);
        return;
      }
      if (response.receipt.byteLength !== snapshot.byteLength) {
        fail("The validation receipt does not match the staged byte length.");
        return;
      }
      worker.terminate();
      preparedImportWorkerRef.current = null;
      invalidateComputed();
      setPreparedDataset({ name, bytes: snapshot, source, receipt: response.receipt });
      setPreparedImportStatus("completed");
      setPreparedImportMessage(
        "Prepared exchange validated and atomically activated. Run will decode these exact bytes again.",
      );
    };

    worker.onerror = (workerError) => {
      workerError.preventDefault();
      fail(workerError.message || "The prepared validation Worker stopped unexpectedly.");
    };

    const transferable = snapshot.slice();
    const request: ValidatePreparedWorkerRequest = {
      v: 1,
      kind: "validate-prepared",
      requestId,
      input: { bytes: transferable.buffer, sourceName: name },
    };
    worker.postMessage(request, [transferable.buffer]);
  }

  async function stagePreparedFile(file: File): Promise<void> {
    const generation = beginPreparedImportIntent();
    if (isNativeSerializedFileName(file.name)) {
      const message =
        "Native serialized analysis files are not accepted. Export a strict .ena3d.json exchange; the active dataset and result were preserved.";
      setPreparedImportStatus("error");
      setPreparedImportMessage(message);
      setError(message);
      return;
    }
    if (!isPreparedExchangeFileName(file.name)) {
      const message =
        "Choose a file ending in .ena3d.json. The active dataset and result were preserved.";
      setPreparedImportStatus("error");
      setPreparedImportMessage(message);
      setError(message);
      return;
    }
    if (file.size > DEFAULT_ENA3D_EXCHANGE_LIMITS.maxFileBytes) {
      const message =
        "The prepared exchange exceeds the 2 MiB browser limit. The active dataset and result were preserved.";
      setPreparedImportStatus("error");
      setPreparedImportMessage(message);
      setError(message);
      return;
    }
    setError(null);
    setPreparedImportStatus("validating");
    setPreparedImportMessage("Reading the exact local prepared-exchange bytes…");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (generation !== preparedImportGenerationRef.current) return;
      if (bytes.byteLength > DEFAULT_ENA3D_EXCHANGE_LIMITS.maxFileBytes) {
        throw new Error("The prepared exchange exceeds the 2 MiB browser limit.");
      }
      validateAndInstallPreparedDataset(bytes, file.name, "file", generation);
    } catch (fileError) {
      if (generation !== preparedImportGenerationRef.current) return;
      const message = `${
        fileError instanceof Error
          ? fileError.message
          : "The prepared exchange could not be read."
      } The active dataset and result were preserved.`;
      setPreparedImportStatus("error");
      setPreparedImportMessage(message);
      setError(message);
    }
  }

  function handlePreparedFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) void stagePreparedFile(file);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    rawImportGenerationRef.current += 1;
    const generation = rawImportGenerationRef.current;
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
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
      if (generation !== rawImportGenerationRef.current) return;
      const staged = stageCsv(csvText);
      if (generation !== rawImportGenerationRef.current) return;

      installDataset({
        headers: staged.headers,
        previewRows: staged.previewRows,
        name: file.name,
        csvText,
        size: file.size,
        source: "file",
      }, staged.mapping);
    } catch (fileError) {
      if (generation !== rawImportGenerationRef.current) return;
      setError(
        fileError instanceof Error
          ? `${fileError.message} The current dataset and result were preserved.`
          : "The CSV could not be inspected. The current dataset was preserved.",
      );
    }
  }

  async function runAnalysis(): Promise<void> {
    const invalid = mode === "raw" ? mappingError(mapping, dataset.headers) : null;
    if (invalid || (mode === "prepared" && !preparedDataset)) {
      const message =
        invalid ??
        "Validate and activate a prepared .ena3d.json exchange before running.";
      setError(message);
      setStatus("error");
      setWorkerState("error");
      setProgressMessage(message);
      return;
    }

    generationRef.current += 1;
    const generation = generationRef.current;
    const runId = uniqueRunId();
    const nextWorkerId = `analysis-worker-${runId}`;
    const modeSnapshot = mode;
    const csvSnapshot = dataset.csvText;
    const mappingSnapshot: AnalysisMapping = {
      ...mapping,
      unitColumns: [...mapping.unitColumns],
      conversationColumns: [...mapping.conversationColumns],
      codeColumns: [...mapping.codeColumns],
    };
    const preparedSnapshot = preparedDataset
      ? {
          ...preparedDataset,
          bytes: preparedDataset.bytes.slice(),
          receipt: { ...preparedDataset.receipt },
        }
      : null;

    workerRef.current?.terminate();
    workerRef.current = null;
    activeOwnerRef.current = null;
    setOwnedResult(null);
    setError(null);
    setStatus("running");
    setWorkerState("preparing");
    setWorkerId(nextWorkerId);
    setPhase("validating");
    setProgress(3);
    setProgressMessage("Sealing dataset and specification ownership hashes…");

    try {
      const owner =
        modeSnapshot === "raw"
          ? await createRunOwner(csvSnapshot, mappingSnapshot, runId)
          : await createRunOwnerFromDatasetHash(
              preparedSnapshot?.receipt.sha256 ?? "",
              PREPARED_EXCHANGE_MAPPING,
              runId,
            );
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

        const nextResult: OwnedAnalysisResult | null =
          modeSnapshot === "raw" && response.type === "result"
            ? { mode: "raw", result: response.result, owner: response.owner }
            : modeSnapshot === "prepared" &&
                response.type === "prepared-result"
              ? {
                  mode: "prepared",
                  result: response.result,
                  owner: response.owner,
                }
              : null;
        if (!nextResult) {
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
          activeOwnerRef.current = null;
          const message = "The Worker returned a result for a different analysis mode.";
          setError(message);
          setStatus("error");
          setWorkerState("error");
          setProgressMessage(message);
          return;
        }

        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        activeOwnerRef.current = null;
        setOwnedResult(nextResult);
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

      const request: AnalysisWorkerRequest =
        modeSnapshot === "raw"
          ? {
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
            }
          : {
              v: 1,
              kind: "analyze-prepared",
              runId,
              input: {
                bytes: preparedSnapshot?.bytes.buffer ?? new ArrayBuffer(0),
                sourceName:
                  preparedSnapshot?.name ?? "prepared-exchange.ena3d.json",
                mapping: PREPARED_EXCHANGE_MAPPING,
                datasetHash: owner.datasetHash,
                specHash: owner.specHash,
                debugDelayMs: e2eWorkerDelay(),
              },
            };
      if (request.kind === "analyze-prepared") {
        worker.postMessage(request, [request.input.bytes]);
      } else {
        worker.postMessage(request);
      }
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
    setOwnedResult(null);
    setError(null);
    setStatus("cancelled");
    setWorkerState("terminated");
    setProgress(0);
    setProgressMessage(STATUS_COPY.cancelled);
  }

  return (
    <div
      className="workspace-shell section-shell"
      data-testid="analysis-workspace"
      data-analysis-mode={mode}
      data-client-ready={clientReady}
    >
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">Browser analysis workspace</p>
          <h1>Configure and run 3D ENA.</h1>
          <p>
            {mode === "raw"
              ? "Raw CSV is parsed and recomputed with jENA in a dedicated Worker. "
              : "A strict prepared exchange is decoded and summarized without refitting jENA. "}
            Nothing is uploaded, and changing the data mode, dataset, or
            specification invalidates computed results.
          </p>
        </div>
        <div className="privacy-chip">
          <ShieldCheck size={20} aria-hidden="true" />
          <span><strong>Local computation</strong> Files stay in this browser tab.</span>
        </div>
      </header>

      <div className="analysis-mode-switch" role="group" aria-label="Analysis data mode">
        <button
          type="button"
          className={mode === "raw" ? "is-active" : undefined}
          aria-pressed={mode === "raw"}
          onClick={() => activateMode("raw")}
          data-testid="analysis-mode-raw"
        >
          <FileSpreadsheet size={18} aria-hidden="true" />
          <span><strong>Raw CSV</strong> Recompute with jENA</span>
        </button>
        <button
          type="button"
          className={mode === "prepared" ? "is-active" : undefined}
          aria-pressed={mode === "prepared"}
          onClick={() => activateMode("prepared")}
          data-testid="analysis-mode-prepared"
        >
          <Database size={18} aria-hidden="true" />
          <span><strong>Prepared exchange</strong> Import shared-space coordinates</span>
        </button>
      </div>

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
          {mode === "raw" ? (
            <>
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
              <button
                className="button button--quiet"
                type="button"
                onClick={useBuiltInSample}
                data-testid="raw-reset-sample"
              >
                <RefreshCw size={17} aria-hidden="true" /> Reset to small raw
              </button>
            </div>

            <div className="dataset-receipt" data-testid="dataset-receipt">
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
            </>
          ) : (
            <>
              <section className="workspace-card" aria-labelledby="prepared-dataset-title">
                <div className="workspace-card__heading">
                  <span className="icon-tile"><FileJson2 size={20} aria-hidden="true" /></span>
                  <div>
                    <p className="eyebrow">Step 1</p>
                    <h2 id="prepared-dataset-title">Prepared exchange</h2>
                  </div>
                </div>
                <p className="card-intro">
                  Import a strict browser-safe <code>.ena3d.json</code> exchange,
                  limited to 2 MiB. Native serialized analysis files are rejected.
                </p>
                <div className="dataset-actions">
                  <label className="file-control">
                    <span><Upload size={18} aria-hidden="true" /> Choose prepared exchange</span>
                    <input
                      type="file"
                      accept=".ena3d.json,application/json"
                      onChange={handlePreparedFile}
                      data-testid="prepared-file-input"
                    />
                  </label>
                </div>
                <p className="validation-hint">
                  Prepared exchanges are user-supplied and remain
                  <code> jenaExecuted: false</code>. This Web build ships no research
                  bytes, participant identity, public fixture hash, or approval claim.
                </p>

                <div
                  className={"prepared-import-status prepared-import-status--" + preparedImportStatus}
                  role="status"
                  aria-live="polite"
                  data-testid="prepared-import-status"
                  data-state={preparedImportStatus}
                >
                  {preparedImportStatus === "validating" ? (
                    <LoaderCircle className="spin" size={19} aria-hidden="true" />
                  ) : preparedImportStatus === "completed" ? (
                    <CheckCircle2 size={19} aria-hidden="true" />
                  ) : (
                    <FileJson2 size={19} aria-hidden="true" />
                  )}
                  <span>{preparedImportMessage}</span>
                </div>

                {preparedDataset ? (
                  <div
                    className="dataset-receipt prepared-dataset-receipt"
                    data-testid="prepared-dataset-receipt"
                    data-source={preparedDataset.source}
                    data-dataset-hash={preparedDataset.receipt.sha256}
                  >
                    <div>
                      <strong>{preparedDataset.name}</strong>
                      <span>User-selected prepared exchange</span>
                    </div>
                    <span>
                      {readableBytes(preparedDataset.receipt.byteLength)} ·{" "}
                      {preparedDataset.receipt.points} points · SHA-256{" "}
                      <code title={preparedDataset.receipt.sha256}>
                        {preparedDataset.receipt.sha256.slice(0, 12)}…
                      </code>
                    </span>
                  </div>
                ) : (
                  <div className="prepared-empty-receipt">
                    No prepared exchange has passed strict validation yet.
                  </div>
                )}
              </section>

              <section className="workspace-card" aria-labelledby="prepared-mapping-title">
                <div className="workspace-card__heading">
                  <span className="icon-tile"><ShieldCheck size={20} aria-hidden="true" /></span>
                  <div>
                    <p className="eyebrow">Step 2</p>
                    <h2 id="prepared-mapping-title">Fixed prepared-exchange roles</h2>
                  </div>
                </div>
                <div className="prepared-boundary" role="note">
                  <strong>Imported prepared shared space</strong>
                  <span>
                    Run decodes the exact committed bytes again and computes
                    display-space centroids and paths. It does not run raw-row
                    jENA model fitting.
                  </span>
                </div>
                <dl className="prepared-mapping-list">
                  <div><dt>Participant identity</dt><dd>Group + Speaker</dd></div>
                  <div><dt>Participant label</dt><dd>Speaker</dd></div>
                  <div><dt>Group</dt><dd>Group</dd></div>
                  <div><dt>Time</dt><dd>Period</dd></div>
                  <div><dt>Period order</dt><dd>TP1 → TP2 → TP3</dd></div>
                  <div><dt>Cohort policy</dt><dd>available</dd></div>
                  <div><dt>Display axes</dt><dd>SVD1 / SVD2 / SVD3</dd></div>
                </dl>
              </section>
            </>
          )}
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

            {mode === "raw" && validationMessage && status !== "running" && (
              <p className="validation-hint">{validationMessage}</p>
            )}
            {mode === "prepared" && !preparedDataset && status !== "running" && (
              <p className="validation-hint">
                Validate a prepared exchange before running this mode.
              </p>
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
                disabled={
                  status === "running" ||
                  (mode === "raw"
                    ? Boolean(validationMessage)
                    : !preparedDataset || preparedImportStatus === "validating")
                }
                data-testid="analysis-run"
              >
                <Play size={18} aria-hidden="true" />{" "}
                {mode === "raw" ? "Run 3D ENA" : "Analyze prepared space"}
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
              when dataset hash, specification hash, run ID, and analysis mode
              all match.
            </p>
          </section>
        </aside>
      </div>

      {ownedResult?.mode === "raw" && (
        <AnalysisResults
          key={ownedResult.owner.runId}
          result={ownedResult.result}
          owner={ownedResult.owner}
          datasetName={dataset.name}
          buildId={buildId}
          datasetByteLength={dataset.size}
          datasetColumns={dataset.headers.length}
          datasetSchema={rawDatasetSchema(dataset.headers, mapping)}
          datasetLimits={RAW_BROWSER_DATASET_LIMITS}
        />
      )}
      {ownedResult?.mode === "prepared" && (
        <PreparedAnalysisResults
          key={ownedResult.owner.runId}
          result={ownedResult.result}
          owner={ownedResult.owner}
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
