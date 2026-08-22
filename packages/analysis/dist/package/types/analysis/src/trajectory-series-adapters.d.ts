import type { PreparedSpaceResult } from "./prepared-types.js";
import { type TrajectorySeriesInput } from "./trajectory-statistics.js";
import type { AnalysisResult } from "./types.js";
export interface TrajectorySeriesAdapterOptions {
    /** Canonical group key from the source result's trajectory group order. */
    group: string;
    namespace: string;
    /** Unit identity is the default; paired cross-group work must opt into the caller-confirmed participant label. */
    participantIdentity?: "unit" | "participant-label";
}
/**
 * Copies one already-computed raw-analysis group into the statistics contract.
 * Full-space coordinates come from the same jENA fit as the selected axes;
 * this adapter never projects or refits the source result.
 */
export declare function adaptAnalysisResultTrajectorySeries(result: AnalysisResult, options: TrajectorySeriesAdapterOptions): TrajectorySeriesInput;
/** Copies one prepared-space group without projecting, rotating, or refitting coordinates. */
export declare function adaptPreparedSpaceTrajectorySeries(result: PreparedSpaceResult, options: TrajectorySeriesAdapterOptions): TrajectorySeriesInput;
//# sourceMappingURL=trajectory-series-adapters.d.ts.map