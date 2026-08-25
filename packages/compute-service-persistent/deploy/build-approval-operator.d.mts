export interface BuildApprovalOperatorInputV1 {
  readonly schemaVersion: "3dena.build-approval-operator.v1";
  readonly operation: "activate" | "verify";
  readonly environment: "preview" | "production";
  readonly migrationConfigPath: string;
  readonly migrationConfigSha256: string;
  readonly signedApprovalPath: string;
  readonly signedApprovalSha256: string;
  readonly publicKeysPath: string;
  readonly publicKeysSha256: string;
}

export interface BuildApprovalOperatorExpectedDigestsV1 {
  readonly expectedConfigSha256: string;
  readonly expectedSignedApprovalSha256: string;
  readonly expectedPublicKeyRegistrySha256: string;
}

export interface OperatorReadSnapshotV1 {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}

export interface BuildApprovalOperatorResultV1 {
  readonly schemaVersion: "3dena.build-approval-operator-result.v1";
  readonly operation: "activate" | "verify";
  readonly environment: "preview" | "production";
  readonly approvalManifestSha256: string;
  readonly verified: true;
}

export interface BuildApprovalOperatorClientV1 {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<Readonly<{
    rows: readonly Record<string, unknown>[];
    rowCount: number;
  }>>;
  end(): Promise<void>;
}

export interface BuildApprovalReviewerKeyV1 {
  readonly algorithm: "Ed25519";
  readonly allowedEnvironments: readonly ("preview" | "production")[];
  readonly publicKeyPem: string;
  readonly reviewerId: string;
  readonly role: "independent-reviewer";
}

export interface BuildApprovalVerificationV1 {
  readonly schemaVersion: "3dena.build-approval-verification.v1";
  readonly approval: Readonly<Record<string, unknown> & {
    readonly candidate: Readonly<Record<string, unknown>>;
  }>;
  readonly publicKeyRegistry: Readonly<{
    readonly sha256: string;
    readonly publicKeyId: string;
    readonly algorithm: "Ed25519";
    readonly allowedEnvironments: readonly ("preview" | "production")[];
    readonly reviewerId: string;
    readonly role: "independent-reviewer";
  }>;
  readonly verified: true;
}

export interface IndependentReviewerSignatureVerificationInputV1 {
  readonly canonicalPayloadBytes: Uint8Array;
  readonly signatureBase64: string;
  readonly publicKeyId: string;
  readonly reviewerId: string;
  readonly environment: "preview" | "production";
  readonly implementationActorIds: readonly string[];
  readonly publicKeyRegistryBytes: Uint8Array;
  readonly expectedPublicKeyRegistrySha256: string;
}

export interface IndependentReviewerSignatureVerificationV1 {
  readonly schemaVersion: "3dena.independent-reviewer-signature-verification.v1";
  readonly environment: "preview" | "production";
  readonly reviewerId: string;
  readonly publicKeyRegistry: BuildApprovalVerificationV1["publicKeyRegistry"];
  readonly verified: true;
}

export type BuildApprovalOperatorConnectorV1 = (
  connectionString: string,
) => Promise<BuildApprovalOperatorClientV1>;

export function verifyBuildApprovalBundle(
  signedApprovalBytes: Uint8Array,
  publicKeyRegistryBytes: Uint8Array,
  expectedPublicKeyRegistrySha256: string,
): BuildApprovalVerificationV1;

export function verifyIndependentReviewerSignature(
  input: IndependentReviewerSignatureVerificationInputV1,
): IndependentReviewerSignatureVerificationV1;

export function operatorReadSnapshotIsStable(
  before: OperatorReadSnapshotV1,
  after: OperatorReadSnapshotV1,
  current: OperatorReadSnapshotV1,
  byteLength: number,
): boolean;

export function loadBuildApprovalOperatorInput(
  sourceRoot: string,
  configPath: string,
  expectedDigests: BuildApprovalOperatorExpectedDigestsV1,
  environment?: Readonly<Record<string, string | undefined>>,
): Promise<Readonly<{
  input: BuildApprovalOperatorInputV1;
  migrations: readonly Readonly<{ readonly version: string; readonly sha256: string }>[];
  migrationManifestSha256: string;
  connectionString: string;
  approval: Readonly<Record<string, unknown>>;
  publicKeys: ReadonlyMap<string, BuildApprovalReviewerKeyV1>;
}>>;

export function runBuildApprovalOperator(
  sourceRoot: string,
  configPath: string,
  expectedDigests: BuildApprovalOperatorExpectedDigestsV1,
  connect?: BuildApprovalOperatorConnectorV1,
  environment?: Readonly<Record<string, string | undefined>>,
): Promise<BuildApprovalOperatorResultV1>;

export function runBuildApprovalOperatorCli(
  sourceRoot: string,
  configPath: string | undefined,
  expectedDigests: BuildApprovalOperatorExpectedDigestsV1 | undefined,
  options?: Readonly<{
    connect?: BuildApprovalOperatorConnectorV1;
    environment?: Readonly<Record<string, string | undefined>>;
    writeStdout?: (value: string) => unknown;
    writeStderr?: (value: string) => unknown;
  }>,
): Promise<0 | 1>;
