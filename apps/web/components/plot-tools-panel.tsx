"use client";

import { Expand, RefreshCw, ScanLine } from "lucide-react";
import type {
  AxisSlot,
  CameraPreset,
  PlotDimension,
  PlotToolState,
} from "@/lib/result-plot-tools";

interface PlotToolsPanelProps {
  dimensions: readonly [string, string, string];
  state: PlotToolState;
  fullscreenActive: boolean;
  dimensionScopeNote?: string;
  onDimensionChange: (dimension: PlotDimension) => void;
  onAxisChange: (slot: AxisSlot, dimension: string) => void;
  onCameraChange: (preset: CameraPreset) => void;
  onCameraReset: () => void;
  onModeBarChange: (visible: boolean) => void;
  onResize: () => void;
  onFullscreen: () => void;
}

export function PlotToolsPanel({
  dimensions,
  state,
  fullscreenActive,
  dimensionScopeNote,
  onDimensionChange,
  onAxisChange,
  onCameraChange,
  onCameraReset,
  onModeBarChange,
  onResize,
  onFullscreen,
}: PlotToolsPanelProps) {
  return (
    <div className="plot-tools" data-testid="plot-tools">
      <header>
        <p className="eyebrow">Display-only controls</p>
        <h3>Plot tools</h3>
        <p>
          These controls select and arrange existing result dimensions. They do
          not create a Worker, refit jENA, or change the result-bound exports.
        </p>
      </header>

      <div className="plot-tools-grid">
        <fieldset>
          <legend>Representation</legend>
          <label>
            <input
              type="radio"
              name="plot-dimension"
              value="3d"
              checked={state.dimension === "3d"}
              onChange={() => onDimensionChange("3d")}
              data-testid="plot-dimension-3d"
            />
            Interactive 3D
          </label>
          <label>
            <input
              type="radio"
              name="plot-dimension"
              value="2d"
              checked={state.dimension === "2d"}
              onChange={() => onDimensionChange("2d")}
              data-testid="plot-dimension-2d"
            />
            Accessible 2D projection
          </label>
        </fieldset>

        <fieldset>
          <legend>Axis mapping</legend>
          {(["x", "y", "z"] as const).map((slot) => (
            <label key={slot}>
              <span>{slot.toUpperCase()} axis</span>
              <select
                value={state.axes[slot]}
                onChange={(event) => onAxisChange(slot, event.currentTarget.value)}
                disabled={state.dimension === "2d" && slot === "z"}
                data-testid={`plot-axis-${slot}`}
              >
                {dimensions.map((dimension) => (
                  <option key={dimension} value={dimension}>{dimension}</option>
                ))}
              </select>
            </label>
          ))}
          <p>
            Reassigning a dimension swaps axis slots so every imported or
            computed dimension remains represented exactly once.
          </p>
          {dimensionScopeNote && <p role="note">{dimensionScopeNote}</p>}
        </fieldset>

        <fieldset>
          <legend>Camera and controls</legend>
          <label>
            <span>Camera preset</span>
            <select
              value={state.cameraPreset}
              onChange={(event) =>
                onCameraChange(event.currentTarget.value as CameraPreset)
              }
              disabled={state.dimension === "2d"}
              data-testid="plot-camera-preset"
            >
              <option value="isometric">Isometric</option>
              <option value="top">Top</option>
              <option value="front">Front</option>
              <option value="side">Side</option>
            </select>
          </label>
          <label className="plot-tools-check">
            <input
              type="checkbox"
              checked={state.showModeBar}
              onChange={(event) => onModeBarChange(event.currentTarget.checked)}
              data-testid="plot-modebar-visible"
            />
            Keep Plotly mode bar visible
          </label>
          <div className="plot-tools-actions">
            <button className="button button--quiet" type="button" onClick={onCameraReset}>
              <RefreshCw size={17} aria-hidden="true" /> Reset camera
            </button>
            <button
              className="button button--quiet"
              type="button"
              onClick={onResize}
              data-testid="plot-resize"
            >
              <ScanLine size={17} aria-hidden="true" /> Reflow plot
            </button>
            <button
              className="button button--secondary"
              type="button"
              onClick={onFullscreen}
              data-testid="plot-fullscreen"
            >
              <Expand size={17} aria-hidden="true" />
              {fullscreenActive ? "Exit fullscreen" : "Fullscreen plot"}
            </button>
          </div>
        </fieldset>
      </div>
    </div>
  );
}
