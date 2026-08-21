import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  AnalysisClientV1,
  AnalysisResultEnvelopeV1,
  DatasetReceiptV1,
} from "@3dena/analysis";
import { analyzeRows, compareGroupNetworks } from "@3dena/analysis";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteAnalysisWorkspace } from "./remote-analysis-workspace";
import type { WebExecutionPolicy } from "@/lib/execution-policy";
import type {
  RemoteDatasetWorkflowAdapter,
  RemoteDatasetInventory,
  RemoteDatasetPreview,
  RemoteParsedWorksheet,
} from "@/lib/remote-dataset-workflow";
import {
  assertApprovedComputeBuild,
  cancelRemoteAnalysis,
  deleteRemoteJobData,
  runRemoteAnalysis,
  type RemoteExecutionBinding,
} from "@/lib/remote-analysis-runtime";

vi.mock("@/components/analysis-results", () => ({
  AnalysisResults: () => <div data-testid="mock-remote-analysis-result">Remote result</div>,
}));

vi.mock("next/dynamic", () => ({
  default: () => function PlotStub() {
    return <div data-testid="workspace-plot-stub" />;
  },
}));

vi.mock("@/lib/remote-analysis-runtime", async () => {
  const actual = await vi.importActual<typeof import("@/lib/remote-analysis-runtime")>(
    "@/lib/remote-analysis-runtime",
  );
  return {
    ...actual,
    assertApprovedComputeBuild: vi.fn(async () => ({
      schemaVersion: "3dena.compute-build-info.v1",
      approvalManifestSha256: "a".repeat(64),
      releaseId: "release-20260821",
      gitCommit: "b".repeat(40),
      flyImageDigest: `sha256:${"c".repeat(64)}`,
      flyBuildId: "compute-approved",
      role: "api",
      contractVersions: ["3dena.contract.v1"],
    })),
    runRemoteAnalysis: vi.fn(),
    deleteRemoteJobData: vi.fn(async () => ({
      schemaVersion: "3dena.job-deletion-receipt.v1",
      jobId: "job-1",
      cancelled: false,
      inputDeleted: true,
      resultDeleted: true,
      deletedAt: new Date().toISOString(),
    })),
    cancelRemoteAnalysis: vi.fn(async () => ({
      schemaVersion: "3dena.job-deletion-receipt.v1",
      jobId: "job-1",
      cancelled: true,
      inputDeleted: true,
      resultDeleted: true,
      deletedAt: new Date().toISOString(),
    })),
  };
});

const policy: WebExecutionPolicy = {
  mode: "remote",
  production: true,
  computeBaseUrl: "https://compute.example.test",
  approvedRemoteBuild: {
    approvalManifestSha256: "a".repeat(64),
    releaseId: "release-20260821",
    gitCommit: "b".repeat(40),
    webBuildId: "web-build",
    flyImageDigest: `sha256:${"c".repeat(64)}`,
    flyBuildId: "compute-approved",
  },
  webGitCommit: "b".repeat(40),
  processingRegion: "Asia Pacific (Singapore)",
  retentionHours: 24,
  blocker: null,
};

const receipt: DatasetReceiptV1 = {
  schemaVersion: "3dena.dataset-receipt.v1",
  sha256: "a".repeat(64),
  byteLength: 100,
  format: "xlsx",
  sheet: { index: 1, name: "Data" },
  rows: 2,
  columns: 7,
  schema: {
    schemaVersion: "3dena.dataset-schema.v1",
    headers: ["Group", "Lesson", "Name", "EC", "ICT", "MCO", "ATT"],
    columns: [
      { name: "Group", inferredType: "string", roles: ["unit", "group"] },
      { name: "Lesson", inferredType: "string", roles: ["conversation", "time"] },
      { name: "Name", inferredType: "string", roles: ["unit"] },
      { name: "EC", inferredType: "number", roles: ["code"] },
      { name: "ICT", inferredType: "number", roles: ["code"] },
      { name: "MCO", inferredType: "number", roles: ["code"] },
      { name: "ATT", inferredType: "number", roles: ["code"] },
    ],
  },
  limits: {
    schemaVersion: "3dena.dataset-limits.v1",
    maxFileBytes: 5_000_000,
    maxWorksheets: 20,
    maxRows: 10_000,
    maxColumns: 100,
    maxCells: 1_000_000,
  },
  warnings: [],
  activationIdentity: "activation-1",
};

const inventory: RemoteDatasetInventory = {
  workflowId: "workflow-1",
  sha256: receipt.sha256,
  byteLength: receipt.byteLength,
  format: "xlsx",
  worksheets: [
    { index: 0, name: "Hidden", hidden: true, selectable: false, declaredRows: 1, declaredColumns: 1 },
    { index: 1, name: "Data", hidden: false, selectable: true, declaredRows: 3, declaredColumns: 7 },
  ],
  parserVersion: "sheetjs-frozen-test",
  warnings: [],
};

const parsed: RemoteParsedWorksheet = {
  workflowId: inventory.workflowId,
  parseIdentity: "parse-1",
  parsedContentSha256: "b".repeat(64),
  worksheet: inventory.worksheets[1]!,
  headers: receipt.schema.headers,
  rowCount: 2,
  columnCount: 7,
};

const preview: RemoteDatasetPreview = {
  workflowId: inventory.workflowId,
  activationIdentity: receipt.activationIdentity,
  parsedContentSha256: parsed.parsedContentSha256,
  headers: receipt.schema.headers,
  rows: [
    [
      { type: "string", value: "Experimental" },
      { type: "string", value: "Lesson 1" },
      { type: "string", value: "Participant 1" },
      { type: "double", ieee754Hex: "3ff0000000000000" },
      { type: "double", ieee754Hex: "0000000000000000" },
      { type: "double", ieee754Hex: "3ff0000000000000" },
      { type: "double", ieee754Hex: "0000000000000000" },
    ],
  ],
  totalRows: 2,
  diagnostics: [],
  activatable: true,
};

const client = {} as AnalysisClientV1;

const sourceAnalysis = analyzeRows({
  rows: [
    { group: "A", participant: "p1", time: 1, A: 1, B: 1, C: 0 },
    { group: "A", participant: "p1", time: 2, A: 1, B: 0, C: 1 },
    { group: "A", participant: "p2", time: 1, A: 1, B: 1, C: 1 },
    { group: "A", participant: "p2", time: 2, A: 0, B: 1, C: 1 },
    { group: "B", participant: "p3", time: 1, A: 0, B: 1, C: 1 },
    { group: "B", participant: "p3", time: 2, A: 1, B: 1, C: 0 },
    { group: "B", participant: "p4", time: 1, A: 1, B: 0, C: 1 },
    { group: "B", participant: "p4", time: 2, A: 0, B: 1, C: 1 },
  ],
  mapping: {
    units: ["group", "participant"],
    conversation: ["time"],
    codes: ["A", "B", "C"],
    trajectory: {
      participant: ["participant"],
      group: "group",
      time: "time",
      timeOrder: [1, 2],
      cohortPolicy: "available",
    },
  },
  config: { model: "AccumulatedTrajectory", windowSizeBack: 4 },
});

function workflow(available = true): RemoteDatasetWorkflowAdapter {
  return {
    capabilities: vi.fn(async () => ({
      available,
      contractVersion: available ? "3dena.compute-dataset-http.v1" : null,
      blocker: available ? null : "Dataset workflow contract is unavailable.",
      executionAvailable: available,
      executionBlocker: available ? null : "Activated execution is unavailable.",
    })),
    inspect: vi.fn(async (_file, _signal, onProgress) => {
      onProgress({ phase: "inventory", completed: 1, total: 1, message: "Inventory complete." });
      return inventory;
    }),
    parseWorksheet: vi.fn(async () => parsed),
    prepare: vi.fn(async () => preview),
    activate: vi.fn(async () => ({
      workflowId: inventory.workflowId,
      activationIdentity: receipt.activationIdentity,
      receipt,
    })),
    bindExecution: vi.fn(async (_active, task): Promise<RemoteExecutionBinding> => ({
      reference: { jobId: "job-1", capabilityToken: "capability-1" },
      datasetReceipt: receipt,
      taskKind: task.kind,
      runId: task.runId,
      start: vi.fn(async () => undefined),
    })),
    bindDerivedExecution: vi.fn(async (_source, task): Promise<RemoteExecutionBinding> => ({
      reference: { jobId: "derived-job-1", capabilityToken: "derived-capability-1" },
      datasetReceipt: receipt,
      taskKind: task.kind,
      runId: task.runId,
      start: vi.fn(async () => undefined),
    })),
    discard: vi.fn(async () => undefined),
  };
}

function completedResult(): Awaited<ReturnType<typeof runRemoteAnalysis>> {
  return {
    envelope: {
      schemaVersion: "3dena.analysis-result-envelope.v1",
      owner: {
        contractVersion: "3dena.contract.v1",
        datasetHash: receipt.sha256,
        specHash: "c".repeat(64),
        runId: "run-1",
        taskId: "task-1",
      },
      taskKind: "ena-model",
      result: sourceAnalysis,
      diagnostics: [],
      evidence: {} as AnalysisResultEnvelopeV1["evidence"],
      provenance: {
        resultHash: "e".repeat(64),
      } as AnalysisResultEnvelopeV1["provenance"],
    },
    reference: {
      schemaVersion: "3dena.job-result-reference.v1",
      jobId: "job-1",
      sha256: "d".repeat(64),
      byteLength: 2,
      resultUrl: "https://objects.example.test/result.json",
      exportUrl: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    exactBytes: new TextEncoder().encode("{}"),
  };
}

function completedDerivedResult(): Awaited<ReturnType<typeof runRemoteAnalysis>> {
  const [groupA, groupB] = sourceAnalysis.trajectory!.groupOrder;
  const derived = compareGroupNetworks(sourceAnalysis, [groupA!.canonical, groupB!.canonical]);
  return {
    envelope: {
      ...completedResult().envelope,
      owner: {
        ...completedResult().envelope.owner,
        runId: "remote-derived-run-1",
        taskId: "derived-job-1",
      },
      taskKind: "network-comparison",
      result: derived,
      diagnostics: derived.diagnostics,
    },
    reference: {
      ...completedResult().reference,
      jobId: "derived-job-1",
      sha256: "f".repeat(64),
    },
    exactBytes: new TextEncoder().encode("{}"),
  };
}

async function reachActivation(target: RemoteDatasetWorkflowAdapter) {
  render(<RemoteAnalysisWorkspace webBuildId="web-build" policy={policy} client={client} workflow={target} />);
  await waitFor(() => expect(screen.getByTestId("remote-runtime-status")).toHaveAttribute("data-state", "idle"));
  fireEvent.click(screen.getByTestId("remote-processing-consent"));
  fireEvent.change(screen.getByTestId("remote-file-input"), {
    target: { files: [new File(["workbook"], "study.xlsx")] },
  });
  fireEvent.click(screen.getByTestId("remote-upload-inspect"));
  await screen.findByText("sheetjs-frozen-test");
  fireEvent.click(screen.getByTestId("remote-parse-sheet"));
  await screen.findByRole("heading", { name: "Ordered role mapping" });
  fireEvent.click(screen.getByTestId("remote-request-preview"));
  await screen.findByTestId("remote-typed-preview");
  fireEvent.click(screen.getByTestId("remote-activate"));
  await screen.findByTestId("remote-activation-receipt");
}

describe("RemoteAnalysisWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertApprovedComputeBuild).mockResolvedValue({
      schemaVersion: "3dena.compute-build-info.v1",
      approvalManifestSha256: "a".repeat(64),
      releaseId: "release-20260821",
      gitCommit: "b".repeat(40),
      flyImageDigest: `sha256:${"c".repeat(64)}`,
      flyBuildId: "compute-approved",
      role: "api",
      contractVersions: ["3dena.contract.v1"],
    });
    vi.mocked(runRemoteAnalysis).mockResolvedValue(completedResult());
  });

  it("fails closed when the reviewed service dataset workflow is absent", async () => {
    render(<RemoteAnalysisWorkspace webBuildId="web-build" policy={policy} client={client} workflow={workflow(false)} />);
    await waitFor(() => expect(screen.getByTestId("remote-runtime-status")).toHaveAttribute("data-state", "blocked"));
    expect(screen.getByTestId("remote-runtime-status")).toHaveTextContent(/contract is unavailable/u);
    expect(screen.getByTestId("remote-file-input")).toBeDisabled();
    expect(screen.queryByTestId("raw-file-input")).not.toBeInTheDocument();
  });

  it("closes mocked upload, inventory, mapping, preview, activation, run, and verified-download UI", async () => {
    const target = workflow();
    await reachActivation(target);
    expect(screen.getByRole("option", { name: "Hidden (hidden; unavailable)" })).toBeDisabled();
    const codes = screen.getByRole("group", { name: "Code columns" });
    expect(within(codes).getByRole("checkbox", { name: "EC" })).toBeChecked();

    fireEvent.click(screen.getByTestId("remote-analysis-run"));
    await waitFor(() => expect(runRemoteAnalysis).toHaveBeenCalledOnce());
    expect(await screen.findByTestId("mock-remote-analysis-result")).toBeInTheDocument();
    expect(screen.getByTestId("remote-verified-download")).toBeEnabled();
    expect(screen.getByTestId("remote-runtime-status")).toHaveAttribute("data-state", "completed");
    expect(target.inspect).toHaveBeenCalledOnce();
    expect(target.activate).toHaveBeenCalledOnce();
  });

  it("lists all seven remote task discriminators and fails closed without reviewed derived controls", async () => {
    const target = workflow();
    await reachActivation(target);
    const taskSelect = screen.getByTestId("remote-task-kind");
    expect(within(taskSelect).getAllByRole("option")).toHaveLength(7);
    fireEvent.change(taskSelect, { target: { value: "statistics" } });
    expect(screen.getByTestId("remote-analysis-run")).toBeDisabled();
    expect(screen.getByTestId("remote-execution-blocker")).toHaveTextContent(
      "verified, service-owned ENA source result",
    );
    expect(target.bindExecution).not.toHaveBeenCalled();
    fireEvent.change(taskSelect, { target: { value: "ena-model" } });
    expect(screen.getByTestId("remote-analysis-run")).toBeEnabled();
  });

  it("retains the verified ENA source, then runs and deletes a source-bound derived job", async () => {
    const target = workflow();
    await reachActivation(target);
    fireEvent.click(screen.getByTestId("remote-analysis-run"));
    await waitFor(() => expect(runRemoteAnalysis).toHaveBeenCalledOnce());
    expect(target.bindExecution).toHaveBeenCalledOnce();
    expect(deleteRemoteJobData).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("remote-task-kind"), {
      target: { value: "network-comparison" },
    });
    expect(await screen.findByTestId("remote-derived-controls")).toBeInTheDocument();
    vi.mocked(runRemoteAnalysis).mockResolvedValueOnce(completedDerivedResult());
    fireEvent.click(screen.getByTestId("remote-derived-run"));
    await waitFor(() => expect(target.bindDerivedExecution).toHaveBeenCalledOnce());
    await screen.findByTestId("remote-derived-result");
    expect(screen.getByTestId("remote-derived-table")).toBeInTheDocument();
    expect(deleteRemoteJobData).toHaveBeenCalledOnce();
    expect(target.bindDerivedExecution).toHaveBeenCalledWith(
      expect.objectContaining({ sourceResultHash: "e".repeat(64) }),
      expect.objectContaining({
        kind: "network-comparison",
        sourceResultHash: "e".repeat(64),
      }),
      expect.any(AbortSignal),
    );
  });

  it("closes the dataset workflow before deleting the retained ENA source", async () => {
    const target = workflow();
    await reachActivation(target);
    fireEvent.click(screen.getByTestId("remote-analysis-run"));
    await waitFor(() => expect(runRemoteAnalysis).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByTestId("remote-source-delete"));
    await waitFor(() => expect(screen.getByTestId("remote-runtime-status")).toHaveAttribute("data-state", "idle"));

    expect(target.discard).toHaveBeenCalledWith(inventory.workflowId);
    expect(deleteRemoteJobData).toHaveBeenCalledWith(client, expect.objectContaining({ jobId: "job-1" }));
    expect(vi.mocked(target.discard).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deleteRemoteJobData).mock.invocationCallOrder[0]!,
    );
    expect(screen.queryByTestId("remote-source-delete")).not.toBeInTheDocument();
    expect(screen.queryByTestId("remote-activation-receipt")).not.toBeInTheDocument();
    expect(screen.getByText("No service dataset is active.")).toBeInTheDocument();
  });

  it("preserves a usable ENA source when dataset-session closure is not observed", async () => {
    const target = workflow();
    await reachActivation(target);
    fireEvent.click(screen.getByTestId("remote-analysis-run"));
    await waitFor(() => expect(runRemoteAnalysis).toHaveBeenCalledOnce());
    vi.mocked(target.discard).mockRejectedValueOnce(new Error("DATASET_DELETE_UNOBSERVED"));

    fireEvent.click(screen.getByTestId("remote-source-delete"));
    expect(await screen.findByTestId("remote-analysis-error")).toHaveTextContent("DATASET_DELETE_UNOBSERVED");

    expect(deleteRemoteJobData).not.toHaveBeenCalled();
    expect(screen.getByTestId("remote-source-delete")).toBeEnabled();
    expect(screen.getByTestId("remote-activation-receipt")).toBeInTheDocument();
  });

  it("does not call cancellation complete until the deletion receipt resolves", async () => {
    const target = workflow();
    await reachActivation(target);
    vi.mocked(runRemoteAnalysis).mockImplementationOnce(async () => await new Promise(() => undefined));
    let resolveDelete!: () => void;
    vi.mocked(cancelRemoteAnalysis).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { resolveDelete = resolve; });
      return {
        schemaVersion: "3dena.job-deletion-receipt.v1",
        jobId: "job-1",
        cancelled: true,
        inputDeleted: true,
        resultDeleted: true,
        deletedAt: new Date().toISOString(),
      };
    });

    fireEvent.click(screen.getByTestId("remote-analysis-run"));
    await waitFor(() => expect(runRemoteAnalysis).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("remote-analysis-cancel"));
    expect(screen.getByTestId("remote-runtime-status")).toHaveAttribute("data-state", "cancelling");
    resolveDelete();
    await waitFor(() => expect(screen.getByTestId("remote-runtime-status")).toHaveAttribute("data-state", "cancelled"));
  });

  it("preserves the active dataset when a replacement inspection fails", async () => {
    const target = workflow();
    await reachActivation(target);
    vi.mocked(target.inspect).mockRejectedValueOnce(new Error("PARSER_MAGIC_MISMATCH"));

    fireEvent.change(screen.getByTestId("remote-file-input"), {
      target: { files: [new File(["not-xlsx"], "replacement.xlsx")] },
    });
    fireEvent.click(screen.getByTestId("remote-upload-inspect"));

    expect(await screen.findByTestId("remote-analysis-error")).toHaveTextContent(
      "previously active dataset was not replaced",
    );
    expect(screen.getByTestId("remote-activation-receipt")).toHaveAttribute(
      "data-activation-id",
      receipt.activationIdentity,
    );
    expect(screen.getByTestId("remote-analysis-run")).toBeEnabled();
  });
});
