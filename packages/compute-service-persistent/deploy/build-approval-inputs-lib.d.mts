export const MATERIALIZATION_INPUT_VERSION:
  "3dena.build-approval-materialization-input.v1";
export const MATERIALIZATION_MANIFEST_VERSION:
  "3dena.build-approval-materialization-manifest.v1";
export const PUBLIC_KEY_MATERIALIZATION_INPUT_VERSION:
  "3dena.build-approval-public-key-materialization-input.v1";
export const PUBLIC_KEY_MATERIALIZATION_MANIFEST_VERSION:
  "3dena.build-approval-public-key-materialization-manifest.v1";
export const SCHEMA_BUNDLE_VERSION:
  "3dena.build-approval-schema-bundle.v1";
export const MAX_PUBLIC_KEY_REGISTRY_BYTES: number;

export interface BuildApprovalArtifactBoundsV1 {
  readonly schemaVersion: "3dena.build-approval-artifact-bounds.v1";
  readonly analysisTarball: number;
  readonly jenaTarball: number;
  readonly lockfile: number;
  readonly sbom: number;
  readonly migration: number;
  readonly schemaIndex: number;
  readonly schemaDocument: number;
  readonly schemaBundle: number;
  readonly candidateInput: number;
  readonly materializationInput: number;
  readonly materializationManifest: number;
  readonly publicKeyRegistry: number;
}

export const BUILD_APPROVAL_ARTIFACT_BOUNDS_V1:
  Readonly<BuildApprovalArtifactBoundsV1>;

export interface BuildApprovalExplicitFile {
  readonly path: string;
  readonly sha256: string;
}

export interface BuildApprovalMigrationFile extends BuildApprovalExplicitFile {
  readonly version: string;
}

export interface BuildApprovalSchemaFile extends BuildApprovalExplicitFile {
  readonly name: string;
}

export interface BuildApprovalCandidateSourceInputV1 {
  readonly releaseId: string;
  readonly environment: "preview" | "production";
  readonly gitCommit: string;
  readonly vercelDeploymentId: string;
  readonly vercelBuildId: string;
  readonly flyImageDigest: string;
  readonly flyBuildId: string;
  readonly jenaVersion: string;
  readonly jenaCommit: string;
  readonly sdkVersion: string;
  readonly buildId: string;
  readonly migrations: readonly BuildApprovalMigrationFile[];
  readonly contractVersions: readonly string[];
  readonly implementationActorIds: readonly string[];
  readonly artifacts: Readonly<{
    analysisTarball: BuildApprovalExplicitFile;
    jenaTarball: BuildApprovalExplicitFile;
    lockfile: BuildApprovalExplicitFile;
    sbom: BuildApprovalExplicitFile;
  }>;
}

export interface BuildApprovalMaterializationInputV1 {
  readonly schemaVersion: typeof MATERIALIZATION_INPUT_VERSION;
  readonly candidate: BuildApprovalCandidateSourceInputV1;
  readonly schemaBundle: Readonly<{
    index: BuildApprovalExplicitFile;
    schemas: readonly BuildApprovalSchemaFile[];
  }>;
  readonly publicKeyRegistry: BuildApprovalExplicitFile;
}

export interface BuildApprovalMaterializationOutputsV1 {
  readonly candidateInput: BuildApprovalExplicitFile;
  readonly schemaBundle: BuildApprovalExplicitFile;
}

export interface BuildApprovalMaterializationManifestV1 {
  readonly schemaVersion: typeof MATERIALIZATION_MANIFEST_VERSION;
  readonly input: BuildApprovalMaterializationInputV1;
  readonly outputs: BuildApprovalMaterializationOutputsV1;
}

export interface BuildApprovalPublicKeySourceV1 extends BuildApprovalExplicitFile {
  readonly publicKeyId: string;
  readonly allowedEnvironments: readonly ("preview" | "production")[];
  readonly reviewerId: string;
  readonly role: "independent-reviewer";
}

export interface BuildApprovalPublicKeyMaterializationInputV1 {
  readonly schemaVersion: typeof PUBLIC_KEY_MATERIALIZATION_INPUT_VERSION;
  readonly publicKeys: readonly BuildApprovalPublicKeySourceV1[];
}

export interface BuildApprovalPublicKeyMaterializationOutputsV1 {
  readonly publicKeyRegistry: BuildApprovalExplicitFile;
}

export interface BuildApprovalPublicKeyMaterializationManifestV1 {
  readonly schemaVersion: typeof PUBLIC_KEY_MATERIALIZATION_MANIFEST_VERSION;
  readonly input: BuildApprovalPublicKeyMaterializationInputV1;
  readonly outputs: BuildApprovalPublicKeyMaterializationOutputsV1;
}

export interface PreparedBuildApprovalInputsV1 {
  readonly outputDirectory: string;
  readonly files: Readonly<Record<string, string>>;
  readonly manifest: BuildApprovalMaterializationManifestV1;
}

export interface PreparedBuildApprovalPublicKeysV1 {
  readonly outputDirectory: string;
  readonly files: Readonly<Record<string, string>>;
  readonly manifest: BuildApprovalPublicKeyMaterializationManifestV1;
}

export function canonical(value: unknown, path?: string): string;

export function readBuildApprovalSourceFile(
  sourceRoot: string,
  requestedPath: string,
  path: string,
  maximumBytes?: number,
  maximumDescription?: string,
): Promise<Buffer>;

export function writeNewBuildApprovalFile(
  sourceRoot: string,
  requestedPath: string,
  text: string,
): Promise<void>;

export function writePreparedBuildApprovalOutput(
  prepared: PreparedBuildApprovalInputsV1 | PreparedBuildApprovalPublicKeysV1,
  sourceRoot: string,
): Promise<void>;

export function validateBuildApprovalPublicKeyRegistryBytes(
  bytes: Uint8Array,
  path: string,
): void;

export function prepareBuildApprovalInputs(
  value: unknown,
  requestedOutputDirectory: string,
  sourceRoot: string,
): Promise<PreparedBuildApprovalInputsV1>;

export function prepareBuildApprovalPublicKeys(
  value: unknown,
  requestedOutputDirectory: string,
  sourceRoot: string,
): Promise<PreparedBuildApprovalPublicKeysV1>;

export function verifyBuildApprovalPublicKeys(
  manifestValue: unknown,
  manifestText: string,
  manifestRelativePath: string,
  sourceRoot: string,
): Promise<BuildApprovalPublicKeyMaterializationOutputsV1>;

export function verifyBuildApprovalInputs(
  manifestValue: unknown,
  manifestText: string,
  manifestRelativePath: string,
  sourceRoot: string,
): Promise<BuildApprovalMaterializationOutputsV1>;

export const BUILD_APPROVAL_INPUT_OUTPUT_NAMES: Readonly<{
  candidateInput: "build-approval-candidate-input.json";
  manifest: "build-approval-materialization-manifest.json";
  schemaBundle: "schema-bundle.json";
}>;

export const BUILD_APPROVAL_PUBLIC_KEY_OUTPUT_NAMES: Readonly<{
  manifest: "build-approval-public-keys-manifest.json";
  publicKeyRegistry: "build-approval-public-keys.json";
}>;
