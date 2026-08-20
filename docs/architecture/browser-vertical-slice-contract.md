# Browser vertical-slice and E2E contract

Status: normative product/browser handoff.

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
| `analysis-run` | Starts a run; disabled until the input/spec is valid. |
| `analysis-cancel` | Cancels the active run by terminating its Worker. |
| `analysis-status` | Has `data-state=idle\|running\|completed\|cancelled\|invalidated\|error`. |
| `worker-status` | Has non-empty `data-state` and `data-worker-id`. Reconstructing a Worker changes the ID. |
| `analysis-result` | Visible only for a current completed owner; exposes `data-dataset-hash`, `data-spec-hash`, and `data-run-id`. |
| `analysis-plot` | Has `data-plotly-ready=true` only after Plotly initialization and contains `.js-plotly-plot`. |
| `analysis-spec-window-size` | Numeric window-size control; editing it invalidates a prior result. |
| `analysis-error` | Optional accessible error summary for invalid input/run failures. |

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

## Browser-only transport assertion

From CSV selection through Plotly initialization, analysis must create a browser
`Worker` and issue no Fetch/XHR or application WebSocket. The development-only
Next.js `/_next/hmr` and `/_next/webpack-hmr` sockets are excluded by exact
pathname from the WebSocket assertion; there is no product socket exemption.

The suite instruments the native Worker constructor before page code runs and
records creation and termination. A status label without an observed Worker is
not sufficient evidence.

## Executable specifications

- `e2e/routes.spec.ts`: route, refresh/history, language, and responsive gates;
- `e2e/analysis.spec.ts`: small CSV to Worker to Plotly, ownership,
  invalidation, cancellation, late-result, and no-analysis-transport gates;
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

These tests intentionally fail until the product implements the selectors and
state semantics above. A missing selector is a product-contract failure, not a
reason to relax the test to presentation text.
