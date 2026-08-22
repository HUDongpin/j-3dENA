# Offline R scientific oracle

Everything in this directory is migration tooling and provenance documentation.
Nothing here is a package dependency, server, fallback endpoint, build step, or
deployment input for 3DENA Next.

Start with `docs/architecture/oracle-r-boundary.md`. The small raw-data generator
supports a write-free preflight and requires an explicit output path for actual
generation:

```bash
node oracle-r/verify-small-raw-custody.mjs
node --test oracle-r/verify-small-raw-custody.test.mjs
```

This R-free custody gate requires a concrete generator-repository `HEAD`; both
the generator and `packages/parity-contracts/fixtures/small-raw.csv` must be
tracked, clean regular files in that repository. The CSV is frozen at 743 bytes
and SHA-256
`163ee849ac316d380e2664067e7389a8114e30d97877c97d6d912e3706c72f16`.
Untracked, staged, modified, renamed, symlinked, or hash/size-drifted inputs are
rejected.

```bash
Rscript oracle-r/generate-small-raw-golden.R \
  --legacy-checkout /absolute/path/to/clean-d020-checkout \
  --preflight
```

The R preflight and generation paths repeat the same repository custody,
fixed-path, hash, and byte-count checks; an explicit output path does not bypass
them. In a newly initialized repository with no first commit, preflight must
fail closed until the governed files are committed and clean.

Do not place `.RData`, `.rds`, `.rda`, or another native R object under
`apps/**` or `packages/**`. Only reviewed JSON/CSV fixtures may cross from this
offline area into the TypeScript parity-contract package.

The Class 1 one-time conversion wrapper is also write-free in preflight mode:

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

The legacy prepared candidate is quarantined as `sensitive-excluded` and is not
a committable fixture. The wrapper has no built-in expected input or output
identity; both preflight and generation require their SHA-256 values and byte
counts to be supplied externally from the authorized private review context. It invokes the pinned
converter, recomputes the output identity, and can only create an unapproved
private candidate. The wrapper must also be at its fixed path, tracked, and
clean in a generator repository with a concrete commit. It is not a
general-purpose native upload path and must not be run before authorization and
de-identification review.

## Authorized Class 1 raw custody

The Class 1 raw parity gate is separate from the prepared exchange wrapper.
Before any raw oracle run, the data custodian creates a canonical frozen mapping
and an Ed25519-signed custody receipt outside the repository, then verifies both
against the exact private bytes:

```bash
node oracle-r/verify-class1-custody-receipt.mjs \
  --receipt /private/custody/receipt.json \
  --mapping /private/custody/mapping.json \
  --raw /private/custody/exact-coded-rows.csv \
  --signature /private/custody/receipt.sig \
  --public-key /private/custody/reviewer-public-key.pem
```

The contract binds written authorization, de-identification disposition, exact
byte length/SHA-256/magic, a role/type/level/missing/sort mapping, isolated-store
access flags, actor separation, and the trusted signing key. The verifier never
prints raw bytes, mapping values, actor identities, or signature bytes. Its unit
tests use synthetic data only. A passing synthetic test is not a Class 1 receipt,
and no raw file, mapping values, private key, or participant identifier belongs
in Git or ordinary CI.

The non-sensitive legacy source-lineage investigation is independently
fail-closed. It records only prepared-file hashes and the preparation-script
semantics; it cannot promote prepared data to raw parity or close any of the 55
scientific quantities:

```bash
node oracle-r/verify-class1-source-lineage.mjs \
  --receipt evidence/scientific/2026-08-21-class1-source-lineage-investigation.json
```

Pass `--legacy-root` only in the authorized local environment to rehash the two
prepared legacy copies. This is a bounded path/history investigation, not proof
that a raw source does not exist in private or external storage.
