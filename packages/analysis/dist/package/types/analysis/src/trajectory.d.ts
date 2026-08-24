import { type AnalysisPoint, type SharedSpaceTrajectories, type TrajectoryDisplayFilter, type TrajectoryDisplaySelection, type TrajectoryMapping } from "./types.js";
export declare function buildSharedSpaceTrajectories(points: AnalysisPoint[], mapping: TrajectoryMapping, dimensions: string[]): SharedSpaceTrajectories;
/**
 * Selects already-computed trajectory rows for presentation. This function
 * has no raw rows, jENA options, or model callback, so it cannot refit SVD or
 * recompute centroids. Returned centroid/path objects retain their identities.
 */
export declare function selectTrajectoryDisplay(trajectory: SharedSpaceTrajectories, filter?: TrajectoryDisplayFilter): TrajectoryDisplaySelection;
//# sourceMappingURL=trajectory.d.ts.map