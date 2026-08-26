export interface ContainerScanDocumentInput {
  readonly expectedPublicKeyRegistrySha256: string;
  readonly imageRef: string;
  readonly inspect: unknown;
  readonly publicKeyRegistryBytes: Uint8Array;
  readonly publicKeyVerification: unknown;
  readonly sourceHeadCommit: string;
  readonly trivyJson: unknown;
}

export interface VerifiedContainerScanner {
  readonly name: "Trivy";
  readonly fullName: "Trivy Vulnerability Scanner";
  readonly informationUri: "https://github.com/aquasecurity/trivy";
  readonly version: "0.70.0";
  readonly artifactName: string;
  readonly artifactType: "container_image";
  readonly targetCount: number;
  readonly resultCount: 0;
}

export interface VerifiedContainerImage {
  readonly digest: string;
  readonly sourceRepository: "https://github.com/HUDongpin/j-3dENA";
  readonly sourceHeadCommit: string;
  readonly user: "10001:10001";
  readonly os: "linux";
  readonly architecture: "amd64" | "arm64";
  readonly entrypoint: readonly ["/usr/local/bin/compute-entrypoint"];
  readonly command: readonly ["api"];
  readonly healthcheck: Readonly<{
    test: readonly ["CMD", "node", "-e", string];
    intervalNanoseconds: 15_000_000_000;
    timeoutNanoseconds: 5_000_000_000;
    startPeriodNanoseconds: 10_000_000_000;
    retries: 3;
  }>;
  readonly bakedSensitiveEnvironmentVariables: 0;
  readonly publicKeyRegistrySha256: string;
}

export interface VerifiedImagePublicKeyRegistry {
  readonly publicKeyCount: number;
  readonly sha256: string;
  readonly byteLength: number;
}

export interface VerifiedContainerScanDocuments {
  readonly scanner: VerifiedContainerScanner;
  readonly image: VerifiedContainerImage;
  readonly publicKeyRegistry: VerifiedImagePublicKeyRegistry;
}

export interface ContainerScanReceiptOptions {
  readonly evidenceRoot: string;
  readonly expectedPublicKeyRegistrySha256: string;
  readonly imageRef: string;
  readonly inspect: string;
  readonly publicKeyRegistry: string;
  readonly publicKeyVerification: string;
  readonly repository: "HUDongpin/j-3dENA";
  readonly runAttempt: string;
  readonly runId: string;
  readonly sourceHeadCommit: string;
  readonly trivyJson: string;
}

export interface ContainerScanReceipt {
  readonly schemaVersion: "3dena.container-scan-receipt.v3";
  readonly status: "passed";
  readonly repository: "HUDongpin/j-3dENA";
  readonly runIdentity: Readonly<{ runId: string; runAttempt: string }>;
  readonly image: Omit<VerifiedContainerImage, "publicKeyRegistrySha256"> & Readonly<{
    ref: string;
    inspectPath: string;
    inspectSha256: string;
    inspectByteLength: number;
    publicKeyRegistry: Readonly<{
      expectedSha256: string;
      sha256: string;
      publicKeyCount: number;
      rawPath: string;
      rawSha256: string;
      rawByteLength: number;
      verificationPath: string;
      verificationSha256: string;
      verificationByteLength: number;
    }>;
  }>;
  readonly scanner: Pick<
    VerifiedContainerScanner,
    "name" | "fullName" | "informationUri" | "version"
  >;
  readonly scan: Readonly<{
    format: "trivy-json";
    artifactName: string;
    artifactType: "container_image";
    resultCount: 0;
    targetCount: number;
    reportPath: string;
    reportSha256: string;
    reportByteLength: number;
  }>;
}

export function inspectContainerScanEvidenceDocuments(
  input: ContainerScanDocumentInput,
): VerifiedContainerScanDocuments;

export function createContainerScanReceipt(
  options: ContainerScanReceiptOptions,
): ContainerScanReceipt;
