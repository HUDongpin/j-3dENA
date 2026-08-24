export type TrajectoryScalarType = "string" | "number" | "boolean";
export type TrajectoryScalar = string | number | boolean;
export type TrajectoryCohortPolicyV1 = "available" | "complete";
export type TrajectoryDurationUnitV1 = "milliseconds" | "seconds" | "minutes" | "hours" | "days" | "weeks";
export interface TrajectoryIdentityComponentV1 {
    name: string;
    type: TrajectoryScalarType;
    value: TrajectoryScalar;
    /** Source semantic tag. It participates in canonical identity. */
    declaredType?: string;
}
export interface TrajectoryIdentityV1 {
    components: TrajectoryIdentityComponentV1[];
}
export interface TrajectoryKeyV1 extends TrajectoryIdentityV1 {
    canonical: string;
    display: string;
}
export type TrajectoryTimeValueV1 = {
    type: "numeric-v1";
    value: number;
    /** An exact, caller-declared unit label; no implicit conversion is performed. */
    unit: string;
} | {
    type: "date-v1";
    /** Strict proleptic-Gregorian YYYY-MM-DD civil date. Elapsed values are days. */
    value: string;
} | {
    type: "instant-v1";
    /** Signed canonical int64 decimal epoch milliseconds. */
    epochMilliseconds: string;
    /** Presentation provenance only; chronology is determined by epochMilliseconds. */
    timeZone: string;
    offsetMinutes: number;
    fold: 0 | 1;
    elapsedUnit: TrajectoryDurationUnitV1;
} | {
    type: "difftime-v1";
    value: number;
    unit: TrajectoryDurationUnitV1;
    elapsedUnit: TrajectoryDurationUnitV1;
};
export interface TrajectoryPeriodDefinitionV1 {
    time: TrajectoryIdentityV1;
    value: TrajectoryTimeValueV1;
}
export interface TrajectoryDynamicsPointV1 {
    participant: TrajectoryIdentityV1;
    time: TrajectoryIdentityV1;
    coordinates: number[];
    /** Required, finite, and strictly positive for weighted-participant-v1. */
    weight?: number;
}
export type TrajectoryEstimandV1 = {
    kind: "equal-participant-v1";
} | {
    kind: "weighted-participant-v1";
};
export interface TrajectoryDynamicsLimitsV1 {
    maxPoints: number;
    maxDimensions: number;
    maxPeriods: number;
    maxParticipants: number;
    maxCells: number;
}
export interface TrajectoryDynamicsInputV1 {
    schemaVersion: "3dena.trajectory-dynamics-input.v1";
    namespace: string;
    points: TrajectoryDynamicsPointV1[];
    dimensions: string[];
    selectedDimensions: [string, string, string];
    periods: TrajectoryPeriodDefinitionV1[];
    cohortPolicy: TrajectoryCohortPolicyV1;
    estimand: TrajectoryEstimandV1;
    limits?: Partial<TrajectoryDynamicsLimitsV1>;
}
export interface TrajectoryParticipantPeriodV1 {
    index: number;
    participant: TrajectoryKeyV1;
    time: TrajectoryKeyV1;
    selectedCoordinates: [number, number, number];
    fullCoordinates: number[];
    sourceRowIndexes: number[];
    participantWeight: number;
    includedInCohort: boolean;
}
export interface TrajectoryDistanceAndSpeedV1 {
    dimensions: string[];
    delta: number[] | null;
    stepDistance: number | null;
    cumulativeDistance: number | null;
    speed: number | null;
}
export interface TrajectoryPeriodDynamicsV1 {
    index: number;
    time: TrajectoryKeyV1;
    timeValue: TrajectoryTimeValueV1;
    elapsedFromPrevious: number | null;
    elapsedFromStart: number;
    selectedCentroid: [number, number, number] | null;
    fullCentroid: number[] | null;
    selected3d: TrajectoryDistanceAndSpeedV1;
    fullSpace: TrajectoryDistanceAndSpeedV1;
    nRows: number;
    nParticipantPeriods: number;
    nUsed: number;
    nDuplicateRows: number;
    nCohortExcluded: number;
    weightSum: number | null;
    effectiveParticipantN: number | null;
}
export interface TrajectoryDynamicsDiagnosticV1 {
    code: string;
    severity: "info" | "warning";
    message: string;
    path?: string;
    count?: number;
}
export type TrajectoryTimeContractV1 = {
    kind: "numeric-v1";
    elapsedUnit: string;
    chronology: "strictly-increasing-finite-number-v1";
} | {
    kind: "date-v1";
    elapsedUnit: "days";
    calendar: "proleptic-gregorian-v1";
    chronology: "strictly-increasing-civil-day-v1";
} | {
    kind: "instant-v1";
    elapsedUnit: TrajectoryDurationUnitV1;
    epoch: "unix-epoch-milliseconds-int64-v1";
    chronology: "strictly-increasing-exact-epoch-v1";
    zoneRole: "presentation-provenance-only";
} | {
    kind: "difftime-v1";
    elapsedUnit: TrajectoryDurationUnitV1;
    conversion: "fixed-duration-unit-ratios-v1";
    chronology: "strictly-increasing-normalized-duration-v1";
};
export interface TrajectoryDynamicsResultV1 {
    schemaVersion: "3dena.trajectory-dynamics.v1";
    namespace: string;
    cohortPolicy: TrajectoryCohortPolicyV1;
    estimand: TrajectoryEstimandV1;
    dimensions: string[];
    selectedDimensions: [string, string, string];
    timeContract: TrajectoryTimeContractV1;
    contracts: {
        duplicateReduction: "equal-row-coordinate-mean-before-centroid-v1";
        weightResolution: "constant-within-participant-period-v1";
        cohort: "available-or-complete-before-centroid-v1";
        distance: "euclidean-selected-and-full-space-v1";
        gap: "expected-period-no-bridge-v1";
        speed: "step-distance-divided-by-positive-adjacent-elapsed-v1";
    };
    participantPeriods: TrajectoryParticipantPeriodV1[];
    periods: TrajectoryPeriodDynamicsV1[];
    diagnostics: TrajectoryDynamicsDiagnosticV1[];
    diagnosticSummary: {
        info: number;
        warning: number;
        codes: string[];
    };
    summary: {
        inputRows: number;
        participants: number;
        participantPeriods: number;
        periods: number;
        observedPeriods: number;
        missingPeriods: number;
        duplicateRows: number;
        cohortExcludedParticipants: number;
    };
    evidence: {
        status: "IMPLEMENTED_UNVERIFIED";
        oracleParityClaim: false;
        scientificAuthority: "successor-definition-pending-review";
    };
    resolvedLimits: TrajectoryDynamicsLimitsV1;
}
export interface TrajectoryPathSetGroupInputV2 {
    group: TrajectoryIdentityV1;
    namespace: string;
    points: TrajectoryDynamicsPointV1[];
}
export interface TrajectoryPathSetInputV2 {
    schemaVersion: "3dena.trajectory-path-set-input.v2";
    dimensions: string[];
    selectedDimensions: [string, string, string];
    periods: TrajectoryPeriodDefinitionV1[];
    cohortPolicy: TrajectoryCohortPolicyV1;
    estimand: TrajectoryEstimandV1;
    groups: TrajectoryPathSetGroupInputV2[];
    limits?: Partial<TrajectoryDynamicsLimitsV1>;
}
export interface TrajectoryPathSetGroupResultV2 {
    group: TrajectoryKeyV1;
    dynamics: TrajectoryDynamicsResultV1;
}
export interface TrajectoryPathSetResultV2 {
    schemaVersion: "3dena.trajectory-path-set.v2";
    dimensions: string[];
    selectedDimensions: [string, string, string];
    cohortPolicy: TrajectoryCohortPolicyV1;
    estimand: TrajectoryEstimandV1;
    groups: TrajectoryPathSetGroupResultV2[];
    summary: {
        groups: number;
        participants: number;
        participantPeriods: number;
        duplicateRows: number;
        missingGroupPeriods: number;
    };
    evidence: {
        status: "IMPLEMENTED_UNVERIFIED";
        scientificAuthority: "jena-js-and-versioned-3dena-contract";
        rEnaOracle: false;
    };
}
//# sourceMappingURL=types.d.ts.map