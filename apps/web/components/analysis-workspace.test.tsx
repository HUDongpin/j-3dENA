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

vi.mock("@/lib/run-ownership", () => ({
  createRunOwner: vi.fn(async (_csv: string, _mapping: unknown, runId: string) => ({
    datasetHash: "dataset-hash",
    specHash: "spec-hash",
    runId,
  })),
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
