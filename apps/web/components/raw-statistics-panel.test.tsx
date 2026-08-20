import { render, screen, within } from "@testing-library/react";
import type { StatisticsTaskResultV1 } from "@3dena/analysis";
import { describe, expect, it } from "vitest";

import { StatisticsTable } from "@/components/raw-statistics-panel";

function independentResult(): StatisticsTaskResultV1 {
  return {
    schemaVersion: "3dena.statistics-task-result.v1",
    design: "independent",
    direction: "group-a-minus-group-b",
    groups: ["A", "B"],
    dimensions: [{
      dimension: "SVD1",
      result: {
        schemaVersion: "3dena.stats.independent-result.v1",
        design: "independent",
        estimates: {
          meanDifference: -4,
          confidenceInterval: {
            method: "welch-t-mean-difference-v1",
            confidenceLevel: 0.95,
            alternative: "two-sided",
            lower: { kind: "finite", value: -6.2 },
            upper: { kind: "finite", value: -1.8 },
          },
        },
        samples: {
          sideA: { valid: 4 },
          sideB: { valid: 4 },
        },
        welch: { pValue: 0.0047 },
        mannWhitney: { pValue: 0.03 },
        effects: { cohensD: -3.1, rankBiserial: -1 },
        adjustment: { adjusted: [0.0094, 0.03] },
      },
    }],
  } as StatisticsTaskResultV1;
}

function pairedResult(): StatisticsTaskResultV1 {
  return {
    schemaVersion: "3dena.statistics-task-result.v1",
    design: "paired",
    direction: "group-a-minus-group-b",
    groups: ["A", "B"],
    dimensions: [{
      dimension: "SVD1",
      result: {
        schemaVersion: "3dena.stats.paired-result.v1",
        design: "paired",
        estimates: {
          meanDifference: 2.5,
          confidenceInterval: {
            method: "paired-t-mean-difference-v1",
            confidenceLevel: 0.95,
            alternative: "greater",
            lower: { kind: "finite", value: 0.98 },
            upper: { kind: "positive-infinity" },
          },
        },
        matching: { validPairs: 4 },
        wilcoxonSignedRank: { pValue: 0.05 },
        effects: { cohensD: 1.94, rankBiserial: 1 },
        adjustment: { adjusted: [0.05] },
      },
    }],
  } as StatisticsTaskResultV1;
}

describe("StatisticsTable scientific method text", () => {
  it("attributes independent mean-difference intervals to Welch t, not rank inference", () => {
    render(<StatisticsTable result={independentResult()} />);

    const region = screen.getByRole("region", { name: "Raw inferential statistics table" });
    expect(within(region).getByText(/Welch t mean-difference confidence intervals and inference/u)).toBeVisible();
    expect(within(region).getByText(/Mann–Whitney rank-sum inference/u)).toBeVisible();
    expect(within(region).getByRole("columnheader", { name: "95% mean-difference CI (A − B)" })).toBeVisible();
    expect(within(region).getByText("CI method: welch-t-mean-difference-v1")).toBeVisible();
  });

  it("distinguishes the paired-t interval from signed-rank inference", () => {
    render(<StatisticsTable result={pairedResult()} />);

    const region = screen.getByRole("region", { name: "Raw inferential statistics table" });
    expect(within(region).getByText(/paired-t mean-difference confidence intervals/u)).toBeVisible();
    expect(within(region).getByText(/Wilcoxon signed-rank inference/u)).toBeVisible();
    expect(within(region).getByText("CI method: paired-t-mean-difference-v1")).toBeVisible();
  });
});
