# Prepared ENA exchange boundary

## Purpose

`ena3d-exchange` version 1 is a portable, precomputed ENA coordinate-space
format. It is not raw coded data. The browser may validate, inspect, filter,
reduce, and visualize the imported points, nodes, and line weights, but it must
not claim that jENA reconstructed those values from raw rows.

The raw-data and prepared-data paths are intentionally separate:

```text
raw CSV -> browser Worker -> jENA accumulation/rotation -> AnalysisResult

.ena3d.json -> browser Worker -> strict exchange validation
            -> prepared-space reduction -> PreparedSpaceResult
            -> canonical result SHA-256 + DatasetReceiptV1
            -> public executeAnalysisTask() V2
            -> Comparison / Change / Stats result envelope
```

Neither path may call a server, native runtime, or legacy service. Native
serialized objects are never accepted by the browser application.

## Trust and provenance

Every exchange starts untrusted. Validation is based on the exact input bytes,
not on a re-serialized JavaScript object. A successful receipt records the
byte count and SHA-256 of those bytes.

The hashed receipt also has same-realm runtime custody. Object spread and
structured cloning deliberately remove that authority. Exact bytes cross the
main-thread/Worker boundary; the analysis Worker decodes, hashes, checks the
activated dataset hash, and immediately reduces the issued receipt in the same
module realm.

The reducer does not attach study-specific oracle provenance by recognizing an
input hash. Every prepared file receives generic precomputed-compatibility
provenance and no parity approval. A separate, independently reviewed release
receipt would be required to make any stronger fixture-scoped claim.

The legacy prepared Class 1 candidate is quarantined outside the public tree as
`sensitive-excluded`. It contains participant identities and has no current
authorization, de-identification review, independent approval, or raw-parity
standing. Its exact hash, byte count, row counts, dimensions, identities, and
aggregate values are not tracked evidence and it is not a committable fixture.

## Validation before activation

Prepared import is transactional. The active dataset and any owned result stay
unchanged unless the complete candidate passes all checks inside a dedicated
browser Worker. Validation includes:

- a 2 MiB default file limit and an immutable 10 MiB hard ceiling;
- fatal UTF-8 decoding, no byte-order mark, duplicate-key detection before
  `JSON.parse`, and a maximum JSON nesting depth of 16;
- exact top-level and table fields with no silent extensions;
- strict tagged column types and finite numeric values;
- unique column names, equal column lengths, and cross-table row alignment;
- exact dimension, node, edge, metadata, and adjacency ordering;
- a complete undirected adjacency over all code nodes, with no self-edge;
- point, node, dimension, metadata, cell, group, and unit resource ceilings.

A failed or stale import attempt cannot replace the active dataset. Analysis
revalidates an immutable byte snapshot, and result publication remains bound to
dataset hash, specification hash, run ID, and Worker identity.

## Generic prepared shared-space invariant

Prepared tests use fully synthetic identities, periods, coordinates, nodes, and
edge weights. The mapping explicitly selects complete typed participant,
label, group, and time columns plus an ordered period list and three display
dimensions. Every imported coordinate and line-weight column remains in the
full space, while display selection projects exactly three named dimensions
without mutating source rows or recomputing a model. The prepared result
truthfully records that rotation, eigenvalue, and explained-variance artifacts
are absent and that no raw-row jENA recomputation occurred.

## Derived AnalysisTask boundary

Prepared Comparison, Change, and Stats no longer use the Web application's
historical local reducers. Each dedicated derived-analysis Worker:

1. receives the exact activated `DatasetReceiptV1`, current build identity and
   immutable `datasetHash + specHash + runId + taskId` owner;
2. recomputes the canonical SHA-256 of the complete `PreparedSpaceResult`;
3. constructs a discriminated `3dena.analysis-execution-dataset.v2` source with
   `sourceKind: prepared-exchange`;
4. invokes the public `@3dena/analysis` `executeAnalysisTask()` entry; and
5. publishes only a runtime-validated `AnalysisResultEnvelopeV1` owned by the
   issued task.

The resulting Comparison and Change schemas are the shared
`3dena.network-comparison.v1` and `3dena.change-network.v1` contracts. Stats
uses `3dena.statistics-task-result.v1` and exposes independent/paired design,
two-sided/greater/less alternatives, none/Holm/BH/Bonferroni adjustment and an
explicit same-physical-entity confirmation before paired execution. Provenance
remains `sourceKind: prepared-exchange`, `jenaExecuted: false`, evidence remains
`IMPLEMENTED_UNVERIFIED`, and `approvedForParity` remains false.

Prepared trajectory, trajectory comparison, and bootstrap use the same public
task executor with explicit fixed-imported-space semantics. They remain
`sourceKind: prepared-exchange`, `jenaExecuted: false`, and unapproved for
parity; none of them implies a model refit or raw-data recomputation.

## Claim boundary

Passing the synthetic prepared centroid and Plotly gates demonstrates only safe
generic import, fixed-space reduction, and rendering. It does not demonstrate
Class 1 behavior, raw accumulation, SVD parity, or approval. Those claims
require authorized private raw custody, dual oracle recomputation, per-quantity
scientific decisions, and independently approved privacy-reviewed receipts.
