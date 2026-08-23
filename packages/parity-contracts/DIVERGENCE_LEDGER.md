# 3DENA divergence ledger

The v1 entries below are retained as historical compatibility evidence only.
Longitudinal V2 does not use rENA as a numerical oracle or release gate. Its
normative numerical authority is the reviewed `jena-js@0.7.0-ona.0` build from
`HUDongpin/jENA@90790856f00bdef63dbd27fc3a5b502e8cffe65f`, supplied as one
exact non-optional peer dependency.

No numerical divergence is approved in v1. Entries below are open boundaries;
they are not permission to relax tests or update goldens.

| ID | Boundary | Status | Required disposition |
|---|---|---|---|
| DIV-001 | Legacy application uses rENA 0.2.7; jENA 0.6.2 was principally golden-tested against rENA 0.3.1 | Open | generate the same staged fixture under both versions, characterize every difference, then select/fix/approve per quantity |
| DIV-002 | Ordinary SVD column signs may differ across LAPACK and JavaScript solvers | Expected equivalence | apply one rotation-derived sign vector consistently; do not alter variance or distances |
| DIV-003 | Near-degenerate singular values may yield rotated bases inside the same subspace | Open | implement subspace/Gram/Procrustes comparison and a tied-spectrum fixture before approval |
| DIV-004 | Legacy RDS-byte hash is not portable to a pure TypeScript runtime | Open successor | approve source SHA-256 plus canonical JSON analysis-payload SHA-256; never claim RDS-byte parity |
| DIV-005 | R bootstrap uses R RNG, `sample`, and quantile type 7; the TypeScript candidate uses explicit resample plans plus a successor PRNG and makes no R RNG parity claim | Open | freeze cross-runtime resample indices for estimator parity and separately approve successor RNG/type-7 semantics before product integration |
| DIV-006 | `jena-js@0.6.2` declares a self-dependency on `jena-js@^0.6.0` | Resolved packaging defect (2026-08-21) | independently reviewed upstream commit `57b7794ec3873c251c33086454523e5a3949836f` published as public `jena-js@0.6.3`; reviewed and registry-redownloaded tarballs share SHA-256 `0387c7958718e1d8a70a29f056da1ffe78e94ceb14ac957a3a360b586ac23121`; the product pins one exact public-registry instance with zero runtime dependencies and byte-identical numerical `dist/` bytes |
| DIV-007 | Longitudinal V2 result values may intentionally differ from historical rENA/rENA-backed application outputs | V2 authority decision (2026-08-24) | adjudicate against the versioned jENA numerical contract, hand-calculable fixtures, invariants and deterministic V2 goldens; record the affected field and rationale, but never rewrite jENA output to imitate rENA |
| DIV-008 | V2 bootstrap and permutation use explicit deterministic participant-history plans rather than R RNG streams | V2 extension contract (2026-08-24) | freeze seed, plan hash, resampling unit, Type 7 percentile rule, finite-replicate audit and execution-equivalence result hash; no R RNG parity claim is permitted |
| DIV-009 | Public V2 runtime externalizes jENA instead of bundling it | Resolved V2 packaging contract (2026-08-24) | accept exactly one required peer `jena-js@0.7.0-ona.0`; verify official commit, tarball SHA-256/integrity, NUMERICS/PROVENANCE digests, installed-tree deduplication and Node/Vite/Next tarball consumers |

## Entry protocol

A divergence can become approved only when its entry records the reproducer,
both frozen outputs, scientific effect, affected fields, quantitative bound,
decision owner, review date, successor contract version, and regression test.
“The TypeScript result changed” is not an approval reason.
