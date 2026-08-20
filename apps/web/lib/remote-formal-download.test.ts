// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ANALYSIS_CONTRACT_VERSION_V1,
  analyzeRows,
  hashAnalysisValueV1,
  type AnalysisResultEnvelopeV1,
} from "@3dena/analysis";
import { createRemoteFormalDownload } from "./remote-formal-download";

function uint16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function uint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function zipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const end = bytes.byteLength - 22;
  expect(uint32(bytes, end)).toBe(0x0605_4b50);
  const count = uint16(bytes, end + 10);
  let cursor = uint32(bytes, end + 16);
  const entries = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index += 1) {
    expect(uint32(bytes, cursor)).toBe(0x0201_4b50);
    const compressedBytes = uint32(bytes, cursor + 20);
    const nameBytes = uint16(bytes, cursor + 28);
    const extraBytes = uint16(bytes, cursor + 30);
    const commentBytes = uint16(bytes, cursor + 32);
    const localOffset = uint32(bytes, cursor + 42);
    const path = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameBytes));
    const localNameBytes = uint16(bytes, localOffset + 26);
    const localExtraBytes = uint16(bytes, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameBytes + localExtraBytes;
    entries.set(path, bytes.slice(dataOffset, dataOffset + compressedBytes));
    cursor += 46 + nameBytes + extraBytes + commentBytes;
  }
  return entries;
}

async function fixture() {
  const result = analyzeRows({
    rows: [
      { group: "A", participant: "p1", time: "T1", A: 1, B: 1, C: 0 },
      { group: "A", participant: "p2", time: "T1", A: 1, B: 0, C: 1 },
      { group: "B", participant: "p3", time: "T1", A: 0, B: 1, C: 1 },
      { group: "B", participant: "p4", time: "T1", A: 1, B: 1, C: 1 },
    ],
    mapping: {
      units: ["group", "participant"],
      conversation: ["time"],
      codes: ["A", "B", "C"],
    },
    config: {
      model: "EndPoint",
      window: "MovingStanzaWindow",
      weightBy: "binary",
      windowSizeBack: 4,
      windowSizeForward: 0,
      centerAlignToOrigin: true,
    },
  });
  const resultHash = await hashAnalysisValueV1(result);
  const owner = {
    contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
    datasetHash: "1".repeat(64),
    specHash: "2".repeat(64),
    runId: "remote-run-1",
    taskId: "job-remote-1",
  } as const;
  const envelope: AnalysisResultEnvelopeV1<typeof result> = {
    schemaVersion: "3dena.analysis-result-envelope.v1",
    owner,
    taskKind: "ena-model",
    result,
    diagnostics: [],
    evidence: {
      schemaVersion: "3dena.evidence-stamp.v1",
      scope: "feature",
      status: "IMPLEMENTED_UNVERIFIED",
      datasetHash: owner.datasetHash,
      specHash: owner.specHash,
      buildId: "fly-build-1",
      approvedForParity: false,
    },
    provenance: {
      schemaVersion: "3dena.provenance-manifest.v1",
      datasetHash: owner.datasetHash,
      specHash: owner.specHash,
      resultHash,
      adapterVersion: "test-adapter",
      jenaPackage: "jena-js",
      jenaVersion: "0.6.3",
      jenaCommit: "3".repeat(40),
      sourceKind: "raw-jena",
      jenaExecuted: true,
      sdkPackage: "@3dena/analysis",
      sdkVersion: "0.1.0",
      appVersion: "0.1.0",
      contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
      buildId: "fly-build-1",
      seed: null,
      toleranceContract: null,
      schemaVersions: [
        "3dena.analysis-result-envelope.v1",
        "3dena.analysis-result.v1",
      ],
      generatedAt: "2026-08-21T00:00:00.000Z",
    },
  };
  const exactBytes = new TextEncoder().encode(JSON.stringify(envelope));
  const exactHash = createHash("sha256").update(exactBytes).digest("hex");
  const receipt = {
    schemaVersion: "3dena.dataset-receipt.v1" as const,
    sha256: owner.datasetHash,
    byteLength: 100,
    format: "csv" as const,
    sheet: null,
    rows: 4,
    columns: 6,
    schema: {
      schemaVersion: "3dena.dataset-schema.v1" as const,
      headers: ["group", "participant", "time", "A", "B", "C"],
      columns: [
        { name: "group", inferredType: "string" as const, roles: ["unit", "group"] as const },
        { name: "participant", inferredType: "string" as const, roles: ["unit"] as const },
        { name: "time", inferredType: "string" as const, roles: ["conversation", "time"] as const },
        { name: "A", inferredType: "number" as const, roles: ["code"] as const },
        { name: "B", inferredType: "number" as const, roles: ["code"] as const },
        { name: "C", inferredType: "number" as const, roles: ["code"] as const },
      ].map((column) => ({ ...column, roles: [...column.roles] })),
    },
    limits: {
      schemaVersion: "3dena.dataset-limits.v1" as const,
      maxFileBytes: 1_000,
      maxWorksheets: 1,
      maxRows: 100,
      maxColumns: 20,
      maxCells: 2_000,
    },
    warnings: [],
    activationIdentity: "activation:sha256:" + "4".repeat(64),
  };
  const approvedBuild = {
    approvalManifestSha256: "5".repeat(64),
    releaseId: "release-20260821",
    gitCommit: "6".repeat(40),
    webBuildId: "web-build-1",
    flyImageDigest: `sha256:${"7".repeat(64)}`,
    flyBuildId: "fly-build-1",
  } as const;
  return {
    verified: {
      envelope,
      exactBytes: Uint8Array.from(exactBytes),
      reference: {
        schemaVersion: "3dena.job-result-reference.v1" as const,
        jobId: owner.taskId,
        sha256: exactHash,
        byteLength: exactBytes.byteLength,
        resultUrl: "https://objects.example.test/result.json",
        exportUrl: null,
        expiresAt: "2026-08-22T00:00:00.000Z",
      },
    },
    activeDataset: {
      workflowId: "dataset-remote-1",
      activationIdentity: receipt.activationIdentity,
      receipt,
    },
    approvedBuild,
    currentWebBuildId: approvedBuild.webBuildId,
  };
}

describe("remote formal download", () => {
  it("contains deterministic formal CSV/manifest plus exact result and approval receipts", async () => {
    const options = await fixture();
    const first = await createRemoteFormalDownload(options);
    const second = await createRemoteFormalDownload(options);
    expect([...first.bytes]).toEqual([...second.bytes]);
    const outer = zipEntries(first.bytes);
    expect([...outer.keys()].sort()).toEqual([
      "formal/formal-scientific-export.zip",
      "receipts/remote-execution-receipt.json",
      "receipts/verified-result-artifact.json",
    ]);
    const formal = zipEntries(outer.get("formal/formal-scientific-export.zip")!);
    expect(formal.has("manifest.json")).toBe(true);
    expect([...formal.keys()].some((path) => path.endsWith(".csv"))).toBe(true);
    const receipt = JSON.parse(new TextDecoder().decode(
      outer.get("receipts/remote-execution-receipt.json"),
    )) as Record<string, unknown>;
    expect(receipt).toMatchObject({
      formalScientificExport: true,
      sourceKind: "raw-jena",
      jenaExecuted: true,
      buildApproval: {
        approvalManifestSha256: options.approvedBuild.approvalManifestSha256,
        flyImageDigest: options.approvedBuild.flyImageDigest,
      },
    });
    expect(JSON.stringify(receipt)).not.toContain("resultUrl");
  });

  it("fails closed for a mixed Web/build approval identity", async () => {
    const options = await fixture();
    await expect(createRemoteFormalDownload({
      ...options,
      currentWebBuildId: "different-web-build",
    })).rejects.toThrow(/Web build/u);
  });
});
