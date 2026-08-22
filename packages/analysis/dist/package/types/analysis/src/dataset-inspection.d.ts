import { type Ena3dExchangeLimits, type HashedEna3dExchangeV1 } from "../../io/src/index.js";
import { type InspectTabularSourceOptions, type TabularInputBytes, type WorkbookInventory } from "../../tabular-import/src/index.js";
export interface InspectDatasetOptions {
    /** Browser File basename. Paths and control characters are rejected. */
    name: string;
    tabular?: InspectTabularSourceOptions;
    exchangeLimits?: Partial<Ena3dExchangeLimits>;
}
export interface TabularDatasetInspectionV1 {
    schemaVersion: "3dena.dataset-inspection.v1";
    kind: "tabular";
    inventory: WorkbookInventory;
}
export interface ExchangeDatasetInspectionV1 {
    schemaVersion: "3dena.dataset-inspection.v1";
    kind: "prepared-exchange";
    receipt: {
        name: string;
        format: "ena3d-json";
        sha256: string;
        byteLength: number;
    };
    inventory: {
        dimensions: string[];
        groupVariables: string[];
        tables: Array<{
            name: string;
            rows: number;
            columns: number;
        }>;
    };
    /** Branded receipt consumed directly by prepared-space analysis. */
    artifact: HashedEna3dExchangeV1;
}
export type DatasetInspectionV1 = TabularDatasetInspectionV1 | ExchangeDatasetInspectionV1;
export declare class DatasetInspectionError extends Error {
    readonly code: "INVALID_NAME" | "R_WORKSPACE_REJECTED" | "UNSUPPORTED_FORMAT";
    constructor(code: DatasetInspectionError["code"], message: string);
}
/**
 * Takes an exact byte snapshot and performs browser-safe local preflight.
 * Tabular inspection returns worksheet inventory only; activation still
 * requires selection, authoritative server parsing, and a DatasetReceiptV1.
 */
export declare function inspectDataset(bytes: TabularInputBytes, options: InspectDatasetOptions): Promise<DatasetInspectionV1>;
//# sourceMappingURL=dataset-inspection.d.ts.map