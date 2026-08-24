export declare class TrajectoryDynamicsError extends Error {
    readonly code: string;
    readonly path: string;
    constructor(code: string, path: string, message: string);
}
export declare function rejectTrajectoryDynamics(code: string, path: string, message: string): never;
//# sourceMappingURL=errors.d.ts.map