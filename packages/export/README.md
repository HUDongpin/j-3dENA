# `@3dena/export`

Framework-independent, browser-only export primitives for 3DENA. The package
has no runtime dependencies and its production source does not import Node,
filesystem, compression, or server APIs.

## CSV

`encodeCsvUtf8(table, options?)` returns UTF-8 bytes without a byte-order mark.
`encodeCsvText(table, options?)` returns the same RFC 4180 text before UTF-8
encoding. Callers provide an ordered `columns` array and rows with exactly the
same width, so JavaScript object-key enumeration never determines formal
export order. Every field is double-quoted, embedded quotes are doubled, and
records use CRLF. A final CRLF is included by default.

Supported cells are `string`, finite `number`, `bigint`, `boolean`, and `null`.
BigInt is serialized losslessly in decimal. Null text and non-finite-number
handling are explicit options. Non-finite numbers are rejected by default.

Spreadsheet-formula handling is also explicit:

- `neutralize` (default) prefixes dangerous text with an apostrophe;
- `reject` fails the export;
- `allow` preserves the caller's text.

Neutralization covers leading whitespace and `=`, `+`, `-`, or `@`, plus
tab/CR/LF prefixes. Leading apostrophes are included in detection so distinct
headers such as `=x`, `'=x`, and `''=x` remain distinct after neutralization.
Numeric negative values are not treated as text formulas.

## Deterministic ZIP store

`createDeterministicZip(entries, limits?)` accepts file paths and `Uint8Array`
contents and returns a complete ZIP archive using the store method. It writes
CRC-32 into local and central records, sets the UTF-8 filename flag, uses the
fixed DOS epoch `1980-01-01T00:00:00Z`, emits no variable extra fields or
comments, and sorts entries by their UTF-8 path bytes. Reordering the input
array therefore does not change the archive.

ZIP paths must be relative, well-formed Unicode file paths using `/`. Absolute
and drive paths, backslashes, control characters, empty/`.`/`..` segments,
directory-only paths, and duplicate paths are rejected. Inputs are copied
before CRC and archive construction.

Default limits are 64 files, 8 MiB per file, 32 MiB total uncompressed data,
and 512 UTF-8 bytes per path. Callers may lower them or raise them only up to
the exported hard ceilings: 1,024 files, 64 MiB per file, 128 MiB total, and
4,096 bytes per path. This writer deliberately emits ordinary ZIP32 archives;
ZIP64 and compression are outside this boundary.
