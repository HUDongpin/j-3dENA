# 3DENA divergence ledger

No numerical divergence is approved in v1. Entries below are open boundaries;
they are not permission to relax tests or update goldens.

| ID | Boundary | Status | Required disposition |
|---|---|---|---|
| DIV-001 | Legacy application uses rENA 0.2.7; jENA 0.6.2 was principally golden-tested against rENA 0.3.1 | Open | generate the same staged fixture under both versions, characterize every difference, then select/fix/approve per quantity |
| DIV-002 | Ordinary SVD column signs may differ across LAPACK and JavaScript solvers | Expected equivalence | apply one rotation-derived sign vector consistently; do not alter variance or distances |
| DIV-003 | Near-degenerate singular values may yield rotated bases inside the same subspace | Open | implement subspace/Gram/Procrustes comparison and a tied-spectrum fixture before approval |
| DIV-004 | Legacy RDS-byte hash is not portable to a pure TypeScript runtime | Open successor | approve source SHA-256 plus canonical JSON analysis-payload SHA-256; never claim RDS-byte parity |
| DIV-005 | R bootstrap uses R RNG, `sample`, and quantile type 7; no TypeScript bootstrap contract exists here | Open | freeze resample indices for estimator parity and separately approve RNG/quantile semantics |
| DIV-006 | `jena-js@0.6.2` declares a self-dependency on `jena-js@^0.6.0` | Packaging defect | remove in a reviewed successor and prove one resolved jENA version in the production dependency graph |

## Entry protocol

A divergence can become approved only when its entry records the reproducer,
both frozen outputs, scientific effect, affected fields, quantitative bound,
decision owner, review date, successor contract version, and regression test.
“The TypeScript result changed” is not an approval reason.
