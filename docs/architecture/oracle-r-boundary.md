# Frozen R oracle boundary and fixture provenance

Status: normative migration procedure; never a production-runtime design.

## Frozen baseline

The first raw-data oracle is frozen to:

- legacy 3dENA commit
  `d02019ad872c5ece3840be2b4028ef27af38b2ff`;
- R `4.4.1`;
- rENA `0.2.7`;
- `jsonlite` `2.0.0` and `digest` `0.6.37` for deterministic fixture
  serialization and hashing;
- input `packages/parity-contracts/fixtures/small-raw.csv`, exactly 743 bytes
  with SHA-256
  `163ee849ac316d380e2664067e7389a8114e30d97877c97d6d912e3706c72f16`;
  and
- fixture ID `small-raw-rena-0.2.7-accumulated-back4`.

The calibrated analysis specification is:

```json
{
  "units": ["Group", "Name"],
  "conversation": ["Lesson"],
  "codes": ["EC", "ICT", "MCO", "ATT"],
  "group": "Group",
  "model": "AccumulatedTrajectory",
  "weightBy": "binary",
  "window": "MovingStanzaWindow",
  "windowSizeBack": 4,
  "rotation": "SVD",
  "dimensions": ["SVD1", "SVD2", "SVD3"]
}
```

This configuration supersedes the earlier uncalibrated EndPoint/back-2
proposal. It follows the legacy raw-import mapping and browser smoke flow.

## Generator contract

Before invoking the offline R environment, the repository-only custody check
can be run with ordinary Node.js:

```bash
node oracle-r/verify-small-raw-custody.mjs
node --test oracle-r/verify-small-raw-custody.test.mjs
```

It is write-free and fail-closed. Both the generator and input must be regular
(not symlinked) files tracked at their fixed paths in this same repository and
clean relative to its concrete `HEAD`. The input must also match the frozen
byte count and SHA-256 above. A repository without a commit, an untracked,
staged, modified, deleted, renamed, or symlinked file, or any content drift is
rejected.

`oracle-r/generate-small-raw-golden.R` independently applies those same Git,
path, size, and hash checks in both of its modes. Preflight performs no writes:

```bash
Rscript oracle-r/generate-small-raw-golden.R \
  --legacy-checkout /absolute/path/to/clean-d020-checkout \
  --preflight
```

Generation requires an explicit, non-existing `.json` output path:

```bash
Rscript oracle-r/generate-small-raw-golden.R \
  --legacy-checkout /absolute/path/to/clean-d020-checkout \
  --output /absolute/review/path/small-raw.rena-0.2.7.golden.json
```

The generator refuses to run when its own generator/input custody check fails,
when the legacy checkout is dirty or not exactly at the pinned commit, when any
pinned tool version differs, when the input schema changes, or when the output
already exists. Its preflight and write path call the same environment check,
so `--output` cannot bypass custody. It never writes a native R object.

The JSON top level is `{ "manifest": ..., "analysis": ... }`. The manifest
contains the fixture/schema IDs, exact versions and commit, analysis spec,
generator and input hashes, normalized replay command, `availableFields`, and a
SHA-256 of the compact UTF-8 `analysis` payload. The final artifact SHA-256 is
printed to stdout. A file cannot contain its own file hash without a circular
definition, so the governed in-file output hash deliberately covers the
analysis payload; an external review receipt may record the final artifact hash.

Each table uses the comparator-facing shape:

```json
{
  "rowKeys": ["stable typed labels"],
  "columns": ["numeric column names"],
  "values": [[0.0, 1.0]]
}
```

Point and line-weight row keys are compact JSON typed tuples such as
`[["string","Experimental"],["string","Student 1"],["string","Lesson 1"]]`,
matching the TypeScript facade's `[Group, Name, Lesson]` identity. Rotation row
keys preserve the legacy edge order; node row keys are code names.

One-dimensional outputs use `{ "columns": [...], "values": [...] }`. The
generator emits only fields actually exposed by the pinned rENA object and
lists those exact names in `manifest.availableFields`. Missing fields are
omitted, never synthesized as `null`, zero, or an empty table. Candidate fields
are `connectionCounts`, `rowConnectionCounts`, `lineWeights`, `centerVector`,
`rotationMatrix`, `points`, `nodes`, `variance`, and `eigenvalues`.

## Governed refresh transaction

A fixture refresh is a candidate-generation and review transaction, not an
ordinary test update:

1. Start from a committed, clean generator repository and run the write-free
   Node custody check. It must report the frozen 743-byte input and exact hash.
2. Create a new isolated checkout at the exact legacy commit; do not use a
   long-lived working copy with ignored outputs.
3. Run R preflight and retain its full stdout in the review evidence.
4. Generate to a new temporary review path. The generator refuses overwrite.
5. Verify the input hash, input byte count, generator commit/hash,
   analysis-payload hash, final file hash,
   complete manifest, row-key uniqueness, numeric finiteness, and expected field
   inventory.
6. Compare the candidate to the currently approved fixture. Explain every
   numeric or schema delta. SVD sign alignment must be applied jointly across
   points, nodes, and rotation columns; it must not hide magnitude, ordering, or
   identity changes.
7. Only after scientific review may a maintainer replace the governed JSON and
   update any external receipt. Never auto-commit from the oracle workflow.
8. Run the TypeScript schema/comparator tests and `npm run test:golden` before
   accepting the successor.

Normal `npm ci`, build, test, E2E, and deployment workflows do not install or
invoke R. A stale or unavailable oracle blocks regeneration, not product use of
the last reviewed static fixture.

## Quarantined legacy prepared conversion

The legacy prepared candidate is `sensitive-excluded` and is not a committable
fixture. It contains participant identities and has no current authorization,
de-identification review, scientific approval, or raw-parity standing. Exact
input/output hashes, byte counts, dimensions, row counts, identities, and
aggregate values are therefore not recorded here.

`oracle-r/generate-class1-exchange.R` remains development-only converter
plumbing. It has no built-in expected output identity and cannot create an
approval. Both preflight and generation require an expected output SHA-256 and
byte count supplied externally from the authorized private review context. The
wrapper must also run from its fixed path in a generator repository with a
concrete `HEAD`; it must be tracked and clean. Preflight prints only that an
external identity was supplied, not the identity itself. Generated checksum and
provenance files remain in the external private review directory and are still
unapproved candidates.

Preflight is write-free:

```bash
R_LIBS_USER=/absolute/path/to/legacy/renv/library \
  Rscript --vanilla oracle-r/generate-class1-exchange.R \
  --legacy-checkout /absolute/path/to/clean-d020-checkout \
  --expected-input-sha256 '<private-review-input-hash>' \
  --expected-input-bytes '<private-review-input-byte-count>' \
  --expected-exchange-sha256 '<private-review-hash>' \
  --expected-exchange-bytes '<private-review-byte-count>' \
  --preflight
```

Generation must target an external review directory, never the legacy checkout:

```bash
R_LIBS_USER=/absolute/path/to/legacy/renv/library \
  Rscript --vanilla oracle-r/generate-class1-exchange.R \
  --legacy-checkout /absolute/path/to/clean-d020-checkout \
  --output /absolute/private-review/path/prepared-exchange.ena3d.json \
  --expected-input-sha256 '<private-review-input-hash>' \
  --expected-input-bytes '<private-review-input-byte-count>' \
  --expected-exchange-sha256 '<private-review-hash>' \
  --expected-exchange-bytes '<private-review-byte-count>'
```

Do not run the converter until the private custody process has supplied the
authorization, de-identification disposition, retention policy, and expected
output identity. R serialization is unsafe for public upload. Produced exchange,
checksum, and provenance files are private review candidates, not tracked or
approved evidence merely because they exist. Production never reads the native
source, and no output may enter Git without a separate privacy review and
independent scientific disposition.
