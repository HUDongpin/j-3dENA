# Parser fuzz execution gate

Status: `IMPLEMENTED_UNVERIFIED` until the exact remote workflow artifact is
executed, retained, and independently approved under the active
`BuildApprovalV1`.

## Scope

The parser fuzz gate exercises the two public exact-byte ingestion boundaries:

- strict `.ena3d.json` decoding in `@3dena/io`; and
- CSV, XLS, and XLSX inspection in `@3dena/tabular-import`.

It does not treat a random exception as an acceptable rejection. Every rejected
case must produce the package's reviewed safe error type, remain below the
message-size ceiling, and exclude marker content that represents participant,
private-research, or secret-like input. Every accepted case must retain the
exact-byte receipt and immutable validated-result invariants.

## Strategies

The frozen v1 matrix contains six strategies:

1. arbitrary `.ena3d.json` exact bytes up to 16 KiB;
2. truncation, insertion, replacement, and bit mutation of a valid exchange;
3. adversarial JSON grammar, duplicate keys, numeric forms, and depths;
4. arbitrary CSV bytes up to 16 KiB;
5. truncation and bit mutation of the governed XLSX corpus; and
6. truncation and bit mutation of the governed XLS corpus.

Seeds are explicit uint32 hexadecimal values. The scheduled and pull-request
workflow combines a frozen seed with two exact Git-SHA-derived seeds and runs
512 cases per seed. The resulting execution is therefore variable across exact
commits but fully replayable from the receipt.

## Resource and privacy boundary

- The fuzz child process has `--max-old-space-size=1024`.
- The workflow job has a 20-minute hard timeout and the child has a 15-minute
  execution timeout.
- Parser hard ceilings remain active; fuzzing never relaxes production limits.
- The evidence artifact contains only seeds, counts, error-code histograms,
  source/corpus hashes, runtime identity, Git/run identity, timestamps, and the
  Vitest JSON result. It contains no input bytes, filenames supplied by a user,
  decoded row values, credentials, or environment dumps.
- The runner refuses to overwrite an existing evidence directory.

## Exact-byte binding

`3dena.parser-fuzz-execution.v1` binds:

- the exact Git commit;
- `package-lock.json`;
- parser, limits, safe-error, fuzz-runner, and verifier source bytes;
- the exact governed XLS/XLSX corpus bytes;
- seed and case-count inputs;
- the six-test Vitest report; and
- the public GitHub workflow identity fields, when present.

`scripts/verify-parser-fuzz-receipt.mjs` recomputes every source/corpus hash,
validates the exact strategy arithmetic, verifies the Vitest report SHA-256,
and rejects receipt fields containing raw marker content.

## Execution

For a local candidate, use a fresh output directory:

```sh
npm run test:parser-fuzz -- --output /absolute/new/evidence-directory \
  --seeds 3de02026,01234567 \
  --cases-per-seed 512
```

The authoritative remote candidate is `.github/workflows/parser-fuzz.yml`.
Its uploaded artifact is an immutable technical execution receipt, not an
independent release approval. The final `parser-fuzz` row in
`3dena.release-receipts.v1` still requires a non-implementation approver and the
same signed `BuildApprovalV1` manifest hash as every other release receipt.
