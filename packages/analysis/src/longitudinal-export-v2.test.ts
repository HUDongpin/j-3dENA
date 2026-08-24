import { describe, expect, it } from "vitest";
import { analyzeTrajectoryDynamicsV1, type TrajectoryIdentityV1 } from "@3dena/trajectory";

import { createExportBundle } from "./export-bundle";
import {
  compileTrajectoryPlotlySpec,
  type LongitudinalAnalysisBundleV2,
  type TrajectoryDisplaySpecV2,
  type TrajectoryRunSpecV2,
  verifyLongitudinalAnalysisBundleV2,
} from "./longitudinal-v2";
import { hashAnalysisValueV1 } from "./task-executor";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const DECODER = new TextDecoder("utf-8", { fatal: true });
const AVAILABLE_NETWORK_OVERLAYS: LongitudinalAnalysisBundleV2["networkOverlays"] = [{
  status: "available",
  reason: null,
  groupCanonical: "group:A",
  periodCanonical: "time:T1",
  dimensions: ["SVD1", "SVD2", "SVD3"],
  estimand: "equal-participant",
  sourceRows: 2,
  participantPeriods: 2,
  effectiveParticipantN: 2,
  edges: [{ id: "RE-IN", sourceIndex: 0, targetIndex: 1, weight: 0.375 }],
}];

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
  const bundleIdentity = {
    datasetHash: HASH_B,
    specHash: HASH_C,
    sourceResultHash: HASH_A,
    requestHash: "d".repeat(64),
    runId: "run-export-v2",
    jenaBuildId: "jena-js@0.7.0-ona.0+90790856f00bdef63dbd27fc3a5b502e8cffe65f:fixture-build",
  };
  const networkOverlays = structuredClone(AVAILABLE_NETWORK_OVERLAYS);
  const core = {
    schemaVersion: "3dena.longitudinal-analysis-bundle.v2" as const,
    identity: {
      datasetHash: bundleIdentity.datasetHash,
      specHash: bundleIdentity.specHash,
      sourceResultHash: bundleIdentity.sourceResultHash,
      jenaBuildId: bundleIdentity.jenaBuildId,
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
    codeGeometry: {
      schemaVersion: "3dena.longitudinal-code-geometry.v2" as const,
      dimensions: ["SVD1", "SVD2", "SVD3"] as [string, string, string],
      nodes: [
        { index: 0, code: "RE", coordinates: [-0.5, 0.1, 0.2] as [number, number, number] },
        { index: 1, code: "IN", coordinates: [0.4, -0.2, 0.3] as [number, number, number] },
      ],
    },
    networkOverlays,
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
    identity: { ...bundleIdentity, resultHash },
    runSpec,
    model: core.model,
    paths: core.paths,
    inference: [],
    pathComparisons: [],
    bootstrap: [],
    codeGeometry: core.codeGeometry,
    networkOverlays: core.networkOverlays,
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

const participantLevelDisplay: TrajectoryDisplaySpecV2 = {
  ...display,
  traces: {
    ...display.traces,
    participants: true,
    individualPaths: true,
  },
};

describe("longitudinal V2 export bundle", () => {
  it("removes participant traces, identities, and coordinates from the default aggregate Plotly export", async () => {
    const bundle = await scientificBundle();
    const participantPlotlySpec = compileTrajectoryPlotlySpec(bundle, participantLevelDisplay);
    const inputPlotlyJson = JSON.stringify(participantPlotlySpec);

    expect(participantPlotlySpec.data.map((trace) => trace.meta.role)).toEqual(expect.arrayContaining([
      "participant",
      "individual-path",
    ]));
    expect(inputPlotlyJson).toContain("private-P1");
    expect(inputPlotlyJson).toContain('"x":[0,3,2,5]');

    const exported = await createExportBundle(bundle, { displaySpec: participantLevelDisplay });
    const entries = zipEntries(exported.bytes);
    const plotlyJson = DECODER.decode(entries.get("plotly-spec.json")!);
    const exportedPlotly = JSON.parse(plotlyJson) as {
      data: Array<{ meta: { role: string; participantCanonical?: string } }>;
    };

    expect([...entries.keys()]).not.toContain("trajectory-participants.csv");
    expect(exportedPlotly.data.map((trace) => trace.meta.role)).not.toContain("participant");
    expect(exportedPlotly.data.map((trace) => trace.meta.role)).not.toContain("individual-path");
    expect(exportedPlotly.data.every((trace) => trace.meta.participantCanonical === undefined)).toBe(true);
    expect(plotlyJson).not.toContain("private-P1");
    expect(plotlyJson).not.toContain("private-P2");
    expect(plotlyJson).not.toContain('"x":[0,3,2,5]');

    for (const [path, bytes] of entries) {
      const text = DECODER.decode(bytes);
      expect(text, `${path} leaked a participant identity`).not.toContain("private-P1");
      expect(text, `${path} leaked a participant identity`).not.toContain("private-P2");
      expect(text, `${path} leaked a participant trace role`).not.toContain('"role":"participant"');
      expect(text, `${path} leaked an individual-path trace role`).not.toContain('"role":"individual-path"');
      expect(text, `${path} leaked a participant canonical field`).not.toContain("participantCanonical");
    }

    const analysis = JSON.parse(DECODER.decode(entries.get("analysis.json")!));
    expect(analysis.privacy.participantLevelIncluded).toBe(false);
    const manifest = JSON.parse(DECODER.decode(entries.get("provenance-manifest.json")!));
    expect(manifest.participantLevelIncluded).toBe(false);
    expect(manifest.privacyWarning).toBeNull();
  });

  it("preserves non-empty network overlays while the trajectory presenter fails closed", async () => {
    const bundle = await scientificBundle();
    const before = structuredClone(bundle);
    await expect(verifyLongitudinalAnalysisBundleV2(bundle)).resolves.toBeUndefined();
    expect(bundle.networkOverlays).toEqual(AVAILABLE_NETWORK_OVERLAYS);

    const plotlySpec = compileTrajectoryPlotlySpec(bundle, display);
    expect(plotlySpec.data.map((trace) => trace.meta.role)).not.toContain("network-edge");
    expect(bundle).toEqual(before);
    const first = await createExportBundle(bundle, { displaySpec: display, fileName: "trajectory-analysis.zip" });
    const second = await createExportBundle(bundle, { displaySpec: display, fileName: "trajectory-analysis.zip" });
    const entries = zipEntries(first.bytes);

    expect(first.schemaVersion).toBe("3dena.longitudinal-export-bundle.v2");
    expect(first.sha256).toBe(second.sha256);
    expect([...entries.keys()].sort()).toEqual([
      "analysis.json",
      "plotly-spec.json",
      "provenance-manifest.json",
      "trajectory-inference.csv",
      "trajectory-metadata.csv",
      "trajectory-path.csv",
    ]);
    const analysis = JSON.parse(DECODER.decode(entries.get("analysis.json")!));
    expect(analysis.networkOverlays).toEqual(before.networkOverlays);
    expect(analysis.identity.resultHash).toBe(before.identity.resultHash);
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
      const bytes = entries.get(member.path);
      expect(bytes, `missing ZIP member ${member.path}`).toBeDefined();
      if (!bytes) throw new Error(`missing ZIP member ${member.path}`);
      expect(bytes.byteLength).toBe(member.byteLength);
      expect(await hashAnalysisValueV1([...bytes])).not.toBe(member.sha256);
      const snapshot = new Uint8Array(bytes.byteLength);
      snapshot.set(bytes);
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", snapshot))].map((value) => value.toString(16).padStart(2, "0")).join("");
      expect(digest).toBe(member.sha256);
    }
    expect(manifest.contentSetHash).toBe(await hashAnalysisValueV1(manifest.members));
    expect(bundle).toEqual(before);
  });

  it("returns the exact package-generated members for standalone presenter downloads", async () => {
    const bundle = await scientificBundle();
    const exported = await createExportBundle(bundle, { displaySpec: display });
    const files = (exported as unknown as {
      files?: ReadonlyArray<{ path: string; mediaType: string; bytes: Uint8Array }>;
    }).files;
    const entries = zipEntries(exported.bytes);

    expect(files).toBeDefined();
    expect(files?.map((file) => file.path).sort()).toEqual([...entries.keys()].sort());
    for (const file of files ?? []) {
      expect(file.bytes).toEqual(entries.get(file.path));
      expect(file.mediaType).toBe(exported.entries.find((entry) => entry.path === file.path)?.mediaType);
    }
  });

  it("exports participant histories only after explicit opt-in and rejects caller-supplied Plotly payloads", async () => {
    const bundle = await scientificBundle();
    const optedIn = await createExportBundle(bundle, {
      displaySpec: participantLevelDisplay,
      includeParticipantLevel: true,
    });
    const entries = zipEntries(optedIn.bytes);

    expect([...entries.keys()]).toContain("trajectory-participants.csv");
    expect(DECODER.decode(entries.get("trajectory-participants.csv")!)).toContain("private-P1");
    const exportedPlotly = JSON.parse(DECODER.decode(entries.get("plotly-spec.json")!));
    expect(exportedPlotly.data.map((trace: { meta: { role: string } }) => trace.meta.role)).toEqual(expect.arrayContaining([
      "participant",
      "individual-path",
    ]));
    expect(JSON.stringify(exportedPlotly)).toContain("private-P1");
    const manifest = JSON.parse(DECODER.decode(entries.get("provenance-manifest.json")!));
    expect(manifest.participantLevelIncluded).toBe(true);
    expect(manifest.privacyWarning).toMatch(/re-identification|privacy/i);

    const forgedPlotlyPayload = {
      displaySpec: participantLevelDisplay,
      plotlySpec: {
        schemaVersion: "3dena.trajectory-plotly-spec.v2",
        resultHash: bundle.identity.resultHash,
        data: [{ type: "scatter3d", meta: { role: "centroid", resultHash: bundle.identity.resultHash }, text: ["private-P1"] }],
        layout: { secret: "private-P2" },
      },
    };
    await expect(createExportBundle(bundle, forgedPlotlyPayload as never)).rejects.toThrowError(
      expect.objectContaining({ code: "INVALID_LONGITUDINAL_EXPORT_OPTIONS" }),
    );
  });
});
