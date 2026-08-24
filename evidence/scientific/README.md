# Scientific evidence receipts

This directory may contain only non-sensitive, hash-bound scientific evidence.
Raw Class 1 rows, participant identifiers, frozen mapping values, signatures,
private keys, and oracle outputs containing row-level research data remain in
the separately governed private custody store and must never be committed.

`2026-08-21-class1-source-lineage-investigation.json` records a bounded search
of the named local legacy checkout and its Git history. It identifies two
byte-identical prepared RData copies and binds the preparation script that
pseudonymizes metadata and intentionally discards raw-input caches. It does not
claim that no raw source exists outside the searched scope. It closes zero of
the 55 scientific quantities and cannot be used as a Class 1 custody receipt.

Verify the non-sensitive receipt contract in ordinary CI with:

```bash
node oracle-r/verify-class1-source-lineage.mjs \
  --receipt evidence/scientific/2026-08-21-class1-source-lineage-investigation.json
```

An authorized local operator may additionally rehash the two prepared legacy
copies without printing their bytes:

```bash
node oracle-r/verify-class1-source-lineage.mjs \
  --receipt evidence/scientific/2026-08-21-class1-source-lineage-investigation.json \
  --legacy-root /absolute/path/to/the/legacy-checkout-parent
```

A successful result means only that the prepared-only investigation receipt is
internally consistent and, when requested, that the prepared copies still match
their recorded hashes. Raw parity remains blocked until the separate signed
`3dena.class1-custody-receipt.v1` gate passes against the exact private bytes.
