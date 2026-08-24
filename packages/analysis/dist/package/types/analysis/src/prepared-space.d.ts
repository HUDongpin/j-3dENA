import type { AnalyzePreparedSpaceInput, PreparedSpaceDisplayFilter, PreparedSpaceDisplaySelection, PreparedSpaceResult } from "./prepared-types.js";
/**
 * Reduces a validated, precomputed ENA exchange without invoking jENA or
 * fitting a new rotation. Full source coordinates and line weights are
 * preserved; only participant-period and group-time summaries are computed.
 */
export declare function analyzePreparedSpace(input: AnalyzePreparedSpaceInput): PreparedSpaceResult;
/**
 * Display-only group/dimension selection in the already imported coordinate
 * space. Dimension reselection redoes reductions but never fits or rotates.
 */
export declare function selectPreparedSpaceDisplay(result: PreparedSpaceResult, filter?: PreparedSpaceDisplayFilter): PreparedSpaceDisplaySelection;
//# sourceMappingURL=prepared-space.d.ts.map