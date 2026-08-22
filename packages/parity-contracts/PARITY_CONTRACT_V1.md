# 3DENA numerical parity contract v1

Status: `PARITY_CANDIDATE`. A governed generated payload passes the complete
nine-field package comparison, but it has no independent approval record. The
presence of this contract and a `candidate-pass` do not establish verified
scientific parity.

## 1. Frozen authorities

| Role | Frozen authority |
|---|---|
| Legacy application | `HUDongpin/3DENA@d02019ad872c5ece3840be2b4028ef27af38b2ff` |
| Legacy R runtime | R 4.4.1 |
| Legacy application oracle | rENA 0.2.7 |
| JavaScript numerical core | `HUDongpin/jENA@2f63db4c6ccf5684afc8437ae81ed1a3ccd0c1a3` |
| npm snapshot | `jena-js@0.6.2` |
| jENA principal upstream oracle | rENA 0.3.1 |

The two rENA versions are different scientific baselines. A successful jENA
0.6.2 test against its own rENA 0.3.1 fixtures must never be reported as proof
that the legacy rENA 0.2.7 application is equivalent. Differences require a
reproduced explanation and a reviewed entry in `DIVERGENCE_LEDGER.md`.

## 2. Calibration fixture

The first vertical slice uses `fixtures/small-raw.csv`, copied mechanically
from the frozen legacy repository. Its SHA-256 is
`163ee849ac316d380e2664067e7389a8114e30d97877c97d6d912e3706c72f16`.
Custody metadata is in `fixtures/small-raw.provenance.json`.

The model specification is exact:

- model: `AccumulatedTrajectory`;
- units: `Group`, `Name` as one typed tuple;
- conversation: `Lesson`;
- codes, in order: `EC`, `ICT`, `MCO`, `ATT`;
- weighting: `binary`;
- window: `MovingStanzaWindow`, back 4, forward 0;
- centering: align non-zero sphere-normalized weights to the origin;
- rotation: one SVD fitted across every accumulated unit-step row;
- displayed dimensions: `SVD1`, `SVD2`, `SVD3`;
- trajectory group: `Group`;
- participant label: `Name`, with the complete `Group` + `Name` unit tuple as
  scientific participant identity;
- time: `Lesson`, ordered `Lesson 1`, `Lesson 2`.

No `.RData`, `.RData`-derived binary object, R package, or R runtime is a
production input. The fixture generator may use the frozen oracle offline.

## 3. Shared 3D SVD invariant

The longitudinal computation order is normative:

1. validate all raw rows, typed identities, mappings, and resource limits;
2. accumulate all unit-step rows under one model specification;
3. sphere-normalize and center that complete line-weight matrix once;
4. fit exactly one jENA SVD rotation to the complete matrix;
5. project every unit-step row with that same rotation;
6. reduce duplicate rows to one equal-weight participant-period coordinate;
7. compute group-period centroids from participant-period coordinates;
8. derive paths and display selections only from those frozen coordinates.

Fitting one SVD per period and then connecting the unrelated coordinates is a
scientific error. Filtering a displayed group, period, or trace must not call
`ena()`, refit rotation, change centroids, alter formal exports, or renumber the
underlying rows. `selectTrajectoryDisplay()` accepts only a computed trajectory
DTO and returns references to already-computed centroid/path records.

`AccumulatedTrajectory` is jENA's accumulation model. The group-period centroid
trajectory is a separate 3DENA estimand and is implemented after projection.

## 4. Typed identity and ordering

All scientific keys use type-tagged tuple encodings. Display labels do not
identify entities. Values such as `["a.b", "c"]` and `["a", "b.c"]` remain
distinct; string `"1"`, number `1`, and boolean `true` remain distinct.
Integers above `Number.MAX_SAFE_INTEGER` must enter as strings.

The following are exact contracts:

- code, edge, point, node, group, and time ordering;
- typed unit and participant-period membership;
- metadata constancy within a unit;
- available versus complete cohort membership;
- explicit missing expected periods as path gaps rather than zero coordinates;
- diagnostic codes and result schema version.

Source-grain accumulation rows use the complete typed unit/conversation tuple.
If that base tuple occurs more than once, every member of the duplicate group
adds a typed one-based source-row occurrence component; unique rows keep the
unextended oracle key. This prevents ambiguous public row identities without
changing the reviewed small-raw keys.

## 5. Numeric comparison

The v1 comparator checks exact table kind, row keys, row order, column names,
and column order before numbers. It uses the field-specific rule

`abs(actual - expected) <= absolute + relative * abs(expected)`.

| Quantity | Absolute | Relative | Notes |
|---|---:|---:|---|
| connection counts | `1e-10` | `1e-10` | order exact |
| row connection counts | `1e-10` | `1e-10` | order exact |
| sphere-normalized line weights | `1e-10` | `1e-9` | zero rows explicit |
| center vector | `1e-10` | `1e-9` | edge order exact |
| SVD rotation | `1e-8` | `1e-7` | sign-aligned |
| projected points | `1e-8` | `1e-7` | same axis signs as rotation |
| node positions | `1e-7` | `1e-6` | same axis signs as rotation |
| variance share | `1e-9` | `1e-8` | normalized over all rotation dimensions |
| eigenvalues | `1e-9` | `1e-8` | full rotation basis |

Ordinary isolated SVD axes are aligned by the sign of the dot product between
actual and oracle rotation columns. The chosen sign is applied consistently to
rotation, points, nodes, centroids, and trajectory coordinates. It is invalid
to sign-align each downstream table independently.

Repeated or near-repeated singular values can rotate within their invariant
subspace, so column-wise sign alignment is insufficient. A fixture whose
adjacent eigenvalue gap is below the approved threshold must use projection-
matrix, Gram-distance, or reviewed Procrustes/subspace comparison for that
block. The current v1 automated comparator does not yet close this degenerate
case; such a result is not eligible for `VERIFIED_PARITY` until that comparator
and fixtures exist.

### 5.1 Numeric outcome is not fixture approval

`compareGoldenAnalysis()` returns three independent facts:

- `fixtureStatus`: the manifest custody state (`pending`, `generated`, or
  `approved`);
- `numericStatus`: `not-run`, `pass`, or `fail`; and
- `status`: the combined state, such as `candidate-pass`,
  `candidate-invalid`, `approved-pass`, or `approved-invalid`.

A generated fixture can never return `approved-pass`, even when every numeric
cell is within tolerance. A retained diagnostic whose numeric cells compare but
whose source, hash, schema, or generator custody is incomplete returns its
numeric result separately and has combined status `candidate-invalid`.

`approvedForParity` is true only when all of these conditions hold:

1. the manifest status is `approved`;
2. the complete manifest-declared field inventory was compared;
3. the fixture and actual payload structural checks pass;
4. exact input, generator, and lexical analysis-payload hashes verify;
5. frozen versions and generator/runtime provenance verify;
6. the approval record binds the input hash, analysis hash, and generator Git
   commit; and
7. every numeric comparison passes its field-specific tolerance.

Callers that make a parity claim must use `compareApprovedGoldenAnalysis()` or
pass an existing comparison through `requireApprovedParity()`. Both reject
pending, generated, partial, invalid, or numerically failing comparisons.

## 6. Fixture envelope and adoption

Each oracle file is a JSON envelope:

```json
{
  "manifest": {
    "schemaVersion": "3dena.parity-fixture.v1",
    "fixtureId": "...",
    "status": "pending | generated | approved",
    "availableFields": []
  },
  "analysis": null
}
```

Numeric tables use `{rowKeys, columns, values}`; vectors use
`{columns, values}`. A field unavailable from the exact oracle is omitted and
must not be populated with zeros, copied jENA output, or inferred values.

The manifest must record at least source and generator Git SHAs, input SHA-256,
canonical analysis-payload SHA-256, R/rENA versions, platform and BLAS/LAPACK,
complete model specification, dimension and edge order, command, UTC generation
time, and field availability. `generated` means the oracle ran; it does not
mean the output was independently approved. Adoption changes status to
`approved` only after custody, schema, numerical sanity, and generator review.

Runtime fixture validation additionally requires unique non-empty table row
keys, unique columns, rectangular table dimensions, exact declared-field
inventory, and finite numeric cells. Generated and approved comparisons must
supply the exact source bytes, exact generator bytes, and exact fixture JSON
text. The analysis hash is checked against the whitespace-compacted lexical
`analysis` value from that JSON, preserving the numeric lexemes emitted by the
frozen serializer; reparsing and hashing `JSON.stringify(analysis)` is not an
equivalent custody check.

An approved manifest adds an explicit review binding:

```json
{
  "approval": {
    "schemaVersion": "3dena.parity-approval.v1",
    "reviewedBy": "independent reviewer identity",
    "reviewedAtUtc": "2026-08-20T00:00:00Z",
    "decisionRecord": "durable review record path or identifier",
    "inputSha256": "same value as manifest.input.sha256",
    "analysisPayloadSha256": "same value as manifest.analysisPayloadSha256",
    "generatorGitCommit": "same value as manifest.generator.gitCommit"
  }
}
```

Changing only `manifest.status` from `generated` to `approved` is invalid. The
review record and all bound evidence must exist and pass the strict gate.

Golden files are never rewritten merely because a candidate implementation
differs. Reproduce, diagnose, independently review, then either fix the code or
record an approved versioned divergence.

## 7. Out of scope for this first fixture

The small-raw fixture does not close bootstrap RNG/quantiles, inferential
statistics, paired matching, missing/gap variants, degenerate SVD, maximum
browser workloads, Web Worker termination, Plotly trace semantics, or export
round trips. Those remain explicit matrix items, not implied by this vertical
slice.
