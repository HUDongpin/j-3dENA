import { ena, type ENASet, type Row } from "jena-js";

import { buildSharedSpaceTrajectories } from "./trajectory";
import {
  type AnalysisDiagnostic,
  type AnalysisEdge,
  type AnalysisNode,
  type AnalysisPoint,
  type AnalysisResult,
  type AxisName,
  type Coordinates3D,
  type EntityKey
} from "./types";
import {
  INTERNAL_CONVERSATION_COLUMN,
  INTERNAL_UNIT_COLUMN,
  canonicalScalars,
  displayScalar,
  prepareAnalysisInput,
  type PreparedAnalysisInput
} from "./validation";

const AXES: [AxisName, AxisName, AxisName] = ["SVD1", "SVD2", "SVD3"];

function finiteNumber(value: unknown, path: string): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`jENA returned a non-finite number at ${path}.`);
  return numeric;
}

function coordinates(row: Row, path: string, diagnostics: AnalysisDiagnostic[]): Coordinates3D {
  return AXES.map((axis) => {
    if (!Object.hasOwn(row, axis)) {
      if (!diagnostics.some((diagnostic) => diagnostic.code === "MISSING_DISPLAY_AXIS" && diagnostic.path === axis)) {
        diagnostics.push({
          code: "MISSING_DISPLAY_AXIS",
          severity: "warning",
          message: `${axis} was unavailable from jENA and was padded with zero.`,
          path: axis
        });
      }
      return 0;
    }
    return finiteNumber(row[axis], `${path}.${axis}`);
  }) as Coordinates3D;
}

function combinedPointKey(unit: EntityKey, step: EntityKey | undefined): EntityKey {
  if (!step) return unit;
  const values = [...unit.values, ...step.values];
  return {
    canonical: canonicalScalars(values),
    display: values.map(displayScalar).join(" · "),
    columns: [...unit.columns, ...step.columns],
    values
  };
}

function pointRows(set: ENASet, prepared: PreparedAnalysisInput, diagnostics: AnalysisDiagnostic[]): AnalysisPoint[] {
  if (set.points.length > prepared.limits.maxOutputPoints) {
    throw new Error(`jENA produced ${set.points.length} points, exceeding maxOutputPoints=${prepared.limits.maxOutputPoints}.`);
  }
  return set.points.map((row, index) => {
    const unitKey = String(row[INTERNAL_UNIT_COLUMN] ?? "");
    const unitContext = prepared.unitContexts.get(unitKey);
    if (!unitContext) throw new Error(`jENA point ${index} has an unknown typed unit key.`);
    const trajectoryRow = set.trajectories?.[index];
    const conversationKey = trajectoryRow ? String(trajectoryRow[INTERNAL_CONVERSATION_COLUMN] ?? "") : undefined;
    const conversationContext = conversationKey ? prepared.conversationContexts.get(conversationKey) : undefined;
    if (prepared.config.model !== "EndPoint" && !conversationContext) {
      throw new Error(`jENA trajectory point ${index} has no matching typed conversation key.`);
    }
    const lineWeightRow = set.lineWeights[index];
    if (!lineWeightRow) throw new Error(`jENA point ${index} has no aligned line-weight row.`);
    const step = conversationContext?.step;
    return {
      index,
      id: combinedPointKey(unitContext.unit, step),
      unit: unitContext.unit,
      participantLabel: unitContext.participantLabel,
      ...(step ? { step } : {}),
      ...(unitContext.group ? { group: unitContext.group } : {}),
      ...(conversationContext?.time ? { time: conversationContext.time } : {}),
      coordinates: coordinates(row, `points[${index}]`, diagnostics),
      lineWeights: set.codeColumns.map((column) => finiteNumber(lineWeightRow[column], `lineWeights[${index}].${column}`)),
      metadata: { ...unitContext.metadata }
    };
  });
}

function nodeRows(set: ENASet, diagnostics: AnalysisDiagnostic[]): AnalysisNode[] {
  const rows = set.rotation.nodes ?? [];
  return rows.map((row, index) => ({
    index,
    code: String(row.code ?? set.codes[index] ?? index),
    coordinates: coordinates(row, `nodes[${index}]`, diagnostics)
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
      meanWeight: weights.length === 0 ? 0 : weights.reduce((sum, weight) => sum + weight, 0) / weights.length
    };
  });
}

function finiteMatrix(matrix: number[][], path: string): number[][] {
  return matrix.map((row, rowIndex) => row.map((value, columnIndex) => finiteNumber(value, `${path}[${rowIndex}][${columnIndex}]`)));
}

/**
 * Runs the complete framework-independent 3D analysis synchronously.
 *
 * In browsers call this inside a dedicated module Worker. jENA's SVD stage is
 * synchronous, so timeout/cancellation must hard-terminate that Worker; an
 * AbortSignal here would promise a cancellation guarantee the core cannot make.
 */
export function analyzeRows(input: import("./types").AnalyzeRowsInput): AnalysisResult {
  const prepared = prepareAnalysisInput(input);
  const set = ena({
    rows: prepared.rows,
    units: [INTERNAL_UNIT_COLUMN],
    conversation: [INTERNAL_CONVERSATION_COLUMN],
    codes: [...prepared.mapping.codes],
    model: prepared.config.model,
    window: prepared.config.window,
    weightBy: prepared.config.weightBy,
    windowSizeBack: prepared.config.windowSizeBack,
    windowSizeForward: prepared.config.windowSizeForward,
    dimensions: 3,
    centerAlignToOrigin: prepared.config.centerAlignToOrigin,
    rotation: { method: "svd" }
  });

  const diagnostics = [...prepared.diagnostics];
  const points = pointRows(set, prepared, diagnostics);
  const nodes = nodeRows(set, diagnostics);
  const edges = edgeRows(set, points);
  const trajectory = prepared.mapping.trajectory
    ? buildSharedSpaceTrajectories(points, prepared.mapping.trajectory)
    : undefined;
  diagnostics.push({
    code: "LEGACY_APPLICATION_GOLDEN_PENDING",
    severity: "warning",
    message: "The frozen legacy-application numeric fixture comparison remains pending; consult the development-only parity contract before making parity claims.",
    path: "provenance.legacyGoldenStatus"
  });

  const variance = set.rotation.rotationColumns.map((axis, rotationIndex) => {
    return {
      axis,
      proportion: finiteNumber(set.variance[axis] ?? 0, `variance.${axis}`),
      eigenvalue: finiteNumber(set.rotation.eigenvalues[rotationIndex] ?? 0, `rotation.eigenvalues[${rotationIndex}]`),
      displayed: AXES.includes(axis as AxisName)
    };
  });

  const result: AnalysisResult = {
    schemaVersion: "3dena.analysis-result.v1",
    axes: [...AXES],
    points,
    nodes,
    edges,
    variance,
    rotation: {
      method: "svd",
      columns: [...set.rotation.rotationColumns],
      matrix: finiteMatrix(set.rotation.rotationMatrix, "rotation.matrix"),
      eigenvalues: set.rotation.eigenvalues.map((value, index) => finiteNumber(value, `rotation.eigenvalues[${index}]`)),
      centerVector: set.rotation.centerVector.map((value, index) => finiteNumber(value, `rotation.centerVector[${index}]`))
    },
    ...(trajectory ? { trajectory } : {}),
    summary: {
      inputRows: input.rows.length,
      inputColumns: prepared.inputColumns.length,
      units: prepared.unitContexts.size,
      points: points.length,
      nodes: nodes.length,
      edges: edges.length,
      groups: trajectory?.groupOrder.length ?? 0,
      timePoints: trajectory?.timeOrder.length ?? 0,
      participantPeriods: trajectory?.participantPeriods.length ?? 0,
      trajectoryCentroids: trajectory?.centroids.length ?? 0
    },
    diagnostics,
    provenance: {
      adapter: "@3dena/analysis",
      adapterVersion: "0.1.0",
      jenaPackage: "jena-js",
      jenaVersion: "0.6.2",
      jenaCommit: "2f63db4c6ccf5684afc8437ae81ed1a3ccd0c1a3",
      coreGoldenContract: "jena-package-golden-v1",
      legacyGoldenContract: "legacy-application-golden-v1",
      legacyGoldenStatus: "pending",
      parityContract: "3dena.parity-contract.v1",
      resultSemantics: "one shared SVD rotation; participant-period reduction before group-time centroids",
      resolvedConfig: { ...prepared.config },
      resolvedLimits: { ...prepared.limits }
    }
  };

  return result;
}
