import type { Row } from "jena-js";

import {
  AnalysisValidationError,
  type AnalysisConfig,
  type AnalysisDiagnostic,
  type AnalysisResourceLimits,
  type AnalysisValidationIssue,
  type AnalyzeRowsInput,
  type EntityKey,
  type RawRow,
  type RawRowMapping,
  type RawScalar,
  type TypedValue
} from "./types";

export const INTERNAL_UNIT_COLUMN = "__3dena_unit_key_v1";
export const INTERNAL_CONVERSATION_COLUMN = "__3dena_conversation_key_v1";

export const DEFAULT_ANALYSIS_LIMITS: AnalysisResourceLimits = Object.freeze({
  maxRows: 100_000,
  maxColumns: 256,
  maxCells: 5_000_000,
  maxCodes: 64,
  maxEdges: 2_016,
  maxStringLength: 32_768,
  maxUnits: 50_000,
  maxGroups: 200,
  maxTimePoints: 512,
  maxOutputPoints: 100_000
});

export const HARD_ANALYSIS_LIMITS: AnalysisResourceLimits = Object.freeze({
  maxRows: 500_000,
  maxColumns: 1_024,
  maxCells: 20_000_000,
  maxCodes: 128,
  maxEdges: 8_128,
  maxStringLength: 1_000_000,
  maxUnits: 200_000,
  maxGroups: 1_000,
  maxTimePoints: 10_000,
  maxOutputPoints: 500_000
});

export interface UnitContext {
  unit: EntityKey;
  participantLabel: EntityKey;
  group?: TypedValue;
  metadata: Record<string, RawScalar>;
}

export interface ConversationContext {
  step: EntityKey;
  time?: TypedValue;
}

export interface PreparedAnalysisInput {
  rows: Row[];
  mapping: RawRowMapping;
  config: Required<AnalysisConfig>;
  limits: AnalysisResourceLimits;
  inputColumns: string[];
  unitContexts: Map<string, UnitContext>;
  conversationContexts: Map<string, ConversationContext>;
  diagnostics: AnalysisDiagnostic[];
}

function issue(code: string, path: string, message: string) {
  return { code, path, message };
}

function validateKnownKeys(value: unknown, path: string, allowed: string[], issues: AnalysisValidationIssue[]): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push(issue("INVALID_OBJECT", path, "must be an object"));
    return;
  }
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) issues.push(issue("UNKNOWN_OPTION", `${path}.${key}`, "is not part of the versioned input contract"));
  }
}

function validateEnvelopeShape(input: AnalyzeRowsInput): void {
  const issues: AnalysisValidationIssue[] = [];
  validateKnownKeys(input, "input", ["rows", "mapping", "config", "limits"], issues);
  validateKnownKeys(input.mapping, "mapping", ["units", "conversation", "codes", "metadata", "trajectory"], issues);
  validateKnownKeys(input.mapping.trajectory, "mapping.trajectory", ["participant", "group", "time", "timeOrder", "cohortPolicy"], issues);
  validateKnownKeys(input.config, "config", ["model", "window", "weightBy", "windowSizeBack", "windowSizeForward", "centerAlignToOrigin"], issues);
  validateKnownKeys(input.limits, "limits", Object.keys(DEFAULT_ANALYSIS_LIMITS), issues);
  if (issues.length > 0) throw new AnalysisValidationError(issues);
}

function isRawScalar(value: unknown): value is RawScalar {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function scalarToken(value: RawScalar): [string, string] {
  if (value === null) return ["null", ""];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "boolean") return ["boolean", value ? "true" : "false"];
  if (Object.is(value, -0)) return ["number", "-0"];
  return ["number", String(value)];
}

export function canonicalScalars(values: RawScalar[]): string {
  return JSON.stringify(values.map(scalarToken));
}

export function displayScalar(value: RawScalar): string {
  if (value === null) return "";
  return String(value);
}

export function typedValue(value: RawScalar): TypedValue {
  return {
    canonical: canonicalScalars([value]),
    display: displayScalar(value),
    value
  };
}

export function entityKey(row: RawRow, columns: string[]): EntityKey {
  const values = columns.map((column) => row[column] ?? null);
  return {
    canonical: canonicalScalars(values),
    display: values.map(displayScalar).join(" · "),
    columns: [...columns],
    values
  };
}

function normalizeCode(value: RawScalar, path: string): number {
  let numeric: number;
  if (typeof value === "boolean") numeric = value ? 1 : 0;
  else if (typeof value === "number") numeric = value;
  else if (typeof value === "string" && value.trim() !== "") numeric = Number(value);
  else throw new AnalysisValidationError([issue("INVALID_CODE_VALUE", path, "code values must be finite non-negative numbers, numeric strings, or booleans")]);

  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new AnalysisValidationError([issue("INVALID_CODE_VALUE", path, "code values must be finite and non-negative")]);
  }
  return numeric;
}

function normalizedConfig(input: AnalyzeRowsInput): Required<AnalysisConfig> {
  return {
    model: input.config?.model ?? (input.mapping.trajectory ? "AccumulatedTrajectory" : "EndPoint"),
    window: input.config?.window ?? "MovingStanzaWindow",
    weightBy: input.config?.weightBy ?? "binary",
    windowSizeBack: input.config?.windowSizeBack ?? 4,
    windowSizeForward: input.config?.windowSizeForward ?? 0,
    centerAlignToOrigin: input.config?.centerAlignToOrigin ?? true
  };
}

function resolveLimits(input: AnalyzeRowsInput): AnalysisResourceLimits {
  const issues: AnalysisValidationIssue[] = [];
  const entries = Object.keys(DEFAULT_ANALYSIS_LIMITS) as Array<keyof AnalysisResourceLimits>;
  const resolved = {} as AnalysisResourceLimits;
  for (const key of entries) {
    const requested = input.limits?.[key];
    if (requested !== undefined && (!Number.isSafeInteger(requested) || requested < 1)) {
      issues.push(issue("INVALID_RESOURCE_LIMIT", `limits.${key}`, "must be a positive safe integer"));
      continue;
    }
    if (requested !== undefined && requested > HARD_ANALYSIS_LIMITS[key]) {
      issues.push(issue("RESOURCE_LIMIT_ABOVE_HARD_CEILING", `limits.${key}`, `must not exceed ${HARD_ANALYSIS_LIMITS[key]}`));
      continue;
    }
    resolved[key] = requested ?? DEFAULT_ANALYSIS_LIMITS[key];
  }
  if (issues.length > 0) throw new AnalysisValidationError(issues);
  return resolved;
}

function validateColumnList(name: string, columns: unknown, minimum: number, issues: ReturnType<typeof issue>[]): string[] {
  if (!Array.isArray(columns) || columns.length < minimum) {
    issues.push(issue("INVALID_COLUMN_MAPPING", `mapping.${name}`, `must contain at least ${minimum} column${minimum === 1 ? "" : "s"}`));
    return [];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  columns.forEach((column, index) => {
    if (typeof column !== "string" || column.trim() === "") {
      issues.push(issue("INVALID_COLUMN_NAME", `mapping.${name}[${index}]`, "must be a non-empty string"));
      return;
    }
    if (seen.has(column)) {
      issues.push(issue("DUPLICATE_COLUMN", `mapping.${name}[${index}]`, `duplicates ${JSON.stringify(column)}`));
      return;
    }
    seen.add(column);
    result.push(column);
  });
  return result;
}

function validateMapping(mapping: RawRowMapping, config: Required<AnalysisConfig>, limits: AnalysisResourceLimits): void {
  const issues: AnalysisValidationIssue[] = [];
  const units = validateColumnList("units", mapping.units, 1, issues);
  const conversation = validateColumnList("conversation", mapping.conversation, 1, issues);
  const codes = validateColumnList("codes", mapping.codes, 3, issues);
  const metadata = mapping.metadata === undefined ? [] : validateColumnList("metadata", mapping.metadata, 0, issues);
  const roleSets: Array<[string, string[]]> = [["units", units], ["conversation", conversation], ["codes", codes], ["metadata", metadata]];
  const owners = new Map<string, string>();
  for (const [role, columns] of roleSets) {
    for (const column of columns) {
      const previous = owners.get(column);
      if (previous) issues.push(issue("OVERLAPPING_COLUMN_ROLES", `mapping.${role}`, `${JSON.stringify(column)} is already mapped as ${previous}`));
      else owners.set(column, role);
    }
  }
  for (const reserved of [INTERNAL_UNIT_COLUMN, INTERNAL_CONVERSATION_COLUMN]) {
    if (owners.has(reserved)) issues.push(issue("RESERVED_COLUMN", "mapping", `${JSON.stringify(reserved)} is reserved by @3dena/analysis`));
  }
  const edgeCount = (codes.length * (codes.length - 1)) / 2;
  if (codes.length > limits.maxCodes) issues.push(issue("CODE_LIMIT_EXCEEDED", "mapping.codes", `${codes.length} exceeds maxCodes=${limits.maxCodes}`));
  if (edgeCount > limits.maxEdges) issues.push(issue("EDGE_LIMIT_EXCEEDED", "mapping.codes", `${edgeCount} implied edges exceeds maxEdges=${limits.maxEdges}`));
  if (!["EndPoint", "AccumulatedTrajectory", "SeparateTrajectory"].includes(config.model)) issues.push(issue("INVALID_MODEL", "config.model", "must be EndPoint, AccumulatedTrajectory, or SeparateTrajectory"));
  if (!["MovingStanzaWindow", "Conversation"].includes(config.window)) issues.push(issue("INVALID_WINDOW", "config.window", "must be MovingStanzaWindow or Conversation"));
  if (!["binary", "sum"].includes(config.weightBy)) issues.push(issue("INVALID_WEIGHT", "config.weightBy", "must be binary or sum"));
  if (!Number.isInteger(config.windowSizeBack) || config.windowSizeBack < 0) issues.push(issue("INVALID_WINDOW", "config.windowSizeBack", "must be a non-negative integer"));
  if (!Number.isInteger(config.windowSizeForward) || config.windowSizeForward < 0) issues.push(issue("INVALID_WINDOW", "config.windowSizeForward", "must be a non-negative integer"));
  if (typeof config.centerAlignToOrigin !== "boolean") issues.push(issue("INVALID_CENTERING", "config.centerAlignToOrigin", "must be boolean"));

  const trajectory = mapping.trajectory;
  if (trajectory) {
    if (config.model === "EndPoint") issues.push(issue("TRAJECTORY_MODEL_REQUIRED", "config.model", "trajectory mapping requires AccumulatedTrajectory or SeparateTrajectory"));
    const participants = validateColumnList("trajectory.participant", trajectory.participant, 1, issues);
    for (const participant of participants) {
      if (!units.includes(participant)) issues.push(issue("PARTICIPANT_NOT_UNIT", "mapping.trajectory.participant", `${JSON.stringify(participant)} must also occur in mapping.units`));
    }
    if (!units.includes(trajectory.group)) issues.push(issue("GROUP_NOT_UNIT", "mapping.trajectory.group", "group must also occur in mapping.units so it is unit-stable"));
    if (!conversation.includes(trajectory.time)) issues.push(issue("TIME_NOT_CONVERSATION", "mapping.trajectory.time", "time must also occur in mapping.conversation"));
    if (trajectory.cohortPolicy !== undefined && trajectory.cohortPolicy !== "available" && trajectory.cohortPolicy !== "complete") {
      issues.push(issue("INVALID_COHORT_POLICY", "mapping.trajectory.cohortPolicy", "must be available or complete"));
    }
    if (trajectory.timeOrder !== undefined && !Array.isArray(trajectory.timeOrder)) {
      issues.push(issue("INVALID_TIME_ORDER", "mapping.trajectory.timeOrder", "must be an array when provided"));
    } else if (trajectory.timeOrder) {
      const seen = new Set<string>();
      trajectory.timeOrder.forEach((value, index) => {
        if (!isRawScalar(value) || value === null || (typeof value === "number" && !Number.isFinite(value))) {
          issues.push(issue("INVALID_TIME_ORDER", `mapping.trajectory.timeOrder[${index}]`, "must be a non-null finite scalar"));
          return;
        }
        const key = canonicalScalars([value]);
        if (seen.has(key)) issues.push(issue("DUPLICATE_TIME", `mapping.trajectory.timeOrder[${index}]`, "duplicates an earlier typed period value"));
        seen.add(key);
      });
    }
  }
  if (issues.length > 0) throw new AnalysisValidationError(issues);
}

function validateIdentityValue(value: RawScalar, path: string): void {
  if (value === null || value === "") {
    throw new AnalysisValidationError([issue("MISSING_IDENTITY", path, "identity values must not be null or empty")]);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new AnalysisValidationError([issue("NON_FINITE_IDENTITY", path, "identity numbers must be finite")]);
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new AnalysisValidationError([issue("UNSAFE_INTEGER_IDENTITY", path, "integers above Number.MAX_SAFE_INTEGER must be supplied as strings")]);
    }
  }
}

function stableRowValue(previous: RawScalar, current: RawScalar): boolean {
  return canonicalScalars([previous]) === canonicalScalars([current]);
}

export function prepareAnalysisInput(input: AnalyzeRowsInput): PreparedAnalysisInput {
  if (!input || typeof input !== "object") {
    throw new AnalysisValidationError([issue("INVALID_INPUT", "input", "must be an object")]);
  }
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    throw new AnalysisValidationError([issue("EMPTY_ROWS", "rows", "must contain at least one row")]);
  }
  if (!input.mapping || typeof input.mapping !== "object") {
    throw new AnalysisValidationError([issue("INVALID_MAPPING", "mapping", "must be an object")]);
  }
  validateEnvelopeShape(input);
  const limits = resolveLimits(input);
  const config = normalizedConfig(input);
  validateMapping(input.mapping, config, limits);
  if (input.rows.length > limits.maxRows) {
    throw new AnalysisValidationError([issue("ROW_LIMIT_EXCEEDED", "rows", `${input.rows.length} exceeds maxRows=${limits.maxRows}`)]);
  }

  const requiredColumns = [
    ...input.mapping.units,
    ...input.mapping.conversation,
    ...input.mapping.codes,
    ...(input.mapping.metadata ?? [])
  ];
  const inputColumnSet = new Set<string>();
  const unitContexts = new Map<string, UnitContext>();
  const conversationContexts = new Map<string, ConversationContext>();
  const normalizedRows: Row[] = [];
  const observedGroups = new Set<string>();
  const observedTimes = new Set<string>();
  const predictedPointKeys = new Set<string>();

  input.rows.forEach((candidate, rowIndex) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new AnalysisValidationError([issue("INVALID_ROW", `rows[${rowIndex}]`, "must be a scalar record")]);
    }
    const row = candidate as RawRow;
    for (const [column, value] of Object.entries(row)) {
      inputColumnSet.add(column);
      if (!isRawScalar(value)) throw new AnalysisValidationError([issue("NON_SCALAR_VALUE", `rows[${rowIndex}].${column}`, "must be string, number, boolean, or null")]);
      if (typeof value === "number" && !Number.isFinite(value)) throw new AnalysisValidationError([issue("NON_FINITE_VALUE", `rows[${rowIndex}].${column}`, "must be finite")]);
      if (typeof value === "string" && value.length > limits.maxStringLength) throw new AnalysisValidationError([issue("STRING_LIMIT_EXCEEDED", `rows[${rowIndex}].${column}`, `length exceeds maxStringLength=${limits.maxStringLength}`)]);
    }
    for (const column of requiredColumns) {
      if (!Object.hasOwn(row, column)) throw new AnalysisValidationError([issue("MISSING_COLUMN", `rows[${rowIndex}].${column}`, "required mapped column is missing")]);
    }
    for (const column of [...input.mapping.units, ...input.mapping.conversation]) validateIdentityValue(row[column] ?? null, `rows[${rowIndex}].${column}`);

    const unit = entityKey(row, input.mapping.units);
    const step = entityKey(row, input.mapping.conversation);
    predictedPointKeys.add(config.model === "EndPoint" ? unit.canonical : JSON.stringify([unit.canonical, step.canonical]));
    const participantColumns = input.mapping.trajectory?.participant ?? input.mapping.units;
    const participantLabel = entityKey(row, participantColumns);
    const group = input.mapping.trajectory ? typedValue(row[input.mapping.trajectory.group] ?? null) : undefined;
    const time = input.mapping.trajectory ? typedValue(row[input.mapping.trajectory.time] ?? null) : undefined;
    if (group) observedGroups.add(group.canonical);
    if (time) observedTimes.add(time.canonical);
    const metadata = Object.fromEntries((input.mapping.metadata ?? []).map((column) => [column, row[column] ?? null])) as Record<string, RawScalar>;

    const previousUnit = unitContexts.get(unit.canonical);
    if (previousUnit) {
      for (const [column, value] of Object.entries(metadata)) {
        if (!stableRowValue(previousUnit.metadata[column] ?? null, value)) {
          throw new AnalysisValidationError([issue("UNSTABLE_UNIT_METADATA", `rows[${rowIndex}].${column}`, "metadata declared as unit-level must be constant within the complete typed unit")]);
        }
      }
    } else {
      unitContexts.set(unit.canonical, {
        unit,
        participantLabel,
        ...(group ? { group } : {}),
        metadata
      });
    }
    const previousConversation = conversationContexts.get(step.canonical);
    if (previousConversation?.time && time && previousConversation.time.canonical !== time.canonical) {
      throw new AnalysisValidationError([issue("AMBIGUOUS_CONVERSATION_TIME", `rows[${rowIndex}]`, "the same typed conversation tuple maps to multiple periods")]);
    }
    if (!previousConversation) conversationContexts.set(step.canonical, { step, ...(time ? { time } : {}) });

    normalizedRows.push({
      [INTERNAL_UNIT_COLUMN]: unit.canonical,
      [INTERNAL_CONVERSATION_COLUMN]: step.canonical,
      ...Object.fromEntries(input.mapping.codes.map((column) => [column, normalizeCode(row[column] ?? null, `rows[${rowIndex}].${column}`)]))
    });
  });

  const inputColumns = [...inputColumnSet].sort();
  if (inputColumns.length > limits.maxColumns) throw new AnalysisValidationError([issue("COLUMN_LIMIT_EXCEEDED", "rows", `${inputColumns.length} exceeds maxColumns=${limits.maxColumns}`)]);
  const cells = input.rows.length * inputColumns.length;
  if (!Number.isSafeInteger(cells) || cells > limits.maxCells) throw new AnalysisValidationError([issue("CELL_LIMIT_EXCEEDED", "rows", `${cells} exceeds maxCells=${limits.maxCells}`)]);
  if (unitContexts.size > limits.maxUnits) throw new AnalysisValidationError([issue("UNIT_LIMIT_EXCEEDED", "rows", `${unitContexts.size} exceeds maxUnits=${limits.maxUnits}`)]);
  if (predictedPointKeys.size > limits.maxOutputPoints) throw new AnalysisValidationError([issue("OUTPUT_POINT_LIMIT_EXCEEDED", "rows", `${predictedPointKeys.size} implied model points exceeds maxOutputPoints=${limits.maxOutputPoints}`)]);
  if (observedGroups.size > limits.maxGroups) throw new AnalysisValidationError([issue("GROUP_LIMIT_EXCEEDED", "rows", `${observedGroups.size} exceeds maxGroups=${limits.maxGroups}`)]);
  if (observedTimes.size > limits.maxTimePoints) throw new AnalysisValidationError([issue("TIME_LIMIT_EXCEEDED", "rows", `${observedTimes.size} exceeds maxTimePoints=${limits.maxTimePoints}`)]);
  if (input.mapping.trajectory?.timeOrder) {
    const expected = new Set(input.mapping.trajectory.timeOrder.map((value) => canonicalScalars([value])));
    const missingFromOrder = [...observedTimes].filter((key) => !expected.has(key));
    if (missingFromOrder.length > 0) throw new AnalysisValidationError([issue("TIME_ORDER_INCOMPLETE", "mapping.trajectory.timeOrder", "must include every observed typed period value")]);
    if (input.mapping.trajectory.timeOrder.length > limits.maxTimePoints) throw new AnalysisValidationError([issue("TIME_LIMIT_EXCEEDED", "mapping.trajectory.timeOrder", `length exceeds maxTimePoints=${limits.maxTimePoints}`)]);
  }

  const diagnostics: AnalysisDiagnostic[] = [];
  if (config.window === "Conversation" && (input.config?.windowSizeBack !== undefined || input.config?.windowSizeForward !== undefined)) {
    diagnostics.push({
      code: "CONVERSATION_WINDOW_IGNORES_STANZA_SIZE",
      severity: "info",
      message: "Conversation windows use the complete conversation; stanza back/forward sizes do not alter accumulation.",
      path: "config.window"
    });
  }

  return {
    rows: normalizedRows,
    mapping: input.mapping,
    config,
    limits,
    inputColumns,
    unitContexts,
    conversationContexts,
    diagnostics
  };
}
