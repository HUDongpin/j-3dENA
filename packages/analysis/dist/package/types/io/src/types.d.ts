export type Ena3dExchangeColumnType = "logical" | "integer" | "double" | "character" | "date" | "datetime" | "difftime" | "factor" | "ordered";
export type Ena3dDifftimeUnit = "secs" | "mins" | "hours" | "days" | "weeks";
export interface Ena3dLogicalColumn {
    readonly name: string;
    readonly type: "logical";
    readonly values: readonly (boolean | null)[];
}
export interface Ena3dIntegerColumn {
    readonly name: string;
    readonly type: "integer";
    readonly values: readonly (number | null)[];
}
export interface Ena3dDoubleColumn {
    readonly name: string;
    readonly type: "double";
    readonly values: readonly (number | null)[];
}
export interface Ena3dCharacterColumn {
    readonly name: string;
    readonly type: "character";
    readonly values: readonly (string | null)[];
}
export interface Ena3dDateColumn {
    readonly name: string;
    readonly type: "date";
    readonly values: readonly (string | null)[];
}
export interface Ena3dDatetimeColumn {
    readonly name: string;
    readonly type: "datetime";
    readonly timezone: string;
    readonly values: readonly (number | null)[];
}
export interface Ena3dDifftimeColumn {
    readonly name: string;
    readonly type: "difftime";
    readonly units: Ena3dDifftimeUnit;
    readonly values: readonly (number | null)[];
}
export interface Ena3dFactorColumn {
    readonly name: string;
    readonly type: "factor" | "ordered";
    readonly levels: readonly string[];
    readonly values: readonly (string | null)[];
}
export type Ena3dExchangeColumn = Ena3dLogicalColumn | Ena3dIntegerColumn | Ena3dDoubleColumn | Ena3dCharacterColumn | Ena3dDateColumn | Ena3dDatetimeColumn | Ena3dDifftimeColumn | Ena3dFactorColumn;
export interface Ena3dExchangeTable {
    readonly columns: readonly Ena3dExchangeColumn[];
}
export interface Ena3dExchangeTablesV1 {
    readonly meta_data: Ena3dExchangeTable;
    readonly points: Ena3dExchangeTable;
    readonly line_weights: Ena3dExchangeTable;
    readonly nodes: Ena3dExchangeTable;
    readonly adjacency_key: Ena3dExchangeTable;
}
export interface Ena3dExchangeV1 {
    readonly format: "ena3d-exchange";
    readonly version: 1;
    readonly dimensions: readonly string[];
    readonly group_variables: readonly string[];
    readonly tables: Ena3dExchangeTablesV1;
}
/** @internal Runtime marker is intentionally not re-exported by the package. */
export declare const VALIDATED_ENA3D_EXCHANGE_V1: unique symbol;
/**
 * An immutable exchange that passed byte, syntax, schema, semantic, and
 * resource validation. Consumers cannot construct this brand through the
 * public package API.
 */
export type ValidatedEna3dExchangeV1 = Ena3dExchangeV1 & {
    readonly [VALIDATED_ENA3D_EXCHANGE_V1]: true;
};
export interface HashedEna3dExchangeV1 {
    readonly exchange: ValidatedEna3dExchangeV1;
    readonly byteLength: number;
    /** Lowercase SHA-256 of the exact input bytes, before UTF-8 decoding. */
    readonly sha256: string;
}
export type Ena3dExchangeBytes = ArrayBuffer | ArrayBufferView;
//# sourceMappingURL=types.d.ts.map