"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  ANALYSIS_CONTRACT_VERSION_V1,
  createAnalysisClient,
  type AnalysisClientV1,
  type AnalysisTaskV1,
} from "@3dena/analysis";
import type {
  ActivatedAnalysisTaskSpecV1,
  ActivatedEnaModelTaskSpecV1,
} from "@3dena/compute-service-http";
import {
  Ban,
  CheckCircle2,
  CloudCog,
  Database,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  Play,
  ShieldCheck,
  Square,
  Upload,
} from "lucide-react";
import { AnalysisResults } from "@/components/analysis-results";
import { PreparedAnalysisResults } from "@/components/prepared-analysis-results";
import {
  RemoteDerivedControls,
  RemoteDerivedResult,
} from "@/components/remote-derived-analysis";
import type { AnalysisMapping } from "@/lib/analysis-contract";
import type { WebExecutionPolicy } from "@/lib/execution-policy";
import {
  createRemoteFormalDownload,
  downloadRemoteFormalBundle,
} from "@/lib/remote-formal-download";
import {
  assertApprovedComputeBuild,
  cancelRemoteAnalysis,
  deleteRemoteJobData,
  runRemoteAnalysis,
  type VerifiedRemoteAnalysisResult,
} from "@/lib/remote-analysis-runtime";
import {
  createHttpRemoteDatasetWorkflowAdapter,
} from "@/lib/remote-dataset-http-adapter";
import {
  createUnavailableRemoteDatasetWorkflowAdapter,
  type RemoteActiveDataset,
  type RemoteDatasetInventory,
  type RemoteDatasetPreview,
  type RemoteDatasetWorkflowAdapter,
  type RemoteEnaSourceResult,
  type RemoteParsedWorksheet,
  type RemotePreparedDataset,
  type RemoteWorksheetSummary,
} from "@/lib/remote-dataset-workflow";
import { mappingForHeaders } from "@/lib/sample-data";

type RemoteStatus =
  | "checking"
  | "blocked"
  | "idle"
  | "uploading"
  | "mapping"
  | "preview"
  | "activated"
  | "running"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "invalidated"
  | "error";

type RemoteTaskKind = Exclude<AnalysisTaskV1["kind"], "prepared-import">;

const REMOTE_TASK_OPTIONS = Object.freeze([
  { kind: "ena-model", label: "ENA model", readiness: "ready" },
  { kind: "network-comparison", label: "Network comparison", readiness: "ready" },
  { kind: "change-network", label: "Change network", readiness: "ready" },
  { kind: "statistics", label: "Statistics", readiness: "ready" },
  { kind: "trajectory", label: "Trajectory", readiness: "ready" },
  { kind: "trajectory-comparison", label: "Trajectory comparison", readiness: "ready" },
  { kind: "bootstrap", label: "Bootstrap", readiness: "ready" },
] satisfies ReadonlyArray<{
  kind: RemoteTaskKind;
  label: string;
  readiness: "ready" | "blocked";
}>);

interface RemoteAnalysisWorkspaceProps {
  readonly webBuildId?: string;
  readonly policy: WebExecutionPolicy;
  readonly client?: AnalysisClientV1;
  readonly workflow?: RemoteDatasetWorkflowAdapter;
}

function uniqueId(prefix: string): string {
  const suffix = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function formatTypedValue(value: RemoteDatasetPreview["rows"][number][number]): string {
  if (!value) return "";
  switch (value.type) {
    case "null": return "—";
    case "double": return `0x${value.ieee754Hex}`;
    case "date": return value.value;
    case "instant": return `${value.epochMilliseconds} ms @ ${value.timeZone}`;
    case "duration": return `${value.value} ${value.unit}`;
    case "factor": return value.value;
    default: return String(value.value);
  }
}

function readableBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mappingError(mapping: AnalysisMapping): string | null {
  if (mapping.unitColumns.length === 0) return "Select at least one unit column.";
  if (!mapping.unitColumns.includes(mapping.groupColumn)) return "The group column must also be part of the unit tuple.";
  if (!mapping.unitColumns.includes(mapping.entityColumn)) return "The participant column must also be part of the unit tuple.";
  if (mapping.conversationColumns.length === 0) return "Select at least one conversation column.";
  if (!mapping.conversationColumns.includes(mapping.timeColumn)) return "The time column must also be part of the conversation tuple.";
  if (mapping.codeColumns.length < 3) return "Select at least three code columns.";
  return null;
}

export function RemoteAnalysisWorkspace({
  webBuildId,
  policy,
  client: suppliedClient,
  workflow: suppliedWorkflow,
}: RemoteAnalysisWorkspaceProps) {
  const client = useMemo(() => suppliedClient ?? (
    policy.computeBaseUrl
      ? createAnalysisClient({ baseUrl: policy.computeBaseUrl })
      : null
  ), [policy.computeBaseUrl, suppliedClient]);
  const workflow = useMemo(
    () => suppliedWorkflow ?? (
      policy.computeBaseUrl
        ? createHttpRemoteDatasetWorkflowAdapter({ baseUrl: policy.computeBaseUrl })
        : createUnavailableRemoteDatasetWorkflowAdapter()
    ),
    [policy.computeBaseUrl, suppliedWorkflow],
  );
  const [status, setStatus] = useState<RemoteStatus>(
    policy.blocker ? "blocked" : "checking",
  );
  const [message, setMessage] = useState(
    policy.blocker ?? "Verifying the remote compute build and dataset workflow contract…",
  );
  const [computeFlyBuildId, setComputeFlyBuildId] = useState<string | null>(null);
  const [executionBlocker, setExecutionBlocker] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inventory, setInventory] = useState<RemoteDatasetInventory | null>(null);
  const [prepared, setPrepared] = useState<RemotePreparedDataset | null>(null);
  const [worksheet, setWorksheet] = useState<RemoteWorksheetSummary | null>(null);
  const [parsed, setParsed] = useState<RemoteParsedWorksheet | null>(null);
  const [mapping, setMapping] = useState<AnalysisMapping | null>(null);
  const [preview, setPreview] = useState<RemoteDatasetPreview | null>(null);
  const [active, setActive] = useState<RemoteActiveDataset | null>(null);
  const [activeMapping, setActiveMapping] = useState<AnalysisMapping | null>(null);
  const [selectedTaskKind, setSelectedTaskKind] = useState<RemoteTaskKind>("ena-model");
  const [cleanupPending, setCleanupPending] = useState(false);
  const [downloadPending, setDownloadPending] = useState(false);
  const [sourceDeleting, setSourceDeleting] = useState(false);
  const [result, setResult] = useState<VerifiedRemoteAnalysisResult | null>(null);
  const [enaSource, setEnaSource] = useState<RemoteEnaSourceResult | null>(null);
  const [enaSourceResult, setEnaSourceResult] = useState<VerifiedRemoteAnalysisResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const activeJobRef = useRef<{
    client: AnalysisClientV1;
    reference: Parameters<typeof cancelRemoteAnalysis>[1];
  } | null>(null);
  const sourceJobRef = useRef<{
    client: AnalysisClientV1;
    reference: Parameters<typeof deleteRemoteJobData>[1];
  } | null>(null);
  const workflowIdRef = useRef<string | null>(null);
  const activeWorkflowIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (policy.blocker || !client) return;
    const controller = new AbortController();
    requestAbortRef.current = controller;
    void (async () => {
      try {
        const approved = await assertApprovedComputeBuild(
          client,
          policy.approvedRemoteBuild,
          webBuildId ?? null,
        );
        if (controller.signal.aborted) return;
        const capability = await workflow.capabilities(controller.signal);
        if (controller.signal.aborted) return;
        setComputeFlyBuildId(approved.flyBuildId);
        setExecutionBlocker(capability.executionBlocker);
        if (!capability.available) {
          setStatus("blocked");
          setMessage(capability.blocker ?? "The remote dataset workflow is unavailable.");
          return;
        }
        setStatus("idle");
        setMessage(capability.executionAvailable
          ? "Remote build, dataset workflow, and execution contracts verified. Choose a dataset to begin."
          : `Remote dataset workflow verified. ${capability.executionBlocker ?? "Scientific execution is unavailable."}`);
      } catch (runtimeError) {
        if (controller.signal.aborted) return;
        setStatus("blocked");
        setMessage(runtimeError instanceof Error
          ? runtimeError.message
          : "Remote execution readiness could not be verified.");
      }
    })();
    return () => controller.abort();
  }, [client, policy.approvedRemoteBuild, policy.blocker, webBuildId, workflow]);

  useEffect(() => () => {
    generationRef.current += 1;
    requestAbortRef.current?.abort();
    const activeJob = activeJobRef.current;
    if (activeJob) void cancelRemoteAnalysis(activeJob.client, activeJob.reference).catch(() => undefined);
    const sourceJob = sourceJobRef.current;
    if (sourceJob) void deleteRemoteJobData(sourceJob.client, sourceJob.reference).catch(() => undefined);
    const workflowId = workflowIdRef.current;
    if (workflowId) void workflow.discard(workflowId).catch(() => undefined);
    const activeWorkflowId = activeWorkflowIdRef.current;
    if (activeWorkflowId && activeWorkflowId !== workflowId) {
      void workflow.discard(activeWorkflowId).catch(() => undefined);
    }
  }, [workflow]);

  function abortRequests(): void {
    generationRef.current += 1;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
  }

  function invalidateAfterSelection(): void {
    abortRequests();
    setInventory(null);
    setPrepared(null);
    setWorksheet(null);
    setParsed(null);
    setMapping(null);
    setPreview(null);
    setProgress(0);
    setError(null);
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    invalidateAfterSelection();
    setSelectedFile(file);
    if (file) setMessage(`${file.name} selected. Confirm server processing, then upload for authoritative inspection.`);
  }

  async function inspectSelected(): Promise<void> {
    if (!selectedFile || !consent || status === "blocked") return;
    abortRequests();
    const generation = generationRef.current;
    const controller = new AbortController();
    requestAbortRef.current = controller;
    setStatus("uploading");
    setError(null);
    const preparedExchange = selectedFile.name.toLocaleLowerCase("en-US").endsWith(".ena3d.json");
    setMessage(preparedExchange
      ? "Strictly validating an owned local snapshot before any service upload…"
      : "Uploading exact bytes and waiting for authoritative service inventory…");
    try {
      if (preparedExchange) {
        const nextPrepared = await workflow.inspectPrepared(
          selectedFile,
          controller.signal,
          (update) => {
            if (generation !== generationRef.current) return;
            const percent = update.total && update.total > 0
              ? Math.round((update.completed / update.total) * 100)
              : 0;
            setProgress(Math.max(0, Math.min(100, percent)));
            setMessage(update.message);
          },
        );
        if (generation !== generationRef.current) return;
        workflowIdRef.current = nextPrepared.workflowId;
        setPrepared(nextPrepared);
        setStatus("preview");
        setMessage("Prepared exchange passed strict local preflight. Review the exact inventory and frozen mapping, then explicitly activate service parsing. No service upload has occurred yet.");
        return;
      }
      const next = await workflow.inspect(selectedFile, controller.signal, (update) => {
        if (generation !== generationRef.current) return;
        const percent = update.total && update.total > 0
          ? Math.round((update.completed / update.total) * 100)
          : 0;
        setProgress(Math.max(0, Math.min(100, percent)));
        setMessage(update.message);
      });
      if (generation !== generationRef.current) return;
      workflowIdRef.current = next.workflowId;
      setInventory(next);
      const selectable = next.worksheets.filter((candidate) => candidate.selectable);
      const selected = selectable.length === 1 ? selectable[0] ?? null : null;
      setWorksheet(selected);
      setStatus("mapping");
      setMessage(selected
        ? "Authoritative inventory received. Parse the selected worksheet to map roles."
        : "Authoritative inventory received. Choose one visible worksheet explicitly.");
    } catch (inspectError) {
      if (generation !== generationRef.current) return;
      setStatus("error");
      const nextMessage = inspectError instanceof Error ? inspectError.message : "Remote inspection failed.";
      setError(`${nextMessage} The previously active dataset was not replaced.`);
    }
  }

  async function runPreparedAnalysis(): Promise<void> {
    if (!prepared || !client || status === "blocked" || enaSource) return;
    abortRequests();
    const generation = generationRef.current;
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const runId = uniqueId("prepared-run");
    setStatus("running");
    setResult(null);
    setError(null);
    setProgress(0);
    setMessage("Creating a capability-bound prepared source job and uploading the exact reviewed bytes…");
    try {
      const binding = await workflow.bindPreparedExecution(
        prepared,
        runId,
        Date.now() + 15 * 60_000,
        controller.signal,
      );
      if (generation !== generationRef.current) return;
      activeJobRef.current = { client, reference: binding.reference };
      setCleanupPending(true);
      const verified = await runRemoteAnalysis({
        client,
        binding,
        approvedRemoteBuild: policy.approvedRemoteBuild,
        currentWebBuildId: webBuildId ?? null,
        signal: controller.signal,
        onProgress(update) {
          if (generation !== generationRef.current) return;
          const percent = update.total && update.total > 0
            ? Math.round((update.completed / update.total) * 100)
            : 0;
          setProgress(Math.max(0, Math.min(100, percent)));
          setMessage(`Remote ${update.phase}: ${update.completed}${update.total === null ? "" : ` of ${update.total}`}.`);
        },
      });
      if (generation !== generationRef.current) return;
      if (verified.envelope.taskKind !== "prepared-import"
          || verified.envelope.result.schemaVersion !== "3dena.prepared-space-result.v1") {
        throw new Error("The verified service result is not a prepared-space source.");
      }
      sourceJobRef.current = { client, reference: binding.reference };
      activeJobRef.current = null;
      setCleanupPending(false);
      setActive({
        workflowId: prepared.workflowId,
        activationIdentity: binding.datasetReceipt.activationIdentity,
        receipt: binding.datasetReceipt,
      });
      setEnaSource({
        reference: binding.reference,
        datasetReceipt: binding.datasetReceipt,
        sourceResultHash: verified.envelope.provenance.resultHash,
        sourceKind: "prepared-exchange",
      });
      setEnaSourceResult(verified);
      setResult(verified);
      setPrepared(null);
      workflowIdRef.current = null;
      setProgress(100);
      setStatus("completed");
      setMessage("Prepared source activated. The service re-read the immutable upload, verified its exact bytes, executed the strict exchange parser and frozen mapping, and published a checksum-verified prepared-space result. jENA was not executed.");
    } catch (runError) {
      if (generation !== generationRef.current) return;
      const cleanup = activeJobRef.current;
      if (cleanup) {
        try {
          await deleteRemoteJobData(cleanup.client, cleanup.reference);
          if (generation !== generationRef.current) return;
          activeJobRef.current = null;
          setCleanupPending(false);
        } catch (cleanupError) {
          if (generation !== generationRef.current) return;
          setCleanupPending(true);
          setStatus("error");
          setError(`${runError instanceof Error ? runError.message : "Prepared activation failed."} Cleanup is still required: ${cleanupError instanceof Error ? cleanupError.message : "service deletion was not observed."}`);
          return;
        }
      }
      setStatus("error");
      setError(runError instanceof Error ? runError.message : "Prepared activation failed.");
    }
  }

  async function parseSelectedWorksheet(): Promise<void> {
    if (!inventory || !worksheet) return;
    abortRequests();
    const generation = generationRef.current;
    const controller = new AbortController();
    requestAbortRef.current = controller;
    setStatus("mapping");
    setError(null);
    setMessage("Parsing the exact selected worksheet on the service…");
    try {
      const next = await workflow.parseWorksheet(inventory, worksheet, controller.signal);
      if (generation !== generationRef.current) return;
      setParsed(next);
      setMapping(mappingForHeaders([...next.headers]));
      setPreview(null);
      setMessage("Header contract received. Freeze the ordered scientific role mapping to request a typed preview.");
    } catch (parseError) {
      if (generation !== generationRef.current) return;
      setStatus("error");
      setError(`${parseError instanceof Error ? parseError.message : "Worksheet parsing failed."} The active dataset was preserved.`);
    }
  }

  function updateMapping(next: AnalysisMapping): void {
    abortRequests();
    setMapping(next);
    setPreview(null);
    setStatus("mapping");
    setMessage(active
      ? "Candidate mapping changed. The previously activated dataset and result remain available until a replacement is explicitly activated."
      : "Mapping changed. Request a new service-generated typed preview before activation.");
  }

  async function requestPreview(): Promise<void> {
    if (!parsed || !mapping || mappingError(mapping)) return;
    abortRequests();
    const generation = generationRef.current;
    const controller = new AbortController();
    requestAbortRef.current = controller;
    setError(null);
    setMessage("Validating the ordered mapping and generating a bounded typed preview on the service…");
    try {
      const next = await workflow.prepare(parsed, mapping, controller.signal);
      if (generation !== generationRef.current) return;
      setPreview(next);
      setStatus("preview");
      setMessage(next.activatable
        ? "Typed preview received. Review it, then explicitly activate this candidate."
        : "The service rejected activation. Resolve the diagnostics and request another preview.");
    } catch (previewError) {
      if (generation !== generationRef.current) return;
      setStatus("error");
      setError(`${previewError instanceof Error ? previewError.message : "Preview preparation failed."} The active dataset was preserved.`);
    }
  }

  async function activatePreview(): Promise<void> {
    if (!preview?.activatable || !mapping) return;
    abortRequests();
    const generation = generationRef.current;
    const controller = new AbortController();
    requestAbortRef.current = controller;
    setError(null);
    setMessage("Atomically activating the reviewed service candidate…");
    let previousSourceDeleted = false;
    try {
      const retainedSource = sourceJobRef.current;
      if (retainedSource) {
        if (active?.workflowId === preview.workflowId) {
          throw new Error("The original raw bytes were deleted after ENA publication. Choose and upload the dataset again before refitting or remapping it.");
        }
        setMessage("Deleting the previous service-owned ENA source before activating its replacement…");
        await deleteRemoteJobData(retainedSource.client, retainedSource.reference);
        if (generation !== generationRef.current) return;
        previousSourceDeleted = true;
        sourceJobRef.current = null;
        setEnaSource(null);
        setEnaSourceResult(null);
        setResult(null);
        setActive(null);
        setActiveMapping(null);
        if (active?.workflowId) await workflow.discard(active.workflowId, controller.signal);
        if (generation !== generationRef.current) return;
        activeWorkflowIdRef.current = null;
      }
      const next = await workflow.activate(
        preview,
        active?.activationIdentity ?? null,
        controller.signal,
      );
      if (generation !== generationRef.current) return;
      setActive(next);
      activeWorkflowIdRef.current = next.workflowId;
      setActiveMapping({
        ...mapping,
        unitColumns: [...mapping.unitColumns],
        conversationColumns: [...mapping.conversationColumns],
        codeColumns: [...mapping.codeColumns],
      });
      setResult(null);
      setStatus("activated");
      setMessage("Dataset activated. Its receipt is bound to the exact upload, parsed content, mapping, and preview.");
    } catch (activationError) {
      if (generation !== generationRef.current) return;
      setStatus("error");
      setError(`${activationError instanceof Error ? activationError.message : "Activation failed."} ${previousSourceDeleted
        ? "The previous ENA source was already attested deleted; it was not preserved. Upload and activate the dataset again before another ENA run."
        : "The previous active dataset was preserved."}`);
    }
  }

  async function runAnalysis(): Promise<void> {
    if (!active || !activeMapping || !client || status === "blocked"
        || selectedTaskKind !== "ena-model" || enaSource) return;
    abortRequests();
    const generation = generationRef.current;
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const runId = uniqueId("remote-run");
    setStatus("running");
    setResult(null);
    setError(null);
    setProgress(0);
    setMessage("Binding the activated receipt to a new immutable remote run…");
    try {
      const task: ActivatedEnaModelTaskSpecV1 = {
        schemaVersion: "3dena.activated-ena-model-task-spec.v1",
        kind: "ena-model",
        runId,
        deadlineEpochMilliseconds: Date.now() + 15 * 60_000,
        spec: {
          schemaVersion: "3dena.analysis-spec.v1",
          model: activeMapping.model,
          window: activeMapping.window,
          weightBy: "binary",
          windowSizeBack: activeMapping.windowSizeBack,
          windowSizeForward: 0,
          centerAlignToOrigin: true,
          cohortPolicy: "available",
        },
      };
      const binding = await workflow.bindExecution(
        active,
        task,
        controller.signal,
      );
      if (generation !== generationRef.current) return;
      activeJobRef.current = { client, reference: binding.reference };
      setCleanupPending(true);
      const verified = await runRemoteAnalysis({
        client,
        binding,
        approvedRemoteBuild: policy.approvedRemoteBuild,
        currentWebBuildId: webBuildId ?? null,
        signal: controller.signal,
        onProgress(update) {
          if (generation !== generationRef.current) return;
          const percent = update.total && update.total > 0
            ? Math.round((update.completed / update.total) * 100)
            : 0;
          setProgress(Math.max(0, Math.min(100, percent)));
          setMessage(`Remote ${update.phase}: ${update.completed}${update.total === null ? "" : ` of ${update.total}`}.`);
        },
      });
      if (generation !== generationRef.current) return;
      sourceJobRef.current = { client, reference: binding.reference };
      activeJobRef.current = null;
      setCleanupPending(false);
      setEnaSource({
        reference: binding.reference,
        datasetReceipt: binding.datasetReceipt,
        sourceResultHash: verified.envelope.provenance.resultHash,
      });
      setEnaSourceResult(verified);
      setResult(verified);
      setProgress(100);
      setStatus("completed");
      setMessage("Remote ENA completed. Exact result bytes passed SHA-256, schema, variant, build, and ownership validation. Raw activation bytes are deleted at terminal publication; the service-owned ENA result remains capability-bound only for this derived-analysis session.");
    } catch (runError) {
      if (generation !== generationRef.current) return;
      const cleanup = activeJobRef.current;
      if (cleanup) {
        try {
          await deleteRemoteJobData(cleanup.client, cleanup.reference);
          if (generation !== generationRef.current) return;
          activeJobRef.current = null;
          setCleanupPending(false);
        } catch (cleanupError) {
          if (generation !== generationRef.current) return;
          setCleanupPending(true);
          setStatus("error");
          setError(`${runError instanceof Error ? runError.message : "Remote analysis failed."} Cleanup is still required: ${cleanupError instanceof Error ? cleanupError.message : "service deletion was not observed."}`);
          return;
        }
      }
      setStatus("error");
      setError(runError instanceof Error ? runError.message : "Remote analysis failed.");
    }
  }

  async function runDerivedAnalysis(task: ActivatedAnalysisTaskSpecV1): Promise<void> {
    if (!client || !enaSource || !enaSourceResult || task.kind === "ena-model"
        || task.kind !== selectedTaskKind || status === "blocked") return;
    abortRequests();
    const generation = generationRef.current;
    const controller = new AbortController();
    requestAbortRef.current = controller;
    setStatus("running");
    setResult(null);
    setError(null);
    setProgress(0);
    setMessage("Authorizing a derived job against the retained service-owned scientific result hash…");
    try {
      const binding = await workflow.bindDerivedExecution(enaSource, task, controller.signal);
      if (generation !== generationRef.current) return;
      activeJobRef.current = { client, reference: binding.reference };
      setCleanupPending(true);
      const verified = await runRemoteAnalysis({
        client,
        binding,
        approvedRemoteBuild: policy.approvedRemoteBuild,
        currentWebBuildId: webBuildId ?? null,
        signal: controller.signal,
        onProgress(update) {
          if (generation !== generationRef.current) return;
          const percent = update.total && update.total > 0
            ? Math.round((update.completed / update.total) * 100)
            : 0;
          setProgress(Math.max(0, Math.min(100, percent)));
          setMessage(`Remote ${update.phase}: ${update.completed}${update.total === null ? "" : ` of ${update.total}`}.`);
        },
      });
      if (generation !== generationRef.current) return;
      await deleteRemoteJobData(client, binding.reference);
      if (generation !== generationRef.current) return;
      activeJobRef.current = null;
      setCleanupPending(false);
      setResult(verified);
      setProgress(100);
      setStatus("completed");
      setMessage("Derived analysis completed. Exact result bytes and ownership passed verification; its derived job objects are attested deleted. The scientific source remains capability-bound for another reviewed derived task.");
    } catch (runError) {
      if (generation !== generationRef.current) return;
      const cleanup = activeJobRef.current;
      if (cleanup) {
        try {
          await deleteRemoteJobData(cleanup.client, cleanup.reference);
          if (generation !== generationRef.current) return;
          activeJobRef.current = null;
          setCleanupPending(false);
        } catch (cleanupError) {
          if (generation !== generationRef.current) return;
          setCleanupPending(true);
          setStatus("error");
          setError(`${runError instanceof Error ? runError.message : "Remote derived analysis failed."} Cleanup is still required: ${cleanupError instanceof Error ? cleanupError.message : "service deletion was not observed."}`);
          return;
        }
      }
      setStatus("error");
      setError(runError instanceof Error ? runError.message : "Remote derived analysis failed.");
    }
  }

  async function cancelAnalysis(): Promise<void> {
    const activeJob = activeJobRef.current;
    if (!activeJob || (status !== "running" && !cleanupPending)) return;
    const cancellingRunningWork = status === "running";
    if (cancellingRunningWork) requestAbortRef.current?.abort();
    generationRef.current += 1;
    setStatus("cancelling");
    setResult(null);
    setMessage(cancellingRunningWork
      ? "Cancellation requested. Waiting for the service deletion receipt and observed capacity release…"
      : "Retrying deletion of remote input and result objects…");
    try {
      if (cancellingRunningWork) {
        await cancelRemoteAnalysis(activeJob.client, activeJob.reference);
      } else {
        await deleteRemoteJobData(activeJob.client, activeJob.reference);
      }
      if (activeJobRef.current !== activeJob) return;
      activeJobRef.current = null;
      setCleanupPending(false);
      setStatus("cancelled");
      setProgress(0);
      setMessage(cancellingRunningWork
        ? "Cancellation observed. Input and result objects are attested deleted."
        : "Remote input and result deletion is now attested.");
    } catch (cancelError) {
      if (activeJobRef.current !== activeJob) return;
      setStatus("error");
      setError(cancelError instanceof Error ? cancelError.message : "Remote cancellation was not observed.");
    }
  }

  async function endSourceSession(): Promise<void> {
    const sourceJob = sourceJobRef.current;
    if (!sourceJob || status === "running" || status === "cancelling") return;
    abortRequests();
    setSourceDeleting(true);
    setStatus("cancelling");
    setError(null);
    setMessage("Deleting the retained scientific source result and closing its dataset session…");
    try {
      if (activeWorkflowIdRef.current) {
        await workflow.discard(activeWorkflowIdRef.current);
        activeWorkflowIdRef.current = null;
        workflowIdRef.current = null;
        setActive(null);
        setActiveMapping(null);
      }
      await deleteRemoteJobData(sourceJob.client, sourceJob.reference);
      sourceJobRef.current = null;
      setActive(null);
      setActiveMapping(null);
      setEnaSource(null);
      setEnaSourceResult(null);
      setResult(null);
      setSelectedTaskKind("ena-model");
      setProgress(0);
      setStatus("idle");
      setMessage("The scientific source result and dataset session are attested deleted. Upload the dataset again to begin another analysis session.");
    } catch (deleteError) {
      setStatus("error");
      setError(deleteError instanceof Error ? deleteError.message : "Source-session deletion was not observed.");
    } finally {
      setSourceDeleting(false);
    }
  }

  async function downloadVerifiedResult(): Promise<void> {
    if (!result || !active || !policy.approvedRemoteBuild || !webBuildId) return;
    setDownloadPending(true);
    setError(null);
    try {
      const bundle = await createRemoteFormalDownload({
        verified: result,
        sourceVerified: enaSourceResult ?? result,
        activeDataset: active,
        approvedBuild: policy.approvedRemoteBuild,
        currentWebBuildId: webBuildId,
      });
      downloadRemoteFormalBundle(bundle);
      setMessage("Formal CSV/ZIP/manifest, exact verified result bytes, provenance, and the active build approval were packaged into one deterministic download.");
    } catch (downloadError) {
      setError(downloadError instanceof Error
        ? downloadError.message
        : "The formal verified download could not be created.");
    } finally {
      setDownloadPending(false);
    }
  }

  const mappingValidation = mapping ? mappingError(mapping) : null;
  const serviceReady = status !== "blocked" && computeFlyBuildId !== null;
  const selectedTaskLabel = REMOTE_TASK_OPTIONS.find(
    (option) => option.kind === selectedTaskKind,
  )?.label ?? selectedTaskKind;
  const taskProductBlocker = selectedTaskKind === "ena-model"
    ? enaSource
      ? "This scientific source is already frozen and its uploaded activation bytes are deleted. Use a derived task, or end the source session before activating a replacement."
      : prepared
        ? "This is a prepared coordinate-space exchange, not raw rows. Use its explicit service-parser activation control; no jENA model fit will be claimed."
        : null
    : enaSource && enaSourceResult
      ? null
      : `${selectedTaskLabel} requires a checksum-verified, service-owned scientific source result. Run ENA or activate a prepared exchange first; no derived job will be allocated before that source binding exists.`;
  const effectiveExecutionBlocker = executionBlocker ?? taskProductBlocker;

  return (
    <div
      className="workspace-shell section-shell remote-workspace"
      data-testid="analysis-workspace"
      data-analysis-mode="remote"
      data-execution-mode="remote"
    >
      <header className="workspace-heading remote-workspace__heading">
        <div>
          <p className="eyebrow">Persistent remote analysis workspace</p>
          <h1>Inspect, activate, and analyze with an approved service.</h1>
          <p>
            Production never falls back to browser computation. A dataset becomes
            active only after service inventory, exact worksheet selection,
            ordered mapping, typed preview, and explicit activation all succeed.
          </p>
        </div>
        <div className="privacy-chip privacy-chip--remote">
          <CloudCog size={20} aria-hidden="true" />
          <span><strong>Remote execution</strong> Region: {policy.processingRegion}</span>
        </div>
      </header>

      <ol className="workflow-steps workflow-steps--remote" aria-label="Remote dataset workflow">
        {[
          ["1", "Consent & upload"],
          ["2", "Inventory & sheet"],
          ["3", "Mapping & preview"],
          ["4", "Activation & analysis"],
          ["5", "Verified download"],
        ].map(([number, label]) => <li key={number}><strong>{number}</strong>{label}</li>)}
      </ol>

      <section className="remote-runtime-card" aria-labelledby="remote-runtime-title">
        <div>
          <span className="icon-tile"><ShieldCheck size={20} aria-hidden="true" /></span>
          <div>
            <p className="eyebrow">Fail-closed runtime gate</p>
            <h2 id="remote-runtime-title">Service readiness</h2>
          </div>
        </div>
        <div
          className={`remote-runtime-state remote-runtime-state--${status}`}
          role={status === "blocked" || status === "error" ? "alert" : "status"}
          aria-live="polite"
          data-testid="remote-runtime-status"
          data-state={status}
        >
          {status === "checking" || status === "uploading" || status === "running" || status === "cancelling"
            ? <LoaderCircle className="spin" size={20} aria-hidden="true" />
            : status === "blocked" || status === "error"
              ? <Ban size={20} aria-hidden="true" />
              : <CheckCircle2 size={20} aria-hidden="true" />}
          <span>{message}</span>
        </div>
        <dl className="remote-runtime-receipt">
          <div><dt>Web build</dt><dd>{webBuildId ?? "unresolved"}</dd></div>
          <div><dt>Fly compute build</dt><dd data-testid="remote-compute-build">{computeFlyBuildId ?? "not approved"}</dd></div>
          <div><dt>Approval manifest</dt><dd><code>{policy.approvedRemoteBuild?.approvalManifestSha256 ?? "not active"}</code></dd></div>
          <div><dt>Analysis contract</dt><dd>{ANALYSIS_CONTRACT_VERSION_V1}</dd></div>
          <div><dt>Raw retention</dt><dd>Deleted after terminal publication; hard limit {policy.retentionHours} hours</dd></div>
        </dl>
      </section>

      <div className="remote-product-grid">
        <div className="workspace-controls">
          <section className="workspace-card" aria-labelledby="remote-upload-title">
            <div className="workspace-card__heading">
              <span className="icon-tile"><Upload size={20} aria-hidden="true" /></span>
              <div><p className="eyebrow">Step 1</p><h2 id="remote-upload-title">Consent and upload</h2></div>
            </div>
            <div className="processing-notice">
              <strong>Before uploading</strong>
              <p>
                Exact file bytes will be processed by the approved compute service
                in <strong>{policy.processingRegion}</strong>. Raw input is deleted
                immediately after terminal result publication; abandoned jobs and
                results have a hard maximum retention of {policy.retentionHours} hours.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.currentTarget.checked)}
                  disabled={!serviceReady}
                  data-testid="remote-processing-consent"
                />
                <span>I understand and consent to this server processing and retention policy.</span>
              </label>
            </div>
            <label className="file-control remote-file-control">
              <span><FileSpreadsheet size={18} aria-hidden="true" /> Choose CSV, XLS, XLSX, or .ena3d.json</span>
              <input
                type="file"
                accept=".csv,.xls,.xlsx,.ena3d.json,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/json"
                onChange={handleFile}
                disabled={!serviceReady || status === "running" || status === "cancelling"}
                data-testid="remote-file-input"
              />
            </label>
            <p className="validation-hint">
              Prepared <code>.ena3d.json</code> is locally preflighted first; the
              exact bytes are uploaded only after you review its inventory and frozen mapping and explicitly activate service parsing.
            </p>
            {selectedFile && (
              <div className="dataset-receipt" data-testid="remote-selected-file">
                <div><strong>{selectedFile.name}</strong><span>Selected locally; not authoritative</span></div>
                <span>{readableBytes(selectedFile.size)}</span>
              </div>
            )}
            <button
              type="button"
              className="button button--primary"
              onClick={() => void inspectSelected()}
              disabled={!serviceReady || !consent || !selectedFile || status === "uploading"}
              data-testid="remote-upload-inspect"
            >
              <Upload size={18} aria-hidden="true" /> Upload and inspect
            </button>
          </section>

          {prepared && (
            <section className="workspace-card" aria-labelledby="remote-prepared-title">
              <div className="workspace-card__heading">
                <span className="icon-tile"><Database size={20} aria-hidden="true" /></span>
                <div><p className="eyebrow">Prepared source review</p><h2 id="remote-prepared-title">Strict exchange inventory and frozen mapping</h2></div>
              </div>
              <dl className="remote-runtime-receipt" data-testid="remote-prepared-inventory">
                <div><dt>Exact SHA-256</dt><dd><code>{prepared.sha256}</code></dd></div>
                <div><dt>Exact bytes</dt><dd>{readableBytes(prepared.byteLength)}</dd></div>
                <div><dt>Scientific shape</dt><dd>{prepared.points} points · {prepared.nodes} nodes · {prepared.edges} edges</dd></div>
                <div><dt>Space</dt><dd>{prepared.dimensions.length} dimensions · {prepared.groups} groups · {prepared.periods.join(" → ")}</dd></div>
                <div><dt>Participant identity</dt><dd>{prepared.mapping.participant.join(" + ")}</dd></div>
                <div><dt>Group / time</dt><dd>{prepared.mapping.group} / {prepared.mapping.time}</dd></div>
                <div><dt>Display dimensions</dt><dd>{prepared.mapping.displayDimensions.join(" / ")}</dd></div>
                <div><dt>Cohort policy</dt><dd>{prepared.mapping.cohortPolicy}</dd></div>
              </dl>
              <div className="table-scroll dataset-preview" role="region" aria-label="Prepared exchange table inventory" tabIndex={0}>
                <table>
                  <caption>Exact strict-parser table inventory</caption>
                  <thead><tr><th scope="col">Table</th><th scope="col">Rows</th><th scope="col">Columns</th></tr></thead>
                  <tbody>{prepared.tables.map((table) => (
                    <tr key={table.name}><th scope="row">{table.name}</th><td>{table.rows}</td><td>{table.columns}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="processing-notice" role="note">
                <strong>Scientific boundary</strong>
                <p>This activation imports an existing prepared coordinate space. The service does not refit raw rows and records <code>jenaExecuted: false</code>.</p>
              </div>
              <button
                type="button"
                className="button button--primary"
                onClick={() => void runPreparedAnalysis()}
                disabled={Boolean(executionBlocker) || Boolean(enaSource) || cleanupPending || sourceDeleting || status === "running" || status === "cancelling"}
                data-testid="remote-prepared-activate"
              ><CheckCircle2 size={18} aria-hidden="true" /> Explicitly activate service parser</button>
            </section>
          )}

          {inventory && (
            <section className="workspace-card" aria-labelledby="remote-inventory-title">
              <div className="workspace-card__heading">
                <span className="icon-tile"><Database size={20} aria-hidden="true" /></span>
                <div><p className="eyebrow">Step 2</p><h2 id="remote-inventory-title">Service inventory</h2></div>
              </div>
              <dl className="remote-runtime-receipt">
                <div><dt>Format</dt><dd>{inventory.format}</dd></div>
                <div><dt>Exact SHA-256</dt><dd><code>{inventory.sha256}</code></dd></div>
                <div><dt>Parser</dt><dd>{inventory.parserVersion}</dd></div>
              </dl>
              <label className="field-label" htmlFor="remote-worksheet-select">Worksheet</label>
              <select
                id="remote-worksheet-select"
                value={worksheet ? `${worksheet.index}` : ""}
                onChange={(event) => {
                  abortRequests();
                  const next = inventory.worksheets.find((candidate) => `${candidate.index}` === event.currentTarget.value) ?? null;
                  setWorksheet(next?.selectable ? next : null);
                  setParsed(null);
                  setMapping(null);
                  setPreview(null);
                }}
                disabled={status === "running" || status === "cancelling"}
                data-testid="remote-worksheet-select"
              >
                <option value="">Choose a visible worksheet</option>
                {inventory.worksheets.map((candidate) => (
                  <option key={`${candidate.index}-${candidate.name}`} value={candidate.index} disabled={!candidate.selectable}>
                    {candidate.name}{candidate.hidden ? " (hidden; unavailable)" : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="button button--secondary"
                disabled={!worksheet}
                onClick={() => void parseSelectedWorksheet()}
                data-testid="remote-parse-sheet"
              >Parse exact worksheet</button>
            </section>
          )}

          {parsed && mapping && (
            <RemoteMappingEditor
              headers={[...parsed.headers]}
              mapping={mapping}
              error={mappingValidation}
              onChange={updateMapping}
              onPreview={() => void requestPreview()}
            />
          )}

          {preview && (
            <section className="workspace-card" aria-labelledby="remote-preview-title">
              <div className="workspace-card__heading">
                <span className="icon-tile"><FileSpreadsheet size={20} aria-hidden="true" /></span>
                <div><p className="eyebrow">Step 3</p><h2 id="remote-preview-title">Typed preview</h2></div>
              </div>
              <div className="table-scroll dataset-preview" role="region" aria-label="Service typed preview" tabIndex={0}>
                <table data-testid="remote-typed-preview">
                  <caption>{preview.rows.length} of {preview.totalRows} rows; values include explicit type encodings</caption>
                  <thead><tr>{preview.headers.map((header) => <th scope="col" key={header}>{header}</th>)}</tr></thead>
                  <tbody>{preview.rows.map((row, rowIndex) => (
                    <tr key={`typed-${rowIndex}`}>{row.map((value, columnIndex) => (
                      <td key={`${rowIndex}-${preview.headers[columnIndex]}`}>{formatTypedValue(value)}</td>
                    ))}</tr>
                  ))}</tbody>
                </table>
              </div>
              {preview.diagnostics.length > 0 && (
                <ul className="remote-diagnostics" aria-label="Dataset diagnostics">
                  {preview.diagnostics.map((diagnostic) => (
                    <li key={`${diagnostic.code}-${diagnostic.path}`} data-severity={diagnostic.severity}>
                      <strong>{diagnostic.code}</strong> {diagnostic.message}
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                className="button button--primary"
                disabled={!preview.activatable}
                onClick={() => void activatePreview()}
                data-testid="remote-activate"
              >
                <CheckCircle2 size={18} aria-hidden="true" /> Explicitly activate reviewed dataset
              </button>
            </section>
          )}
        </div>

        <aside className="run-column" aria-labelledby="remote-run-title">
          <section className="workspace-card run-card">
            <div className="workspace-card__heading">
              <span className="icon-tile"><CloudCog size={20} aria-hidden="true" /></span>
              <div><p className="eyebrow">Step 4</p><h2 id="remote-run-title">Remote analysis</h2></div>
            </div>
            <div className="progress-block" aria-label={`Remote analysis progress: ${progress}%`}>
              <div><span>Observed service progress</span><strong>{progress}%</strong></div>
              <progress max="100" value={progress}>{progress}%</progress>
              <p>{message}</p>
            </div>
            {active ? (
              <div className="remote-activation-receipt" data-testid="remote-activation-receipt" data-activation-id={active.activationIdentity}>
                <strong>Active service dataset</strong>
                <span>SHA-256 <code>{active.receipt.sha256.slice(0, 16)}…</code></span>
                <span>{active.receipt.rows} rows · {active.receipt.columns} columns</span>
              </div>
            ) : <p className="validation-hint">No service dataset is active.</p>}
            <label className="field-label" htmlFor="remote-task-kind">Analysis task</label>
            <select
              id="remote-task-kind"
              value={selectedTaskKind}
              onChange={(event) => {
                setSelectedTaskKind(event.currentTarget.value as RemoteTaskKind);
                setError(null);
                setProgress(0);
              }}
              disabled={status === "running" || status === "cancelling"}
              data-testid="remote-task-kind"
            >
              {REMOTE_TASK_OPTIONS.map((option) => (
                <option key={option.kind} value={option.kind}>
                  {option.label} — ready
                </option>
              ))}
            </select>
            <p className="validation-hint">
              All seven public analysis task discriminators use the persistent remote route.
              Prepared import is a separate source-activation contract; derived tasks bind either verified source kind and never enter a browser Worker.
            </p>
            {effectiveExecutionBlocker && (
              <p className="validation-hint" role="note" data-testid="remote-execution-blocker">
                {effectiveExecutionBlocker}
              </p>
            )}
            {error && <div className="analysis-error" role="alert" data-testid="remote-analysis-error"><strong>Needs attention</strong><span>{error}</span></div>}
            <div className="run-actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => void runAnalysis()}
                disabled={!active || selectedTaskKind !== "ena-model" || Boolean(effectiveExecutionBlocker) || cleanupPending || sourceDeleting || status === "running" || status === "cancelling"}
                data-testid="remote-analysis-run"
              ><Play size={18} aria-hidden="true" /> {selectedTaskKind === "ena-model" ? "Run ENA on approved service" : "Use scientific controls below"}</button>
              <button
                type="button"
                className="button button--danger"
                onClick={() => void cancelAnalysis()}
                disabled={status !== "running" && !cleanupPending}
                data-testid="remote-analysis-cancel"
              ><Square size={17} aria-hidden="true" /> {status === "running" ? "Cancel and delete" : "Retry remote deletion"}</button>
            </div>
            {result && (
              <button
                type="button"
                className="button button--secondary remote-download"
                onClick={() => void downloadVerifiedResult()}
                disabled={downloadPending}
                data-testid="remote-verified-download"
              ><Download size={18} aria-hidden="true" /> {downloadPending ? "Building formal bundle…" : "Download formal verified ZIP"}</button>
            )}
            {enaSource && (
              <button
                type="button"
                className="button button--danger remote-download"
                onClick={() => void endSourceSession()}
                disabled={sourceDeleting || status === "running" || status === "cancelling"}
                data-testid="remote-source-delete"
              ><Square size={17} aria-hidden="true" /> {sourceDeleting ? "Deleting source session…" : "End session and delete scientific source"}</button>
            )}
          </section>
        </aside>
      </div>

      {enaSource && enaSourceResult && selectedTaskKind !== "ena-model" && (
        <RemoteDerivedControls
          key={`${enaSource.sourceResultHash}-${selectedTaskKind}`}
          kind={selectedTaskKind}
          source={enaSourceResult}
          running={status === "running"}
          onRun={(task) => void runDerivedAnalysis(task)}
        />
      )}

      {result && result.envelope.taskKind !== "ena-model" && result.envelope.taskKind !== "prepared-import" && (
        <RemoteDerivedResult verified={result} />
      )}

      {enaSourceResult && active
        && enaSourceResult.envelope.taskKind === "ena-model"
        && enaSourceResult.envelope.result.schemaVersion === "3dena.analysis-result.v1" && (
        <AnalysisResults
          result={enaSourceResult.envelope.result}
          owner={{
            datasetHash: enaSourceResult.envelope.owner.datasetHash,
            specHash: enaSourceResult.envelope.owner.specHash,
            runId: enaSourceResult.envelope.owner.runId,
          }}
          datasetName={selectedFile?.name ?? "remote-dataset"}
          buildId={policy.approvedRemoteBuild?.approvalManifestSha256}
          datasetByteLength={active.receipt.byteLength}
          datasetColumns={active.receipt.columns}
          datasetSchema={active.receipt.schema}
          datasetLimits={active.receipt.limits}
          browserDerivedEnabled={false}
        />
      )}

      {enaSourceResult && active
        && enaSourceResult.envelope.taskKind === "prepared-import"
        && enaSourceResult.envelope.result.schemaVersion === "3dena.prepared-space-result.v1" && (
        <PreparedAnalysisResults
          result={enaSourceResult.envelope.result}
          owner={{
            datasetHash: enaSourceResult.envelope.owner.datasetHash,
            specHash: enaSourceResult.envelope.owner.specHash,
            runId: enaSourceResult.envelope.owner.runId,
          }}
          browserDerivedEnabled={false}
        />
      )}
    </div>
  );
}

interface RemoteMappingEditorProps {
  readonly headers: string[];
  readonly mapping: AnalysisMapping;
  readonly error: string | null;
  readonly onChange: (mapping: AnalysisMapping) => void;
  readonly onPreview: () => void;
}

function RemoteMappingEditor({ headers, mapping, error, onChange, onPreview }: RemoteMappingEditorProps) {
  const toggle = (key: "unitColumns" | "conversationColumns" | "codeColumns", header: string) => {
    const values = mapping[key];
    onChange({
      ...mapping,
      [key]: values.includes(header)
        ? values.filter((value) => value !== header)
        : [...values, header],
    });
  };
  return (
    <section className="workspace-card" aria-labelledby="remote-mapping-title">
      <div className="workspace-card__heading">
        <span className="icon-tile"><ShieldCheck size={20} aria-hidden="true" /></span>
        <div><p className="eyebrow">Step 3</p><h2 id="remote-mapping-title">Ordered role mapping</h2></div>
      </div>
      <div className="remote-role-grid">
        {(["unitColumns", "conversationColumns", "codeColumns"] as const).map((key) => (
          <fieldset key={key}>
            <legend>{key === "unitColumns" ? "Unit columns" : key === "conversationColumns" ? "Conversation columns" : "Code columns"}</legend>
            {headers.map((header) => (
              <label key={`${key}-${header}`}>
                <input type="checkbox" checked={mapping[key].includes(header)} onChange={() => toggle(key, header)} />
                <span>{header}</span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <div className="remote-single-role-grid">
        {([
          ["groupColumn", "Group column"],
          ["timeColumn", "Time column"],
          ["entityColumn", "Participant column"],
        ] as const).map(([key, label]) => (
          <label key={key}><span>{label}</span><select value={mapping[key]} onChange={(event) => onChange({ ...mapping, [key]: event.currentTarget.value })}>{headers.map((header) => <option value={header} key={`${key}-${header}`}>{header}</option>)}</select></label>
        ))}
      </div>
      {error && <p className="validation-hint" role="alert">{error}</p>}
      <button type="button" className="button button--secondary" disabled={Boolean(error)} onClick={onPreview} data-testid="remote-request-preview">Request typed preview</button>
    </section>
  );
}
