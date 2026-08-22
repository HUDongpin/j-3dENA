import { type AnalysisResult } from "./types.js";
/**
 * Runs the complete framework-independent 3D analysis synchronously.
 *
 * In browsers call this inside a dedicated module Worker. jENA's SVD stage is
 * synchronous, so timeout/cancellation must hard-terminate that Worker; an
 * AbortSignal here would promise a cancellation guarantee the core cannot make.
 */
export declare function analyzeRows(input: import("./types.js").AnalyzeRowsInput): AnalysisResult;
//# sourceMappingURL=analyze.d.ts.map