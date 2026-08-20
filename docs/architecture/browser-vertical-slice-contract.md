# Browser vertical-slice and E2E contract

Status: normative for the local calibration/SDK-compatibility slice. The
persistent compute-service decision supersedes this document as the production
scientific-execution topology; this file does not authorize a Worker-only
public release.

## Supported surface

The required routes are `/`, `/app`, `/papers`, `/team`, and `/about`. Each route
must render a shared `app-shell`, a single visible `route-main`, a non-empty
document language, and no horizontal overflow at the audited widths.

The initial browser support statement is Chromium. Firefox and WebKit parity are
explicit future gaps; passing the current suite must not be described as
cross-browser certification.

The audited responsive widths are:

- mobile: 390 px;
- tablet: 768 px; and
- desktop: 1280 px.

At every width and on every required route, axe must report zero `serious` or
`critical` violations.

## Required application selectors

These selectors are product contracts, not styling hooks:

| `data-testid` | Required semantics |
| --- | --- |
| `app-shell` | Shared route shell. |
| `route-main` | The route's primary content container. |
| `raw-file-input` | Native file input accepting the governed small CSV. |
| `analysis-workspace` | Has `data-analysis-mode=raw\|prepared`. |
| `analysis-mode-raw`, `analysis-mode-prepared` | Switch the mutually exclusive raw-modeling and prepared-space contracts. |
| `prepared-file-input` | Native file input accepting only strict `.ena3d.json`. |
| `prepared-load-bundled` | Historical selector only; release builds must not expose a bundled study artifact. |
| `prepared-import-status` | Has `data-state=idle\|validating\|completed\|error`. |
| `prepared-dataset-receipt` | Exposes committed source kind and exact `data-dataset-hash`; absent before successful activation. |
| `analysis-run` | Starts a run; disabled until the input/spec is valid. |
| `analysis-cancel` | Cancels the active run by terminating its Worker. |
| `analysis-status` | Has `data-state=idle\|running\|completed\|cancelled\|invalidated\|error`. |
| `worker-status` | Has non-empty `data-state` and `data-worker-id`. Reconstructing a Worker changes the ID. |
| `analysis-result` | Visible only for a current completed owner; exposes `data-dataset-hash`, `data-spec-hash`, and `data-run-id`. |
| `analysis-plot` | Has `data-plotly-ready=true` only after Plotly initialization and contains `.js-plotly-plot`. |
| `analysis-spec-window-size` | Numeric window-size control; editing it invalidates a prior result. |
| `analysis-error` | Optional accessible error summary for invalid input/run failures. |
| `prepared-summary` | Exposes point, node, edge, dimension, group, and centroid counts. |
| `prepared-g1-centroid-table` | Historical selector only; current prepared tables use generic group identities from the active upload. |
| `prepared-export-centroids`, `prepared-export-provenance`, `prepared-export-bundle` | Download the result-bound CSV, JSON receipt, and deterministic ZIP. |

Hashes must contain at least eight hexadecimal characters. `runId` and
`data-worker-id` must be non-empty opaque identities, not presentation labels.

## Ownership and cancellation invariants

A renderable result is owned by the exact tuple:

```text
datasetHash + specHash + runId
```

Changing any analysis input or option invalidates the old result immediately.
After changing `windowSizeBack`, the visible state is `invalidated`, the old
result is hidden, and the next completed result must retain the same dataset
hash while changing both spec hash and run ID.

Cancellation is not a UI-only flag. It must terminate the current Worker. The
next run reconstructs a Worker with a new identity rather than reviving the
terminated instance. A message from a terminated or superseded run must not
change `cancelled` state or repopulate the result.

To make this race deterministic, the product accepts
`?e2eWorkerDelayMs=<bounded milliseconds>` only when `NODE_ENV !== "production"`
and passes the delay to the analysis Worker. Production builds must ignore the
parameter. The E2E suite uses 1200 ms, cancels during `running`, waits beyond
that interval, and verifies that no late result appears.

## Calibration-slice transport assertion

When this local calibration executor is selected, CSV analysis through Plotly
initialization must create a browser `Worker` and issue no Fetch/XHR or
application WebSocket. This proves local SDK compatibility and that the tested
slice does not leak data; it is not the target production transport contract.
The production Web product must instead use the versioned remote compute client
after explicit upload consent and is governed by
`persistent-compute-service-v1.md`. The development-only
Next.js `/_next/hmr` and `/_next/webpack-hmr` sockets are excluded by exact
pathname from the WebSocket assertion; there is no product socket exemption.

The suite instruments the native Worker constructor before page code runs and
records creation and termination. A status label without an observed Worker is
not sufficient evidence.

The local calibration prepared path uses two observed Workers: one for
transactional import validation and one for analysis-time revalidation plus
reduction. Release tests use fully synthetic prepared bytes and never load a
bundled study artifact. From Run through Plotly, local prepared reduction
issues no Fetch/XHR or application WebSocket and publishes
`data-source-kind=prepared-exchange` together with
`data-raw-recomputed=false`; the production remote-default path has its own
transport receipt.

## Executable specifications

- `e2e/routes.spec.ts`: route, refresh/history, language, and responsive gates;
- `e2e/analysis.spec.ts`: small CSV to Worker to Plotly, ownership,
  invalidation, cancellation, late-result, and no-analysis-transport gates;
- the prepared E2E suite: fully synthetic exact-byte receipt, transactional
  import, ownership/cancellation, Plotly, generic centroids, and real browser
  downloads;
- `e2e/accessibility.a11y.spec.ts`: all routes at all three widths; and
- `playwright.config.ts`: Chromium and a11y projects with failure artifacts in
  `output/playwright/`.

Run locally with `npm run test:e2e`; run the a11y-only project with
`npm run test:e2e:a11y`. The default server is Next development mode so the
non-production delay hook is available. To target an already running server,
set `PLAYWRIGHT_BASE_URL`. To select a different local command, set
`PLAYWRIGHT_WEB_SERVER_COMMAND`. A machine with a locally installed Chrome may
set `PLAYWRIGHT_CHROMIUM_CHANNEL=chrome`; CI leaves this unset and installs the
exact Playwright Chromium revision.

These tests intentionally fail until the calibration slice implements the
selectors and state semantics above. A missing selector is a calibration
contract failure, not a reason to relax the test to presentation text. Separate
production E2E must exercise the real Compute API/image and must not reuse this
no-network assertion as evidence that the remote product flow passed.
