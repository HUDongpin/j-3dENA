# @3dena/analysis

Framework-independent, synchronous TypeScript facade for one complete 3D ENA
model plus shared-space group/time centroid trajectories.

```ts
import { analyzeRows, selectTrajectoryDisplay } from "@3dena/analysis";

const result = analyzeRows({
  rows,
  mapping: {
    units: ["Group", "Name"],
    conversation: ["Lesson"],
    codes: ["EC", "ICT", "MCO", "ATT"],
    trajectory: {
      participant: ["Name"],
      group: "Group",
      time: "Lesson",
      timeOrder: ["Lesson 1", "Lesson 2"],
      cohortPolicy: "available"
    }
  },
  config: {
    model: "AccumulatedTrajectory",
    window: "MovingStanzaWindow",
    weightBy: "binary",
    windowSizeBack: 4,
    windowSizeForward: 0,
    centerAlignToOrigin: true
  }
});

const oneGroup = selectTrajectoryDisplay(result.trajectory!, {
  groups: [result.trajectory!.groupOrder[0]!.canonical]
});
```

`AnalysisResult` is structured-clone safe. It retains every available jENA
rotation dimension for points and nodes, while `axes` remains a separate
three-axis display selection. It also contains ordered edges and normalized
point weights, variance/eigenvalues, the full shared rotation, diagnostics,
neutral baseline identifiers, typed accumulation tables, and optional
participant-period/centroid/path rows computed in that same shared fit.

`result.accumulation.modelCounts` contains the accumulated edge counts aligned
one-for-one with model points. `result.accumulation.rowCounts` contains source-
grain code and edge counts in emitted source order. Both use neutral public DTO
names, ordered numeric columns, finite numeric matrices, and typed `EntityKey`
rows. For the calibrated trajectory input, those keys are the original
`Group` + `Name` + `Lesson` tuple, not jENA's internal encoded columns.

When multiple source rows have the same complete unit/conversation tuple, every
member of that duplicate group receives a typed, one-based
`@3dena/source-row-occurrence` component. Unique rows retain the unextended
oracle-compatible key. Thus `rowCounts.rowKeys` remain collision-safe without
changing the reviewed small-raw fixture order. `maxAccumulationCells` bounds
the combined public count matrices before the model runs and verifies the
actual returned size again before constructing the result.

Every raw result reports `legacyGoldenStatus: not-assessed`. Modeled rows alone
cannot prove that the exact governed fixture bytes, specification, version set,
and build scope match a parity contract. The Web evidence layer may attach a
scoped `PARITY_CANDIDATE` only after those identities match; arbitrary SDK raw
results carry no candidate or verified-parity claim.

## Prepared exchange reduction

`analyzePreparedSpace()` is a separate contract for a validated, precomputed
ENA coordinate space. It does not call the modeling package, accumulate raw
codes, or fit a rotation:

```ts
import { analyzePreparedSpace } from "@3dena/analysis";
import { decodeEna3dExchangeV1WithSha256 } from "@3dena/io";

const artifact = await decodeEna3dExchangeV1WithSha256(exactBytes);
const prepared = analyzePreparedSpace({
  source: { artifact, name: "prepared-study.ena3d.json" },
  mapping: {
    participant: ["Cohort", "Actor"],
    participantLabel: "Actor",
    group: "Cohort",
    time: "Phase",
    timeOrder: ["phase-one", "phase-two", "phase-three"],
    cohortPolicy: "available",
    displayDimensions: ["SVD1", "SVD2", "SVD3"],
    missingDisplayCoordinates: "reject"
  }
});

const alternateDisplay = selectPreparedSpaceDisplay(prepared, {
  dimensions: ["SVD2", "SVD4", "SVD5"],
  groups: [prepared.displaySpace.trajectory.groupOrder[0]!.canonical]
});
```

The strict decoder and reducer must run in the same Worker/module realm.
`@3dena/io` marks hashed receipts in a process-local custody registry, so an
object spread, hand-authored lookalike, or `structuredClone()` of a receipt is
rejected. Pass exact bytes across a Worker boundary and decode them there; do
not pass a supposedly validated object from the main thread.

`PreparedSpaceResult` preserves every imported coordinate dimension, node,
edge, and line-weight row while exposing a separate three-coordinate display
space. Its provenance embeds a deep-copied resolved mapping and explicitly
records `jenaExecuted: false`, `rawJenaRecompute: false`, and absent rotation,
eigenvalue, and variance artifacts.

Prepared inputs are always generic precomputed-compatibility material. The
reducer does not recognize a study by hash and never manufactures fixture or
parity evidence. A prepared result therefore remains unapproved for parity
unless a separate, independently reviewed release receipt says otherwise; it
cannot establish raw-data recomputation parity.

`selectPreparedSpaceDisplay()` accepts an optional `dimensions` tuple containing
exactly three distinct names from `fullSpace.dimensions`, together with the
existing optional canonical `groups` filter. When dimensions are supplied, it
projects the preserved full-space points and nodes by direct index selection,
then repeats participant-period reduction, available/complete cohort handling,
group-time centroids, and explicit-gap paths in that same imported coordinate
space. It never accumulates codes, changes line weights, fits an SVD, rotates,
or invokes the modeling package. Omitting `dimensions` retains the original
groups-only behavior and original display axes.

The selection returns `cohortPolicy` and the selected `participantPeriods` in
addition to points, nodes, centroids, and paths, so the reduction remains
auditable. It is a detached, deeply frozen, structured-clone-safe DTO; the base
`PreparedSpaceResult`, source receipt, provenance, full coordinates, edges,
line weights, and export inputs remain unchanged. Null, short, long, duplicate,
blank, or unknown dimension selections and duplicate or unknown groups fail
closed with typed validation errors.

## Trajectory path statistics and comparisons

The versioned `trajectory` member of `AnalysisTaskV1` now routes through the
internal trajectory-dynamics core. The task must bind every immutable source
time key to an explicit `numeric-v1`, `date-v1`, `instant-v1`, or
`difftime-v1` value and must choose either `equal-participant-v1` or a named
positive numeric metadata field for `weighted-participant-v1`. The SDK does
not guess date parsing, timezone/DST semantics, duration units, or weights.
Its result adds elapsed time, selected/full-space speed, effective participant
N, weight sums, gap diagnostics, and an explicit `IMPLEMENTED_UNVERIFIED`
evidence boundary. The unified export writes these fields to `trajectory.csv`.

The older functions described below remain the current implementation behind
trajectory comparison, permutation, and participant-cluster bootstrap. They
are retained as internal compatibility candidates while those products are
migrated to the explicit dynamics contract.

`analyzeTrajectoryPath()` is a reusable, browser-safe descriptive statistics
boundary for points that already share one coordinate space. It requires typed
participant and period identities, an explicit period order, the full ordered
dimension inventory, and exactly three selected display dimensions. Duplicate
participant-period rows are averaged before centroids. Its period DTO reports
available/complete cohort counts, explicit missing-period rows, deltas, steps,
and cumulative distance in two separately labelled spaces:

- `selected3d`: Euclidean distance in exactly the selected three dimensions;
- `fullSpace`: Euclidean distance in every declared dimension.

The first valid centroid has step and cumulative distance zero. A missing
centroid creates a real path gap: no step bridges it, and cumulative distance
remains unavailable after the discontinuity even if a later adjacent step is
defined.

`compareTrajectoryPaths()` has a required design discriminant:

```ts
const paired = compareTrajectoryPaths({
  design: "paired",
  pairedId: "ParticipantId",
  sideA: { label: "A", series: seriesA },
  sideB: { label: "B", series: seriesB }
});

const independent = compareTrajectoryPaths({
  design: "independent",
  sideA: { label: "A", series: { ...seriesA, namespace: "sample-A" } },
  sideB: { label: "B", series: { ...seriesB, namespace: "sample-B" } }
});
```

Paired comparison requires the caller-selected `pairedId` to occur exactly
once in every participant's scientific identity. It reduces raw duplicates,
then matches exact typed ID-time keys. Missing IDs, more than one participant
with the same paired ID at a time, and unmatched A/B slices are errors rather
than silently changing the paired estimand. The difference direction is always
`B-minus-A`.

Independent comparison requires distinct side namespaces. Identical display
IDs in A and B remain unrelated sampling units and are never paired. Complete
cohorts are resolved independently by side; available cohorts may change by
period and retain a diagnostic.

Permutation inference is opt-in and has no hidden RNG. Call
`getTrajectoryPermutationUnits()` to obtain the deterministic, canonical unit
order, then supply either a `paired-swap-indices-v1` plan or an
`independent-pool-indices-v1` plan bound to that exact order. Paired swaps and
independent label assignments preserve whole participant histories. P-values
use `(1 + exceedances) / (1 + finite permutations)` and the returned family is
Holm-adjusted. `rngParityClaim` is always `false`; these indices make a run
reproducible but do not claim byte parity with any external RNG.

### Participant-cluster percentile bootstrap

`bootstrapTrajectoryPath()` resamples participant clusters, never individual
rows or isolated periods. Every draw copies the selected participant's entire
observed history, including duplicate source rows and genuine period gaps, and
then reruns only the participant-period and centroid reduction in the already
projected coordinate space. It does not refit or rotate an ENA model.

Resolve the exact cluster order first and bind a plan to it:

```ts
const units = getTrajectoryBootstrapUnits({
  series,
  stratifyBy: "explicit"
});

const plan = createSeededTrajectoryBootstrapPlan({
  units,
  repetitions: 2_000,
  seed: 2026
});

const bootstrap = bootstrapTrajectoryPath({
  series,
  stratifyBy: "explicit",
  confidenceLevel: 0.95,
  plan
});
```

For governed or cross-language runs, a caller-provided
`participant-history-resample-indices-v1` plan is preferred. It must reproduce
the exact returned `unitOrder`, stratum order, membership, replicate count, and
fixed draw count per stratum; every index remains inside its declared stratum.
Mark that plan with `generation: { kind: "caller-provided" }`. This makes the
sampling schedule reviewable independently of an RNG.

The optional built-in plan generator is fully specified as
`mulberry32-uint32-v1`: the seed is an unsigned 32-bit integer, units use
ascending JavaScript UTF-16 code-unit order, each random value is in `[0, 1)`,
and `floor(random * stratumSize)` selects an index. A plan labelled `seeded` is
recomputed and rejected if its draws differ from that declaration.
`rngParityClaim` is always `false`; deterministic JavaScript output is not a
claim of R RNG or other external RNG parity.

The input cohort policy is resolved before the sampling pool is built.
`available` retains each eligible participant's observed history and gaps;
`complete` removes incomplete participants from every period before any draw.
With `stratifyBy: "explicit"`, every eligible row needs a typed `stratum`, and
that identity must be constant across the participant history. The bootstrap
preserves the original cluster count within each stratum. Singleton strata and
fully degenerate centroid distributions receive explicit warnings.

Intervals are pointwise percentile intervals for every centroid component and
for step and cumulative distances in both `selected3d` and `fullSpace`.
Quantiles use the versioned `linear-type7-v1` rule: finite values are sorted
ascending, position is `(n - 1) * p`, adjacent order statistics are linearly
interpolated, and `p=0`/`p=1` return the minimum/maximum. An interval is withheld
unless its base period has at least two participant clusters and it has at
least `max(ceil(0.8 * repetitions), ceil(10 / (1 - confidenceLevel)))` finite
replicates. `maxResamples`, `maxCells`, point/dimension limits, finite-value
validation, and safe-integer overflow checks apply before materializing the
replicate results. Centroids use a scaled Neumaier-compensated mean to avoid
avoidable finite-input overflow and severe cancellation loss; deltas,
`Math.hypot` distances, cumulative distances, and quantile interpolation fail
with a typed numeric-overflow error if the mathematical result is not
representable as a finite JavaScript number.

These longitudinal bootstrap intervals are numerical analysis artifacts for
exact tables and exports. `compileTrajectoryPlotlySpec()` intentionally does
not render them in either 2D or 3D, even when a legacy V2 display specification
sets `traces.uncertainty` to `true`. Visual confidence intervals remain part of
the separate static 3D ENA group-comparison grammar; they are not trajectory
marks.

### Result adapters

`adaptAnalysisResultTrajectorySeries()` and
`adaptPreparedSpaceTrajectorySeries()` are pure copying adapters for one
explicit canonical group. They do not call the modeling engine, recompute an
SVD, change coordinates, or infer a group from a display label. The raw result
adapter retains every coordinate dimension produced by the same jENA fit and
keeps the selected display dimensions separate. The prepared-space adapter
likewise retains every imported full-space coordinate while selecting the
existing three display axes. Both preserve typed participant and time identity
and the source cohort policy; unknown or empty groups fail closed.

Current scientific limitations are explicit: comparison/permutation/bootstrap
still use equal participant weights and do not yet propagate elapsed/speed or
weighted dynamics. No path supports BCa/studentized/simultaneous intervals,
degenerate-SVD alignment uncertainty, or uncertainty from fitting the ENA
model/rotation. The new single-group dynamics task computes elapsed/speed and
equal/weighted estimands, but its successor formulas remain pending scientific
oracle adjudication and therefore make no parity claim.
Explicit strata constrain cluster resampling only; this API does not fit a
stratified regression, estimate stratum effects, or by itself justify
stratified inference. Permutation p-values cover
selected coordinate contrasts, selected/full centroid separation, and
selected/full step and cumulative-distance contrasts. Exchangeability,
paired-identity validity, stratum choice, and cluster independence remain
study-design assumptions, not facts that typed matching can prove.

## Execution boundary

Node SDK consumers can call `executeAnalysisTask()` locally. The public Web
product's target architecture uses `createAnalysisClient()` and a persistent
TypeScript compute service for scientific work; it must not hide long
computations in a short-lived Next.js request. The current Web product still
executes scientific tasks in browser module Workers. The remote client and
compute-service packages are implementation candidates that are not yet wired
as the Web product's default execution path or backed by production
persistence. The browser module Worker therefore remains both the current Web
executor and the development calibration/bundler-compatibility executor.

All synchronous execution roles need hard process/Worker termination. The
numerical model stage cannot guarantee cooperative interruption, so cancel and
timeout must terminate the execution realm, observe its exit, discard the
immutable run owner, and construct a fresh realm. Do not put `AbortSignal` or
callback functions in a structured-clone task.

A recommended versioned envelope is:

```ts
type Request = { v: 1; kind: "analyze"; runId: string; input: AnalyzeRowsInput };
type Response =
  | { v: 1; kind: "progress"; runId: string; phase: "validating" | "modeling" | "trajectory" | "complete"; percent: number }
  | { v: 1; kind: "result"; runId: string; result: AnalysisResult }
  | { v: 1; kind: "error"; runId: string; message: string };
```

Progress around the synchronous model call is phase progress, not proof that
the model can stop between percentages. The Worker supervisor owns real hard
cancellation and stale-result protection.

## Scientific boundaries

- one call fits one SVD across every unit-step point;
- participant-period duplicates are averaged before group-time centroids;
- `available` and `complete` cohort policies are distinct;
- an explicit unobserved period is a path gap, never a zero coordinate;
- `selectTrajectoryDisplay()` receives no raw rows or model configuration and
  cannot refit or recompute the scientific result;
- exact source versions and unresolved numerical evidence live in the separate
  development-only parity contract package.
