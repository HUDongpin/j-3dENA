export interface CapacityOperatorInputV1 {
  readonly schemaVersion: "3dena.compute-capacity-operator.v1";
  readonly operation: "apply" | "verify";
  readonly expectedCapacity: number;
  readonly migrationConfigPath: string;
  readonly migrationConfigSha256: string;
  readonly buildReadiness: Readonly<{
    readonly environment: "preview" | "production";
    readonly approvalManifestSha256: string;
    readonly publicKeysPath: string;
    readonly publicKeysSha256: string;
  }>;
}

export interface CapacityOperatorExpectedDigestsV1 {
  readonly expectedConfigSha256: string;
  readonly expectedApprovalManifestSha256: string;
  readonly expectedPublicKeyRegistrySha256: string;
}

export interface CapacityOperatorResultV1 {
  readonly schemaVersion: "3dena.compute-capacity-operator-result.v1";
  readonly operation: "apply" | "verify";
  readonly expectedCapacity: number;
  readonly verified: true;
}

export interface CapacityOperatorClientV1 {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<Readonly<{
    rows: readonly Record<string, unknown>[];
    rowCount: number;
  }>>;
  end(): Promise<void>;
}

export type CapacityOperatorConnectorV1 = (
  connectionString: string,
) => Promise<CapacityOperatorClientV1>;

export function loadCapacityOperatorInput(
  sourceRoot: string,
  configPath: string,
  expectedDigests: CapacityOperatorExpectedDigestsV1,
  environment?: Readonly<Record<string, string | undefined>>,
): Promise<Readonly<{
  input: CapacityOperatorInputV1;
  migrations: readonly Readonly<{ readonly version: string; readonly sha256: string }>[];
  migrationManifestSha256: string;
  connectionString: string;
  publicKeys: Readonly<{
    entries: ReadonlyMap<string, Readonly<{
      algorithm: "Ed25519";
      allowedEnvironments: readonly ("preview" | "production")[];
      publicKeyPem: string;
      reviewerId: string;
      role: "independent-reviewer";
    }>>;
    sha256: string;
  }>;
}>>;

export function runCapacityOperator(
  sourceRoot: string,
  configPath: string,
  expectedDigests: CapacityOperatorExpectedDigestsV1,
  connect?: CapacityOperatorConnectorV1,
  environment?: Readonly<Record<string, string | undefined>>,
): Promise<CapacityOperatorResultV1>;

export function runCapacityOperatorCli(
  sourceRoot: string,
  configPath: string | undefined,
  expectedDigests: CapacityOperatorExpectedDigestsV1 | undefined,
  options?: Readonly<{
    connect?: CapacityOperatorConnectorV1;
    environment?: Readonly<Record<string, string | undefined>>;
    writeStdout?: (value: string) => unknown;
    writeStderr?: (value: string) => unknown;
  }>,
): Promise<0 | 1>;
