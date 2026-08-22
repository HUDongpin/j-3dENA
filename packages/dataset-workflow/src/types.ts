import type {
  DatasetColumnRoleV1,
  DatasetReceiptV1,
  DatasetSchemaV1,
  TypedScalarV1,
} from "@3dena/analysis";
import type {
  CsvDelimiter,
  RawScalar,
  TabularImportFormat,
  WorksheetDescriptor,
  WorksheetSelection,
} from "@3dena/tabular-import";
import type { DatasetWorkflowErrorCode } from "./errors";

export const DATASET_WORKFLOW_VERSION_V1 = "3dena.dataset-workflow.v1" as const;
export const DATASET_WORKFLOW_STATUS = "IMPLEMENTED_UNVERIFIED" as const;

declare const workflowIdentityBrand: unique symbol;
export type PreflightIdentityV1 = string & {
  readonly [workflowIdentityBrand]: "preflight";
};
export type UploadIdentityV1 = string & {
  readonly [workflowIdentityBrand]: "upload";
};
export type ParsedIdentityV1 = string & {
  readonly [workflowIdentityBrand]: "parsed";
};
export type ActivationIdentityV1 = string & {
  readonly [workflowIdentityBrand]: "activation";
};

export type DeclaredTabularExtensionV1 = ".csv" | ".xlsx" | ".xls";

export interface DatasetWorkflowLimitsV1 {
  readonly schemaVersion: "3dena.dataset-workflow-limits.v1";
  readonly maxFileBytes: number;
  readonly maxWorksheets: number;
  readonly maxRows: number;
  readonly maxColumns: number;
  readonly maxCells: number;
  readonly maxStringLength: number;
  readonly maxZipEntries: number;
  readonly maxZipTotalUncompressedBytes: number;
  readonly maxZipEntryUncompressedBytes: number;
  readonly maxZipCompressionRatio: number;
  readonly maxZipPathDepth: number;
}

export interface BrowserPreflightInputV1 {
  readonly schemaVersion: "3dena.browser-preflight-input.v1";
  /** Extension only. The raw browser filename is deliberately not retained. */
  readonly declaredExtension: DeclaredTabularExtensionV1;
  readonly bytes: ArrayBuffer | ArrayBufferView;
  readonly limits?: Partial<Omit<DatasetWorkflowLimitsV1, "schemaVersion">>;
}

export interface BrowserPreflightReceiptV1 {
  readonly schemaVersion: "3dena.browser-preflight-receipt.v1";
  readonly productStatus: typeof DATASET_WORKFLOW_STATUS;
  readonly preflightIdentity: PreflightIdentityV1;
  readonly declaredExtension: DeclaredTabularExtensionV1;
  readonly format: TabularImportFormat;
  readonly byteLength: number;
  readonly sha256: string;
  readonly limits: DatasetWorkflowLimitsV1;
}

export interface StageUploadRequestV1 {
  readonly schemaVersion: "3dena.stage-upload-request.v1";
  readonly generation: number;
  readonly preflight: BrowserPreflightReceiptV1;
  readonly bytes: ArrayBuffer | ArrayBufferView;
}

export interface WorkflowWorkbookInventoryV1 {
  readonly schemaVersion: "3dena.workflow-workbook-inventory.v1";
  readonly format: TabularImportFormat;
  readonly byteLength: number;
  readonly sha256: string;
  readonly delimiter: CsvDelimiter | null;
  readonly worksheets: readonly WorksheetDescriptor[];
  readonly visibleSelectableWorksheetCount: number;
  readonly selectionPolicy: "single-visible-auto-otherwise-explicit";
  readonly hiddenWorksheetPolicy: "listed-not-selectable";
  readonly vbaDetectedAndDiscarded: boolean;
  readonly parserVersion: string;
}

export interface InspectedDatasetCandidateV1 {
  readonly schemaVersion: "3dena.inspected-dataset-candidate.v1";
  readonly productStatus: typeof DATASET_WORKFLOW_STATUS;
  readonly generation: number;
  readonly preflightIdentity: PreflightIdentityV1;
  readonly uploadIdentity: UploadIdentityV1;
  readonly inventory: WorkflowWorkbookInventoryV1;
}

export interface DatasetRoleAssignmentV1 {
  readonly index: number;
  readonly header: string;
  readonly roles: readonly DatasetColumnRoleV1[];
}

export interface DatasetRoleMappingV1 {
  readonly schemaVersion: "3dena.dataset-role-mapping.v1";
  /** One ordered assignment for every parsed header. */
  readonly columns: readonly DatasetRoleAssignmentV1[];
}

export interface ParseWorksheetRequestV1 {
  readonly schemaVersion: "3dena.parse-worksheet-request.v1";
  readonly generation: number;
  readonly uploadIdentity: UploadIdentityV1;
  readonly selection: WorksheetSelection | null;
}

/**
 * Header-only public result of exact worksheet parsing. Raw rows remain in the
 * storage boundary until an explicit role mapping produces a bounded preview.
 */
export interface ParsedWorksheetCandidateV1 {
  readonly schemaVersion: "3dena.parsed-worksheet-candidate.v1";
  readonly productStatus: typeof DATASET_WORKFLOW_STATUS;
  readonly generation: number;
  readonly uploadIdentity: UploadIdentityV1;
  readonly parsedIdentity: ParsedIdentityV1;
  /** SHA-256 of the exact ordered, typed header/row payload. */
  readonly parsedContentSha256: string;
  readonly worksheet: WorksheetDescriptor;
  readonly headers: readonly string[];
  readonly rowCount: number;
  readonly columnCount: number;
}

export interface PrepareDatasetRequestV1 {
  readonly schemaVersion: "3dena.prepare-dataset-request.v1";
  readonly generation: number;
  readonly parsedIdentity: ParsedIdentityV1;
  readonly mapping: DatasetRoleMappingV1;
}

export type WorkflowDiagnosticSeverityV1 = "warning" | "error";

export interface WorkflowDiagnosticV1 {
  readonly code:
    | "VBA_DISCARDED"
    | "BLANK_ROWS_SKIPPED"
    | "MIXED_COLUMN_TYPE"
    | "MAPPING_REQUIRES_UNIT"
    | "MAPPING_REQUIRES_GROUP"
    | "GROUP_MUST_BE_PART_OF_UNIT"
    | "MAPPING_REQUIRES_THREE_CODES"
    | "IDENTITY_VALUE_MISSING"
    | "UNSAFE_NUMERIC_IDENTITY"
    | "CODE_VALUE_NOT_NUMERIC";
  readonly severity: WorkflowDiagnosticSeverityV1;
  /** Contract coordinate only; never a raw value. */
  readonly path: string;
  readonly message: string;
  readonly affectedCount: number;
}

export interface TypedPreviewRowV1 {
  readonly rowIndex: number;
  readonly values: readonly TypedScalarV1[];
}

export interface TypedDatasetPreviewV1 {
  readonly schemaVersion: "3dena.typed-dataset-preview.v1";
  readonly headers: readonly string[];
  readonly rows: readonly TypedPreviewRowV1[];
  readonly totalRowCount: number;
  readonly previewRowCount: number;
}

export interface PreparedDatasetCandidateV1 {
  readonly schemaVersion: "3dena.prepared-dataset-candidate.v1";
  readonly productStatus: typeof DATASET_WORKFLOW_STATUS;
  readonly generation: number;
  readonly uploadIdentity: UploadIdentityV1;
  readonly parsedIdentity: ParsedIdentityV1;
  readonly parsedContentSha256: string;
  readonly activationIdentity: ActivationIdentityV1;
  readonly worksheet: WorksheetDescriptor;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly schema: DatasetSchemaV1;
  readonly preview: TypedDatasetPreviewV1;
  readonly diagnostics: readonly WorkflowDiagnosticV1[];
  readonly activatable: boolean;
}

export interface ActivateDatasetRequestV1 {
  readonly schemaVersion: "3dena.activate-dataset-request.v1";
  readonly generation: number;
  readonly activationIdentity: ActivationIdentityV1;
  readonly expectedActiveActivationIdentity: ActivationIdentityV1 | null;
}

export interface ActiveDatasetHandleV1 {
  readonly schemaVersion: "3dena.active-dataset-handle.v1";
  readonly productStatus: typeof DATASET_WORKFLOW_STATUS;
  readonly generation: number;
  readonly uploadIdentity: UploadIdentityV1;
  readonly parsedIdentity: ParsedIdentityV1;
  readonly activationIdentity: ActivationIdentityV1;
  readonly receipt: DatasetReceiptV1;
}

export interface DatasetActivationResultV1 {
  readonly schemaVersion: "3dena.dataset-activation-result.v1";
  readonly productStatus: typeof DATASET_WORKFLOW_STATUS;
  readonly outcome: "activated" | "stale" | "conflict";
  readonly requestedGeneration: number;
  readonly active: ActiveDatasetHandleV1 | null;
}

export interface ActiveDatasetPayloadV1 {
  readonly schemaVersion: "3dena.active-dataset-payload.v1";
  readonly handle: ActiveDatasetHandleV1;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly RawScalar[])[];
  readonly schema: DatasetSchemaV1;
}

export interface DatasetWorkflowSnapshotV1 {
  readonly schemaVersion: "3dena.dataset-workflow-snapshot.v1";
  readonly productStatus: typeof DATASET_WORKFLOW_STATUS;
  readonly currentGeneration: number;
  readonly active: ActiveDatasetHandleV1 | null;
}

export interface ParserInspectRequestV1 {
  readonly format: TabularImportFormat;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly expectedSha256: string;
  readonly limits: DatasetWorkflowLimitsV1;
}

export interface ParserParseRequestV1 extends ParserInspectRequestV1 {
  readonly selection: WorksheetSelection | null;
}

export interface WorkflowParsedWorksheetV1 {
  readonly schemaVersion: "3dena.workflow-parsed-worksheet.v1";
  readonly format: TabularImportFormat;
  readonly byteLength: number;
  readonly sha256: string;
  readonly delimiter: CsvDelimiter | null;
  readonly worksheet: WorksheetDescriptor;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly RawScalar[])[];
  readonly previewRows: readonly (readonly RawScalar[])[];
  readonly rowCount: number;
  readonly columnCount: number;
  readonly skippedBlankRowCount: number;
  readonly vbaDetectedAndDiscarded: boolean;
  readonly parserVersion: string;
}

export interface DatasetWorkflowParser {
  readonly parserVersion: string;
  inspect(request: ParserInspectRequestV1): Promise<WorkflowWorkbookInventoryV1>;
  parse(request: ParserParseRequestV1): Promise<WorkflowParsedWorksheetV1>;
}

export interface ImmutableUploadRecordV1 {
  readonly schemaVersion: "3dena.immutable-upload-record.v1";
  readonly uploadIdentity: UploadIdentityV1;
  readonly format: TabularImportFormat;
  readonly byteLength: number;
  readonly sha256: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

export interface ImmutableParsedRecordV1 {
  readonly schemaVersion: "3dena.immutable-parsed-record.v1";
  readonly uploadIdentity: UploadIdentityV1;
  readonly parsedIdentity: ParsedIdentityV1;
  readonly parsedContentSha256: string;
  readonly parserVersion: string;
  readonly format: TabularImportFormat;
  readonly delimiter: CsvDelimiter | null;
  readonly worksheet: WorksheetDescriptor;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly RawScalar[])[];
  readonly rowCount: number;
  readonly columnCount: number;
  readonly skippedBlankRowCount: number;
  readonly vbaDetectedAndDiscarded: boolean;
}

export interface StoredActivationRecordV1 {
  readonly schemaVersion: "3dena.stored-activation-record.v1";
  readonly handle: ActiveDatasetHandleV1;
  readonly mapping: DatasetRoleMappingV1;
}

export interface AtomicActivationRequestV1 {
  readonly generation: number;
  readonly expectedActiveActivationIdentity: ActivationIdentityV1 | null;
  readonly next: StoredActivationRecordV1;
}

export type AtomicActivationOutcomeV1 = "activated" | "stale" | "conflict";
export type ImmutablePutOutcomeV1 = "created" | "existing";
export type GenerationClaimOutcomeV1 = "claimed" | "current" | "stale";

export interface DatasetWorkflowStorage {
  claimGeneration(generation: number): Promise<GenerationClaimOutcomeV1>;
  isGenerationCurrent(generation: number): Promise<boolean>;
  putUpload(record: ImmutableUploadRecordV1): Promise<ImmutablePutOutcomeV1>;
  readUpload(identity: UploadIdentityV1): Promise<ImmutableUploadRecordV1 | null>;
  putParsed(record: ImmutableParsedRecordV1): Promise<ImmutablePutOutcomeV1>;
  readParsed(identity: ParsedIdentityV1): Promise<ImmutableParsedRecordV1 | null>;
  activateAtomic(request: AtomicActivationRequestV1): Promise<AtomicActivationOutcomeV1>;
  readActive(): Promise<StoredActivationRecordV1 | null>;
}

export type WorkflowAuditEventTypeV1 =
  | "generation-claimed"
  | "upload-verified"
  | "inventory-inspected"
  | "worksheet-parsed"
  | "dataset-prepared"
  | "activation-attempted"
  | "workflow-rejected";

/** Closed, aggregate-only audit event. No free-form message or source data. */
export interface WorkflowAuditEventV1 {
  readonly schemaVersion: "3dena.dataset-workflow-audit-event.v1";
  readonly productStatus: typeof DATASET_WORKFLOW_STATUS;
  readonly event: WorkflowAuditEventTypeV1;
  readonly generation: number;
  readonly identity: PreflightIdentityV1 | UploadIdentityV1 | ParsedIdentityV1 | ActivationIdentityV1 | null;
  readonly outcome: "ok" | "stale" | "conflict" | "rejected";
  readonly errorCode: DatasetWorkflowErrorCode | null;
}

export interface DatasetWorkflowAuditSink {
  record(event: WorkflowAuditEventV1): void;
}

export interface DatasetWorkflowDependencies {
  readonly storage: DatasetWorkflowStorage;
  readonly parser: DatasetWorkflowParser;
  readonly audit?: DatasetWorkflowAuditSink;
  /** Trusted ceiling. Browser receipts may lower but never raise this policy. */
  readonly limits?: Partial<Omit<DatasetWorkflowLimitsV1, "schemaVersion">>;
}

export type {
  CsvDelimiter,
  DatasetColumnRoleV1,
  DatasetReceiptV1,
  DatasetSchemaV1,
  RawScalar,
  TabularImportFormat,
  TypedScalarV1,
  WorksheetDescriptor,
  WorksheetSelection,
};
