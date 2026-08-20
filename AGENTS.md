# AGENTS.md

These instructions apply to the entire `j-3dENA` repository. A more deeply
nested `AGENTS.md` may add or override instructions for its own subtree.

## Read order

Before planning or editing, read:

1. this file;
2. `docs/session-records/2026-08-20-nextjs-jena-feasibility-and-agent-plan.md`;
3. `design-system/3dena-next/MASTER.md` for UI work;
4. the matching file under `design-system/3dena-next/pages/`, if one exists.

Reinspect the current worktree before relying on these records. The session
record is an evidence-backed starting contract, not permission to ignore newer
source, tests, decisions, or nested instructions.

## Project mission

Build the Next.js/TypeScript successor to the current R/Shiny 3DENA analysis
application, using `jena-js` as the ENA numerical core while preserving the
current product's scientifically meaningful analysis behavior.

The intended deliverables are:

- a reusable, framework-independent TypeScript analysis package;
- a Next.js App Router analysis application that consumes that package;
- executable numerical, browser, security, export, and release evidence.

## Runtime boundary

The final production runtime must contain:

- no R runtime;
- no rENA runtime dependency;
- no Shiny or Shiny Server;
- no R-backed API or R subprocess;
- no R package installation in the production image or deployment.

Development and validation **may run R/rENA** as a frozen, read-only scientific
oracle. Keep oracle material isolated under a clearly named development-only
location such as `oracle-r/`, `tools/oracle-r/`, or an external frozen checkout.
It must never be imported by a production package, copied into a client bundle,
or required to start the Next.js application.

Do not write new product behavior in R. R is allowed to generate or verify
golden fixtures, characterize legacy behavior, and explain approved numerical
differences.

## Authoritative baselines

Until a reviewed successor record changes them, the migration baselines are:

- legacy 3DENA commit:
  `d02019ad872c5ece3840be2b4028ef27af38b2ff`;
- jENA commit: `2f63db4c6ccf5684afc8437ae81ed1a3ccd0c1a3`;
- npm package snapshot: `jena-js@0.6.2`;
- legacy R: 4.4.1;
- legacy application rENA: 0.2.7;
- jENA's principal golden reference: rENA 0.3.1.

Do not silently change the oracle version, jENA version, numerical tolerance,
fixture, seed, schema, or expected output. Record every intended change in a
versioned parity contract or divergence ledger.

The audited `jena-js@0.6.2` package declares a self-dependency on
`jena-js@^0.6.0`. Fix and validate that packaging defect, ideally in a successor
release, before treating the dependency graph as production-ready. Pin exactly
one reviewed jENA version in application builds.

The audited jENA package is ESM-only and requires Node 18 or newer. Prefer its
documented stable exports and wrap them behind the repository adapter; do not
spread jENA internal object shapes through UI, plotting, or export packages.
Treat `jena-js/experimental` as unstable unless a reviewed adapter pins and
tests the exact API. The verified Next.js consumer path used a module Worker and
`next build --webpack`; do not claim Turbopack, Firefox, WebKit, or Safari support
until the exact production build and real-browser flows pass here.

## Architecture constraints

Keep scientific computation outside React components and short-lived Next.js
request handlers.

The preferred repository shape is:

- `apps/web`: Next.js App Router, React UI, routes, and optional aggregate-only
  AI endpoint;
- `packages/domain`: typed datasets, analysis specifications, diagnostics, and
  state-independent contracts;
- `packages/jena-adapter`: validated 3DENA-to-jENA input and result mapping;
- `packages/io`: CSV, Excel, `.ena3d.json`, limits, and safe parsing;
- `packages/stats`: inferential statistics and effect sizes;
- `packages/trajectory`: centroid paths, cohorts, distances, bootstrap, and
  comparisons;
- `packages/plotly-spec`: pure Plotly trace/layout compilation;
- `packages/exports`: CSV, ZIP, manifest, and provenance;
- `packages/worker-protocol`: tasks, progress, cancellation, deadlines, and
  ownership;
- `packages/parity-contracts`: fixtures, tolerances, schemas, and approved
  divergences.

This structure is a direction, not authorization to create empty packages for
appearance. Introduce a package when it owns a real tested boundary. Choose one
package manager, commit its lockfile, and do not mix lockfiles. The current root
contract selects npm workspaces and Node `>=20.9.0`; use those unless an
authorized successor changes `package.json`, `.npmrc`, and the lockfile
together.

Use browser Web Workers for ENA, statistics, trajectory, and bootstrap. If
calibration proves that documented maximum workloads cannot fit safely in
supported browsers, surface the evidence and obtain an architecture decision
before introducing a persistent Node computation service. Do not hide long CPU
work in a Vercel serverless request.

Worker messages must be structured-clone safe. Do not attempt to send arbitrary
JavaScript weighting functions across the worker boundary; encode approved
weighting behavior as versioned serializable names and parameters. jENA's
current synchronous model/SVD phase cannot be assumed to support cooperative
mid-compute cancellation, so hard worker termination and reconstruction must be
available.

Use Plotly for the established 2D/3D analysis semantics unless a reviewed
decision explicitly changes the renderer. A replacement must prove trace roles,
geometry, hover content, camera behavior, exports, and accessibility—not merely
look similar in one screenshot.

## Scientific invariants

Treat the following as product correctness, not optional polish:

- longitudinal time points use one shared ENA rotation space;
- Class 1 and comparable longitudinal figures retain SVD1/SVD2/SVD3 axes,
  directional paths, labels, square centroid markers, and the approved
  confidence-box language;
- display-only filters do not refit the model or alter computed rows and formal
  exports;
- participant-period duplicates are reduced before group-time centroids;
- available and complete cohort policies remain distinct;
- missing-data and gap behavior is explicit and tested;
- selected-space and full-space distance semantics remain distinct;
- bootstrap resamples the approved participant clusters and preserves complete
  participant histories;
- paired comparison uses exact typed ID-time matching;
- network overlay provides context and does not alter trajectory estimands;
- edge and node order, group alignment, metadata, diagnostics, and provenance
  are part of the contract.

Do not confuse jENA's `AccumulatedTrajectory` or `SeparateTrajectory`
accumulation models with 3DENA's centroid trajectory analysis. The latter is a
separate analysis subsystem and must be implemented and validated explicitly.

## Numerical parity policy

Target scientific/semantic parity, not undefined bit-for-bit similarity.

- Align ordinary SVD axes by sign before coordinate comparison.
- For degenerate or near-degenerate singular values, compare the represented
  subspace or an approved Procrustes-equivalent result.
- Compare names, row/column order, categorical levels, diagnostics, and schema
  exactly unless a versioned successor contract approves a difference.
- Define absolute and relative tolerances per quantity; do not use a single
  unexplained global epsilon.
- Freeze RNG, sampling, sorting, tie, zero, missing-value, and quantile rules
  for bootstrap and nonparametric statistics.
- Treat rENA 0.2.7 versus 0.3.1 differences as explicit migration decisions,
  not incidental test updates.
- Never update a golden merely because the new implementation produced a
  different value. Reproduce, explain, independently review, and record the
  disposition first.

The legacy RDS-byte dataset hash is not naturally portable to TypeScript.
Prefer a reviewed, versioned successor based on source-file and canonical JSON
hashes. Do not claim legacy hash parity unless it is actually implemented and
verified.

## Typed data and identity

Never identify scientific entities with display strings or unsafe JavaScript
numbers.

- Preserve IDs above `Number.MAX_SAFE_INTEGER`; `2^53` and `2^53 + 1` must not
  collapse.
- Use canonical typed keys or lossless strings/BigInt where appropriate.
- Preserve multi-column tuple boundaries without delimiter collisions.
- Account for adjacent IEEE-754 doubles, factors and ordered factors, Date,
  POSIXct including DST folds, difftime, logical, integer, double, and character
  values when the corresponding contract is in scope.
- Metadata declared as unit-level must be constant within a unit.
- Reject ambiguous reuse of an apparent participant label across groups unless
  grouping is part of the unit identity.

## Data, export, and AI safety

Preserve the legacy security posture unless a reviewed successor is stricter:

- browser inputs may include CSV, XLSX, XLS, and strict `.ena3d.json`;
- do not accept arbitrary `.RData`, `.rda`, `.rds`, or R workspace uploads;
- validate magic bytes, archive expansion, depth, rows, columns, cells, nodes,
  dimensions, groups, and size limits before expensive processing;
- dataset activation is transactional: failed import must not replace the
  active valid dataset;
- reject unknown, duplicate, missing, misordered, or cross-table-inconsistent
  exchange fields according to the versioned schema;
- reject or encode non-finite values according to the contract;
- neutralize spreadsheet-formula injection in CSV downloads;
- prevent raw rows, participant IDs, private research context, and unapproved
  identifier-like fields from entering logs or AI requests.

AI is optional and default-off until its evidence, consent, suppression,
validation, rate-limit, secret, provider, and failure-isolation gates pass. An
AI failure must never mutate the active scientific result. Server-side AI may
receive only the exact aggregate envelope shown to and approved by the user.

## Worker and state lifecycle

Every asynchronous result must be owned by an immutable combination such as
`datasetHash + specHash + runId`.

- Changing the dataset or analysis specification invalidates old results.
- Cancellation and timeout must stop CPU work; `Promise.race()` alone is not
  cancellation.
- A worker or capacity slot remains occupied until termination is actually
  observed.
- Duplicate cancellation must be safe and deterministic.
- A late callback may not publish stale data.
- Test rapid cancel/restart, maximum concurrency plus one, page close, dataset
  replacement, worker crash, timeout, and memory recovery.
- Do not declare cleanup complete from UI state alone; verify worker/process
  termination and registry state.

## Visual and interaction contract

Follow `design-system/3dena-next/MASTER.md` and any matching page override.
Also preserve the established analytical visual language where it conveys
meaning:

- red SVD1, blue SVD2, and green SVD3 directional axes;
- stable group and period color mappings;
- correct positive/negative difference-edge semantics;
- centroid, participant, node, network, uncertainty, and trajectory trace roles;
- camera persistence, dimension changes, hidden-tab resize, fullscreen, and
  responsive layout;
- keyboard operation, visible focus, reduced motion, and accessible status
  text.

Prefer structural Plotly-spec assertions for analysis correctness and browser
screenshots for presentation regressions. A screenshot alone cannot prove the
underlying analysis or export.

## Working rules

1. Inspect the worktree and existing instructions before editing.
2. Preserve unattributed or unrelated user changes; do not broadly clean,
   overwrite, stage, or reformat them.
3. Convert each requested feature or control into an explicit acceptance item.
4. Freeze the relevant source SHA, fixture, options, seed, and expected schema
   before parity work.
5. Reproduce a defect and create a failing regression before applying a fix
   whenever practicable.
6. Keep implementation and independent acceptance separate for scientific,
   lifecycle, and release-critical changes.
7. Run focused tests during iteration, then the required integrated numerical,
   browser, security, and production gates.
8. Preserve command exit codes; do not hide failures behind output pipelines or
   trailing commands.
9. Record intentional divergences and successor contracts durably in the repo.
10. Do not publish, deploy, cut over, or change npm/GitHub state without user
    authorization.

## Completion language and evidence

Use these states consistently:

- `PLANNED`: design or schedule only;
- `IMPLEMENTED_UNVERIFIED`: code exists but required evidence is missing;
- `PARITY_CANDIDATE`: focused parity passes, integrated closure incomplete;
- `VERIFIED_PARITY`: the approved numerical and functional matrix passes;
- `PRODUCTION_CANDIDATE`: exact build has passed local and preview gates;
- `PRODUCTION_READY`: exact deployed build, security, performance, browser,
  soak, provenance, and rollback evidence all pass.

Never infer a broader state from a narrower test. In particular:

- a visible 3D plot does not prove numerical parity;
- unit tests do not prove worker termination or browser behavior;
- a successful build does not prove downloads, routes, or production health;
- a preview deployment does not prove production readiness;
- an agent reporting completion does not substitute for current artifacts and
  test evidence.

For the public product, test each visible control as a functional unit. Verify
the official routes, deep-link refresh, browser back/forward, analysis state,
real downloads, console/request errors, and build identity in a real browser.

## Agent-native schedule baseline

The active planning baseline assumes four `gpt-5.6-sol Ultra` agents running
continuously, 24 hours per natural day, with necessary owner decisions returned
quickly. These are cumulative wall-clock targets, not human work weeks:

| Milestone | Internal P50 | Planning P80 |
|---|---:|---:|
| Calibration and trusted vertical slice | 2 days | 4 days |
| Coherent internal beta | 7 days | 12 days |
| Current public `/app` functional parity | 16 days | 30 days |
| Public production replacement | 30 days | 45 days |
| Strict whole-repository semantic parity | 45 days | 70 days |

Code appearing early does not move a milestone. The corresponding oracle,
browser, export, lifecycle, security, and release receipts must pass.

Pause and re-estimate after calibration if the jENA/legacy numerical relation,
browser capacity, licensing strategy, or product scope contradicts the recorded
assumptions. External approval waiting and paused agent execution extend calendar
dates one-for-one and are not hidden inside agent-hours.

## License gate

The legacy 3DENA repository audited in the originating session was Apache-2.0,
while `jena-js@0.6.2` declares GPL-3.0-only. The current `j-3dENA` root
`package.json` and `LICENSE` select `GPL-3.0-only`; preserve that declaration
unless the owner explicitly authorizes a reviewed successor.

This project-level GPL choice resolves the basic Apache-only versus GPL product
direction, but it does not replace release compliance. Before distribution,
verify the complete license text, dependency notices, source offer/source
availability requirements, package metadata, and treatment of any legacy or
rENA-derived material. Do not copy or translate legacy/rENA source under the
assumption that a language change alters its license status, and do not call a
release license-complete based only on passing technical tests.
