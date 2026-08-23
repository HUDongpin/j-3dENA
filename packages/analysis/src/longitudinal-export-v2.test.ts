import { describe, expect, it } from "vitest";
import { analyzeTrajectoryDynamicsV1, type TrajectoryIdentityV1 } from "@3dena/trajectory";

import { createExportBundle } from "./export-bundle";
import {
  compileTrajectoryPlotlySpec,
  type LongitudinalAnalysisBundleV2,
  type TrajectoryDisplaySpecV2,
  type TrajectoryRunSpecV2,
} from "./longitudinal-v2";
import { hashAnalysisValueV1 } from "./task-executor";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const DECODER = new TextDecoder("utf-8", { fatal: true });

const identity = (name: string, value: string): TrajectoryIdentityV1 => ({
  components: [{ name, type: "string", value }],
});

function uint16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function uint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function zipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const eocd = bytes.byteLength - 22;
  const count = uint16(bytes, eocd + 10);
  let cursor = uint32(bytes, eocd + 16);
  const output = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index += 1) {
    const compressedBytes = uint32(bytes, cursor + 20);
    const nameBytes = uint16(bytes, cursor + 28);
    const extraBytes = uint16(bytes, cursor + 30);
    const commentBytes = uint16(bytes, cursor + 32);
    const localOffset = uint32(bytes, cursor + 42);
    const path = DECODER.decode(bytes.slice(cursor + 46, cursor + 46 + nameBytes));
    const dataOffset = localOffset + 30 + uint16(bytes, localOffset + 26) + uint16(bytes, localOffset + 28);
    output.set(path, bytes.slice(dataOffset, dataOffset + compressedBytes));
    cursor += 46 + nameBytes + extraBytes + commentBytes;
  }
  return output;
}

async function scientificBundle(): Promise<LongitudinalAnalysisBundleV2> {
  const runSpec: TrajectoryRunSpecV2 = {
    schemaVersion: "3dena.trajectory-run-spec.v2",
    sourceResultHash: HASH_A,
    participantColumns: ["Student"],
    timeColumn: "Time",
    groupColumn: "Condition",
    orderedPeriods: ["T1", "T2"].map((value, index) => ({
      identity: identity("Time", value),
      sourceTimeCanonical: `time:${value}`,
      displayLabel: value,
      expected: true,
      value: { type: "ordered-index-v2" as const, index },
    })),
    selectedDimensions: ["SVD1", "SVD2", "SVD3"],
    cohortPolicy: "available",
    missingValuePolicy: "complete-analytical-rows",
    estimand: { kind: "equal-participant" },
  };
  const dynamics = analyzeTrajectoryDynamicsV1({
    schemaVersion: "3dena.trajectory-dynamics-input.v1",
    namespace: "group-a",
    dimensions: ["SVD1", "SVD2", "SVD3", "SVD4"],
    selectedDimensions: ["SVD1", "SVD2", "SVD3"],
    periods: ["T1", "T2"].map((value, index) => ({
      time: identity("Time", value),
      value: { type: "numeric-v1" as const, value: index, unit: "ordered-period" },
    })),
    cohortPolicy: "available",
    estimand: { kind: "equal-participant-v1" },
    points: [
      { participant: identity("Student", "private-P1"), time: identity("Time", "T1"), coordinates: [0, 1, 2, 10] },
      { participant: identity("Student", "private-P2"), time: identity("Time", "T1"), coordinates: [2, 3, 4, 14] },
      { participant: identity("Student", "private-P1"), time: identity("Time", "T2"), coordinates: [3, 4, 5, 18] },
      { participant: identity("Student", "private-P2"), time: identity("Time", "T2"), coordinates: [5, 6, 7, 22] },
    ],
  });
  const core = {
    schemaVersion: "3dena.longitudinal-analysis-bundle.v2" as const,
    identity: {
      datasetHash: HASH_B,
      specHash: HASH_C,
      sourceResultHash: HASH_A,
      runId: "run-export-v2",
      jenaBuildId: "jena-js@0.7.0-ona.0+90790856:fixture-build",
    },
    runSpec,
    model: {
      type: "SeparateTrajectory" as const,
      fullRotationDimensions: ["SVD1", "SVD2", "SVD3", "SVD4"],
      selectedDimensions: ["SVD1", "SVD2", "SVD3"] as [string, string, string],
    },
    paths: [{ group: { canonical: "group:A", display: "Group A" }, dynamics }],
    inference: [],
    pathComparisons: [],
    bootstrap: [],
    networkOverlays: [],
    diagnostics: [],
    scientificExecution: {
      jenaVersion: "0.7.0-ona.0",
      jenaCommit: "90790856f00bdef63dbd27fc3a5b502e8cffe65f",
      jenaTarballIntegrity: "sha512-fixture",
      sdkVersion: "0.2.0",
      buildId: "fixture-build",
      seed: 2026,
      permutationPlanHashes: [],
      resamplingPlanHashes: [],
      evidenceStatus: "IMPLEMENTED_UNVERIFIED" as const,
    },
  };
  const resultHash = await hashAnalysisValueV1(core);
  return {
    schemaVersion: core.schemaVersion,
    identity: { ...core.identity, resultHash },
    runSpec,
    model: core.model,
    paths: core.paths,
    inference: [],
    pathComparisons: [],
    bootstrap: [],
    networkOverlays: [],
    diagnostics: [],
    execution: { target: "browser-worker", ...core.scientificExecution },
  };
}

const display: TrajectoryDisplaySpecV2 = {
  schemaVersion: "3dena.trajectory-display-spec.v2",
  projection: "3d",
  displayedGroups: [],
  traces: { participants: false, individualPaths: false, centroids: true, paths: true, directionArrows: true, uncertainty: true, networkOverlay: true, labels: true },
  axisFlips: [false, false, false],
  camera: null,
  style: { participantSize: 5, participantOpacity: 0.5, centroidSize: 10, pathWidth: 4 },
};

describe("longitudinal V2 export bundle", () => {
  it("emits deterministic aggregate members and a recomputable per-file provenance manifest", async () => {
    const bundle = await scientificBundle();
    const plotlySpec = compileTrajectoryPlotlySpec(bundle, display);
    const first = await createExportBundle(bundle, { plotlySpec, fileName: "trajectory-analysis.zip" });
    const second = await createExportBundle(bundle, { plotlySpec, fileName: "trajectory-analysis.zip" });
    const entries = zipEntries(first.bytes);

    expect(first.schemaVersion).toBe("3dena.longitudinal-export-bundle.v2");
    expect(first.sha256).toBe(second.sha256);
    expect([...entries.keys()].sort()).toEqual([
      "analysis.json",
      "plotly-spec.json",
      "provenance-manifest.json",
      "trajectory-bootstrap.csv",
      "trajectory-inference.csv",
      "trajectory-metadata.csv",
      "trajectory-path.csv",
    ]);
    expect(DECODER.decode(entries.get("analysis.json")!)).not.toContain("private-P1");
    expect(DECODER.decode(entries.get("trajectory-path.csv")!)).toContain("full:SVD4");
    const manifest = JSON.parse(DECODER.decode(entries.get("provenance-manifest.json")!));
    expect(manifest).toMatchObject({
      schemaVersion: "3dena.longitudinal-provenance-manifest.v2",
      resultHash: bundle.identity.resultHash,
      participantLevelIncluded: false,
      executionTarget: "browser-worker",
      jena: { version: "0.7.0-ona.0", commit: "90790856f00bdef63dbd27fc3a5b502e8cffe65f" },
    });
    for (const member of manifest.members) {
      const bytes = entries.get(member.path)!;
      expect(bytes.byteLength).toBe(member.byteLength);
      expect(await hashAnalysisValueV1([...bytes])).not.toBe(member.sha256);
      const snapshot = new Uint8Array(bytes.byteLength);
      snapshot.set(bytes);
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", snapshot))].map((value) => value.toString(16).padStart(2, "0")).join("");
      expect(digest).toBe(member.sha256);
    }
  });

  it("exports participant histories only after explicit opt-in and rejects a plot from another result", async () => {
    const bundle = await scientificBundle();
    const plotlySpec = compileTrajectoryPlotlySpec(bundle, display);
    const optedIn = await createExportBundle(bundle, { plotlySpec, includeParticipantLevel: true });
    const entries = zipEntries(optedIn.bytes);

    expect([...entries.keys()]).toContain("trajectory-participants.csv");
    expect(DECODER.decode(entries.get("trajectory-participants.csv")!)).toContain("private-P1");
    const manifest = JSON.parse(DECODER.decode(entries.get("provenance-manifest.json")!));
    expect(manifest.participantLevelIncluded).toBe(true);
    expect(manifest.privacyWarning).toMatch(/re-identification|privacy/i);

    await expect(createExportBundle(bundle, {
      plotlySpec: { ...plotlySpec, resultHash: "f".repeat(64) },
    })).rejects.toThrowError(expect.objectContaining({ code: "PLOTLY_RESULT_BINDING_MISMATCH" }));
  });
});
