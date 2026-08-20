/**
 * Stable npm facade. Keep runtime exports exactly aligned with the reviewed
 * public contract; the broader workspace index remains an internal app API.
 */
export { createAnalysisClient } from "./analysis-client";
export { inspectDataset } from "./dataset-inspection";
export { createExportBundle } from "./export-bundle";
export { compilePlotlySpec } from "./plotly-spec";
export { assertAnalysisResultEnvelopeV1 } from "./contracts";
export { assertAnalysisExecutionDatasetV2, executeAnalysisTask } from "./task-executor";

export type * from "./analysis-client";
export type * from "./contracts";
export type * from "./dataset-inspection";
export type * from "./export-bundle";
export type * from "./network-analysis";
export type * from "./plotly-spec";
export type * from "./prepared-types";
export type * from "./task-executor";
export type * from "./trajectory-series-adapters";
export type * from "./trajectory-statistics";
export type * from "./types";
export type {
  TrajectoryDistanceAndSpeedV1,
  TrajectoryDurationUnitV1,
  TrajectoryDynamicsDiagnosticV1,
  TrajectoryDynamicsResultV1,
  TrajectoryEstimandV1,
  TrajectoryPeriodDynamicsV1,
  TrajectoryTimeContractV1,
  TrajectoryTimeValueV1
} from "@3dena/trajectory";
