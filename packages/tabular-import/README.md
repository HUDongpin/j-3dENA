# `@3dena/tabular-import`

Framework-independent, browser-safe import boundary for exact `.csv`, `.xlsx`,
and BIFF8 `.xls` bytes. The package is designed to run inside a module Web
Worker. It imports no Node API and performs no server-side or R-backed parsing.

## Frozen dependency

The only runtime dependency is SheetJS Community Edition `0.20.3`, installed
from the reviewed local tarball at `../../vendor/sheetjs/xlsx-0.20.3.tgz`.
Its upstream URL, exact SHA-256, Apache-2.0 declaration, and package facts are
recorded in `../../vendor/sheetjs/README.md`.

## Two-stage exact-byte API

```ts
const inventory = await inspectTabularSource({ name: file.name, bytes });
const selected = inventory.worksheets.find((worksheet) => worksheet.selectable)!;

const table = await parseTabularWorksheet({
  name: file.name,
  bytes,
  expectedSha256: inventory.receipt.sha256,
  selection: inventory.visibleSelectableWorksheetCount === 1
    ? null
    : { index: selected.index, name: selected.name },
});
```

Both calls take an owned snapshot before awaiting. The second call recomputes
SHA-256 over the exact bytes and refuses a stale or substituted source. Results
contain only structured-clone-safe primitives and deeply frozen arrays/objects.
They never expose a SheetJS workbook object.

The worksheet policy is explicit:

- one visible ordinary sheet may be selected automatically with `null`;
- two or more visible ordinary sheets require an exact `{ index, name }` from
  the inspected inventory;
- hidden, very-hidden, macro, dialog, chart, and unknown sheet kinds are listed
  but are not selectable;
- a selected table uses the first declared row as normalized string headers;
- fully blank data rows are skipped, while blank cells inside a row become
  `null`;
- the preview is an independent copy of the first six data rows.

## Security and fidelity contract

- Default source limit: 5 MiB. Callers may tighten limits but cannot exceed the
  exported hard ceilings.
- `.xlsx` must match ZIP magic. Before SheetJS runs, the importer validates the
  EOCD, every central and local record, exact boundaries, encryption flags,
  ZIP64/AES fields, compression methods, duplicate/case-colliding paths,
  traversal/symlink paths, entry depth, entry count, single-entry expansion,
  total expansion, compression ratio, overlaps, and required OPC parts.
- `.xls` must match OLE Compound File magic and pass header/version/sector
  bounds before SheetJS runs.
- `.csv` must be strict UTF-8 and is parsed lexically; it never invokes SheetJS
  and never performs dynamic typing. Comma, semicolon, and tab are tested with
  quote-aware parsing, the widest consistent table wins, and ties resolve in
  that fixed order. Mixed row widths and ambiguous single-column files fail.
  The resolved delimiter is written into both inspection and result receipts.
- Formula source is never evaluated or returned. A formula is accepted only
  when the file already contains a finite cached scalar. Missing caches and
  error cells fail the whole candidate transaction.
- Numbers remain numbers, including unsafe integers. The importer does not
  silently stringify or repair them; the downstream scientific identity
  boundary must reject unsafe numeric identifiers.
- Excel date-formatted numeric cells become deterministic
  `YYYY-MM-DDTHH:mm:ss.SSS` wall-time strings using the workbook's 1900/1904
  calendar. No host timezone is applied. Elapsed-duration formats remain
  numeric.
- VBA is never executed and never returned. Comments, hyperlinks, formatting,
  and formula source are discarded. Macro/dialog/chart sheets are never
  materialized.
- Empty or duplicate normalized headers, non-finite numbers, error cells,
  unsupported cells, malformed structure, and exceeded row/column/cell/string
  limits reject the candidate before activation.

This boundary validates and materializes a candidate; the UI/Worker supervisor
still owns transactional activation, hard termination, generation ownership,
and stale-result suppression.

## Workspace and publication status

This package is currently private and is supported as an internal npm-workspace
package. Its `file:../../vendor/sheetjs/xlsx-0.20.3.tgz` dependency is resolved
from the repository checkout. A fresh root `npm ci` requires the root workspace
manifest and lockfile to include this package and exact tarball; that integration
is intentionally owned by the repository release coordinator.

Do not publish a packed `@3dena/tabular-import` tarball in this form: npm resolves
the relative `file:` dependency from the consumer installation location, where
the repository `vendor/` directory does not exist. A reviewed distribution
layout (for example, a bundled browser artifact or a publish-time package
rewrite) and a fresh-consumer install test remain required before publication.
