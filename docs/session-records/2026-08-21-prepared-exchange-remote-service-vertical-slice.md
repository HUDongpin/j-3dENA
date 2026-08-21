# Prepared-exchange remote service vertical slice — 2026-08-21

Status: `IMPLEMENTED_UNVERIFIED`

This record freezes the implemented `.ena3d.json` remote product boundary. It
does not claim scientific parity, independent approval, preview deployment, or
production readiness.

## Acceptance surface

The browser product now provides a separate prepared-source flow rather than
misrepresenting a prepared coordinate space as raw ENA input:

1. The browser takes one owned exact-byte snapshot and applies the strict
   `@3dena/io` exchange decoder.
2. The product shows an accessible table inventory, source SHA-256, scientific
   shape, and the frozen Class 1 mapping before any service upload.
3. Explicit activation creates a capability-bound `prepared-import` job,
   uploads the exact bytes through the authenticated service content route, and
   receives an immutable storage receipt.
4. The network execute request contains only the activated receipt, run/deadline,
   and frozen mapping. It never contains `exactBytesBase64`.
5. The service reads back its immutable object, verifies exact SHA-256 and byte
   length, binds `specHash = hash({ kind: "prepared-import", mapping })`, and
   injects the bytes only into the internal Worker task.
6. The Worker decodes the strict exchange again, checks the service receipt,
   executes `analyzePreparedSpace`, and verifies row, dimension, and schema
   inventory before publication.
7. The primary result is published as `prepared-exchange` with
   `jenaExecuted: false`; it is never recast as `ena-model` or `raw-jena`.
8. The retained prepared result can authorize the same six remote derived tasks
   as a raw ENA source. Each derived job binds the exact source-result hash and
   is independently deleted after verified download.
9. The remote prepared result renders the imported network/trajectory surface,
   Plotly view, and exact accessible tables. App-local derived computation is
   disabled on this remote surface.
10. Formal download accepts a prepared primary source or a derived result bound
    to it and includes exact source/current artifacts, deterministic CSV/ZIP,
    provenance, source binding, dataset receipt, and BuildApprovalV1 identity.

## Frozen wire contracts

- `3dena.compute-prepared-import-http.v1`
- `3dena.create-job-request.v1` with `format: "ena3d-json"`
- `3dena.prepared-import-upload-receipt.v1`
- `3dena.execute-prepared-import-job-request.v1`
- `3dena.activated-prepared-import-task-spec.v1`
- `3dena.analysis-task.v1` with `kind: "prepared-import"`
- `3dena.prepared-space-result.v1`

The runtime candidate manifest must advertise the prepared-import HTTP contract
alongside the dataset, source-result, compute, and analysis contracts. An older
allowlisted compute build fails execution closed before upload.

## Custody and deletion boundary

- User filenames do not enter the internal task or published scientific result;
  the source name is the constant `uploaded.ena3d.json`.
- The browser-safe execute request carries no raw bytes.
- Persistent production stores the upload in the configured private object
  store and verifies its immutable descriptor before execution.
- The prepared input is owned by its source job. Normal terminal publication
  and explicit source-session deletion remain responsible for observed object
  deletion and capacity release.
- Only a primary `ena-model` or `prepared-import` result enters the published
  source registry. Derived results cannot recursively become a source.

## Scientific boundary

The approved frozen mapping is:

```json
{
  "participant": ["Group", "Speaker"],
  "participantLabel": "Speaker",
  "group": "Group",
  "time": "Period",
  "timeOrder": ["TP1", "TP2", "TP3"],
  "cohortPolicy": "available",
  "displayDimensions": ["SVD1", "SVD2", "SVD3"],
  "missingDisplayCoordinates": "reject"
}
```

Prepared import does not fit or refit an ENA model. Rotation, eigenvalues, and
variance remain unavailable unless the exchange contains a future reviewed
contract for them. This implementation does not establish raw-row parity,
rENA parity, independent scientific approval, or Class 1 acceptance.

## Focused executable evidence

At the time of this record:

- `@3dena/analysis`: 92 tests passed, including primary exact-byte prepared
  import, receipt mismatch rejection, prepared derived tasks, and recursive
  schema checks.
- `@3dena/compute-service-http`: 8 tests passed, including wrong-byte upload
  rejection, authenticated content receipt, mapping-bound activation, internal
  byte injection, and prepared-source derived binding.
- `@3dena/compute-service-persistent`: 22 tests passed, including exact artifact
  resolution as `prepared-exchange` without a jENA claim.
- `@3dena/web`: 103 tests passed, including local preflight-before-upload,
  explicit prepared activation, service-only derived controls, and prepared
  formal export.
- Root lint and typecheck passed across all workspaces, all workspace test
  suites passed, the production Webpack build generated all eight routes, and
  the TypeScript-only production-boundary and repository release-security
  gates passed.
- The persistent runtime builder produced an immutable candidate whose manifest
  advertises `3dena.compute-prepared-import-http.v1`; this is build evidence,
  not an image, deployment, provider, or BuildApprovalV1 receipt.
- Public-package build and layout verification passed. The isolated consumer
  smoke did not produce a local completion receipt because its fixed-version
  Next.js `npm install` ran with network disabled; it remains for networked CI.
- The live jENA successor gate still fails closed on installed and locked
  `jena-js@0.6.2`; no public `0.6.3` registry release is claimed.
- A real-browser Playwright contract now covers local prepared preflight with no
  mutation, exact content upload, service parser activation, prepared-source
  rendering, source-bound network comparison, formal ZIP download, deletion,
  and absence of browser Workers. Test discovery and strict TypeScript checking
  pass locally; actual browser execution is awaiting the networked CI matrix
  because this session could not obtain permission to bind its local test port.
- The preceding remote CodeQL run completed query extraction and SARIF export
  but failed while reading its workflow-run metadata. The workflow now grants
  the minimal missing `actions: read` permission while retaining the zero-result
  SARIF verifier; a new CI run is required before calling CodeQL green.

Integrated build, browser matrix, real Safari/assistive-technology execution,
security approval, live provider migration, stress/soak, canary, production
probes, rollback, and Owner acceptance remain separate gates.
