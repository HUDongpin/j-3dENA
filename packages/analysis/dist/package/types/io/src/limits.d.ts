export interface Ena3dExchangeLimits {
    readonly maxFileBytes: number;
    readonly maxPointRows: number;
    readonly maxNodes: number;
    readonly maxDimensions: number;
    readonly maxMetadataColumns: number;
    readonly maxTableCells: number;
    readonly maxGroupLevels: number;
    readonly maxUnits: number;
}
export declare const ENA3D_EXCHANGE_V1_MAX_JSON_DEPTH = 16;
export declare const DEFAULT_ENA3D_EXCHANGE_LIMITS: Readonly<Ena3dExchangeLimits>;
export declare const HARD_ENA3D_EXCHANGE_LIMITS: Readonly<Ena3dExchangeLimits>;
export declare function resolveEna3dExchangeLimits(requested?: Partial<Ena3dExchangeLimits>): Readonly<Ena3dExchangeLimits>;
//# sourceMappingURL=limits.d.ts.map