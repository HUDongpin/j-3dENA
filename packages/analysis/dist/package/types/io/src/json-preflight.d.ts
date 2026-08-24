/**
 * Complete, non-materializing JSON grammar scan. It runs before JSON.parse so
 * duplicate keys and excessive depth cannot be normalized away by the host
 * parser. Only object keys are decoded; all other values are scanned in place.
 */
export declare function preflightJsonText(text: string): void;
//# sourceMappingURL=json-preflight.d.ts.map