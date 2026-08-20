# @3dena/parity-contracts

Development-only parity contracts, source fixtures, provenance, tolerances, and
comparators for 3DENA Next. Production packages may use the pure comparator if
needed, but must never import or require an R script, R runtime, `.RData`, or
oracle checkout.

- `PARITY_CONTRACT_V1.md`: normative numerical and shared-space contract.
- `PARITY_MATRIX.md`: evidence state without milestone overclaiming.
- `DIVERGENCE_LEDGER.md`: unresolved and approved differences.
- `fixtures/`: tracked source custody and static oracle envelopes.
- `src/compare.ts`: fixture custody validation, exact structure checks,
  ordinary SVD sign alignment, and an approved-only gate.

The tracked rENA 0.2.7 golden envelope is intentionally `pending` until the
frozen oracle emits a real payload and hashes it. Tests verify that pending is
reported as pending, not silently treated as a pass.

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
