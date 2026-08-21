# jENA 0.6.3 public successor receipt

Status: packaging successor **published and independently approved**. This closes
the jENA self-dependency successor and public-registry publication requirement;
it does not establish 3DENA scientific parity or production readiness.

The machine-readable publication record is
`2026-08-21-jena-js-0.6.3-publication.json`.

## Upstream identities

| Item | Identity |
|---|---|
| Repository | `https://github.com/HUDongpin/jENA` |
| Frozen 0.6.2 baseline | `2f63db4c6ccf5684afc8437ae81ed1a3ccd0c1a3` |
| Reviewed successor commit | `55fe95505a7076c0c44cd9f01a65b9c84b4ab56e` |
| Merged upstream successor | `57b7794ec3873c251c33086454523e5a3949836f` |
| Public package | `jena-js@0.6.3` with `latest=0.6.3` |
| Registry tarball | `https://registry.npmjs.org/jena-js/-/jena-js-0.6.3.tgz` |
| Tarball SHA-256 | `0387c7958718e1d8a70a29f056da1ffe78e94ceb14ac957a3a360b586ac23121` |
| Tarball SHA-1 | `5713278b6a0b0a8418569afb52ccef55f53c5383` |
| npm SRI | `sha512-AT/LTYt0YyQiGbO4Xq0XLES9FZ9rBuzj+J+Oq9s8B3HESy5bClzHFnjfpxThNmRWOM7HuuwM9E6NdOT0vyGNng==` |

The registry recorded publication at `2026-08-21T14:28:39.486Z`. A fresh
`npm pack jena-js@0.6.3` download reproduced the exact reviewed SHA-256 and
SHA-1 above, so the public object is byte-identical to the independently
reviewed 43-file tarball.

## Independent review

The non-implementation reviewer `Epicurus` issued `APPROVE` for the complete
successor worktree and the exact tarball above. The reviewer independently:

- verified removal of the runtime self-dependency from package, lock root, npm
  runtime tree, and tarball;
- ran a 46-case malformed-contract mutation matrix and the tracked 17-case
  fail-closed contract suite;
- ran clean installation, lint, typecheck, 150 unit tests, build, pack check,
  and four Chromium package tests;
- repeated the package gates under Node 18; and
- proved the baseline and successor `dist/` trees byte-identical, so the
  successor did not change numerical, API, or runtime implementation bytes.

The review retained one non-blocking low-severity `esbuild@0.27.7` finding in a
development-only dependency. Production dependencies audited with zero known
vulnerabilities; the receipt does not claim that every development dependency
has zero findings.

## Product integration

The j-3dENA product now pins exactly `jena-js: "0.6.3"`. Its lock entry resolves
only to the public registry tarball and exact SRI above, contains no runtime
dependency/self edge, and `npm ls jena-js --all` returns one registry instance.
Both the four-case fail-closed successor contract suite and the actual product
successor gate pass.

## Historical candidate material

`jena-js-0.6.3-source.patch` and `jena-js-0.6.3.package-lock.json` preserve the
earlier handoff candidate. They are retained for lineage, but their old
candidate hashes and content are not the authoritative published object. The
merged upstream commit and registry tarball identities above supersede them for
release consumption.

## Evidence boundary

This receipt closes only the named jENA packaging successor, independent code
review, upstream merge, public npm publication, and exact product dependency
pin. It does not approve Class 1 custody, any of the 55 scientific quantities,
Fly deployment, legal/DPA/region decisions, a signed `BuildApprovalV1`, stress,
soak, canary, production probes, or rollback.
