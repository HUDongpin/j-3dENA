# Vendored SheetJS Community Edition

This directory freezes the browser spreadsheet parser used by
`@3dena/tabular-import`.

| Field | Frozen value |
|---|---|
| Package | `xlsx` / SheetJS Community Edition |
| Version | `0.20.3` |
| Distribution URL | `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` |
| Retrieved | `2026-08-20` |
| SHA-256 | `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8` |
| Declared license | `Apache-2.0` |
| Runtime dependencies | none in the frozen package manifest |

The tarball contains its own complete `package/LICENSE` and
`package/dist/LICENSE`. The application installs this exact local tarball with
a `file:` dependency; it does not resolve the older public npm-registry
snapshot. Release-level notice aggregation remains a separate repository gate.

The production adapter imports only the ESM package entry and passes owned
`Uint8Array` snapshots. It does not call SheetJS filesystem helpers, does not
evaluate formulas, and never returns VBA, comments, hyperlinks, formatting, or
formula source.
