import type { AnalysisDiagnostic, AnalyzeRowsInput, CohortPolicy, ENAModel, ENAWeight, ENAWindow, RawScalar } from "./types.js";
import type { TrajectoryTimeValueV1 } from "../../trajectory/src/index.js";
import type { PreparedSpaceMapping } from "./prepared-types.js";
export declare const ANALYSIS_CONTRACT_VERSION_V1: "3dena.contract.v1";
export declare const DATASET_RECEIPT_VERSION_V1: "3dena.dataset-receipt.v1";
export declare const ANALYSIS_TASK_VERSION_V1: "3dena.analysis-task.v1";
export declare const RESULT_ENVELOPE_VERSION_V1: "3dena.analysis-result-envelope.v1";
export declare const PROVENANCE_MANIFEST_VERSION_V1: "3dena.provenance-manifest.v1";
export declare const RESULT_SCHEMA_VERSION_BY_TASK_KIND_V1: Readonly<{
    readonly "ena-model": "3dena.analysis-result.v1";
    readonly "prepared-import": "3dena.prepared-space-result.v1";
    readonly "network-comparison": "3dena.network-comparison.v1";
    readonly "change-network": "3dena.change-network.v1";
    readonly statistics: "3dena.statistics-task-result.v1";
    readonly trajectory: "3dena.trajectory-dynamics.v1";
    readonly "trajectory-comparison": "3dena.trajectory-comparison.v1";
    readonly bootstrap: "3dena.trajectory-bootstrap.v1";
}>;
export type DurationUnitV1 = "nanoseconds" | "microseconds" | "milliseconds" | "seconds" | "minutes" | "hours" | "days";
/** JSON-safe scalar representation for scientific identities and metadata. */
export type TypedScalarV1 = {
    type: "null";
} | {
    type: "string";
    value: string;
} | {
    type: "boolean";
    value: boolean;
} | {
    type: "int64";
    value: string;
} | {
    type: "double";
    ieee754Hex: string;
} | {
    type: "date";
    value: string;
} | {
    type: "instant";
    epochMilliseconds: string;
    timeZone: string;
    offsetMinutes: number;
    fold: 0 | 1;
} | {
    type: "duration";
    value: string;
    unit: DurationUnitV1;
} | {
    type: "factor";
    value: string;
    levels: string[];
    ordered: boolean;
};
export interface TypedKeyComponentV1 {
    name: string;
    value: TypedScalarV1;
}
export interface TypedKeyV1 {
    schemaVersion: "3dena.typed-key.v1";
    components: TypedKeyComponentV1[];
    /** Canonical JSON over normalized tagged values; never a display-label join. */
    canonical: string;
}
export type DatasetColumnTypeV1 = "string" | "number" | "boolean" | "mixed" | "null";
export type DatasetColumnRoleV1 = "unit" | "conversation" | "time" | "code" | "group" | "metadata" | "unmapped";
export interface DatasetColumnSchemaV1 {
    name: string;
    inferredType: DatasetColumnTypeV1;
    /** A column can have multiple scientific roles; `unmapped` must stand alone. */
    roles: DatasetColumnRoleV1[];
}
export interface DatasetSchemaV1 {
    schemaVersion: "3dena.dataset-schema.v1";
    headers: string[];
    columns: DatasetColumnSchemaV1[];
}
export interface DatasetLimitsReceiptV1 {
    schemaVersion: "3dena.dataset-limits.v1";
    maxFileBytes: number;
    maxWorksheets: number;
    maxRows: number;
    maxColumns: number;
    maxCells: number;
}
export interface DatasetReceiptV1 {
    schemaVersion: typeof DATASET_RECEIPT_VERSION_V1;
    sha256: string;
    byteLength: number;
    format: "csv" | "xlsx" | "xls" | "ena3d-json";
    sheet: {
        index: number;
        name: string;
    } | null;
    rows: number;
    columns: number;
    schema: DatasetSchemaV1;
    limits: DatasetLimitsReceiptV1;
    warnings: string[];
    activationIdentity: string;
}
export interface TaskOwnerV1 {
    contractVersion: typeof ANALYSIS_CONTRACT_VERSION_V1;
    datasetHash: string;
    specHash: string;
    runId: string;
    taskId: string;
}
export interface AnalysisSpecV1 {
    schemaVersion: "3dena.analysis-spec.v1";
    model: ENAModel;
    window: ENAWindow;
    weightBy: ENAWeight;
    windowSizeBack: number;
    windowSizeForward: number;
    centerAlignToOrigin: boolean;
    cohortPolicy: CohortPolicy;
}
export interface DisplaySpecV1 {
    schemaVersion: "3dena.display-spec.v1";
    dimensions: [string, string, string];
    plotDimension: 2 | 3;
    groups?: string[];
    showGrid: boolean;
    showZeroLines: boolean;
    showAxes: boolean;
    traces: {
        points: boolean;
        nodes: boolean;
        network: boolean;
        /** Legacy saved-display field; accepted on read but ignored because V1 has no ordinary group-mean artifact. */
        centroids: boolean;
        /** Legacy saved-display field; accepted on read but ignored by the generic ENA presenter. */
        trajectory: boolean;
        uncertainty: boolean;
    };
    style: {
        pointSize: number;
        pointOpacity: number;
        nodeSize: number;
        nodeOpacity: number;
        edgeThreshold: number;
        edgeWidthScale: number;
        /** Legacy required V1 readback-only field; compilePlotlySpec treats it as a no-op. */
        trajectoryWidth: number;
    };
    camera: {
        eye: {
            x: number;
            y: number;
            z: number;
        };
        center: {
            x: number;
            y: number;
            z: number;
        };
        up: {
            x: number;
            y: number;
            z: number;
        };
    } | null;
}
interface AnalysisTaskBaseV1 {
    schemaVersion: typeof ANALYSIS_TASK_VERSION_V1;
    owner: TaskOwnerV1;
    deadlineEpochMilliseconds: number;
}
export interface EnaModelTaskV1 extends AnalysisTaskBaseV1 {
    kind: "ena-model";
    input: AnalyzeRowsInput;
}
/**
 * Internal exact-byte prepared-exchange import. The browser-facing HTTP
 * contract never carries `exactBytesBase64`; the service injects bytes read
 * back from its immutable upload object only after matching the receipt hash.
 */
export interface PreparedImportTaskV1 extends AnalysisTaskBaseV1 {
    kind: "prepared-import";
    input: {
        sourceName: "uploaded.ena3d.json";
        exactBytesBase64: string;
        mapping: PreparedSpaceMapping;
    };
}
export interface NetworkComparisonTaskV1 extends AnalysisTaskBaseV1 {
    kind: "network-comparison";
    sourceResultHash: string;
    groups: [string, string];
}
export interface ChangeNetworkTaskV1 extends AnalysisTaskBaseV1 {
    kind: "change-network";
    sourceResultHash: string;
    field: string;
    level: RawScalar;
}
export interface StatisticsTaskV1 extends AnalysisTaskBaseV1 {
    kind: "statistics";
    sourceResultHash: string;
    design: "independent" | "paired";
    groups: [string, string];
    dimensions: string[];
    alternative: "two-sided" | "greater" | "less";
    adjustment: "none" | "holm" | "bh" | "bonferroni";
    /** Required true for paired work; independent work must set false. */
    samePhysicalEntityConfirmed: boolean;
}
export interface TrajectoryTaskV1 extends AnalysisTaskBaseV1 {
    kind: "trajectory";
    sourceResultHash: string;
    group: string;
    selectedDimensions: [string, string, string];
    cohortPolicy: CohortPolicy;
    /** Exact order and identity binding for every source trajectory period. */
    periods: Array<{
        sourceTimeCanonical: string;
        value: TrajectoryTimeValueV1;
    }>;
    estimand: {
        kind: "equal-participant-v1";
    } | {
        kind: "weighted-participant-v1";
        metadataField: string;
    };
}
export interface TrajectoryComparisonTaskV1 extends AnalysisTaskBaseV1 {
    kind: "trajectory-comparison";
    sourceResultHash: string;
    design: "independent" | "paired";
    groups: [string, string];
    samePhysicalEntityConfirmed: boolean;
}
export interface BootstrapTaskV1 extends AnalysisTaskBaseV1 {
    kind: "bootstrap";
    sourceResultHash: string;
    group: string;
    replicates: number;
    confidenceLevel: number;
    seed: number;
    interval: "pointwise-percentile-type7";
    rotationPolicy: "fixed-preprojected";
}
export type AnalysisTaskV1 = EnaModelTaskV1 | PreparedImportTaskV1 | NetworkComparisonTaskV1 | ChangeNetworkTaskV1 | StatisticsTaskV1 | TrajectoryTaskV1 | TrajectoryComparisonTaskV1 | BootstrapTaskV1;
export type EvidenceStatusV1 = "IMPLEMENTED_UNVERIFIED" | "PARITY_CANDIDATE" | "VERIFIED_PARITY" | "PRODUCTION_CANDIDATE" | "PRODUCTION_READY" | "PRECOMPUTED_COMPATIBILITY_CANDIDATE";
export interface EvidenceStampV1 {
    schemaVersion: "3dena.evidence-stamp.v1";
    scope: "fixture" | "feature" | "build" | "deployment";
    status: EvidenceStatusV1;
    datasetHash?: string;
    specHash?: string;
    fixtureId?: string;
    buildId?: string;
    approvedForParity: boolean;
}
export interface ProvenanceManifestV1 {
    schemaVersion: typeof PROVENANCE_MANIFEST_VERSION_V1;
    datasetHash: string;
    specHash: string;
    resultHash: string;
    adapterVersion: string;
    jenaPackage: "jena-js";
    jenaVersion: string;
    jenaCommit: string;
    sourceKind: "raw-jena" | "prepared-exchange";
    jenaExecuted: boolean;
    sdkPackage: "@3dena/analysis";
    sdkVersion: string;
    appVersion: string;
    contractVersion: typeof ANALYSIS_CONTRACT_VERSION_V1;
    buildId: string;
    seed: number | null;
    toleranceContract: string | null;
    schemaVersions: string[];
    generatedAt: string;
}
export interface AnalysisResultEnvelopeV1<Result = unknown> {
    schemaVersion: typeof RESULT_ENVELOPE_VERSION_V1;
    owner: TaskOwnerV1;
    taskKind: AnalysisTaskV1["kind"];
    result: Result;
    diagnostics: AnalysisDiagnostic[];
    evidence: EvidenceStampV1;
    provenance: ProvenanceManifestV1;
}
/** Encodes the exact IEEE-754 bit pattern, preserving -0 and adjacent doubles. */
export declare function typedDoubleV1(value: number): TypedScalarV1;
export declare function assertTypedScalarV1(value: unknown, path?: string): asserts value is TypedScalarV1;
export declare function createTypedKeyV1(components: readonly TypedKeyComponentV1[]): TypedKeyV1;
export declare function assertTypedKeyV1(value: unknown, path?: string): asserts value is TypedKeyV1;
export declare function assertTaskOwnerV1(value: unknown, path?: string): asserts value is TaskOwnerV1;
export declare function assertDatasetReceiptV1(value: unknown, path?: string): asserts value is DatasetReceiptV1;
export declare function assertAnalysisSpecV1(value: unknown, path?: string): asserts value is AnalysisSpecV1;
/** Strict runtime validator shared by SDK, remote client, service, and Worker. */
export declare function assertAnalysisTaskV1(value: unknown, path?: string): asserts value is AnalysisTaskV1;
export declare function assertDisplaySpecV1(value: unknown, path?: string): asserts value is DisplaySpecV1;
export declare function assertEvidenceStampV1(value: unknown, path?: string): asserts value is EvidenceStampV1;
export declare function assertAnalysisResultEnvelopeV1(value: unknown, path?: string): asserts value is AnalysisResultEnvelopeV1;
/** Strict per-field validator for all seven public result variants. */
export declare function assertAnalysisTaskResultV1(value: unknown, taskKind: AnalysisTaskV1["kind"], path?: string): asserts value is {
    schemaVersion: string;
};
export declare function assertProvenanceManifestV1(value: unknown, path?: string): asserts value is ProvenanceManifestV1;
export declare const CONTRACT_SCHEMAS_V1: Readonly<{
    typedScalar: Readonly<{
        $id: "https://3dena.com/schemas/typed-scalar.v1.json";
        oneOf: ({
            type: string;
            additionalProperties: boolean;
            required: string[];
            properties: {
                type: {
                    const: string;
                };
                value?: never;
                ieee754Hex?: never;
                epochMilliseconds?: never;
                timeZone?: never;
                offsetMinutes?: never;
                fold?: never;
                unit?: never;
                levels?: never;
                ordered?: never;
            };
        } | {
            type: string;
            additionalProperties: boolean;
            required: string[];
            properties: {
                type: {
                    const: string;
                };
                value: {
                    type: string;
                    pattern?: never;
                };
                ieee754Hex?: never;
                epochMilliseconds?: never;
                timeZone?: never;
                offsetMinutes?: never;
                fold?: never;
                unit?: never;
                levels?: never;
                ordered?: never;
            };
        } | {
            type: string;
            additionalProperties: boolean;
            required: string[];
            properties: {
                type: {
                    const: string;
                };
                value: {
                    type: string;
                    pattern: string;
                };
                ieee754Hex?: never;
                epochMilliseconds?: never;
                timeZone?: never;
                offsetMinutes?: never;
                fold?: never;
                unit?: never;
                levels?: never;
                ordered?: never;
            };
        } | {
            type: string;
            additionalProperties: boolean;
            required: string[];
            properties: {
                type: {
                    const: string;
                };
                ieee754Hex: {
                    type: string;
                    pattern: string;
                };
                value?: never;
                epochMilliseconds?: never;
                timeZone?: never;
                offsetMinutes?: never;
                fold?: never;
                unit?: never;
                levels?: never;
                ordered?: never;
            };
        } | {
            type: string;
            additionalProperties: boolean;
            required: string[];
            properties: {
                type: {
                    const: string;
                };
                epochMilliseconds: {
                    type: string;
                    pattern: string;
                };
                timeZone: {
                    readonly type: "string";
                    readonly minLength: 1;
                };
                offsetMinutes: {
                    type: string;
                    minimum: number;
                    maximum: number;
                };
                fold: {
                    enum: number[];
                };
                value?: never;
                ieee754Hex?: never;
                unit?: never;
                levels?: never;
                ordered?: never;
            };
        } | {
            type: string;
            additionalProperties: boolean;
            required: string[];
            properties: {
                type: {
                    const: string;
                };
                value: {
                    type: string;
                    pattern: string;
                };
                unit: {
                    enum: DurationUnitV1[];
                };
                ieee754Hex?: never;
                epochMilliseconds?: never;
                timeZone?: never;
                offsetMinutes?: never;
                fold?: never;
                levels?: never;
                ordered?: never;
            };
        } | {
            type: string;
            additionalProperties: boolean;
            required: string[];
            properties: {
                type: {
                    const: string;
                };
                value: {
                    type: string;
                    pattern?: never;
                };
                levels: {
                    type: string;
                    uniqueItems: boolean;
                    items: {
                        type: string;
                    };
                };
                ordered: {
                    type: string;
                };
                ieee754Hex?: never;
                epochMilliseconds?: never;
                timeZone?: never;
                offsetMinutes?: never;
                fold?: never;
                unit?: never;
            };
        })[];
    }>;
    typedKey: Readonly<{
        $id: "https://3dena.com/schemas/typed-key.v1.json";
        type: "object";
        additionalProperties: false;
        required: string[];
        properties: {
            schemaVersion: {
                const: string;
            };
            components: {
                type: string;
                minItems: number;
                items: {
                    type: string;
                    additionalProperties: boolean;
                    required: string[];
                    properties: {
                        name: {
                            readonly type: "string";
                            readonly minLength: 1;
                        };
                        value: {
                            $ref: string;
                        };
                    };
                };
            };
            canonical: {
                readonly type: "string";
                readonly minLength: 1;
            };
        };
    }>;
    taskOwner: Readonly<{
        $id: "https://3dena.com/schemas/task-owner.v1.json";
        type: "object";
        additionalProperties: false;
        required: string[];
        properties: {
            contractVersion: {
                const: "3dena.contract.v1";
            };
            datasetHash: {
                readonly type: "string";
                readonly pattern: "^[a-f0-9]{64}$";
            };
            specHash: {
                readonly type: "string";
                readonly pattern: "^[a-f0-9]{64}$";
            };
            runId: {
                readonly type: "string";
                readonly minLength: 1;
            };
            taskId: {
                readonly type: "string";
                readonly minLength: 1;
            };
        };
    }>;
    datasetReceipt: Readonly<{
        $id: "https://3dena.com/schemas/dataset-receipt.v1.json";
        type: "object";
        additionalProperties: false;
        required: string[];
        properties: {
            schemaVersion: {
                const: "3dena.dataset-receipt.v1";
            };
            sha256: {
                readonly type: "string";
                readonly pattern: "^[a-f0-9]{64}$";
            };
            byteLength: {
                readonly type: "integer";
                readonly minimum: 1;
                readonly maximum: number;
            };
            format: {
                enum: string[];
            };
            sheet: {
                oneOf: ({
                    type: string;
                    additionalProperties?: never;
                    required?: never;
                    properties?: never;
                } | {
                    type: string;
                    additionalProperties: boolean;
                    required: string[];
                    properties: {
                        index: {
                            readonly type: "integer";
                            readonly minimum: 0;
                            readonly maximum: number;
                        };
                        name: {
                            readonly type: "string";
                            readonly minLength: 1;
                        };
                    };
                })[];
            };
            rows: {
                readonly type: "integer";
                readonly minimum: 1;
                readonly maximum: number;
            };
            columns: {
                readonly type: "integer";
                readonly minimum: 1;
                readonly maximum: number;
            };
            schema: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    schemaVersion: {
                        const: string;
                    };
                    headers: {
                        type: string;
                        minItems: number;
                        uniqueItems: boolean;
                        items: {
                            readonly type: "string";
                            readonly minLength: 1;
                        };
                    };
                    columns: {
                        type: string;
                        minItems: number;
                        items: {
                            type: string;
                            additionalProperties: boolean;
                            required: string[];
                            properties: {
                                name: {
                                    readonly type: "string";
                                    readonly minLength: 1;
                                };
                                inferredType: {
                                    enum: string[];
                                };
                                roles: {
                                    type: string;
                                    minItems: number;
                                    uniqueItems: boolean;
                                    items: {
                                        enum: string[];
                                    };
                                };
                            };
                        };
                    };
                };
            };
            limits: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    schemaVersion: {
                        const: string;
                    };
                    maxFileBytes: {
                        readonly type: "integer";
                        readonly minimum: 1;
                        readonly maximum: number;
                    };
                    maxWorksheets: {
                        readonly type: "integer";
                        readonly minimum: 1;
                        readonly maximum: number;
                    };
                    maxRows: {
                        readonly type: "integer";
                        readonly minimum: 1;
                        readonly maximum: number;
                    };
                    maxColumns: {
                        readonly type: "integer";
                        readonly minimum: 1;
                        readonly maximum: number;
                    };
                    maxCells: {
                        readonly type: "integer";
                        readonly minimum: 1;
                        readonly maximum: number;
                    };
                };
            };
            warnings: {
                type: string;
                uniqueItems: boolean;
                items: {
                    type: string;
                };
            };
            activationIdentity: {
                readonly type: "string";
                readonly minLength: 1;
            };
        };
    }>;
    analysisExecutionDatasetV2: Readonly<{
        [x: string]: unknown;
    }>;
    trajectoryRunSpecV2: Readonly<{
        readonly $id: "https://3dena.com/schemas/trajectory-run-spec.v2.json";
        readonly type: "object";
        readonly additionalProperties: false;
        readonly required: readonly ["schemaVersion", "sourceResultHash", "participantColumns", "timeColumn", "groupColumn", "orderedPeriods", "selectedDimensions", "cohortPolicy", "missingValuePolicy", "estimand"];
        readonly properties: {
            readonly schemaVersion: {
                readonly const: "3dena.trajectory-run-spec.v2";
            };
            readonly sourceResultHash: {
                readonly type: "string";
                readonly pattern: "^[a-f0-9]{64}$";
            };
            readonly participantColumns: {
                readonly type: "array";
                readonly minItems: 1;
                readonly uniqueItems: true;
                readonly items: {
                    readonly type: "string";
                    readonly minLength: 1;
                };
            };
            readonly timeColumn: {
                readonly type: "string";
                readonly minLength: 1;
            };
            readonly groupColumn: {
                readonly oneOf: readonly [{
                    readonly type: "null";
                }, {
                    readonly type: "string";
                    readonly minLength: 1;
                }];
            };
            readonly orderedPeriods: {
                readonly type: "array";
                readonly minItems: 1;
                readonly items: {
                    readonly type: "object";
                    readonly additionalProperties: false;
                    readonly required: readonly ["identity", "sourceTimeCanonical", "displayLabel", "expected", "value"];
                    readonly properties: {
                        readonly identity: {
                            readonly type: "object";
                            readonly additionalProperties: false;
                            readonly required: readonly ["components"];
                            readonly properties: {
                                readonly components: {
                                    readonly type: "array";
                                    readonly minItems: 1;
                                    readonly items: {
                                        readonly oneOf: readonly [{
                                            readonly type: "object";
                                            readonly additionalProperties: false;
                                            readonly required: readonly ["name", "type", "value"];
                                            readonly properties: {
                                                readonly name: {
                                                    readonly type: "string";
                                                    readonly minLength: 1;
                                                };
                                                readonly type: {
                                                    readonly const: "string";
                                                };
                                                readonly value: {
                                                    readonly type: "string";
                                                };
                                                readonly declaredType: {
                                                    readonly type: "string";
                                                    readonly minLength: 1;
                                                };
                                            };
                                        }, {
                                            readonly type: "object";
                                            readonly additionalProperties: false;
                                            readonly required: readonly ["name", "type", "value"];
                                            readonly properties: {
                                                readonly name: {
                                                    readonly type: "string";
                                                    readonly minLength: 1;
                                                };
                                                readonly type: {
                                                    readonly const: "number";
                                                };
                                                readonly value: {
                                                    readonly type: "number";
                                                };
                                                readonly declaredType: {
                                                    readonly type: "string";
                                                    readonly minLength: 1;
                                                };
                                            };
                                        }, {
                                            readonly type: "object";
                                            readonly additionalProperties: false;
                                            readonly required: readonly ["name", "type", "value"];
                                            readonly properties: {
                                                readonly name: {
                                                    readonly type: "string";
                                                    readonly minLength: 1;
                                                };
                                                readonly type: {
                                                    readonly const: "boolean";
                                                };
                                                readonly value: {
                                                    readonly type: "boolean";
                                                };
                                                readonly declaredType: {
                                                    readonly type: "string";
                                                    readonly minLength: 1;
                                                };
                                            };
                                        }];
                                    };
                                };
                            };
                        };
                        readonly sourceTimeCanonical: {
                            readonly type: "string";
                            readonly minLength: 1;
                        };
                        readonly displayLabel: {
                            readonly type: "string";
                            readonly minLength: 1;
                        };
                        readonly expected: {
                            readonly type: "boolean";
                        };
                        readonly value: {
                            readonly oneOf: readonly [{
                                readonly type: "object";
                                readonly additionalProperties: false;
                                readonly required: readonly ["type", "index"];
                                readonly properties: {
                                    readonly type: {
                                        readonly const: "ordered-index-v2";
                                    };
                                    readonly index: {
                                        readonly type: "integer";
                                        readonly minimum: 0;
                                        readonly maximum: number;
                                    };
                                };
                            }, {
                                readonly type: "object";
                                readonly additionalProperties: false;
                                readonly required: readonly ["type", "value", "unit"];
                                readonly properties: {
                                    readonly type: {
                                        readonly const: "numeric-v1";
                                    };
                                    readonly value: {
                                        readonly type: "number";
                                    };
                                    readonly unit: {
                                        readonly type: "string";
                                        readonly minLength: 1;
                                    };
                                };
                            }, {
                                readonly type: "object";
                                readonly additionalProperties: false;
                                readonly required: readonly ["type", "value"];
                                readonly properties: {
                                    readonly type: {
                                        readonly const: "date-v1";
                                    };
                                    readonly value: {
                                        readonly type: "string";
                                        readonly pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$";
                                    };
                                };
                            }, {
                                readonly type: "object";
                                readonly additionalProperties: false;
                                readonly required: readonly ["type", "epochMilliseconds", "timeZone", "offsetMinutes", "fold", "elapsedUnit"];
                                readonly properties: {
                                    readonly type: {
                                        readonly const: "instant-v1";
                                    };
                                    readonly epochMilliseconds: {
                                        readonly type: "string";
                                        readonly pattern: "^-?(?:0|[1-9][0-9]*)$";
                                    };
                                    readonly timeZone: {
                                        readonly type: "string";
                                        readonly minLength: 1;
                                    };
                                    readonly offsetMinutes: {
                                        readonly type: "integer";
                                        readonly minimum: -1440;
                                        readonly maximum: 1440;
                                    };
                                    readonly fold: {
                                        readonly enum: readonly [0, 1];
                                    };
                                    readonly elapsedUnit: {
                                        readonly enum: readonly string[];
                                    };
                                };
                            }, {
                                readonly type: "object";
                                readonly additionalProperties: false;
                                readonly required: readonly ["type", "value", "unit", "elapsedUnit"];
                                readonly properties: {
                                    readonly type: {
                                        readonly const: "difftime-v1";
                                    };
                                    readonly value: {
                                        readonly type: "number";
                                    };
                                    readonly unit: {
                                        readonly enum: readonly string[];
                                    };
                                    readonly elapsedUnit: {
                                        readonly enum: readonly string[];
                                    };
                                };
                            }];
                        };
                    };
                };
            };
            readonly selectedDimensions: {
                readonly type: "array";
                readonly minItems: 3;
                readonly maxItems: 3;
                readonly uniqueItems: true;
                readonly items: {
                    readonly type: "string";
                    readonly minLength: 1;
                };
            };
            readonly cohortPolicy: {
                readonly enum: readonly ["available", "complete"];
            };
            readonly missingValuePolicy: {
                readonly const: "complete-analytical-rows";
            };
            readonly estimand: {
                readonly oneOf: readonly [{
                    readonly type: "object";
                    readonly additionalProperties: false;
                    readonly required: readonly ["kind"];
                    readonly properties: {
                        readonly kind: {
                            readonly const: "equal-participant";
                        };
                    };
                }, {
                    readonly type: "object";
                    readonly additionalProperties: false;
                    readonly required: readonly ["kind", "metadataField"];
                    readonly properties: {
                        readonly kind: {
                            readonly const: "weighted-participant";
                        };
                        readonly metadataField: {
                            readonly type: "string";
                            readonly minLength: 1;
                        };
                    };
                }];
            };
        };
    }>;
    trajectoryPathTaskV2: Readonly<{
        $id: "https://3dena.com/schemas/trajectory-path-task.v2.json";
        type: "object";
        additionalProperties: false;
        required: string[];
        properties: {
            schemaVersion: {
                const: string;
            };
            kind: {
                const: string;
            };
            datasetHash: {
                readonly type: "string";
                readonly pattern: "^[a-f0-9]{64}$";
            };
            specHash: {
                readonly type: "string";
                readonly pattern: "^[a-f0-9]{64}$";
            };
            runId: {
                readonly type: "string";
                readonly minLength: 1;
            };
            runSpec: {
                $ref: string;
            };
        };
    }>;
    trajectoryInferenceTaskV2: Readonly<{
        $id: "https://3dena.com/schemas/trajectory-inference-task.v2.json";
        type: "object";
        additionalProperties: false;
        required: string[];
        properties: {
            adjustment: {
                const: string;
            };
            requests: {
                type: string;
                minItems: number;
                items: {
                    oneOf: ({
                        type: string;
                        additionalProperties: boolean;
                        required: string[];
                        properties: {
                            kind: {
                                const: string;
                            };
                            groups: {
                                type: string;
                                minItems: number;
                                maxItems: number;
                                uniqueItems: boolean;
                                items: {
                                    readonly type: "string";
                                    readonly minLength: 1;
                                };
                            };
                            periodCanonical: {
                                readonly type: "string";
                                readonly minLength: 1;
                            };
                            group?: never;
                            earlierPeriodCanonical?: never;
                            laterPeriodCanonical?: never;
                            samePhysicalEntityConfirmed?: never;
                            periodCanonicals?: never;
                            design?: never;
                            repetitions?: never;
                            seed?: never;
                        };
                    } | {
                        type: string;
                        additionalProperties: boolean;
                        required: string[];
                        properties: {
                            kind: {
                                const: string;
                            };
                            group: {
                                oneOf: ({
                                    readonly type: "string";
                                    readonly minLength: 1;
                                } | {
                                    type: string;
                                })[];
                            };
                            earlierPeriodCanonical: {
                                readonly type: "string";
                                readonly minLength: 1;
                            };
                            laterPeriodCanonical: {
                                readonly type: "string";
                                readonly minLength: 1;
                            };
                            samePhysicalEntityConfirmed: {
                                type: string;
                            };
                            groups?: never;
                            periodCanonical?: never;
                            periodCanonicals?: never;
                            design?: never;
                            repetitions?: never;
                            seed?: never;
                        };
                    } | {
                        type: string;
                        additionalProperties: boolean;
                        required: string[];
                        properties: {
                            kind: {
                                const: string;
                            };
                            group: {
                                oneOf: ({
                                    readonly type: "string";
                                    readonly minLength: 1;
                                } | {
                                    type: string;
                                })[];
                            };
                            periodCanonicals: {
                                type: string;
                                minItems: number;
                                uniqueItems: boolean;
                                items: {
                                    readonly type: "string";
                                    readonly minLength: 1;
                                };
                            };
                            samePhysicalEntityConfirmed: {
                                type: string;
                            };
                            groups?: never;
                            periodCanonical?: never;
                            earlierPeriodCanonical?: never;
                            laterPeriodCanonical?: never;
                            design?: never;
                            repetitions?: never;
                            seed?: never;
                        };
                    } | {
                        type: string;
                        additionalProperties: boolean;
                        required: string[];
                        properties: {
                            kind: {
                                const: string;
                            };
                            design: {
                                enum: string[];
                            };
                            groups: {
                                type: string;
                                minItems: number;
                                maxItems: number;
                                uniqueItems: boolean;
                                items: {
                                    readonly type: "string";
                                    readonly minLength: 1;
                                };
                            };
                            repetitions: {
                                type: string;
                                minimum: number;
                                maximum: number;
                            };
                            seed: {
                                type: string;
                                minimum: number;
                                maximum: number;
                            };
                            samePhysicalEntityConfirmed: {
                                type: string;
                            };
                            periodCanonical?: never;
                            group?: never;
                            earlierPeriodCanonical?: never;
                            laterPeriodCanonical?: never;
                            periodCanonicals?: never;
                        };
                    })[];
                };
            };
            datasetHash: {
                readonly type: "string";
                readonly pattern: "^[a-f0-9]{64}$";
            };
            specHash: {
                readonly type: "string";
                readonly pattern: "^[a-f0-9]{64}$";
            };
            sourceResultHash: {
                readonly type: "string";
                readonly pattern: "^[a-f0-9]{64}$";
            };
            runId: {
                readonly type: "string";
                readonly minLength: 1;
            };
            schemaVersion: {
                const: string;
            };
            kind: {
                const: string;
            };
        };
    }>;
    trajectoryBootstrapTaskV2: Readonly<{
        $id: "https://3dena.com/schemas/trajectory-bootstrap-task.v2.json";
        type: "object";
        additionalProperties: false;
        required: string[];
        properties: {
            repetitions: {
                type: string;
                minimum: number;
                maximum: number;
            };
            confidenceLevel: {
                type: string;
                exclusiveMinimum: number;
                exclusiveMaximum: number;
            };
            seed: {
                type: string;
                minimum: number;
                maximum: number;
            };
            resamplingDesign: {
                enum: string[];
            };
            explicitStrataField: {
                oneOf: ({
                    readonly type: "string";
                    readonly minLength: 1;
                } | {
                    type: string;
                })[];
            };
            interval: {
                const: string;
            };
            rotationPolicy: {
                const: string;
            };
            datasetHash: {
                readonly type: "string";
                readonly pattern: "^[a-f0-9]{64}$";
            };
            specHash: {
                readonly type: "string";
                readonly pattern: "^[a-f0-9]{64}$";
            };
            sourceResultHash: {
                readonly type: "string";
                readonly pattern: "^[a-f0-9]{64}$";
            };
            runId: {
                readonly type: "string";
                readonly minLength: 1;
            };
            schemaVersion: {
                const: string;
            };
            kind: {
                const: string;
            };
        };
        allOf: {
            if: {
                properties: {
                    resamplingDesign: {
                        const: string;
                    };
                };
            };
            then: {
                properties: {
                    explicitStrataField: {
                        readonly type: "string";
                        readonly minLength: 1;
                    };
                };
            };
            else: {
                properties: {
                    explicitStrataField: {
                        type: string;
                    };
                };
            };
        }[];
    }>;
    trajectoryNetworkOverlayTaskV2: Readonly<{
        $id: "https://3dena.com/schemas/trajectory-network-overlay-task.v2.json";
        type: "object";
        additionalProperties: false;
        required: string[];
        properties: {
            requests: {
                type: string;
                minItems: number;
                items: {
                    type: string;
                    additionalProperties: boolean;
                    required: string[];
                    properties: {
                        periodCanonical: {
                            readonly type: "string";
                            readonly minLength: 1;
                        };
                        groupCanonical: {
                            oneOf: ({
                                readonly type: "string";
                                readonly minLength: 1;
                            } | {
                                type: string;
                            })[];
                        };
                    };
                };
            };
            datasetHash: {
                readonly type: "string";
                readonly pattern: "^[a-f0-9]{64}$";
            };
            specHash: {
                readonly type: "string";
                readonly pattern: "^[a-f0-9]{64}$";
            };
            sourceResultHash: {
                readonly type: "string";
                readonly pattern: "^[a-f0-9]{64}$";
            };
            runId: {
                readonly type: "string";
                readonly minLength: 1;
            };
            schemaVersion: {
                const: string;
            };
            kind: {
                const: string;
            };
        };
    }>;
    trajectoryDisplaySpecV2: Readonly<{
        $id: "https://3dena.com/schemas/trajectory-display-spec.v2.json";
        type: "object";
        additionalProperties: false;
        required: string[];
        properties: {
            schemaVersion: {
                const: string;
            };
            projection: {
                enum: string[];
            };
            displayedGroups: {
                type: string;
                uniqueItems: boolean;
                items: {
                    readonly type: "string";
                    readonly minLength: 1;
                };
            };
            traces: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    [k: string]: {
                        type: string;
                    };
                };
            };
            axisFlips: {
                type: string;
                minItems: number;
                maxItems: number;
                items: {
                    type: string;
                };
            };
            camera: {
                oneOf: ({
                    type: string;
                    additionalProperties?: never;
                    required?: never;
                    properties?: never;
                } | {
                    type: string;
                    additionalProperties: boolean;
                    required: string[];
                    properties: {
                        projection: {
                            type: string;
                            additionalProperties: boolean;
                            required: string[];
                            properties: {
                                type: {
                                    enum: string[];
                                };
                            };
                        };
                    };
                })[];
            };
            style: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    participantSize: {
                        type: string;
                        exclusiveMinimum: number;
                    };
                    participantOpacity: {
                        type: string;
                        minimum: number;
                        maximum: number;
                    };
                    centroidSize: {
                        type: string;
                        exclusiveMinimum: number;
                    };
                    pathWidth: {
                        type: string;
                        exclusiveMinimum: number;
                    };
                };
            };
        };
    }>;
    longitudinalAnalysisBundleV2: Readonly<{
        $id: "https://3dena.com/schemas/longitudinal-analysis-bundle.v2.json";
        type: "object";
        additionalProperties: false;
        required: string[];
        properties: {
            schemaVersion: {
                const: string;
            };
            identity: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    datasetHash: {
                        readonly type: "string";
                        readonly pattern: "^[a-f0-9]{64}$";
                    };
                    specHash: {
                        readonly type: "string";
                        readonly pattern: "^[a-f0-9]{64}$";
                    };
                    sourceResultHash: {
                        readonly type: "string";
                        readonly pattern: "^[a-f0-9]{64}$";
                    };
                    requestHash: {
                        readonly type: "string";
                        readonly pattern: "^[a-f0-9]{64}$";
                    };
                    resultHash: {
                        readonly type: "string";
                        readonly pattern: "^[a-f0-9]{64}$";
                    };
                    runId: {
                        readonly type: "string";
                        readonly minLength: 1;
                    };
                    jenaBuildId: {
                        readonly type: "string";
                        readonly minLength: 1;
                    };
                };
            };
            runSpec: {
                $ref: string;
            };
            model: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    type: {
                        enum: string[];
                    };
                    fullRotationDimensions: {
                        type: string;
                        minItems: number;
                        uniqueItems: boolean;
                        items: {
                            readonly type: "string";
                            readonly minLength: 1;
                        };
                    };
                    selectedDimensions: {
                        type: string;
                        minItems: number;
                        maxItems: number;
                        uniqueItems: boolean;
                        items: {
                            readonly type: "string";
                            readonly minLength: 1;
                        };
                    };
                };
            };
            paths: {
                type: string;
                minItems: number;
                items: {
                    type: string;
                    additionalProperties: boolean;
                    required: string[];
                    properties: {
                        group: {
                            type: string;
                            additionalProperties: boolean;
                            required: string[];
                            properties: {
                                canonical: {
                                    readonly type: "string";
                                    readonly minLength: 1;
                                };
                                display: {
                                    readonly type: "string";
                                    readonly minLength: 1;
                                };
                            };
                        };
                        dynamics: {
                            [x: string]: unknown;
                        } | undefined;
                    };
                };
            };
            inference: {
                type: string;
                items: {
                    type: string;
                    additionalProperties: boolean;
                    required: string[];
                    properties: {
                        request: {
                            $ref: string;
                        };
                        status: {
                            enum: string[];
                        };
                        familyId: {
                            readonly type: "string";
                            readonly minLength: 1;
                        };
                        familySize: {
                            readonly type: "integer";
                            readonly minimum: 0;
                            readonly maximum: number;
                        };
                        rows: {
                            type: string;
                            items: {
                                readonly oneOf: readonly [{
                                    readonly type: "object";
                                    readonly additionalProperties: false;
                                    readonly required: readonly ["memberId", "sideAEntities", "sideBEntities", "overlappingEntities", "pairedCompleteEntities", "sideAOnly", "sideBOnly", "excludedIncompleteOverlap", "samePhysicalEntityConfirmed"];
                                    readonly properties: {
                                        readonly memberId: {
                                            readonly const: "identity-overlap-audit";
                                        };
                                        readonly sideAEntities: {
                                            readonly type: "integer";
                                            readonly minimum: 0;
                                            readonly maximum: number;
                                        };
                                        readonly sideBEntities: {
                                            readonly type: "integer";
                                            readonly minimum: 0;
                                            readonly maximum: number;
                                        };
                                        readonly overlappingEntities: {
                                            readonly type: "integer";
                                            readonly minimum: 0;
                                            readonly maximum: number;
                                        };
                                        readonly pairedCompleteEntities: {
                                            readonly type: "integer";
                                            readonly minimum: 0;
                                            readonly maximum: number;
                                        };
                                        readonly sideAOnly: {
                                            readonly type: "integer";
                                            readonly minimum: 0;
                                            readonly maximum: number;
                                        };
                                        readonly sideBOnly: {
                                            readonly type: "integer";
                                            readonly minimum: 0;
                                            readonly maximum: number;
                                        };
                                        readonly excludedIncompleteOverlap: {
                                            readonly type: "integer";
                                            readonly minimum: 0;
                                            readonly maximum: number;
                                        };
                                        readonly samePhysicalEntityConfirmed: {
                                            readonly const: true;
                                        };
                                    };
                                }, {
                                    readonly type: "object";
                                    readonly additionalProperties: false;
                                    readonly required: readonly ["memberId", "test", "design", "estimand", "axis", "axisIndex", "status", "reason", "effect", "statistic", "pRaw", "method", "ties", "zeros", "exactTail", "familyId", "familySize", "pHolm", "holmRank", "holmMultiplier", "periodCanonical", "nPrimary", "nSecondary"];
                                    readonly properties: {
                                        readonly test: {
                                            readonly const: "mann-whitney";
                                        };
                                        readonly design: {
                                            readonly const: "independent";
                                        };
                                        readonly periodCanonical: {
                                            readonly type: "string";
                                            readonly minLength: 1;
                                        };
                                        readonly nPrimary: {
                                            readonly type: "integer";
                                            readonly minimum: 0;
                                            readonly maximum: number;
                                        };
                                        readonly nSecondary: {
                                            readonly type: "integer";
                                            readonly minimum: 0;
                                            readonly maximum: number;
                                        };
                                        readonly memberId: {
                                            readonly type: "string";
                                            readonly minLength: 1;
                                        };
                                        readonly estimand: {
                                            readonly type: "string";
                                            readonly minLength: 1;
                                        };
                                        readonly axis: {
                                            readonly type: "string";
                                            readonly minLength: 1;
                                        };
                                        readonly axisIndex: {
                                            readonly type: "integer";
                                            readonly minimum: 0;
                                            readonly maximum: number;
                                        };
                                        readonly status: {
                                            readonly enum: readonly ["available", "not-estimable"];
                                        };
                                        readonly reason: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "string";
                                                readonly minLength: 1;
                                            }];
                                        };
                                        readonly effect: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "number";
                                            }];
                                        };
                                        readonly statistic: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "number";
                                            }];
                                        };
                                        readonly pRaw: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "number";
                                                readonly minimum: 0;
                                                readonly maximum: 1;
                                            }];
                                        };
                                        readonly method: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "string";
                                                readonly minLength: 1;
                                            }];
                                        };
                                        readonly ties: {
                                            readonly type: "object";
                                            readonly additionalProperties: false;
                                            readonly required: readonly ["groups", "observations", "correctionSum"];
                                            readonly properties: {
                                                readonly groups: {
                                                    readonly type: "integer";
                                                    readonly minimum: 0;
                                                    readonly maximum: number;
                                                };
                                                readonly observations: {
                                                    readonly type: "integer";
                                                    readonly minimum: 0;
                                                    readonly maximum: number;
                                                };
                                                readonly correctionSum: {
                                                    readonly type: "number";
                                                    readonly minimum: 0;
                                                };
                                            };
                                        };
                                        readonly zeros: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "integer";
                                                readonly minimum: 0;
                                                readonly maximum: number;
                                            }];
                                        };
                                        readonly exactTail: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "object";
                                                readonly additionalProperties: false;
                                                readonly required: readonly ["extremeAssignmentCount", "totalAssignmentCount", "inclusive", "midP"];
                                                readonly properties: {
                                                    readonly extremeAssignmentCount: {
                                                        readonly type: "string";
                                                        readonly pattern: "^(?:0|[1-9][0-9]*)$";
                                                    };
                                                    readonly totalAssignmentCount: {
                                                        readonly type: "string";
                                                        readonly pattern: "^(?:0|[1-9][0-9]*)$";
                                                    };
                                                    readonly inclusive: {
                                                        readonly const: true;
                                                    };
                                                    readonly midP: {
                                                        readonly const: false;
                                                    };
                                                };
                                            }];
                                        };
                                        readonly familyId: {
                                            readonly type: "string";
                                            readonly minLength: 1;
                                        };
                                        readonly familySize: {
                                            readonly type: "integer";
                                            readonly minimum: 1;
                                            readonly maximum: number;
                                        };
                                        readonly pHolm: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "number";
                                                readonly minimum: 0;
                                                readonly maximum: 1;
                                            }];
                                        };
                                        readonly holmRank: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "integer";
                                                readonly minimum: 1;
                                                readonly maximum: number;
                                            }];
                                        };
                                        readonly holmMultiplier: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "integer";
                                                readonly minimum: 1;
                                                readonly maximum: number;
                                            }];
                                        };
                                    };
                                }, {
                                    readonly type: "object";
                                    readonly additionalProperties: false;
                                    readonly required: readonly ["memberId", "test", "design", "estimand", "axis", "axisIndex", "status", "reason", "effect", "statistic", "pRaw", "method", "ties", "zeros", "exactTail", "familyId", "familySize", "pHolm", "holmRank", "holmMultiplier", "earlierPeriodCanonical", "laterPeriodCanonical", "n", "identityOverlapAudit"];
                                    readonly properties: {
                                        readonly test: {
                                            readonly const: "wilcoxon-signed-rank";
                                        };
                                        readonly design: {
                                            readonly const: "paired";
                                        };
                                        readonly earlierPeriodCanonical: {
                                            readonly type: "string";
                                            readonly minLength: 1;
                                        };
                                        readonly laterPeriodCanonical: {
                                            readonly type: "string";
                                            readonly minLength: 1;
                                        };
                                        readonly n: {
                                            readonly type: "integer";
                                            readonly minimum: 0;
                                            readonly maximum: number;
                                        };
                                        readonly identityOverlapAudit: {
                                            readonly type: "object";
                                            readonly additionalProperties: false;
                                            readonly required: readonly ["earlier", "later", "overlap", "earlierOnly", "laterOnly", "samePhysicalEntityConfirmed"];
                                            readonly properties: {
                                                readonly earlier: {
                                                    readonly type: "integer";
                                                    readonly minimum: 0;
                                                    readonly maximum: number;
                                                };
                                                readonly later: {
                                                    readonly type: "integer";
                                                    readonly minimum: 0;
                                                    readonly maximum: number;
                                                };
                                                readonly overlap: {
                                                    readonly type: "integer";
                                                    readonly minimum: 0;
                                                    readonly maximum: number;
                                                };
                                                readonly earlierOnly: {
                                                    readonly type: "integer";
                                                    readonly minimum: 0;
                                                    readonly maximum: number;
                                                };
                                                readonly laterOnly: {
                                                    readonly type: "integer";
                                                    readonly minimum: 0;
                                                    readonly maximum: number;
                                                };
                                                readonly samePhysicalEntityConfirmed: {
                                                    readonly const: true;
                                                };
                                            };
                                        };
                                        readonly memberId: {
                                            readonly type: "string";
                                            readonly minLength: 1;
                                        };
                                        readonly estimand: {
                                            readonly type: "string";
                                            readonly minLength: 1;
                                        };
                                        readonly axis: {
                                            readonly type: "string";
                                            readonly minLength: 1;
                                        };
                                        readonly axisIndex: {
                                            readonly type: "integer";
                                            readonly minimum: 0;
                                            readonly maximum: number;
                                        };
                                        readonly status: {
                                            readonly enum: readonly ["available", "not-estimable"];
                                        };
                                        readonly reason: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "string";
                                                readonly minLength: 1;
                                            }];
                                        };
                                        readonly effect: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "number";
                                            }];
                                        };
                                        readonly statistic: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "number";
                                            }];
                                        };
                                        readonly pRaw: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "number";
                                                readonly minimum: 0;
                                                readonly maximum: 1;
                                            }];
                                        };
                                        readonly method: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "string";
                                                readonly minLength: 1;
                                            }];
                                        };
                                        readonly ties: {
                                            readonly type: "object";
                                            readonly additionalProperties: false;
                                            readonly required: readonly ["groups", "observations", "correctionSum"];
                                            readonly properties: {
                                                readonly groups: {
                                                    readonly type: "integer";
                                                    readonly minimum: 0;
                                                    readonly maximum: number;
                                                };
                                                readonly observations: {
                                                    readonly type: "integer";
                                                    readonly minimum: 0;
                                                    readonly maximum: number;
                                                };
                                                readonly correctionSum: {
                                                    readonly type: "number";
                                                    readonly minimum: 0;
                                                };
                                            };
                                        };
                                        readonly zeros: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "integer";
                                                readonly minimum: 0;
                                                readonly maximum: number;
                                            }];
                                        };
                                        readonly exactTail: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "object";
                                                readonly additionalProperties: false;
                                                readonly required: readonly ["extremeAssignmentCount", "totalAssignmentCount", "inclusive", "midP"];
                                                readonly properties: {
                                                    readonly extremeAssignmentCount: {
                                                        readonly type: "string";
                                                        readonly pattern: "^(?:0|[1-9][0-9]*)$";
                                                    };
                                                    readonly totalAssignmentCount: {
                                                        readonly type: "string";
                                                        readonly pattern: "^(?:0|[1-9][0-9]*)$";
                                                    };
                                                    readonly inclusive: {
                                                        readonly const: true;
                                                    };
                                                    readonly midP: {
                                                        readonly const: false;
                                                    };
                                                };
                                            }];
                                        };
                                        readonly familyId: {
                                            readonly type: "string";
                                            readonly minLength: 1;
                                        };
                                        readonly familySize: {
                                            readonly type: "integer";
                                            readonly minimum: 1;
                                            readonly maximum: number;
                                        };
                                        readonly pHolm: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "number";
                                                readonly minimum: 0;
                                                readonly maximum: 1;
                                            }];
                                        };
                                        readonly holmRank: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "integer";
                                                readonly minimum: 1;
                                                readonly maximum: number;
                                            }];
                                        };
                                        readonly holmMultiplier: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "integer";
                                                readonly minimum: 1;
                                                readonly maximum: number;
                                            }];
                                        };
                                    };
                                }, {
                                    readonly type: "object";
                                    readonly additionalProperties: false;
                                    readonly required: readonly ["memberId", "test", "design", "estimand", "axis", "axisIndex", "status", "reason", "effect", "statistic", "pRaw", "method", "ties", "zeros", "exactTail", "familyId", "familySize", "pHolm", "holmRank", "holmMultiplier", "selectedPeriodCanonicals", "n", "identityOverlapAudit"];
                                    readonly properties: {
                                        readonly test: {
                                            readonly const: "friedman";
                                        };
                                        readonly design: {
                                            readonly const: "repeated";
                                        };
                                        readonly selectedPeriodCanonicals: {
                                            readonly type: "array";
                                            readonly minItems: 3;
                                            readonly uniqueItems: true;
                                            readonly items: {
                                                readonly type: "string";
                                                readonly minLength: 1;
                                            };
                                        };
                                        readonly n: {
                                            readonly type: "integer";
                                            readonly minimum: 0;
                                            readonly maximum: number;
                                        };
                                        readonly identityOverlapAudit: {
                                            readonly type: "object";
                                            readonly additionalProperties: false;
                                            readonly required: readonly ["totalEntities", "completeBlocks", "excludedIncomplete", "samePhysicalEntityConfirmed"];
                                            readonly properties: {
                                                readonly totalEntities: {
                                                    readonly type: "integer";
                                                    readonly minimum: 0;
                                                    readonly maximum: number;
                                                };
                                                readonly completeBlocks: {
                                                    readonly type: "integer";
                                                    readonly minimum: 0;
                                                    readonly maximum: number;
                                                };
                                                readonly excludedIncomplete: {
                                                    readonly type: "integer";
                                                    readonly minimum: 0;
                                                    readonly maximum: number;
                                                };
                                                readonly samePhysicalEntityConfirmed: {
                                                    readonly const: true;
                                                };
                                            };
                                        };
                                        readonly memberId: {
                                            readonly type: "string";
                                            readonly minLength: 1;
                                        };
                                        readonly estimand: {
                                            readonly type: "string";
                                            readonly minLength: 1;
                                        };
                                        readonly axis: {
                                            readonly type: "string";
                                            readonly minLength: 1;
                                        };
                                        readonly axisIndex: {
                                            readonly type: "integer";
                                            readonly minimum: 0;
                                            readonly maximum: number;
                                        };
                                        readonly status: {
                                            readonly enum: readonly ["available", "not-estimable"];
                                        };
                                        readonly reason: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "string";
                                                readonly minLength: 1;
                                            }];
                                        };
                                        readonly effect: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "number";
                                            }];
                                        };
                                        readonly statistic: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "number";
                                            }];
                                        };
                                        readonly pRaw: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "number";
                                                readonly minimum: 0;
                                                readonly maximum: 1;
                                            }];
                                        };
                                        readonly method: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "string";
                                                readonly minLength: 1;
                                            }];
                                        };
                                        readonly ties: {
                                            readonly type: "object";
                                            readonly additionalProperties: false;
                                            readonly required: readonly ["groups", "observations", "correctionSum"];
                                            readonly properties: {
                                                readonly groups: {
                                                    readonly type: "integer";
                                                    readonly minimum: 0;
                                                    readonly maximum: number;
                                                };
                                                readonly observations: {
                                                    readonly type: "integer";
                                                    readonly minimum: 0;
                                                    readonly maximum: number;
                                                };
                                                readonly correctionSum: {
                                                    readonly type: "number";
                                                    readonly minimum: 0;
                                                };
                                            };
                                        };
                                        readonly zeros: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "integer";
                                                readonly minimum: 0;
                                                readonly maximum: number;
                                            }];
                                        };
                                        readonly exactTail: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "object";
                                                readonly additionalProperties: false;
                                                readonly required: readonly ["extremeAssignmentCount", "totalAssignmentCount", "inclusive", "midP"];
                                                readonly properties: {
                                                    readonly extremeAssignmentCount: {
                                                        readonly type: "string";
                                                        readonly pattern: "^(?:0|[1-9][0-9]*)$";
                                                    };
                                                    readonly totalAssignmentCount: {
                                                        readonly type: "string";
                                                        readonly pattern: "^(?:0|[1-9][0-9]*)$";
                                                    };
                                                    readonly inclusive: {
                                                        readonly const: true;
                                                    };
                                                    readonly midP: {
                                                        readonly const: false;
                                                    };
                                                };
                                            }];
                                        };
                                        readonly familyId: {
                                            readonly type: "string";
                                            readonly minLength: 1;
                                        };
                                        readonly familySize: {
                                            readonly type: "integer";
                                            readonly minimum: 1;
                                            readonly maximum: number;
                                        };
                                        readonly pHolm: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "number";
                                                readonly minimum: 0;
                                                readonly maximum: 1;
                                            }];
                                        };
                                        readonly holmRank: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "integer";
                                                readonly minimum: 1;
                                                readonly maximum: number;
                                            }];
                                        };
                                        readonly holmMultiplier: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "integer";
                                                readonly minimum: 1;
                                                readonly maximum: number;
                                            }];
                                        };
                                    };
                                }, {
                                    readonly type: "object";
                                    readonly additionalProperties: false;
                                    readonly required: readonly ["memberId", "test", "design", "estimand", "axis", "axisIndex", "status", "reason", "effect", "statistic", "pRaw", "method", "ties", "zeros", "exactTail", "familyId", "familySize", "pHolm", "holmRank", "holmMultiplier", "earlierPeriodCanonical", "laterPeriodCanonical", "n", "identityOverlapAudit"];
                                    readonly properties: {
                                        readonly test: {
                                            readonly const: "wilcoxon-signed-rank";
                                        };
                                        readonly design: {
                                            readonly const: "repeated-posthoc";
                                        };
                                        readonly earlierPeriodCanonical: {
                                            readonly type: "string";
                                            readonly minLength: 1;
                                        };
                                        readonly laterPeriodCanonical: {
                                            readonly type: "string";
                                            readonly minLength: 1;
                                        };
                                        readonly n: {
                                            readonly type: "integer";
                                            readonly minimum: 0;
                                            readonly maximum: number;
                                        };
                                        readonly identityOverlapAudit: {
                                            readonly type: "object";
                                            readonly additionalProperties: false;
                                            readonly required: readonly ["totalEntities", "completeBlocks", "excludedIncomplete", "samePhysicalEntityConfirmed"];
                                            readonly properties: {
                                                readonly totalEntities: {
                                                    readonly type: "integer";
                                                    readonly minimum: 0;
                                                    readonly maximum: number;
                                                };
                                                readonly completeBlocks: {
                                                    readonly type: "integer";
                                                    readonly minimum: 0;
                                                    readonly maximum: number;
                                                };
                                                readonly excludedIncomplete: {
                                                    readonly type: "integer";
                                                    readonly minimum: 0;
                                                    readonly maximum: number;
                                                };
                                                readonly samePhysicalEntityConfirmed: {
                                                    readonly const: true;
                                                };
                                            };
                                        };
                                        readonly memberId: {
                                            readonly type: "string";
                                            readonly minLength: 1;
                                        };
                                        readonly estimand: {
                                            readonly type: "string";
                                            readonly minLength: 1;
                                        };
                                        readonly axis: {
                                            readonly type: "string";
                                            readonly minLength: 1;
                                        };
                                        readonly axisIndex: {
                                            readonly type: "integer";
                                            readonly minimum: 0;
                                            readonly maximum: number;
                                        };
                                        readonly status: {
                                            readonly enum: readonly ["available", "not-estimable"];
                                        };
                                        readonly reason: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "string";
                                                readonly minLength: 1;
                                            }];
                                        };
                                        readonly effect: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "number";
                                            }];
                                        };
                                        readonly statistic: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "number";
                                            }];
                                        };
                                        readonly pRaw: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "number";
                                                readonly minimum: 0;
                                                readonly maximum: 1;
                                            }];
                                        };
                                        readonly method: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "string";
                                                readonly minLength: 1;
                                            }];
                                        };
                                        readonly ties: {
                                            readonly type: "object";
                                            readonly additionalProperties: false;
                                            readonly required: readonly ["groups", "observations", "correctionSum"];
                                            readonly properties: {
                                                readonly groups: {
                                                    readonly type: "integer";
                                                    readonly minimum: 0;
                                                    readonly maximum: number;
                                                };
                                                readonly observations: {
                                                    readonly type: "integer";
                                                    readonly minimum: 0;
                                                    readonly maximum: number;
                                                };
                                                readonly correctionSum: {
                                                    readonly type: "number";
                                                    readonly minimum: 0;
                                                };
                                            };
                                        };
                                        readonly zeros: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "integer";
                                                readonly minimum: 0;
                                                readonly maximum: number;
                                            }];
                                        };
                                        readonly exactTail: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "object";
                                                readonly additionalProperties: false;
                                                readonly required: readonly ["extremeAssignmentCount", "totalAssignmentCount", "inclusive", "midP"];
                                                readonly properties: {
                                                    readonly extremeAssignmentCount: {
                                                        readonly type: "string";
                                                        readonly pattern: "^(?:0|[1-9][0-9]*)$";
                                                    };
                                                    readonly totalAssignmentCount: {
                                                        readonly type: "string";
                                                        readonly pattern: "^(?:0|[1-9][0-9]*)$";
                                                    };
                                                    readonly inclusive: {
                                                        readonly const: true;
                                                    };
                                                    readonly midP: {
                                                        readonly const: false;
                                                    };
                                                };
                                            }];
                                        };
                                        readonly familyId: {
                                            readonly type: "string";
                                            readonly minLength: 1;
                                        };
                                        readonly familySize: {
                                            readonly type: "integer";
                                            readonly minimum: 1;
                                            readonly maximum: number;
                                        };
                                        readonly pHolm: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "number";
                                                readonly minimum: 0;
                                                readonly maximum: 1;
                                            }];
                                        };
                                        readonly holmRank: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "integer";
                                                readonly minimum: 1;
                                                readonly maximum: number;
                                            }];
                                        };
                                        readonly holmMultiplier: {
                                            readonly oneOf: readonly [{
                                                readonly type: "null";
                                            }, {
                                                readonly type: "integer";
                                                readonly minimum: 1;
                                                readonly maximum: number;
                                            }];
                                        };
                                    };
                                }];
                            };
                        };
                        reason: {
                            oneOf: ({
                                readonly type: "string";
                                readonly minLength: 1;
                            } | {
                                type: string;
                            })[];
                        };
                    };
                };
            };
            pathComparisons: {
                type: string;
                items: {
                    type: string;
                    additionalProperties: boolean;
                    required: string[];
                    properties: {
                        groups: {
                            type: string;
                            minItems: number;
                            maxItems: number;
                            uniqueItems: boolean;
                            items: {
                                readonly type: "string";
                                readonly minLength: 1;
                            };
                        };
                        design: {
                            enum: string[];
                        };
                        seed: {
                            type: string;
                            minimum: number;
                            maximum: number;
                        };
                        planHash: {
                            readonly type: "string";
                            readonly pattern: "^[a-f0-9]{64}$";
                        };
                        identityOverlapAudit: {
                            oneOf: ({
                                type: string;
                                additionalProperties?: never;
                                required?: never;
                                properties?: never;
                            } | {
                                type: string;
                                additionalProperties: boolean;
                                required: string[];
                                properties: {
                                    sideAEntities: {
                                        readonly type: "integer";
                                        readonly minimum: 0;
                                        readonly maximum: number;
                                    };
                                    sideBEntities: {
                                        readonly type: "integer";
                                        readonly minimum: 0;
                                        readonly maximum: number;
                                    };
                                    overlappingEntities: {
                                        readonly type: "integer";
                                        readonly minimum: 0;
                                        readonly maximum: number;
                                    };
                                    pairedCompleteEntities: {
                                        readonly type: "integer";
                                        readonly minimum: 0;
                                        readonly maximum: number;
                                    };
                                    sideAOnly: {
                                        readonly type: "integer";
                                        readonly minimum: 0;
                                        readonly maximum: number;
                                    };
                                    sideBOnly: {
                                        readonly type: "integer";
                                        readonly minimum: 0;
                                        readonly maximum: number;
                                    };
                                    excludedIncompleteOverlap: {
                                        readonly type: "integer";
                                        readonly minimum: 0;
                                        readonly maximum: number;
                                    };
                                    samePhysicalEntityConfirmed: {
                                        const: boolean;
                                    };
                                };
                            })[];
                        };
                        result: {
                            [x: string]: unknown;
                        } | undefined;
                    };
                };
            };
            bootstrap: {
                type: string;
                items: {
                    type: string;
                    additionalProperties: boolean;
                    required: string[];
                    properties: {
                        groupCanonical: {
                            readonly type: "string";
                            readonly minLength: 1;
                        };
                        status: {
                            enum: string[];
                        };
                        notEstimableReason: {
                            oneOf: ({
                                readonly type: "string";
                                readonly minLength: 1;
                            } | {
                                type: string;
                            })[];
                        };
                        seed: {
                            type: string;
                            minimum: number;
                            maximum: number;
                        };
                        planHash: {
                            readonly type: "string";
                            readonly pattern: "^[a-f0-9]{64}$";
                        };
                        finiteReplicates: {
                            readonly type: "integer";
                            readonly minimum: 0;
                            readonly maximum: number;
                        };
                        requiredFiniteReplicates: {
                            readonly type: "integer";
                            readonly minimum: 1;
                            readonly maximum: number;
                        };
                        totalReplicates: {
                            readonly type: "integer";
                            readonly minimum: 1;
                            readonly maximum: number;
                        };
                        confidenceLevel: {
                            type: string;
                            exclusiveMinimum: number;
                            exclusiveMaximum: number;
                        };
                        requestedResamplingDesign: {
                            enum: string[];
                        };
                        resolvedResamplingDesign: {
                            enum: string[];
                        };
                        resamplingAlgorithm: {
                            enum: string[];
                        };
                        intervalContract: {
                            const: string;
                        };
                        rotationPolicy: {
                            const: string;
                        };
                        speedIntervals: {
                            type: string;
                            items: {
                                type: string;
                                additionalProperties: boolean;
                                required: string[];
                                properties: {
                                    periodCanonical: {
                                        readonly type: "string";
                                        readonly minLength: 1;
                                    };
                                    selected: {
                                        oneOf: ({
                                            readonly type: "object";
                                            readonly additionalProperties: false;
                                            readonly required: readonly ["estimate", "lower", "upper", "finiteReplicates", "requiredFiniteReplicates", "totalReplicates"];
                                            readonly properties: {
                                                readonly estimate: {
                                                    readonly type: "number";
                                                };
                                                readonly lower: {
                                                    readonly type: "number";
                                                };
                                                readonly upper: {
                                                    readonly type: "number";
                                                };
                                                readonly finiteReplicates: {
                                                    readonly type: "integer";
                                                    readonly minimum: 0;
                                                    readonly maximum: number;
                                                };
                                                readonly requiredFiniteReplicates: {
                                                    readonly type: "integer";
                                                    readonly minimum: 1;
                                                    readonly maximum: number;
                                                };
                                                readonly totalReplicates: {
                                                    readonly type: "integer";
                                                    readonly minimum: 1;
                                                    readonly maximum: number;
                                                };
                                            };
                                        } | {
                                            type: string;
                                        })[];
                                    };
                                    full: {
                                        oneOf: ({
                                            readonly type: "object";
                                            readonly additionalProperties: false;
                                            readonly required: readonly ["estimate", "lower", "upper", "finiteReplicates", "requiredFiniteReplicates", "totalReplicates"];
                                            readonly properties: {
                                                readonly estimate: {
                                                    readonly type: "number";
                                                };
                                                readonly lower: {
                                                    readonly type: "number";
                                                };
                                                readonly upper: {
                                                    readonly type: "number";
                                                };
                                                readonly finiteReplicates: {
                                                    readonly type: "integer";
                                                    readonly minimum: 0;
                                                    readonly maximum: number;
                                                };
                                                readonly requiredFiniteReplicates: {
                                                    readonly type: "integer";
                                                    readonly minimum: 1;
                                                    readonly maximum: number;
                                                };
                                                readonly totalReplicates: {
                                                    readonly type: "integer";
                                                    readonly minimum: 1;
                                                    readonly maximum: number;
                                                };
                                            };
                                        } | {
                                            type: string;
                                        })[];
                                    };
                                };
                            };
                        };
                        result: {
                            [x: string]: unknown;
                        } | undefined;
                    };
                };
            };
            codeGeometry: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    schemaVersion: {
                        const: string;
                    };
                    dimensions: {
                        type: string;
                        minItems: number;
                        maxItems: number;
                        uniqueItems: boolean;
                        items: {
                            readonly type: "string";
                            readonly minLength: 1;
                        };
                    };
                    nodes: {
                        type: string;
                        minItems: number;
                        items: {
                            type: string;
                            additionalProperties: boolean;
                            required: string[];
                            properties: {
                                index: {
                                    readonly type: "integer";
                                    readonly minimum: 0;
                                    readonly maximum: number;
                                };
                                code: {
                                    readonly type: "string";
                                    readonly minLength: 1;
                                };
                                coordinates: {
                                    type: string;
                                    minItems: number;
                                    maxItems: number;
                                    items: {
                                        type: string;
                                    };
                                };
                            };
                        };
                    };
                };
            };
            networkOverlays: {
                type: string;
                items: {
                    type: string;
                    additionalProperties: boolean;
                    required: string[];
                    properties: {
                        status: {
                            enum: string[];
                        };
                        reason: {
                            oneOf: ({
                                readonly type: "string";
                                readonly minLength: 1;
                            } | {
                                type: string;
                            })[];
                        };
                        groupCanonical: {
                            oneOf: ({
                                readonly type: "string";
                                readonly minLength: 1;
                            } | {
                                type: string;
                            })[];
                        };
                        periodCanonical: {
                            readonly type: "string";
                            readonly minLength: 1;
                        };
                        dimensions: {
                            type: string;
                            minItems: number;
                            maxItems: number;
                            uniqueItems: boolean;
                            items: {
                                readonly type: "string";
                                readonly minLength: 1;
                            };
                        };
                        estimand: {
                            enum: string[];
                        };
                        sourceRows: {
                            readonly type: "integer";
                            readonly minimum: 0;
                            readonly maximum: number;
                        };
                        participantPeriods: {
                            readonly type: "integer";
                            readonly minimum: 0;
                            readonly maximum: number;
                        };
                        effectiveParticipantN: {
                            oneOf: ({
                                type: string;
                                exclusiveMinimum?: never;
                            } | {
                                type: string;
                                exclusiveMinimum: number;
                            })[];
                        };
                        edges: {
                            type: string;
                            items: {
                                type: string;
                                additionalProperties: boolean;
                                required: string[];
                                properties: {
                                    id: {
                                        readonly type: "string";
                                        readonly minLength: 1;
                                    };
                                    sourceIndex: {
                                        readonly type: "integer";
                                        readonly minimum: 0;
                                        readonly maximum: number;
                                    };
                                    targetIndex: {
                                        readonly type: "integer";
                                        readonly minimum: 0;
                                        readonly maximum: number;
                                    };
                                    weight: {
                                        type: string;
                                    };
                                };
                            };
                        };
                    };
                };
            };
            diagnostics: {
                type: string;
                items: {
                    type: string;
                    additionalProperties: boolean;
                    required: string[];
                    properties: {
                        code: {
                            readonly type: "string";
                            readonly minLength: 1;
                        };
                        severity: {
                            enum: string[];
                        };
                        message: {
                            readonly type: "string";
                            readonly minLength: 1;
                        };
                        path: {
                            readonly type: "string";
                            readonly minLength: 1;
                        };
                    };
                };
            };
            execution: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    target: {
                        enum: string[];
                    };
                    jenaVersion: {
                        readonly type: "string";
                        readonly minLength: 1;
                    };
                    jenaCommit: {
                        readonly type: "string";
                        readonly minLength: 1;
                    };
                    jenaTarballIntegrity: {
                        readonly type: "string";
                        readonly minLength: 1;
                    };
                    sdkVersion: {
                        readonly type: "string";
                        readonly minLength: 1;
                    };
                    buildId: {
                        readonly type: "string";
                        readonly minLength: 1;
                    };
                    seed: {
                        type: string;
                        minimum: number;
                        maximum: number;
                    };
                    permutationPlanHashes: {
                        type: string;
                        items: {
                            readonly type: "string";
                            readonly pattern: "^[a-f0-9]{64}$";
                        };
                    };
                    resamplingPlanHashes: {
                        type: string;
                        items: {
                            readonly type: "string";
                            readonly pattern: "^[a-f0-9]{64}$";
                        };
                    };
                    evidenceStatus: {
                        enum: string[];
                    };
                };
            };
        };
    }>;
    analysisSpec: Readonly<{
        $id: "https://3dena.com/schemas/analysis-spec.v1.json";
        type: "object";
        additionalProperties: false;
        required: string[];
        properties: {
            schemaVersion: {
                const: string;
            };
            model: {
                enum: string[];
            };
            window: {
                enum: string[];
            };
            weightBy: {
                enum: string[];
            };
            windowSizeBack: {
                readonly type: "integer";
                readonly minimum: 0;
                readonly maximum: number;
            };
            windowSizeForward: {
                readonly type: "integer";
                readonly minimum: 0;
                readonly maximum: number;
            };
            centerAlignToOrigin: {
                type: string;
            };
            cohortPolicy: {
                enum: string[];
            };
        };
    }>;
    displaySpec: Readonly<{
        $id: "https://3dena.com/schemas/display-spec.v1.json";
        type: "object";
        additionalProperties: false;
        required: string[];
        properties: {
            schemaVersion: {
                const: string;
            };
            dimensions: {
                type: string;
                minItems: number;
                maxItems: number;
                uniqueItems: boolean;
                items: {
                    readonly type: "string";
                    readonly minLength: 1;
                };
            };
            plotDimension: {
                enum: number[];
            };
            groups: {
                type: string;
                minItems: number;
                uniqueItems: boolean;
                items: {
                    readonly type: "string";
                    readonly minLength: 1;
                };
            };
            showGrid: {
                type: string;
            };
            showZeroLines: {
                type: string;
            };
            showAxes: {
                type: string;
            };
            traces: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    [k: string]: {
                        type: string;
                    };
                };
            };
            style: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    pointSize: {
                        type: string;
                        minimum: number;
                        maximum: number;
                    };
                    pointOpacity: {
                        type: string;
                        minimum: number;
                        maximum: number;
                    };
                    nodeSize: {
                        type: string;
                        minimum: number;
                        maximum: number;
                    };
                    nodeOpacity: {
                        type: string;
                        minimum: number;
                        maximum: number;
                    };
                    edgeThreshold: {
                        type: string;
                        minimum: number;
                        maximum: number;
                    };
                    edgeWidthScale: {
                        type: string;
                        minimum: number;
                        maximum: number;
                    };
                    trajectoryWidth: {
                        type: string;
                        minimum: number;
                        maximum: number;
                    };
                };
            };
            camera: {
                oneOf: ({
                    type: string;
                    additionalProperties?: never;
                    required?: never;
                    properties?: never;
                } | {
                    type: string;
                    additionalProperties: boolean;
                    required: string[];
                    properties: {
                        [k: string]: {
                            type: string;
                            additionalProperties: boolean;
                            required: string[];
                            properties: {
                                x: {
                                    type: string;
                                };
                                y: {
                                    type: string;
                                };
                                z: {
                                    type: string;
                                };
                            };
                        };
                    };
                })[];
            };
        };
    }>;
    analysisTask: Readonly<{
        $id: "https://3dena.com/schemas/analysis-task.v1.json";
        discriminator: {
            propertyName: string;
        };
        $defs: {
            stringPair: {
                type: string;
                minItems: number;
                maxItems: number;
                uniqueItems: boolean;
                items: {
                    readonly type: "string";
                    readonly minLength: 1;
                };
            };
            timeValue: {
                oneOf: ({
                    type: string;
                    additionalProperties: boolean;
                    required: string[];
                    properties: {
                        type: {
                            const: string;
                        };
                        value: {
                            type: string;
                            pattern?: never;
                        };
                        unit: {
                            readonly type: "string";
                            readonly minLength: 1;
                        };
                        epochMilliseconds?: never;
                        timeZone?: never;
                        offsetMinutes?: never;
                        fold?: never;
                        elapsedUnit?: never;
                    };
                } | {
                    type: string;
                    additionalProperties: boolean;
                    required: string[];
                    properties: {
                        type: {
                            const: string;
                        };
                        value: {
                            type: string;
                            pattern: string;
                        };
                        unit?: never;
                        epochMilliseconds?: never;
                        timeZone?: never;
                        offsetMinutes?: never;
                        fold?: never;
                        elapsedUnit?: never;
                    };
                } | {
                    type: string;
                    additionalProperties: boolean;
                    required: string[];
                    properties: {
                        type: {
                            const: string;
                        };
                        epochMilliseconds: {
                            type: string;
                            pattern: string;
                        };
                        timeZone: {
                            readonly type: "string";
                            readonly minLength: 1;
                        };
                        offsetMinutes: {
                            type: string;
                            minimum: number;
                            maximum: number;
                        };
                        fold: {
                            enum: number[];
                        };
                        elapsedUnit: {
                            enum: string[];
                        };
                        value?: never;
                        unit?: never;
                    };
                } | {
                    type: string;
                    additionalProperties: boolean;
                    required: string[];
                    properties: {
                        type: {
                            const: string;
                        };
                        value: {
                            type: string;
                            pattern?: never;
                        };
                        unit: {
                            enum: string[];
                        };
                        elapsedUnit: {
                            enum: string[];
                        };
                        epochMilliseconds?: never;
                        timeZone?: never;
                        offsetMinutes?: never;
                        fold?: never;
                    };
                })[];
            };
        };
        oneOf: {
            type: string;
            additionalProperties: boolean;
            required: string[];
            properties: {
                schemaVersion: {
                    const: "3dena.analysis-task.v1";
                };
                kind: {
                    const: "trajectory" | "ena-model" | "prepared-import" | "network-comparison" | "change-network" | "statistics" | "trajectory-comparison" | "bootstrap";
                };
                owner: {
                    readonly $ref: "https://3dena.com/schemas/task-owner.v1.json";
                };
                deadlineEpochMilliseconds: {
                    readonly type: "integer";
                    readonly minimum: 0;
                    readonly maximum: number;
                };
            };
        }[];
    }>;
    evidenceStamp: Readonly<{
        $id: "https://3dena.com/schemas/evidence-stamp.v1.json";
        type: "object";
        additionalProperties: false;
        required: string[];
        properties: {
            schemaVersion: {
                const: string;
            };
            scope: {
                enum: string[];
            };
            status: {
                enum: string[];
            };
            datasetHash: {
                readonly type: "string";
                readonly pattern: "^[a-f0-9]{64}$";
            };
            specHash: {
                readonly type: "string";
                readonly pattern: "^[a-f0-9]{64}$";
            };
            fixtureId: {
                readonly type: "string";
                readonly minLength: 1;
            };
            buildId: {
                readonly type: "string";
                readonly minLength: 1;
            };
            approvedForParity: {
                type: string;
            };
        };
    }>;
    provenanceManifest: Readonly<{
        $id: "https://3dena.com/schemas/provenance-manifest.v1.json";
        type: "object";
        additionalProperties: false;
        required: string[];
        properties: {
            schemaVersion: {
                const: "3dena.provenance-manifest.v1";
            };
            datasetHash: {
                readonly type: "string";
                readonly pattern: "^[a-f0-9]{64}$";
            };
            specHash: {
                readonly type: "string";
                readonly pattern: "^[a-f0-9]{64}$";
            };
            resultHash: {
                readonly type: "string";
                readonly pattern: "^[a-f0-9]{64}$";
            };
            adapterVersion: {
                readonly type: "string";
                readonly minLength: 1;
            };
            jenaPackage: {
                const: string;
            };
            jenaVersion: {
                readonly type: "string";
                readonly minLength: 1;
            };
            jenaCommit: {
                readonly type: "string";
                readonly minLength: 1;
            };
            sourceKind: {
                enum: string[];
            };
            jenaExecuted: {
                type: string;
            };
            sdkPackage: {
                const: string;
            };
            sdkVersion: {
                readonly type: "string";
                readonly minLength: 1;
            };
            appVersion: {
                readonly type: "string";
                readonly minLength: 1;
            };
            contractVersion: {
                const: "3dena.contract.v1";
            };
            buildId: {
                readonly type: "string";
                readonly minLength: 1;
            };
            seed: {
                oneOf: ({
                    type: string;
                    minimum?: never;
                    maximum?: never;
                } | {
                    type: string;
                    minimum: number;
                    maximum: number;
                })[];
            };
            toleranceContract: {
                oneOf: ({
                    readonly type: "string";
                    readonly minLength: 1;
                } | {
                    type: string;
                })[];
            };
            schemaVersions: {
                type: string;
                minItems: number;
                uniqueItems: boolean;
                items: {
                    readonly type: "string";
                    readonly minLength: 1;
                };
            };
            generatedAt: {
                type: string;
                format: string;
            };
        };
    }>;
    resultEnvelope: Readonly<{
        $id: "https://3dena.com/schemas/analysis-result-envelope.v1.json";
        discriminator: {
            propertyName: string;
        };
        type: "object";
        additionalProperties: false;
        required: string[];
        properties: {
            schemaVersion: {
                const: "3dena.analysis-result-envelope.v1";
            };
            owner: {
                readonly $ref: "https://3dena.com/schemas/task-owner.v1.json";
            };
            taskKind: {
                enum: string[];
            };
            result: {
                oneOf: {
                    [x: string]: unknown;
                }[];
            };
            diagnostics: {
                type: string;
                items: {
                    type: string;
                    additionalProperties: boolean;
                    required: string[];
                    properties: {
                        code: {
                            readonly type: "string";
                            readonly minLength: 1;
                        };
                        severity: {
                            enum: string[];
                        };
                        message: {
                            readonly type: "string";
                            readonly minLength: 1;
                        };
                        path: {
                            readonly type: "string";
                            readonly minLength: 1;
                        };
                        count: {
                            readonly type: "integer";
                            readonly minimum: 0;
                            readonly maximum: number;
                        };
                    };
                };
            };
            evidence: {
                $ref: string;
            };
            provenance: {
                $ref: string;
            };
        };
        allOf: ({
            properties: {
                provenance: {
                    properties: {
                        schemaVersions: {
                            contains: {
                                const: "3dena.analysis-task.v1";
                            };
                        };
                    };
                };
            };
        } | {
            properties: {
                provenance: {
                    properties: {
                        schemaVersions: {
                            contains: {
                                const: "3dena.analysis-result-envelope.v1";
                            };
                        };
                    };
                };
            };
        })[];
        oneOf: {
            properties: {
                taskKind: {
                    const: string;
                };
                result: {
                    [x: string]: unknown;
                };
                provenance: {
                    properties: {
                        schemaVersions: {
                            contains: {
                                const: "3dena.analysis-result.v1" | "3dena.trajectory-dynamics.v1" | "3dena.prepared-space-result.v1" | "3dena.network-comparison.v1" | "3dena.change-network.v1" | "3dena.statistics-task-result.v1" | "3dena.trajectory-comparison.v1" | "3dena.trajectory-bootstrap.v1";
                            };
                        };
                    };
                };
            };
            required: string[];
        }[];
    }>;
}>;
export {};
//# sourceMappingURL=contracts.d.ts.map