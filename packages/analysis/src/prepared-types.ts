import type {
  Ena3dExchangeColumnType,
  HashedEna3dExchangeV1
} from "@3dena/io";

import type {
  AnalysisDiagnostic,
  CohortPolicy,
  Coordinates3D,
  RawScalar
} from "./types";

export type PreparedDisplayDimensions = [string, string, string];

export interface PreparedSpaceSource {
  /** Immutable validated exchange and exact-byte receipt returned by @3dena/io. */
  artifact: HashedEna3dExchangeV1;
  /** Exact user-visible source name; copied to the result receipt without normalization. */
  name: string;
}

export interface PreparedSpaceSourceReceipt {
  name: string;
  sha256: string;
  byteLength: number;
}

export interface PreparedSpaceMapping {
  /** Complete scientific participant identity; labels alone are never identities. */
  participant: string[];
  participantLabel: string;
  group: string;
  time: string;
  /** Required expected period order. Unobserved periods remain explicit path gaps. */
  timeOrder: RawScalar[];
  cohortPolicy: CohortPolicy;
  /** Exactly three existing full-space dimensions selected only for display. */
  displayDimensions: PreparedDisplayDimensions;
  /** P0 policy: every full-space point coordinate must be present and finite. */
  missingDisplayCoordinates?: "reject";
}

export interface AnalyzePreparedSpaceInput {
  source: PreparedSpaceSource;
  mapping: PreparedSpaceMapping;
}

/** A type-aware scalar copied from a validated exchange metadata column. */
export interface PreparedTypedValue {
  canonical: string;
  display: string;
  column: string;
  columnType: Ena3dExchangeColumnType;
  value: RawScalar;
}

/** Column- and exchange-type-aware tuple identity with delimiter-safe encoding. */
export interface PreparedEntityKey {
  canonical: string;
  display: string;
  columns: string[];
  columnTypes: Ena3dExchangeColumnType[];
  values: RawScalar[];
}

export interface PreparedSpacePoint {
  index: number;
  id: PreparedEntityKey;
  participant: PreparedEntityKey;
  participantLabel: PreparedTypedValue;
  group: PreparedTypedValue;
  time: PreparedTypedValue;
  metadata: Record<string, RawScalar>;
  /** All source dimensions, in `fullSpace.dimensions` order. */
  coordinates: number[];
}

export interface PreparedSpaceNode {
  index: number;
  code: string;
  /** All source dimensions, in `fullSpace.dimensions` order. */
  coordinates: number[];
}

export interface PreparedSpaceEdge {
  index: number;
  id: string;
  column: string;
  source: string;
  target: string;
  sourceIndex: number;
  targetIndex: number;
  meanWeight: number;
}

export interface PreparedSpaceLineWeights {
  rowKeys: PreparedEntityKey[];
  columns: string[];
  values: number[][];
}

export interface PreparedSpaceFullSpace {
  dimensions: string[];
  points: PreparedSpacePoint[];
  nodes: PreparedSpaceNode[];
  edges: PreparedSpaceEdge[];
  lineWeights: PreparedSpaceLineWeights;
}

export interface PreparedSpaceDisplayPoint {
  pointIndex: number;
  id: PreparedEntityKey;
  group: PreparedTypedValue;
  time: PreparedTypedValue;
  coordinates: Coordinates3D;
}

export interface PreparedSpaceDisplayNode {
  nodeIndex: number;
  code: string;
  coordinates: Coordinates3D;
}

export interface PreparedParticipantPeriodPoint {
  index: number;
  participant: PreparedEntityKey;
  participantLabel: PreparedTypedValue;
  group: PreparedTypedValue;
  time: PreparedTypedValue;
  coordinates: Coordinates3D;
  sourcePointIndexes: number[];
  includedInCohort: boolean;
}

export interface PreparedTrajectoryCentroid {
  index: number;
  group: PreparedTypedValue;
  time: PreparedTypedValue;
  coordinates: Coordinates3D;
  participantCount: number;
  participantPeriodIndexes: number[];
}

export interface PreparedTrajectoryPathStep {
  time: PreparedTypedValue;
  /** `null` is an explicit expected-but-unobserved gap, never a zero vector. */
  centroidIndex: number | null;
}

export interface PreparedTrajectoryPath {
  group: PreparedTypedValue;
  steps: PreparedTrajectoryPathStep[];
}

export interface PreparedSpaceTrajectories {
  space: "prepared-exchange-display-space";
  dimensions: PreparedDisplayDimensions;
  cohortPolicy: CohortPolicy;
  groupOrder: PreparedTypedValue[];
  timeOrder: PreparedTypedValue[];
  participantPeriods: PreparedParticipantPeriodPoint[];
  centroids: PreparedTrajectoryCentroid[];
  paths: PreparedTrajectoryPath[];
}

export interface PreparedSpaceDisplaySpace {
  dimensions: PreparedDisplayDimensions;
  points: PreparedSpaceDisplayPoint[];
  nodes: PreparedSpaceDisplayNode[];
  trajectory: PreparedSpaceTrajectories;
}

export interface PreparedSpaceDisplayFilter {
  /** Exactly three distinct names from `fullSpace.dimensions`; omitted keeps the current display axes. */
  dimensions?: PreparedDisplayDimensions;
  /** Canonical group identities returned in `displaySpace.trajectory.groupOrder`. */
  groups?: string[];
}

export interface PreparedSpaceDisplaySelection {
  space: "prepared-exchange-display-space";
  dimensions: PreparedDisplayDimensions;
  points: PreparedSpaceDisplayPoint[];
  nodes: PreparedSpaceDisplayNode[];
  cohortPolicy: CohortPolicy;
  groupOrder: PreparedTypedValue[];
  timeOrder: PreparedTypedValue[];
  participantPeriods: PreparedParticipantPeriodPoint[];
  centroids: PreparedTrajectoryCentroid[];
  paths: PreparedTrajectoryPath[];
}

export interface PreparedSpaceArtifacts {
  rotation: "not-present";
  eigenvalues: "not-present";
  variance: "not-present";
}

export interface PreparedSpaceProvenance {
  adapter: "@3dena/analysis";
  adapterVersion: "0.1.0";
  coordinateSpace: "precomputed-import";
  computation: "reduction-only";
  jenaExecuted: false;
  /** Deep-copied specification that produced this exact reduction result. */
  resolvedMapping: PreparedSpaceMapping;
}

export interface PreparedSpaceSummary {
  dimensions: number;
  points: number;
  nodes: number;
  edges: number;
  lineWeightRows: number;
  groups: number;
  timePoints: number;
  participantPeriods: number;
  trajectoryCentroids: number;
}

export interface PreparedSpaceResult {
  schemaVersion: "3dena.prepared-space-result.v1";
  sourceKind: "prepared-exchange";
  rawJenaRecompute: false;
  sourceReceipt: PreparedSpaceSourceReceipt;
  artifacts: PreparedSpaceArtifacts;
  fullSpace: PreparedSpaceFullSpace;
  displaySpace: PreparedSpaceDisplaySpace;
  summary: PreparedSpaceSummary;
  diagnostics: AnalysisDiagnostic[];
  provenance: PreparedSpaceProvenance;
}
