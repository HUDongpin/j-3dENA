# 3DENA Next

3DENA Next is the browser-native successor to
[3DENA](https://github.com/HUDongpin/3DENA). Its production runtime is built
from Next.js, React, TypeScript, jENA, a dedicated browser Web Worker, and
Plotly.js. It has no production R process, rENA dependency, Shiny server, native
R serialization path, or R-service fallback.

## Current status

This repository now contains a working browser-only calibration slice:

- five App Router routes: `/`, `/app`, `/papers`, `/team`, and `/about`;
- local raw-CSV preview and analytical-role mapping;
- collision-safe typed identities and bounded input validation;
- jENA-based shared-space SVD in a hard-cancellable browser Worker;
- stale-result suppression through dataset, specification, run, and Worker
  ownership;
- Plotly 2D/3D network, point, and trajectory rendering;
- CSV result export;
- reusable framework-independent analysis and parity-contract workspaces;
- functional, accessibility, unit, build, and production-boundary checks.

The correct scientific status is **PARITY_CANDIDATE**, not verified parity or a
production release. A diagnostic comparison against an ungoverned frozen
oracle candidate is encouraging, but the tracked rENA 0.2.7 golden remains
explicitly pending. Accumulation-table coverage, tied-spectrum comparison,
bootstrap/inference, the governed Class 1 trajectory fixture, the full import
and export matrix, independent package-consumer verification, licensing review,
deployment, and release evidence remain open.

The frozen legacy application may run only as an offline scientific oracle to
generate and independently validate reviewed static JSON/CSV fixtures. Oracle
tooling is isolated under `oracle-r/`; it is not imported, installed, invoked,
or shipped by the application or reusable analysis package.

## Run the calibration slice

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
tests, a production Next build, and a fail-closed production-runtime boundary
scan. The boundary scan checks manifests, the installed production dependency
tree, production source, and emitted `.next` files.

## Architecture

```text
apps/web
  Next.js App Router, React UI, Worker lifecycle, Plotly rendering

packages/analysis
  reusable typed jENA adapter, validation, shared-space trajectories

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
- [Parity contract](packages/parity-contracts/PARITY_CONTRACT_V1.md)
- [Parity matrix](packages/parity-contracts/PARITY_MATRIX.md)
- [Divergence ledger](packages/parity-contracts/DIVERGENCE_LEDGER.md)
- [Analysis package API](packages/analysis/README.md)
- [Design system](design-system/3dena-next/MASTER.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

Planning, an implementation commit, a green browser test, candidate numeric
agreement, governed fixture approval, verified parity, and a production release
are separate evidence states. This project reports each state independently.
