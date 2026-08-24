# j-3dena

`j-3dena` is the public TypeScript package for the j-3dENA successor.
It exposes one ESM root entry for dataset inspection, local analysis execution,
remote compute-service clients, pure Plotly-spec compilation, and deterministic
exports. Internal workspace packages are bundled implementation details and do
not define public subpath APIs.

The package requires Node.js 20.9 or newer. Its browser-compatible entry can be
consumed by modern ESM bundlers. Scientific computation is pure TypeScript; R,
rENA, Shiny, and R subprocesses are not runtime dependencies.

```ts
import { executeAnalysisTask, inspectDataset } from "j-3dena";
```

The package has zero bundled runtime dependencies and one exact peer:
`jena-js@0.7.0-ona.0`. The host must install that single engine instance. Its
internal scientific adapter identity remains `@3dena/analysis` for compatibility
with the versioned result contracts; consumers install and import `j-3dena`.

## Evidence status

This package build is `IMPLEMENTED_UNVERIFIED`. That label is intentional:
packaging and focused tests do not establish whole-product numerical parity,
browser support, deployment readiness, or Class 1 raw-data parity. Consumers
must inspect each result's versioned provenance and evidence scope.

## Public API

The supported runtime root exports are exactly:

- `inspectDataset(bytes, options)`
- `adaptFittedJenaTrajectoryResultV2(input)`
- `executeAnalysisTask(dataset, task)`
- `assertAnalysisExecutionDatasetV2(value)`
- `assertAnalysisResultEnvelopeV1(value)`
- `assertLongitudinalExecutionRequestV2(value)`
- `assertTrajectoryRunSpecV2(value)`
- `assertLongitudinalAnalysisBundleV2(value)`
- `verifyLongitudinalAnalysisBundleV2(value)`
- `createAnalysisClient(config)`
- `compilePlotlySpec(result, displaySpec)`
- `compileTrajectoryPlotlySpec(bundle, displaySpec)`
- `createExportBundle(result, options)`
- `executeLongitudinalAnalysisV2(input)`
- `getAnalysisBuildIdentityV2()`
- `hashAnalysisValueV1(value)`

The plotting APIs are mutually exclusive presenter boundaries:
`compilePlotlySpec()` is ENA-only: it renders fitted participant points, code
nodes, network edges, and axes, but no group-period centroids or time-point
labels. V1 has no independent ordinary group-mean input, so its
read-compatible legacy `traces.centroids` and `traces.trajectory` flags are
display no-ops. The required legacy `style.trajectoryWidth` field is likewise
readback-only. `compileTrajectoryPlotlySpec()` is trajectory-only and ignores
the read-compatible legacy
`traces.networkOverlay` flag. Fitted
code reference nodes remain part of trajectory plots because they are
coordinate references, not ENA network edges. Longitudinal scientific bundles
and exports retain their immutable `networkOverlays` data.

No `@3dena/*` internal subpath is a public compatibility promise. Versioned
contract and result types remain type-only root exports. The runtime
validators and the discriminated JSON Schemas under `schemas/` are the stable
untrusted-data boundary for execution datasets and result envelopes.

## License and provenance

The package is distributed under `GPL-3.0-only`. See `LICENSE`,
`THIRD_PARTY_NOTICES.md`, `THIRD_PARTY/`, `schemas/`, and `PROVENANCE.json` in the package.
No publication or production-readiness claim is implied by a local tarball.
