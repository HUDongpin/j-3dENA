import type { PreparedSpaceResult } from "@3dena/analysis";
import { describe, expect, it } from "vitest";
import {
  PREPARED_EXPORT_BUNDLE_PATHS,
  preparedCentroidCsv,
  preparedProvenanceJson,
  preparedResultBundle,
} from "@/lib/export-prepared-results";
import { PREPARED_EXCHANGE_MAPPING } from "@/lib/prepared-class1";

const result = {
  schemaVersion: "3dena.prepared-space-result.v1",
  sourceKind: "prepared-exchange",
  rawJenaRecompute: false,
  sourceReceipt: {
    name: "synthetic-prepared.ena3d.json",
    sha256: "a".repeat(64),
    byteLength: 1_536,
  },
  artifacts: {
    rotation: "not-present",
    eigenvalues: "not-present",
    variance: "not-present",
  },
  displaySpace: {
    dimensions: ["SVD1", "SVD2", "SVD3"],
    trajectory: {
      centroids: [
        {
          group: { canonical: "cohort:synthetic-alpha", display: "=Synthetic Alpha" },
          time: { canonical: "phase:warmup", display: "Warmup" },
          participantCount: 3,
          coordinates: [0.125, -0.25, 0.375],
        },
      ],
    },
  },
  summary: { points: 72 },
  provenance: {
    adapter: "@3dena/analysis",
    adapterVersion: "0.1.0",
    coordinateSpace: "precomputed-import",
    computation: "reduction-only",
    jenaExecuted: false,
    resolvedMapping: PREPARED_EXCHANGE_MAPPING,
  },
} as unknown as PreparedSpaceResult;

function signatureCount(bytes: Uint8Array, signature: readonly number[]): number {
  let count = 0;
  for (let index = 0; index <= bytes.length - signature.length; index += 1) {
    if (signature.every((byte, offset) => bytes[index + offset] === byte)) {
      count += 1;
    }
  }
  return count;
}

describe("prepared result exports", () => {
  it("exports prepared centroids and guards spreadsheet formulas", () => {
    const csv = preparedCentroidCsv(result);
    expect(csv).toContain(
      '"group_key","group_label","time_key","time_label","participant_count","SVD1","SVD2","SVD3"',
    );
    expect(csv).toContain("'=Synthetic Alpha");
    expect(csv).toContain('"0.125","-0.25","0.375"');
  });

  it("exports source, mapping, artifacts, ownership, and neutral evidence status", () => {
    const json = JSON.parse(
      preparedProvenanceJson(
        result,
        { datasetHash: "a".repeat(64), specHash: "b".repeat(64), runId: "run" },
      ),
    ) as Record<string, unknown>;

    expect(json).toMatchObject({
      schemaVersion: "3dena.prepared-export-provenance.v1",
      sourceKind: "prepared-exchange",
      rawJenaRecompute: false,
      artifacts: {
        rotation: "not-present",
        eigenvalues: "not-present",
        variance: "not-present",
      },
      analysisProvenance: {
        coordinateSpace: "precomputed-import",
        computation: "reduction-only",
        jenaExecuted: false,
      },
      mapping: {
        participant: ["Group", "Speaker"],
        participantLabel: "Speaker",
        group: "Group",
        time: "Period",
        timeOrder: ["TP1", "TP2", "TP3"],
        cohortPolicy: "available",
        missingDisplayCoordinates: "reject",
      },
    });
    expect(json).not.toHaveProperty("approvalRecord");
    expect(json).not.toHaveProperty("verificationStatus");
    expect(json).not.toHaveProperty("fixtureEvidence");
  });

  it("creates a deterministic two-file ZIP with fixed auditable paths", () => {
    const owner = {
      datasetHash: "a".repeat(64),
      specHash: "b".repeat(64),
      runId: "run",
    };
    const first = preparedResultBundle(result, owner);
    const second = preparedResultBundle(result, owner);
    const archiveText = new TextDecoder().decode(first);

    expect(first).toEqual(second);
    expect(archiveText).toContain(PREPARED_EXPORT_BUNDLE_PATHS.centroids);
    expect(archiveText).toContain(PREPARED_EXPORT_BUNDLE_PATHS.provenance);
    expect(signatureCount(first, [0x50, 0x4b, 0x03, 0x04])).toBe(2);
    expect(signatureCount(first, [0x50, 0x4b, 0x01, 0x02])).toBe(2);
  });
});
