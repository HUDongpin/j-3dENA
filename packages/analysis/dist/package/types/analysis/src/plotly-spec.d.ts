import { type DisplaySpecV1 } from "./contracts.js";
import type { PreparedSpaceResult } from "./prepared-types.js";
import type { AnalysisDiagnostic, AnalysisResult } from "./types.js";
export type PlotlyTraceRoleV1 = "participant" | "node" | "network-edge" | "centroid"
/** @deprecated Historical V1 readback only; compilePlotlySpec no longer emits this role. */
 | "trajectory" | "axis-shaft" | "axis-arrowhead";
export interface PlotlyTraceV1 extends Record<string, unknown> {
    type: "scatter" | "scatter3d" | "cone";
    meta: {
        role: PlotlyTraceRoleV1;
        groupCanonical?: string;
        edgeId?: string;
        axis?: string;
    };
}
export interface PlotlySpecV1 {
    schemaVersion: "3dena.plotly-spec.v1";
    data: PlotlyTraceV1[];
    layout: Record<string, unknown>;
    config: {
        responsive: true;
        displaylogo: false;
        scrollZoom: true;
    };
    diagnostics: AnalysisDiagnostic[];
}
export declare class PlotlySpecCompilationError extends Error {
    readonly code: string;
    readonly path: string;
    constructor(code: string, path: string, message: string);
}
/** Pure compiler: display changes select retained coordinates and never refit scientific results. */
export declare function compilePlotlySpec(result: AnalysisResult | PreparedSpaceResult, displaySpec: DisplaySpecV1): PlotlySpecV1;
//# sourceMappingURL=plotly-spec.d.ts.map