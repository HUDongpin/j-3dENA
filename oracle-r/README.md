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
  --preflight
```

It accepts only the exact tracked trusted native input at d020, invokes the
official pinned converter, and recomputes the complete exchange hash before it
writes provenance. The wrapper must also be at its fixed path, tracked, and
clean in a generator repository with a concrete commit; preflight emits that
commit and the wrapper SHA-256, and provenance records both. It is not a
general-purpose native upload path.
