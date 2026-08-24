import type { Data } from "plotly.js";
import { describe, expect, it } from "vitest";
import {
  axisMappingIndexes,
  buildResultPlotConfig,
  cameraForPreset,
  createPlotToolState,
  permuteCoordinate,
  permutePlotly3dTrace,
  projectPlotly3dTrace2d,
  selectAxisDimension,
} from "@/lib/result-plot-tools";

const dimensions = ["SVD1", "SVD2", "SVD3"] as const;

describe("result plot tools", () => {
  it("keeps axis mapping a complete permutation by swapping occupied slots", () => {
    const initial = createPlotToolState(dimensions);
    const swapped = selectAxisDimension(
      initial.axes,
      "x",
      "SVD2",
      dimensions,
    );
    expect(swapped).toEqual({ x: "SVD2", y: "SVD1", z: "SVD3" });
    const indexes = axisMappingIndexes(dimensions, swapped);
    expect(indexes).toEqual([1, 0, 2]);
    expect(permuteCoordinate([11, 22, 33], indexes)).toEqual([22, 11, 33]);
    expect(initial.axes).toEqual({ x: "SVD1", y: "SVD2", z: "SVD3" });
  });

  it("builds auditable responsive Plotly configuration with result-bound export name", () => {
    expect(
      buildResultPlotConfig({
        showModeBar: false,
        fileName: "Class 1 / run 007 prepared space",
      }),
    ).toMatchObject({
      responsive: true,
      displaylogo: false,
      scrollZoom: true,
      displayModeBar: "hover",
      modeBarButtonsToRemove: ["sendDataToCloud", "lasso2d", "select2d"],
      toImageButtonOptions: {
        format: "png",
        filename: "class-1-run-007-prepared-space",
      },
    });
    expect(
      buildResultPlotConfig({ showModeBar: true, fileName: "owned-run" }),
    ).toMatchObject({ displayModeBar: true });
  });

  it("returns independent camera presets and resets to the same isometric geometry", () => {
    const first = cameraForPreset("isometric");
    first.eye.x = 99;
    expect(cameraForPreset("isometric").eye).toEqual({
      x: 1.35,
      y: 1.35,
      z: 1.35,
    });
    expect(cameraForPreset("top")).toMatchObject({
      eye: { x: 0, y: 0, z: 2.5 },
      projection: { type: "orthographic" },
    });
  });

  it("permutes imported trace coordinates and makes a 2D direction marker without refitting", () => {
    const indexes = [1, 0, 2] as const;
    const cone = {
      type: "cone",
      x: [1],
      y: [2],
      z: [3],
      u: [4],
      v: [5],
      w: [6],
      colorscale: [[0, "#123456"], [1, "#123456"]],
      meta: { trajectory_role: "direction_arrows" },
    } as unknown as Data;

    expect(permutePlotly3dTrace(cone, indexes)).toMatchObject({
      type: "cone",
      x: [2],
      y: [1],
      z: [3],
      u: [5],
      v: [4],
      w: [6],
    });
    const projected = projectPlotly3dTrace2d(cone, indexes) as unknown as Record<
      string,
      unknown
    >;
    expect(projected).toMatchObject({
      type: "scatter",
      mode: "markers",
      x: [2],
      y: [1],
      marker: { symbol: "triangle-up", color: "#123456" },
    });
    expect(projected).not.toHaveProperty("z");
    expect(projected).not.toHaveProperty("u");
  });
});
