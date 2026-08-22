import { type AnalysisConfig, type AnalysisDiagnostic, type AnalysisResourceLimits, type AnalyzeRowsInput, type EntityKey, type RawRow, type RawRowMapping, type RawScalar, type TypedValue } from "./types.js";
export declare const INTERNAL_UNIT_COLUMN = "__3dena_unit_key_v1";
export declare const INTERNAL_CONVERSATION_COLUMN = "__3dena_conversation_key_v1";
export declare const INTERNAL_SOURCE_ROW_OCCURRENCE_COLUMN = "@3dena/source-row-occurrence";
export declare const DEFAULT_ANALYSIS_LIMITS: AnalysisResourceLimits;
export declare const HARD_ANALYSIS_LIMITS: AnalysisResourceLimits;
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
    /** Adapter-owned scalar rows; no jENA object type crosses this boundary. */
    rows: RawRow[];
    mapping: RawRowMapping;
    config: Required<AnalysisConfig>;
    limits: AnalysisResourceLimits;
    inputColumns: string[];
    unitContexts: Map<string, UnitContext>;
    conversationContexts: Map<string, ConversationContext>;
    diagnostics: AnalysisDiagnostic[];
}
export declare function canonicalScalars(values: RawScalar[]): string;
export declare function displayScalar(value: RawScalar): string;
export declare function typedValue(value: RawScalar): TypedValue;
export declare function entityKey(row: RawRow, columns: string[]): EntityKey;
export declare function prepareAnalysisInput(input: AnalyzeRowsInput): PreparedAnalysisInput;
//# sourceMappingURL=validation.d.ts.map