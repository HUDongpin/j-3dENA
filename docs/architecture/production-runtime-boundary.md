# Production runtime boundary

Status: normative for 3DENA Next production builds.

## Decision

3DENA Next uses Next.js/React/Plotly in the browser and a persistent Node.js
TypeScript compute service for production scientific tasks. jENA, Stats,
trajectory and bootstrap code execute in isolated compute children. Browser
Workers are limited to byte preflight, hashing, lightweight inspection,
development calibration and SDK/browser compatibility. No production role has
an R executable, R package, Shiny process, native R object loader, or remote
R-backed analysis service.

The old R application and its pinned rENA installation are a migration-only
scientific oracle. They may generate reviewable static JSON golden fixtures in
an isolated offline workflow. They are not a fallback production path.

## Allowed production data flow

```text
local CSV/XLS/XLSX/JSON
    -> browser exact-byte preflight, hash and explicit upload consent
    -> persistent Compute API + immutable encrypted object
    -> PostgreSQL queue/lease + isolated Node.js compute child
    -> jENA / Stats / trajectory / bootstrap TypeScript core
    -> checksummed result owned by datasetHash + specHash + runId + taskId
    -> short-lived result reference -> browser Plotly/download
```

The same pure TypeScript core may run locally for Node SDK consumers. The
public Web product does not silently switch between a Worker fit and a remote
fit. The local Worker calibration flow is governed separately by
`browser-vertical-slice-contract.md` and is not production-topology evidence.

The product may read governed JSON/CSV fixtures. It must never read `.RData`,
`.rds`, `.rda`, or other native R serialization.

## Prohibited production evidence

The boundary gate fails on any of the following in production dependencies,
product source, or emitted Next.js output:

- `Rscript` or another direct R execution path;
- rENA, Shiny/Shiny Server, Rserve, or OpenCPU runtime references;
- HTTP or WebSocket endpoints that identify an R, rENA, Shiny, Rserve, or
  OpenCPU analysis service;
- production dependency names for those runtimes/clients;
- native R scripts, projects, workspaces, package locks, or serialized fixture
  files outside the isolated oracle area.

The gate permits historical/provenance wording in `docs/**`, `oracle-r/**`, and
the parity-contract package. This is a wording exemption, not a binary-fixture
exemption: a native R file under `packages/**` still fails.

## Gate and evidence scopes

Run:

```bash
npm run test:runtime-boundary
```

The implementation is `scripts/verify-production-boundary.mjs`. It inspects:

1. production declarations in every reachable `package.json`;
2. non-dev package-lock entries when `package-lock.json` exists;
3. the installed tree from `npm ls --omit=dev --all --json` after `npm ci`;
4. non-test source under `apps/**` and `packages/**`;
5. every root or app `.next` output when a build exists; and
6. native R filenames across the repository, except `docs/**` and
   `oracle-r/**`.

In CI, absence of an inspectable `node_modules` tree is itself a failure. For a
source-only local preflight before install, use:

```bash
node scripts/verify-production-boundary.mjs --allow-missing-installed-tree
```

The boundary unit suite is:

```bash
node --test scripts/verify-production-boundary.test.mjs
```

## Review rule

A green gate proves only that its enumerated dependency, source, filename, and
bundle evidence contains no prohibited runtime path. It does not prove
scientific parity. Parity is independently established by governed fixtures and
the golden/comparator suites.

If a legitimate product string trips the scanner, do not weaken a global rule
or add an inline bypass. Move historical explanation to documentation, or
propose a narrowly reviewed structural exemption that cannot conceal executable
source or emitted bundles.
