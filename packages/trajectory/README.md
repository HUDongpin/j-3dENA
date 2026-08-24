# @3dena/trajectory

Framework-independent, browser-safe TypeScript trajectory dynamics for the
3DENA successor. The package has no runtime dependencies and does not import or
invoke R, rENA, jENA, React, a Worker, or a service adapter.

The additive `analyzeTrajectoryDynamicsV1()` entry point accepts coordinates
that already share one ENA rotation. It returns deterministic participant-
period reductions, group-time centroids, selected/full-space path distances,
elapsed time, speed, diagnostics, and explicit evidence scope. Its result is
structured-clone safe and deeply frozen.

## Versioned v1 semantics

- Participant and period identities use collision-safe typed tuple keys.
  Integer identities above `Number.MAX_SAFE_INTEGER` must be supplied as
  lossless strings. Number identities use their exact IEEE-754 bit pattern, so
  adjacent doubles and `-0`/`0` do not collapse.
- Duplicate source rows are reduced to one participant-period coordinate by an
  equal-row compensated mean before any group-time centroid is calculated.
- `available` uses every observed eligible participant-period. `complete`
  removes any participant missing an expected period from every period before
  centroid calculation.
- `equal-participant-v1` assigns one unit of centroid weight to every reduced
  participant-period. Any supplied weights are ignored with a warning.
- `weighted-participant-v1` requires a finite positive weight on every source
  row. Duplicate rows for one participant-period must agree on that weight.
  The group-time centroid uses normalized participant weights; the result also
  reports the unscaled weight sum when representable and Kish-style effective
  participant N. Time-varying participant weights are supported but diagnosed
  because they define a period-specific estimand.
- Selected-space distances use exactly the three declared display dimensions;
  full-space distances use every declared coordinate in order. Both are
  Euclidean.
- An expected period with no usable centroid is an explicit gap. The package
  never bridges it. The first local step after two adjacent observed periods can
  resume, but cumulative path distance remains `null` after the gap.
- Speed is adjacent step distance divided by a strictly positive adjacent
  elapsed interval. It is `null` for the first period and whenever the step is
  unavailable.

## Typed time contracts

Every period has a typed identity and a separate versioned time value. All
periods in one analysis must use the same time contract and must be strictly
increasing.

- `numeric-v1` preserves the caller's exact non-empty unit label and performs
  no implicit unit conversion.
- `date-v1` validates strict `YYYY-MM-DD` values in the proleptic Gregorian
  calendar and reports elapsed civil days, independent of host time zone or DST.
- `instant-v1` orders signed canonical int64 epoch-millisecond strings exactly.
  Time-zone label, UTC offset, and fold are retained as presentation provenance;
  they do not override the epoch. Adjacent epoch differences must fit exact
  JavaScript integer conversion before division into the declared elapsed unit.
- `difftime-v1` converts milliseconds, seconds, minutes, hours, days, or weeks
  using frozen fixed-duration ratios into one declared output unit. Calendar
  months and years are intentionally not accepted as fixed durations.

## Diagnostics and evidence boundary

Results include per-period row, participant-period, used/excluded, weight-sum,
effective-N, elapsed, centroid, distance, and speed fields. Diagnostics cover
duplicate reduction, ignored or time-varying weights, complete-cohort
exclusions, missing expected periods, path gaps, changing available cohorts,
single-participant centroids, concentrated weights, and unrepresentable raw
weight sums. Invalid contracts fail with `TrajectoryDynamicsError` carrying a
stable code and path.

Every v1 result deliberately carries:

```text
status = IMPLEMENTED_UNVERIFIED
oracleParityClaim = false
scientificAuthority = successor-definition-pending-review
```

Passing package tests proves this implementation contract only. It does not
establish rENA 0.2.7, rENA 0.3.1, Class 1, UI, Worker/service, export, browser,
or production parity.

## Remaining scientific and product gates

The following remain unresolved until a versioned authority decision and
independent oracle review are recorded:

- whether legacy `equal` and `weighted` mean exactly the v1 participant-level
  definitions, including how duplicate-row weights and time-varying weights
  should behave;
- the authoritative output unit and zero/negative-time policy for every legacy
  numeric, Date, instant/POSIXct, and difftime fixture;
- missing/gap and cumulative-distance behavior where rENA 0.2.7 and 0.3.1 may
  differ;
- tolerance, ordering, name, metadata, and diagnostic goldens;
- integration with the existing comparison/permutation and participant-cluster
  bootstrap candidates, including weighted resampling semantics and speed
  intervals;
- Worker or persistent-service cancellation, progress, ownership, and resource
  receipts;
- Plotly traces, accessible UI controls, formal CSV/ZIP export, and Class 1 raw
  evidence; and
- BCa, studentized, simultaneous intervals, model-refit uncertainty, and any
  legacy behaviors that the capability ledger has not yet adjudicated.

Do not describe this package as `VERIFIED_PARITY`, `PRODUCTION_CANDIDATE`, or a
complete replacement until those gates close.
