import { fireEvent, render, screen } from "@testing-library/react";
import {
  ANALYSIS_CONTRACT_VERSION_V1,
  analyzeRows,
  executeAnalysisTask,
  hashAnalysisValueV1,
  type AnalysisResultEnvelopeV1,
  type AnalysisTaskV1,
  type DatasetReceiptV1,
} from "@3dena/analysis";
import type { ActivatedAnalysisTaskSpecV1 } from "@3dena/compute-service-http";
import { describe, expect, it, vi } from "vitest";
import {
  RemoteDerivedControls,
  RemoteDerivedResult,
} from "./remote-derived-analysis";
import type { VerifiedRemoteAnalysisResult } from "@/lib/remote-analysis-runtime";

vi.mock("next/dynamic", () => ({
  default: () => function PlotStub({ data }: { data: unknown[] }) {
    return <div data-testid="plot-stub" data-traces={data.length} />;
  },
}));

const analysis = analyzeRows({
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

const receipt: DatasetReceiptV1 = {
  schemaVersion: "3dena.dataset-receipt.v1",
  sha256: "1".repeat(64),
  byteLength: 1_000,
  format: "csv",
  sheet: null,
  rows: 8,
  columns: 6,
  schema: {
    schemaVersion: "3dena.dataset-schema.v1",
    headers: ["group", "participant", "time", "A", "B", "C"],
    columns: [
      { name: "group", inferredType: "string", roles: ["unit", "group"] },
      { name: "participant", inferredType: "string", roles: ["unit"] },
      { name: "time", inferredType: "number", roles: ["conversation", "time"] },
      { name: "A", inferredType: "number", roles: ["code"] },
      { name: "B", inferredType: "number", roles: ["code"] },
      { name: "C", inferredType: "number", roles: ["code"] },
    ],
  },
  limits: {
    schemaVersion: "3dena.dataset-limits.v1",
    maxFileBytes: 10_000,
    maxWorksheets: 1,
    maxRows: 100,
    maxColumns: 20,
    maxCells: 2_000,
  },
  warnings: [],
  activationIdentity: `activation:sha256:${"4".repeat(64)}`,
};

async function sourceVerified(): Promise<VerifiedRemoteAnalysisResult> {
  const resultHash = await hashAnalysisValueV1(analysis);
  return {
    envelope: {
      schemaVersion: "3dena.analysis-result-envelope.v1",
      owner: {
        contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
        datasetHash: receipt.sha256,
        specHash: "2".repeat(64),
        runId: "source-run",
        taskId: "source-job",
      },
      taskKind: "ena-model",
      result: analysis,
      diagnostics: analysis.diagnostics,
      evidence: {} as AnalysisResultEnvelopeV1["evidence"],
      provenance: { resultHash } as AnalysisResultEnvelopeV1["provenance"],
    },
    reference: {
      schemaVersion: "3dena.job-result-reference.v1",
      jobId: "source-job",
      sha256: "3".repeat(64),
      byteLength: 2,
      resultUrl: "https://objects.example.test/source.json",
      exportUrl: null,
      expiresAt: "2026-08-22T00:00:00.000Z",
    },
    exactBytes: new TextEncoder().encode("{}"),
  };
}

describe("RemoteDerivedControls", () => {
  it("builds all six source-hash-bound activated task variants without rows", async () => {
    const source = await sourceVerified();
    const kinds = [
      "network-comparison",
      "change-network",
      "statistics",
      "trajectory",
      "trajectory-comparison",
      "bootstrap",
    ] as const;
    for (const kind of kinds) {
      const onRun = vi.fn<(task: ActivatedAnalysisTaskSpecV1) => void>();
      const view = render(<RemoteDerivedControls kind={kind} source={source} running={false} onRun={onRun} />);
      fireEvent.click(screen.getByTestId("remote-derived-run"));
      expect(onRun).toHaveBeenCalledOnce();
      const task = onRun.mock.calls[0]![0];
      expect(task.kind).toBe(kind);
      expect("sourceResultHash" in task ? task.sourceResultHash : null).toBe(source.envelope.provenance.resultHash);
      expect(JSON.stringify(task)).not.toMatch(/rows|capabilityToken|resultUrl/u);
      if (kind === "trajectory") {
        expect(task).toMatchObject({
          selectedDimensions: ["SVD1", "SVD2", "SVD3"],
          cohortPolicy: "available",
          periods: [
            { value: { type: "numeric-v1", value: 1, unit: "source-period" } },
            { value: { type: "numeric-v1", value: 2, unit: "source-period" } },
          ],
        });
      }
      if (kind === "bootstrap") {
        expect(task).toMatchObject({
          replicates: 500,
          confidenceLevel: 0.95,
          seed: 42,
          interval: "pointwise-percentile-type7",
          rotationPolicy: "fixed-preprojected",
        });
      }
      view.unmount();
    }
  });

  it("rejects calendar-looking civil dates that do not round-trip exactly", async () => {
    const source = await sourceVerified();
    const timeOrder = sourceAnalysisTimeOrder(source);
    const invalidDateSource = {
      ...source,
      envelope: {
        ...source.envelope,
        result: {
          ...analysis,
          trajectory: {
            ...analysis.trajectory!,
            timeOrder: [
              { ...timeOrder[0]!, value: "2026-02-31", display: "2026-02-31" },
              { ...timeOrder[1]!, value: "2026-03-04", display: "2026-03-04" },
            ],
          },
        },
      },
    } satisfies VerifiedRemoteAnalysisResult;

    render(<RemoteDerivedControls
      kind="trajectory"
      source={invalidDateSource}
      running={false}
      onRun={vi.fn()}
    />);

    expect(screen.getByLabelText("Value contract")).toHaveValue("date-v1");
    expect(screen.getByTestId("remote-derived-run")).toBeDisabled();
  });
});

function sourceAnalysisTimeOrder(source: VerifiedRemoteAnalysisResult) {
  if (source.envelope.taskKind !== "ena-model"
      || source.envelope.result.schemaVersion !== "3dena.analysis-result.v1"
      || !source.envelope.result.trajectory) {
    throw new Error("expected trajectory source");
  }
  return source.envelope.result.trajectory.timeOrder;
}

describe("RemoteDerivedResult", () => {
  it("renders a visualization, exact table, and diagnostics for every derived schema", async () => {
    const sourceHash = await hashAnalysisValueV1(analysis);
    const groups = analysis.trajectory!.groupOrder.map((group) => group.canonical) as [string, string];
    const common = {
      schemaVersion: "3dena.analysis-task.v1" as const,
      deadlineEpochMilliseconds: Date.now() + 60_000,
    };
    type TaskInput = AnalysisTaskV1 extends infer Task
      ? Task extends AnalysisTaskV1 ? Omit<Task, "owner"> : never
      : never;
    const taskInputs: TaskInput[] = [
      { ...common, kind: "network-comparison", sourceResultHash: sourceHash, groups },
      { ...common, kind: "change-network", sourceResultHash: sourceHash, field: "@group", level: "A" },
      { ...common, kind: "statistics", sourceResultHash: sourceHash, design: "independent", groups, dimensions: [...analysis.axes], alternative: "two-sided", adjustment: "holm", samePhysicalEntityConfirmed: false },
      { ...common, kind: "trajectory", sourceResultHash: sourceHash, group: groups[0], selectedDimensions: [...analysis.axes], cohortPolicy: "available", periods: analysis.trajectory!.timeOrder.map((time) => ({ sourceTimeCanonical: time.canonical, value: { type: "numeric-v1" as const, value: Number(time.value), unit: "source-period" } })), estimand: { kind: "equal-participant-v1" } },
      { ...common, kind: "trajectory-comparison", sourceResultHash: sourceHash, design: "independent", groups, samePhysicalEntityConfirmed: false },
      { ...common, kind: "bootstrap", sourceResultHash: sourceHash, group: groups[0], replicates: 200, confidenceLevel: 0.95, seed: 42, interval: "pointwise-percentile-type7", rotationPolicy: "fixed-preprojected" },
    ];
    for (const [index, taskInput] of taskInputs.entries()) {
      const task = {
        ...taskInput,
        owner: {
          contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
          datasetHash: receipt.sha256,
          specHash: "2".repeat(64),
          runId: `derived-run-${index}`,
          taskId: `derived-task-${index}`,
        },
      } as AnalysisTaskV1;
      const envelope = await executeAnalysisTask({
        schemaVersion: "3dena.analysis-execution-dataset.v2",
        receipt,
        specHash: "2".repeat(64),
        buildId: "approved-build",
        generatedAt: "2026-08-21T00:00:00.000Z",
        sourceResult: { sourceKind: "raw-jena", hash: sourceHash, result: analysis },
      }, task);
      const verified = {
        envelope,
        reference: { schemaVersion: "3dena.job-result-reference.v1", jobId: task.owner.taskId, sha256: "5".repeat(64), byteLength: 2, resultUrl: "https://objects.example.test/result.json", exportUrl: null, expiresAt: "2026-08-22T00:00:00.000Z" },
        exactBytes: new TextEncoder().encode("{}"),
      } satisfies VerifiedRemoteAnalysisResult;
      const view = render(<RemoteDerivedResult verified={verified} />);
      expect(screen.getByTestId("remote-derived-result")).toHaveAttribute("data-task-kind", task.kind);
      expect(screen.getByTestId("remote-derived-visualization")).toBeInTheDocument();
      expect(screen.getByTestId("remote-derived-table")).toBeInTheDocument();
      expect(screen.getByTestId("plot-stub")).toBeInTheDocument();
      view.unmount();
    }
  });
});
