import { projectIn, type ENASet, type Row } from "jena-js";

import { ANALYSIS_BUILD_IDENTITY, type AnalysisBuildIdentity } from "./build-identity";
import { buildSharedSpaceTrajectories } from "./trajectory";
import {
  type AnalysisDiagnostic,
  type AnalysisEdge,
  type AnalysisNode,
  type AnalysisPoint,
  type AnalysisResult,
  type EntityKey,
  type RawScalar,
} from "./types";
import {
  DEFAULT_ANALYSIS_LIMITS,
  canonicalScalars,
  displayScalar,
  typedValue,
} from "./validation";

export const FITTED_JENA_TRAJECTORY_ADAPTER_VERSION_V2 =
  "3dena.fitted-jena-trajectory-adapter.v2" as const;

export interface FittedJenaTrajectoryAdapterMappingV2 {
  unitColumns: string[];
  conversationColumns: string[];
  participantColumns: string[];
  timeColumn: string;
  groupColumn: string | null;
  metadataColumns: string[];
}

export interface FittedJenaTrajectoryAdapterConfigurationV2 {
  model: "SeparateTrajectory" | "AccumulatedTrajectory";
  window: "MovingStanzaWindow" | "Conversation";
  weightBy: "binary" | "sum";
  windowSizeBack: number;
  windowSizeForward: number;
  centerAlignToOrigin: boolean;
  rotationMethod: "svd" | "mean" | "reference";
}

export interface AdaptFittedJenaTrajectoryResultV2Input {
  /** The already-successful jENA set. This adapter never invokes ena/makeSet without its fixed rotation. */
  set: ENASet;
  /** Used only to bind typed identities and explicitly selected stable metadata. Never retained. */
  sourceRows: Row[];
  mapping: FittedJenaTrajectoryAdapterMappingV2;
  configuration: FittedJenaTrajectoryAdapterConfigurationV2;
  inputColumns: string[];
}

interface SourceStepContextV2 {
  typedStepCanonical: string;
  unit: EntityKey;
  participantLabel: EntityKey;
  step: EntityKey;
  group: ReturnType<typeof typedValue>;
  time: ReturnType<typeof typedValue>;
  metadata: Record<string, RawScalar>;
}

function reject(path: string, message: string): never {
  throw new TypeError(`${path}: ${message}`);
}

function rawScalar(value: unknown, path: string): RawScalar {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    reject(path, "must be a string, finite number, boolean, or null");
  }
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
    reject(path, "unsafe integer identities must be supplied as strings");
  }
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) reject(path, "must be finite");
  return value;
}

function exactStringColumns(value: unknown, path: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    reject(path, allowEmpty ? "must be a string array" : "must be a non-empty string array");
  }
  const result = value.map((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) reject(`${path}[${index}]`, "must be non-empty");
    return entry;
  });
  if (new Set(result).size !== result.length) reject(path, "must not contain duplicate columns");
  return result;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function mergeColumns(row: Row, columns: readonly string[]): string {
  return columns.map((column) => {
    const value = rawScalar(row[column], `row.${column}`);
    return value === null ? "" : String(value);
  }).join("::");
}

function entityKey(columns: string[], values: RawScalar[]): EntityKey {
  return {
    canonical: canonicalScalars(values),
    display: values.map(displayScalar).join(" · "),
    columns: [...columns],
    values: [...values],
  };
}

function valuesFor(row: Row, columns: readonly string[], path: string): RawScalar[] {
  return columns.map((column) => rawScalar(row[column], `${path}.${column}`));
}

function combinedKey(unit: EntityKey, step: EntityKey): EntityKey {
  return entityKey([...unit.columns, ...step.columns], [...unit.values, ...step.values]);
}

function sameScalarRecord(left: Record<string, RawScalar>, right: Record<string, RawScalar>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return sameStrings(leftKeys, rightKeys)
    && leftKeys.every((key) => Object.is(left[key], right[key]));
}

function stableUnique<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = key(value);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function sourceStepContexts(
  rows: Row[],
  mapping: FittedJenaTrajectoryAdapterMappingV2,
): Map<string, SourceStepContextV2> {
  const byDisplayStep = new Map<string, SourceStepContextV2>();
  const unitIdentityByDisplay = new Map<string, string>();
  const conversationIdentityByDisplay = new Map<string, string>();
  const stepOnlyColumns = mapping.conversationColumns.filter((column) => !mapping.unitColumns.includes(column));
  if (!stepOnlyColumns.includes(mapping.timeColumn)) {
    reject("mapping.timeColumn", "must identify a conversation field outside the analytic-unit tuple");
  }
  const scientificUnitColumns = mapping.groupColumn && !mapping.unitColumns.includes(mapping.groupColumn)
    ? [...mapping.unitColumns, mapping.groupColumn]
    : [...mapping.unitColumns];

  rows.forEach((row, rowIndex) => {
    const unitValues = valuesFor(row, mapping.unitColumns, `sourceRows[${rowIndex}]`);
    const conversationValues = valuesFor(row, mapping.conversationColumns, `sourceRows[${rowIndex}]`);
    const unitDisplay = mergeColumns(row, mapping.unitColumns);
    const conversationDisplay = mergeColumns(row, mapping.conversationColumns);
    const typedUnit = canonicalScalars(unitValues);
    const typedConversation = canonicalScalars(conversationValues);
    const priorTypedUnit = unitIdentityByDisplay.get(unitDisplay);
    if (priorTypedUnit !== undefined && priorTypedUnit !== typedUnit) {
      reject(
        `sourceRows[${rowIndex}]`,
        "contains a typed analytic-unit collision in the standard jENA display identity",
      );
    }
    unitIdentityByDisplay.set(unitDisplay, typedUnit);
    const priorTypedConversation = conversationIdentityByDisplay.get(conversationDisplay);
    if (priorTypedConversation !== undefined && priorTypedConversation !== typedConversation) {
      reject(
        `sourceRows[${rowIndex}]`,
        "contains a typed conversation collision in the standard jENA display identity",
      );
    }
    conversationIdentityByDisplay.set(conversationDisplay, typedConversation);

    const displayStep = JSON.stringify([unitDisplay, conversationDisplay]);
    const participantValues = valuesFor(row, mapping.participantColumns, `sourceRows[${rowIndex}]`);
    if (participantValues.some((value) => value === null || (typeof value === "string" && value.length === 0))) {
      reject(`sourceRows[${rowIndex}]`, "contains an empty participant identity component");
    }
    const groupValue = mapping.groupColumn
      ? rawScalar(row[mapping.groupColumn], `sourceRows[${rowIndex}].${mapping.groupColumn}`)
      : "All units";
    if (groupValue === null || (typeof groupValue === "string" && groupValue.length === 0)) {
      reject(`sourceRows[${rowIndex}]`, "contains an empty group identity");
    }
    const timeValue = rawScalar(row[mapping.timeColumn], `sourceRows[${rowIndex}].${mapping.timeColumn}`);
    if (timeValue === null || (typeof timeValue === "string" && timeValue.length === 0)) {
      reject(`sourceRows[${rowIndex}]`, "contains an empty time identity");
    }
    const metadata = Object.fromEntries(mapping.metadataColumns.map((column) => [
      column,
      rawScalar(row[column], `sourceRows[${rowIndex}].${column}`),
    ]));
    const scientificUnitValues = scientificUnitColumns.map((column) => (
      mapping.groupColumn === column ? groupValue : rawScalar(row[column], `sourceRows[${rowIndex}].${column}`)
    ));
    const stepValues = valuesFor(row, stepOnlyColumns, `sourceRows[${rowIndex}]`);
    const context: SourceStepContextV2 = {
      typedStepCanonical: canonicalScalars([...unitValues, ...conversationValues]),
      unit: entityKey(scientificUnitColumns, scientificUnitValues),
      participantLabel: entityKey(mapping.participantColumns, participantValues),
      step: entityKey(stepOnlyColumns, stepValues),
      group: typedValue(groupValue),
      time: typedValue(timeValue),
      metadata,
    };
    const prior = byDisplayStep.get(displayStep);
    if (prior) {
      if (
        prior.typedStepCanonical !== context.typedStepCanonical
        || prior.participantLabel.canonical !== context.participantLabel.canonical
        || prior.group.canonical !== context.group.canonical
        || prior.time.canonical !== context.time.canonical
        || !sameScalarRecord(prior.metadata, context.metadata)
      ) {
        reject(`sourceRows[${rowIndex}]`, "changes identity, group, time, or selected metadata within one fitted jENA step");
      }
      return;
    }
    byDisplayStep.set(displayStep, context);
  });
  return byDisplayStep;
}

function validateInput(input: AdaptFittedJenaTrajectoryResultV2Input): void {
  if (!input || typeof input !== "object") reject("input", "must be an object");
  const { set, sourceRows, mapping, configuration, inputColumns } = input;
  if (!set || typeof set !== "object") reject("input.set", "must be a fitted jENA set");
  if (!Array.isArray(sourceRows) || sourceRows.length === 0) reject("input.sourceRows", "must be non-empty");
  exactStringColumns(inputColumns, "input.inputColumns");
  const unitColumns = exactStringColumns(mapping?.unitColumns, "input.mapping.unitColumns");
  const conversationColumns = exactStringColumns(mapping?.conversationColumns, "input.mapping.conversationColumns");
  const participantColumns = exactStringColumns(mapping?.participantColumns, "input.mapping.participantColumns");
  const metadataColumns = exactStringColumns(mapping?.metadataColumns, "input.mapping.metadataColumns", true);
  const declared = new Set(inputColumns);
  for (const column of [...unitColumns, ...conversationColumns, ...participantColumns, ...metadataColumns]) {
    if (!declared.has(column)) reject("input.mapping", `column ${JSON.stringify(column)} is absent from inputColumns`);
  }
  if (typeof mapping.timeColumn !== "string" || !conversationColumns.includes(mapping.timeColumn)) {
    reject("input.mapping.timeColumn", "must be one declared conversation column");
  }
  if (mapping.groupColumn !== null && (
    typeof mapping.groupColumn !== "string" || !declared.has(mapping.groupColumn)
  )) reject("input.mapping.groupColumn", "must be null or one declared input column");
  if (!sameStrings(set.units, unitColumns) || !sameStrings(set.conversation, conversationColumns)) {
    reject("input.set", "unit/conversation mappings do not match the successful jENA fit");
  }
  if (set.modelType !== configuration.model || set.functionParams.model !== configuration.model) {
    reject("input.configuration.model", "does not match the successful jENA fit");
  }
  if (set.functionParams.window !== configuration.window
    || set.functionParams.weightBy !== configuration.weightBy
    || set.functionParams.windowSizeBack !== configuration.windowSizeBack
    || set.functionParams.windowSizeForward !== configuration.windowSizeForward) {
    reject("input.configuration", "window/weight settings do not match the successful jENA fit");
  }
  if (!Array.isArray(set.trajectories) || set.trajectories.length !== set.points.length || set.points.length === 0) {
    reject("input.set.trajectories", "must align one-to-one with non-empty fitted points");
  }
  if (set.connectionCounts.length !== set.points.length || set.lineWeights.length !== set.points.length) {
    reject("input.set", "model counts, line weights, and fitted points must align");
  }
  if (!Array.isArray(set.rotation.rotationColumns) || set.rotation.rotationColumns.length < 3) {
    reject("input.set.rotation.rotationColumns", "must retain at least three fitted dimensions");
  }
}

function pointRows(
  set: ENASet,
  fullProjection: ENASet,
  contexts: Map<string, SourceStepContextV2>,
  mapping: FittedJenaTrajectoryAdapterMappingV2,
  dimensions: string[],
): AnalysisPoint[] {
  const stepOnlyColumns = mapping.conversationColumns.filter((column) => !mapping.unitColumns.includes(column));
  return set.trajectories!.map((trajectoryRow, index) => {
    const unitDisplay = mergeColumns(trajectoryRow, mapping.unitColumns);
    const conversationDisplay = mergeColumns(trajectoryRow, mapping.conversationColumns);
    const context = contexts.get(JSON.stringify([unitDisplay, conversationDisplay]));
    if (!context) reject(`input.set.trajectories[${index}]`, "has no unique typed source-step binding");
    const fittedPoint = fullProjection.points[index];
    const fittedNodeWeights = set.lineWeights[index];
    if (!fittedPoint || !fittedNodeWeights) reject(`input.set.points[${index}]`, "is not aligned to the fixed projection");
    const trajectoryStep = entityKey(
      stepOnlyColumns,
      valuesFor(trajectoryRow, stepOnlyColumns, `input.set.trajectories[${index}]`),
    );
    if (trajectoryStep.canonical !== context.step.canonical) {
      reject(`input.set.trajectories[${index}]`, "does not preserve the typed source-step tuple");
    }
    return {
      index,
      id: combinedKey(context.unit, context.step),
      unit: structuredClone(context.unit),
      participantLabel: structuredClone(context.participantLabel),
      step: structuredClone(context.step),
      group: structuredClone(context.group),
      time: structuredClone(context.time),
      coordinates: dimensions.slice(0, 3).map((dimension) => finite(fittedPoint[dimension], `fixedProjection.points[${index}].${dimension}`)) as [number, number, number],
      fullCoordinates: dimensions.map((dimension) => finite(fittedPoint[dimension], `fixedProjection.points[${index}].${dimension}`)),
      lineWeights: set.codeColumns.map((column) => finite(fittedNodeWeights[column], `input.set.lineWeights[${index}].${column}`)),
      metadata: { ...context.metadata },
    };
  });
}

function nodeRows(fullProjection: ENASet, dimensions: string[]): AnalysisNode[] {
  const nodes = fullProjection.rotation.nodes;
  if (!nodes || nodes.length !== fullProjection.codes.length) {
    reject("fixedProjection.rotation.nodes", "must provide one node for every fitted code");
  }
  return nodes.map((node, index) => ({
    index,
    code: String(node.code ?? fullProjection.codes[index] ?? ""),
    coordinates: dimensions.slice(0, 3).map((dimension) => finite(node[dimension], `fixedProjection.rotation.nodes[${index}].${dimension}`)) as [number, number, number],
    fullCoordinates: dimensions.map((dimension) => finite(node[dimension], `fixedProjection.rotation.nodes[${index}].${dimension}`)),
  }));
}

function edgeRows(set: ENASet, points: AnalysisPoint[]): AnalysisEdge[] {
  return set.adjacencyKey.map((entry, index) => {
    const weights = points.map((point) => point.lineWeights[index] ?? 0);
    return {
      index,
      id: `edge:${entry.sourceIndex}:${entry.targetIndex}`,
      column: entry.name,
      source: entry.source,
      target: entry.target,
      sourceIndex: entry.sourceIndex,
      targetIndex: entry.targetIndex,
      meanWeight: weights.reduce((sum, value) => sum + value, 0) / weights.length,
    };
  });
}

/** Return the package-build identity injected into the exact consumed artifact. */
export function getAnalysisBuildIdentityV2(): AnalysisBuildIdentity {
  return structuredClone(ANALYSIS_BUILD_IDENTITY);
}

/**
 * Convert one already-fitted jENA trajectory set into the versioned analysis
 * DTO. Full coordinates and nodes are obtained by jENA `projectIn` against a
 * node-free copy of the same rotation set, so no accumulation or rotation fit
 * is repeated and the caller's fitted set remains immutable.
 */
export function adaptFittedJenaTrajectoryResultV2(
  input: AdaptFittedJenaTrajectoryResultV2Input,
): AnalysisResult {
  validateInput(input);
  const { set, sourceRows, mapping, configuration, inputColumns } = input;
  const contexts = sourceStepContexts(sourceRows, mapping);
  const { nodes: _displayNodes, ...fixedRotation } = set.rotation;
  const dimensions = [...fixedRotation.rotationColumns];
  const fullProjection = projectIn(set, fixedRotation, {
    dimensions: dimensions.length,
    centerAlignToOrigin: configuration.centerAlignToOrigin,
  });
  const points = pointRows(set, fullProjection, contexts, mapping, dimensions);
  if (new Set(points.map((point) => point.id.canonical)).size !== points.length) {
    reject("input.set.points", "contains duplicate typed unit-step identities");
  }
  const boundDisplaySteps = new Set(set.trajectories!.map((trajectoryRow) => JSON.stringify([
    mergeColumns(trajectoryRow, mapping.unitColumns),
    mergeColumns(trajectoryRow, mapping.conversationColumns),
  ])));
  if (boundDisplaySteps.size !== contexts.size || [...contexts.keys()].some((key) => !boundDisplaySteps.has(key))) {
    reject("input.sourceRows", "does not bind exactly to the fitted jENA trajectory steps");
  }
  const nodes = nodeRows(fullProjection, dimensions);
  const edges = edgeRows(set, points);
  const trajectory = buildSharedSpaceTrajectories(points, {
    participant: [...mapping.participantColumns],
    group: mapping.groupColumn ?? "@3dena/all-units",
    time: mapping.timeColumn,
    timeOrder: stableUnique(points.map((point) => point.time!.value), (value) => typedValue(value).canonical),
    cohortPolicy: "available",
  }, dimensions);
  const diagnostics: AnalysisDiagnostic[] = [{
    code: "FITTED_JENA_FIXED_ROTATION_ADAPTER_V2",
    severity: "info",
    message: "Full-space coordinates were projected by jENA against the immutable successful-fit rotation; no ENA accumulation or rotation fit was repeated.",
    path: "provenance.resultSemantics",
  }];
  const result: AnalysisResult = {
    schemaVersion: "3dena.analysis-result.v1",
    dimensions,
    axes: dimensions.slice(0, 3) as [string, string, string],
    points,
    nodes,
    edges,
    accumulation: {
      modelCounts: {
        rowKeys: points.map((point) => structuredClone(point.id)),
        columns: [...set.codeColumns],
        values: set.connectionCounts.map((row, rowIndex) => set.codeColumns.map((column) => (
          finite(row[column], `input.set.connectionCounts[${rowIndex}].${column}`)
        ))),
      },
      rowCounts: { rowKeys: [], columns: [...set.codeColumns], values: [] },
    },
    variance: dimensions.map((axis, index) => ({
      axis,
      proportion: finite(fullProjection.variance[axis], `fixedProjection.variance.${axis}`),
      eigenvalue: finite(fixedRotation.eigenvalues[index], `input.set.rotation.eigenvalues[${index}]`),
      displayed: index < 3,
    })),
    rotation: {
      method: configuration.rotationMethod,
      columns: dimensions,
      matrix: fixedRotation.rotationMatrix.map((row, rowIndex) => row.map((value, columnIndex) => (
        finite(value, `input.set.rotation.rotationMatrix[${rowIndex}][${columnIndex}]`)
      ))),
      eigenvalues: fixedRotation.eigenvalues.map((value, index) => finite(value, `input.set.rotation.eigenvalues[${index}]`)),
      centerVector: fixedRotation.centerVector.map((value, index) => finite(value, `input.set.rotation.centerVector[${index}]`)),
    },
    trajectory,
    summary: {
      inputRows: sourceRows.length,
      inputColumns: inputColumns.length,
      units: new Set(points.map((point) => point.unit.canonical)).size,
      points: points.length,
      nodes: nodes.length,
      edges: edges.length,
      modelCountRows: points.length,
      rowCountRows: 0,
      groups: trajectory.groupOrder.length,
      timePoints: trajectory.timeOrder.length,
      participantPeriods: trajectory.participantPeriods.length,
      trajectoryCentroids: trajectory.centroids.length,
      dimensions: dimensions.length,
    },
    diagnostics,
    provenance: {
      adapter: "@3dena/analysis",
      adapterVersion: ANALYSIS_BUILD_IDENTITY.sdkVersion,
      jenaPackage: "jena-js",
      jenaVersion: ANALYSIS_BUILD_IDENTITY.jenaVersion,
      jenaCommit: ANALYSIS_BUILD_IDENTITY.jenaCommit,
      coreGoldenContract: "jena-package-golden-v1",
      legacyGoldenContract: "legacy-application-golden-v1",
      legacyGoldenStatus: "not-assessed",
      parityContract: "3dena.parity-contract.v1",
      resultSemantics: "one immutable fitted jENA rotation; fixed projectIn full-space recovery; participant-period reduction before group-time centroids",
      resolvedConfig: {
        model: configuration.model,
        window: configuration.window,
        weightBy: configuration.weightBy,
        windowSizeBack: Number.isFinite(configuration.windowSizeBack)
          ? configuration.windowSizeBack
          : "Infinity",
        windowSizeForward: configuration.windowSizeForward,
        centerAlignToOrigin: configuration.centerAlignToOrigin,
      },
      resolvedLimits: { ...DEFAULT_ANALYSIS_LIMITS },
    },
  };
  return result;
}
