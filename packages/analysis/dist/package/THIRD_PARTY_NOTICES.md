# Third-party notices

This candidate distribution binds or bundles reviewed runtime bytes from the
following third-party packages. Exact versions and source-integrity records are
captured in `PROVENANCE.json`.

## jena-js 0.7.0-ona.0

- Project: <https://github.com/HUDongpin/jENA>
- Audited source commit: `90790856f00bdef63dbd27fc3a5b502e8cffe65f`
- Reviewed tarball SHA-256:
  `1e071eaa4085688bbbd5f9d7122513a4bf82a0eaf955d399ab21706204fc8afe`
- License: GPL-3.0-only
- Purpose: ENA model, accumulation, rotation, and node-position computation

The public `j-3dena` package declares this exact prerelease as its sole jENA
peer. It does not bundle a second engine instance. The reviewed artifact is
generated from the pinned official source commit and its transport integrity is
bound in `PROVENANCE.json`. rENA remains attribution and historical comparison
context; it is not the numerical oracle for this trajectory contract. The
upstream license is reproduced byte-for-byte under `THIRD_PARTY/`. The
redistributed `THIRD_PARTY/jena-js-PROVENANCE.md` is instead a deterministic,
privacy-sanitized copy.
Recognized high-confidence or explicitly path-labeled local filesystem paths are
replaced in full with a fixed placeholder, retaining no path components;
ambiguous unquoted path-like values fail closed. Its
transparent header records the upstream original provenance SHA-256 and
reviewed jENA artifact identity. The exact original provenance bytes remain
unchanged inside the reviewed tarball, whose hash and receipt stay under
repository custody; this public-package transformation does not alter the jENA
code, numerical contract, license, tarball, or receipt.

## SheetJS Community Edition (xlsx) 0.20.3

- Project: <https://git.sheetjs.com/SheetJS/sheetjs>
- Distribution: <https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz>
- Vendored archive SHA-256:
  `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`
- License: Apache-2.0
- Purpose: non-executing XLS/XLSX workbook parsing after bounded preflight

The exact license file carried by the vendored archive is reproduced as
`THIRD_PARTY/SheetJS-LICENSE.txt`.
