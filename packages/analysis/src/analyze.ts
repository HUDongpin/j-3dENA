import { ena, type ENASet, type Row } from "jena-js";

import { buildSharedSpaceTrajectories } from "./trajectory";
import {
  type AnalysisAccumulation,
  type AnalysisAccumulationTable,
  type AnalysisDiagnostic,
  type AnalysisEdge,
  type AnalysisNode,
  type AnalysisPoint,
  type AnalysisResult,
  type AxisName,
  type CoordinatesND,
  type Coordinates3D,
  type EntityKey
} from "./types";
import {
  INTERNAL_CONVERSATION_COLUMN,
  INTERNAL_SOURCE_ROW_OCCURRENCE_COLUMN,
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

function fullCoordinates(row: Row, dimensions: string[], path: string): CoordinatesND {
  return dimensions.map((dimension) => {
    if (!Object.hasOwn(row, dimension)) {
      throw new Error(`jENA omitted modeled dimension ${JSON.stringify(dimension)} at ${path}.`);
    }
    return finiteNumber(row[dimension], `${path}.${dimension}`);
  });
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

function ensureUniqueColumns(columns: string[], path: string): void {
  if (new Set(columns).size !== columns.length) {
    throw new Error(`${path} contains duplicate column names; code and edge labels must be unambiguous.`);
  }
}

function countValues(row: Row, columns: string[], path: string): number[] {
  return columns.map((column) => finiteNumber(row[column], `${path}.${column}`));
}

function emittedRowKey(row: Row, prepared: PreparedAnalysisInput, index: number): EntityKey {
  const unitKey = String(row[INTERNAL_UNIT_COLUMN] ?? "");
  const conversationKey = String(row[INTERNAL_CONVERSATION_COLUMN] ?? "");
  const unitContext = prepared.unitContexts.get(unitKey);
  const conversationContext = prepared.conversationContexts.get(conversationKey);
  if (!unitContext) throw new Error(`jENA row count ${index} has an unknown typed unit key.`);
  if (!conversationContext) throw new Error(`jENA row count ${index} has an unknown typed conversation key.`);
  return combinedPointKey(unitContext.unit, conversationContext.step);
}

function disambiguateRowKeys(baseKeys: EntityKey[]): EntityKey[] {
  const frequencies = new Map<string, number>();
  for (const key of baseKeys) frequencies.set(key.canonical, (frequencies.get(key.canonical) ?? 0) + 1);
  const occurrences = new Map<string, number>();
  return baseKeys.map((key) => {
    if ((frequencies.get(key.canonical) ?? 0) === 1) return key;
    const occurrence = (occurrences.get(key.canonical) ?? 0) + 1;
    occurrences.set(key.canonical, occurrence);
    const values = [...key.values, occurrence];
    return {
      canonical: canonicalScalars(values),
      display: `${key.display} · source row ${occurrence}`,
      columns: [...key.columns, INTERNAL_SOURCE_ROW_OCCURRENCE_COLUMN],
      values
    };
  });
}

function accumulationTables(
  set: ENASet,
  prepared: PreparedAnalysisInput,
  points: AnalysisPoint[]
): AnalysisAccumulation {
  if (set.connectionCounts.length !== points.length) {
    throw new Error(`jENA returned ${set.connectionCounts.length} model-count rows for ${points.length} aligned model points.`);
  }

  const modelColumns = [...set.codeColumns];
  const rowColumns = [...prepared.mapping.codes, ...set.codeColumns];
  ensureUniqueColumns(modelColumns, "accumulation.modelCounts.columns");
  ensureUniqueColumns(rowColumns, "accumulation.rowCounts.columns");

  const modelCounts: AnalysisAccumulationTable = {
    rowKeys: points.map((point) => point.id),
    columns: modelColumns,
    values: set.connectionCounts.map((row, index) => countValues(row, modelColumns, `connectionCounts[${index}]`))
  };
  const rowCountBaseKeys = set.rowConnectionCounts.map((row, index) => emittedRowKey(row, prepared, index));
  const rowCounts: AnalysisAccumulationTable = {
    rowKeys: disambiguateRowKeys(rowCountBaseKeys),
    columns: rowColumns,
    values: set.rowConnectionCounts.map((row, index) => countValues(row, rowColumns, `rowConnectionCounts[${index}]`))
  };

  if (new Set(modelCounts.rowKeys.map((key) => key.canonical)).size !== modelCounts.rowKeys.length) {
    throw new Error("jENA returned ambiguous duplicate model-count row identities.");
  }
  if (new Set(rowCounts.rowKeys.map((key) => key.canonical)).size !== rowCounts.rowKeys.length) {
    throw new Error("Public source-row occurrence keys remain ambiguous after disambiguation.");
  }

  const cellCount = modelCounts.values.length * modelCounts.columns.length + rowCounts.values.length * rowCounts.columns.length;
  if (!Number.isSafeInteger(cellCount) || cellCount > prepared.limits.maxAccumulationCells) {
    throw new Error(`jENA produced ${cellCount} public accumulation cells, exceeding maxAccumulationCells=${prepared.limits.maxAccumulationCells}.`);
  }
  return { modelCounts, rowCounts };
}

function pointRows(
  set: ENASet,
  prepared: PreparedAnalysisInput,
  dimensions: string[],
  diagnostics: AnalysisDiagnostic[]
): AnalysisPoint[] {
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
      fullCoordinates: fullCoordinates(row, dimensions, `points[${index}]`),
      lineWeights: set.codeColumns.map((column) => finiteNumber(lineWeightRow[column], `lineWeights[${index}].${column}`)),
      metadata: { ...unitContext.metadata }
    };
  });
}

function nodeRows(set: ENASet, dimensions: string[], diagnostics: AnalysisDiagnostic[]): AnalysisNode[] {
  const rows = set.rotation.nodes ?? [];
  return rows.map((row, index) => ({
    index,
    code: String(row.code ?? set.codes[index] ?? index),
    coordinates: coordinates(row, `nodes[${index}]`, diagnostics),
    fullCoordinates: fullCoordinates(row, dimensions, `nodes[${index}]`)
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
  const requestedDimensions = (prepared.mapping.codes.length * (prepared.mapping.codes.length - 1)) / 2;
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
    dimensions: requestedDimensions,
    centerAlignToOrigin: prepared.config.centerAlignToOrigin,
    rotation: { method: "svd" }
  });

  const diagnostics = [...prepared.diagnostics];
  const dimensions = [...set.rotation.rotationColumns];
  if (dimensions.length > prepared.limits.maxDimensions) {
    throw new Error(`jENA returned ${dimensions.length} dimensions, exceeding maxDimensions=${prepared.limits.maxDimensions}.`);
  }
  const coordinateCells = (set.points.length + (set.rotation.nodes?.length ?? 0)) * dimensions.length;
  if (!Number.isSafeInteger(coordinateCells) || coordinateCells > prepared.limits.maxCoordinateCells) {
    throw new Error(`jENA returned ${coordinateCells} point/node coordinate cells, exceeding maxCoordinateCells=${prepared.limits.maxCoordinateCells}.`);
  }
  const points = pointRows(set, prepared, dimensions, diagnostics);
  const nodes = nodeRows(set, dimensions, diagnostics);
  const edges = edgeRows(set, points);
  const accumulation = accumulationTables(set, prepared, points);
  const trajectory = prepared.mapping.trajectory
    ? buildSharedSpaceTrajectories(points, prepared.mapping.trajectory, dimensions)
    : undefined;
  diagnostics.push({
    code: "PARITY_SCOPE_NOT_ASSESSED",
    severity: "info",
    message: "A raw analysis result does not carry fixture-level parity evidence by itself. Assess exact dataset, specification, version, and build scope separately before making a candidate claim.",
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
    dimensions,
    axes: [...AXES],
    points,
    nodes,
    edges,
    accumulation,
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
      modelCountRows: accumulation.modelCounts.values.length,
      rowCountRows: accumulation.rowCounts.values.length,
      groups: trajectory?.groupOrder.length ?? 0,
      timePoints: trajectory?.timeOrder.length ?? 0,
      participantPeriods: trajectory?.participantPeriods.length ?? 0,
      trajectoryCentroids: trajectory?.centroids.length ?? 0,
      dimensions: dimensions.length
    },
    diagnostics,
    provenance: {
      adapter: "@3dena/analysis",
      adapterVersion: "0.1.0",
      jenaPackage: "jena-js",
      jenaVersion: "0.6.3",
      jenaCommit: "57b7794ec3873c251c33086454523e5a3949836f",
      coreGoldenContract: "jena-package-golden-v1",
      legacyGoldenContract: "legacy-application-golden-v1",
      legacyGoldenStatus: "not-assessed",
      parityContract: "3dena.parity-contract.v1",
      resultSemantics: "one shared SVD rotation; participant-period reduction before group-time centroids",
      resolvedConfig: { ...prepared.config },
      resolvedLimits: { ...prepared.limits }
    }
  };

  return result;
}
