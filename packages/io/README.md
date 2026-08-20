# `@3dena/io`

Browser-safe input validation for the ENA3D exchange format. The package
accepts bytes, not JavaScript objects, so the security checks cover the exact
upload payload before any value can enter analysis state.

```ts
import {
  decodeEna3dExchangeV1,
  decodeEna3dExchangeV1WithSha256,
  isHashedEna3dExchangeV1,
} from "@3dena/io";

const exchange = decodeEna3dExchangeV1(await file.arrayBuffer());
const receipt = await decodeEna3dExchangeV1WithSha256(
  await file.arrayBuffer(),
);
if (!isHashedEna3dExchangeV1(receipt)) throw new Error("untrusted receipt");
```

`decodeEna3dExchangeV1` is synchronous and returns a deeply frozen, branded
`ValidatedEna3dExchangeV1`. The brand is not constructible through the public
API. `decodeEna3dExchangeV1WithSha256` validates the same immutable byte
snapshot and also returns its lowercase SHA-256 and byte length. Hashing uses
WebCrypto, so both entry points work in a browser main thread or Web Worker and
the runtime package has no Node dependency.

Hashed receipts are also registered in a module-local `WeakSet`.
`isHashedEna3dExchangeV1()` therefore accepts only a receipt actually issued
by the same decoder module instance. It intentionally rejects object spreads,
hand-authored lookalikes, and structured clones. When analysis runs in a
Worker, transfer exact bytes and decode them inside that Worker immediately
before consumption; do not treat a cloned validated DTO as custody evidence.

The decoder rejects an empty input, a UTF-8 BOM, malformed UTF-8, duplicate
JSON keys (including escape-equivalent keys), nesting beyond 16 containers,
invalid JSON, unknown fields, invalid column types or scalar values, table and
metadata misalignment, incomplete adjacency, or mismatched adjacency/line-
weight order. All numeric values must be finite. Nodes and line weights must
be complete; point dimensions may use `null`.

The default file limit is 2 MiB. Callers may lower limits or raise them only up
to the exported hard ceilings; the file-size hard ceiling is 10 MiB. Row,
node, dimension, metadata-column, total-cell, group-level, and unit ceilings
are enforced during validation. Limits are validation policy only and cannot
disable the fixed depth gate.
