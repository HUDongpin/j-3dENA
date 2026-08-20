# 3DENA parity matrix

The state names follow repository `AGENTS.md`. Passing a narrower row does not
promote a broader milestone.

| Boundary | Fixture / evidence | Current state | Closure requirement |
|---|---|---|---|
| Frozen source versions | contract v1 | `IMPLEMENTED_UNVERIFIED` | verify packed `jena-js@0.6.2` integrity and exact oracle environments |
| small-raw source custody | CSV + SHA-256 provenance | `PARITY_CANDIDATE` | independent custody review |
| raw mapping and limits | analysis unit tests | `PARITY_CANDIDATE` | integrated parser/security cases |
| AccumulatedTrajectory, moving back 4 | jENA execution test | `IMPLEMENTED_UNVERIFIED` | compare staged counts/weights to frozen rENA 0.2.7 golden |
| sphere normalization and center | public result + ungoverned candidate diagnostic | `IMPLEMENTED_UNVERIFIED` | approved rENA 0.2.7 center/line-weight fixture |
| shared SVD1/SVD2/SVD3 | one facade call + trajectory tests + ungoverned candidate diagnostic | `PARITY_CANDIDATE` | approved sign-aligned rENA 0.2.7 numeric report |
| projected points | ungoverned candidate diagnostic passed | `IMPLEMENTED_UNVERIFIED` | governed row-key exact, sign-aligned tolerance pass |
| node positions | ungoverned candidate diagnostic passed | `IMPLEMENTED_UNVERIFIED` | governed code-order exact, sign-aligned tolerance pass |
| variance/eigenvalues | ungoverned candidate diagnostic passed | `IMPLEMENTED_UNVERIFIED` | governed full-basis denominator and tolerance pass |
| participant-period reduction | duplicate-step unit test | `PARITY_CANDIDATE` | legacy Class 1 or dedicated oracle fixture |
| available/complete cohorts | missing-period unit test | `PARITY_CANDIDATE` | full missing/gap/cohort oracle matrix |
| group-time centroids and paths | shared-space unit tests | `PARITY_CANDIDATE` | Class 1 15-centroid approved golden |
| display filter invariant | object-identity unit test | `PARITY_CANDIDATE` | UI structural + export invariance test |
| SVD sign indeterminacy | synthetic comparator test | `PARITY_CANDIDATE` | real oracle fixture pass |
| Fixture custody and approval gate | synthetic generated/approved/tamper tests | `PARITY_CANDIDATE` | independently reviewed real oracle fixture plus CI approved-only gate |
| degenerate SVD subspace | contract only | `PLANNED` | tied-spectrum fixture and projection/Gram/Procrustes comparator |
| bootstrap clusters/RNG/quantiles | none | `PLANNED` | fixed resample-plan estimator fixture plus explicit RNG policy |
| Web Worker hard cancellation | outside this package | `PLANNED` | terminate/rebuild, timeout, stale ownership, crash, capacity tests |
| Plotly structural semantics | outside this package | `PLANNED` | trace-role/layout/axis/filter/export assertions |
| production contains no R | outside this package | `PLANNED` | exact build dependency and artifact scan |

Current package-level conclusion: the reusable facade and comparison machinery
are calibration candidates. Scientific equivalence to the legacy application
is not yet established because the exact rENA 0.2.7 numeric fixture remains
pending.

## Ungoverned calibration diagnostic

On 2026-08-20, an explicit environment-gated test read a temporary candidate
whose reported artifact SHA-256 was
`fa865c6c318431bddbeb530beafc17413ef0f5d1c48e414ec0b1c89b0339a03b` and whose
canonical analysis-payload SHA-256 was
`b8d5708d3bf71341f39013f73c450bd66d5b145e06cdd95bf6e5cea77d0d3e5d`.
Seven public DTO fields passed the v1 comparator: line weights, center vector,
full rotation matrix, points, nodes, full variance, and full eigenvalues.
Connection counts and row connection counts were present in the oracle but are
not exposed by the public DTO, so they remain a coverage gap.

The rotation-derived sign vector was `[-1, +1, -1, +1, +1, +1]` for
`SVD1` through `SVD6`. Maximum absolute errors in that diagnostic were: line
weights `0`, center `0`, rotation `9.992007221626409e-16`, points
`7.216449660063518e-16`, nodes `2.1719919196527826e-9`, variance
`8.326672684688674e-17`, and eigenvalues `5.551115123125783e-17`; every
field had zero mismatches under its versioned tolerance.

That temporary candidate was generated before the generator's final Git-commit
enforcement was added. It was not copied into `fixtures/`, was not adopted, and
does not change the tracked golden envelope from `pending`. The diagnostic is a
useful calibration result, not governed parity evidence. Under the custody-aware
comparator it exposes `numericStatus: pass` for the seven selected public fields
but combined `status: candidate-invalid`, because its generator Git commit,
timestamp/runtime provenance, and current generator-byte binding are not valid.
