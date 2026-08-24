# 2026-08-20 — Strict whole-repository successor implementation record

## Status and authority

This record supersedes the unresolved scope and compute-topology questions in
the earlier feasibility record. It does not rewrite that historical record and
does not claim completion.

Owner-authorized decisions captured in the implementation request:

- target strict whole-repository semantic replacement, not only public `/app`;
- adjudicate rENA 0.2.7, rENA 0.3.1, or a reviewed successor per quantity;
- require authorized raw Class 1 coded rows before any raw Class 1 parity claim;
- publish one stable `@3dena/analysis` npm facade while keeping implementation
  packages private;
- route production scientific workloads through a persistent TypeScript
  compute service by default;
- retain the browser jENA Worker for bounded preflight, development calibration,
  and SDK compatibility rather than as the production workload authority;
- keep AI default-off and aggregate-only;
- keep R/rENA development-only and absent from all production artifacts.

The current product state remains `IMPLEMENTED_UNVERIFIED`. The governed
small-raw configuration remains a fixture-scoped `PARITY_CANDIDATE`. The Class
1 exchange remains a `PRECOMPUTED_COMPATIBILITY_CANDIDATE` and is not a raw
jENA recomputation. The small-raw generated oracle remains
`approvedForParity=false`; neither candidate is independently approved.

## Implementation baseline

- Branch: `main`.
- Starting HEAD: `4a0f0a6c79b8872e0a07d6ac239b5a4e863a6d48`.
- The starting worktree contained overlapping tracked modifications and
  untracked candidates across Web, analysis, parity, I/O, export, spreadsheet,
  trajectory, fixtures, and CI.
- Existing changes are preserved and are promoted by narrow subsystem review;
  no reset, clean, stash, or broad overwrite is authorized.
- A clean-install preflight failed because the lock did not yet include
  `@3dena/tabular-import` and the frozen `xlsx@0.20.3` tarball.
- The frozen SheetJS tarball SHA-256 is
  `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`.

The missing workspace and vendored-tarball lock entries have since been added
to the local candidate. The final code snapshot, immediately before the final
documentation-only receipt and evidence-scope corrections, was copied to
`/tmp/j3dena-fresh-final-v2.sisGMK`, excluding
existing `node_modules`, `.next`, `dist`, coverage and browser-report outputs
while preserving `.git`. The source status before exclusions contained 386
lines with SHA-256
`09dfcd65708a63142258917336a867af0e8b34d73dde62c963eec0986d1f7a04`;
the filtered source and copied status both contained 268 lines with SHA-256
`2c1994545abfa247676bd782b36f86833109323caeb27841bf72fa0ea499310a`,
and their line-by-line diff was empty. From that copy,
`npm ci --ignore-scripts` installed 718 packages, audited 732 and reported zero
vulnerabilities, then the complete local `npm run check` exited zero from fresh
dependencies. The workspace run covered 50 test files / 338 tests; together
with the focused golden rerun, oracle-custody, runtime-boundary and
release-security unit gates, 383 enumerated test executions passed. The golden
19 are deliberately counted twice because the gate reruns them. The optimized
`next build --webpack`, four public-package consumer classes, live
runtime/release verifiers and CI action-pin gate also passed. The retained
install and check logs under `/tmp/j3dena-fresh-final-v2.sisGMK.logs` have
SHA-256
`816975e804d00136a6fb0fdbdb7ddbb4498ebb8e49edd141c39e582ffde6ef50`
and
`67ff9c42ca4dd9365234d7224ef62a2196163567a29f924533c990494a5822e8`.
This is a fresh-dependency copy of that exact dirty snapshot, not a clean
checkout or remote CI receipt. Generated outputs were subsequently rebuilt in
the shared tree, and this receipt plus the ledger's small-raw scope wording were
updated; no production/source code changed after the copy, and no claim is made
that the dirty tree became clean. The historical failed preflight above remains
part of the record.

## Local implementation checkpoint — 2026-08-21

The following candidates now exist in the shared worktree. None of these
items, separately or together, changes the whole-product state from
`IMPLEMENTED_UNVERIFIED`:

- raw jENA results retain every returned rotation, point, node, variance and
  eigenvalue dimension; a separate display contract selects two or three axes;
- strict v1 contracts cover typed identity, dataset receipts and limits,
  analysis/display/task ownership, result evidence and provenance, with
  runtime validators and generated JSON Schemas;
- the local task executor covers ENA, Comparison, Change, Stats, trajectory,
  trajectory comparison and bootstrap discriminants, while explicitly leaving
  the older comparison/bootstrap estimator limitations in its documentation;
- a backward-compatible execution-dataset v2 discriminant now accepts either
  raw jENA or prepared-exchange immutable sources. Prepared Comparison, Change
  and Stats run through the public task core only after canonical result-hash,
  activated-receipt, full-space and line-weight alignment checks, and always
  publish `sourceKind: prepared-exchange` / `jenaExecuted: false`; prepared
  trajectory, trajectory comparison and bootstrap fail closed;
- the additive trajectory-dynamics core covers duplicate reduction,
  available/complete cohorts, equal/weighted estimands, selected/full distance,
  numeric/Date/instant/difftime elapsed time and speed;
- the pure Plotly compiler and deterministic export portfolio cover raw and
  prepared results without treating prepared coordinates as a jENA execution;
- an in-memory compute-orchestration core exercises leases, fencing, hard
  cancellation, observed child exit, stale-result rejection, deletion and TTL.
  A framework-neutral HTTP layer and real single-host Node child supervisor now
  exercise the public client, IPC-ready, deadline/abort, SIGKILL escalation and
  close-observed capacity contract. A fixed child additionally rehashes
  immutable input, executes the public scientific task, writes a
  checksum/owner/lease-bound artifact and waits for publication acknowledgement
  before exit zero. These are not the required PostgreSQL/S3/distributed
  production service or hardened container;
- the dataset-workflow core now exercises independent browser/service byte
  custody, authoritative parser inventory, exact worksheet selection, ordered
  role mapping, typed preview, parsed-row content hashing and generation-fenced
  atomic activation. It has no HTTP/UI or durable storage adapter;
- Web product candidates now expose raw and prepared Comparison, Change and
  Stats paths with downloads. Prepared execution now uses the same public task
  executor, V2 source discriminant, canonical result hash, exact dataset
  receipt, task owner and public result envelope as raw execution while
  preserving `sourceKind: prepared-exchange` and `jenaExecuted: false`. Exact
  evidence labels bind the small-raw candidate to its dataset/spec/version and
  explicit non-development build contract; arbitrary raw results report
  `legacyGoldenStatus: not-assessed`, and Class 1 remains visibly precomputed;
- the Stats candidate now carries alternative-aligned 95% Welch and paired-t
  mean-difference intervals through typed results, the raw Web table and the
  formal statistics CSV. It tags finite, open, undefined and unrepresentable
  bounds and does not relabel these intervals as rank-test or effect-size CIs;
- a staged prerelease facade bundles the internal implementation behind the
  `@3dena/analysis` root entry, includes declarations, source maps, schemas,
  licenses, notices and provenance, and has been consumed locally by fresh
  Node, strict TypeScript, browser-bundler and Next.js webpack smoke projects.

The final shared-worktree facade smoke used prerelease
`0.1.0-implemented-unverified.0`, build ID
`local-20260821-final-v2`, tarball SHA-256
`accfc4389ad1373dae259358f19a36eef831742663f04d2f715ecbce20306294`,
and bundle SHA-256
`065a4ad8568b5d048e329ece2ee9d0a10a12d40062ee503ee6a2f63c1c0724c3`;
it packed 1,244,171 bytes / unpacked 5,091,343 bytes across 118 files. The
fresh-dependency copy independently rebuilt the same 118-file facade with
build ID `local-20260821-final-v2-fresh`; its build-bound tarball SHA-256 was
`e7dafdadb4c04b0f0e3c40029baafd538a40b51fe0b0a057197eee2d589ab287`
and its bundle SHA-256 was identical. Both exposed exactly the five reviewed
runtime functions and passed the four local consumer classes above. The
result-envelope runtime validator and generated JSON Schema
now bind every task kind to its reviewed result `schemaVersion` and require the
task, result and envelope schema versions in provenance. This remains a
discriminator-level guard, not a complete per-field validator for every result
variant. A separate exact Node `v20.9.0` smoke imported the five root runtime
exports and completed a 32-byte CSV inspection, covering the package's declared
minimum Node runtime. It is not an npm registry, preview, deployment or release
receipt.

The final browser checkpoint used the installed Google Chrome
`151.0.7922.138` and passed 20/20 isolated managed-development cases, 22/22
automated accessibility cases against the optimized app, and 3/3 exact
`browser-final-prepared-wiring-20260821` build-identity plus raw/prepared
Comparison, Change, Stats and download cases after a successful
`next build --webpack` and `next start`. Playwright used isolated ports,
`reuseExistingServer=false`, `/build-info` preflight and the system Chrome
channel; no browser was installed. This is a local Chrome-only receipt.
Firefox, real Safari/WebKit, manual screen-reader acceptance and deployed
browsers remain open.

The local dependency/security checkpoint reported zero `npm audit`
vulnerabilities. It also found that npm's native production CycloneDX output
contained only 272 of 296 reachable production components and omitted 24
packages plus their dependency nodes/edges; that artifact is now a fixed
fail-closed regression and is not accepted as release evidence. The repository
lock-graph generator instead produced a deterministic CycloneDX 1.5 document
with 296 components and 297 dependency entries. The final lock snapshot has
SHA-256
`07bacc8f53887acc2a53e7d889cb5cd236a62e7581c37db9d84ef5cb00a8e9b6`
and serial number `urn:uuid:7a42ed77-0672-52d6-ba9e-4a6db83ae5da`.
The combined verifier passed 14 private GPL workspace manifests, 296/296
production license dispositions, the runtime boundary, the 118-file staged
public facade, and the complete generated graph. `git diff --check` passed.
These are local candidate receipts, not SAST, secret-scan, parser-fuzz,
container-scan, signed artifact, legal approval, or remote CI evidence.

## New architecture decision

The persistent compute service decision is specified in
`docs/architecture/persistent-compute-service-v1.md`. This is an authorized
successor to the earlier Worker-first planning assumption. It does not permit
R, a short-lived serverless compute route, unbounded retention, or raw-data
logging.

## Evidence rule

Every receipt must state its scope: fixture, feature, build, or deployment.
Fixture evidence may never be attached to arbitrary user data. A generated
golden remains unapproved until an independent approval record exists. Code,
unit tests, a visible plot, a build, a preview, and a production deployment are
separate gates.

## External hard gates

- raw Class 1 custody, authorization, de-identification, mapping, and oracle;
- independent per-quantity scientific decisions and fixture approvals;
- npm namespace and provenance authorization;
- remote/CI, preview, and production infrastructure authorization;
- release-level GPL and third-party notice review.

Until those external gates exist, implementation may progress but the broader
status must fail closed.

## Known local implementation gaps

- No authorized Class 1 raw coded rows, raw mapping, dual rENA oracle or
  independent Class 1 approval exists.
- The public Web still runs scientific work in browser module Workers. The
  persistent client/service packages are not wired as the default Web compute
  authority, so the owner-approved production topology is not yet delivered.
- The compute candidate has no PostgreSQL repository, S3-compatible immutable
  object adapter, distributed capacity coordinator, restart reattachment,
  acknowledgement replay, durable orphan recovery or production container
  evidence. Long synchronous jENA execution is not cooperatively cancellable;
  runtime deadlines depend on a persistent core sweep and observed
  SIGTERM-to-SIGKILL exit. A parent crash has no `PDEATHSIG`/container-level
  orphan guarantee. The current scientific-child matrix remains narrow.
- The spreadsheet transaction core has no HTTP/UI, durable encrypted object/
  database adapters, restart recovery, TTL/deletion or browser product flow.
- The public facade bundles one jENA implementation and removes its published
  self-dependency from the staged tarball, but the workspace lock graph still
  records `jena-js@0.6.2` declaring itself. No separately reviewed successor
  package/commit has closed that production dependency-graph gate.
- Statistics, trajectory, Comparison, Change and bootstrap lack the complete
  per-quantity oracle and independent scientific review matrix.
- The Web evidence stamp records the exact build ID observed for a run and
  rejects missing/development identities, but it does not compare that ID to an
  independently approved build-SHA allowlist. The small-raw numerical matrix is
  enforced by the local golden gate, not recomputed inside each UI evidence
  assessment; therefore this remains candidate traceability, not approved-build
  evidence.
- Prepared trajectory, trajectory comparison and bootstrap have no approved
  public task semantics and are deliberately rejected. Execution-dataset v2
  currently has strict validation inside `executeAnalysisTask()` but no
  independently exported standalone validator/schema.
- The result-envelope validator binds task/result discriminants and ownership,
  but the compute parent cannot yet invoke one exported complete per-field
  validator for every result variant before publication.
- Advanced bootstrap intervals and model-refit uncertainty are not claimed;
  the legacy inventory decision for those rows remains open.
- No authorized Git remote/CI receipt, npm publication, preview, canary,
  production deployment, soak, deletion-policy proof or rollback drill exists.
