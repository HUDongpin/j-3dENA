import type { TrajectoryDynamicsResultV1, TrajectoryIdentityV1, TrajectoryTimeValueV1 } from "../../trajectory/src/index.js";
import { type TrajectoryBootstrapResult, type TrajectoryComparisonResult } from "./trajectory-statistics.js";
import { type AnalysisExecutionDatasetV2 } from "./task-executor.js";
export declare const TRAJECTORY_RUN_SPEC_VERSION_V2: "3dena.trajectory-run-spec.v2";
export declare const LONGITUDINAL_BUNDLE_VERSION_V2: "3dena.longitudinal-analysis-bundle.v2";
export declare const TRAJECTORY_DISPLAY_SPEC_VERSION_V2: "3dena.trajectory-display-spec.v2";
export type OrderedPeriodValueV2 = {
    type: "ordered-index-v2";
    index: number;
} | TrajectoryTimeValueV1;
export interface OrderedTrajectoryPeriodV2 {
    identity: TrajectoryIdentityV1;
    sourceTimeCanonical: string;
    displayLabel: string;
    expected: boolean;
    value: OrderedPeriodValueV2;
}
export type TrajectoryEstimandV2 = {
    kind: "equal-participant";
} | {
    kind: "weighted-participant";
    metadataField: string;
};
export interface TrajectoryRunSpecV2 {
    schemaVersion: typeof TRAJECTORY_RUN_SPEC_VERSION_V2;
    sourceResultHash: string;
    participantColumns: string[];
    timeColumn: string;
    groupColumn: string | null;
    orderedPeriods: OrderedTrajectoryPeriodV2[];
    selectedDimensions: [string, string, string];
    cohortPolicy: "available" | "complete";
    missingValuePolicy: "complete-analytical-rows";
    estimand: TrajectoryEstimandV2;
}
export interface TrajectoryPathTaskV2 {
    schemaVersion: "3dena.trajectory-path-task.v2";
    kind: "trajectory-path-v2";
    datasetHash: string;
    specHash: string;
    runId: string;
    runSpec: TrajectoryRunSpecV2;
}
export type TrajectoryInferenceRequestV2 = {
    kind: "independent-period";
    groups: [string, string];
    periodCanonical: string;
} | {
    kind: "paired-periods";
    group: string | null;
    earlierPeriodCanonical: string;
    laterPeriodCanonical: string;
    samePhysicalEntityConfirmed: boolean;
} | {
    kind: "repeated-periods";
    group: string | null;
    periodCanonicals: string[];
    samePhysicalEntityConfirmed: boolean;
} | {
    kind: "path-comparison";
    design: "independent" | "paired";
    groups: [string, string];
    repetitions: number;
    seed: number;
    samePhysicalEntityConfirmed: boolean;
};
export interface TrajectoryInferenceTaskV2 {
    schemaVersion: "3dena.trajectory-inference-task.v2";
    kind: "trajectory-inference-v2";
    datasetHash: string;
    specHash: string;
    sourceResultHash: string;
    runId: string;
    requests: TrajectoryInferenceRequestV2[];
    adjustment: "holm";
}
export interface TrajectoryBootstrapTaskV2 {
    schemaVersion: "3dena.trajectory-bootstrap-task.v2";
    kind: "trajectory-bootstrap-v2";
    datasetHash: string;
    specHash: string;
    sourceResultHash: string;
    runId: string;
    repetitions: number;
    confidenceLevel: number;
    seed: number;
    resamplingDesign: "auto" | "global-participant" | "within-group" | "explicit-strata";
    explicitStrataField: string | null;
    interval: "pointwise-percentile-linear-type7";
    rotationPolicy: "fixed-same-fit-projection";
}
export interface TrajectoryNetworkOverlayTaskV2 {
    schemaVersion: "3dena.trajectory-network-overlay-task.v2";
    kind: "trajectory-network-overlay-v2";
    datasetHash: string;
    specHash: string;
    sourceResultHash: string;
    runId: string;
    requests: Array<{
        periodCanonical: string;
        groupCanonical: string | null;
    }>;
}
export interface LongitudinalGroupPathV2 {
    group: {
        canonical: string;
        display: string;
    };
    dynamics: TrajectoryDynamicsResultV1;
}
export interface LongitudinalInferenceResultV2 {
    request: TrajectoryInferenceRequestV2;
    status: "available" | "not-estimable" | "disabled";
    familyId: string;
    familySize: number;
    rows: ReadonlyArray<Record<string, unknown>>;
    reason: string | null;
}
export interface LongitudinalPathComparisonV2 {
    groups: [string, string];
    design: "independent" | "paired";
    seed: number;
    planHash: string;
    identityOverlapAudit: {
        sideAEntities: number;
        sideBEntities: number;
        overlappingEntities: number;
        pairedCompleteEntities: number;
        sideAOnly: number;
        sideBOnly: number;
        excludedIncompleteOverlap: number;
        samePhysicalEntityConfirmed: true;
    } | null;
    result: TrajectoryComparisonResult;
}
export interface LongitudinalBootstrapResultV2 {
    groupCanonical: string;
    status: "available" | "not-estimable";
    notEstimableReason: string | null;
    seed: number;
    planHash: string;
    finiteReplicates: number;
    requiredFiniteReplicates: number;
    totalReplicates: number;
    confidenceLevel: number;
    requestedResamplingDesign: TrajectoryBootstrapTaskV2["resamplingDesign"];
    resolvedResamplingDesign: Exclude<TrajectoryBootstrapTaskV2["resamplingDesign"], "auto">;
    resamplingAlgorithm: "participant-complete-history-mulberry32-uint32-v1" | "global-participant-complete-history-mulberry32-uint32-v2";
    intervalContract: "pointwise-percentile-linear-type7";
    rotationPolicy: "fixed-same-fit-projection";
    speedIntervals: Array<{
        periodCanonical: string;
        selected: TrajectoryBootstrapResult["periods"][number]["selectedStepDistance"];
        full: TrajectoryBootstrapResult["periods"][number]["fullStepDistance"];
    }>;
    result: TrajectoryBootstrapResult;
}
export interface LongitudinalNetworkOverlayV2 {
    status: "available" | "not-estimable";
    reason: string | null;
    groupCanonical: string | null;
    periodCanonical: string;
    dimensions: [string, string, string];
    estimand: TrajectoryEstimandV2["kind"];
    sourceRows: number;
    participantPeriods: number;
    effectiveParticipantN: number | null;
    nodes: Array<{
        code: string;
        coordinates: [number, number, number];
        weight: number;
    }>;
    edges: Array<{
        id: string;
        sourceIndex: number;
        targetIndex: number;
        weight: number;
    }>;
}
export type LongitudinalEvidenceStatusV2 = "IMPLEMENTED_UNVERIFIED" | "PARITY_CANDIDATE" | "PRODUCTION_CANDIDATE" | "PRODUCTION_READY";
export interface LongitudinalAnalysisBundleV2 {
    schemaVersion: typeof LONGITUDINAL_BUNDLE_VERSION_V2;
    identity: {
        datasetHash: string;
        specHash: string;
        sourceResultHash: string;
        resultHash: string;
        runId: string;
        jenaBuildId: string;
    };
    runSpec: TrajectoryRunSpecV2;
    model: {
        type: "SeparateTrajectory" | "AccumulatedTrajectory";
        fullRotationDimensions: string[];
        selectedDimensions: [string, string, string];
    };
    paths: LongitudinalGroupPathV2[];
    inference: LongitudinalInferenceResultV2[];
    pathComparisons: LongitudinalPathComparisonV2[];
    bootstrap: LongitudinalBootstrapResultV2[];
    networkOverlays: LongitudinalNetworkOverlayV2[];
    diagnostics: Array<{
        code: string;
        severity: "error" | "warning" | "info";
        message: string;
        path?: string;
    }>;
    execution: {
        target: "browser-worker" | "persistent-compute-service" | "node-service";
        jenaVersion: string;
        jenaCommit: string;
        jenaTarballIntegrity: string;
        sdkVersion: string;
        buildId: string;
        seed: number;
        permutationPlanHashes: string[];
        resamplingPlanHashes: string[];
        evidenceStatus: LongitudinalEvidenceStatusV2;
    };
}
export interface LongitudinalExecutionRequestV2 {
    dataset: AnalysisExecutionDatasetV2;
    pathTask: TrajectoryPathTaskV2;
    inferenceTask?: TrajectoryInferenceTaskV2;
    bootstrapTask?: TrajectoryBootstrapTaskV2;
    networkOverlayTask?: TrajectoryNetworkOverlayTaskV2;
    execution: {
        target: LongitudinalAnalysisBundleV2["execution"]["target"];
        jenaVersion: string;
        jenaCommit: string;
        jenaTarballIntegrity: string;
        sdkVersion: string;
        buildId: string;
        seed: number;
    };
}
export declare class LongitudinalExecutionErrorV2 extends Error {
    readonly code: string;
    readonly path: string;
    constructor(code: string, path: string, message: string);
}
export type TrajectoryProjectionV2 = "3d" | "xy" | "xz" | "yz" | "yx" | "zx" | "zy";
export interface TrajectoryDisplaySpecV2 {
    schemaVersion: typeof TRAJECTORY_DISPLAY_SPEC_VERSION_V2;
    projection: TrajectoryProjectionV2;
    displayedGroups: string[];
    traces: {
        participants: boolean;
        individualPaths: boolean;
        centroids: boolean;
        paths: boolean;
        directionArrows: boolean;
        uncertainty: boolean;
        networkOverlay: boolean;
        /** Show fitted ENA code reference nodes without requiring mean-network edges. */
        codeNodes?: boolean;
        labels: boolean;
    };
    axisFlips: [boolean, boolean, boolean];
    camera: {
        eye: {
            x: number;
            y: number;
            z: number;
        };
        center: {
            x: number;
            y: number;
            z: number;
        };
        up: {
            x: number;
            y: number;
            z: number;
        };
    } | null;
    style: {
        participantSize: number;
        participantOpacity: number;
        centroidSize: number;
        pathWidth: number;
    };
}
export type TrajectoryPlotlyTraceRoleV2 = "participant" | "individual-path" | "centroid" | "trajectory-path" | "direction-arrow" | "uncertainty" | "network-node" | "network-edge" | "axis-shaft" | "axis-arrowhead";
export interface TrajectoryPlotlyTraceV2 extends Record<string, unknown> {
    type: "scatter" | "scatter3d" | "cone";
    meta: {
        role: TrajectoryPlotlyTraceRoleV2;
        groupCanonical?: string;
        participantCanonical?: string;
        axis?: string;
        resultHash: string;
    };
}
export interface TrajectoryPlotlySpecV2 {
    schemaVersion: "3dena.trajectory-plotly-spec.v2";
    resultHash: string;
    data: TrajectoryPlotlyTraceV2[];
    layout: Record<string, unknown>;
    config: {
        responsive: true;
        displaylogo: false;
        scrollZoom: true;
        toImageButtonOptions: {
            format: "png";
            filename: "3dena-longitudinal-trajectory";
        };
    };
    diagnostics: LongitudinalAnalysisBundleV2["diagnostics"];
}
export declare function assertTrajectoryRunSpecV2(value: unknown, path?: string): asserts value is TrajectoryRunSpecV2;
/** Strict structural guard for persisted or remotely returned V2 envelopes. */
export declare function assertLongitudinalAnalysisBundleV2(value: unknown, path?: string): asserts value is LongitudinalAnalysisBundleV2;
/**
 * Recomputes the canonical scientific hash. Execution target and the
 * operational run ID remain transport/audit provenance and are intentionally
 * excluded, so identical science is stable across retries and execution paths.
 */
export declare function verifyLongitudinalAnalysisBundleV2(bundle: unknown): Promise<void>;
/**
 * Pure presenter compiler. It accepts only a completed longitudinal bundle;
 * projection, filtering, labels, camera and axis flips cannot execute or alter
 * any scientific task.
 */
export declare function compileTrajectoryPlotlySpec(bundle: LongitudinalAnalysisBundleV2, displaySpec: TrajectoryDisplaySpecV2): TrajectoryPlotlySpecV2;
/**
 * Executes the display-independent base path against one immutable fitted
 * jENA result. Inference and bootstrap tasks are added to the same envelope by
 * the versioned task coordinator; presenter changes never enter this function.
 */
export declare function executeLongitudinalAnalysisV2(input: LongitudinalExecutionRequestV2): Promise<LongitudinalAnalysisBundleV2>;
//# sourceMappingURL=longitudinal-v2.d.ts.map