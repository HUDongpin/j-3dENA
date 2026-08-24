import { type ENASet, type Row } from "jena-js";
import { type AnalysisBuildIdentity } from "./build-identity.js";
import { type AnalysisResult } from "./types.js";
export declare const FITTED_JENA_TRAJECTORY_ADAPTER_VERSION_V2: "3dena.fitted-jena-trajectory-adapter.v2";
export interface FittedJenaTrajectoryAdapterMappingV2 {
    unitColumns: string[];
    conversationColumns: string[];
    participantColumns: string[];
    timeColumn: string;
    groupColumn: string | null;
    metadataColumns: string[];
}
export interface FittedJenaTrajectoryAdapterConfigurationV2 {
    model: "SeparateTrajectory" | "AccumulatedTrajectory";
    window: "MovingStanzaWindow" | "Conversation";
    weightBy: "binary" | "sum";
    windowSizeBack: number;
    windowSizeForward: number;
    centerAlignToOrigin: boolean;
    rotationMethod: "svd" | "mean" | "reference";
}
export interface AdaptFittedJenaTrajectoryResultV2Input {
    /** The already-successful jENA set. This adapter never invokes ena/makeSet without its fixed rotation. */
    set: ENASet;
    /** Used only to bind typed identities and explicitly selected stable metadata. Never retained. */
    sourceRows: Row[];
    mapping: FittedJenaTrajectoryAdapterMappingV2;
    configuration: FittedJenaTrajectoryAdapterConfigurationV2;
    inputColumns: string[];
}
/** Return the package-build identity injected into the exact consumed artifact. */
export declare function getAnalysisBuildIdentityV2(): AnalysisBuildIdentity;
/**
 * Convert one already-fitted jENA trajectory set into the versioned analysis
 * DTO. Full coordinates and nodes are obtained by jENA `projectIn` against a
 * node-free copy of the same rotation set, so no accumulation or rotation fit
 * is repeated and the caller's fitted set remains immutable.
 */
export declare function adaptFittedJenaTrajectoryResultV2(input: AdaptFittedJenaTrajectoryResultV2Input): AnalysisResult;
//# sourceMappingURL=fitted-jena-adapter-v2.d.ts.map