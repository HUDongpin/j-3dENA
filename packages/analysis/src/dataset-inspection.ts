import {
  decodeEna3dExchangeV1WithSha256,
  type Ena3dExchangeLimits,
  type HashedEna3dExchangeV1,
} from "@3dena/io";
import {
  inspectTabularSource,
  type InspectTabularSourceOptions,
  type TabularInputBytes,
  type WorkbookInventory,
} from "@3dena/tabular-import";

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
    tables: Array<{ name: string; rows: number; columns: number }>;
  };
  /** Branded receipt consumed directly by prepared-space analysis. */
  artifact: HashedEna3dExchangeV1;
}

export type DatasetInspectionV1 =
  | TabularDatasetInspectionV1
  | ExchangeDatasetInspectionV1;

export class DatasetInspectionError extends Error {
  readonly code: "INVALID_NAME" | "R_WORKSPACE_REJECTED" | "UNSUPPORTED_FORMAT";

  constructor(
    code: DatasetInspectionError["code"],
    message: string,
  ) {
    super(message);
    this.name = "DatasetInspectionError";
    this.code = code;
  }
}

function validateName(name: unknown): string {
  if (
    typeof name !== "string"
    || name.length === 0
    || name.length > 255
    || name.includes("/")
    || name.includes("\\")
    || /[\u0000-\u001f\u007f]/u.test(name)
    || name === "."
    || name === ".."
  ) {
    throw new DatasetInspectionError(
      "INVALID_NAME",
      "Dataset name must be a safe basename without paths or control characters.",
    );
  }
  return name;
}

function tableShape(
  artifact: HashedEna3dExchangeV1,
  name: keyof HashedEna3dExchangeV1["exchange"]["tables"],
): { name: string; rows: number; columns: number } {
  const columns = artifact.exchange.tables[name].columns;
  return {
    name,
    rows: columns[0]?.values.length ?? 0,
    columns: columns.length,
  };
}

/**
 * Takes an exact byte snapshot and performs browser-safe local preflight.
 * Tabular inspection returns worksheet inventory only; activation still
 * requires selection, authoritative server parsing, and a DatasetReceiptV1.
 */
export async function inspectDataset(
  bytes: TabularInputBytes,
  options: InspectDatasetOptions,
): Promise<DatasetInspectionV1> {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new DatasetInspectionError("INVALID_NAME", "Dataset inspection options must contain a safe name.");
  }
  const name = validateName(options.name);
  const lower = name.toLocaleLowerCase("en-US");
  if (/\.(?:rdata|rda|rds)$/u.test(lower)) {
    throw new DatasetInspectionError(
      "R_WORKSPACE_REJECTED",
      "R workspace formats are not accepted by the TypeScript product boundary.",
    );
  }
  if (lower.endsWith(".ena3d.json")) {
    const artifact = await decodeEna3dExchangeV1WithSha256(bytes, options.exchangeLimits);
    const tableNames = ["meta_data", "points", "line_weights", "nodes", "adjacency_key"] as const;
    return Object.freeze({
      schemaVersion: "3dena.dataset-inspection.v1",
      kind: "prepared-exchange",
      receipt: Object.freeze({
        name,
        format: "ena3d-json",
        sha256: artifact.sha256,
        byteLength: artifact.byteLength,
      }),
      inventory: Object.freeze({
        dimensions: Object.freeze([...artifact.exchange.dimensions]),
        groupVariables: Object.freeze([...artifact.exchange.group_variables]),
        tables: Object.freeze(tableNames.map((tableName) => Object.freeze(tableShape(artifact, tableName)))),
      }),
      artifact,
    }) as ExchangeDatasetInspectionV1;
  }
  if (!/\.(?:csv|xlsx|xls)$/u.test(lower)) {
    throw new DatasetInspectionError(
      "UNSUPPORTED_FORMAT",
      "Supported dataset formats are CSV, XLSX, XLS, and strict .ena3d.json.",
    );
  }
  const inventory = await inspectTabularSource({ name, bytes }, options.tabular);
  return Object.freeze({
    schemaVersion: "3dena.dataset-inspection.v1",
    kind: "tabular",
    inventory,
  });
}
