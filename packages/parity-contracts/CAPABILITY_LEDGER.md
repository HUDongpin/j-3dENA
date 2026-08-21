# Strict whole-repository capability ledger

This ledger maps the intentional legacy/product surface to an explicit target
disposition. A target disposition is not evidence that the row is complete.
`TS_SUCCESSOR_VERIFIED` requires linked numerical, contract, integration,
browser/export, and release receipts appropriate to that row.

| ID | Capability | Target disposition | Current state | Closure evidence |
|---|---|---|---|---|
| DATA-001 | Strict CSV exact-byte import and mapping | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | transaction core independently rehashes service bytes, binds parsed row content, maps typed preview and atomically activates in 17 focused tests; HTTP/UI, durable adapters, browser flow and load evidence remain |
| DATA-002 | XLSX/XLS inventory, sheet selection and parse | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | frozen SheetJS hash, package parser matrix and exact multi-sheet selection workflow candidate exist; real workbook workflow receipt, durable service, policy-complete adversarial cases and UI remain |
| DATA-003 | Strict `.ena3d.json` prepared exchange | `TS_SUCCESSOR_VERIFIED` | `PRECOMPUTED_COMPATIBILITY_CANDIDATE` | current fixture proves precomputed custody only; approved schema/custody and product/browser/export matrix remain |
| DATA-004 | Native R workspace upload | `OWNER_APPROVED_RETIREMENT` | rejected by successor contract | implementation request explicitly requires rejecting RData/rda/rds/workspaces |
| DATA-005 | Transactional dataset activation | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | generation fence, immutable upload/parsed/activation identities, storage CAS and failed-import/stale/conflict preservation tests exist; cross-process durable CAS, restart, TTL/deletion and browser replacement matrix remain |
| ID-001 | Lossless scalar and tuple identity | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | focused int64, adjacent-double, signed-zero, tuple, factor, date/instant/DST-fold/duration tests exist; reviewed property/fuzz matrix remains |
| ENA-001 | EndPoint model | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | approved raw oracle configuration |
| ENA-002 | AccumulatedTrajectory model | `TS_SUCCESSOR_VERIFIED` | `PARITY_CANDIDATE` for the exact small-raw fixture/spec only; otherwise `IMPLEMENTED_UNVERIFIED` | small-raw approval plus broader oracle matrix |
| ENA-003 | SeparateTrajectory model | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | approved raw oracle configuration |
| ENA-004 | MovingStanza and Conversation windows | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | back/forward/conversation edge-case oracle matrix |
| ENA-005 | Binary/sum weighting and centering | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | versioned serializable registry and approved goldens |
| ENA-006 | Full rotation, points, nodes, variance and eigenvalues | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | adapter retains all returned dimensions and display selection is separate; full-dimensional raw Class 1 oracle and resource evidence remain |
| ENA-007 | Raw Class 1 recomputation | `TS_SUCCESSOR_VERIFIED` | blocked: legacy prepared candidate quarantined as `sensitive-excluded`; no authorized raw custody or approval | authorized raw custody, mapping, dual oracle and independent approval |
| ENA-008 | Near-degenerate SVD subspace adjudication | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | rank-checked projector comparator and synthetic invariance tests exist; governed tied-spectrum fixture, tolerance decision and independent approval remain |
| VIEW-001 | Overall results and scoped evidence | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | exact result tables, evidence binding and browser checks |
| VIEW-002 | Networks with node/edge/group/time semantics | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | structural Plotly, exact table and export assertions |
| VIEW-003 | Two-group Comparison and signed difference network | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | A-minus-B raw/prepared public task core, Web state and download candidates exist; prepared provenance remains non-jENA and descriptive-only, while scientific oracle, confidence language and full Plotly/export closure remain |
| VIEW-004 | Change level network | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | raw/prepared typed level-selection public task and Web candidates exist; prepared is one-level descriptive reduction, while legacy cardinality/cache oracle and full download/trace closure remain |
| STAT-001 | Independent Welch and rank-sum statistics | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | typed package plus raw/prepared public task candidates cover Welch/rank-sum/effects/N/drop/p-adjust and explicitly t-only 95% mean-difference CIs; focused high-precision review repaired extreme-range scaling and CSV missing/unmatched ownership, while formula/tie/CI oracle, prepared inferential disposition and independent approval remain |
| STAT-002 | Paired exact matching and signed-rank statistics | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | raw and prepared public tasks use full typed participant identity plus canonical time, with signed-rank, unmatched diagnostics and an explicitly paired-t 95% mean-difference CI; approved identity/oracle matrix and paired browser flow remain |
| TRAJ-001 | Participant-period reduction and cohort policies | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | dynamics package tests duplicate reduction, available/complete cohorts, missing periods and gaps; raw/prepared oracle and UI remain |
| TRAJ-002 | Selected/full distance, elapsed time and speed | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | numeric/Date/instant/difftime and selected/full dynamics plus formal CSV candidate exist; oracle and product/Plotly chain remain |
| TRAJ-003 | Weighted trajectory estimand | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | explicit weighted-participant task and effective-N diagnostics exist; frozen estimator decision, oracle and product control remain |
| TRAJ-004 | Paired and independent path comparison | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | exact match/permutation oracle, UI and export |
| BOOT-001 | Participant-history cluster bootstrap | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | frozen resample plan, RNG/quantile decision, lifecycle/UI/export |
| BOOT-002 | BCa/studentized/simultaneous/model-refit intervals | pending legacy inventory | not claimed | verify legacy presence; then implement or record explicit non-parity disposition |
| PLOT-001 | 2D/3D dimensions, axes, camera and fullscreen | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | pure compiler tests cover arbitrary retained axes, 2D/3D scale and camera contract; centralized Web use and complete real-browser state/focus matrix remain |
| PLOT-002 | Confidence boxes, path arrows and network overlay | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | scientific geometry contract, table equivalent and browser evidence |
| EXP-001 | Canonical CSV/ZIP/manifest/provenance | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | deterministic raw/prepared portfolio tests cover hashes, CRLF and applicable derived tables; complete browser downloads and reviewed lossless/formula policy remain |
| LIFE-001 | Immutable ownership and stale suppression | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | Web Worker ownership tests and in-memory service fencing/CAS candidates exist; cross-service dataset replacement/restart matrix remains |
| LIFE-002 | Queue, lease, timeout, hard cancel and observed exit | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | in-memory lease/fencing/CAS plus real Node IPC-ready/abort/deadline/SIGKILL/close-observed supervisor and publish-acknowledged scientific-child tests exist; PostgreSQL/S3, replica, restart and acknowledgement-replay integration remain |
| SERVICE-001 | Versioned Compute API, capability, CORS, idempotency, SSE and checksum | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | framework-neutral handlers and public-client in-memory integration exist; persistent adapters, external rate limits, deployment and adversarial network evidence remain |
| SERVICE-002 | PostgreSQL/S3 persistent state and objects | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | exact `0001-persistent-compute` expand migration is active on the Owner's Singapore Neon `main/neondb` with one hash-bound registry row, 17 tables, append-only rejection, transaction rollback, manual child-branch reset/deletion, and automatic Vercel Preview branch inheritance probes; independent approval, signed-BuildApproval Preview, Fly replicas, object storage, restart/capacity/TTL/object-deletion, fencing and soak receipts remain |
| SERVICE-003 | Isolated Node scientific process execution | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | fixed-entry Node child rehashes input, executes the public task, binds result artifact to checksum/owner/lease and waits for CAS acknowledgement; complete task/oracle matrix, reattachment, acknowledgement replay, container and descendant containment remain |
| ROUTE-001 | Public routes, deep links and browser history | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | current managed Chromium and exact-build identity receipts exist; full route/history matrix in Chromium/Firefox/real Safari and deployment remain |
| A11Y-001 | Keyboard, focus, status, reduced motion and tables | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | current automated accessibility matrix is 22/22; manual keyboard/screen-reader and multi-browser evidence remain |
| SDK-001 | One public `@3dena/analysis` facade | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | local prerelease tarball passes Node/strict-TS/Vite/Next-webpack consumers with declarations/maps/schemas/notices/provenance; registry provenance and independent API/release review remain |
| TOOL-001 | Intentional maintained offline product tools | `TS_SUCCESSOR_VERIFIED` | inventory in progress | legacy tool mapping and same-package `3dena` CLI where required |
| ORACLE-001 | R/rENA development oracle tools | `FROZEN_COMPATIBILITY_ARTIFACT` | custody candidate | frozen environment, hashes and production exclusion |
| AI-001 | Aggregate-only optional AI contract | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | internal fixed-vocabulary contract tests default-off, consent, suppression, unknown-field rejection, rate limiting, abort/deadline and failure isolation; provider/privacy/secret/cost/Web/deployment review remains |
| REL-001 | Clean CI, exact artifacts, security and licenses | `TS_SUCCESSOR_VERIFIED` | `IMPLEMENTED_UNVERIFIED` | exact dirty snapshot passed fresh dependency install and the full local check; clean checkout, remote CI, container/preview/soak/rollback and complete release-security receipts remain |

## Ledger completion rule

Before strict closure, replace `pending legacy inventory` with a verified
disposition, add every direct API/property/offline tool found in the frozen
legacy inventory, and attach immutable evidence identifiers to every
`TS_SUCCESSOR_VERIFIED` row. No implementation author may self-approve the
scientific or release-critical row they implemented.

## Machine-readable VERIFIED_PARITY gate

`strict-capability-ledger.v1.json` freezes the 41 capability IDs above and is
the normative release-gate input. It is intentionally `blocked` with no closure
entries. `requireVerifiedParityCapabilityLedgerV1()` accepts exactly one entry
per capability and only the dispositions `verified`, `frozen`, and
`owner-approved-retirement`. Every entry must bind immutable hash/commit/schema
evidence plus a dated approval; self-approval is rejected, and retirement must
be approved by the Owner.

Run `npm run release:strict-closure --workspace @3dena/parity-contracts` to
evaluate this ledger together with the per-quantity scientific authority
matrix. The tracked inputs currently fail by design. `PLANNED`, pending, open,
implemented-unverified, generated, and candidate states cannot satisfy
`VERIFIED_PARITY`.
