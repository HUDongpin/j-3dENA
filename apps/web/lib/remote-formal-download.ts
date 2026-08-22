import {
  createExportBundle,
  hashAnalysisValueV1,
  type AnalysisResult,
  type AnalysisExportPortfolioV1,
  type PreparedSpaceResult,
} from "@3dena/analysis";
import { createDeterministicZip } from "@3dena/export";
import type { ApprovedRemoteBuildIdentity } from "./execution-policy";
import type { VerifiedRemoteAnalysisResult } from "./remote-analysis-runtime";
import type { RemoteActiveDataset } from "./remote-dataset-workflow";

const ENCODER = new TextEncoder();

export interface CreateRemoteFormalDownloadOptions {
  readonly verified: VerifiedRemoteAnalysisResult;
  readonly sourceVerified?: VerifiedRemoteAnalysisResult;
  readonly activeDataset: RemoteActiveDataset;
  readonly approvedBuild: ApprovedRemoteBuildIdentity;
  readonly currentWebBuildId: string;
}

export interface RemoteFormalDownload {
  readonly schemaVersion: "3dena.remote-formal-download.v1";
  readonly fileName: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly sha256: string;
  readonly byteLength: number;
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function jsonBytes(value: unknown): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(ENCODER.encode(`${JSON.stringify(value, null, 2)}\n`));
}

function safeRunId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_-]/gu, "-").slice(0, 100);
  return normalized || "remote-run";
}

/**
 * Builds the formal remote product download. The nested scientific bundle owns
 * the stable CSV/manifest contract; the outer ZIP adds the exact verified
 * service artifact and an approval-bound execution receipt without signed URLs
 * or capability tokens.
 */
export async function createRemoteFormalDownload(
  options: CreateRemoteFormalDownloadOptions,
): Promise<RemoteFormalDownload> {
  const { verified, activeDataset, approvedBuild, currentWebBuildId } = options;
  const sourceVerified = options.sourceVerified ?? verified;
  const { envelope, reference, exactBytes } = verified;
  const sourceEnvelope = sourceVerified.envelope;
  if (currentWebBuildId !== approvedBuild.webBuildId) {
    throw new Error("The Web build does not match the active build approval.");
  }
  const rawSource = sourceEnvelope.taskKind === "ena-model"
    && sourceEnvelope.result.schemaVersion === "3dena.analysis-result.v1";
  const preparedSource = sourceEnvelope.taskKind === "prepared-import"
    && sourceEnvelope.result.schemaVersion === "3dena.prepared-space-result.v1";
  if (!rawSource && !preparedSource) {
    throw new Error("A formal remote download requires a verified primary scientific source result.");
  }
  const expectedSourceKind = rawSource ? "raw-jena" : "prepared-exchange";
  const expectedJenaExecuted = rawSource;
  const primaryTask = envelope.taskKind === "ena-model" || envelope.taskKind === "prepared-import";
  if (sourceEnvelope.owner.datasetHash !== activeDataset.receipt.sha256
      || sourceEnvelope.provenance.datasetHash !== sourceEnvelope.owner.datasetHash
      || sourceEnvelope.provenance.specHash !== sourceEnvelope.owner.specHash
      || sourceEnvelope.provenance.buildId !== approvedBuild.flyBuildId
      || sourceEnvelope.provenance.sourceKind !== expectedSourceKind
      || sourceEnvelope.provenance.jenaExecuted !== expectedJenaExecuted
      || envelope.owner.datasetHash !== sourceEnvelope.owner.datasetHash
      || envelope.provenance.datasetHash !== envelope.owner.datasetHash
      || envelope.provenance.specHash !== envelope.owner.specHash
      || envelope.provenance.buildId !== approvedBuild.flyBuildId
      || envelope.provenance.sourceKind !== expectedSourceKind
      || envelope.provenance.jenaExecuted !== expectedJenaExecuted
      || (!primaryTask
        && verified.sourceResultHash !== sourceEnvelope.provenance.resultHash)) {
    throw new Error("The verified task and scientific source are not bound to the active dataset and approved compute build.");
  }
  if (reference.byteLength !== exactBytes.byteLength
      || reference.sha256 !== await sha256(exactBytes)) {
    throw new Error("The exact result artifact no longer matches its verified receipt.");
  }
  if (sourceVerified.reference.byteLength !== sourceVerified.exactBytes.byteLength
      || sourceVerified.reference.sha256 !== await sha256(sourceVerified.exactBytes)) {
    throw new Error("The exact scientific source artifact no longer matches its verified receipt.");
  }

  const sourceAnalysis = sourceEnvelope.result as AnalysisResult | PreparedSpaceResult;
  let scientificInput: AnalysisResult | PreparedSpaceResult | AnalysisExportPortfolioV1 = sourceAnalysis;
  if (!primaryTask) {
    const portfolio: AnalysisExportPortfolioV1 = {
      schemaVersion: "3dena.analysis-export-portfolio.v1",
      analysis: sourceAnalysis,
    };
    if (envelope.result.schemaVersion === "3dena.network-comparison.v1") portfolio.comparison = envelope.result;
    else if (envelope.result.schemaVersion === "3dena.change-network.v1") portfolio.change = envelope.result;
    else if (envelope.result.schemaVersion === "3dena.statistics-task-result.v1") portfolio.statistics = envelope.result;
    else if (envelope.result.schemaVersion === "3dena.trajectory-dynamics.v1"
        || envelope.result.schemaVersion === "3dena.trajectory-path-statistics.v1") portfolio.trajectory = envelope.result;
    else if (envelope.result.schemaVersion === "3dena.trajectory-comparison.v1") portfolio.trajectoryComparison = envelope.result;
    else if (envelope.result.schemaVersion === "3dena.trajectory-bootstrap.v1") portfolio.bootstrap = envelope.result;
    else throw new Error("The verified derived result is not supported by the formal export portfolio.");
    scientificInput = portfolio;
  }
  const exportProvenance = {
    ...envelope.provenance,
    resultHash: await hashAnalysisValueV1(scientificInput),
    schemaVersions: [...new Set([
      ...sourceEnvelope.provenance.schemaVersions,
      ...envelope.provenance.schemaVersions,
      scientificInput.schemaVersion,
    ])],
  };
  const scientific = await createExportBundle(
    scientificInput,
    {
      provenance: exportProvenance,
      fileName: `3dena-scientific-${safeRunId(envelope.owner.runId)}.zip`,
    },
  );
  const receipt = {
    schemaVersion: "3dena.remote-execution-download-receipt.v1",
    formalScientificExport: true,
    displayFilteringApplied: false,
    taskKind: envelope.taskKind,
    sourceKind: envelope.provenance.sourceKind,
    jenaExecuted: envelope.provenance.jenaExecuted,
    owner: envelope.owner,
    activation: {
      workflowId: activeDataset.workflowId,
      activationIdentity: activeDataset.activationIdentity,
      datasetReceipt: activeDataset.receipt,
    },
    verifiedResultArtifact: {
      schemaVersion: "3dena.verified-result-object-receipt.v1",
      sha256: reference.sha256,
      byteLength: reference.byteLength,
      expiresAt: reference.expiresAt,
    },
    verifiedSourceArtifact: {
      schemaVersion: "3dena.verified-source-result-object-receipt.v1",
      taskKind: sourceEnvelope.taskKind,
      owner: sourceEnvelope.owner,
      resultHash: sourceEnvelope.provenance.resultHash,
      sha256: sourceVerified.reference.sha256,
      byteLength: sourceVerified.reference.byteLength,
      expiresAt: sourceVerified.reference.expiresAt,
    },
    sourceResultBinding: primaryTask ? null : {
      schemaVersion: "3dena.verified-source-result-binding.v1",
      sourceResultHash: verified.sourceResultHash,
    },
    buildApproval: {
      ...approvedBuild,
      currentWebBuildId,
    },
    provenance: exportProvenance,
    scientificBundle: {
      schemaVersion: scientific.schemaVersion,
      fileName: scientific.fileName,
      sha256: scientific.sha256,
      byteLength: scientific.byteLength,
      manifest: scientific.manifest,
    },
  } as const;
  const bytes = createDeterministicZip([
    {
      path: "formal/formal-scientific-export.zip",
      data: Uint8Array.from(scientific.bytes),
    },
    {
      path: "receipts/remote-execution-receipt.json",
      data: jsonBytes(receipt),
    },
    {
      path: primaryTask
        ? "receipts/verified-source-result-artifact.json"
        : "receipts/verified-derived-result-artifact.json",
      data: Uint8Array.from(exactBytes),
    },
    ...(primaryTask ? [] : [{
      path: "receipts/verified-source-result-artifact.json",
      data: Uint8Array.from(sourceVerified.exactBytes),
    }]),
  ]);
  return Object.freeze({
    schemaVersion: "3dena.remote-formal-download.v1",
    fileName: `3dena-remote-${safeRunId(envelope.owner.runId)}.zip`,
    bytes,
    sha256: await sha256(bytes),
    byteLength: bytes.byteLength,
  });
}

export function downloadRemoteFormalBundle(bundle: RemoteFormalDownload): void {
  const url = URL.createObjectURL(new Blob([bundle.bytes], { type: "application/zip" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = bundle.fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
