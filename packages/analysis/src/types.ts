/** Values accepted at the raw-row boundary. Dates and objects must be encoded explicitly. */
export type RawScalar = string | number | boolean | null;
export type RawRow = Record<string, RawScalar>;

export type ENAModel = "EndPoint" | "AccumulatedTrajectory" | "SeparateTrajectory";
export type ENAWindow = "MovingStanzaWindow" | "Conversation";
export type ENAWeight = "binary" | "sum";
export type CohortPolicy = "available" | "complete";
export type AxisName = "SVD1" | "SVD2" | "SVD3";
export type Coordinates3D = [number, number, number];
export type CoordinatesND = number[];

export interface TrajectoryMapping {
  /** Participant label columns. Scientific identity remains the complete `units` tuple. */
  participant: string[];
  /** Unit-level group column; it must also occur in `units`. */
  group: string;
  /** Period column; it must also occur in `conversation`. */
  time: string;
  /** Optional explicit order. Missing expected periods remain explicit gaps in paths. */
  timeOrder?: RawScalar[];
  cohortPolicy?: CohortPolicy;
}

export interface RawRowMapping {
  units: string[];
  conversation: string[];
  codes: string[];
  metadata?: string[];
  trajectory?: TrajectoryMapping;
}

export interface AnalysisConfig {
  model?: ENAModel;
  window?: ENAWindow;
  weightBy?: ENAWeight;
  windowSizeBack?: number;
  windowSizeForward?: number;
  centerAlignToOrigin?: boolean;
}

export interface AnalysisResourceLimits {
  maxRows: number;
  maxColumns: number;
  maxCells: number;
  /** Combined numeric cells copied into public model/row accumulation tables. */
  maxAccumulationCells: number;
  maxCodes: number;
  maxEdges: number;
  maxStringLength: number;
  maxUnits: number;
  maxGroups: number;
  maxTimePoints: number;
  maxOutputPoints: number;
  /** Maximum retained dimensions in the shared ENA rotation space. */
  maxDimensions: number;
  /** Point and node coordinates retained across all modeled dimensions. */
  maxCoordinateCells: number;
}

export interface AnalyzeRowsInput {
  rows: RawRow[];
  mapping: RawRowMapping;
  config?: AnalysisConfig;
  /** Limits may only tighten the package hard ceiling, never raise it. */
  limits?: Partial<AnalysisResourceLimits>;
}

export interface TypedValue {
  canonical: string;
  display: string;
  value: RawScalar;
}

export interface EntityKey {
  /** Collision-safe, type-preserving tuple encoding. */
  canonical: string;
  display: string;
  columns: string[];
  values: RawScalar[];
}

export interface AnalysisPoint {
  index: number;
  id: EntityKey;
  unit: EntityKey;
  participantLabel: EntityKey;
  step?: EntityKey;
  group?: TypedValue;
  time?: TypedValue;
  coordinates: Coordinates3D;
  /** All modeled dimensions, aligned with `AnalysisResult.dimensions`. */
  fullCoordinates: CoordinatesND;
  /** One normalized weight per `AnalysisResult.edges`, in identical order. */
  lineWeights: number[];
  metadata: Record<string, RawScalar>;
}

export interface AnalysisNode {
  index: number;
  code: string;
  coordinates: Coordinates3D;
  /** All modeled dimensions, aligned with `AnalysisResult.dimensions`. */
  fullCoordinates: CoordinatesND;
}

export interface AnalysisEdge {
  index: number;
  id: string;
  column: string;
  source: string;
  target: string;
  sourceIndex: number;
  targetIndex: number;
  /** Mean of normalized line weights over all model points. */
  meanWeight: number;
}

/**
 * Structured-clone-safe numeric table whose rows retain typed scientific
 * identity instead of relying on display labels or delimiter joins.
 */
export interface AnalysisAccumulationTable {
  rowKeys: EntityKey[];
  columns: string[];
  values: number[][];
}

/** Neutral public names for jENA's two accumulation grains. */
export interface AnalysisAccumulation {
  /** One accumulated co-occurrence row per modeled unit or unit-step point. */
  modelCounts: AnalysisAccumulationTable;
  /** One code/co-occurrence row per emitted source row, in source order. */
  rowCounts: AnalysisAccumulationTable;
}

export interface DimensionVariance {
  axis: string;
  proportion: number;
  eigenvalue: number;
  displayed: boolean;
}

export interface AnalysisRotation {
  method: "svd" | "mean" | "reference";
  columns: string[];
  matrix: number[][];
  eigenvalues: number[];
  centerVector: number[];
}

export interface ParticipantPeriodPoint {
  index: number;
  participant: EntityKey;
  participantLabel: EntityKey;
  group: TypedValue;
  time: TypedValue;
  coordinates: Coordinates3D;
  fullCoordinates: CoordinatesND;
  sourcePointIndexes: number[];
  includedInCohort: boolean;
}

export interface TrajectoryCentroid {
  index: number;
  group: TypedValue;
  time: TypedValue;
  coordinates: Coordinates3D;
  fullCoordinates: CoordinatesND;
  participantCount: number;
  participantPeriodIndexes: number[];
}

export interface TrajectoryPathStep {
  time: TypedValue;
  /** `null` is an explicit unobserved period/gap, not a zero coordinate. */
  centroidIndex: number | null;
}

export interface TrajectoryPath {
  group: TypedValue;
  steps: TrajectoryPathStep[];
}

export interface SharedSpaceTrajectories {
  /** Every row was projected by `AnalysisResult.rotation`; no period refit occurs. */
  space: "analysis-result-rotation";
  /** Complete modeled rotation inventory used by `fullCoordinates`. */
  dimensions: string[];
  cohortPolicy: CohortPolicy;
  groupOrder: TypedValue[];
  timeOrder: TypedValue[];
  participantPeriods: ParticipantPeriodPoint[];
  centroids: TrajectoryCentroid[];
  paths: TrajectoryPath[];
}

export interface TrajectoryDisplayFilter {
  /** Canonical group keys returned in `trajectory.groupOrder`. */
  groups?: string[];
}

export interface TrajectoryDisplaySelection {
  space: "analysis-result-rotation";
  groupOrder: TypedValue[];
  timeOrder: TypedValue[];
  centroids: TrajectoryCentroid[];
  paths: TrajectoryPath[];
}

export type AnalysisDisplayDimensions = [string, string, string];

export interface AnalysisDisplayFilter {
  /** Three distinct names from `AnalysisResult.dimensions`; omitted keeps SVD1–SVD3. */
  dimensions?: AnalysisDisplayDimensions;
  /** Canonical group keys; omitted keeps every group and point. */
  groups?: string[];
}

export interface AnalysisDisplayPoint {
  pointIndex: number;
  id: EntityKey;
  group?: TypedValue;
  time?: TypedValue;
  coordinates: Coordinates3D;
}

export interface AnalysisDisplayNode {
  nodeIndex: number;
  code: string;
  coordinates: Coordinates3D;
}

export interface AnalysisDisplayParticipantPeriod {
  participantPeriodIndex: number;
  participant: EntityKey;
  group: TypedValue;
  time: TypedValue;
  coordinates: Coordinates3D;
  includedInCohort: boolean;
}

export interface AnalysisDisplayCentroid {
  centroidIndex: number;
  group: TypedValue;
  time: TypedValue;
  coordinates: Coordinates3D;
  participantCount: number;
}

export interface AnalysisDisplaySelection {
  space: "analysis-result-rotation-display";
  dimensions: AnalysisDisplayDimensions;
  points: AnalysisDisplayPoint[];
  nodes: AnalysisDisplayNode[];
  trajectory?: {
    cohortPolicy: CohortPolicy;
    groupOrder: TypedValue[];
    timeOrder: TypedValue[];
    participantPeriods: AnalysisDisplayParticipantPeriod[];
    centroids: AnalysisDisplayCentroid[];
    paths: TrajectoryPath[];
  };
}

export type DiagnosticSeverity = "info" | "warning";

export interface AnalysisDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  path?: string;
  /** Optional aggregate count; never a raw row or participant identifier. */
  count?: number;
}

export interface AnalysisSummary {
  inputRows: number;
  inputColumns: number;
  units: number;
  points: number;
  nodes: number;
  edges: number;
  modelCountRows: number;
  rowCountRows: number;
  groups: number;
  timePoints: number;
  participantPeriods: number;
  trajectoryCentroids: number;
  dimensions: number;
}

export interface AnalysisProvenance {
  adapter: "@3dena/analysis";
  adapterVersion: string;
  jenaPackage: "jena-js";
  jenaVersion: string;
  jenaCommit: string;
  coreGoldenContract: "jena-package-golden-v1";
  legacyGoldenContract: "legacy-application-golden-v1";
  /**
   * A raw execution cannot infer fixture-level parity from modeled rows alone.
   * Exact dataset/spec/version evidence is assessed outside this scientific DTO.
   */
  legacyGoldenStatus: "not-assessed";
  parityContract: "3dena.parity-contract.v1";
  resultSemantics:
    | "one shared SVD rotation; participant-period reduction before group-time centroids"
    | "one immutable fitted jENA rotation; fixed projectIn full-space recovery; participant-period reduction before group-time centroids";
  resolvedConfig: Omit<Required<AnalysisConfig>, "windowSizeBack"> & {
    /** JSON-safe representation of jENA's unbounded Conversation window. */
    windowSizeBack: number | "Infinity";
  };
  resolvedLimits: AnalysisResourceLimits;
}

export interface AnalysisResult {
  schemaVersion: "3dena.analysis-result.v1";
  /** Complete modeled rotation inventory retained from the single jENA fit. */
  dimensions: string[];
  /** The first three display dimensions exposed by this fitted rotation. */
  axes: [string, string, string];
  points: AnalysisPoint[];
  nodes: AnalysisNode[];
  edges: AnalysisEdge[];
  accumulation: AnalysisAccumulation;
  variance: DimensionVariance[];
  rotation: AnalysisRotation;
  trajectory?: SharedSpaceTrajectories;
  summary: AnalysisSummary;
  diagnostics: AnalysisDiagnostic[];
  provenance: AnalysisProvenance;
}

export interface AnalysisValidationIssue {
  code: string;
  message: string;
  path: string;
}

export class AnalysisValidationError extends Error {
  readonly issues: AnalysisValidationIssue[];

  constructor(issues: AnalysisValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "AnalysisValidationError";
    this.issues = issues;
  }
}
