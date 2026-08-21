import type {
  AnalysisMapping,
} from "@/lib/analysis-contract";
import type {
  AnalysisJobReferenceV1,
  DatasetReceiptV1,
  PreparedSpaceMapping,
  TypedScalarV1,
} from "@3dena/analysis";
import type { ActivatedAnalysisTaskSpecV1 } from "@3dena/compute-service-http";
import type { RemoteExecutionBinding } from "./remote-analysis-runtime";

export type RemoteDatasetFormat = "csv" | "xlsx" | "xls" | "ena3d-json";

export interface RemoteWorksheetSummary {
  readonly index: number;
  readonly name: string;
  readonly hidden: boolean;
  readonly selectable: boolean;
  readonly declaredRows: number;
  readonly declaredColumns: number;
}

export interface RemoteDatasetInventory {
  readonly workflowId: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly format: RemoteDatasetFormat;
  readonly worksheets: readonly RemoteWorksheetSummary[];
  readonly parserVersion: string;
  readonly warnings: readonly string[];
}

export interface RemoteParsedWorksheet {
  readonly workflowId: string;
  readonly parseIdentity: string;
  readonly parsedContentSha256: string;
  readonly worksheet: RemoteWorksheetSummary;
  readonly headers: readonly string[];
  readonly rowCount: number;
  readonly columnCount: number;
}

export interface RemoteDatasetPreview {
  readonly workflowId: string;
  readonly activationIdentity: string;
  readonly parsedContentSha256: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly TypedScalarV1[])[];
  readonly totalRows: number;
  readonly diagnostics: readonly {
    code: string;
    severity: "warning" | "error";
    path: string;
    message: string;
  }[];
  readonly activatable: boolean;
}

export interface RemoteActiveDataset {
  readonly workflowId: string;
  readonly activationIdentity: string;
  readonly receipt: DatasetReceiptV1;
}

export interface RemoteEnaSourceResult {
  readonly reference: AnalysisJobReferenceV1;
  readonly datasetReceipt: DatasetReceiptV1;
  readonly sourceResultHash: string;
  readonly sourceKind?: "raw-jena" | "prepared-exchange";
}

export type RemoteScientificSourceResult = RemoteEnaSourceResult;

export interface RemotePreparedDataset {
  readonly workflowId: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly dimensions: readonly string[];
  readonly groupVariables: readonly string[];
  readonly tables: readonly { name: string; rows: number; columns: number }[];
  readonly points: number;
  readonly nodes: number;
  readonly edges: number;
  readonly groups: number;
  readonly periods: readonly string[];
  readonly mapping: PreparedSpaceMapping;
}

export interface RemoteDatasetWorkflowCapability {
  readonly available: boolean;
  readonly contractVersion: string | null;
  readonly blocker: string | null;
  readonly executionAvailable: boolean;
  readonly executionBlocker: string | null;
}

export interface RemoteWorkflowProgress {
  readonly phase: string;
  readonly completed: number;
  readonly total: number | null;
  readonly message: string;
}

export interface RemoteDatasetWorkflowAdapter {
  capabilities(signal?: AbortSignal): Promise<RemoteDatasetWorkflowCapability>;
  inspect(
    file: File,
    signal: AbortSignal,
    onProgress: (progress: RemoteWorkflowProgress) => void,
  ): Promise<RemoteDatasetInventory>;
  inspectPrepared(
    file: File,
    signal: AbortSignal,
    onProgress: (progress: RemoteWorkflowProgress) => void,
  ): Promise<RemotePreparedDataset>;
  parseWorksheet(
    inventory: RemoteDatasetInventory,
    worksheet: RemoteWorksheetSummary,
    signal: AbortSignal,
  ): Promise<RemoteParsedWorksheet>;
  prepare(
    parsed: RemoteParsedWorksheet,
    mapping: AnalysisMapping,
    signal: AbortSignal,
  ): Promise<RemoteDatasetPreview>;
  activate(
    preview: RemoteDatasetPreview,
    expectedActiveActivationIdentity: string | null,
    signal: AbortSignal,
  ): Promise<RemoteActiveDataset>;
  bindExecution(
    active: RemoteActiveDataset,
    task: ActivatedAnalysisTaskSpecV1,
    signal: AbortSignal,
  ): Promise<RemoteExecutionBinding>;
  bindPreparedExecution(
    prepared: RemotePreparedDataset,
    runId: string,
    deadlineEpochMilliseconds: number,
    signal: AbortSignal,
  ): Promise<RemoteExecutionBinding>;
  bindDerivedExecution(
    source: RemoteEnaSourceResult,
    task: ActivatedAnalysisTaskSpecV1,
    signal: AbortSignal,
  ): Promise<RemoteExecutionBinding>;
  discard(workflowId: string, signal?: AbortSignal): Promise<void>;
}

export const REMOTE_DATASET_WORKFLOW_REQUIRED_CONTRACT =
  "3dena.compute-dataset-http.v1";
export const REMOTE_DERIVED_EXECUTION_REQUIRED_CONTRACT =
  "3dena.compute-source-result-job-http.v1";
export const REMOTE_PREPARED_IMPORT_REQUIRED_CONTRACT =
  "3dena.compute-prepared-import-http.v1";

/**
 * The current public job client deliberately has no worksheet/mapping routes.
 * Keep production fail-closed until the compute service publishes a reviewed
 * adapter for the exact dataset-workflow HTTP contract.
 */
export function createUnavailableRemoteDatasetWorkflowAdapter(): RemoteDatasetWorkflowAdapter {
  const blocker =
    "The compute service does not yet expose the reviewed inventory, worksheet, mapping, preview, and atomic activation contract. No file was uploaded.";
  const unavailable = async (): Promise<never> => {
    throw new Error(blocker);
  };
  return Object.freeze({
    async capabilities() {
      return {
        available: false,
        contractVersion: null,
        blocker,
        executionAvailable: false,
        executionBlocker: blocker,
      };
    },
    inspect: unavailable,
    inspectPrepared: unavailable,
    parseWorksheet: unavailable,
    prepare: unavailable,
    activate: unavailable,
    bindExecution: unavailable,
    bindPreparedExecution: unavailable,
    bindDerivedExecution: unavailable,
    async discard() {
      // No remote workflow was created, so there is nothing to delete.
    },
  });
}
