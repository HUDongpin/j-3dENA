import { type Ena3dExchangeLimits } from "./limits.js";
import { type Ena3dExchangeBytes, type HashedEna3dExchangeV1, type ValidatedEna3dExchangeV1 } from "./types.js";
/**
 * Decode an exact ENA3D exchange v1 byte snapshot into a deeply frozen,
 * branded DTO. No hashing or Node API is needed on this synchronous path.
 */
export declare function decodeEna3dExchangeV1(bytes: Ena3dExchangeBytes, limits?: Partial<Ena3dExchangeLimits>): ValidatedEna3dExchangeV1;
/**
 * Decode and bind a SHA-256 receipt to the exact immutable byte snapshot used
 * for validation. Uses browser WebCrypto and remains safe in a Web Worker.
 */
export declare function decodeEna3dExchangeV1WithSha256(bytes: Ena3dExchangeBytes, limits?: Partial<Ena3dExchangeLimits>): Promise<HashedEna3dExchangeV1>;
/** True only for a hashed receipt issued by this module instance. */
export declare function isHashedEna3dExchangeV1(value: unknown): value is HashedEna3dExchangeV1;
/** SHA-256 of exact raw bytes, constrained by the same file-size policy. */
export declare function sha256Ena3dExchangeBytes(bytes: Ena3dExchangeBytes, limits?: Partial<Ena3dExchangeLimits>): Promise<string>;
//# sourceMappingURL=decode.d.ts.map