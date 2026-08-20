# jENA 0.6.3 successor candidate handoff

Status: `IMPLEMENTED_UNVERIFIED` — local upstream candidate only.

This receipt records a minimal successor candidate prepared from the frozen jENA
source commit `2f63db4c6ccf5684afc8437ae81ed1a3ccd0c1a3`. It removes the accidental
`jena-js -> jena-js@^0.6.0` runtime self-dependency, adds a pack-time zero-runtime-
dependency assertion, and updates development-only browser test tooling. It does
not change runtime or numerical source.

## Immutable candidate identities

| Item | SHA-256 |
|---|---|
| Local `jena-js-0.6.3.tgz` | `2bae88973c0aa948767a2bdbf78d7c17510f5d35475190dc40c50f8be97896c7` |
| `CHANGELOG.md` | `3b5ba53f89b5ede83faaf2f261dcf8f42db0d66a8b5bf3067fb7af3bde0c64de` |
| `PROVENANCE.md` | `e7074a92fcc21a7f308abb3398d8c65aebaa48331440036c5f4af3892a4e2e5f` |
| `package.json` | `5ade34aee40e805f9bcf25a62368542a19151bbaf83a65a5b733000f0405cdae` |
| `package-lock.json` | `b608bdab95ebd3c37da2c1b68d53b10953888dbcd6099f934db06e1f73398801` |
| `scripts/pack-check.mjs` | `6d160c8e7535351ed6887de7f3e8d0cd7ec2b40515b526d0ad6c9cd2c6e34581` |
| `vitest.browser.config.ts` | `153072f6ff16253e778fb6217bf88a99bf134a222ea5a51270cf9ce5949c98fd` |

The review patch intentionally contains the authored source and manifest changes.
The regenerated exact lockfile is supplied separately as
`jena-js-0.6.3.package-lock.json`, rather than embedded as thousands of generated
patch lines. Its content must match the hash above when applied in the upstream
review branch/commit.

## Local gates run on 2026-08-21

- `npm ci`: pass.
- `npm run lint`: pass.
- `npm run typecheck`: pass.
- `npm test`: pass, 13 files and 150 tests.
- `npm run build`: pass.
- `npm run pack:check`: pass, 43 published files and zero runtime dependencies.
- `npm run test:browser`: pass, two files and four tests in real Playwright Chromium.
- `npm audit --audit-level=moderate`: pass; one low-severity vulnerability remains
  in `tsup`'s development-only nested `esbuild`, with no runtime dependency graph.
- Fresh Node ESM consumer installed the local tarball and observed exactly one
  lock entry at `node_modules/jena-js`, version `0.6.3`, with no dependencies.

## Required independent release actions

This candidate is not a production successor and must not be consumed as one yet.
The upstream owner must create a reviewed commit/PR, rerun the frozen numerical and
consumer matrix, inspect the manifest, exports, tarball, license, and provenance,
and publish an authorized `jena-js@0.6.3`. The product release gate must then prove
that its clean consumer lockfile and SBOM contain exactly that single registry
instance and no self edge. A workspace alias, filtered SBOM, modified lockfile, or
this local tarball cannot satisfy that gate.
