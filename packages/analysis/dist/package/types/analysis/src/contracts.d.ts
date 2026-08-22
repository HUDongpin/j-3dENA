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
        centroids: boolean;
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