import {
  createExportBundle,
  type AnalysisResult,
} from "@3dena/analysis";
import { createDeterministicZip } from "@3dena/export";
import type { ApprovedRemoteBuildIdentity } from "./execution-policy";
import type { VerifiedRemoteAnalysisResult } from "./remote-analysis-runtime";
import type { RemoteActiveDataset } from "./remote-dataset-workflow";

const ENCODER = new TextEncoder();

export interface CreateRemoteFormalDownloadOptions {
  readonly verified: VerifiedRemoteAnalysisResult;
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
  const { envelope, reference, exactBytes } = verified;
  if (currentWebBuildId !== approvedBuild.webBuildId) {
    throw new Error("The Web build does not match the active build approval.");
  }
  if (envelope.taskKind !== "ena-model"
      || envelope.result.schemaVersion !== "3dena.analysis-result.v1") {
    throw new Error("A standalone formal download requires a verified ENA source result.");
  }
  if (envelope.owner.datasetHash !== activeDataset.receipt.sha256
      || envelope.provenance.datasetHash !== envelope.owner.datasetHash
      || envelope.provenance.specHash !== envelope.owner.specHash
      || envelope.provenance.buildId !== approvedBuild.flyBuildId
      || envelope.provenance.sourceKind !== "raw-jena"
      || envelope.provenance.jenaExecuted !== true) {
    throw new Error("The verified result is not bound to the active dataset and approved compute build.");
  }
  if (reference.byteLength !== exactBytes.byteLength
      || reference.sha256 !== await sha256(exactBytes)) {
    throw new Error("The exact result artifact no longer matches its verified receipt.");
  }

  const scientific = await createExportBundle(
    envelope.result as AnalysisResult,
    {
      provenance: envelope.provenance,
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
    buildApproval: {
      ...approvedBuild,
      currentWebBuildId,
    },
    provenance: envelope.provenance,
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
      path: "receipts/verified-result-artifact.json",
      data: Uint8Array.from(exactBytes),
    },
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
