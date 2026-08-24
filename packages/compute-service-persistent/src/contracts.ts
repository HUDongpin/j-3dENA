import type {
  ComputeJobRecordV1,
  LeaseTokenV1,
} from "@3dena/compute-service-core";

export const BUILD_APPROVAL_CANDIDATE_VERSION =
  "3dena.build-approval-candidate.v3" as const;
export const BUILD_APPROVAL_VERSION = "3dena.build-approval.v3" as const;
export const BUILD_APPROVAL_REGISTRY_VERSION =
  "3dena.build-approval-registry.v1" as const;
export const PERSISTENT_LEASE_CLAIM_VERSION =
  "3dena.persistent-lease-claim.v1" as const;
export const RECOVERY_RECEIPT_VERSION =
  "3dena.compute-recovery-receipt.v1" as const;
export const RECOVERY_RECEIPT_VERSION_V2 =
  "3dena.compute-recovery-receipt.v2" as const;
export const OBJECT_DELETION_PROBE_VERSION =
  "3dena.object-deletion-probe.v1" as const;
export const ORPHAN_RECONCILIATION_RECEIPT_VERSION =
  "3dena.orphan-reconciliation-receipt.v1" as const;
export const TERMINATION_RECONCILIATION_RECEIPT_VERSION =
  "3dena.termination-reconciliation-receipt.v1" as const;
export const EXTERNAL_TERMINATION_OBSERVATION_VERSION =
  "3dena.external-termination-observation.v1" as const;

export interface BuildApprovalCandidateV1 {
  readonly version: typeof BUILD_APPROVAL_CANDIDATE_VERSION;
  readonly releaseId: string;
  readonly environment: "preview" | "production";
  readonly gitCommit: string;
  readonly vercelDeploymentId: string;
  readonly vercelBuildId: string;
  readonly flyImageDigest: string;
  readonly flyBuildId: string;
  readonly analysisTarballSha256: string;
  readonly jenaVersion: string;
  readonly jenaCommit: string;
  readonly jenaTarballSha256: string;
  readonly jenaTarballIntegrity: string;
  readonly sdkVersion: string;
  readonly buildId: string;
  readonly lockfileSha256: string;
  readonly sbomSha256: string;
  readonly schemaBundleSha256: string;
  readonly migrationManifestSha256: string;
  readonly contractVersions: readonly string[];
  /** All implementation actors bound into the signed candidate manifest. */
  readonly implementationActorIds: readonly string[];
}

export interface BuildApprovalV1 {
  readonly version: typeof BUILD_APPROVAL_VERSION;
  readonly candidate: BuildApprovalCandidateV1;
  readonly approvalManifestSha256: string;
  readonly reviewerId: string;
  readonly approvedAt: string;
  readonly publicKeyId: string;
  readonly signatureAlgorithm: "Ed25519";
  readonly signatureBase64: string;
}

export interface ExpectedRuntimeBuildV1 {
  readonly releaseId: string;
  readonly environment: BuildApprovalCandidateV1["environment"];
  readonly gitCommit: string;
  readonly vercelDeploymentId: string;
  readonly vercelBuildId: string;
  readonly flyImageDigest: string;
  readonly flyBuildId: string;
  readonly approvalManifestSha256: string;
  readonly migrationManifestSha256: string;
  readonly contractVersions: readonly string[];
  readonly jenaVersion: string;
  readonly jenaCommit: string;
  readonly jenaTarballIntegrity: string;
  readonly sdkVersion: string;
  readonly buildId: string;
}

export interface BuildApprovalRegistry {
  readonly version: typeof BUILD_APPROVAL_REGISTRY_VERSION;
  activate(approval: BuildApprovalV1): Promise<void>;
  revoke(
    approvalManifestSha256: string,
    revokedAt: string,
    actorId: string,
  ): Promise<void>;
  isActive(expected: ExpectedRuntimeBuildV1): Promise<boolean>;
}

export interface PersistentLeaseClaimV1 {
  readonly version: typeof PERSISTENT_LEASE_CLAIM_VERSION;
  readonly slot: number;
  readonly holderId: string;
  readonly taskId: string;
  readonly fencingEpoch: number;
  readonly lease: LeaseTokenV1;
  readonly record: ComputeJobRecordV1;
}

export interface PersistentLeaseCoordinatorV1 {
  claimNext(input: Readonly<{
    holderId: string;
    leaseId: string;
    durationMs: number;
  }>): Promise<PersistentLeaseClaimV1 | null>;
  heartbeat(
    claim: PersistentLeaseClaimV1,
    durationMs: number,
  ): Promise<PersistentLeaseClaimV1>;
  release(claim: PersistentLeaseClaimV1): Promise<boolean>;
  /** Atomically proves terminal/deleting job state and clears its exact fenced slot. */
  reconcileObservedTermination?(
    claim: PersistentLeaseClaimV1,
  ): Promise<boolean>;
  recoverExpiredClaims(): Promise<readonly RecoveryReceiptV2[]>;
}

export type RecoveryDisposition =
  | "ack_replayed"
  | "cancelled"
  | "expired"
  | "quarantined"
  | "requeued"
  | "timed_out";

export interface RecoveryReceiptV1 {
  readonly version: typeof RECOVERY_RECEIPT_VERSION;
  readonly taskRef: string;
  readonly previousLeaseEpoch: number;
  readonly fencingEpoch: number;
  readonly disposition: RecoveryDisposition;
  readonly recoveredAtMs: number;
}

export interface RecoveryReceiptV2 {
  readonly version: typeof RECOVERY_RECEIPT_VERSION_V2;
  readonly taskRef: string;
  readonly previousLeaseEpoch: number;
  readonly fencingEpoch: number;
  readonly disposition: RecoveryDisposition;
  readonly recoveredAtMs: number;
  readonly terminationObserved: boolean;
  readonly capacityReleased: boolean;
  readonly isolated: boolean;
}

export interface ObjectDeletionProbeV1 {
  readonly version: typeof OBJECT_DELETION_PROBE_VERSION;
  readonly objectRef: string;
  readonly requestedAtMs: number;
  readonly completedAtMs: number;
  readonly headAbsent: true;
  readonly getAbsent: true;
}

export interface OrphanReconciliationReceiptV1 {
  readonly version: typeof ORPHAN_RECONCILIATION_RECEIPT_VERSION;
  readonly objectRef: string;
  readonly providerUploadedAtMs: number;
  readonly discoveredAtMs: number;
  readonly completedAtMs: number;
  readonly ledgerAbsent: true;
  readonly headAbsent: true;
  readonly getAbsent: true;
}

export interface TerminationReconciliationReceiptV1 {
  readonly version: typeof TERMINATION_RECONCILIATION_RECEIPT_VERSION;
  readonly taskRef: string;
  readonly leaseEpoch: number;
  readonly fencingEpoch: number;
  readonly reconciledAtMs: number;
  readonly terminationObserved: true;
  readonly capacityReleased: true;
  readonly source:
    | "owning-worker"
    | "external-quarantine-reconcile"
    | "expired-claim-recovery";
}

export interface ExternalTerminationObservationV1 {
  readonly version: typeof EXTERNAL_TERMINATION_OBSERVATION_VERSION;
  readonly taskId: string;
  readonly executionId: string;
  readonly childId: string | null;
  readonly observedAtMs: number;
  readonly kind: "completed" | "crashed" | "terminated" | "launch_rejected";
  /** Opaque immutable receipt identifier supplied by the process platform. */
  readonly providerReceiptId: string;
}
