# Third-party notices

This candidate distribution bundles reviewed runtime bytes from the following
third-party packages. The exact versions and source-integrity records are also
captured in `PROVENANCE.json`.

## jena-js 0.6.3

- Project: <https://github.com/HUDongpin/jENA>
- Audited source commit: `57b7794ec3873c251c33086454523e5a3949836f`
- Public npm tarball SHA-256:
  `0387c7958718e1d8a70a29f056da1ffe78e94ceb14ac957a3a360b586ac23121`
- License: GPL-3.0-only
- Purpose: ENA model, accumulation, rotation, and node-position computation

The independently reviewed 0.6.3 successor removes the erroneous 0.6.2
self-dependency and declares zero runtime dependencies. Its `dist/` tree is
byte-identical to the frozen 0.6.2 numerical baseline. The public `j-3dena`
build bundles that reviewed implementation exactly once and
publishes no runtime dependency on jena-js. This packaging correction does not
authorize numerical changes. The upstream license and provenance files are
reproduced under `THIRD_PARTY/`.

## SheetJS Community Edition (xlsx) 0.20.3

- Project: <https://git.sheetjs.com/SheetJS/sheetjs>
- Distribution: <https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz>
- Vendored archive SHA-256:
  `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`
- License: Apache-2.0
- Purpose: non-executing XLS/XLSX workbook parsing after bounded preflight

The exact license file carried by the vendored archive is reproduced as
`THIRD_PARTY/SheetJS-LICENSE.txt`.
