import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { DEFAULT_ANALYSIS_LIMITS } from "@3dena/analysis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalysisWorkspace } from "@/components/analysis-workspace";

vi.mock("@/components/analysis-results", () => ({
  AnalysisResults: () => <div data-testid="mock-analysis-result">Result</div>,
}));

vi.mock("@/components/prepared-analysis-results", () => ({
  PreparedAnalysisResults: () => (
    <div data-testid="mock-prepared-analysis-result">Prepared result</div>
  ),
}));

vi.mock("@/lib/run-ownership", () => ({
  createRunOwner: vi.fn(async (_csv: string, _mapping: unknown, runId: string) => ({
    datasetHash: "dataset-hash",
    specHash: "spec-hash",
    runId,
  })),
  createRunOwnerFromDatasetHash: vi.fn(
    async (datasetHash: string, _mapping: unknown, runId: string) => ({
      datasetHash,
      specHash: "prepared-spec-hash",
      runId,
    }),
  ),
  sameRunOwner: (
    active: { datasetHash: string; specHash: string; runId: string } | null,
    candidate: { datasetHash: string; specHash: string; runId: string },
  ) =>
    Boolean(
      active &&
        active.datasetHash === candidate.datasetHash &&
        active.specHash === candidate.specHash &&
        active.runId === candidate.runId,
    ),
}));

const PREPARED_HASH = "c".repeat(64);
const SECOND_PREPARED_HASH = "d".repeat(64);
const PREPARED_RECEIPT = {
  sha256: PREPARED_HASH,
  byteLength: 4,
  points: 72,
  nodes: 6,
  edges: 15,
  dimensions: 15,
  groups: 5,
  periods: ["TP1", "TP2", "TP3"],
};

function preparedFile(name = "synthetic-prepared.ena3d.json", bytes = [1, 2, 3, 4]) {
  const file = new File([new Uint8Array(bytes)], name, {
    type: "application/json",
  });
  Object.defineProperty(file, "arrayBuffer", {
    value: vi.fn(async () => Uint8Array.from(bytes).buffer),
  });
  return file;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function rawCsv(label: string): string {
  return [
    "Group,Lesson,Name,EC,ICT,MCO,ATT",
    `Experimental,Lesson 1,${label},1,0,1,0`,
  ].join("\n");
}

function rawFile(
  name: string,
  text: string,
  read: () => Promise<string> = async () => text,
): File {
  const file = new File([text], name, { type: "text/csv" });
  Object.defineProperty(file, "text", { value: vi.fn(read) });
  return file;
}

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();

  constructor() {
    FakeWorker.instances.push(this);
  }
}

describe("AnalysisWorkspace", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
    window.history.replaceState({}, "", "/app?e2eWorkerDelayMs=1200");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("starts with the legacy small-raw mapping and contract selectors", () => {
    render(<AnalysisWorkspace />);

    expect(screen.getByTestId("raw-file-input")).toBeInTheDocument();
    expect(screen.getByTestId("analysis-status")).toHaveAttribute("data-state", "idle");
    expect(screen.getByTestId("worker-status")).toHaveAttribute("data-state", "idle");
    expect(screen.getByTestId("analysis-spec-window-size")).toHaveValue(4);

    const units = screen.getByRole("group", { name: "Unit columns" });
    expect(within(units).getByRole("checkbox", { name: "Group" })).toBeChecked();
    expect(within(units).getByRole("checkbox", { name: "Name" })).toBeChecked();
    const codes = screen.getByRole("group", { name: "Code columns" });
    for (const code of ["EC", "ICT", "MCO", "ATT"]) {
      expect(within(codes).getByRole("checkbox", { name: code })).toBeChecked();
    }
  });

  it("atomically activates, runs, and preserves a prepared result after a failed replacement", async () => {
    render(<AnalysisWorkspace />);
    fireEvent.click(screen.getByTestId("analysis-mode-prepared"));

    expect(screen.getByTestId("analysis-workspace")).toHaveAttribute(
      "data-analysis-mode",
      "prepared",
    );
    expect(screen.getByTestId("prepared-import-status")).toHaveAttribute(
      "data-state",
      "idle",
    );

    fireEvent.change(screen.getByTestId("prepared-file-input"), {
      target: { files: [preparedFile()] },
    });
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const validationWorker = FakeWorker.instances[0];
    await waitFor(() => expect(validationWorker?.postMessage).toHaveBeenCalled());
    const validationRequest = validationWorker?.postMessage.mock.calls[0]?.[0] as {
      requestId: string;
    };
    expect(validationWorker?.postMessage.mock.calls[0]?.[0]).toMatchObject({
      v: 1,
      kind: "validate-prepared",
      input: { sourceName: "synthetic-prepared.ena3d.json" },
    });

    await act(async () => {
      validationWorker?.onmessage?.({
        data: {
          type: "prepared-validated",
          requestId: validationRequest.requestId,
          receipt: PREPARED_RECEIPT,
        },
      } as MessageEvent);
    });

    expect(screen.getByTestId("prepared-import-status")).toHaveAttribute(
      "data-state",
      "completed",
    );
    expect(screen.getByTestId("prepared-dataset-receipt")).toHaveAttribute(
      "data-dataset-hash",
      PREPARED_HASH,
    );

    fireEvent.click(screen.getByTestId("analysis-run"));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(2));
    const analysisWorker = FakeWorker.instances[1];
    await waitFor(() => expect(analysisWorker?.postMessage).toHaveBeenCalled());
    const analysisRequest = analysisWorker?.postMessage.mock.calls[0]?.[0] as {
      runId: string;
      input: { datasetHash: string; specHash: string };
    };
    expect(analysisWorker?.postMessage.mock.calls[0]?.[0]).toMatchObject({
      v: 1,
      kind: "analyze-prepared",
      input: {
        sourceName: "synthetic-prepared.ena3d.json",
        datasetHash: PREPARED_HASH,
        debugDelayMs: 1200,
      },
    });

    await act(async () => {
      analysisWorker?.onmessage?.({
        data: {
          type: "prepared-result",
          owner: {
            datasetHash: analysisRequest.input.datasetHash,
            specHash: analysisRequest.input.specHash,
            runId: analysisRequest.runId,
          },
          result: {},
        },
      } as MessageEvent);
    });
    expect(screen.getByTestId("analysis-status")).toHaveAttribute(
      "data-state",
      "completed",
    );
    expect(screen.getByTestId("mock-prepared-analysis-result")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("prepared-file-input"), {
      target: { files: [preparedFile("broken.ena3d.json", [9, 9, 9, 9])] },
    });
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(3));
    const replacementWorker = FakeWorker.instances[2];
    await waitFor(() => expect(replacementWorker?.postMessage).toHaveBeenCalled());
    const replacementRequest = replacementWorker?.postMessage.mock.calls[0]?.[0] as {
      requestId: string;
    };
    await act(async () => {
      replacementWorker?.onmessage?.({
        data: {
          type: "prepared-validation-error",
          requestId: replacementRequest.requestId,
          message: "INVALID_SCHEMA: missing required table",
        },
      } as MessageEvent);
    });

    expect(screen.getByTestId("prepared-import-status")).toHaveAttribute(
      "data-state",
      "error",
    );
    expect(screen.getByTestId("prepared-dataset-receipt")).toHaveAttribute(
      "data-dataset-hash",
      PREPARED_HASH,
    );
    expect(screen.getByTestId("mock-prepared-analysis-result")).toBeInTheDocument();
    expect(screen.getByTestId("analysis-status")).toHaveAttribute(
      "data-state",
      "completed",
    );

    replacementWorker?.onmessage?.({
      data: {
        type: "prepared-validated",
        requestId: replacementRequest.requestId,
        receipt: { ...PREPARED_RECEIPT, sha256: SECOND_PREPARED_HASH },
      },
    } as MessageEvent);
    expect(screen.getByTestId("prepared-dataset-receipt")).toHaveAttribute(
      "data-dataset-hash",
      PREPARED_HASH,
    );
  });

  it("ships no bundled prepared research-data entry point", () => {
    render(<AnalysisWorkspace />);
    fireEvent.click(screen.getByTestId("analysis-mode-prepared"));
    expect(screen.queryByTestId("prepared-load-bundled")).not.toBeInTheDocument();
    expect(screen.getByText(/ships no research bytes, participant identity/u)).toBeVisible();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it("rejects native serialized files and prepared exchanges above 2 MiB before Worker creation", () => {
    render(<AnalysisWorkspace />);
    fireEvent.click(screen.getByTestId("analysis-mode-prepared"));

    fireEvent.change(screen.getByTestId("prepared-file-input"), {
      target: { files: [new File(["native"], "class1.RData")] },
    });
    expect(screen.getByTestId("analysis-error")).toHaveTextContent(
      "Native serialized analysis files are not accepted",
    );
    expect(FakeWorker.instances).toHaveLength(0);

    const oversized = new File(
      [new Uint8Array(2 * 1024 * 1024 + 1)],
      "oversized.ena3d.json",
      { type: "application/json" },
    );
    fireEvent.change(screen.getByTestId("prepared-file-input"), {
      target: { files: [oversized] },
    });
    expect(screen.getByTestId("analysis-error")).toHaveTextContent(
      "exceeds the 2 MiB browser limit",
    );
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it("rejects CSV files above the 5 MiB browser limit transactionally", () => {
    render(<AnalysisWorkspace />);
    const oversized = new File(
      [new Uint8Array(5 * 1024 * 1024 + 1)],
      "oversized.csv",
      { type: "text/csv" },
    );
    fireEvent.change(screen.getByTestId("raw-file-input"), {
      target: { files: [oversized] },
    });

    expect(screen.getByTestId("analysis-error")).toHaveTextContent(
      "5 MiB browser workspace limit",
    );
    expect(screen.getByText("small-raw.csv")).toBeInTheDocument();
    expect(screen.getByTestId("analysis-status")).toHaveAttribute("data-state", "idle");
  });

  it("gives the newest raw file-read intent ownership over a delayed older file", async () => {
    const slowRead = deferred<string>();
    const slow = rawFile("slow-a.csv", rawCsv("Slow A"), () => slowRead.promise);
    const fast = rawFile("fast-b.csv", rawCsv("Fast B"));
    render(<AnalysisWorkspace />);

    fireEvent.change(screen.getByTestId("raw-file-input"), {
      target: { files: [slow] },
    });
    fireEvent.change(screen.getByTestId("raw-file-input"), {
      target: { files: [fast] },
    });

    await waitFor(() =>
      expect(screen.getByTestId("dataset-receipt")).toHaveTextContent("fast-b.csv"),
    );
    await act(async () => {
      slowRead.resolve(rawCsv("Slow A"));
      await slowRead.promise;
    });

    expect(screen.getByTestId("dataset-receipt")).toHaveTextContent("fast-b.csv");
    expect(screen.getByText("Fast B")).toBeInTheDocument();
    expect(screen.queryByText("Slow A")).not.toBeInTheDocument();
  });

  it("invalidates a delayed raw file-read intent when Reset is selected", async () => {
    const slowRead = deferred<string>();
    const slow = rawFile("slow-reset.csv", rawCsv("Late replacement"), () =>
      slowRead.promise,
    );
    render(<AnalysisWorkspace />);

    fireEvent.change(screen.getByTestId("raw-file-input"), {
      target: { files: [slow] },
    });
    fireEvent.click(screen.getByTestId("raw-reset-sample"));

    await act(async () => {
      slowRead.resolve(rawCsv("Late replacement"));
      await slowRead.promise;
    });

    expect(screen.getByTestId("dataset-receipt")).toHaveTextContent("small-raw.csv");
    expect(screen.queryByText("slow-reset.csv")).not.toBeInTheDocument();
    expect(screen.queryByText("Late replacement")).not.toBeInTheDocument();
  });

  it("invalidates a delayed raw file-read intent when data mode changes", async () => {
    const slowRead = deferred<string>();
    const slow = rawFile("slow-mode.csv", rawCsv("Late mode result"), () =>
      slowRead.promise,
    );
    render(<AnalysisWorkspace />);

    fireEvent.change(screen.getByTestId("raw-file-input"), {
      target: { files: [slow] },
    });
    fireEvent.click(screen.getByTestId("analysis-mode-prepared"));

    await act(async () => {
      slowRead.resolve(rawCsv("Late mode result"));
      await slowRead.promise;
    });
    fireEvent.click(screen.getByTestId("analysis-mode-raw"));

    expect(screen.getByTestId("dataset-receipt")).toHaveTextContent("small-raw.csv");
    expect(screen.queryByText("slow-mode.csv")).not.toBeInTheDocument();
  });

  it("preserves the active dataset and completed result when a later code value is invalid", async () => {
    render(<AnalysisWorkspace />);
    fireEvent.click(screen.getByTestId("analysis-run"));

    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0];
    await waitFor(() => expect(worker?.postMessage).toHaveBeenCalledTimes(1));
    const request = worker?.postMessage.mock.calls[0]?.[0] as {
      runId: string;
      input: { datasetHash: string; specHash: string };
    };

    await act(async () => {
      worker?.onmessage?.({
        data: {
          type: "result",
          owner: {
            datasetHash: request.input.datasetHash,
            specHash: request.input.specHash,
            runId: request.runId,
          },
          result: {},
        },
      } as MessageEvent);
    });

    expect(screen.getByTestId("analysis-status")).toHaveAttribute(
      "data-state",
      "completed",
    );
    expect(screen.getByTestId("mock-analysis-result")).toBeInTheDocument();

    const validRows = Array.from(
      { length: 7 },
      (_, index) => `Group ${index},Lesson 1,Student ${index},1,0,1,0`,
    );
    const invalidCsv = [
      "Group,Lesson,Name,EC,ICT,MCO,ATT",
      ...validRows,
      "Group 8,Lesson 1,Student 8,not-a-code,0,1,0",
    ].join("\n");
    const invalidFile = new File([invalidCsv], "invalid-late-row.csv", {
      type: "text/csv",
    });
    Object.defineProperty(invalidFile, "text", {
      value: vi.fn(async () => invalidCsv),
    });

    fireEvent.change(screen.getByTestId("raw-file-input"), {
      target: { files: [invalidFile] },
    });

    await waitFor(() =>
      expect(screen.getByTestId("analysis-error")).toHaveTextContent(
        "CSV row 9, code column “EC”",
      ),
    );
    expect(screen.getByText("small-raw.csv")).toBeInTheDocument();
    expect(screen.queryByText("invalid-late-row.csv")).not.toBeInTheDocument();
    expect(screen.getByTestId("mock-analysis-result")).toBeInTheDocument();
    expect(screen.getByTestId("analysis-status")).toHaveAttribute(
      "data-state",
      "completed",
    );
    expect(screen.getByTestId("worker-status")).toHaveAttribute(
      "data-state",
      "completed",
    );
  });

  it("rejects an over-wide staged CSV before it reaches dataset state", async () => {
    render(<AnalysisWorkspace />);
    const headers = Array.from(
      { length: DEFAULT_ANALYSIS_LIMITS.maxColumns + 1 },
      (_, index) => `column-${index}`,
    );
    const csvText = [headers.join(","), headers.map(() => "0").join(",")].join(
      "\n",
    );
    const overWideFile = new File([csvText], "over-wide.csv", {
      type: "text/csv",
    });
    Object.defineProperty(overWideFile, "text", {
      value: vi.fn(async () => csvText),
    });

    fireEvent.change(screen.getByTestId("raw-file-input"), {
      target: { files: [overWideFile] },
    });

    await waitFor(() =>
      expect(screen.getByTestId("analysis-error")).toHaveTextContent(
        `${DEFAULT_ANALYSIS_LIMITS.maxColumns + 1} columns; maximum is ${DEFAULT_ANALYSIS_LIMITS.maxColumns}`,
      ),
    );
    expect(screen.getByText("small-raw.csv")).toBeInTheDocument();
    expect(screen.queryByText("over-wide.csv")).not.toBeInTheDocument();
    expect(screen.getByTestId("analysis-status")).toHaveAttribute(
      "data-state",
      "idle",
    );
    expect(screen.getByRole("group", { name: "Code columns" })).toBeInTheDocument();
  });

  it("hard-terminates the current Worker and sends the non-production delay hook", async () => {
    render(<AnalysisWorkspace />);
    fireEvent.click(screen.getByTestId("analysis-run"));

    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0];
    expect(worker).toBeDefined();
    await waitFor(() => expect(worker?.postMessage).toHaveBeenCalledTimes(1));
    expect(worker?.postMessage.mock.calls[0]?.[0]).toMatchObject({
      v: 1,
      kind: "analyze",
      input: { debugDelayMs: 1200 },
    });

    fireEvent.click(screen.getByTestId("analysis-cancel"));
    expect(worker?.terminate).toHaveBeenCalled();
    expect(screen.getByTestId("analysis-status")).toHaveAttribute("data-state", "cancelled");
    expect(screen.getByTestId("worker-status")).toHaveAttribute("data-state", "terminated");
  });

  it("suppresses a result delivered after hard cancellation", async () => {
    render(<AnalysisWorkspace />);
    fireEvent.click(screen.getByTestId("analysis-run"));
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    const worker = FakeWorker.instances[0];
    await waitFor(() => expect(worker?.postMessage).toHaveBeenCalled());
    const request = worker?.postMessage.mock.calls[0]?.[0] as {
      runId: string;
      input: { datasetHash: string; specHash: string };
    };
    fireEvent.click(screen.getByTestId("analysis-cancel"));

    worker?.onmessage?.({
      data: {
        type: "result",
        owner: {
          datasetHash: request.input.datasetHash,
          specHash: request.input.specHash,
          runId: request.runId,
        },
        result: {},
      },
    } as MessageEvent);

    expect(screen.queryByTestId("mock-analysis-result")).not.toBeInTheDocument();
    expect(screen.getByTestId("analysis-status")).toHaveAttribute("data-state", "cancelled");
  });
});
