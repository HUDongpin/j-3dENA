/**
 * Stable npm facade. Keep runtime exports exactly aligned with the reviewed
 * public contract; the broader workspace index remains an internal app API.
 */
export { createAnalysisClient } from "./analysis-client.js";
export { inspectDataset } from "./dataset-inspection.js";
export { createExportBundle } from "./export-bundle.js";
export { compilePlotlySpec } from "./plotly-spec.js";
export { adaptFittedJenaTrajectoryResultV2, getAnalysisBuildIdentityV2, } from "./fitted-jena-adapter-v2.js";
export { assertLongitudinalAnalysisBundleV2, assertTrajectoryRunSpecV2, compileTrajectoryPlotlySpec, executeLongitudinalAnalysisV2, verifyLongitudinalAnalysisBundleV2, } from "./longitudinal-v2.js";
export { assertAnalysisResultEnvelopeV1 } from "./contracts.js";
export { assertAnalysisExecutionDatasetV2, executeAnalysisTask, hashAnalysisValueV1 } from "./task-executor.js";
export type * from "./analysis-client.js";
export type * from "./contracts.js";
export type * from "./dataset-inspection.js";
export type * from "./export-bundle.js";
export type * from "./fitted-jena-adapter-v2.js";
export type * from "./network-analysis.js";
export type * from "./plotly-spec.js";
export type * from "./longitudinal-v2.js";
export type * from "./prepared-types.js";
export type * from "./task-executor.js";
export type * from "./trajectory-series-adapters.js";
export type * from "./trajectory-statistics.js";
export type * from "./types.js";
export type { TrajectoryDistanceAndSpeedV1, TrajectoryDurationUnitV1, TrajectoryDynamicsDiagnosticV1, TrajectoryDynamicsResultV1, TrajectoryEstimandV1, TrajectoryPeriodDynamicsV1, TrajectoryTimeContractV1, TrajectoryTimeValueV1 } from "../../trajectory/src/index.js";
//# sourceMappingURL=public.d.ts.map