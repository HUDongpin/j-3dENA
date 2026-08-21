# 3DENA parity matrix

The state names follow repository `AGENTS.md`. Passing a narrower row does not
promote a broader milestone.

| Boundary | Fixture / evidence | Current state | Closure requirement |
|---|---|---|---|
| Frozen source versions | contract v1 | `IMPLEMENTED_UNVERIFIED` | verify packed `jena-js@0.6.2` integrity and exact oracle environments |
| small-raw source custody | CSV + generated manifest + exact hash validation | `PARITY_CANDIDATE` | independent approval record |
| raw mapping and limits | analysis unit tests | `PARITY_CANDIDATE` | integrated parser/security cases |
| AccumulatedTrajectory, moving back 4 | governed model/row count and line-weight comparison | `PARITY_CANDIDATE` | independently approved fixture |
| sphere normalization and center | governed complete candidate comparison | `PARITY_CANDIDATE` | independently approved fixture |
| shared SVD1/SVD2/SVD3 | one facade call + trajectory tests + governed candidate | `PARITY_CANDIDATE` | approved sign-aligned numeric report |
| projected points | governed exact-row-order candidate pass | `PARITY_CANDIDATE` | independent approval |
| node positions | governed exact-code-order candidate pass | `PARITY_CANDIDATE` | independent approval |
| variance/eigenvalues | governed full-basis candidate pass | `PARITY_CANDIDATE` | independent approval |
| raw full-dimensional coordinates | one shared fit now retains all rotation columns with resource gates | `IMPLEMENTED_UNVERIFIED` | approved raw Class 1/full-space oracle and product dimension selector |
| typed public contracts and JSON Schemas | strict validators plus generated scalar/key/receipt/spec/display/task/evidence/provenance/envelope schemas; envelope task kind is bound to result schema and provenance entries | `IMPLEMENTED_UNVERIFIED` | complete per-field validators for every result variant, independent schema/API review, cross-client/service conformance and version-negotiation evidence |
| Comparison A-minus-B network | raw/prepared discriminated public task core plus Worker/Web candidates; prepared is hash/receipt-bound and non-jENA | `IMPLEMENTED_UNVERIFIED` | per-quantity oracle, confidence-language decision, full trace/export matrix and independent approval |
| Change exact-level network | raw/prepared discriminated public task core plus Worker/Web candidates; prepared remains one-level descriptive reduction | `IMPLEMENTED_UNVERIFIED` | legacy cardinality/cache/error oracle and approved product semantics |
| independent and paired coordinate Stats | typed stats core plus raw/prepared public task candidates; prepared pairs on full typed participant-time identity; 95% Welch/paired-t mean-difference intervals are method-tagged in result/UI/formal CSV | `IMPLEMENTED_UNVERIFIED` | formula/tie/zero/CI/multiplicity oracle, paired browser flow, prepared inferential disposition and independent approval |
| participant-period reduction | synthetic duplicate-step unit test | `IMPLEMENTED_UNVERIFIED` | authorized raw Class 1 or dedicated approved oracle fixture |
| available/complete cohorts | missing-period unit test | `IMPLEMENTED_UNVERIFIED` | full missing/gap/cohort oracle matrix |
| group-time centroids and paths | fully synthetic fixed-imported-space unit tests | `PRECOMPUTED_COMPATIBILITY_CANDIDATE` | authorized raw Class 1 recomputation and independently approved per-quantity oracle rows |
| trajectory elapsed/speed/weighting | additive dynamics package, task and formal CSV candidates for numeric/Date/instant/difftime and selected/full space | `IMPLEMENTED_UNVERIFIED` | frozen estimator/time-unit decision, oracle, UI/Plotly and service lifecycle |
| display filter invariant | object-identity unit test | `IMPLEMENTED_UNVERIFIED` | UI structural + export invariance test |
| SVD sign indeterminacy | synthetic comparator test | `IMPLEMENTED_UNVERIFIED` | real oracle fixture pass |
| Fixture custody and approval gate | synthetic generated/approved/tamper tests | `PARITY_CANDIDATE` | independently reviewed real oracle fixture plus CI approved-only gate |
| Class 1 exchange custody | bounded source-lineage receipt binds two byte-identical 13,176-byte legacy prepared copies and the preparation script that discards raw caches; no exact raw source, frozen raw mapping, custody signature, or independent approval was located in the named checkout scope | blocked | written authorization, de-identification review, exact-byte private custody and independently approved aggregate/hash-only receipts; prepared input can never substitute for raw Class 1 parity |
| degenerate SVD subspace | strict candidate comparator uses rank-checked orthogonal projectors and passes rotation/sign/permutation versus different-subspace tests | `IMPLEMENTED_UNVERIFIED` | governed tied-spectrum oracle fixture, tolerance decision and independent approval |
| trajectory path comparison | package-level typed paired/independent candidate tests | `IMPLEMENTED_UNVERIFIED` | oracle, service/Worker, UI, Plotly and export closure |
| bootstrap clusters/RNG/quantiles | package-level participant-history/type-7 candidate tests; RNG parity explicitly false | `IMPLEMENTED_UNVERIFIED` | fixed resample-plan oracle, policy approval, lifecycle, UI and export closure |
| Web Worker hard cancellation | module-Worker termination, owner/generation stale suppression and focused browser tests | `IMPLEMENTED_UNVERIFIED` | exact optimized cancellation fixture, crash/max-plus-one/memory recovery and multi-browser evidence |
| persistent compute orchestration | in-memory lease/fencing/CAS/cancel/TTL and framework-neutral HTTP candidates plus a real single-host Node supervisor and publish-acknowledged scientific child | `IMPLEMENTED_UNVERIFIED` | PostgreSQL/S3 adapters, distributed capacity, restart reattachment/acknowledgement replay, complete task matrix and hardened container evidence |
| transactional spreadsheet workflow | exact browser/service byte custody, parsed-content hash, inventory/sheet selection, typed mapping preview and atomic in-memory activation | `IMPLEMENTED_UNVERIFIED` | HTTP/UI, durable encrypted adapters, real XLS/XLSX workflow integration, restart/TTL/deletion and browser evidence |
| Plotly structural semantics | pure compiler tests for roles, axes, 2D/3D layout, camera, filters and prepared provenance | `IMPLEMENTED_UNVERIFIED` | centralized Web use plus confidence/network/trajectory structural and browser matrix |
| public SDK package | local prerelease tarball with bundled runtime, declarations/maps/schemas/notices/provenance; fresh Node/TS/Vite/Next smoke; exact dirty snapshot fresh-dependency full check | `IMPLEMENTED_UNVERIFIED` | clean-checkout reproduction, registry provenance, public API approval and release gates |
| production contains no R | runtime-boundary verifier and artifact/package candidates | `IMPLEMENTED_UNVERIFIED` | clean exact Web/Compute/SDK image dependency and filesystem scans |

Current package-level conclusion: the reusable facade and its local task,
Plotly, export, Stats and trajectory candidates form a broader implemented
surface around the complete small-raw calibration candidate. Scientific
equivalence to the legacy application is not verified because the generated
evidence has no independent approval record, raw Class 1 is unavailable, and
the service/product/release matrix remains open.

## Governed generated calibration candidate

On 2026-08-20, the frozen generator at repository commit
`4a0f0a6c79b8872e0a07d6ac239b5a4e863a6d48` produced the tracked generated
small-raw candidate. Its artifact SHA-256 is
`35458bc85fa665d0d3449fc07a4f308f35c821bfa8edda0862a2fff759c5c245`, and its
canonical analysis-payload SHA-256 is
`b8d5708d3bf71341f39013f73c450bd66d5b145e06cdd95bf6e5cea77d0d3e5d`.
All nine fields pass the v1 comparator in complete scope: accumulated model
counts, source-row counts, line weights, center vector, full rotation matrix,
points, nodes, full variance, and full eigenvalues. The production DTO exposes
the first two under neutral `modelCounts` and `rowCounts` names; the parity
normalizer maps them to the oracle schema.

Model counts, source-row counts, line weights, and center match exactly. The
rotation-derived sign vector is `[-1, +1, -1, +1, +1, +1]` for
`SVD1` through `SVD6`. Maximum absolute errors in that diagnostic were: line
weights `0`, center `0`, rotation `9.992007221626409e-16`, points
`7.216449660063518e-16`, nodes `2.1719919196527826e-9`, variance
`8.326672684688674e-17`, and eigenvalues `5.551115123125783e-17`; every
field has zero mismatches under its versioned tolerance.

The comparator reports `fixtureStatus: generated`, `numericStatus: pass`,
`comparisonScope: complete`, `status: candidate-pass`, and
`approvedForParity: false`. No `approval` object exists. Therefore the result
is governed candidate evidence, not approved evidence and not
`VERIFIED_PARITY`.

The legacy prepared Class 1 candidate is quarantined outside the public parity
tree because it contains participant identities and has no authorization or
de-identification review for this release. Its disposition is
`sensitive-excluded`: it is not a committable fixture, contributes no tracked
aggregate oracle evidence, has no independent approval, and provides no raw
parity. Future release evidence may retain only privacy-reviewed hash-only or
approved aggregate receipts; exact bytes remain in private custody.

The later non-sensitive source-lineage investigation under
`evidence/scientific/` records only the two prepared RData identities and the
legacy preparation-script semantics. Both copies are 13,176 bytes with SHA-256
`16c74f4e2ab4580f5742f2c46684e24bb7ab3417c0c0b66ba99f7bb2fed9debc`.
The script accepts a private `INPUT.RData`, pseudonymizes Speaker and Condition,
and round-trips through the public exchange contract specifically to discard
raw-input caches. The bounded checkout/history search found no exact raw
coded-row source, frozen raw mapping, custody signature, or independent
scientific approval. That is a scoped negative finding, not a claim that the
private raw source does not exist; it closes 0 of 55 scientific quantities.
