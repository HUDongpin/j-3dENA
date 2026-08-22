/** Browser-safe descriptive and comparison statistics for preprojected trajectories. */
export type TrajectoryScalarType = "string" | "number" | "boolean";
export type TrajectoryScalar = string | number | boolean;
export type TrajectoryCohortPolicy = "available" | "complete";
export interface TrajectoryIdentityComponent {
    name: string;
    type: TrajectoryScalarType;
    value: TrajectoryScalar;
    /** Optional source semantic type, included in the collision-safe canonical key. */
    declaredType?: string;
}
export interface TrajectoryIdentity {
    components: TrajectoryIdentityComponent[];
}
export interface TrajectoryKey extends TrajectoryIdentity {
    canonical: string;
    display: string;
}
export interface TrajectoryStatisticsPoint {
    participant: TrajectoryIdentity;
    time: TrajectoryIdentity;
    /** Required and participant-stable only when explicit stratification is requested. */
    stratum?: TrajectoryIdentity;
    /** Coordinates in the exact order declared by the containing series. */
    coordinates: number[];
}
export interface TrajectoryStatisticsLimits {
    maxPoints: number;
    maxDimensions: number;
    maxPeriods: number;
    maxParticipants: number;
    maxCells: number;
    maxResamples: number;
    maxTests: number;
}
export interface TrajectorySeriesInput {
    /** A stable namespace for this sample; required to isolate independent sides. */
    namespace: string;
    points: TrajectoryStatisticsPoint[];
    dimensions: string[];
    selectedDimensions: [string, string, string];
    timeOrder: TrajectoryIdentity[];
    cohortPolicy: TrajectoryCohortPolicy;
    limits?: Partial<TrajectoryStatisticsLimits>;
}
export interface TrajectoryParticipantPeriod {
    index: number;
    participant: TrajectoryKey;
    time: TrajectoryKey;
    selectedCoordinates: [number, number, number];
    fullCoordinates: number[];
    sourceRowIndexes: number[];
    includedInCohort: boolean;
}
export interface TrajectoryDistanceMetrics {
    dimensions: string[];
    delta: number[] | null;
    stepDistance: number | null;
    cumulativeDistance: number | null;
}
export interface TrajectoryPathPeriodStatistics {
    index: number;
    time: TrajectoryKey;
    selectedCentroid: [number, number, number] | null;
    fullCentroid: number[] | null;
    selected3d: TrajectoryDistanceMetrics;
    fullSpace: TrajectoryDistanceMetrics;
    nRows: number;
    nTotal: number;
    nUsed: number;
    nDuplicateRows: number;
    nCohortExcluded: number;
}
export interface TrajectoryStatisticsDiagnostic {
    code: string;
    severity: "info" | "warning";
    message: string;
    path?: string;
}
export interface TrajectoryPathStatistics {
    schemaVersion: "3dena.trajectory-path-statistics.v1";
    namespace: string;
    cohortPolicy: TrajectoryCohortPolicy;
    dimensions: string[];
    selectedDimensions: [string, string, string];
    distanceSemantics: {
        selected3d: "euclidean-selected-three-dimensions";
        fullSpace: "euclidean-all-declared-dimensions";
    };
    participantPeriods: TrajectoryParticipantPeriod[];
    periods: TrajectoryPathPeriodStatistics[];
    diagnostics: TrajectoryStatisticsDiagnostic[];
    summary: {
        inputRows: number;
        participants: number;
        participantPeriods: number;
        periods: number;
        duplicateRows: number;
    };
    resolvedLimits: TrajectoryStatisticsLimits;
}
export interface TrajectoryComparisonSide {
    label: string;
    series: TrajectorySeriesInput;
}
export interface PairedSwapPermutationPlan {
    kind: "paired-swap-indices-v1";
    /** Exact deterministic order returned by `getTrajectoryPermutationUnits()`. */
    unitOrder: string[];
    /** Each replicate lists matched-pair indexes whose A/B histories are swapped. */
    replicates: number[][];
}
export interface IndependentPoolPermutationPlan {
    kind: "independent-pool-indices-v1";
    /** Exact deterministic order returned by `getTrajectoryPermutationUnits()`. */
    unitOrder: string[];
    /** Each replicate is a complete permutation; the first original-A count becomes A. */
    replicates: number[][];
}
interface TrajectoryComparisonInputBase {
    sideA: TrajectoryComparisonSide;
    sideB: TrajectoryComparisonSide;
}
export interface PairedTrajectoryComparisonInput extends TrajectoryComparisonInputBase {
    design: "paired";
    /** Caller-selected identity component or collision-safe tuple shared across conditions. */
    pairedId: string | string[];
    permutationPlan?: PairedSwapPermutationPlan;
}
export interface IndependentTrajectoryComparisonInput extends TrajectoryComparisonInputBase {
    design: "independent";
    permutationPlan?: IndependentPoolPermutationPlan;
}
export type TrajectoryComparisonInput = PairedTrajectoryComparisonInput | IndependentTrajectoryComparisonInput;
export interface TrajectoryComparisonPeriod {
    index: number;
    time: TrajectoryKey;
    selectedCentroidA: [number, number, number] | null;
    selectedCentroidB: [number, number, number] | null;
    selectedDifference: [number, number, number] | null;
    fullCentroidA: number[] | null;
    fullCentroidB: number[] | null;
    fullDifference: number[] | null;
    selectedCentroidSeparation: number | null;
    fullCentroidSeparation: number | null;
    selectedStepDistanceA: number | null;
    selectedStepDistanceB: number | null;
    selectedStepDistanceDifference: number | null;
    selectedCumulativeDistanceA: number | null;
    selectedCumulativeDistanceB: number | null;
    selectedCumulativeDistanceDifference: number | null;
    fullStepDistanceA: number | null;
    fullStepDistanceB: number | null;
    fullStepDistanceDifference: number | null;
    fullCumulativeDistanceA: number | null;
    fullCumulativeDistanceB: number | null;
    fullCumulativeDistanceDifference: number | null;
    nAUsed: number;
    nBUsed: number;
    nMatched: number | null;
}
export interface TrajectoryPermutationTest {
    id: string;
    timeIndex: number;
    metric: string;
    distanceSpace: "selected-3d" | "full-space" | null;
    tail: "two-sided" | "upper";
    observed: number;
    pValue: number;
    holmAdjustedPValue: number;
    permutationCount: number;
}
export interface TrajectoryComparisonResult {
    schemaVersion: "3dena.trajectory-comparison.v1";
    design: "paired" | "independent";
    direction: "B-minus-A";
    pairedId: string | string[] | null;
    sideA: TrajectoryPathStatistics;
    sideB: TrajectoryPathStatistics;
    periods: TrajectoryComparisonPeriod[];
    tests: TrajectoryPermutationTest[];
    permutation: {
        status: "not-requested" | "complete";
        planKind: PairedSwapPermutationPlan["kind"] | IndependentPoolPermutationPlan["kind"] | null;
        unitOrder: string[];
        replicateCount: number;
        rngParityClaim: false;
    };
    diagnostics: TrajectoryStatisticsDiagnostic[];
}
export interface TrajectoryPermutationUnits {
    design: "paired" | "independent";
    unitOrder: string[];
    sideACount: number | null;
}
export type TrajectoryBootstrapStratification = "none" | "explicit";
export interface TrajectoryBootstrapStratumUnits {
    key: TrajectoryKey;
    unitIndexes: number[];
}
export interface TrajectoryBootstrapUnits {
    schemaVersion: "3dena.trajectory-bootstrap-units.v1";
    unitOrder: string[];
    strata: TrajectoryBootstrapStratumUnits[];
    cohortPolicy: TrajectoryCohortPolicy;
    stratifyBy: TrajectoryBootstrapStratification;
}
export interface TrajectoryBootstrapStratumPlan {
    key: TrajectoryKey;
    unitIndexes: number[];
    /** Global unit indexes, sampled with replacement, one draw per original stratum unit. */
    replicates: number[][];
}
export interface TrajectoryBootstrapPlan {
    kind: "participant-history-resample-indices-v1";
    unitOrder: string[];
    strata: TrajectoryBootstrapStratumPlan[];
    generation: {
        kind: "caller-provided";
    } | {
        kind: "seeded";
        algorithm: "mulberry32-uint32-v1";
        seed: number;
        unitSort: "utf16-code-unit-ascending";
        randomEndpoint: "zero-inclusive-one-exclusive";
    };
}
export interface GetTrajectoryBootstrapUnitsInput {
    series: TrajectorySeriesInput;
    stratifyBy: TrajectoryBootstrapStratification;
}
export interface CreateSeededTrajectoryBootstrapPlanInput {
    units: TrajectoryBootstrapUnits;
    repetitions: number;
    seed: number;
    limits?: Partial<TrajectoryStatisticsLimits>;
}
export interface TrajectoryBootstrapInput {
    series: TrajectorySeriesInput;
    stratifyBy: TrajectoryBootstrapStratification;
    confidenceLevel: number;
    plan: TrajectoryBootstrapPlan;
}
export interface TrajectoryBootstrapInterval {
    estimate: number;
    lower: number;
    upper: number;
    finiteReplicates: number;
    requiredFiniteReplicates: number;
    totalReplicates: number;
}
export interface TrajectoryBootstrapPeriod {
    index: number;
    time: TrajectoryKey;
    selectedCentroid: Array<TrajectoryBootstrapInterval | null>;
    fullCentroid: Array<TrajectoryBootstrapInterval | null>;
    selectedStepDistance: TrajectoryBootstrapInterval | null;
    fullStepDistance: TrajectoryBootstrapInterval | null;
    selectedCumulativeDistance: TrajectoryBootstrapInterval | null;
    fullCumulativeDistance: TrajectoryBootstrapInterval | null;
}
export interface TrajectoryBootstrapResult {
    schemaVersion: "3dena.trajectory-bootstrap.v1";
    base: TrajectoryPathStatistics;
    confidenceLevel: number;
    periods: TrajectoryBootstrapPeriod[];
    quantileRule: {
        id: "linear-type7-v1";
        sort: "ascending-numeric";
        position: "(n-1)*p";
        interpolation: "linear-between-floor-and-ceiling";
        endpoints: "p=0-min-p=1-max";
    };
    resampling: {
        unit: "participant-complete-history";
        stratified: boolean;
        strata: Array<{
            key: TrajectoryKey;
            unitCount: number;
        }>;
        replicateCount: number;
        planKind: "participant-history-resample-indices-v1";
        generation: TrajectoryBootstrapPlan["generation"];
        rngParityClaim: false;
    };
    diagnostics: TrajectoryStatisticsDiagnostic[];
}
export declare class TrajectoryStatisticsError extends Error {
    readonly code: string;
    readonly path: string;
    constructor(code: string, path: string, message: string);
}
export declare function analyzeTrajectoryPath(input: TrajectorySeriesInput): TrajectoryPathStatistics;
export declare function getTrajectoryPermutationUnits(input: TrajectoryComparisonInput): TrajectoryPermutationUnits;
export declare function holmAdjust(pValues: number[]): number[];
export declare function compareTrajectoryPaths(input: TrajectoryComparisonInput): TrajectoryComparisonResult;
export declare function getTrajectoryBootstrapUnits(input: GetTrajectoryBootstrapUnitsInput): TrajectoryBootstrapUnits;
export declare function createSeededTrajectoryBootstrapPlan(input: CreateSeededTrajectoryBootstrapPlanInput): TrajectoryBootstrapPlan;
export declare function trajectoryPercentile(values: number[], probability: number): number;
export declare function bootstrapTrajectoryPath(input: TrajectoryBootstrapInput): TrajectoryBootstrapResult;
export {};
//# sourceMappingURL=trajectory-statistics.d.ts.map