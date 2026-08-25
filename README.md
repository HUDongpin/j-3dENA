# 3DENA Next

3DENA Next is the TypeScript successor to
[3DENA](https://github.com/HUDongpin/3DENA). The target production runtime uses
Next.js/React in the browser and a persistent Node.js compute service for jENA,
Stats, trajectory and bootstrap work, with Plotly.js for analytical views.
Browser Workers remain local preflight, calibration and SDK-compatibility
executors; they are not the target public product's default scientific
authority. Production has no R process, rENA dependency, Shiny server, native
R serialization path, or R-service fallback.

## Current status

This repository contains a working browser calibration slice plus broader
local implementation candidates:

- five App Router routes: `/`, `/app`, `/papers`, `/team`, and `/about`;
- local raw-CSV preview and analytical-role mapping;
- collision-safe typed identities and bounded input validation;
- jENA-based shared-space SVD in a hard-cancellable browser Worker;
- public model-row and source-row accumulation tables with typed identities;
- stale-result suppression through dataset, specification, run, and Worker
  ownership;
- mutually exclusive Plotly 2D/3D ENA-network and dedicated trajectory rendering;
- strict, transactional `.ena3d.json` prepared-space import with same-realm
  byte custody and a browser-validated Class 1 trajectory path;
- RFC 4180 CSV, provenance JSON, and deterministic ZIP result exports;
- reusable framework-independent analysis, strict exchange-I/O, spreadsheet,
  Stats, trajectory, export and parity-contract workspaces;
- raw and prepared Comparison, Change and Stats product candidates, with
  prepared results explicitly limited to precomputed reductions;
- full-dimensional raw jENA result retention with display axes selected by a
  separate contract;
- a local `@3dena/analysis` prerelease package candidate consumed by fresh
  Node, TypeScript, browser-bundler and Next.js webpack smoke projects;
- an in-memory compute-orchestration candidate for leases, fencing, hard
  cancellation, observed exit, stale publication, TTL and deletion semantics;
- a framework-neutral Compute HTTP candidate plus a real single-host Node
  child-process supervisor and scientific-child candidate with immutable input
  rehash, public task execution, result checksum/owner/lease binding,
  publish-before-exit acknowledgement, deadline/cancel escalation and
  observed-close capacity release;
- a transaction-fenced spreadsheet workflow candidate for exact browser
  preflight, independent service rehash, inventory, exact sheet selection,
  typed mapping preview, parsed-content custody and atomic activation;
- functional, accessibility, unit, build, and production-boundary checks.

The correct whole-product state is **IMPLEMENTED_UNVERIFIED**. Only the exact
tracked small-raw dataset/spec/jENA/fixture contract under an explicit build
identity is a scoped
`PARITY_CANDIDATE`: all nine declared numeric fields pass the versioned
comparator, including both accumulation tables, but the generated fixture has
no independent approval record. Arbitrary user data must not inherit that
label.

The legacy prepared Class 1 candidate is quarantined outside the public tree as
`sensitive-excluded`. It contains participant identities and has no current
authorization, de-identification review, independent approval, or raw-parity
standing. Its exact hash, byte count, row/dimension inventory, identities, and
aggregate values are not tracked evidence. Prepared compatibility behavior is
tested only with fully synthetic exchange bytes and cannot demonstrate raw
Class 1 accumulation, rotation, or model-fit parity.

Raw Class 1 custody and dual-oracle review, per-quantity Stats/trajectory/
bootstrap decisions, spreadsheet HTTP/UI/durable adapters,
PostgreSQL/S3/distributed compute persistence and recovery, multi-browser evidence,
independent scientific approval, preview, publication, deployment, soak and
rollback evidence remain open. No repository-wide `VERIFIED_PARITY`,
`PRODUCTION_CANDIDATE`, `PRODUCTION_READY`, or completion claim is made.

The frozen legacy application may run only as an offline scientific oracle to
generate and independently validate reviewed static JSON/CSV fixtures. Oracle
tooling is isolated under `oracle-r/`; it is not imported, installed, invoked,
or shipped by the application or reusable analysis package.

## Run the local calibration candidate

Requirements: Node.js 20.9 or newer and npm 11.16.0.

```bash
npm ci
npm run dev
```

Then open `http://localhost:3000/app`. The bundled `small-raw.csv` fixture is
preloaded, so the complete local Worker-to-Plotly path can be exercised without
uploading data.

## Verify the repository

```bash
npm run check
npm run test:e2e
```

`npm run check` runs lint, TypeScript checks, package tests, parity-contract
tests, the R-free frozen-input custody gate, a production Next build, and a
deterministic public-facade build plus fresh Node/TypeScript/Vite/Next consumer
smoke, fail-closed production-runtime checks, the complete lock-graph
release-security/SBOM contract, and immutable CI action pins. The runtime
boundary scan checks manifests, the installed production dependency tree,
production source, and emitted `.next` files. The release-security verifier
requires every reachable production package and dependency edge in the
deterministic CycloneDX graph; npm's currently incomplete native SBOM is not an
accepted substitute.

The public-package portion is phase-aware. On a clean source HEAD it builds the
facade, creates a temporary tarball and receipt outside the repository, passes
their explicit paths to the strict verifier, and runs fresh consumer smoke. On
a generated artifact/runtime HEAD it verifies and consumes the exact tracked
tarball and receipt without rebuilding or overwriting their source-bound
custody. Temporary source-stage tarball/receipt artifacts are removed when the
gate exits; the staged package directory remains available to the subsequent
release-security check in the same `npm run check` invocation.

## Architecture

```text
apps/web
  Next.js App Router, React UI, Worker lifecycle, Plotly rendering

packages/analysis
  reusable typed jENA adapter, public contracts/task facade, Plotly/export facade

packages/io
  strict browser-safe ENA3D exchange decoding, limits, and byte receipts

packages/tabular-import
  bounded CSV/XLS/XLSX inspection and parsing candidates

packages/stats
  independent/paired statistics and effect-size candidates

packages/trajectory
  cohort, centroid, distance, elapsed/speed and weighting candidates

packages/export
  runtime-neutral RFC 4180 CSV and deterministic ZIP encoding

packages/compute-service-core
  in-memory orchestration contract and test adapters; not a production service

packages/compute-service-http
  Web-standard v1 job routes, capabilities, idempotency, SSE and checksum candidate

packages/compute-service-node
  real single-host Node supervisor and publish-acknowledged scientific child;
  not a persistent distributed worker or hardened container

packages/dataset-workflow
  preflight, server rehash, inventory, mapping preview and atomic activation core

packages/parity-contracts
  fixture schema, provenance, numerical alignment/comparison contracts

oracle-r
  offline migration-only generators; excluded from all production graphs
```

The non-negotiable longitudinal invariant is one shared coordinate system:
all unit-period vectors are fitted by one joint rotation, and group-period
centroids are computed only after every point has been projected into that same
space. Display filtering never refits or mutates the analysis.

## Evidence and governance

- [Repository instructions](AGENTS.md)
- [Feasibility and execution record](docs/session-records/2026-08-20-nextjs-jena-feasibility-and-agent-plan.md)
- [Browser vertical-slice contract](docs/architecture/browser-vertical-slice-contract.md)
- [Production runtime boundary](docs/architecture/production-runtime-boundary.md)
- [Offline oracle boundary](docs/architecture/oracle-r-boundary.md)
- [Prepared exchange boundary](docs/architecture/prepared-exchange-boundary.md)
- [Persistent compute-service decision](docs/architecture/persistent-compute-service-v1.md)
- [Strict successor implementation record](docs/session-records/2026-08-20-strict-successor-implementation-record.md)
- [Whole-repository capability ledger](packages/parity-contracts/CAPABILITY_LEDGER.md)
- [Scientific authority matrix](packages/parity-contracts/SCIENTIFIC_AUTHORITY_MATRIX.md)
- [Parity contract](packages/parity-contracts/PARITY_CONTRACT_V1.md)
- [Parity matrix](packages/parity-contracts/PARITY_MATRIX.md)
- [Divergence ledger](packages/parity-contracts/DIVERGENCE_LEDGER.md)
- [Analysis package API](packages/analysis/README.md)
- [Design system](design-system/3dena-next/MASTER.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

Planning, an implementation commit, a green browser test, candidate numeric
agreement, governed fixture approval, verified parity, and a production release
are separate evidence states. This project reports each state independently.
