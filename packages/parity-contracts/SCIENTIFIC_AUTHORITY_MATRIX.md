# Scientific authority matrix v1

This is the decision register for per-quantity authority. `Open decision` is a
hard parity blocker, not permission to copy whichever output is convenient.

| Quantity | Candidate authority | Current decision | Comparison rule | Required fixture |
|---|---|---|---|---|
| accumulated model counts | legacy rENA 0.2.7 | open independent approval | exact names/order/values | small-raw plus raw Class 1 |
| source row counts | legacy rENA 0.2.7 | open independent approval | exact typed row identity/order/values | small-raw plus duplicate rows |
| normalized line weights | per-quantity 0.2.7/0.3.1 review | open decision | quantity-specific abs/rel tolerance | small-raw, zero and weighted cases |
| center vector | jENA/rENA shared algorithm | candidate only | exact where possible, otherwise frozen tolerance | small-raw and uncentered case |
| ordinary SVD rotation | semantic successor | sign alignment approved in contract; fixture approval open | one sign vector applied to rotation/points/nodes | small-raw and Class 1 raw |
| near-degenerate SVD | semantic successor | projector-comparison candidate implemented; authority/tolerance approval open | rank-checked orthogonal-projector max/Frobenius error, or an independently approved successor | governed tied-spectrum oracle fixture |
| projected points | selected per-quantity oracle | candidate only | typed row order plus abs/rel tolerance | small-raw and Class 1 raw |
| node coordinates | selected per-quantity oracle | candidate only | code order plus abs/rel tolerance | small-raw and Class 1 raw |
| eigenvalues and variance | selected per-quantity oracle | candidate only | full inventory and per-field tolerance | small-raw and Class 1 raw |
| participant-period reduction | legacy application 0.2.7 | open decision | exact membership/source indexes; numeric tolerance | duplicates and Class 1 raw |
| group-time centroids | legacy application 0.2.7 | blocked; legacy prepared candidate quarantined and not approved evidence | exact group/time/N; quantity-specific numeric tolerance | authorized Class 1 raw centroids only |
| network difference | legacy application 0.2.7 | open decision | `mean(A)-mean(B)`, exact edge order/sign | two-group fixture |
| Welch statistic/p/mean-difference CI/effect | legacy application 0.2.7, with reviewed high-precision successor arithmetic where R rejects extreme finite inputs | alternative-aligned 95% t-interval implementation candidate; authority remains open | exact method/bound tags plus per-field tolerance and exact N/drop; undefined degrees of freedom must stay explicitly undefined; unrepresentable finite arithmetic returns explicit diagnostics rather than JSON infinity | balanced/unbalanced/missing/zero-variance/extreme-dynamic-range fixtures |
| rank-sum statistic/p/effect | per-quantity legacy review | open tie/continuity decision | exact tie ranks and approved p tolerance | ties/zeros/one-sided fixtures |
| signed-rank statistic/p/effect and paired mean-difference CI | legacy application 0.2.7 | open zero/exact/asymptotic decision; paired-t CI is an implementation candidate only; constant paired-difference interval disposition remains open | exact matching/ranks and approved p tolerance; CI method must not be attributed to signed-rank | paired ties/zeros/constant-difference/unmatched fixtures |
| p-value adjustments | successor standard formulas | implementation candidate | exact order-stable adjusted values | none/Holm/BH/Bonferroni fixture |
| trajectory selected/full distance | legacy application 0.2.7 | open decision | selected and all-retained dimensions separate | >3D irregular path fixture |
| elapsed time and speed | legacy application 0.2.7 | open type/unit decision | exact elapsed units and tolerant division | numeric/Date/instant/difftime fixtures |
| weighted trajectory | legacy application 0.2.7 | open estimator decision | exact weights/membership and numeric tolerance | unequal-weight fixture |
| paired path comparison | legacy application 0.2.7 | open decision | exact typed ID-time matches and direction | matched/unmatched fixture |
| independent path comparison | strict repository inventory | open decision | frozen exchangeability/permutation family | independent fixture |
| bootstrap resampling | frozen successor plan plus legacy estimator | cluster unit fixed; plan approval open | exact participant-history resample indices | explicit resample-plan fixture |
| bootstrap quantiles | R type 7 candidate | implementation candidate; approval open | exact type-7 indexing then numeric tolerance | odd/even/tied replicate arrays |
| bootstrap RNG | successor versioned RNG | no R RNG parity claim | exact generated index receipt within successor | seed 2026 plan fixture |

Every approved row must add the decision owner, independent reviewer, review
date, exact oracle versions, fixture hashes, spec hash, seed where applicable,
schema version, and absolute/relative tolerance. Updating an expected output
from the TypeScript implementation alone is prohibited.

## Machine-readable release gate

`scientific-authority.matrix.v1.json` is the tracked release input. It is
intentionally `blocked` with no approval rows until the real oracle, comparison,
and independent-review receipts exist. `src/scientific-authority.ts` freezes 55
independently approvable quantities and exposes
`requireApprovedScientificAuthorityV1()` as the fail-closed gate.

The machine-readable inventory is normative. Summary rows in the table above
do not merge approvals: variance and eigenvalues; row, column, order, and schema;
each statistics policy and adjustment family; each cohort, missing/gap,
estimand, distance, elapsed, speed, pairing, and permutation decision; and each
bootstrap cluster, strata, plan, PRNG, seed, quantile, interval, and rotation
decision remain separate gates.

The gate accepts exactly one independently reviewed `approved` row per frozen
quantity. Each row binds the fixture, exact input, mapping, analysis spec, both
rENA outputs, TypeScript output, comparison report, quantity-specific tolerance,
regression test, implementer, reviewer, and dated decision. Generated,
candidate, duplicated, incomplete, self-reviewed, or status-flipped rows cannot
make the matrix release-approved.
