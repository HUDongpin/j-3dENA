# @3dena/parity-contracts

Development-only parity contracts, source fixtures, provenance, tolerances, and
comparators for 3DENA Next. Production packages may use the pure comparator if
needed, but must never import or require an R script, R runtime, `.RData`, or
oracle checkout.

- `PARITY_CONTRACT_V1.md`: normative numerical and shared-space contract.
- `PARITY_MATRIX.md`: evidence state without milestone overclaiming.
- `DIVERGENCE_LEDGER.md`: unresolved and approved differences.
- `SCIENTIFIC_AUTHORITY_MATRIX.md`: per-quantity scientific decision register.
- `scientific-authority.matrix.v1.json`: machine-readable, initially blocked
  release input; it contains no synthetic or inferred approvals.
- `strict-capability-ledger.v1.json`: machine-readable, initially blocked
  41-capability strict-parity inventory with no fabricated closure entries.
- `fixtures/`: tracked source custody and static oracle envelopes.
- `src/compare.ts`: fixture custody validation, exact structure checks,
  ordinary SVD sign alignment, and an approved-only gate.
- `src/scientific-authority.ts`: exact authority-receipt validation and the
  approved-only scientific release gate.
- `src/strict-capability-ledger.ts`: immutable evidence/approval validation for
  verified, frozen, or Owner-approved retirement dispositions.

The protected release workflow must run
`npm run release:strict-closure --workspace @3dena/parity-contracts`. The
command reads both tracked JSON files by default and exits non-zero until every
scientific quantity and strict capability has a genuine approved closure.

The tracked small-raw envelope is a governed `generated` candidate produced by
the frozen offline oracle at generator commit
`4a0f0a6c79b8872e0a07d6ac239b5a4e863a6d48`. The TypeScript facade compares
all nine declared fields in complete scope with `numericStatus: "pass"` and
combined `status: "candidate-pass"`. It has no approval record, so
`approvedForParity` remains false and the strict gate rejects it.

The legacy prepared Class 1 candidate is quarantined outside the public parity
tree as `sensitive-excluded`. It contains participant identities and has no
authorization, de-identification review, aggregate approval, or raw-parity
standing for this release. It is not a committable fixture. Only
privacy-reviewed hash-only or independently approved aggregate receipts may be
tracked later; exact bytes remain in private custody.

The public comparison API deliberately separates calculation from evidence
custody:

- `compareGoldenAnalysis()` returns `fixtureStatus`, `numericStatus`, combined
  `status`, validation issues, comparison scope, and `approvedForParity`;
- a valid generated numeric match is `candidate-pass`, never `pass` or
  `approved-pass`;
- a diagnostic candidate with incomplete provenance remains runnable and can
  expose `numericStatus: "pass"`, but its combined status is
  `candidate-invalid`;
- `validateParityFixture()` verifies the schema core, frozen versions,
  generator/runtime provenance, exact input/generator/payload hashes, field
  inventory, row-key uniqueness, rectangular shapes, and finite cells; and
- `compareApprovedGoldenAnalysis()` / `requireApprovedParity()` are the only
  strict success gates. They reject pending, generated, partial, invalid, or
  numerically failing results.

Generated and approved validation requires exact `inputBytes`,
`generatorBytes`, and `fixtureJson` evidence. This is intentional: the oracle's
analysis hash covers the serializer's compact lexical JSON, whose numeric
lexemes cannot safely be reconstructed by parsing and re-stringifying.

`normalizeAnalysisResult()` maps the production-neutral
`accumulation.modelCounts` and `accumulation.rowCounts` DTOs to the oracle's
development-only field names. This keeps oracle vocabulary out of the public
analysis result while retaining exact row/column ordering for all nine fields.
